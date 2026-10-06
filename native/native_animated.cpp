#include "native_animated.h"
#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/featureflags/ReactNativeFeatureFlagsDefaults.h>
#include <react/renderer/animationbackend/AnimationBackend.h>
#include <react/renderer/animationbackend/AnimationChoreographer.h>
#include <react/renderer/uimanager/UIManager.h>
#include <exception>
#include <mutex>

namespace rn = facebook::react;

namespace fabric_godot {
namespace {
// RN 0.87.1's defaults plus the two flags RN's own OSS channels turn on for
// C++ Animated: cxxNativeAnimatedEnabled (canary) and useSharedAnimatedBackend
// (experimental). Every other flag keeps its default.
class GodotFeatureFlags final : public rn::ReactNativeFeatureFlagsDefaults {
 public:
  // RN's C++ AnimatedModule instead of an ObjC/Java one. JS reads this through
  // NativeReactNativeFeatureFlagsCxx: NativeAnimatedHelper then signals each
  // operation batch and the C++ backend owns the view sync.
  bool cxxNativeAnimatedEnabled() override { return true; }
  // The shared AnimationBackend. Its NativeAnimatedNodesManagerProvider path is
  // the one that never casts the UIManager delegate to RN's Scheduler, which
  // this host does not use, and it commits through the UIManager directly.
  bool useSharedAnimatedBackend() override { return true; }
};
}

std::string configure_react_native_feature_flags() {
  static std::once_flag once;
  static std::string error;
  std::call_once(once, [] {
    try {
      rn::ReactNativeFeatureFlags::override(std::make_unique<GodotFeatureFlags>());
    } catch (const std::exception &failure) {
      error = std::string("E_FEATURE_FLAGS: ") + failure.what();
    }
  });
  return error;
}

// The backend's frame source. resume() and pause() come from the backend as its
// first animation starts and its last one ends; frame() is what the frame clock's
// tick calls. The backend's own now() stamps the updates it pushes between frames
// (event-driven animations), so it reads the host's monotonic clock: RN's default,
// HighResTimeStamp, is another clock on some platforms.
class NativeAnimated::Choreographer final : public rn::AnimationChoreographer {
 public:
  explicit Choreographer(std::function<double()> now) : clock_(std::move(now)) {}
  void resume() override {
    active_ = true;
    ++resumes_;
  }
  void pause() override {
    active_ = false;
    ++pauses_;
  }
  rn::AnimationTimestamp now() const override { return rn::AnimationTimestamp(clock_()); }
  bool active() const { return active_ && !stopped_; }
  void frame(double timestamp_ms) {
    if (!active_ || stopped_) {
      return;
    }
    ++frames_;
    last_frame_ms_ = timestamp_ms;
    onAnimationFrame(rn::AnimationTimestamp(timestamp_ms));
  }
  void stop() { stopped_ = true; }
  // The clock's reading is live, so a stopped application, which must report one
  // state however often it is asked, leaves it out.
  folly::dynamic snapshot() const {
    folly::dynamic result = folly::dynamic::object("active", active_ && !stopped_)("stopped", stopped_)("frames", frames_)
        ("resumes", resumes_)("pauses", pauses_)("lastFrameMs", last_frame_ms_);
    if (!stopped_) {
      result["nowMs"] = clock_();
    }
    return result;
  }

 private:
  std::function<double()> clock_;
  bool active_{}, stopped_{};
  uint64_t frames_{}, resumes_{}, pauses_{};
  double last_frame_ms_{};
};

NativeAnimated::NativeAnimated(std::shared_ptr<Choreographer> choreographer) : choreographer_(std::move(choreographer)) {}
NativeAnimated::~NativeAnimated() = default;

std::unique_ptr<NativeAnimated> NativeAnimated::attach(const std::shared_ptr<rn::UIManager> &ui,
    std::function<double()> now) {
  if (!rn::ReactNativeFeatureFlags::cxxNativeAnimatedEnabled() || !rn::ReactNativeFeatureFlags::useSharedAnimatedBackend()) {
    return nullptr;
  }
  // As RN's Scheduler does with useSharedAnimatedBackend: one backend per
  // UIManager, owned by it, before any JS looks the module up.
  auto choreographer = std::make_shared<Choreographer>(std::move(now));
  auto backend = std::make_shared<rn::AnimationBackend>(choreographer, ui);
  choreographer->setAnimationBackend(backend);
  ui->unstable_setAnimationBackend(backend);
  return std::unique_ptr<NativeAnimated>(new NativeAnimated(std::move(choreographer)));
}

bool NativeAnimated::active() const { return choreographer_->active(); }
void NativeAnimated::frame(double timestamp_ms) { choreographer_->frame(timestamp_ms); }
void NativeAnimated::stop() { choreographer_->stop(); }
void NativeAnimated::update_applied() { ++applied_; }
void NativeAnimated::update_dropped() { ++dropped_; }

folly::dynamic NativeAnimated::snapshot() const {
  auto result = choreographer_->snapshot();
  result["enabled"] = true;
  result["directUpdates"] = applied_;
  result["staleDirectUpdates"] = dropped_;
  return result;
}
}
