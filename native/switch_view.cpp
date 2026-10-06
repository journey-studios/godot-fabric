#include "switch_view.h"
#include <godot_cpp/classes/input_event_mouse_button.hpp>
#include <godot_cpp/classes/input_event_screen_touch.hpp>
#include <godot_cpp/classes/style_box_flat.hpp>
#include <react/renderer/components/switch/AppleSwitchShadowNode.h>
#include <algorithm>
#include <cmath>

namespace facebook::react {
// The Godot platform half of RN's shared non-Android Switch component, beside
// IOSSwitchShadowNode.mm and MacOSSwitchShadowNode.mm.
extern const char AppleSwitchComponentName[] = "Switch";

Size SwitchShadowNode::measureContent(const LayoutContext &, const LayoutConstraints &) const {
  return {.width = fabric_godot::SwitchIntrinsicWidth, .height = fabric_godot::SwitchIntrinsicHeight};
}
} // namespace facebook::react

using namespace godot;
namespace rn = facebook::react;

namespace {
// Fixed defaults while no color prop is set, modeled on the iOS switch: a light
// gray off track, a green on track and a white thumb.
const Color default_off_track(233 / 255.0, 233 / 255.0, 234 / 255.0);
const Color default_on_track(52 / 255.0, 199 / 255.0, 89 / 255.0);
const Color default_thumb(1, 1, 1);
// A disabled UISwitch is drawn translucent; Godot uses half opacity.
constexpr float disabled_alpha = 0.5;
constexpr int max_transitions = 64;

Color native_color(const rn::SharedColor &color, const Color &fallback) {
  if (!color) return fallback;
  auto components = rn::colorComponentsFromColor(color);
  return Color(components.red, components.green, components.blue, components.alpha);
}
folly::dynamic hex(const rn::SharedColor &color) {
  if (!color) return nullptr;
  return native_color(color, Color()).to_html(true).utf8().get_data();
}
std::string hex(const Color &color) { return color.to_html(true).utf8().get_data(); }
}

void GodotSwitch::_bind_methods() {
  ADD_SIGNAL(MethodInfo("toggled", PropertyInfo(Variant::BOOL, "value")));
}

void GodotSwitch::apply(const rn::SwitchProps &props, const rn::SwitchProps *previous) {
  if (!initialized_ || !previous || previous->value != props.value) change(props.value, "props");
  initialized_ = true;
  if (props.disabled != disabled_) {
    disabled_ = props.disabled;
    // A control disabled mid-press must not complete that press later.
    if (disabled_ && press_ != Press::None) { press_ = Press::None; ++canceled_presses_; }
  }
  // Switch.js sends trackColor.false/true and thumbColor as the iOS props
  // tintColor, onTintColor and thumbTintColor. Like RCTSwitchComponentView,
  // the generated thumbColor/trackColorFor* fields are parsed but not drawn.
  tint_ = props.tintColor;
  on_tint_ = props.onTintColor;
  thumb_tint_ = props.thumbTintColor;
  queue_redraw();
}

void GodotSwitch::set_value(bool value) {
  ++commands_;
  change(value, "command");
}

void GodotSwitch::change(bool value, const char *cause) {
  if (on_ == value && initialized_) return;
  on_ = value;
  transitions_.emplace_back(value, cause);
  if (transitions_.size() > max_transitions) transitions_.pop_front();
  queue_redraw();
}

void GodotSwitch::toggle() {
  ++toggles_;
  change(!on_, "input");
  // The runtime compares this value with the committed value prop before it
  // emits RN's onChange (RCTSwitchComponentView onChange:).
  emit_signal("toggled", on_);
}

bool GodotSwitch::inside(Vector2 point) const {
  return Rect2(Vector2(), get_size()).has_point(point);
}

void GodotSwitch::_gui_input(const Ref<InputEvent> &event) {
  if (event.is_null()) return;
  // A touch also arrives as Godot's emulated mouse (and the reverse when touch
  // emulation is enabled). Like the Fabric pointer route, only the original
  // device's event counts, so one tap toggles once.
  if (event->get_device() == InputEvent::DEVICE_ID_EMULATION) {
    ++ignored_emulated_;
    return;
  }
  if (auto *mouse = Object::cast_to<InputEventMouseButton>(event.ptr())) {
    if (mouse->get_button_index() != MOUSE_BUTTON_LEFT) return;
    if (mouse->is_pressed() && !mouse->is_canceled()) {
      if (!disabled_ && press_ == Press::None && inside(mouse->get_position())) press_ = Press::Mouse;
      return;
    }
    if (press_ != Press::Mouse) return;
    press_ = Press::None;
    // Godot's synthetic release when it drops mouse focus uses an internal
    // negative device. Only an actual release inside the control activates.
    if (mouse->is_canceled() || event->get_device() < 0 || !inside(mouse->get_position())) {
      ++canceled_presses_;
      return;
    }
    toggle();
    return;
  }
  if (auto *touch = Object::cast_to<InputEventScreenTouch>(event.ptr())) {
    if (touch->is_pressed() && !touch->is_canceled()) {
      if (!disabled_ && press_ == Press::None && inside(touch->get_position())) {
        press_ = Press::Touch;
        touch_index_ = touch->get_index();
      }
      return;
    }
    if (press_ != Press::Touch || touch->get_index() != touch_index_) return;
    press_ = Press::None;
    touch_index_ = -1;
    if (touch->is_canceled() || !inside(touch->get_position())) {
      ++canceled_presses_;
      return;
    }
    toggle();
  }
}

void GodotSwitch::_notification(int what) {
  // Hiding or detaching drops Godot's GUI focus without a release event.
  if ((what == NOTIFICATION_VISIBILITY_CHANGED && !is_visible_in_tree()) || what == NOTIFICATION_EXIT_TREE) {
    if (press_ != Press::None) ++canceled_presses_;
    press_ = Press::None;
    touch_index_ = -1;
  }
}

Color GodotSwitch::track_color() const {
  return on_ ? native_color(on_tint_, default_on_track) : native_color(tint_, default_off_track);
}

Color GodotSwitch::thumb_color() const { return native_color(thumb_tint_, default_thumb); }

void GodotSwitch::_draw() {
  const auto size = get_size();
  if (size.x <= 0 || size.y <= 0) return;
  // The Panel has already painted the host appearance. The track fills the
  // Yoga frame; the thumb is a circle inset by two points.
  const float alpha = disabled_ ? disabled_alpha : 1;
  Color track = track_color(), thumb = thumb_color();
  track.a *= alpha;
  thumb.a *= alpha;
  const float radius = std::min(size.x, size.y) / 2;
  Ref<StyleBoxFlat> pill;
  pill.instantiate();
  pill->set_bg_color(track);
  pill->set_corner_radius_all(static_cast<int>(std::ceil(radius)));
  pill->set_anti_aliased(true);
  draw_style_box(pill, Rect2(Vector2(), size));
  const float thumb_radius = std::max(0.0f, radius - 2);
  const Vector2 center(on_ ? size.x - radius : radius, size.y / 2);
  draw_circle(center, thumb_radius, thumb, true, -1, true);
  ++draws_;
  drawn_ = folly::dynamic::object("track", hex(track))("thumb", hex(thumb))
      ("thumbX", center.x)("thumbY", center.y)("thumbRadius", thumb_radius)
      ("width", size.x)("height", size.y)("value", on_);
}

folly::dynamic GodotSwitch::snapshot() const {
  auto transitions = folly::dynamic::array();
  for (const auto &[value, cause] : transitions_)
    transitions.push_back(folly::dynamic::object("value", value)("cause", cause));
  return folly::dynamic::object("value", on_)("disabled", disabled_)
      ("tintColor", hex(tint_))("onTintColor", hex(on_tint_))("thumbTintColor", hex(thumb_tint_))
      ("trackColor", hex(track_color()))("thumbColor", hex(thumb_color()))
      ("pressing", press_ == Press::Mouse ? "mouse" : press_ == Press::Touch ? "touch" : "none")
      ("toggles", toggles_)("commands", commands_)("canceledPresses", canceled_presses_)
      ("ignoredEmulated", ignored_emulated_)
      ("draws", draws_)("drawn", drawn_)("transitions", std::move(transitions));
}
