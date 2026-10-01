#include "svg_node.h"
#include <godot_cpp/classes/image.hpp>
#include <godot_cpp/classes/font_variation.hpp>
#include <folly/json.h>
#include <cmath>
#include <chrono>
#include <algorithm>
#include <stdexcept>

using namespace godot;
namespace {
String gd(const std::string &s) { return String::utf8(s.c_str()); }
std::string escaped(const std::string &s) { return gd(s).xml_escape(true).utf8().get_data(); }
std::string attr(const folly::dynamic &p, const char *key, const char *fallback = "") {
  const auto &a = p["attrs"];
  return a.count(key) ? a[key].asString() : fallback;
}
double number(const folly::dynamic &p, const char *key, const char *fallback = "0") {
  return std::stod(attr(p, key, fallback));
}
std::string opening(const folly::dynamic &p) {
  std::string out = "<" + p["tag"].asString();
  for (const auto &item : p["attrs"].items())
    out += " " + item.first.asString() + "=\"" + escaped(item.second.asString()) + "\"";
  return out + ">";
}
}
void GodotSvgNode::set_payload(const std::string &json) {
  auto parsed = folly::parseJson(json);
  if (!payload_.isNull() && payload_["tag"] != parsed["tag"])
    throw std::runtime_error("A mounted SVG primitive cannot change tag; use a different React key");
  payload_ = std::move(parsed);
}
bool GodotSvgNode::is_surface() const { return !payload_.isNull() && payload_["tag"] == "svg"; }
std::string GodotSvgNode::markup(bool include_text) const {
  if (payload_.isNull()) return "";
  const auto tag = payload_["tag"].asString();
  if (!include_text && tag == "text") return "";
  auto out = opening(payload_);
  if (tag == "text") out += escaped(payload_["text"].asString());
  for (int i = 0; i < get_child_count(); ++i)
    if (auto *child = Object::cast_to<GodotSvgNode>(get_child(i))) out += child->markup(include_text);
  return out + "</" + tag + ">";
}
void GodotSvgNode::collect_definitions(std::string &out) const {
  if (payload_["tag"] == "defs") { out += markup(false); return; }
  for (int i = 0; i < get_child_count(); ++i)
    if (auto *child = Object::cast_to<GodotSvgNode>(get_child(i))) child->collect_definitions(out);
}
void GodotSvgNode::flush(std::string &segment, std::vector<Paint> &paints,
    const std::string &defs, int &pixels, uint64_t &hash) const {
  if (segment.empty()) return;
  Ref<Image> image;
  image.instantiate();
  const auto size = get_size();
  const auto xml = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" +
      std::to_string(size.x) + "\" height=\"" + std::to_string(size.y) + "\">" + defs + segment + "</svg>";
  if (image->load_svg_from_string(gd(xml)) != OK || image->is_empty())
    throw std::runtime_error("Godot could not rasterize committed SVG");
  image->convert(Image::FORMAT_RGBA8);
  const auto bytes = image->get_data();
  for (int64_t i = 0; i < bytes.size(); ++i) {
    hash = (hash ^ bytes[i]) * 1099511628211ULL;
    if (i % 4 == 3 && bytes[i]) ++pixels;
  }
  Paint paint;
  paint.texture = ImageTexture::create_from_image(image);
  paints.push_back(std::move(paint));
  segment.clear();
}
void GodotSvgNode::collect_paint(std::string &segment, std::vector<Paint> &paints,
    const Ref<Font> &font, const std::string &defs, int &pixels, int &texts, uint64_t &hash) const {
  const auto tag = payload_["tag"].asString();
  if (tag == "defs") return;
  if (tag == "text") {
    // Segment boundaries retain SVG paint order around native shaped text.
    // Groups are attribute-free in this explicit subset.
    const GodotSvgNode *root = this;
    while (auto *parent = Object::cast_to<GodotSvgNode>(root->get_parent())) root = parent;
    root->flush(segment, paints, defs, pixels, hash);
    Paint paint;
    paint.font = font;
    if (attr(payload_, "font-weight") == "600") {
      Ref<FontVariation> semibold;
      semibold.instantiate();
      semibold->set_base_font(font);
      semibold->set_variation_embolden(0.25);
      paint.font = semibold;
    }
    paint.text = gd(payload_["text"].asString());
    paint.font_size = static_cast<int>(number(payload_, "font-size", "12"));
    paint.baseline = Vector2(number(payload_, "x"), number(payload_, "y"));
    const double width = paint.font->get_string_size(paint.text, HORIZONTAL_ALIGNMENT_LEFT, -1, paint.font_size).x;
    const auto anchor = attr(payload_, "text-anchor", "start");
    if (anchor == "middle") paint.baseline.x -= width / 2;
    if (anchor == "end") paint.baseline.x -= width;
    paint.color = Color::from_string(gd(attr(payload_, "fill", "#000000")), Color(0, 0, 0));
    paint.color.a *= number(payload_, "opacity", "1") * number(payload_, "fill-opacity", "1");
    paints.push_back(std::move(paint));
    ++texts;
    return;
  }
  if (tag != "svg" && tag != "g") { segment += markup(false); return; }
  for (int i = 0; i < get_child_count(); ++i)
    if (auto *child = Object::cast_to<GodotSvgNode>(get_child(i))) child->collect_paint(segment, paints, font, defs, pixels, texts, hash);
}
void GodotSvgNode::refresh(const Ref<Font> &font) {
  if (!is_surface()) return;
  const auto size = get_size();
  if (!std::isfinite(size.x) || !std::isfinite(size.y) || size.x <= 0 || size.y <= 0 || size.x > 2048 || size.y > 2048)
    throw std::runtime_error("Godot SVG raster size exceeds the 2048 pixel surface budget");
  const auto xml = markup(true);
  const auto key = std::to_string(size.x) + ":" + std::to_string(size.y) + xml;
  if (key == fingerprint_) return;
  const auto start = std::chrono::steady_clock::now();
  std::vector<Paint> next;
  std::string defs, segment;
  int pixels = 0, texts = 0;
  uint64_t hash = 14695981039346656037ULL;
  collect_definitions(defs);
  collect_paint(segment, next, font, defs, pixels, texts, hash);
  flush(segment, next, defs, pixels, hash);
  paints_ = std::move(next);
  document_ = xml;
  fingerprint_ = key;
  painted_pixels_ = pixels;
  raster_hash_ = hash;
  text_count_ = texts;
  raster_layers_ = 0;
  for (const auto &paint : paints_) if (paint.texture.is_valid()) ++raster_layers_;
  last_raster_ms_ = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
  total_raster_ms_ += last_raster_ms_;
  peak_raster_ms_ = std::max(peak_raster_ms_, last_raster_ms_);
  ++renders_;
  queue_redraw();
}
void GodotSvgNode::_draw() {
  for (const auto &paint : paints_) {
    if (paint.texture.is_valid()) draw_texture(paint.texture, Vector2());
    else paint.font->draw_string(get_canvas_item(), paint.baseline, paint.text,
        HORIZONTAL_ALIGNMENT_LEFT, -1, paint.font_size, paint.color);
  }
}
folly::dynamic GodotSvgNode::snapshot() const {
  return folly::dynamic::object("tag", payload_["tag"])("attributes", payload_["attrs"])
      ("text", payload_["text"])("renders", renders_)("rasterLayers", raster_layers_)
      ("textCount", text_count_)("paintedPixels", painted_pixels_)("document", document_)("rasterHash", std::to_string(raster_hash_))
      ("lastRasterMs", last_raster_ms_)("totalRasterMs", total_raster_ms_)("peakRasterMs", peak_raster_ms_);
}
