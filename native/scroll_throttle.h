#pragma once

#include <algorithm>
#include <cmath>

namespace fabric_godot {
// ReactScrollViewHelper.kt throttles a scroll event while the requested delay
// is at least max(17 ms, the elapsed time since the previous delivered event).
inline bool scroll_event_is_throttled(double requested_ms, double elapsed_ms) {
  if (!std::isfinite(requested_ms) || requested_ms < 0 || std::isnan(elapsed_ms) || elapsed_ms < 0) return false;
  return requested_ms >= std::max(17.0, elapsed_ms);
}
}
