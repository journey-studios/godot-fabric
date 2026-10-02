#include "fabric_application.h"
#include "application_runtime.h"
#include "fabric_surface.h"
#include <godot_cpp/classes/file_access.hpp>
#include <godot_cpp/classes/json.hpp>
#include <godot_cpp/classes/viewport.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <stdexcept>

using namespace godot;
static std::string utf8(const String &value) { return value.utf8().get_data(); }
static String gd(const std::string &value) { return String::utf8(value.c_str()); }

FabricApplication::FabricApplication() { set_process_mode(PROCESS_MODE_ALWAYS); set_process(true); }
FabricApplication::~FabricApplication() { stop(); }
void FabricApplication::_bind_methods() {
  ClassDB::bind_method(D_METHOD("evaluate", "source"), &FabricApplication::evaluate);
  ClassDB::bind_method(D_METHOD("snapshot"), &FabricApplication::snapshot);
  ClassDB::bind_method(D_METHOD("stop"), &FabricApplication::stop);
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
    if (!runtime) {
      const auto scenario = get_meta("scenario", host.get_meta("scenario", "react"));
      runtime = std::make_unique<fabric_godot::ApplicationRuntime>(host,
          [this]() { return get_viewport() ? get_viewport()->get_visible_rect().size : Vector2(); },
          utf8(scenario), get_instance_id());
    }
    int legacy_id = 0;
    if (!bundle_loaded) {
      // Legacy demo bundles render root 1 themselves. Named entries instead
      // register first, then mount through the original AppRegistry binding.
      if (component.is_empty()) legacy_id = runtime->mount(host, "", "{}");
      if (!FileAccess::file_exists(bundle_path)) throw std::runtime_error("Missing application bundle; run npm run bundle");
      const auto bundle = FileAccess::get_file_as_string(bundle_path);
      if (bundle.is_empty()) throw std::runtime_error("Missing application bundle; run npm run bundle");
      runtime->load_bundle(utf8(bundle));
      bundle_loaded = true;
    }
    return legacy_id ? legacy_id : runtime->mount(host, utf8(component), utf8(JSON::stringify(props)));
  } catch (const std::exception &error) {
    if (runtime) runtime->report_error(error.what());
    else UtilityFunctions::push_error(String("FABRIC_ERROR: ") + gd(error.what()));
    if (!bundle_loaded && runtime) runtime->stop();
    return 0;
  }
}
void FabricApplication::_process(double) { if (runtime) runtime->pump(true); }
void FabricApplication::_exit_tree() { stop(); }
void FabricApplication::stop() { if (runtime) runtime->stop(); }
bool FabricApplication::is_stopped() const { return runtime && runtime->is_stopped(); }
String FabricApplication::evaluate(const String &source) { return runtime ? gd(runtime->evaluate(utf8(source))) : String("null"); }
String FabricApplication::snapshot() { return runtime ? gd(runtime->status()) : String("{}"); }
