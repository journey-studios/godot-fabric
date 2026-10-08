#pragma once

#include <algorithm>
#include <cmath>

namespace fabric_godot {
struct ScrollPoint {
  double x{};
  double y{};
};

inline bool finite(ScrollPoint point) {
  return std::isfinite(point.x) && std::isfinite(point.y);
}

inline ScrollPoint scroll_maximum(ScrollPoint content, ScrollPoint viewport) {
  return {std::max(0.0, content.x - viewport.x), std::max(0.0, content.y - viewport.y)};
}

inline ScrollPoint clamp_scroll_offset(ScrollPoint value, ScrollPoint maximum) {
  return {std::clamp(value.x, 0.0, std::max(0.0, maximum.x)),
      std::clamp(value.y, 0.0, std::max(0.0, maximum.y))};
}

inline ScrollPoint scroll_content_position(ScrollPoint yoga_origin, ScrollPoint offset) {
  return {yoga_origin.x - offset.x, yoga_origin.y - offset.y};
}

// A ScrollView owns one scroll axis. Keep the pointer's cross-axis coordinate
// fixed at gesture start so a diagonal pan cannot create cross-axis offset or
// release velocity.
inline ScrollPoint scroll_gesture_point(ScrollPoint point, ScrollPoint origin, bool horizontal) {
  return horizontal ? ScrollPoint{point.x, origin.y} : ScrollPoint{origin.x, point.y};
}
}
