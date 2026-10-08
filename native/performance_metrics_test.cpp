#include "performance_metrics.h"
#include <cmath>
#include <cstdint>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>

using fabric_godot::DurationSeries;
using fabric_godot::Phase;
using fabric_godot::PerformanceMetrics;
using fabric_godot::PhaseScope;
using fabric_godot::PumpScope;
using fabric_godot::SeriesTimer;

namespace {
void require(bool condition, const char *message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}
bool near(double a, double b) { return std::fabs(a - b) < 1e-9; }

// The scopes read a clock that the test moves by hand.
double fake_now_ms = 0;
double fake_now() { return fake_now_ms; }

// xorshift: the sequences are the same on every run and platform.
struct Random {
  uint64_t state;
  explicit Random(uint64_t seed) : state(seed) {}
  uint64_t next() {
    state ^= state << 13;
    state ^= state >> 7;
    state ^= state << 17;
    return state;
  }
  double between(double low, double high) { return low + (high - low) * static_cast<double>(next() >> 11) / 9007199254740992.0; }
};

void series_totals_and_window() {
  DurationSeries series;
  require(series.count() == 0 && series.total_ms() == 0 && series.max_ms() == 0 && series.window().empty(),
      "A series that took no sample is empty");
  require(series.percentile(50) == 0 && series.percentile(99) == 0, "and has no percentile to report");
  for (int value = 1; value <= 300; ++value) {
    series.add(value);
  }
  require(series.count() == 300 && series.total_ms() == 300.0 * 301 / 2 && series.max_ms() == 300,
      "Count, total and maximum are exact over every sample, not over the window");
  const auto window = series.window();
  require(window.size() == DurationSeries::window_size, "The window keeps the most recent samples");
  require(window.front() == 300 - DurationSeries::window_size + 1 && window.back() == 300,
      "and gives them oldest first after the ring has wrapped");
  for (size_t index = 1; index < window.size(); ++index) {
    require(window[index] == window[index - 1] + 1, "in the order they arrived");
  }
  DurationSeries partial;
  for (double value : {5.0, 3.0, 9.0}) {
    partial.add(value);
  }
  const auto kept = partial.window();
  require(kept.size() == 3 && kept[0] == 5 && kept[1] == 3 && kept[2] == 9, "A window that is not full is in arrival order");
}

void durations_that_are_not_durations() {
  DurationSeries series;
  series.add(2);
  series.add(-0.5);
  series.add(std::numeric_limits<double>::quiet_NaN());
  series.add(std::numeric_limits<double>::infinity());
  series.add(-std::numeric_limits<double>::infinity());
  series.add(0);
  require(series.count() == 2 && series.rejected() == 4 && series.total_ms() == 2 && series.max_ms() == 2,
      "A negative or non-finite duration is counted apart and enters no total, maximum or percentile");
  require(series.window().size() == 2, "nor the window");
}

void percentiles_are_nearest_rank() {
  std::vector<double> hundred;
  for (int value = 100; value >= 1; --value) {
    hundred.push_back(value);
  }
  require(DurationSeries::percentile_of(hundred, 50) == 50 && DurationSeries::percentile_of(hundred, 95) == 95 &&
          DurationSeries::percentile_of(hundred, 99) == 99 && DurationSeries::percentile_of(hundred, 100) == 100,
      "Of 1..100, in any order, the p50 is 50, the p95 95, the p99 99 and the p100 100");
  require(DurationSeries::percentile_of(hundred, 0) == 1, "The p0 is the smallest sample");
  require(DurationSeries::percentile_of(hundred, 250) == 100, "A percent over 100 is the largest sample");
  std::vector<double> twenty;
  for (int value = 1; value <= 20; ++value) {
    twenty.push_back(value * 10);
  }
  require(DurationSeries::percentile_of(twenty, 95) == 190, "The p95 of 20 samples is the 19th: ceil(0.95 * 20), not the 20th");
  require(DurationSeries::percentile_of(twenty, 50) == 100 && DurationSeries::percentile_of(twenty, 99) == 200,
      "and the p50 the 10th, the p99 the 20th");
  require(DurationSeries::percentile_of({7}, 50) == 7 && DurationSeries::percentile_of({7}, 99) == 7, "One sample is every percentile");
  require(DurationSeries::percentile_of({4, 8}, 50) == 4 && DurationSeries::percentile_of({4, 8}, 51) == 8,
      "Two samples: the p50 is the first, above it the second");
  DurationSeries series;
  for (double value : {30.0, 10.0, 20.0}) {
    series.add(value);
  }
  require(series.percentile(50) == 20 && series.percentile(99) == 30, "A series gives the percentile of its window");
}

void nested_phases_exclude_each_other() {
  PerformanceMetrics metrics;
  metrics.begin_pump(0);
  require(metrics.enter(Phase::Js, 1), "A phase opens inside a pump");
  require(metrics.enter(Phase::Mount, 3), "and another inside it");
  metrics.leave(7);
  metrics.leave(10);
  metrics.end_pump(12);
  require(near(metrics.pump().total_ms(), 12) && metrics.pump().count() == 1, "The pump is one sample, whole");
  require(near(metrics.phase(Phase::Js).total_ms(), 5), "JS has its own time: 2 ms before the mount and 3 ms after it");
  require(near(metrics.phase(Phase::Mount).total_ms(), 4), "and the mount the 4 ms between");
  require(metrics.phase(Phase::Layout).count() == 0, "A phase that did not run in the pump takes no sample");
  require(metrics.phases_within_pumps(), "Together the phases are no more than the pump");
}

void layout_comes_out_of_the_phase_around_it() {
  PerformanceMetrics metrics;
  metrics.begin_pump(0);
  metrics.enter(Phase::Js, 0);
  metrics.enter(Phase::Mount, 10);
  metrics.charge_enclosing(Phase::Layout, 3, 11);
  metrics.leave(14);
  metrics.leave(20);
  metrics.end_pump(20);
  require(near(metrics.phase(Phase::Layout).total_ms(), 3), "Layout that somebody else timed is a phase of its own");
  require(near(metrics.phase(Phase::Js).total_ms(), 13), "taken out of the JS turn the commit ran in: 16 ms less the 3");
  require(near(metrics.phase(Phase::Mount).total_ms(), 4), "and not out of the mount");
  require(metrics.phases_within_pumps() && near(metrics.phase(Phase::Js).total_ms() + metrics.phase(Phase::Mount).total_ms() +
              metrics.phase(Phase::Layout).total_ms(), 20),
      "so the phases still add up to the pump, no more");
}

void layout_is_never_more_than_the_donor_has() {
  PerformanceMetrics metrics;
  metrics.begin_pump(0);
  metrics.enter(Phase::Js, 0);
  metrics.enter(Phase::Mount, 2);
  metrics.charge_enclosing(Phase::Layout, 50, 3);
  metrics.leave(4);
  metrics.leave(5);
  metrics.end_pump(5);
  require(near(metrics.phase(Phase::Layout).total_ms(), 2) && near(metrics.phase(Phase::Js).total_ms(), 1),
      "A layout longer than the JS time around the commit is cut to what that time was");
  require(metrics.phases_within_pumps(), "and the phases are still within the pump");
}

void layout_without_a_phase_around_it() {
  PerformanceMetrics metrics;
  metrics.begin_pump(0);
  metrics.enter(Phase::Mount, 5);
  metrics.charge_enclosing(Phase::Layout, 2, 6);
  metrics.leave(8);
  metrics.end_pump(10);
  require(near(metrics.phase(Phase::Layout).total_ms(), 2) && near(metrics.phase(Phase::Mount).total_ms(), 3),
      "Where no phase surrounds the commit, the layout comes out of the pump time no phase has");
  metrics.begin_pump(20);
  metrics.enter(Phase::Mount, 20);
  metrics.charge_enclosing(Phase::Layout, 9, 21);
  metrics.leave(22);
  metrics.end_pump(22);
  require(near(metrics.phase(Phase::Layout).total_ms(), 2 + 0) && metrics.phases_within_pumps(),
      "and there is none to take when the pump had no time outside the mount");
  metrics.enter(Phase::Mount, 30);
  metrics.charge_enclosing(Phase::Layout, 1, 31);
  require(metrics.pump().count() == 2, "Charging outside a pump attributes nothing");
}

void nothing_is_attributed_outside_a_pump() {
  PerformanceMetrics metrics;
  require(!metrics.enter(Phase::Js, 0) && !metrics.pumping(), "A phase does not open outside a pump");
  metrics.leave(5);
  metrics.charge_enclosing(Phase::Layout, 3, 5);
  fake_now_ms = 0;
  {
    PhaseScope scope(metrics, Phase::Mount, fake_now);
    fake_now_ms = 4;
  }
  require(metrics.pump().count() == 0 && metrics.phase(Phase::Mount).count() == 0 && metrics.phase(Phase::Js).count() == 0,
      "and a scope around work outside a pump takes no sample");
  {
    PumpScope pump(metrics, fake_now);
    fake_now_ms = 6;
    PhaseScope scope(metrics, Phase::Js, fake_now);
    fake_now_ms = 9;
  }
  require(metrics.pump().count() == 1 && near(metrics.phase(Phase::Js).total_ms(), 3) && near(metrics.pump().total_ms(), 5),
      "Inside one it does, and both end however the scope is left");
}

void a_pump_inside_a_pump_is_one_sample() {
  PerformanceMetrics metrics;
  metrics.begin_pump(0);
  metrics.begin_pump(1);
  metrics.end_pump(2);
  require(metrics.pump().count() == 0 && metrics.pumping(), "The inner pump takes no sample of its own");
  metrics.end_pump(10);
  require(metrics.pump().count() == 1 && near(metrics.pump().total_ms(), 10) && !metrics.pumping(),
      "its time is the outer pump's, counted once");
  metrics.end_pump(11);
  require(metrics.pump().count() == 1, "An end with no pump begun is ignored");
}

void a_scope_an_exception_skipped_is_closed_with_the_pump() {
  PerformanceMetrics metrics;
  metrics.begin_pump(0);
  metrics.enter(Phase::Js, 2);
  metrics.enter(Phase::Mount, 4);
  metrics.end_pump(9);
  require(near(metrics.phase(Phase::Mount).total_ms(), 5) && near(metrics.phase(Phase::Js).total_ms(), 2),
      "A phase left open at the end of the pump is closed there, innermost first");
  metrics.begin_pump(20);
  require(metrics.phase(Phase::Js).count() == 1, "and the next pump starts clean");
  metrics.end_pump(21);
  require(metrics.phase(Phase::Js).count() == 1 && metrics.pump().count() == 2, "taking no phase sample for a phase it did not run");
}

void surfaces_and_counters() {
  PerformanceMetrics metrics;
  fake_now_ms = 100;
  {
    SeriesTimer timer(metrics.surface_start(), fake_now);
    fake_now_ms = 112.5;
  }
  {
    SeriesTimer timer(metrics.surface_retire(), fake_now);
    fake_now_ms = 120;
  }
  require(metrics.surface_start().count() == 1 && near(metrics.surface_start().total_ms(), 12.5) &&
          metrics.surface_retire().count() == 1 && near(metrics.surface_retire().total_ms(), 7.5),
      "A surface's start and its retirement are timed whole");
  metrics.retire_root(4, 30, 28, 6);
  metrics.retire_root(1, 2, 2, 0);
  const auto retired = metrics.retired();
  require(retired.commits == 5 && retired.creates == 32 && retired.deletes == 30 && retired.updates == 6 && retired.roots == 2,
      "The counters of the roots that ended add up, so the application's totals survive unmounting");
}

// Whatever the sequence of phases, charges and pumps, a pump's phases never add up to more than the
// pump, a phase takes at most one sample per pump, and every time is finite and not negative.
void properties_hold_for_arbitrary_sequences() {
  for (uint64_t seed = 1; seed <= 40; ++seed) {
    Random random(seed * 104729);
    PerformanceMetrics metrics;
    double time = random.between(0, 1e6);
    for (int round = 0; round < 400; ++round) {
      const double before_pumps = metrics.pump().total_ms();
      double before_phases = 0;
      for (Phase phase : {Phase::Js, Phase::Mount, Phase::Layout}) {
        before_phases += metrics.phase(phase).total_ms();
      }
      const uint64_t before_count = metrics.pump().count();
      metrics.begin_pump(time);
      int open = 0;
      for (int step = 0; step < 24; ++step) {
        time += random.between(0, 3);
        const uint64_t action = random.next() % 6;
        if (action == 0 || action == 1) {
          metrics.enter(static_cast<Phase>(random.next() % 2), time);
          ++open;
        } else if (action == 2 && open > 0) {
          metrics.leave(time);
          --open;
        } else if (action == 3) {
          metrics.charge_enclosing(Phase::Layout, random.between(-1, 6), time);
        } else if (action == 4) {
          metrics.begin_pump(time);
          time += random.between(0, 1);
          metrics.end_pump(time);
        }
      }
      time += random.between(0, 3);
      metrics.end_pump(time);
      double after_phases = 0;
      for (Phase phase : {Phase::Js, Phase::Mount, Phase::Layout}) {
        after_phases += metrics.phase(phase).total_ms();
        require(metrics.phase(phase).count() <= metrics.pump().count(), "A phase takes at most one sample per pump");
        require(metrics.phase(phase).rejected() == 0, "No phase time is ever negative or not finite");
      }
      require(metrics.pump().count() == before_count + 1 && metrics.pump().rejected() == 0, "One outermost pump, one sample");
      require(after_phases - before_phases <= metrics.pump().total_ms() - before_pumps + 1e-9,
          "The phases of one pump add up to no more than that pump");
      require(metrics.phases_within_pumps(), "and so do the totals");
    }
  }
}
}

int main() {
  series_totals_and_window();
  durations_that_are_not_durations();
  percentiles_are_nearest_rank();
  nested_phases_exclude_each_other();
  layout_comes_out_of_the_phase_around_it();
  layout_is_never_more_than_the_donor_has();
  layout_without_a_phase_around_it();
  nothing_is_attributed_outside_a_pump();
  a_pump_inside_a_pump_is_one_sample();
  a_scope_an_exception_skipped_is_closed_with_the_pump();
  surfaces_and_counters();
  properties_hold_for_arbitrary_sequences();
  std::cout << "PERFORMANCE_METRICS_PASSED\n";
}
