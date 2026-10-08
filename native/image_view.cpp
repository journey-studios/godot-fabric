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
folly::dynamic rgba_json(const img::Rgba &color) { return folly::dynamic::array(color.r, color.g, color.b, color.a); }
folly::dynamic edges_json(const img::Edges &edges) {
  return folly::dynamic::object("left", edges.left)("top", edges.top)("right", edges.right)("bottom", edges.bottom);
}
// A corner's radii in the order the shader reads them: top left, top right, bottom right, bottom left.
folly::dynamic corners_json(const img::Corners &c) {
  return folly::dynamic::object("horizontal", folly::dynamic::array(c.top_left.horizontal, c.top_right.horizontal, c.bottom_right.horizontal, c.bottom_left.horizontal))
      ("vertical", folly::dynamic::array(c.top_left.vertical, c.top_right.vertical, c.bottom_right.vertical, c.bottom_left.vertical));
}
folly::dynamic rounded_json(const img::RoundedRect &shape) {
  return folly::dynamic::object("rect", rect_json(shape.rect))("radii", corners_json(shape.radii));
}
// What one draw asked of the renderer, with the layer's own record of the calls it made.
folly::dynamic effects_json(const img::Painting &painting, folly::dynamic layer) {
  folly::dynamic clip = nullptr;
  if (painting.clip) clip = folly::dynamic::object("outer", rounded_json(painting.clip->outer))("inner", rounded_json(painting.clip->inner));
  return folly::dynamic::object("kind", img::paint_kind_name(painting.kind))("scale", painting.scale)
      ("tint", painting.tint ? rgba_json(*painting.tint) : folly::dynamic(nullptr))("clip", std::move(clip))("layer", std::move(layer));
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
  frame_ = {shadow.layoutMetrics.frame.size.width, shadow.layoutMetrics.frame.size.height};
  tint_.reset();
  if (props.tintColor) {
    const auto color = rn::colorComponentsFromColor(props.tintColor);
    tint_ = img::Rgba{color.red, color.green, color.blue, color.alpha};
  }
  cap_insets_ = {props.capInsets.left, props.capInsets.top, props.capInsets.right, props.capInsets.bottom};
  blur_radius_ = props.blurRadius;
  // The border radii as ViewProps resolves them (percentages, the corners' overlap), and the widths of the borders beside them.
  const auto border = props.resolveBorderMetrics(shadow.layoutMetrics);
  const auto &radii = border.borderRadii;
  border_radii_ = {{radii.topLeft.horizontal, radii.topLeft.vertical}, {radii.topRight.horizontal, radii.topRight.vertical},
      {radii.bottomRight.horizontal, radii.bottomRight.vertical}, {radii.bottomLeft.horizontal, radii.bottomLeft.vertical}};
  border_widths_ = {border.borderWidths.left, border.borderWidths.top, border.borderWidths.right, border.borderWidths.bottom};
  clips_ = props.getClipsContentToBounds();
  // Props that iOS' view config drops (loadingIndicatorSource, fadeDuration, progressiveRenderingEnabled, resizeMethod,
  // resizeMultiplier, overlayColor) never reach this view, and defaultSource arrives and is not used: ImageProps parses it, and no
  // iOS component reads it. What the view holds is reported, so that this can be seen.
  ignored_ = folly::dynamic::object("defaultSource", !props.defaultSource.uri.empty())("loadingIndicatorSource", !props.loadingIndicatorSource.uri.empty())
      ("fadeDuration", props.fadeDuration)("progressiveRenderingEnabled", props.progressiveRenderingEnabled)("resizeMethod", props.resizeMethod)
      ("resizeMultiplier", props.resizeMultiplier)("overlayColor", static_cast<bool>(props.overlayColor));
  const auto state = std::static_pointer_cast<const rn::ImageShadowNode::ConcreteState>(shadow.state);
  if (state != state_) resubscribe(state);
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
  // RCTImageComponentView didReceiveFailure: the message, and the status and headers of the HTTP response the failure came with.
  // The emitter leaves out what is empty.
  rn::ImageErrorInfo info;
  info.error = error_;
  folly::dynamic headers = folly::dynamic::object();
  if (failure) {
    info.responseCode = failure->response_code;
    info.httpResponseHeaders = failure->response_headers;
    for (const auto &[name, value] : failure->response_headers) headers[name] = value;
  }
  ++errors_;
  ++load_ends_;
  emitted(folly::dynamic::object("type", "error")("error", error_)("responseCode", info.responseCode)("httpResponseHeaders", std::move(headers)));
  emit([info](const rn::ImageEventEmitter &events) { events.onError(info); });
  emitted(folly::dynamic::object("type", "loadEnd"));
  emit([](const rn::ImageEventEmitter &events) { events.onLoadEnd(); });
}

img::Size GodotImage::natural_size() const {
  if (!image_ || !(image_->scale > 0)) return {};
  return {static_cast<double>(image_->width) / image_->scale, static_cast<double>(image_->height) / image_->scale};
}

std::optional<img::Painting> GodotImage::painting() const {
  if (!image_ || image_->texture.is_null()) return std::nullopt;
  img::PaintInput input;
  input.mode = mode_;
  input.frame = frame_;
  input.content = {content_.origin.x, content_.origin.y, content_.size.width, content_.size.height};
  input.pixels = {static_cast<double>(image_->width), static_cast<double>(image_->height)};
  input.scale = image_->scale;
  // A blurred picture is a bitmap rebuilt from the image that was tinted, resized and tiled: it is none of them.
  input.plain = image_->blur.applies;
  input.tint = tint_;
  input.cap_insets = cap_insets_;
  input.clips = clips_;
  input.radii = border_radii_;
  input.widths = border_widths_;
  return img::paint(input);
}

void GodotImage::_draw() {
  ++draws_;
  drawn_ = nullptr;
  layer_.clear();
  const auto painted = painting();
  if (!painted) return;
  // The texture is the cache's and every view of the picture shares it: it is drawn, never resized or written.
  layer_.draw(get_canvas_item(), image_->texture->get_rid(), *painted);
  drawn_ = folly::dynamic::object("mode", img::mode_name(painted->mode))
      ("dst", rect_json({content_.origin.x + painted->plan.dst.x, content_.origin.y + painted->plan.dst.y, painted->plan.dst.width, painted->plan.dst.height}))
      ("src", rect_json(painted->plan.src))("tiled", painted->plan.tiled)("tileWidth", painted->plan.tile.width)("tileHeight", painted->plan.tile.height)
      ("effects", effects_json(*painted, layer_.snapshot()));
}

folly::dynamic GodotImage::props_json() const {
  return folly::dynamic::object("tint", tint_ ? rgba_json(*tint_) : folly::dynamic(nullptr))("blurRadius", blur_radius_)("capInsets", edges_json(cap_insets_))
      ("clips", clips_)("frame", folly::dynamic::object("width", frame_.width)("height", frame_.height))("borderWidths", edges_json(border_widths_))
      ("borderRadii", corners_json(border_radii_));
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
        ("blur", folly::dynamic::object("radius", image_->blur.radius)("scale", image_->blur.scale)("kernel", image_->blur.kernel)
            ("passes", image_->blur.passes)("applies", image_->blur.applies))
        ("textureWidth", image_->texture.is_valid() ? image_->texture->get_width() : 0)
        ("textureHeight", image_->texture.is_valid() ? image_->texture->get_height() : 0);
  }
  folly::dynamic events = folly::dynamic::array();
  for (const auto &event : emitted_) events.push_back(event);
  const auto painted = painting();
  folly::dynamic expected = nullptr;
  if (painted) expected = folly::dynamic::object("dst", rect_json({content_.origin.x + painted->plan.dst.x, content_.origin.y + painted->plan.dst.y, painted->plan.dst.width, painted->plan.dst.height}))
      ("src", rect_json(painted->plan.src))("tiled", painted->plan.tiled);
  return folly::dynamic::object("status", status_)("error", error_)("mode", img::mode_name(mode_))
      ("content", rect_json({content_.origin.x, content_.origin.y, content_.size.width, content_.size.height}))
      ("observing", state_ != nullptr)("source", std::move(source))("image", std::move(picture))("planned", std::move(expected))
      ("drawn", drawn_)("props", props_json())("ignored", ignored_)("events", std::move(events))
      ("counters", folly::dynamic::object("states", states_)("loadStarts", load_starts_)("progress", progresses_)("loads", loads_)
          ("errors", errors_)("loadEnds", load_ends_)("draws", draws_));
}
