#pragma once
#include <react/nativemodule/dom/NativeDOM.h>
#include <react/renderer/dom/DOM.h>
#include <functional>

namespace fabric_godot {
// All tree, layout, props and pointer APIs come from the original Codegen
// NativeDOM module. Only the host's embedding into Godot window space differs.
class GodotDOM final : public facebook::react::NativeDOM {
 public:
  using Project = std::function<facebook::react::dom::DOMRect(
      facebook::react::SurfaceId, facebook::react::dom::DOMRect, bool)>;
  GodotDOM(std::shared_ptr<facebook::react::CallInvoker> invoker, Project project);
 private:
  Project project_;
  static facebook::jsi::Value compare_position(facebook::jsi::Runtime &,
      facebook::react::TurboModule &, const facebook::jsi::Value *, size_t);
  static facebook::jsi::Value bounding_rect(facebook::jsi::Runtime &,
      facebook::react::TurboModule &, const facebook::jsi::Value *, size_t);
  static facebook::jsi::Value measure_window(facebook::jsi::Runtime &,
      facebook::react::TurboModule &, const facebook::jsi::Value *, size_t);
};
}
