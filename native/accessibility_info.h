#pragma once

#include "accessibility_info_core.h"
#include <folly/dynamic.h>
#include <cstdint>
#include <memory>
#include <string>

namespace fabric_godot {
class TurboModuleRegistry;
struct AccessibilityInfoState;

// One application's side of the settings React Native's original AccessibilityInfo reports: the
// AccessibilityManager module with iOS's contract (which is what AccessibilityInfo.js takes when Platform.OS is
// "godot"). The module, the JSI binding, the callbacks and the device events are RN's; this owns the platform
// backend and the counters, reads the settings once per frame from ApplicationRuntime's pump and ends all of it
// with the application.
//
// Godot backs four settings (screen reader, reduce motion, reduce transparency, increase contrast); the others
// reject. Announcements and programmatic focus are the next slice's.
class AccessibilityInfo {
 public:
  // The backend is Godot's, or Godot's with some readings replaced by a validation run.
  explicit AccessibilityInfo(accessibility::Backend backend);
  ~AccessibilityInfo();
  // Registers AccessibilityManager; it is created when JS first asks for it, which is when
  // AccessibilityInfo.js is first imported.
  void install(TurboModuleRegistry &registry);
  // The settings of one frame. Once the module exists it reads each setting and queues a device event for each
  // known value that changed; before that, and after stop(), it does nothing.
  void poll();
  // An event of Fabric's UIManager.sendAccessibilityEvent, counted. Ignored for every type but focus, as iOS does;
  // Unsupported for focus, which the caller refuses out loud.
  accessibility::UiEvent ui_event(const std::string &type);
  // Ends the owner: later calls to a retained module throw E_MODULE_DISPOSED, nothing is read and no queued
  // event or callback reaches JS.
  void stop();
  folly::dynamic snapshot() const;

 private:
  std::shared_ptr<AccessibilityInfoState> state_;
};

// Godot's backend for one FabricApplication, found by its instance id on every call (the owner may outlive the Node
// until the VM is released): DisplayServer's accessibility_screen_reader_active, accessibility_should_reduce_animation,
// accessibility_should_reduce_transparency and accessibility_should_increase_contrast, each -1 (unknown), 0 or 1. The
// headless server and the mobile servers report -1.
//
// Only an integer is a reading: a DisplayServer without the method, or a call that returns anything else, is unknown (-1)
// and never off. The method of each setting is `displayMethod` in the snapshot.
//
// A validation run replaces readings by setting the application's "validation_accessibility_settings" meta to a
// Dictionary of the keys screen_reader, reduce_animation, reduce_transparency and increase_contrast, each -1, 0 or
// 1. Only the keys present replace the DisplayServer's reading, and a value that is not one of those integers is
// unknown. The meta is read on every reading, so a run changes a setting by setting the meta again.
accessibility::Backend make_godot_accessibility_backend(uint64_t application_id);
}
