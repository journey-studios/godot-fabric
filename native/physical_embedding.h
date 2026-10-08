#pragma once

#include <react/renderer/components/root/RootShadowNode.h>
#include <react/renderer/dom/DOM.h>
#include <optional>
#include <utility>
#include <vector>

namespace facebook::react {
class ShadowNode;
}

namespace fabric_godot {
namespace rn = facebook::react;

// One immutable Fabric revision and the logical path from its nearest physical
// root boundary to a target. RN still owns event ancestry; this path is only for
// geometry and maps to the native embedding that hosts that boundary.
class PhysicalEmbedding final {
 public:
  static std::optional<PhysicalEmbedding> capture(
      rn::RootShadowNode::Shared revision, const rn::ShadowNode &target);

  const rn::RootShadowNode::Shared &revision() const { return revision_; }
  const rn::ShadowNode &target() const { return *path_.back(); }
  const rn::ShadowNode &boundary() const { return *path_[boundary_index_]; }
  const std::vector<const rn::ShadowNode *> &path() const { return path_; }
  std::size_t boundary_index() const { return boundary_index_; }
  bool target_is_boundary() const { return boundary_index_ + 1 == path_.size(); }
  std::size_t projection_boundary_index() const;
  bool has_layout(bool include_transform) const;
  rn::dom::DOMRect bounding_rect(bool include_transform) const;

 private:
  PhysicalEmbedding(rn::RootShadowNode::Shared revision,
      std::vector<const rn::ShadowNode *> path, std::size_t boundary_index)
      : revision_(std::move(revision)), path_(std::move(path)),
        boundary_index_(boundary_index) {}

  rn::RootShadowNode::Shared revision_;
  std::vector<const rn::ShadowNode *> path_;
  std::size_t boundary_index_{};
};
}
