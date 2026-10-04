#pragma once
#include <react/nativemodule/dom/NativeDOM.h>
#include <react/renderer/dom/DOM.h>
#include <functional>

namespace fabric_godot {
// Original Codegen NativeDOM supplies tree/layout and capture behavior. The
// host adds window projection and retires authority with its native roots.
class GodotDOM final : public facebook::react::NativeDOM {
 public:
  using Project = std::function<facebook::react::dom::DOMRect(
      facebook::react::SurfaceId, facebook::react::dom::DOMRect, bool)>;
  using Authority = std::function<bool(const facebook::react::ShadowNode &)>;
  GodotDOM(std::shared_ptr<facebook::react::CallInvoker> invoker, Project project, Authority authority);
 private:
  Project project_;
  Authority authority_;
  static facebook::jsi::Value has_capture(facebook::jsi::Runtime &,
      facebook::react::TurboModule &, const facebook::jsi::Value *, size_t);
  static facebook::jsi::Value set_capture(facebook::jsi::Runtime &,
      facebook::react::TurboModule &, const facebook::jsi::Value *, size_t);
  static facebook::jsi::Value release_capture(facebook::jsi::Runtime &,
      facebook::react::TurboModule &, const facebook::jsi::Value *, size_t);
  static facebook::jsi::Value capture(facebook::jsi::Runtime &,
      facebook::react::TurboModule &, const facebook::jsi::Value *, size_t, int);
  static facebook::jsi::Value compare_position(facebook::jsi::Runtime &,
      facebook::react::TurboModule &, const facebook::jsi::Value *, size_t);
  static facebook::jsi::Value bounding_rect(facebook::jsi::Runtime &,
      facebook::react::TurboModule &, const facebook::jsi::Value *, size_t);
  static facebook::jsi::Value measure_window(facebook::jsi::Runtime &,
      facebook::react::TurboModule &, const facebook::jsi::Value *, size_t);
};
}
