#include "image_effects_core.h"
#include <cstdlib>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

using namespace fabric_godot::image;

namespace {
void require(bool condition, const std::string &message) {
  if (!condition) throw std::runtime_error(message);
}

// A deterministic bitmap with every kind of pixel: opaque, translucent and transparent, with colors under the transparent ones.
std::vector<uint8_t> bitmap(std::size_t width, std::size_t height) {
  std::vector<uint8_t> out(width * height * 4);
  uint32_t state = 12345u + static_cast<uint32_t>(width * 31 + height);
  for (auto &byte : out) {
    state = state * 1664525u + 1013904223u;
    byte = static_cast<uint8_t>(state >> 24);
  }
  for (std::size_t i = 0; i < width * height; ++i) {
    if (i % 5 == 0) out[i * 4 + 3] = 255;
    if (i % 7 == 0) out[i * 4 + 3] = 0;
  }
  return out;
}

// RCTBlurredImageWithRadius as the spec states it, one output pixel at a time: no running sums, no shared work.
std::vector<uint8_t> blurred_naively(const std::vector<uint8_t> &straight, std::size_t width, std::size_t height, uint32_t kernel) {
  std::vector<uint8_t> current(straight.size());
  for (std::size_t i = 0; i < width * height; ++i) {
    for (std::size_t c = 0; c < 3; ++c) current[i * 4 + c] = static_cast<uint8_t>((straight[i * 4 + c] * straight[i * 4 + 3] + 127) / 255);
    current[i * 4 + 3] = straight[i * 4 + 3];
  }
  const long r = static_cast<long>(kernel / 2);
  for (int pass = 0; pass < 2; ++pass) {
    std::vector<uint8_t> next(current.size());
    for (long y = 0; y < static_cast<long>(height); ++y) {
      for (long x = 0; x < static_cast<long>(width); ++x) {
        for (std::size_t c = 0; c < 4; ++c) {
          unsigned long long sum = 0;
          for (long dy = -r; dy <= r; ++dy) {
            for (long dx = -r; dx <= r; ++dx) {
              const long sy = std::min(std::max(y + dy, 0L), static_cast<long>(height) - 1);
              const long sx = std::min(std::max(x + dx, 0L), static_cast<long>(width) - 1);
              sum += current[(static_cast<std::size_t>(sy) * width + static_cast<std::size_t>(sx)) * 4 + c];
            }
          }
          const unsigned long long area = static_cast<unsigned long long>(kernel) * kernel;
          next[(static_cast<std::size_t>(y) * width + static_cast<std::size_t>(x)) * 4 + c] = static_cast<uint8_t>((sum + area / 2) / area);
        }
      }
    }
    current = std::move(next);
  }
  for (std::size_t i = 0; i < width * height; ++i) {
    const unsigned alpha = current[i * 4 + 3];
    for (std::size_t c = 0; c < 3; ++c) {
      current[i * 4 + c] = alpha == 0 ? 0 : static_cast<uint8_t>(std::min(255u, (2u * 255u * current[i * 4 + c] + alpha) / (2u * alpha)));
    }
  }
  return current;
}

void the_kernel_is_the_box_of_a_gaussian_made_odd() {
  require(blur_plan(1, 2).kernel == 3 && blur_plan(1, 2).applies, "radius 1 at scale 2: floor((3.76 + 0.5) / 2) = 2, made odd");
  require(blur_plan(2, 2).kernel == 5, "radius 2 at scale 2: floor((7.52 + 0.5) / 2) = 4, made odd");
  require(blur_plan(1, 3).kernel == 3 && blur_plan(10, 1).kernel == 9 && blur_plan(12, 2).kernel == 23, "other radii and scales");
  require(blur_plan(0.2, 2).kernel == 1 && !blur_plan(0.2, 2).applies, "a box of one pixel changes nothing, and RN returns the image it was given");
  require(blur_plan(0, 2).kernel == 0 && !blur_plan(0, 2).applies, "no radius, no blur");
  require(!blur_plan(flt_epsilon, 2).applies && blur_plan(flt_epsilon, 2).kernel == 0, "a radius at FLT_EPSILON is no blur: RN blurs only above it");
  require(!blur_plan(-3, 2).applies && !blur_plan(std::nan(""), 2).applies, "a negative or missing radius is no blur");
  require(blur_plan(1e30, 2).kernel == (max_blur_kernel | 1u), "an absurd radius is limited to the widest box");
  require(blur_plan(3, 2).passes == 2, "two passes reach the picture");
}

void premultiplying_rounds_to_the_nearest() {
  require(premultiplied(200, 128) == 100 && premultiplied(255, 255) == 255 && premultiplied(255, 0) == 0 && premultiplied(1, 1) == 0, "c * a / 255, rounded");
  require(premultiplied(129, 255) == 129 && premultiplied(128, 128) == 64, "an opaque pixel keeps its color");
  require(straightened(100, 128) == 199 && straightened(0, 0) == 0 && straightened(77, 0) == 0, "p * 255 / a, rounded; black where transparent");
  require(straightened(255, 10) == 255, "never above 255");
}

void a_uniform_picture_stays_uniform_and_a_kernel_of_one_changes_nothing() {
  std::vector<uint8_t> flat(6 * 5 * 4);
  for (std::size_t i = 0; i < flat.size(); i += 4) {
    flat[i] = 40;
    flat[i + 1] = 90;
    flat[i + 2] = 200;
    flat[i + 3] = 255;
  }
  auto copy = flat;
  box_blur_rgba8(copy.data(), 6, 5, 7);
  require(copy == flat, "an opaque uniform picture is a fixed point of the blur, whatever the box");
  auto mixed = bitmap(7, 4);
  const auto before = mixed;
  box_blur_rgba8(mixed.data(), 7, 4, 1);
  require(mixed == before, "a box of one pixel, and none at all, leave every byte");
  std::vector<uint8_t> clear(3 * 3 * 4);
  box_blur_rgba8(clear.data(), 3, 3, 5);
  require(clear == std::vector<uint8_t>(3 * 3 * 4), "a transparent picture stays transparent");
}

void dimensions_that_overflow_leave_the_buffer() {
  constexpr std::size_t largest = std::numeric_limits<std::size_t>::max();
  auto pixels = bitmap(2, 2);
  const auto before = pixels;
  // 2^63 x 2 is 2^64, which wraps to zero pixels: the sum a careless count would take for an empty bitmap.
  box_blur_rgba8(pixels.data(), largest / 2 + 1, 2, 3);
  require(pixels == before, "a pixel count that wraps leaves the buffer as it was");
  box_blur_rgba8(pixels.data(), largest, 3, 3);
  require(pixels == before, "a pixel count that overflows leaves the buffer as it was");
  // A pixel count that fits, whose byte count (four to a pixel) does not.
  box_blur_rgba8(pixels.data(), largest / 4 + 1, 1, 3);
  require(pixels == before, "a byte count that overflows leaves the buffer as it was");
}

void the_running_sums_are_the_window_sums() {
  for (const auto &[width, height] : std::vector<std::pair<std::size_t, std::size_t>>{{1, 1}, {1, 6}, {6, 1}, {3, 3}, {7, 4}, {16, 9}, {2, 11}}) {
    for (const uint32_t kernel : {3u, 5u, 9u, 15u, 41u}) {
      auto fast = bitmap(width, height);
      const auto expected = blurred_naively(fast, width, height, kernel);
      box_blur_rgba8(fast.data(), width, height, kernel);
      require(fast == expected, "the " + std::to_string(width) + "x" + std::to_string(height) + " picture with a box of " + std::to_string(kernel) + " is the naive one");
    }
  }
}

void one_opaque_pixel_spreads_as_two_boxes() {
  std::vector<uint8_t> dot(5 * 5 * 4);
  dot[(2 * 5 + 2) * 4 + 0] = 255;
  dot[(2 * 5 + 2) * 4 + 3] = 255;
  box_blur_rgba8(dot.data(), 5, 5, 3);
  const auto alpha = [&](std::size_t x, std::size_t y) { return dot[(y * 5 + x) * 4 + 3]; };
  // First pass: 255 / 9 = 28 over the 3x3 around the dot. Second pass, by hand: the centre sums nine of them (252 / 9 = 28), a
  // diagonal neighbour four (112 / 9 = 12), the middle of the top row three (84 / 9 = 9) and the corner, whose window reads the edge
  // twice, one (28 / 9 = 3).
  require(alpha(2, 2) == 28 && alpha(1, 1) == 12 && alpha(2, 0) == 9 && alpha(0, 0) == 3, "two boxes of 3 spread the dot over 5x5 as 28, 12, 9 and 3");
  require(dot[(2 * 5 + 2) * 4 + 0] == 255 && dot[(2 * 5 + 2) * 4 + 1] == 0 && dot[(0 * 5 + 0) * 4 + 0] == 255, "straight color comes back from the premultiplied one");
}

void corners_follow_the_border_drawing() {
  const Corners ten{{10, 10}, {10, 10}, {10, 10}, {10, 10}};
  const auto less = corner_insets(ten, {2, 3, 4, 5});
  require(less.top_left == Corner{8, 7} && less.top_right == Corner{6, 7} && less.bottom_right == Corner{6, 5} && less.bottom_left == Corner{8, 5},
      "each radius loses the widths of the two borders that meet at its corner");
  require(corner_insets(ten, {20, 20, 20, 20}).top_left == Corner{0, 0}, "never below zero");
  const Corners fifteen{{15, 15}, {15, 15}, {15, 15}, {15, 15}};
  const auto fitted = fit_corners({20, 20}, fifteen);
  require(fitted.top_left == Corner{5, 5} && fitted.top_right == Corner{5, 5} && fitted.bottom_right == Corner{5, 5} && fitted.bottom_left == Corner{5, 5},
      "each radius is limited to the side less its neighbour's: 20 - 15");
  const Corners lopsided{{30, 4}, {30, 4}, {1, 40}, {1, 40}};
  const auto uneven = fit_corners({20, 20}, lopsided);
  require(uneven.top_left == Corner{0, 0} && uneven.top_right == Corner{0, 0}, "a radius whose neighbour already takes the side is zero");
  require(uneven.bottom_left == Corner{1, 16} && uneven.bottom_right == Corner{1, 16}, "a height is limited by the corner above it, as the original radius: 20 - 4");
}

void a_clip_is_the_border_box_and_the_content_frame() {
  const Corners twenty{{20, 20}, {20, 20}, {20, 20}, {20, 20}};
  const auto clip = clip_geometry({40, 40}, {3, 3, 34, 34}, twenty, {2, 2, 2, 2});
  require(clip.outer.rect == Rect{0, 0, 40, 40} && clip.outer.radii.top_left == Corner{20, 20}, "the view itself keeps its radii");
  require(clip.inner.rect == Rect{3, 3, 34, 34} && clip.inner.radii.top_left == Corner{16, 16},
      "the content frame has the radii less the border (18), limited to the 34 points it has: 34 - 18");
  const auto square = clip_geometry({40, 40}, {0, 0, 40, 40}, Corners{}, {});
  require(!square.outer.radii.any() && !square.inner.radii.any(), "no radius, no rounded clip");
  const auto uneven = clip_geometry({60, 30}, {4, 2, 52, 26}, {{20, 10}, {0, 0}, {0, 0}, {5, 5}}, {4, 2, 4, 2});
  require(uneven.outer.radii.top_left == Corner{20, 10} && uneven.outer.radii.bottom_left == Corner{5, 5}, "elliptical corners keep both radii");
  require(uneven.inner.radii.top_left == Corner{16, 8} && uneven.inner.radii.bottom_left == Corner{1, 3}, "and each loses the width beside it");
  const auto scaled_up = scaled(clip.outer, 2);
  require(scaled_up.rect == Rect{0, 0, 80, 80} && scaled_up.radii.top_left == Corner{40, 40}, "pixels of the picture are scale times points");
}

void cap_insets_become_margins_in_pixels() {
  const auto margins = patch_margins({4, 2, 4, 2}, 2, {16, 16});
  require(margins == Edges{8, 4, 8, 4}, "points of the picture times its scale");
  const auto crowded = patch_margins({10, 10, 10, 10}, 2, {16, 12});
  require(crowded == Edges{16, 12, 0, 0}, "what one inset leaves of the picture is all the opposite one may take");
  require(patch_margins({-3, 1, -3, 1}, 1, {8, 8}) == Edges{0, 1, 0, 1}, "a negative inset is none");
}

PaintInput base_input() {
  PaintInput in;
  in.frame = {60, 40};
  in.content = {2, 2, 56, 36};
  in.pixels = {32, 16};
  in.scale = 2;
  return in;
}

void a_draw_is_one_description() {
  auto in = base_input();
  const auto plain_stretch = paint(in);
  require(plain_stretch && plain_stretch->kind == PaintKind::Region && plain_stretch->dst_px == Rect{4, 4, 112, 72}, "stretch fills the content frame, in pixels");
  require(plain_stretch->src_px == Rect{0, 0, 32, 16} && !plain_stretch->tint && !plain_stretch->patch && !plain_stretch->clip, "nothing else is asked");
  in.mode = ResizeMode::Repeat;
  const auto tiled = paint(in);
  require(tiled && tiled->kind == PaintKind::Tile && tiled->plan.tiled && tiled->dst_px == Rect{4, 4, 112, 72}, "repeat tiles, with no caps");
  in.cap_insets = {2, 1, 2, 1};
  const auto tile_patch = paint(in);
  require(tile_patch && tile_patch->kind == PaintKind::NinePatch && tile_patch->patch->x == PatchMode::Tile && tile_patch->patch->y == PatchMode::Tile
      && tile_patch->patch->margins == Edges{4, 2, 4, 2} && tile_patch->patch->src == Rect{0, 0, 32, 16}, "repeat with caps tiles a nine-patch");
  in.mode = ResizeMode::Stretch;
  const auto stretch_patch = paint(in);
  require(stretch_patch && stretch_patch->patch->x == PatchMode::Stretch && stretch_patch->patch->dst == Rect{4, 4, 112, 72}, "stretch with caps stretches it");
  in.mode = ResizeMode::Cover;
  const auto covered = paint(in);
  require(covered && covered->kind == PaintKind::Region && !covered->patch, "the other modes ignore the caps");
  in.mode = ResizeMode::Stretch;
  in.tint = Rgba{1, 0.5f, 0, 0.5f};
  in.plain = true;
  const auto blurred = paint(in);
  require(blurred && !blurred->tint && !blurred->patch && blurred->kind == PaintKind::Region, "a rebuilt picture has no tint and no caps");
  in.mode = ResizeMode::Repeat;
  const auto blurred_repeat = paint(in);
  require(blurred_repeat && blurred_repeat->mode == ResizeMode::Stretch && !blurred_repeat->plan.tiled && blurred_repeat->kind == PaintKind::Region,
      "and repeat fills the view with it instead of tiling");
  in.plain = false;
  in.mode = ResizeMode::Stretch;
  const auto tinted = paint(in);
  require(tinted && tinted->tint && *tinted->tint == Rgba{1, 0.5f, 0, 0.5f}, "a tint is kept");
}

void a_draw_clips_only_a_view_that_clips_and_has_a_radius() {
  auto in = base_input();
  in.radii = {{8, 8}, {8, 8}, {8, 8}, {8, 8}};
  in.widths = {2, 2, 2, 2};
  require(!paint(in)->clip, "overflow visible keeps only the rectangle of the content frame");
  in.clips = true;
  const auto rounded = paint(in);
  require(rounded->clip && rounded->outer_px->rect == Rect{0, 0, 120, 80} && rounded->outer_px->radii.top_left == Corner{16, 16}
      && rounded->inner_px->rect == Rect{4, 4, 112, 72} && rounded->inner_px->radii.top_left == Corner{12, 12}, "the clip is in pixels of the picture");
  in.radii = {};
  require(!paint(in)->clip, "a clipping view without radii needs no mask");
  require(!paint(PaintInput{}), "an empty input paints nothing");
}
}  // namespace

int main() {
  the_kernel_is_the_box_of_a_gaussian_made_odd();
  premultiplying_rounds_to_the_nearest();
  a_uniform_picture_stays_uniform_and_a_kernel_of_one_changes_nothing();
  dimensions_that_overflow_leave_the_buffer();
  the_running_sums_are_the_window_sums();
  one_opaque_pixel_spreads_as_two_boxes();
  corners_follow_the_border_drawing();
  a_clip_is_the_border_box_and_the_content_frame();
  cap_insets_become_margins_in_pixels();
  a_draw_is_one_description();
  a_draw_clips_only_a_view_that_clips_and_has_a_radius();
  std::cout << "IMAGE_EFFECTS_PASSED\n";
}
