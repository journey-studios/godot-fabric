#pragma once
#include <godot_cpp/classes/control.hpp>
#include <react/renderer/components/view/ViewProps.h>

namespace fabric_godot {
void apply_transform(godot::Control &control, const facebook::react::ViewProps &props,
    const facebook::react::LayoutMetrics &metrics);
}
