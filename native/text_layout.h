#pragma once
#include <godot_cpp/classes/font.hpp>
#include <react/renderer/core/LayoutConstraints.h>
#include <string>

namespace fabric_godot {
// Resources used by speculative Yoga measurement; never allocates Controls.
// All calls use the Godot main thread, like the Hermes runtime in this platform.
class TextLayout final {
 public:
  explicit TextLayout(godot::Ref<godot::Font> font) : font_(std::move(font)) {}
  facebook::react::Size measure(const std::string &text, float font_size,
      const facebook::react::LayoutConstraints &constraints) const;
  const godot::Ref<godot::Font> &font() const { return font_; }
  int measurements() const { return measurements_; }
 private:
  godot::Ref<godot::Font> font_;
  mutable int measurements_{};
};
} // namespace fabric_godot
