#pragma once

#include <react/runtime/PlatformTimerRegistry.h>
#include <algorithm>
#include <functional>
#include <map>
#include <utility>
#include <vector>

namespace fabric_godot {

// Godot supplies deadlines; upstream TimerManager owns JS callbacks, arguments
// and coercion. No JSI values live in this platform registry.
class TimerRegistry final : public facebook::react::PlatformTimerRegistry {
 public:
  explicit TimerRegistry(std::function<double()> clock) : clock_(std::move(clock)) {}
  void createTimer(uint32_t id, double delay) override { create(id, delay, false); }
  void createRecurringTimer(uint32_t id, double delay) override { create(id, delay, true); }
  void deleteTimer(uint32_t id) override { timers_.erase(id); }
  void quit() override { timers_.clear(); }

  std::vector<uint32_t> take_due(double time, size_t limit = 256) {
    std::vector<uint32_t> due;
    for (const auto &[id, timer] : timers_)
      if (!timer.queued && timer.due <= time) due.push_back(id);
    std::sort(due.begin(), due.end(), [this](auto a, auto b) {
      return timers_.at(a).due == timers_.at(b).due ? a < b : timers_.at(a).due < timers_.at(b).due;
    });
    if (due.size() > limit) due.resize(limit);
    for (auto id : due) timers_.at(id).queued = true;
    return due;
  }
  void finish(uint32_t id, double time) {
    auto found = timers_.find(id);
    if (found == timers_.end()) return; // The callback may cancel itself.
    if (!found->second.repeat) { timers_.erase(found); return; }
    found->second.queued = false;
    // A delayed frame never replays a burst of missed intervals.
    found->second.due = time + found->second.delay;
  }
  bool recurring(uint32_t id) const {
    auto found = timers_.find(id);
    return found != timers_.end() && found->second.repeat;
  }
  std::vector<uint32_t> handles() const {
    std::vector<uint32_t> ids;
    for (const auto &[id, timer] : timers_) ids.push_back(id);
    return ids;
  }
  size_t size() const { return timers_.size(); }

 private:
  struct Timer { double due, delay; bool repeat, queued; };
  std::function<double()> clock_;
  std::map<uint32_t, Timer> timers_;
  void create(uint32_t id, double delay, bool repeat) {
    timers_.insert_or_assign(id, Timer{clock_() + delay, delay, repeat, false});
  }
};
}
