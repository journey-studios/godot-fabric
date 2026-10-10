#pragma once
#include <ReactCommon/TurboModule.h>
#include <folly/dynamic.h>
#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/array.hpp>
#include <godot_cpp/variant/callable.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/signal.hpp>
#include <functional>
#include <memory>
#include <string>

namespace fabric_godot { class GameServiceRegistry; }

// An explicit registration owner. Releasing the Ref does not implicitly
// revoke the registration; remove() and application shutdown do.
class GodotFabricBinding : public godot::RefCounted {
  GDCLASS(GodotFabricBinding, godot::RefCounted)
 public:
  void remove();
  void initialize(std::weak_ptr<fabric_godot::GameServiceRegistry> registry,
      std::string origin, std::string name, uint64_t generation);
 protected:
  static void _bind_methods();
 private:
  std::weak_ptr<fabric_godot::GameServiceRegistry> registry;
  std::string origin, name;
  uint64_t generation{};
};

namespace fabric_godot {
// Main-thread host boundary. Registration/signal ingestion copy strict DTOs;
// only pump_host(), on a Godot process frame outside JS, invokes Callables.
class GameServiceRegistry : public std::enable_shared_from_this<GameServiceRegistry> {
 public:
  using Resolve = std::function<void(folly::dynamic)>;
  using Reject = std::function<void(std::string)>;
  GameServiceRegistry();
  ~GameServiceRegistry();
  godot::Ref<GodotFabricBinding> bind_signal(const godot::String &name,
      const godot::Signal &signal, const godot::Array &args, const godot::Dictionary &options);
  godot::Ref<GodotFabricBinding> bind_state(const godot::String &name,
      const godot::Callable &getter, const godot::Signal &changed,
      const godot::Variant &schema, const godot::Dictionary &options);
  godot::Ref<GodotFabricBinding> register_method(const godot::String &name,
      const godot::Callable &callable, const godot::Array &args,
      const godot::Variant &result, const godot::Dictionary &options);
  std::shared_ptr<facebook::react::TurboModule> create_module(
      const std::shared_ptr<facebook::react::CallInvoker> &invoker);
  void remove_binding(const std::string &origin, const std::string &name, uint64_t generation);
  uint64_t reserve();
  void connect(uint64_t id, folly::dynamic address, bool initial, Resolve resolve, Reject reject);
  void remove(uint64_t id);
  void call(folly::dynamic address, folly::dynamic args, Resolve resolve, Reject reject);
  void pump_host(size_t task_budget = 64, size_t event_budget = 128);
  void stop();
  bool active() const;
  // What the binding of the default origin with this name has ingested and handed to the JavaScript runtime: {bound, emitted, sent, delivered}. `sent`
  // counts distinct revisions (one emission reaching several subscriptions is one) and `delivered` is the revision of the last value a subscription
  // got. A read of counters, with no JSON and no JavaScript.
  godot::Dictionary delivery(const godot::String &name) const;
  folly::dynamic snapshot() const;
 private:
  struct State;
  std::shared_ptr<State> state;
};
}
