#include "display_insets_core.h"
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

using namespace fabric_godot::display_insets;

namespace {
void require(bool condition, const char *message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

bool near(double a, double b) { return std::abs(a - b) < 1e-9; }

bool same(const Edges &a, const Edges &b) {
  return near(a.left, b.left) && near(a.top, b.top) && near(a.right, b.right) && near(a.bottom, b.bottom);
}

// iPhone 16e in landscape on the iOS simulator: 2532x1170 physical pixels at scale 3, so 844x390 points. The OS reports
// get_display_safe_area() in screen pixels as the screen minus the notch at the left (188 px), the home indicator at the
// bottom (63 px) and the matching right margin (188 px): 62.67 pt, 21 pt and 62.67 pt.
const Frame screen_pixels{0, 0, 2532, 1170};
const Frame safe_pixels{188, 0, 2532 - 188 - 188, 1170 - 63};

void the_bands_are_what_the_safe_area_leaves_out() {
  const Edges bands = unsafe_bands(safe_pixels, screen_pixels, 3);
  require(same(bands, {188.0 / 3, 0, 188.0 / 3, 21}), "Pixels become points by the content scale");
  // A window that is not the whole screen only has the bands it overlaps.
  const Edges inset_window = unsafe_bands(safe_pixels, {100, 100, 1000, 500}, 1);
  require(same(inset_window, {88, 0, 0, 0}), "Only the left band reaches a window at (100, 100)");
  const Edges corner = unsafe_bands({50, 20, 900, 560}, {0, 0, 1000, 600}, 2);
  require(same(corner, {25, 10, 25, 10}), "Every edge has its own band");
  // A band never exceeds the window.
  const Edges clamped = unsafe_bands({400, 0, 100, 600}, {0, 0, 300, 600}, 1);
  require(near(clamped.left, 300) && near(clamped.right, 0), "A band is at most the window");
}

void no_information_is_no_band() {
  require(same(unsafe_bands({}, screen_pixels, 3), {}), "Headless and desktop display servers report an empty rectangle");
  require(same(unsafe_bands({0, 0, 0, 100}, screen_pixels, 3), {}), "A rectangle without width is empty");
  require(same(unsafe_bands(safe_pixels, {}, 3), {}), "An empty window has no bands");
  for (double scale : {0.0, -1.0, std::numeric_limits<double>::infinity(), std::nan("")}) {
    require(same(unsafe_bands(safe_pixels, screen_pixels, scale), {}), "A scale that is not positive and finite gives no band");
  }
  // Safe area covering the whole window: nothing is unsafe.
  require(same(unsafe_bands(screen_pixels, screen_pixels, 3), {}), "A safe area that is the whole window has no band");
}

void a_view_gets_the_part_of_each_band_it_reaches() {
  const Edges unsafe{47, 20, 47.5, 21};
  const double width = 844, height = 390;
  // The whole window: exactly the bands.
  require(same(view_insets({0, 0, width, height}, width, height, unsafe), unsafe), "A full-window view gets every band");
  // A view whose edge is inside a band loses the distance to the window edge.
  require(same(view_insets({40, 0, width - 40, height}, width, height, unsafe), {7, 20, 47.5, 21}),
      "The distance from the window edge to the left of the view comes off the left band");
  // A view clear of every band gets nothing, whatever the bands are.
  require(same(view_insets({100, 100, 200, 100}, width, height, unsafe), {}), "A view in the middle gets no padding");
  // Touching only the top edge: the top band alone.
  require(same(view_insets({100, 0, 200, 50}, width, height, unsafe), {0, 20, 0, 0}), "A view on the top edge gets the top band");
  // Bottom right corner view: right and bottom bands, reduced by the distance to the edges.
  require(same(view_insets({width - 100, height - 60, 90, 50}, width, height, unsafe), {0, 0, 37.5, 11}),
      "A view 10 pt from the right and bottom edges gets the bands less 10 pt");
  // Nested: the inner view starts where the outer view's padding ended, so it has nothing left to overlap.
  const Frame inner{unsafe.left, unsafe.top, width - unsafe.left - unsafe.right, height - unsafe.top - unsafe.bottom};
  require(same(view_insets(inner, width, height, unsafe), {}), "A view inside the outer padding has no overlap");
  // Never negative.
  require(same(view_insets({500, 200, 100, 100}, width, height, {0, 0, 0, 0}), {}), "No band, no padding");
}

void padding_is_rounded_to_a_pixel() {
  require(near(round_to_pixel(62.7, 3), 188.0 / 3), "62.7 pt is 188/3 at scale 3");
  require(near(round_to_pixel(47.5, 2), 47.5), "47.5 is a pixel at scale 2");
  require(near(round_to_pixel(0.24, 2), 0), "A quarter point is below half a pixel");
  // Half a pixel rounds away from zero, as the C round in RCTRoundPixelValue.
  require(near(round_to_pixel(47.25, 2), 47.5), "A tie rounds up");
  require(same(padding_for({0, 0, 844, 390}, 844, 390, {47.3, 20.1, 47.7, 21.2}, 3),
                  {round_to_pixel(47.3, 3), round_to_pixel(20.1, 3), round_to_pixel(47.7, 3), round_to_pixel(21.2, 3)}),
      "Each side is rounded on its own");
}

void a_side_must_move_by_the_threshold() {
  // 1/scale + 0.01: one pixel is under it, two pixels are over it.
  require(near(update_threshold(2), 0.51) && near(update_threshold(3), 1.0 / 3 + 0.01), "The threshold is a pixel and a little");
  const Edges base{47, 20, 47, 21};
  require(!needs_update(base, base, 2), "No change, no update");
  require(!needs_update(base, {47.5, 20, 47, 21}, 2), "One pixel at scale 2 (0.5 pt) does not update");
  require(needs_update(base, {48, 20, 47, 21}, 2), "Two pixels at scale 2 (1 pt) update");
  require(needs_update(base, {47, 20, 47, 19.5}, 2), "Any one side is enough");
  require(!needs_update(base, {47, 20.3, 47, 21}, 3), "One pixel at scale 3 (0.33 pt) does not update");
  require(needs_update(base, {47, 20.7, 47, 21}, 3), "Two pixels at scale 3 (0.67 pt) update");
  require(needs_update({0, 0, 0, 0}, {0.5101, 0, 0, 0}, 2), "A move a hair over the threshold updates");
  require(!needs_update({0, 0, 0, 0}, {0.5099, 0, 0, 0}, 2), "...and a hair under it does not");
}

void a_layout_does_not_need_the_view_to_be_rounded_twice() {
  // padding_for output is already on the pixel grid, so rounding it again changes nothing.
  const Edges padding = padding_for({10, 5, 800, 380}, 844, 390, {47.3, 20.1, 47.7, 21.2}, 3);
  require(same(round_to_pixels(padding, 3), padding), "Rounding is idempotent");
}
}  // namespace

int main() {
  the_bands_are_what_the_safe_area_leaves_out();
  no_information_is_no_band();
  a_view_gets_the_part_of_each_band_it_reaches();
  padding_is_rounded_to_a_pixel();
  a_side_must_move_by_the_threshold();
  a_layout_does_not_need_the_view_to_be_rounded_twice();
  std::cout << "DISPLAY_INSETS_CORE_PASSED\n";
}
