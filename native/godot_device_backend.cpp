#include "godot_device_backend.h"
#include "fabric_application.h"
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/classes/os.hpp>
#include <godot_cpp/core/object.hpp>
#include <godot_cpp/variant/callable.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/packed_string_array.hpp>
#include <godot_cpp/variant/string.hpp>
#include <godot_cpp/variant/variant.hpp>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

using namespace godot;

namespace fabric_godot {
namespace {
constexpr const char *validation_device_services = "validation_device_services";
// DisplayServer.FEATURE_CLIPBOARD; the build's godot-cpp profile has no DisplayServer or Input class.
constexpr int display_feature_clipboard = 5;
// Input.vibrate_handheld takes an int number of milliseconds.
constexpr double maximum_vibration_ms = 2147483647.0;

std::string utf8(const String &value) { return value.utf8().get_data(); }
String gd(const std::string &value) { return String::utf8(value.c_str()); }

// Everything the application's validation meta replaces; empty without it.
Dictionary overlay(uint64_t id) {
  auto *application = Object::cast_to<FabricApplication>(ObjectDB::get_instance(id));
  if (!application || !application->has_meta(validation_device_services)) {
    return Dictionary();
  }
  const Variant value = application->get_meta(validation_device_services);
  Dictionary replaced;
  if (value.get_type() == Variant::DICTIONARY) {
    replaced = value;
  }
  return replaced;
}

// The Callable the overlay holds for a function, or none. A key whose value is
// not a valid Callable yields an invalid one, which the caller treats as a
// refusal.
struct Replacement {
  bool present{};
  Callable callable;
};
Replacement replacement(uint64_t id, const char *name) {
  const Dictionary replaced = overlay(id);
  if (!replaced.has(name)) {
    return {};
  }
  const Variant value = replaced[name];
  Replacement result{true, Callable()};
  if (value.get_type() == Variant::CALLABLE) {
    result.callable = value;
  }
  return result;
}

bool application_exists(uint64_t id) { return Object::cast_to<FabricApplication>(ObjectDB::get_instance(id)) != nullptr; }

Object *singleton(const char *name) { return Engine::get_singleton()->get_singleton(name); }

bool open_url(uint64_t id, const std::string &url) {
  if (const auto replaced = replacement(id, "open_url"); replaced.present) {
    return replaced.callable.is_valid() && static_cast<int64_t>(replaced.callable.call(gd(url))) == 0;
  }
  // OS.shell_open returns an Error; Godot reports OK for a URL macOS accepted.
  return application_exists(id) && static_cast<int64_t>(OS::get_singleton()->shell_open(gd(url))) == 0;
}

bool clipboard_available(uint64_t id) {
  if (const auto replaced = replacement(id, "clipboard_available"); replaced.present) {
    return replaced.callable.is_valid() && static_cast<bool>(replaced.callable.call());
  }
  auto *display = singleton("DisplayServer");
  return application_exists(id) && display != nullptr && static_cast<bool>(display->call("has_feature", display_feature_clipboard));
}

std::string clipboard_get(uint64_t id) {
  if (const auto replaced = replacement(id, "clipboard_get"); replaced.present) {
    return replaced.callable.is_valid() ? utf8(String(replaced.callable.call())) : std::string();
  }
  auto *display = singleton("DisplayServer");
  return display == nullptr ? std::string() : utf8(String(display->call("clipboard_get")));
}

void clipboard_set(uint64_t id, const std::string &text) {
  if (const auto replaced = replacement(id, "clipboard_set"); replaced.present) {
    if (replaced.callable.is_valid()) {
      replaced.callable.call(gd(text));
    }
    return;
  }
  if (auto *display = singleton("DisplayServer")) {
    display->call("clipboard_set", gd(text));
  }
}

void vibrate(uint64_t id, double milliseconds) {
  if (const auto replaced = replacement(id, "vibrate"); replaced.present) {
    if (replaced.callable.is_valid()) {
      replaced.callable.call(milliseconds);
    }
    return;
  }
  if (auto *input = singleton("Input"); input != nullptr && application_exists(id)) {
    input->call("vibrate_handheld", static_cast<int64_t>(std::llround(std::min(milliseconds, maximum_vibration_ms))), -1.0);
  }
}

void cancel_vibration(uint64_t id) {
  if (const auto replaced = replacement(id, "cancel_vibration"); replaced.present) {
    if (replaced.callable.is_valid()) {
      replaced.callable.call();
    }
  }
  // Godot's Input has no way to stop a vibration, so there is nothing to call.
}

std::vector<std::string> to_vector(const PackedStringArray &values) {
  std::vector<std::string> result;
  result.reserve(static_cast<std::size_t>(values.size()));
  for (int64_t index = 0; index < values.size(); ++index) {
    result.push_back(utf8(values[index]));
  }
  return result;
}
}  // namespace

device::Backend make_godot_device_backend(uint64_t application_id) {
  device::Backend backend;
  backend.open_url = [application_id](const std::string &url) { return open_url(application_id, url); };
  backend.clipboard_available = [application_id] { return clipboard_available(application_id); };
  backend.clipboard_get = [application_id] { return clipboard_get(application_id); };
  backend.clipboard_set = [application_id](const std::string &text) { clipboard_set(application_id, text); };
  backend.vibrate = [application_id](double milliseconds) { vibrate(application_id, milliseconds); };
  backend.cancel_vibration = [application_id] { cancel_vibration(application_id); };
  return backend;
}

std::optional<std::string> godot_launch_url() {
  auto *os = OS::get_singleton();
  if (os == nullptr) {
    return std::nullopt;
  }
  return device::launch_url(to_vector(os->get_cmdline_user_args()), to_vector(os->get_cmdline_args()));
}
}
