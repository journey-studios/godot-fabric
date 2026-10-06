#include "activity_indicator_view.h"
#include <algorithm>
#include <cmath>
#include <numbers>

using namespace godot;
namespace rn = facebook::react;

namespace {
// ActivityIndicator.js passes '#999999' on iOS and null elsewhere, so the
// Godot default draws RN's iOS gray.
const Color default_color(0x99 / 255.0, 0x99 / 255.0, 0x99 / 255.0);
constexpr int spokes = 8;
constexpr double turns_per_second = 1;

Color native_color(const rn::SharedColor &color, const Color &fallback) {
  if (!color) return fallback;
  auto components = rn::colorComponentsFromColor(color);
  return Color(components.red, components.green, components.blue, components.alpha);
}
std::string hex(const Color &color) { return color.to_html(true).utf8().get_data(); }
}

void GodotActivityIndicator::apply(const rn::ActivityIndicatorViewProps &props,
    const rn::ActivityIndicatorViewProps *previous) {
  if (!previous || previous->animating != props.animating) set_animating(props.animating);
  hides_when_stopped_ = props.hidesWhenStopped;
  color_ = props.color;
  // The style picks UIKit's medium or large spinner on iOS. Godot draws to the
  // frame, which ActivityIndicator.js already sizes from the same prop.
  large_ = props.size == rn::ActivityIndicatorViewSize::Large;
  queue_redraw();
}

void GodotActivityIndicator::set_animating(bool value) {
  if (animating_ == value) return;
  animating_ = value;
  if (value) ++starts_;
  else ++stops_;
  // Only an animating spinner takes per-frame work.
  set_process_internal(value);
  queue_redraw();
}

void GodotActivityIndicator::_notification(int what) {
  if (what != NOTIFICATION_INTERNAL_PROCESS || !animating_) return;
  turns_ += get_process_delta_time() * turns_per_second;
  ++frames_;
  queue_redraw();
}

void GodotActivityIndicator::_draw() {
  ++draws_;
  const auto size = get_size();
  if (!spinner_visible() || size.x <= 0 || size.y <= 0) {
    drawn_ = folly::dynamic::object("visible", false)("turns", turns_);
    return;
  }
  const Color color = native_color(color_, default_color);
  const float radius = std::min(size.x, size.y) / 2;
  const float width = std::max(1.5f, radius * 0.18f);
  const Vector2 center = size / 2;
  // Stepped like UIActivityIndicatorView: the brightest spoke advances one
  // position per eighth of a turn and the trailing spokes fade.
  const int head = static_cast<int>(static_cast<long long>(std::floor(turns_ * spokes)) % spokes);
  for (int index = 0; index < spokes; ++index) {
    const double angle = (static_cast<double>(index) / spokes - 0.25) * 2 * std::numbers::pi;
    const Vector2 direction(static_cast<float>(std::cos(angle)), static_cast<float>(std::sin(angle)));
    Color spoke = color;
    spoke.a *= 1.0f - 0.8f * static_cast<float>((head - index + spokes) % spokes) / spokes;
    draw_line(center + direction * radius * 0.45f, center + direction * (radius - width / 2), spoke, width, true);
  }
  drawn_ = folly::dynamic::object("visible", true)("color", hex(color))("head", head)("spokes", spokes)
      ("radius", radius)("width", size.x)("height", size.y)("turns", turns_);
}

folly::dynamic GodotActivityIndicator::snapshot() const {
  return folly::dynamic::object("animating", animating_)("hidesWhenStopped", hides_when_stopped_)
      ("size", large_ ? "large" : "small")
      ("color", color_ ? folly::dynamic(hex(native_color(color_, Color()))) : folly::dynamic(nullptr))
      ("drawColor", hex(native_color(color_, default_color)))("spinnerVisible", spinner_visible())
      ("processing", is_processing_internal())("turns", turns_)("frames", frames_)
      ("starts", starts_)("stops", stops_)("draws", draws_)("drawn", drawn_);
}
