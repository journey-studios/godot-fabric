#pragma once
#include <godot_cpp/classes/control.hpp>
#include <memory>
#include <godot_cpp/classes/input_event.hpp>

class FabricSurface : public godot::Control {
  GDCLASS(FabricSurface, godot::Control)
 public:
  FabricSurface();
  ~FabricSurface() override;
  void _ready() override;
  void _process(double delta) override;
  void _input(const godot::Ref<godot::InputEvent> &event) override;
  void _notification(int what);
  void _exit_tree() override;
  godot::String evaluate(const godot::String &source);
  godot::String snapshot();
  void stop();
  void activate(int tag);
  void change(const godot::String &text, int tag);
  void input_focus(bool focused, int tag);
  void input_submit(const godot::String &text, int tag);
  void input_key(const godot::Ref<godot::InputEvent> &event, int tag);
 protected:
  static void _bind_methods();
 private:
  struct Impl;
  std::unique_ptr<Impl> impl;
};
