#pragma once

#include <algorithm>
#include <cmath>

// The pure arithmetic behind RN's SafeAreaView on this host. It needs neither Godot nor RN, so that
// native/display_insets_core_test.cpp can state each rule with numbers.
//
// Two things are computed, as UIKit and RN's iOS SafeAreaView do:
//   unsafe_bands     the part of each edge of the window that the OS leaves out (the notch, the home indicator), in
//                    Fabric points, from the rectangle DisplayServer.get_display_safe_area() reports in screen pixels;
//   view_insets      UIKit's safeAreaInsets of one view: for each edge, the part of that band the view's frame reaches.
// padding_for then rounds each side to a pixel and needs_update applies the threshold, both exactly as
// React/Fabric/Mounting/ComponentViews/SafeAreaView/RCTSafeAreaViewComponentView.mm (_updateStateIfNecessary) does.
namespace fabric_godot::display_insets {

struct Edges {
  double left{};
  double top{};
  double right{};
  double bottom{};
  bool operator==(const Edges &) const = default;
};

struct Frame {
  double x{};
  double y{};
  double width{};
  double height{};
};

inline bool is_empty(const Frame &frame) { return !(frame.width > 0 && frame.height > 0); }

// The bands of `window` that the safe area leaves out, in Fabric points. Both rectangles are in screen pixels (the
// window's position is its place on the screen) and `pixels_per_point` is the window's content scale. An empty safe area
// is no information (headless and desktop display servers report none): no band.
inline Edges unsafe_bands(const Frame &safe_area, const Frame &window, double pixels_per_point) {
  if (is_empty(safe_area) || is_empty(window) || !(pixels_per_point > 0) || !std::isfinite(pixels_per_point)) {
    return {};
  }
  const auto band = [&](double value, double limit) { return std::clamp(value, 0.0, limit) / pixels_per_point; };
  return {band(safe_area.x - window.x, window.width),
      band(safe_area.y - window.y, window.height),
      band((window.x + window.width) - (safe_area.x + safe_area.width), window.width),
      band((window.y + window.height) - (safe_area.y + safe_area.height), window.height)};
}

// UIKit's safeAreaInsets of a view whose frame (in the window's points) is `frame`, in a window of the given size whose
// unsafe bands are `unsafe`: the part of each band that the frame overlaps. The distance from a window edge to the
// view's edge is what the band loses, and the result is never negative.
inline Edges view_insets(const Frame &frame, double window_width, double window_height, const Edges &unsafe) {
  return {std::max(0.0, unsafe.left - frame.x),
      std::max(0.0, unsafe.top - frame.y),
      std::max(0.0, unsafe.right - (window_width - (frame.x + frame.width))),
      std::max(0.0, unsafe.bottom - (window_height - (frame.y + frame.height)))};
}

// RCTRoundPixelValue: the nearest multiple of one pixel at this scale.
inline double round_to_pixel(double value, double scale) { return std::round(value * scale) / scale; }

inline Edges round_to_pixels(const Edges &edges, double scale) {
  return {round_to_pixel(edges.left, scale), round_to_pixel(edges.top, scale), round_to_pixel(edges.right, scale),
      round_to_pixel(edges.bottom, scale)};
}

// The padding a SafeAreaView's State should hold: its view_insets, each side rounded to a pixel.
inline Edges padding_for(const Frame &frame, double window_width, double window_height, const Edges &unsafe, double scale) {
  return round_to_pixels(view_insets(frame, window_width, window_height, unsafe), scale);
}

// "Size of a pixel plus some small threshold": a side must move by at least this much for the State to change.
inline double update_threshold(double scale) { return 1.0 / scale + 0.01; }

// RCTSafeAreaViewComponentView leaves the State alone only when every side moved by less than the threshold.
inline bool needs_update(const Edges &current, const Edges &next, double scale) {
  const double threshold = update_threshold(scale);
  return std::abs(next.left - current.left) >= threshold || std::abs(next.top - current.top) >= threshold ||
      std::abs(next.right - current.right) >= threshold || std::abs(next.bottom - current.bottom) >= threshold;
}

}  // namespace fabric_godot::display_insets
