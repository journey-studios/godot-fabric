#include "scroll_motion.h"
#include "scroll_throttle.h"
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>

using namespace fabric_godot;
namespace {
int checks{};
void require(bool condition, const std::string &message) {
  ++checks;
  if (!condition) throw std::runtime_error(message);
}
void near(double actual, double expected, const std::string &message) {
  require(std::abs(actual - expected) < 1e-6, message);
}
}
int main() {
  try {
    const auto maximum = scroll_maximum({500, 900}, {120, 100});
    near(maximum.x, 380, "horizontal max");
    near(maximum.y, 800, "vertical max");
    const auto clamped = clamp_scroll_offset({13.25, 900}, maximum);
    near(clamped.x, 13.25, "fractional offset retained");
    near(clamped.y, 800, "offset clamped");
    const auto position = scroll_content_position({2, 4}, clamped);
    near(position.x, -11.25, "content origin includes fractional offset");
    near(position.y, -796, "content origin translated");

    require(!scroll_event_is_throttled(0, 0), "zero throttle never suppresses scroll events");
    require(!scroll_event_is_throttled(16, 0), "sub-frame throttle never suppresses scroll events");
    require(scroll_event_is_throttled(17, 0), "17 ms throttle follows RN's minimum interval");
    require(scroll_event_is_throttled(17, 17), "equal elapsed time remains throttled");
    require(!scroll_event_is_throttled(17, 17.001), "event passes after the 17 ms interval");
    require(scroll_event_is_throttled(150, 149.999), "150 ms throttle suppresses inside its interval");
    require(scroll_event_is_throttled(150, 150), "equal 150 ms elapsed remains throttled");
    require(!scroll_event_is_throttled(150, 150.001), "event passes after the 150 ms interval");

    ScrollMotion motion;
    motion.replace({0, 100}, false, 0);
    near(motion.offset().y, 100, "immediate command applies final offset");
    require(motion.mode() == ScrollMotion::Mode::Idle, "immediate command does not schedule motion");
    motion.set_offset({});
    motion.replace({0, 100}, true, 1.0);
    auto middle = motion.tick(1.125, {0, 800});
    require(middle.changed && middle.offset.y > 0 && middle.offset.y < 100, "animated command advances in time");
    motion.replace({0, 200}, true, 1.125);
    near(motion.offset().y, middle.offset.y, "replacement starts at the current offset");
    auto final = motion.tick(1.375, {0, 800});
    near(final.offset.y, 200, "replacement reaches its target");
    require(motion.mode() == ScrollMotion::Mode::Idle, "animation retires at final frame");

    motion.set_offset({});
    motion.begin_drag({50, 120}, 2.0);
    auto first = motion.drag({50, 80}, 2.04, {0, 800});
    near(first.y, 40, "drag offset follows finger");
    auto second = motion.drag({50, 30}, 2.09, {0, 800});
    near(second.y, 90, "drag uses same canonical offset");
    const auto release_velocity = motion.finish_drag({50, 0}, 2.12, {0, 800});
    near(motion.offset().y, 120, "release coordinate commits final finger position");
    require(release_velocity.y > 0, "release velocity comes from measured pointer samples");
    require(motion.mode() == ScrollMotion::Mode::Momentum, "measured flick starts momentum");
    const double before = motion.offset().y;
    auto coast = motion.tick(2.14, {0, 800});
    require(coast.changed && coast.offset.y > before && motion.mode() == ScrollMotion::Mode::Momentum,
        "momentum integrates measured velocity");
    motion.cancel();
    require(motion.mode() == ScrollMotion::Mode::Idle, "cancellation retires momentum");

    ScrollMotion long_frame, partitioned;
    for (auto *candidate : {&long_frame, &partitioned}) {
      candidate->set_offset({0, 200});
      candidate->begin_drag({0, 0}, 4.0);
      candidate->drag({0, -200}, 4.2, {0, 800});
      candidate->finish_drag({0, -200}, 4.2, {0, 800});
    }
    const auto one_tick = long_frame.tick(4.4, {0, 800});
    ScrollMotion::Update partitioned_tick{};
    for (int frame = 1; frame <= 10; ++frame)
      partitioned_tick = partitioned.tick(4.2 + frame * 0.02, {0, 800});
    near(one_tick.offset.y, partitioned_tick.offset.y, "inertia is independent of frame partition");
    near(one_tick.offset.y, 400 + 1000 * (1 - std::exp(-ScrollMotion::kFrictionPerSecond * 0.2)) /
        ScrollMotion::kFrictionPerSecond, "inertia uses analytic exponential distance");

    ScrollMotion long_gap;
    long_gap.set_offset({0, 200});
    long_gap.begin_drag({0, 0}, 5.0);
    long_gap.drag({0, -200}, 5.2, {0, 800});
    long_gap.finish_drag({0, -200}, 5.2, {0, 800});
    const auto after_gap = long_gap.tick(6.2, {0, 800});
    near(after_gap.offset.y, 400 + 1000 / ScrollMotion::kFrictionPerSecond,
        "long elapsed interval settles the analytic exponential tail");
    require(after_gap.momentumEnded, "long elapsed interval ends slow momentum");
    ScrollMotion many_frames;
    many_frames.set_offset({0, 200});
    many_frames.begin_drag({0, 0}, 8.0);
    many_frames.drag({0, -200}, 8.2, {0, 800});
    many_frames.finish_drag({0, -200}, 8.2, {0, 800});
    ScrollMotion::Update settled_frames{};
    for (int frame = 1; frame <= 50; ++frame)
      settled_frames = many_frames.tick(8.2 + frame * 0.02, {0, 800});
    near(after_gap.offset.y, settled_frames.offset.y, "settled inertia is frame-partition invariant");

    ScrollMotion hold;
    hold.set_offset({0, 200});
    hold.begin_drag({0, 20}, 7.0);
    const auto held_velocity = hold.finish_drag({0, 20}, 7.5, {0, 800});
    near(held_velocity.y, 0, "stationary hold does not invent release velocity");
    near(hold.offset().y, 200, "stationary release preserves offset");
    require(hold.mode() == ScrollMotion::Mode::Idle, "stationary release starts no momentum");

    ScrollMotion held_after_move;
    held_after_move.set_offset({0, 200});
    held_after_move.begin_drag({0, 120}, 9.0);
    held_after_move.drag({0, 20}, 9.05, {0, 800});
    held_after_move.drag({0, 20}, 10.05, {0, 800});
    const auto after_hold = held_after_move.finish_drag({0, 20}, 10.06, {0, 800});
    near(after_hold.y, 0, "a one-second hold expires earlier movement samples");
    require(held_after_move.mode() == ScrollMotion::Mode::Idle, "a stale pre-hold flick starts no momentum");

    ScrollMotion repeated_hold;
    repeated_hold.set_offset({0, 200});
    repeated_hold.begin_drag({0, 120}, 11.0);
    repeated_hold.drag({0, 20}, 11.05, {0, 800});
    for (int frame = 1; frame <= 50; ++frame)
      repeated_hold.drag({0, 20}, 11.05 + frame * 0.02, {0, 800});
    const auto repeated_hold_velocity = repeated_hold.finish_drag({0, 20}, 12.07, {0, 800});
    near(repeated_hold_velocity.y, 0, "repeated stationary moves do not preserve stale velocity");
    require(repeated_hold.mode() == ScrollMotion::Mode::Idle, "stationary moves end without momentum");

    ScrollMotion recent_flick;
    recent_flick.set_offset({0, 200});
    recent_flick.begin_drag({0, 120}, 13.0);
    recent_flick.drag({0, 100}, 13.04, {0, 800});
    recent_flick.drag({0, 70}, 13.07, {0, 800});
    const auto fresh_velocity = recent_flick.finish_drag({0, 50}, 13.10, {0, 800});
    require(fresh_velocity.y > ScrollMotion::kStopSpeed,
        "a recent flick remains eligible for momentum after the freshness window is introduced");
    require(recent_flick.mode() == ScrollMotion::Mode::Momentum, "a recent flick starts momentum");

    motion.set_offset({0, 790});
    motion.begin_drag({0, 10}, 3.0);
    motion.drag({0, -30}, 3.03, {0, 800});
    const auto bounded_velocity = motion.finish_drag({0, -50}, 3.05, {0, 800});
    require(bounded_velocity.y > 0, "bounded flick has measured velocity");
    auto bounded = motion.tick(3.10, {0, 800});
    near(bounded.offset.y, 800, "momentum respects maximum offset");
    require(bounded.momentumEnded, "momentum ends when it reaches a hard boundary");
    std::cout << "SCROLL_MOTION_PASSED " << checks << "\n";
  } catch (const std::exception &error) {
    std::cerr << "SCROLL_MOTION_FAILED: " << error.what() << "\n";
    return EXIT_FAILURE;
  }
}
