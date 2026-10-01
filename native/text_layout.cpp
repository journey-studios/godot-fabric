#include "text_layout.h"
#include <godot_cpp/classes/text_paragraph.hpp>
#include <godot_cpp/classes/text_server.hpp>
#include <algorithm>
#include <cmath>

namespace fabric_godot {
facebook::react::Size TextLayout::measure(const std::string &text, float font_size,
    const facebook::react::LayoutConstraints &constraints) const {
  ++measurements_;
  godot::Ref<godot::TextParagraph> paragraph;
  paragraph.instantiate();
  auto flags = godot::TextServer::BREAK_MANDATORY | godot::TextServer::BREAK_WORD_BOUND |
      godot::TextServer::BREAK_ADAPTIVE | godot::TextServer::BREAK_TRIM_START_EDGE_SPACES |
      godot::TextServer::BREAK_TRIM_END_EDGE_SPACES;
  paragraph->set_break_flags(flags);
  // Label uses integral content widths; use the same break boundary here.
  paragraph->set_width(std::isfinite(constraints.maximumSize.width) ?
      std::max(1.0f, std::floor(constraints.maximumSize.width)) : -1);
  paragraph->add_string(godot::String::utf8(text.c_str()) + godot::String::chr(0x200B),
      font_, std::max(1, static_cast<int>(font_size)));
  auto size = paragraph->get_size();
  return constraints.clamp({static_cast<float>(std::ceil(size.x)),
      static_cast<float>(std::ceil(std::max(size.y, static_cast<godot::real_t>(
          font_->get_height(std::max(1, static_cast<int>(font_size)))))))});
}
} // namespace fabric_godot
