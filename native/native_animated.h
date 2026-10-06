#pragma once
#include <folly/dynamic.h>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>

namespace facebook::react {
class UIManager;
}

namespace fabric_godot {
// Sets RN's process-wide feature flags before any runtime reads one, as RN's
// app factories do at startup. Returns an error message, or an empty string.
std::string configure_react_native_feature_flags();

// One application's RN Native Animated. RN's own C++ backend (the AnimationBackend
// its Scheduler creates with useSharedAnimatedBackend) is attached to the
// application's UIManager, and the application's Godot frame tick is its
// choreographer, like RCTAnimationChoreographer over CADisplayLink. The module
// that talks to it is RN's AnimatedModule; the runtime applies the backend's
// direct prop updates to its Controls and reports each one here.
class NativeAnimated {
 public:
  // Null unless both of RN's flags are on. now is the host's frame clock, in
  // milliseconds: the base of every timestamp frame() receives and of the
  // backend's own now() for the updates it pushes between frames.
  static std::unique_ptr<NativeAnimated> attach(const std::shared_ptr<facebook::react::UIManager> &ui,
      std::function<double()> now);
  ~NativeAnimated();
  // At most one animation frame per Godot frame, and none while the backend
  // has no animation to run or after stop().
  void frame(double timestamp_ms);
  void stop();
  void update_applied();
  // An update for a view that is gone is dropped, as RCTMountingManager does.
  void update_dropped();
  folly::dynamic snapshot() const;

 private:
  class Choreographer;
  explicit NativeAnimated(std::shared_ptr<Choreographer> choreographer);
  std::shared_ptr<Choreographer> choreographer_;
  uint64_t applied_{}, dropped_{};
};
}
