#include "game_service_registry.h"
#include <jsi/JSIDynamic.h>
#include <react/bridging/EventEmitter.h>
#include <react/bridging/Dynamic.h>
#include <react/bridging/Promise.h>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/core/object.hpp>
#include <godot_cpp/variant/callable_custom.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <algorithm>
#include <cmath>
#include <deque>
#include <map>
#include <optional>
#include <stdexcept>
#include <vector>

namespace rn = facebook::react;
namespace jsi = facebook::jsi;
using namespace godot;
namespace fabric_godot {
namespace {
constexpr uint64_t safe_integer = 9007199254740991ULL;
constexpr size_t dto_depth = 32, dto_nodes = 10000;
std::string utf8(const String &value) {
  const auto bytes = value.utf8();
  return std::string(bytes.get_data(), bytes.length());
}
String gd(const std::string &value) { return String::utf8(value.data(), value.size()); }
[[noreturn]] void error(const char *code, const std::string &message) {
  throw std::runtime_error(std::string(code) + ": " + message);
}
std::string error_code(const std::string &message) {
  const auto end = message.find(':');
  return end == std::string::npos ? "E_SERVICE_HOST" : message.substr(0, end);
}
void number(double value) {
  if (!std::isfinite(value) || (std::floor(value) == value && std::abs(value) > safe_integer))
    error("E_SERVICE_DTO_NUMBER", "DTO numbers must be finite; integers must be safe");
}
struct VariantDTO {
  std::vector<Variant> ancestors;
  size_t nodes{};
  folly::dynamic copy(const Variant &value, size_t depth = 0) {
    if (depth > dto_depth || ++nodes > dto_nodes) error("E_SERVICE_DTO_LIMIT", "DTO depth/node limit exceeded");
    switch (value.get_type()) {
      case Variant::NIL: return nullptr;
      case Variant::BOOL: return static_cast<bool>(value);
      case Variant::INT: {
        const auto result = static_cast<int64_t>(value);
        if (result < -static_cast<int64_t>(safe_integer) || result > static_cast<int64_t>(safe_integer))
          error("E_SERVICE_DTO_NUMBER", "Godot integer exceeds JSON safe range");
        return result;
      }
      case Variant::FLOAT: { const double result = value; number(result); return result; }
      case Variant::STRING: return utf8(value);
      case Variant::ARRAY:
      case Variant::DICTIONARY: break;
      default: error("E_SERVICE_DTO_TYPE", "Only null, bool, numbers, String, Array and Dictionary are DTOs");
    }
    for (const auto &parent : ancestors)
      if (UtilityFunctions::is_same(parent, value)) error("E_SERVICE_DTO_CYCLE", "Cyclic DTO container");
    ancestors.push_back(value);
    auto result = value.get_type() == Variant::ARRAY ? folly::dynamic::array() : folly::dynamic::object();
    if (value.get_type() == Variant::ARRAY) {
      const Array array = value;
      for (int64_t index = 0; index < array.size(); ++index) result.push_back(copy(array[index], depth + 1));
    } else {
      const Dictionary dictionary = value;
      const Array keys = dictionary.keys();
      for (int64_t index = 0; index < keys.size(); ++index) {
        if (keys[index].get_type() != Variant::STRING) error("E_SERVICE_DTO_KEY", "DTO object keys must be Strings");
        result[utf8(keys[index])] = copy(dictionary[keys[index]], depth + 1);
      }
    }
    ancestors.pop_back();
    return result;
  }
};
struct JSDTO {
  jsi::Runtime &runtime;
  std::vector<jsi::Object> ancestors;
  size_t nodes{};
  folly::dynamic copy(const jsi::Value &value, size_t depth = 0) {
    if (depth > dto_depth || ++nodes > dto_nodes) error("E_SERVICE_DTO_LIMIT", "DTO depth/node limit exceeded");
    if (value.isNull()) return nullptr;
    if (value.isBool()) return value.getBool();
    if (value.isNumber()) {
      const auto result = value.asNumber(); number(result);
      return std::floor(result) == result ? folly::dynamic(static_cast<int64_t>(result)) : folly::dynamic(result);
    }
    if (value.isString()) return value.asString(runtime).utf8(runtime);
    if (!value.isObject()) error("E_SERVICE_DTO_TYPE", "Only JSON values are DTOs");
    auto object = value.asObject(runtime);
    if (object.isFunction(runtime) || object.isHostObject(runtime)) error("E_SERVICE_DTO_TYPE", "Functions/host objects are not DTOs");
    for (const auto &parent : ancestors)
      if (jsi::Value::strictEquals(runtime, value, jsi::Value(runtime, parent)))
        error("E_SERVICE_DTO_CYCLE", "Cyclic DTO container");
    ancestors.emplace_back(jsi::Value(runtime, object).asObject(runtime));
    auto result = object.isArray(runtime) ? folly::dynamic::array() : folly::dynamic::object();
    if (object.isArray(runtime)) {
      auto array = object.asArray(runtime);
      for (size_t index = 0; index < array.size(runtime); ++index)
        result.push_back(copy(array.getValueAtIndex(runtime, index), depth + 1));
    } else {
      auto objectClass = runtime.global().getPropertyAsObject(runtime, "Object");
      const auto prototype = objectClass.getPropertyAsFunction(runtime, "getPrototypeOf").call(runtime, object);
      if (!prototype.isNull() && !jsi::Value::strictEquals(runtime, prototype, objectClass.getProperty(runtime, "prototype")))
        error("E_SERVICE_DTO_TYPE", "DTO objects must have Object.prototype or null prototype");
      const auto symbols = objectClass.getPropertyAsFunction(runtime, "getOwnPropertySymbols").call(runtime, object).asObject(runtime).asArray(runtime);
      if (symbols.size(runtime)) error("E_SERVICE_DTO_KEY", "Symbol DTO keys are unsupported");
      // JSI getPropertyNames includes the prototype chain; JSON objects only
      // transport their own enumerable fields, matching the public DTO copier.
      const auto names = objectClass.getPropertyAsFunction(runtime, "keys").call(runtime, object).asObject(runtime).asArray(runtime);
      for (size_t index = 0; index < names.size(runtime); ++index) {
        const auto name = names.getValueAtIndex(runtime, index).asString(runtime);
        result[name.utf8(runtime)] = copy(object.getProperty(runtime, name), depth + 1);
      }
    }
    ancestors.pop_back();
    return result;
  }
};
Variant variant(const folly::dynamic &value) {
  if (value.isNull()) return Variant();
  if (value.isBool()) return value.asBool();
  if (value.isInt()) return value.asInt();
  if (value.isDouble()) return value.asDouble();
  if (value.isString()) return gd(value.asString());
  if (value.isArray()) {
    Array array;
    for (const auto &item : value) array.push_back(variant(item));
    return array;
  }
  Dictionary dictionary;
  for (const auto &item : value.items()) dictionary[gd(item.first.asString())] = variant(item.second);
  return dictionary;
}
void check_schema(const folly::dynamic &schema, size_t depth = 0) {
  if (depth > dto_depth) error("E_SERVICE_SCHEMA", "Schema depth exceeds limit");
  if (schema.isString()) {
    const auto type = schema.asString();
    if (type == "null" || type == "boolean" || type == "number" || type == "integer" || type == "string") return;
  } else if (schema.isObject() && schema.size() == 1) {
    if (auto element = schema.get_ptr("array")) { check_schema(*element, depth + 1); return; }
    if (auto fields = schema.get_ptr("object"); fields && fields->isObject()) {
      for (const auto &field : fields->items()) check_schema(field.second, depth + 1);
      return;
    }
  }
  error("E_SERVICE_SCHEMA", "Schema must be a JSON scalar type, {array:schema}, or {object:{field:schema}}");
}
void validate(const folly::dynamic &value, const folly::dynamic &schema) {
  bool valid = false;
  if (schema.isString()) {
    const auto type = schema.asString();
    valid = (type == "null" && value.isNull()) || (type == "boolean" && value.isBool()) ||
        (type == "number" && value.isNumber()) || (type == "string" && value.isString()) ||
        (type == "integer" && value.isNumber() && std::floor(value.asDouble()) == value.asDouble());
  } else if (auto element = schema.get_ptr("array")) {
    valid = value.isArray();
    if (valid) for (const auto &item : value) validate(item, *element);
  } else {
    const auto &fields = schema.at("object");
    valid = value.isObject() && value.size() == fields.size();
    if (valid) for (const auto &field : fields.items()) {
      const auto item = value.get_ptr(field.first);
      if (!item) { valid = false; break; }
      validate(*item, field.second);
    }
  }
  if (!valid) error("E_SERVICE_SCHEMA", "DTO does not match the exact declared schema");
}
folly::dynamic schemas(const Array &args) {
  auto result = VariantDTO{}.copy(args);
  for (const auto &schema : result) check_schema(schema);
  return result;
}
void validate_args(const folly::dynamic &args, const folly::dynamic &schema) {
  if (!args.isArray() || args.size() != schema.size()) error("E_SERVICE_SCHEMA", "Argument count differs from schema");
  for (size_t index = 0; index < args.size(); ++index) validate(args[index], schema[index]);
}
using Key = std::pair<std::string, std::string>; // origin, name
Key address(const folly::dynamic &value) {
  if (!value.isObject() || value.size() != 2 || !value.get_ptr("name") || !value.get_ptr("origin") ||
      !value["name"].isString() || !value["origin"].isString() || value["name"].asString().empty() || value["origin"].asString().empty())
    error("E_SERVICE_ADDRESS", "Address requires nonempty origin/name strings and no other fields");
  return {value["origin"].asString(), value["name"].asString()};
}
bool owner_live(uint64_t id) {
  const auto *object = id ? ObjectDB::get_instance(ObjectID(id)) : nullptr;
  return object && !object->is_queued_for_deletion();
}
struct Registration {
  Key key;
  std::string response{"completion"};
};
Registration options(const String &name, const Dictionary &values, bool method) {
  const auto data = VariantDTO{}.copy(values);
  Registration result{{"default", utf8(name)}};
  if (result.key.second.empty()) error("E_SERVICE_ADDRESS", "Service name must not be empty");
  for (const auto &item : data.items()) {
    if (item.first == "origin" && item.second.isString() && !item.second.asString().empty()) result.key.first = item.second.asString();
    else if (method && item.first == "response" && item.second.isString() &&
        (item.second == "completion" || item.second == "acceptance")) result.response = item.second.asString();
    else error("E_SERVICE_OPTIONS", "Unsupported registration option/value");
  }
  return result;
}
Variant invoke(const Callable &callable, const folly::dynamic &args) {
  std::vector<Variant> values;
  std::vector<const Variant *> pointers;
  for (const auto &arg : args) values.push_back(variant(arg));
  for (const auto &value : values) pointers.push_back(&value);
  Variant target = callable, result;
  GDExtensionCallError failure{};
  target.callp("call", pointers.data(), pointers.size(), result, failure);
  if (failure.error != GDEXTENSION_CALL_OK) error("E_SERVICE_CALLBACK", "Godot Callable rejected the invocation");
  return result;
}
void signal_schema(const Signal &signal, size_t count) {
  if (!owner_live(signal.get_object_id()) || !signal.get_object()->has_signal(signal.get_name()))
    error("E_SERVICE_OWNER", "Signal owner or declared signal is invalid");
  for (const Dictionary declaration : signal.get_object()->get_signal_list()) {
    if (StringName(declaration["name"]) == signal.get_name()) {
      const Array args = declaration["args"];
      if (static_cast<size_t>(args.size()) != count) error("E_SERVICE_SCHEMA", "Signal declaration/schema argument count differs");
      return;
    }
  }
  error("E_SERVICE_OWNER", "Signal declaration is unavailable");
}
class SignalReceiver final : public CallableCustom {
 public:
  explicit SignalReceiver(std::function<void(const Variant **, int)> receive) : receive(std::move(receive)) {}
  uint32_t hash() const override { return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(this)); }
  String get_as_text() const override { return "GodotFabric service signal receiver"; }
  CompareEqualFunc get_compare_equal_func() const override { return [](const CallableCustom *a, const CallableCustom *b) { return a == b; }; }
  CompareLessFunc get_compare_less_func() const override { return [](const CallableCustom *a, const CallableCustom *b) { return std::less<const CallableCustom *>{}(a, b); }; }
  ObjectID get_object() const override { return ObjectID(); }
  bool is_valid() const override { return true; }
  void call(const Variant **args, int count, Variant &result, GDExtensionCallError &failure) const override {
    failure.error = GDEXTENSION_CALL_OK;
    result = Variant();
    receive(args, count);
  }
 private:
  std::function<void(const Variant **, int)> receive;
};
struct Permit { uint64_t id{}, generation{}; bool closed{}; };
struct EventGate {
  std::optional<Permit> emitting;
  std::function<bool(const Permit &)> allowed;
};
class DeliveryInvoker final : public rn::CallInvoker {
 public:
  DeliveryInvoker(std::shared_ptr<rn::CallInvoker> delegate, std::shared_ptr<EventGate> gate)
      : delegate(std::move(delegate)), gate(std::move(gate)) {}
  void invokeAsync(rn::CallFunc &&function) noexcept override { delegate->invokeAsync(guard(std::move(function))); }
  void invokeAsync(rn::SchedulerPriority priority, rn::CallFunc &&function) noexcept override { delegate->invokeAsync(priority, guard(std::move(function))); }
  void invokeSync(rn::CallFunc &&function) override { delegate->invokeSync(guard(std::move(function))); }
 private:
  std::shared_ptr<rn::CallInvoker> delegate;
  std::shared_ptr<EventGate> gate;
  rn::CallFunc guard(rn::CallFunc &&function) const {
    const auto permit = gate->emitting;
    return [gate = gate, permit, function = std::move(function)](jsi::Runtime &rt) {
      // Subscription removal calls through the same invoker without an emit
      // permit; cleanup must remain harmless after lifetime invalidation.
      if (!permit || (gate->allowed && gate->allowed(*permit))) function(rt);
    };
  }
};
}

struct GameServiceRegistry::State : public std::enable_shared_from_this<GameServiceRegistry::State> {
  enum class Kind { Signal, State, Method };
  struct Binding {
    Registration registration;
    Kind kind;
    uint64_t generation{}, revision{}, signal_owner{}, callable_owner{};
    Signal signal;
    Callable receiver, callable;
    folly::dynamic args = folly::dynamic::array(), result = nullptr;
  };
  struct Subscription {
    bool connecting{}, ready{}, closed{};
    Key key;
    uint64_t generation{};
    std::deque<folly::dynamic> pending;
  };
  struct Task { std::function<void()> run; Reject cancel; };
  bool stopped{}, pumping{};
  uint64_t next_generation{1}, next_id{1};
  size_t tasks_run{}, tasks_canceled{}, events_sent{}, callbacks_run{};
  std::map<Key, std::shared_ptr<Binding>> bindings;
  std::map<uint64_t, Subscription> subscriptions;
  std::deque<Task> tasks;
  Reject running_cancel;
  std::deque<std::pair<Permit, folly::dynamic>> events;
  std::vector<std::string> errors;
  std::shared_ptr<rn::AsyncEventEmitter<folly::dynamic>> emitter = std::make_shared<rn::AsyncEventEmitter<folly::dynamic>>();
  std::shared_ptr<EventGate> gate = std::make_shared<EventGate>();

  bool live(const std::shared_ptr<Binding> &binding) const {
    const auto found = bindings.find(binding->registration.key);
    return !stopped && found != bindings.end() && found->second->generation == binding->generation &&
        (!binding->signal_owner || owner_live(binding->signal_owner)) &&
        (!binding->callable_owner || (owner_live(binding->callable_owner) && binding->callable.is_valid()));
  }
  std::shared_ptr<Binding> lookup(const Key &key, uint64_t generation = 0) {
    if (stopped) error("E_SERVICE_STOPPED", "Application game services stopped");
    auto found = bindings.find(key);
    if (found == bindings.end()) {
      if (generation) error("E_SERVICE_BINDING_REMOVED", "Binding removed before operation completed");
      error("E_SERVICE_MISSING", "No registration for " + key.first + "/" + key.second);
    }
    if (generation && found->second->generation != generation) error("E_SERVICE_GENERATION", "Binding generation changed before execution");
    if (!live(found->second)) error("E_SERVICE_OWNER", "Game service owner is no longer valid");
    return found->second;
  }
  folly::dynamic envelope(uint64_t id, const Binding &binding, folly::dynamic args) const {
    return folly::dynamic::object("subscriptionId", id)("origin", binding.registration.key.first)
        ("name", binding.registration.key.second)("generation", std::to_string(binding.generation))
        ("revision", binding.revision)("args", std::move(args));
  }
  void close(const Key &key, uint64_t generation, const std::string &message) {
    auto found = bindings.find(key);
    if (found == bindings.end() || found->second->generation != generation) return;
    auto binding = found->second;
    if (binding->signal_owner && owner_live(binding->signal_owner) && binding->signal.is_connected(binding->receiver))
      binding->signal.disconnect(binding->receiver);
    bindings.erase(found);
    for (auto &[id, subscription] : subscriptions) {
      if (subscription.key != key || subscription.generation != generation || subscription.closed) continue;
      subscription.closed = true;
      subscription.pending.clear();
      auto payload = envelope(id, *binding, folly::dynamic::array());
      payload["closed"] = true;
      payload["error"] = folly::dynamic::object("code", error_code(message))("message", message);
      events.emplace_back(Permit{id, generation, true}, std::move(payload));
    }
  }
  void receive(const Key &key, uint64_t generation, const Variant **values, int count) {
    try {
      auto binding = lookup(key, generation);
      VariantDTO copier;
      auto args = folly::dynamic::array();
      for (int index = 0; index < count; ++index) args.push_back(copier.copy(*values[index]));
      if (binding->kind == Kind::State) {
        if (count != 1) error("E_SERVICE_SCHEMA", "State changed signal requires exactly one DTO value");
        validate(args[0], binding->result);
      } else validate_args(args, binding->args);
      if (binding->revision >= safe_integer) error("E_SERVICE_REVISION", "Revision exhausted JSON safe range");
      ++binding->revision;
      for (auto &[id, subscription] : subscriptions) {
        if (subscription.key != key || subscription.generation != generation || subscription.closed) continue;
        auto payload = envelope(id, *binding, args);
        if (binding->kind == Kind::State) payload["value"] = args[0];
        if (!subscription.ready) subscription.pending.push_back(std::move(payload));
        else events.emplace_back(Permit{id, generation, false}, std::move(payload));
      }
    } catch (const std::exception &failure) {
      errors.push_back(failure.what());
      close(key, generation, failure.what());
    }
  }
  Ref<GodotFabricBinding> add(GameServiceRegistry &registry, std::shared_ptr<Binding> binding) {
    if (stopped) error("E_SERVICE_STOPPED", "Cannot register with stopped game services");
    const auto key = binding->registration.key;
    if (bindings.contains(key)) error("E_SERVICE_COLLISION", "Origin/name is already registered");
    if (next_generation > safe_integer) error("E_SERVICE_GENERATION", "Registration generation exhausted");
    binding->generation = next_generation++;
    if (binding->kind != Kind::Method) {
      std::weak_ptr<State> owner = shared_from_this();
      binding->receiver = Callable(memnew(SignalReceiver([owner, key, generation = binding->generation](const Variant **args, int count) {
        if (auto state = owner.lock(); state && !state->stopped) state->receive(key, generation, args, count);
      })));
      if (binding->signal.connect(binding->receiver) != OK) error("E_SERVICE_SIGNAL", "Failed to connect declared signal");
    }
    bindings.emplace(key, binding);
    Ref<GodotFabricBinding> token;
    token.instantiate();
    token->initialize(registry.weak_from_this(), key.first, key.second, binding->generation);
    return token;
  }
};

class NativeGameServices final : public rn::TurboModule {
 public:
  NativeGameServices(const std::shared_ptr<rn::CallInvoker> &invoker,
      std::shared_ptr<GameServiceRegistry> registry,
      std::shared_ptr<rn::AsyncEventEmitter<folly::dynamic>> emitter, std::shared_ptr<EventGate> gate)
      : rn::TurboModule("GodotFabricServices", invoker), registry(std::move(registry)),
        event_invoker(std::make_shared<DeliveryInvoker>(invoker, std::move(gate))), emitter(std::move(emitter)) {
    methodMap_["reserve"] = {0, reserve};
    methodMap_["connect"] = {3, connect};
    methodMap_["remove"] = {1, remove};
    methodMap_["call"] = {2, call};
    eventEmitterMap_["onEvent"] = this->emitter;
  }
 private:
  std::shared_ptr<GameServiceRegistry> registry;
  std::shared_ptr<rn::CallInvoker> event_invoker;
  std::shared_ptr<rn::AsyncEventEmitter<folly::dynamic>> emitter;
  static NativeGameServices &self(rn::TurboModule &module) { return static_cast<NativeGameServices &>(module); }
  static NativeGameServices &live(jsi::Runtime &rt, rn::TurboModule &module) {
    auto &native = self(module);
    if (!native.registry->active()) throw jsi::JSError(rt, "E_RUNTIME_STOPPED: Game service runtime stopped");
    return native;
  }
  static uint64_t id(jsi::Runtime &rt, const jsi::Value &value) {
    if (!value.isNumber() || !std::isfinite(value.asNumber()) || value.asNumber() <= 0 ||
        value.asNumber() > safe_integer || std::floor(value.asNumber()) != value.asNumber())
      throw jsi::JSError(rt, "E_SERVICE_SUBSCRIPTION: Subscription ID must be a positive safe integer");
    return static_cast<uint64_t>(value.asNumber());
  }
  jsi::Value create(jsi::Runtime &rt, const jsi::PropNameID &name) override {
    if (name.utf8(rt) != "onEvent") return rn::TurboModule::create(rt, name);
    return jsi::Function::createFromHostFunction(rt, name, 1,
        [owner = registry, emitter = emitter, invoker = event_invoker](jsi::Runtime &runtime, const jsi::Value &, const jsi::Value *args, size_t count) {
          if (!owner->active()) throw jsi::JSError(runtime, "E_RUNTIME_STOPPED: Cannot subscribe after shutdown");
          return emitter->get(runtime, invoker).asFunction(runtime).call(runtime, args, count);
        });
  }
  static jsi::Value reserve(jsi::Runtime &rt, rn::TurboModule &module, const jsi::Value *, size_t count) {
    auto &native = live(rt, module);
    try {
      if (count) error("E_SERVICE_ARGUMENT", "reserve takes no arguments");
      return jsi::Value(static_cast<double>(native.registry->reserve()));
    } catch (const std::exception &failure) { throw jsi::JSError(rt, failure.what()); }
  }
  static jsi::Value remove(jsi::Runtime &rt, rn::TurboModule &module, const jsi::Value *args, size_t count) {
    if (count != 1) throw jsi::JSError(rt, "E_SERVICE_ARGUMENT: remove requires one subscription ID");
    self(module).registry->remove(id(rt, args[0]));
    return jsi::Value::undefined();
  }
  static jsi::Value connect(jsi::Runtime &rt, rn::TurboModule &module, const jsi::Value *args, size_t count) {
    auto &native = live(rt, module);
    rn::AsyncPromise<folly::dynamic> promise(rt, native.jsInvoker_);
    try {
      if (count != 3 || !args[2].isBool()) error("E_SERVICE_ARGUMENT", "connect requires id, address, initial:boolean");
      const auto subscription = id(rt, args[0]);
      auto target = JSDTO{rt}.copy(args[1]);
      native.registry->connect(subscription, std::move(target), args[2].getBool(),
          [promise](folly::dynamic value) mutable { promise.resolve(std::move(value)); },
          [promise](std::string message) mutable { promise.reject(std::move(message)); });
    } catch (const std::exception &failure) { promise.reject(failure.what()); }
    return promise.get(rt);
  }
  static jsi::Value call(jsi::Runtime &rt, rn::TurboModule &module, const jsi::Value *args, size_t count) {
    auto &native = live(rt, module);
    rn::AsyncPromise<folly::dynamic> promise(rt, native.jsInvoker_);
    try {
      if (count != 2) error("E_SERVICE_ARGUMENT", "call requires address and DTO arguments");
      auto target = JSDTO{rt}.copy(args[0]);
      auto values = JSDTO{rt}.copy(args[1]);
      native.registry->call(std::move(target), std::move(values),
          [promise](folly::dynamic value) mutable { promise.resolve(std::move(value)); },
          [promise](std::string message) mutable { promise.reject(std::move(message)); });
    } catch (const std::exception &failure) { promise.reject(failure.what()); }
    return promise.get(rt);
  }
};

GameServiceRegistry::GameServiceRegistry() : state(std::make_shared<State>()) {
  std::weak_ptr<State> owner = state;
  state->gate->allowed = [owner](const Permit &permit) {
    auto state = owner.lock();
    if (!state || state->stopped) return false;
    auto found = state->subscriptions.find(permit.id);
    if (found == state->subscriptions.end() || found->second.generation != permit.generation) return false;
    if (permit.closed) return found->second.closed;
    if (!found->second.ready || found->second.closed) return false;
    auto binding = state->bindings.find(found->second.key);
    return binding != state->bindings.end() && state->live(binding->second);
  };
}
GameServiceRegistry::~GameServiceRegistry() { stop(); }
Ref<GodotFabricBinding> GameServiceRegistry::bind_signal(const String &name, const Signal &signal,
    const Array &args, const Dictionary &values) {
  auto binding = std::make_shared<State::Binding>();
  binding->registration = options(name, values, false);
  binding->kind = State::Kind::Signal;
  binding->args = schemas(args);
  signal_schema(signal, binding->args.size());
  binding->signal = signal;
  binding->signal_owner = signal.get_object_id();
  return state->add(*this, std::move(binding));
}
Ref<GodotFabricBinding> GameServiceRegistry::bind_state(const String &name, const Callable &getter,
    const Signal &changed, const Variant &schema, const Dictionary &values) {
  auto binding = std::make_shared<State::Binding>();
  binding->registration = options(name, values, false);
  binding->kind = State::Kind::State;
  binding->result = VariantDTO{}.copy(schema);
  check_schema(binding->result);
  signal_schema(changed, 1);
  if (!owner_live(getter.get_object_id()) || !getter.is_valid()) error("E_SERVICE_OWNER", "State getter owner is invalid");
  binding->signal = changed;
  binding->signal_owner = changed.get_object_id();
  binding->callable = getter;
  binding->callable_owner = getter.get_object_id();
  return state->add(*this, std::move(binding));
}
Ref<GodotFabricBinding> GameServiceRegistry::register_method(const String &name, const Callable &callable,
    const Array &args, const Variant &result, const Dictionary &values) {
  auto binding = std::make_shared<State::Binding>();
  binding->registration = options(name, values, true);
  binding->kind = State::Kind::Method;
  binding->args = schemas(args);
  binding->result = VariantDTO{}.copy(result);
  check_schema(binding->result);
  if (!owner_live(callable.get_object_id()) || !callable.is_valid()) error("E_SERVICE_OWNER", "Method Callable owner is invalid");
  binding->callable = callable;
  binding->callable_owner = callable.get_object_id();
  return state->add(*this, std::move(binding));
}
std::shared_ptr<rn::TurboModule> GameServiceRegistry::create_module(const std::shared_ptr<rn::CallInvoker> &invoker) {
  return std::make_shared<NativeGameServices>(invoker, shared_from_this(), state->emitter, state->gate);
}
void GameServiceRegistry::remove_binding(const std::string &origin, const std::string &name, uint64_t generation) {
  if (!state->stopped) state->close({origin, name}, generation, "E_SERVICE_BINDING_REMOVED: Registration owner removed binding");
}
uint64_t GameServiceRegistry::reserve() {
  if (state->stopped) error("E_SERVICE_STOPPED", "Cannot reserve subscription after shutdown");
  if (state->next_id > safe_integer) error("E_SERVICE_SUBSCRIPTION", "Subscription IDs exhausted");
  const auto id = state->next_id++;
  state->subscriptions.emplace(id, State::Subscription{});
  return id;
}
void GameServiceRegistry::connect(uint64_t id, folly::dynamic target, bool initial, Resolve resolve, Reject reject) {
  const auto key = address(target);
  if (state->stopped) error("E_SERVICE_STOPPED", "Cannot connect subscription after shutdown");
  auto found = state->subscriptions.find(id);
  if (found == state->subscriptions.end() || found->second.connecting) error("E_SERVICE_SUBSCRIPTION", "Subscription ID not reserved or already connecting");
  auto &subscription = found->second;
  subscription.connecting = true;
  subscription.key = key;
  auto binding = state->bindings.find(key);
  const auto generation = binding == state->bindings.end() ? 0 : binding->second->generation;
  subscription.generation = generation;
  std::weak_ptr<State> owner = state;
  state->tasks.push_back({[owner, id, key, initial, generation, resolve = std::move(resolve), reject]() mutable {
    auto state = owner.lock();
    if (!state) { reject("E_SERVICE_STOPPED: Registry no longer exists"); return; }
    try {
      if (!generation) error("E_SERVICE_MISSING", "No binding existed when connection was requested");
      auto binding = state->lookup(key, generation);
      auto found = state->subscriptions.find(id);
      if (found == state->subscriptions.end()) error("E_SERVICE_SUBSCRIPTION_REMOVED", "Subscription removed before connection");
      if (binding->kind == State::Kind::Method || (initial && binding->kind != State::Kind::State))
        error("E_SERVICE_KIND", "Initial reads require state; subscriptions require state or signals");
      folly::dynamic value = nullptr;
      uint64_t revision = binding->revision;
      if (initial) {
        bool consistent = false;
        // The subscription was installed before the getter. Synchronous
        // changed emissions invalidate its sample; retry explicitly, bounded.
        for (int attempt = 0; attempt < 3; ++attempt) {
          state->lookup(key, generation);
          revision = binding->revision;
          ++state->callbacks_run;
          value = VariantDTO{}.copy(invoke(binding->callable, folly::dynamic::array()));
          state->lookup(key, generation);
          validate(value, binding->result);
          if (revision == binding->revision) { consistent = true; break; }
        }
        if (!consistent) error("E_SERVICE_STATE_RACE", "State changed during each bounded snapshot attempt");
      }
      auto current = state->subscriptions.find(id);
      if (current == state->subscriptions.end() || current->second.closed) error("E_SERVICE_SUBSCRIPTION_REMOVED", "Subscription invalidated while reading initial state");
      current->second.ready = true;
      folly::dynamic acknowledgement = folly::dynamic::object("name", key.second)("origin", key.first)
          ("generation", std::to_string(binding->generation))("revision", revision);
      if (initial) acknowledgement["value"] = std::move(value);
      resolve(std::move(acknowledgement));
      for (auto &payload : current->second.pending) {
        if (initial && payload["revision"].asInt() <= static_cast<int64_t>(revision)) continue;
        state->events.emplace_back(Permit{id, generation, false}, std::move(payload));
      }
      current->second.pending.clear();
    } catch (const std::exception &failure) {
      state->subscriptions.erase(id);
      reject(failure.what());
    }
  }, reject});
}
void GameServiceRegistry::remove(uint64_t id) { state->subscriptions.erase(id); }
void GameServiceRegistry::call(folly::dynamic target, folly::dynamic args, Resolve resolve, Reject reject) {
  const auto key = address(target);
  if (state->stopped) error("E_SERVICE_STOPPED", "Cannot call after shutdown");
  if (!args.isArray()) error("E_SERVICE_SCHEMA", "Method arguments must be a DTO array");
  auto found = state->bindings.find(key);
  const auto generation = found == state->bindings.end() ? 0 : found->second->generation;
  std::weak_ptr<State> owner = state;
  state->tasks.push_back({[owner, key, generation, args = std::move(args), resolve = std::move(resolve), reject]() mutable {
    auto state = owner.lock();
    if (!state) { reject("E_SERVICE_STOPPED: Registry no longer exists"); return; }
    try {
      if (!generation) error("E_SERVICE_MISSING", "No binding existed when call was requested");
      auto binding = state->lookup(key, generation);
      if (binding->kind != State::Kind::Method) error("E_SERVICE_KIND", "Calls require registered methods");
      validate_args(args, binding->args);
      ++state->callbacks_run;
      auto value = VariantDTO{}.copy(invoke(binding->callable, args));
      state->lookup(key, generation);
      validate(value, binding->result);
      resolve(folly::dynamic::object("value", std::move(value))("response", binding->registration.response)
          ("generation", std::to_string(generation))("origin", key.first)("name", key.second));
    } catch (const std::exception &failure) { reject(failure.what()); }
  }, reject});
}
void GameServiceRegistry::pump_host(size_t task_budget, size_t event_budget) {
  if (state->stopped || state->pumping) return;
  state->pumping = true;
  std::vector<std::pair<Key, uint64_t>> invalid;
  for (const auto &[key, binding] : state->bindings)
    if (!state->live(binding)) invalid.emplace_back(key, binding->generation);
  for (const auto &[key, generation] : invalid)
    state->close(key, generation, "E_SERVICE_OWNER: Source owner was freed or queued for deletion");
  const auto count = std::min(task_budget, state->tasks.size());
  for (size_t index = 0; index < count && !state->stopped; ++index) {
    auto task = std::move(state->tasks.front());
    state->tasks.pop_front();
    ++state->tasks_run;
    state->running_cancel = task.cancel;
    task.run();
    state->running_cancel = {};
  }
  for (size_t index = 0; index < event_budget && !state->events.empty() && !state->stopped; ++index) {
    auto [permit, payload] = std::move(state->events.front());
    state->events.pop_front();
    if (!state->gate->allowed(permit)) continue;
    state->gate->emitting = permit;
    state->emitter->emit(std::move(payload));
    state->gate->emitting.reset();
    ++state->events_sent;
  }
  state->pumping = false;
}
void GameServiceRegistry::stop() {
  if (state->stopped) return;
  state->stopped = true;
  for (auto &[key, binding] : state->bindings)
    if (binding->signal_owner && owner_live(binding->signal_owner) && binding->signal.is_connected(binding->receiver))
      binding->signal.disconnect(binding->receiver);
  state->bindings.clear();
  state->subscriptions.clear();
  state->events.clear();
  std::deque<State::Task> pending;
  pending.swap(state->tasks);
  if (state->running_cancel) {
    ++state->tasks_canceled;
    state->running_cancel("E_SERVICE_STOPPED: Executing host operation canceled by shutdown");
  }
  for (auto &task : pending) {
    ++state->tasks_canceled;
    task.cancel("E_SERVICE_STOPPED: Pending host operation canceled by shutdown");
  }
}
bool GameServiceRegistry::active() const { return !state->stopped; }
folly::dynamic GameServiceRegistry::snapshot() const {
  auto errors = folly::dynamic::array();
  for (const auto &message : state->errors) errors.push_back(message);
  return folly::dynamic::object("stopped", state->stopped)("bindings", state->bindings.size())
      ("subscriptions", state->subscriptions.size())("pendingHostTasks", state->tasks.size())
      ("pendingEvents", state->events.size())("hostTasksRun", state->tasks_run)("hostTasksCanceled", state->tasks_canceled)
      ("eventsSent", state->events_sent)("callbacksRun", state->callbacks_run)
      ("taskBudget", 64)("eventBudget", 128)("errors", std::move(errors));
}
}

void GodotFabricBinding::_bind_methods() { ClassDB::bind_method(D_METHOD("remove"), &GodotFabricBinding::remove); }
void GodotFabricBinding::initialize(std::weak_ptr<fabric_godot::GameServiceRegistry> value,
    std::string source, std::string service, uint64_t version) {
  registry = std::move(value); origin = std::move(source); name = std::move(service); generation = version;
}
void GodotFabricBinding::remove() {
  if (!generation) return;
  if (auto owner = registry.lock()) owner->remove_binding(origin, name, generation);
  generation = 0;
  registry.reset();
}
