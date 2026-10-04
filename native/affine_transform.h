#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>

namespace fabric_godot {
// Control's base and offset transforms compose R(a) S(x,y) R(b).
// A signed singular value preserves reflections as well as arbitrary shear.
struct AffineFactors {
  double rotation, scale_x, scale_y, offset_rotation, translate_x, translate_y;
};

template <typename T>
AffineFactors affine_factors(const std::array<T, 16> &matrix) {
  for (auto value : matrix)
    if (!std::isfinite(value))
      throw std::runtime_error("E_TRANSFORM_NONFINITE: transform must be finite");
  for (auto index : {2, 3, 6, 7, 8, 9, 11, 14})
    if (matrix[index] != 0)
      throw std::runtime_error("E_TRANSFORM_3D: perspective and 3D transforms are not implemented");
  if (matrix[10] != 1 || matrix[15] != 1)
    throw std::runtime_error("E_TRANSFORM_3D: expected a planar affine transform");

  const auto magnitude = std::max({std::abs(double(matrix[0])), std::abs(double(matrix[1])),
      std::abs(double(matrix[4])), std::abs(double(matrix[5]))});
  if (magnitude == 0)
    throw std::runtime_error("E_TRANSFORM_SINGULAR: singular transforms are not implemented");
  const double a = matrix[0] / magnitude, b = matrix[1] / magnitude;
  const double c = matrix[4] / magnitude, d = matrix[5] / magnitude;
  const auto determinant = a * d - b * c;
  // Division can introduce a false nonzero determinant for proportional
  // columns. RN Float products fit exactly in double before normalization.
  const double first_product = double(matrix[0]) * double(matrix[5]);
  const double second_product = double(matrix[1]) * double(matrix[4]);
  const auto raw_determinant = first_product - second_product;
  if ((std::isfinite(raw_determinant) && raw_determinant == 0 &&
          (first_product != 0 || second_product != 0)) ||
      (determinant == 0 && (raw_determinant == 0 || !std::isfinite(raw_determinant))))
    throw std::runtime_error("E_TRANSFORM_SINGULAR: singular transforms are not implemented");
  // Rotate the principal right singular vector onto the first column. Scaling
  // before the eigensystem avoids overflow/underflow in its squared entries.
  const auto theta = 0.5 * std::atan2(2 * (a * c + b * d), a * a + b * b - c * c - d * d);
  const auto cosine = std::cos(theta), sine = std::sin(theta);
  const auto x = a * cosine + c * sine, y = b * cosine + d * sine;
  const auto first = std::hypot(x, y);
  const auto second = std::isfinite(raw_determinant) && raw_determinant != 0
      ? raw_determinant / magnitude / first : determinant / first * magnitude;
  return {std::atan2(y, x), first * magnitude, second,
      -theta, double(matrix[12]), double(matrix[13])};
}
}
