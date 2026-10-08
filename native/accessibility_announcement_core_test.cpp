#include "accessibility_announcement_core.h"
#include <iostream>
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

// A platform whose calls the test sees: every call to it is in `log` in order, with the boundaries of the update the test runs
// by hand (the engine runs it when AccessKit asks), and an element freed inside an update is a violation.
struct RecordingPlatform {
  bool reader{true}, element{true}, in_update{};
  // The next creations that fail, as a platform with no element for the application does.
  std::size_t creations_to_fail{};
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
      if (!element || creations_to_fail > 0) {
        creations_to_fail -= creations_to_fail > 0 ? 1 : 0;
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
  // Frames until nothing waits and nothing is left to free.
  void settle(Announcer &announcer) {
    for (std::size_t frames = 0; frames < 1000 && (announcer.pending() > 0 || announcer.held() > 0); ++frames) {
      frame(announcer);
    }
    require(announcer.pending() == 0 && announcer.held() == 0, "The announcer settles");
  }
};

using Log = std::vector<std::string>;

// requested = published + pending + the dropped: nothing taken is lost without being counted.
void balanced(const Announcer &announcer) {
  const auto &c = announcer.counters();
  require(c.requested == c.published + announcer.pending() + c.dropped_no_screen_reader + c.dropped_empty + c.dropped_expired
      + c.dropped_stopped, "Every announcement taken is published, pending or counted as dropped");
}

// No update of a log made more than one element: the order of the elements of one update is AccessKit's, so each update holds one.
bool one_element_per_update(const Log &log) {
  std::size_t created = 0;
  for (const auto &entry : log) {
    if (entry == "begin") {
      created = 0;
    } else if (entry.rfind("create ", 0) == 0 && ++created > 1) {
      return false;
    }
  }
  return true;
}

void the_refusals_say_why() {
  require(std::string(queue_refusal).rfind("E_UNSUPPORTED", 0) == 0
      && std::string(queue_refusal).find("the macOS accessibility API has no announcement queue") != std::string::npos, "The reason for the queue");
  require(std::string(priority_refusal).rfind("E_UNSUPPORTED", 0) == 0
      && std::string(priority_refusal).find("AccessKit has only polite and assertive") != std::string::npos, "The reason for low priority");
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

void announcements_of_a_frame_are_published_one_per_update_in_order() {
  RecordingPlatform platform;
  Announcer announcer(platform.port());
  announcer.announce("Now", {std::nullopt, std::string("high")});
  announcer.announce("Later", {std::nullopt, std::string("default")});
  announcer.announce("Soon", {false, std::string("urgent")});
  announcer.announce("Plain");
  announcer.announce("Null options", {std::nullopt, std::nullopt});
  platform.frame(announcer);
  require((platform.log == Log{"begin", "create 1", "value 1 Now", "live 1 assertive", "end"}) && announcer.pending() == 4,
      "The first update publishes the first announcement only, with the live mode of its priority; the others wait");
  platform.settle(announcer);
  require((platform.log == Log{"begin", "create 1", "value 1 Now", "live 1 assertive", "end",
      "free 1", "begin", "create 2", "value 2 Later", "live 2 polite", "end",
      "free 2", "begin", "create 3", "value 3 Soon", "live 3 polite", "end",
      "free 3", "begin", "create 4", "value 4 Plain", "live 4 polite", "end",
      "free 4", "begin", "create 5", "value 5 Null options", "live 5 polite", "end",
      "free 5", "begin", "end"}),
      "One announcement per update in the order they were asked for, each freed outside the update after it, which also takes it off the tree");
  require(announcer.counters().updates == 6 && announcer.counters().updates_requested == 6 && announcer.counters().published == 5
      && announcer.counters().released == 5 && announcer.last_text() == "Null options" && announcer.last_live() == Live::Polite,
      "Six updates for five elements, and the last one asked for is remembered");
  require(one_element_per_update(platform.log) && !platform.freed_in_update && !platform.text_outside_update && platform.alive.empty(),
      "No update holds two elements, none was freed in an update or filled outside one");
  balanced(announcer);
}

void a_long_batch_keeps_its_order_and_each_announcement_expires_on_its_own() {
  RecordingPlatform platform;
  Announcer announcer(platform.port());
  for (std::size_t index = 0; index < 10; ++index) {
    announcer.announce("n" + std::to_string(index));
  }
  platform.settle(announcer);
  std::vector<std::string> values;
  for (const auto &entry : platform.log) {
    if (entry.rfind("value ", 0) == 0) {
      values.push_back(entry.substr(entry.find(' ', 6) + 1));
    }
  }
  require((values == std::vector<std::string>{"n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9"}) && one_element_per_update(platform.log),
      "Ten announcements of one frame are ten elements, in order, one per update");
  // One per update takes a frame each: an announcement that waits for more pumps than the bound allows is dropped, and the ones
  // before it were published.
  RecordingPlatform crowded;
  Announcer many(crowded.port());
  const std::size_t asked = Announcer::max_pending_pumps + 10;
  for (std::size_t index = 0; index < asked; ++index) {
    many.announce("m" + std::to_string(index));
  }
  crowded.settle(many);
  require(many.counters().published == Announcer::max_pending_pumps && many.counters().dropped_expired == 10 && one_element_per_update(crowded.log),
      "The first 120 are published, one per frame; the other ten waited longer than the bound and are dropped as expired");
  balanced(many);
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
  // Two announcements of the same text in one frame: two updates, two elements, nothing merged.
  RecordingPlatform platform;
  Announcer announcer(platform.port());
  announcer.announce("Twice");
  announcer.announce("Twice");
  platform.settle(announcer);
  require((platform.log == Log{"begin", "create 1", "value 1 Twice", "live 1 polite", "end", "free 1", "begin", "create 2", "value 2 Twice",
      "live 2 polite", "end", "free 2", "begin", "end"}), "The same text twice in one frame is two elements, in two updates");
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

void the_screen_reader_is_asked_for_each_announcement_of_a_batch() {
  RecordingPlatform platform;
  Announcer announcer(platform.port());
  announcer.announce("First");
  announcer.announce("Second");
  announcer.announce("Third");
  platform.frame(announcer);
  require(announcer.held() == 1 && announcer.pending() == 2, "The first is published and two wait");
  platform.reader = false;
  platform.frame(announcer);
  require(announcer.pending() == 0 && announcer.counters().dropped_no_screen_reader == 2 && announcer.counters().published == 1
      && (platform.log == Log{"begin", "create 1", "value 1 First", "live 1 polite", "end", "free 1", "begin", "end"}),
      "The screen reader goes away: the two that waited are dropped, and the one published stays published");
  balanced(announcer);
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

void an_element_that_cannot_be_made_is_dropped_without_taking_the_update() {
  RecordingPlatform platform;
  platform.element = false;
  Announcer announcer(platform.port());
  announcer.announce("No element");
  announcer.announce("Still none");
  platform.frame(announcer);
  require(announcer.pending() == 0 && announcer.held() == 0 && announcer.counters().published == 0 && announcer.counters().dropped_no_screen_reader == 2
      && platform.log == Log{"begin", "end"}, "With no element to put them in, both are dropped in one update, like announcements without a screen reader");
  platform.element = true;
  announcer.announce("Now there is one");
  platform.frame(announcer);
  require(announcer.counters().published == 1, "The next one is published");
  // An announcement that has no element does not take the update from the next one.
  RecordingPlatform flaky;
  flaky.creations_to_fail = 1;
  Announcer retry(flaky.port());
  retry.announce("Lost");
  retry.announce("Heard");
  retry.announce("Waiting");
  flaky.frame(retry);
  require((flaky.log == Log{"begin", "create 1", "value 1 Heard", "live 1 polite", "end"}) && retry.counters().dropped_no_screen_reader == 1
      && retry.counters().published == 1 && retry.pending() == 1, "The one with no element is dropped and the next takes the update; the third waits");
  balanced(announcer);
  balanced(retry);
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
  // The platform refuses to free inside an update, and a platform call is on the stack when stop() runs there: the element of
  // that update is left to the platform, and the announcements that waited are dropped as stopped.
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
  the_refusals_say_why();
  priorities_map_to_live_modes();
  an_announcement_is_a_new_element_with_a_value_and_a_live_mode();
  announcements_of_a_frame_are_published_one_per_update_in_order();
  a_long_batch_keeps_its_order_and_each_announcement_expires_on_its_own();
  the_same_text_twice_is_two_elements();
  the_same_text_twice_in_a_frame_is_two_elements();
  the_options_that_cannot_be_honored_are_refused();
  without_a_screen_reader_the_announcement_is_dropped_and_never_kept();
  the_screen_reader_is_asked_for_each_announcement_of_a_batch();
  an_empty_text_has_nothing_to_speak();
  an_update_that_never_comes_expires_the_announcement();
  an_element_that_cannot_be_made_is_dropped_without_taking_the_update();
  stop_ends_the_announcer_without_freeing_inside_an_update();
  stop_inside_an_update_frees_nothing();
  std::cout << "ACCESSIBILITY_ANNOUNCEMENT_CORE_PASSED\n";
}
