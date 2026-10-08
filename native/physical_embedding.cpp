#include "physical_embedding.h"

#include <react/renderer/core/LayoutableShadowNode.h>
#include <react/renderer/dom/DOM.h>

namespace fabric_godot {
namespace rn = facebook::react;

std::optional<PhysicalEmbedding> PhysicalEmbedding::capture(
    rn::RootShadowNode::Shared revision, const rn::ShadowNode &target) {
  if (!revision) return std::nullopt;

  std::vector<const rn::ShadowNode *> path{revision.get()};
  if (!rn::ShadowNode::sameFamily(*revision, target)) {
    const auto ancestors = target.getFamily().getAncestors(*revision);
    if (ancestors.empty()) return std::nullopt;
    path.reserve(ancestors.size() + 1);
    for (const auto &[parent, index] : ancestors) {
      const auto &current = parent.get();
      if (!rn::ShadowNode::sameFamily(*path.back(), current)) return std::nullopt;
      path.push_back(current.getChildren().at(index).get());
    }
    if (!rn::ShadowNode::sameFamily(*path.back(), target)) return std::nullopt;
  }

  std::size_t boundary = 0;
  for (std::size_t index = 0; index < path.size(); ++index)
    if (path[index]->getTraits().check(rn::ShadowNodeTraits::Trait::RootNodeKind))
      boundary = index;
  return PhysicalEmbedding(std::move(revision), std::move(path), boundary);
}

rn::dom::DOMRect PhysicalEmbedding::bounding_rect(bool include_transform) const {
  return rn::dom::getBoundingClientRect(revision_, target(), include_transform);
}

std::size_t PhysicalEmbedding::projection_boundary_index() const {
  if (!target_is_boundary()) return boundary_index_;
  for (std::size_t index = boundary_index_; index > 0; --index)
    if (path_[index - 1]->getTraits().check(rn::ShadowNodeTraits::Trait::RootNodeKind))
      return index - 1;
  return 0;
}

bool PhysicalEmbedding::has_layout(bool include_transform) const {
  return rn::LayoutableShadowNode::computeLayoutMetricsFromRoot(target().getFamily(), *revision_,
      {.includeTransform = include_transform, .includeViewportOffset = true}) != rn::EmptyLayoutMetrics;
}

}  // namespace fabric_godot
