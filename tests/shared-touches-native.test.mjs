import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleProbe, eventTargetProbeModes} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const requestedFlag = process.argv.find(value => value.startsWith("--flag="))?.slice(7);
assert.ok(requestedFlag == null || eventTargetProbeModes.includes(requestedFlag));
// The preceding host runs once, in a native-dispatch lane.
const modes = allowOriginalNegative ? ["enabled"] : requestedFlag == null ? eventTargetProbeModes : [requestedFlag];
const digest = value => createHash("sha256").update(value).digest("hex");
const nativeProducers = ["native/application_runtime.cpp", "native/pointer_adapter.cpp", "native/pointer_adapter.h"];
async function optionalFile(file) { try { return await readFile(path.join(root, file)); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function publicHash() { const bytes = await optionalFile("build/app.js"); return bytes == null ? null : digest(bytes); }

// An independent statement of RN's single JS responder over every touch of
// the runtime. Godot touch index i is identifier i + 1 and the mouse is 0. A
// touch event lists every active touch of the application, ended ones
// excluded; targetTouches stay within the touch's own target. A touch in the
// other root cannot claim (no common ancestor) and cannot release while the
// holder's touch is listed; a cancel terminates the one responder.
const press = (root, id, by = root) => [[root, "pressIn", [id], root], [root, "pressOut", [id], by], [root, "press", [id], by]];
const start = (root, id, touches) => [root, "topTouchStart", [id], touches, [id]];
const end = (root, id, touches, type = "topTouchEnd") => [root, type, [id], touches, []];
const cases = {
  "touch/overlap-a-then-b": {events: press("A", 1), raw: [start("A", 1, [1]), start("B", 2, [1, 2]), end("B", 2, [1]), end("A", 1, [])],
    normative: ["events", "raw"]},
  "touch/overlap-b-then-a": {events: press("B", 1), raw: [start("B", 1, [1]), start("A", 2, [1, 2]), end("A", 2, [1]), end("B", 1, [])],
    normative: ["events", "raw"]},
  "mixed/mouse-a-touch-b": {events: press("A", 0), raw: [start("A", 0, [0]), start("B", 1, [0, 1]), end("B", 1, [0]), end("A", 0, [])],
    normative: ["events", "raw"]},
  "touch/sequential": {events: [...press("A", 1), ...press("B", 1)],
    raw: [start("A", 1, [1]), end("A", 1, []), start("B", 1, [1]), end("B", 1, [])], normative: []},
  // When A's own touch ends first, the legacy plugin releases A (B's listed
  // touch is outside it); ReactNativeResponder releases only when no touch
  // remains, so A presses with B's end, as on one RN surface.
  "touch/a-lifts-first": {events: press("A", 1), nativeEvents: [["A", "pressIn", [1], "A"], ["A", "pressOut", [2], "B"], ["A", "press", [2], "B"]],
    raw: [start("A", 1, [1]), start("B", 2, [1, 2]), end("A", 1, [2]), end("B", 2, [])], normative: ["events", "raw"]},
  "touch/cancel-b": {events: [["A", "pressIn", [1], "A"], ["A", "pressOut", [2], "B"]],
    raw: [start("A", 1, [1]), start("B", 2, [1, 2]), end("B", 2, [1], "topTouchCancel"), end("A", 1, [])], normative: ["raw"]},
};
const names = {events: "The original Pressables see RN's single-responder gesture", raw: "Each TouchEvent lists every touch the application's runtime sees"};

function rootsOf(stage) {
  const tags = {};
  for (const [name, surface] of Object.entries(stage.surfaces))
    for (const node of surface.nodes) if (node.testID === name + "-press") tags[node.tag] = name;
  return tags;
}
// Lanes with native dispatch run ReactNativeResponder.
const nativeDispatch = flagMode => flagMode === "internal-only" || flagMode === "enabled";
const expectedEvents = (spec, flagMode) => (nativeDispatch(flagMode) && spec.nativeEvents) || spec.events;
function verifyCase(id, stage, flagMode) {
  const spec = cases[id], tags = rootsOf(stage), react = stage.react;
  assert.deepEqual(react.events.map(row => [row.name, row.callback, row.changed, tags[row.target]]), expectedEvents(spec, flagMode), id);
  assert.deepEqual(react.raw.map(row => [tags[row.target], row.type, row.changed, row.touches, row.targetTouches]), spec.raw, id);
  assert.equal(stage.application.pointerRouting.active, 0, id);
}

function verify({report, result, log, flagMode}) {
  assert.equal(result.error, undefined, log); assert.equal(result.signal, null, log); assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "native-shared-touches"); assert.equal(report.flagMode, flagMode); assert.equal(report.displayServer, "headless");
  // Both hosts state all 23 checks: the six cases, mount and cleanup.
  assert.equal(report.checks.length, 23);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual([...checkErrors].sort(), [...report.failures].sort());
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native, script or engine error is hidden");
  if (allowOriginalNegative) {
    // The preceding host lists only a root's own touches: a touch ending in
    // the other root releases the holder with that touch's payload.
    const expected = Object.entries(cases).flatMap(([id, spec]) => spec.normative.map(kind => `${id}/${names[kind]}`));
    assert.deepEqual([...report.expectedOriginalFailures].sort(), [...expected].sort());
    assert.deepEqual([...report.failures].sort(), [...expected].sort());
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(report.stages["touch/overlap-a-then-b"].react.events.map(row => [row.name, row.callback, row.changed]),
      [["A", "pressIn", [1]], ["A", "pressOut", [2]], ["A", "press", [2]]], "The defect: A presses with B's touch");
    return;
  }
  assert.ok(report.allAssertionsPassed); assert.deepEqual(report.failures, []);
  assert.match(log, /SHARED_TOUCHES_PASSED: \d+/);
  for (const id of Object.keys(cases)) verifyCase(id, report.stages[id], flagMode);
  assert.ok(report.afterStop.stopped && report.afterStop.rootCount === 0 && report.afterStop.errors.length === 0);
}

test("roots of one application share RN's single responder over every touch", async () => {
  const before = await publicHash(), binary = await ensureGodotBinary(), results = [], reports = {};
  const nativeHostSha256 = digest(await readFile(path.join(root, "addons/fabric_godot.dylib")));
  const bundles = await bundleProbe({entryPoint: "tests/shared-touches-fixture.jsx", modes, prefix: "shared-touches",
    parentMode: "current", rendererTagMode: "current", nativeDispatchMode: "experimental", pointerInterestMode: "original",
    sources: ["tests/event-target-bootstrap.js", "tests/shared-touches-fixture.jsx", "tests/shared-touches-probe.gd",
      "tests/shared-touches-native.test.mjs", "scripts/event-target-bundle.mjs", "sdk/toolchain/platform-plugin.mjs",
      "src/react-native-platform.jsx", "src/components.jsx", ...nativeProducers],
    extraUpstreamFiles: ["Libraries/Pressability/Pressability.js", "src/private/renderer/events/ReactNativeResponder.js",
      "src/private/renderer/events/dispatchNativeEvent.js", "ReactCommon/react/renderer/components/view/TouchEventEmitter.cpp"]});
  // Keep every actual report before asserting a lane.
  for (const flagMode of modes) {
    await rm(path.join(root, "build/shared-touches-report.json"), {force: true});
    const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/shared-touches-probe.gd", "--",
      "--flag=" + flagMode, ...(allowOriginalNegative ? ["--allow-original-negative"] : [])], {encoding: "utf8", timeout: 300000, maxBuffer: 16 * 1024 * 1024});
    const log = (result.stdout ?? "") + (result.stderr ?? ""), id = allowOriginalNegative ? "original" : flagMode;
    await writeFile(path.join(root, "build/shared-touches-" + id + ".log"), log);
    const bytes = await optionalFile("build/shared-touches-report.json"), report = bytes == null ? null : JSON.parse(bytes);
    if (report != null) {
      report.provenance = {node: process.version, bundles, publicBundleSha256: before, nativeHostSha256};
      await writeFile(path.join(root, "build/shared-touches-" + id + "-report.json"), JSON.stringify(report, null, 2) + "\n"); reports[id] = report;
    }
    results.push({report, result, log, flagMode});
    assert.equal(await publicHash(), before, "Each isolated bundle preserves build/app.js");
  }
  for (const result of results) verify(result);
  if (allowOriginalNegative || modes.length !== eventTargetProbeModes.length) return;
  // Lanes of the same responder implementation agree on every case; the two
  // implementations differ only where the cases state it.
  const trace = (mode, id) => reports[mode].stages[id].react.events.map(row => [row.name, row.callback, row.changed]);
  for (const id of Object.keys(cases))
    for (const mode of eventTargetProbeModes) {
      assert.deepEqual(trace(mode, id), trace(nativeDispatch(mode) ? "enabled" : "disabled", id), `${mode} ${id}`);
      assert.equal(JSON.stringify(trace("enabled", id)) === JSON.stringify(trace("disabled", id)), cases[id].nativeEvents == null, id);
    }
  const originalBytes = await optionalFile("build/shared-touches-original-report.json"), original = originalBytes == null ? null : JSON.parse(originalBytes);
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assert.equal(original.provenance.bundles.bundles.enabled.sha256, reports.enabled.provenance.bundles.bundles.enabled.sha256);
    for (const [file, sha] of Object.entries(reports.enabled.provenance.bundles.sources))
      if (!nativeProducers.includes(file)) assert.equal(original.provenance.bundles.sources[file], sha, "Old/new hosts share the reproducer and SDK: " + file);
    assert.notEqual(original.provenance.nativeHostSha256, reports.enabled.provenance.nativeHostSha256);
  }
  await writeFile(path.join(root, "build/shared-touches-comparison.json"), JSON.stringify({scenario: "native-shared-touches", modes,
    nativeHostSha256, originalControlPresent: original != null, reports, original}, null, 2) + "\n");
});
