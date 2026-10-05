import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundlePointerDocumentUpProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {decodeNativePng} from "./native-png.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const capture = process.argv.includes("--capture");
const flagModes = ["disabled", "imperative-only", "internal-only", "enabled"];
const requestedInterest = process.argv.find(value => value.startsWith("--interest="))?.slice(11);
const requestedFlag = process.argv.find(value => value.startsWith("--flag="))?.slice(7);
assert.ok(requestedInterest == null || ["original", "current"].includes(requestedInterest));
assert.ok(requestedFlag == null || flagModes.includes(requestedFlag));
assert.ok(!capture || requestedInterest === "current" && requestedFlag === "enabled", "Capture selects only current/enabled; other lanes remain headless controls");
const interests = requestedInterest == null ? ["original", "current"] : [requestedInterest];
const modes = requestedFlag == null ? flagModes : [requestedFlag];
const digest = value => createHash("sha256").update(value).digest("hex");
const flags = mode => ({imperative: ["imperative-only", "enabled"].includes(mode), nativeDispatch: ["internal-only", "enabled"].includes(mode)});
const methods = available => Array(3).fill(available ? "function" : "undefined");
async function optionalFile(file) { try { return await readFile(path.join(root, file)); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function publicHash() { const bytes = await optionalFile("build/app.js"); return bytes == null ? null : digest(bytes); }
const pointerRows = value => value.events.filter(row => !["TouchEnd", "TouchCancel"].includes(row.label));
const rawRows = (value, type) => value.raw.filter(row => row.type === type);
function clean(value, D) {
  const up = pointerRows(value), hasTouchEnd = value.events.some(row => row.label === "TouchEnd");
  assert.deepEqual(value.upEventIdentity, {callbackCount: up.length,
    sameObject: up.length > 0 ? true : null, touchEndDistinct: up.length > 0 && hasTouchEnd ? D : null});
  assert.ok(value.globalEventRestored && value.currentPriority === value.defaultPriority);
  assert.equal(value.cleanup.length, value.events.length);
  assert.ok(value.cleanup.every(row => row.currentTargetNull && (!D || row.originalEvent && row.phase === 0 && row.pathEmpty)));
}
function raw(value, type, callbacks) {
  const rows = rawRows(value, type);
  assert.ok(callbacks.length > 0);
  assert.deepEqual(rows.map(row => row.channel), ["typed", "star"]);
  assert.equal(rows[0].payloadId, rows[1].payloadId);
  assert.ok(callbacks.every(row => row.payloadId === rows[0].payloadId && row.nativeTarget === rows[0].target &&
    row.timeStamp === row.nativeTimeStamp && row.timeStamp === rows[0].timeStamp && row.sequence > rows[1].sequence));
}
function query(value, name, installed, offsets, results, nativeNodes) {
  if (!installed) { assert.deepEqual(value.query.rows, []); return; }
  const roots = value.query.rows.filter(row => row.isRootHandle);
  assert.ok(roots.length > 0, "A negative root query cannot pass through empty membership");
  assert.deepEqual(roots.map(row => row.name), offsets.map(() => name));
  assert.deepEqual(roots.map(row => row.offset), offsets);
  assert.deepEqual(roots.map(row => row.result), results);
  const category = offsets[0] === 34 ? [34, 35] : [36, 37];
  const components = value.query.rows.filter(row => !row.isRootHandle);
  const ownerTags = new Set(nativeNodes.map(node => node.tag));
  assert.ok(roots.every(row => row.candidateTag === value.panels[name].surfaceId));
  assert.ok(components.every(row => ownerTags.has(row.candidateTag)));
  if (category[0] === 36) {
    assert.ok(components.length >= 2, "Real Up checks the materialized physical target before its root");
    assert.equal(components[0].candidateTag, value.targetTag);
  }
  assert.equal(components.length % 2, 0);
  for (let index = 0; index < components.length; index += 2) {
    const [bubble, captured] = components.slice(index, index + 2);
    assert.deepEqual([bubble.offset, captured.offset], category);
    assert.ok(Number.isSafeInteger(bubble.candidateTag) && bubble.candidateTag > 0);
    assert.equal(bubble.candidateTag, captured.candidateTag);
    assert.equal(bubble.name, null); assert.equal(captured.name, null);
    assert.ok(bubble.sequence < captured.sequence && captured.sequence < roots[0].sequence);
    assert.equal(bubble.result, false); assert.equal(captured.result, false);
  }
  assert.ok(value.query.rows.every(row => row.action === "delegate" && !row.matched && row.resultKind === "boolean" && category.includes(row.offset)));
  assert.ok(roots.every(row => row.expectedHandle && row.before.handleExists && row.after.handleExists && row.before.canonicalPresent && row.after.canonicalPresent &&
    row.before.publicInstanceNull === row.after.publicInstanceNull && row.before.refAssigned === row.after.refAssigned));
  if (roots.length > 1) assert.ok(roots[0].sequence < roots[1].sequence);
}
function terminal(stage, expected, phases, name, D, installed, offsets, results, remaining = 0, legacy = false, sentinel = false, faultRows = null) {
  const value = stage.react, pointers = pointerRows(value), touch = value.events.filter(row => row.label === "TouchEnd");
  assert.deepEqual(value.events.map(row => row.label), [...expected, "TouchEnd"]);
  assert.deepEqual(pointers.map(row => row.phase), phases);
  assert.ok(pointers.every(row => (legacy || row.type === "pointerup") && row.pointerId > 0 && row.pointerType === "touch" && row.buttons === 0 && row.pressure === 0 && row.name === name && row.targetMatches && row.currentMatches && row.nativeTarget === value.targetTag && row.currentPriority === value.discretePriority));
  if (pointers.length === 0) assert.deepEqual(rawRows(value, "topPointerUp"), []);
  else {
    raw(value, "topPointerUp", pointers);
    const actual = rawRows(value, "topPointerUp");
    assert.ok(actual.every(row => row.pointerId === pointers[0].pointerId && row.buttons === 0 && row.pressure === 0 && row.pointerType === "touch"));
    if (legacy) assert.ok(pointers.length === 1 && pointers[0].compiledLegacySynthetic && !pointers[0].originalEvent);
    else assert.ok(pointers.every(row => row.trusted && row.originalEvent && row.originalSynthetic && row.targetOriginalElement && row.ownerDocumentMatches && row.thisMatches && row.globalEventMatches));
  }
  assert.equal(touch.length, 1); raw(value, "topTouchEnd", touch);
  assert.ok(touch[0].name === name && touch[0].targetMatches && touch[0].currentMatches && touch[0].currentPriority === value.discretePriority);
  if (D) assert.ok(touch[0].trusted && touch[0].originalEvent && touch[0].originalSynthetic && touch[0].thisMatches && touch[0].globalEventMatches && touch[0].targetOriginalElement && touch[0].ownerDocumentMatches);
  else assert.ok(touch[0].compiledLegacySynthetic && !touch[0].originalEvent);
  if (pointers.length > 0) assert.ok(touch[0].sequence > pointers.at(-1).sequence);
  assert.equal(value.raw.length, expected.length === 0 ? 2 : 4);
  assert.deepEqual(rawRows(value, "topPointerDown"), []);
  assert.equal(value.panels[name].count, value.baselineCount + expected.length);
  assert.equal(stage.after.commits, stage.before.commits + (expected.length > 0 ? 1 : 0));
  assert.equal(stage.after.pointer.pointerUps, stage.before.pointer.pointerUps + 1);
  assert.equal(stage.after.pointer.ends, stage.before.pointer.ends + 1);
  assert.equal(stage.after.pointer.activePointers, 0); assert.equal(stage.after.pointer.activeTouches, 0);
  assert.deepEqual(stage.application.pointerProcessor, {active: remaining, pendingCapture: 0, activeCapture: 0, hover: remaining});
  for (const key of ["active", "contacts", "stored"]) assert.equal(stage.application.pointerRouting[key], remaining);
  if (sentinel) assert.deepEqual(value.query.rows, []);
  else if (faultRows != null && installed) faultQuery(value, name, faultRows, stage.after.nodes);
  else query(value, name, installed, offsets, results, stage.after.nodes);
  clean(value, D);
}
// Root rows [offset, action, result] in call order; View ancestors still
// delegate healthy false pairs before the faulted root lookup.
function faultQuery(value, name, rows, nativeNodes) {
  const roots = value.query.rows.filter(row => row.isRootHandle), components = value.query.rows.filter(row => !row.isRootHandle);
  assert.deepEqual(roots.map(row => [row.offset, row.action, row.result]), rows.map(([offset, action, result]) => [offset, action, action === "nonboolean" ? 1 : result]));
  assert.ok(roots.every(row => row.name === name && row.expectedHandle && row.matched === (row.action !== "delegate") &&
    row.resultKind === (row.action === "delegate" ? "boolean" : row.action === "throw" ? "throw" : "number") &&
    row.before.handleExists && row.after.handleExists && row.before.publicInstanceNull === row.after.publicInstanceNull));
  // Same pairing as query(): each owning-surface ancestor reads 36 then 37,
  // starting at the physical target, all before the first root lookup.
  const ownerTags = new Set(nativeNodes.map(node => node.tag));
  assert.ok(roots.every(row => row.candidateTag === value.panels[name].surfaceId));
  assert.ok(components.length >= 2 && components.length % 2 === 0 && components[0].candidateTag === value.targetTag);
  assert.ok(components.every(row => ownerTags.has(row.candidateTag) && row.action === "delegate" && !row.matched &&
    row.resultKind === "boolean" && row.result === false && row.sequence < roots[0].sequence));
  for (let index = 0; index < components.length; index += 2) {
    const [bubble, captured] = components.slice(index, index + 2);
    assert.deepEqual([bubble.offset, captured.offset], [36, 37]);
    assert.ok(Number.isSafeInteger(bubble.candidateTag) && bubble.candidateTag > 0);
    assert.equal(bubble.candidateTag, captured.candidateTag);
    assert.equal(bubble.name, null); assert.equal(captured.name, null);
    assert.ok(bubble.sequence < captured.sequence);
  }
}
// One-shot root query faults at the Up offsets, in a second application after
// the healthy one stopped. A consumed fault rejects only its own lookup with
// one retained diagnostic; the recovery gesture is healthy.
function faults(report, D, installed) {
  const stages = report.stages, docOffsets = installed ? [36] : [36, 37], docResults = installed ? [true] : [false, false];
  const docs = installed ? ["DocC", "DocB"] : [], phases = labels => labels.map(label => label.endsWith("C") ? 1 : 3);
  const app = stages["fault/beforeStop"].application;
  assert.equal(stages["fault/capabilityA"].query.installations, installed ? 1 : 0);
  const cases = [
    ["throw36", "doc", 36, "throw", docs, [[36, "throw", null], [37, "delegate", true]], docs, docOffsets, docResults],
    ["throw37", "doc-capture-only", 37, "throw", [], [[36, "delegate", false], [37, "throw", null]], installed ? ["DocC"] : [], [36, 37], [false, installed]],
    ["nonboolean36", "doc-remove", 36, "nonboolean", [], [[36, "nonboolean", null], [37, "delegate", false]], installed ? ["DocB"] : [], docOffsets, docResults],
    ["nonboolean37", "doc-capture-only", 37, "nonboolean", [], [[36, "delegate", false], [37, "nonboolean", null]], installed ? ["DocC"] : [], [36, 37], [false, installed]],
    ["armed37", "doc", 37, "throw", docs, [[36, "delegate", true]], docs, docOffsets, docResults],
  ];
  const expectedErrors = [];
  for (const [id, kind, offset, mode, expected, rows, recovery, offsets, results] of cases) {
    const prefix = "fault/" + id, consumed = installed && rows.some(row => row[1] !== "delegate");
    assert.equal(stages[prefix + "/configuration"].kind, kind);
    assert.deepEqual(stages[prefix + "/fault"], {offset, mode, label: "root" + offset, remaining: 1});
    terminal(stages[prefix + "/up"], expected, phases(expected), "A", D, installed, [36, 37], [false, false], 0, false, false, rows);
    const fault = stages[prefix + "/up"].react.query.fault, errors = stages[prefix + "/errors"];
    assert.equal(errors.consumed, consumed); assert.equal(fault.remaining, consumed ? 0 : 1);
    assert.equal(errors.after.length, errors.before.length + (consumed ? 1 : 0));
    if (consumed) {
      const cause = mode === "throw" ? "GF document query deliberate fault: root" + offset : "Pointer listener query must return a boolean";
      assert.ok(errors.after.at(-1).startsWith("E_POINTER_LISTENER_QUERY: ") && errors.after.at(-1).includes(cause));
      expectedErrors.push(cause);
    }
    assert.equal(stages[prefix + "/cleared"], true);
    terminal(stages[prefix + "/recovery/up"], recovery, phases(recovery), "A", D, installed, offsets, results);
    assert.equal(stages[prefix + "/recovery/up"].react.query.fault, null);
  }
  assert.deepEqual(report.faultExpectedErrors, expectedErrors);
  assert.equal(expectedErrors.length, installed ? 4 : 0);
  terminal(stages["fault/B-healthy/up"], docs, installed ? [1, 3] : [], "B", D, installed, docOffsets, docResults);
  assert.deepEqual(app.errors, stages["fault/stopped"].errors);
  const stopped = stages["fault/stopped"];
  assert.ok(stopped.stopped && !stopped.pointerListenerQueryInstalled && stopped.rootCount === 0);
  assert.equal(stopped.errors.length, expectedErrors.length);
  stopped.errors.forEach((line, index) => assert.ok(line.startsWith("E_POINTER_LISTENER_QUERY: ") && line.includes(expectedErrors[index])));
  return expectedErrors;
}

function lifecycleManual(stage, expected, D) {
  const value = stage.react;
  assert.equal(stage.result.available, D); assert.ok(stage.result.noPrototypeBorrow);
  assert.deepEqual(value.events.map(row => row.label), expected);
  if (D) assert.ok(stage.result.returned && !stage.result.trusted && stage.result.targetMatches && stage.result.cleaned);
  assert.ok(value.events.every(row => row.type === "pointerup" && !row.trusted && row.phase === 2 &&
    row.targetMatches && row.currentMatches && row.thisMatches && row.originalEvent && !row.originalSynthetic));
  assert.deepEqual(value.raw, []); assert.deepEqual(value.query.rows, []);
  assert.equal(value.panels.A.count, value.baselineCount); clean(value, D);
}
// Rerender keeps identities; retirement cancels held A without Up while B
// survives; the replacement root has fresh Maps, inert retained listeners and
// swallows the release of the contact cancelled by retirement.
function refs(report, I, D, installed) {
  const stages = report.stages, docExpected = installed ? ["DocC", "DocB"] : [];
  const docOffsets = installed ? [36] : [36, 37], docResults = installed ? [true] : [false, false];
  const rerender = stages["refs/rerender/identity"];
  assert.deepEqual(rerender.identity, {docSame: true, elementSame: true, refSame: true, getterSame: true, revision: 1});
  assert.equal(rerender.after.commits, rerender.before.commits + 1);
  const allExpected = !installed ? [] : I ? ["DocC", "RootC", "RootB", "DocB"] : ["DocC", "DocB"];
  terminal(stages["refs/rerender/up"], allExpected, allExpected.length === 4 ? [1, 1, 3, 3] : allExpected.length === 2 ? [1, 3] : [], "A", D, installed, docOffsets, docResults);
  const retained = stages["refs/retire/retained"];
  assert.equal(retained.surfaceId, stages.capabilityA.surfaceId); assert.equal(retained.key, "A-" + retained.surfaceId);
  assert.deepEqual(stages["refs/retire/B-configuration"].installed, D ? ["DocC", "DocB"] : []);
  const retirement = stages["refs/retire/unmount"], retiring = retirement.react, cancel = retiring.events;
  assert.deepEqual(cancel.map(row => row.label), ["TouchCancel"]); raw(retiring, "topTouchCancel", cancel);
  assert.equal(retiring.raw.length, 2); assert.deepEqual(rawRows(retiring, "topPointerUp"), []); assert.deepEqual(retiring.query.rows, []);
  assert.ok(cancel[0].name === "A" && cancel[0].targetMatches && cancel[0].currentMatches && cancel[0].currentPriority === retiring.discretePriority);
  if (D) assert.ok(cancel[0].trusted && cancel[0].originalEvent && cancel[0].originalSynthetic && cancel[0].thisMatches && cancel[0].globalEventMatches && cancel[0].ownerDocumentMatches);
  else assert.ok(cancel[0].compiledLegacySynthetic && !cancel[0].originalEvent);
  assert.equal(retiring.panels.A, undefined); clean(retiring, D);
  const {beforeA, afterA, beforeB, afterB, application} = retirement;
  assert.equal(afterA.nativeTags, 0); assert.equal(afterA.creates, afterA.deletes);
  assert.equal(afterA.pointer.pointerCancels, beforeA.pointer.pointerCancels + 1); assert.equal(afterA.pointer.cancels, beforeA.pointer.cancels + 1);
  assert.equal(afterA.pointer.pointerUps, beforeA.pointer.pointerUps); assert.equal(afterA.pointer.ends, beforeA.pointer.ends);
  assert.equal(afterA.pointer.activePointers, 0); assert.equal(afterA.pointer.activeTouches, 0);
  assert.equal(application.rootCount, 1); assert.deepEqual(application.pointerProcessor, {active: 1, pendingCapture: 0, activeCapture: 0, hover: 1});
  for (const key of ["active", "contacts", "stored"]) assert.equal(application.pointerRouting[key], 1);
  assert.deepEqual(afterB.pointer, beforeB.pointer); assert.equal(afterB.commits, beforeB.commits);
  assert.equal(retirement.afterCountB, retirement.beforeCountB); assert.equal(afterB.pointer.activePointers, 1);
  assert.deepEqual(retirement.identities, {currentDocFresh: true, currentElementFresh: true, docConnected: false, elementConnected: false,
    methods: methods(D), oldRootGetterNull: true, originalDoc: true});
  terminal(stages["refs/retire/B-positive/up"], docExpected, installed ? [1, 3] : [], "B", D, installed, docOffsets, docResults);
  const capability = stages["refs/remount/capability"], fresh = stages["refs/remount/identities"];
  assert.notEqual(capability.surfaceId, retained.surfaceId); assert.notEqual(capability.surfaceId, stages.capabilityB.surfaceId);
  for (const key of ["originalDoc", "originalElement", "docOwnsElement", "docConnected", "elementConnected", "originalRootGetterIdentity", "distinctOtherRoot"]) assert.equal(capability[key], true);
  assert.deepEqual(capability.methods.doc, methods(D)); assert.deepEqual(capability.methods.element, methods(I && D));
  assert.equal(capability.query.installations, installed ? 1 : 0);
  assert.ok(fresh.currentDocFresh && fresh.currentElementFresh && !fresh.docConnected && !fresh.elementConnected && fresh.oldRootGetterNull);
  terminal(stages["refs/remount/retained-inert/up"], [], [], "A", D, installed, [36, 37], [false, false]);
  lifecycleManual(stages["refs/remount/retained-manual"], D ? ["OldDoc"] : [], D);
  assert.deepEqual(stages["refs/remount/configuration"].installed, D ? ["DocC", "DocB"] : []);
  const stale = stages["refs/remount/stale-release"];
  assert.deepEqual(stale.react.events, []); assert.deepEqual(stale.react.raw, []); assert.deepEqual(stale.react.query.rows, []);
  assert.equal(stale.react.panels.A.count, stale.react.baselineCount); assert.equal(stale.after.commits, stale.before.commits);
  assert.deepEqual(stale.after.pointer, stale.before.pointer);
  assert.deepEqual(stale.application.pointerProcessor, stale.applicationBefore.pointerProcessor);
  assert.deepEqual(stale.application.pointerRouting, stale.applicationBefore.pointerRouting); clean(stale.react, D);
  terminal(stages["refs/remount/fresh-document/up"], docExpected, installed ? [1, 3] : [], "A", D, installed, docOffsets, docResults);
}
// Callbacks and the mutations they perform share one sequence; "action:target"
// marks a mutation between the callbacks around it.
const timeline = value => [...value.events.map(row => [row.sequence, row.label]),
  ...value.mutations.map(row => [row.sequence, row.action + ":" + row.target]),
  ...value.nested.map(row => [row.sequence, "nested:" + row.name + "." + row.label]),
  ...value.reentries.map(row => [row.sequence, "reenter:" + (row.threw == null ? "returned" : "threw")])].sort((a, b) => a[0] - b[0]).map(row => row[1]);
// Reentrant dispatch from actual native Up callbacks. Nested events are
// untrusted, at target, Discrete and distinct; the outer native Event resumes
// with its trust, phase, currentTarget, target, path and global binding.
function reentry(report, D, installed) {
  const stages = report.stages, docOffsets = installed ? [36] : [36, 37], docResults = installed ? [true] : [false, false];
  const callbacks = entries => entries.filter(entry => !entry.includes(":"));
  function up(id, name, entries, phase) {
    const stage = stages["reentry/" + id + "/up"], value = stage.react;
    terminal(stage, callbacks(entries), callbacks(entries).map(label => label.endsWith("C") ? 1 : 3), name, D, installed, docOffsets, docResults);
    assert.deepEqual(timeline(value), [...entries, "TouchEnd"]); assert.deepEqual(value.mutations, []);
    assert.equal(value.reentries.length, entries.filter(entry => entry.startsWith("reenter:")).length);
    const count = value.nested.length;
    assert.deepEqual(value.nestedEventIdentity, {count, sameObject: count > 0 ? true : null, distinctFromOuter: count > 0 ? true : null});
    assert.ok(value.nested.every(row => row.type === "pointerup" && !row.trusted && row.phase === 2 && row.targetMatches && row.currentMatches &&
      row.thisMatches && row.originalEvent && !row.originalSynthetic && row.globalEventMatches && row.currentPriority === value.discretePriority));
    for (const row of value.reentries) {
      if (row.threw == null) assert.ok(!row.sameEvent && row.returned === true && !row.nestedTrusted && row.nestedCleaned === true);
      else assert.ok(row.sameEvent && row.returned === null && /already being dispatched/.test(row.threw) && row.nestedTrusted && row.nestedCleaned === null);
      assert.ok(row.outerTrusted && row.outerPhase === phase && row.outerCurrentMatches && row.outerTargetSame && row.outerPathLength > 0 && row.outerGlobalEventMatches);
      assert.ok(value.events.some(event => event.label === row.by && event.sequence < row.sequence));
    }
  }
  function flat(id, expected) {
    const stage = stages["reentry/" + id + "/manual"], value = stage.react;
    assert.equal(stage.result.available, D); assert.deepEqual(value.events.map(row => row.label), expected);
    assert.ok(value.events.every(row => !row.trusted && row.phase === 2 && row.originalEvent));
    assert.deepEqual(value.nested, []); assert.deepEqual(value.reentries, []); assert.equal(value.nestedEventIdentity.count, 0);
    assert.deepEqual(value.raw, []); assert.deepEqual(value.query.rows, []); assert.equal(value.panels.A.count, value.baselineCount); clean(value, D);
  }
  const configured = {"nested-capture": ["DocC", "DocB1", "DocB2"], "nested-bubble": ["DocC", "DocB1", "DocB2"], "same-event": ["DocB1", "DocB2"], "cross-root": ["DocB"]};
  for (const [id, labels] of Object.entries(configured)) {
    const configuration = stages["reentry/" + id + "/configuration"];
    assert.equal(configuration.kind, "re-" + id); assert.deepEqual(configuration.installed, D ? labels : []);
  }
  const on = entries => installed ? entries : [];
  const nestedA = ["nested:A.DocC", "nested:A.DocB1", "nested:A.DocB2", "reenter:returned"];
  up("nested-capture", "A", on(["DocC", ...nestedA, "DocB1", "DocB2"]), 1);
  flat("nested-capture/after", D ? ["DocC", "DocB1", "DocB2"] : []);
  up("nested-bubble", "A", on(["DocC", "DocB1", ...nestedA, "DocB2"]), 3);
  flat("nested-bubble/after", D ? ["DocC", "DocB1", "DocB2"] : []);
  up("same-event", "A", on(["DocB1", "reenter:threw", "DocB2"]), 3);
  flat("same-event/after", D ? ["DocB1", "DocB2"] : []);
  assert.deepEqual(stages["reentry/cross-root/B-configuration"].installed, D ? ["DocC", "DocB"] : []);
  up("cross-root/A", "A", on(["DocB", "nested:B.DocC", "nested:B.DocB", "reenter:returned"]), 3);
  const unchanged = stages["reentry/cross-root/B-unchanged"];
  assert.equal(unchanged.after.commits, unchanged.before.commits); assert.deepEqual(unchanged.after.pointer, unchanged.before.pointer);
  assert.equal(unchanged.afterCount, unchanged.beforeCount);
  terminal(stages["reentry/cross-root/B/up"], installed ? ["DocC", "DocB"] : [], installed ? [1, 3] : [], "B", D, installed, docOffsets, docResults);
}
// Listener mutation inside actual native Up callbacks. The original dispatcher
// snapshots each target/phase Map when it reaches it; the root query happens
// before dispatch and reflects membership before this gesture's mutations.
function mutation(report, I, D, installed) {
  const stages = report.stages, docOffsets = installed ? [36] : [36, 37], docResults = installed ? [true] : [false, false];
  const callbacks = entries => entries.filter(entry => !entry.includes(":"));
  function rows(value, entries, phase) {
    assert.equal(value.mutations.length, entries.length - callbacks(entries).length);
    for (const row of value.mutations) {
      assert.equal(row.phase, phase); assert.ok(row.currentMatches && row.globalEventMatches);
      assert.ok(value.events.some(event => event.label === row.by && event.sequence < row.sequence));
      assert.equal(row.result, row.action === "abort" ? true : null);
    }
  }
  function up(id, name, entries, offsets = docOffsets, results = docResults) {
    const stage = stages["mutation/" + id + "/up"];
    terminal(stage, callbacks(entries), callbacks(entries).map(label => label.endsWith("C") ? 1 : 3), name, D, installed, offsets, results);
    assert.deepEqual(timeline(stage.react), [...entries, "TouchEnd"]);
    rows(stage.react, entries, entries[0]?.endsWith("C") ? 1 : 3);
  }
  function manual(id, name, entries) {
    const stage = stages["mutation/" + id + "/manual"], value = stage.react;
    assert.equal(stage.result.available, D); assert.ok(stage.result.noPrototypeBorrow);
    if (D) assert.ok(stage.result.returned && !stage.result.trusted && stage.result.targetMatches && stage.result.cleaned);
    assert.deepEqual(timeline(value), entries); rows(value, entries, 2);
    assert.ok(value.events.every(row => row.type === "pointerup" && !row.trusted && row.phase === 2 &&
      row.targetMatches && row.currentMatches && row.thisMatches && row.originalEvent && !row.originalSynthetic));
    assert.deepEqual(value.raw, []); assert.deepEqual(value.query.rows, []);
    assert.equal(value.panels[name].count, value.baselineCount); clean(value, D);
  }
  const configured = {"remove-later": ["DocC", "DocB"], "remove-sibling": ["DocB1", "DocB2"], "add-same": ["DocB1"],
    "add-later": ["DocC"], "abort-sibling": ["DocB1", "DocB2"], "cross-root": ["DocB"]};
  for (const [id, labels] of Object.entries(configured)) {
    const configuration = stages["mutation/" + id + "/configuration"];
    assert.equal(configuration.kind, "mut-" + id); assert.equal(configuration.eventType, "pointerup");
    assert.ok(configuration.noPrototypeBorrow); assert.deepEqual(configuration.installed, D ? labels : []);
  }
  const on = entries => installed ? entries : [];
  // Removal from a later phase and from the same Map both suppress delivery.
  up("remove-later/first", "A", on(["DocC", "remove:DocB"]));
  up("remove-later/second", "A", on(["DocC", "remove:DocB"]), [36, 37], [false, installed]);
  manual("remove-later/after", "A", D ? ["DocC", "remove:DocB"] : []);
  up("remove-sibling/first", "A", on(["DocB1", "remove:DocB2"]));
  up("remove-sibling/second", "A", on(["DocB1", "remove:DocB2"]));
  manual("remove-sibling/after", "A", D ? ["DocB1", "remove:DocB2"] : []);
  // An add to the Map being iterated waits for the next event.
  up("add-same/first", "A", on(["DocB1", "add:DocB2"]));
  up("add-same/second", "A", on(["DocB1", "add:DocB2", "DocB2"]));
  manual("add-same/after", "A", !D ? [] : installed ? ["DocB1", "add:DocB2", "DocB2"] : ["DocB1", "add:DocB2"]);
  // Bubble Maps populated during capture run in the same native dispatch, even
  // though the pre-dispatch root query saw only the capture listener.
  const later = on(I ? ["DocC", "add:RootB", "add:DocB", "RootB", "DocB"] : ["DocC", "add:DocB", "DocB"]);
  up("add-later/first", "A", later, [36, 37], [false, installed]);
  up("add-later/second", "A", later);
  manual("add-later/after", "A", !D ? [] : I ? ["DocC", "add:RootB", "add:DocB", "DocB"] : ["DocC", "add:DocB", "DocB"]);
  const signal = aborted => ({available: D, originalSignal: D ? true : null, aborted: D ? aborted : null});
  assert.deepEqual(stages["mutation/abort-sibling/signal-before"], signal(false));
  up("abort-sibling/first", "A", on(["DocB1", "abort:DocB2"]));
  up("abort-sibling/second", "A", on(["DocB1", "abort:DocB2"]));
  assert.deepEqual(stages["mutation/abort-sibling/signal-after-native"], signal(installed));
  manual("abort-sibling/after", "A", D ? ["DocB1", "abort:DocB2"] : []);
  assert.deepEqual(stages["mutation/abort-sibling/signal-after-manual"], signal(true));
  // A's callback populates B's Document: B's state is untouched until B's own
  // gesture, whose root query and delivery then see the new listener.
  up("cross-root/A", "A", on(["DocB", "add:XDoc"]));
  const countB = stages["mutation/cross-root/A/down"].react.panels.B.count;
  assert.equal(stages["mutation/cross-root/A/up"].react.panels.B.count, countB);
  assert.equal(stages["mutation/cross-root/B/down"].react.baselineCount, countB);
  up("cross-root/B", "B", on(["XDoc"]));
  manual("cross-root/B-after", "B", installed ? ["XDoc"] : []);
}
function verify({report, result, log, interestMode, flagMode, bundles, headed}) {
  assert.equal(result.error, undefined, log); assert.equal(result.signal, null, log); assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use|Inconsistency between local and platform pointer registries/);
  assert.equal(report.scenario, "native-pointer-document-up-four-flags"); assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.flagMode, flagMode); assert.equal(report.interestMode, interestMode);
  assert.equal(report.displayServer, headed ? "macOS" : "headless"); assert.equal(report.captureRequested, headed);
  assert.ok(report.allAssertionsPassed); assert.deepEqual(report.failures, []);
  assert.ok(report.checks.length > 0 && report.checks.every(row => row.passed));
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  // Only the second application's configured root faults may print native
  // diagnostics; the healthy matrix and every script stay error-free.
  const nativeErrors = [...log.matchAll(/^ERROR: FABRIC_ERROR: (.+)$/gm)].map(match => match[1]);
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, nativeErrors.length, "No script or engine error is hidden behind the configured faults");
  assert.match(log, /POINTER_DOCUMENT_UP_PASSED: \d+/);
  assert.ok(report.scope.actualNativeInput && report.scope.realOriginalDocuments && report.scope.experimentalNativeDispatch);
  for (const key of ["listenerRegistryMirrored", "publicDefaultEnabled", "hardwareCertified", "upQueryFaultsCertified", "explicitCaptureCertified"]) assert.equal(report.scope[key], false);
  assert.equal(report.scope.upRootQueryFaultsExercised, true);
  const {imperative: I, nativeDispatch: D} = flags(flagMode), installed = interestMode === "current" && D;
  for (const name of ["A", "B"]) {
    const capability = report.stages["capability" + name];
    assert.deepEqual(capability.flags, flags(flagMode)); assert.equal(capability.mode, flagMode); assert.equal(capability.interestMode, interestMode);
    for (const key of ["originalDoc", "originalElement", "docOwnsElement", "docConnected", "elementConnected", "originalRootGetterIdentity", "distinctOtherRoot"]) assert.equal(capability[key], true);
    assert.deepEqual(capability.methods.doc, methods(D)); assert.deepEqual(capability.methods.element, methods(I && D));
    assert.equal(capability.docEventTarget, D); assert.equal(capability.rootEventTarget, D);
    assert.equal(capability.query.installations, installed ? 1 : 0);
    if (installed) assert.ok(capability.query.restoredInstaller);
  }
  assert.deepEqual(report.stages.capabilityA.methods.view, methods(I && D)); assert.ok(report.stages.capabilityA.docOwnsRef);
  assert.equal(report.stages.capabilityB.methods.view, null); assert.ok(report.stages.capabilityB.noRef.noRef && report.stages.capabilityB.noRef.publicInstanceNull && !report.stages.capabilityB.noRef.refAssigned);
  assert.notEqual(report.stages.capabilityA.surfaceId, report.stages.capabilityB.surfaceId);
  for (const kind of ["doc", "all", "element", "doc-capture-only", "element-capture-only"]) {
    const supported = D && (!kind.startsWith("element") || I), delivered = installed && supported;
    const expected = !delivered ? [] : kind === "all" && I ? ["DocC", "RootC", "RootB", "DocB"] : kind === "element" ? ["RootC", "RootB"] : kind === "doc-capture-only" ? ["DocC"] : kind === "element-capture-only" ? ["RootC"] : ["DocC", "DocB"];
    const configuration = report.stages["case/" + kind + "/configuration"];
    const expectedRegistration = !supported ? [] : kind === "all" ? (I ? ["DocC", "RootC", "RootB", "DocB"] : ["DocC", "DocB"]) : kind === "element" ? ["RootC", "RootB"] : kind === "doc-capture-only" ? ["DocC"] : kind === "element-capture-only" ? ["RootC"] : ["DocC", "DocB"];
    assert.equal(configuration.eventType, "pointerup"); assert.ok(configuration.noPrototypeBorrow); assert.deepEqual(configuration.installed, expectedRegistration);
    const manual = report.stages["case/" + kind + "/manual"], manualExpected = !supported ? [] : kind === "element" ? ["RootC", "RootB"] : kind === "element-capture-only" ? ["RootC"] : kind === "doc-capture-only" ? ["DocC"] : ["DocC", "DocB"];
    assert.equal(manual.result.available, supported); assert.ok(manual.result.noPrototypeBorrow);
    assert.deepEqual(manual.react.events.map(row => row.label), manualExpected);
    assert.ok(manual.react.events.every(row => row.type === "pointerup" && !row.trusted && row.phase === 2 && row.targetMatches && row.currentMatches && row.thisMatches && row.originalEvent && !row.originalSynthetic));
    if (supported) assert.ok(manual.result.returned && !manual.result.trusted && manual.result.targetMatches && manual.result.cleaned);
    assert.deepEqual(manual.react.raw, []); assert.deepEqual(manual.react.query.rows, []);
    assert.equal(manual.react.panels.A.count, manual.react.baselineCount); clean(manual.react, D);
    const captureOnly = kind.endsWith("capture-only"), offsets = captureOnly || !delivered ? [36, 37] : [36], results = offsets.length === 2 ? [false, delivered] : [true];
    terminal(report.stages["case/" + kind + "/up"], expected, expected.length === 4 ? [1, 1, 3, 3] : expected.length === 2 ? [1, 3] : expected.length === 1 ? [1] : [], "A", D, installed, offsets, results);
  }
  // Every physical Down is a real held contact, but its original Maps do not
  // contain Down listeners. Observed false lookups cannot be replaced by [].
  for (const [id, stage] of Object.entries(report.stages)) {
    if (!id.endsWith("/down")) continue;
    const name = stage.react.name;
    assert.deepEqual(stage.react.events, []); assert.deepEqual(stage.react.raw, []);
    assert.equal(stage.react.panels[name].count, stage.react.baselineCount);
    assert.equal(stage.after.commits, stage.before.commits);
    assert.equal(stage.after.pointer.pointerDowns, stage.before.pointer.pointerDowns + 1);
    assert.equal(stage.after.pointer.starts, stage.before.pointer.starts + 1);
    assert.equal(stage.after.pointer.activePointers, 1); assert.equal(stage.after.pointer.activeTouches, 1);
    query(stage.react, name, installed, [34, 35], [false, false], stage.after.nodes); clean(stage.react, D);
  }
  terminal(report.stages["isolation/A-negative/up"], [], [], "A", D, installed, [36, 37], [false, false], 1);
  const positive = installed ? ["DocC", "DocB"] : [];
  terminal(report.stages["isolation/B-positive/up"], positive, installed ? [1, 3] : [], "B", D, installed, installed ? [36] : [36, 37], installed ? [true] : [false, false]);
  const sibling = report.stages["isolation/B-unchanged"];
  assert.deepEqual(sibling.before.pointer, sibling.after.pointer); assert.equal(sibling.before.commits, sibling.after.commits);
  assert.equal(sibling.beforeCount, sibling.afterCount); assert.equal(sibling.after.pointer.activePointers, 1); assert.equal(sibling.after.pointer.activeTouches, 1);
  terminal(report.stages["removal/positive/up"], positive, installed ? [1, 3] : [], "A", D, installed, installed ? [36] : [36, 37], installed ? [true] : [false, false]);
  assert.equal(report.stages["removal/removed"], true);
  terminal(report.stages["removal/negative/up"], [], [], "A", D, installed, [36, 37], [false, false]);
  // Requested registrations are traces of calls, not a mirrored RN registry.
  // The real first and second native queries establish membership/cleanup.
  for (const [id, kind] of [["once", "doc-once"], ["abort-pre", "doc-abort-pre"], ["abort-after", "doc-abort-after"]]) {
    const prefix = "lifecycle/" + id, configuration = report.stages[prefix + "/configuration"];
    assert.equal(configuration.eventType, "pointerup"); assert.equal(configuration.kind, kind);
    assert.ok(configuration.noPrototypeBorrow); assert.deepEqual(configuration.installed, D ? ["DocB"] : []);
    const firstExpected = id !== "abort-pre" && installed ? ["DocB"] : [];
    terminal(report.stages[prefix + "/first/up"], firstExpected, firstExpected.length > 0 ? [3] : [], "A", D, installed,
      firstExpected.length > 0 ? [36] : [36, 37], firstExpected.length > 0 ? [true] : [false, false]);
    terminal(report.stages[prefix + "/second/up"], [], [], "A", D, installed, [36, 37], [false, false]);
    if (id === "once") {
      lifecycleManual(report.stages[prefix + "/after-native/manual"], D && !installed ? ["DocB"] : [], D);
      lifecycleManual(report.stages[prefix + "/after-manual/manual"], [], D);
    } else if (id === "abort-pre") {
      assert.deepEqual(report.stages[prefix + "/signal"], {available: D, originalSignal: D ? true : null, aborted: D ? true : null});
      lifecycleManual(report.stages[prefix + "/after-native/manual"], [], D);
    } else {
      lifecycleManual(report.stages[prefix + "/before-abort/manual"], D ? ["DocB"] : [], D);
      const aborted = report.stages[prefix + "/abort"];
      assert.deepEqual(report.stages[prefix + "/signal-before"], {available: D, originalSignal: D ? true : null, aborted: D ? false : null});
      assert.deepEqual(aborted.result, {available: D, originalSignal: D ? true : null, aborted: D ? true : null}); assert.equal(aborted.before.commits, aborted.after.commits);
      assert.deepEqual(aborted.before.pointer, aborted.after.pointer); assert.equal(aborted.beforeCount, aborted.afterCount);
      assert.deepEqual(aborted.react.query.rows, []); clean(aborted.react, D);
      lifecycleManual(report.stages[prefix + "/after-abort/manual"], [], D);
    }
  }
  refs(report, I, D, installed);
  mutation(report, I, D, installed);
  reentry(report, D, installed);
  const faultErrors = faults(report, D, installed);
  assert.equal(nativeErrors.length, faultErrors.length);
  nativeErrors.forEach((line, index) => assert.ok(line.startsWith("E_POINTER_LISTENER_QUERY: ") && line.includes(faultErrors[index])));
  const canceled = report.stages["cancel/terminal"], cancel = canceled.react;
  assert.deepEqual(cancel.events.map(row => row.label), ["TouchCancel"]); assert.deepEqual(rawRows(cancel, "topPointerUp"), []);
  raw(cancel, "topTouchCancel", cancel.events); assert.deepEqual(cancel.query.rows, []);
  assert.equal(cancel.panels.A.count, cancel.baselineCount); assert.equal(canceled.after.commits, canceled.before.commits);
  assert.equal(canceled.after.pointer.pointerCancels, canceled.before.pointer.pointerCancels + 1); assert.equal(canceled.after.pointer.cancels, canceled.before.pointer.cancels + 1);
  assert.equal(canceled.application.pointerRouting.contacts, 0); assert.equal(canceled.application.pointerProcessor.active, 0); clean(cancel, D);
  terminal(report.stages["sentinel/up"], ["JSX"], D ? [2] : [null], "A", D, installed, [], [], 0, !D, true);
  assert.ok(typeof report.stages.lateOverride === "string" && report.stages.lateOverride.length > 0);
  const stopped = report.afterStop;
  assert.ok(stopped.stopped && !stopped.pointerListenerQueryInstalled && stopped.rootCount === 0);
  for (const field of ["pendingWork", "pendingTimers", "pendingAnimationFrames", "pendingRootRetirements"]) assert.equal(stopped[field], 0);
  assert.deepEqual(stopped.pointerProcessor, {active: 0, pendingCapture: 0, activeCapture: 0, hover: 0});
  for (const key of ["active", "contacts", "stored"]) assert.equal(stopped.pointerRouting[key], 0);
  assert.deepEqual(stopped.errors, []);
  for (const name of ["A", "B"]) { const owner = report.stages["stoppedRoot" + name]; assert.equal(owner.nativeTags, 0); assert.equal(owner.creates, owner.deletes); assert.equal(owner.pointer.activePointers, 0); assert.equal(owner.pointer.activeTouches, 0); }
  assert.equal(report.captures.length, headed ? 10 : 0);
  // A null A counter is the retired root generation: its region is clear color.
  const captureStages = [
    ["initial", 0, 0, 10], ["updated", 2, 0, 10],
    ["once-before", 12, 2, 14], ["once-first", 13, 2, 14], ["once-second", 13, 2, 14],
    ["refs-retired", null, 2, 14], ["refs-remounted", 2, 4, 14],
    ["mutation-before", 9, 4, 14], ["mutation-added", 12, 4, 14], ["fault-throw36", 4, 0, 14],
  ];
  for (const [index, frame] of report.captures.entries()) {
    const [stage, counterA, counterB, pixels] = captureStages[index];
    assert.equal(frame.file, "build/pointer-document-up-" + stage + ".png");
    assert.equal(frame.width, 760); assert.equal(frame.height, 220); assert.equal(frame.pixels.length, pixels);
    assert.equal(frame.reactCounters.A?.count ?? null, counterA); assert.equal(frame.reactCounters.B.count, counterB);
  }
  assert.equal(bundles.nativeDispatchMode, "experimental"); assert.equal(bundles.pointerInterestMode, interestMode); assert.equal(bundles.parentMode, "current"); assert.equal(bundles.rendererTagMode, "current");
  for (const file of ["tests/event-target-bootstrap.js", "tests/pointer-document-bootstrap.js", "tests/pointer-document-fixture.jsx", "tests/pointer-document-up-fixture.jsx", "tests/pointer-document-up-probe.gd", "tests/pointer-document-up-native.test.mjs", "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/rn-pointer-interest-overlay.mjs", "scripts/rn-pointer-overlay.mjs", "native/application_runtime.cpp"]) assert.match(bundles.sources[file], /^[0-9a-f]{64}$/);
  for (const file of ["ReactCommon/react/renderer/components/view/primitives.h", "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp", "ReactCommon/react/renderer/core/EventQueueProcessor.cpp", "ReactCommon/react/renderer/components/view/TouchEventEmitter.cpp", "src/private/webapis/dom/abort-api/AbortController.js", "src/private/webapis/dom/abort-api/AbortSignal.js", "src/private/webapis/dom/nodes/ReactNativeDocument.js", "src/private/webapis/dom/nodes/internals/NodeInternals.js", "src/private/webapis/dom/nodes/internals/ReactNativeDocumentElementInstanceHandle.js"]) assert.match(bundles.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  assert.ok(bundles.bundles[flagMode].inputs.includes("node_modules/react-native/src/private/renderer/events/dispatchNativeEvent.js"));
}

test("original Document and documentElement Up interest obey four immutable flags with native terminal isolation and cleanup", async () => {
  const before = await publicHash(), binary = await ensureGodotBinary(), results = [], reports = {};
  const nativeHostSha256 = digest(await readFile(path.join(root, "addons/fabric_godot.dylib")));
  // Keep every actual report and negative diagnostic before asserting a lane.
  for (const interestMode of interests) {
    const bundles = await bundlePointerDocumentUpProbe({interestMode});
    for (const flagMode of modes) {
      await rm(path.join(root, "build/pointer-document-up-report.json"), {force: true});
      const headed = capture && interestMode === "current" && flagMode === "enabled";
      const result = spawnSync(binary, ["--path", root, ...(headed ? [] : ["--headless"]), "--script", "res://tests/pointer-document-up-probe.gd", "--", "--interest=" + interestMode, "--flag=" + flagMode, ...(headed ? ["--capture"] : [])], {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
      const log = (result.stdout ?? "") + (result.stderr ?? ""), id = interestMode + "-" + flagMode;
      await writeFile(path.join(root, "build/pointer-document-up-" + id + ".log"), log);
      const bytes = await optionalFile("build/pointer-document-up-report.json"), report = bytes == null ? null : JSON.parse(bytes);
      if (report != null) {
        report.provenance = {node: process.version, bundles, publicBundleSha256: before, nativeHostSha256, sourceReceiptDoesNotCertifyNativeBuild: true};
        await writeFile(path.join(root, "build/pointer-document-up-" + id + "-report.json"), JSON.stringify(report, null, 2) + "\n"); reports[id] = report;
      }
      results.push({report, result, log, interestMode, flagMode, bundles, headed});
      assert.equal(await publicHash(), before, "Each isolated Up bundle preserves build/app.js");
      assert.equal(digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), nativeHostSha256, "All eight lane candidates use the same actual compiled native host");
    }
  }
  await writeFile(path.join(root, "build/pointer-document-up-comparison.json"), JSON.stringify({scenario: "native-pointer-document-up-four-flags", interests, flagModes: modes, nativeHostSha256, reports,
    scope: {actualNativeInput: true, sameNativeHostAcrossControls: true, fourIndependentHermesFlagConfigurations: modes.length === 4, publicDefaultEnabled: false, hardwareCertified: false}}, null, 2) + "\n");
  for (const result of results) {
    verify(result);
    for (const frame of result.report.captures) {
      const image = decodeNativePng(await readFile(path.join(root, frame.file)), 760, 220);
      for (const row of frame.pixels) { assert.equal(row.color, row.expected); assert.equal(image.color(...row.point), row.expected, "Saved PNG independently agrees with actual native readback"); }
    }
  }
  if (interests.length === 2 && modes.length === 4) {
    for (const mode of flagModes) {
      const original = reports["original-" + mode], current = reports["current-" + mode];
      assert.deepEqual(Object.keys(original.provenance.bundles.sources).sort(), Object.keys(current.provenance.bundles.sources).sort());
      assert.deepEqual(original.provenance.bundles.sources, current.provenance.bundles.sources);
      assert.deepEqual(original.provenance.bundles.originalReactNativeSources, current.provenance.bundles.originalReactNativeSources);
      assert.equal(original.provenance.nativeHostSha256, current.provenance.nativeHostSha256);
    }
  }
});
