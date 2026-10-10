#pragma once

#include "display_insets_core.h"
#include "frame_clock.h"
#include <godot_cpp/variant/vector2.hpp>
#include <cstdint>
#include <mutex>
#include <shared_mutex>

namespace fabric_godot {
struct WindowMetrics {
  godot::Vector2 size;
  godot::Vector2 screen;
  double scale{1};
  // The bands of the window's edges that the OS leaves out, in Fabric points (display_insets.h). Zero without a safe area.
  display_insets::Edges unsafe;
  uint64_t window_instance_id{};
  double refresh_rate{};
  FrameClock::Pacing pacing{FrameClock::Pacing::Time};
  const char *pacing_source{"unknown"};
};

class WindowMetricsSnapshot final {
 public:
  WindowMetrics get() const {
    std::shared_lock lock(mutex_);
    return value_;
  }

  void set(WindowMetrics value) {
    std::unique_lock lock(mutex_);
    value_ = value;
  }

 private:
  mutable std::shared_mutex mutex_;
  WindowMetrics value_;
};
}
