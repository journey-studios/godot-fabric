#include "godot_dom.h"
#include <react/renderer/bridging/bridging.h>
#include <react/renderer/uimanager/UIManagerBinding.h>
#include <cmath>
#include <limits>

namespace fabric_godot {
namespace rn = facebook::react;
namespace jsi = facebook::jsi;

GodotDOM::GodotDOM(std::shared_ptr<rn::CallInvoker> invoker, Project project, Authority authority)
    : rn::NativeDOM(std::move(invoker)), project_(std::move(project)), authority_(std::move(authority)) {
  methodMap_["compareDocumentPosition"] = {2, compare_position};
  methodMap_["getBoundingClientRect"] = {2, bounding_rect};
  methodMap_["measureInWindow"] = {2, measure_window};
  methodMap_["hasPointerCapture"] = {2, has_capture};
  methodMap_["setPointerCapture"] = {2, set_capture};
  methodMap_["releasePointerCapture"] = {2, release_capture};
}

jsi::Value GodotDOM::capture(jsi::Runtime &rt, rn::TurboModule &module,
    const jsi::Value *args, size_t count, int operation) {
  if (count != 2 || !args[1].isNumber())
    throw jsi::JSError(rt, "Pointer capture requires a node and signed 32-bit pointer ID");
  const auto pointer = args[1].getNumber();
  if (!std::isfinite(pointer) || pointer != std::floor(pointer) ||
      pointer < std::numeric_limits<int32_t>::min() || pointer > std::numeric_limits<int32_t>::max())
    throw jsi::JSError(rt, "Pointer capture requires a signed 32-bit pointer ID");
  auto &self = static_cast<GodotDOM &>(module);
  auto node = rn::Bridging<std::shared_ptr<const rn::ShadowNode>>::fromJs(rt, args[0]);
  auto &binding = *rn::UIManagerBinding::getBinding(rt);
  binding.getPointerEventsProcessor().clearDisconnectedCaptureTargetsForGodot(binding.getUIManager());
  // A retained logical ref may still be connected while its native root is
  // stopping. Neither that interval nor a removed family may regain capture.
  if (!node || !self.authority_(*node) || !self.isConnected(rt, jsi::Value(rt, args[0])))
    return operation == 0 ? jsi::Value(false) : jsi::Value::undefined();
  if (operation == 0) return jsi::Value(self.hasPointerCapture(rt, node, pointer));
  if (operation == 1) self.setPointerCapture(rt, node, pointer);
  else self.releasePointerCapture(rt, node, pointer);
  return jsi::Value::undefined();
}

jsi::Value GodotDOM::has_capture(jsi::Runtime &rt, rn::TurboModule &module,
    const jsi::Value *args, size_t count) { return capture(rt, module, args, count, 0); }
jsi::Value GodotDOM::set_capture(jsi::Runtime &rt, rn::TurboModule &module,
    const jsi::Value *args, size_t count) { return capture(rt, module, args, count, 1); }
jsi::Value GodotDOM::release_capture(jsi::Runtime &rt, rn::TurboModule &module,
    const jsi::Value *args, size_t count) { return capture(rt, module, args, count, 2); }

jsi::Value GodotDOM::compare_position(jsi::Runtime &rt, rn::TurboModule &module,
    const jsi::Value *args, size_t count) {
  if (count != 2) throw jsi::JSError(rt, "compareDocumentPosition requires two nodes");
  auto &self = static_cast<GodotDOM &>(module);
  // Upstream 0.87.1 assumes a document operand's revision still exists.
  // A Godot root can unmount while another root retains that document.
  if (!self.isConnected(rt, jsi::Value(rt, args[0])) ||
      !self.isConnected(rt, jsi::Value(rt, args[1])))
    return jsi::Value(static_cast<double>(rn::dom::DOCUMENT_POSITION_DISCONNECTED));
  return jsi::Value(self.compareDocumentPosition(rt, jsi::Value(rt, args[0]), jsi::Value(rt, args[1])));
}

jsi::Value GodotDOM::bounding_rect(jsi::Runtime &rt, rn::TurboModule &module,
    const jsi::Value *args, size_t count) {
  if (count != 2 || !args[1].isBool())
    throw jsi::JSError(rt, "getBoundingClientRect requires a node and transform flag");
  auto &self = static_cast<GodotDOM &>(module);
  auto node = rn::Bridging<std::shared_ptr<const rn::ShadowNode>>::fromJs(rt, args[0]);
  if (!node) return jsi::Array::createWithElements(rt, 0, 0, 0, 0);
  // Keep tree ancestry, boundary selection and layout on one immutable Fabric
  // revision. RN's canonical relative-layout function stops at RootNodeKind.
  auto &ui = rn::UIManagerBinding::getBinding(rt)->getUIManager();
  auto revision = ui.getShadowTreeRevisionProvider()->getCurrentRevision(node->getSurfaceId());
  auto embedding = PhysicalEmbedding::capture(std::move(revision), *node);
  if (!embedding) return jsi::Array::createWithElements(rt, 0, 0, 0, 0);
  auto rect = embedding->bounding_rect(args[1].getBool());
  // A legitimate zero-sized layout still has a meaningful origin. RN's
  // EmptyLayoutMetrics sentinel, rather than the rect dimensions, distinguishes
  // an unmeasurable or display:none node from a mounted 0×0 View.
  if (embedding->has_layout(args[1].getBool()))
    rect = self.project_(*embedding, rect, args[1].getBool());
  return jsi::Array::createWithElements(rt, rect.x, rect.y, rect.width, rect.height);
}

jsi::Value GodotDOM::measure_window(jsi::Runtime &rt, rn::TurboModule &module,
    const jsi::Value *args, size_t count) {
  if (count != 2 || !args[1].isObject() || !args[1].asObject(rt).isFunction(rt))
    throw jsi::JSError(rt, "measureInWindow requires a node and callback");
  jsi::Value parameters[] = {jsi::Value(rt, args[0]), jsi::Value(true)};
  auto rect = bounding_rect(rt, module, parameters, 2).asObject(rt).asArray(rt);
  args[1].asObject(rt).asFunction(rt).call(rt,
      rect.getValueAtIndex(rt, 0), rect.getValueAtIndex(rt, 1),
      rect.getValueAtIndex(rt, 2), rect.getValueAtIndex(rt, 3));
  return jsi::Value::undefined();
}
}
