#include "godot_image_manager.h"
#include <functional>
#include <mutex>

namespace rn = facebook::react;

namespace fabric_godot {
namespace {
// What cancels the load a request currently has; a resume replaces it.
struct Current {
  std::mutex mutex;
  std::function<void()> cancel;
};
}  // namespace

GodotImageManager::GodotImageManager(const std::shared_ptr<const rn::ContextContainer> &context, std::shared_ptr<ImageLoader> loader)
    : rn::ImageManager(context), loader_(std::move(loader)) {}

rn::ImageRequest GodotImageManager::requestImage(const rn::ImageSource &source, rn::SurfaceId, const rn::ImageRequestParams &, rn::Tag) const {
  // An invalid source (an Image without one) has nothing to load, as in RN's stub manager.
  if (source.type == rn::ImageSource::Type::Invalid) return {source, nullptr, {}};
  rn::SharedFunction<> resume, cancel;
  rn::ImageRequest request(source, nullptr, resume, cancel);
  const std::weak_ptr<const rn::ImageResponseObserverCoordinator> coordinator = request.getSharedObserverCoordinator();
  const auto current = std::make_shared<Current>();
  const auto start = [loader = loader_, source, coordinator, current] {
    auto stop = loader->load(source, coordinator);
    const std::lock_guard<std::mutex> lock(current->mutex);
    current->cancel = std::move(stop);
  };
  cancel.assign([current] {
    std::function<void()> stop;
    {
      const std::lock_guard<std::mutex> lock(current->mutex);
      stop = current->cancel;
    }
    if (stop) stop();
  });
  resume.assign(start);
  start();
  return request;
}

}  // namespace fabric_godot
