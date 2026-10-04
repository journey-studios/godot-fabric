#include "appearance_adapter.h"
#include <godot_cpp/classes/label.hpp>
#include <godot_cpp/classes/panel.hpp>
#include <godot_cpp/classes/button.hpp>
#include <godot_cpp/classes/line_edit.hpp>
#include <godot_cpp/classes/style_box_flat.hpp>
#include <godot_cpp/classes/rendering_server.hpp>
#include <godot_cpp/variant/packed_color_array.hpp>
#include <godot_cpp/variant/packed_int32_array.hpp>
#include <godot_cpp/variant/packed_vector2_array.hpp>
#include <algorithm>
#include <cmath>
#include <numbers>
#include <optional>
#include <optional>
#include <vector>

namespace rn = facebook::react;
using namespace godot;
namespace {
Color native_color(rn::SharedColor color) {
  if (!color) return Color(0, 0, 0, 0);
  auto components = rn::colorComponentsFromColor(color);
  return Color(components.red, components.green, components.blue, components.alpha);
}
std::string hex(Color color) { return color.to_html(true).utf8().get_data(); }
Color source_over(Color foreground, Color background) {
  const float alpha = foreground.a + background.a * (1 - foreground.a);
  if (alpha <= 0) return Color(0, 0, 0, 0);
  const float retained_background = background.a * (1 - foreground.a);
  return Color((foreground.r * foreground.a + background.r * retained_background) / alpha,
      (foreground.g * foreground.a + background.g * retained_background) / alpha,
      (foreground.b * foreground.a + background.b * retained_background) / alpha, alpha);
}
constexpr double quarter_turn = std::numbers::pi / 2;
constexpr int corner_steps = 20;
struct Contour {
  Rect2 rect;
  std::array<Vector2, 4> radii; // top-left, top-right, bottom-right, bottom-left
  void fit() {
    double scale = 1;
    auto limit = [&scale](double size, double total) {
      if (total > 0) scale = std::min(scale, size / total);
    };
    limit(rect.size.x, radii[0].x + radii[1].x);
    limit(rect.size.x, radii[3].x + radii[2].x);
    limit(rect.size.y, radii[0].y + radii[3].y);
    limit(rect.size.y, radii[1].y + radii[2].y);
    for (auto &radius : radii) radius *= std::clamp(scale, 0.0, 1.0);
  }
  Vector2 box_corner(int corner) const {
    return rect.position + Vector2(corner == 1 || corner == 2 ? rect.size.x : 0,
        corner == 2 || corner == 3 ? rect.size.y : 0);
  }
  Vector2 center(int corner) const {
    const auto radius = radii[corner];
    return box_corner(corner) + Vector2(corner == 1 || corner == 2 ? -radius.x : radius.x,
        corner == 2 || corner == 3 ? -radius.y : radius.y);
  }
  Vector2 point(int corner, double turn) const {
    const auto radius = radii[corner];
    const double angle = std::numbers::pi + corner * quarter_turn + turn;
    return center(corner) + Vector2(radius.x * std::cos(angle), radius.y * std::sin(angle));
  }
  Vector2 normal(int corner, double turn) const {
    const auto radius = radii[corner];
    const double angle = std::numbers::pi + corner * quarter_turn + turn;
    return Vector2(std::cos(angle) / std::max(1.0, static_cast<double>(radius.x)),
        std::sin(angle) / std::max(1.0, static_cast<double>(radius.y))).normalized();
  }
};
// RN partitions adjacent colors along the ray from the outer box corner to
// its inset corner. Intersect that SAME ray with each ellipse: their angular
// parameters differ when the horizontal and vertical widths are unequal.
double seam_turn(const Contour &contour, int corner, Vector2 origin, Vector2 direction, double fallback) {
  const auto radius = contour.radii[corner];
  const auto center = contour.center(corner);
  if (radius.x == 0 && radius.y == 0) return fallback; // All arc points coincide.
  const double sign_x = corner == 1 || corner == 2 ? 1 : -1;
  const double sign_y = corner == 2 || corner == 3 ? 1 : -1;
  auto turn_for = [&](double t) -> std::optional<double> {
    if (!std::isfinite(t) || t < 0) return std::nullopt;
    const double x = origin.x + direction.x * t - center.x;
    const double y = origin.y + direction.y * t - center.y;
    double nx = radius.x > 0 ? x / radius.x : 0;
    double ny = radius.y > 0 ? y / radius.y : 0;
    if (std::abs(nx) > 1.00001 || std::abs(ny) > 1.00001 || nx * sign_x < -0.00001 || ny * sign_y < -0.00001)
      return std::nullopt;
    nx = std::clamp(nx, -1.0, 1.0); ny = std::clamp(ny, -1.0, 1.0);
    if (radius.x == 0) nx = sign_x * std::sqrt(std::max(0.0, 1 - ny * ny));
    if (radius.y == 0) ny = sign_y * std::sqrt(std::max(0.0, 1 - nx * nx));
    double angle = std::atan2(ny, nx);
    const double start = std::numbers::pi + corner * quarter_turn;
    while (angle < start - 0.00001) angle += 2 * std::numbers::pi;
    return std::clamp(angle - start, 0.0, quarter_turn);
  };
  if (radius.x == 0 || radius.y == 0) {
    const double delta = radius.x == 0 ? direction.x : direction.y;
    if (delta == 0) return fallback;
    const double t = (radius.x == 0 ? center.x - origin.x : center.y - origin.y) / delta;
    return turn_for(t).value_or(fallback);
  }
  const double px = (origin.x - center.x) / radius.x, py = (origin.y - center.y) / radius.y;
  const double dx = direction.x / radius.x, dy = direction.y / radius.y;
  const double a = dx * dx + dy * dy;
  const double b = 2 * (px * dx + py * dy);
  const double c = px * px + py * py - 1;
  if (a == 0) return fallback;
  const double discriminant = b * b - 4 * a * c;
  if (discriminant < -0.00001) return fallback;
  const double root = std::sqrt(std::max(0.0, discriminant));
  if (auto turn = turn_for((-b - root) / (2 * a))) return *turn;
  return turn_for((-b + root) / (2 * a)).value_or(fallback);
}
struct Mesh {
  PackedVector2Array points;
  PackedColorArray colors;
  PackedInt32Array indices;
  void triangle(Vector2 a, Vector2 b, Vector2 c, Color ca, Color cb, Color cc) {
    if (std::abs((b - a).cross(c - a)) < 0.000001) return;
    const int offset = points.size();
    points.push_back(a); points.push_back(b); points.push_back(c);
    colors.push_back(ca); colors.push_back(cb); colors.push_back(cc);
    indices.push_back(offset); indices.push_back(offset + 1); indices.push_back(offset + 2);
  }
  void quad(Vector2 a, Vector2 b, Vector2 c, Vector2 d, Color outer, Color inner) {
    triangle(a, b, c, outer, outer, inner);
    triangle(a, c, d, outer, inner, inner);
  }
};
struct BorderPoint {
  Vector2 outer, inner, outer_core, inner_core, outer_fade, inner_fade;
};
BorderPoint border_point(const Contour &outer, const Contour &inner, int corner, double outer_turn, double inner_turn, double aa) {
  const Vector2 p = outer.point(corner, outer_turn);
  const Vector2 q = inner.point(corner, inner_turn);
  // Thin/tapering borders keep an ordered opaque ring, including beside a
  // zero-width edge. Feathering never consumes the whole border thickness.
  const double feather = std::min(aa, static_cast<double>(p.distance_to(q)) / 4);
  const Vector2 no = outer.normal(corner, outer_turn) * feather;
  const Vector2 ni = inner.normal(corner, inner_turn) * feather;
  return {p, q, p - no, q + ni, p + no, q - ni};
}
void border_segment(Mesh &mesh, const BorderPoint &a, const BorderPoint &b, Color color) {
  Color transparent = color;
  transparent.a = 0;
  mesh.quad(a.outer_core, b.outer_core, b.inner_core, a.inner_core, color, color);
  mesh.quad(a.outer_fade, b.outer_fade, b.outer_core, a.outer_core, transparent, color);
  mesh.quad(a.inner_core, b.inner_core, b.inner_fade, a.inner_fade, color, transparent);
}
}
void GodotBorderStyleBox::configure(const Ref<StyleBoxFlat> &metrics, const std::array<Color, 4> &colors) {
  metrics_ = metrics;
  colors_ = colors;
  // RN paints its background to the outer contour before compositing borders.
  // Delegate that fill/outer antialiasing to a borderless native StyleBoxFlat.
  background_.instantiate();
  background_->set_bg_color(metrics->get_bg_color());
  for (int corner = 0; corner < 4; ++corner)
    background_->set_corner_radius(static_cast<Corner>(corner), metrics->get_corner_radius(static_cast<Corner>(corner)));
  for (int side = 0; side < 4; ++side)
    set_content_margin(static_cast<Side>(side), metrics->get_content_margin(static_cast<Side>(side)));
}
Vector2 GodotBorderStyleBox::_get_minimum_size() const {
  return metrics_.is_valid() ? metrics_->get_minimum_size() : Vector2();
}
Rect2 GodotBorderStyleBox::_get_draw_rect(const Rect2 &rect) const { return rect.grow(0.5); }
void GodotBorderStyleBox::_draw(const RID &canvas_item, const Rect2 &rect) const {
  if (metrics_.is_null() || rect.size.x <= 0 || rect.size.y <= 0) return;
  background_->draw(canvas_item, rect);
  std::array<double, 4> widths;
  for (int side = 0; side < 4; ++side) widths[side] = std::max(0, metrics_->get_border_width(static_cast<Side>(side)));
  auto fit_widths = [&widths](int a, int b, double size) {
    const double sum = widths[a] + widths[b];
    if (sum > size) { widths[a] *= size / sum; widths[b] *= size / sum; }
  };
  fit_widths(SIDE_LEFT, SIDE_RIGHT, rect.size.x);
  fit_widths(SIDE_TOP, SIDE_BOTTOM, rect.size.y);
  Contour outer{rect, {}};
  bool rounded = false;
  for (int corner = 0; corner < 4; ++corner) {
    const double radius = std::max(0, metrics_->get_corner_radius(static_cast<Corner>(corner)));
    outer.radii[corner] = Vector2(radius, radius);
    rounded = rounded || radius > 0;
  }
  outer.fit();
  const int first_side[] = {SIDE_LEFT, SIDE_TOP, SIDE_RIGHT, SIDE_BOTTOM};
  const int second_side[] = {SIDE_TOP, SIDE_RIGHT, SIDE_BOTTOM, SIDE_LEFT};
  const int horizontal_side[] = {SIDE_LEFT, SIDE_RIGHT, SIDE_RIGHT, SIDE_LEFT};
  const int vertical_side[] = {SIDE_TOP, SIDE_TOP, SIDE_BOTTOM, SIDE_BOTTOM};
  Contour inner{Rect2(rect.position + Vector2(widths[SIDE_LEFT], widths[SIDE_TOP]),
      Vector2(std::max(0.0, rect.size.x - widths[SIDE_LEFT] - widths[SIDE_RIGHT]),
          std::max(0.0, rect.size.y - widths[SIDE_TOP] - widths[SIDE_BOTTOM]))), {}};
  for (int corner = 0; corner < 4; ++corner)
    inner.radii[corner] = Vector2(std::max(0.0, outer.radii[corner].x - widths[horizontal_side[corner]]),
        std::max(0.0, outer.radii[corner].y - widths[vertical_side[corner]]));
  inner.fit();
  // Each solid-color border sector paints once over the separate outer fill.
  Mesh mesh;
  const double aa = rounded ? 0.5 : 0;
  std::array<BorderPoint, 4> starts, ends;
  for (int corner = 0; corner < 4; ++corner) {
    starts[corner] = border_point(outer, inner, corner, 0, 0, aa);
    ends[corner] = border_point(outer, inner, corner, quarter_turn, quarter_turn, aa);
    const int first = first_side[corner], second = second_side[corner];
    const double fallback = std::atan2(widths[first], widths[second]);
    const Vector2 origin = outer.box_corner(corner);
    const Vector2 direction = inner.box_corner(corner) - origin;
    const double outer_split = seam_turn(outer, corner, origin, direction, fallback);
    const double inner_split = seam_turn(inner, corner, origin, direction, fallback);
    for (int sector = 0; sector < 2; ++sector) {
      const int side = sector == 0 ? first : second;
      if (widths[side] <= 0) continue;
      const double outer_start = sector == 0 ? 0 : outer_split;
      const double inner_start = sector == 0 ? 0 : inner_split;
      const double outer_end = sector == 0 ? outer_split : quarter_turn;
      const double inner_end = sector == 0 ? inner_split : quarter_turn;
      const int steps = std::max(1, static_cast<int>(std::ceil(corner_steps *
          std::max(outer_end - outer_start, inner_end - inner_start) / quarter_turn)));
      auto vertex = [&](int step) {
        const double fraction = static_cast<double>(step) / steps;
        return border_point(outer, inner, corner, outer_start + (outer_end - outer_start) * fraction,
            inner_start + (inner_end - inner_start) * fraction, aa);
      };
      for (int step = 1; step <= steps; ++step) border_segment(mesh, vertex(step - 1), vertex(step), colors_[side]);
    }
  }
  for (int corner = 0; corner < 4; ++corner) {
    const int side = second_side[corner];
    if (widths[side] > 0) border_segment(mesh, ends[corner], starts[(corner + 1) % 4], colors_[side]);
  }
  if (!mesh.indices.is_empty()) RenderingServer::get_singleton()->canvas_item_add_triangle_array(
      canvas_item, mesh.indices, mesh.points, mesh.colors);
}
namespace fabric_godot {
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
  const std::array<Color, 4> border_colors{native_color(border.borderColors.left), native_color(border.borderColors.top),
      native_color(border.borderColors.right), native_color(border.borderColors.bottom)};
  const float widths[] = {border.borderWidths.left, border.borderWidths.top,
    border.borderWidths.right, border.borderWidths.bottom};
  const float insets[] = {layout.contentInsets.left, layout.contentInsets.top,
    layout.contentInsets.right, layout.contentInsets.bottom};
  const bool styled = props.backgroundColor || border.borderWidths.left || border.borderWidths.top ||
      border.borderWidths.right || border.borderWidths.bottom || border.borderRadii.topLeft.horizontal ||
      border.borderRadii.topRight.horizontal || border.borderRadii.bottomLeft.horizontal ||
      border.borderRadii.bottomRight.horizontal || insets[0] || insets[1] || insets[2] || insets[3];
  for (int side = 0; side < 4; ++side) {
    style->set_border_width(static_cast<Side>(side), std::max(0L, std::lround(widths[side])));
    style->set_content_margin(static_cast<Side>(side), label || widget ? insets[side] : 0);
  }
  style->set_corner_radius(CORNER_TOP_LEFT, std::lround(border.borderRadii.topLeft.horizontal));
  style->set_corner_radius(CORNER_TOP_RIGHT, std::lround(border.borderRadii.topRight.horizontal));
  style->set_corner_radius(CORNER_BOTTOM_LEFT, std::lround(border.borderRadii.bottomLeft.horizontal));
  style->set_corner_radius(CORNER_BOTTOM_RIGHT, std::lround(border.borderRadii.bottomRight.horizontal));
  Color uniform_color = border_colors[SIDE_LEFT];
  bool found_color = false, multicolor = false;
  PackedColorArray effective_colors;
  for (int side = 0; side < 4; ++side) {
    effective_colors.push_back(border_colors[side]);
    if (style->get_border_width(static_cast<Side>(side)) <= 0) continue;
    if (!found_color) { uniform_color = border_colors[side]; found_color = true; }
    else if (uniform_color != border_colors[side]) multicolor = true;
  }
  // StyleBoxFlat fills only inside its border. Precomposing a uniform border
  // over the background preserves RN source-over while retaining the flat path.
  style->set_border_color(source_over(uniform_color, style->get_bg_color()));
  // Keep the four resolved colors even when a zero-width side is not drawn.
  style->set_meta("_fabric_border_colors", effective_colors);
  style->set_meta("_fabric_border_color", uniform_color);
  Ref<StyleBox> painter = style;
  if (multicolor) {
    Ref<GodotBorderStyleBox> colored;
    colored.instantiate();
    colored->configure(style, border_colors);
    painter = colored;
  }
  if (widget) {
    // Preserve the Godot Theme for unstyled legacy controls and restore it
    // after prop removal. Focus keeps the transparent native Theme outline.
    for (const auto *key : {"normal", "hover", "pressed", "hover_pressed", "disabled", "read_only"}) {
      if (styled) control.add_theme_stylebox_override(key, painter);
      else control.remove_theme_stylebox_override(key);
    }
  } else control.add_theme_stylebox_override(label ? "normal" : "panel", painter);
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
  Ref<StyleBox> painter = control.get_theme_stylebox(label || widget ? "normal" : "panel");
  auto *colored = Object::cast_to<GodotBorderStyleBox>(painter.ptr());
  Ref<StyleBoxFlat> style = colored ? colored->metrics() : Ref<StyleBoxFlat>(painter);
  if (style.is_null()) return nullptr;
  const Color border_color = style->has_meta("_fabric_border_color") ? static_cast<Color>(style->get_meta("_fabric_border_color")) : style->get_border_color();
  folly::dynamic result = folly::dynamic::object("background", hex(style->get_bg_color()))
    ("borderColor", hex(border_color))("borderPainter", colored ? "multicolor" : "flat");
  auto widths = folly::dynamic::array();
  auto radii = folly::dynamic::array();
  auto colors = folly::dynamic::array();
  PackedColorArray effective_colors;
  if (style->has_meta("_fabric_border_colors")) effective_colors = style->get_meta("_fabric_border_colors");
  for (int side = 0; side < 4; ++side) widths.push_back(style->get_border_width(static_cast<Side>(side)));
  for (int side = 0; side < 4; ++side)
    colors.push_back(hex(effective_colors.size() == 4 ? effective_colors[side] : style->get_border_color()));
  for (int corner = 0; corner < 4; ++corner) radii.push_back(style->get_corner_radius(static_cast<Corner>(corner)));
  result["borderWidths"] = std::move(widths);
  result["borderColors"] = std::move(colors);
  result["cornerRadii"] = std::move(radii);
  if (label || widget) result["textColor"] = hex(control.get_theme_color("font_color"));
  return result;
}
}
