#include "scroll_adapter.h"
#include "scroll_throttle.h"
#include <godot_cpp/classes/input_event.hpp>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <stdexcept>

using namespace godot;
namespace fabric_godot {
namespace {
Vector2 gd(ScrollPoint point) { return {static_cast<real_t>(point.x), static_cast<real_t>(point.y)}; }
ScrollPoint core(Vector2 point) { return {point.x, point.y}; }
}
ScrollAdapter::ScrollAdapter(Control &control) : control_(control) {
  control_.set_clip_contents(true);
  control_.set_mouse_filter(Control::MOUSE_FILTER_IGNORE);
  vertical_indicator_ = memnew(Panel);
  vertical_indicator_->set_name("FabricScrollVerticalIndicator");
  vertical_indicator_->set_mouse_filter(Control::MOUSE_FILTER_IGNORE);
  Ref<StyleBoxFlat> vertical_style;
  vertical_style.instantiate();
  vertical_style->set_bg_color(Color(0.35, 0.37, 0.40, 0.72));
  vertical_indicator_->add_theme_stylebox_override("panel", vertical_style);
  control_.add_child(vertical_indicator_);
  horizontal_indicator_ = memnew(Panel);
  horizontal_indicator_->set_name("FabricScrollHorizontalIndicator");
  horizontal_indicator_->set_mouse_filter(Control::MOUSE_FILTER_IGNORE);
  Ref<StyleBoxFlat> horizontal_style;
  horizontal_style.instantiate();
  horizontal_style->set_bg_color(Color(0.35, 0.37, 0.40, 0.72));
  horizontal_indicator_->add_theme_stylebox_override("panel", horizontal_style);
  control_.add_child(horizontal_indicator_);
}
void ScrollAdapter::apply(const rn::ShadowView &shadow) {
  const auto next = std::static_pointer_cast<const rn::ScrollViewProps>(shadow.props);
  if (!std::isfinite(next->contentOffset.x) || !std::isfinite(next->contentOffset.y))
    throw std::runtime_error("ScrollView contentOffset requires finite x/y coordinates");
  if (!std::isfinite(next->scrollEventThrottle) || next->scrollEventThrottle < 0)
    throw std::runtime_error("ScrollView scrollEventThrottle requires a finite non-negative number");
  const auto next_emitter = std::static_pointer_cast<const rn::ScrollViewEventEmitter>(shadow.eventEmitter);
  if (emitter_ != next_emitter && motion_.active()) cancel();
  const bool orientation_changed = props_ && props_->horizontal != next->horizontal;
  if (orientation_changed && (candidate_ || motion_.active())) cancel();
  const bool offset_changed = !props_ || props_->contentOffset != next->contentOffset;
  const bool disabling = props_ && props_->scrollEnabled && !next->scrollEnabled;
  props_ = next;
  state_ = std::static_pointer_cast<const rn::ScrollViewShadowNode::ConcreteState>(shadow.state);
  emitter_ = next_emitter;
  const auto size = state_->getData().getContentSize();
  const bool content_shrank = size.width < content_size_.x || size.height < content_size_.y;
  content_size_ = {size.width, size.height};
  if (content_shrank && candidate_ && candidate_->claimed) {
    motion_.set_offset(clamp_scroll_offset(motion_.offset(), maximum()));
    cancel();
  }
  if (offset_changed && candidate_ && candidate_->claimed) interrupt_motion();
  if (disabling) cancel();
  if (offset_changed) requested_offset_ = ScrollPoint{props_->contentOffset.x, props_->contentOffset.y};
  update_indicators();
}
void ScrollAdapter::set_content_frame(Control &content, ScrollPoint yoga_origin) {
  const auto next_content_id = content.get_instance_id();
  const godot::ObjectID next_id(next_content_id);
  if (content_id_ != next_id && (candidate_ || motion_.active())) cancel();
  content_id_ = next_id;
  content_origin_ = yoga_origin;
}
void ScrollAdapter::clear_content() {
  if (candidate_ || motion_.active()) cancel();
  content_id_ = godot::ObjectID();
}
Control *ScrollAdapter::content() const {
  return Object::cast_to<Control>(ObjectDB::get_instance(content_id_));
}
ScrollPoint ScrollAdapter::maximum() const {
  return scroll_maximum(content_size_, core(control_.get_size()));
}
double ScrollAdapter::now_seconds() const {
  return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
}
void ScrollAdapter::interrupt_motion() {
  if (candidate_ && candidate_->claimed)
    finish_pan(candidate_->pointer_id, candidate_->origin, now_seconds(), true);
  if (motion_.mode() == ScrollMotion::Mode::Momentum) {
    if (emitter_) {
      emitter_->onMomentumScrollEnd(metrics());
      ++momentum_ends_;
    }
  }
  motion_.cancel();
}
void ScrollAdapter::layout() {
  const auto next_viewport = core(control_.get_size());
  const bool viewport_resized = next_viewport.x != viewport_size_.x || next_viewport.y != viewport_size_.y;
  viewport_size_ = next_viewport;
  if (viewport_resized && motion_.active()) cancel();
  auto *mounted_content = content();
  if (!mounted_content) return;
  auto offset = clamp_scroll_offset(requested_offset_.value_or(motion_.offset()), maximum());
  if (requested_offset_) {
    interrupt_motion();
    motion_.set_offset(offset);
    requested_offset_.reset();
  } else if (offset.x != motion_.offset().x || offset.y != motion_.offset().y) {
    cancel();
    motion_.set_offset(offset);
  }
  mounted_content->set_position(gd(scroll_content_position(content_origin_, motion_.offset())));
  if (vertical_indicator_ && vertical_indicator_->get_parent() == &control_)
    control_.move_child(vertical_indicator_, control_.get_child_count() - 1);
  if (horizontal_indicator_ && horizontal_indicator_->get_parent() == &control_)
    control_.move_child(horizontal_indicator_, control_.get_child_count() - 1);
  update_indicators();
  sample();
}
void ScrollAdapter::set_offset(ScrollPoint value) {
  interrupt_motion();
  motion_.set_offset(clamp_scroll_offset(value, maximum()));
  if (auto *mounted_content = content())
    mounted_content->set_position(gd(scroll_content_position(content_origin_, motion_.offset())));
  update_indicators();
  sample();
}
rn::ScrollEvent ScrollAdapter::metrics() const {
  rn::ScrollEvent event;
  const auto offset = motion_.offset();
  event.contentOffset = {static_cast<float>(offset.x), static_cast<float>(offset.y)};
  event.contentSize = {static_cast<float>(content_size_.x), static_cast<float>(content_size_.y)};
  event.containerSize = {static_cast<float>(control_.get_size().x), static_cast<float>(control_.get_size().y)};
  event.zoomScale = 1;
  event.timestamp = static_cast<float>(now_seconds());
  return event;
}
void ScrollAdapter::sample() {
  if (!state_ || !emitter_) return;
  const auto event = metrics();
  if (state_->getData().contentOffset != event.contentOffset) {
    state_->updateState([point = event.contentOffset](const rn::ScrollViewState &old) -> std::shared_ptr<const rn::ScrollViewState> {
      if (old.contentOffset == point) return nullptr;
      auto next = old;
      next.contentOffset = point;
      return std::make_shared<const rn::ScrollViewState>(next);
    });
  }
  const double now = now_seconds() * 1000.0;
  const auto current = motion_.offset();
  if (current.x == last_sampled_.x && current.y == last_sampled_.y) return;
  last_sampled_ = current;
  if (scroll_event_is_throttled(props_->scrollEventThrottle, now - last_scroll_ms_)) {
    ++throttled_;
    return;
  }
  last_scroll_ms_ = now;
  ++scrolls_;
  emitter_->onScroll(event);
}
void ScrollAdapter::emit_end_drag(ScrollPoint velocity, bool momentum) {
  const auto event = metrics();
  rn::ScrollEndDragEvent end(event);
  end.velocity = {static_cast<float>(velocity.x), static_cast<float>(velocity.y)};
  const double friction = ScrollMotion::kFrictionPerSecond;
  end.targetContentOffset = {static_cast<float>(std::clamp(event.contentOffset.x + velocity.x / friction, 0.0, maximum().x)),
      static_cast<float>(std::clamp(event.contentOffset.y + velocity.y / friction, 0.0, maximum().y))};
  if (emitter_) emitter_->onScrollEndDrag(end);
  ++ends_;
  if (momentum && emitter_) { emitter_->onMomentumScrollBegin(event); ++momentum_begins_; }
}
bool ScrollAdapter::command(const std::string &name, const folly::dynamic &args) {
  if (name == "flashScrollIndicators") {
    update_indicators();
    return true;
  }
  if (name == "scrollTo") {
    if (!args.isArray() || args.size() != 3 || !args[0].isNumber() || !args[1].isNumber() || !args[2].isBool() ||
        !std::isfinite(args[0].asDouble()) || !std::isfinite(args[1].asDouble()))
      throw std::runtime_error("scrollTo requires finite x/y coordinates and an animated boolean");
    const ScrollPoint target = clamp_scroll_offset({args[0].asDouble(), args[1].asDouble()}, maximum());
    interrupt_motion();
    if (args[2].getBool()) {
      motion_.replace(target, true, now_seconds());
      sample();
    } else set_offset(target);
    return true;
  }
  if (name == "scrollToEnd") {
    if (!args.isArray() || args.size() != 1 || !args[0].isBool())
      throw std::runtime_error("scrollToEnd requires an animated boolean");
    interrupt_motion();
    const auto current = motion_.offset();
    const auto limit = maximum();
    // Match the pinned Android ScrollView command: scroll only along the
    // configured axis and retain the current cross-axis offset.
    const ScrollPoint target = props_->horizontal ? ScrollPoint{limit.x, current.y}
                                                   : ScrollPoint{current.x, limit.y};
    if (args[0].getBool()) {
      motion_.replace(target, true, now_seconds());
      sample();
    } else set_offset(target);
    return true;
  }
  return false;
}
void ScrollAdapter::wheel(int direction, double factor) {
  if (!props_ || !props_->scrollEnabled) return;
  const auto delta = 48.0 * direction * factor;
  const auto offset = motion_.offset();
  set_offset({offset.x + (props_->horizontal ? delta : 0), offset.y + (props_->horizontal ? 0 : delta)});
}
void ScrollAdapter::pointer_down(int pointer_id, ScrollPoint local, double now) {
  if (!props_ || !props_->scrollEnabled || pointer_id <= 0 || !finite(local) || !std::isfinite(now)) return;
  if (candidate_) cancel_pointer(candidate_->pointer_id);
  interrupt_motion();
  candidate_ = Candidate{pointer_id, local, now, false};
}
bool ScrollAdapter::pan_ready(int pointer_id, ScrollPoint local, bool blocked, bool captured) const {
  if (!candidate_ || candidate_->pointer_id != pointer_id || candidate_->claimed || blocked || captured || !props_ || !props_->scrollEnabled) return false;
  const double primary = props_->horizontal ? std::abs(local.x - candidate_->origin.x) : std::abs(local.y - candidate_->origin.y);
  const double cross = props_->horizontal ? std::abs(local.y - candidate_->origin.y) : std::abs(local.x - candidate_->origin.x);
  return primary > ScrollMotion::kDragThreshold && primary > cross;
}
void ScrollAdapter::begin_pan(int pointer_id, ScrollPoint local, double now) {
  if (!candidate_ || candidate_->pointer_id != pointer_id || !props_ || !props_->scrollEnabled) return;
  interrupt_motion();
  candidate_->claimed = true;
  motion_.begin_drag(candidate_->origin, candidate_->started);
  if (control_.is_inside_tree()) control_.propagate_notification(Control::NOTIFICATION_SCROLL_BEGIN);
  if (emitter_) emitter_->onScrollBeginDrag(metrics());
  ++begins_;
  update_pan(pointer_id, local, now);
}
void ScrollAdapter::update_pan(int pointer_id, ScrollPoint local, double now) {
  if (!candidate_ || candidate_->pointer_id != pointer_id || !candidate_->claimed) return;
  const auto next = motion_.drag(scroll_gesture_point(local, candidate_->origin, props_->horizontal), now, maximum());
  if (auto *mounted_content = content()) mounted_content->set_position(gd(scroll_content_position(content_origin_, next)));
  update_indicators();
  sample();
}
void ScrollAdapter::finish_pan(int pointer_id, ScrollPoint local, double now, bool canceled) {
  if (!candidate_ || candidate_->pointer_id != pointer_id) return;
  const bool claimed = candidate_->claimed;
  const auto release_point = scroll_gesture_point(local, candidate_->origin, props_->horizontal);
  candidate_.reset();
  if (!claimed) return;
  ScrollPoint velocity{};
  if (!canceled) velocity = motion_.finish_drag(release_point, now, maximum());
  else motion_.cancel();
  if (auto *mounted_content = content()) mounted_content->set_position(gd(scroll_content_position(content_origin_, motion_.offset())));
  update_indicators();
  sample();
  if (control_.is_inside_tree()) control_.propagate_notification(Control::NOTIFICATION_SCROLL_END);
  emit_end_drag(velocity, !canceled && motion_.mode() == ScrollMotion::Mode::Momentum);
  if (canceled || motion_.mode() != ScrollMotion::Mode::Momentum) motion_.cancel();
}
void ScrollAdapter::cancel_pointer(int pointer_id) {
  if (candidate_ && candidate_->pointer_id == pointer_id) finish_pan(pointer_id, candidate_->origin, now_seconds(), true);
}
void ScrollAdapter::tick(double now) {
  if (!motion_.active()) return;
  const auto update = motion_.tick(now, maximum());
  if (update.changed) if (auto *mounted_content = content())
    mounted_content->set_position(gd(scroll_content_position(content_origin_, update.offset)));
  if (update.changed) { update_indicators(); sample(); }
  if (update.momentumEnded && emitter_) { emitter_->onMomentumScrollEnd(metrics()); ++momentum_ends_; }
}
void ScrollAdapter::cancel() {
  if (candidate_) finish_pan(candidate_->pointer_id, candidate_->origin, now_seconds(), true);
  interrupt_motion();
}
bool ScrollAdapter::dragging() const { return candidate_ && candidate_->claimed; }
bool ScrollAdapter::dragging(int pointer_id) const {
  return candidate_ && candidate_->pointer_id == pointer_id && candidate_->claimed;
}
void ScrollAdapter::update_indicators() {
  if (!props_) return;
  const auto viewport = core(control_.get_size());
  const auto max = maximum();
  const auto offset = motion_.offset();
  const bool show_v = props_->showsVerticalScrollIndicator && content_size_.y > viewport.y && viewport.y > 0;
  vertical_indicator_->set_visible(show_v);
  if (show_v) {
    const double thumb = std::clamp(viewport.y * viewport.y / content_size_.y, std::min(18.0, viewport.y), viewport.y);
    const double track = std::max(0.0, viewport.y - thumb);
    const double y = max.y > 0 ? track * offset.y / max.y : 0;
    vertical_indicator_->set_position({static_cast<real_t>(std::max(0.0, viewport.x - 3.0)), static_cast<real_t>(y)});
    vertical_indicator_->set_size({3, static_cast<real_t>(thumb)});
  }
  const bool show_h = props_->showsHorizontalScrollIndicator && content_size_.x > viewport.x && viewport.x > 0;
  horizontal_indicator_->set_visible(show_h);
  if (show_h) {
    const double thumb = std::clamp(viewport.x * viewport.x / content_size_.x, std::min(18.0, viewport.x), viewport.x);
    const double track = std::max(0.0, viewport.x - thumb);
    const double x = max.x > 0 ? track * offset.x / max.x : 0;
    horizontal_indicator_->set_position({static_cast<real_t>(x), static_cast<real_t>(std::max(0.0, viewport.y - 3.0))});
    horizontal_indicator_->set_size({static_cast<real_t>(thumb), 3});
  }
}
folly::dynamic ScrollAdapter::snapshot() const {
  const auto max = maximum();
  const auto offset = motion_.offset();
  const auto &state = state_->getData();
  const auto vertical_size = vertical_indicator_ ? core(vertical_indicator_->get_size()) : ScrollPoint{};
  const auto horizontal_size = horizontal_indicator_ ? core(horizontal_indicator_->get_size()) : ScrollPoint{};
  return folly::dynamic::object("x", offset.x)("y", offset.y)("maxX", max.x)("maxY", max.y)
      ("contentWidth", content_size_.x)("contentHeight", content_size_.y)
      ("viewportWidth", viewport_size_.x)("viewportHeight", viewport_size_.y)
      ("verticalThumbHeight", vertical_size.y)("horizontalThumbWidth", horizontal_size.x)
      ("fabricX", state.contentOffset.x)("fabricY", state.contentOffset.y)
      ("contentX", content() ? content()->get_position().x : 0)("contentY", content() ? content()->get_position().y : 0)
      ("dragging", dragging())("motion", static_cast<int>(motion_.mode()))
      ("enabled", props_->scrollEnabled)("scrolls", scrolls_)("throttled", throttled_)
      ("horizontal", props_->horizontal)("candidate", candidate_.has_value())
      ("candidatePointer", candidate_ ? candidate_->pointer_id : 0)
      ("candidateClaimed", candidate_ && candidate_->claimed)
      ("throttle", props_->scrollEventThrottle)("begins", begins_)("ends", ends_)
      ("momentumBegins", momentum_begins_)("momentumEnds", momentum_ends_);
}
}
