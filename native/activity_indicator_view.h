#pragma once
#include <godot_cpp/classes/panel.hpp>
#include <react/renderer/components/FBReactNativeSpec/Props.h>
#include <folly/dynamic.h>

// RN's ActivityIndicatorView (the generated component iOS mounts) on a Godot
// Panel. Like RCTActivityIndicatorViewComponentView, the host paints the View
// appearance and a spinner is drawn over it; the spinner fills the Yoga frame,
// which ActivityIndicator.js sizes (small 20x20, large 36x36 or numeric).
class GodotActivityIndicator final : public godot::Panel {
  GDCLASS(GodotActivityIndicator, godot::Panel)
 public:
  // RCTActivityIndicatorViewComponentView updateProps: start/stop on
  // `animating`, plus color, hidesWhenStopped and size.
  void apply(const facebook::react::ActivityIndicatorViewProps &props,
      const facebook::react::ActivityIndicatorViewProps *previous);
  void _draw() override;
  void _notification(int what);
  folly::dynamic snapshot() const;
 protected:
  static void _bind_methods() {}
 private:
  void set_animating(bool value);
  bool spinner_visible() const { return animating_ || !hides_when_stopped_; }
  bool animating_{};
  bool hides_when_stopped_{true};
  bool large_{};
  facebook::react::SharedColor color_;
  // Unwrapped rotation in turns. It advances with real frame time only while
  // animating, so a stopped spinner keeps its last phase.
  double turns_{};
  int frames_{}, starts_{}, stops_{}, draws_{};
  folly::dynamic drawn_ = nullptr;
};
