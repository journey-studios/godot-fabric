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
const allowPreviousSDK = process.argv.includes("--allow-previous-sdk");
const requestedFlag = process.argv.find(value => value.startsWith("--flag="))?.slice(7);
assert.ok(requestedFlag == null || eventTargetProbeModes.includes(requestedFlag));
// The preceding SDK replaced PanResponder with a stub; one lane shows it.
const modes = allowPreviousSDK ? ["disabled"] : requestedFlag == null ? eventTargetProbeModes : [requestedFlag];
const digest = value => createHash("sha256").update(value).digest("hex");
async function optionalFile(file) { try { return await readFile(path.join(root, file)); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function publicHash() { const bytes = await optionalFile("build/app.js"); return bytes == null ? null : digest(bytes); }

// An independent statement of RN's PanResponder over its responder system.
// Grant sets x0/y0 to the touch centroid and resets dx/dy; moves accumulate the
// centroid change of the touches that changed at or after the accounted time
// (all active touches in a multi-touch move); start and end read the active
// count; a claimer is granted before the responder is asked to yield.
const g = (x0, y0) => ({x0, y0, dx: 0, dy: 0});
const cases = {
  "touch/drag": [["P", "grant", {...g(40, 40), numberActiveTouches: 1}], ["P", "start", {numberActiveTouches: 1}],
    ["P", "move", {dx: 20, dy: 10, moveX: 60, moveY: 50}], ["P", "move", {dx: 40, dy: 30, moveX: 80, moveY: 70}],
    ["P", "end", {numberActiveTouches: 0}], ["P", "release", {dx: 40, dy: 30, x0: 40, y0: 40}]],
  "mouse/drag": [["P", "grant", g(40, 40)], ["P", "start", {numberActiveTouches: 1}],
    ["P", "move", {dx: 20, dy: 10}], ["P", "move", {dx: 40, dy: 30}], ["P", "end", {numberActiveTouches: 0}], ["P", "release", {dx: 40, dy: 30}]],
  "touch/two-fingers": [["P", "grant", g(30, 30)], ["P", "start", {numberActiveTouches: 1}], ["P", "start", {numberActiveTouches: 2}],
    ["P", "move", {dx: 0, dy: 10, moveX: 60, moveY: 40, numberActiveTouches: 2}],
    ["P", "move", {dx: 0, dy: 30, moveX: 60, moveY: 50, numberActiveTouches: 2}],
    ["P", "end", {numberActiveTouches: 1}], ["P", "end", {numberActiveTouches: 0}], ["P", "release", {dx: 0, dy: 30}]],
  "touch/tap-pressable": [["K", "pressIn"], ["K", "pressOut"], ["K", "press"]],
  "touch/claim": [["K", "pressIn"], ["Q", "grant", g(185, 55)], ["K", "pressOut"], ["Q", "move", {dx: 0, dy: 15, moveY: 70}],
    ["Q", "end", {numberActiveTouches: 0}], ["Q", "release", {dy: 15}]],
  "touch/refuse": [["R", "grant", {x0: 250, y0: 35}], ["R", "start", {numberActiveTouches: 1}], ["Q", "grant", g(250, 55)], ["Q", "reject"],
    ["R", "move", {dx: 0, dy: 20}], ["R", "end", {numberActiveTouches: 0}], ["R", "release", {dy: 20}]],
  "touch/capture": [["T", "grant", {x0: 45, y0: 140}], ["T", "start", {numberActiveTouches: 1}], ["T", "move", {dx: 10, dy: 10}],
    ["T", "end", {numberActiveTouches: 0}], ["T", "release", {dx: 10, dy: 10}]],
  "touch/remove": [["M", "grant", {x0: 180, y0: 140}], ["M", "start", {numberActiveTouches: 1}], ["M", "move", {dx: 10, dy: 10}],
    ["P", "grant", g(40, 40)], ["P", "start", {numberActiveTouches: 1}], ["P", "end", {numberActiveTouches: 0}], ["P", "release", {dx: 0, dy: 0}]],
  "B/touch/drag": [["P", "grant", g(40, 40)], ["P", "start", {numberActiveTouches: 1}], ["P", "move", {dx: 30, dy: 0}],
    ["P", "end", {numberActiveTouches: 0}], ["P", "release", {dx: 30, dy: 0}]],
};

function verifyCase(id, stage) {
  const events = stage.react.events, name = id.startsWith("B/") ? "B" : "A";
  assert.deepEqual(events.map(row => [row.view, row.callback]), cases[id].map(([view, callback]) => [view, callback]), id);
  cases[id].forEach(([, , fields = {}], index) => {
    for (const [key, value] of Object.entries(fields)) assert.equal(events[index][key], value, `${id} #${index} ${key}`);
  });
  assert.ok(events.every(row => row.name === name), id);
  // Responder callbacks carry the original touch history; velocity follows the move.
  for (const row of events.filter(entry => entry.callback !== "pressIn" && entry.callback !== "pressOut" && entry.callback !== "press"))
    assert.ok(row.touchHistory && Number.isFinite(row.vx) && Number.isFinite(row.vy), id);
  for (const row of events.filter(entry => entry.callback === "move"))
    assert.ok(row.vx * row.dx >= 0 && row.vy * row.dy >= 0, id);
  assert.deepEqual([stage.surface.pointer.activeTouches, stage.application.pointerRouting.active, stage.application.pointerProcessor.active], [0, 0, 0], id);
}

function verify({report, result, log, flagMode}) {
  assert.equal(result.error, undefined, log); assert.equal(result.signal, null, log); assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "native-pan-responder"); assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.flagMode, flagMode); assert.equal(report.displayServer, "headless");
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual([...checkErrors].sort(), [...report.failures].sort());
  if (allowPreviousSDK) {
    // The stub throws when the fixture creates its first PanResponder: nothing
    // renders, so the run fails exactly at mount, with that error on record.
    assert.ok(report.previousSDKObserved && !report.allAssertionsPassed);
    assert.deepEqual(report.failures, ["mount/Two roots render original PanResponder instances in one Hermes application",
      "cleanup/No dispatch or responder diagnostic was hidden", "cleanup/Stop balances roots, routes and work without diagnostics"]);
    assert.match(log, /Chart platform PanResponder\/pinch zoom is not implemented/);
    assert.match(log, /PAN_RESPONDER_PREVIOUS_SDK: 3/);
    return;
  }
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, 0, "No native, script or engine error is printed");
  assert.ok(report.allAssertionsPassed); assert.deepEqual(report.failures, []);
  assert.match(log, /PAN_RESPONDER_PASSED: \d+/);
  for (const id of Object.keys(cases)) verifyCase(id, report.stages[id]);
  assert.equal(report.stages["touch/tap-pressable"].react.panels.A.presses, 1);
  assert.equal(report.stages["touch/claim"].react.panels.A.presses, 1, "The claimed gesture never presses");
  assert.ok(report.afterStop.stopped && report.afterStop.rootCount === 0 && report.afterStop.errors.length === 0);
}

test("the original PanResponder negotiates and tracks gestures from actual Godot input", async () => {
  const before = await publicHash(), binary = await ensureGodotBinary(), results = [], reports = {};
  const nativeHostSha256 = digest(await readFile(path.join(root, "addons/fabric_godot.dylib")));
  const bundles = await bundleProbe({entryPoint: "tests/pan-responder-fixture.jsx", modes, prefix: "pan-responder",
    parentMode: "current", rendererTagMode: "current", nativeDispatchMode: "experimental", pointerInterestMode: "original",
    sources: ["tests/event-target-bootstrap.js", "tests/pan-responder-fixture.jsx", "tests/pan-responder-probe.gd",
      "tests/pan-responder-native.test.mjs", "scripts/event-target-bundle.mjs", "sdk/toolchain/platform-plugin.mjs",
      "src/react-native-platform.jsx", "src/components.jsx", "src/private-interface.js", "native/application_runtime.cpp",
      "native/pointer_adapter.cpp"],
    extraUpstreamFiles: ["Libraries/Interaction/PanResponder.js", "Libraries/Interaction/TouchHistoryMath.js",
      "Libraries/Pressability/Pressability.js", "src/private/renderer/events/ReactNativeResponder.js",
      "src/private/renderer/events/dispatchNativeEvent.js"]});
  // Keep every actual report before asserting a lane.
  for (const flagMode of modes) {
    await rm(path.join(root, "build/pan-responder-report.json"), {force: true});
    const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/pan-responder-probe.gd", "--",
      "--flag=" + flagMode, ...(allowPreviousSDK ? ["--allow-previous-sdk"] : [])], {encoding: "utf8", timeout: 300000, maxBuffer: 16 * 1024 * 1024});
    const log = (result.stdout ?? "") + (result.stderr ?? ""), id = allowPreviousSDK ? "previous-sdk" : flagMode;
    await writeFile(path.join(root, "build/pan-responder-" + id + ".log"), log);
    const bytes = await optionalFile("build/pan-responder-report.json"), report = bytes == null ? null : JSON.parse(bytes);
    if (report != null) {
      report.provenance = {node: process.version, bundles, publicBundleSha256: before, nativeHostSha256};
      await writeFile(path.join(root, "build/pan-responder-" + id + "-report.json"), JSON.stringify(report, null, 2) + "\n"); reports[id] = report;
    }
    results.push({report, result, log, flagMode});
    assert.equal(await publicHash(), before, "Each isolated bundle preserves build/app.js");
  }
  for (const result of results) verify(result);
  if (allowPreviousSDK || modes.length !== eventTargetProbeModes.length) return;
  // Both responder implementations (legacy plugin and native dispatch) agree on
  // every callback and gesture coordinate; velocity is checked per lane above.
  const trace = row => [row.view, row.callback, row.x0, row.y0, row.moveX, row.moveY, row.dx, row.dy, row.numberActiveTouches];
  for (const id of Object.keys(cases)) {
    const reference = reports.disabled.stages[id].react.events.map(trace);
    for (const mode of eventTargetProbeModes)
      assert.deepEqual(reports[mode].stages[id].react.events.map(trace), reference, `${mode} ${id}`);
  }
  await writeFile(path.join(root, "build/pan-responder-comparison.json"), JSON.stringify({scenario: "native-pan-responder", modes,
    nativeHostSha256, reports, scope: {actualNativeInput: true, publicDefaultEnabled: false, hardwareCertified: false}}, null, 2) + "\n");
});
