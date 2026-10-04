#pragma once
#include "godot_component.h"
#include <godot_cpp/classes/control.hpp>
#include <godot_cpp/classes/style_box_flat.hpp>
#include <array>
#include <folly/dynamic.h>

// A Resource paints into the consuming Control's existing CanvasItem. It never
// adds nodes or takes ownership of the Control's input or lifetime.
class GodotBorderStyleBox final : public godot::StyleBox {
  GDCLASS(GodotBorderStyleBox, godot::StyleBox)
 public:
  void configure(const godot::Ref<godot::StyleBoxFlat> &metrics,
      const std::array<godot::Color, 4> &colors);
  void _draw(const godot::RID &canvas_item, const godot::Rect2 &rect) const override;
  godot::Rect2 _get_draw_rect(const godot::Rect2 &rect) const override;
  godot::Vector2 _get_minimum_size() const override;
  const godot::Ref<godot::StyleBoxFlat> &metrics() const { return metrics_; }
 protected:
  static void _bind_methods() {}
 private:
  godot::Ref<godot::StyleBoxFlat> metrics_;
  godot::Ref<godot::StyleBoxFlat> background_;
  std::array<godot::Color, 4> colors_{};
};

namespace fabric_godot {
void apply_appearance(godot::Control &control, const facebook::react::ViewProps &props,
                      const facebook::react::LayoutMetrics &layout,
                      const ControlProps *text_props = nullptr);
folly::dynamic appearance_snapshot(const godot::Control &control);
}
