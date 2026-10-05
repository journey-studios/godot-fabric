#include <hermes/hermes.h>
#include <jsi/JSIDynamic.h>
#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/renderer/bridging/bridging.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/components/root/RootComponentDescriptor.h>
#include <react/renderer/components/view/ViewComponentDescriptor.h>
#include <react/renderer/core/EventQueueProcessor.h>
#include <react/renderer/core/InstanceHandle.h>
#include <react/renderer/core/RawEvent.h>
#include <react/renderer/uimanager/UIManagerBinding.h>
#include <react/utils/ContextContainer.h>
#include "pointer_geometry_history.h"
#include <folly/json.h>
#include <algorithm>
#include <array>
#include <iostream>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

// Actual Hermes binding and original RawEvent batch processing. This witness
// injects portable offsets; Godot affine math belongs to the separate native
// example. EventQueue enqueue/coalescing is outside this fixture's scope.
namespace rn = facebook::react;
namespace jsi = facebook::jsi;
namespace {
std::vector<std::string> checks;
void require(bool condition, const std::string &message) {
  if (!condition) throw std::runtime_error(message);
  checks.push_back(message);
}
struct Envelope final : rn::PointerEvent {
  const int serial;
  const rn::SurfaceId origin;
  const rn::Point viewport;
  Envelope(rn::PointerEvent pointer, int sample, rn::SurfaceId surface)
      : rn::PointerEvent(std::move(pointer)), serial(sample), origin(surface),
        viewport{static_cast<rn::Float>(sample + 10), static_cast<rn::Float>(sample + 20)} {}
};
struct Request {
  std::shared_ptr<const rn::ShadowNode> physical;
  std::shared_ptr<const Envelope> source;
  std::string type;
  rn::RawEvent::Category category;
};
struct Fixture {
  // The machine outlives every instance handle and binding.
  std::unique_ptr<facebook::hermes::HermesRuntime> runtime{facebook::hermes::makeHermesRuntime()};
  std::shared_ptr<rn::ContextContainer> context{std::make_shared<rn::ContextContainer>()};
  rn::ComponentDescriptorProviderRegistry providers;
  std::shared_ptr<const rn::ComponentDescriptorRegistry> registry;
  std::shared_ptr<rn::UIManager> ui;
  std::shared_ptr<rn::UIManagerBinding> binding;
  std::unique_ptr<rn::EventQueueProcessor> queue;
  std::vector<std::unique_ptr<jsi::Object>> handles;
  std::shared_ptr<const rn::ShadowNode> a, b, c, d;
  std::map<int, std::shared_ptr<const Envelope>> sources;
  std::map<int, folly::dynamic> originalPayloads;
  folly::dynamic deliveries = folly::dynamic::array, projections = folly::dynamic::array;
  const Envelope *current{};
  const rn::EventPayload *expectedSource{};
  std::string currentType;
  rn::ReactEventPriority pipePriority{rn::ReactEventPriority::Default};
  int projectionCalls{}, handlerCalls{}, conclusions{}, nativeFault{}, jsFault{};
  bool projectionInstalled{true}, retargetedCopySeen{false};
  const bool modernPriorities{rn::ReactNativeFeatureFlags::fixMappingOfEventPrioritiesBetweenFabricAndReact()};

  Fixture() {
    providers.add(rn::concreteComponentDescriptorProvider<rn::ViewComponentDescriptor>());
    providers.add(rn::concreteComponentDescriptorProvider<rn::RootComponentDescriptor>());
    registry = providers.createComponentDescriptorRegistry({{}, context, nullptr});
    ui = std::make_shared<rn::UIManager>([](auto &&) {}, context);
    ui->setComponentDescriptorRegistry(registry);
    rn::UIManagerBinding::createAndInstallIfNeeded(*runtime, ui);
    binding = rn::UIManagerBinding::getBinding(*runtime);
    for (rn::SurfaceId surface : {1, 11}) {
      rn::LayoutConstraints constraints;
      constraints.minimumSize = constraints.maximumSize = {500, 250};
      ui->startEmptySurface(std::make_unique<rn::ShadowTree>(surface, constraints, rn::LayoutContext{}, *ui, *context));
    }
    a = create(1, 2, 10); b = create(1, 4, 110);
    c = create(11, 12, 30); d = create(11, 14, 130);
    commit(1, {a, b}); commit(11, {c, d});
    auto handler = jsi::Function::createFromHostFunction(*runtime,
        jsi::PropNameID::forAscii(*runtime, "projectionWitnessHandler"), 3,
        [this](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
          const auto key = "delivery/" + std::to_string(++handlerCalls) + "/";
          require(count == 3 && args[0].isObject() && args[2].isObject(), key + "binding supplies retained instance and public payload");
          const auto type = args[1].asString(rt).utf8(rt);
          auto payload = jsi::dynamicFromValue(rt, args[2]);
          const auto tag = static_cast<rn::Tag>(payload["target"].asInt());
          auto expected = originalPayloads.at(current->serial);
          if (projectionInstalled) {
            expected["offsetX"] = current->serial * 10 + tag;
            expected["offsetY"] = -current->serial * 10 - (tag < 10 ? 1 : 11);
          }
          expected["target"] = tag;
          expected["timeStamp"] = current->timeStamp.toDOMHighResTimeStamp();
          require(payload == expected, key + "every field matches source except declared offset and binding target/timestamp");
          const auto priority = currentPriority();
          const auto expectedPriority = type == currentType ? pipePriority : rn::ReactEventPriority::Discrete;
          require(priority == rn::serialize(expectedPriority), key + "original raw priority or discrete capture/hover priority reaches JS");
          deliveries.push_back(folly::dynamic::object("serial", current->serial)("origin", current->origin)
              ("type", type)("priority", priority)("payload", payload));
          if (jsFault == current->serial && type == "topPointerMove") {
            jsFault = 0;
            return jsi::Value(true);
          }
          return jsi::Value(false);
        });
    runtime->global().setProperty(*runtime, "__projectionWitnessObserve", std::move(handler));
    auto jsHandler = runtime->evaluateJavaScript(std::make_shared<jsi::StringBuffer>(R"JS(
      (function(instance, type, payload) {
        if (__projectionWitnessObserve(instance, type, payload))
          throw new Error('projection-witness-js-fault');
      })
    )JS"), "pointer-projection-witness.js");
    auto object = runtime->global().getPropertyAsObject(*runtime, "nativeFabricUIManager");
    object.getPropertyAsFunction(*runtime, "registerEventHandler").call(*runtime, std::move(jsHandler));
    binding->setPointerEventProjectionForGodot(
        [this](const rn::ShadowNode &target, const rn::EventPayload &source, rn::PointerEvent &copy) {
          const auto key = "projection/" + std::to_string(++projectionCalls) + "/";
          const auto *envelope = dynamic_cast<const Envelope *>(&source);
          require(envelope && &source == expectedSource && envelope == current,
              key + "binding retains exact source envelope instead of its retargeted copy");
          require(envelope->origin == sources.at(envelope->serial)->origin &&
              envelope->viewport == rn::Point{static_cast<rn::Float>(envelope->serial + 10), static_cast<rn::Float>(envelope->serial + 20)},
              key + "per-sample origin and viewport metadata survive interleaved dispatch");
          auto normalized = copy;
          normalized.offsetPoint = envelope->offsetPoint;
          require(publicPayload(normalized) == originalPayloads.at(envelope->serial) && copy.timeStamp == envelope->timeStamp,
              key + "processor retargeting changes no non-offset field or timestamp");
          retargetedCopySeen = retargetedCopySeen || copy.offsetPoint != envelope->offsetPoint;
          projections.push_back(folly::dynamic::object("serial", envelope->serial)("origin", envelope->origin)
              ("target", target.getTag())("viewport", folly::dynamic::array(envelope->viewport.x, envelope->viewport.y))
              ("sourceOffset", folly::dynamic::array(envelope->offsetPoint.x, envelope->offsetPoint.y))
              ("processorOffset", folly::dynamic::array(copy.offsetPoint.x, copy.offsetPoint.y)));
          if (nativeFault == envelope->serial) {
            nativeFault = 0;
            throw std::runtime_error("projection-witness-native-fault");
          }
          copy.offsetPoint = {static_cast<rn::Float>(envelope->serial * 10 + target.getTag()),
              static_cast<rn::Float>(-envelope->serial * 10 - target.getSurfaceId())};
          return true;
        });
    queue = std::make_unique<rn::EventQueueProcessor>(
        [this](jsi::Runtime &rt, rn::EventTarget *target, const std::string &type,
            rn::ReactEventPriority priority, const rn::EventPayload &payload, rn::HighResTimeStamp timestamp) {
          current = dynamic_cast<const Envelope *>(&payload);
          require(current != nullptr, "pipe/" + type + "/" + std::to_string(current ? current->serial : -1) + "/intact native envelope");
          expectedSource = &payload; currentType = type; pipePriority = priority;
          require(timestamp == current->timeStamp, "pipe/" + std::to_string(current->serial) + "/sample timestamp preserved");
          binding->dispatchEvent(rt, target, type, priority, payload, timestamp);
        }, [this](jsi::Runtime &) { ++conclusions; }, [](const rn::StateUpdate &) {}, std::weak_ptr<rn::EventLogger>{});
  }
  ~Fixture() {
    binding->setPointerEventProjectionForGodot({});
    for (rn::SurfaceId surface : {1, 11}) ui->stopSurface(surface);
  }
  std::shared_ptr<const rn::ShadowNode> create(rn::SurfaceId surface, rn::Tag tag, rn::Float left) {
    const auto &descriptor = registry->at("View");
    auto handle = std::make_unique<jsi::Object>(*runtime);
    auto instance = std::make_shared<rn::InstanceHandle>(*runtime, jsi::Value(*runtime, *handle), tag);
    auto props = std::make_shared<rn::ViewProps>();
    for (auto offset : {rn::ViewEvents::Offset::PointerDown, rn::ViewEvents::Offset::PointerMove,
        rn::ViewEvents::Offset::PointerUp, rn::ViewEvents::Offset::PointerOver, rn::ViewEvents::Offset::PointerOut,
        rn::ViewEvents::Offset::PointerEnter, rn::ViewEvents::Offset::PointerLeave,
        rn::ViewEvents::Offset::GotPointerCapture, rn::ViewEvents::Offset::LostPointerCapture}) props->events[offset] = true;
    props->yogaStyle.setPositionType(facebook::yoga::PositionType::Absolute);
    props->yogaStyle.setPosition(facebook::yoga::Edge::Left, facebook::yoga::StyleLength::points(left));
    props->yogaStyle.setPosition(facebook::yoga::Edge::Top, facebook::yoga::StyleLength::points(20));
    props->yogaStyle.setDimension(facebook::yoga::Dimension::Width, facebook::yoga::StyleSizeLength::points(80));
    props->yogaStyle.setDimension(facebook::yoga::Dimension::Height, facebook::yoga::StyleSizeLength::points(60));
    auto family = descriptor.createFamily({tag, surface, instance});
    auto node = descriptor.createShadowNode({props, {}, {}, false}, family);
    auto state = jsi::Object(*runtime);
    state.setProperty(*runtime, "node", rn::Bridging<std::shared_ptr<const rn::ShadowNode>>::toJs(*runtime, node));
    handle->setProperty(*runtime, "stateNode", std::move(state));
    handles.push_back(std::move(handle));
    return node;
  }
  void commit(rn::SurfaceId surface, std::vector<std::shared_ptr<const rn::ShadowNode>> children) {
    ui->completeSurface(surface, std::make_shared<std::vector<std::shared_ptr<const rn::ShadowNode>>>(std::move(children)), {});
  }
  folly::dynamic publicPayload(const rn::PointerEvent &pointer) { return jsi::dynamicFromValue(*runtime, pointer.asJSIValue(*runtime)); }
  int currentPriority() {
    auto object = runtime->global().getPropertyAsObject(*runtime, "nativeFabricUIManager");
    return static_cast<int>(object.getPropertyAsFunction(*runtime, "unstable_getCurrentEventPriority").call(*runtime).asNumber());
  }
  Request request(int serial, int pointer, const std::shared_ptr<const rn::ShadowNode> &physical, const std::string &type) {
    rn::PointerEvent event{};
    event.pointerId = pointer; event.pointerType = "touch";
    event.clientPoint = {static_cast<rn::Float>(serial + 0.25), static_cast<rn::Float>(serial + 0.75)};
    event.screenPoint = {static_cast<rn::Float>(500 + serial * 2), static_cast<rn::Float>(600 + serial * 3)};
    event.offsetPoint = {static_cast<rn::Float>(1000 + serial), static_cast<rn::Float>(2000 + serial)};
    event.button = type == "topPointerMove" ? -1 : 0;
    event.buttons = type == "topPointerUp" ? 0 : 1;
    event.pressure = event.buttons ? 0.625 : 0;
    event.width = 7; event.height = 11; event.tiltX = 13; event.tiltY = -17; event.detail = 19;
    event.tangentialPressure = 0.125; event.twist = 23;
    event.ctrlKey = true; event.shiftKey = false; event.altKey = true; event.metaKey = false; event.isPrimary = pointer == 71;
    event.timeStamp = rn::HighResTimeStamp::fromDOMHighResTimeStamp(1000 + serial);
    auto source = std::make_shared<const Envelope>(event, serial, physical->getSurfaceId());
    sources.emplace(serial, source); originalPayloads.emplace(serial, publicPayload(event));
    const auto category = type == "topPointerDown" ? rn::RawEvent::Category::ContinuousStart :
        type == "topPointerUp" ? rn::RawEvent::Category::ContinuousEnd : rn::RawEvent::Category::Continuous;
    return {physical, std::move(source), type, category};
  }
  void flush(std::vector<Request> requests) {
    std::vector<rn::RawEvent> events;
    for (const auto &request : requests)
      events.emplace_back(request.type, request.source, request.physical->getEventEmitter()->getEventTarget(),
          request.physical->getFamilyShared(), request.category, request.type == "topPointerMove", request.source->timeStamp);
    queue->flushEvents(*runtime, std::move(events));
  }
  void released(const std::string &stage) {
    for (const auto &node : {a, b, c, d})
      require(node->getEventEmitter()->getEventTarget()->getInstanceHandle(*runtime).isNull(),
          stage + "/target/" + std::to_string(node->getTag()) + "/temporary retention balanced");
    require(currentPriority() == rn::serialize(rn::ReactEventPriority::Default), stage + "/priority restored to default");
  }
  void immutable(const std::string &stage) {
    for (const auto &[serial, source] : sources)
      require(publicPayload(*source) == originalPayloads.at(serial) && source->timeStamp == rn::HighResTimeStamp::fromDOMHighResTimeStamp(1000 + serial),
          stage + "/source/" + std::to_string(serial) + "/original fields and timestamp immutable");
  }
  std::vector<std::string> types(int serial) const {
    std::vector<std::string> values;
    for (const auto &delivery : deliveries)
      if (delivery["serial"].asInt() == serial) values.push_back(delivery["type"].asString() + ":" + std::to_string(delivery["payload"]["target"].asInt()));
    return values;
  }
  bool delivered(int serial, const std::string &type, rn::Tag tag) const {
    auto sequence = types(serial);
    return std::find(sequence.begin(), sequence.end(), type + ":" + std::to_string(tag)) != sequence.end();
  }
  int deliveredPriority(int serial, const std::string &type) const {
    for (const auto &delivery : deliveries)
      if (delivery["serial"].asInt() == serial && delivery["type"].asString() == type)
        return static_cast<int>(delivery["priority"].asInt());
    throw std::runtime_error("Missing original binding event priority: " + std::to_string(serial) + "/" + type);
  }
};

void verifyHistory(const Fixture &fixture) {
  using History = fabric_godot::PointerGeometryHistory;
  History history;
  const auto family = fixture.a->getFamilyShared();
  const History::NativePoint firstPoint{101, 201}, newestPoint{103, 203}, olderPoint{102, 202};
  history.begin(1, false); history.remember(1, family, firstPoint, {11, 21});
  require(history.previous(family, firstPoint) == std::optional<rn::Point>{rn::Point{11, 21}},
      "history/first: exact family and native point recover the delivered offset");
  history.begin(3, false); history.remember(3, family, newestPoint, {13, 23});
  require(!history.previous(family, firstPoint), "history/newest: advancing sample clears earlier geometry");
  history.begin(2, false); history.remember(2, family, olderPoint, {12, 22});
  require(history.projected == 3 && history.previous(family, newestPoint) == std::optional<rn::Point>{rn::Point{13, 23}},
      "history/reordered: older delivered sample cannot overwrite newest fallback");
  require(!history.previous(family, olderPoint), "history/reordered: fallback denies a different native point");
  history.begin(4, true);
  require(history.projected == 4 && history.previous(family, newestPoint) == std::optional<rn::Point>{rn::Point{13, 23}},
      "history/terminal: advances serial while preserving last valid fallback");
  history.remember(4, family, newestPoint, {14, 24});
  history.begin(3, false); history.remember(3, family, newestPoint, {13, 23});
  require(history.previous(family, newestPoint) == std::optional<rn::Point>{rn::Point{14, 24}},
      "history/older normal: cannot overwrite a newer terminal projection");
  history.begin(5, false); history.remember(5, family, firstPoint, {15, 25});
  require(!history.previous(family, newestPoint), "history/post-terminal: newer normal sample clears terminal geometry");
  history.begin(4, true); history.remember(4, family, firstPoint, {14, 24});
  require(history.projected == 5 && history.previous(family, firstPoint) == std::optional<rn::Point>{rn::Point{15, 25}},
      "history/older terminal: cannot overwrite a newer normal projection");
  const auto &descriptor = fixture.registry->at("View");
  auto replacement = descriptor.createFamily({family->getTag(), family->getSurfaceId(), nullptr});
  require(!history.previous(replacement, firstPoint), "history/family: same tag with a new family cannot borrow prior geometry");
  History independent;
  require(!independent.previous(family, newestPoint), "history/contact: independent contact has no fallback from another contact");
  auto ephemeral = descriptor.createFamily({22, 1, nullptr});
  History retired;
  retired.begin(1, false); retired.remember(1, ephemeral, newestPoint, {13, 23});
  ephemeral.reset();
  require(retired.targets.at(22).family.expired(), "history/retirement: stored geometry does not retain its target family");
  auto revived = descriptor.createFamily({22, 1, nullptr});
  require(!retired.previous(revived, newestPoint), "history/retirement: expired family cannot authorize a later target");
  history = History{};
  require(!history.previous(family, firstPoint), "history/new contact: reset history denies reused pointer identity");
}

void verify(Fixture &f) {
  require(f.currentPriority() == rn::serialize(rn::ReactEventPriority::Default),
      "initial: original public priority is defined before any event");
  verifyHistory(f);
  f.flush({f.request(1, 71, f.a, "topPointerDown"), f.request(2, 81, f.c, "topPointerDown")});
  require(f.delivered(1, "topPointerDown", 2) && f.delivered(2, "topPointerDown", 12), "batch/down: both native contacts dispatch in separate roots");
  require(f.deliveredPriority(1, "topPointerDown") == rn::serialize(rn::ReactEventPriority::Discrete),
      "category/start: first contact reaches JS with pinned discrete priority");
  require(f.deliveredPriority(2, "topPointerDown") == rn::serialize(f.modernPriorities ? rn::ReactEventPriority::Discrete : rn::ReactEventPriority::Default),
      "category/start: second contact preserves pinned feature-flag priority mapping");
  f.released("batch/down");
  auto &processor = f.binding->getPointerEventsProcessor();
  processor.setPointerCapture(71, f.d); processor.setPointerCapture(81, f.b);
  f.flush({f.request(3, 71, f.a, "topPointerMove"), f.request(4, 81, f.c, "topPointerMove"),
      f.request(5, 71, f.a, "topPointerMove"), f.request(6, 81, f.c, "topPointerMove")});
  auto firstA = f.types(3), firstB = f.types(4);
  require(!firstA.empty() && !firstB.empty() && firstA.front() == "topGotPointerCapture:14" && firstB.front() == "topGotPointerCapture:4", "batch/capture: original got precedes moves across roots");
  require(f.delivered(3, "topPointerMove", 14) && f.delivered(4, "topPointerMove", 4) && f.delivered(5, "topPointerMove", 14) && f.delivered(6, "topPointerMove", 4), "batch/capture: interleaved samples keep their distinct owners");
  for (int serial : {3, 4, 5, 6})
    require(f.deliveredPriority(serial, "topPointerMove") == rn::serialize(f.modernPriorities ? rn::ReactEventPriority::Continuous : rn::ReactEventPriority::Default),
        "category/move/" + std::to_string(serial) + ": continuous raw category keeps pinned priority at JS");
  require(f.retargetedCopySeen, "batch/capture: projected callback copy differs from original source offset");
  require(processor.pointerStateCountsForGodot() == std::array<std::size_t, 4>{2, 2, 2, 2}, "batch/capture: both pointers retain capture and hover state");
  f.immutable("batch/capture"); f.released("batch/capture");
  f.nativeFault = 7;
  bool nativeObserved = false;
  try { f.flush({f.request(7, 71, f.a, "topPointerMove")}); }
  catch (const std::runtime_error &error) { nativeObserved = std::string(error.what()) == "projection-witness-native-fault"; }
  require(nativeObserved, "native fault: exact projection exception remains visible");
  require(!f.delivered(7, "topPointerMove", 14), "native fault: failed projection publishes no partial pointer");
  require(!processor.hasPointerCapture(71, f.d.get()) && processor.hasPointerCapture(81, f.b.get()), "native fault: only offending capture is revoked");
  require(processor.pointerStateCountsForGodot() == std::array<std::size_t, 4>{1, 1, 1, 1}, "native fault: offender removed from all four registries");
  f.released("native fault");
  f.flush({f.request(8, 81, f.c, "topPointerMove")});
  require(f.types(8) == std::vector<std::string>{"topPointerMove:4"}, "native fault: concurrent pointer continues on next captured move");
  f.immutable("native fault");
  // JS failure happens after temporary retention of the capture target, unlike
  // native projection failure which occurs before that retain.
  f.flush({f.request(9, 72, f.a, "topPointerDown")});
  processor.setPointerCapture(72, f.d); f.flush({f.request(10, 72, f.a, "topPointerMove")});
  f.jsFault = 11;
  bool jsObserved = false;
  try { f.flush({f.request(11, 72, f.a, "topPointerMove")}); }
  catch (const std::exception &error) {
    const std::string diagnostic = error.what();
    jsObserved = diagnostic.find("projection-witness-js-fault") != std::string::npos &&
        diagnostic.find("pointer-projection-witness.js") != std::string::npos;
  }
  require(jsObserved, "JS fault: handler throws after projection and target retention");
  require(!processor.hasPointerCapture(72, f.d.get()) && processor.hasPointerCapture(81, f.b.get()), "JS fault: cleanup revokes only offender's capture");
  require(processor.pointerStateCountsForGodot() == std::array<std::size_t, 4>{1, 1, 1, 1}, "JS fault: temporary retained dispatch leaves no offender ownership");
  f.released("JS fault");
  f.flush({f.request(12, 81, f.c, "topPointerMove")});
  require(f.types(12) == std::vector<std::string>{"topPointerMove:4"}, "JS fault: concurrent capture continues unchanged");
  f.flush({f.request(13, 81, f.c, "topPointerUp")});
  auto ending = f.types(13);
  auto up = std::find(ending.begin(), ending.end(), "topPointerUp:4");
  auto lost = std::find(ending.begin(), ending.end(), "topLostPointerCapture:4");
  require(up != ending.end() && lost != ending.end() && up < lost, "terminal: captured up precedes original implicit lost");
  require(f.deliveredPriority(13, "topPointerUp") == rn::serialize(rn::ReactEventPriority::Discrete),
      "category/end: terminal raw category reaches JS with pinned discrete priority");
  require(processor.pointerStateCountsForGodot() == std::array<std::size_t, 4>{0, 0, 0, 0}, "terminal: both fault recoveries and survivor up empty all registries");
  f.released("terminal"); f.immutable("terminal");
  const int projectionCount = f.projectionCalls;
  f.binding->setPointerEventProjectionForGodot({}); f.projectionInstalled = false;
  f.flush({f.request(14, 74, f.a, "topPointerDown"), f.request(15, 74, f.a, "topPointerUp")});
  require(f.projectionCalls == projectionCount && f.delivered(14, "topPointerDown", 2) && f.delivered(15, "topPointerUp", 2), "disabled hook: original payloads dispatch without fabricated offsets");
  require(processor.pointerStateCountsForGodot() == std::array<std::size_t, 4>{0, 0, 0, 0}, "disabled hook: original cleanup empties all registries");
  f.released("disabled hook"); f.immutable("disabled hook");
  folly::dynamic names = folly::dynamic::array;
  for (const auto &name : checks) names.push_back(name);
  std::cout << "POINTER_PROJECTION_PASSED " << checks.size() << "\n";
  std::cout << folly::toJson(folly::dynamic::object("count", checks.size())("checks", names)
      ("projectionCalls", f.projectionCalls)("deliveries", f.deliveries)("projections", f.projections)
      ("retargetedCopySeen", f.retargetedCopySeen)("nativeFaultObserved", nativeObserved)("jsFaultObserved", jsObserved)
      ("fixMappingOfEventPrioritiesBetweenFabricAndReact", f.modernPriorities)("conclusions", f.conclusions)
      ("scope", "actual Hermes binding and original raw-batch processor; no EventQueue coalescing or Godot geometry claim")) << "\n";
}
}
int main() {
  // Exception-owned JSI values must be destroyed while Hermes is still alive,
  // including an unexpected failed assertion, not only the deliberate fault.
  std::unique_ptr<Fixture> fixture;
  try { fixture = std::make_unique<Fixture>(); verify(*fixture); return 0; }
  catch (const std::exception &error) { std::cerr << "POINTER_PROJECTION_FAILED: " << error.what() << "\n"; return 1; }
}
