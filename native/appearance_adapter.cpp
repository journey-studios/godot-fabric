#include "appearance_adapter.h"
#include <godot_cpp/classes/label.hpp>
#include <godot_cpp/classes/panel.hpp>
#include <godot_cpp/classes/button.hpp>
#include <godot_cpp/classes/line_edit.hpp>
#include <godot_cpp/classes/style_box_flat.hpp>
#include <cmath>

namespace fabric_godot {
namespace rn = facebook::react;
using namespace godot;
namespace {
Color native_color(rn::SharedColor color) {
  if (!color) return Color(0, 0, 0, 0);
  auto components = rn::colorComponentsFromColor(color);
  return Color(components.red, components.green, components.blue, components.alpha);
}
std::string hex(Color color) { return color.to_html(true).utf8().get_data(); }
}
void apply_appearance(Control &control, const rn::ViewProps &props,
                      const rn::LayoutMetrics &layout, const ControlProps *text_props) {
  const bool label = Object::cast_to<Label>(&control) != nullptr;
  const bool panel = Object::cast_to<Panel>(&control) != nullptr;
  const bool widget = Object::cast_to<Button>(&control) || Object::cast_to<LineEdit>(&control);
  if (!label && !panel && !widget) return;
  // Recreate styles on updates so removed props leave no stale overrides.
  // Yoga positions children; leaf text and widgets consume their content insets.
  Ref<StyleBoxFlat> style;
  style.instantiate();
  auto border = props.resolveBorderMetrics(layout);
  style->set_bg_color(native_color(props.backgroundColor));
  style->set_border_color(native_color(border.borderColors.left));
  const float widths[] = {border.borderWidths.left, border.borderWidths.top,
    border.borderWidths.right, border.borderWidths.bottom};
  const float insets[] = {layout.contentInsets.left, layout.contentInsets.top,
    layout.contentInsets.right, layout.contentInsets.bottom};
  const bool styled = props.backgroundColor || border.borderWidths.left || border.borderWidths.top ||
      border.borderWidths.right || border.borderWidths.bottom || border.borderRadii.topLeft.horizontal ||
      border.borderRadii.topRight.horizontal || border.borderRadii.bottomLeft.horizontal ||
      border.borderRadii.bottomRight.horizontal || insets[0] || insets[1] || insets[2] || insets[3];
  for (int side = 0; side < 4; ++side) {
    style->set_border_width(static_cast<Side>(side), std::lround(widths[side]));
    style->set_content_margin(static_cast<Side>(side), label || widget ? insets[side] : 0);
  }
  style->set_corner_radius(CORNER_TOP_LEFT, std::lround(border.borderRadii.topLeft.horizontal));
  style->set_corner_radius(CORNER_TOP_RIGHT, std::lround(border.borderRadii.topRight.horizontal));
  style->set_corner_radius(CORNER_BOTTOM_LEFT, std::lround(border.borderRadii.bottomLeft.horizontal));
  style->set_corner_radius(CORNER_BOTTOM_RIGHT, std::lround(border.borderRadii.bottomRight.horizontal));
  if (widget) {
    // Preserve the Godot Theme for unstyled legacy controls and restore it
    // after prop removal. Focus keeps the transparent native Theme outline.
    for (const auto *key : {"normal", "hover", "pressed", "hover_pressed", "disabled", "read_only"}) {
      if (styled) control.add_theme_stylebox_override(key, style);
      else control.remove_theme_stylebox_override(key);
    }
  } else control.add_theme_stylebox_override(label ? "normal" : "panel", style);
  // External components own their generated Props and font overrides. Only
  // callers that already hold the core ControlProps may apply core text color.
  if ((label || widget) && text_props) {
    if (text_props->color) control.add_theme_color_override("font_color", native_color(text_props->color));
    else control.remove_theme_color_override("font_color");
  }
}
folly::dynamic appearance_snapshot(const Control &control) {
  const bool label = Object::cast_to<Label>(&control) != nullptr;
  const bool widget = Object::cast_to<Button>(&control) || Object::cast_to<LineEdit>(&control);
  if (!label && !widget && !Object::cast_to<Panel>(&control)) return nullptr;
  Ref<StyleBoxFlat> style = control.get_theme_stylebox(label || widget ? "normal" : "panel");
  if (style.is_null()) return nullptr;
  folly::dynamic result = folly::dynamic::object("background", hex(style->get_bg_color()))
    ("borderColor", hex(style->get_border_color()));
  auto widths = folly::dynamic::array();
  auto radii = folly::dynamic::array();
  for (int side = 0; side < 4; ++side) widths.push_back(style->get_border_width(static_cast<Side>(side)));
  for (int corner = 0; corner < 4; ++corner) radii.push_back(style->get_corner_radius(static_cast<Corner>(corner)));
  result["borderWidths"] = std::move(widths);
  result["cornerRadii"] = std::move(radii);
  if (label || widget) result["textColor"] = hex(control.get_theme_color("font_color"));
  return result;
}
}
