#pragma once

#include "modal_window_stack.h"
#include <react/renderer/components/FBReactNativeSpec/Props.h>
#include <memory>

namespace fabric_godot {

class ModalPresentation final {
 public:
  static std::shared_ptr<ModalPresentation> create(
      godot::Window &owner, ModalWindowStack::Owner identity,
      const godot::Vector2 &size);
  ~ModalPresentation();

  godot::Window *window() const;
  bool visible() const;
  bool present();
  void hide();
  bool apply(const facebook::react::ModalHostViewProps &props,
             const godot::Vector2 &size);
  bool resize(const godot::Vector2 &size);
  void destroy();

 private:
  ModalPresentation(godot::Ref<ModalWindowStack> stack,
                    ModalWindowStack::Owner identity);

  godot::Ref<ModalWindowStack> stack_;
  ModalWindowStack::Owner identity_;
};

}  // namespace fabric_godot
