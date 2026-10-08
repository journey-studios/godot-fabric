#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace fabric_godot {

// What the host measures of its own work, without a clock of its own: every function takes the
// time it is told (monotonic milliseconds), so the accounting is pure and exact on any sequence
// of times, which native/performance_metrics_test.cpp feeds it. Nothing here is a budget or a
// gate: it only counts and times, and what a time means is the reader's to judge.

// The durations of one kind of work. Count, total and maximum are exact over the whole life of
// the series; the percentiles are the nearest rank over the most recent window_size samples,
// which the series also hands out, so that whoever reports a percentile can be given the
// samples it comes from and compute it again.
class DurationSeries {
 public:
  static constexpr size_t window_size = 128;

  // A duration that is not finite or is negative is not a duration: it is counted apart and
  // never enters a total, a maximum or a percentile.
  void add(double ms) {
    if (!std::isfinite(ms) || ms < 0) {
      ++rejected_;
      return;
    }
    ++count_;
    total_ms_ += ms;
    max_ms_ = std::max(max_ms_, ms);
    if (window_.size() < window_size) {
      window_.push_back(ms);
    } else {
      window_[next_] = ms;
    }
    next_ = (next_ + 1) % window_size;
  }

  uint64_t count() const { return count_; }
  uint64_t rejected() const { return rejected_; }
  double total_ms() const { return total_ms_; }
  double max_ms() const { return max_ms_; }

  // The most recent samples, oldest first.
  std::vector<double> window() const {
    if (window_.size() < window_size) {
      return window_;
    }
    std::vector<double> ordered;
    ordered.reserve(window_size);
    for (size_t index = 0; index < window_size; ++index) {
      ordered.push_back(window_[(next_ + index) % window_size]);
    }
    return ordered;
  }

  // Nearest rank: the smallest sample that has at least `percent` percent of the samples at
  // or below it, that is the sample of rank ceil(percent * n / 100) once they are sorted.
  // Whole percents keep the rank in integers, where a fraction of n could land on either side
  // of an integer by rounding. Zero for no sample.
  static double percentile_of(std::vector<double> samples, unsigned percent) {
    if (samples.empty()) {
      return 0;
    }
    std::sort(samples.begin(), samples.end());
    const size_t n = samples.size();
    const size_t rank = std::clamp<size_t>((static_cast<size_t>(percent) * n + 99) / 100, 1, n);
    return samples[rank - 1];
  }
  double percentile(unsigned percent) const { return percentile_of(window(), percent); }

 private:
  uint64_t count_{}, rejected_{};
  double total_ms_{}, max_ms_{};
  std::vector<double> window_;
  size_t next_{};
};

// The work of one pump (one frame's turn of the runtime) that the host attributes to a phase.
//   Js      JS turns: microtasks, frame callbacks, timers and the queued work. What a React
//           render and commit cost on the JS side is here.
//   Mount   Fabric's mounting callback: the diff of the committed tree and the native
//           mutations (create, insert, update, remove, delete) and frames it applies.
//   Layout  Yoga layout and text measurement of a commit, as RN's own telemetry timed them
//           (TransactionTelemetry), which the host did not bracket itself.
enum class Phase : size_t { Js = 0, Mount = 1, Layout = 2 };
inline constexpr size_t phase_count = 3;
inline const char *phase_name(Phase phase) {
  switch (phase) {
    case Phase::Js: return "js";
    case Phase::Mount: return "mount";
    case Phase::Layout: return "layout";
  }
  return "";
}

class PerformanceMetrics {
 public:
  // Counters the roots that already ended no longer carry. The live roots' own counters add to
  // these, which is how the application's totals stay exact across mounts and unmounts.
  struct RetiredCounters {
    uint64_t commits{}, creates{}, deletes{}, updates{}, roots{};
  };
  void retire_root(uint64_t commits, uint64_t creates, uint64_t deletes, uint64_t updates) {
    retired_.commits += commits;
    retired_.creates += creates;
    retired_.deletes += deletes;
    retired_.updates += updates;
    ++retired_.roots;
  }
  const RetiredCounters &retired() const { return retired_; }

  // ------------------------------------------------------------------ the pump
  // One sample per outermost pump. A pump inside a pump (the unmount of a root runs ordinary
  // pumps) belongs to the one around it, so no time is counted twice.
  void begin_pump(double now_ms) {
    if (depth_++ > 0) {
      return;
    }
    pump_start_ms_ = now_ms;
    local_.fill(0);
    touched_.fill(false);
    open_.clear();
  }

  void end_pump(double now_ms) {
    if (depth_ == 0 || --depth_ > 0) {
      return;
    }
    // A scope that an exception skipped is closed at the end of the pump, never left to run on.
    while (!open_.empty()) {
      leave(now_ms);
    }
    pump_.add(now_ms - pump_start_ms_);
    for (size_t index = 0; index < phase_count; ++index) {
      if (touched_[index]) {
        phases_[index].add(local_[index]);
      }
    }
  }

  bool pumping() const { return depth_ > 0; }

  // A phase runs from enter to the matching leave and excludes what an inner phase takes: a
  // mount inside a JS turn is the mount's time and not the JS's, so that the phases of a pump
  // never add up to more than the pump. Outside a pump nothing is attributed, and enter says
  // so (false), so that its scope does not leave what it did not enter.
  bool enter(Phase phase, double now_ms) {
    if (depth_ == 0) {
      return false;
    }
    if (!open_.empty()) {
      local_[index_of(open_.back().phase)] += now_ms - open_.back().since_ms;
    }
    open_.push_back({phase, now_ms});
    touched_[index_of(phase)] = true;
    return true;
  }

  void leave(double now_ms) {
    if (open_.empty()) {
      return;
    }
    local_[index_of(open_.back().phase)] += now_ms - open_.back().since_ms;
    open_.pop_back();
    if (!open_.empty()) {
      open_.back().since_ms = now_ms;
    }
  }

  // Time that was spent before the innermost open phase began, by work the host did not
  // bracket and somebody else timed: RN's layout of the commit that this mounting callback
  // reports. It moves into `phase` out of the phase that was running around the callback or,
  // where none was, out of the pump time that no phase has, and never more than that donor
  // has, so that the phases of a pump still do not add up to more than the pump.
  void charge_enclosing(Phase phase, double ms, double now_ms) {
    if (depth_ == 0 || open_.empty() || !std::isfinite(ms) || ms <= 0) {
      return;
    }
    local_[index_of(open_.back().phase)] += now_ms - open_.back().since_ms;
    open_.back().since_ms = now_ms;
    double pool;
    if (open_.size() > 1) {
      pool = local_[index_of(open_[open_.size() - 2].phase)];
    } else {
      double attributed = 0;
      for (double part : local_) {
        attributed += part;
      }
      pool = (now_ms - pump_start_ms_) - attributed;
    }
    const double moved = std::clamp(ms, 0.0, std::max(pool, 0.0));
    if (open_.size() > 1) {
      local_[index_of(open_[open_.size() - 2].phase)] -= moved;
    }
    local_[index_of(phase)] += moved;
    touched_[index_of(phase)] = true;
  }

  const DurationSeries &pump() const { return pump_; }
  const DurationSeries &phase(Phase phase) const { return phases_[index_of(phase)]; }

  // ----------------------------------------------------------------- surfaces
  // The mount of a root (starting its surface) and its retirement, timed whole: React's first
  // render and its unmount do not run inside a pump.
  DurationSeries &surface_start() { return surface_start_; }
  DurationSeries &surface_retire() { return surface_retire_; }
  const DurationSeries &surface_start() const { return surface_start_; }
  const DurationSeries &surface_retire() const { return surface_retire_; }

  // The invariant the phases keep: together they never account for more than the pumps did.
  bool phases_within_pumps() const {
    double attributed = 0;
    for (const auto &series : phases_) {
      attributed += series.total_ms();
    }
    return attributed <= pump_.total_ms() * (1 + 1e-12) + 1e-9;
  }

 private:
  static constexpr size_t index_of(Phase phase) { return static_cast<size_t>(phase); }
  struct Open {
    Phase phase;
    double since_ms;
  };
  RetiredCounters retired_;
  DurationSeries pump_, surface_start_, surface_retire_;
  std::array<DurationSeries, phase_count> phases_;
  std::array<double, phase_count> local_{};
  std::array<bool, phase_count> touched_{};
  std::vector<Open> open_;
  double pump_start_ms_{};
  unsigned depth_{};
};

// A pump, ended however the function leaves.
class PumpScope {
 public:
  PumpScope(PerformanceMetrics &metrics, double (*now)()) : metrics_(metrics), now_(now) { metrics_.begin_pump(now_()); }
  ~PumpScope() { metrics_.end_pump(now_()); }
  PumpScope(const PumpScope &) = delete;
  PumpScope &operator=(const PumpScope &) = delete;

 private:
  PerformanceMetrics &metrics_;
  double (*now_)();
};

// A phase from open to close, closed however the function leaves. Constructed open unless told
// otherwise, so that a bracket can open and close around one call.
class PhaseScope {
 public:
  PhaseScope(PerformanceMetrics &metrics, Phase phase, double (*now)(), bool open_now = true)
      : metrics_(metrics), phase_(phase), now_(now) {
    if (open_now) {
      open();
    }
  }
  ~PhaseScope() { close(); }
  PhaseScope(const PhaseScope &) = delete;
  PhaseScope &operator=(const PhaseScope &) = delete;

  void open() {
    if (!entered_) {
      entered_ = metrics_.enter(phase_, now_());
    }
  }
  void close() {
    if (entered_) {
      metrics_.leave(now_());
      entered_ = false;
    }
  }
  // Charged to the phase this scope's phase interrupted, if it was entered.
  void charge_enclosing(Phase phase, double ms) {
    if (entered_) {
      metrics_.charge_enclosing(phase, ms, now_());
    }
  }

 private:
  PerformanceMetrics &metrics_;
  Phase phase_;
  double (*now_)();
  bool entered_{};
};

// One duration into a series when the scope ends.
class SeriesTimer {
 public:
  SeriesTimer(DurationSeries &series, double (*now)()) : series_(series), now_(now), start_ms_(now()) {}
  ~SeriesTimer() { series_.add(now_() - start_ms_); }
  SeriesTimer(const SeriesTimer &) = delete;
  SeriesTimer &operator=(const SeriesTimer &) = delete;

 private:
  DurationSeries &series_;
  double (*now_)();
  double start_ms_;
};
}
