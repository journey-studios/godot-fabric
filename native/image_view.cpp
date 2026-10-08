#include "image_view.h"
#include <godot_cpp/classes/image_texture.hpp>
#include <react/renderer/components/image/ImageProps.h>
#include <algorithm>
#include <cmath>
#include <mutex>

using namespace godot;
namespace rn = facebook::react;
namespace img = fabric_godot::image;

namespace {
constexpr std::size_t max_events = 64;

img::ResizeMode mode_of(rn::ImageResizeMode mode) {
  switch (mode) {
    case rn::ImageResizeMode::Cover: return img::ResizeMode::Cover;
    case rn::ImageResizeMode::Contain: return img::ResizeMode::Contain;
    case rn::ImageResizeMode::Stretch: return img::ResizeMode::Stretch;
    case rn::ImageResizeMode::Center: return img::ResizeMode::Center;
    case rn::ImageResizeMode::Repeat: return img::ResizeMode::Repeat;
    case rn::ImageResizeMode::None: return img::ResizeMode::None;
  }
  return img::ResizeMode::Stretch;
}
folly::dynamic rect_json(const img::Rect &rect) {
  return folly::dynamic::object("x", rect.x)("y", rect.y)("width", rect.width)("height", rect.height);
}
const char *type_name(rn::ImageSource::Type type) {
  switch (type) {
    case rn::ImageSource::Type::Local: return "local";
    case rn::ImageSource::Type::Remote: return "remote";
    case rn::ImageSource::Type::Invalid: break;
  }
  return "invalid";
}
}  // namespace

// The observer the view puts on its request's coordinator, as RCTImageResponseObserverProxy does for the iOS component.
// RN requires an observer to be thread-safe; this one only forwards, and does so until the view detaches it.
class GodotImage::Observer final : public rn::ImageResponseObserver {
 public:
  explicit Observer(GodotImage &view) : view_(&view) {}
  void detach() {
    const std::lock_guard<std::mutex> lock(mutex_);
    view_ = nullptr;
  }
  void didReceiveProgress(float progress, int64_t loaded, int64_t total) const override {
    const std::lock_guard<std::mutex> lock(mutex_);
    if (view_) view_->received_progress(progress, loaded, total);
  }
  void didReceiveImage(const rn::ImageResponse &response) const override {
    const std::lock_guard<std::mutex> lock(mutex_);
    if (view_) view_->received_image(response);
  }
  void didReceiveFailure(const rn::ImageLoadError &error) const override {
    const std::lock_guard<std::mutex> lock(mutex_);
    if (view_) view_->received_failure(error);
  }
 private:
  mutable std::mutex mutex_;
  GodotImage *view_;
};

GodotImage::GodotImage() : observer_(std::make_shared<Observer>(*this)) {
  // The iOS component filters its image trilinearly; a project's pixel-art default must not decide how an Image scales.
  set_texture_filter(TEXTURE_FILTER_LINEAR);
}

GodotImage::~GodotImage() { detach(); }

void GodotImage::bind(fabric_godot::ImageEmitter emitter) { emitter_ = std::move(emitter); }

void GodotImage::detach() {
  // RCTImageComponentView prepareForRecycle: the last observer leaving a request that is still loading cancels it.
  if (observer_) observer_->detach();
  if (state_ && observer_) state_->getData().getImageRequest().getObserverCoordinator().removeObserver(observer_);
  state_.reset();
}

void GodotImage::apply(const rn::ShadowView &shadow) {
  const auto &props = static_cast<const rn::ImageProps &>(*shadow.props);
  mode_ = mode_of(props.resizeMode);
  content_ = shadow.layoutMetrics.getContentFrame();
  const auto state = std::static_pointer_cast<const rn::ImageShadowNode::ConcreteState>(shadow.state);
  if (state != state_) resubscribe(state);
  refresh_texture();
  queue_redraw();
}

void GodotImage::resubscribe(const std::shared_ptr<const rn::ImageShadowNode::ConcreteState> &state) {
  ++states_;
  const auto previous = state_;
  const bool had_source = previous && previous->getData().getImageSource() != rn::ImageSource{};
  const bool starts = !had_source || (state && state->getData().getImageSource() != previous->getData().getImageSource());
  if (starts) {
    status_ = "loading";
    error_.clear();
    // Loading actually starts a little before this, but this is the first time the component knows (RCTImageComponentView.mm).
    // It is told before the observer is swapped: addObserver answers at once when the request already holds a response, and that
    // answer (onLoad or onError, then onLoadEnd) must not reach JS ahead of the onLoadStart of the request it answers.
    ++load_starts_;
    emitted(folly::dynamic::object("type", "loadStart"));
    emit([](const rn::ImageEventEmitter &events) { events.onLoadStart(); });
  }
  if (state_) state_->getData().getImageRequest().getObserverCoordinator().removeObserver(observer_);
  state_ = state;
  // May answer at once (a response the request kept) and may start the request again (one that was cancelled or consumed).
  if (state_) state_->getData().getImageRequest().getObserverCoordinator().addObserver(observer_);
}

void GodotImage::emit(const std::function<void(const rn::ImageEventEmitter &)> &call) {
  if (emitter_) emitter_(call);
}

void GodotImage::emitted(folly::dynamic event) {
  emitted_.push_back(std::move(event));
  if (emitted_.size() > max_events) emitted_.pop_front();
}

void GodotImage::received_progress(float progress, int64_t loaded, int64_t total) {
  ++progresses_;
  emitted(folly::dynamic::object("type", "progress")("progress", static_cast<double>(progress))("loaded", loaded)("total", total));
  emit([progress, loaded, total](const rn::ImageEventEmitter &events) { events.onProgress(static_cast<double>(progress), loaded, total); });
}

void GodotImage::received_image(const rn::ImageResponse &response) {
  if (!state_) return;
  image_ = std::static_pointer_cast<fabric_godot::LoadedImage>(response.getImage());
  status_ = "loaded";
  error_.clear();
  refresh_texture();
  queue_redraw();
  // onLoad reports the picture's size in points times the state's scale: the pixels it decoded to when it has the request's
  // scale, as every picture but a bundled asset does (RCTImageComponentView.mm didReceiveImage).
  auto source = state_->getData().getImageSource();
  source.size = {.width = static_cast<rn::Float>(image_->width / image_->scale), .height = static_cast<rn::Float>(image_->height / image_->scale)};
  ++loads_;
  ++load_ends_;
  emitted(folly::dynamic::object("type", "load")("uri", source.uri)("width", source.size.width * source.scale)("height", source.size.height * source.scale));
  emit([source](const rn::ImageEventEmitter &events) { events.onLoad(source); });
  emitted(folly::dynamic::object("type", "loadEnd"));
  emit([](const rn::ImageEventEmitter &events) { events.onLoadEnd(); });
}

void GodotImage::received_failure(const rn::ImageLoadError &error) {
  image_.reset();
  status_ = "failed";
  const auto failure = std::static_pointer_cast<fabric_godot::LoadFailure>(error.getError());
  error_ = failure ? failure->message : std::string();
  queue_redraw();
  rn::ImageErrorInfo info;
  info.error = error_;
  ++errors_;
  ++load_ends_;
  emitted(folly::dynamic::object("type", "error")("error", error_));
  emit([info](const rn::ImageEventEmitter &events) { events.onError(info); });
  emitted(folly::dynamic::object("type", "loadEnd"));
  emit([](const rn::ImageEventEmitter &events) { events.onLoadEnd(); });
}

img::Size GodotImage::natural_size() const {
  if (!image_ || !(image_->scale > 0)) return {};
  return {static_cast<double>(image_->width) / image_->scale, static_cast<double>(image_->height) / image_->scale};
}

// Repeat tiles at the texture's size; the size override makes that the picture's size in points, as UIImage.size is for a
// resizable image. Every other mode addresses the texture in pixels.
void GodotImage::refresh_texture() {
  if (!image_ || image_->texture.is_null()) return;
  Vector2i size(static_cast<int32_t>(image_->width), static_cast<int32_t>(image_->height));
  if (mode_ == img::ResizeMode::Repeat) {
    const auto natural = natural_size();
    size = Vector2i(std::max(1, static_cast<int>(std::lround(natural.width))), std::max(1, static_cast<int>(std::lround(natural.height))));
  }
  if (image_->texture->get_width() == size.x && image_->texture->get_height() == size.y) return;
  image_->texture->set_size_override(size);
}

void GodotImage::_draw() {
  ++draws_;
  drawn_ = nullptr;
  if (!image_ || image_->texture.is_null()) return;
  const auto natural = natural_size();
  const auto plan = img::plan(mode_, {content_.size.width, content_.size.height}, natural);
  if (!plan) return;
  const Vector2 origin(content_.origin.x, content_.origin.y);
  const Rect2 destination(origin + Vector2(plan->dst.x, plan->dst.y), Vector2(plan->dst.width, plan->dst.height));
  if (plan->tiled) {
    draw_texture_rect(image_->texture, destination, true);
  } else {
    const auto scale = static_cast<float>(image_->scale);
    draw_texture_rect_region(image_->texture, destination, Rect2(plan->src.x * scale, plan->src.y * scale, plan->src.width * scale, plan->src.height * scale));
  }
  drawn_ = folly::dynamic::object("mode", img::mode_name(mode_))("dst", rect_json({content_.origin.x + plan->dst.x, content_.origin.y + plan->dst.y, plan->dst.width, plan->dst.height}))
      ("src", rect_json(plan->src))("tiled", plan->tiled)("tileWidth", plan->tile.width)("tileHeight", plan->tile.height);
}

folly::dynamic GodotImage::snapshot() const {
  folly::dynamic source = nullptr;
  if (state_) {
    const auto data = state_->getData().getImageSource();
    source = folly::dynamic::object("type", type_name(data.type))("uri", data.uri)("scale", data.scale)("width", data.size.width)("height", data.size.height);
  }
  folly::dynamic picture = nullptr;
  if (image_) {
    const auto natural = natural_size();
    picture = folly::dynamic::object("width", image_->width)("height", image_->height)("sourceWidth", image_->source_width)
        ("sourceHeight", image_->source_height)("scale", image_->scale)("naturalWidth", natural.width)("naturalHeight", natural.height)
        ("format", image_->format)("fingerprint", image_->fingerprint)
        ("textureWidth", image_->texture.is_valid() ? image_->texture->get_width() : 0)
        ("textureHeight", image_->texture.is_valid() ? image_->texture->get_height() : 0);
  }
  folly::dynamic events = folly::dynamic::array();
  for (const auto &event : emitted_) events.push_back(event);
  const auto planned = img::plan(mode_, {content_.size.width, content_.size.height}, natural_size());
  folly::dynamic expected = nullptr;
  if (planned) expected = folly::dynamic::object("dst", rect_json({content_.origin.x + planned->dst.x, content_.origin.y + planned->dst.y, planned->dst.width, planned->dst.height}))
      ("src", rect_json(planned->src))("tiled", planned->tiled);
  return folly::dynamic::object("status", status_)("error", error_)("mode", img::mode_name(mode_))
      ("content", rect_json({content_.origin.x, content_.origin.y, content_.size.width, content_.size.height}))
      ("observing", state_ != nullptr)("source", std::move(source))("image", std::move(picture))("planned", std::move(expected))
      ("drawn", drawn_)("events", std::move(events))
      ("counters", folly::dynamic::object("states", states_)("loadStarts", load_starts_)("progress", progresses_)("loads", loads_)
          ("errors", errors_)("loadEnds", load_ends_)("draws", draws_));
}
