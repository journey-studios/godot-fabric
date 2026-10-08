#include "image_loader_module.h"
#include "image_loader.h"
#include "turbo_module_registry.h"
#include "FBReactNativeSpecJSI.h"
#include <jsi/jsi.h>
#include <react/bridging/Bridging.h>
#include <react/bridging/Promise.h>
#include <map>
#include <string>
#include <vector>

namespace rn = facebook::react;
namespace jsi = facebook::jsi;

namespace fabric_godot {
namespace {
struct State {
  bool active{true};
  std::shared_ptr<ImageLoader> loader;
};

constexpr const char *no_cache = "this host has no image cache yet: the decoded-image cache and network loading arrive in a later slice";

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
    state_->loader->measure(text, [promise, text, state = state_](MeasuredImage size) mutable {
      if (!state->active) return;
      if (size.ok) promise.resolve({static_cast<double>(size.width), static_cast<double>(size.height)});
      else promise.reject("E_GET_SIZE_FAILURE: Failed to getSize of " + text + ": " + size.error);
    });
    return jsi::Value(rt, promise.get(rt));
  }

  // The same, with the {width, height} object RCTImageLoader getSizeWithHeaders answers. Headers only matter to a network
  // request, which this host does not make yet.
  jsi::Value getSizeWithHeaders(jsi::Runtime &rt, jsi::String uri, jsi::Object) {
    live(rt);
    const auto text = uri.utf8(rt);
    rn::AsyncPromise<std::map<std::string, double>> promise(rt, jsInvoker_);
    state_->loader->measure(text, [promise, state = state_](MeasuredImage size) mutable {
      if (!state->active) return;
      if (size.ok) promise.resolve({{"width", static_cast<double>(size.width)}, {"height", static_cast<double>(size.height)}});
      else promise.reject("E_GET_SIZE_FAILURE: " + size.error);
    });
    return jsi::Value(rt, promise.get(rt));
  }

  jsi::Value prefetchImage(jsi::Runtime &rt, jsi::String) { return refuse_prefetch(rt); }
  jsi::Value prefetchImageWithMetadata(jsi::Runtime &rt, jsi::String, jsi::String, double) { return refuse_prefetch(rt); }

  // Nothing is cached, which is true.
  jsi::Value queryCache(jsi::Runtime &rt, jsi::Array) {
    live(rt);
    rn::AsyncPromise<std::map<std::string, std::string>> promise(rt, jsInvoker_);
    promise.resolve({});
    return jsi::Value(rt, promise.get(rt));
  }

 private:
  std::shared_ptr<State> state_;
  void live(jsi::Runtime &rt) const {
    if (!state_->active) throw jsi::JSError(rt, "E_MODULE_DISPOSED: ImageLoader");
  }
  jsi::Value refuse_prefetch(jsi::Runtime &rt) {
    live(rt);
    rn::AsyncPromise<bool> promise(rt, jsInvoker_);
    promise.reject(std::string("E_PREFETCH_FAILURE: ") + no_cache);
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
