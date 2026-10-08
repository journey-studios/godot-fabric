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
// The run a code-point position falls in; a position past the last run belongs to the last one.
size_t run_index_at(const std::vector<TextRun> &runs, int position) {
  for (size_t index = 0; index < runs.size(); ++index) if (position < runs[index].end) return index;
  return runs.size() - 1;
}
const TextRun &run_at(const std::vector<TextRun> &runs, int position) {
  return runs[run_index_at(runs, position)];
}
// Android's FontMetricsUtil reads capHeight and xHeight from the height of the
// ink bounds of "T" and "x" at the line's font and size. The outline of the glyph
// gives the same bounds, in pixels at that size (a glyph the font lacks has none).
float ink_height(const Ref<Font> &font, int size, char32_t glyph) {
  if (font.is_null()) {
    return 0;
  }
  const auto rids = font->get_rids();
  if (rids.is_empty()) {
    return 0;
  }
  const RID rid = rids[0];
  const auto ts = server();
  const int64_t index = ts->font_get_glyph_index(rid, size, glyph, 0);
  if (index == 0) {
    return 0;
  }
  const PackedVector3Array points = ts->font_get_glyph_contours(rid, size, index)["points"];
  if (points.is_empty()) {
    return 0;
  }
  float lowest = points[0].y, highest = points[0].y;
  for (int i = 1; i < points.size(); ++i) {
    lowest = std::min(lowest, static_cast<float>(points[i].y));
    highest = std::max(highest, static_cast<float>(points[i].y));
  }
  return highest - lowest;
}
// RN's LineMeasurement rows of a paragraph the host has already shaped: the rows are the ones
// measure sized and the painter draws, so no second line breaker exists. The row's top and its
// baseline give the ascender (the centred lineHeight offset included); start and end tile the text.
rn::LinesMeasurements lines_of(const PreparedParagraph &prepared) {
  const String full = String::utf8(prepared.text.c_str());
  rn::LinesMeasurements lines;
  lines.reserve(prepared.lines.size());
  // capHeight and xHeight belong to a run's font and size: each run is measured once.
  std::vector<std::pair<float, float>> ink(prepared.runs.size(), {-1.0f, -1.0f});
  for (const auto &line : prepared.lines) {
    // iOS reads the font of the row's first character.
    const size_t index = run_index_at(prepared.runs, line.start);
    const auto &run = prepared.runs[index];
    auto &measured = ink[index];
    if (measured.first < 0) {
      measured = {ink_height(run.font, run.size, U'T'), ink_height(run.font, run.size, U'x')};
    }
    const float ascender = line.y - line.top;
    lines.emplace_back(std::string(full.substr(line.start, line.end - line.start).utf8().get_data()),
        rn::Rect{{line.x, line.top}, {line.width, line.height}}, line.height - ascender,
        measured.first, ascender, measured.second);
  }
  return lines;
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
  // The facade rejects these before they reach the host. A paragraph built without it (RN's NativeText imported
  // directly) must not get a silent substitute either: head and middle would be drawn as a plain character trim,
  // and a fit to the box would be ignored. The callers (measure, measureLines, apply) report the failure.
  if (props.ellipsizeMode == rn::EllipsizeMode::Head || props.ellipsizeMode == rn::EllipsizeMode::Middle)
    throw std::runtime_error("Godot Text supports tail or clip ellipsizeMode");
  if (props.adjustsFontSizeToFit)
    throw std::runtime_error("Godot Text does not implement adjustsFontSizeToFit");
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
        std::isfinite(a.lineHeight) ? a.lineHeight : 0, last_font});
    offset += content.length();
    out.text += fragment.string;
    out.paragraph->add_string(content, last_font, font_size(a));
  }
  if (out.runs.empty()) {
    const auto &a = text.getBaseTextAttributes();
    last_font = font(a);
    out.runs.push_back({0, 0, font_size(a), static_cast<int>(a.fontWeight.value_or(rn::FontWeight::Regular)), a.fontFamily,
        a.foregroundColor ? color(a.foregroundColor) : Color(1, 1, 1, 1),
        std::isfinite(a.lineHeight) ? a.lineHeight : 0, last_font});
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
    // Rows tile the text: each one runs to where the next starts (the break
    // characters and the spaces trimmed at a wrap belong to the row they end),
    // and the last one to the end of the text, before the sentinel.
    const int start = i == 0 ? 0 : std::min<int>(range.x, offset);
    const int next = i + 1 < out.total_lines ? std::min<int>(out.paragraph->get_line_range(i + 1).x, offset) : offset;
    out.lines.push_back({rid, x, y + (height - natural) / 2 + ascent, height, line_width, ascent,
        y, start, std::max(start, next)});
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
rn::LinesMeasurements ParagraphLayout::measureLines(const rn::AttributedStringBox &text,
    const rn::ParagraphAttributes &props, const rn::Size &size) const {
  ++line_measurements_;
  // ParagraphShadowNode reaches this from layout and from Yoga's baseline
  // callback, which is a C function pointer: nothing may unwind through it. A
  // paragraph that cannot be laid out reports its error, like measure does, and
  // yields no rows (a zero baseline and an empty onTextLayout).
  try {
    return lines_of(prepare(text.getValue(), props, size.width));
  } catch (const std::exception &error) {
    report_(error.what());
    return {};
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
