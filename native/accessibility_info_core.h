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
// settings, and the end of an announcement (Godot has no announce method and no end-of-speech callback).
inline constexpr std::array<const char *, 4> silent_events{
    "boldTextChanged", "grayscaleChanged", "invertColorsChanged", "announcementFinished"};

// The error codes of the module. Each is the start of the message RN's promise or JS error carries.
inline constexpr const char *code_unknown = "E_ACCESSIBILITY_UNKNOWN";
inline constexpr const char *code_unavailable = "E_ACCESSIBILITY_UNAVAILABLE";
inline constexpr const char *code_unsupported = "E_UNSUPPORTED";
inline constexpr const char *code_argument = "E_ARGUMENT";
inline constexpr const char *code_disposed = "E_MODULE_DISPOSED";

// The content size categories setAccessibilityContentSizeMultipliers takes (NativeAccessibilityManager.js).
inline constexpr std::array<std::string_view, 12> content_size_categories{"extraSmall", "small", "medium", "large", "extraLarge",
    "extraExtraLarge", "extraExtraExtraLarge", "accessibilityMedium", "accessibilityLarge", "accessibilityExtraLarge",
    "accessibilityExtraExtraLarge", "accessibilityExtraExtraExtraLarge"};
// A multiplier scales text: it is finite and above zero.
inline bool valid_multiplier(double value) { return std::isfinite(value) && value > 0; }

// What the platform provides: the reading of one setting. The default is Godot's DisplayServer; validation
// replaces any subset (accessibility_info.h).
struct Backend {
  std::function<int64_t(Setting)> read;
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
  std::size_t content_size_refused{}, content_size_invalid{}, announce_refused{}, announce_options_refused{}, focus_refused{};
  // The accessibility events Fabric's UIManager sends (UIManager.sendAccessibilityEvent): the ones iOS ignores, and
  // the ones that need the focus the next slice implements.
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

  // The settings with no backing, and the calls whose work belongs to the next slice, are counted and refused.
  void note_unavailable(Unbacked setting) { ++counters_.unbacked_rejected[index_of(setting)]; }
  void note_content_size_refused() { ++counters_.content_size_refused; }
  void note_content_size_invalid() { ++counters_.content_size_invalid; }
  void note_announce_refused() { ++counters_.announce_refused; }
  void note_announce_options_refused() { ++counters_.announce_options_refused; }
  void note_focus_refused() { ++counters_.focus_refused; }

  // An event of Fabric's UIManager.sendAccessibilityEvent. iOS acts on "focus" alone (RCTMountingManager.mm:
  // 342-348) and ignores the other types, which are counted here by type, up to a bound; focus is the work of the
  // next slice and is refused out loud.
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

}  // namespace fabric_godot::accessibility
