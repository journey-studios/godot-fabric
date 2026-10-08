#include "image_effects.h"
#include <godot_cpp/classes/rendering_server.hpp>
#include <godot_cpp/variant/color.hpp>
#include <godot_cpp/variant/rect2.hpp>
#include <godot_cpp/variant/transform2d.hpp>
#include <godot_cpp/variant/vector2.hpp>
#include <godot_cpp/variant/vector4.hpp>
#include <atomic>
#include <memory>

using namespace godot;
namespace img = fabric_godot::image;

namespace fabric_godot {
namespace {
// One shader for every Image: the tint of a template image and the mask of a rounded view, both optional.
//
// The tint replaces the color of every pixel and keeps its alpha, as UIKit's template rendering does: COLOR.rgb = tint.rgb and
// COLOR.a *= tint.a.
//
// The mask is two rounded rectangles in the coordinates of the item the picture is drawn on, which are pixels of the picture: the
// view's border box with its radii and the content frame with the radii less the border widths (image_effects_core.h). A corner is a
// quarter of an ellipse; its distance is the first-order bound k0 (k0 - 1) / k1 of Inigo Quilez, exact for a circle. The coverage of
// a pixel is a one-pixel ramp on the screen (fwidth), so the edge is anti-aliased whatever the scale.
const char *const shader_code = R"(shader_type canvas_item;

uniform float tinted = 0.0;
uniform vec4 tint = vec4(1.0);
uniform float clipped = 0.0;
uniform vec4 outer_rect = vec4(0.0);
uniform vec4 outer_rx = vec4(0.0);
uniform vec4 outer_ry = vec4(0.0);
uniform vec4 inner_rect = vec4(0.0);
uniform vec4 inner_rx = vec4(0.0);
uniform vec4 inner_ry = vec4(0.0);

varying vec2 picture_position;

void vertex() {
	picture_position = VERTEX;
}

float rounded_distance(vec2 point, vec4 rect, vec4 rx, vec4 ry) {
	vec2 half_size = rect.zw * 0.5;
	vec2 q = point - (rect.xy + half_size);
	vec2 r;
	if (q.x < 0.0) {
		r = q.y < 0.0 ? vec2(rx.x, ry.x) : vec2(rx.w, ry.w);
	} else {
		r = q.y < 0.0 ? vec2(rx.y, ry.y) : vec2(rx.z, ry.z);
	}
	vec2 k = abs(q) - (half_size - r);
	if (k.x <= 0.0 || k.y <= 0.0) {
		vec2 e = abs(q) - half_size;
		return max(e.x, e.y);
	}
	if (r.x <= 0.0 || r.y <= 0.0) {
		return length(k);
	}
	float k0 = length(k / r);
	float k1 = length(k / (r * r));
	return k0 * (k0 - 1.0) / k1;
}

void fragment() {
	if (tinted > 0.5) {
		COLOR = vec4(tint.rgb, COLOR.a * tint.a);
	}
	if (clipped > 0.5) {
		vec2 width = fwidth(picture_position);
		float pixel = max(max(width.x, width.y), 0.0001);
		float outer_cover = clamp(0.5 - rounded_distance(picture_position, outer_rect, outer_rx, outer_ry) / pixel, 0.0, 1.0);
		float inner_cover = clamp(0.5 - rounded_distance(picture_position, inner_rect, inner_rx, inner_ry) / pixel, 0.0, 1.0);
		COLOR.a *= min(outer_cover, inner_cover);
	}
}
)";

// A RID is a built-in type that calls into the engine as it is made, which a static cannot do before the extension is initialized.
std::unique_ptr<RID> shared_shader;
std::atomic<uint64_t> shaders_created{}, shaders_freed{}, items_created{}, items_freed{}, materials_created{}, materials_freed{};

RID shader() {
  if (!shared_shader) {
    auto *server = RenderingServer::get_singleton();
    shared_shader = std::make_unique<RID>(server->shader_create());
    server->shader_set_code(*shared_shader, shader_code);
    ++shaders_created;
  }
  return *shared_shader;
}

folly::dynamic rect_json(const img::Rect &rect) {
  return folly::dynamic::object("x", rect.x)("y", rect.y)("width", rect.width)("height", rect.height);
}
folly::dynamic array4(double a, double b, double c, double d) { return folly::dynamic::array(a, b, c, d); }
folly::dynamic rgba_json(const img::Rgba &color) { return folly::dynamic::array(color.r, color.g, color.b, color.a); }

// The four values of one side of a rounded rectangle's corners, in the order of the shader's vectors.
Vector4 horizontals(const img::Corners &c) {
  return Vector4(c.top_left.horizontal, c.top_right.horizontal, c.bottom_right.horizontal, c.bottom_left.horizontal);
}
Vector4 verticals(const img::Corners &c) {
  return Vector4(c.top_left.vertical, c.top_right.vertical, c.bottom_right.vertical, c.bottom_left.vertical);
}
Vector4 bounds(const img::Rect &r) { return Vector4(r.x, r.y, r.width, r.height); }
folly::dynamic vector_json(const Vector4 &v) { return array4(v.x, v.y, v.z, v.w); }
}  // namespace

PictureLayer::~PictureLayer() {
  auto *server = RenderingServer::get_singleton();
  if (!server) return;
  // The item first: a material that is freed while an item still uses it would be used after it was freed.
  if (item_.is_valid()) {
    server->free_rid(item_);
    ++items_freed;
  }
  if (material_.is_valid()) {
    server->free_rid(material_);
    ++materials_freed;
  }
}

void PictureLayer::ensure_item(const RID &parent) {
  if (item_.is_valid()) return;
  auto *server = RenderingServer::get_singleton();
  item_ = server->canvas_item_create();
  server->canvas_item_set_parent(item_, parent);
  // The view filters its picture trilinearly (GodotImage's constructor sets the node's filter, which a child item would otherwise
  // take from the project's default).
  server->canvas_item_set_default_texture_filter(item_, RenderingServer::CANVAS_ITEM_TEXTURE_FILTER_LINEAR);
  ++items_created;
}

void PictureLayer::set_material(const img::Painting &painting) {
  auto *server = RenderingServer::get_singleton();
  params_.clear();
  const bool shaded = painting.tint.has_value() || painting.clip.has_value();
  if (!shaded) {
    if (shaded_) server->canvas_item_set_material(item_, RID());
    shaded_ = false;
    return;
  }
  if (!material_.is_valid()) {
    material_ = server->material_create();
    server->material_set_shader(material_, shader());
    ++materials_created;
  }
  const auto set = [&](const char *name, const Variant &value, folly::dynamic shown) {
    server->material_set_param(material_, name, value);
    params_.emplace_back(name, std::move(shown));
  };
  set("tinted", painting.tint ? 1.0f : 0.0f, painting.tint ? 1.0 : 0.0);
  const img::Rgba tint = painting.tint.value_or(img::Rgba{1, 1, 1, 1});
  set("tint", Vector4(tint.r, tint.g, tint.b, tint.a), rgba_json(tint));
  set("clipped", painting.clip ? 1.0f : 0.0f, painting.clip ? 1.0 : 0.0);
  const auto set_shape = [&](const std::string &prefix, const img::RoundedRect &shape) {
    set((prefix + "_rect").c_str(), bounds(shape.rect), vector_json(bounds(shape.rect)));
    set((prefix + "_rx").c_str(), horizontals(shape.radii), vector_json(horizontals(shape.radii)));
    set((prefix + "_ry").c_str(), verticals(shape.radii), vector_json(verticals(shape.radii)));
  };
  set_shape("outer", painting.outer_px.value_or(img::RoundedRect{}));
  set_shape("inner", painting.inner_px.value_or(img::RoundedRect{}));
  server->canvas_item_set_material(item_, material_);
  shaded_ = true;
}

void PictureLayer::draw(const RID &parent, const RID &texture, const img::Painting &painting) {
  ensure_item(parent);
  auto *server = RenderingServer::get_singleton();
  server->canvas_item_clear(item_);
  const float unit = static_cast<float>(1.0 / painting.scale);
  server->canvas_item_set_transform(item_, Transform2D(0.0f, Vector2(unit, unit), 0.0f, Vector2()));
  set_material(painting);
  const Rect2 destination(painting.dst_px.x, painting.dst_px.y, painting.dst_px.width, painting.dst_px.height);
  commands_ = folly::dynamic::array();
  switch (painting.kind) {
    case img::PaintKind::Region: {
      const Rect2 source(painting.src_px.x, painting.src_px.y, painting.src_px.width, painting.src_px.height);
      server->canvas_item_add_texture_rect_region(item_, destination, texture, source);
      commands_.push_back(folly::dynamic::object("op", "textureRectRegion")("dst", rect_json(painting.dst_px))("src", rect_json(painting.src_px)));
      break;
    }
    case img::PaintKind::Tile:
      // The tiles are laid in pixels of the picture: one tile is the picture, at its size in points.
      server->canvas_item_add_texture_rect(item_, destination, texture, true);
      commands_.push_back(folly::dynamic::object("op", "textureRectTile")("dst", rect_json(painting.dst_px)));
      break;
    case img::PaintKind::NinePatch: {
      const auto &patch = *painting.patch;
      const auto axis = [](img::PatchMode mode) {
        return mode == img::PatchMode::Tile ? RenderingServer::NINE_PATCH_TILE : RenderingServer::NINE_PATCH_STRETCH;
      };
      server->canvas_item_add_nine_patch(item_, destination, Rect2(patch.src.x, patch.src.y, patch.src.width, patch.src.height), texture,
          Vector2(patch.margins.left, patch.margins.top), Vector2(patch.margins.right, patch.margins.bottom), axis(patch.x), axis(patch.y));
      commands_.push_back(folly::dynamic::object("op", "ninePatch")("dst", rect_json(patch.dst))("src", rect_json(patch.src))
          ("margins", folly::dynamic::object("left", patch.margins.left)("top", patch.margins.top)("right", patch.margins.right)("bottom", patch.margins.bottom))
          ("xMode", img::patch_mode_name(patch.x))("yMode", img::patch_mode_name(patch.y)));
      break;
    }
  }
}

void PictureLayer::clear() {
  if (item_.is_valid()) RenderingServer::get_singleton()->canvas_item_clear(item_);
  params_.clear();
  commands_ = folly::dynamic::array();
}

folly::dynamic PictureLayer::snapshot() const {
  folly::dynamic params = folly::dynamic::object();
  for (const auto &[name, value] : params_) params[name] = value;
  return folly::dynamic::object("item", item_.is_valid())("material", material_.is_valid())("shaded", shaded_)("params", std::move(params))
      ("commands", commands_);
}

folly::dynamic PictureLayer::counters() {
  return folly::dynamic::object("shadersCreated", shaders_created.load())("shadersFreed", shaders_freed.load())
      ("itemsCreated", items_created.load())("itemsFreed", items_freed.load())("materialsCreated", materials_created.load())
      ("materialsFreed", materials_freed.load());
}

void PictureLayer::release_shader() {
  if (!shared_shader) return;
  if (auto *server = RenderingServer::get_singleton()) {
    server->free_rid(*shared_shader);
    ++shaders_freed;
  }
  shared_shader.reset();
}

}  // namespace fabric_godot
