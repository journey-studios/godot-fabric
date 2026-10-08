#pragma once

#include "image_loader.h"
#include <react/renderer/imagemanager/ImageManager.h>
#include <memory>

namespace fabric_godot {

// RN's ImageManager (the cross-platform facade RCTImageManager and the Android ImageManager implement), with
// the host's loader behind it. ImageShadowNode asks it for a request inside layout, so requestImage only builds the
// request RN's observer coordinator is attached to and queues its load; reading and decoding happen on the worker
// pool and the answers come back from ImageLoader::poll(). Resuming a cancelled or consumed request loads it again, the way
// RCTImageManager's resume function starts its loader request again.
class GodotImageManager final : public facebook::react::ImageManager {
 public:
  GodotImageManager(const std::shared_ptr<const facebook::react::ContextContainer> &context, std::shared_ptr<ImageLoader> loader);
  facebook::react::ImageRequest requestImage(const facebook::react::ImageSource &source, facebook::react::SurfaceId surface,
      const facebook::react::ImageRequestParams &params = {}, facebook::react::Tag tag = {}) const override;

 private:
  std::shared_ptr<ImageLoader> loader_;
};

}  // namespace fabric_godot
