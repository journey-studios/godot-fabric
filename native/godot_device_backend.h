#pragma once

#include "device_services_core.h"
#include <cstdint>
#include <optional>
#include <string>

namespace fabric_godot {
// Godot's backend of the device services for one FabricApplication, found by
// its instance id on every call (the services may outlive the Node until the VM
// is released):
//   open_url           OS.shell_open
//   clipboard_*        DisplayServer.clipboard_get/set, and has_feature(FEATURE_CLIPBOARD)
//                      for the availability (the headless DisplayServer has none)
//   vibrate            Input.vibrate_handheld (a silent no-op on desktop)
//   cancel_vibration   nothing: Godot has no way to stop a vibration
//
// A validation run replaces any of these by setting the application's
// "validation_device_services" meta to a Dictionary of Callables, keyed by the
// functions above. Only the keys present are replaced, and a key whose Callable
// is no longer valid is a backend that refuses, never the real one, so a test or
// an example cannot open a real URL or touch the real pasteboard by accident:
//   open_url(url: String) -> int       a Godot Error; 0 (OK) opens the URL
//   clipboard_available() -> bool
//   clipboard_get() -> String
//   clipboard_set(text: String)
//   vibrate(duration_ms: float)
//   cancel_vibration()
device::Backend make_godot_device_backend(uint64_t application_id);

// The URL that launched this process: the first valid --uri=<url> of
// OS.get_cmdline_user_args(), then of OS.get_cmdline_args() (macOS
// LaunchServices passes the URL that opened the application this way).
std::optional<std::string> godot_launch_url();
}
