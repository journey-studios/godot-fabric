#pragma once

#include <ReactCommon/TurboModule.h>
#include <folly/dynamic.h>
#include <react/renderer/runtimescheduler/RuntimeScheduler.h>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>

namespace fabric_godot {
// The platform owns providers and lifetime. The JSI binding, TurboModule
// HostObjects, property cache, promises and typed event emitters remain RN's.
// All methods run on the application's JS/main thread, before VM destruction.
class TurboModuleRegistry {
 public:
  using Factory = std::function<std::shared_ptr<facebook::react::TurboModule>(
      facebook::jsi::Runtime &, const std::shared_ptr<facebook::react::CallInvoker> &)>;
  using Dispose = std::function<void()>;

  TurboModuleRegistry(uint64_t runtime_id,
      const std::shared_ptr<facebook::react::RuntimeScheduler> &scheduler);
  ~TurboModuleRegistry();
  void add(const std::string &name, Factory factory, Dispose dispose = {});
  // The getter resolves the application's actual evaluated bundle URL. It is
  // called on the JS thread and invalidated before host/runtime destruction.
  void add_source_code(std::function<std::string()> script_url);
  // Returns original DeviceInfo constants from real host window/screen metrics.
  // Physical pixel metrics follow RN's schema, including densityDpi.
  void add_device_info(std::function<folly::dynamic()> constants);
  void add_feature_flags();
  void add_fixture();
  void install(facebook::jsi::Runtime &runtime);
  // Queues a call through RN's scheduler. Arguments are copied DTOs; no JS
  // function or object is retained by the native caller.
  void invoke_callable(const std::string &name, const std::string &method,
      folly::dynamic arguments = folly::dynamic::array());
  void stop(facebook::jsi::Runtime &runtime);
  folly::dynamic snapshot() const;

 private:
  struct State;
  std::shared_ptr<State> state_;
};
}
