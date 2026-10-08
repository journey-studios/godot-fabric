#include "device_services.h"
#include "stoppable_invoker.h"
#include "turbo_module_registry.h"
#include "FBReactNativeSpecJSI.h"
#include <ReactCommon/TurboModule.h>
#include <jsi/jsi.h>
#include <react/bridging/Bridging.h>
#include <react/bridging/Promise.h>
#include <functional>
#include <stdexcept>
#include <utility>
#include <vector>

namespace rn = facebook::react;
namespace jsi = facebook::jsi;

namespace fabric_godot {
// The services and what the three modules share. The modules hold it through a
// shared_ptr, so a module RN keeps alive past the application's stop (a method
// JS retained) still finds a stopped state and not a dangling one.
struct DeviceServicesState {
  device::Services core;
  // Set by the LinkingManager module while it exists: Linking's "url" event is
  // emitted through that module's own emitDeviceEvent.
  std::function<void(const std::string &)> emit_url;
  std::size_t linking_created{}, clipboard_created{}, vibration_created{}, settled_dropped{};

  DeviceServicesState(device::Backend backend, std::optional<std::string> initial_url)
      : core(std::move(backend), std::move(initial_url)) {}
  void stop() {
    core.stop();
    emit_url = {};
  }
  // What StoppableInvoker asks of its state: nothing queued runs after a stop, and the drops are counted.
  bool accepts_calls() const { return core.active(); }
  void drop_call() { ++settled_dropped; }
};

namespace {
constexpr const char *clipboard_unavailable_message =
    "E_CLIPBOARD_UNAVAILABLE: this display server has no clipboard";

std::shared_ptr<rn::CallInvoker> guarded(const std::shared_ptr<rn::CallInvoker> &invoker,
    const std::shared_ptr<DeviceServicesState> &state) {
  return std::make_shared<StoppableInvoker<DeviceServicesState>>(invoker, state);
}

// LinkingManager is the module Linking.js uses when Platform.OS is not
// "android" (Godot's is "godot"), with the contract of iOS's RCTLinkingManager:
// openURL resolves true or rejects "Unable to open URL: <url>", getInitialURL
// resolves null without a launch URL, and the "url" event carries {url}.
class NativeLinkingManager final : public rn::NativeLinkingManagerCxxSpec<NativeLinkingManager> {
 public:
  NativeLinkingManager(const std::shared_ptr<rn::CallInvoker> &invoker, std::shared_ptr<DeviceServicesState> state)
      : rn::NativeLinkingManagerCxxSpec<NativeLinkingManager>(invoker), state_(std::move(state)) {
    state_->emit_url = [this](const std::string &url) { emit(url); };
  }
  ~NativeLinkingManager() override { state_->emit_url = {}; }

  jsi::Value getInitialURL(jsi::Runtime &runtime) {
    live(runtime);
    rn::AsyncPromise<std::optional<std::string>> promise(runtime, jsInvoker_);
    promise.resolve(state_->core.initial_url());
    return jsi::Value(runtime, promise.get(runtime));
  }
  jsi::Value canOpenURL(jsi::Runtime &runtime, jsi::String url) {
    live(runtime);
    rn::AsyncPromise<bool> promise(runtime, jsInvoker_);
    promise.resolve(state_->core.can_open_url(url.utf8(runtime)));
    return jsi::Value(runtime, promise.get(runtime));
  }
  jsi::Value openURL(jsi::Runtime &runtime, jsi::String url) {
    live(runtime);
    rn::AsyncPromise<bool> promise(runtime, jsInvoker_);
    const auto text = url.utf8(runtime);
    if (state_->core.open_url(text) == device::OpenResult::Opened) {
      promise.resolve(true);
    } else {
      promise.reject("Unable to open URL: " + text);
    }
    return jsi::Value(runtime, promise.get(runtime));
  }
  // Godot has no app settings screen to open; the promise never resolves in
  // silence.
  jsi::Value openSettings(jsi::Runtime &runtime) {
    live(runtime);
    rn::AsyncPromise<bool> promise(runtime, jsInvoker_);
    state_->core.note_settings_refused();
    promise.reject("Unable to open app settings: unavailable on Godot");
    return jsi::Value(runtime, promise.get(runtime));
  }
  // Linking.js hands this module to NativeEventEmitter on iOS only; elsewhere
  // listeners register with RCTDeviceEventEmitter alone and nothing calls these.
  void addListener(jsi::Runtime &, jsi::String) {}
  void removeListeners(jsi::Runtime &, double) {}

 private:
  std::shared_ptr<DeviceServicesState> state_;
  void live(jsi::Runtime &runtime) const {
    if (!state_->core.active()) {
      throw jsi::JSError(runtime, "E_MODULE_DISPOSED: LinkingManager");
    }
  }
  void emit(const std::string &url) {
    // Queued through RN's emitDeviceEvent: one emit on the runtime's single
    // RCTDeviceEventEmitter reaches every listener of every root, in order.
    emitDeviceEvent("url", [url](jsi::Runtime &runtime, std::vector<jsi::Value> &args) {
      jsi::Object event(runtime);
      event.setProperty(runtime, "url", jsi::String::createFromUtf8(runtime, url));
      args.emplace_back(runtime, event);
    });
  }
};

// The legacy Clipboard module. An unavailable clipboard is an error, never an
// empty string: getString rejects and setString throws E_CLIPBOARD_UNAVAILABLE.
class NativeClipboard final : public rn::NativeClipboardCxxSpec<NativeClipboard> {
 public:
  NativeClipboard(const std::shared_ptr<rn::CallInvoker> &invoker, std::shared_ptr<DeviceServicesState> state)
      : rn::NativeClipboardCxxSpec<NativeClipboard>(invoker), state_(std::move(state)) {}

  jsi::Object getConstants(jsi::Runtime &runtime) {
    live(runtime);
    return jsi::Object(runtime);
  }
  jsi::Value getString(jsi::Runtime &runtime) {
    live(runtime);
    rn::AsyncPromise<std::string> promise(runtime, jsInvoker_);
    if (auto text = state_->core.clipboard_get()) {
      promise.resolve(std::move(*text));
    } else {
      promise.reject(clipboard_unavailable_message);
    }
    return jsi::Value(runtime, promise.get(runtime));
  }
  void setString(jsi::Runtime &runtime, jsi::String content) {
    live(runtime);
    if (!state_->core.clipboard_set(content.utf8(runtime))) {
      throw jsi::JSError(runtime, clipboard_unavailable_message);
    }
  }

 private:
  std::shared_ptr<DeviceServicesState> state_;
  void live(jsi::Runtime &runtime) const {
    if (!state_->core.active()) {
      throw jsi::JSError(runtime, "E_MODULE_DISPOSED: Clipboard");
    }
  }
};

// The Vibration module. Vibration.js drives it through vibrate() alone with
// Platform.OS "godot", scheduling arrays in JS; vibrateByPattern is Android's.
class NativeVibration final : public rn::NativeVibrationCxxSpec<NativeVibration> {
 public:
  NativeVibration(const std::shared_ptr<rn::CallInvoker> &invoker, std::shared_ptr<DeviceServicesState> state)
      : rn::NativeVibrationCxxSpec<NativeVibration>(invoker), state_(std::move(state)) {}

  jsi::Object getConstants(jsi::Runtime &runtime) {
    live(runtime);
    return jsi::Object(runtime);
  }
  void vibrate(jsi::Runtime &runtime, double milliseconds) {
    live(runtime);
    if (!state_->core.vibrate(milliseconds)) {
      throw jsi::JSError(runtime, "E_ARGUMENT: vibrate requires a finite, non-negative duration in milliseconds");
    }
  }
  // Godot's Input.vibrate_handheld has no pattern, repeat or cancel; the
  // original Vibration.js never reaches this on Godot, and a direct call is
  // refused instead of being played as something else.
  void vibrateByPattern(jsi::Runtime &runtime, jsi::Array, double) {
    live(runtime);
    state_->core.note_pattern_refused();
    throw jsi::JSError(runtime, "E_UNSUPPORTED: vibrateByPattern is Android only; Godot vibrates for a duration");
  }
  void cancel(jsi::Runtime &runtime) {
    live(runtime);
    state_->core.cancel_vibration();
  }

 private:
  std::shared_ptr<DeviceServicesState> state_;
  void live(jsi::Runtime &runtime) const {
    if (!state_->core.active()) {
      throw jsi::JSError(runtime, "E_MODULE_DISPOSED: Vibration");
    }
  }
};

folly::dynamic optional_string(const std::optional<std::string> &value) {
  return value ? folly::dynamic(*value) : folly::dynamic(nullptr);
}
}  // namespace

DeviceServices::DeviceServices(device::Backend backend, std::optional<std::string> initial_url)
    : state_(std::make_shared<DeviceServicesState>(std::move(backend), std::move(initial_url))) {}
DeviceServices::~DeviceServices() { state_->stop(); }

void DeviceServices::install(TurboModuleRegistry &registry) {
  const auto state = state_;
  const auto dispose = [state] { state->stop(); };
  registry.add(std::string(NativeLinkingManager::kModuleName),
      [state](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
        ++state->linking_created;
        return std::make_shared<NativeLinkingManager>(guarded(invoker, state), state);
      }, dispose);
  registry.add(std::string(NativeClipboard::kModuleName),
      [state](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
        ++state->clipboard_created;
        return std::make_shared<NativeClipboard>(guarded(invoker, state), state);
      }, dispose);
  registry.add(std::string(NativeVibration::kModuleName),
      [state](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
        ++state->vibration_created;
        return std::make_shared<NativeVibration>(guarded(invoker, state), state);
      }, dispose);
}

bool DeviceServices::deliver_url(const std::string &url) {
  if (!state_->core.accept_url(url)) {
    return false;
  }
  // Without a LinkingManager module (JS never read Linking) there is no JS
  // listener to carry the URL to; it is still accepted, and counted apart.
  const bool observed = static_cast<bool>(state_->emit_url);
  state_->core.note_url_emitted(observed);
  if (observed) {
    state_->emit_url(url);
  }
  return true;
}

void DeviceServices::stop() { state_->stop(); }

folly::dynamic DeviceServices::snapshot() const {
  const auto &s = *state_;
  const auto &c = s.core.counters();
  return folly::dynamic::object("stopped", !s.core.active())
      ("modules", folly::dynamic::object("LinkingManager", s.linking_created)("Clipboard", s.clipboard_created)
          ("Vibration", s.vibration_created))
      ("linking", folly::dynamic::object("launchUrl", optional_string(s.core.launch_url()))
          ("initialUrlReads", c.initial_url_reads)("canOpen", c.can_open)("opened", c.opened)
          ("invalidUrls", c.open_invalid)("refused", c.open_refused)("settingsRefused", c.settings_refused)
          ("urlsAccepted", c.urls_accepted)("urlsRejected", c.urls_rejected)("urlsObserved", c.urls_observed)
          ("urlsUnobserved", c.urls_unobserved))
      ("clipboard", folly::dynamic::object("reads", c.clipboard_reads)("writes", c.clipboard_writes)
          ("unavailable", c.clipboard_unavailable))
      ("vibration", folly::dynamic::object("vibrations", c.vibrations)("refused", c.vibrations_refused)
          ("patternsRefused", c.patterns_refused)("cancels", c.cancels))
      ("settlementsDropped", s.settled_dropped);
}
}
