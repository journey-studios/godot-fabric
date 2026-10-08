#pragma once

// The pure parts of what an Image does to its picture beyond placing it: the blur RN iOS applies to the bitmap, the clip that
// follows the view's rounded corners, the nine-patch that capInsets make and the single description (Painting) of everything
// that is drawn for one frame. Header-only and free of Godot and React Native, so image_effects_test.cpp checks it on its own
// and the view only hands it what the shadow view holds. The sources are RN iOS's:
//   Libraries/Image/RCTImageBlurUtils.mm                         the box blur (RCTBlurredImageWithRadius)
//   React/Fabric/.../Image/RCTImageComponentView.mm              which of tint, caps, tiling and blur apply, and in what order
//   React/Views/RCTBorderDrawing.m                               the corner insets and the rounded rectangle's clamp
//   React/Fabric/.../View/RCTViewComponentView.mm                the masks of a view that clips its content

#include "image_geometry.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <numbers>
#include <optional>
#include <vector>

namespace fabric_godot::image {

// ---- blur ----

// __FLT_EPSILON__: RCTImageComponentView blurs only for a radius above it.
constexpr double flt_epsilon = 1.1920928955078125e-07;
// A box wider than this is limited to it: the sums of a window must fit 64 bits.
constexpr uint32_t max_blur_kernel = 1u << 20;

struct BlurPlan {
  double radius{};
  // The picture's pixels per point (UIImage.scale), which the kernel is measured in.
  double scale{};
  // The side of the square box in pixels, always odd; 0 when no blur was asked for.
  uint32_t kernel{};
  // RCTBlurredImageWithRadius calls vImageBoxConvolve three times, but frees the buffer the third call writes and builds its image
  // from the one the second wrote: two passes reach the picture.
  int passes{2};
  // The pixels change: a radius above epsilon whose box is wider than one pixel. A box of one pixel has no temp buffer to
  // allocate, and the function returns its input image untouched (tempBufferSize <= 0): the picture keeps everything it had.
  bool applies{};
  bool operator==(const BlurPlan &) const = default;
};

// RCTBlurredImageWithRadius: the box side of a gaussian of standard deviation radius x scale (SVG's feGaussianBlur), made odd.
inline BlurPlan blur_plan(double radius, double scale) {
  BlurPlan plan;
  plan.radius = radius;
  plan.scale = scale;
  if (!(radius > flt_epsilon) || !(scale > 0)) return plan;
  const double side = std::floor((radius * scale * 3 * std::sqrt(2 * std::numbers::pi) / 4 + 0.5) / 2);
  plan.kernel = (side >= static_cast<double>(max_blur_kernel) ? max_blur_kernel : static_cast<uint32_t>(side)) | 1u;
  plan.applies = plan.kernel > 1;
  return plan;
}

// Straight-alpha RGBA8 to premultiplied: each color channel is round(c * a / 255).
inline uint8_t premultiplied(uint8_t channel, uint8_t alpha) {
  return static_cast<uint8_t>((static_cast<uint32_t>(channel) * alpha + 127) / 255);
}
// Back to straight alpha: round(p * 255 / a), at most 255, and black where the pixel is transparent.
inline uint8_t straightened(uint8_t channel, uint8_t alpha) {
  if (alpha == 0) return 0;
  const uint32_t value = (2u * 255u * channel + alpha) / (2u * alpha);
  return static_cast<uint8_t>(std::min<uint32_t>(value, 255));
}

// Sums, for every pixel of one row, each channel over the window [x - r, x + r], reading the nearest pixel of the row for what falls
// outside it (kvImageEdgeExtend). `out` holds width x 4 sums.
inline void row_window_sums(const uint8_t *row, std::size_t width, std::size_t r, uint64_t *out) {
  for (std::size_t channel = 0; channel < 4; ++channel) {
    uint64_t sum = static_cast<uint64_t>(row[channel]) * (r + 1);
    for (std::size_t j = 1; j <= std::min(r, width - 1); ++j) sum += row[j * 4 + channel];
    if (r > width - 1) sum += static_cast<uint64_t>(row[(width - 1) * 4 + channel]) * (r - (width - 1));
    for (std::size_t x = 0; x < width; ++x) {
      out[x * 4 + channel] = sum;
      sum += row[std::min(x + r + 1, width - 1) * 4 + channel];
      sum -= row[(x >= r ? x - r : 0) * 4 + channel];
    }
  }
}

// One vImageBoxConvolve_ARGB8888 with a square kernel of side `kernel` and the edge extended: every channel of a pixel becomes the
// mean of the kernel x kernel window around it. The sum is exact and divided once, rounding to the nearest (an odd divisor never leaves
// a tie).
inline void box_pass(const uint8_t *source, uint8_t *target, std::size_t width, std::size_t height, uint64_t kernel) {
  const std::size_t r = static_cast<std::size_t>(kernel / 2), stride = width * 4;
  const uint64_t area = kernel * kernel, half = area / 2;
  std::vector<uint64_t> column(stride), row(stride);
  row_window_sums(source, width, r, row.data());
  for (std::size_t i = 0; i < stride; ++i) column[i] = row[i] * (r + 1);
  for (std::size_t j = 1; j <= std::min(r, height - 1); ++j) {
    row_window_sums(source + j * stride, width, r, row.data());
    for (std::size_t i = 0; i < stride; ++i) column[i] += row[i];
  }
  if (r > height - 1) {
    row_window_sums(source + (height - 1) * stride, width, r, row.data());
    for (std::size_t i = 0; i < stride; ++i) column[i] += row[i] * (r - (height - 1));
  }
  for (std::size_t y = 0; y < height; ++y) {
    for (std::size_t i = 0; i < stride; ++i) target[y * stride + i] = static_cast<uint8_t>((column[i] + half) / area);
    if (y + 1 == height) break;
    row_window_sums(source + std::min(y + r + 1, height - 1) * stride, width, r, row.data());
    for (std::size_t i = 0; i < stride; ++i) column[i] += row[i];
    row_window_sums(source + (y >= r ? y - r : 0) * stride, width, r, row.data());
    for (std::size_t i = 0; i < stride; ++i) column[i] -= row[i];
  }
}

// RCTBlurredImageWithRadius on a straight-alpha RGBA8 bitmap, in place: premultiplied, two box passes, straight again. A kernel of one
// pixel changes nothing.
inline void box_blur_rgba8(uint8_t *pixels, std::size_t width, std::size_t height, uint32_t kernel) {
  if (width == 0 || height == 0 || kernel <= 1) return;
  const std::size_t count = width * height;
  for (std::size_t i = 0; i < count; ++i) {
    for (std::size_t channel = 0; channel < 3; ++channel) pixels[i * 4 + channel] = premultiplied(pixels[i * 4 + channel], pixels[i * 4 + 3]);
  }
  std::vector<uint8_t> scratch(count * 4);
  box_pass(pixels, scratch.data(), width, height, kernel);
  box_pass(scratch.data(), pixels, width, height, kernel);
  for (std::size_t i = 0; i < count; ++i) {
    for (std::size_t channel = 0; channel < 3; ++channel) pixels[i * 4 + channel] = straightened(pixels[i * 4 + channel], pixels[i * 4 + 3]);
  }
}

// ---- the clip of a view with rounded corners ----

struct Edges {
  double left{}, top{}, right{}, bottom{};
  bool operator==(const Edges &) const = default;
};
// One corner's radii: the quarter ellipse is `horizontal` wide and `vertical` high.
struct Corner {
  double horizontal{}, vertical{};
  bool operator==(const Corner &) const = default;
};
struct Corners {
  Corner top_left, top_right, bottom_right, bottom_left;
  bool operator==(const Corners &) const = default;
  bool any() const {
    for (const auto &corner : {top_left, top_right, bottom_right, bottom_left}) {
      if (corner.horizontal > 0 || corner.vertical > 0) return true;
    }
    return false;
  }
};
struct RoundedRect {
  Rect rect;
  Corners radii;
  bool operator==(const RoundedRect &) const = default;
};

// RCTGetCornerInsets: a corner's radii, less the widths of the borders that meet at it.
inline Corners corner_insets(const Corners &radii, const Edges &edges) {
  const auto less = [](double radius, double edge) { return std::max(0.0, radius - edge); };
  return {{less(radii.top_left.horizontal, edges.left), less(radii.top_left.vertical, edges.top)},
      {less(radii.top_right.horizontal, edges.right), less(radii.top_right.vertical, edges.top)},
      {less(radii.bottom_right.horizontal, edges.right), less(radii.bottom_right.vertical, edges.bottom)},
      {less(radii.bottom_left.horizontal, edges.left), less(radii.bottom_left.vertical, edges.bottom)}};
}

// RCTPathCreateWithRoundedRect: each radius is limited to what is left of the side once the neighbour's has been taken. (Not CSS's
// proportional reduction: that one is done earlier, by ViewProps, on the radii this receives.)
inline Corners fit_corners(Size bounds, const Corners &c) {
  const auto fit = [](double radius, double room) { return std::max(0.0, std::min(radius, room)); };
  return {{fit(c.top_left.horizontal, bounds.width - c.top_right.horizontal), fit(c.top_left.vertical, bounds.height - c.bottom_left.vertical)},
      {fit(c.top_right.horizontal, bounds.width - c.top_left.horizontal), fit(c.top_right.vertical, bounds.height - c.bottom_right.vertical)},
      {fit(c.bottom_right.horizontal, bounds.width - c.bottom_left.horizontal), fit(c.bottom_right.vertical, bounds.height - c.top_right.vertical)},
      {fit(c.bottom_left.horizontal, bounds.width - c.bottom_right.horizontal), fit(c.bottom_left.vertical, bounds.height - c.top_left.vertical)}};
}

// What a view that clips its content leaves of an Image's picture. `outer` is the border box with the view's radii (the mask of the
// view itself) and `inner` the content frame with each radius less the border widths beside it (the mask of the UIImageView,
// which RCTViewComponentView adds because the image might otherwise overflow the corners). Both in points of the view.
struct Clip {
  RoundedRect outer, inner;
  bool operator==(const Clip &) const = default;
};

inline Clip clip_geometry(Size frame, const Rect &content, const Corners &radii, const Edges &widths) {
  Clip clip;
  clip.outer = {{0, 0, frame.width, frame.height}, fit_corners(frame, corner_insets(radii, {}))};
  clip.inner = {content, fit_corners({content.width, content.height}, corner_insets(radii, widths))};
  return clip;
}

inline RoundedRect scaled(const RoundedRect &shape, double factor) {
  const auto corner = [factor](const Corner &c) { return Corner{c.horizontal * factor, c.vertical * factor}; };
  return {{shape.rect.x * factor, shape.rect.y * factor, shape.rect.width * factor, shape.rect.height * factor},
      {corner(shape.radii.top_left), corner(shape.radii.top_right), corner(shape.radii.bottom_right), corner(shape.radii.bottom_left)}};
}

// ---- capInsets ----

enum class PatchMode { Stretch, Tile };

inline const char *patch_mode_name(PatchMode mode) { return mode == PatchMode::Tile ? "tile" : "stretch"; }

// RenderingServer::canvas_item_add_nine_patch, in the pixels of the picture: the destination rectangle, the whole picture as the
// source, and the margins, which Godot reads as destination units and as source texels at once.
struct NinePatch {
  Rect dst, src;
  Edges margins;
  PatchMode x{PatchMode::Stretch}, y{PatchMode::Stretch};
  bool operator==(const NinePatch &) const = default;
};

// capInsets are points of the picture, so they are `scale` times as many pixels, and no more than the picture holds: what the two
// insets of one axis leave of it is the stretched (or tiled) middle.
inline Edges patch_margins(const Edges &insets, double scale, Size pixels) {
  const auto positive = [](double value) { return value > 0 ? value : 0.0; };
  Edges margins;
  margins.left = std::min(positive(insets.left * scale), pixels.width);
  margins.right = std::min(positive(insets.right * scale), pixels.width - margins.left);
  margins.top = std::min(positive(insets.top * scale), pixels.height);
  margins.bottom = std::min(positive(insets.bottom * scale), pixels.height - margins.top);
  return margins;
}

// ---- one frame ----

struct Rgba {
  float r{}, g{}, b{}, a{};
  bool operator==(const Rgba &) const = default;
};

enum class PaintKind { Region, Tile, NinePatch };

inline const char *paint_kind_name(PaintKind kind) {
  switch (kind) {
    case PaintKind::Region: return "region";
    case PaintKind::Tile: return "tile";
    case PaintKind::NinePatch: return "ninePatch";
  }
  return "region";
}

// What the view knows when it draws.
struct PaintInput {
  ResizeMode mode{ResizeMode::Stretch};
  // The view's border box and its content frame, in points of the view.
  Size frame;
  Rect content;
  // The picture: its pixels, and the pixels per point it was decoded at.
  Size pixels;
  double scale{1};
  // A picture that RCTBlurredImageWithRadius rebuilt from its bitmap: it has lost the template mode, the caps and the tiling of the
  // image it was made from.
  bool plain{};
  std::optional<Rgba> tint;
  Edges cap_insets;
  // The view clips its content to its bounds (overflow other than visible), which is what rounds the picture.
  bool clips{};
  Corners radii;
  Edges widths;
};

// Everything one draw asks of the renderer. The rectangles with a `_px` suffix are in pixels of the picture: the item the picture is
// drawn on is scaled by 1/scale, so a pixel of the picture is a pixel of the texture and the shader's coordinates are texels.
struct Painting {
  ResizeMode mode{ResizeMode::Stretch};
  // What the six resize modes place, in points of the content frame (image_geometry.h).
  Draw plan;
  PaintKind kind{PaintKind::Region};
  Rect dst_px, src_px;
  std::optional<NinePatch> patch;
  std::optional<Rgba> tint;
  // In points of the view, and in pixels of the picture; set when the picture has rounded corners to be clipped to.
  std::optional<Clip> clip;
  std::optional<RoundedRect> outer_px, inner_px;
  double scale{1};
};

// Tint, caps and the blur that rebuilds the picture follow RCTImageComponentView didReceiveImage: a tint makes it a template; caps make
// it resizable (stretching, or tiling for repeat); a blur that changes the pixels rebuilds it from its bitmap, which has none of
// them. The caps apply to the stretch and repeat modes only: UIKit's other content modes were not verified against a resizable image.
inline std::optional<Painting> paint(const PaintInput &in) {
  if (!(in.scale > 0) || !(in.pixels.width > 0 && in.pixels.height > 0)) return std::nullopt;
  Painting out;
  out.scale = in.scale;
  // A rebuilt picture is not a resizable image, so repeat has nothing to tile: the view fills with it, as scale-to-fill does.
  out.mode = in.plain && in.mode == ResizeMode::Repeat ? ResizeMode::Stretch : in.mode;
  const auto placed = plan(out.mode, {in.content.width, in.content.height}, {in.pixels.width / in.scale, in.pixels.height / in.scale});
  if (!placed) return std::nullopt;
  out.plan = *placed;
  const double s = in.scale;
  out.dst_px = {(in.content.x + placed->dst.x) * s, (in.content.y + placed->dst.y) * s, placed->dst.width * s, placed->dst.height * s};
  out.src_px = {placed->src.x * s, placed->src.y * s, placed->src.width * s, placed->src.height * s};
  out.kind = placed->tiled ? PaintKind::Tile : PaintKind::Region;
  if (!in.plain) {
    out.tint = in.tint;
    const bool caps = out.mode == ResizeMode::Stretch || out.mode == ResizeMode::Repeat;
    const Edges margins = patch_margins(in.cap_insets, s, in.pixels);
    if (caps && (margins.left > 0 || margins.top > 0 || margins.right > 0 || margins.bottom > 0)) {
      const PatchMode mode = out.mode == ResizeMode::Repeat ? PatchMode::Tile : PatchMode::Stretch;
      out.kind = PaintKind::NinePatch;
      out.patch = NinePatch{out.dst_px, {0, 0, in.pixels.width, in.pixels.height}, margins, mode, mode};
    }
  }
  if (in.clips) {
    const auto clip = clip_geometry(in.frame, in.content, in.radii, in.widths);
    if (clip.outer.radii.any() || clip.inner.radii.any()) {
      out.clip = clip;
      out.outer_px = scaled(clip.outer, s);
      out.inner_px = scaled(clip.inner, s);
    }
  }
  return out;
}

}  // namespace fabric_godot::image
