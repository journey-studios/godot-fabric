#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/components/root/RootComponentDescriptor.h>
#include <react/renderer/components/view/ViewComponentDescriptor.h>
#include <react/renderer/core/RawProps.h>
#include <react/renderer/uimanager/PointerEventsProcessor.h>
#include <react/renderer/uimanager/UIManager.h>
#include <react/utils/ContextContainer.h>
#include <folly/json.h>
#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace rn = facebook::react;
namespace {
std::vector<std::string> checks;
void require(bool condition, const std::string &message) {
  if (!condition) throw std::runtime_error(message);
  checks.push_back(message);
}

struct Entry { rn::Tag tag; std::string type; rn::PointerEvent event; };
struct Fixture {
  std::shared_ptr<rn::ContextContainer> context{std::make_shared<rn::ContextContainer>()};
  rn::ComponentDescriptorProviderRegistry providers;
  std::shared_ptr<const rn::ComponentDescriptorRegistry> registry;
  std::unique_ptr<rn::UIManager> ui;
  rn::PointerEventsProcessor processor;
  std::shared_ptr<const rn::ShadowNode> a, b, c;
  std::vector<Entry> events;
  std::function<void(const Entry &)> callback;

  Fixture() {
    providers.add(rn::concreteComponentDescriptorProvider<rn::ViewComponentDescriptor>());
    providers.add(rn::concreteComponentDescriptorProvider<rn::RootComponentDescriptor>());
    registry = providers.createComponentDescriptorRegistry({{}, context, nullptr});
    ui = std::make_unique<rn::UIManager>([](auto &&) {}, context);
    ui->setComponentDescriptorRegistry(registry);
    for (rn::SurfaceId surface : {1, 11, 21}) {
      rn::LayoutConstraints constraints;
      constraints.minimumSize = constraints.maximumSize = {400, 200};
      ui->startEmptySurface(std::make_unique<rn::ShadowTree>(surface,
          constraints, rn::LayoutContext{}, *ui, *context));
    }
    a = create(1, 2);
    b = create(11, 12);
    c = create(21, 22);
    commit(1, {a});
    commit(11, {b});
    commit(21, {c});
  }
  ~Fixture() {
    for (rn::SurfaceId surface : {1, 11, 21}) ui->stopSurface(surface);
  }
  std::shared_ptr<const rn::ShadowNode> create(rn::SurfaceId surface, rn::Tag tag) {
    const auto &descriptor = registry->at("View");
    auto props = std::make_shared<rn::ViewProps>();
    for (auto offset : {rn::ViewEvents::Offset::PointerDown, rn::ViewEvents::Offset::PointerMove,
        rn::ViewEvents::Offset::PointerUp, rn::ViewEvents::Offset::PointerOver,
        rn::ViewEvents::Offset::PointerOut, rn::ViewEvents::Offset::PointerEnter,
        rn::ViewEvents::Offset::PointerLeave, rn::ViewEvents::Offset::GotPointerCapture,
        rn::ViewEvents::Offset::LostPointerCapture}) props->events[offset] = true;
    props->yogaStyle.setDimension(facebook::yoga::Dimension::Width, facebook::yoga::StyleSizeLength::points(100));
    props->yogaStyle.setDimension(facebook::yoga::Dimension::Height, facebook::yoga::StyleSizeLength::points(100));
    auto family = descriptor.createFamily({tag, surface, nullptr});
    return descriptor.createShadowNode({props, {}, {}, false}, family);
  }
  void commit(rn::SurfaceId surface, std::vector<std::shared_ptr<const rn::ShadowNode>> children) {
    ui->completeSurface(surface, std::make_shared<std::vector<std::shared_ptr<const rn::ShadowNode>>>(std::move(children)), {});
  }
  void send(int id, const std::shared_ptr<const rn::ShadowNode> &target,
      const std::string &type, int buttons = 1) {
    rn::PointerEvent event{};
    event.pointerId = id;
    event.pointerType = "touch";
    event.buttons = buttons;
    event.clientPoint = {25, 30};
    event.offsetPoint = {25, 30};
    processor.interceptPointerEvent(target, type, rn::ReactEventPriority::Discrete,
        event, [this](const rn::ShadowNode &node, const std::string &name,
            rn::ReactEventPriority, const rn::EventPayload &payload) {
          Entry entry{node.getTag(), name, static_cast<const rn::PointerEvent &>(payload)};
          events.push_back(entry);
          if (callback) callback(entry);
        }, *ui);
  }
  std::vector<std::string> sequence() const {
    std::vector<std::string> value;
    for (const auto &event : events) value.push_back(event.type + ":" + std::to_string(event.tag));
    return value;
  }
  bool contains(const std::string &type, rn::Tag tag) const {
    return std::any_of(events.begin(), events.end(), [&](const auto &event) { return event.type == type && event.tag == tag; });
  }
  void remove(int id) {
#ifndef GODOT_FABRIC_POINTER_ORIGINAL_NEGATIVE
    processor.removePointerForGodot(id);
#else
    (void)id;
#endif
  }
  void prune() {
#ifndef GODOT_FABRIC_POINTER_ORIGINAL_NEGATIVE
    processor.clearDisconnectedCaptureTargetsForGodot(*ui);
#endif
  }
  void retire(rn::SurfaceId surface) {
#ifndef GODOT_FABRIC_POINTER_ORIGINAL_NEGATIVE
    processor.clearCaptureTargetsForSurfaceForGodot(surface);
#else
    (void)surface;
#endif
  }
};

void retainedTargetDeletion() {
  Fixture f;
  f.send(1, f.a, "topPointerDown");
  f.processor.setPointerCapture(1, f.b);
  f.send(1, f.a, "topPointerMove");
  require(f.processor.hasPointerCapture(1, f.b.get()), "capture is active before retained-target deletion");
  f.commit(11, {}); // f.b deliberately retains the removed original family.
  require(!f.ui->getNewestCloneOfShadowNode(*f.b), "removed capture family has no newest clone despite retained ref");
  f.prune();
  f.events.clear();
  std::cout << "RETAINED_CAPTURE_TARGET_WITHOUT_NEWEST_CLONE\n" << std::flush;
  f.send(1, f.a, "topPointerMove"); // Original RN dereferences the removed capture here.
  require(f.contains("topPointerMove", 2), "physical contact survives deletion of capture target in another root");
  require(!f.contains("topLostPointerCapture", 12), "disconnected capture target receives no lost callback");
  require(!f.processor.hasPointerCapture(1, f.b.get()), "removed retained ref loses capture authority");
  f.processor.setPointerCapture(1, f.a);
  require(f.processor.hasPointerCapture(1, f.a.get()), "surviving native contact can reacquire capture");
  f.send(1, nullptr, "topPointerUp", 0);
}

#ifndef GODOT_FABRIC_POINTER_ORIGINAL_NEGATIVE
void originalMountedBehavior() {
  Fixture f;
  f.processor.setPointerCapture(404, f.a);
  require(!f.processor.hasPointerCapture(404, f.a.get()), "inactive pointer set remains original silent no-op");
  f.send(1, f.a, "topPointerDown");
  f.events.clear();
  f.processor.setPointerCapture(1, f.b);
  require(f.processor.hasPointerCapture(1, f.b.get()), "pending capture is observable immediately");
  require(f.events.empty(), "setting capture emits no immediate got event");
  f.processor.releasePointerCapture(1, f.a.get());
  require(f.processor.hasPointerCapture(1, f.b.get()), "wrong-owner release remains original no-op");
  f.send(1, nullptr, "topPointerMove");
  auto sequence = f.sequence();
  require(!sequence.empty() && sequence.front() == "topGotPointerCapture:12", "got capture precedes the next captured move");
  require(f.contains("topPointerMove", 12), "null physical hit retargets to mounted capture owner");
  f.events.clear();
  f.processor.setPointerCapture(1, f.c);
  require(f.processor.hasPointerCapture(1, f.c.get()) && !f.processor.hasPointerCapture(1, f.b.get()), "transfer updates pending queries before next event");
  f.send(1, nullptr, "topPointerMove");
  sequence = f.sequence();
  require(sequence.size() >= 2 && sequence[0] == "topLostPointerCapture:12" && sequence[1] == "topGotPointerCapture:22", "transfer orders original lost before got");
  require(f.contains("topPointerMove", 22), "transfer moves dispatch to new capture owner");
  f.events.clear();
  f.send(1, nullptr, "topPointerUp", 0);
  sequence = f.sequence();
  auto up = std::find(sequence.begin(), sequence.end(), "topPointerUp:22");
  auto lost = std::find(sequence.begin(), sequence.end(), "topLostPointerCapture:22");
  require(up != sequence.end() && lost != sequence.end() && up < lost, "captured up precedes implicit lost capture");
  require(f.processor.pointerStateCountsForGodot() == std::array<std::size_t, 4>{0, 0, 0, 0}, "touch up clears all four registries");
  f.events.clear();
  f.send(2, nullptr, "topPointerDown");
  require(f.events.empty() && f.processor.pointerStateCountsForGodot() == std::array<std::size_t, 4>{0, 0, 0, 0}, "no-hit down does not register a fabricated contact");
}

void deletionDuringGotAndLost() {
  {
    Fixture f;
    f.send(1, f.a, "topPointerDown");
    f.processor.setPointerCapture(1, f.b);
    f.events.clear();
    f.callback = [&](const Entry &event) { if (event.type == "topGotPointerCapture") f.commit(11, {}); };
    f.send(1, f.a, "topPointerMove");
    require(f.contains("topGotPointerCapture", 12), "got callback runs before deleting its own capture target");
    require(!f.processor.hasPointerCapture(1, f.b.get()), "got callback deletion cannot resurrect pending capture");
    auto counts = f.processor.pointerStateCountsForGodot();
    require(counts[0] == 1 && counts[1] == 0 && counts[2] == 0, "got deletion preserves physical pointer without active capture snapshot");
    require(f.contains("topPointerMove", 2) && !f.contains("topPointerMove", 12), "same move recovers to mounted physical target after got deletion");
    f.callback = {};
    f.send(1, f.a, "topPointerCancel", 0);
    require(f.processor.pointerStateCountsForGodot() == std::array<std::size_t, 4>{0, 0, 0, 0}, "got deletion then cancel leaves no registry");
  }
  {
    Fixture f;
    f.send(1, f.a, "topPointerDown");
    f.processor.setPointerCapture(1, f.b);
    f.send(1, f.a, "topPointerMove");
    f.processor.setPointerCapture(1, f.c);
    f.events.clear();
    f.callback = [&](const Entry &event) { if (event.type == "topLostPointerCapture") f.commit(11, {}); };
    f.send(1, f.a, "topPointerMove");
    const auto sequence = f.sequence();
    require(sequence.size() >= 2 && sequence[0] == "topLostPointerCapture:12" && sequence[1] == "topGotPointerCapture:22", "lost callback deletion preserves transfer ordering to surviving target");
    require(f.processor.hasPointerCapture(1, f.c.get()) && f.contains("topPointerMove", 22), "lost callback deletion cannot discard new live capture");
    f.callback = {};
    f.send(1, nullptr, "topPointerCancel", 0);
  }
}

void crossRootRetirementDuringGot() {
  Fixture f;
  f.send(1, f.a, "topPointerDown");
  f.send(2, f.c, "topPointerDown");
  f.processor.setPointerCapture(2, f.c);
  f.send(2, f.c, "topPointerMove");
  f.processor.setPointerCapture(1, f.b);
  f.events.clear();
  f.callback = [&](const Entry &event) {
    if (event.type == "topGotPointerCapture" && event.tag == 12) f.retire(11);
  };
  f.send(1, f.a, "topPointerMove");
  require(f.ui->getNewestCloneOfShadowNode(*f.b) != nullptr, "root retirement is tested while RN target is still connected");
  require(f.sequence() == std::vector<std::string>{"topGotPointerCapture:12"}, "retiring capture root aborts remaining stale event continuation");
  require(!f.processor.hasPointerCapture(1, f.b.get()), "logically connected retiring root loses capture authority immediately");
  require(f.processor.hasPointerCapture(2, f.c.get()), "retiring another capture root preserves unrelated pointer capture");
  const auto counts = f.processor.pointerStateCountsForGodot();
  require(counts == std::array<std::size_t, 4>{2, 1, 1, 1}, "selective retirement keeps both physical contacts and only surviving capture and hover");
  f.callback = {};
  f.events.clear();
  f.send(1, f.a, "topPointerMove");
  require(f.contains("topPointerMove", 2), "surviving origin contact resumes on its next native sample");
  f.processor.setPointerCapture(1, f.a);
  require(f.processor.hasPointerCapture(1, f.a.get()), "retirement recovery can acquire capture without a fabricated down");
  f.send(1, nullptr, "topPointerUp", 0);
  require(f.processor.hasPointerCapture(2, f.c.get()), "up of recovered contact preserves other root capture");
  f.send(2, nullptr, "topPointerUp", 0);
  require(f.processor.pointerStateCountsForGodot() == std::array<std::size_t, 4>{0, 0, 0, 0}, "cross-root retirement and both ups leave all registries empty");
}

void reentrantContactRemoval() {
  for (const std::string phase : {"topGotPointerCapture", "topPointerOver", "topPointerMove", "topPointerUp"}) {
    Fixture f;
    f.send(2, f.c, "topPointerDown");
    f.processor.setPointerCapture(2, f.c);
    f.send(2, f.c, "topPointerMove");
    if (phase != "topPointerOver") f.send(1, f.a, "topPointerDown");
    if (phase == "topGotPointerCapture" || phase == "topPointerUp") f.processor.setPointerCapture(1, f.a);
    if (phase == "topPointerUp") f.send(1, f.a, "topPointerMove");
    f.events.clear();
    f.callback = [&](const Entry &event) { if (event.event.pointerId == 1 && event.type == phase) f.remove(1); };
    f.send(1, f.a, phase == "topPointerOver" ? "topPointerDown" : phase == "topPointerUp" ? "topPointerUp" : "topPointerMove", phase == "topPointerUp" ? 0 : 1);
    require(f.contains(phase, 2), phase + " callback executes actual selective removal");
    require(f.events.back().type == phase, phase + " removal stops original continuation after callback");
    require(!f.processor.hasPointerCapture(1, f.a.get()) && f.processor.hasPointerCapture(2, f.c.get()), phase + " removal preserves unrelated capture and invalidates own ref");
    require(f.processor.pointerStateCountsForGodot() == std::array<std::size_t, 4>{1, 1, 1, 1}, phase + " removal clears only selected pointer across all registries");
    f.callback = {};
    f.send(2, nullptr, "topPointerCancel", 0);
    require(f.processor.pointerStateCountsForGodot() == std::array<std::size_t, 4>{0, 0, 0, 0}, phase + " surviving cancellation proves complete cleanup");
  }
}

struct ListenerFault final : std::runtime_error {
  explicit ListenerFault(const std::string &phase) : std::runtime_error("listener-fault:" + phase) {}
};

void throwingListenerRecovery() {
  for (const std::string phase : {"topPointerOut", "topPointerOver", "topPointerEnter",
      "topPointerLeave", "topGotPointerCapture", "topLostPointerCapture",
      "topPointerDown", "topPointerMove", "topPointerUp"}) {
    Fixture f;
    f.send(2, f.c, "topPointerDown");
    f.processor.setPointerCapture(2, f.c);
    f.send(2, f.c, "topPointerMove");
    if (phase != "topPointerDown") f.send(1, f.a, "topPointerDown");
    if (phase == "topGotPointerCapture" || phase == "topLostPointerCapture" ||
        phase == "topPointerMove" || phase == "topPointerUp") f.processor.setPointerCapture(1, f.a);
    if (phase == "topLostPointerCapture" || phase == "topPointerMove" || phase == "topPointerUp")
      f.send(1, f.a, "topPointerMove");
    if (phase == "topLostPointerCapture") f.processor.setPointerCapture(1, f.b);
    f.events.clear();
    f.callback = [&](const Entry &event) {
      if (event.event.pointerId == 1 && event.type == phase) throw ListenerFault(phase);
    };
    const bool crossing = phase == "topPointerOut" || phase == "topPointerOver" ||
        phase == "topPointerEnter" || phase == "topPointerLeave" || phase == "topLostPointerCapture";
    bool observedOriginalError = false;
    try {
      f.send(1, crossing ? f.b : f.a,
          phase == "topPointerDown" ? "topPointerDown" : phase == "topPointerUp" ? "topPointerUp" : "topPointerMove",
          phase == "topPointerUp" ? 0 : 1);
    } catch (const ListenerFault &error) {
      observedOriginalError = std::string(error.what()) == "listener-fault:" + phase;
    }
    require(observedOriginalError, phase + " preserves the original listener exception type and message");
    require(!f.events.empty() && f.events.back().type == phase, phase + " fault stops the event continuation");
    require(f.processor.pointerStateCountsForGodot() == std::array<std::size_t, 4>{1, 1, 1, 1}, phase + " fault clears only its own active capture and hover registries");
    require(!f.processor.hasPointerCapture(1, f.a.get()) && !f.processor.hasPointerCapture(1, f.b.get()) &&
        f.processor.hasPointerCapture(2, f.c.get()), phase + " fault invalidates both own capture refs and preserves the other pointer");
    f.callback = {};
    f.events.clear();
    // The previously moved hover-tracker entry must not remain as nullptr.
    // A real no-hit sample takes the same original hover recovery path.
    f.send(1, nullptr, "topPointerMove");
    require(f.processor.pointerStateCountsForGodot() == std::array<std::size_t, 4>{1, 1, 1, 1}, phase + " next no-hit native sample recovers without a crash or unrelated state loss");
    f.processor.setPointerCapture(1, f.b);
    require(!f.processor.hasPointerCapture(1, f.b.get()), phase + " failed contact cannot reacquire capture without a new Down");
    f.send(1, f.b, "topPointerDown");
    f.processor.setPointerCapture(1, f.b);
    require(f.processor.hasPointerCapture(1, f.b.get()), phase + " a fresh Down restores normal pending capture");
    f.events.clear();
    f.send(1, nullptr, "topPointerMove");
    require(f.contains("topGotPointerCapture", 12) && f.contains("topPointerMove", 12), phase + " fresh contact delivers original got and captured move");
    f.send(1, nullptr, "topPointerUp", 0);
    require(f.processor.pointerStateCountsForGodot() == std::array<std::size_t, 4>{1, 1, 1, 1}, phase + " recovered Up cleans own state and preserves the other capture");
    f.send(2, nullptr, "topPointerCancel", 0);
    require(f.processor.pointerStateCountsForGodot() == std::array<std::size_t, 4>{0, 0, 0, 0}, phase + " final surviving contact cancellation clears all registries");
  }
}
#endif
}

int main(int argc, char **argv) {
  try {
#ifdef GODOT_FABRIC_POINTER_ORIGINAL_NEGATIVE
    if (argc == 2 && std::string(argv[1]) == "listener-fault") {
      Fixture f;
      f.send(1, f.a, "topPointerDown");
      f.callback = [](const Entry &entry) {
        if (entry.type == "topPointerOut") throw std::runtime_error("original-listener-fault");
      };
      bool observed = false;
      try { f.send(1, f.b, "topPointerMove"); }
      catch (const std::runtime_error &error) { observed = std::string(error.what()) == "original-listener-fault"; }
      require(observed, "original listener fault reaches the moved hover-tracker boundary");
      f.callback = {};
      std::cout << "ORIGINAL_LISTENER_FAULT_WITH_MOVED_HOVER_TRACKER\n" << std::flush;
      f.send(1, f.b, "topPointerMove");
      throw std::runtime_error("Original listener-fault control unexpectedly recovered");
    }
#else
    (void)argc;
    (void)argv;
#endif
    retainedTargetDeletion();
#ifndef GODOT_FABRIC_POINTER_ORIGINAL_NEGATIVE
    originalMountedBehavior();
    deletionDuringGotAndLost();
    crossRootRetirementDuringGot();
    reentrantContactRemoval();
    throwingListenerRecovery();
#endif
    folly::dynamic names = folly::dynamic::array;
    for (const auto &check : checks) names.push_back(check);
    std::cout << "POINTER_PROCESSOR_PASSED " << checks.size() << "\n";
    std::cout << folly::toJson(folly::dynamic::object("checks", names)("count", checks.size())) << "\n";
    return 0;
  } catch (const std::exception &error) {
    std::cerr << "POINTER_PROCESSOR_FAILED: " << error.what() << "\n";
    return 1;
  }
}
