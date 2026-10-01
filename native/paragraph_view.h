#pragma once
#include "paragraph_layout.h"
#include <godot_cpp/classes/panel.hpp>
#include <react/renderer/mounting/ShadowView.h>

class GodotParagraph final : public godot::Panel {
  GDCLASS(GodotParagraph, godot::Panel)
 public:
  void apply(const facebook::react::ShadowView &shadow,
      const std::shared_ptr<fabric_godot::ParagraphLayout> &layout);
  void _draw() override;
  folly::dynamic snapshot() const;
 protected:
  static void _bind_methods() {}
 private:
  fabric_godot::PreparedParagraph prepared_;
  godot::Vector2 inset_;
};
