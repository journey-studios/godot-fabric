#include "accessibility_info.h"
#include "fabric_application.h"
#include "stoppable_invoker.h"
#include "turbo_module_registry.h"
#include "FBReactNativeSpecJSI.h"
#include <ReactCommon/TurboModule.h>
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/core/object.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/variant.hpp>
#include <jsi/jsi.h>
#include <react/bridging/Bridging.h>
#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace rn = facebook::react;
namespace jsi = facebook::jsi;

namespace fabric_godot {
// The owner and what the module shares with it. The module holds it through a shared_ptr, so a module RN keeps
// alive past the application's stop (a method JS retained) still finds a stopped state and not a dangling one.
struct AccessibilityInfoState {
  accessibility::Settings core;
  // Set by the AccessibilityManager module while it exists: the settings' device events are emitted through that
  // module's own emitDeviceEvent.
  std::function<void(accessibility::Setting, bool)> emit;
  std::size_t manager_created{}, events_unobserved{}, settled_dropped{};

  explicit AccessibilityInfoState(accessibility::Backend backend) : core(std::move(backend)) {}
  void stop() {
    core.stop();
    emit = {};
  }
  // What StoppableInvoker asks of its state: nothing queued runs after a stop, and the drops are counted.
  bool accepts_calls() const { return core.active(); }
  void drop_call() { ++settled_dropped; }
};

namespace {
using accessibility::Reading;
using accessibility::Setting;
using accessibility::Unbacked;

std::shared_ptr<rn::CallInvoker> guarded(const std::shared_ptr<rn::CallInvoker> &invoker,
    const std::shared_ptr<AccessibilityInfoState> &state) {
  return std::make_shared<StoppableInvoker<AccessibilityInfoState>>(invoker, state);
}

const char *description(Setting setting) {
  switch (setting) {
    case Setting::ScreenReader: return "the screen reader";
    case Setting::ReduceMotion: return "reduce motion";
    case Setting::ReduceTransparency: return "reduce transparency";
    case Setting::IncreaseContrast: return "increase contrast";
  }
  return "";
}
const char *description(Unbacked setting) {
  switch (setting) {
    case Unbacked::BoldText: return "bold text";
    case Unbacked::Grayscale: return "grayscale";
    case Unbacked::InvertColors: return "inverted colors";
    case Unbacked::CrossFadeTransitions: return "the preference for cross-fade transitions";
  }
  return "";
}

// AccessibilityManager is the module AccessibilityInfo.js uses when Platform.OS is not "android" (Godot's is
// "godot"), with the contract of iOS's RCTAccessibilityManager: the getters hand the setting to a success callback
// and an error to the other, and the changes are device events whose body is the new boolean. The settings come from
// the application's Godot backend; the ones Godot cannot read reject, and the announcement and the focus, which are
// the next slice's, throw.
class NativeAccessibilityManager final : public rn::NativeAccessibilityManagerCxxSpec<NativeAccessibilityManager> {
 public:
  NativeAccessibilityManager(const std::shared_ptr<rn::CallInvoker> &invoker, std::shared_ptr<AccessibilityInfoState> state)
      : rn::NativeAccessibilityManagerCxxSpec<NativeAccessibilityManager>(invoker), state_(std::move(state)) {
    // As RCTAccessibilityManager's init reads the settings: these readings are the baseline of the later events.
    state_->core.start();
    state_->emit = [this](Setting setting, bool value) { emit(setting, value); };
  }
  ~NativeAccessibilityManager() override { state_->emit = {}; }

  void getCurrentVoiceOverState(jsi::Runtime &runtime, rn::AsyncCallback<bool> success, jsi::Function error) {
    answer(runtime, Setting::ScreenReader, std::move(success), error);
  }
  void getCurrentReduceMotionState(jsi::Runtime &runtime, rn::AsyncCallback<bool> success, jsi::Function error) {
    answer(runtime, Setting::ReduceMotion, std::move(success), error);
  }
  void getCurrentReduceTransparencyState(jsi::Runtime &runtime, rn::AsyncCallback<bool> success, jsi::Function error) {
    answer(runtime, Setting::ReduceTransparency, std::move(success), error);
  }
  void getCurrentDarkerSystemColorsState(jsi::Runtime &runtime, rn::AsyncCallback<bool> success, jsi::Function error) {
    answer(runtime, Setting::IncreaseContrast, std::move(success), error);
  }
  void getCurrentBoldTextState(jsi::Runtime &runtime, rn::AsyncCallback<bool>, jsi::Function error) {
    unavailable(runtime, Unbacked::BoldText, error);
  }
  void getCurrentGrayscaleState(jsi::Runtime &runtime, rn::AsyncCallback<bool>, jsi::Function error) {
    unavailable(runtime, Unbacked::Grayscale, error);
  }
  void getCurrentInvertColorsState(jsi::Runtime &runtime, rn::AsyncCallback<bool>, jsi::Function error) {
    unavailable(runtime, Unbacked::InvertColors, error);
  }
  void getCurrentPrefersCrossFadeTransitionsState(jsi::Runtime &runtime, rn::AsyncCallback<bool>, jsi::Function error) {
    unavailable(runtime, Unbacked::CrossFadeTransitions, error);
  }

  // Godot has no content size category to scale: the argument is checked (a number above zero or nothing for each
  // category) and a valid one is refused, so a call never looks like it took effect.
  void setAccessibilityContentSizeMultipliers(jsi::Runtime &runtime, jsi::Object multipliers) {
    live(runtime);
    for (const auto category : accessibility::content_size_categories) {
      const auto value = multipliers.getProperty(runtime, std::string(category).c_str());
      if (value.isUndefined() || value.isNull()) {
        continue;
      }
      if (!value.isNumber() || !accessibility::valid_multiplier(value.asNumber())) {
        state_->core.note_content_size_invalid();
        throw jsi::JSError(runtime, std::string(accessibility::code_argument) + ": setAccessibilityContentSizeMultipliers requires "
            "a finite number above zero for " + std::string(category));
      }
    }
    state_->core.note_content_size_refused();
    throw jsi::JSError(runtime, std::string(accessibility::code_unsupported) + ": setAccessibilityContentSizeMultipliers needs a "
        "content size category, which Godot does not have");
  }
  void setAccessibilityFocus(jsi::Runtime &runtime, double) {
    live(runtime);
    state_->core.note_focus_refused();
    throw jsi::JSError(runtime, std::string(accessibility::code_unsupported) + ": setAccessibilityFocus is not implemented yet (GF-20 slice 2b)");
  }
  void announceForAccessibility(jsi::Runtime &runtime, jsi::String) {
    live(runtime);
    state_->core.note_announce_refused();
    throw jsi::JSError(runtime, std::string(accessibility::code_unsupported) + ": announceForAccessibility is not implemented yet (GF-20 slice 2b)");
  }
  void announceForAccessibilityWithOptions(jsi::Runtime &runtime, jsi::String, jsi::Object) {
    live(runtime);
    state_->core.note_announce_options_refused();
    throw jsi::JSError(runtime, std::string(accessibility::code_unsupported) +
        ": announceForAccessibilityWithOptions is not implemented yet (GF-20 slice 2b)");
  }

 private:
  std::shared_ptr<AccessibilityInfoState> state_;
  void live(jsi::Runtime &runtime) const {
    if (!state_->core.active()) {
      throw jsi::JSError(runtime, std::string(accessibility::code_disposed) + ": AccessibilityManager");
    }
  }
  // The error callback gets an Error, as a rejected promise would carry; it is called before the method returns.
  static void reject(jsi::Runtime &runtime, jsi::Function &error, const std::string &message) {
    error.call(runtime, jsi::Value(runtime, jsi::JSError(runtime, message).value()));
  }
  void answer(jsi::Runtime &runtime, Setting setting, rn::AsyncCallback<bool> &&success, jsi::Function &error) {
    live(runtime);
    switch (state_->core.answer(setting)) {
      case Reading::On:
        success(true);
        break;
      case Reading::Off:
        success(false);
        break;
      case Reading::Unknown:
        reject(runtime, error, std::string(accessibility::code_unknown) + ": the platform does not report " + description(setting));
        break;
    }
  }
  void unavailable(jsi::Runtime &runtime, Unbacked setting, jsi::Function &error) {
    live(runtime);
    state_->core.note_unavailable(setting);
    reject(runtime, error, std::string(accessibility::code_unavailable) + ": Godot has no way to read " + description(setting));
  }
  void emit(Setting setting, bool value) {
    // Queued through RN's emitDeviceEvent: one emit on the runtime's single RCTDeviceEventEmitter reaches every
    // listener of every root, in order, and AccessibilityInfo.js maps both "change" and "screenReaderChanged" to
    // the first event.
    emitDeviceEvent(accessibility::event_name(setting), [value](jsi::Runtime &, std::vector<jsi::Value> &args) {
      args.emplace_back(value);
    });
  }
};

// Godot's backend. The meta is read on every reading, so a validation run changes a setting by setting it again.
constexpr const char *validation_accessibility_settings = "validation_accessibility_settings";

// The key of a setting in the validation meta, and the DisplayServer method that backs it.
constexpr const char *validation_key(Setting setting) {
  switch (setting) {
    case Setting::ScreenReader: return "screen_reader";
    case Setting::ReduceMotion: return "reduce_animation";
    case Setting::ReduceTransparency: return "reduce_transparency";
    case Setting::IncreaseContrast: return "increase_contrast";
  }
  return "";
}
constexpr const char *display_method(Setting setting) {
  switch (setting) {
    case Setting::ScreenReader: return "accessibility_screen_reader_active";
    case Setting::ReduceMotion: return "accessibility_should_reduce_animation";
    case Setting::ReduceTransparency: return "accessibility_should_reduce_transparency";
    case Setting::IncreaseContrast: return "accessibility_should_increase_contrast";
  }
  return "";
}

int64_t read_setting(uint64_t id, Setting setting) {
  constexpr int64_t unknown = -1;
  auto *application = godot::Object::cast_to<FabricApplication>(godot::ObjectDB::get_instance(id));
  if (application == nullptr) {
    return unknown;
  }
  if (application->has_meta(validation_accessibility_settings)) {
    const godot::Variant meta = application->get_meta(validation_accessibility_settings);
    if (meta.get_type() == godot::Variant::DICTIONARY) {
      const godot::Dictionary replaced = meta;
      if (replaced.has(validation_key(setting))) {
        const godot::Variant value = replaced[validation_key(setting)];
        return value.get_type() == godot::Variant::INT ? static_cast<int64_t>(value) : unknown;
      }
    }
  }
  auto *display = godot::Engine::get_singleton()->get_singleton("DisplayServer");
  if (display == nullptr) {
    return unknown;
  }
  return static_cast<int64_t>(display->call(display_method(setting)));
}
}  // namespace

AccessibilityInfo::AccessibilityInfo(accessibility::Backend backend)
    : state_(std::make_shared<AccessibilityInfoState>(std::move(backend))) {}
AccessibilityInfo::~AccessibilityInfo() { state_->stop(); }

void AccessibilityInfo::install(TurboModuleRegistry &registry) {
  const auto state = state_;
  registry.add(std::string(NativeAccessibilityManager::kModuleName),
      [state](jsi::Runtime &, const std::shared_ptr<rn::CallInvoker> &invoker) {
        ++state->manager_created;
        return std::make_shared<NativeAccessibilityManager>(guarded(invoker, state), state);
      }, [state] { state->stop(); });
}

void AccessibilityInfo::poll() {
  for (const auto &change : state_->core.poll()) {
    if (state_->emit) {
      state_->emit(change.setting, change.value);
    } else {
      ++state_->events_unobserved;
    }
  }
}

bool AccessibilityInfo::ui_event(const std::string &type) {
  return state_->core.note_ui_event(type) == accessibility::UiEvent::Ignored;
}

void AccessibilityInfo::stop() { state_->stop(); }

folly::dynamic AccessibilityInfo::snapshot() const {
  const auto &s = *state_;
  const auto &c = s.core.counters();
  folly::dynamic settings = folly::dynamic::object;
  folly::dynamic events = folly::dynamic::object;
  for (const auto setting : accessibility::all_settings) {
    const auto &counters = c.settings[accessibility::index_of(setting)];
    const auto known = s.core.known(setting);
    settings[accessibility::snapshot_name(setting)] = folly::dynamic::object("last", static_cast<int>(s.core.last(setting)))
        ("known", known ? folly::dynamic(*known) : folly::dynamic(nullptr))("reads", counters.reads)
        ("resolved", counters.resolved)("rejectedUnknown", counters.rejected_unknown)("events", counters.events);
    events[accessibility::event_name(setting)] = counters.events;
  }
  // The events RN lets JS subscribe to that Godot can never send; the count is part of what the snapshot promises.
  for (const auto *name : accessibility::silent_events) {
    events[name] = 0;
  }
  folly::dynamic unbacked = folly::dynamic::object;
  for (const auto setting : accessibility::all_unbacked) {
    unbacked[accessibility::snapshot_name(setting)] = c.unbacked_rejected[accessibility::index_of(setting)];
  }
  folly::dynamic by_type = folly::dynamic::object;
  for (const auto &[type, count] : s.core.ignored_types()) {
    by_type[type] = count;
  }
  return folly::dynamic::object("stopped", !s.core.active())("started", s.core.started())
      ("modules", folly::dynamic::object("AccessibilityManager", s.manager_created))("polls", c.polls)("settings", settings)
      ("events", events)("eventsUnobserved", s.events_unobserved)("unbacked", unbacked)
      ("refused", folly::dynamic::object("contentSize", c.content_size_refused)("contentSizeInvalid", c.content_size_invalid)
          ("announce", c.announce_refused)("announceWithOptions", c.announce_options_refused)("focus", c.focus_refused))
      ("uiEvents", folly::dynamic::object("ignored", c.ui_events_ignored)("ignoredOther", c.ui_events_ignored_other)
          ("unsupported", c.ui_events_unsupported)("byType", by_type))
      ("settlementsDropped", s.settled_dropped);
}

accessibility::Backend make_godot_accessibility_backend(uint64_t application_id) {
  accessibility::Backend backend;
  backend.read = [application_id](Setting setting) { return read_setting(application_id, setting); };
  return backend;
}
}
