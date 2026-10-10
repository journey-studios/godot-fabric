#pragma once

#include "display_insets_core.h"
#include "window_metrics.h"
#include <folly/dynamic.h>
#include <react/renderer/components/safeareaview/SafeAreaViewShadowNode.h>
#include <memory>
#include <optional>

namespace godot {
class Window;
}

namespace fabric_godot {

// RN's SafeAreaView on this host. The window's unsafe bands come from Godot (below); the padding each view holds follows
// the UIKit rules of display_insets_core.h and travels as RN's own SafeAreaViewState, which RN's
// SafeAreaViewComponentDescriptor applies to Yoga as padding.

// The bands of `window` that the OS leaves out, in Fabric points at the window's content scale. iOS and Android report
// them through DisplayServer.get_display_safe_area (physical pixels in screen coordinates); every other display server
// reports none. macOS in particular answers with its usable rectangle (menu bar, Dock), which is not a safe area, so it is
// never read there.
display_insets::Edges window_unsafe_edges(godot::Window &window, double scale);

using SafeAreaState = facebook::react::SafeAreaViewShadowNode::ConcreteState;

// What the host did with the State of its SafeAreaViews, for the status of the application.
struct SafeAreaCounters {
  // updateState calls: the padding differed from the State's by the threshold when it was decided.
  uint64_t requested{};
  // callbacks that still found the padding apart by the threshold when the update was applied, and changed the State.
  uint64_t committed{};
  // pumps that found a SafeAreaView whose frame could not be resolved (no layout, no physical host).
  uint64_t unresolved{};
};

// The padding the State holds, in points.
display_insets::Edges padding_of(const SafeAreaState &state);

// The most recent State of a SafeAreaView's shadow node, which RN's State updates replace; null without one.
std::shared_ptr<const SafeAreaState> safe_area_state(const facebook::react::ShadowNode &node);

// What one pump does for one SafeAreaView, as RCTSafeAreaViewComponentView._updateStateIfNecessary does: given its State and its
// frame in the window (points), the padding is what the window's unsafe bands leave of the frame, and when a side of it is the
// threshold away from the State's, RN is asked to replace the State. The request repeats the test against the State's data at the
// time it is applied and cancels itself below the threshold, as RN's does. A view without a State or a frame (no layout, no physical
// host) is counted as unresolved and asks for nothing.
void follow_safe_area(const std::shared_ptr<const SafeAreaState> &state, const std::optional<display_insets::Frame> &frame,
    const WindowMetrics &window, const std::shared_ptr<SafeAreaCounters> &counters);

folly::dynamic safe_area_snapshot(const display_insets::Edges &unsafe, const SafeAreaCounters &counters, size_t views);

}  // namespace fabric_godot
