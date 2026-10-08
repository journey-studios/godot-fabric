#include "paragraph_layout.h"
#include <godot_cpp/classes/font_variation.hpp>
#include <godot_cpp/classes/rendering_server.hpp>
#include <godot_cpp/classes/resource_loader.hpp>
#include <godot_cpp/classes/text_server_manager.hpp>
#include <godot_cpp/variant/transform2d.hpp>
#include <react/renderer/attributedstring/conversions.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace fabric_godot {
using namespace godot;
namespace {
// How far the top of an italic glyph leans right, as a fraction of its height. It is the skew Android's Skia applies
// (-0.25) to a typeface that has no italic face, which is the case of every font this platform bundles.
constexpr float ITALIC_SKEW = 0.25f;
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
// The outline of one glyph at a font and size, in pixels with y down from the baseline (a glyph the font lacks has
// none): its top and bottom, where its leftmost point at each of them is and its advance. The skew of an italic font
// shows in how far the top sits from the bottom.
struct Outline {
  float top{}, bottom{}, top_x{}, bottom_x{}, advance{};
};
Outline outline_of(const Ref<Font> &font, int size, char32_t glyph) {
  Outline out;
  if (font.is_null()) {
    return out;
  }
  const auto rids = font->get_rids();
  if (rids.is_empty()) {
    return out;
  }
  const RID rid = rids[0];
  const auto ts = server();
  const int64_t index = ts->font_get_glyph_index(rid, size, glyph, 0);
  if (index == 0) {
    return out;
  }
  const PackedVector3Array points = ts->font_get_glyph_contours(rid, size, index)["points"];
  if (points.is_empty()) {
    return out;
  }
  out.top = out.bottom = points[0].y;
  for (int i = 1; i < points.size(); ++i) {
    out.top = std::min(out.top, static_cast<float>(points[i].y));
    out.bottom = std::max(out.bottom, static_cast<float>(points[i].y));
  }
  out.top_x = out.bottom_x = std::numeric_limits<float>::infinity();
  for (int i = 0; i < points.size(); ++i) {
    if (points[i].y == out.top) {
      out.top_x = std::min(out.top_x, static_cast<float>(points[i].x));
    }
    if (points[i].y == out.bottom) {
      out.bottom_x = std::min(out.bottom_x, static_cast<float>(points[i].x));
    }
  }
  out.advance = ts->font_get_glyph_advance(rid, size, index).x;
  return out;
}
// Android's FontMetricsUtil reads capHeight and xHeight from the height of the
// ink bounds of "T" and "x" at the line's font and size. The outline of the glyph
// gives the same bounds, in pixels at that size.
float ink_height(const Ref<Font> &font, int size, char32_t glyph) {
  const Outline outline = outline_of(font, size, glyph);
  return outline.bottom - outline.top;
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
// A glyph a row paints: where its pen is on the row, the glyph to draw and the run whose style it takes.
struct PaintedGlyph {
  RID font;
  int size{};
  int64_t index{};
  Vector2 offset;
  float x{}, advance{};
  size_t run{};
  bool ellipsis{};
};
// The glyphs a row paints, in painting order: its text up to where it was trimmed, then the glyphs of the ellipsis.
// The ellipsis takes the run of the last glyph painted before it (the row's first run when none is): RN's span covers
// the truncated text, so its color and its decoration go on under the ellipsis. The positions are the paragraph's.
std::vector<PaintedGlyph> painted_glyphs(const ParagraphLine &line, const std::vector<TextRun> &runs) {
  auto ts = server();
  std::vector<PaintedGlyph> out;
  float pen = line.x;
  size_t run = run_index_at(runs, line.start);
  const auto paint = [&](const TypedArray<Dictionary> &glyphs, int trim, bool ellipsis) {
    for (int i = 0; i < glyphs.size() && (trim < 0 || i < trim); ++i) {
      Dictionary glyph = glyphs[i];
      if (!ellipsis) {
        run = run_index_at(runs, glyph["start"]);
      }
      const int repeat = glyph["repeat"];
      for (int j = 0; j < repeat; ++j) {
        const float advance = static_cast<float>(static_cast<double>(glyph["advance"]));
        out.push_back({glyph["font_rid"], glyph["font_size"], glyph["index"], glyph["offset"], pen, advance, run, ellipsis});
        pen += advance;
      }
    }
  };
  paint(ts->shaped_text_get_glyphs(line.rid), ts->shaped_text_get_trim_pos(line.rid), false);
  paint(ts->shaped_text_get_ellipsis_glyphs(line.rid), -1, true);
  return out;
}
// Consecutive painted glyphs of one run, from where the first starts to where the last ends on the row. A decoration
// runs on under the ellipsis, which belongs to the run before it; the report of what is painted splits there, to say
// which run the ellipsis took.
struct PaintedGroup {
  size_t run{};
  bool ellipsis{};
  float x0{}, x1{};
};
std::vector<PaintedGroup> painted_groups(const std::vector<PaintedGlyph> &glyphs, bool split_ellipsis) {
  std::vector<PaintedGroup> groups;
  for (const auto &glyph : glyphs) {
    if (!groups.empty() && groups.back().run == glyph.run && (!split_ellipsis || groups.back().ellipsis == glyph.ellipsis)) {
      groups.back().x1 = glyph.x + glyph.advance;
    } else {
      groups.push_back({glyph.run, glyph.ellipsis, glyph.x, glyph.x + glyph.advance});
    }
  }
  return groups;
}
// What a fragment paints besides its font. Opacity multiplies the text and the decoration alike, and a decoration that
// sets no color takes the text's.
TextRun make_run(int start, int end, const rn::TextAttributes &a, const Ref<Font> &font, float opacity) {
  auto ink = a.foregroundColor ? color(a.foregroundColor) : Color(1, 1, 1, 1);
  auto decoration = a.textDecorationColor ? color(a.textDecorationColor) : ink;
  ink.a *= opacity;
  decoration.a *= opacity;
  const auto line = a.textDecorationLineType.value_or(rn::TextDecorationLineType::None);
  const bool both = line == rn::TextDecorationLineType::UnderlineStrikethrough;
  return {start, end, font_size(a), static_cast<int>(a.fontWeight.value_or(rn::FontWeight::Regular)), a.fontFamily,
      ink, std::isfinite(a.lineHeight) ? a.lineHeight : 0, font, a.fontStyle == rn::FontStyle::Italic,
      line == rn::TextDecorationLineType::Underline || both,
      line == rn::TextDecorationLineType::Strikethrough || both, decoration};
}
// The facade rejects these before they reach the host. A paragraph built without it (RN's NativeText imported
// directly) must not get a silent substitute either: oblique would be drawn upright and a dotted or wavy line solid.
// The value is named by RN's own toString, with the words of the facade's errors.
void refuse_unsupported_style(const rn::TextAttributes &a) {
  if (a.fontStyle == rn::FontStyle::Oblique) {
    throw std::runtime_error("Godot Text does not implement style fontStyle " + rn::toString(*a.fontStyle) +
        ": use normal or italic");
  }
  if (a.textDecorationStyle.has_value() && *a.textDecorationStyle != rn::TextDecorationStyle::Solid) {
    throw std::runtime_error("Godot Text does not implement style textDecorationStyle " +
        rn::toString(*a.textDecorationStyle) + ": only solid");
  }
}
}
ParagraphLayout::ParagraphLayout(const std::shared_ptr<const rn::ContextContainer> &context,
    Ref<Font> fallback, std::function<void(const std::string &)> report)
    : rn::TextLayoutManager(context), fallback_(std::move(fallback)), report_(std::move(report)) {}
Ref<Font> ParagraphLayout::font(const rn::TextAttributes &a) const {
  const int weight = static_cast<int>(a.fontWeight.value_or(rn::FontWeight::Regular));
  // The bundled fonts have no italic face, so italic is the same font slanted (see ITALIC_SKEW): it never takes the
  // shortcut to the fallback font, which is not a variation.
  const bool italic = a.fontStyle == rn::FontStyle::Italic;
  auto family = a.fontFamily;
  if (family.empty() && weight == 400 && !std::isfinite(a.letterSpacing) && !italic) return fallback_;
  if (family.empty()) family = "NotoSans";
  const auto key = family + ":" + std::to_string(weight) + ":" + std::to_string(a.letterSpacing) + (italic ? ":italic" : "");
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
  if (italic) {
    variation->set_variation_transform(Transform2D(Vector2(1, ITALIC_SKEW), Vector2(0, 1), Vector2()));
  }
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
    refuse_unsupported_style(a);
    last_attributes = a;
    auto content = String::utf8(fragment.string.c_str());
    last_font = font(a);
    out.runs.push_back(make_run(offset, offset + static_cast<int>(content.length()), a, last_font,
        std::isfinite(a.opacity) ? a.opacity : 1.0f));
    offset += content.length();
    out.text += fragment.string;
    out.paragraph->add_string(content, last_font, font_size(a));
  }
  if (out.runs.empty()) {
    const auto &a = text.getBaseTextAttributes();
    refuse_unsupported_style(a);
    last_font = font(a);
    out.runs.push_back(make_run(0, 0, a, last_font, 1.0f));
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
std::vector<DecorationSegment> PreparedParagraph::decoration_segments() const {
  std::vector<DecorationSegment> segments;
  for (size_t row = 0; row < lines.size(); ++row) {
    const auto &line = lines[row];
    // One segment per run on a row: from where its first painted glyph starts to where its last one ends.
    for (const auto &group : painted_groups(painted_glyphs(line, runs), false)) {
      const auto &run = runs[group.run];
      // A group without width (the sentinel, a trimmed space) has nothing to draw a line under.
      if (group.x1 <= group.x0 || !(run.underline || run.strikethrough)) {
        continue;
      }
      // Godot's metrics, as RichTextLabel reads them: the underline sits at the font's underline position below
      // the baseline, the strike-through in the middle of the run's ascent and descent. Both are as thick as the
      // underline, at least one pixel.
      const float thickness = std::max(1.0f, run.font->get_underline_thickness(run.size));
      const auto add = [&](bool strikethrough, float y) {
        segments.push_back({static_cast<int>(row), static_cast<int>(group.run), strikethrough, group.x0, group.x1, y,
            thickness, run.decoration_color});
      };
      if (run.underline) {
        add(false, line.y + run.font->get_underline_position(run.size));
      }
      if (run.strikethrough) {
        const float ascent = run.font->get_ascent(run.size), descent = run.font->get_descent(run.size);
        add(true, line.y - ascent + (ascent + descent) / 2);
      }
    }
  }
  return segments;
}
void PreparedParagraph::draw(const RID &canvas, Vector2 origin) const {
  auto ts = server();
  for (const auto &line : lines) {
    for (const auto &glyph : painted_glyphs(line, runs)) {
      if (glyph.font.is_valid()) {
        ts->font_draw_glyph(glyph.font, canvas, glyph.size, origin + Vector2(glyph.x, line.y) + glyph.offset,
            glyph.index, runs[glyph.run].color);
      }
    }
  }
  auto *rendering = RenderingServer::get_singleton();
  for (const auto &segment : decoration_segments()) {
    rendering->canvas_item_add_rect(canvas, Rect2(origin.x + segment.x0, origin.y + segment.y - segment.thickness / 2,
        segment.x1 - segment.x0, segment.thickness), segment.color);
  }
}
folly::dynamic PreparedParagraph::snapshot() const {
  auto spans = folly::dynamic::array(), metrics = folly::dynamic::array(), decorations = folly::dynamic::array(),
      painted = folly::dynamic::array();
  for (const auto &run : runs) {
    // The outline of "I" in the font the run paints with: how far its top leans from its bottom is the skew.
    const Outline outline = outline_of(run.font, run.size, U'I');
    const char *line = run.underline && run.strikethrough ? "underline line-through" :
        run.underline ? "underline" : run.strikethrough ? "line-through" : "none";
    spans.push_back(folly::dynamic::object("start", run.start)("end", run.end)
        ("fontSize", run.size)("fontWeight", run.weight)("fontFamily", run.family)
        ("color", run.color.to_html(true).utf8().get_data())("lineHeight", run.line_height)
        ("fontStyle", run.italic ? "italic" : "normal")("syntheticItalic", run.italic)
        ("textDecorationLine", line)("textDecorationColor", run.decoration_color.to_html(true).utf8().get_data())
        ("glyphI", folly::dynamic::object("top", outline.top)("bottom", outline.bottom)("topX", outline.top_x)
            ("bottomX", outline.bottom_x)("advance", outline.advance)));
  }
  for (const auto &line : lines) metrics.push_back(folly::dynamic::object("x", line.x)("baseline", line.y)
      ("height", line.height)("width", line.width)("ascent", line.ascent));
  for (const auto &segment : decoration_segments()) decorations.push_back(folly::dynamic::object("line", segment.line)
      ("run", segment.run)("kind", segment.strikethrough ? "line-through" : "underline")("x0", segment.x0)
      ("x1", segment.x1)("y", segment.y)("thickness", segment.thickness)
      ("color", segment.color.to_html(true).utf8().get_data()));
  // What each row paints: the runs of its glyphs in order, and the run the ellipsis took.
  for (size_t row = 0; row < lines.size(); ++row) {
    for (const auto &group : painted_groups(painted_glyphs(lines[row], runs), true)) {
      painted.push_back(folly::dynamic::object("line", row)("run", group.run)("ellipsis", group.ellipsis)
          ("x0", group.x0)("x1", group.x1));
    }
  }
  return folly::dynamic::object("nativeText", text)("lines", total_lines)("visibleLines", lines.size())
      ("measuredWidth", size.x)("measuredHeight", size.y)("ellipses", ellipses)
      ("runs", std::move(spans))("lineMetrics", std::move(metrics))("decorations", std::move(decorations))
      ("painted", std::move(painted));
}
}
