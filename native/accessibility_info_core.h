#pragma once

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

// The pure core of AccessibilityInfo's settings: what a reading of the platform
// is, which readings RN is told about, the names and error codes of the iOS
// contract (RCTAccessibilityManager, which is what AccessibilityInfo.js takes
// when Platform.OS is "godot") and the counters. It needs neither Godot nor
// React Native, so accessibility_info_core_test exercises every rule without an
// engine.
namespace fabric_godot::accessibility {

// What DisplayServer reports for a setting: -1 when the platform does not know
// (the headless server, every mobile server today), 0 off or 1 on.
enum class Reading { Unknown = -1, Off = 0, On = 1 };

// Anything but 0 and 1 is unknown. An unknown setting is never reported as off.
inline Reading reading_from(int64_t raw) {
  if (raw == 1) {
    return Reading::On;
  }
  if (raw == 0) {
    return Reading::Off;
  }
  return Reading::Unknown;
}

// The four settings Godot 4.7.2 can read.
enum class Setting { ScreenReader, ReduceMotion, ReduceTransparency, IncreaseContrast };
inline constexpr std::size_t setting_count = 4;
inline constexpr std::array<Setting, setting_count> all_settings{
    Setting::ScreenReader, Setting::ReduceMotion, Setting::ReduceTransparency, Setting::IncreaseContrast};
inline constexpr std::size_t index_of(Setting setting) { return static_cast<std::size_t>(setting); }

// Everything that names a setting, in one row of one table (setting_info, indexed by Setting):
//   getter          the RCTAccessibilityManager method AccessibilityInfo.js calls for it
//   event           the device event RCTAccessibilityManager sends; AccessibilityInfo.js maps both "change" and
//                   "screenReaderChanged" to the first one
//   snapshot        the key of the host's snapshot
//   description     what the getter's error says the platform does not report
//   validation_key  the key of the validation meta (validation_accessibility_settings) that replaces the reading
//   display_method  the DisplayServer method of Godot 4.7.2 that is the reading (-1, 0 or 1)
struct SettingInfo {
  const char *getter, *event, *snapshot, *description, *validation_key, *display_method;
};
inline constexpr std::array<SettingInfo, setting_count> setting_info{{
    {"getCurrentVoiceOverState", "screenReaderChanged", "screenReader", "the screen reader",
        "screen_reader", "accessibility_screen_reader_active"},
    {"getCurrentReduceMotionState", "reduceMotionChanged", "reduceMotion", "reduce motion",
        "reduce_animation", "accessibility_should_reduce_animation"},
    {"getCurrentReduceTransparencyState", "reduceTransparencyChanged", "reduceTransparency", "reduce transparency",
        "reduce_transparency", "accessibility_should_reduce_transparency"},
    {"getCurrentDarkerSystemColorsState", "darkerSystemColorsChanged", "increaseContrast", "increase contrast",
        "increase_contrast", "accessibility_should_increase_contrast"},
}};
inline constexpr const SettingInfo &info(Setting setting) { return setting_info[index_of(setting)]; }

// The settings iOS reports and Godot has no way to read. Their getters reject; they never resolve false.
enum class Unbacked { BoldText, Grayscale, InvertColors, CrossFadeTransitions };
inline constexpr std::size_t unbacked_count = 4;
inline constexpr std::array<Unbacked, unbacked_count> all_unbacked{
    Unbacked::BoldText, Unbacked::Grayscale, Unbacked::InvertColors, Unbacked::CrossFadeTransitions};
inline constexpr std::size_t index_of(Unbacked setting) { return static_cast<std::size_t>(setting); }

// The same for the settings with no backing (unbacked_info, indexed by Unbacked): the getter, the snapshot key and what the
// getter's error says Godot has no way to read.
struct UnbackedInfo {
  const char *getter, *snapshot, *description;
};
inline constexpr std::array<UnbackedInfo, unbacked_count> unbacked_info{{
    {"getCurrentBoldTextState", "boldText", "bold text"},
    {"getCurrentGrayscaleState", "grayscale", "grayscale"},
    {"getCurrentInvertColorsState", "invertColors", "inverted colors"},
    {"getCurrentPrefersCrossFadeTransitionsState", "crossFadeTransitions", "the preference for cross-fade transitions"},
}};
inline constexpr const UnbackedInfo &info(Unbacked setting) { return unbacked_info[index_of(setting)]; }

// The device events AccessibilityInfo.js lets JS subscribe to that Godot can never send: three of the unbacked
// settings, and the end of an announcement. announcementFinished is iOS's (RCTAccessibilityManager.mm:55-56, 111-123);
// macOS, AccessKit and Godot have no signal that speech ended, and Godot's text to speech is not the screen reader (it speaks
// without one), so using it would invent the event.
inline constexpr std::array<const char *, 4> silent_events{
    "boldTextChanged", "grayscaleChanged", "invertColorsChanged", "announcementFinished"};

// The error codes of the module. Each is the start of the message RN's promise or JS error carries.
inline constexpr const char *code_unknown = "E_ACCESSIBILITY_UNKNOWN";
inline constexpr const char *code_unavailable = "E_ACCESSIBILITY_UNAVAILABLE";
inline constexpr const char *code_unsupported = "E_UNSUPPORTED";
inline constexpr const char *code_argument = "E_ARGUMENT";
inline constexpr const char *code_disposed = "E_MODULE_DISPOSED";

// Why the calls that stay refused are refused. Each is the whole message of the error, from the code on.
// Godot has one focus, the keyboard's: the AccessKit focus of a window is that focus (SceneTree::_process_accessibility_changes
// reads gui_get_focus_owner() and overwrites any other), so moving the screen reader's focus is grab_focus(), which releases the
// focus of every viewport and sends FOCUS_EXIT to a focused TextInput. iOS's UIAccessibilityLayoutChangedNotification moves
// VoiceOver's focus and nothing else (RCTMountingManager.mm:342-348).
inline constexpr const char *focus_refusal =
    "E_UNSUPPORTED: Godot has a single focus; moving the screen reader's focus would move the keyboard focus and blur the "
    "focused control, which iOS does not do";
inline constexpr const char *queue_refusal =
    "E_UNSUPPORTED: announceForAccessibilityWithOptions queue: the macOS accessibility API has no announcement queue";
inline constexpr const char *priority_refusal =
    "E_UNSUPPORTED: announceForAccessibilityWithOptions priority \"low\": AccessKit has only polite and assertive";

// The content size categories setAccessibilityContentSizeMultipliers takes (NativeAccessibilityManager.js).
inline constexpr std::array<std::string_view, 12> content_size_categories{"extraSmall", "small", "medium", "large", "extraLarge",
    "extraExtraLarge", "extraExtraExtraLarge", "accessibilityMedium", "accessibilityLarge", "accessibilityExtraLarge",
    "accessibilityExtraExtraLarge", "accessibilityExtraExtraExtraLarge"};
// A multiplier scales text: it is finite and above zero.
inline bool valid_multiplier(double value) { return std::isfinite(value) && value > 0; }

// ---- Announcements ----
//
// iOS speaks an announcement by posting UIAccessibilityAnnouncementNotification (RCTAccessibilityManager.mm:319-358). AccessKit
// has no such call: the macOS adapter posts NSAccessibilityAnnouncementRequestedNotification when a node that has a value and a
// live mode is added to the tree, or when its value or live mode changes (accesskit_macos event.rs: node_added, node_updated),
// and what it asks to speak is the node's value. So an announcement is a new element with a value and a live mode, put under
// the application's own element in an accessibility update and freed outside the next one. A value equal to the one before does
// not speak again, which is why every announcement is an element of its own (as iOS's is a notification of its own).

// How AccessKit speaks a live node. iOS's priorities map onto these two (live_for).
enum class Live { Polite, Assertive };

// The text property of an element an announcement is put in. AccessKit speaks the value of a live node and nothing for its
// name alone (measured on macOS), and Godot's own Window::accessibility_announcement puts its text in the name.
enum class TextProperty { Value, Name };
inline constexpr TextProperty announcement_text = TextProperty::Value;

// RCTAccessibilityManager's priority option (UIAccessibilityPriorityHigh, Default, Low; any other string is ignored, so the
// announcement is a default one) as the live mode that carries it: high is assertive, default, absent and unknown are polite.
// "low" has no live mode (AccessKit has only polite and assertive), so it has no value here.
inline std::optional<Live> live_for(const std::optional<std::string> &priority) {
  if (priority == "high") {
    return Live::Assertive;
  }
  if (priority == "low") {
    return std::nullopt;
  }
  return Live::Polite;
}
inline const char *live_name(Live live) { return live == Live::Assertive ? "assertive" : "polite"; }

// The options of announceForAccessibilityWithOptions after JS's values were read: absent or null is nullopt.
struct AnnounceOptions {
  std::optional<bool> queue;
  std::optional<std::string> priority;
};

// One call of the announcer to a platform that records them: update.begin and update.end around the update, create,
// value or name (text), live (the live mode's name), and free.
struct PortOperation {
  std::string op;
  uint64_t handle{};
  std::string text;
};

// What the announcer asks of the platform. Handles are the announcer's own opaque numbers for the elements it creates: 0 is
// no element. Every function may be left empty (a platform with no accessibility): the announcement is then dropped.
struct AnnouncePort {
  // An OS accessibility tree stands behind the application, so an announcement has somewhere to be put: a screen reader is
  // on, the accessibility server supports it and the application has an element. An announcement is never kept for a screen
  // reader that is not there.
  std::function<bool()> available;
  // Asks for the accessibility update in which publish() runs. The platform calls publish() from inside the update, and
  // the update may come a frame or more later, or never if no screen reader is attached to the window.
  std::function<void()> request_update;
  // A new static text element under the application's element. 0 if there is none.
  std::function<uint64_t()> create;
  std::function<void(uint64_t, TextProperty, const std::string &)> set_text;
  std::function<void(uint64_t, Live)> set_live;
  // Frees an element. The platform refuses it inside an update, so it is only called outside one.
  std::function<void(uint64_t)> release;
  // What a platform that records its calls recorded, in order; empty for the others. It outlives the announcer's stop.
  std::function<std::vector<PortOperation>()> recorded;
};

// What the platform provides: the reading of one setting, and the way announcements reach the screen reader. The default is
// Godot's; validation replaces any subset (accessibility_info.h). announce is given what runs the update in which
// announcements are published, for a platform whose update the host drives itself (the validation recorder does).
struct Backend {
  std::function<int64_t(Setting)> read;
  std::function<AnnouncePort(std::function<void()>)> announce;
};

// A change to deliver: a setting whose known value differs from the last known one.
struct Change {
  Setting setting;
  bool value;
};

struct SettingCounters {
  std::size_t reads{}, resolved{}, rejected_unknown{}, events{};
};

struct Counters {
  std::size_t polls{};
  std::array<SettingCounters, setting_count> settings{};
  std::array<std::size_t, unbacked_count> unbacked_rejected{};
  std::size_t content_size_refused{}, content_size_invalid{}, announce_invalid{}, focus_refused{};
  // The accessibility events Fabric's UIManager sends (UIManager.sendAccessibilityEvent): the ones iOS ignores, and
  // focus, which is refused (focus_refusal).
  std::size_t ui_events_ignored{}, ui_events_ignored_other{}, ui_events_unsupported{};
};

enum class UiEvent { Ignored, Unsupported };

// One application's view of the platform's accessibility settings. Every method runs on the application's main
// thread. After stop() the backend is never read again and nothing is reported.
class Settings {
 public:
  explicit Settings(Backend backend) : backend_(std::move(backend)) {}

  bool active() const { return active_; }
  bool started() const { return started_; }
  void stop() { active_ = false; }
  const Counters &counters() const { return counters_; }

  // Called when the module is created, as RCTAccessibilityManager reads the settings in its init: these
  // readings are the baseline later changes are told against and the answers the getters give until the next
  // poll. Nothing is reported for them, and a second call does nothing.
  void start() {
    if (!active_ || started_) {
      return;
    }
    started_ = true;
    for (const auto setting : all_settings) {
      auto &state = states_[index_of(setting)];
      state.last = read(setting);
      state.known = known_value(state.last);
    }
  }

  // The poll of one frame: it reads every setting once and returns the changes to deliver, in the order of
  // all_settings. A change is a known value that differs from the last known one. A reading that is unknown
  // changes nothing and reports nothing, whatever came before it, and the known value is kept for comparing with
  // the next known reading. The first known reading after only unknown ones has no value to differ from, so it is
  // a change.
  std::vector<Change> poll() {
    std::vector<Change> changes;
    if (!active_ || !started_) {
      return changes;
    }
    ++counters_.polls;
    for (const auto setting : all_settings) {
      auto &state = states_[index_of(setting)];
      state.last = read(setting);
      const auto value = known_value(state.last);
      if (!value) {
        continue;
      }
      if (state.known && *state.known == *value) {
        continue;
      }
      state.known = value;
      ++counters_.settings[index_of(setting)].events;
      changes.push_back({setting, *value});
    }
    return changes;
  }

  // What a getter answers: the last reading, which is not read again. Unknown is for the module to reject.
  Reading answer(Setting setting) {
    const auto reading = states_[index_of(setting)].last;
    auto &counters = counters_.settings[index_of(setting)];
    ++(reading == Reading::Unknown ? counters.rejected_unknown : counters.resolved);
    return reading;
  }
  Reading last(Setting setting) const { return states_[index_of(setting)].last; }
  std::optional<bool> known(Setting setting) const { return states_[index_of(setting)].known; }

  // The settings with no backing, and the calls Godot cannot honor (content size, the screen reader's focus, options of an
  // announcement that are not the right type), are counted and refused.
  void note_unavailable(Unbacked setting) { ++counters_.unbacked_rejected[index_of(setting)]; }
  void note_content_size_refused() { ++counters_.content_size_refused; }
  void note_content_size_invalid() { ++counters_.content_size_invalid; }
  void note_announce_invalid() { ++counters_.announce_invalid; }
  void note_focus_refused() { ++counters_.focus_refused; }

  // An event of Fabric's UIManager.sendAccessibilityEvent. iOS acts on "focus" alone (RCTMountingManager.mm:
  // 342-348) and ignores the other types, which are counted here by type, up to a bound; focus is refused out loud
  // (focus_refusal).
  UiEvent note_ui_event(const std::string &type) {
    if (type == "focus") {
      ++counters_.ui_events_unsupported;
      return UiEvent::Unsupported;
    }
    ++counters_.ui_events_ignored;
    const auto found = ignored_types_.find(type);
    if (found != ignored_types_.end()) {
      ++found->second;
    } else if (ignored_types_.size() < max_ignored_types) {
      ignored_types_.emplace(type, 1);
    } else {
      ++counters_.ui_events_ignored_other;
    }
    return UiEvent::Ignored;
  }
  const std::map<std::string, std::size_t> &ignored_types() const { return ignored_types_; }

  static constexpr std::size_t max_ignored_types = 16;

 private:
  struct State {
    Reading last{Reading::Unknown};
    std::optional<bool> known;
  };
  Backend backend_;
  bool active_{true};
  bool started_{};
  std::array<State, setting_count> states_{};
  Counters counters_;
  std::map<std::string, std::size_t> ignored_types_;

  static std::optional<bool> known_value(Reading reading) {
    if (reading == Reading::Unknown) {
      return std::nullopt;
    }
    return reading == Reading::On;
  }
  Reading read(Setting setting) {
    ++counters_.settings[index_of(setting)].reads;
    if (!backend_.read) {
      return Reading::Unknown;
    }
    return reading_from(backend_.read(setting));
  }
};

enum class AnnounceOutcome {
  // Taken: it will be published in the next accessibility update.
  Pending,
  // Taken and let go: no screen reader stands behind the application, or the text is empty and AccessKit has nothing to speak.
  DroppedNoScreenReader,
  DroppedEmpty,
  // Refused out loud (queue_refusal, priority_refusal).
  RefusedQueue,
  RefusedPriority,
  // The announcer has stopped; nothing was kept.
  Stopped
};

struct AnnouncementCounters {
  // Announcements taken (valid options), whatever became of them: requested = published + pending + every dropped.
  std::size_t requested{}, published{}, released{}, updates_requested{}, updates{};
  std::size_t dropped_no_screen_reader{}, dropped_empty{}, dropped_expired{}, dropped_stopped{};
  std::size_t refused_queue{}, refused_priority{};
};

// One application's announcements. Every method runs on the application's main thread.
//
//   announce()  JS asked for one. It is kept only if a screen reader can speak it: with none it is dropped at once and counted,
//               and one that was kept is dropped if the screen reader goes away before it is published. It is never kept to
//               speak when a screen reader turns on.
//   pump()      once per frame, outside any accessibility update: frees the elements the last update published (the platform
//               refuses to free inside an update), drops what waited too long, and asks for an update when there is something
//               to publish or to remove from the tree.
//   publish()   called by the platform inside the update: a new element for each announcement kept, in order, with its text and
//               live mode. Several announcements of one frame share the update.
//   stop()      drops what is kept, frees what was published (outside an update) and ends the announcer. Idempotent.
class Announcer {
 public:
  // Pumps an announcement may wait for an update. The update comes in the same frame once a screen reader is attached to the
  // window; one that does not come (a screen reader that is not looking at this window) is a screen reader that did not hear
  // the announcement, which must not be spoken long after.
  static constexpr std::size_t max_pending_pumps = 120;

  explicit Announcer(AnnouncePort port = {}) : port_(std::move(port)) {}

  AnnounceOutcome announce(const std::string &text, const AnnounceOptions &options = {}) {
    if (stopped_) {
      return AnnounceOutcome::Stopped;
    }
    if (options.queue.value_or(false)) {
      ++counters_.refused_queue;
      return AnnounceOutcome::RefusedQueue;
    }
    const auto live = live_for(options.priority);
    if (!live) {
      ++counters_.refused_priority;
      return AnnounceOutcome::RefusedPriority;
    }
    ++counters_.requested;
    last_text_ = text;
    last_live_ = *live;
    if (text.empty()) {
      ++counters_.dropped_empty;
      return AnnounceOutcome::DroppedEmpty;
    }
    if (!available()) {
      ++counters_.dropped_no_screen_reader;
      return AnnounceOutcome::DroppedNoScreenReader;
    }
    pending_.push_back({text, *live, 0});
    return AnnounceOutcome::Pending;
  }

  void pump() {
    if (stopped_) {
      return;
    }
    const bool released = release_held();
    if (!pending_.empty()) {
      if (!available()) {
        counters_.dropped_no_screen_reader += pending_.size();
        pending_.clear();
      } else {
        age_pending();
      }
    }
    if (released || !pending_.empty()) {
      ++counters_.updates_requested;
      if (port_.request_update) {
        port_.request_update();
      }
    }
  }

  void publish() {
    if (stopped_ || publishing_) {
      return;
    }
    publishing_ = true;
    ++counters_.updates;
    // The platform's calls below may reach stop(), so the batch is taken out first: nothing here iterates what stop() clears.
    const auto batch = std::move(pending_);
    pending_.clear();
    for (std::size_t index = 0; index < batch.size(); ++index) {
      if (stopped_) {
        counters_.dropped_stopped += batch.size() - index;
        break;
      }
      const uint64_t handle = port_.create ? port_.create() : 0;
      if (handle == 0) {
        ++counters_.dropped_no_screen_reader;
        continue;
      }
      if (port_.set_text) {
        port_.set_text(handle, announcement_text, batch[index].text);
      }
      if (port_.set_live) {
        port_.set_live(handle, batch[index].live);
      }
      ++counters_.published;
      if (!stopped_) {
        held_.push_back(handle);
      }
    }
    publishing_ = false;
  }

  void stop() {
    if (stopped_) {
      return;
    }
    stopped_ = true;
    counters_.dropped_stopped += pending_.size();
    pending_.clear();
    // Inside the update this announcer runs an element cannot be freed, and a platform call is on the stack: the elements of
    // that update are left to the platform, which frees them with the application's own element, and the port stays where it
    // is (every method returns at once once stopped).
    if (publishing_) {
      held_.clear();
      return;
    }
    release_held();
    // The platform is let go; what it recorded stays readable.
    auto recorded = std::move(port_.recorded);
    port_ = {};
    port_.recorded = std::move(recorded);
  }

  bool stopped() const { return stopped_; }
  std::vector<PortOperation> recorded() const { return port_.recorded ? port_.recorded() : std::vector<PortOperation>{}; }
  // True when an OS accessibility tree can carry an announcement now.
  bool available() const { return port_.available && port_.available(); }
  const AnnouncementCounters &counters() const { return counters_; }
  std::size_t pending() const { return pending_.size(); }
  std::size_t held() const { return held_.size(); }
  const std::optional<std::string> &last_text() const { return last_text_; }
  const std::optional<Live> &last_live() const { return last_live_; }

 private:
  struct Pending {
    std::string text;
    Live live;
    std::size_t age;
  };
  AnnouncePort port_;
  std::vector<Pending> pending_;
  std::vector<uint64_t> held_;
  std::optional<std::string> last_text_;
  std::optional<Live> last_live_;
  AnnouncementCounters counters_;
  bool stopped_{};
  bool publishing_{};

  bool release_held() {
    const bool any = !held_.empty();
    for (const auto handle : held_) {
      if (port_.release) {
        port_.release(handle);
      }
      ++counters_.released;
    }
    held_.clear();
    return any;
  }
  void age_pending() {
    std::vector<Pending> kept;
    for (auto &item : pending_) {
      ++item.age;
      if (item.age > max_pending_pumps) {
        ++counters_.dropped_expired;
      } else {
        kept.push_back(std::move(item));
      }
    }
    pending_ = std::move(kept);
  }
};

}  // namespace fabric_godot::accessibility
