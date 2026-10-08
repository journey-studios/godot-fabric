#include "modal_presentation.h"

#include <godot_cpp/core/object.hpp>
#include <stdexcept>

namespace fabric_godot {
namespace rn = facebook::react;

ModalPresentation::ModalPresentation(godot::Ref<ModalWindowStack> stack,
    ModalWindowStack::Owner identity)
    : stack_(std::move(stack)), identity_(identity) {}

std::shared_ptr<ModalPresentation> ModalPresentation::create(
    godot::Window &owner, ModalWindowStack::Owner identity,
    const godot::Vector2 &size) {
  auto stack = ModalWindowStack::for_window(owner);
  stack->create(owner, identity, size);
  return std::shared_ptr<ModalPresentation>(new ModalPresentation(std::move(stack), identity));
}

ModalPresentation::~ModalPresentation() { destroy(); }

godot::Window *ModalPresentation::window() const {
  return stack_.is_valid() ? stack_->window(identity_) : nullptr;
}

bool ModalPresentation::visible() const {
  auto *current = window();
  return current && current->is_visible();
}

bool ModalPresentation::present() {
  return stack_.is_valid() && stack_->present(identity_);
}

void ModalPresentation::hide() {
  if (stack_.is_valid()) stack_->hide(identity_);
}

bool ModalPresentation::apply(const rn::ModalHostViewProps &props,
    const godot::Vector2 &size) {
  if (props.animationType != rn::ModalHostViewAnimationType::None)
    throw std::runtime_error("E_MODAL_ANIMATION: Godot Modal supports animationType none");
  if (props.presentationStyle != rn::ModalHostViewPresentationStyle::FullScreen &&
      props.presentationStyle != rn::ModalHostViewPresentationStyle::OverFullScreen)
    throw std::runtime_error("E_MODAL_PRESENTATION: Godot Modal supports fullScreen and overFullScreen");
  if (props.statusBarTranslucent || props.navigationBarTranslucent ||
      props.hardwareAccelerated || props.allowSwipeDismissal)
    throw std::runtime_error("E_MODAL_PROP: requested behavior requires an unsupported mobile host feature");
  if (!resize(size)) return false;
  auto *current = window();
  if (!current) return false;
  current->set_flag(godot::Window::FLAG_TRANSPARENT, props.transparent);
  return window() != nullptr;
}

bool ModalPresentation::resize(const godot::Vector2 &size) {
  auto *current = window();
  if (!current || size.x <= 0 || size.y <= 0 || !size.is_finite()) return false;
  current->set_size(godot::Vector2i(static_cast<int32_t>(size.x),
      static_cast<int32_t>(size.y)));
  return window() != nullptr;
}

void ModalPresentation::destroy() {
  if (stack_.is_valid()) stack_->destroy(identity_);
}

}  // namespace fabric_godot
