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
};
struct ParagraphLine {
  godot::RID rid;
  float x{}, y{}, height{}, width{}, ascent{};
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
  PreparedParagraph prepare(const rn::AttributedString &text,
      const rn::ParagraphAttributes &props, float width) const;
  int measurements() const { return measurements_; }
 private:
  godot::Ref<godot::Font> font(const rn::TextAttributes &attributes) const;
  godot::Ref<godot::Font> fallback_;
  std::function<void(const std::string &)> report_;
  mutable std::map<std::string, godot::Ref<godot::Font>> fonts_;
  mutable int measurements_{};
};
}
