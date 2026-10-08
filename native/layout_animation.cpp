#include "layout_animation.h"
#include <godot_cpp/classes/engine.hpp>
#include <react/renderer/animations/LayoutAnimationDriver.h>
#include <react/renderer/mounting/MountingCoordinator.h>
#include <react/renderer/mounting/MountingTransaction.h>
#include <react/renderer/mounting/ShadowTree.h>
#include <react/renderer/uimanager/LayoutAnimationStatusDelegate.h>
#include <react/renderer/uimanager/UIManager.h>
#include <deque>
#include <set>

namespace rn = facebook::react;

namespace fabric_godot {
namespace {
// What one transaction the driver served did to the mounting layer: the counts of its
// mutations by type, at the clock the driver read for it (clock_ms, whole milliseconds)
// and the frame time the runtime had handed over then (frame_ms), with the callbacks the
// driver had queued and whether an animation was in flight when it returned.
struct Pull {
  uint64_t sequence{};
  uint64_t godot_frame{};
  uint64_t clock_ms{};
  double frame_ms{};
  uint64_t callbacks{};
  bool animating{};
  int creates{}, inserts{}, updates{}, removes{}, deletes{};

  folly::dynamic snapshot() const {
    return folly::dynamic::object("sequence", sequence)("godotFrame", godot_frame)("clockMs", clock_ms)("frameMs", frame_ms)
        ("callbacks", callbacks)("active", animating)("creates", creates)("inserts", inserts)("updates", updates)
        ("removes", removes)("deletes", deletes);
  }
};
}

// Everything the module keeps, shared with the executor wrapper and the status delegate
// the driver holds on to. RN signals started and completed from inside a pull
// (LayoutAnimationKeyFrameManager.cpp:1033-1043), on the host's thread.
struct LayoutAnimation::State final : rn::LayoutAnimationStatusDelegate {
  std::shared_ptr<rn::UIManager> ui;
  std::shared_ptr<rn::LayoutAnimationDriver> driver;
  std::set<int> surfaces;
  bool animating{}, stopped{};
  uint64_t started{}, completed{}, callbacks_queued{}, ticks{}, clock_reads{}, clock_reads_served{};
  double frame_ms{};
  uint64_t last_read_ms{};
  uint64_t pull_total{};
  std::deque<Pull> pulls;

  void onAnimationStarted() override {
    animating = true;
    ++started;
  }
  void onAllAnimationsComplete() override {
    animating = false;
    ++completed;
  }
};

LayoutAnimation::LayoutAnimation(std::shared_ptr<State> state) : state_(std::move(state)) {}

LayoutAnimation::~LayoutAnimation() { stop(); }

std::unique_ptr<LayoutAnimation> LayoutAnimation::attach(const std::shared_ptr<rn::UIManager> &ui,
    const rn::SharedComponentDescriptorRegistry &descriptors, rn::RuntimeExecutor executor,
    const std::shared_ptr<rn::ContextContainer> &context) {
  auto state = std::make_shared<State>();
  state->ui = ui;
  // Everything the driver sends JS (its end and failure callbacks) goes through the application's
  // executor, which only counts what passes.
  std::weak_ptr<State> weak = state;
  rn::RuntimeExecutor counted = [weak, executor = std::move(executor)](std::function<void(facebook::jsi::Runtime &)> &&callback) {
    if (auto owner = weak.lock()) {
      ++owner->callbacks_queued;
    }
    executor(std::move(callback));
  };
  // The constructor takes the container as a mutable reference to a pointer to const.
  std::shared_ptr<const rn::ContextContainer> container = context;
  state->driver = std::make_shared<rn::LayoutAnimationDriver>(std::move(counted), container, state.get());
  // The time RN reads is the frame time the runtime handed over, truncated to the whole
  // milliseconds RN works in (LayoutAnimationKeyFrameManager.cpp:82-95 takes the same
  // reading from the system clock).
  state->driver->setClockNow([weak]() -> uint64_t {
    auto owner = weak.lock();
    if (!owner) {
      return 0;
    }
    ++owner->clock_reads;
    owner->last_read_ms = static_cast<uint64_t>(owner->frame_ms);
    return owner->last_read_ms;
  });
  // As Scheduler.cpp:157-161 does, in this order.
  state->driver->setComponentDescriptorRegistry(descriptors);
  ui->setAnimationDelegate(state->driver.get());
  return std::unique_ptr<LayoutAnimation>(new LayoutAnimation(std::move(state)));
}

void LayoutAnimation::register_surface(const rn::ShadowTree &tree) {
  if (state_->stopped) {
    return;
  }
  tree.getMountingCoordinator()->setMountingOverrideDelegate(state_->driver);
  state_->surfaces.insert(tree.getSurfaceId());
}

void LayoutAnimation::surface_stopped(int surface_id) {
  state_->surfaces.erase(surface_id);
  if (state_->surfaces.empty()) {
    state_->animating = false;
  }
}

bool LayoutAnimation::active() const { return state_->animating && !state_->stopped; }

void LayoutAnimation::clock(double frame_ms) {
  if (frame_ms > state_->frame_ms) {
    state_->frame_ms = frame_ms;
  }
}

void LayoutAnimation::tick(double frame_ms) {
  if (state_->stopped) {
    return;
  }
  clock(frame_ms);
  ++state_->ticks;
  state_->ui->animationTick();
}

void LayoutAnimation::pulled(const rn::MountingTransaction &transaction) {
  auto &state = *state_;
  // The driver reads the clock once for every transaction it serves, and none for the ones
  // it leaves alone: the reads say which pulls were its.
  if (state.stopped || state.clock_reads == state.clock_reads_served) {
    return;
  }
  state.clock_reads_served = state.clock_reads;
  Pull pull;
  pull.sequence = ++state.pull_total;
  pull.godot_frame = godot::Engine::get_singleton()->get_process_frames();
  pull.clock_ms = state.last_read_ms;
  pull.frame_ms = state.frame_ms;
  pull.callbacks = state.callbacks_queued;
  pull.animating = state.animating;
  for (const auto &mutation : transaction.getMutations()) {
    switch (mutation.type) {
      case rn::ShadowViewMutation::Create:
        ++pull.creates;
        break;
      case rn::ShadowViewMutation::Insert:
        ++pull.inserts;
        break;
      case rn::ShadowViewMutation::Update:
        ++pull.updates;
        break;
      case rn::ShadowViewMutation::Remove:
        ++pull.removes;
        break;
      case rn::ShadowViewMutation::Delete:
        ++pull.deletes;
        break;
    }
  }
  state.pulls.push_back(pull);
  if (state.pulls.size() > max_pulls) {
    state.pulls.pop_front();
  }
}

void LayoutAnimation::stop() {
  auto &state = *state_;
  if (state.stopped) {
    return;
  }
  state.stopped = true;
  state.animating = false;
  // The UIManager stops calling the driver before it is destroyed, and the destruction drops the
  // JS callbacks it holds while the runtime they belong to is alive.
  state.ui->setAnimationDelegate(nullptr);
  state.driver.reset();
}

folly::dynamic LayoutAnimation::snapshot() const {
  const auto &state = *state_;
  folly::dynamic pulls = folly::dynamic::array();
  for (const auto &pull : state.pulls) {
    pulls.push_back(pull.snapshot());
  }
  return folly::dynamic::object("enabled", true)("active", state.animating && !state.stopped)("stopped", state.stopped)
      ("started", state.started)("completed", state.completed)("callbacksQueued", state.callbacks_queued)("ticks", state.ticks)
      ("clockReads", state.clock_reads)("lastClockMs", state.frame_ms)("pullsTotal", state.pull_total)
      ("pullsDropped", state.pull_total - state.pulls.size())("pulls", std::move(pulls));
}
}
