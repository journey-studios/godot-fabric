#pragma once
#include "godot_component.h"
#include <godot_cpp/classes/control.hpp>
#include <folly/dynamic.h>

namespace fabric_godot {
void apply_appearance(godot::Control &control, const facebook::react::ViewProps &props,
                      const facebook::react::LayoutMetrics &layout);
folly::dynamic appearance_snapshot(const godot::Control &control);
}
