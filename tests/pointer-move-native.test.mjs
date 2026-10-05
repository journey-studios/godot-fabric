import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundlePointerMoveProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {decodeNativePng} from "./native-png.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const capture = process.argv.includes("--capture");
assert.ok(!capture || !allowOriginalNegative, "Native graphical captures run only against the corrected host");
const lane = capture ? "capture" : allowOriginalNegative ? "original" : "current";
const digest = value => createHash("sha256").update(value).digest("hex");
const touchSuffixes = ["Native move delivers exactly the qualified original pointermove callback",
  "Pointer move Raw appears once per channel with the exact callback payload",
  "Each delivered move commits one functional React increment",
  "Native move consults the original pointermove Maps at the exact pinned offsets"];
const mouseSuffixes = ["Native mouse moves deliver trusted pointermove callbacks at the dispatched samples with the unique Continuous priority",
  ...touchSuffixes.slice(1)];
// target: listener on the hit View; parent: on its original parent View.
const cases = [["bubble", false, "only"], ["capture-only", true, "only"], ["ancestor-bubble", false, "parent"], ["ancestor-capture", true, "parent"]];
// The host flushes RN's queue after every input event, so only Godot's input
// accumulation (on by default) merges samples of one frame.
const pair = [[30, -10], [50, 15]];
const mouseCases = [["hover", [[40, 10]], true, 1], ["accumulated", pair, true, 1], ["unaccumulated", pair, false, 2]];
// The two native producers are compiled into the host under comparison; every
// other producer pin must be identical between the old and corrected lanes.
const nativeProducers = ["native/application_runtime.cpp", "scripts/rn-pointer-overlay.mjs"];
// Delivery, pointer Raw, React state and Move lookups depend on native Move
// interest; the preceding host also never consults B's Move Maps.
const expectedFailures = [...cases.flatMap(([id]) => [1, 2].flatMap(sample =>
  touchSuffixes.map(suffix => `case/${id}/move-${sample}/${suffix}`))),
  "sibling-no-listeners/move/B's own Move Maps are consulted false before its parent container and root in path order",
  ...mouseCases.flatMap(([id]) => mouseSuffixes.map(suffix => `mouse/${id}/${suffix}`))];
async function optionalFile(file) {
  try { return await readFile(path.join(root, file)); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function publicHash() { const bytes = await optionalFile("build/app.js"); return bytes == null ? null : digest(bytes); }
const labels = value => value.events.map(row => row.label);
function clean(value) {
  assert.ok(value.globalEventRestored && value.currentPriority === value.defaultPriority);
  assert.equal(value.cleanup.length, value.events.length);
  assert.ok(value.cleanup.every(row => row.originalEvent && row.currentTargetNull && row.phase === 0 && row.pathEmpty));
}
function rawPair(value, type) {
  const raw = value.raw.filter(row => row.type === type);
  assert.deepEqual(raw.map(row => row.channel), ["typed", "star"]); assert.equal(raw[0].payloadId, raw[1].payloadId);
  return raw;
}
// A trusted callback with its Raw pair; phase/currentTag default to a listener
// on the hit target itself.
function nativeEvent(value, label, type, phase = 2, currentTag = value.targetTag) {
  const rows = value.events.filter(row => row.label === label), raw = rawPair(value, type);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row.trusted && row.originalEvent && row.originalSynthetic && row.currentMatches && row.targetMatches && row.globalEventMatches);
  assert.equal(row.phase, phase);
  if (currentTag === value.targetTag) assert.ok(row.thisMatches);
  if (row.type === "pointermove") assert.equal(row.currentTag, currentTag);
  assert.equal(row.payloadId, raw[0].payloadId); assert.equal(row.nativeTarget, raw[0].target);
  assert.equal(row.timeStamp, row.nativeTimeStamp); assert.equal(row.timeStamp, raw[0].timeStamp);
  assert.ok(raw[1].sequence < row.sequence);
  return row;
}
function terminalClean(stage, remaining = 0) {
  assert.equal(stage.after.pointer.activePointers, 0); assert.equal(stage.after.pointer.activeTouches, 0);
  assert.deepEqual(stage.application.pointerProcessor, {active: remaining, pendingCapture: 0, activeCapture: 0, hover: remaining});
  for (const key of ["active", "contacts", "stored"]) assert.equal(stage.application.pointerRouting[key], remaining);
}
// Moves are enqueued unique, so RN's Continuous category maps to Default under
// the pinned priority mapping and to Continuous only when that flag is fixed.
const movePriority = value => value.priorityMappingFixed ? value.continuousPriority : value.defaultPriority;
const lookups = value => value.query.rows.map(row => [row.targetTag, row.offset, row.result, row.rootHandle]);
function healthyLookups(value) {
  assert.ok(value.query.rows.every(row => row.action === "delegate" && !row.matched && row.resultKind === "boolean"));
  for (let index = 1; index < value.query.rows.length; ++index)
    assert.ok(value.query.rows[index - 1].sequence < value.query.rows[index].sequence);
}

// Move lookups run on every sample: a failing one is retained once per distinct
// cause, up to 16 distinct causes, and otherwise only counted. The preceding
// host never consults Move Maps, so the fault application runs only on the
// corrected host.
function moveFaults(report) {
  if (allowOriginalNegative) { assert.deepEqual(report.faultExpectedErrors, []); return; }
  const stages = report.stages, cause = "GF pointer query deliberate fault: ";
  const caps = Array.from({length: 15}, (_, index) => "cap-" + String(index + 1).padStart(2, "0"));
  const expectedCauses = [cause + "move1", "Pointer listener query must return a boolean", ...caps.slice(0, 14).map(label => cause + label)];
  assert.deepEqual(report.faultExpectedErrors, expectedCauses);
  assert.deepEqual(Object.fromEntries(["offset", "mode", "remaining", "label"].map(key => [key, stages["fault/repeat-throw1/fault"][key]])),
    {offset: 1, mode: "throw", remaining: 3, label: "move1"});
  assert.deepEqual(Object.fromEntries(["offset", "mode", "remaining", "label"].map(key => [key, stages["fault/repeat-nonboolean25/fault"][key]])),
    {offset: 25, mode: "nonboolean", remaining: 2, label: "move25"});
  const failing = (key, own) => {
    const value = stages[key].react, rows = value.query.rows;
    assert.deepEqual(rows.slice(0, 2).map(row => [row.targetTag, row.offset, row.action]), own.map(([offset, action]) => [value.targetTag, offset, action]));
    assert.deepEqual(rows.slice(2).map(row => [row.offset, row.action, row.result]), [1, 25, 1, 25, 1, 25].map(offset => [offset, "delegate", false]));
    assert.deepEqual(rows.slice(2).map(row => row.rootHandle), [false, false, false, false, true, true]);
    assert.deepEqual(value.events, []); assert.deepEqual(value.raw.filter(row => row.type === "topPointerMove"), []);
    assert.equal(value.panels[value.name].moves, value.baselineMoves);
  };
  const delivered = (key, own) => {
    const value = stages[key].react;
    assert.deepEqual(value.query.rows.map(row => [row.targetTag, row.offset, row.action, row.result]), own.map(([offset, result]) => [value.targetTag, offset, "delegate", result]));
    assert.equal(value.events.length, 1); assert.equal(value.events[0].type, "pointermove"); assert.ok(value.events[0].trusted);
    assert.equal(value.panels[value.name].moves, value.baselineMoves + 1);
  };
  const counted = [];
  for (const sample of [1, 2, 3]) {
    failing(`fault/repeat-throw1/move-${sample}`, [[1, "throw"], [25, "delegate"]]);
    counted.push([`fault/repeat-throw1/move-${sample}`, sample === 1 ? 1 : 0, sample === 1 ? 0 : 1]);
  }
  delivered("fault/repeat-throw1/recovery", [[1, true]]); counted.push(["fault/repeat-throw1/recovery", 0, 0]);
  for (const sample of [1, 2]) {
    failing(`fault/repeat-nonboolean25/move-${sample}`, [[1, "delegate"], [25, "nonboolean"]]);
    counted.push([`fault/repeat-nonboolean25/move-${sample}`, sample === 1 ? 1 : 0, sample === 1 ? 0 : 1]);
  }
  delivered("fault/repeat-nonboolean25/recovery", [[1, false], [25, true]]); counted.push(["fault/repeat-nonboolean25/recovery", 0, 0]);
  for (const [index, label] of caps.entries()) {
    failing("fault/distinct-cap/" + label, [[1, "throw"], [25, "delegate"]]);
    counted.push(["fault/distinct-cap/" + label, index < 14 ? 1 : 0, index < 14 ? 0 : 1]);
  }
  delivered("fault/B-healthy/move", [[1, true]]); counted.push(["fault/B-healthy/move", 0, 0]);
  for (const [key, retained, suppressed] of counted) {
    assert.equal(stages[key].errorsAfter - stages[key].errorsBefore, retained, key);
    assert.equal(stages[key].suppressedAfter - stages[key].suppressedBefore, suppressed, key);
  }
  const stopped = stages["fault/stopped"];
  assert.ok(stopped.stopped && !stopped.pointerListenerQueryInstalled && stopped.rootCount === 0);
  assert.equal(stopped.errors.length, 16); assert.equal(stopped.pointerListenerQuerySuppressed, 4);
  stopped.errors.forEach((line, index) => assert.ok(line.startsWith("E_POINTER_LISTENER_QUERY: ") && line.includes(expectedCauses[index])));
}

test("original imperative View pointermove qualifies native interest while original touch moves and cleanup survive", async () => {
  const before = await publicHash(), bundles = await bundlePointerMoveProbe();
  await rm(path.join(root, "build/pointer-move-report.json"), {force: true});
  const binary = await ensureGodotBinary();
  const result = spawnSync(binary, ["--path", root, ...(capture ? [] : ["--headless"]), "--script", "res://tests/pointer-move-probe.gd", "--",
    ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(capture ? ["--capture"] : [])], {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, "build/pointer-move-" + lane + ".log"), log);
  const bytes = await optionalFile("build/pointer-move-report.json"), report = bytes == null ? null : JSON.parse(bytes);
  if (report != null) {
    report.provenance = {node: process.version, bundles, publicBundleSha256: before,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, "build/pointer-move-" + lane + "-report.json"), JSON.stringify(report, null, 2) + "\n");
  }
  // Save actual artifacts before assertions. The old-host flag never accepts
  // unrelated failures or removes the normative failures from the report.
  assert.equal(result.error, undefined, log); assert.equal(result.signal, null, log); assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use|Inconsistency between local and platform pointer registries/);
  assert.equal(report.scenario, "native-pointer-move-view-interest"); assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, capture ? "macOS" : "headless"); assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(report.captureRequested, capture); assert.equal(report.captures.length, capture ? 2 : 0);
  assert.equal(report.originalNegativeObserved, allowOriginalNegative); assert.equal(report.allCurrentAssertionsPassed, !allowOriginalNegative);
  for (const [index, frame] of report.captures.entries()) {
    const updated = index === 1, moves = updated ? 2 : 0;
    assert.equal(frame.file, "build/pointer-move-" + (updated ? "updated" : "initial") + ".png");
    assert.equal(frame.width, 680); assert.equal(frame.height, 160);
    assert.deepEqual(frame.expectedReactCounters, {A: {moves}, B: {moves: 0}});
    assert.equal(frame.reactCounters.A.moves, moves); assert.equal(frame.reactCounters.B.moves, 0);
    // The bar spans x160..179+4*moves: its last orange and first background
    // pixels pin the exact count for each root.
    assert.deepEqual(frame.pixels.map(row => row.point), [[5, 5], [75, 55], [165, 125], [179 + 4 * moves, 125], [180 + 4 * moves, 125],
      [345, 5], [415, 55], [505, 125], [519, 125], [520, 125]]);
    assert.deepEqual(frame.pixels.map(row => row.expected), ["0f172aff", "2563ebff", "f97316ff", "f97316ff", "0f172aff",
      "0f172aff", "2563ebff", "f97316ff", "f97316ff", "0f172aff"]);
    const image = decodeNativePng(await readFile(path.join(root, frame.file)), 680, 160);
    for (const row of frame.pixels) {
      assert.equal(row.color, row.expected, "Actual native viewport readback agrees with the fixed declared React stage");
      assert.equal(image.color(...row.point), row.expected, "Independently decoded saved PNG agrees with the actual pixel report");
    }
  }
  // Captures and the corrected-host fault application add separate checks.
  const base = row => !row.name.startsWith("move-capture/") && !row.name.startsWith("fault/");
  assert.equal(report.checks.filter(row => row.name.startsWith("move-capture/")).length, capture ? 24 : 0, "Ten actual pixels plus counters and save/dimensions per native frame");
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.deepEqual([...report.expectedOriginalFailures].sort(), [...expectedFailures].sort());
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual([...failures].sort(), allowOriginalNegative ? [...expectedFailures].sort() : [], "Only the normative Move failures qualify as the old-host control");
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual([...checkErrors].sort(), [...failures].sort());
  // Only the fault application's retained Move diagnostics print natively.
  const nativeErrors = [...log.matchAll(/^ERROR: FABRIC_ERROR: (.+)$/gm)].map(match => match[1]);
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length + nativeErrors.length, "No script or engine error is hidden");
  assert.equal(nativeErrors.length, report.faultExpectedErrors.length);
  nativeErrors.forEach((line, index) => assert.ok(line.startsWith("E_POINTER_LISTENER_QUERY: ") && line.includes(report.faultExpectedErrors[index])));
  assert.match(log, allowOriginalNegative ? new RegExp(`POINTER_MOVE_ORIGINAL_NEGATIVE: ${expectedFailures.length}`) : /POINTER_MOVE_PASSED: \d+/);
  assert.equal(bundles.nativeDispatchMode, "experimental"); assert.equal(bundles.pointerInterestMode, "current");
  for (const file of ["tests/pointer-move-fixture.jsx", "tests/pointer-move-probe.gd", "tests/pointer-move-native.test.mjs", "tests/native-png.mjs",
    "tests/pointer-query-fault-bootstrap.js", "tests/pointer-query-fault-fixture.jsx", "tests/pointer-query-fault-probe.gd",
    "src/pointer-listener-query.js", "sdk/toolchain/rn-pointer-interest-overlay.mjs", ...nativeProducers])
    assert.match(bundles.sources[file], /^[0-9a-f]{64}$/, "Pin every reused producer and SDK/native seam: " + file);
  for (const file of ["ReactCommon/react/renderer/components/view/primitives.h", "ReactCommon/react/renderer/core/EventQueueProcessor.cpp",
    "ReactCommon/react/renderer/core/EventEmitter.cpp", "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp"])
    assert.match(bundles.originalReactNativeSources[file], /^[0-9a-f]{64}$/, "Pin original enum, queue, emitter and processor: " + file);
  for (const name of ["A", "B"]) {
    const cap = report.stages["capability" + name];
    assert.ok(cap.original && cap.connected && cap.flags.imperative && cap.flags.nativeDispatch);
    assert.deepEqual(cap.methods, ["function", "function", "function"]); assert.equal(cap.query.installations, 1); assert.ok(cap.query.restoredInstaller);
  }
  let expectedMoves = 0;
  for (const [id, captureOnly, where] of cases) {
    const prefix = "case/" + id, label = "pointermove-" + (captureOnly ? "capture" : "bubble");
    const registration = report.stages[prefix + "/registration"], manual = report.stages[prefix + "/manual"];
    const phase = where === "only" ? 2 : captureOnly ? 1 : 3;
    assert.equal(registration.type, "pointermove"); assert.equal(registration.capture, captureOnly);
    const listenerTag = where === "only" ? registration.targetTag : registration.listenerTag;
    if (where === "parent") assert.ok(Number.isSafeInteger(listenerTag) && listenerTag !== registration.targetTag);
    assert.ok(manual.result.returned && manual.result.cleaned && manual.result.targetMatches && !manual.result.trusted);
    assert.deepEqual(labels(manual.react), [label]); assert.equal(manual.react.events[0].phase, phase);
    assert.equal(manual.react.events[0].type, "pointermove"); assert.equal(manual.react.events[0].currentTag, listenerTag);
    assert.deepEqual(manual.react.raw, []); assert.deepEqual(manual.react.query.rows, []);
    assert.equal(manual.react.panels.A.moves, manual.react.baselineMoves); clean(manual.react);
    const down = report.stages[prefix + "/down"];
    assert.deepEqual(labels(down.react), ["touchstart"]); nativeEvent(down.react, "touchstart", "topTouchStart"); clean(down.react);
    assert.ok(down.react.query.rows.every(row => row.action === "delegate" && row.result === false && [34, 35].includes(row.offset)));
    for (const sample of [1, 2]) {
      const stage = report.stages[`${prefix}/move-${sample}`], value = stage.react;
      rawPair(value, "topTouchMove"); clean(value);
      assert.equal(stage.after.pointer.pointerMoves, stage.before.pointer.pointerMoves + 1);
      assert.equal(stage.after.pointer.moves, stage.before.pointer.moves + 1);
      assert.equal(stage.after.pointer.activePointers, 1); assert.equal(stage.after.pointer.activeTouches, 1);
      assert.equal(value.panels.A.starts, value.baselineStarts);
      if (allowOriginalNegative) {
        assert.deepEqual(value.events, []); assert.deepEqual(value.query.rows, [], "The preceding host never enters the SDK for Move");
        assert.deepEqual(value.raw.filter(row => row.type === "topPointerMove"), []);
        assert.equal(value.panels.A.moves, value.baselineMoves); assert.equal(stage.after.commits, stage.before.commits);
      } else {
        assert.deepEqual(labels(value), [label]);
        const row = nativeEvent(value, label, "topPointerMove", phase, listenerTag);
        assert.ok(row.type === "pointermove" && row.pointerId > 0 && row.pointerType === "touch" && row.buttons === 1);
        assert.equal(row.currentPriority, movePriority(value));
        const target = value.targetTag, parent = value.panels.A.parentTag;
        assert.equal(parent, registration.listenerTag ?? parent);
        const own = where === "only" ? (captureOnly ? [[target, 1, false, false], [target, 25, true, false]] : [[target, 1, true, false]])
          : [[target, 1, false, false], [target, 25, false, false],
            ...(captureOnly ? [[parent, 1, false, false], [parent, 25, true, false]] : [[parent, 1, true, false]])];
        assert.deepEqual(lookups(value), own); healthyLookups(value);
        assert.equal(value.panels.A.moves, value.baselineMoves + 1); assert.equal(stage.after.commits, stage.before.commits + 1);
        ++expectedMoves;
      }
    }
    const up = report.stages[prefix + "/up"];
    assert.deepEqual(labels(up.react), ["touchend"]); nativeEvent(up.react, "touchend", "topTouchEnd"); clean(up.react); terminalClean(up);
    assert.ok(up.react.query.rows.every(row => row.action === "delegate" && row.result === false && [36, 37].includes(row.offset)));
    assert.deepEqual(up.react.raw.filter(row => row.type === "topPointerMove"), []);
  }
  const bMove = report.stages["sibling-no-listeners/move"];
  assert.deepEqual(bMove.react.events, []); rawPair(bMove.react, "topTouchMove");
  assert.deepEqual(bMove.react.raw.filter(row => row.type === "topPointerMove"), []);
  assert.equal(bMove.react.panels.B.moves, bMove.react.baselineMoves); assert.equal(bMove.after.commits, bMove.before.commits);
  if (allowOriginalNegative) assert.deepEqual(bMove.react.query.rows, []);
  else {
    // The full native path in order: B, its parent, the AppRegistry container
    // and the owning root handle, each read 1 then 25 and false.
    const containers = bMove.after.nodes.filter(node => node.testID === "");
    assert.equal(containers.length, 1);
    const chain = [bMove.react.targetTag, bMove.react.panels.B.parentTag, containers[0].tag];
    assert.equal(new Set(chain).size, 3);
    assert.deepEqual(lookups(bMove.react), [...chain.flatMap(tag => [[tag, 1, false, false], [tag, 25, false, false]]),
      [null, 1, false, true], [null, 25, false, true]]);
    assert.deepEqual(bMove.expectedRows, lookups(bMove.react)); healthyLookups(bMove.react);
  }
  terminalClean(report.stages["sibling-no-listeners/up"]);
  // Cancel is always emitted by RN's processor, so this guards cleanup and the
  // listener rather than discriminating Move interest.
  const cancel = report.stages["cancel-is-not-move/cancel"];
  assert.deepEqual(labels(cancel.react), ["touchcancel"]); nativeEvent(cancel.react, "touchcancel", "topTouchCancel"); clean(cancel.react); terminalClean(cancel);
  assert.deepEqual(cancel.react.query.rows, []); assert.equal(cancel.react.panels.A.moves, cancel.react.baselineMoves);
  for (const [id, samples, accumulated, dispatched] of mouseCases) {
    const stage = report.stages["mouse/" + id], value = stage.react, delivered = samples.slice(-dispatched);
    assert.deepEqual(stage.samples, samples); assert.equal(stage.accumulated, accumulated);
    assert.deepEqual(stage.points, delivered.map(([x, y]) => [75 + x - 20, 55 + y - 20]));
    assert.equal(stage.before.pointer.activePointers, 0, "No contact holds a ContinuousStart before the mouse sample");
    assert.equal(stage.after.pointer.pointerMoves, stage.before.pointer.pointerMoves + dispatched, "Godot accumulation alone decides how many samples reach the host");
    assert.equal(stage.after.pointer.moves, stage.before.pointer.moves); assert.equal(stage.after.pointer.activeTouches, 0);
    assert.deepEqual(value.raw.filter(row => row.type === "topTouchMove"), []); clean(value);
    assert.notEqual(value.defaultPriority, value.discretePriority);
    if (allowOriginalNegative) {
      assert.deepEqual(value.events, []); assert.deepEqual(value.query.rows, []);
      assert.equal(value.panels.A.moves, value.baselineMoves); assert.equal(stage.after.commits, stage.before.commits);
    } else {
      assert.deepEqual(labels(value), delivered.map(() => "pointermove-bubble"));
      const raw = value.raw.filter(row => row.type === "topPointerMove");
      assert.equal(raw.length, 2 * dispatched);
      for (const [index, row] of value.events.entries()) {
        const pairRows = raw.slice(2 * index, 2 * index + 2);
        assert.deepEqual(pairRows.map(entry => entry.channel), ["typed", "star"]); assert.equal(pairRows[0].payloadId, pairRows[1].payloadId);
        assert.ok(row.trusted && row.originalEvent && row.originalSynthetic && row.currentMatches && row.thisMatches && row.targetMatches && row.globalEventMatches);
        assert.equal(row.phase, 2); assert.equal(row.currentTag, value.targetTag);
        assert.equal(row.payloadId, pairRows[0].payloadId); assert.equal(row.timeStamp, pairRows[0].timeStamp); assert.ok(pairRows[1].sequence < row.sequence);
        assert.ok(row.pointerType === "mouse" && row.buttons === 0 && row.pointerId > 0);
        assert.deepEqual([row.offsetX, row.offsetY], stage.points[index]);
        assert.equal(row.currentPriority, movePriority(value));
      }
      assert.deepEqual(lookups(value), delivered.map(() => [value.targetTag, 1, true, false])); healthyLookups(value);
      assert.equal(value.panels.A.moves, value.baselineMoves + dispatched); assert.equal(stage.after.commits, stage.before.commits + dispatched);
      expectedMoves += dispatched;
    }
  }
  assert.equal(report.stages.beforeStop.react.panels.A.moves, expectedMoves); assert.equal(expectedMoves, allowOriginalNegative ? 0 : 12);
  assert.equal(report.stages.beforeStop.react.panels.B.moves, 0);
  assert.deepEqual(report.afterStop.errors, []); assert.ok(report.afterStop.stopped && !report.afterStop.pointerListenerQueryInstalled && report.afterStop.rootCount === 0);
  for (const key of ["pendingWork", "pendingTimers", "pendingAnimationFrames", "pendingRootRetirements"]) assert.equal(report.afterStop[key], 0);
  assert.deepEqual(report.afterStop.pointerProcessor, {active: 0, pendingCapture: 0, activeCapture: 0, hover: 0});
  for (const name of ["A", "B"]) {
    const owner = report.stages["stoppedRoot" + name];
    assert.equal(owner.nativeTags, 0); assert.equal(owner.creates, owner.deletes); assert.equal(owner.pointer.activePointers, 0); assert.equal(owner.pointer.activeTouches, 0);
  }
  moveFaults(report);
  assert.equal(await publicHash(), before);
  if (!allowOriginalNegative) {
    const originalBytes = await optionalFile("build/pointer-move-original-report.json"), original = originalBytes == null ? null : JSON.parse(originalBytes);
    if (original != null) {
      assert.ok(original.originalNegativeObserved);
      assert.deepEqual(original.checks.map(row => row.name), report.checks.filter(base).map(row => row.name), "Captures and the fault application only add separate checks");
      assert.deepEqual(original.provenance.bundles.originalReactNativeSources, bundles.originalReactNativeSources);
      // The causal control executes the same final SDK bundle on the preserved
      // host. Its two native producers are compiled into that host, so their
      // bundle-time pins say nothing about it; every other producer matches.
      assert.equal(original.provenance.bundles.bundles.enabled.sha256, bundles.bundles.enabled.sha256);
      for (const [file, sha] of Object.entries(bundles.sources))
        if (!nativeProducers.includes(file))
          assert.equal(original.provenance.bundles.sources[file], sha, "Old/new hosts share the actual reproducer and SDK producer: " + file);
      assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
    }
    await writeFile(path.join(root, capture ? "build/pointer-move-capture-comparison.json" : "build/pointer-move-comparison.json"), JSON.stringify({scenario: report.scenario,
      originalControlPresent: original != null, sameSDKBundleRequired: true, intentionalNativeProducerDifferences: nativeProducers,
      original, current: report}, null, 2) + "\n");
  }
});
