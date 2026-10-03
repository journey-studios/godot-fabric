#include "paragraph_layout.h"
#include <godot_cpp/classes/font_variation.hpp>
#include <godot_cpp/classes/resource_loader.hpp>
#include <godot_cpp/classes/text_server_manager.hpp>
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace fabric_godot {
using namespace godot;
namespace {
Ref<TextServer> server() { return TextServerManager::get_singleton()->get_primary_interface(); }
Color color(rn::SharedColor value) {
  auto c = rn::colorComponentsFromColor(value);
  return {c.red, c.green, c.blue, c.alpha};
}
int font_size(const rn::TextAttributes &a) {
  return std::max(1, static_cast<int>(std::lround(std::isfinite(a.fontSize) ? a.fontSize : 18)));
}
const TextRun &run_at(const std::vector<TextRun> &runs, int position) {
  for (const auto &run : runs) if (position < run.end) return run;
  return runs.back();
}
void draw_glyphs(const TypedArray<Dictionary> &glyphs, RID canvas,
    Vector2 &pen, const std::vector<TextRun> &runs, int trim = -1) {
  auto ts = server();
  for (int i = 0; i < glyphs.size() && (trim < 0 || i < trim); ++i) {
    Dictionary glyph = glyphs[i];
    const auto &run = run_at(runs, glyph["start"]);
    const int repeat = glyph["repeat"];
    for (int j = 0; j < repeat; ++j) {
      RID font = glyph["font_rid"];
      if (font.is_valid()) ts->font_draw_glyph(font, canvas, glyph["font_size"],
          pen + static_cast<Vector2>(glyph["offset"]), glyph["index"], run.color);
      pen.x += static_cast<double>(glyph["advance"]);
    }
  }
}
}
ParagraphLayout::ParagraphLayout(const std::shared_ptr<const rn::ContextContainer> &context,
    Ref<Font> fallback, std::function<void(const std::string &)> report)
    : rn::TextLayoutManager(context), fallback_(std::move(fallback)), report_(std::move(report)) {}
Ref<Font> ParagraphLayout::font(const rn::TextAttributes &a) const {
  const int weight = static_cast<int>(a.fontWeight.value_or(rn::FontWeight::Regular));
  auto family = a.fontFamily;
  if (family.empty() && weight == 400 && !std::isfinite(a.letterSpacing)) return fallback_;
  if (family.empty()) family = "NotoSans";
  const auto key = family + ":" + std::to_string(weight) + ":" + std::to_string(a.letterSpacing);
  if (auto it = fonts_.find(key); it != fonts_.end()) return it->second;
  if (family != "NotoSans" && family != "JetBrainsMono")
    throw std::runtime_error("Godot font family is not registered: " + family);
  const auto filename = String::utf8(family.c_str()) + ".ttf";
  const auto addon_font = String("res://addons/godot_fabric/assets/fonts/") + filename;
  Ref<Font> base = ResourceLoader::get_singleton()->load(
      ResourceLoader::get_singleton()->exists(addon_font) ? addon_font : String("res://assets/fonts/") + filename);
  if (base.is_null()) throw std::runtime_error("Godot font asset is unavailable: " + family);
  Ref<FontVariation> variation;
  variation.instantiate();
  variation->set_base_font(base);
  Dictionary axes;
  axes[server()->name_to_tag("wght")] = weight;
  variation->set_variation_opentype(axes);
  if (std::isfinite(a.letterSpacing))
    variation->set_spacing(TextServer::SPACING_GLYPH, std::lround(a.letterSpacing));
  fonts_[key] = variation;
  return variation;
}
PreparedParagraph ParagraphLayout::prepare(const rn::AttributedString &text,
    const rn::ParagraphAttributes &props, float width) const {
  PreparedParagraph out;
  out.paragraph.instantiate();
  out.paragraph->set_width(std::isfinite(width) ? std::max(1.0f, std::floor(width)) : -1);
  out.paragraph->set_break_flags(TextServer::BREAK_MANDATORY | TextServer::BREAK_WORD_BOUND |
      TextServer::BREAK_ADAPTIVE | TextServer::BREAK_TRIM_START_EDGE_SPACES | TextServer::BREAK_TRIM_END_EDGE_SPACES);
  out.paragraph->set_max_lines_visible(props.maximumNumberOfLines > 0 && props.ellipsizeMode == rn::EllipsizeMode::Tail ?
      props.maximumNumberOfLines : -1);
  out.paragraph->set_text_overrun_behavior(props.ellipsizeMode == rn::EllipsizeMode::Tail ?
      TextServer::OVERRUN_TRIM_ELLIPSIS : TextServer::OVERRUN_TRIM_CHAR);
  Ref<Font> last_font = fallback_;
  auto last_attributes = text.getBaseTextAttributes();
  int offset = 0;
  for (const auto &fragment : text.getFragments()) {
    if (fragment.isAttachment()) throw std::runtime_error("Inline Controls are not implemented in Godot Text");
    const auto &a = fragment.textAttributes;
    last_attributes = a;
    auto content = String::utf8(fragment.string.c_str());
    last_font = font(a);
    auto ink = a.foregroundColor ? color(a.foregroundColor) : Color(1, 1, 1, 1);
    if (std::isfinite(a.opacity)) ink.a *= a.opacity;
    out.runs.push_back({offset, offset + static_cast<int>(content.length()), font_size(a),
        static_cast<int>(a.fontWeight.value_or(rn::FontWeight::Regular)), a.fontFamily, ink,
        std::isfinite(a.lineHeight) ? a.lineHeight : 0});
    offset += content.length();
    out.text += fragment.string;
    out.paragraph->add_string(content, last_font, font_size(a));
  }
  if (out.runs.empty()) {
    const auto &a = text.getBaseTextAttributes();
    last_font = font(a);
    out.runs.push_back({0, 0, font_size(a), static_cast<int>(a.fontWeight.value_or(rn::FontWeight::Regular)), a.fontFamily,
        a.foregroundColor ? color(a.foregroundColor) : Color(1, 1, 1, 1),
        std::isfinite(a.lineHeight) ? a.lineHeight : 0});
  }
  // The sentinel retains empty/trailing-newline rows without adding spacing.
  last_attributes.letterSpacing = std::numeric_limits<float>::quiet_NaN();
  out.paragraph->add_string(String::chr(0x200B), font(last_attributes), out.runs.back().size);
  out.total_lines = out.paragraph->get_line_count();
  const int count = props.maximumNumberOfLines > 0 ?
      std::min(out.total_lines, props.maximumNumberOfLines) : out.total_lines;
  auto alignment = text.getBaseTextAttributes().alignment.value_or(rn::TextAlignment::Left);
  float y = 0, widest = 0;
  for (int i = 0; i < count; ++i) {
    auto range = out.paragraph->get_line_range(i);
    const float ascent = out.paragraph->get_line_ascent(i);
    const float natural = ascent + out.paragraph->get_line_descent(i);
    float explicit_height = 0;
    for (const auto &run : out.runs) {
      const bool overlaps = run.start < range.y && run.end > range.x;
      const bool terminal_sentinel = range.x == offset && run.end == offset &&
          &run == &out.runs.back();
      if (overlaps || terminal_sentinel)
        explicit_height = std::max(explicit_height, run.line_height);
    }
    const float height = explicit_height > 0 ? explicit_height : natural;
    const float line_width = out.paragraph->get_line_width(i);
    float x = 0;
    if (std::isfinite(width)) {
      if (alignment == rn::TextAlignment::Center) x = (width - line_width) / 2;
      if (alignment == rn::TextAlignment::Right) x = width - line_width;
    }
    auto rid = out.paragraph->get_line_rid(i);
    if (server()->shaped_text_get_ellipsis_pos(rid) >= 0) ++out.ellipses;
    out.lines.push_back({rid, x, y + (height - natural) / 2 + ascent, height, line_width, ascent});
    y += height;
    widest = std::max(widest, line_width);
  }
  out.size = Vector2(std::ceil(widest), std::ceil(y));
  return out;
}
rn::TextMeasurement ParagraphLayout::measure(const rn::AttributedStringBox &text,
    const rn::ParagraphAttributes &props, const rn::TextLayoutContext &,
    const rn::LayoutConstraints &constraints) const {
  ++measurements_;
  // Yoga invokes measure through a noexcept callback. Report a host failure
  // without allowing a native exception to terminate the Godot process.
  try {
    auto result = prepare(text.getValue(), props, constraints.maximumSize.width);
    return {constraints.clamp({static_cast<float>(result.size.x), static_cast<float>(result.size.y)}), {}};
  } catch (const std::exception &error) {
    report_(error.what());
    rn::TextMeasurement rejected{constraints.minimumSize, {}};
    // Upstream ParagraphShadowNode indexes one measurement per attachment
    // even on a failed layout. Keep that structural contract while hiding them.
    for (const auto &fragment : text.getValue().getFragments())
      if (fragment.isAttachment()) rejected.attachments.push_back({{}, true});
    return rejected;
  }
}
void PreparedParagraph::draw(const RID &canvas, Vector2 origin) const {
  auto ts = server();
  for (const auto &line : lines) {
    Vector2 pen = origin + Vector2(line.x, line.y);
    draw_glyphs(ts->shaped_text_get_glyphs(line.rid), canvas, pen, runs,
        ts->shaped_text_get_trim_pos(line.rid));
    draw_glyphs(ts->shaped_text_get_ellipsis_glyphs(line.rid), canvas, pen, runs);
  }
}
folly::dynamic PreparedParagraph::snapshot() const {
  auto spans = folly::dynamic::array(), metrics = folly::dynamic::array();
  for (const auto &run : runs) spans.push_back(folly::dynamic::object("start", run.start)("end", run.end)
      ("fontSize", run.size)("fontWeight", run.weight)("fontFamily", run.family)
      ("color", run.color.to_html(true).utf8().get_data())("lineHeight", run.line_height));
  for (const auto &line : lines) metrics.push_back(folly::dynamic::object("x", line.x)("baseline", line.y)
      ("height", line.height)("width", line.width)("ascent", line.ascent));
  return folly::dynamic::object("nativeText", text)("lines", total_lines)("visibleLines", lines.size())
      ("measuredWidth", size.x)("measuredHeight", size.y)("ellipses", ellipses)
      ("runs", std::move(spans))("lineMetrics", std::move(metrics));
}
}
