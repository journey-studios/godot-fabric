#include "fabric_application.h"
#include "application_runtime.h"
#include "adapter_loader.h"
#include "app_lifecycle.h"
#include "device_services.h"
#include "accessibility_info.h"
#include "godot_device_backend.h"
#include "system_appearance.h"
#include <godot_cpp/classes/project_settings.hpp>
#include "fabric_surface.h"
#include <godot_cpp/classes/file_access.hpp>
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/classes/json.hpp>
#include <godot_cpp/classes/viewport.hpp>
#include <godot_cpp/classes/window.hpp>
#include <godot_cpp/core/object.hpp>
#include <godot_cpp/variant/callable_method_pointer.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <folly/json.h>
#include <stdexcept>
#include <filesystem>
#include <optional>

using namespace godot;
static std::string utf8(const String &value) { return value.utf8().get_data(); }
static String gd(const std::string &value) { return String::utf8(value.c_str()); }
// The headless DisplayServer has no system theme and never calls back, so a
// validation run supplies the system scheme through this meta instead.
static constexpr const char *validation_system_scheme = "validation_system_color_scheme";
// Likewise the headless DisplayServer reports no screen refresh rate (-1), the
// value the frame clock turns into its 60 Hz fallback; a validation run supplies
// the rate its simulated display would report through this meta instead.
static constexpr const char *validation_refresh_rate = "validation_refresh_rate";
// And the headless DisplayServer presents nothing, so a validation run states how its
// simulated window is presented ("presentation" or "time") through this meta.
static constexpr const char *validation_frame_pacing = "validation_frame_pacing";
// Godot's default roots cannot vouch for the private authority of a local test server, so
// a validation run states the PEM text of the authorities an HTTPS request trusts, instead
// of those roots, through this meta.
static constexpr const char *validation_tls_authorities = "validation_tls_trusted_authorities";
static std::string read_validation_tls_authorities(uint64_t id) {
  auto *application = Object::cast_to<FabricApplication>(ObjectDB::get_instance(id));
  if (!application || !application->has_meta(validation_tls_authorities)) return {};
  return utf8(String(application->get_meta(validation_tls_authorities)));
}
// A request's deadline would otherwise need a real wait to pass, so a validation run moves the
// clock the deadlines are measured on forward by this many milliseconds through this meta.
static constexpr const char *validation_clock_offset = "validation_clock_offset_ms";
static double read_validation_clock_offset(uint64_t id) {
  auto *application = Object::cast_to<FabricApplication>(ObjectDB::get_instance(id));
  return application && application->has_meta(validation_clock_offset) ? static_cast<double>(application->get_meta(validation_clock_offset)) : 0;
}
// A heap reading compares only what is live once the collector has run, and it may run in
// the background, so a validation run asks the application, through this meta, to collect
// before it reports Hermes' heap in the snapshot.
static constexpr const char *validation_collect_garbage_on_status = "validation_collect_garbage_on_status";
static bool read_validation_collect_garbage(uint64_t id) {
  auto *application = Object::cast_to<FabricApplication>(ObjectDB::get_instance(id));
  return application && application->has_meta(validation_collect_garbage_on_status);
}
// The performance section reports aggregates; a validation run that recomputes its percentiles asks for
// the samples they come from through this meta.
static constexpr const char *validation_performance_samples = "validation_performance_samples";
static bool read_validation_performance_samples(uint64_t id) {
  auto *application = Object::cast_to<FabricApplication>(ObjectDB::get_instance(id));
  return application && application->has_meta(validation_performance_samples);
}
static fabric_godot::SystemAppearance::System read_system_appearance(uint64_t id) {
  auto *application = Object::cast_to<FabricApplication>(ObjectDB::get_instance(id));
  if (!application) return {};
  if (application->has_meta(validation_system_scheme))
    return {true, String(application->get_meta(validation_system_scheme)) == "dark"};
  auto *display = Engine::get_singleton()->get_singleton("DisplayServer");
  if (!display) return {};
  const bool supported = display->call("is_dark_mode_supported");
  return {supported, supported && static_cast<bool>(display->call("is_dark_mode"))};
}
// The Callable the shared owner handed to DisplayServer. It calls a static
// function, so DisplayServer's copy never refers to an application; this copy
// is released when the extension's scene level terminates, before the engine.
static std::optional<Callable> &system_theme_callable() {
  static std::optional<Callable> callable;
  return callable;
}
static fabric_godot::SystemThemeOwner &system_theme_owner();
static void dispatch_system_theme() { system_theme_owner().changed(); }
// Editor processes leave DisplayServer's slot to the editor.
static bool register_system_theme_callback() {
  if (Engine::get_singleton()->is_editor_hint()) return false;
  auto *display = Engine::get_singleton()->get_singleton("DisplayServer");
  if (!display) return false;
  system_theme_callable() = callable_mp_static(&dispatch_system_theme);
  display->call("set_system_theme_change_callback", *system_theme_callable());
  return true;
}
static bool deliver_system_theme(uint64_t id) {
  auto *application = Object::cast_to<FabricApplication>(ObjectDB::get_instance(id));
  if (!application) return false;
  application->system_theme_changed();
  return true;
}
// One owner per process, shared by every application (see SystemThemeOwner).
static fabric_godot::SystemThemeOwner &system_theme_owner() {
  static fabric_godot::SystemThemeOwner owner(register_system_theme_callback, deliver_system_theme);
  return owner;
}
void FabricApplication::release_system_theme_callback() { system_theme_callable().reset(); }

FabricApplication::FabricApplication() : game_services(std::make_shared<fabric_godot::GameServiceRegistry>()),
    app_state(std::make_shared<fabric_godot::AppLifecycle>()) {
  set_process_mode(PROCESS_MODE_ALWAYS); set_process(true);
  // Resolved by ID: the module may outlive this Node until the VM is released.
  // The module joins the shared system theme callback when it starts and
  // leaves it when it is released.
  const uint64_t id = get_instance_id();
  appearance = std::make_shared<fabric_godot::SystemAppearance>(
      [id] { return read_system_appearance(id); }, [id] { return system_theme_owner().join(id); },
      [id] { system_theme_owner().leave(id); });
  // The backend finds this application by its id on every call (the services may outlive the Node
  // until the VM is released), and replaces what the validation_device_services meta names.
  device_services = std::make_shared<fabric_godot::DeviceServices>(
      fabric_godot::make_godot_device_backend(id), fabric_godot::godot_launch_url());
  // Likewise found by id on every reading; the validation_accessibility_settings meta replaces the keys it names.
  accessibility_info = std::make_shared<fabric_godot::AccessibilityInfo>(fabric_godot::make_godot_accessibility_backend(id));
}
FabricApplication::~FabricApplication() { stop(); }
void FabricApplication::_bind_methods() {
  ClassDB::bind_method(D_METHOD("evaluate", "source"), &FabricApplication::evaluate);
  ClassDB::bind_method(D_METHOD("snapshot"), &FabricApplication::snapshot);
  ClassDB::bind_method(D_METHOD("stop"), &FabricApplication::stop);
  ClassDB::bind_method(D_METHOD("deliver_url", "url"), &FabricApplication::deliver_url);
  ClassDB::bind_method(D_METHOD("validation_system_theme_callback"), &FabricApplication::validation_system_theme_callback);
  ClassDB::bind_method(D_METHOD("invoke_callable", "name", "method", "args"), &FabricApplication::invoke_callable);
  ClassDB::bind_method(D_METHOD("bind_signal", "name", "signal", "arg_schema", "options"), &FabricApplication::bind_signal, DEFVAL(Dictionary()));
  ClassDB::bind_method(D_METHOD("bind_state", "name", "getter", "changed", "value_schema", "options"), &FabricApplication::bind_state, DEFVAL(Dictionary()));
  ClassDB::bind_method(D_METHOD("register_method", "name", "callable", "arg_schema", "result_schema", "options"), &FabricApplication::register_method, DEFVAL(Dictionary()));
  ClassDB::bind_method(D_METHOD("set_bundle_path", "path"), &FabricApplication::set_bundle_path);
  ClassDB::bind_method(D_METHOD("get_bundle_path"), &FabricApplication::get_bundle_path);
  ADD_PROPERTY(PropertyInfo(Variant::STRING, "bundle_path", PROPERTY_HINT_FILE, "*.js"), "set_bundle_path", "get_bundle_path");
  ClassDB::bind_method(D_METHOD("set_adapter_manifest_path", "path"), &FabricApplication::set_adapter_manifest_path);
  ClassDB::bind_method(D_METHOD("get_adapter_manifest_path"), &FabricApplication::get_adapter_manifest_path);
  ADD_PROPERTY(PropertyInfo(Variant::STRING, "adapter_manifest_path", PROPERTY_HINT_FILE, "*.json"), "set_adapter_manifest_path", "get_adapter_manifest_path");
  ClassDB::bind_method(D_METHOD("set_native_combination_path", "path"), &FabricApplication::set_native_combination_path);
  ClassDB::bind_method(D_METHOD("get_native_combination_path"), &FabricApplication::get_native_combination_path);
  ADD_PROPERTY(PropertyInfo(Variant::STRING, "native_combination_path", PROPERTY_HINT_FILE, "*.json"), "set_native_combination_path", "get_native_combination_path");
}
void FabricApplication::set_bundle_path(const String &path) {
  if (initialization_attempted) { report_error("Bundle path cannot change after application initialization"); return; }
  bundle_path = path;
}
String FabricApplication::get_bundle_path() const { return bundle_path; }
void FabricApplication::set_adapter_manifest_path(const String &path) {
  if (initialization_attempted) { report_error("Adapter selection cannot change after application initialization"); return; }
  adapter_manifest_path = path;
}
String FabricApplication::get_adapter_manifest_path() const { return adapter_manifest_path; }
void FabricApplication::set_native_combination_path(const String &path) {
  if (initialization_attempted) { report_error("Native combination cannot change after application initialization"); return; }
  native_combination_path = path;
}
String FabricApplication::get_native_combination_path() const { return native_combination_path; }
fabric_godot::ApplicationRuntime *FabricApplication::get_runtime() const { return runtime.get(); }
int FabricApplication::mount(FabricSurface &host, const String &component, const Dictionary &props) {
  try {
    if (terminal_stopped) throw std::runtime_error("E_RUNTIME_STOPPED: Application cannot mount after stop");
    if (!runtime) {
      if (initialization_attempted) throw std::runtime_error("E_ADAPTER_RESTART_REQUIRED: failed initialization cannot be retried");
      initialization_attempted = true;
      if (!adapter_manifest_path.is_empty()) {
        auto *settings = ProjectSettings::get_singleton();
        const auto physical = [settings](const String &resource) {
          return std::filesystem::canonical(utf8(settings->globalize_path(resource))).string();
        };
        adapter_loader = std::make_unique<fabric_godot::AdapterLoader>(
            physical(adapter_manifest_path),
            physical(native_combination_path),
            physical("res://"),
            physical(bundle_path));
      }
      const auto scenario = get_meta("scenario", host.get_meta("scenario", "react"));
      runtime = std::make_unique<fabric_godot::ApplicationRuntime>(host,
          [this]() {
            fabric_godot::WindowMetrics metrics;
            auto *window = get_window();
            if (!window) return metrics;
            metrics.window_instance_id = window->get_instance_id();
            if (window->is_embedded() || window->get_content_scale_mode() == Window::CONTENT_SCALE_MODE_VIEWPORT)
              throw std::runtime_error("Embedded windows and viewport stretch require a complete React Native metrics adapter");
            metrics.size = window->get_visible_rect().size;
            // Fabric points are Godot's content coordinates. Density comes
            // from the actual content-to-window transform, not OS screen DPI.
            // RN exposes one scalar density; nonuniform content scaling is an
            // explicit unsupported coordinate contract for this checkpoint.
            const auto content_transform = window->get_final_transform() *
                window->get_global_canvas_transform().affine_inverse();
            const auto scale = content_transform.get_scale();
            if (!Math::is_equal_approx(scale.x, scale.y) || scale.x <= 0)
              throw std::runtime_error("React Native window metrics require uniform positive Godot content scaling");
            metrics.scale = scale.x;
            if (auto *display = Engine::get_singleton()->get_singleton("DisplayServer")) {
              const int screen = display->call("window_get_current_screen", window->get_window_id());
              const Vector2i pixels = display->call("screen_get_size", screen);
              metrics.screen = Vector2(pixels) / metrics.scale;
              // Per screen, so a window moved to another display follows its rate.
              metrics.refresh_rate = display->call("screen_get_refresh_rate", screen);
              // And per window: V-Sync makes the display pace its frames, a headless server has none.
              // The mode is DisplayServer.VSyncMode, an int here (the build's godot-cpp profile has no
              // DisplayServer); detect_pacing documents the values.
              const bool headless = String(display->call("get_name")) == "headless";
              const int vsync = display->call("window_get_vsync_mode", window->get_window_id());
              // While the window cannot draw (minimized, say) Godot's main loop sleeps
              // low_processor_usage_mode_sleep_usec per frame even with V-Sync, so presentation
              // paces nothing. Godot 4.7.2 exposes window_can_draw per window, not can_any_window_draw.
              const bool can_draw = display->call("window_can_draw", window->get_window_id());
              const auto detected = fabric_godot::FrameClock::detect_pacing(headless, vsync, can_draw);
              metrics.pacing = detected.pacing;
              metrics.pacing_source = detected.source;
            }
            if (has_meta(validation_refresh_rate)) metrics.refresh_rate = get_meta(validation_refresh_rate);
            if (has_meta(validation_frame_pacing)) {
              const String requested = get_meta(validation_frame_pacing);
              if (requested == "presentation" || requested == "time") {
                metrics.pacing = requested == "presentation" ? fabric_godot::FrameClock::Pacing::Presentation
                                                             : fabric_godot::FrameClock::Pacing::Time;
                metrics.pacing_source = "validation";
              }
            }
            return metrics;
          },
          utf8(scenario), get_instance_id(), game_services, app_state, appearance,
          [id = get_instance_id()] { return read_validation_tls_authorities(id); },
          [id = get_instance_id()] { return read_validation_clock_offset(id); },
          adapter_loader ? adapter_loader->registry() : nullptr, device_services, accessibility_info,
          [id = get_instance_id()] { return read_validation_collect_garbage(id); },
          [id = get_instance_id()] { return read_validation_performance_samples(id); });
    }
    int legacy_id = 0;
    if (!bundle_loaded) {
      // Legacy demo bundles render root 1 themselves. Named entries instead
      // register first, then mount through the original AppRegistry binding.
      if (component.is_empty()) legacy_id = runtime->mount(host, "", "{}");
      if (!FileAccess::file_exists(bundle_path)) throw std::runtime_error("Missing application bundle; run npm run bundle");
      const auto bundle = FileAccess::get_file_as_string(bundle_path);
      if (bundle.is_empty()) throw std::runtime_error("Missing application bundle; run npm run bundle");
      runtime->load_bundle(utf8(bundle), utf8(bundle_path));
      bundle_loaded = true;
    }
    return legacy_id ? legacy_id : runtime->mount(host, utf8(component), utf8(JSON::stringify(props)));
  } catch (const std::exception &error) {
    report_error(error.what());
    if (!bundle_loaded) stop();
    return 0;
  }
}
void FabricApplication::_process(double) { if (runtime) runtime->pump(true); }
void FabricApplication::_exit_tree() { stop(); }
void FabricApplication::system_theme_changed() { appearance->system_changed(); }
// The headless DisplayServer drops the Callable it is handed, so validation
// calls this copy of it as DisplayServer would; empty before registration.
Callable FabricApplication::validation_system_theme_callback() const {
  return system_theme_callable().value_or(Callable());
}
void FabricApplication::_notification(int what) {
  // The platform layers call MainLoop::notification for these OS events and
  // SceneTree::_notification propagates them to every node in the tree.
  switch (what) {
    case NOTIFICATION_APPLICATION_FOCUS_IN: app_state->focus(true); break;
    case NOTIFICATION_APPLICATION_FOCUS_OUT: app_state->focus(false); break;
    case NOTIFICATION_APPLICATION_PAUSED: app_state->pause(true); break;
    case NOTIFICATION_APPLICATION_RESUMED: app_state->pause(false); break;
    case NOTIFICATION_OS_MEMORY_WARNING: app_state->memory_warning(); break;
    // The accessibility update AccessKit asked for: the announcements waiting for it are published into it.
    case fabric_godot::notification_accessibility_update: accessibility_info->publish_announcements(); break;
    default: break;
  }
}
void FabricApplication::stop() {
  if (terminal_stopped) return;
  terminal_stopped = true;
  if (runtime) runtime->stop();
  else {
    game_services->stop();
    device_services->stop();
    accessibility_info->stop();
  }
  if (adapter_loader) {
    try { adapter_loader->registry()->dispose_modules(); }
    catch (const std::exception &error) { report_error(error.what()); }
  }
}
bool FabricApplication::deliver_url(const String &url) { return device_services->deliver_url(utf8(url)); }
bool FabricApplication::is_stopped() const { return terminal_stopped || (runtime && runtime->is_stopped()); }
String FabricApplication::evaluate(const String &source) { return runtime ? gd(runtime->evaluate(utf8(source))) : String("null"); }
String FabricApplication::snapshot() {
  folly::dynamic result = runtime ? folly::parseJson(runtime->status()) :
      folly::dynamic::object("stopped", terminal_stopped)("rootCount", 0)("bundleEvaluations", 0)
          ("gameServices", game_services->snapshot())("deviceServices", device_services->snapshot())
          ("accessibilityInfo", accessibility_info->snapshot())
          ("errors", folly::dynamic::array());
  result["runtimeInitialized"] = static_cast<bool>(runtime);
  result["initializationAttempted"] = initialization_attempted;
  result["appState"] = app_state->snapshot();
  result["systemAppearance"] = appearance->snapshot();
  result["systemThemeCallback"] = system_theme_owner().snapshot();
  if (adapter_loader) result["adapterLoader"] = adapter_loader->snapshot();
  for (const auto &error : pre_runtime_errors) result["errors"].push_back(error);
  return gd(folly::toJson(result));
}
void FabricApplication::report_error(const std::string &message) {
  if (runtime) runtime->report_error(message);
  else {
    pre_runtime_errors.push_back(message);
    UtilityFunctions::push_error(String("FABRIC_ERROR: ") + gd(message));
  }
}

void FabricApplication::invoke_callable(const String &name, const String &method, const Array &args) {
  try {
    if (!runtime) throw std::runtime_error("Callable module requires an initialized application");
    runtime->invoke_callable(utf8(name), utf8(method), utf8(JSON::stringify(args)));
  } catch (const std::exception &error) {
    report_error(error.what());
  }
}

Ref<GodotFabricBinding> FabricApplication::bind_signal(const String &name, const Signal &signal,
    const Array &arg_schema, const Dictionary &options) {
  try { return game_services->bind_signal(name, signal, arg_schema, options); }
  catch (const std::exception &error) {
    report_error(error.what());
    return {};
  }
}
Ref<GodotFabricBinding> FabricApplication::bind_state(const String &name, const Callable &getter,
    const Signal &changed, const Variant &value_schema, const Dictionary &options) {
  try { return game_services->bind_state(name, getter, changed, value_schema, options); }
  catch (const std::exception &error) {
    report_error(error.what());
    return {};
  }
}
Ref<GodotFabricBinding> FabricApplication::register_method(const String &name, const Callable &callable,
    const Array &arg_schema, const Variant &result_schema, const Dictionary &options) {
  try { return game_services->register_method(name, callable, arg_schema, result_schema, options); }
  catch (const std::exception &error) {
    report_error(error.what());
    return {};
  }
}
