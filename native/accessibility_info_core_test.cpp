#include "accessibility_info_core.h"
#include <cmath>
#include <iostream>
#include <iterator>
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

// One row of the descriptor table per setting, in the order of the enum: a row out of place would name the wrong setting.
void the_table_names_each_setting_once() {
  struct Expected {
    Setting setting;
    const char *getter, *event, *snapshot, *description, *validation_key, *display_method;
  };
  const Expected expected[] = {
      {Setting::ScreenReader, "getCurrentVoiceOverState", "screenReaderChanged", "screenReader", "the screen reader", "screen_reader",
          "accessibility_screen_reader_active"},
      {Setting::ReduceMotion, "getCurrentReduceMotionState", "reduceMotionChanged", "reduceMotion", "reduce motion", "reduce_animation",
          "accessibility_should_reduce_animation"},
      {Setting::ReduceTransparency, "getCurrentReduceTransparencyState", "reduceTransparencyChanged", "reduceTransparency",
          "reduce transparency", "reduce_transparency", "accessibility_should_reduce_transparency"},
      {Setting::IncreaseContrast, "getCurrentDarkerSystemColorsState", "darkerSystemColorsChanged", "increaseContrast",
          "increase contrast", "increase_contrast", "accessibility_should_increase_contrast"},
  };
  require(setting_info.size() == setting_count && std::size(expected) == setting_count, "One row per setting");
  for (std::size_t index = 0; index < setting_count; ++index) {
    const auto &row = expected[index];
    require(all_settings[index] == row.setting && index_of(row.setting) == index, "The settings are listed in the order of the enum");
    const auto &actual = info(row.setting);
    require(&actual == &setting_info[index], "info() reads the row of the setting");
    require(std::string(actual.getter) == row.getter, row.getter);
    require(std::string(actual.event) == row.event, row.event);
    require(std::string(actual.snapshot) == row.snapshot, row.snapshot);
    require(std::string(actual.description) == row.description, row.description);
    require(std::string(actual.validation_key) == row.validation_key, row.validation_key);
    require(std::string(actual.display_method) == row.display_method, row.display_method);
    require(std::string(actual.display_method).rfind("accessibility_", 0) == 0, "Every reading is an accessibility_ method of the DisplayServer");
  }
  require(std::string(info(Setting::ScreenReader).getter) == "getCurrentVoiceOverState", "VoiceOver is the screen reader");
  require(std::string(info(Setting::IncreaseContrast).getter) == "getCurrentDarkerSystemColorsState", "darker system colors is increased contrast");
  // No two settings share a name of any kind, and none is a name of the settings with no backing or of a silent event.
  std::set<std::string> names;
  std::size_t count = 0;
  const auto add = [&](const char *name) {
    require(name != nullptr && *name != '\0', "Every field of a row is filled");
    names.insert(name);
    ++count;
  };
  for (const auto setting : all_settings) {
    const auto &row = info(setting);
    for (const auto *name : {row.getter, row.event, row.snapshot, row.description, row.validation_key, row.display_method}) {
      add(name);
    }
  }
  for (const auto setting : all_unbacked) {
    const auto &row = info(setting);
    // The description of "grayscale" is its snapshot key, so it is not part of the set.
    for (const auto *name : {row.getter, row.snapshot}) {
      add(name);
    }
  }
  for (const auto *event : silent_events) {
    add(event);
  }
  require(count == 4 * 6 + 4 * 2 + 4 && names.size() == count, "Every getter, event, snapshot key, description, meta key and method is distinct");
}

void the_unbacked_table_names_each_setting_once() {
  struct Expected {
    Unbacked setting;
    const char *getter, *snapshot, *description;
  };
  const Expected expected[] = {
      {Unbacked::BoldText, "getCurrentBoldTextState", "boldText", "bold text"},
      {Unbacked::Grayscale, "getCurrentGrayscaleState", "grayscale", "grayscale"},
      {Unbacked::InvertColors, "getCurrentInvertColorsState", "invertColors", "inverted colors"},
      {Unbacked::CrossFadeTransitions, "getCurrentPrefersCrossFadeTransitionsState", "crossFadeTransitions",
          "the preference for cross-fade transitions"},
  };
  require(unbacked_info.size() == unbacked_count && std::size(expected) == unbacked_count, "One row per setting with no backing");
  for (std::size_t index = 0; index < unbacked_count; ++index) {
    const auto &row = expected[index];
    require(all_unbacked[index] == row.setting && index_of(row.setting) == index, "They are listed in the order of the enum");
    const auto &actual = info(row.setting);
    require(&actual == &unbacked_info[index], "info() reads the row of the setting");
    require(std::string(actual.getter) == row.getter && std::string(actual.snapshot) == row.snapshot
        && std::string(actual.description) == row.description, row.getter);
  }
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
  settings.note_announce_invalid();
  settings.note_focus_refused();
  const auto &counters = settings.counters();
  require(counters.unbacked_rejected[index_of(Unbacked::BoldText)] == 2 && counters.unbacked_rejected[index_of(Unbacked::Grayscale)] == 1,
      "Each unbacked getter is counted on its own");
  require(counters.content_size_refused == 1 && counters.content_size_invalid == 1 && counters.announce_invalid == 1
      && counters.focus_refused == 1, "Each refused call is counted on its own");
}

void the_refusals_say_why() {
  require(std::string(focus_refusal) == "E_UNSUPPORTED: Godot has a single focus; moving the screen reader's focus would move the "
      "keyboard focus and blur the focused control, which iOS does not do", "The reason for the focus");
  require(std::string(queue_refusal).rfind(code_unsupported, 0) == 0
      && std::string(queue_refusal).find("the macOS accessibility API has no announcement queue") != std::string::npos, "The reason for the queue");
  require(std::string(priority_refusal).rfind(code_unsupported, 0) == 0
      && std::string(priority_refusal).find("AccessKit has only polite and assertive") != std::string::npos, "The reason for low priority");
}

// ---- announcements ----

// A platform whose calls the test sees: every call to it is in `log` in order, with the boundaries of the update the test runs
// by hand (the engine runs it when AccessKit asks), and an element freed inside an update is a violation.
struct RecordingPlatform {
  bool reader{true}, element{true}, in_update{};
  std::size_t update_requests{};
  uint64_t next{1};
  std::vector<std::string> log;
  std::set<uint64_t> alive;
  bool freed_in_update{}, text_outside_update{};

  AnnouncePort port() {
    AnnouncePort result;
    result.available = [this] { return reader; };
    result.request_update = [this] { ++update_requests; };
    result.create = [this]() -> uint64_t {
      if (!element) {
        return 0;
      }
      text_outside_update = text_outside_update || !in_update;
      const uint64_t handle = next++;
      alive.insert(handle);
      log.push_back("create " + std::to_string(handle));
      return handle;
    };
    result.set_text = [this](uint64_t handle, TextProperty property, const std::string &text) {
      text_outside_update = text_outside_update || !in_update;
      log.push_back(std::string(property == TextProperty::Value ? "value " : "name ") + std::to_string(handle) + " " + text);
    };
    result.set_live = [this](uint64_t handle, Live live) {
      text_outside_update = text_outside_update || !in_update;
      log.push_back("live " + std::to_string(handle) + " " + live_name(live));
    };
    result.release = [this](uint64_t handle) {
      freed_in_update = freed_in_update || in_update;
      alive.erase(handle);
      log.push_back("free " + std::to_string(handle));
    };
    result.recorded = [this] {
      std::vector<PortOperation> operations;
      for (const auto &entry : log) {
        operations.push_back({entry, 0, {}});
      }
      return operations;
    };
    return result;
  }
  // The update the engine would run, around the announcer's publish.
  void update(Announcer &announcer) {
    log.push_back("begin");
    in_update = true;
    announcer.publish();
    in_update = false;
    log.push_back("end");
  }
  // One frame: the pump, then the update if the pump asked for one.
  void frame(Announcer &announcer) {
    const auto before = update_requests;
    announcer.pump();
    if (update_requests > before) {
      update(announcer);
    }
  }
};

using Log = std::vector<std::string>;

// requested = published + pending + the dropped: nothing taken is lost without being counted.
void balanced(const Announcer &announcer) {
  const auto &c = announcer.counters();
  require(c.requested == c.published + announcer.pending() + c.dropped_no_screen_reader + c.dropped_empty + c.dropped_expired
      + c.dropped_stopped, "Every announcement taken is published, pending or counted as dropped");
}

void priorities_map_to_live_modes() {
  require(live_for(std::nullopt) == Live::Polite && live_for(std::string("default")) == Live::Polite, "Absent and default are polite");
  require(live_for(std::string("high")) == Live::Assertive, "High is assertive");
  require(!live_for(std::string("low")).has_value(), "Low has no live mode");
  for (const char *unknown : {"urgent", "", "HIGH", "High", "medium", " high"}) {
    require(live_for(std::string(unknown)) == Live::Polite, "A string iOS does not know is ignored, so the announcement is a default one");
  }
  require(announcement_text == TextProperty::Value, "AccessKit speaks the value of a live node, and nothing for a name alone");
  require(std::string(live_name(Live::Polite)) == "polite" && std::string(live_name(Live::Assertive)) == "assertive", "The names of the modes");
}

void an_announcement_is_a_new_element_with_a_value_and_a_live_mode() {
  RecordingPlatform platform;
  Announcer announcer(platform.port());
  require(announcer.announce("Saved") == AnnounceOutcome::Pending && announcer.pending() == 1 && platform.log.empty(),
      "An announcement waits for the update; nothing is created outside it");
  announcer.pump();
  require(platform.update_requests == 1 && platform.log.empty(), "The pump asks for the update and does not publish");
  platform.update(announcer);
  require((platform.log == Log{"begin", "create 1", "value 1 Saved", "live 1 polite", "end"}), "A new element with the text as its value, polite");
  require(announcer.pending() == 0 && announcer.held() == 1 && announcer.counters().published == 1 && announcer.counters().updates == 1,
      "It is published, held, and the update is counted");
  platform.log.clear();
  platform.frame(announcer);
  require((platform.log == Log{"free 1", "begin", "end"}) && announcer.held() == 0 && announcer.counters().released == 1,
      "The next frame frees it outside any update, and an update takes it off the tree");
  require(!platform.freed_in_update && !platform.text_outside_update && platform.alive.empty(), "No element was freed in an update or filled outside one");
  platform.log.clear();
  platform.frame(announcer);
  require(platform.log.empty() && platform.update_requests == 2, "A quiet frame asks for nothing");
  balanced(announcer);
}

void high_priority_is_assertive_and_the_rest_is_polite() {
  RecordingPlatform platform;
  Announcer announcer(platform.port());
  announcer.announce("Now", {std::nullopt, std::string("high")});
  announcer.announce("Later", {std::nullopt, std::string("default")});
  announcer.announce("Soon", {false, std::string("urgent")});
  announcer.announce("Plain");
  announcer.announce("Null options", {std::nullopt, std::nullopt});
  platform.frame(announcer);
  require((platform.log == Log{"begin", "create 1", "value 1 Now", "live 1 assertive", "create 2", "value 2 Later", "live 2 polite",
      "create 3", "value 3 Soon", "live 3 polite", "create 4", "value 4 Plain", "live 4 polite", "create 5", "value 5 Null options",
      "live 5 polite", "end"}), "Several announcements of a frame share one update, in order, each with the live mode of its priority");
  require(announcer.counters().updates == 1 && announcer.counters().published == 5 && announcer.last_text() == "Null options"
      && announcer.last_live() == Live::Polite, "One update, five elements, and the last one taken is remembered");
  balanced(announcer);
}

void the_same_text_twice_is_two_elements() {
  RecordingPlatform platform;
  Announcer announcer(platform.port());
  announcer.announce("Saved");
  platform.frame(announcer);
  platform.frame(announcer);
  announcer.announce("Saved");
  platform.frame(announcer);
  platform.frame(announcer);
  require((platform.log == Log{"begin", "create 1", "value 1 Saved", "live 1 polite", "end", "free 1", "begin", "end", "begin", "create 2",
      "value 2 Saved", "live 2 polite", "end", "free 2", "begin", "end"}), "A value equal to the one before does not speak again, so the same text is a second element");
  require(announcer.counters().published == 2 && !platform.freed_in_update, "Two announcements, two elements");
  balanced(announcer);
}

void the_same_text_twice_in_a_frame_is_two_elements() {
  // Two announcements of the same text in one frame: one update, two elements, nothing merged.
  RecordingPlatform platform;
  Announcer announcer(platform.port());
  announcer.announce("Twice");
  announcer.announce("Twice");
  platform.frame(announcer);
  require((platform.log == Log{"begin", "create 1", "value 1 Twice", "live 1 polite", "create 2", "value 2 Twice", "live 2 polite", "end"}),
      "The same text twice in one frame is two elements");
}

void the_options_that_cannot_be_honored_are_refused() {
  RecordingPlatform platform;
  Announcer announcer(platform.port());
  require(announcer.announce("Q", {true, std::nullopt}) == AnnounceOutcome::RefusedQueue, "queue: true is refused");
  require(announcer.announce("Q", {true, std::string("high")}) == AnnounceOutcome::RefusedQueue, "Whatever the priority is");
  require(announcer.announce("L", {std::nullopt, std::string("low")}) == AnnounceOutcome::RefusedPriority, "priority low is refused");
  require(announcer.announce("L", {false, std::string("low")}) == AnnounceOutcome::RefusedPriority, "queue: false does not change that");
  require(announcer.announce("both", {true, std::string("low")}) == AnnounceOutcome::RefusedQueue, "With both, the queue is what is reported");
  require(announcer.counters().refused_queue == 3 && announcer.counters().refused_priority == 2 && announcer.counters().requested == 0
      && announcer.pending() == 0 && !announcer.last_text().has_value(), "A refusal takes nothing and is counted on its own");
  require(announcer.announce("ok", {false, std::string("high")}) == AnnounceOutcome::Pending, "queue: false is no queue");
  balanced(announcer);
}

void without_a_screen_reader_the_announcement_is_dropped_and_never_kept() {
  RecordingPlatform platform;
  platform.reader = false;
  Announcer announcer(platform.port());
  require(announcer.announce("Lost") == AnnounceOutcome::DroppedNoScreenReader && announcer.pending() == 0, "No screen reader, no announcement");
  require(announcer.counters().requested == 1 && announcer.counters().dropped_no_screen_reader == 1 && announcer.last_text() == "Lost",
      "It is counted as requested and as dropped for that reason");
  platform.reader = true;
  platform.frame(announcer);
  platform.frame(announcer);
  require(platform.log.empty() && announcer.counters().published == 0 && platform.update_requests == 0,
      "A screen reader that turns on later hears nothing of it");
  balanced(announcer);
  // The screen reader that goes away while one is waiting for the update.
  announcer.announce("Waiting");
  require(announcer.pending() == 1, "With the screen reader on it waits");
  platform.reader = false;
  platform.frame(announcer);
  require(announcer.pending() == 0 && announcer.counters().dropped_no_screen_reader == 2 && platform.update_requests == 0 && platform.log.empty(),
      "A waiting announcement is dropped when the screen reader goes away, and no update is asked for");
  platform.reader = true;
  platform.frame(announcer);
  require(platform.log.empty() && announcer.counters().published == 0, "And it is not published when the screen reader comes back");
  balanced(announcer);
  // A platform with no port at all behaves as no screen reader.
  Announcer bare;
  require(bare.announce("Nobody") == AnnounceOutcome::DroppedNoScreenReader && !bare.available(), "Without a port there is no screen reader");
  bare.pump();
  bare.publish();
  bare.stop();
  balanced(bare);
}

void an_empty_text_has_nothing_to_speak() {
  RecordingPlatform platform;
  Announcer announcer(platform.port());
  require(announcer.announce("") == AnnounceOutcome::DroppedEmpty && announcer.pending() == 0, "AccessKit clears an empty value, so an empty text is dropped");
  require(announcer.counters().dropped_empty == 1 && announcer.counters().requested == 1 && announcer.last_text() == "", "It is counted on its own");
  platform.frame(announcer);
  require(platform.log.empty(), "Nothing reaches the platform");
  balanced(announcer);
}

void an_update_that_never_comes_expires_the_announcement() {
  RecordingPlatform platform;
  Announcer announcer(platform.port());
  announcer.announce("Unheard");
  // The pump asks for the update every frame; the platform never runs it.
  for (std::size_t frame = 0; frame < Announcer::max_pending_pumps; ++frame) {
    announcer.pump();
  }
  require(announcer.pending() == 1 && announcer.counters().dropped_expired == 0 && platform.update_requests == Announcer::max_pending_pumps,
      "It waits for as many pumps as the bound allows, asking for the update each time");
  announcer.pump();
  require(announcer.pending() == 0 && announcer.counters().dropped_expired == 1 && platform.update_requests == Announcer::max_pending_pumps,
      "One more and it is dropped as expired, and nothing else is asked for");
  platform.update(announcer);
  require(platform.log == Log{"begin", "end"} && announcer.counters().published == 0, "An update that comes afterwards finds nothing to publish");
  // A newer one is not expired with the older.
  announcer.announce("Old");
  for (std::size_t frame = 0; frame < 60; ++frame) {
    announcer.pump();
  }
  announcer.announce("New");
  for (std::size_t frame = 0; frame < 61; ++frame) {
    announcer.pump();
  }
  require(announcer.pending() == 1 && announcer.counters().dropped_expired == 2, "Each announcement ages from its own request");
  balanced(announcer);
}

void an_element_that_cannot_be_made_is_dropped() {
  RecordingPlatform platform;
  platform.element = false;
  Announcer announcer(platform.port());
  announcer.announce("No element");
  platform.frame(announcer);
  require(announcer.pending() == 0 && announcer.held() == 0 && announcer.counters().published == 0 && announcer.counters().dropped_no_screen_reader == 1
      && platform.log == Log{"begin", "end"}, "With no element to put it in, the announcement is dropped like one without a screen reader");
  platform.element = true;
  announcer.announce("Now there is one");
  platform.frame(announcer);
  require(announcer.counters().published == 1, "The next one is published");
  balanced(announcer);
}

void stop_ends_the_announcer_without_freeing_inside_an_update() {
  RecordingPlatform platform;
  Announcer announcer(platform.port());
  announcer.announce("Published");
  platform.frame(announcer);
  announcer.announce("Waiting 1");
  announcer.announce("Waiting 2");
  const auto held = announcer.held();
  require(held == 1 && announcer.pending() == 2, "One element is held and two announcements wait");
  platform.log.clear();
  announcer.stop();
  require(platform.log == Log{"free 1"} && !platform.freed_in_update && platform.alive.empty(), "Stop frees the held element, outside any update");
  require(announcer.counters().dropped_stopped == 2 && announcer.pending() == 0 && announcer.held() == 0 && announcer.stopped(),
      "It drops what was waiting, and counts it");
  balanced(announcer);
  const auto counters_after_stop = announcer.counters();
  const auto log_after_stop = platform.log;
  require(announcer.announce("After") == AnnounceOutcome::Stopped, "A stopped announcer takes nothing");
  announcer.pump();
  announcer.publish();
  platform.update(announcer);
  announcer.stop();
  require(platform.log.size() == log_after_stop.size() + 2 && platform.log[platform.log.size() - 2] == "begin"
      && platform.log.back() == "end", "Nothing but the update's own boundaries reaches the platform after stop");
  const auto &after = announcer.counters();
  require(after.requested == counters_after_stop.requested && after.published == counters_after_stop.published
      && after.released == counters_after_stop.released && after.dropped_stopped == counters_after_stop.dropped_stopped
      && after.updates == counters_after_stop.updates && after.updates_requested == counters_after_stop.updates_requested,
      "A second stop, and the calls after it, change no counter");
  require(announcer.recorded().size() == platform.log.size(), "What the platform recorded stays readable after stop");
  require(platform.update_requests == 1, "Stop asks for no update");
  balanced(announcer);
}

void stop_inside_an_update_frees_nothing() {
  // The platform refuses to free inside an update, and a platform call is on the stack when stop() runs there: the elements of
  // that update are left to the platform, and the rest of the batch is dropped as stopped.
  RecordingPlatform platform;
  Announcer *self = nullptr;
  AnnouncePort port = platform.port();
  const auto inner = port.set_live;
  port.set_live = [&self, inner](uint64_t handle, Live live) {
    inner(handle, live);
    self->stop();
  };
  Announcer announcer(std::move(port));
  self = &announcer;
  announcer.announce("A");
  announcer.announce("B");
  announcer.announce("C");
  announcer.pump();
  platform.update(announcer);
  require((platform.log == Log{"begin", "create 1", "value 1 A", "live 1 polite", "end"}) && announcer.stopped() && !platform.freed_in_update,
      "Stopping from inside the update frees nothing and publishes nothing more");
  require(announcer.counters().published == 1 && announcer.counters().dropped_stopped == 2 && announcer.held() == 0 && announcer.pending() == 0,
      "The element made is counted, the other two are dropped as stopped");
  balanced(announcer);
  announcer.pump();
  announcer.stop();
  require(platform.log.size() == 5 && platform.alive.size() == 1, "Nothing is freed after it either: the platform owns that element now");
}

}  // namespace

int main() {
  readings_are_three_valued();
  the_table_names_each_setting_once();
  the_unbacked_table_names_each_setting_once();
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
  the_refusals_say_why();
  priorities_map_to_live_modes();
  an_announcement_is_a_new_element_with_a_value_and_a_live_mode();
  high_priority_is_assertive_and_the_rest_is_polite();
  the_same_text_twice_is_two_elements();
  the_same_text_twice_in_a_frame_is_two_elements();
  the_options_that_cannot_be_honored_are_refused();
  without_a_screen_reader_the_announcement_is_dropped_and_never_kept();
  an_empty_text_has_nothing_to_speak();
  an_update_that_never_comes_expires_the_announcement();
  an_element_that_cannot_be_made_is_dropped();
  stop_ends_the_announcer_without_freeing_inside_an_update();
  stop_inside_an_update_frees_nothing();
  std::cout << "ACCESSIBILITY_INFO_CORE_PASSED\n";
}
