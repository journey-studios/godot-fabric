#pragma once
#include <godot_cpp/classes/node.hpp>
#include "display_insets_core.h"
#include "game_service_registry.h"
#include <memory>
#include <vector>

class FabricSurface;
namespace godot { class Window; }
namespace fabric_godot { class ApplicationRuntime; class AdapterLoader; class AppLifecycle; class SystemAppearance; class DeviceServices; class AccessibilityInfo; }

// Experimental explicit owner. Final resource/editor authoring is still GF-28.
class FabricApplication : public godot::Node {
  GDCLASS(FabricApplication, godot::Node)
 public:
  FabricApplication();
  ~FabricApplication() override;
  void _process(double delta) override;
  void _exit_tree() override;
  void _notification(int what);
  // A system theme change from the callback every application shares, while
  // this application's Appearance module observes.
  void system_theme_changed();
  // Validation seam: the very Callable the shared owner registered with
  // DisplayServer, which the headless DisplayServer never calls.
  godot::Callable validation_system_theme_callback() const;
  // Releases that Callable before the engine shuts down.
  static void release_system_theme_callback();
  godot::String evaluate(const godot::String &source);
  godot::String snapshot();
  void stop();
  // The entry point of a deep link that reaches the running application: Linking's
  // "url" event, once, to every JS listener. False, and nothing emitted, for a string
  // without a URL scheme and for an application that has stopped.
  bool deliver_url(const godot::String &url);
  void invoke_callable(const godot::String &name, const godot::String &method, const godot::Array &args);
  godot::Ref<GodotFabricBinding> bind_signal(const godot::String &name, const godot::Signal &signal,
      const godot::Array &arg_schema, const godot::Dictionary &options = {});
  godot::Ref<GodotFabricBinding> bind_state(const godot::String &name, const godot::Callable &getter,
      const godot::Signal &changed, const godot::Variant &value_schema, const godot::Dictionary &options = {});
  godot::Ref<GodotFabricBinding> register_method(const godot::String &name, const godot::Callable &callable,
      const godot::Array &arg_schema, const godot::Variant &result_schema, const godot::Dictionary &options = {});
  bool is_stopped() const;
  void set_bundle_path(const godot::String &path);
  godot::String get_bundle_path() const;
  void set_adapter_manifest_path(const godot::String &path);
  godot::String get_adapter_manifest_path() const;
  void set_native_combination_path(const godot::String &path);
  godot::String get_native_combination_path() const;
  // How the window's content scale is chosen, before the application initializes. "content" (the default) leaves the project's
  // stretch settings alone, so Dimensions.scale is whatever they make it (1 without stretch). "screen" gives Fabric points the
  // size of the OS's points: the window stretches as canvas_items, with no content size and the screen's scale as the content
  // factor, and follows the screen's scale when it changes (a window dragged to another display).
  void set_density_policy(const godot::String &policy);
  godot::String get_density_policy() const;
  int mount(FabricSurface &host, const godot::String &component, const godot::Dictionary &props);
  fabric_godot::ApplicationRuntime *get_runtime() const;
 protected:
  static void _bind_methods();
 private:
  godot::String bundle_path = "res://build/app.js";
  godot::String adapter_manifest_path;
  godot::String native_combination_path = "res://addons/godot_fabric/native/native-combination.json";
  godot::String density_policy = "content";
  std::unique_ptr<fabric_godot::AdapterLoader> adapter_loader;
  std::unique_ptr<fabric_godot::ApplicationRuntime> runtime;
  bool initialization_attempted = false;
  std::shared_ptr<fabric_godot::GameServiceRegistry> game_services;
  // One lifecycle per application: every root's AppState reads the same state.
  std::shared_ptr<fabric_godot::AppLifecycle> app_state;
  // One system appearance per application, shared by every root.
  std::shared_ptr<fabric_godot::SystemAppearance> appearance;
  // One set of device services (Linking, Clipboard, Vibration) per application, shared by every root.
  std::shared_ptr<fabric_godot::DeviceServices> device_services;
  // One AccessibilityInfo (the settings and events of the AccessibilityManager module) per application, shared by every root.
  std::shared_ptr<fabric_godot::AccessibilityInfo> accessibility_info;
  bool bundle_loaded = false;
  bool terminal_stopped = false;
  std::vector<std::string> pre_runtime_errors;
  void report_error(const std::string &message);
  // The scale the "screen" policy gives the window's content: the window's screen's scale, or what validation_screen_scale
  // says for a display server that has one scale.
  double screen_scale(godot::Window &window) const;
  void apply_density_policy(godot::Window &window);
  // The bands of the window's edges the OS leaves out, in Fabric points (validation_safe_area replaces the OS).
  fabric_godot::display_insets::Edges unsafe_edges(godot::Window &window, double scale) const;
};
