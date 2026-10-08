#include "accessibility_announcer.h"
#include "fabric_application.h"
#include <godot_cpp/classes/class_db_singleton.hpp>
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/classes/node.hpp>
#include <godot_cpp/classes/scene_tree.hpp>
#include <godot_cpp/core/object.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/rid.hpp>
#include <godot_cpp/variant/string.hpp>
#include <godot_cpp/variant/variant.hpp>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

using namespace godot;
namespace ax = fabric_godot::accessibility;

namespace fabric_godot {
namespace {
// Godot's AccessibilityServer is not in the pinned binding profile; it is reached by name, as the application reaches the
// DisplayServer.
constexpr const char *server_class = "AccessibilityServer";
constexpr const char *validation_announcer = "validation_accessibility_announcer";
// What the announcements ask of the engine. A name here that the engine lacks closes the gate (nothing can be announced to), and
// announce_api_report says which.
constexpr const char *server_methods[] = {"is_supported", "create_sub_element", "update_set_value", "update_set_live", "free_element"};
constexpr const char *server_constants[] = {"ROLE_STATIC_TEXT", "LIVE_POLITE", "LIVE_ASSERTIVE"};
constexpr const char *tree_method = "is_accessibility_enabled";
constexpr const char *node_methods[] = {"get_accessibility_element", "queue_accessibility_update"};
// A recorded run is short; the bound keeps a runaway one from growing without end, and the overflow is counted.
constexpr std::size_t max_recorded = 1024;

String gd(const std::string &value) { return String::utf8(value.c_str()); }

Object *accessibility_server() { return Engine::get_singleton()->get_singleton(server_class); }

// The engine API of the announcements that this engine does not have, as "Class.name". The engine does not change while it
// runs, so it is asked of ClassDB once.
const std::vector<std::string> &missing_api() {
  static const std::vector<std::string> missing = [] {
    std::vector<std::string> result;
    auto *classes = ClassDBSingleton::get_singleton();
    if (!Engine::get_singleton()->has_singleton(server_class)) {
      result.push_back(std::string(server_class) + " (singleton)");
      return result;
    }
    for (const auto *method : server_methods) {
      if (!classes->class_has_method(server_class, method)) {
        result.push_back(std::string(server_class) + "." + method);
      }
    }
    for (const auto *constant : server_constants) {
      if (!classes->class_has_integer_constant(server_class, constant)) {
        result.push_back(std::string(server_class) + "." + constant);
      }
    }
    if (!classes->class_has_method("SceneTree", tree_method)) {
      result.push_back(std::string("SceneTree.") + tree_method);
    }
    for (const auto *method : node_methods) {
      if (!classes->class_has_method("Node", method)) {
        result.push_back(std::string("Node.") + method);
      }
    }
    return result;
  }();
  return missing;
}

// The number of an AccessibilityServer constant in the running engine, asked once per name.
std::optional<int64_t> server_constant(const std::string &name) {
  static std::unordered_map<std::string, std::optional<int64_t>> known;
  const auto found = known.find(name);
  if (found != known.end()) {
    return found->second;
  }
  auto *classes = ClassDBSingleton::get_singleton();
  std::optional<int64_t> value;
  if (classes->class_has_integer_constant(server_class, String(name.c_str()))) {
    value = classes->class_get_integer_constant(server_class, String(name.c_str()));
  }
  known.emplace(name, value);
  return value;
}

FabricApplication *find_application(uint64_t id) {
  return Object::cast_to<FabricApplication>(ObjectDB::get_instance(id));
}

// The validation recorder's settings, or nothing for a real run.
struct Recorded {
  bool available{true}, element{true}, delivers{true};
};
std::optional<Recorded> recorder_settings(uint64_t id) {
  auto *application = find_application(id);
  if (application == nullptr || !application->has_meta(validation_announcer)) {
    return std::nullopt;
  }
  Recorded settings;
  const Variant meta = application->get_meta(validation_announcer);
  if (meta.get_type() == Variant::DICTIONARY) {
    const Dictionary values = meta;
    const std::pair<const char *, bool *> keys[] = {{"available", &settings.available}, {"element", &settings.element}, {"delivers", &settings.delivers}};
    for (const auto &[key, target] : keys) {
      if (values.has(key)) {
        const Variant value = values[key];
        *target = value.get_type() == Variant::BOOL ? static_cast<bool>(value) : *target;
      }
    }
  }
  return settings;
}

// Everything one port shares between its functions.
struct PortState {
  uint64_t application;
  std::function<void()> publish;
  uint64_t next_handle{1};
  // The elements the real server made, by the handle the announcer holds.
  std::unordered_map<uint64_t, RID> elements;
  std::vector<ax::PortOperation> operations;
  std::size_t overflow{};

  void record(std::string op, uint64_t handle = 0, std::string text = {}) {
    if (operations.size() >= max_recorded) {
      ++overflow;
      return;
    }
    operations.push_back({std::move(op), handle, std::move(text)});
  }
};

// A screen reader is there for an announcement: the engine has what the announcements use, the application is in a tree whose
// accessibility is enabled and supported, and it has an element to put them in. A headless engine has none of the last three.
bool real_available(uint64_t id) {
  if (!missing_api().empty()) {
    return false;
  }
  auto *application = find_application(id);
  auto *server = accessibility_server();
  if (application == nullptr || server == nullptr || !application->is_inside_tree()) {
    return false;
  }
  auto *tree = application->get_tree();
  if (tree == nullptr || !static_cast<bool>(server->call("is_supported")) || !static_cast<bool>(tree->call(tree_method))) {
    return false;
  }
  const RID element = application->call("get_accessibility_element");
  return element.is_valid();
}

uint64_t real_create(PortState &state) {
  auto *application = find_application(state.application);
  auto *server = accessibility_server();
  const auto role = server_constant("ROLE_STATIC_TEXT");
  if (application == nullptr || server == nullptr || !role) {
    return 0;
  }
  const RID parent = application->call("get_accessibility_element");
  if (!parent.is_valid()) {
    return 0;
  }
  const RID element = server->call("create_sub_element", parent, *role);
  if (!element.is_valid()) {
    return 0;
  }
  const uint64_t handle = state.next_handle++;
  state.elements.emplace(handle, element);
  return handle;
}
}  // namespace

ax::AnnouncePort make_godot_announce_port(uint64_t application_id, std::function<void()> publish) {
  auto state = std::make_shared<PortState>();
  state->application = application_id;
  state->publish = std::move(publish);
  ax::AnnouncePort port;
  port.available = [state] {
    if (const auto recorder = recorder_settings(state->application)) {
      return recorder->available;
    }
    return real_available(state->application);
  };
  port.request_update = [state] {
    if (const auto recorder = recorder_settings(state->application)) {
      // The recorder is the AccessibilityServer: the update the engine would run is run here, with its boundaries recorded.
      if (recorder->delivers) {
        state->record("update.begin");
        state->publish();
        state->record("update.end");
      }
      return;
    }
    if (auto *application = find_application(state->application)) {
      application->call("queue_accessibility_update");
    }
  };
  port.create = [state]() -> uint64_t {
    if (const auto recorder = recorder_settings(state->application)) {
      if (!recorder->element) {
        return 0;
      }
      const uint64_t handle = state->next_handle++;
      state->record("create", handle);
      return handle;
    }
    return real_create(*state);
  };
  port.set_text = [state](uint64_t handle, ax::TextProperty property, const std::string &text) {
    const bool value = property == ax::TextProperty::Value;
    if (recorder_settings(state->application)) {
      state->record(value ? "value" : "name", handle, text);
      return;
    }
    const auto found = state->elements.find(handle);
    auto *server = accessibility_server();
    if (found != state->elements.end() && server != nullptr) {
      server->call(value ? "update_set_value" : "update_set_name", found->second, gd(text));
    }
  };
  port.set_live = [state](uint64_t handle, ax::Live live) {
    if (recorder_settings(state->application)) {
      state->record("live", handle, ax::live_name(live));
      return;
    }
    const auto found = state->elements.find(handle);
    auto *server = accessibility_server();
    const auto mode = server_constant(live == ax::Live::Assertive ? "LIVE_ASSERTIVE" : "LIVE_POLITE");
    if (found != state->elements.end() && server != nullptr && mode) {
      server->call("update_set_live", found->second, *mode);
    }
  };
  port.release = [state](uint64_t handle) {
    if (recorder_settings(state->application)) {
      state->record("free", handle);
      return;
    }
    const auto found = state->elements.find(handle);
    if (found == state->elements.end()) {
      return;
    }
    // The element may be gone already, freed with the application's own; free_element of an element that does not exist does
    // nothing.
    if (auto *server = accessibility_server()) {
      server->call("free_element", found->second);
    }
    state->elements.erase(found);
  };
  port.recorded = [state] { return state->operations; };
  return port;
}

folly::dynamic announce_api_report() {
  folly::dynamic methods = folly::dynamic::array();
  for (const auto *method : server_methods) {
    methods.push_back(method);
  }
  folly::dynamic constants = folly::dynamic::array();
  for (const auto *constant : server_constants) {
    constants.push_back(constant);
  }
  folly::dynamic node = folly::dynamic::array();
  for (const auto *method : node_methods) {
    node.push_back(method);
  }
  folly::dynamic missing = folly::dynamic::array();
  for (const auto &name : missing_api()) {
    missing.push_back(name);
  }
  return folly::dynamic::object("server", server_class)("methods", methods)("constants", constants)("tree", tree_method)
      ("node", node)("missing", missing);
}
}  // namespace fabric_godot
