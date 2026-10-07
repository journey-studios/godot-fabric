#pragma once

#include "window_metrics.h"
#include <react/renderer/components/modal/ModalHostViewComponentDescriptor.h>
#include <cmath>
#include <stdexcept>

namespace fabric_godot {
namespace rn = facebook::react;

inline constexpr char modal_window_metrics_context[] = "GodotWindowMetrics";

class ModalHostViewComponentDescriptor final
    : public rn::ConcreteComponentDescriptor<rn::ModalHostViewShadowNode> {
 public:
  explicit ModalHostViewComponentDescriptor(
      const rn::ComponentDescriptorParameters &parameters)
      : rn::ConcreteComponentDescriptor<rn::ModalHostViewShadowNode>(parameters),
        upstream_(parameters) {}

  rn::State::Shared createInitialState(
      const rn::Props::Shared &,
      const rn::ShadowNodeFamily::Shared &family) const override {
    const auto metrics = contextContainer_->at<std::shared_ptr<WindowMetricsSnapshot>>(
        modal_window_metrics_context);
    const auto snapshot = metrics ? metrics->get() : WindowMetrics{};
    if (snapshot.size.x <= 0 || snapshot.size.y <= 0 ||
        !std::isfinite(snapshot.size.x) || !std::isfinite(snapshot.size.y))
      throw std::runtime_error("E_MODAL_WINDOW_METRICS: Modal requires positive host Window dimensions");
    auto state = std::make_shared<const rn::ModalHostViewState>(rn::Size{
        .width = static_cast<rn::Float>(snapshot.size.x),
        .height = static_cast<rn::Float>(snapshot.size.y)});
    return std::make_shared<rn::ModalHostViewShadowNode::ConcreteState>(
        std::move(state), family);
  }

  void adopt(rn::ShadowNode &node) const override {
    upstream_.adopt(node);
  }

 private:
  rn::ModalHostViewComponentDescriptor upstream_;
};
}  // namespace fabric_godot
