#include "fabric_application.h"
#include "application_runtime.h"
#include "fabric_surface.h"
#include <godot_cpp/classes/file_access.hpp>
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/classes/json.hpp>
#include <godot_cpp/classes/viewport.hpp>
#include <godot_cpp/classes/window.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <folly/json.h>
#include <stdexcept>

using namespace godot;
static std::string utf8(const String &value) { return value.utf8().get_data(); }
static String gd(const std::string &value) { return String::utf8(value.c_str()); }

FabricApplication::FabricApplication() : game_services(std::make_shared<fabric_godot::GameServiceRegistry>()) {
  set_process_mode(PROCESS_MODE_ALWAYS); set_process(true);
}
FabricApplication::~FabricApplication() { stop(); }
void FabricApplication::_bind_methods() {
  ClassDB::bind_method(D_METHOD("evaluate", "source"), &FabricApplication::evaluate);
  ClassDB::bind_method(D_METHOD("snapshot"), &FabricApplication::snapshot);
  ClassDB::bind_method(D_METHOD("stop"), &FabricApplication::stop);
  ClassDB::bind_method(D_METHOD("invoke_callable", "name", "method", "args"), &FabricApplication::invoke_callable);
  ClassDB::bind_method(D_METHOD("bind_signal", "name", "signal", "arg_schema", "options"), &FabricApplication::bind_signal, DEFVAL(Dictionary()));
  ClassDB::bind_method(D_METHOD("bind_state", "name", "getter", "changed", "value_schema", "options"), &FabricApplication::bind_state, DEFVAL(Dictionary()));
  ClassDB::bind_method(D_METHOD("register_method", "name", "callable", "arg_schema", "result_schema", "options"), &FabricApplication::register_method, DEFVAL(Dictionary()));
  ClassDB::bind_method(D_METHOD("set_bundle_path", "path"), &FabricApplication::set_bundle_path);
  ClassDB::bind_method(D_METHOD("get_bundle_path"), &FabricApplication::get_bundle_path);
  ADD_PROPERTY(PropertyInfo(Variant::STRING, "bundle_path", PROPERTY_HINT_FILE, "*.js"), "set_bundle_path", "get_bundle_path");
}
void FabricApplication::set_bundle_path(const String &path) {
  if (runtime) { UtilityFunctions::push_error("FABRIC_ERROR: Bundle path cannot change after application initialization"); return; }
  bundle_path = path;
}
String FabricApplication::get_bundle_path() const { return bundle_path; }
fabric_godot::ApplicationRuntime *FabricApplication::get_runtime() const { return runtime.get(); }
int FabricApplication::mount(FabricSurface &host, const String &component, const Dictionary &props) {
  try {
    if (terminal_stopped) throw std::runtime_error("E_RUNTIME_STOPPED: Application cannot mount after stop");
    if (!runtime) {
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
            }
            return metrics;
          },
          utf8(scenario), get_instance_id(), game_services);
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
    if (!bundle_loaded && runtime) runtime->stop();
    return 0;
  }
}
void FabricApplication::_process(double) { if (runtime) runtime->pump(true); }
void FabricApplication::_exit_tree() { stop(); }
void FabricApplication::stop() {
  if (terminal_stopped) return;
  terminal_stopped = true;
  if (runtime) runtime->stop();
  else game_services->stop();
}
bool FabricApplication::is_stopped() const { return terminal_stopped || (runtime && runtime->is_stopped()); }
String FabricApplication::evaluate(const String &source) { return runtime ? gd(runtime->evaluate(utf8(source))) : String("null"); }
String FabricApplication::snapshot() {
  folly::dynamic result = runtime ? folly::parseJson(runtime->status()) :
      folly::dynamic::object("stopped", terminal_stopped)("rootCount", 0)("bundleEvaluations", 0)
          ("gameServices", game_services->snapshot())("errors", folly::dynamic::array());
  result["runtimeInitialized"] = static_cast<bool>(runtime);
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
