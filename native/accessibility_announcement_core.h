#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

// The pure core of AccessibilityInfo's announcements: when an announcement is kept, published, dropped or refused, what it asks of
// the platform (AnnouncePort), and the counters. It is independent of the settings' core (accessibility_info_core.h, which
// includes this one only because its Backend carries the announcements' port) and needs neither Godot nor React Native, so
// accessibility_announcement_core_test exercises every rule without an engine.
namespace fabric_godot::accessibility {

// Why the options that cannot be honored are refused. Each is the whole message of the error, from the code on.
inline constexpr const char *queue_refusal =
    "E_UNSUPPORTED: announceForAccessibilityWithOptions queue: the macOS accessibility API has no announcement queue";
inline constexpr const char *priority_refusal =
    "E_UNSUPPORTED: announceForAccessibilityWithOptions priority \"low\": AccessKit has only polite and assertive";

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
//   publish()   called by the platform inside the update: a new element for the first announcement kept, with its text and live
//               mode. One announcement per update, in the order they were asked for: the ones left wait for the updates
//               after it, one frame of latency for each.
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

  // One announcement per update, in the order they were asked for. AccessKit posts the elements of one update in an order of its
  // own (measured: three announcements of one frame came out second, first, third), and on iOS, with no queue, each announcement
  // interrupts the one before, so the user hears the last one asked for: the order has to be the host's. The announcements left
  // wait for the updates after this one, which the next pumps ask for, and each ages on its own. An announcement the platform has
  // no element for is dropped without taking the update, and the next one is tried.
  void publish() {
    if (stopped_ || publishing_) {
      return;
    }
    publishing_ = true;
    ++counters_.updates;
    // The platform's calls below may reach stop(), which clears what waits: the announcement is taken out of the queue first.
    while (!pending_.empty() && !stopped_) {
      const Pending item = std::move(pending_.front());
      pending_.erase(pending_.begin());
      const uint64_t handle = port_.create ? port_.create() : 0;
      if (handle == 0) {
        ++counters_.dropped_no_screen_reader;
        continue;
      }
      if (port_.set_text) {
        port_.set_text(handle, announcement_text, item.text);
      }
      if (port_.set_live) {
        port_.set_live(handle, item.live);
      }
      ++counters_.published;
      if (!stopped_) {
        held_.push_back(handle);
      }
      break;
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
