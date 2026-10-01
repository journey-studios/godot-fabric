#include "appearance_adapter.h"
#include <godot_cpp/classes/label.hpp>
#include <godot_cpp/classes/panel.hpp>
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
                      const rn::LayoutMetrics &layout) {
  const bool label = Object::cast_to<Label>(&control) != nullptr;
  const bool panel = Object::cast_to<Panel>(&control) != nullptr;
  if (!label && !panel) return;
  // A ausência de uma prop recria o estilo vazio e remove overrides antigos.
  // Yoga já posiciona os filhos; somente o Label consome seus contentInsets.
  Ref<StyleBoxFlat> style;
  style.instantiate();
  auto border = props.resolveBorderMetrics(layout);
  style->set_bg_color(native_color(props.backgroundColor));
  style->set_border_color(native_color(border.borderColors.left));
  const float widths[] = {border.borderWidths.left, border.borderWidths.top,
    border.borderWidths.right, border.borderWidths.bottom};
  const float insets[] = {layout.contentInsets.left, layout.contentInsets.top,
    layout.contentInsets.right, layout.contentInsets.bottom};
  for (int side = 0; side < 4; ++side) {
    style->set_border_width(static_cast<Side>(side), std::lround(widths[side]));
    style->set_content_margin(static_cast<Side>(side), label ? insets[side] : 0);
  }
  style->set_corner_radius(CORNER_TOP_LEFT, std::lround(border.borderRadii.topLeft.horizontal));
  style->set_corner_radius(CORNER_TOP_RIGHT, std::lround(border.borderRadii.topRight.horizontal));
  style->set_corner_radius(CORNER_BOTTOM_LEFT, std::lround(border.borderRadii.bottomLeft.horizontal));
  style->set_corner_radius(CORNER_BOTTOM_RIGHT, std::lround(border.borderRadii.bottomRight.horizontal));
  control.add_theme_stylebox_override(label ? "normal" : "panel", style);
  if (label) {
    const auto &text = static_cast<const ControlProps &>(props);
    if (text.color) control.add_theme_color_override("font_color", native_color(text.color));
    else control.remove_theme_color_override("font_color");
  }
}
folly::dynamic appearance_snapshot(const Control &control) {
  const bool label = Object::cast_to<Label>(&control) != nullptr;
  if (!label && !Object::cast_to<Panel>(&control)) return nullptr;
  Ref<StyleBoxFlat> style = control.get_theme_stylebox(label ? "normal" : "panel");
  if (style.is_null()) return nullptr;
  folly::dynamic result = folly::dynamic::object("background", hex(style->get_bg_color()))
    ("borderColor", hex(style->get_border_color()));
  auto widths = folly::dynamic::array();
  auto radii = folly::dynamic::array();
  for (int side = 0; side < 4; ++side) widths.push_back(style->get_border_width(static_cast<Side>(side)));
  for (int corner = 0; corner < 4; ++corner) radii.push_back(style->get_corner_radius(static_cast<Corner>(corner)));
  result["borderWidths"] = std::move(widths);
  result["cornerRadii"] = std::move(radii);
  if (label) result["textColor"] = hex(control.get_theme_color("font_color"));
  return result;
}
}
