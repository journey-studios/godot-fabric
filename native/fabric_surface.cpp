#include "fabric_surface.h"
#include "fabric_application.h"
#include "application_runtime.h"
#include <godot_cpp/classes/json.hpp>
#include <godot_cpp/classes/scene_tree.hpp>
#include <godot_cpp/classes/window.hpp>
#include <godot_cpp/core/object.hpp>
#include <godot_cpp/variant/utility_functions.hpp>

using namespace godot;
static std::string utf8(const String &value) { return value.utf8().get_data(); }
static String gd(const std::string &value) { return String::utf8(value.c_str()); }

FabricSurface::FabricSurface() = default;
FabricSurface::~FabricSurface() { unmount(); }
FabricApplication *FabricSurface::application() const {
  return Object::cast_to<FabricApplication>(ObjectDB::get_instance(application_id));
}
void FabricSurface::_bind_methods() {
  ClassDB::bind_method(D_METHOD("evaluate", "source"), &FabricSurface::evaluate);
  ClassDB::bind_method(D_METHOD("snapshot"), &FabricSurface::snapshot);
  ClassDB::bind_method(D_METHOD("stop"), &FabricSurface::stop);
  ClassDB::bind_method(D_METHOD("mount"), &FabricSurface::mount);
  ClassDB::bind_method(D_METHOD("unmount"), &FabricSurface::unmount);
  ClassDB::bind_method(D_METHOD("update_props", "props"), &FabricSurface::update_props);
  ClassDB::bind_method(D_METHOD("get_surface_id"), &FabricSurface::get_surface_id);
  ClassDB::bind_method(D_METHOD("set_application_path", "path"), &FabricSurface::set_application_path);
  ClassDB::bind_method(D_METHOD("get_application_path"), &FabricSurface::get_application_path);
  ClassDB::bind_method(D_METHOD("set_component_name", "name"), &FabricSurface::set_component_name);
  ClassDB::bind_method(D_METHOD("get_component_name"), &FabricSurface::get_component_name);
  ClassDB::bind_method(D_METHOD("set_initial_props", "props"), &FabricSurface::set_initial_props);
  ClassDB::bind_method(D_METHOD("get_initial_props"), &FabricSurface::get_initial_props);
  ADD_PROPERTY(PropertyInfo(Variant::NODE_PATH, "application_path"), "set_application_path", "get_application_path");
  ADD_PROPERTY(PropertyInfo(Variant::STRING, "component_name"), "set_component_name", "get_component_name");
  ADD_PROPERTY(PropertyInfo(Variant::DICTIONARY, "initial_props"), "set_initial_props", "get_initial_props");
  ClassDB::bind_method(D_METHOD("activate", "tag"), &FabricSurface::activate);
  ClassDB::bind_method(D_METHOD("change", "text", "tag"), &FabricSurface::change);
  ClassDB::bind_method(D_METHOD("input_focus", "focused", "tag"), &FabricSurface::input_focus);
  ClassDB::bind_method(D_METHOD("input_submit", "text", "tag"), &FabricSurface::input_submit);
  ClassDB::bind_method(D_METHOD("input_key", "event", "tag"), &FabricSurface::input_key);
}
void FabricSurface::_ready() { mount(); }
bool FabricSurface::mount() {
  if (surface_id) return true;
  if (!is_inside_tree()) return false;
  bool pending_implicit_owner = false;
  auto *owner = application();
  if (owner && application_path.is_empty() && owner->is_stopped()) {
    application_id = 0;
    owner = nullptr;
  }
  if (!owner && !application_path.is_empty())
    owner = Object::cast_to<FabricApplication>(get_node_or_null(application_path));
  if (!owner && application_path.is_empty()) {
    // Compatibility for single-root fixtures. The application still owns the
    // runtime and survives outside the scene; new UI uses registered entries.
    auto *root = get_tree()->get_root();
    owner = Object::cast_to<FabricApplication>(root->get_node_or_null(NodePath("_FabricApplication")));
    if (!owner && get_tree()->has_meta("_fabric_application_id"))
      owner = Object::cast_to<FabricApplication>(ObjectDB::get_instance(static_cast<uint64_t>(get_tree()->get_meta("_fabric_application_id"))));
    if (owner && owner->is_stopped()) {
      const auto id = owner->get_instance_id();
      owner->set_name(String("_FabricApplicationRetired_") + String::num_uint64(id));
      owner->queue_free();
      if (get_tree()->has_meta("_fabric_application_id") &&
          static_cast<uint64_t>(get_tree()->get_meta("_fabric_application_id")) == id)
        get_tree()->remove_meta("_fabric_application_id");
      owner = nullptr;
    }
    if (!owner) {
      owner = memnew(FabricApplication);
      owner->set_name("_FabricApplication");
      get_tree()->set_meta("_fabric_application_id", owner->get_instance_id());
      // _ready can run while the SceneTree root is adding a scene. Defer both
      // insertion and mounting; never create an off-tree runtime owner.
      root->call_deferred("add_child", owner);
      pending_implicit_owner = true;
    }
  }
  if (!owner) { UtilityFunctions::push_error("FABRIC_ERROR: application_path must point to FabricApplication"); return false; }
  if (component_name.is_empty()) set_anchors_and_offsets_preset(PRESET_FULL_RECT);
  application_id = owner->get_instance_id();
  if (!owner->is_inside_tree()) {
    if (pending_implicit_owner) call_deferred("mount");
    else UtilityFunctions::push_error("FABRIC_ERROR: FabricApplication must be inside the SceneTree");
    return false;
  }
  surface_id = owner->mount(*this, component_name, initial_props);
  return surface_id != 0;
}
void FabricSurface::unmount() {
  if (!surface_id) return;
  if (auto *owner = application(); owner && owner->get_runtime()) owner->get_runtime()->unmount(surface_id);
  surface_id = 0;
}
void FabricSurface::stop() {
  // Preserve old validation APIs which explicitly terminate an anonymous app.
  // Registered surfaces only unmount; application.stop() owns global shutdown.
  if (component_name.is_empty()) { if (auto *owner = application()) owner->stop(); }
  else unmount();
}
void FabricSurface::native_unmounted(const String &state) { retired_state = state; surface_id = 0; }
void FabricSurface::_exit_tree() {
  if (component_name.is_empty()) stop();
  else unmount();
  request_ready();
}
void FabricSurface::update_props(const Dictionary &props) {
  if (!surface_id) { initial_props = props; return; }
  if (auto *owner = application(); surface_id && owner && owner->get_runtime()) {
    try { owner->get_runtime()->update_props(surface_id, utf8(JSON::stringify(props))); initial_props = props; }
    catch (const std::exception &error) { UtilityFunctions::push_error(String("FABRIC_ERROR: ") + gd(error.what())); }
  }
}
void FabricSurface::set_application_path(const NodePath &path) {
  if (surface_id) { UtilityFunctions::push_error("FABRIC_ERROR: Unmount before changing application_path"); return; }
  application_path = path; application_id = 0;
}
NodePath FabricSurface::get_application_path() const { return application_path; }
void FabricSurface::set_component_name(const String &name) {
  if (surface_id) { UtilityFunctions::push_error("FABRIC_ERROR: Unmount before changing component_name"); return; }
  component_name = name;
}
String FabricSurface::get_component_name() const { return component_name; }
void FabricSurface::set_initial_props(const Dictionary &props) {
  if (surface_id) update_props(props);
  else initial_props = props;
}
Dictionary FabricSurface::get_initial_props() const { return initial_props; }
int FabricSurface::get_surface_id() const { return surface_id; }
String FabricSurface::evaluate(const String &source) { if (auto *owner = application()) return owner->evaluate(source); return "null"; }
String FabricSurface::snapshot() {
  if (auto *owner = application(); owner && owner->get_runtime())
    return gd(owner->get_runtime()->snapshot(surface_id, utf8(retired_state)));
  return retired_state;
}
void FabricSurface::_input(const Ref<InputEvent> &event) {
  if (!surface_id) return;
  if (has_meta("validation_input_device") &&
      (event->is_class("InputEventMouse") || event->is_class("InputEventScreenTouch") || event->is_class("InputEventScreenDrag")) &&
      event->get_device() != static_cast<int>(get_meta("validation_input_device"))) {
    get_viewport()->set_input_as_handled(); return;
  }
  if (auto *owner = application(); owner && owner->get_runtime() && owner->get_runtime()->input(surface_id, event))
    get_viewport()->set_input_as_handled();
}
void FabricSurface::_notification(int what) {
  if (what == NOTIFICATION_WM_WINDOW_FOCUS_OUT && !has_meta("validation_input_device"))
    if (auto *owner = application(); surface_id && owner && owner->get_runtime()) owner->get_runtime()->cancel(surface_id);
}
void FabricSurface::activate(int tag) { if (auto *owner = application(); owner && owner->get_runtime()) owner->get_runtime()->activate(surface_id, tag); }
void FabricSurface::change(const String &text, int tag) { if (auto *owner = application(); owner && owner->get_runtime()) owner->get_runtime()->change(surface_id, text, tag); }
void FabricSurface::input_focus(bool focused, int tag) { if (auto *owner = application(); owner && owner->get_runtime()) owner->get_runtime()->focus(surface_id, focused, tag); }
void FabricSurface::input_submit(const String &, int tag) { if (auto *owner = application(); owner && owner->get_runtime()) owner->get_runtime()->submit(surface_id, tag); }
void FabricSurface::input_key(const Ref<InputEvent> &event, int tag) { if (auto *owner = application(); owner && owner->get_runtime()) owner->get_runtime()->key(surface_id, event, tag); }
