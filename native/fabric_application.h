#pragma once
#include <godot_cpp/classes/node.hpp>
#include <memory>

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
  bool bundle_loaded = false;
};
