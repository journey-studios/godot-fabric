#include "accessibility_info_core.h"
#include <cmath>
#include <iostream>
#include <limits>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

using namespace fabric_godot::accessibility;

namespace {
void require(bool condition, const char *message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

// A platform whose four readings the test sets and whose reads it counts.
struct Platform {
  int64_t values[setting_count] = {-1, -1, -1, -1};
  std::size_t reads{};
  Backend backend() {
    Backend result;
    result.read = [this](Setting setting) {
      ++reads;
      return values[index_of(setting)];
    };
    return result;
  }
  void set(Setting setting, int64_t value) { values[index_of(setting)] = value; }
};

std::size_t total_events(const Settings &settings) {
  std::size_t total = 0;
  for (const auto setting : all_settings) {
    total += settings.counters().settings[index_of(setting)].events;
  }
  return total;
}

void readings_are_three_valued() {
  require(reading_from(1) == Reading::On && reading_from(0) == Reading::Off, "1 is on and 0 is off");
  require(reading_from(-1) == Reading::Unknown, "-1 is unknown, never off");
  for (const int64_t other : {int64_t{2}, int64_t{-2}, int64_t{100}, std::numeric_limits<int64_t>::min(), std::numeric_limits<int64_t>::max()}) {
    require(reading_from(other) == Reading::Unknown, "Anything but 0 and 1 is unknown");
  }
}

void names_follow_the_ios_contract() {
  require(std::string(getter_name(Setting::ScreenReader)) == "getCurrentVoiceOverState", "VoiceOver is the screen reader");
  require(std::string(getter_name(Setting::ReduceMotion)) == "getCurrentReduceMotionState", "reduce motion getter");
  require(std::string(getter_name(Setting::ReduceTransparency)) == "getCurrentReduceTransparencyState", "reduce transparency getter");
  require(std::string(getter_name(Setting::IncreaseContrast)) == "getCurrentDarkerSystemColorsState", "darker system colors is increased contrast");
  require(std::string(event_name(Setting::ScreenReader)) == "screenReaderChanged", "The screen reader event is the one 'change' aliases");
  require(std::string(event_name(Setting::IncreaseContrast)) == "darkerSystemColorsChanged", "darker system colors event");
  std::set<std::string> names;
  for (const auto setting : all_settings) {
    names.insert(getter_name(setting));
    names.insert(event_name(setting));
    names.insert(snapshot_name(setting));
  }
  for (const auto setting : all_unbacked) {
    names.insert(getter_name(setting));
    names.insert(snapshot_name(setting));
  }
  for (const auto *event : silent_events) {
    names.insert(event);
  }
  require(names.size() == 4 * 3 + 4 * 2 + 4, "Every getter, event and snapshot name is distinct, and no silent event is a backed one");
  require(std::string(getter_name(Unbacked::CrossFadeTransitions)) == "getCurrentPrefersCrossFadeTransitionsState", "cross-fade getter");
}

void start_reads_the_baseline_without_reporting() {
  Platform platform;
  platform.set(Setting::ScreenReader, 1);
  platform.set(Setting::ReduceMotion, 0);
  Settings settings(platform.backend());
  require(!settings.started() && settings.poll().empty() && platform.reads == 0 && settings.counters().polls == 0,
      "Nothing is read or reported before the module starts");
  settings.start();
  require(settings.started() && platform.reads == setting_count, "Starting reads each setting once");
  require(settings.last(Setting::ScreenReader) == Reading::On && settings.last(Setting::ReduceMotion) == Reading::Off
      && settings.last(Setting::ReduceTransparency) == Reading::Unknown, "The baseline is what was read");
  require(settings.known(Setting::ScreenReader) == std::optional<bool>(true) && !settings.known(Setting::IncreaseContrast).has_value(),
      "Only a known reading is a known value");
  require(total_events(settings) == 0, "The baseline reports nothing");
  settings.start();
  require(platform.reads == setting_count, "A second start reads nothing");
}

void a_change_is_reported_once() {
  Platform platform;
  for (const auto setting : all_settings) {
    platform.set(setting, 0);
  }
  Settings settings(platform.backend());
  settings.start();
  for (int frame = 0; frame < 5; ++frame) {
    require(settings.poll().empty(), "An unchanged platform reports nothing, frame after frame");
  }
  require(settings.counters().polls == 5 && platform.reads == setting_count * 6, "Every poll reads every setting once");
  platform.set(Setting::ReduceMotion, 1);
  auto changes = settings.poll();
  require(changes.size() == 1 && changes[0].setting == Setting::ReduceMotion && changes[0].value, "Reduce motion turned on is one change");
  for (int frame = 0; frame < 5; ++frame) {
    require(settings.poll().empty(), "The same value is not reported again");
  }
  platform.set(Setting::ReduceMotion, 0);
  changes = settings.poll();
  require(changes.size() == 1 && changes[0].setting == Setting::ReduceMotion && !changes[0].value, "Turned off is reported as false");
  require(settings.counters().settings[index_of(Setting::ReduceMotion)].events == 2 && total_events(settings) == 2,
      "Two changes, two events, and no other setting moved");
}

void each_setting_reports_itself() {
  for (const auto changed : all_settings) {
    Platform platform;
    for (const auto setting : all_settings) {
      platform.set(setting, 0);
    }
    Settings settings(platform.backend());
    settings.start();
    platform.set(changed, 1);
    const auto changes = settings.poll();
    require(changes.size() == 1 && changes[0].setting == changed && changes[0].value, "Only the setting that moved is reported");
  }
  Platform platform;
  for (const auto setting : all_settings) {
    platform.set(setting, 0);
  }
  Settings settings(platform.backend());
  settings.start();
  for (const auto setting : all_settings) {
    platform.set(setting, 1);
  }
  const auto changes = settings.poll();
  require(changes.size() == setting_count, "Four settings that move together are four changes");
  for (std::size_t index = 0; index < setting_count; ++index) {
    require(changes[index].setting == all_settings[index], "Changes come in the order of the settings");
  }
}

void unknown_is_never_reported() {
  Platform platform;
  platform.set(Setting::ScreenReader, 1);
  Settings settings(platform.backend());
  settings.start();
  platform.set(Setting::ScreenReader, -1);
  for (int frame = 0; frame < 3; ++frame) {
    require(settings.poll().empty(), "A setting that becomes unknown reports nothing, and -1 to -1 neither");
  }
  require(settings.last(Setting::ScreenReader) == Reading::Unknown && settings.answer(Setting::ScreenReader) == Reading::Unknown,
      "A getter answers the last reading, which is unknown");
  require(settings.counters().settings[index_of(Setting::ScreenReader)].rejected_unknown == 1
      && settings.counters().settings[index_of(Setting::ScreenReader)].resolved == 0, "The unknown answer is counted as rejected");
  platform.set(Setting::ScreenReader, 1);
  require(settings.poll().empty(), "Coming back to the last known value is not a change");
  require(settings.answer(Setting::ScreenReader) == Reading::On, "And the getter resolves again");
  platform.set(Setting::ScreenReader, -1);
  settings.poll();
  platform.set(Setting::ScreenReader, 0);
  const auto changes = settings.poll();
  require(changes.size() == 1 && changes[0].setting == Setting::ScreenReader && !changes[0].value,
      "A known value that differs from the last known one is a change, after an unknown reading too");
  require(total_events(settings) == 1, "One event in all");
}

void the_first_known_value_is_a_change() {
  Platform platform;
  Settings settings(platform.backend());
  settings.start();
  require(!settings.known(Setting::IncreaseContrast).has_value() && settings.poll().empty(), "Unknown at the start reports nothing");
  platform.set(Setting::IncreaseContrast, 0);
  const auto changes = settings.poll();
  require(changes.size() == 1 && changes[0].setting == Setting::IncreaseContrast && !changes[0].value,
      "The first known value has no earlier known value to equal");
  require(settings.poll().empty(), "And it is reported once");
}

void a_missing_backend_reads_unknown() {
  Settings settings(Backend{});
  settings.start();
  require(settings.poll().empty() && settings.last(Setting::ReduceMotion) == Reading::Unknown, "Without a backend every setting is unknown");
}

void a_stopped_settings_reads_nothing() {
  Platform platform;
  Settings settings(platform.backend());
  settings.start();
  const auto reads = platform.reads;
  settings.stop();
  platform.set(Setting::ReduceMotion, 1);
  require(settings.poll().empty() && platform.reads == reads && !settings.active(), "A stopped service reports nothing and reads nothing");
  Platform late;
  Settings never(late.backend());
  never.stop();
  never.start();
  require(!never.started() && late.reads == 0, "A stopped service cannot start");
}

void ui_events_are_ignored_except_focus() {
  Settings settings(Backend{});
  require(settings.note_ui_event("focus") == UiEvent::Unsupported, "Focus is refused");
  require(settings.counters().ui_events_unsupported == 1 && settings.counters().ui_events_ignored == 0, "Focus is not an ignored event");
  for (const char *type : {"click", "viewHoverEnter", "windowStateChange", "click"}) {
    require(settings.note_ui_event(type) == UiEvent::Ignored, "Every other type is ignored, as iOS does");
  }
  require(settings.counters().ui_events_ignored == 4 && settings.ignored_types().at("click") == 2
      && settings.ignored_types().at("windowStateChange") == 1, "Ignored events are counted by type");
  for (std::size_t index = 0; index < Settings::max_ignored_types + 4; ++index) {
    settings.note_ui_event("custom" + std::to_string(index));
  }
  require(settings.ignored_types().size() == Settings::max_ignored_types, "The distinct types kept are bounded");
  // Three types were kept before the loop; the other sixteen-minus-three of the twenty custom ones fit.
  require(settings.counters().ui_events_ignored_other == 7 && settings.counters().ui_events_ignored == 4 + Settings::max_ignored_types + 4,
      "The types past the bound are counted together, and every event is still counted");
}

void multipliers_are_finite_and_positive() {
  require(valid_multiplier(1) && valid_multiplier(0.5) && valid_multiplier(3.25), "Positive finite numbers scale");
  for (const double bad : {0.0, -1.0, std::nan(""), std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity()}) {
    require(!valid_multiplier(bad), "Zero, negative and non-finite numbers do not");
  }
  require(content_size_categories.size() == 12 && content_size_categories.front() == "extraSmall"
      && content_size_categories.back() == "accessibilityExtraExtraExtraLarge", "The twelve categories of the spec");
}

void refusals_are_counted() {
  Settings settings(Backend{});
  for (const auto setting : all_unbacked) {
    settings.note_unavailable(setting);
  }
  settings.note_unavailable(Unbacked::BoldText);
  settings.note_content_size_refused();
  settings.note_content_size_invalid();
  settings.note_announce_refused();
  settings.note_announce_options_refused();
  settings.note_focus_refused();
  const auto &counters = settings.counters();
  require(counters.unbacked_rejected[index_of(Unbacked::BoldText)] == 2 && counters.unbacked_rejected[index_of(Unbacked::Grayscale)] == 1,
      "Each unbacked getter is counted on its own");
  require(counters.content_size_refused == 1 && counters.content_size_invalid == 1 && counters.announce_refused == 1
      && counters.announce_options_refused == 1 && counters.focus_refused == 1, "Each refused call is counted on its own");
}
}  // namespace

int main() {
  readings_are_three_valued();
  names_follow_the_ios_contract();
  start_reads_the_baseline_without_reporting();
  a_change_is_reported_once();
  each_setting_reports_itself();
  unknown_is_never_reported();
  the_first_known_value_is_a_change();
  a_missing_backend_reads_unknown();
  a_stopped_settings_reads_nothing();
  ui_events_are_ignored_except_focus();
  multipliers_are_finite_and_positive();
  refusals_are_counted();
  std::cout << "ACCESSIBILITY_INFO_CORE_PASSED\n";
}
