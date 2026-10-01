#pragma once
#include <godot_cpp/classes/control.hpp>
#include <godot_cpp/classes/font.hpp>
#include <godot_cpp/classes/image_texture.hpp>
#include <folly/dynamic.h>
#include <vector>
#include <cstdint>

// Fabric owns every primitive and its identity. Only the root paints. SVG's
// coordinates are independent of Yoga; descendants are zero-size host nodes.
class GodotSvgNode final : public godot::Control {
  GDCLASS(GodotSvgNode, godot::Control)
 public:
  void set_payload(const std::string &json);
  bool is_surface() const;
  void refresh(const godot::Ref<godot::Font> &font);
  void _draw() override;
  folly::dynamic snapshot() const;
 protected:
  static void _bind_methods() {}
 private:
  struct Paint {
    godot::Ref<godot::ImageTexture> texture;
    godot::Ref<godot::Font> font;
    godot::String text;
    godot::Vector2 baseline;
    godot::Color color;
    int font_size{};
  };
  folly::dynamic payload_;
  std::string fingerprint_, document_;
  uint64_t raster_hash_{};
  double last_raster_ms_{}, peak_raster_ms_{}, total_raster_ms_{};
  std::vector<Paint> paints_;
  int renders_{}, raster_layers_{}, text_count_{}, painted_pixels_{};
  std::string markup(bool include_text) const;
  void collect_definitions(std::string &out) const;
  void collect_paint(std::string &segment, std::vector<Paint> &paints,
      const godot::Ref<godot::Font> &font, const std::string &defs, int &pixels, int &texts, uint64_t &hash) const;
  void flush(std::string &segment, std::vector<Paint> &paints,
      const std::string &defs, int &pixels, uint64_t &hash) const;
};
