#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <optional>
#include <stdexcept>

namespace fabric_godot {
// Control's base and offset transforms compose R(a) S(x,y) R(b).
// A signed singular value preserves reflections as well as arbitrary shear.
// Default-constructed factors are the identity.
struct AffineFactors {
  double rotation = 0, scale_x = 1, scale_y = 1, offset_rotation = 0, translate_x = 0, translate_y = 0;
};

// What a planar transform is, defined once for everything that reads RN's
// Transform::matrix: the transform adapter and pointer projection each call
// planar_violation and report a violation under their own error code. The matrix
// is RN's 4x4 in CATransform3D order (translation at [12], [13], [14]; the
// projective row at [3], [7], [11], [15]). A Control's points have z = 0, so a
// transform is planar when no entry couples z with the rest ([2], [6], [8], [9],
// [14]) or bends the projective row ([3], [7], [11]) and the weight [15] is 1.
//
// [10] is not part of the rule. RN writes `scale: n` as scale3d(n, n, n)
// (Transform::Scale sets [0], [5] and [10]), so every uniform scale carries n
// there. With the entries above all zero it only multiplies z, and a Control's
// points have z = 0: it cannot move a point of the plane. iOS (CATransform3D on
// the layer) and Android (scaleX and scaleY) render this scale in the plane too.
// [15] is different: it divides x and y, so it must stay 1.
enum class PlanarViolation { None, ZCoupling, Weight };

template <typename T>
PlanarViolation planar_violation(const std::array<T, 16> &matrix) {
  for (auto index : {2, 3, 6, 7, 8, 9, 11, 14})
    if (matrix[index] != 0)
      return PlanarViolation::ZCoupling;
  return matrix[15] != 1 ? PlanarViolation::Weight : PlanarViolation::None;
}

// The factors of a planar matrix, or nullopt when the matrix is singular: it has no
// inverse. A singular matrix is not an error; see PlanarTransform.
template <typename T>
std::optional<AffineFactors> affine_factors(const std::array<T, 16> &matrix) {
  for (auto value : matrix)
    if (!std::isfinite(value))
      throw std::runtime_error("E_TRANSFORM_NONFINITE: transform must be finite");
  switch (planar_violation(matrix)) {
    case PlanarViolation::ZCoupling:
      throw std::runtime_error("E_TRANSFORM_3D: perspective and 3D transforms are not implemented");
    case PlanarViolation::Weight:
      throw std::runtime_error("E_TRANSFORM_3D: expected a planar affine transform");
    case PlanarViolation::None:
      break;
  }

  const auto magnitude = std::max({std::abs(double(matrix[0])), std::abs(double(matrix[1])),
      std::abs(double(matrix[4])), std::abs(double(matrix[5]))});
  if (magnitude == 0)
    return std::nullopt;
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
    return std::nullopt;
  // Rotate the principal right singular vector onto the first column. Scaling
  // before the eigensystem avoids overflow/underflow in its squared entries.
  const auto theta = 0.5 * std::atan2(2 * (a * c + b * d), a * a + b * b - c * c - d * d);
  const auto cosine = std::cos(theta), sine = std::sin(theta);
  const auto x = a * cosine + c * sine, y = b * cosine + d * sine;
  const auto first = std::hypot(x, y);
  const auto second = std::isfinite(raw_determinant) && raw_determinant != 0
      ? raw_determinant / magnitude / first : determinant / first * magnitude;
  return AffineFactors{std::atan2(y, x), first * magnitude, second,
      -theta, double(matrix[12]), double(matrix[13])};
}

// Whether a double rounds to zero when stored as Native, with no conversion that
// could overflow: a tie at half the smallest subnormal rounds to the even zero.
template <typename Native>
bool rounds_to_zero(double value) {
  return std::abs(value) <= double(std::numeric_limits<Native>::denorm_min()) / 2;
}

// What a planar transform leaves of its view. A singular transform has no inverse
// and RN reports no error for it: the view and its subtree are neither drawn nor
// hit (iOS passes the matrix to the layer and RCTViewComponentView refuses hits
// once the determinant collapses; Android's TouchTargetHelper skips a child whose
// matrix does not invert), and layout, onLayout and the measurement APIs stay RN's
// own C++, which never inverts a transform. Such a view is collapsed. It is
// defined once, for the transform adapter and for pointer projection: a singular
// matrix, or one that loses rank at the Control's native precision (a scale factor
// that rounds to zero in Native) and so could not be inverted there either.
// Perspective, 3D and non-finite matrices are still errors, thrown as before.
struct PlanarTransform {
  bool collapsed = false;
  AffineFactors factors;  // Meaningful only when !collapsed.
};

template <typename Native, typename T>
PlanarTransform planar_transform(const std::array<T, 16> &matrix) {
  const auto factors = affine_factors(matrix);
  if (!factors || rounds_to_zero<Native>(factors->scale_x) || rounds_to_zero<Native>(factors->scale_y))
    return {true, {}};
  return {false, *factors};
}
}
