#pragma once
#include "affine_transform.h"
#include <godot_cpp/classes/control.hpp>
#include <react/renderer/components/view/ViewProps.h>

namespace fabric_godot {
// The transform step's result for one View: the planar factors its Control carries,
// or the collapse of a singular transform (affine_transform.h). Throws
// E_TRANSFORM_3D, E_TRANSFORM_NONFINITE and E_TRANSFORM_RANGE for what a Control
// cannot carry; a collapsed transform is a result, never an error. The runtime
// composes it with the View's display type in one place, since a collapsed View is
// hidden like a display: none one.
PlanarTransform resolve_transform(const facebook::react::ViewProps &props,
    const facebook::react::LayoutMetrics &metrics);

// Carries a resolved transform on the Control. A collapsed one leaves the Control's
// last invertible transform in place, so its geometry stays finite until a later
// update brings an invertible transform.
void apply_transform(godot::Control &control, const PlanarTransform &transform,
    const facebook::react::LayoutMetrics &metrics);
}
