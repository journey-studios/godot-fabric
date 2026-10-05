#include "pointer_adapter.h"
#include <godot_cpp/classes/input_event_mouse_button.hpp>
#include <godot_cpp/classes/input_event_mouse_motion.hpp>
#include <godot_cpp/classes/input_event_screen_touch.hpp>
#include <godot_cpp/classes/input_event_screen_drag.hpp>
#include <algorithm>
#include <cmath>
#include <limits>

namespace fabric_godot {
using namespace godot;
namespace {
int pointer_buttons(BitField<MouseButtonMask> mask) {
  const auto value = static_cast<uint64_t>(mask);
  return ((value & MOUSE_BUTTON_MASK_LEFT) ? 1 : 0) |
      ((value & MOUSE_BUTTON_MASK_RIGHT) ? 2 : 0) |
      ((value & MOUSE_BUTTON_MASK_MIDDLE) ? 4 : 0) |
      ((value & MOUSE_BUTTON_MASK_MB_XBUTTON1) ? 8 : 0) |
      ((value & MOUSE_BUTTON_MASK_MB_XBUTTON2) ? 16 : 0);
}
int pointer_button(MouseButton button) {
  switch (button) {
    case MOUSE_BUTTON_LEFT: return 0;
    case MOUSE_BUTTON_MIDDLE: return 1;
    case MOUSE_BUTTON_RIGHT: return 2;
    case MOUSE_BUTTON_XBUTTON1: return 3;
    case MOUSE_BUTTON_XBUTTON2: return 4;
    default: return -1;
  }
}
int button_mask(int button) { return button == 1 ? 4 : button == 2 ? 2 : 1 << button; }
void modifiers(rn::PointerEvent &pointer, const InputEventMouse &mouse) {
  pointer.ctrlKey = mouse.is_ctrl_pressed();
  pointer.shiftKey = mouse.is_shift_pressed();
  pointer.altKey = mouse.is_alt_pressed();
  pointer.metaKey = mouse.is_meta_pressed();
}
}
PointerAdapter::PointerAdapter(HitTest hit, LocalPoint local, Project project, Emit emit, EmitPointer emit_pointer)
    : hit_(std::move(hit)), local_(std::move(local)), project_(std::move(project)),
      emit_(std::move(emit)), emit_pointer_(std::move(emit_pointer)) {}
bool PointerAdapter::input(const Ref<InputEvent> &event, int pointer_id, bool primary) {
  invalid_coordinates_ = false;
  if (event.is_null() || pointer_id <= 0) return false;
  // Godot marks mouse-from-touch and touch-from-mouse with device -1. Do not
  // duplicate a physical gesture when project input emulation is enabled.
  if (event->get_device() == -1) return false;
  if (Ref<InputEventMouseButton> mouse = event; mouse.is_valid()) {
    const int button = pointer_button(mouse->get_button_index());
    if (button < 0) return false;
    if (mouse->is_canceled()) { cancel_pointer(pointer_id); return true; }
    auto found = pointers_.find(pointer_id);
    const int previous_buttons = found == pointers_.end() ? 0 : found->second.event.buttons;
    auto *current = sample(pointer_id, mouse->get_position(), true, primary);
    if (!current) return true;
    current->event.buttons = pointer_buttons(mouse->get_button_mask());
    if (!current->event.buttons) current->event.buttons = previous_buttons;
    // Injected events may omit button_mask. The changed button remains an
    // authoritative sample even when the rest of the native mask is absent.
    if (mouse->is_pressed()) current->event.buttons |= button_mask(button);
    else current->event.buttons &= ~button_mask(button);
    current->event.button = button;
    current->event.pressure = current->event.buttons ? 0.5 : 0;
    modifiers(current->event, *mouse.ptr());
    current->active = current->event.buttons != 0;
    const auto phase = previous_buttons == 0 && current->active ? "down" :
        previous_buttons != 0 && !current->active ? "up" : "move";
    pointer(pointer_id, phase);
    if (mouse->get_button_index() == MOUSE_BUTTON_LEFT) {
      if (mouse->is_pressed()) {
        current->touch_id = 0;
        start(0, mouse->get_position());
      } else {
        current->touch_id = -1;
        update(0, mouse->get_position(), "end");
      }
    }
  } else if (Ref<InputEventMouseMotion> motion = event; motion.is_valid()) {
    auto *current = sample(pointer_id, motion->get_position(), true, primary);
    if (!current) return true;
    const int buttons = pointer_buttons(motion->get_button_mask());
    if (buttons || !current->active) current->event.buttons = buttons;
    current->event.button = -1;
    current->event.pressure = current->event.buttons ? 0.5 : 0;
    modifiers(current->event, *motion.ptr());
    pointer(pointer_id, "move");
    update(0, motion->get_position(), "move");
  } else if (Ref<InputEventScreenTouch> touch = event; touch.is_valid()) {
    if (touch->get_index() < 0 || touch->get_index() == std::numeric_limits<int>::max()) return false;
    if (touch->is_canceled()) { cancel_pointer(pointer_id); return true; }
    auto found = pointers_.find(pointer_id);
    if (!touch->is_pressed() && found == pointers_.end()) return true;
    if (touch->is_pressed() && found != pointers_.end() && found->second.active) return true;
    auto *current = sample(pointer_id, touch->get_position(), false, primary);
    if (!current) return true;
    current->event.button = 0;
    current->event.buttons = touch->is_pressed() ? 1 : 0;
    current->event.pressure = touch->is_pressed() ? 0.5 : 0;
    current->active = touch->is_pressed();
    current->touch_id = touch->get_index() + 1;
    const int touch_id = current->touch_id;
    pointer(pointer_id, touch->is_pressed() ? "down" : "up");
    if (touch->is_pressed()) start(touch_id, touch->get_position());
    else {
      update(touch_id, touch->get_position(), "end");
      pointers_.erase(pointer_id);
    }
  } else if (Ref<InputEventScreenDrag> drag = event; drag.is_valid()) {
    if (drag->get_index() < 0 || drag->get_index() == std::numeric_limits<int>::max()) return false;
    auto found = pointers_.find(pointer_id);
    if (found == pointers_.end() || !found->second.active) return true;
    auto *current = sample(pointer_id, drag->get_position(), false, primary);
    if (!current) return true;
    current->event.button = -1;
    current->event.buttons = 1;
    current->event.pressure = drag->get_pressure() > 0 && std::isfinite(drag->get_pressure()) ?
        std::min(1.0f, drag->get_pressure()) : 0.5;
    pointer(pointer_id, "move");
    update(drag->get_index() + 1, drag->get_position(), "move");
  } else return false;
  return true;
}
PointerAdapter::PointerSample *PointerAdapter::sample(int id, Vector2 position, bool mouse, bool primary) {
  const int target = hit_(position);
  // A missing physical hit is distinct from the touch gesture's origin and
  // from RN's capture override. The upstream processor receives a null target
  // so it can leave the hover path or route an active capture itself.
  const auto local = target ? local_(target, position) : Vector2();
  const auto projected = project_(position);
  if (!local.is_finite() || !projected.page.is_finite() || !projected.screen.is_finite()) {
    invalid_coordinates_ = true;
    cancel_pointer(id);
    return nullptr;
  }
  auto &current = pointers_[id];
  current.viewport_point = position;
  current.target = target;
  current.mouse = mouse;
  auto &event = current.event;
  event.pointerId = id;
  event.pointerType = mouse ? "mouse" : "touch";
  event.clientPoint = {projected.page.x, projected.page.y};
  event.screenPoint = {projected.screen.x, projected.screen.y};
  event.offsetPoint = {local.x, local.y};
  event.width = event.height = 1;
  event.isPrimary = primary;
  event.timeStamp = rn::HighResTimeStamp::now();
  return &current;
}
void PointerAdapter::pointer(int id, const std::string &phase) {
  auto found = pointers_.find(id);
  if (found == pointers_.end()) return;
  if (phase == "down") {
    ++pointer_downs_;
    // A mouse survives Up as hover and can reuse its pointer ID. New buttons
    // start a new contact even if no Down listener causes a projection; old
    // queued envelopes keep their own history instead of lending it forward.
    found->second.geometry = std::make_shared<PointerGeometryHistory>();
  }
  else if (phase == "move") ++pointer_moves_;
  else if (phase == "up") ++pointer_ups_;
  else if (phase == "cancel") ++pointer_cancels_;
  else if (phase == "leave") ++pointer_leaves_;
  emit_pointer_(found->second.target, phase, found->second.event, found->second.viewport_point, found->second.geometry);
}
void PointerAdapter::leave_mouse(int id, const Vector2 *position) {
  auto found = pointers_.find(id);
  if (found == pointers_.end() || !found->second.mouse || found->second.active) return;
  if (position && !sample(id, *position, true, found->second.event.isPrimary)) return;
  found->second.event.button = -1;
  found->second.event.buttons = 0;
  found->second.event.pressure = 0;
  found->second.event.timeStamp = rn::HighResTimeStamp::now();
  found->second.target = 0;
  pointer(id, "leave");
  pointers_.erase(id);
}
std::vector<int> PointerAdapter::pointer_ids() const {
  std::vector<int> ids;
  for (const auto &[id, current] : pointers_) ids.push_back(id);
  return ids;
}
void PointerAdapter::cancel_pointer(int id) {
  auto found = pointers_.find(id);
  if (found == pointers_.end()) return;
  if (!found->second.active) { leave_mouse(id); return; }
  found->second.event.button = -1;
  found->second.event.buttons = 0;
  found->second.event.pressure = 0;
  found->second.event.timeStamp = rn::HighResTimeStamp::now();
  const int touch_id = found->second.touch_id;
  pointer(id, "cancel");
  pointers_.erase(id);
  auto touch = touches_.find(touch_id);
  if (touch != touches_.end()) {
    auto canceled = touch->second;
    touches_.erase(touch);
    canceled.force = 0;
    canceled.timeStamp = rn::HighResTimeStamp::now();
    ++cancels_;
    dispatch(canceled, "cancel");
  }
  if (touches_.empty() && responder_tag_) responder(responder_tag_, false, false);
}
void PointerAdapter::start(int id, Vector2 position) {
  if (touches_.contains(id)) return;
  const int target = hit_(position);
  if (!target) return;
  const auto local = local_(target, position);
  const auto projected = project_(position);
  if (!local.is_finite() || !projected.page.is_finite() || !projected.screen.is_finite()) {
    invalid_coordinates_ = true;
    return;
  }
  rn::Touch touch;
  touch.identifier = id;
  touch.target = target;
  touch.force = 1;
  touches_.emplace(id, touch);
  ++starts_;
  update(id, position, "start");
}
void PointerAdapter::update(int id, Vector2 position, const std::string &phase) {
  auto found = touches_.find(id);
  if (found == touches_.end()) return;
  auto &touch = found->second;
  auto local = local_(touch.target, position);
  auto projected = project_(position);
  // An embedding can become non-invertible during an active gesture. Cancel
  // using the last valid sample, never publish fabricated or non-finite points.
  if (!local.is_finite() || !projected.page.is_finite() || !projected.screen.is_finite()) {
    invalid_coordinates_ = true;
    cancel();
    return;
  }
  touch.pagePoint = {projected.page.x, projected.page.y};
  touch.screenPoint = {projected.screen.x, projected.screen.y};
  touch.offsetPoint = {local.x, local.y};
  touch.timeStamp = rn::HighResTimeStamp::now();
  auto changed = touch;
  if (phase == "end") { changed.force = 0; touches_.erase(found); ++ends_; }
  if (phase == "move") ++moves_;
  dispatch(changed, phase);
}
void PointerAdapter::dispatch(const rn::Touch &touch, const std::string &phase) {
  rn::TouchEvent event;
  event.changedTouches.insert(touch);
  for (const auto &[id, current] : touches_) {
    event.touches.insert(current);
    if (current.target == touch.target) event.targetTouches.insert(current);
  }
  emit_(touch.target, phase, std::move(event));
}
void PointerAdapter::responder(int tag, bool active, bool block) {
  if (active) { responder_tag_ = tag; block_native_ = block; ++grants_; }
  else if (responder_tag_ == tag) { responder_tag_ = 0; block_native_ = false; ++releases_; }
}
void PointerAdapter::cancel() {
  const auto ids = pointer_ids();
  for (int id : ids) cancel_pointer(id);
  auto canceled = std::move(touches_);
  touches_.clear();
  if (responder_tag_) responder(responder_tag_, false, false);
  for (auto &[id, touch] : canceled) {
    touch.force = 0;
    touch.timeStamp = rn::HighResTimeStamp::now();
    ++cancels_;
    dispatch(touch, "cancel");
  }
}
void PointerAdapter::removed(int tag) {
  if (tag == responder_tag_) { cancel(); return; }
  std::vector<int> ids;
  for (const auto &[id, current] : pointers_) {
    auto touch = touches_.find(current.touch_id);
    if (current.target == tag || (touch != touches_.end() && touch->second.target == tag)) ids.push_back(id);
  }
  for (int id : ids) cancel_pointer(id);
}
folly::dynamic PointerAdapter::snapshot() const {
  int active = 0, hover = 0;
  for (const auto &[id, current] : pointers_) {
    if (current.active) ++active;
    else if (current.mouse) ++hover;
  }
  return folly::dynamic::object("activeTouches", touches_.size())("responder", responder_tag_)
      ("blockNative", block_native_)("starts", starts_)("moves", moves_)
      ("ends", ends_)("cancels", cancels_)("grants", grants_)("releases", releases_)
      ("activePointers", active)("hoverPointers", hover)("pointerDowns", pointer_downs_)
      ("pointerMoves", pointer_moves_)("pointerUps", pointer_ups_)
      ("pointerCancels", pointer_cancels_)("pointerLeaves", pointer_leaves_);
}
}
