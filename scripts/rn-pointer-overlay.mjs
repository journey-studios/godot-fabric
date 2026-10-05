// Pinned native lifetime fixes; the downloaded RN sources remain immutable.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const base = 'react/renderer/uimanager/PointerEventsProcessor';
const bindingBase = 'react/renderer/uimanager/UIManagerBinding';
const pins = {
  h: 'e730cf3d93f5bb494d8503ea28a153f476535eb44d6c65ec51dd358c90f9672b',
  cpp: '5b7c58cab65034fab387db19c299905fae18d22b85c9d75038bcd40bd3dad739',
  bindingH: '8fb51ebce77ff24658cd722e2f9c700aaaf9aeb8ae25dddf0047ad1b79b9524b',
  bindingCpp: 'c9b31e0dacfce08c985dd4ecefa0bde29ec8b1acc6041e1e28b4aebe79687e4b',
};
const inputNames = {h: base + '.h', cpp: base + '.cpp', bindingH: bindingBase + '.h', bindingCpp: bindingBase + '.cpp'};
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('E_POINTER_OVERLAY_SPAN: expected one pinned span');
  return source.replace(before, after);
}

export function renderPointerOverlay(header, source, bindingHeader, bindingSource) {
  for (const [extension, content] of [['h', header], ['cpp', source], ['bindingH', bindingHeader], ['bindingCpp', bindingSource]])
    if (hash(content) !== pins[extension]) throw new Error('E_POINTER_OVERLAY_INPUT: RN 0.87.1 ' + extension + ' hash mismatch');
  header = replaceOnce(header, '#include <functional>', '#include <array>\n#include <cstddef>\n#include <functional>');
  header = replaceOnce(header, ' private:\n', `  // Godot calls these only on its serialized Hermes/native host thread.
  void removePointerForGodot(PointerIdentifier pointerId);
  void clearDisconnectedCaptureTargetsForGodot(const UIManager &uiManager);
  void clearCaptureTargetsForSurfaceForGodot(SurfaceId surfaceId);
  // Active pointers, pending capture, active capture, hover trackers.
  std::array<std::size_t, 4> pointerStateCountsForGodot() const;
  using GodotListenerInterest = std::function<bool(const ShadowNode &, std::size_t)>;
  void setListenerInterestForGodot(GodotListenerInterest interest) {
    godotListenerInterest_ = std::move(interest);
  }

 private:
  GodotListenerInterest godotListenerInterest_;
  // A callback can retire one pointer while its original intercept is running.
  std::unordered_map<PointerIdentifier, std::shared_ptr<bool>> godotPointerLifetimes_;
`);
  source = replaceOnce(source, 'namespace facebook::react {', `namespace facebook::react {

namespace {
struct GodotPointerRetired final {};
}

// The default callback is empty. The opt-in SDK query reads existing original
// EventTarget Maps without creating refs, dispatching events or cloning props.
static bool hasPointerInterestForGodot(
    const ShadowNode &target, const UIManager &uiManager,
    const PointerEventsProcessor::GodotListenerInterest &query,
    const std::array<ViewEvents::Offset, 2> &offsets) {
  if (!query) return false;
  auto interested = [&query, &offsets](const ShadowNode &node) {
    return query(node, static_cast<std::size_t>(offsets[0])) ||
        query(node, static_cast<std::size_t>(offsets[1]));
  };
  if (interested(target)) return true;
  std::shared_ptr<const ShadowNode> root;
  uiManager.getShadowTreeRegistry().visit(target.getSurfaceId(), [&root](const ShadowTree &tree) {
    root = tree.getCurrentRevision().rootShadowNode;
  });
  // All JS queries run after the registry's visit lock has been released.
  if (!root) return false;
  const auto ancestors = target.getFamily().getAncestors(*root);
  for (auto it = ancestors.rbegin(); it != ancestors.rend(); ++it)
    if (interested(it->first.get())) return true;
  return false;
}

void PointerEventsProcessor::removePointerForGodot(PointerIdentifier pointerId) {
  if (auto found = godotPointerLifetimes_.find(pointerId); found != godotPointerLifetimes_.end()) {
    *found->second = false;
    godotPointerLifetimes_.erase(found);
  }
  activePointers_.erase(pointerId);
  pendingPointerCaptureTargetOverrides_.erase(pointerId);
  activePointerCaptureTargetOverrides_.erase(pointerId);
  previousHoverTrackersPerPointer_.erase(pointerId);
}

void PointerEventsProcessor::clearDisconnectedCaptureTargetsForGodot(const UIManager &uiManager) {
  for (auto *registry : {&pendingPointerCaptureTargetOverrides_, &activePointerCaptureTargetOverrides_}) {
    for (auto it = registry->begin(); it != registry->end();) {
      const auto target = it->second.lock();
      if (!target || !uiManager.getNewestCloneOfShadowNode(*target)) it = registry->erase(it);
      else ++it;
    }
  }
}

void PointerEventsProcessor::clearCaptureTargetsForSurfaceForGodot(SurfaceId surfaceId) {
  std::unordered_set<PointerIdentifier> affected;
  for (auto *registry : {&pendingPointerCaptureTargetOverrides_, &activePointerCaptureTargetOverrides_}) {
    for (auto it = registry->begin(); it != registry->end();) {
      const auto target = it->second.lock();
      if (target && target->getSurfaceId() == surfaceId) {
        affected.insert(it->first);
        it = registry->erase(it);
      } else ++it;
    }
  }
  for (auto pointerId : affected) {
    if (auto found = godotPointerLifetimes_.find(pointerId); found != godotPointerLifetimes_.end()) {
      *found->second = false;
      godotPointerLifetimes_.erase(found);
    }
    // The native contact can belong to another, surviving surface. Retire its
    // capture/hover continuation without unregistering that physical contact.
    previousHoverTrackersPerPointer_.erase(pointerId);
  }
}

std::array<std::size_t, 4> PointerEventsProcessor::pointerStateCountsForGodot() const {
  return {activePointers_.size(), pendingPointerCaptureTargetOverrides_.size(),
      activePointerCaptureTargetOverrides_.size(), previousHoverTrackersPerPointer_.size()};
}`);
  source = replaceOnce(source, '#include "PointerEventsProcessor.h"', '#include "PointerEventsProcessor.h"\n\n#include <folly/ScopeGuard.h>\n#include <unordered_set>');
  source = replaceOnce(source,
    '  // TODO: is dereferencing latestNodeToTarget without null checking safe?\n  auto latestNodeToTarget = uiManager.getNewestCloneOfShadowNode(nodeToTarget);',
    '  auto latestNodeToTarget = uiManager.getNewestCloneOfShadowNode(nodeToTarget);\n  if (!latestNodeToTarget) return {};');
  source = replaceOnce(source,
    '    const DispatchEvent& eventDispatcher,\n    const UIManager& uiManager) {\n  // Process all pending pointer capture assignments',
    `    const DispatchEvent& originalDispatcher,
    const UIManager& uiManager) {
  clearDisconnectedCaptureTargetsForGodot(uiManager);
  auto [lifetimeIt, inserted] = godotPointerLifetimes_.try_emplace(event.pointerId, nullptr);
  if (inserted) lifetimeIt->second = std::make_shared<bool>(true);
  auto lifetime = lifetimeIt->second;
  SCOPE_EXIT {
    auto current = godotPointerLifetimes_.find(event.pointerId);
    if (!activePointers_.contains(event.pointerId) &&
        !previousHoverTrackersPerPointer_.contains(event.pointerId) &&
        current != godotPointerLifetimes_.end() && current->second == lifetime)
      godotPointerLifetimes_.erase(current);
  };
  const DispatchEvent eventDispatcher = [this, &originalDispatcher, &uiManager, lifetime, pointerId = event.pointerId](
      const ShadowNode &node, const std::string &eventType,
      ReactEventPriority eventPriority, const EventPayload &payload) {
    if (!*lifetime) throw GodotPointerRetired{};
    // A preceding callback may have deleted this event's next hover/capture node.
    auto current = uiManager.getNewestCloneOfShadowNode(node);
    if (current) {
      try { originalDispatcher(*current, eventType, eventPriority, payload); }
      catch (...) {
        // The original hover algorithm temporarily moves its previous tracker
        // out of the registry. A throwing listener must not leave that entry
        // null, retain capture, or become active again without a new Down.
        removePointerForGodot(pointerId);
        throw;
      }
    }
    if (!*lifetime) throw GodotPointerRetired{};
  };
  try {
  // Process all pending pointer capture assignments`);
  source = replaceOnce(source,
    '    pointerEvent = retargeted.event;\n    targetNode = retargeted.target;',
    '    if (retargeted.target) {\n      pointerEvent = retargeted.event;\n      targetNode = retargeted.target;\n    } else {\n      clearDisconnectedCaptureTargetsForGodot(uiManager);\n    }');
  source = replaceOnce(source,
    '      overrideTarget->getTag() != targetNode->getTag()) {',
    '      (!targetNode || overrideTarget->getTag() != targetNode->getTag())) {');
  source = replaceOnce(source,
    '  if (type == "topClick") {',
    '  // Capture notifications may commit removal of the native hit target.\n  if (targetNode) targetNode = uiManager.getNewestCloneOfShadowNode(*targetNode);\n  if (!targetNode && type == "topPointerDown") return;\n\n  if (type == "topClick") {\n    if (!targetNode) return;');
  source = replaceOnce(source,
    '    if (shouldEmitPointerEvent(*targetNode, type, uiManager)) {',
    `    if (targetNode && (shouldEmitPointerEvent(*targetNode, type, uiManager) ||
        (type == "topPointerDown" && hasPointerInterestForGodot(
            *targetNode, uiManager, godotListenerInterest_,
            {ViewEvents::Offset::PointerDown, ViewEvents::Offset::PointerDownCapture})) ||
        (type == "topPointerUp" && hasPointerInterestForGodot(
            *targetNode, uiManager, godotListenerInterest_,
            {ViewEvents::Offset::PointerUp, ViewEvents::Offset::PointerUpCapture})))) {`);
  source = replaceOnce(source,
    '    unregisterActivePointer(pointerEvent);\n  }\n}',
    `    unregisterActivePointer(pointerEvent);
  }
  } catch (const GodotPointerRetired &) {
    // Native retirement already invalidated this pointer's continuation.
    return;
  }
  clearDisconnectedCaptureTargetsForGodot(uiManager);
}`);
  source = replaceOnce(source,
    '    if (shouldEmitPointerEvent(\n            *retargeted.target, "topLostPointerCapture", uiManager)) {',
    '    if (retargeted.target && shouldEmitPointerEvent(\n            *retargeted.target, "topLostPointerCapture", uiManager)) {');
  source = replaceOnce(source,
    '    if (shouldEmitPointerEvent(\n            *retargeted.target, "topGotPointerCapture", uiManager)) {',
    '    if (retargeted.target && shouldEmitPointerEvent(\n            *retargeted.target, "topGotPointerCapture", uiManager)) {');
  source = replaceOnce(source,
    '  if (!hasPendingOverride) {\n    activePointerCaptureTargetOverrides_.erase(event.pointerId);',
    `  // Do not resurrect a removed target from the pre-callback snapshot. A
  // connected transfer made in JS remains pending until the next pointer event.
  clearDisconnectedCaptureTargetsForGodot(uiManager);
  hasPendingOverride = hasPendingOverride &&
      uiManager.getNewestCloneOfShadowNode(*pendingOverride) != nullptr;
  if (!hasPendingOverride) {
    activePointerCaptureTargetOverrides_.erase(event.pointerId);`);
  bindingHeader = replaceOnce(bindingHeader, '#include <jsi/jsi.h>',
    '#include <jsi/jsi.h>\n#include <functional>\n#include <utility>');
  bindingHeader = replaceOnce(bindingHeader, ' private:\n', `  // Project the copied public pointer against its actual dispatched target.
  // The immutable source payload stays owned by the original event queue.
  using PointerEventProjectionForGodot = std::function<bool(
      const ShadowNode &, const EventPayload &, PointerEvent &)>;
  void setPointerEventProjectionForGodot(PointerEventProjectionForGodot projection) {
    godotPointerEventProjection_ = std::move(projection);
  }

 private:
`);
  bindingHeader = replaceOnce(bindingHeader,
    '  mutable ReactEventPriority currentEventPriority_;',
    '  mutable ReactEventPriority currentEventPriority_{ReactEventPriority::Default};\n  PointerEventProjectionForGodot godotPointerEventProjection_;');
  bindingSource = replaceOnce(bindingSource,
    '    auto dispatchCallback = [this, &runtime, eventTimestamp](',
    '    const auto &godotSourcePayload = eventPayload;\n    auto dispatchCallback = [this, &runtime, eventTimestamp, &godotSourcePayload](');
  bindingSource = replaceOnce(bindingSource,
    '                                const EventPayload& eventPayload) {\n      auto eventTarget = targetNode.getEventEmitter()->getEventTarget();',
    `                                const EventPayload& eventPayload) {
      // Processor copies/retargets deliberately retain the original client,
      // screen and identity fields. Only native target-local geometry changes.
      auto projectedPointer = static_cast<const PointerEvent&>(eventPayload);
      if (godotPointerEventProjection_ &&
          !godotPointerEventProjection_(targetNode, godotSourcePayload, projectedPointer)) return;
      auto eventTarget = targetNode.getEventEmitter()->getEventTarget();`);
  bindingSource = replaceOnce(bindingSource,
    '            eventPayload,\n            eventTimestamp);',
    '            projectedPointer,\n            eventTimestamp);');
  bindingSource = replaceOnce(bindingSource,
    '    if (targetNode != nullptr) {\n      pointerEventsProcessor_.interceptPointerEvent(\n          targetNode,\n          type,\n          priority,\n          pointerEvent,\n          dispatchCallback,\n          *uiManager_);\n    }',
    '    // A registered physical pointer can move/up/cancel outside native hits.\n    pointerEventsProcessor_.interceptPointerEvent(\n        targetNode, type, priority, pointerEvent, dispatchCallback, *uiManager_);');
  bindingSource = replaceOnce(bindingSource, '#include "UIManagerBinding.h"',
    '#include "UIManagerBinding.h"\n\n#include <folly/ScopeGuard.h>');
  bindingSource = replaceOnce(bindingSource,
    '        eventTarget->retain(runtime);\n        this->dispatchEventToJS(',
    '        eventTarget->retain(runtime);\n        SCOPE_EXIT { eventTarget->release(runtime); };\n        this->dispatchEventToJS(');
  bindingSource = replaceOnce(bindingSource,
    '            eventTimestamp);\n        eventTarget->release(runtime);\n      }\n    };',
    '            eventTimestamp);\n      }\n    };');
  bindingSource = replaceOnce(bindingSource, '  currentEventPriority_ = priority;\n',
    '  const auto previousPriority = currentEventPriority_;\n  SCOPE_EXIT { currentEventPriority_ = previousPriority; };\n  currentEventPriority_ = priority;\n');
  bindingSource = replaceOnce(bindingSource, '  currentEventPriority_ = ReactEventPriority::Default;\n', '');
  return {[base + '.h']: header, [base + '.cpp']: source,
    [bindingBase + '.h']: bindingHeader, [bindingBase + '.cpp']: bindingSource};
}

export function writePointerOverlay(rnRoot, output) {
  const inputs = Object.fromEntries(Object.entries(inputNames).map(([name, relative]) =>
    [name, fs.readFileSync(path.join(rnRoot, relative), 'utf8')]));
  const files = renderPointerOverlay(inputs.h, inputs.cpp, inputs.bindingH, inputs.bindingCpp);
  files['overlay-manifest.json'] = JSON.stringify({
    format: 'godot-fabric.rn-pointer-overlay/v1', reactNative: '0.87.1',
    originalSources: Object.fromEntries(Object.entries(pins).map(([name, sha256]) => [inputNames[name], sha256])),
    generatedSources: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, hash(content)])),
  }, null, 2) + '\n';
  // Validate all four immutable inputs before any output is created or replaced.
  for (const [relative, content] of Object.entries(files)) {
    const filename = path.join(output, relative);
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    if (fs.existsSync(filename) && fs.readFileSync(filename, 'utf8') === content) continue;
    const staging = filename + '.staging-' + process.pid;
    try { fs.writeFileSync(staging, content, {flag: 'wx'}); fs.renameSync(staging, filename); }
    finally { fs.rmSync(staging, {force: true}); }
  }
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: rn-pointer-overlay.mjs <RN ReactCommon> <output>');
    writePointerOverlay(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
