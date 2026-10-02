#include "timer_registry.h"
#include <iostream>
#include <stdexcept>

using fabric_godot::TimerRegistry;
void require(bool condition, const char *message) {
  if (!condition) throw std::runtime_error(message);
}
int main() {
  double time = 100;
  TimerRegistry registry([&] { return time; });
  registry.createTimer(1, 20);
  registry.createTimer(2, 5);
  registry.createTimer(3, 5);
  require(registry.take_due(104).empty(), "A deadline must not fire early");
  require(registry.take_due(105) == std::vector<uint32_t>({2, 3}), "Equal deadlines preserve handle order");
  require(registry.take_due(105).empty(), "Queued callbacks cannot be dispatched twice");
  registry.deleteTimer(2);
  registry.finish(2, 106);
  registry.finish(3, 106);
  require(registry.size() == 1, "Cancelling a queued callback cannot resurrect it");
  registry.createRecurringTimer(4, 0);
  require(registry.take_due(100) == std::vector<uint32_t>({4}), "Zero intervals are eligible once per pump");
  require(registry.take_due(100).empty(), "Zero intervals cannot spin inside the same dispatch");
  registry.finish(4, 500);
  require(registry.take_due(500) == std::vector<uint32_t>({1, 4}), "Overdue deadlines sort before rescheduled intervals");
  registry.quit();
  registry.createRecurringTimer(5, 10);
  registry.take_due(110);
  registry.finish(5, 1000);
  require(registry.take_due(1009).empty(), "Missed intervals cannot replay a catch-up burst");
  require(registry.take_due(1010) == std::vector<uint32_t>({5}), "Intervals resume from callback completion");
  registry.quit();
  for (uint32_t id = 1; id <= 300; ++id) registry.createTimer(id, 0);
  require(registry.take_due(100).size() == 256, "The dispatch budget bounds a timer storm");
  require(registry.take_due(100).size() == 44, "Excess callbacks remain available for a later pump");
  registry.quit();
  require(registry.size() == 0, "Shutdown releases queued and scheduled deadlines");
  std::cout << "TIMER_REGISTRY_PASSED\n";
}
