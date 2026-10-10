#include "display_insets.h"
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/classes/os.hpp>
#include <godot_cpp/classes/window.hpp>
#include <godot_cpp/variant/rect2i.hpp>
#include <godot_cpp/variant/vector2i.hpp>

using namespace godot;

namespace fabric_godot {
namespace {
display_insets::Edges edges_of(const facebook::react::EdgeInsets &padding) {
  return {padding.left, padding.top, padding.right, padding.bottom};
}
facebook::react::EdgeInsets insets_of(const display_insets::Edges &edges) {
  return {static_cast<facebook::react::Float>(edges.left), static_cast<facebook::react::Float>(edges.top),
      static_cast<facebook::react::Float>(edges.right), static_cast<facebook::react::Float>(edges.bottom)};
}
}  // namespace

display_insets::Edges window_unsafe_edges(Window &window, double scale) {
  auto *os = OS::get_singleton();
  if (!os || !(os->has_feature("ios") || os->has_feature("android"))) {
    return {};
  }
  auto *display = Engine::get_singleton()->get_singleton("DisplayServer");
  if (!display) {
    return {};
  }
  const Rect2i safe = display->call("get_display_safe_area");
  const Vector2i position = window.get_position();
  const Vector2i size = window.get_size();
  return display_insets::unsafe_bands(
      {static_cast<double>(safe.position.x), static_cast<double>(safe.position.y), static_cast<double>(safe.size.x),
          static_cast<double>(safe.size.y)},
      {static_cast<double>(position.x), static_cast<double>(position.y), static_cast<double>(size.x), static_cast<double>(size.y)},
      scale);
}

display_insets::Edges padding_of(const SafeAreaState &state) { return edges_of(state.getData().padding); }

std::shared_ptr<const SafeAreaState> safe_area_state(const facebook::react::ShadowNode &node) {
  const auto &state = node.getState();
  return state ? std::static_pointer_cast<const SafeAreaState>(state->getMostRecentState()) : nullptr;
}

void follow_safe_area(const std::shared_ptr<const SafeAreaState> &state, const std::optional<display_insets::Frame> &frame,
    const WindowMetrics &window, const std::shared_ptr<SafeAreaCounters> &counters) {
  if (!state || !frame) {
    ++counters->unresolved;
    return;
  }
  const double scale = window.scale;
  const auto padding = display_insets::padding_for(*frame, window.size.x, window.size.y, window.unsafe, scale);
  if (!display_insets::needs_update(padding_of(*state), padding, scale)) {
    return;
  }
  ++counters->requested;
  const auto next = insets_of(padding);
  state->updateState(
      [next, scale, counters](const facebook::react::SafeAreaViewState &old) -> SafeAreaState::SharedData {
        if (!display_insets::needs_update(edges_of(old.padding), edges_of(next), scale)) {
          return nullptr;
        }
        ++counters->committed;
        auto data = old;
        data.padding = next;
        return std::make_shared<const facebook::react::SafeAreaViewState>(data);
      });
}

folly::dynamic safe_area_snapshot(const display_insets::Edges &unsafe, const SafeAreaCounters &counters, size_t views) {
  return folly::dynamic::object("unsafe", folly::dynamic::object("left", unsafe.left)("top", unsafe.top)("right", unsafe.right)(
                                    "bottom", unsafe.bottom))
      ("views", static_cast<int64_t>(views))("requested", static_cast<int64_t>(counters.requested))
      ("committed", static_cast<int64_t>(counters.committed))("unresolved", static_cast<int64_t>(counters.unresolved));
}

}  // namespace fabric_godot
