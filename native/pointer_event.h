#pragma once
#include "pointer_geometry_history.h"
#include <godot_cpp/variant/transform2d.hpp>
#include <godot_cpp/variant/vector2.hpp>
#include <react/renderer/components/view/PointerEvent.h>
#include <react/renderer/core/ReactPrimitives.h>
#include <react/renderer/core/ShadowNodeFamily.h>
#include <cstdint>
#include <memory>
#include <utility>

namespace fabric_godot {
struct PointerInputSource {
  facebook::react::SurfaceId surface{};
  facebook::react::Tag boundary_tag{};
  uint64_t boundary_mount{};
  uint64_t window_id{}, viewport_id{}, owner_window_id{};
  facebook::react::ShadowNodeFamily::Shared boundary_family;
  godot::Transform2D boundary_to_viewport;
  godot::Transform2D viewport_to_screen;
};

// Shared native queue payload: copies made by the upstream capture processor
// keep the public fields; the binding still holds this immutable source sample.
// No event-ID side table, JS field or upstream PointerEvent layout is added.
struct GodotPointerEvent final : facebook::react::PointerEvent {
  const godot::Vector2 viewport_point;
  const PointerInputSource source;
  const std::shared_ptr<PointerGeometryHistory> history;
  const uint64_t serial;
  const bool terminal;
  // No view was hit inside the source root: RN resolves that point to the root
  // view itself, which stays in the hover path but never receives an event.
  const bool root_target;
  GodotPointerEvent(facebook::react::PointerEvent event, godot::Vector2 point,
      PointerInputSource input_source,
      std::shared_ptr<PointerGeometryHistory> contact, bool ending, bool root)
      : facebook::react::PointerEvent(std::move(event)), viewport_point(point),
        source(std::move(input_source)),
        history(std::move(contact)), serial(++history->submitted), terminal(ending),
        root_target(root) {}
};
}
