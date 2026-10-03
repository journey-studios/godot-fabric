#pragma once
#include <godot_cpp/classes/node.hpp>
#include "game_service_registry.h"
#include <memory>
#include <vector>

class FabricSurface;
namespace fabric_godot { class ApplicationRuntime; }

// Experimental explicit owner. Final resource/editor authoring is still GF-28.
class FabricApplication : public godot::Node {
  GDCLASS(FabricApplication, godot::Node)
 public:
  FabricApplication();
  ~FabricApplication() override;
  void _process(double delta) override;
  void _exit_tree() override;
  godot::String evaluate(const godot::String &source);
  godot::String snapshot();
  void stop();
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
  int mount(FabricSurface &host, const godot::String &component, const godot::Dictionary &props);
  fabric_godot::ApplicationRuntime *get_runtime() const;
 protected:
  static void _bind_methods();
 private:
  godot::String bundle_path = "res://build/app.js";
  std::unique_ptr<fabric_godot::ApplicationRuntime> runtime;
  std::shared_ptr<fabric_godot::GameServiceRegistry> game_services;
  bool bundle_loaded = false;
  bool terminal_stopped = false;
  std::vector<std::string> pre_runtime_errors;
  void report_error(const std::string &message);
};
