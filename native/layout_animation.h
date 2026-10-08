#pragma once
#include <ReactCommon/RuntimeExecutor.h>
#include <folly/dynamic.h>
#include <react/renderer/componentregistry/ComponentDescriptorRegistry.h>
#include <react/utils/ContextContainer.h>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>

namespace facebook::react {
class ShadowTree;
class UIManager;
}

namespace fabric_godot {
// One application's LayoutAnimation. RN's own LayoutAnimationDriver (the C++ animation
// engine behind LayoutAnimation.configureNext and UIManager.configureNextLayoutAnimation)
// is installed on the application's UIManager as RN's Scheduler installs it, with the
// mounting override delegate of every ShadowTree, and the application's frame clock tick
// (frame_clock.h) is its display link: animationTick() is what RCTScheduler.mm's
// CADisplayLink observer and Android's choreographer call. The driver's own logic is not
// subclassed or reimplemented. Each surface hands its coordinator a delegate that forwards to
// the driver and records every transaction the driver serves.
//
// The driver reads time through setClockNow. The clock here is the host's frame time in
// milliseconds, the timestamp the frame callbacks and RN's Native Animated receive, so
// that an animation's start, every frame and its end are read on the same clock. The
// runtime hands it over once per pump; it never goes backwards.
class LayoutAnimation {
 public:
  // The most recent pulls kept in snapshot(). A probe that reads the status once per
  // Godot frame sees every pull; pullsTotal and pullsDropped say if one was missed.
  static constexpr std::size_t max_pulls = 64;

  // descriptors is the registry the driver reads the components of the views it
  // animates from; executor is the application's JS executor, wrapped to count what the
  // driver queues on it (its callbacks).
  static std::unique_ptr<LayoutAnimation> attach(const std::shared_ptr<facebook::react::UIManager> &ui,
      const facebook::react::SharedComponentDescriptorRegistry &descriptors, facebook::react::RuntimeExecutor executor,
      const std::shared_ptr<facebook::react::ContextContainer> &context);
  ~LayoutAnimation();
  // As RCTScheduler.mm and FabricUIManagerBinding.cpp do for every surface they start:
  // the surface's mounting coordinator lets the driver override the transactions it pulls
  // (through a delegate that forwards to the driver and records what it served).
  void register_surface(const facebook::react::ShadowTree &tree);
  // The surface is gone. The driver is told to drop its animations by the UIManager; this
  // ends the host's own interest (the frame ticks) when no surface is left, because
  // RN does not signal the animations it drops for a stopped surface.
  void surface_stopped(int surface_id);
  // Whether RN's driver has an animation in flight, by the driver's own signals
  // (LayoutAnimationStatusDelegate, as the observer of the iOS run loop is switched), and
  // the application is not stopped. The host's frame clock ticks for it only then.
  bool active() const;
  // Hands the driver the host's frame time for the pulls that follow, until the next
  // call. A commit that pulls between two ticks reads this, so an animation that starts
  // there starts at the time of its own pump.
  void clock(double frame_ms);
  // One animation frame at the frame clock's tick: the clock, then RN's animationTick()
  // (the transactions it pulls reach the runtime's uiManagerDidFinishTransaction).
  void tick(double frame_ms);
  // No more frames or callbacks: the driver is detached from the UIManager and destroyed,
  // which drops the JS callbacks it holds. The runtime calls it while the JS runtime lives.
  void stop();
  folly::dynamic snapshot() const;

 private:
  struct State;
  explicit LayoutAnimation(std::shared_ptr<State> state);
  std::shared_ptr<State> state_;
};
}
