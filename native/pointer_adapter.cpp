#include "pointer_adapter.h"
#include <godot_cpp/classes/input_event_mouse_button.hpp>
#include <godot_cpp/classes/input_event_mouse_motion.hpp>
#include <godot_cpp/classes/input_event_screen_touch.hpp>
#include <godot_cpp/classes/input_event_screen_drag.hpp>

namespace fabric_godot {
using namespace godot;
PointerAdapter::PointerAdapter(HitTest hit, LocalPoint local, Emit emit)
    : hit_(std::move(hit)), local_(std::move(local)), emit_(std::move(emit)) {}
bool PointerAdapter::input(const Ref<InputEvent> &event) {
  // Godot marks mouse-from-touch and touch-from-mouse with device -1. Do not
  // duplicate a physical gesture when project input emulation is enabled.
  if (event->get_device() == -1) return false;
  if (Ref<InputEventMouseButton> mouse = event; mouse.is_valid()) {
    if (mouse->get_button_index() != MOUSE_BUTTON_LEFT) return false;
    if (mouse->is_pressed()) start(0, mouse->get_position());
    else update(0, mouse->get_position(), "end");
  } else if (Ref<InputEventMouseMotion> motion = event; motion.is_valid()) {
    update(0, motion->get_position(), "move");
  } else if (Ref<InputEventScreenTouch> touch = event; touch.is_valid()) {
    if (touch->is_canceled()) { cancel(); return true; }
    if (touch->is_pressed()) start(touch->get_index() + 1, touch->get_position());
    else update(touch->get_index() + 1, touch->get_position(), "end");
  } else if (Ref<InputEventScreenDrag> drag = event; drag.is_valid()) {
    update(drag->get_index() + 1, drag->get_position(), "move");
  } else return false;
  return true;
}
void PointerAdapter::start(int id, Vector2 position) {
  if (touches_.contains(id)) return;
  const int target = hit_(position);
  if (!target) return;
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
  touch.pagePoint = {position.x, position.y};
  touch.screenPoint = touch.pagePoint;
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
  if (tag == responder_tag_) cancel();
  else for (const auto &[id, touch] : touches_)
    if (touch.target == tag) { cancel(); break; }
}
folly::dynamic PointerAdapter::snapshot() const {
  return folly::dynamic::object("activeTouches", touches_.size())("responder", responder_tag_)
      ("blockNative", block_native_)("starts", starts_)("moves", moves_)
      ("ends", ends_)("cancels", cancels_)("grants", grants_)("releases", releases_);
}
}
