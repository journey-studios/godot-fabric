#pragma once

#include "text_layout.h"
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/core/propsConversions.h>
#include <react/renderer/graphics/conversions.h>

namespace fabric_godot {
namespace rn = facebook::react;

// These are Godot platform components. They deliberately use Fabric's real
// ViewProps, Yoga node, immutable props parser and event emitter.
class ControlProps final : public rn::ViewProps {
 public:
  ControlProps() = default;
  ControlProps(const rn::PropsParserContext &context, const ControlProps &source,
               const rn::RawProps &raw)
      : rn::ViewProps(context, source, raw),
        kind(rn::convertRawProp(context, raw, "kind", source.kind, std::string("view"))),
        text(rn::convertRawProp(context, raw, "text", source.text, std::string())),
        svg(rn::convertRawProp(context, raw, "svg", source.svg, std::string())),
        fontSize(rn::convertRawProp(context, raw, "fontSize", source.fontSize, 18.0f)),
        color(rn::convertRawProp(context, raw, "color", source.color, rn::SharedColor())),
        disabled(rn::convertRawProp(context, raw, "disabled", source.disabled, false)),
        placeholder(rn::convertRawProp(context, raw, "placeholder", source.placeholder, std::string())),
        submitBehavior(rn::convertRawProp(context, raw, "submitBehavior", source.submitBehavior, std::string("blurAndSubmit"))) {}
  std::string kind{"view"};
  std::string text;
  std::string svg;
  float fontSize{18};
  rn::SharedColor color;
  bool disabled{false};
  std::string placeholder;
  std::string submitBehavior{"blurAndSubmit"};
};

class ControlEventEmitter final : public rn::ViewEventEmitter {
 public:
  using rn::ViewEventEmitter::ViewEventEmitter;
  void activate() const {
    dispatchEvent("activate", folly::dynamic::object(), rn::RawEvent::Category::Discrete);
  }
  void inputEvent(const std::string &name, folly::dynamic payload) const {
    dispatchEvent(name, std::move(payload), rn::RawEvent::Category::Discrete);
  }
};

inline constexpr char ControlName[] = "GodotControl";
class ControlShadowNode final
    : public rn::ConcreteViewShadowNode<ControlName, ControlProps, ControlEventEmitter> {
 public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;
  ControlShadowNode(const rn::ShadowNodeFragment &fragment,
      const rn::ShadowNodeFamily::Shared &family, rn::ShadowNodeTraits traits)
      : ConcreteViewShadowNode(fragment, family, textTraits(fragment, traits)) {}
  void setTextLayout(std::shared_ptr<TextLayout> layout) { text_layout_ = std::move(layout); }
  rn::Size measureContent(const rn::LayoutContext &, const rn::LayoutConstraints &constraints) const override {
    const auto &props = getConcreteProps();
    return text_layout_->measure(props.text, props.fontSize, constraints);
  }
 private:
  static rn::ShadowNodeTraits textTraits(const rn::ShadowNodeFragment &fragment, rn::ShadowNodeTraits traits) {
    if (fragment.props && (static_cast<const ControlProps &>(*fragment.props).kind == "text" ||
        static_cast<const ControlProps &>(*fragment.props).kind == "button")) {
      traits.set(rn::ShadowNodeTraits::Trait::LeafYogaNode);
      traits.set(rn::ShadowNodeTraits::Trait::MeasurableYogaNode);
    }
    return traits;
  }
  std::shared_ptr<TextLayout> text_layout_;

};
class ControlDescriptor final : public rn::ConcreteComponentDescriptor<ControlShadowNode> {
 public:
  using ConcreteComponentDescriptor::ConcreteComponentDescriptor;
 protected:
  void adopt(rn::ShadowNode &node) const override {
    ConcreteComponentDescriptor::adopt(node);
    static_cast<ControlShadowNode &>(node).setTextLayout(
        contextContainer_->at<std::shared_ptr<TextLayout>>("GodotTextLayout"));
  }
};
} // namespace fabric_godot
