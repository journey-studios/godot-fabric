#pragma once
#include <folly/dynamic.h>
#include <cstdint>
#include <functional>
#include <string>
#include <utility>

namespace fabric_godot {
// The Godot application lifecycle as React Native's AppState reports it. One
// instance belongs to a FabricApplication and is shared by every root of its
// runtime. The application feeds it the OS notifications that
// SceneTree::_notification propagates to every node; the AppState TurboModule
// observes it while that module is alive. All calls run on Godot's main thread.
//
// Godot reports the transitions RCTAppState maps on iOS: FOCUS_OUT on
// WillResignActive ("inactive") and PAUSED on DidEnterBackground ("background").
// Android sends FOCUS_OUT then PAUSED from Activity.onPause, and desktop
// platforms send application focus alone, so a desktop application is
// "inactive" while another application has focus. Application focus is also
// reported as Android's appStateFocusChange (AppState focus/blur).
class AppLifecycle {
 public:
  enum class Event { State, Focus, MemoryWarning };
  using Observer = std::function<void(Event, const std::string &state, bool focused)>;

  // Godot's Input assumes a focused application until FOCUS_OUT arrives.
  const char *state() const { return paused_ ? "background" : focused_ ? "active" : "inactive"; }
  void focus(bool focused) {
    ++(focused ? received_focus_in_ : received_focus_out_);
    // Like Android's onWindowFocusChanged, only an actual change is reported.
    if (focused_ == focused) return;
    const std::string previous = state();
    focused_ = focused;
    // The state event comes first, so focus/blur listeners read the new state.
    publish_state(previous);
    publish(Event::Focus);
  }
  void pause(bool paused) {
    ++(paused ? received_paused_ : received_resumed_);
    if (paused_ == paused) return;
    const std::string previous = state();
    paused_ = paused;
    publish_state(previous);
  }
  void memory_warning() {
    ++received_memory_warnings_;
    publish(Event::MemoryWarning);
  }
  void observe(Observer observer) {
    observer_ = std::move(observer);
    ++observers_;
  }
  void release() { observer_ = {}; }
  folly::dynamic snapshot() const {
    return folly::dynamic::object("state", state())("focused", focused_)("paused", paused_)
        ("observed", static_cast<bool>(observer_))("observers", observers_)
        ("notifications", folly::dynamic::object("focusIn", received_focus_in_)("focusOut", received_focus_out_)
            ("paused", received_paused_)("resumed", received_resumed_)("memoryWarning", received_memory_warnings_))
        ("events", folly::dynamic::object("change", changes_)("focus", focus_events_)("blur", blur_events_)
            ("memoryWarning", memory_events_))
        ("unobserved", unobserved_);
  }

 private:
  bool focused_{true}, paused_{false};
  Observer observer_;
  uint64_t observers_{};
  uint64_t received_focus_in_{}, received_focus_out_{}, received_paused_{}, received_resumed_{};
  uint64_t received_memory_warnings_{};
  uint64_t changes_{}, focus_events_{}, blur_events_{}, memory_events_{}, unobserved_{};

  // RCTAppState sends appStateDidChange only when the state differs from the
  // last one it reported; this source starts from the state it was created in.
  void publish_state(const std::string &previous) {
    if (previous != state()) publish(Event::State);
  }
  void publish(Event event) {
    if (!observer_) {
      ++unobserved_;
      return;
    }
    switch (event) {
      case Event::State: ++changes_; break;
      case Event::Focus: ++(focused_ ? focus_events_ : blur_events_); break;
      case Event::MemoryWarning: ++memory_events_; break;
    }
    observer_(event, state(), focused_);
  }
};
}
