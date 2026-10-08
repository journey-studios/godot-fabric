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
PointerAdapter::PointerAdapter(HitTest hit, HitPath path, InsideRoot inside, LocalPoint local, Project project,
    Emit emit, EmitPointer emit_pointer, OtherTouches other_touches)
    : hit_(std::move(hit)), path_(std::move(path)), inside_(std::move(inside)), local_(std::move(local)),
      project_(std::move(project)), emit_(std::move(emit)), emit_pointer_(std::move(emit_pointer)),
      other_touches_(std::move(other_touches)) {}
bool PointerAdapter::input(const Ref<InputEvent> &event, int pointer_id, bool primary,
    PointerInputSource source) {
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
    auto *current = sample(pointer_id, mouse->get_position(), true, primary, source);
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
        start(0, mouse->get_position(), source);
      } else {
        current->touch_id = -1;
        update(0, mouse->get_position(), "end", source);
      }
    }
  } else if (Ref<InputEventMouseMotion> motion = event; motion.is_valid()) {
    auto *current = sample(pointer_id, motion->get_position(), true, primary, source);
    if (!current) return true;
    const int buttons = pointer_buttons(motion->get_button_mask());
    if (buttons || !current->active) current->event.buttons = buttons;
    current->event.button = -1;
    current->event.pressure = current->event.buttons ? 0.5 : 0;
    modifiers(current->event, *motion.ptr());
    pointer(pointer_id, "move");
    update(0, motion->get_position(), "move", source);
  } else if (Ref<InputEventScreenTouch> touch = event; touch.is_valid()) {
    if (touch->get_index() < 0 || touch->get_index() == std::numeric_limits<int>::max()) return false;
    if (touch->is_canceled()) { cancel_pointer(pointer_id); return true; }
    auto found = pointers_.find(pointer_id);
    if (!touch->is_pressed() && found == pointers_.end()) return true;
    if (touch->is_pressed() && found != pointers_.end() && found->second.active) return true;
    auto *current = sample(pointer_id, touch->get_position(), false, primary, source);
    if (!current) return true;
    current->event.button = 0;
    current->event.buttons = touch->is_pressed() ? 1 : 0;
    current->event.pressure = touch->is_pressed() ? 0.5 : 0;
    current->active = touch->is_pressed();
    current->touch_id = touch->get_index() + 1;
    const int touch_id = current->touch_id;
    pointer(pointer_id, touch->is_pressed() ? "down" : "up");
    if (touch->is_pressed()) start(touch_id, touch->get_position(), source);
    else {
      update(touch_id, touch->get_position(), "end", source);
      pointers_.erase(pointer_id);
    }
  } else if (Ref<InputEventScreenDrag> drag = event; drag.is_valid()) {
    if (drag->get_index() < 0 || drag->get_index() == std::numeric_limits<int>::max()) return false;
    auto found = pointers_.find(pointer_id);
    if (found == pointers_.end() || !found->second.active) return true;
    auto *current = sample(pointer_id, drag->get_position(), false, primary, source);
    if (!current) return true;
    current->event.button = -1;
    current->event.buttons = 1;
    current->event.pressure = drag->get_pressure() > 0 && std::isfinite(drag->get_pressure()) ?
        std::min(1.0f, drag->get_pressure()) : 0.5;
    pointer(pointer_id, "move");
    update(drag->get_index() + 1, drag->get_position(), "move", source);
  } else return false;
  return true;
}
PointerAdapter::PointerSample *PointerAdapter::sample(int id, Vector2 position, bool mouse, bool primary,
    const PointerInputSource &source) {
  auto existing = pointers_.find(id);
  const auto &contact_source = existing != pointers_.end() && existing->second.active ?
      existing->second.source : source;
  if (existing != pointers_.end() && existing->second.active &&
      (existing->second.source.window_id != source.window_id ||
       existing->second.source.viewport_id != source.viewport_id ||
       existing->second.source.boundary_mount != source.boundary_mount ||
       existing->second.source.boundary_family != source.boundary_family)) {
    cancel_pointer(id);
    return nullptr;
  }
  const int target = hit_(position, contact_source);
  // A missing physical hit is distinct from the touch gesture's origin and
  // from RN's capture override. Inside the root RN resolves it to the root,
  // which keeps the hover path; outside, the processor receives a null target
  // so it can leave the hover path or route an active capture itself.
  const bool root = !target && inside_(position, contact_source);
  const auto projected = project_(position, contact_source);
  const auto local = target ? local_(target, position, contact_source) : root ? projected.page : Vector2();
  if (!local.is_finite() || !projected.page.is_finite() || !projected.screen.is_finite()) {
    invalid_coordinates_ = true;
    cancel_pointer(id);
    return nullptr;
  }
  auto &current = pointers_[id];
  current.viewport_point = position;
  current.target = target;
  current.root = root;
  if (!current.active) current.source = source;
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
  auto &current = found->second;
  // A taken-over contact already ended for JS with its cancel. A mouse
  // released afterwards hovers again from its next sample.
  if (current.taken) {
    if (phase == "up") current.taken = false;
    return;
  }
  if (phase == "down") {
    ++pointer_downs_;
    // A mouse survives Up as hover and can reuse its pointer ID. New buttons
    // start a new contact even if no Down listener causes a projection; old
    // queued envelopes keep their own history instead of lending it forward.
    current.geometry = std::make_shared<PointerGeometryHistory>();
    // RN keeps the Down hit path for the release's click. An empty point
    // inside the root resolves to the root alone, which never clicks.
    current.down_path = current.target ? path_(current.target, current.source) : std::vector<int>();
  }
  else if (phase == "move") ++pointer_moves_;
  else if (phase == "up") ++pointer_ups_;
  else if (phase == "cancel") ++pointer_cancels_;
  else if (phase == "leave") ++pointer_leaves_;
  emit_pointer_(current.target, current.root, phase, current.event, current.viewport_point,
      current.source, current.geometry);
  if (phase == "up") click(current);
}
void PointerAdapter::click(PointerSample &current) {
  const auto down = std::move(current.down_path);
  current.down_path.clear();
  // Like iOS and the W3C model, only the primary pointer's main button clicks.
  if (!current.event.isPrimary || current.event.button != 0 || down.empty() || !current.target) return;
  // RN (Android's JSPointerDispatcher) clicks the first view of the release's
  // hit path that the Down's path shares: their deepest common mounted view.
  // When they share only the root, RN drops the click there.
  for (int tag : path_(current.target, current.source)) {
    if (std::find(down.begin(), down.end(), tag) == down.end()) continue;
    ++pointer_clicks_;
    emit_pointer_(tag, false, "click", current.event, current.viewport_point,
        current.source, current.geometry);
    return;
  }
}
// A native scroll gesture cancels the child stream exactly once when it wins.
void PointerAdapter::takeover(int tag, int pointer_id) {
  auto found = pointers_.find(pointer_id);
  if (found == pointers_.end()) return;
  auto &current = found->second;
  if (!current.active || current.taken ||
      std::find(current.down_path.begin(), current.down_path.end(), tag) == current.down_path.end()) return;
  current.down_path.clear();
  auto cancel = current.event;
  cancel.button = -1;
  cancel.buttons = 0;
  cancel.pressure = 0;
  cancel.timeStamp = rn::HighResTimeStamp::now();
  ++pointer_cancels_;
  ++pointer_takeovers_;
  current.taken = true;
  emit_pointer_(current.target, current.root, "cancel", cancel, current.viewport_point,
      current.source, current.geometry);
  auto touch = touches_.find(current.touch_id);
  if (touch != touches_.end()) {
    auto canceled = touch->second.event;
    touches_.erase(touch);
    canceled.force = 0;
    canceled.timeStamp = rn::HighResTimeStamp::now();
    ++cancels_;
    dispatch(canceled, "cancel");
  }
}
void PointerAdapter::leave_mouse(int id, const Vector2 *position) {
  auto found = pointers_.find(id);
  if (found == pointers_.end() || !found->second.mouse || found->second.active) return;
  if (position && !sample(id, *position, true, found->second.event.isPrimary, found->second.source)) return;
  found->second.event.button = -1;
  found->second.event.buttons = 0;
  found->second.event.pressure = 0;
  found->second.event.timeStamp = rn::HighResTimeStamp::now();
  found->second.target = 0;
  found->second.root = false;
  pointer(id, "leave");
  pointers_.erase(id);
}
std::vector<int> PointerAdapter::pointer_ids() const {
  std::vector<int> ids;
  for (const auto &[id, current] : pointers_) ids.push_back(id);
  return ids;
}
std::vector<rn::Touch> PointerAdapter::touches() const {
  std::vector<rn::Touch> active;
  for (const auto &[id, contact] : touches_) active.push_back(contact.event);
  return active;
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
    auto canceled = touch->second.event;
    touches_.erase(touch);
    canceled.force = 0;
    canceled.timeStamp = rn::HighResTimeStamp::now();
    ++cancels_;
    dispatch(canceled, "cancel");
  }
  if (touches_.empty() && responder_tag_) responder(responder_tag_, false, false);
}
void PointerAdapter::start(int id, Vector2 position, const PointerInputSource &source) {
  if (touches_.contains(id)) return;
  const int target = hit_(position, source);
  if (!target) return;
  const auto local = local_(target, position, source);
  const auto projected = project_(position, source);
  if (!local.is_finite() || !projected.page.is_finite() || !projected.screen.is_finite()) {
    invalid_coordinates_ = true;
    return;
  }
  TouchContact contact;
  contact.event.identifier = id;
  contact.event.target = target;
  contact.event.force = 1;
  contact.source = source;
  touches_.emplace(id, std::move(contact));
  ++starts_;
  update(id, position, "start", source);
}
void PointerAdapter::update(int id, Vector2 position, const std::string &phase,
    const PointerInputSource &source) {
  auto found = touches_.find(id);
  if (found == touches_.end()) return;
  auto &contact = found->second;
  const auto &contact_source = contact.source;
  auto &touch = contact.event;
  auto local = local_(touch.target, position, contact_source);
  auto projected = project_(position, contact_source);
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
  for (const auto &[id, contact] : touches_) {
    const auto &current = contact.event;
    event.touches.insert(current);
    if (current.target == touch.target) event.targetTouches.insert(current);
  }
  // Another root's active touches keep its responder's gesture alive: RN
  // releases the responder only when no listed touch remains in it.
  for (const auto &other : other_touches_()) event.touches.insert(other);
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
  for (auto &[id, contact] : canceled) {
    auto &touch = contact.event;
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
    // A taken-over contact has no pointer target left; only its touch counts.
    if ((!current.taken && current.target == tag) ||
        (touch != touches_.end() && touch->second.event.target == tag))
      ids.push_back(id);
  }
  for (int id : ids) cancel_pointer(id);
}
folly::dynamic PointerAdapter::snapshot() const {
  int active = 0, hover = 0, taken = 0;
  for (const auto &[id, current] : pointers_) {
    if (current.active) ++active;
    else if (current.mouse) ++hover;
    if (current.taken) ++taken;
  }
  return folly::dynamic::object("activeTouches", touches_.size())("responder", responder_tag_)
      ("blockNative", block_native_)("starts", starts_)("moves", moves_)
      ("ends", ends_)("cancels", cancels_)("grants", grants_)("releases", releases_)
      ("activePointers", active)("hoverPointers", hover)("pointerDowns", pointer_downs_)
      ("pointerMoves", pointer_moves_)("pointerUps", pointer_ups_)
      ("pointerCancels", pointer_cancels_)("pointerLeaves", pointer_leaves_)("pointerClicks", pointer_clicks_)
      ("pointerTakeovers", pointer_takeovers_)("takenPointers", taken);
}
}
