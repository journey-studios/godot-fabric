#include "scroll_adapter.h"
#include <godot_cpp/classes/style_box_empty.hpp>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <stdexcept>

using namespace godot;
namespace fabric_godot {
ScrollAdapter::ScrollAdapter(ScrollContainer &control) : control_(control) {
  Ref<StyleBoxEmpty> panel;
  panel.instantiate();
  control_.add_theme_stylebox_override("panel", panel);
  control_.set_clip_contents(true);
}
void ScrollAdapter::apply(const rn::ShadowView &shadow) {
  const auto next = std::static_pointer_cast<const rn::ScrollViewProps>(shadow.props);
  const bool offset_changed = !props_ || props_->contentOffset != next->contentOffset;
  props_ = next;
  state_ = std::static_pointer_cast<const rn::ScrollViewShadowNode::ConcreteState>(shadow.state);
  emitter_ = std::static_pointer_cast<const rn::ScrollViewEventEmitter>(shadow.eventEmitter);
  const auto size = state_->getData().getContentSize();
  content_size_ = {size.width, size.height};
  control_.set_horizontal_scroll_mode(props_->horizontal ? ScrollContainer::SCROLL_MODE_SHOW_NEVER : ScrollContainer::SCROLL_MODE_DISABLED);
  control_.set_vertical_scroll_mode(props_->horizontal ? ScrollContainer::SCROLL_MODE_DISABLED : ScrollContainer::SCROLL_MODE_SHOW_NEVER);
  if (!props_->scrollEnabled) end_drag();
  if (offset_changed) {
    // Initial layout may not have attached its content yet. layout() applies
    // the requested offset after native ranges are known.
    requested_offset_ = Vector2(props_->contentOffset.x, props_->contentOffset.y);
  }
}
Vector2 ScrollAdapter::maximum() const {
  const auto size = control_.get_size();
  return {props_->horizontal ? std::max<real_t>(0, content_size_.x - size.x) : 0,
          props_->horizontal ? 0 : std::max<real_t>(0, content_size_.y - size.y)};
}
void ScrollAdapter::layout() {
  // ScrollContainer expects one content Control. Its minimum is the committed
  // Yoga frame, so Container sorting cannot substitute a second layout engine.
  for (int i = 0; i < control_.get_child_count(); ++i) {
    auto *child = Object::cast_to<Control>(control_.get_child(i));
    if (child) child->set_custom_minimum_size(content_size_);
  }
  // Godot caches the largest child while computing its minimum. Refresh that
  // extent before sorting, including the first mount with contentOffset != 0.
  static_cast<void>(control_.get_minimum_size());
  control_.notification(Container::NOTIFICATION_SORT_CHILDREN);
  set_offset(requested_offset_.value_or(offset_));
  requested_offset_.reset();
  sample();
}
void ScrollAdapter::set_offset(Vector2 value) {
  const auto max = maximum();
  control_.set_h_scroll(static_cast<int>(std::round(std::clamp<double>(value.x, 0.0, max.x))));
  control_.set_v_scroll(static_cast<int>(std::round(std::clamp<double>(value.y, 0.0, max.y))));
}
rn::ScrollEvent ScrollAdapter::metrics() const {
  rn::ScrollEvent event;
  event.contentOffset = {static_cast<float>(control_.get_h_scroll()), static_cast<float>(control_.get_v_scroll())};
  event.contentSize = {static_cast<float>(content_size_.x), static_cast<float>(content_size_.y)};
  event.containerSize = {static_cast<float>(control_.get_size().x), static_cast<float>(control_.get_size().y)};
  event.zoomScale = 1;
  event.timestamp = std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
  return event;
}
void ScrollAdapter::sample() {
  const auto event = metrics();
  const Vector2 next(event.contentOffset.x, event.contentOffset.y);
  // A fresh state revision can carry an older offset. Publish native authority
  // even when it hasn't moved since the previous frame.
  if (state_->getData().contentOffset != event.contentOffset) {
    state_->updateState([point = event.contentOffset](const rn::ScrollViewState &old) -> std::shared_ptr<const rn::ScrollViewState> {
      if (old.contentOffset == point) return nullptr;
      auto next = old;
      next.contentOffset = point;
      return std::make_shared<const rn::ScrollViewState>(next);
    });
  }
  if (next == offset_) return;
  offset_ = next;
  // RN Android's rule (ReactScrollViewHelper.emitScrollEvent): drop a scroll
  // event while scrollEventThrottle >= max(17 ms, time since the last one).
  // Like iOS, throttles below one 60 Hz frame send every event.
  const double now = event.timestamp * 1000;
  if (props_->scrollEventThrottle >= std::max(17.0, now - last_scroll_ms_)) {
    ++throttled_;
    return;
  }
  last_scroll_ms_ = now;
  ++scrolls_;
  emitter_->onScroll(event);
}
void ScrollAdapter::end_drag() {
  if (!dragging_) return;
  dragging_ = false;
  control_.propagate_notification(Control::NOTIFICATION_SCROLL_END);
  sample();
  rn::ScrollEndDragEvent event(metrics());
  event.targetContentOffset = event.contentOffset;
  emitter_->onScrollEndDrag(event);
  ++ends_;
}
bool ScrollAdapter::command(const std::string &name, const folly::dynamic &args) {
  if (name == "scrollDragEnd") { end_drag(); return true; }
  if (name == "scrollToEnd") { set_offset(maximum()); sample(); return true; }
  if (name != "scrollTo" && name != "scrollDragStart" && name != "scrollDragTo") return false;
  if (!args.isArray() || args.size() != 2 || !args[0].isNumber() || !args[1].isNumber() ||
      !std::isfinite(args[0].asDouble()) || !std::isfinite(args[1].asDouble()))
    throw std::runtime_error(name + " requires two finite coordinates");
  const Vector2 point(args[0].asDouble(), args[1].asDouble());
  if (name == "scrollTo") set_offset(point);
  else if (name == "scrollDragStart" && props_->scrollEnabled) {
    dragging_ = true;
    // React owns this gesture now. Cancel GUI presses that began on native
    // descendants through the same notification as Godot's scroll recognizer.
    control_.propagate_notification(Control::NOTIFICATION_SCROLL_BEGIN);
    drag_origin_ = point;
    drag_offset_ = offset_;
    emitter_->onScrollBeginDrag(metrics());
    ++begins_;
  } else if (name == "scrollDragTo" && dragging_ && props_->scrollEnabled)
    set_offset(drag_offset_ + drag_origin_ - point);
  sample();
  return true;
}
void ScrollAdapter::wheel(int direction, double factor) {
  if (props_->scrollEnabled) {
    const auto delta = 48 * direction * factor;
    set_offset(offset_ + (props_->horizontal ? Vector2(delta, 0) : Vector2(0, delta)));
    sample();
  }
}
folly::dynamic ScrollAdapter::snapshot() const {
  const auto max = maximum();
  const auto &state = state_->getData();
  return folly::dynamic::object("x", offset_.x)("y", offset_.y)
      ("maxX", max.x)("maxY", max.y)("contentWidth", content_size_.x)("contentHeight", content_size_.y)
      ("fabricX", state.contentOffset.x)("fabricY", state.contentOffset.y)
      ("dragging", dragging_)("enabled", props_->scrollEnabled)("scrolls", scrolls_)("throttled", throttled_)
      ("throttle", props_->scrollEventThrottle)("begins", begins_)("ends", ends_);
}
}
