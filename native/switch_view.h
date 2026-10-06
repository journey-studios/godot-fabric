#pragma once
#include <godot_cpp/classes/input_event.hpp>
#include <godot_cpp/classes/panel.hpp>
#include <react/renderer/components/FBReactNativeSpec/Props.h>
#include <folly/dynamic.h>
#include <deque>
#include <string>

namespace fabric_godot {
// Frame of a Switch without an explicit size. RN iOS measures UISwitch's
// intrinsic size plus two points of width (IOSSwitchShadowNode.mm), so it
// varies by iOS release: 61x28 + 2 on iOS 26.3 (the repo's iOS reference
// runtime), 49x31 + 2 on iOS 18.4. Godot reports the iOS 26 frame.
inline constexpr float SwitchIntrinsicWidth = 63;
inline constexpr float SwitchIntrinsicHeight = 28;
}

// RN's non-Android Switch on a Godot Panel. As in RCTSwitchComponentView, the
// host paints the View appearance (Switch.js maps ios_backgroundColor to its
// backgroundColor and borderRadius) and the toggle paints over it. A completed
// tap toggles the native value and emits `toggled`; the runtime decides whether
// that becomes RN's onChange, exactly as the iOS component view does.
class GodotSwitch final : public godot::Panel {
  GDCLASS(GodotSwitch, godot::Panel)
 public:
  // RCTSwitchComponentView updateProps: the value prop applies initially and
  // whenever it changes, never merely because another prop changed.
  void apply(const facebook::react::SwitchProps &props, const facebook::react::SwitchProps *previous);
  // The setValue command changes the native value without emitting onChange.
  void set_value(bool value);
  bool is_on() const { return on_; }
  void _draw() override;
  void _gui_input(const godot::Ref<godot::InputEvent> &event) override;
  void _notification(int what);
  folly::dynamic snapshot() const;
 protected:
  static void _bind_methods();
 private:
  enum class Press { None, Mouse, Touch };
  void change(bool value, const char *cause);
  void toggle();
  bool inside(godot::Vector2 point) const;
  godot::Color track_color() const;
  godot::Color thumb_color() const;
  bool on_{};
  bool disabled_{};
  bool initialized_{};
  facebook::react::SharedColor tint_, on_tint_, thumb_tint_;
  Press press_{Press::None};
  int touch_index_{-1};
  int toggles_{}, commands_{}, canceled_presses_{}, ignored_emulated_{}, draws_{};
  folly::dynamic drawn_ = nullptr;
  std::deque<std::pair<bool, std::string>> transitions_;
};
