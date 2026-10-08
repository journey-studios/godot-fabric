#pragma once

#include "scroll_offset.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <limits>

namespace fabric_godot {
class ScrollMotion {
 public:
  enum class Mode { Idle, Dragging, Animated, Momentum };
  struct Update {
    ScrollPoint offset{};
    bool changed{};
    bool momentumEnded{};
  };

  static constexpr double kDragThreshold = 8.0;
  static constexpr double kAnimationSeconds = 0.25;
  static constexpr double kFrictionPerSecond = 5.5;
  static constexpr double kStopSpeed = 12.0;
  // Desktop pointer sampling can pause while the user holds a press. Only
  // samples from this recent window contribute to release velocity.
  static constexpr double kVelocitySampleWindowSeconds = 0.25;

  Mode mode() const { return mode_; }
  bool active() const { return mode_ != Mode::Idle; }
  ScrollPoint offset() const { return offset_; }
  ScrollPoint velocity() const { return velocity_; }

  void set_offset(ScrollPoint offset) {
    offset_ = offset;
    cancel();
  }
  void cancel() {
    mode_ = Mode::Idle;
    velocity_ = {};
    sample_count_ = 0;
  }
  void replace(ScrollPoint target, bool animated, double now) {
    velocity_ = {};
    sample_count_ = 0;
    if (!animated) {
      offset_ = target;
      mode_ = Mode::Idle;
      return;
    }
    from_ = offset_;
    target_ = target;
    started_ = now;
    mode_ = Mode::Animated;
  }
  void begin_drag(ScrollPoint pointer, double now) {
    drag_start_offset_ = offset_;
    drag_start_pointer_ = pointer;
    velocity_ = {};
    sample_count_ = 0;
    mode_ = Mode::Dragging;
    add_sample(pointer, now);
  }
  ScrollPoint drag(ScrollPoint pointer, double now, ScrollPoint maximum) {
    if (mode_ != Mode::Dragging) return offset_;
    add_sample(pointer, now);
    // Pointer movement and content movement have opposite signs.
    offset_ = clamp_scroll_offset({drag_start_offset_.x + drag_start_pointer_.x - pointer.x,
        drag_start_offset_.y + drag_start_pointer_.y - pointer.y}, maximum);
    return offset_;
  }
  ScrollPoint finish_drag(ScrollPoint pointer, double now, ScrollPoint maximum) {
    if (mode_ != Mode::Dragging) return {};
    // Release can arrive at a new coordinate without a final Move. Commit that
    // final finger position before calculating velocity or emitting EndDrag.
    offset_ = clamp_scroll_offset({drag_start_offset_.x + drag_start_pointer_.x - pointer.x,
        drag_start_offset_.y + drag_start_pointer_.y - pointer.y}, maximum);
    add_sample(pointer, now);
    velocity_ = measured_velocity();
    velocity_.x = maximum.x > 0 ? -velocity_.x : 0;
    velocity_.y = maximum.y > 0 ? -velocity_.y : 0;
    if (std::hypot(velocity_.x, velocity_.y) >= kStopSpeed) {
      mode_ = Mode::Momentum;
      last_tick_ = now;
      return velocity_;
    }
    mode_ = Mode::Idle;
    velocity_ = {};
    return {};
  }
  Update tick(double now, ScrollPoint maximum) {
    Update update{offset_};
    if (mode_ == Mode::Animated) {
      const double raw = std::clamp((now - started_) / kAnimationSeconds, 0.0, 1.0);
      const double progress = 1.0 - std::pow(1.0 - raw, 3.0);
      const auto next = clamp_scroll_offset({from_.x + (target_.x - from_.x) * progress,
          from_.y + (target_.y - from_.y) * progress}, maximum);
      update.changed = next.x != offset_.x || next.y != offset_.y;
      offset_ = next;
      update.offset = offset_;
      if (raw >= 1.0) {
        mode_ = Mode::Idle;
      }
      return update;
    }
    if (mode_ != Mode::Momentum) return update;
    if (!std::isfinite(last_tick_)) last_tick_ = now;
    const double dt = std::max(0.0, now - last_tick_);
    last_tick_ = now;
    const double decay = std::exp(-kFrictionPerSecond * dt);
    const double distance_factor = -std::expm1(-kFrictionPerSecond * dt) / kFrictionPerSecond;
    const auto old_velocity = velocity_;
    velocity_.x *= decay;
    velocity_.y *= decay;
    const auto next = clamp_scroll_offset({offset_.x + old_velocity.x * distance_factor,
        offset_.y + old_velocity.y * distance_factor}, maximum);
    if (next.x == 0 || next.x == maximum.x) velocity_.x = 0;
    if (next.y == 0 || next.y == maximum.y) velocity_.y = 0;
    update.changed = next.x != offset_.x || next.y != offset_.y;
    offset_ = next;
    update.offset = offset_;
    if (std::hypot(velocity_.x, velocity_.y) < kStopSpeed) {
      // Fold the sub-threshold analytic tail into the terminal offset. This
      // keeps the settled result independent of which frame crossed the stop
      // threshold while avoiding more frames for imperceptible motion.
      const auto settled = clamp_scroll_offset({offset_.x + velocity_.x / kFrictionPerSecond,
          offset_.y + velocity_.y / kFrictionPerSecond}, maximum);
      update.changed = update.changed || settled.x != offset_.x || settled.y != offset_.y;
      offset_ = settled;
      update.offset = offset_;
      mode_ = Mode::Idle;
      velocity_ = {};
      last_tick_ = std::numeric_limits<double>::quiet_NaN();
      update.momentumEnded = true;
    }
    return update;
  }
 private:
  struct Sample { ScrollPoint point{}; double time{}; };
  Mode mode_{Mode::Idle};
  ScrollPoint offset_{}, from_{}, target_{}, velocity_{}, drag_start_offset_{}, drag_start_pointer_{};
  double started_{};
  double last_tick_{std::numeric_limits<double>::quiet_NaN()};
  std::array<Sample, 8> samples_{};
  std::size_t sample_next_{}, sample_count_{};

  void add_sample(ScrollPoint point, double time) {
    if (sample_count_) {
      const auto &last = samples_[(sample_next_ + samples_.size() - 1) % samples_.size()];
      if (time <= last.time) return;
    }
    samples_[sample_next_] = {point, time};
    sample_next_ = (sample_next_ + 1) % samples_.size();
    sample_count_ = std::min(samples_.size(), sample_count_ + 1);
  }
  ScrollPoint measured_velocity() const {
    if (sample_count_ < 2) return {};
    std::size_t first = (sample_next_ + samples_.size() - sample_count_) % samples_.size();
    std::size_t count = sample_count_;
    const auto latest = (sample_next_ + samples_.size() - 1) % samples_.size();
    const double latest_time = samples_[latest].time;
    while (count > 1 && latest_time - samples_[first].time > kVelocitySampleWindowSeconds) {
      first = (first + 1) % samples_.size();
      --count;
    }
    if (count < 2) return {};
    const double origin = samples_[first].time;
    double mean_t{}, mean_x{}, mean_y{};
    for (std::size_t i = 0; i < count; ++i) {
      const auto &sample = samples_[(first + i) % samples_.size()];
      const double t = sample.time - origin;
      mean_t += t; mean_x += sample.point.x; mean_y += sample.point.y;
    }
    mean_t /= count; mean_x /= count; mean_y /= count;
    double variance{}, covariance_x{}, covariance_y{};
    for (std::size_t i = 0; i < count; ++i) {
      const auto &sample = samples_[(first + i) % samples_.size()];
      const double dt = sample.time - origin - mean_t;
      variance += dt * dt;
      covariance_x += dt * (sample.point.x - mean_x);
      covariance_y += dt * (sample.point.y - mean_y);
    }
    return variance > 1e-9 ? ScrollPoint{covariance_x / variance, covariance_y / variance} : ScrollPoint{};
  }
};
}
