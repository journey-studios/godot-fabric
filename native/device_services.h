#pragma once

#include "device_services_core.h"
#include <folly/dynamic.h>
#include <memory>
#include <optional>
#include <string>

namespace fabric_godot {
class TurboModuleRegistry;
struct DeviceServicesState;

// One application's side of the device services RN's original Linking,
// Clipboard and Vibration modules drive: the LinkingManager module with iOS's
// contract (which is what Linking.js takes when Platform.OS is "godot"), and
// the neutral Clipboard and Vibration modules. The modules, the JSI binding,
// the promises and the device events are RN's; this owns the platform backend
// and the counters and ends all of it with the application.
class DeviceServices {
 public:
  // The backend is Godot's, or Godot's with some functions replaced by a
  // validation run (godot_device_backend.h). initial_url is the URL that
  // launched the process, if any.
  DeviceServices(device::Backend backend, std::optional<std::string> initial_url);
  ~DeviceServices();
  // Registers LinkingManager, Clipboard and Vibration; each is created when JS
  // first asks for it.
  void install(TurboModuleRegistry &registry);
  // A URL that the platform hands to the running application, as a deep link
  // would arrive. Linking's "url" event carries it once to every listener of the
  // application's JS runtime, in order. Returns false, and emits nothing, for a
  // string without a URL scheme and for an application that has stopped.
  bool deliver_url(const std::string &url);
  // Ends the services: later calls to a retained module throw E_MODULE_DISPOSED,
  // no URL is delivered and no queued event or settlement reaches JS.
  void stop();
  folly::dynamic snapshot() const;

 private:
  std::shared_ptr<DeviceServicesState> state_;
};
}
