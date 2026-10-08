#pragma once
#include "image_geometry.h"
#include "image_loader.h"
#include <folly/dynamic.h>
#include <godot_cpp/classes/panel.hpp>
#include <react/renderer/components/image/ImageEventEmitter.h>
#include <react/renderer/components/image/ImageShadowNode.h>
#include <react/renderer/mounting/ShadowView.h>
#include <deque>
#include <functional>
#include <memory>

namespace fabric_godot {
// Runs a function with the committed event emitter of the view when the application still takes events for it. The
// runtime owns the guards (a stopped application, a retiring surface, a replaced mount), as for every other Control.
using ImageEmitter = std::function<void(const std::function<void(const facebook::react::ImageEventEmitter &)> &)>;
}  // namespace fabric_godot

// RN's Image on a Godot Panel, as RCTImageComponentView is a view around a UIImageView: the host paints the View
// appearance (background and border), and the picture is drawn over it in the content frame with the resize mode's
// UIViewContentMode. The view subscribes to the ImageRequest that RN's ImageShadowNode keeps in its state, swapping the
// subscription when the state changes, and tells JS what the request reports, in the order and with the payloads of the
// iOS component: onLoadStart when the source changes, then onProgress, then onLoad and onLoadEnd, or onError and onLoadEnd.
class GodotImage final : public godot::Panel {
  GDCLASS(GodotImage, godot::Panel)
 public:
  GodotImage();
  ~GodotImage() override;
  // Hands the view the way to reach its event emitter. Called once, as the runtime creates the Control.
  void bind(fabric_godot::ImageEmitter emitter);
  // RCTImageComponentView updateProps, updateState and updateLayoutMetrics, from the committed shadow view.
  void apply(const facebook::react::ShadowView &shadow);
  void _draw() override;
  folly::dynamic snapshot() const;
 protected:
  static void _bind_methods() {}
 private:
  class Observer;
  void resubscribe(const std::shared_ptr<const facebook::react::ImageShadowNode::ConcreteState> &state);
  void detach();
  void received_progress(float progress, int64_t loaded, int64_t total);
  void received_image(const facebook::react::ImageResponse &response);
  void received_failure(const facebook::react::ImageLoadError &error);
  void emitted(folly::dynamic event);
  void emit(const std::function<void(const facebook::react::ImageEventEmitter &)> &call);
  fabric_godot::image::Size natural_size() const;

  fabric_godot::ImageEmitter emitter_;
  std::shared_ptr<const facebook::react::ImageShadowNode::ConcreteState> state_;
  std::shared_ptr<Observer> observer_;
  std::shared_ptr<fabric_godot::LoadedImage> image_;
  fabric_godot::image::ResizeMode mode_{fabric_godot::image::ResizeMode::Stretch};
  facebook::react::Rect content_{};
  std::string status_{"idle"}, error_;
  std::deque<folly::dynamic> emitted_;
  int states_{}, load_starts_{}, progresses_{}, loads_{}, errors_{}, load_ends_{}, draws_{};
  folly::dynamic drawn_ = nullptr;
};
