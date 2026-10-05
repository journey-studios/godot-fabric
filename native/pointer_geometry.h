#pragma once
#include <godot_cpp/variant/transform2d.hpp>
#include <react/renderer/core/ReactPrimitives.h>
#include <functional>
#include <optional>

namespace facebook::react {
class ShadowNode;
class UIManager;
}

namespace fabric_godot {
// The callback returns a connected mounted Control's viewport transform. An
// absent Control is normal for a logical ref flattened by Fabric.
using MountedPointerTransform =
    std::function<std::optional<godot::Transform2D>(facebook::react::Tag)>;

// Only computes offset coordinates. The source root's client/page coordinates
// and the input sample's screen coordinates remain owned by the transport.
// Missing/disconnected/non-layout targets return nullopt. A hidden tree reports
// hidden=true so the adapter can retain upstream unpainted-node semantics.
// Unsupported or
// non-invertible geometry throws an E_POINTER_GEOMETRY_* diagnostic.
std::optional<godot::Vector2> pointer_local_point(
    const facebook::react::UIManager &ui,
    const facebook::react::ShadowNode &target,
    godot::Vector2 viewport_point,
    const godot::Transform2D &root_embedding,
    const MountedPointerTransform &mounted, bool *hidden = nullptr);
}
