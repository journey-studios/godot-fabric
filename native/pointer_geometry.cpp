#include "pointer_geometry.h"
#include "coordinate_transform.h"
#include <react/renderer/components/root/RootShadowNode.h>
#include <react/renderer/core/LayoutableShadowNode.h>
#include <react/renderer/uimanager/UIManager.h>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <vector>

namespace fabric_godot {
namespace rn = facebook::react;
namespace {
godot::real_t native_value(double value) {
  if (!std::isfinite(value))
    throw std::runtime_error("E_POINTER_GEOMETRY_NONFINITE: pointer geometry must be finite");
  if (std::abs(value) > std::numeric_limits<godot::real_t>::max())
    throw std::runtime_error("E_POINTER_GEOMETRY_RANGE: pointer geometry exceeds native coordinate precision");
  const auto result = static_cast<godot::real_t>(value);
  if (value != 0 && result == 0)
    throw std::runtime_error("E_POINTER_GEOMETRY_RANGE: pointer geometry underflows native coordinate precision");
  return result;
}

godot::Transform2D inverse(const godot::Transform2D &transform) {
  if (!transform.is_finite())
    throw std::runtime_error("E_POINTER_GEOMETRY_NONFINITE: pointer transform must be finite");
  // Evaluate Float products in double before Godot's real_t determinant, so
  // native overflow/underflow is distinguishable from an actual rank loss.
  const auto determinant = double(transform[0].x) * double(transform[1].y) -
      double(transform[0].y) * double(transform[1].x);
  if (determinant == 0)
    throw std::runtime_error("E_POINTER_GEOMETRY_SINGULAR: pointer transform must be invertible");
  godot::Transform2D result;
  if (!coordinate_inverse(transform, result))
    throw std::runtime_error("E_POINTER_GEOMETRY_RANGE: pointer inverse exceeds native coordinate precision");
  return result;
}

// Validation only: the same guarantees and diagnostics as inverse(), for
// callers that keep the forward transform.
void require_invertible(const godot::Transform2D &transform) {
  static_cast<void>(inverse(transform));
}

godot::Transform2D translation(rn::Point point) {
  return {{1, 0}, {0, 1}, {native_value(point.x), native_value(point.y)}};
}

godot::Transform2D local_transform(const rn::LayoutableShadowNode &node) {
  const auto metrics = node.getLayoutMetrics();
  const auto matrix = node.getTransform().matrix;
  for (auto value : matrix) native_value(value);
  for (auto index : {2, 3, 6, 7, 8, 9, 11, 14})
    if (matrix[index] != 0)
      throw std::runtime_error("E_POINTER_GEOMETRY_3D: pointer projection requires a planar affine transform");
  if (matrix[10] != 1 || matrix[15] != 1)
    throw std::runtime_error("E_POINTER_GEOMETRY_3D: pointer projection requires a planar affine transform");

  const double center_x = double(metrics.frame.size.width) / 2;
  const double center_y = double(metrics.frame.size.height) / 2;
  // ConcreteViewShadowNode::getTransform resolves percentage operations and
  // transformOrigin. Like LayoutableShadowNode's applyWithCenter, the resolved
  // affine acts about this node's center before its parent-relative frame.
  const double x = double(metrics.frame.origin.x) + center_x + matrix[12] -
      double(matrix[0]) * center_x - double(matrix[4]) * center_y;
  const double y = double(metrics.frame.origin.y) + center_y + matrix[13] -
      double(matrix[1]) * center_x - double(matrix[5]) * center_y;
  godot::Transform2D result({native_value(matrix[0]), native_value(matrix[1])},
      {native_value(matrix[4]), native_value(matrix[5])}, {native_value(x), native_value(y)});
  require_invertible(result);
  return result;
}
}

std::optional<godot::Vector2> pointer_local_point(
    const rn::UIManager &ui, const rn::ShadowNode &target,
    godot::Vector2 viewport_point, const godot::Transform2D &root_embedding,
    const MountedPointerTransform &mounted, bool *hidden) {
  if (hidden) *hidden = false;
  if (!viewport_point.is_finite())
    throw std::runtime_error("E_POINTER_GEOMETRY_NONFINITE: native pointer sample must be finite");

  // Retain one current revision, then perform all host callbacks after the
  // registry visit releases its lock. Family ancestry survives clone changes.
  rn::RootShadowNode::Shared root;
  ui.getShadowTreeRegistry().visit(target.getSurfaceId(), [&](const rn::ShadowTree &tree) {
    root = tree.getCurrentRevision().rootShadowNode;
  });
  if (!root) return std::nullopt;

  std::vector<const rn::ShadowNode *> path;
  if (rn::ShadowNode::sameFamily(*root, target)) {
    path.push_back(root.get());
  } else {
    const auto ancestors = target.getFamily().getAncestors(*root);
    if (ancestors.empty()) return std::nullopt;
    path.reserve(ancestors.size() + 1);
    for (const auto &[parent, index] : ancestors) path.push_back(&parent.get());
    const auto &[parent, index] = ancestors.back();
    path.push_back(parent.get().getChildren().at(index).get());
  }

  std::vector<const rn::LayoutableShadowNode *> layouts;
  layouts.reserve(path.size());
  for (const auto *node : path) {
    const auto *layout = dynamic_cast<const rn::LayoutableShadowNode *>(node);
    if (!layout) return std::nullopt;
    const auto metrics = layout->getLayoutMetrics();
    if (metrics.displayType == rn::DisplayType::None) {
      if (hidden) *hidden = true;
      return std::nullopt;
    }
    if (metrics == rn::EmptyLayoutMetrics)
      return std::nullopt;
    for (auto value : {metrics.frame.origin.x, metrics.frame.origin.y,
        metrics.frame.size.width, metrics.frame.size.height}) native_value(value);
    layouts.push_back(layout);
  }

  require_invertible(root_embedding);
  auto transform = root_embedding;
  std::size_t anchor = 0;
  if (mounted) {
    for (std::size_t index = path.size(); index-- > 0;) {
      auto actual = mounted(path[index]->getTag());
      if (!actual) continue;
      require_invertible(*actual);
      transform = *actual;
      anchor = index;
      break;
    }
  }

  for (std::size_t index = anchor + 1; index < path.size(); ++index) {
    // The ancestor's content offset precedes the child's frame/transform.
    // getContentOriginOffset(false) remains in that ancestor's local space;
    // using its transformed form here would apply an affine a second time.
    // A mounted content ancestor already includes native ScrollContainer
    // displacement. Only logical edges use the committed Fabric offset.
    transform = transform * translation(layouts[index - 1]->getContentOriginOffset(false)) *
        local_transform(*layouts[index]);
    if (!transform.is_finite())
      throw std::runtime_error("E_POINTER_GEOMETRY_RANGE: composed pointer transform exceeds native coordinate precision");
    require_invertible(transform);
  }

  const auto point = inverse(transform).xform(viewport_point);
  if (!point.is_finite())
    throw std::runtime_error("E_POINTER_GEOMETRY_RANGE: projected pointer point exceeds native coordinate precision");
  return point;
}
}
