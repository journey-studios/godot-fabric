#pragma once
#include <godot_cpp/classes/control.hpp>
#include <memory>
#include <godot_cpp/classes/input_event.hpp>
#include <godot_cpp/variant/node_path.hpp>

class FabricApplication;

class FabricSurface : public godot::Control {
  GDCLASS(FabricSurface, godot::Control)
 public:
  FabricSurface();
  ~FabricSurface() override;
  void _ready() override;
  void _input(const godot::Ref<godot::InputEvent> &event) override;
  void _notification(int what);
  void _exit_tree() override;
  godot::String evaluate(const godot::String &source);
  godot::String snapshot();
  void stop();
  bool mount();
  void unmount();
  void update_props(const godot::Dictionary &props);
  void set_application_path(const godot::NodePath &path);
  godot::NodePath get_application_path() const;
  void set_component_name(const godot::String &name);
  godot::String get_component_name() const;
  void set_initial_props(const godot::Dictionary &props);
  godot::Dictionary get_initial_props() const;
  int get_surface_id() const;
  void native_unmounted(const godot::String &state);
  void activate(int tag);
  void change(const godot::String &text, int tag);
  void input_focus(bool focused, int tag);
  void input_submit(const godot::String &text, int tag);
  void input_key(const godot::Ref<godot::InputEvent> &event, int tag);
 protected:
  static void _bind_methods();
 private:
  FabricApplication *application() const;
  godot::NodePath application_path;
  godot::String component_name;
  godot::Dictionary initial_props;
  uint64_t application_id = 0;
  int surface_id = 0;
  godot::String retired_state = R"({"surfaceId":0,"state":"unmounted","stopped":false,"applicationStopped":false,"nodes":[],"nativeTags":0,"errors":[],"pendingTimers":0,"pendingWork":0,"pendingAnimationFrames":0})";
};
