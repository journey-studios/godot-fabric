#pragma once
#include "scroll_motion.h"
#include <godot_cpp/classes/control.hpp>
#include <godot_cpp/classes/panel.hpp>
#include <godot_cpp/classes/style_box_flat.hpp>
#include <godot_cpp/core/object.hpp>
#include <react/renderer/components/scrollview/ScrollViewShadowNode.h>
#include <react/renderer/mounting/ShadowView.h>
#include <folly/dynamic.h>
#include <memory>
#include <limits>
#include <optional>
#include <string>

namespace fabric_godot {
namespace rn = facebook::react;
class ScrollAdapter {
 public:
  explicit ScrollAdapter(godot::Control &control);
  void apply(const rn::ShadowView &shadow);
  void set_content_frame(godot::Control &content, ScrollPoint yoga_origin);
  void clear_content();
  void layout();
  void sample();
  bool command(const std::string &name, const folly::dynamic &args);
  void wheel(int direction, double factor);
  void pointer_down(int pointer_id, ScrollPoint local, double now);
  bool pan_ready(int pointer_id, ScrollPoint local, bool blocked) const;
  void begin_pan(int pointer_id, ScrollPoint local, double now);
  void update_pan(int pointer_id, ScrollPoint local, double now);
  void finish_pan(int pointer_id, ScrollPoint local, double now, bool canceled = false);
  void cancel_pointer(int pointer_id);
  void tick(double now);
  void cancel();
  bool dragging() const;
  bool dragging(int pointer_id) const;
  bool active_motion() const {
    return motion_.mode() == ScrollMotion::Mode::Animated || motion_.mode() == ScrollMotion::Mode::Momentum;
  }
  folly::dynamic snapshot() const;
 private:
  godot::Control &control_;
  godot::ObjectID content_id_;
  godot::Panel *vertical_indicator_{};
  godot::Panel *horizontal_indicator_{};
  std::shared_ptr<const rn::ScrollViewProps> props_;
  std::shared_ptr<const rn::ScrollViewShadowNode::ConcreteState> state_;
  std::shared_ptr<const rn::ScrollViewEventEmitter> emitter_;
  ScrollMotion motion_;
  ScrollPoint content_size_{}, content_origin_{}, viewport_size_{};
  std::optional<ScrollPoint> requested_offset_;
  struct Candidate { int pointer_id{}; ScrollPoint origin{}; double started{}; bool claimed{}; };
  std::optional<Candidate> candidate_;
  ScrollPoint last_sampled_{};
  int scrolls_{}, throttled_{}, begins_{}, ends_{}, momentum_begins_{}, momentum_ends_{};
  double last_scroll_ms_{-std::numeric_limits<double>::infinity()};
  ScrollPoint maximum() const;
  double now_seconds() const;
  godot::Control *content() const;
  void interrupt_motion();
  void set_offset(ScrollPoint value);
  void emit_end_drag(ScrollPoint velocity, bool momentum);
  void update_indicators();
  rn::ScrollEvent metrics() const;
};
}
