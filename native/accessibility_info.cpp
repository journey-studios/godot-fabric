#include "accessibility_info.h"
#include "accessibility_announcer.h"
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
  // The announcer comes first: it takes its port from the backend, which the settings then take whole. The port's update runs
  // the announcer's publish, so the announcer is what the port is given.
  accessibility::Announcer announcer;
  accessibility::Settings core;
  // Set by the AccessibilityManager module while it exists: the settings' device events are emitted through that
  // module's own emitDeviceEvent.
  std::function<void(accessibility::Setting, bool)> emit;
  std::size_t manager_created{}, events_unobserved{}, settled_dropped{};

  explicit AccessibilityInfoState(accessibility::Backend backend)
      : announcer(backend.announce ? backend.announce([this] { announcer.publish(); }) : accessibility::AnnouncePort{}),
        core(std::move(backend)) {}
  void stop() {
    core.stop();
    announcer.stop();
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

// AccessibilityManager is the module AccessibilityInfo.js uses when Platform.OS is not "android" (Godot's is
// "godot"), with the contract of iOS's RCTAccessibilityManager: the getters hand the setting to a success callback
// and an error to the other, and the changes are device events whose body is the new boolean. The settings come from
// the application's Godot backend; the ones Godot cannot read reject. The announcements are spoken through AccessKit
// (queue and low priority, which it cannot honor, throw) and the screen reader's focus throws.
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
  // The screen reader's focus is Godot's keyboard focus (see accessibility::focus_refusal): moving one moves the other, which
  // iOS does not do, so the call is refused with that reason.
  void setAccessibilityFocus(jsi::Runtime &runtime, double) {
    live(runtime);
    state_->core.note_focus_refused();
    throw jsi::JSError(runtime, accessibility::focus_refusal);
  }
  // RCTAccessibilityManager posts UIAccessibilityAnnouncementNotification. Here the announcer puts the text in a live element for
  // AccessKit to speak; with no screen reader the call returns, counted, as it does on iOS and Android.
  void announceForAccessibility(jsi::Runtime &runtime, jsi::String announcement) {
    live(runtime);
    announce(runtime, announcement.utf8(runtime), {});
  }
  void announceForAccessibilityWithOptions(jsi::Runtime &runtime, jsi::String announcement, jsi::Object options) {
    live(runtime);
    announce(runtime, announcement.utf8(runtime), announce_options(runtime, options));
  }

 private:
  std::shared_ptr<AccessibilityInfoState> state_;
  // {queue?: boolean, priority?: string} (NativeAccessibilityManager.js): an option that is undefined or null is left out, and
  // one of another type is an argument error, as the typed bridge of iOS would not take it.
  accessibility::AnnounceOptions announce_options(jsi::Runtime &runtime, const jsi::Object &options) {
    accessibility::AnnounceOptions result;
    const auto queue = options.getProperty(runtime, "queue");
    if (queue.isBool()) {
      result.queue = queue.getBool();
    } else if (!queue.isUndefined() && !queue.isNull()) {
      invalid_announcement(runtime, "queue to be a boolean");
    }
    const auto priority = options.getProperty(runtime, "priority");
    if (priority.isString()) {
      result.priority = priority.getString(runtime).utf8(runtime);
    } else if (!priority.isUndefined() && !priority.isNull()) {
      invalid_announcement(runtime, "priority to be a string");
    }
    return result;
  }
  [[noreturn]] void invalid_announcement(jsi::Runtime &runtime, const char *requirement) {
    state_->core.note_announce_invalid();
    throw jsi::JSError(runtime, std::string(accessibility::code_argument) + ": announceForAccessibilityWithOptions requires " + requirement);
  }
  void announce(jsi::Runtime &runtime, const std::string &text, const accessibility::AnnounceOptions &options) {
    switch (state_->announcer.announce(text, options)) {
      case accessibility::AnnounceOutcome::RefusedQueue:
        throw jsi::JSError(runtime, accessibility::queue_refusal);
      case accessibility::AnnounceOutcome::RefusedPriority:
        throw jsi::JSError(runtime, accessibility::priority_refusal);
      case accessibility::AnnounceOutcome::Pending:
      case accessibility::AnnounceOutcome::DroppedNoScreenReader:
      case accessibility::AnnounceOutcome::DroppedEmpty:
      case accessibility::AnnounceOutcome::Stopped:
        break;
    }
  }
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
        reject(runtime, error, std::string(accessibility::code_unknown) + ": the platform does not report " + accessibility::info(setting).description);
        break;
    }
  }
  void unavailable(jsi::Runtime &runtime, Unbacked setting, jsi::Function &error) {
    live(runtime);
    state_->core.note_unavailable(setting);
    reject(runtime, error, std::string(accessibility::code_unavailable) + ": Godot has no way to read " + accessibility::info(setting).description);
  }
  void emit(Setting setting, bool value) {
    // Queued through RN's emitDeviceEvent: one emit on the runtime's single RCTDeviceEventEmitter reaches every
    // listener of every root, in order, and AccessibilityInfo.js maps both "change" and "screenReaderChanged" to
    // the first event.
    emitDeviceEvent(accessibility::info(setting).event, [value](jsi::Runtime &, std::vector<jsi::Value> &args) {
      args.emplace_back(value);
    });
  }
};

// What the host says of the announcements, for the snapshot: the counters (requested = published + pending + the dropped), the last
// one taken, whether an OS accessibility tree stands behind the application, the engine API they use and, for a validation run,
// the calls the announcer made to the platform.
folly::dynamic announcements_snapshot(const accessibility::Announcer &announcer) {
  const auto &c = announcer.counters();
  folly::dynamic recorded = folly::dynamic::array();
  for (const auto &operation : announcer.recorded()) {
    recorded.push_back(folly::dynamic::object("op", operation.op)("handle", operation.handle)("text", operation.text));
  }
  const auto &last_text = announcer.last_text();
  const auto &last_live = announcer.last_live();
  return folly::dynamic::object("stopped", announcer.stopped())("osTree", announcer.available())
      ("requested", c.requested)("published", c.published)("released", c.released)
      ("updatesRequested", c.updates_requested)("updates", c.updates)("pending", announcer.pending())("held", announcer.held())
      ("dropped", folly::dynamic::object("noScreenReader", c.dropped_no_screen_reader)("empty", c.dropped_empty)
          ("expired", c.dropped_expired)("stopped", c.dropped_stopped))
      ("refused", folly::dynamic::object("queue", c.refused_queue)("priority", c.refused_priority))
      ("lastText", last_text ? folly::dynamic(*last_text) : folly::dynamic(nullptr))
      ("lastPriority", last_live ? folly::dynamic(accessibility::live_name(*last_live)) : folly::dynamic(nullptr))
      ("maxPendingPumps", accessibility::Announcer::max_pending_pumps)("api", announce_api_report())("recorded", recorded);
}

// Godot's backend. The meta is read on every reading, so a validation run changes a setting by setting it again. The key
// of each setting in the meta and the DisplayServer method that is its reading are in the core's table.
constexpr const char *validation_accessibility_settings = "validation_accessibility_settings";

int64_t read_setting(uint64_t id, Setting setting) {
  constexpr int64_t unknown = -1;
  auto *application = godot::Object::cast_to<FabricApplication>(godot::ObjectDB::get_instance(id));
  if (application == nullptr) {
    return unknown;
  }
  const auto &names = accessibility::info(setting);
  if (application->has_meta(validation_accessibility_settings)) {
    const godot::Variant meta = application->get_meta(validation_accessibility_settings);
    if (meta.get_type() == godot::Variant::DICTIONARY) {
      const godot::Dictionary replaced = meta;
      if (replaced.has(names.validation_key)) {
        const godot::Variant value = replaced[names.validation_key];
        return value.get_type() == godot::Variant::INT ? static_cast<int64_t>(value) : unknown;
      }
    }
  }
  auto *display = godot::Engine::get_singleton()->get_singleton("DisplayServer");
  if (display == nullptr || !display->has_method(names.display_method)) {
    return unknown;
  }
  // Only an integer is a reading. Anything else (a call that returns nil is what a method that does not do its job looks
  // like) is unknown, and an unknown setting is never off.
  const godot::Variant reading = display->call(names.display_method);
  return reading.get_type() == godot::Variant::INT ? static_cast<int64_t>(reading) : unknown;
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
  state_->announcer.pump();
  for (const auto &change : state_->core.poll()) {
    if (state_->emit) {
      state_->emit(change.setting, change.value);
    } else {
      ++state_->events_unobserved;
    }
  }
}

void AccessibilityInfo::publish_announcements() { state_->announcer.publish(); }

accessibility::UiEvent AccessibilityInfo::ui_event(const std::string &type) { return state_->core.note_ui_event(type); }

void AccessibilityInfo::stop() { state_->stop(); }

folly::dynamic AccessibilityInfo::snapshot() const {
  const auto &s = *state_;
  const auto &c = s.core.counters();
  folly::dynamic settings = folly::dynamic::object;
  folly::dynamic events = folly::dynamic::object;
  for (const auto setting : accessibility::all_settings) {
    const auto &counters = c.settings[accessibility::index_of(setting)];
    const auto known = s.core.known(setting);
    const auto &names = accessibility::info(setting);
    settings[names.snapshot] = folly::dynamic::object("displayMethod", names.display_method)
        ("last", static_cast<int>(s.core.last(setting)))("known", known ? folly::dynamic(*known) : folly::dynamic(nullptr))
        ("reads", counters.reads)("resolved", counters.resolved)("rejectedUnknown", counters.rejected_unknown)
        ("events", counters.events);
    events[names.event] = counters.events;
  }
  // The events RN lets JS subscribe to that Godot can never send; the count is part of what the snapshot promises.
  for (const auto *name : accessibility::silent_events) {
    events[name] = 0;
  }
  folly::dynamic unbacked = folly::dynamic::object;
  for (const auto setting : accessibility::all_unbacked) {
    unbacked[accessibility::info(setting).snapshot] = c.unbacked_rejected[accessibility::index_of(setting)];
  }
  folly::dynamic by_type = folly::dynamic::object;
  for (const auto &[type, count] : s.core.ignored_types()) {
    by_type[type] = count;
  }
  return folly::dynamic::object("stopped", !s.core.active())("started", s.core.started())
      ("modules", folly::dynamic::object("AccessibilityManager", s.manager_created))("polls", c.polls)("settings", settings)
      ("events", events)("eventsUnobserved", s.events_unobserved)("unbacked", unbacked)
      ("refused", folly::dynamic::object("contentSize", c.content_size_refused)("contentSizeInvalid", c.content_size_invalid)
          ("announceInvalid", c.announce_invalid)("focus", c.focus_refused))
      ("announcements", announcements_snapshot(s.announcer))
      ("uiEvents", folly::dynamic::object("ignored", c.ui_events_ignored)("ignoredOther", c.ui_events_ignored_other)
          ("unsupported", c.ui_events_unsupported)("byType", by_type))
      ("settlementsDropped", s.settled_dropped);
}

accessibility::Backend make_godot_accessibility_backend(uint64_t application_id) {
  accessibility::Backend backend;
  backend.read = [application_id](Setting setting) { return read_setting(application_id, setting); };
  backend.announce = [application_id](std::function<void()> publish) {
    return make_godot_announce_port(application_id, std::move(publish));
  };
  return backend;
}
}
