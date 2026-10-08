#include "image_loader_module.h"
#include "image_core.h"
#include "image_loader.h"
#include "turbo_module_registry.h"
#include "FBReactNativeSpecJSI.h"
#include <jsi/jsi.h>
#include <react/bridging/Bridging.h>
#include <react/bridging/Promise.h>
#include <cmath>
#include <map>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace rn = facebook::react;
namespace jsi = facebook::jsi;

namespace fabric_godot {
namespace {
struct State {
  bool active{true};
  std::shared_ptr<ImageLoader> loader;
};

// RCTConvert NSString of one value of getSizeWithHeaders' dictionary: a string as it is, a number or a boolean as its text.
std::optional<std::string> header_text(jsi::Runtime &rt, const jsi::Value &value) {
  if (value.isString()) return value.getString(rt).utf8(rt);
  if (value.isNumber()) return image::number_text(value.getNumber());
  if (value.isBool()) return std::string(value.getBool() ? "1" : "0");
  return std::nullopt;
}

class NativeImageLoader final : public rn::NativeImageLoaderIOSCxxSpec<NativeImageLoader> {
 public:
  NativeImageLoader(std::shared_ptr<rn::CallInvoker> invoker, std::shared_ptr<State> state)
      : rn::NativeImageLoaderIOSCxxSpec<NativeImageLoader>(std::move(invoker)), state_(std::move(state)) {}

  jsi::Object getConstants(jsi::Runtime &rt) {
    live(rt);
    return jsi::Object(rt);
  }

  // RCTImageLoader getSize: [width, height] in pixels, or E_GET_SIZE_FAILURE.
  jsi::Value getSize(jsi::Runtime &rt, jsi::String uri) {
    live(rt);
    const auto text = uri.utf8(rt);
    rn::AsyncPromise<std::vector<double>> promise(rt, jsInvoker_);
    state_->loader->measure(text, {}, [promise, text, state = state_](MeasuredImage size) mutable {
      if (!state->active) return;
      if (size.ok) promise.resolve({static_cast<double>(size.width), static_cast<double>(size.height)});
      else promise.reject("E_GET_SIZE_FAILURE: Failed to getSize of " + text + ": " + size.error);
    });
    return jsi::Value(rt, promise.get(rt));
  }

  // The same, with the {width, height} object RCTImageLoader getSizeWithHeaders answers. The headers go with the request of an
  // http(s) source, each added in turn.
  jsi::Value getSizeWithHeaders(jsi::Runtime &rt, jsi::String uri, jsi::Object headers) {
    live(rt);
    const auto text = uri.utf8(rt);
    std::vector<std::pair<std::string, std::string>> request_headers;
    const auto names = headers.getPropertyNames(rt);
    for (size_t index = 0, count = names.size(rt); index < count; ++index) {
      const auto name = names.getValueAtIndex(rt, index).getString(rt);
      if (const auto value = header_text(rt, headers.getProperty(rt, name))) request_headers.emplace_back(name.utf8(rt), *value);
    }
    rn::AsyncPromise<std::map<std::string, double>> promise(rt, jsInvoker_);
    state_->loader->measure(text, std::move(request_headers), [promise, state = state_](MeasuredImage size) mutable {
      if (!state->active) return;
      if (size.ok) promise.resolve({{"width", static_cast<double>(size.width)}, {"height", static_cast<double>(size.height)}});
      else promise.reject("E_GET_SIZE_FAILURE: " + size.error);
    });
    return jsi::Value(rt, promise.get(rt));
  }

  // RCTImageLoader prefetchImage: loads the picture as an Image of no size would, so that the cache has it, and resolves true;
  // a failure rejects with E_PREFETCH_FAILURE and the error's text. The metadata only attributes the request.
  jsi::Value prefetchImage(jsi::Runtime &rt, jsi::String uri) { return prefetch(rt, uri.utf8(rt)); }
  jsi::Value prefetchImageWithMetadata(jsi::Runtime &rt, jsi::String uri, jsi::String, double) { return prefetch(rt, uri.utf8(rt)); }

  // RCTImageLoader getImageCacheStatus: the URLs the byte cache holds a response for, as "memory" (the cache has no disk).
  jsi::Value queryCache(jsi::Runtime &rt, jsi::Array uris) {
    live(rt);
    std::map<std::string, std::string> status;
    for (size_t index = 0, count = uris.size(rt); index < count; ++index) {
      const auto value = uris.getValueAtIndex(rt, index);
      if (!value.isString()) continue;
      const auto uri = value.getString(rt).utf8(rt);
      if (auto where = state_->loader->cache_status(uri); !where.empty()) status[uri] = std::move(where);
    }
    rn::AsyncPromise<std::map<std::string, std::string>> promise(rt, jsInvoker_);
    promise.resolve(std::move(status));
    return jsi::Value(rt, promise.get(rt));
  }

 private:
  std::shared_ptr<State> state_;
  void live(jsi::Runtime &rt) const {
    if (!state_->active) throw jsi::JSError(rt, "E_MODULE_DISPOSED: ImageLoader");
  }
  jsi::Value prefetch(jsi::Runtime &rt, const std::string &uri) {
    live(rt);
    rn::AsyncPromise<bool> promise(rt, jsInvoker_);
    state_->loader->prefetch(uri, [promise, state = state_](MeasuredImage result) mutable {
      if (!state->active) return;
      if (result.ok) promise.resolve(true);
      else promise.reject("E_PREFETCH_FAILURE: " + result.error);
    });
    return jsi::Value(rt, promise.get(rt));
  }
};

class ImageLoaderFixture final : public rn::TurboModule {
 public:
  ImageLoaderFixture(const std::shared_ptr<rn::CallInvoker> &invoker, std::shared_ptr<State> state)
      : rn::TurboModule("GodotImageFixture", invoker), state_(std::move(state)) {
    methodMap_["hold"] = {1, hold};
    methodMap_["limit"] = {1, limit};
    methodMap_["budget"] = {1, budget};
    methodMap_["responseLimit"] = {1, response_limit};
  }

 private:
  std::shared_ptr<State> state_;
  static jsi::Value hold(jsi::Runtime &rt, rn::TurboModule &module, const jsi::Value *args, size_t count) {
    auto &fixture = static_cast<ImageLoaderFixture &>(module);
    if (!fixture.state_->active) throw jsi::JSError(rt, "E_MODULE_DISPOSED: GodotImageFixture");
    if (count != 1 || !args[0].isBool()) throw jsi::JSError(rt, "E_ARGUMENT: hold requires one boolean");
    fixture.state_->loader->hold(args[0].getBool());
    return jsi::Value::undefined();
  }
  static jsi::Value budget(jsi::Runtime &rt, rn::TurboModule &module, const jsi::Value *args, size_t count) {
    auto &fixture = static_cast<ImageLoaderFixture &>(module);
    if (!fixture.state_->active) throw jsi::JSError(rt, "E_MODULE_DISPOSED: GodotImageFixture");
    if (count != 1 || !args[0].isNumber() || !(args[0].getNumber() >= 0)) throw jsi::JSError(rt, "E_ARGUMENT: budget requires a number of bytes");
    fixture.state_->loader->budget(static_cast<std::size_t>(args[0].getNumber()));
    return jsi::Value::undefined();
  }
  static jsi::Value response_limit(jsi::Runtime &rt, rn::TurboModule &module, const jsi::Value *args, size_t count) {
    auto &fixture = static_cast<ImageLoaderFixture &>(module);
    if (!fixture.state_->active) throw jsi::JSError(rt, "E_MODULE_DISPOSED: GodotImageFixture");
    if (count != 1 || !args[0].isNumber() || !(args[0].getNumber() >= 0)) throw jsi::JSError(rt, "E_ARGUMENT: responseLimit requires a number of bytes");
    fixture.state_->loader->response_limit(static_cast<uint64_t>(args[0].getNumber()));
    return jsi::Value::undefined();
  }
  static jsi::Value limit(jsi::Runtime &rt, rn::TurboModule &module, const jsi::Value *args, size_t count) {
    auto &fixture = static_cast<ImageLoaderFixture &>(module);
    if (!fixture.state_->active) throw jsi::JSError(rt, "E_MODULE_DISPOSED: GodotImageFixture");
    if (count != 1 || !args[0].isNumber() || !(args[0].getNumber() >= 1)) throw jsi::JSError(rt, "E_ARGUMENT: limit requires a number of at least 1");
    fixture.state_->loader->limit(static_cast<std::size_t>(args[0].getNumber()));
    return jsi::Value::undefined();
  }
};
}  // namespace

void install_image_loader_fixture(TurboModuleRegistry &registry, std::shared_ptr<ImageLoader> loader) {
  // The certification compares decoded pixels with the fixture's: only here do decodes fingerprint them.
  loader->fingerprints(true);
  auto state = std::make_shared<State>();
  state->loader = std::move(loader);
  registry.add("GodotImageFixture",
      [state](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) { return std::make_shared<ImageLoaderFixture>(invoker, state); },
      [state] { state->active = false; });
}

void install_image_loader_module(TurboModuleRegistry &registry, std::shared_ptr<ImageLoader> loader) {
  auto state = std::make_shared<State>();
  state->loader = std::move(loader);
  registry.add(std::string(NativeImageLoader::kModuleName),
      [state](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) { return std::make_shared<NativeImageLoader>(invoker, state); },
      [state] { state->active = false; });
}

}  // namespace fabric_godot
