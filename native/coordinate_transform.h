#pragma once
#include <godot_cpp/variant/transform2d.hpp>
#include <cmath>
#include <limits>

namespace fabric_godot {
inline bool coordinate_inverse(const godot::Transform2D &transform, godot::Transform2D &inverse) {
  const auto determinant = transform.determinant();
  if (!transform.is_finite() || !std::isfinite(determinant) || determinant == 0) return false;
  inverse = transform.affine_inverse();
  return inverse.is_finite();
}
inline godot::Vector2 invalid_coordinate() {
  const auto invalid = std::numeric_limits<godot::real_t>::quiet_NaN();
  return {invalid, invalid};
}
inline godot::Vector2 local_coordinate(const godot::Transform2D &transform, godot::Vector2 point) {
  godot::Transform2D inverse;
  if (!point.is_finite() || !coordinate_inverse(transform, inverse)) return invalid_coordinate();
  const auto local = inverse.xform(point);
  return local.is_finite() ? local : invalid_coordinate();
}
}
