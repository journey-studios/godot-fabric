#include "transform_adapter.h"
#include "affine_transform.h"
#include "coordinate_transform.h"
#include <limits>

namespace fabric_godot {
void apply_transform(godot::Control &control, const facebook::react::ViewProps &props,
    const facebook::react::LayoutMetrics &metrics) {
  const auto factors = affine_factors(props.resolveTransform(metrics).matrix);
  for (auto value : {factors.scale_x, factors.scale_y, factors.translate_x, factors.translate_y})
    if (!std::isfinite(value) || std::abs(value) > std::numeric_limits<godot::real_t>::max())
      throw std::runtime_error("E_TRANSFORM_RANGE: transform exceeds native coordinate precision");
  if (godot::real_t(factors.scale_x) == 0 || godot::real_t(factors.scale_y) == 0)
    throw std::runtime_error("E_TRANSFORM_RANGE: transform loses rank at native coordinate precision");
  const auto center = control.get_size() / 2;
  const godot::Vector2 position{static_cast<godot::real_t>(metrics.frame.origin.x + factors.translate_x),
      static_cast<godot::real_t>(metrics.frame.origin.y + factors.translate_y)};
  const godot::Vector2 scale{static_cast<godot::real_t>(factors.scale_x),
      static_cast<godot::real_t>(factors.scale_y)};
  godot::Transform2D base(factors.rotation, scale, 0, center);
  base.translate_local(-center);
  godot::Transform2D offset(factors.offset_rotation, {1, 1}, 0, center);
  offset.translate_local(-center);
  auto native_transform = base * offset;
  native_transform[2] += position;
  godot::Transform2D inverse;
  if (!coordinate_inverse(native_transform, inverse))
    throw std::runtime_error("E_TRANSFORM_RANGE: transform or inverse exceeds native coordinate precision");
  if (factors.rotation == 0 && factors.scale_x == 1 && factors.scale_y == 1 &&
      factors.offset_rotation == 0 && factors.translate_x == 0 && factors.translate_y == 0) {
    control.call("set_offset_transform_enabled", false);
    control.set_rotation(0);
    control.set_scale({1, 1});
    control.set_pivot_offset({});
    control.set_position({metrics.frame.origin.x, metrics.frame.origin.y});
    return;
  }
  // These public 4.7 APIs predate our pinned generated godot-cpp binding update.
  // Both factors affect the same Control's real transform, painting and GUI.
  control.call("set_pivot_offset_ratio", godot::Vector2());
  control.set_pivot_offset(center);
  control.set_rotation(factors.rotation);
  control.set_scale(scale);
  control.call("set_offset_transform_enabled", false);
  control.call("set_offset_transform_position", godot::Vector2());
  control.call("set_offset_transform_position_ratio", godot::Vector2());
  control.call("set_offset_transform_pivot", center);
  control.call("set_offset_transform_pivot_ratio", godot::Vector2());
  control.call("set_offset_transform_scale", godot::Vector2(1, 1));
  control.call("set_offset_transform_rotation", factors.offset_rotation);
  control.call("set_offset_transform_visual_only", false);
  control.call("set_offset_transform_enabled", factors.offset_rotation != 0);
  control.set_position(position);
}
}
