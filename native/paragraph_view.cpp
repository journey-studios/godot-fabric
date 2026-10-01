#include "paragraph_view.h"
#include <react/renderer/components/text/ParagraphShadowNode.h>

void GodotParagraph::apply(const facebook::react::ShadowView &shadow,
    const std::shared_ptr<fabric_godot::ParagraphLayout> &layout) {
  namespace rn = facebook::react;
  auto state = std::static_pointer_cast<const rn::ParagraphShadowNode::ConcreteState>(shadow.state);
  const auto &content = state->getData();
  const auto &frame = shadow.layoutMetrics;
  inset_ = {frame.contentInsets.left, frame.contentInsets.top};
  prepared_ = {};
  prepared_ = layout->prepare(content.attributedString,
      std::static_pointer_cast<const rn::ParagraphProps>(shadow.props)->paragraphAttributes,
      frame.getContentFrame().size.width);
  set_clip_contents(true);
  set_mouse_filter(MOUSE_FILTER_IGNORE);
  queue_redraw();
}
void GodotParagraph::_draw() {
  if (prepared_.paragraph.is_valid()) prepared_.draw(get_canvas_item(), inset_);
}
folly::dynamic GodotParagraph::snapshot() const { return prepared_.snapshot(); }
