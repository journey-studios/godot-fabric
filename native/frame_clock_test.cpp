#include "frame_clock.h"
#include <algorithm>
#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

using fabric_godot::FrameClock;
using Pacing = FrameClock::Pacing;
namespace {
void require(bool condition, const char *message) {
  if (!condition) throw std::runtime_error(message);
}
constexpr double unknown = -1;
const double T60 = 1000.0 / 60;

// Plays Godot frame times through one clock, the way the runtime asks it once per
// frame, and remembers which frames ticked.
struct Player {
  FrameClock clock;
  double rate;
  bool consumer;
  Pacing pacing;
  std::vector<double> frames, ticks;
  std::vector<bool> flags;
  explicit Player(double rate = unknown, bool consumer = true, Pacing pacing = Pacing::Time)
      : rate(rate), consumer(consumer), pacing(pacing) {}
  bool step(double time) {
    const bool tick = clock.frame(time, rate, pacing, consumer);
    frames.push_back(time);
    flags.push_back(tick);
    if (tick) ticks.push_back(time);
    return tick;
  }
  // Frames spaced by the given intervals, the first one at start.
  void run(double start, const std::vector<double> &intervals) {
    double time = start;
    step(time);
    for (double interval : intervals) step(time += interval);
  }
  double tightest() const {
    double least = std::numeric_limits<double>::infinity();
    for (size_t index = 1; index < ticks.size(); ++index) least = std::min(least, ticks[index] - ticks[index - 1]);
    return least;
  }
  double loosest() const {
    double most = 0;
    for (size_t index = 1; index < ticks.size(); ++index) most = std::max(most, ticks[index] - ticks[index - 1]);
    return most;
  }
};

// xorshift: the sequences are the same on every run and platform.
struct Random {
  uint64_t state;
  explicit Random(uint64_t seed) : state(seed) {}
  double next() {
    state ^= state << 13;
    state ^= state >> 7;
    state ^= state << 17;
    return static_cast<double>(state >> 11) / 9007199254740992.0;
  }
  double between(double low, double high) { return low + (high - low) * next(); }
};

void refresh_rate_selection() {
  FrameClock clock;
  auto state = clock.state();
  require(state.refresh_rate == 60 && state.period_ms == T60 && !state.display_rate && state.frames == 0 && state.ticks == 0,
      "A clock that has seen no frame already runs at the fallback rate");
  double time = 0;
  for (double reported : {unknown, 0.0, -144.0, std::numeric_limits<double>::quiet_NaN(),
           std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity()}) {
    clock.frame(time += 1, reported, Pacing::Time, false);
    state = clock.state();
    require(!state.display_rate && state.refresh_rate == 60 && state.period_ms == T60,
        "A rate that is not positive and finite means the display reports none, so 60 applies");
  }
  clock.frame(time += 1, 144, Pacing::Time, false);
  state = clock.state();
  require(state.display_rate && state.refresh_rate == 144 && state.period_ms == 1000.0 / 144,
      "The display's positive rate sets the period");
  clock.frame(time += 1, 59.94, Pacing::Time, false);
  require(clock.state().period_ms == 1000.0 / 59.94, "A fractional rate is used as reported");
  clock.frame(time += 1, unknown, Pacing::Time, false);
  require(!clock.state().display_rate && clock.state().period_ms == T60,
      "A window that moves to a screen with no rate falls back again");
  require(clock.state().ticks == 0 && clock.state().skipped == 0 && clock.state().frames == 9,
      "Frames without a consumer are counted and neither tick nor wait");
}

void counters_and_state() {
  FrameClock clock;
  require(!clock.frame(10, unknown, Pacing::Time, false), "A frame nothing waits for never ticks");
  require(clock.frame(11, unknown, Pacing::Time, true), "The first frame with a consumer ticks at once, however close to the last");
  require(!clock.frame(12, unknown, Pacing::Time, true), "A frame a millisecond behind a tick does not tick");
  const auto state = clock.state();
  require(state.frames == 3 && state.ticks == 1 && state.skipped == 1, "Idle frames, ticks and waited frames are told apart");
  require(state.last_frame_ms == 12 && state.last_tick_ms == 11, "The clock reports its latest frame and its latest tick");
  require(state.pacing == Pacing::Time, "A clock asked for Time pacing reports it");
}

// R = 64 makes T = 15.625 and T / 2 = 7.8125, and every time below is a multiple of
// 1/16, so each comparison sits exactly on its boundary.
void boundaries_are_inclusive() {
  Player player(64);
  require(player.step(100), "The first frame with a consumer ticks");
  require(!player.step(107.5), "7.5 ms is under half a period of 15.625 ms and nothing else is due");
  require(player.step(115.3125), "Exactly half a period after the previous Godot frame ticks");
  for (double time : {119.3125, 123.3125, 127.3125})
    require(!player.step(time), "4 ms after the previous frame and under a period after the tick does not");
  require(!player.step(130.90625), "A hair under a whole period after the tick, 3.59375 ms after the previous frame, does not");
  require(player.step(130.9375), "Exactly a whole period after the tick, 0.03125 ms after the previous frame, does");
  Player whole(64);
  whole.step(100);
  whole.step(107.5);
  require(!whole.step(114.5), "7 ms after the previous Godot frame, 14.5 ms after the tick: neither bound reached");
  require(whole.step(115.625), "Exactly one period after the previous tick ticks, though the previous frame is 1.125 ms behind");
}

// Time pacing is for loops that nothing paces, among them one the application caps at the
// refresh rate (Engine.max_fps with V-Sync off).
void capped_loops_tick_on_every_frame() {
  Random random(1);
  Player capped;
  std::vector<double> intervals;
  for (int index = 0; index < 600; ++index) intervals.push_back(T60 + random.between(-4, 4));
  capped.run(1000, intervals);
  require(capped.ticks.size() == capped.frames.size() && capped.clock.state().skipped == 0,
      "A loop capped at 60 fps with jitter under half a period ticks on every frame");
  Player catch_up;
  catch_up.run(0, {24.9, 8.4, 24.9, 8.4, 24.9, 8.4, 24.9, 8.4});
  require(catch_up.ticks.size() == catch_up.frames.size(),
      "The late frame of a capped loop's hiccup and the catch-up behind it, still over half a period apart, both tick");
  Player slow;
  slow.run(0, {33.3, 41, 120, 33.3, 250, 33.3});
  require(slow.ticks.size() == slow.frames.size(), "A loop slower than the display ticks on every frame");
}

void high_refresh_displays() {
  Random random(2);
  std::vector<double> intervals;
  for (int index = 0; index < 1000; ++index) intervals.push_back(1000.0 / 144 + random.between(-2, 2));
  Player matched(144);
  matched.run(0, intervals);
  require(matched.ticks.size() == matched.frames.size() && matched.clock.state().period_ms == 1000.0 / 144,
      "A 144 Hz loop on a display that reports 144 ticks on every frame");
  // The same loop on a display that reports nothing: R falls back to 60, so the
  // loop is faster than the display and ticks at about the 60 Hz rate. Its jitter
  // lets a frame that happens to follow a long interval tick closer than a whole
  // period after the last tick, but never closer than half of one.
  Player unreported;
  unreported.run(0, intervals);
  const double elapsed = unreported.frames.back() - unreported.frames.front();
  require(unreported.tightest() >= T60 / 2, "The same loop with no reported rate never ticks closer than half a fallback period");
  require(unreported.ticks.size() > 0.8 * elapsed / T60 && unreported.ticks.size() < 1.2 * elapsed / T60,
      "and is thinned to about one tick per fallback period");
}

void fast_loops_tick_once_per_period() {
  Player millisecond;
  millisecond.run(0, std::vector<double>(10000, 1));
  require(millisecond.tightest() >= T60 && millisecond.loosest() <= T60 + 1,
      "A loop at 1000 frames per second ticks each time a whole period has passed");
  require(millisecond.ticks.size() > 570 && millisecond.ticks.size() < 600, "which is about one tick per 60 Hz period");
  Player headless;
  headless.run(0, std::vector<double>(2000, 6.9));
  require(headless.tightest() >= T60 && headless.loosest() < T60 + 6.9,
      "Godot's headless pacing (a frame every 6.9 ms) ticks every third frame");
  Player eighths(60);
  eighths.run(0, std::vector<double>(500, 0.3));
  require(eighths.tightest() >= T60 && eighths.loosest() < T60 + 0.3, "A frame every 0.3 ms ticks once per period");
}

// A hosted runner delivered a late frame and, 0.4 ms behind it, a catch-up frame.
void ci_bursts_tick_once_per_pair() {
  Player burst;
  double time = 0;
  for (int pair = 0; pair < 100; ++pair) {
    burst.step(time += 57);
    burst.step(time += 0.4);
  }
  require(burst.ticks.size() == 100 && burst.clock.state().skipped == 100,
      "Each late frame ticks and the catch-up frame behind it waits");
  for (size_t index = 0; index < burst.flags.size(); ++index)
    require(burst.flags[index] == (index % 2 == 0), "The tick is the late frame of the pair, never the one 0.4 ms behind it");
  require(burst.tightest() > 57, "Ticks are a whole stall apart, not 0.4 ms");
}

void a_stall_gives_one_late_tick() {
  Player player;
  double time = 0;
  for (int index = 0; index < 30; ++index) player.step(time += T60);
  const size_t stall = player.frames.size();
  player.step(time += 500);
  player.step(time += 0.4);
  player.step(time += 0.4);
  player.step(time += 0.4);
  const size_t resumed = player.frames.size();
  player.step(time += T60);
  require(std::count(player.flags.begin(), player.flags.end(), false) == 3, "Only the catch-up frames wait");
  require(player.flags[stall] && !player.flags[stall + 1] && !player.flags[stall + 2] && !player.flags[stall + 3],
      "A 500 ms stall ticks once, on the late frame, and the three catch-up frames behind it do not");
  require(player.flags[resumed], "The first frame a whole period behind ticks again");
  require(player.ticks.size() == 30 + 1 + 1, "No tick replays the periods the stall missed");
}

void idle_loops_start_on_demand() {
  Player player(unknown, false);
  player.run(0, std::vector<double>(145, 6.9));
  require(player.clock.state().ticks == 0 && player.clock.state().skipped == 0 && player.clock.state().frames == 146,
      "A second of frames with no consumer ticks never");
  player.consumer = true;
  require(player.step(1001), "The first frame with a consumer ticks at once");
  // It served the consumer; the consumer leaves for a moment and returns.
  player.consumer = false;
  player.step(1003);
  player.consumer = true;
  require(!player.step(1005), "A consumer back within a period of the last tick on a fast loop waits for the period");
  player.step(1010);
  player.step(1015);
  require(player.step(1017.7), "and gets its tick once a whole period has passed");
  // Idle for longer than a period, a new request waits for nothing.
  player.consumer = false;
  for (int index = 0; index < 5; ++index) player.step(1020 + index * 6.9);
  player.consumer = true;
  require(player.step(1055), "A consumer that arrives after the loop idled for more than a period ticks at once");
}

void rate_changes_apply_on_the_next_frame() {
  Player player(60);
  player.run(0, std::vector<double>(60, 7));
  const size_t at_sixty = player.ticks.size();
  require(at_sixty < player.frames.size() / 2, "At 60 Hz a 7 ms loop is thinned");
  player.rate = 144;
  for (int index = 0; index < 60; ++index) player.step(player.frames.back() + 7);
  require(player.ticks.size() - at_sixty >= 59, "The same loop on a screen that reports 144 Hz ticks on every frame");
  player.rate = 60;
  for (int index = 0; index < 60; ++index) player.step(player.frames.back() + 7);
  require(player.ticks.size() - at_sixty < 59 + 25, "and is thinned again on moving back");
}

// A V-Sync window on a 120 Hz macOS display (measured): the engine pipelines its CPU frames, so
// they arrive in two clusters about 3 ms and 13 ms apart while one image is presented per refresh.
std::vector<double> pipelined_frames(int pairs) {
  std::vector<double> intervals;
  for (int index = 0; index < pairs; ++index) {
    intervals.push_back(13);
    intervals.push_back(3);
  }
  return intervals;
}

void presentation_ticks_every_frame_with_a_consumer() {
  const auto intervals = pipelined_frames(300);
  Player presented(120, true, Pacing::Presentation);
  presented.run(0, intervals);
  require(presented.ticks.size() == presented.frames.size() && presented.clock.state().skipped == 0,
      "In Presentation pacing the pipelined 3 and 13 ms frames of a V-Sync window all tick");
  // The same frames in Time pacing lose the 3 ms ones: time between Godot frames is no reference
  // for a loop the display paces, which is why Time is only for loops nothing paces.
  Player timed(120);
  timed.run(0, intervals);
  require(timed.ticks.size() >= 0.45 * timed.frames.size() && timed.ticks.size() <= 0.55 * timed.frames.size() && timed.clock.state().skipped > 250,
      "In Time pacing the same frames are thinned to the 13 ms ones");
  require(timed.tightest() >= 1000.0 / 120 / 2, "and the ticks that remain are no closer than half a period");
  Player stalled(unknown, true, Pacing::Presentation);
  double time = 0;
  for (int index = 0; index < 30; ++index) stalled.step(time += T60);
  stalled.step(time += 500);
  for (int index = 0; index < 3; ++index) stalled.step(time += 0.4);
  require(stalled.ticks.size() == stalled.frames.size(), "A stall and the catch-up frames behind it are presented frames, so each ticks");
  Player fast(unknown, true, Pacing::Presentation);
  fast.run(0, std::vector<double>(500, 0.3));
  require(fast.ticks.size() == fast.frames.size(),
      "Presentation pacing trusts the caller's claim that the display paces the loop: a loop that nothing paces belongs to Time");
  Player idle(120, false, Pacing::Presentation);
  idle.run(0, intervals);
  const auto state = idle.clock.state();
  require(state.ticks == 0 && state.skipped == 0 && state.frames == idle.frames.size() && state.pacing == Pacing::Presentation,
      "Frames with no consumer neither tick nor wait in Presentation pacing, and the clock reports the pacing");
  require(state.refresh_rate == 120 && state.period_ms == 1000.0 / 120, "The refresh rate still gives the period it reports");
}

void pacing_changes_apply_on_the_next_frame() {
  Player player(60);
  player.run(0, std::vector<double>(60, 7));
  const size_t timed = player.ticks.size();
  require(timed < player.frames.size() / 2, "In Time pacing a 7 ms loop at 60 Hz is thinned");
  player.pacing = Pacing::Presentation;
  for (int index = 0; index < 60; ++index) player.step(player.frames.back() + 7);
  require(player.ticks.size() - timed == 60, "The same loop on a window that V-Sync now presents ticks on every frame");
  player.pacing = Pacing::Time;
  const size_t presented = player.ticks.size();
  for (int index = 0; index < 60; ++index) player.step(player.frames.back() + 7);
  require(player.ticks.size() - presented < 30, "and is thinned again when V-Sync is turned off, from the last tick on");
}

void the_display_decides_the_pacing() {
  const auto presented = [](bool headless, int mode) { return FrameClock::detect_pacing(headless, mode); };
  require(presented(false, 1).pacing == Pacing::Presentation && std::string(presented(false, 1).source) == "vsync",
      "A window with V-Sync enabled is presented on the display's schedule");
  require(presented(false, 2).pacing == Pacing::Presentation && std::string(presented(false, 2).source) == "vsync",
      "and so is one with adaptive V-Sync");
  for (int mode : {0, 3, -1, 7})
    require(presented(false, mode).pacing == Pacing::Time && std::string(presented(false, mode).source) == "unpaced",
        "V-Sync disabled, mailbox or an unknown mode does not wait for the display");
  for (int mode : {0, 1, 2, 3})
    require(presented(true, mode).pacing == Pacing::Time && std::string(presented(true, mode).source) == "headless",
        "A headless display server has no display to pace anything, whatever V-Sync mode it reports");
}

// Whatever the pacing, the consumers and the rate: the properties below are the
// rule, restated as what a frame must and must not do.
void properties_hold_for_arbitrary_pacing() {
  const double rates[] = {unknown, 24, 30, 59.94, 60, 75, 90, 120, 144, 165, 240, 360};
  for (uint64_t seed = 1; seed <= 24; ++seed) {
    Random random(seed * 7919);
    const double rate = rates[seed % (sizeof(rates) / sizeof(rates[0]))];
    FrameClock clock;
    const double period = 1000.0 / (rate > 0 ? rate : 60);
    // Every third seed is a presented window, where a frame with a consumer is a tick whatever its timing.
    const Pacing pacing = seed % 3 == 0 ? Pacing::Presentation : Pacing::Time;
    double time = random.between(0, 1e6), previous_frame = 0, previous_tick = 0;
    bool served = false;
    uint64_t consumers = 0, ticks = 0;
    for (int index = 0; index < 20000; ++index) {
      // A mixture: V-Sync like, bursts, a fast loop and stalls.
      const double kind = random.next();
      time += kind < 0.4 ? random.between(0.2 * period, 1.6 * period) : kind < 0.7 ? random.between(0.01, 1)
          : kind < 0.95 ? random.between(0.4 * period, 0.6 * period) : random.between(2, 60) * period;
      const bool consumer = random.next() < 0.8;
      const bool tick = clock.frame(time, rate, pacing, consumer);
      consumers += consumer;
      require(!tick || consumer, "A frame no consumer waits for never ticks");
      if (pacing == Pacing::Presentation) {
        require(tick == consumer, "A presented frame ticks exactly when it has a consumer");
      } else {
        if (tick && served) require(time - previous_tick >= period / 2, "Two ticks are never closer than half a period");
        if (consumer && served && time - previous_tick >= period) require(tick, "A consumer is never kept waiting a whole period after a tick");
        if (consumer && served && time - previous_frame >= period / 2) require(tick, "A frame half a period behind the previous one serves its consumer");
        if (consumer && !served) require(tick, "The first frame with a consumer serves it");
        if (consumer && served && time - previous_frame < period / 2 && time - previous_tick < period)
          require(!tick, "A frame close to the previous frame and to the previous tick does not tick");
      }
      previous_frame = time;
      if (tick) {
        served = true;
        previous_tick = time;
        ++ticks;
      }
    }
    const auto state = clock.state();
    require(state.frames == 20000 && state.ticks == ticks && state.ticks + state.skipped == consumers,
        "Ticks and waited frames add up to the frames a consumer was present for");
    require(state.last_frame_ms == time && state.last_tick_ms == previous_tick && state.pacing == pacing, "The clock's own state agrees");
  }
}
}

int main() {
  refresh_rate_selection();
  counters_and_state();
  boundaries_are_inclusive();
  capped_loops_tick_on_every_frame();
  high_refresh_displays();
  fast_loops_tick_once_per_period();
  ci_bursts_tick_once_per_pair();
  a_stall_gives_one_late_tick();
  idle_loops_start_on_demand();
  rate_changes_apply_on_the_next_frame();
  presentation_ticks_every_frame_with_a_consumer();
  pacing_changes_apply_on_the_next_frame();
  the_display_decides_the_pacing();
  properties_hold_for_arbitrary_pacing();
  std::cout << "FRAME_CLOCK_PASSED\n";
}
