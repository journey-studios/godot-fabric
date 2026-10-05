#pragma once
#include "pointer_geometry_history.h"
#include <godot_cpp/variant/vector2.hpp>
#include <react/renderer/components/view/PointerEvent.h>
#include <react/renderer/core/ReactPrimitives.h>
#include <cstdint>
#include <memory>
#include <utility>

namespace fabric_godot {
// Shared native queue payload: copies made by the upstream capture processor
// keep the public fields; the binding still holds this immutable source sample.
// No event-ID side table, JS field or upstream PointerEvent layout is added.
struct GodotPointerEvent final : facebook::react::PointerEvent {
  const godot::Vector2 viewport_point;
  const facebook::react::SurfaceId source_surface;
  const uint64_t window_id, viewport_id;
  const std::shared_ptr<PointerGeometryHistory> history;
  const uint64_t serial;
  const bool terminal;
  // No view was hit inside the source root: RN resolves that point to the root
  // view itself, which stays in the hover path but never receives an event.
  const bool root_target;
  GodotPointerEvent(facebook::react::PointerEvent event, godot::Vector2 point,
      facebook::react::SurfaceId surface, uint64_t window, uint64_t viewport,
      std::shared_ptr<PointerGeometryHistory> contact, bool ending, bool root)
      : facebook::react::PointerEvent(std::move(event)), viewport_point(point),
        source_surface(surface), window_id(window), viewport_id(viewport),
        history(std::move(contact)), serial(++history->submitted), terminal(ending),
        root_target(root) {}
};
}
