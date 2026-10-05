#include "turbo_module_registry.h"
#include "app_lifecycle.h"
#include "game_service_registry.h"
#include "system_appearance.h"

#include <ReactCommon/TurboModuleBinding.h>
#include <jsi/JSIDynamic.h>
#include <react/bridging/Bridging.h>
#include <react/bridging/Promise.h>
#include <react/nativemodule/featureflags/NativeReactNativeFeatureFlags.h>
#include <react/renderer/runtimescheduler/RuntimeSchedulerCallInvoker.h>
#include <algorithm>
#include <cmath>
#include <map>
#include <optional>
#include <stdexcept>
#include <vector>

namespace rn = facebook::react;
namespace jsi = facebook::jsi;

namespace fabric_godot {
using DeviceDisplayMetrics = rn::NativeDeviceInfoDisplayMetrics<double, double, double, double>;
using DevicePhysicalMetrics = rn::NativeDeviceInfoDisplayMetricsAndroid<double, double, double, double, double>;
using DeviceDimensions = rn::NativeDeviceInfoDimensionsPayload<std::optional<DeviceDisplayMetrics>,
    std::optional<DeviceDisplayMetrics>, std::optional<DevicePhysicalMetrics>, std::optional<DevicePhysicalMetrics>>;
using DeviceConstants = rn::NativeDeviceInfoDeviceInfoConstants<DeviceDimensions, std::optional<bool>, std::optional<bool>>;
using AppStatePayload = rn::NativeAppStateAppState<std::string>;
using AppStateConstants = rn::NativeAppStateAppStateConstants<std::string>;
}
namespace facebook::react {
template <> struct Bridging<fabric_godot::AppStatePayload>
    : NativeAppStateAppStateBridging<fabric_godot::AppStatePayload> {};
template <> struct Bridging<fabric_godot::DeviceDisplayMetrics>
    : NativeDeviceInfoDisplayMetricsBridging<fabric_godot::DeviceDisplayMetrics> {};
template <> struct Bridging<fabric_godot::DevicePhysicalMetrics>
    : NativeDeviceInfoDisplayMetricsAndroidBridging<fabric_godot::DevicePhysicalMetrics> {};
template <> struct Bridging<fabric_godot::DeviceDimensions>
    : NativeDeviceInfoDimensionsPayloadBridging<fabric_godot::DeviceDimensions> {};
template <> struct Bridging<fabric_godot::DeviceConstants>
    : NativeDeviceInfoDeviceInfoConstantsBridging<fabric_godot::DeviceConstants> {};
}

namespace fabric_godot {
namespace {
constexpr const char *fixture_name = "GodotFabricNativeFixture";

struct SourceCodeState {
  bool active{true};
  std::function<std::string()> script_url;
  void stop() { active = false; script_url = {}; }
};

// SourceCode is a platform module: its generated C++ contract and invocation
// are original RN, while the bundle's actual URL comes from the Godot host.
class NativeSourceCode final : public rn::NativeSourceCodeCxxSpec<NativeSourceCode> {
 public:
  NativeSourceCode(const std::shared_ptr<rn::CallInvoker> &invoker,
      std::shared_ptr<SourceCodeState> state)
      : rn::NativeSourceCodeCxxSpec<NativeSourceCode>(invoker), state_(std::move(state)) {}
  jsi::Object getConstants(jsi::Runtime &runtime) {
    if (!state_->active) throw jsi::JSError(runtime, "E_MODULE_DISPOSED: SourceCode");
    const auto url = state_->script_url();
    if (url.empty()) throw jsi::JSError(runtime, "E_SOURCE_CODE: application bundle URL is empty");
    using Constants = rn::NativeSourceCodeSourceCodeConstants<std::string>;
    return rn::NativeSourceCodeSourceCodeConstantsBridging<Constants>::toJs(
        runtime, Constants{url}, jsInvoker_);
  }
 private:
  std::shared_ptr<SourceCodeState> state_;
};

struct DeviceInfoState {
  bool active{true};
  std::function<folly::dynamic()> constants;
  void stop() { active = false; constants = {}; }
};

class NativeDeviceInfo final : public rn::NativeDeviceInfoCxxSpec<NativeDeviceInfo> {
 public:
  NativeDeviceInfo(const std::shared_ptr<rn::CallInvoker> &invoker,
      std::shared_ptr<DeviceInfoState> state)
      : rn::NativeDeviceInfoCxxSpec<NativeDeviceInfo>(invoker), state_(std::move(state)) {}
  jsi::Object getConstants(jsi::Runtime &runtime) {
    if (!state_->active) throw jsi::JSError(runtime, "E_MODULE_DISPOSED: DeviceInfo");
    const auto payload = state_->constants();
    const auto &dimensions = object(runtime, payload, "Dimensions");
    DeviceDimensions metrics{
        display(runtime, dimensions, "window"), display(runtime, dimensions, "screen"),
        physical(runtime, dimensions, "windowPhysicalPixels"), physical(runtime, dimensions, "screenPhysicalPixels")};
    if (!metrics.window && !metrics.windowPhysicalPixels)
      throw jsi::JSError(runtime, "E_DEVICE_INFO: Dimensions requires window or windowPhysicalPixels");
    DeviceConstants constants{metrics, boolean(runtime, payload, "isEdgeToEdge"),
        boolean(runtime, payload, "isIPhoneX_deprecated")};
    return rn::Bridging<DeviceConstants>::toJs(runtime, constants, jsInvoker_);
  }
 private:
  std::shared_ptr<DeviceInfoState> state_;
  static const folly::dynamic &object(jsi::Runtime &runtime, const folly::dynamic &parent, const char *name) {
    const auto *value = parent.isObject() ? parent.get_ptr(name) : nullptr;
    if (!value || !value->isObject())
      throw jsi::JSError(runtime, std::string("E_DEVICE_INFO: ") + name + " must be an object");
    return *value;
  }
  static double number(jsi::Runtime &runtime, const folly::dynamic &parent, const char *name, bool positive) {
    const auto *value = parent.get_ptr(name);
    if (!value || !value->isNumber() || !std::isfinite(value->asDouble()) ||
        (positive ? value->asDouble() <= 0 : value->asDouble() < 0))
      throw jsi::JSError(runtime, std::string("E_DEVICE_INFO: ") + name +
          (positive ? " must be finite and positive" : " must be finite and nonnegative"));
    return value->asDouble();
  }
  static std::optional<DeviceDisplayMetrics> display(jsi::Runtime &runtime, const folly::dynamic &parent, const char *name) {
    const auto *value = parent.get_ptr(name);
    if (!value || value->isNull()) return {};
    const auto &metrics = object(runtime, parent, name);
    return DeviceDisplayMetrics{number(runtime, metrics, "width", false), number(runtime, metrics, "height", false),
        number(runtime, metrics, "scale", true), number(runtime, metrics, "fontScale", true)};
  }
  static std::optional<DevicePhysicalMetrics> physical(jsi::Runtime &runtime, const folly::dynamic &parent, const char *name) {
    const auto *value = parent.get_ptr(name);
    if (!value || value->isNull()) return {};
    const auto &metrics = object(runtime, parent, name);
    return DevicePhysicalMetrics{number(runtime, metrics, "width", false), number(runtime, metrics, "height", false),
        number(runtime, metrics, "scale", true), number(runtime, metrics, "fontScale", true),
        number(runtime, metrics, "densityDpi", true)};
  }
  static std::optional<bool> boolean(jsi::Runtime &runtime, const folly::dynamic &parent, const char *name) {
    const auto *value = parent.get_ptr(name);
    if (!value || value->isNull()) return {};
    if (!value->isBool()) throw jsi::JSError(runtime, std::string("E_DEVICE_INFO: ") + name + " must be boolean");
    return value->asBool();
  }
};

struct AppStateModuleState {
  bool active{true};
  std::shared_ptr<AppLifecycle> lifecycle;
  void stop() {
    if (!active) return;
    active = false;
    lifecycle->release();
  }
};

// AppState is a platform module: its generated C++ contract, payloads and the
// RCTDeviceEventEmitter delivery are original RN, while the state comes from
// the Godot lifecycle notifications of the owning application.
class NativeAppState final : public rn::NativeAppStateCxxSpec<NativeAppState> {
 public:
  NativeAppState(const std::shared_ptr<rn::CallInvoker> &invoker,
      std::shared_ptr<AppStateModuleState> state)
      : rn::NativeAppStateCxxSpec<NativeAppState>(invoker), state_(std::move(state)),
        // As in RCTAppState's initialize, the constant is the state at creation.
        initial_(state_->lifecycle->state()) {
    // Like AnimatedModule, events capture only copied values; delivery is
    // queued through RN's emitDeviceEvent and never re-enters this object.
    state_->lifecycle->observe([this](AppLifecycle::Event event, const std::string &app_state, bool focused) {
      emit(event, app_state, focused);
    });
  }
  ~NativeAppState() override { state_->stop(); }
  jsi::Object getConstants(jsi::Runtime &runtime) {
    live(runtime);
    return rn::NativeAppStateAppStateConstantsBridging<AppStateConstants>::toJs(
        runtime, AppStateConstants{initial_}, jsInvoker_);
  }
  // iOS and Android answer asynchronously with the current state; neither
  // platform ever calls the error callback.
  void getCurrentAppState(jsi::Runtime &runtime, rn::AsyncCallback<AppStatePayload> success, jsi::Function) {
    live(runtime);
    success(AppStatePayload{state_->lifecycle->state()});
  }
  // AppState.js hands this module to NativeEventEmitter on iOS only, so these
  // are the no-ops of Android's AppStateModule.
  void addListener(jsi::Runtime &, jsi::String) {}
  void removeListeners(jsi::Runtime &, double) {}

 private:
  std::shared_ptr<AppStateModuleState> state_;
  std::string initial_;
  void live(jsi::Runtime &runtime) const {
    if (!state_->active) throw jsi::JSError(runtime, "E_MODULE_DISPOSED: AppState");
  }
  void emit(AppLifecycle::Event event, const std::string &app_state, bool focused) {
    switch (event) {
      case AppLifecycle::Event::State:
        emitDeviceEvent("appStateDidChange", [app_state, invoker = jsInvoker_](
            jsi::Runtime &runtime, std::vector<jsi::Value> &args) {
          args.emplace_back(rn::Bridging<AppStatePayload>::toJs(runtime, AppStatePayload{app_state}, invoker));
        });
        break;
      case AppLifecycle::Event::Focus:
        emitDeviceEvent("appStateFocusChange", [focused](jsi::Runtime &, std::vector<jsi::Value> &args) {
          args.emplace_back(focused);
        });
        break;
      case AppLifecycle::Event::MemoryWarning:
        // RCTAppState sends memoryWarning without a body.
        emitDeviceEvent("memoryWarning");
        break;
    }
  }
};

struct AppearanceModuleState {
  bool active{true};
  std::shared_ptr<SystemAppearance> appearance;
  void stop() {
    if (!active) return;
    active = false;
    appearance->release();
  }
};

// Appearance is a platform module: its generated C++ contract and the
// RCTDeviceEventEmitter delivery are original RN, while the scheme comes from
// Godot's system theme and the application's override.
class NativeAppearance final : public rn::NativeAppearanceCxxSpec<NativeAppearance> {
 public:
  NativeAppearance(const std::shared_ptr<rn::CallInvoker> &invoker,
      std::shared_ptr<AppearanceModuleState> state)
      : rn::NativeAppearanceCxxSpec<NativeAppearance>(invoker), state_(std::move(state)) {
    state_->appearance->observe([this](const std::string &scheme) { emit(scheme); });
  }
  ~NativeAppearance() override { state_->stop(); }
  std::string getColorScheme(jsi::Runtime &runtime) {
    live(runtime);
    return state_->appearance->scheme();
  }
  void setColorScheme(jsi::Runtime &runtime, jsi::String style) {
    live(runtime);
    try { state_->appearance->set_override(style.utf8(runtime)); }
    catch (const std::invalid_argument &error) { throw jsi::JSError(runtime, std::string("E_ARGUMENT: ") + error.what()); }
  }
  // Appearance.js hands this module to NativeEventEmitter on every platform.
  // As in Android's AppearanceModule nothing is gated on the count.
  void addListener(jsi::Runtime &runtime, jsi::String) {
    live(runtime);
    state_->appearance->add_listener();
  }
  void removeListeners(jsi::Runtime &runtime, double count) {
    // Late cleanup stays safe after disposal without restoring authority.
    if (!state_->active) return;
    try { state_->appearance->remove_listeners(count); }
    catch (const std::invalid_argument &error) { throw jsi::JSError(runtime, std::string("E_ARGUMENT: ") + error.what()); }
  }

 private:
  std::shared_ptr<AppearanceModuleState> state_;
  void live(jsi::Runtime &runtime) const {
    if (!state_->active) throw jsi::JSError(runtime, "E_MODULE_DISPOSED: Appearance");
  }
  void emit(const std::string &scheme) {
    // Both platforms send AppearancePreferences: {colorScheme}.
    emitDeviceEvent("appearanceChanged", [scheme](jsi::Runtime &runtime, std::vector<jsi::Value> &args) {
      jsi::Object preferences(runtime);
      preferences.setProperty(runtime, "colorScheme", jsi::String::createFromUtf8(runtime, scheme));
      args.emplace_back(runtime, preferences);
    });
  }
};

double finite_number(jsi::Runtime &runtime, const jsi::Value *args,
    size_t count, size_t index, const char *method) {
  if (count <= index || !args[index].isNumber() || !std::isfinite(args[index].asNumber()))
    throw jsi::JSError(runtime, std::string("E_ARGUMENT: ") + method + " requires finite numbers");
  return args[index].asNumber();
}

struct FixtureState {
  bool active{true};
  uint64_t runtime_id;
  double value{};
  size_t legacy_listeners{};
  size_t calls{};
  size_t emissions{};
  size_t completions{};
  size_t disposals{};
  std::shared_ptr<rn::AsyncEventEmitter<double>> event = std::make_shared<rn::AsyncEventEmitter<double>>();

  explicit FixtureState(uint64_t id) : runtime_id(id) {}
  void stop() {
    if (!active) return;
    active = false;
    legacy_listeners = 0;
    ++disposals;
  }
};

// RN keeps listener callbacks weakly, while this platform gate invalidates an
// already queued native event when its module lifetime ends. Promise settlement
// uses the ordinary invoker so disposal can still reject accepted operations.
class EventLifetimeInvoker final : public rn::CallInvoker {
 public:
  EventLifetimeInvoker(std::shared_ptr<rn::CallInvoker> delegate, std::weak_ptr<FixtureState> owner)
      : delegate_(std::move(delegate)), owner_(std::move(owner)) {}
  void invokeAsync(rn::CallFunc &&function) noexcept override {
    delegate_->invokeAsync(guard(std::move(function)));
  }
  void invokeAsync(rn::SchedulerPriority priority, rn::CallFunc &&function) noexcept override {
    delegate_->invokeAsync(priority, guard(std::move(function)));
  }
  void invokeSync(rn::CallFunc &&function) override { delegate_->invokeSync(guard(std::move(function))); }
 private:
  std::shared_ptr<rn::CallInvoker> delegate_;
  std::weak_ptr<FixtureState> owner_;
  rn::CallFunc guard(rn::CallFunc &&function) const {
    return [owner = owner_, function = std::move(function)](jsi::Runtime &runtime) {
      auto state = owner.lock();
      if (state && state->active) function(runtime);
    };
  }
};

// Concrete native module used by the executable acceptance fixture. It has
// real RN TurboModule/AsyncPromise/AsyncEventEmitter behavior, not a JS mock.
class NativeFixture final : public rn::TurboModule {
 public:
  NativeFixture(const std::shared_ptr<rn::CallInvoker> &invoker,
      std::shared_ptr<FixtureState> state)
      : rn::TurboModule(fixture_name, invoker), state_(std::move(state)),
        event_invoker_(std::make_shared<EventLifetimeInvoker>(invoker, state_)) {
    methodMap_["getConstants"] = {0, constants};
    methodMap_["add"] = {2, add};
    methodMap_["addAsync"] = {2, add_async};
    methodMap_["failSync"] = {0, fail_sync};
    methodMap_["failAsync"] = {0, fail_async};
    methodMap_["emitValue"] = {1, emit_value};
    methodMap_["emitLegacy"] = {1, emit_legacy};
    methodMap_["addListener"] = {1, add_listener};
    methodMap_["removeListeners"] = {1, remove_listeners};
    methodMap_["getStats"] = {0, stats};
    methodMap_["dispose"] = {0, dispose};
    eventEmitterMap_["onValue"] = state_->event;
  }

 private:
  std::shared_ptr<FixtureState> state_;
  std::shared_ptr<rn::CallInvoker> event_invoker_;
  jsi::Value create(jsi::Runtime &runtime, const jsi::PropNameID &name) override {
    if (name.utf8(runtime) == "onValue") {
      if (!state_->active) throw jsi::JSError(runtime, "E_MODULE_DISPOSED: event subscription");
      return jsi::Function::createFromHostFunction(runtime, name, 1,
          [owner = state_, invoker = event_invoker_](jsi::Runtime &rt,
              const jsi::Value &, const jsi::Value *args, size_t count) {
            if (!owner->active) throw jsi::JSError(rt, "E_MODULE_DISPOSED: event subscription");
            return owner->event->get(rt, invoker).asFunction(rt).call(rt, args, count);
          });
    }
    return rn::TurboModule::create(runtime, name);
  }
  static NativeFixture &self(rn::TurboModule &module) { return static_cast<NativeFixture &>(module); }
  static NativeFixture &live(jsi::Runtime &runtime, rn::TurboModule &module) {
    auto &fixture = self(module);
    if (!fixture.state_->active) throw jsi::JSError(runtime, "E_MODULE_DISPOSED: GodotFabricNativeFixture");
    ++fixture.state_->calls;
    return fixture;
  }
  static double sum(jsi::Runtime &runtime, const jsi::Value *args, size_t count) {
    if (count != 2) throw jsi::JSError(runtime, "E_ARGUMENT: add requires exactly two numbers");
    const auto result = finite_number(runtime, args, count, 0, "add") + finite_number(runtime, args, count, 1, "add");
    if (!std::isfinite(result)) throw jsi::JSError(runtime, "E_ARGUMENT: add result must be finite");
    return result;
  }
  static jsi::Value constants(jsi::Runtime &runtime, rn::TurboModule &module, const jsi::Value *, size_t count) {
    auto &fixture = live(runtime, module);
    if (count) throw jsi::JSError(runtime, "E_ARGUMENT: getConstants takes no arguments");
    return jsi::valueFromDynamic(runtime, folly::dynamic::object
        ("runtimeId", std::to_string(fixture.state_->runtime_id))("apiVersion", 1)("implementation", "upstream-cxx-turbomodule"));
  }
  static jsi::Value add(jsi::Runtime &runtime, rn::TurboModule &module, const jsi::Value *args, size_t count) {
    live(runtime, module);
    return jsi::Value(sum(runtime, args, count));
  }
  static jsi::Value add_async(jsi::Runtime &runtime, rn::TurboModule &module, const jsi::Value *args, size_t count) {
    auto &fixture = live(runtime, module);
    const double result = sum(runtime, args, count);
    rn::AsyncPromise<double> promise(runtime, fixture.jsInvoker_);
    // No jsi::Value or callback escapes the executor. RN owns the callbacks
    // weakly and releases them with its LongLivedObjectCollection on shutdown.
    std::weak_ptr<FixtureState> state = fixture.state_;
    fixture.jsInvoker_->invokeAsync([promise, state, result](jsi::Runtime &) mutable {
      auto owner = state.lock();
      if (!owner || !owner->active) { promise.reject("E_MODULE_DISPOSED: asynchronous operation canceled"); return; }
      ++owner->completions;
      promise.resolve(result);
    });
    return promise.get(runtime);
  }
  static jsi::Value fail_sync(jsi::Runtime &runtime, rn::TurboModule &module, const jsi::Value *, size_t) {
    live(runtime, module);
    throw jsi::JSError(runtime, "E_FIXTURE_SYNC: intentional native exception");
  }
  static jsi::Value fail_async(jsi::Runtime &runtime, rn::TurboModule &module, const jsi::Value *, size_t) {
    auto &fixture = live(runtime, module);
    rn::AsyncPromise<double> promise(runtime, fixture.jsInvoker_);
    fixture.jsInvoker_->invokeAsync([promise](jsi::Runtime &) mutable {
      promise.reject("E_FIXTURE_ASYNC: intentional native rejection");
    });
    return promise.get(runtime);
  }
  static jsi::Value emit_value(jsi::Runtime &runtime, rn::TurboModule &module, const jsi::Value *args, size_t count) {
    auto &fixture = live(runtime, module);
    if (count != 1) throw jsi::JSError(runtime, "E_ARGUMENT: emitValue requires one number");
    fixture.state_->value = finite_number(runtime, args, count, 0, "emitValue");
    ++fixture.state_->emissions;
    fixture.state_->event->emit(fixture.state_->value);
    return jsi::Value::undefined();
  }
  static jsi::Value emit_legacy(jsi::Runtime &runtime, rn::TurboModule &module, const jsi::Value *args, size_t count) {
    auto &fixture = live(runtime, module);
    if (count != 1) throw jsi::JSError(runtime, "E_ARGUMENT: emitLegacy requires one number");
    const double value = finite_number(runtime, args, count, 0, "emitLegacy");
    std::weak_ptr<FixtureState> owner = fixture.state_;
    fixture.jsInvoker_->invokeAsync([owner, value](jsi::Runtime &rt) {
      auto state = owner.lock();
      if (!state || !state->active) return;
      // NativeEventEmitter is original RN; the native side merely delivers its
      // named event through the upstream device emitter in the JS executor.
      auto emitter = rt.global().getProperty(rt, "__rctDeviceEventEmitter");
      if (!emitter.isObject()) throw jsi::JSError(rt, "E_EVENT_RUNTIME: RCTDeviceEventEmitter is not initialized");
      auto object = emitter.asObject(rt);
      object.getPropertyAsFunction(rt, "emit").callWithThis(rt, object,
          jsi::String::createFromUtf8(rt, "GodotFabricNativeFixture.value"), value);
    });
    return jsi::Value::undefined();
  }
  static jsi::Value add_listener(jsi::Runtime &runtime, rn::TurboModule &module, const jsi::Value *args, size_t count) {
    auto &fixture = live(runtime, module);
    if (count != 1 || !args[0].isString() || args[0].asString(runtime).utf8(runtime) != "GodotFabricNativeFixture.value")
      throw jsi::JSError(runtime, "E_ARGUMENT: unknown fixture event");
    ++fixture.state_->legacy_listeners;
    return jsi::Value::undefined();
  }
  static jsi::Value remove_listeners(jsi::Runtime &runtime, rn::TurboModule &module, const jsi::Value *args, size_t count) {
    auto &fixture = self(module);
    if (count != 1) throw jsi::JSError(runtime, "E_ARGUMENT: removeListeners requires a nonnegative integer");
    const auto number = finite_number(runtime, args, count, 0, "removeListeners");
    if (number < 0 || std::floor(number) != number || number > 9007199254740991.0)
      throw jsi::JSError(runtime, "E_ARGUMENT: removeListeners requires a nonnegative safe integer");
    // Original NativeEventEmitter calls this before removing its JS callback.
    // Late cleanup must stay safe after disposal without restoring authority.
    if (!fixture.state_->active) return jsi::Value::undefined();
    ++fixture.state_->calls;
    fixture.state_->legacy_listeners -= static_cast<size_t>(std::min<double>(number, fixture.state_->legacy_listeners));
    return jsi::Value::undefined();
  }
  static jsi::Value stats(jsi::Runtime &runtime, rn::TurboModule &module, const jsi::Value *, size_t) {
    const auto &state = *live(runtime, module).state_;
    return jsi::valueFromDynamic(runtime, folly::dynamic::object("value", state.value)
        ("calls", state.calls)("emissions", state.emissions)("completions", state.completions)("listeners", state.legacy_listeners));
  }
  static jsi::Value dispose(jsi::Runtime &, rn::TurboModule &module, const jsi::Value *, size_t) {
    self(module).state_->stop();
    return jsi::Value::undefined();
  }
};
}

struct TurboModuleRegistry::State {
  struct Entry { Factory factory; Dispose dispose; std::shared_ptr<rn::TurboModule> module; };
  struct Callable { std::optional<jsi::Function> factory; std::optional<jsi::Object> module; };
  uint64_t runtime_id;
  bool installed{}, stopped{};
  size_t lookups{}, creations{}, disposals{}, callable_calls{}, stale_calls{};
  std::shared_ptr<rn::CallInvoker> invoker;
  std::shared_ptr<rn::LongLivedObjectCollection> collection = std::make_shared<rn::LongLivedObjectCollection>();
  std::map<std::string, Entry> entries;
  // RN's generated host functions capture TurboModule::this. Disposed modules
  // therefore remain native-alive until the VM and its binding release State,
  // even if JS retains only an extracted method instead of the module object.
  std::vector<std::shared_ptr<rn::TurboModule>> retired_modules;
  std::map<std::string, Callable> callables;
  std::shared_ptr<FixtureState> fixture;

  State(uint64_t id, const std::shared_ptr<rn::RuntimeScheduler> &scheduler)
      : runtime_id(id), invoker(std::make_shared<rn::RuntimeSchedulerCallInvoker>(scheduler)) {}
  std::shared_ptr<rn::TurboModule> lookup(jsi::Runtime &runtime, const std::string &name) {
    if (stopped) throw jsi::JSError(runtime, "E_RUNTIME_STOPPED: native module lookup");
    ++lookups;
    auto found = entries.find(name);
    if (found == entries.end()) return nullptr;
    auto &entry = found->second;
    if (!entry.module) {
      entry.module = entry.factory(runtime, invoker);
      if (!entry.module) throw jsi::JSError(runtime, "E_MODULE_FACTORY: provider returned null for " + name);
      ++creations;
    }
    return entry.module;
  }
};

TurboModuleRegistry::TurboModuleRegistry(uint64_t runtime_id, const std::shared_ptr<rn::RuntimeScheduler> &scheduler)
    : state_(std::make_shared<State>(runtime_id, scheduler)) {
  if (!scheduler) throw std::invalid_argument("TurboModuleRegistry requires a RuntimeScheduler");
}
TurboModuleRegistry::~TurboModuleRegistry() = default;
void TurboModuleRegistry::add(const std::string &name, Factory factory, Dispose dispose) {
  if (state_->stopped) throw std::runtime_error("E_RUNTIME_STOPPED: register native module");
  if (name.empty() || !factory) throw std::invalid_argument("Native module requires a name and factory");
  if (!state_->entries.emplace(name, State::Entry{std::move(factory), std::move(dispose), nullptr}).second)
    throw std::invalid_argument("E_MODULE_DUPLICATE: " + name);
}
void TurboModuleRegistry::add_source_code(std::function<std::string()> script_url) {
  if (!script_url) throw std::invalid_argument("SourceCode requires the application's bundle URL getter");
  auto source = std::make_shared<SourceCodeState>();
  source->script_url = std::move(script_url);
  add(std::string(NativeSourceCode::kModuleName),
      [source](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
        return std::make_shared<NativeSourceCode>(invoker, source);
      }, [source] { source->stop(); });
}
void TurboModuleRegistry::add_device_info(std::function<folly::dynamic()> constants) {
  if (!constants) throw std::invalid_argument("DeviceInfo requires the application's display metrics getter");
  auto device = std::make_shared<DeviceInfoState>();
  device->constants = std::move(constants);
  add(std::string(NativeDeviceInfo::kModuleName),
      [device](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
        return std::make_shared<NativeDeviceInfo>(invoker, device);
      }, [device] { device->stop(); });
}
void TurboModuleRegistry::add_app_state(const std::shared_ptr<AppLifecycle> &lifecycle) {
  if (!lifecycle) throw std::invalid_argument("AppState requires the application's lifecycle");
  auto app_state = std::make_shared<AppStateModuleState>();
  app_state->lifecycle = lifecycle;
  add(std::string(NativeAppState::kModuleName),
      [app_state](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
        return std::make_shared<NativeAppState>(invoker, app_state);
      }, [app_state] { app_state->stop(); });
}
void TurboModuleRegistry::add_appearance(const std::shared_ptr<SystemAppearance> &appearance) {
  if (!appearance) throw std::invalid_argument("Appearance requires the application's system appearance");
  auto state = std::make_shared<AppearanceModuleState>();
  state->appearance = appearance;
  add(std::string(NativeAppearance::kModuleName),
      [state](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
        return std::make_shared<NativeAppearance>(invoker, state);
      }, [state] { state->stop(); });
}
void TurboModuleRegistry::add_feature_flags() {
  add(std::string(rn::NativeReactNativeFeatureFlags::kModuleName),
      [](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
        return std::make_shared<rn::NativeReactNativeFeatureFlags>(invoker);
      });
}
void TurboModuleRegistry::add_game_services(const std::shared_ptr<GameServiceRegistry> &services) {
  if (!services) throw std::invalid_argument("Game services require the application's registry");
  add("GodotFabricServices", [services](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
    return services->create_module(invoker);
  }, [services] { services->stop(); });
}
void TurboModuleRegistry::add_fixture() {
  auto fixture = std::make_shared<FixtureState>(state_->runtime_id);
  add(fixture_name, [fixture](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
    return std::make_shared<NativeFixture>(invoker, fixture);
  }, [fixture] { fixture->stop(); });
  state_->fixture = std::move(fixture);
}
void TurboModuleRegistry::install(jsi::Runtime &runtime) {
  if (state_->stopped || state_->installed) throw std::runtime_error("Native module binding must be installed exactly once per runtime");
  auto state = state_;
  runtime.global().setProperty(runtime, "RN$Bridgeless", true);
  runtime.global().setProperty(runtime, "RN$registerCallableModule", jsi::Function::createFromHostFunction(
      runtime, jsi::PropNameID::forAscii(runtime, "RN$registerCallableModule"), 2,
      [state](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
        if (state->stopped) throw jsi::JSError(rt, "E_RUNTIME_STOPPED: register callable module");
        if (count != 2)
          throw jsi::JSError(rt, "registerCallableModule requires exactly 2 arguments");
        if (!args[0].isString())
          throw jsi::JSError(rt, "The first argument to registerCallableModule must be a string (the name of the JS module).");
        const auto name = args[0].asString(rt).utf8(rt);
        if (!args[1].isObject() || !args[1].asObject(rt).isFunction(rt))
          throw jsi::JSError(rt, "The second argument to registerCallableModule must be a function that returns the JS module.");
        State::Callable callable;
        callable.factory.emplace(args[1].asObject(rt).asFunction(rt));
        // Match ReactInstance: an existing callable keeps its first factory or
        // resolved module; repeated registration does not throw or replace it.
        state->callables.emplace(name, std::move(callable));
        return jsi::Value::undefined();
      }));
  rn::TurboModuleBinding::install(runtime,
      [state](jsi::Runtime &rt, const std::string &name) { return state->lookup(rt, name); },
      nullptr, state->collection);
  state_->installed = true;
}
void TurboModuleRegistry::invoke_callable(const std::string &name, const std::string &method, folly::dynamic arguments) {
  if (state_->stopped) throw std::runtime_error("E_RUNTIME_STOPPED: invoke callable module");
  if (!state_->installed || name.empty() || method.empty() || !arguments.isArray())
    throw std::invalid_argument("Callable invocation requires an installed runtime, module/method names and argument array");
  std::weak_ptr<State> owner = state_;
  state_->invoker->invokeAsync([owner, name, method, arguments = std::move(arguments)](jsi::Runtime &runtime) {
    auto state = owner.lock();
    if (!state) return;
    if (state->stopped) { ++state->stale_calls; return; }
    auto found = state->callables.find(name);
    if (found == state->callables.end()) throw jsi::JSError(runtime, "E_CALLABLE_MISSING: " + name);
    auto &callable = found->second;
    if (!callable.module) {
      const auto result = callable.factory->call(runtime);
      if (!result.isObject()) throw jsi::JSError(runtime, "E_CALLABLE_FACTORY: " + name + " must return a module object");
      callable.module.emplace(result.asObject(runtime));
      callable.factory.reset();
    }
    std::vector<jsi::Value> args;
    for (const auto &arg : arguments) args.emplace_back(jsi::valueFromDynamic(runtime, arg));
    auto function = callable.module->getProperty(runtime, method.c_str());
    if (!function.isObject() || !function.asObject(runtime).isFunction(runtime))
      throw jsi::JSError(runtime, "E_CALLABLE_METHOD: " + name + "." + method);
    ++state->callable_calls;
    function.asObject(runtime).asFunction(runtime).callWithThis(runtime, *callable.module,
        static_cast<const jsi::Value *>(args.data()), args.size());
  });
}
void TurboModuleRegistry::stop(jsi::Runtime &runtime) {
  if (state_->stopped) return;
  state_->stopped = true;
  // Mark all providers dead before invoking disposal. A queued call therefore
  // cannot re-create a module or enter a disposed Godot service.
  std::vector<std::string> errors;
  for (auto &[name, entry] : state_->entries) {
    if (entry.module && entry.dispose) {
      try { entry.dispose(); }
      catch (const std::exception &error) { errors.push_back(name + ": " + error.what()); }
      catch (...) { errors.push_back(name + ": unknown native exception"); }
      ++state_->disposals;
    }
    if (entry.module) state_->retired_modules.push_back(std::move(entry.module));
    entry.factory = {};
    entry.dispose = {};
  }
  state_->callables.clear();
  state_->collection->clear();
  rn::LongLivedObjectCollection::get(runtime).clear();
  if (!errors.empty()) {
    std::string message = "E_MODULE_DISPOSAL";
    for (const auto &error : errors) message += "; " + error;
    throw std::runtime_error(message);
  }
}
folly::dynamic TurboModuleRegistry::snapshot() const {
  size_t loaded = 0;
  for (const auto &[name, entry] : state_->entries) if (entry.module) ++loaded;
  folly::dynamic result = folly::dynamic::object("runtimeId", std::to_string(state_->runtime_id))
      ("installed", state_->installed)("stopped", state_->stopped)("registered", state_->entries.size())
      ("loaded", loaded)("lookups", state_->lookups)("creations", state_->creations)("disposals", state_->disposals)
      ("retainedUntilVMDestroy", state_->retired_modules.size())
      ("callableModules", state_->callables.size())("callableCalls", state_->callable_calls)("staleCalls", state_->stale_calls);
  if (state_->fixture) result["fixture"] = folly::dynamic::object("active", state_->fixture->active)
      ("listeners", state_->fixture->legacy_listeners)("disposals", state_->fixture->disposals);
  return result;
}
}
