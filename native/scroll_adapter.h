#pragma once
#include <godot_cpp/classes/scroll_container.hpp>
#include <react/renderer/components/scrollview/ScrollViewShadowNode.h>
#include <react/renderer/mounting/ShadowView.h>
#include <folly/dynamic.h>
#include <limits>
#include <optional>

namespace fabric_godot {
namespace rn = facebook::react;
// Yoga owns content frames. The native container owns clipping and translation;
// its offset is published through Fabric's original immutable ScrollView state.
class ScrollAdapter {
 public:
  explicit ScrollAdapter(godot::ScrollContainer &control);
  void apply(const rn::ShadowView &shadow);
  void layout();
  void sample();
  bool command(const std::string &name, const folly::dynamic &args);
  void wheel(int direction, double factor);
  bool dragging() const { return dragging_; }
  folly::dynamic snapshot() const;
 private:
  godot::ScrollContainer &control_;
  std::shared_ptr<const rn::ScrollViewProps> props_;
  std::shared_ptr<const rn::ScrollViewShadowNode::ConcreteState> state_;
  std::shared_ptr<const rn::ScrollViewEventEmitter> emitter_;
  godot::Vector2 content_size_, offset_, drag_origin_, drag_offset_;
  std::optional<godot::Vector2> requested_offset_;
  bool dragging_{false};
  int scrolls_{}, throttled_{}, begins_{}, ends_{};
  double last_scroll_ms_{-std::numeric_limits<double>::infinity()};
  godot::Vector2 maximum() const;
  void set_offset(godot::Vector2 value);
  void end_drag();
  rn::ScrollEvent metrics() const;
};
}
