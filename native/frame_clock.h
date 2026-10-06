#pragma once

#include <cmath>
#include <cstdint>

namespace fabric_godot {

// The host's display link. RN runs `requestAnimationFrame` callbacks and its
// Native Animated drivers from the platform's display link (iOS CADisplayLink in
// RCTTiming and RCTScheduler, Android Choreographer), which never fires twice
// within a refresh period and, after a stall, fires once and late: the vsyncs it
// missed are dropped, never replayed. Godot's loop has no such guarantee. Where
// nothing paces it (headless, V-Sync off) it runs as fast as its sleep allows,
// hundreds of frames per second, and after a long frame it delivers back-to-back
// catch-up frames. RN's drivers assume display cadence: a decay ends at its first
// step under 0.1, so near-duplicate frames end it early and change where it lands.
//
// This clock decides, once per Godot frame, whether the frame is a tick. Only a
// tick runs the frame callbacks and the Native Animated frame, both with the
// tick's timestamp. The rule is here and nowhere else. A frame is a tick only if
// something consumes frames (pending frame callbacks or an active Native Animated
// backend), and then the way the window's frames reach the screen (Pacing) decides.
//
// Presentation. The window is presented with V-Sync (enabled or adaptive) on a real
// display. The engine blocks on the display and presents every process frame as one
// image, so every frame with a consumer is a tick. The time between Godot frames
// says nothing here: the CPU runs ahead of the display and the engine pipelines its
// frames (a 120 Hz macOS window measured them in two clusters, about 3 ms and
// 13 ms apart, around an 8 ms mean). A rule on that time would drop presented
// images and judder what moves.
//
// Time. Nothing paces the loop (headless, V-Sync off or mailbox), so time is the
// only reference. With T = 1000 / R ms, R being the refresh rate of the screen that
// shows the application's window when the display reports a positive one and 60
// otherwise (Godot's documented fallback, and the single-frame interval RN assumes),
// the frame at time t is a tick iff it has a consumer and any of these holds:
//   - no tick has served a consumer yet;
//   - t - (the previous Godot frame) >= T / 2, so the loop is paced at the
//     display, or stalled;
//   - t - (the previous tick) >= T, so the loop runs faster than the display.
// Every Godot frame, tick or not, is the previous Godot frame of the next one;
// only a tick is the previous tick.
//
// T / 2 is rounding to the nearest refresh period: the widest tolerance that
// never thins a loop already paced at the refresh with jitter under T / 2. What
// follows from the rule, at the rate in force:
//   - two ticks are never closer than T / 2: a tick is itself a Godot frame, so
//     the previous tick is at or before the previous Godot frame;
//   - a loop capped at the refresh (Engine.max_fps) or slower ticks on every
//     frame, as long as its jitter stays under T / 2;
//   - a loop faster than T / 2 ticks about once per T;
//   - a stall gives one late tick: the catch-up frames behind it are closer than
//     T / 2 to each other and to the tick;
//   - after idling, the first frame with a consumer ticks at once, which is what
//     a display link started on demand does.
// Time is only for loops nothing paces: given a presented loop it would thin the
// frames that reach the screen.
//
// Open: a Presentation tick carries the CPU time of its frame, so the steps between
// ticks are as uneven as those frames (3 and 13 ms above) and a decay, which ends
// at its first step under 0.1, lands earlier than at a regular cadence. The display
// link of iOS hands RN the presentation time of the frame (targetTimestamp), which
// is regular. A regular presentation timestamp is not implemented here.
//
// Time is monotonic milliseconds; the clock never reads one itself.
class FrameClock {
 public:
  static constexpr double fallback_refresh_rate = 60;

  // How the window's frames reach the screen, which decides what a tick is.
  enum class Pacing { Time, Presentation };

  // The pacing of a window from what the DisplayServer reports, and why: the source
  // is a literal. vsync_mode is DisplayServer.VSyncMode: 0 disabled, 1 enabled,
  // 2 adaptive, 3 mailbox. Enabled and adaptive present each frame on the display's
  // schedule; mailbox and disabled do not wait for it, and headless has no display.
  struct Detected {
    Pacing pacing;
    const char *source;
  };
  static Detected detect_pacing(bool headless, int vsync_mode) {
    if (headless) {
      return {Pacing::Time, "headless"};
    }
    if (vsync_mode == 1 || vsync_mode == 2) {
      return {Pacing::Presentation, "vsync"};
    }
    return {Pacing::Time, "unpaced"};
  }

  struct State {
    double period_ms;
    double refresh_rate;
    // The rate came from the display, not from the fallback.
    bool display_rate;
    Pacing pacing;
    // Godot frames seen, ticks among them, and the frames a consumer waited
    // through without a tick. The rest had no consumer.
    uint64_t frames;
    uint64_t ticks;
    uint64_t skipped;
    // The time of the latest Godot frame and of the latest tick; 0 before any.
    double last_frame_ms;
    double last_tick_ms;
  };

  // One call per Godot frame. refresh_rate is what the display reports for the
  // window's screen: a value that is not positive and finite means it reports none.
  // Returns whether this frame is a tick.
  bool frame(double now_ms, double refresh_rate, Pacing pacing, bool consumer) {
    use_refresh_rate(refresh_rate);
    pacing_ = pacing;
    const double period = 1000.0 / rate_;
    const bool due = !served_ || now_ms - previous_frame_ms_ >= period / 2 || now_ms - last_tick_ms_ >= period;
    const bool tick = consumer && (pacing == Pacing::Presentation || due);
    ++frames_;
    previous_frame_ms_ = now_ms;
    if (tick) {
      ++ticks_;
      served_ = true;
      last_tick_ms_ = now_ms;
    } else if (consumer) {
      ++skipped_;
    }
    return tick;
  }

  State state() const {
    return {1000.0 / rate_, rate_, display_rate_, pacing_, frames_, ticks_, skipped_, previous_frame_ms_, last_tick_ms_};
  }

 private:
  void use_refresh_rate(double refresh_rate) {
    display_rate_ = std::isfinite(refresh_rate) && refresh_rate > 0;
    rate_ = display_rate_ ? refresh_rate : fallback_refresh_rate;
  }

  double rate_{fallback_refresh_rate};
  bool display_rate_{};
  Pacing pacing_{Pacing::Time};
  bool served_{};
  double previous_frame_ms_{}, last_tick_ms_{};
  uint64_t frames_{}, ticks_{}, skipped_{};
};
}
