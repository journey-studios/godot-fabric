#pragma once
#include <godot_cpp/classes/font.hpp>
#include <godot_cpp/classes/text_paragraph.hpp>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>
#include <folly/dynamic.h>
#include <map>
#include <functional>

namespace fabric_godot {
namespace rn = facebook::react;
struct TextRun {
  int start{}, end{}, size{}, weight{};
  std::string family;
  godot::Color color;
  float line_height{};
  godot::Ref<godot::Font> font;
};
// y is the baseline inside the paragraph and top is where the row's line box
// starts (the box holds the ascender above the baseline, whatever lineHeight
// centres inside it); start/end are the code points the row covers, which tile
// the text without gaps (the sentinel is never inside them).
struct ParagraphLine {
  godot::RID rid;
  float x{}, y{}, height{}, width{}, ascent{};
  float top{};
  int start{}, end{};
};
struct PreparedParagraph {
  godot::Ref<godot::TextParagraph> paragraph;
  std::vector<TextRun> runs;
  std::vector<ParagraphLine> lines;
  godot::Vector2 size;
  std::string text;
  int total_lines{}, ellipses{};
  folly::dynamic snapshot() const;
  void draw(const godot::RID &canvas, godot::Vector2 origin) const;
};
// Fabric supplies immutable attributed strings, including inheritance and
// composite children. One shaper supplies both Yoga measurement and drawing.
class ParagraphLayout final : public rn::TextLayoutManager {
 public:
  ParagraphLayout(const std::shared_ptr<const rn::ContextContainer> &context,
                  godot::Ref<godot::Font> fallback, std::function<void(const std::string &)> report);
  rn::TextMeasurement measure(const rn::AttributedStringBox &text,
      const rn::ParagraphAttributes &props, const rn::TextLayoutContext &context,
      const rn::LayoutConstraints &constraints) const override;
  // The same shaped paragraph reported as RN's LineMeasurement rows. This is
  // what ParagraphShadowNode turns into onTextLayout and the Yoga baseline.
  rn::LinesMeasurements measureLines(const rn::AttributedStringBox &text,
      const rn::ParagraphAttributes &props, const rn::Size &size) const override;
  PreparedParagraph prepare(const rn::AttributedString &text,
      const rn::ParagraphAttributes &props, float width) const;
  int measurements() const { return measurements_; }
  int line_measurements() const { return line_measurements_; }
 private:
  godot::Ref<godot::Font> font(const rn::TextAttributes &attributes) const;
  godot::Ref<godot::Font> fallback_;
  std::function<void(const std::string &)> report_;
  mutable std::map<std::string, godot::Ref<godot::Font>> fonts_;
  mutable int measurements_{}, line_measurements_{};
};
}
