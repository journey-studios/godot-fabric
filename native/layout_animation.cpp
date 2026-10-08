#include "layout_animation.h"
#include <godot_cpp/classes/engine.hpp>
#include <react/renderer/animations/LayoutAnimationDriver.h>
#include <react/renderer/mounting/MountingCoordinator.h>
#include <react/renderer/mounting/MountingOverrideDelegate.h>
#include <react/renderer/mounting/MountingTransaction.h>
#include <react/renderer/mounting/ShadowTree.h>
#include <react/renderer/uimanager/LayoutAnimationStatusDelegate.h>
#include <react/renderer/uimanager/UIManager.h>
#include <deque>
#include <optional>
#include <set>

namespace rn = facebook::react;

namespace fabric_godot {
namespace {
// What one transaction the driver served did to the mounting layer: the counts of its
// mutations by type, at the time the driver read for it (read_ms, whole milliseconds) and
// the frame time the runtime had handed over then (frame_ms), with the callbacks the driver
// had queued and whether an animation was in flight when it returned.
struct Pull {
  uint64_t sequence{};
  uint64_t godot_frame{};
  uint64_t read_ms{};
  double frame_ms{};
  uint64_t callbacks{};
  bool animating{};
  int creates{}, inserts{}, updates{}, removes{}, deletes{};

  folly::dynamic snapshot() const {
    return folly::dynamic::object("sequence", sequence)("godotFrame", godot_frame)("readMs", read_ms)("frameMs", frame_ms)
        ("callbacks", callbacks)("active", animating)("creates", creates)("inserts", inserts)("updates", updates)
        ("removes", removes)("deletes", deletes);
  }
};

// The mounting override delegate every surface hands its coordinator. It is RN's driver, which it forwards to
// unchanged, and it is the one place that knows a transaction was served by the driver: the coordinator calls
// pullTransaction only for a delegate that asked to override, and what the driver returns is reported to record.
class RecordingDriver final : public rn::MountingOverrideDelegate {
 public:
  using Record = std::function<void(const rn::MountingTransaction &)>;
  RecordingDriver(std::shared_ptr<const rn::MountingOverrideDelegate> driver, Record record)
      : driver_(std::move(driver)), record_(std::move(record)) {}

  bool shouldOverridePullTransaction() const override { return driver_->shouldOverridePullTransaction(); }

  std::optional<rn::MountingTransaction> pullTransaction(rn::SurfaceId surface_id, rn::MountingTransaction::Number number,
      const rn::TransactionTelemetry &telemetry, rn::ShadowViewMutationList mutations) const override {
    auto transaction = driver_->pullTransaction(surface_id, number, telemetry, std::move(mutations));
    if (transaction) {
      record_(*transaction);
    }
    return transaction;
  }

 private:
  std::shared_ptr<const rn::MountingOverrideDelegate> driver_;
  Record record_;
};
}

// Everything the module keeps, shared with the executor wrapper, the clock and the recorder the driver and
// the coordinators hold on to. RN signals started and completed from inside a pull
// (LayoutAnimationKeyFrameManager.cpp:1031-1043), on the host's thread.
struct LayoutAnimation::State final : rn::LayoutAnimationStatusDelegate {
  std::shared_ptr<rn::UIManager> ui;
  std::shared_ptr<rn::LayoutAnimationDriver> driver;
  // What the coordinators of the surfaces point to (weakly) in place of the driver.
  std::shared_ptr<RecordingDriver> recorder;
  std::set<int> surfaces;
  bool animating{}, stopped{};
  uint64_t started{}, completed{}, callbacks_queued{}, ticks{}, clock_reads{};
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

  // The transaction the driver just served: the driver read the clock for it, which is what last_read_ms holds.
  void record(const rn::MountingTransaction &transaction) {
    Pull pull;
    pull.sequence = ++pull_total;
    pull.godot_frame = godot::Engine::get_singleton()->get_process_frames();
    pull.read_ms = last_read_ms;
    pull.frame_ms = frame_ms;
    pull.callbacks = callbacks_queued;
    pull.animating = animating;
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
    pulls.push_back(pull);
    if (pulls.size() > max_pulls) {
      pulls.pop_front();
    }
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
  state->recorder = std::make_shared<RecordingDriver>(state->driver, [weak](const rn::MountingTransaction &transaction) {
    if (auto owner = weak.lock()) {
      owner->record(transaction);
    }
  });
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
  // As Scheduler.cpp:157-161 does, in this order. The driver is the UIManager's animation delegate;
  // the surfaces get it through the recorder.
  state->driver->setComponentDescriptorRegistry(descriptors);
  ui->setAnimationDelegate(state->driver.get());
  return std::unique_ptr<LayoutAnimation>(new LayoutAnimation(std::move(state)));
}

void LayoutAnimation::register_surface(const rn::ShadowTree &tree) {
  if (state_->stopped) {
    return;
  }
  tree.getMountingCoordinator()->setMountingOverrideDelegate(state_->recorder);
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

void LayoutAnimation::stop() {
  auto &state = *state_;
  if (state.stopped) {
    return;
  }
  state.stopped = true;
  state.animating = false;
  // The UIManager stops calling the driver before it is destroyed, and the destruction drops the
  // JS callbacks it holds while the runtime they belong to is alive. The coordinators hold the
  // recorder weakly, so releasing it detaches every surface.
  state.ui->setAnimationDelegate(nullptr);
  state.recorder.reset();
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
      ("clockReads", state.clock_reads)("frameMs", state.frame_ms)("lastReadMs", state.last_read_ms)
      ("pullsTotal", state.pull_total)("pullsDropped", state.pull_total - state.pulls.size())("pulls", std::move(pulls));
}
}
