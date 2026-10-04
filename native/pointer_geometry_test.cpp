#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/components/root/RootComponentDescriptor.h>
#include <react/renderer/components/view/ViewComponentDescriptor.h>
#include <react/renderer/graphics/Transform.h>
#include <react/renderer/uimanager/PointerEventsProcessor.h>
#include <react/renderer/uimanager/UIManager.h>
#include <react/utils/ContextContainer.h>
#include <folly/json.h>
#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

// This witness deliberately installs no Godot geometry projection. Its two
// link variants must reproduce the same pinned upstream retargeter, including
// the incomplete AABB subtraction. The native example proves the host fix.
namespace rn = facebook::react;
namespace {
constexpr double epsilon = 0.002;
std::vector<std::string> checks;
folly::dynamic cases = folly::dynamic::array;
void require(bool condition, const std::string &message) {
  if (!condition) throw std::runtime_error(message);
  checks.push_back(message);
}
bool near(rn::Point point, rn::Point expected) {
  return std::abs(point.x - expected.x) <= epsilon && std::abs(point.y - expected.y) <= epsilon;
}
folly::dynamic point(rn::Point value) { return folly::dynamic::array(value.x, value.y); }

struct Entry { rn::Tag tag; std::string type; rn::ReactEventPriority priority; rn::PointerEvent event; };
struct GeometryCase {
  std::string name;
  rn::SurfaceId surface;
  rn::Point origin, size, rootEmbedding, declaredLocal, client, aabbOrigin, upstreamOffset;
  rn::Transform transform;
  // Independent declared affine coefficients, never read from RN metrics or
  // the RN transform matrix: [a c; b d], applied around the box center.
  double a, b, c, d;
  bool limitation;
};
struct Fixture {
  std::shared_ptr<rn::ContextContainer> context{std::make_shared<rn::ContextContainer>()};
  rn::ComponentDescriptorProviderRegistry providers;
  std::shared_ptr<const rn::ComponentDescriptorRegistry> registry;
  std::unique_ptr<rn::UIManager> ui;
  rn::PointerEventsProcessor processor;
  std::shared_ptr<const rn::ShadowNode> physical, target, transfer;
  std::vector<Entry> events;

  explicit Fixture(const GeometryCase &geometry) {
    providers.add(rn::concreteComponentDescriptorProvider<rn::ViewComponentDescriptor>());
    providers.add(rn::concreteComponentDescriptorProvider<rn::RootComponentDescriptor>());
    registry = providers.createComponentDescriptorRegistry({{}, context, nullptr});
    ui = std::make_unique<rn::UIManager>([](auto &&) {}, context);
    ui->setComponentDescriptorRegistry(registry);
    for (rn::SurfaceId surface : {1, 11}) {
      rn::LayoutConstraints constraints;
      constraints.minimumSize = constraints.maximumSize = {600, 300};
      ui->startEmptySurface(std::make_unique<rn::ShadowTree>(surface,
          constraints, rn::LayoutContext{}, *ui, *context));
    }
    physical = create(1, 2, {0, 0}, {80, 50}, rn::Transform::Identity());
    target = create(geometry.surface, geometry.surface == 1 ? 4 : 14,
        geometry.origin, geometry.size, geometry.transform);
    transfer = create(11, 12, {40, 25}, {100, 60}, rn::Transform::Identity());
    commit(1, geometry.surface == 1 ? std::vector{physical, target} : std::vector{physical});
    commit(11, geometry.surface == 11 ? std::vector{transfer, target} : std::vector{transfer});
  }
  ~Fixture() { for (rn::SurfaceId surface : {1, 11}) ui->stopSurface(surface); }
  std::shared_ptr<const rn::ShadowNode> create(rn::SurfaceId surface, rn::Tag tag,
      rn::Point origin, rn::Point size, rn::Transform transform) {
    const auto &descriptor = registry->at("View");
    auto props = std::make_shared<rn::ViewProps>();
    for (auto offset : {rn::ViewEvents::Offset::PointerDown, rn::ViewEvents::Offset::PointerMove,
        rn::ViewEvents::Offset::PointerUp, rn::ViewEvents::Offset::PointerOver,
        rn::ViewEvents::Offset::PointerOut, rn::ViewEvents::Offset::PointerEnter,
        rn::ViewEvents::Offset::PointerLeave, rn::ViewEvents::Offset::GotPointerCapture,
        rn::ViewEvents::Offset::LostPointerCapture}) props->events[offset] = true;
    props->yogaStyle.setPositionType(facebook::yoga::PositionType::Absolute);
    props->yogaStyle.setPosition(facebook::yoga::Edge::Left, facebook::yoga::StyleLength::points(origin.x));
    props->yogaStyle.setPosition(facebook::yoga::Edge::Top, facebook::yoga::StyleLength::points(origin.y));
    props->yogaStyle.setDimension(facebook::yoga::Dimension::Width, facebook::yoga::StyleSizeLength::points(size.x));
    props->yogaStyle.setDimension(facebook::yoga::Dimension::Height, facebook::yoga::StyleSizeLength::points(size.y));
    props->transform = std::move(transform);
    auto family = descriptor.createFamily({tag, surface, nullptr});
    return descriptor.createShadowNode({props, {}, {}, false}, family);
  }
  void commit(rn::SurfaceId surface, std::vector<std::shared_ptr<const rn::ShadowNode>> children) {
    ui->completeSurface(surface, std::make_shared<std::vector<std::shared_ptr<const rn::ShadowNode>>>(std::move(children)), {});
  }
  rn::PointerEvent send(rn::Point client, const std::string &type, int buttons = 1) {
    rn::PointerEvent event{};
    event.pointerId = 7;
    event.pointerType = "touch";
    event.buttons = buttons;
    event.button = 0;
    event.pressure = buttons ? 0.75 : 0;
    event.clientPoint = client;
    event.screenPoint = {client.x + 900, client.y + 500};
    event.offsetPoint = {3, 4}; // Physical-hit offsets are not the capture target's offsets.
    event.width = 5;
    event.height = 7;
    event.ctrlKey = true;
    event.isPrimary = true;
    event.timeStamp = rn::HighResTimeStamp::now();
    processor.interceptPointerEvent(physical, type, rn::ReactEventPriority::Discrete,
        event, [this](const rn::ShadowNode &node, const std::string &name,
            rn::ReactEventPriority priority, const rn::EventPayload &payload) {
          events.push_back({node.getTag(), name, priority, static_cast<const rn::PointerEvent &>(payload)});
        }, *ui);
    return event;
  }
  const Entry &find(const std::string &type, rn::Tag tag) const {
    auto found = std::find_if(events.begin(), events.end(), [&](const auto &entry) {
      return entry.type == type && entry.tag == tag;
    });
    if (found == events.end()) throw std::runtime_error("Missing original pointer event: " + type);
    return *found;
  }
  std::vector<std::string> sequence() const {
    std::vector<std::string> values;
    for (const auto &entry : events) values.push_back(entry.type + ":" + std::to_string(entry.tag));
    return values;
  }
};

void preserve(const std::string &name, const Entry &entry, const rn::PointerEvent &source) {
  require(near(entry.event.clientPoint, source.clientPoint), name + " preserves source-root client/page point");
  require(near(entry.event.screenPoint, source.screenPoint), name + " preserves screen point");
  require(entry.event.pointerId == source.pointerId && entry.event.pointerType == source.pointerType &&
      entry.event.buttons == source.buttons && entry.event.button == source.button &&
      entry.event.pressure == source.pressure && entry.event.width == source.width &&
      entry.event.height == source.height && entry.event.ctrlKey == source.ctrlKey &&
      entry.event.isPrimary == source.isPrimary && entry.event.timeStamp == source.timeStamp,
      name + " preserves identifier, contact, buttons, modifiers and timestamp");
}

void witness(const GeometryCase &geometry) {
  const auto prefix = geometry.name + ": ";
  // The declared local point's forward projection uses independent coefficients
  // and the hypothetical native root embedding, not getRelativeLayoutMetrics.
  const double x = geometry.declaredLocal.x - geometry.size.x / 2;
  const double y = geometry.declaredLocal.y - geometry.size.y / 2;
  const rn::Point independentClient{
      static_cast<rn::Float>(geometry.rootEmbedding.x + geometry.origin.x + geometry.size.x / 2 + geometry.a * x + geometry.c * y),
      static_cast<rn::Float>(geometry.rootEmbedding.y + geometry.origin.y + geometry.size.y / 2 + geometry.b * x + geometry.d * y)};
  require(near(independentClient, geometry.client), prefix + "declared affine math independently locates the sample");
  Fixture fixture(geometry);
  require(fixture.ui->getNewestCloneOfShadowNode(*fixture.physical) != nullptr, prefix + "physical family is committed");
  require(fixture.ui->getNewestCloneOfShadowNode(*fixture.target) != nullptr, prefix + "capture family is committed");
  const auto metrics = fixture.ui->getRelativeLayoutMetrics(*fixture.target, nullptr, {.includeTransform = true});
  require(metrics != rn::EmptyLayoutMetrics && near(metrics.frame.origin, geometry.aabbOrigin),
      prefix + "measured RN AABB origin matches declared bounds");
  fixture.send(geometry.client, "topPointerDown");
  fixture.events.clear();
  fixture.processor.setPointerCapture(7, fixture.target);
  require(fixture.processor.hasPointerCapture(7, fixture.target.get()), prefix + "pending capture is observable immediately");
  require(fixture.events.empty(), prefix + "set capture emits no immediate notification");
  const auto moveSource = fixture.send(geometry.client, "topPointerMove");
  const auto sequence = fixture.sequence();
  const auto tag = fixture.target->getTag();
  require(!sequence.empty() && sequence.front() == "topGotPointerCapture:" + std::to_string(tag),
      prefix + "original got precedes captured move");
  const auto got = fixture.find("topGotPointerCapture", tag);
  const auto move = fixture.find("topPointerMove", tag);
  require(got.priority == rn::ReactEventPriority::Discrete, prefix + "got keeps original discrete priority");
  preserve(prefix + "got", got, moveSource);
  preserve(prefix + "move", move, moveSource);
  require(near(got.event.offsetPoint, geometry.upstreamOffset), prefix + "got reproduces pinned upstream offset");
  require(near(move.event.offsetPoint, geometry.upstreamOffset), prefix + "captured move reproduces pinned upstream offset");
  require(near(move.event.offsetPoint, geometry.declaredLocal) != geometry.limitation,
      prefix + (geometry.limitation ? "upstream offset differs from true affine local point" : "untransformed control matches true local point"));
  fixture.events.clear();
  const auto upSource = fixture.send(geometry.client, "topPointerUp", 0);
  const auto upSequence = fixture.sequence();
  const auto upPosition = std::find(upSequence.begin(), upSequence.end(), "topPointerUp:" + std::to_string(tag));
  const auto lostPosition = std::find(upSequence.begin(), upSequence.end(), "topLostPointerCapture:" + std::to_string(tag));
  require(upPosition != upSequence.end() && lostPosition != upSequence.end() && upPosition < lostPosition,
      prefix + "original captured up precedes implicit lost");
  const auto lost = fixture.find("topLostPointerCapture", tag);
  preserve(prefix + "lost", lost, upSource);
  require(near(lost.event.offsetPoint, geometry.upstreamOffset), prefix + "lost reproduces the same upstream offset");
  require(!fixture.processor.hasPointerCapture(7, fixture.target.get()), prefix + "implicit up releases pending capture");
  folly::dynamic moveOrder = folly::dynamic::array;
  for (const auto &name : sequence) moveOrder.push_back(name);
  cases.push_back(folly::dynamic::object("name", geometry.name)("targetSurface", geometry.surface)
      ("declaredOrigin", point(geometry.origin))("declaredSize", point(geometry.size))
      ("hypotheticalRootEmbedding", point(geometry.rootEmbedding))("declaredAffine", folly::dynamic::array(geometry.a, geometry.b, geometry.c, geometry.d))
      ("client", point(geometry.client))("screen", point(moveSource.screenPoint))
      ("expectedAffineLocal", point(geometry.declaredLocal))("declaredAabbOrigin", point(geometry.aabbOrigin))
      ("measuredAabbOrigin", point(metrics.frame.origin))("expectedUpstreamOffset", point(geometry.upstreamOffset))
      ("observedOffset", point(move.event.offsetPoint))("upstreamLimitation", geometry.limitation)("moveOrder", moveOrder));
}

void transferWitness(const GeometryCase &geometry) {
  Fixture fixture(geometry);
  fixture.send(geometry.client, "topPointerDown");
  fixture.processor.setPointerCapture(7, fixture.target);
  fixture.send(geometry.client, "topPointerMove");
  fixture.events.clear();
  fixture.processor.setPointerCapture(7, fixture.transfer);
  require(fixture.processor.hasPointerCapture(7, fixture.transfer.get()) &&
      !fixture.processor.hasPointerCapture(7, fixture.target.get()), "transfer: pending owner changes before notification");
  require(fixture.events.empty(), "transfer: changing pending owner emits no immediate lost or got");
  const auto source = fixture.send({455, 140}, "topPointerMove");
  const auto sequence = fixture.sequence();
  require(sequence.size() >= 2 && sequence[0] == "topLostPointerCapture:4" && sequence[1] == "topGotPointerCapture:12",
      "transfer: original lost to old target precedes got to other root");
  const auto &lost = fixture.find("topLostPointerCapture", 4);
  const auto &got = fixture.find("topGotPointerCapture", 12);
  const auto &move = fixture.find("topPointerMove", 12);
  preserve("transfer: lost", lost, source);
  preserve("transfer: got", got, source);
  preserve("transfer: move", move, source);
  require(near(lost.event.offsetPoint, {315, 120}), "transfer: old rotated owner receives its upstream AABB offset");
  require(near(got.event.offsetPoint, {415, 115}) && near(move.event.offsetPoint, {415, 115}),
      "transfer: other root receives its own upstream AABB offset");
  require(!near(move.event.offsetPoint, {15, 15}), "transfer: other-root upstream offset omits declared native embedding");
  fixture.events.clear();
  fixture.send({455, 140}, "topPointerUp", 0);
  require(!fixture.processor.hasPointerCapture(7, fixture.transfer.get()), "transfer: terminal up releases new capture owner");
}
}

int main() {
  try {
    const double pi = std::acos(-1.0);
    const std::vector<GeometryCase> geometries{
      {"same-root-translation", 1, {120, 40}, {80, 40}, {0, 0}, {15, 10}, {135, 50}, {120, 40}, {15, 10}, rn::Transform::Identity(), 1, 0, 0, 1, false},
      {"same-root-rotation-90", 1, {120, 40}, {80, 40}, {0, 0}, {15, 10}, {170, 35}, {140, 20}, {30, 15}, rn::Transform::RotateZ(pi / 2), 0, 1, -1, 0, true},
      {"same-root-skew-x-45", 1, {120, 40}, {80, 40}, {0, 0}, {15, 10}, {125, 50}, {100, 40}, {25, 10}, rn::Transform::Skew(pi / 4, 0), 1, 0, 1, 1, true},
      {"other-root-embedding", 11, {40, 25}, {100, 60}, {400, 100}, {15, 15}, {455, 140}, {40, 25}, {415, 115}, rn::Transform::Identity(), 1, 0, 0, 1, true},
    };
    for (const auto &geometry : geometries) witness(geometry);
    transferWitness(geometries[1]);
    folly::dynamic names = folly::dynamic::array;
    for (const auto &name : checks) names.push_back(name);
#ifdef GODOT_FABRIC_POINTER_GEOMETRY_ORIGINAL
    constexpr auto source = "unchanged-original-processor-and-binding";
#else
    constexpr auto source = "lifetime-overlay-without-geometry-projection";
#endif
    std::cout << "POINTER_GEOMETRY_PASSED " << checks.size() << "\n";
    std::cout << folly::toJson(folly::dynamic::object("count", checks.size())("checks", names)
        ("cases", cases)("source", source)("geometryProjectionInstalled", false)) << "\n";
    return 0;
  } catch (const std::exception &error) {
    std::cerr << "POINTER_GEOMETRY_FAILED: " << error.what() << "\n";
    return 1;
  }
}
