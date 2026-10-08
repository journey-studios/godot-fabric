#pragma once

// Where an image is drawn inside its content frame, for the six resize modes. The mapping is the one the iOS component
// applies: RCTImagePrimitivesConversions.h turns each mode into a UIViewContentMode of the UIImageView that fills the
// content frame, and repeat is a tiled resizable image. Header-only and free of Godot and React Native, so
// image_core_test.cpp checks it on its own.

#include <algorithm>
#include <optional>

namespace fabric_godot::image {

enum class ResizeMode { Cover, Contain, Stretch, Center, Repeat, None };

struct Size {
  double width{}, height{};
  bool operator==(const Size &) const = default;
};
struct Rect {
  double x{}, y{}, width{}, height{};
  bool operator==(const Rect &) const = default;
};

// One draw: the part of the image (src, in the image's own points) shown in dst (points of the content frame). A tiled draw
// repeats the whole image, tile by tile from dst's top-left corner.
struct Draw {
  Rect dst, src;
  bool tiled{};
  Size tile{};
  bool operator==(const Draw &) const = default;
};

inline const char *mode_name(ResizeMode mode) {
  switch (mode) {
    case ResizeMode::Cover: return "cover";
    case ResizeMode::Contain: return "contain";
    case ResizeMode::Stretch: return "stretch";
    case ResizeMode::Center: return "center";
    case ResizeMode::Repeat: return "repeat";
    case ResizeMode::None: return "none";
  }
  return "stretch";
}

// What a UIImageView of the mode draws for an image `natural` points large in a content frame `content` points large; nothing
// when either has no area or the image falls outside the frame.
inline std::optional<Draw> plan(ResizeMode mode, Size content, Size natural) {
  if (!(content.width > 0 && content.height > 0 && natural.width > 0 && natural.height > 0)) return std::nullopt;
  const Rect whole{0, 0, natural.width, natural.height};
  const Rect frame{0, 0, content.width, content.height};
  switch (mode) {
    case ResizeMode::Stretch: return Draw{frame, whole};
    case ResizeMode::Contain: {
      const double scale = std::min(content.width / natural.width, content.height / natural.height);
      const double width = natural.width * scale, height = natural.height * scale;
      return Draw{{(content.width - width) / 2, (content.height - height) / 2, width, height}, whole};
    }
    case ResizeMode::Cover: {
      const double scale = std::max(content.width / natural.width, content.height / natural.height);
      const double width = content.width / scale, height = content.height / scale;
      return Draw{frame, {(natural.width - width) / 2, (natural.height - height) / 2, width, height}};
    }
    case ResizeMode::Repeat: return Draw{frame, whole, true, natural};
    case ResizeMode::Center:
    case ResizeMode::None: {
      // The image keeps its size: centered, or against the top-left corner, and clipped by the frame.
      const double x = mode == ResizeMode::Center ? (content.width - natural.width) / 2 : 0;
      const double y = mode == ResizeMode::Center ? (content.height - natural.height) / 2 : 0;
      const double left = std::max(x, 0.0), top = std::max(y, 0.0);
      const double right = std::min(x + natural.width, content.width), bottom = std::min(y + natural.height, content.height);
      if (!(right > left && bottom > top)) return std::nullopt;
      return Draw{{left, top, right - left, bottom - top}, {left - x, top - y, right - left, bottom - top}};
    }
  }
  return std::nullopt;
}

}  // namespace fabric_godot::image
