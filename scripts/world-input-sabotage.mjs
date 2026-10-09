import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync, rmSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {guardSources} from "./sabotage-sources.mjs";

// The retained controls of the pointer spike. Each runs the same bundle, probe and independent oracle, and each must be
// rejected, or accepted as the control it is:
//
//  surface-stop   the probe gives every Surface MOUSE_FILTER_STOP again, as the host had before a1: the Control under the empty
//                 area takes the pointer and 0 of 100 clicks reach the world.
//  views-ignore   the probe gives every Control of the Views MOUSE_FILTER_IGNORE, so that no Control of a View takes the pointer
//                 either. Before a2 the Pressable, the bar and the panels let it through to the world; with the claim the hit test
//                 still finds them, and what breaks is what lives on the GUI: the Switch never toggles and the hover is lost.
//  unhandled-off  the probe keeps the Surfaces from receiving _unhandled_input, so nothing claims what React Native hit-tests:
//                 the gaps of a1 come back (a hit slop, a Text, the gaps of a ScrollView, the wheel over the HUD).
//  claim-all      fabric_surface.cpp claims every event in the unhandled stage, with or without a View at its point: the empty area
//                 no longer reaches the world. The host is rebuilt from the broken source.
//  before-gui     fabric_surface.cpp claims in _input, before the GUI: the Controls React Native mounts that live on the GUI (the
//                 fixture's Switch) never get a click or a tap. The host is rebuilt from the broken source.
//  a1 host        the host built from main with a1 and without the claim (build/world-input-a1-host/, kept outside Git) runs the
//                 bundle: the probe must fail exactly the checks it declares normative for a2, and the oracle rejects it.
//  previous host  the host before a1 (build/world-input-previous-host/, kept outside Git; rebuilt from the same main with the
//                 constructor's MOUSE_FILTER_IGNORE removed) fails the checks that need a1 and the ones of a2 its STOP Surface does
//                 not hide.
//
// Each variant's result file is deleted before it runs, and a variant whose file is not there afterwards counts as not
// rejected. The sources and the host come back byte for byte, whatever ends the run (scripts/sabotage-sources.mjs guards a
// signal too), and the genuine host is rebuilt and compared. A last run of the current host writes
// build/world-input-comparison.json with every report beside it. Run with:
//   node scripts/world-input-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const host = "addons/fabric_godot.dylib";
const cmake = path.join(root, ".deps/python/bin/cmake");
const a1Host = path.join(root, "build/world-input-a1-host/fabric_godot.dylib");
const previousHost = path.join(root, "build/world-input-previous-host/fabric_godot.dylib");
const test = "tests/world-input-native.test.mjs";
const surface = "native/fabric_surface.cpp";
const claimCall = "owner->get_runtime()->claims(surface_id, event))";
const inputCall = "owner->get_runtime()->input(surface_id, event))";
const sourceVariants = [
  {name: "claim-all", file: surface, find: claimCall, replace: "(owner->get_runtime()->claims(surface_id, event) || true))"},
  {name: "before-gui", file: surface, find: inputCall, replace: "(owner->get_runtime()->input(surface_id, event) || owner->get_runtime()->claims(surface_id, event)))"},
];
// Each sabotage must fail the checks that prove its reason, not only fail something.
const sceneVariants = [
  {name: "surface-stop", must: ["a/void: 100 of 100 left presses"]},
  // With a2 the Surface claims what React Native hit-tests even when the View's Control is IGNORE, so the world no longer hears a
  // Pressable, a bar or a panel; what the sabotage still breaks is the Controls of the GUI (the Switch toggles in _gui_input) and the hover.
  {name: "views-ignore", must: ["a/native Switch: 100 left inputs", "a/native Switch: 100 touch inputs", "a/hover: a control of the HUD"]},
  {name: "unhandled-off", must: ["a/L1 hit slop: 100 left", "a/L4 bar: 100 wheel ticks"]},
];
sourceVariants[0].must = ["a/void: 100 of 100 left presses"];
sourceVariants[1].must = ["a/native Switch: 100 left inputs", "a/native Switch: 100 touch inputs"];
const digest = content => createHash("sha256").update(content).digest("hex");
const remove = file => rmSync(path.join(root, file), {force: true});
const readReport = lane => {
  try {
    return JSON.parse(readFileSync(path.join(root, `build/world-input-${lane}-report.json`), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

async function build(sources, name) {
  const result = await sources.run(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"]);
  writeFileSync(path.join(root, `build/world-input-control-${name}-build.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `The ${name} host must build: build/world-input-control-${name}-build.log`);
}

// The genuine host first, from the genuine sources, before anything is guarded: the guard keeps its bytes.
const first = spawnSync(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"], {cwd: root, encoding: "utf8"});
writeFileSync(path.join(root, "build/world-input-control-genuine-build.log"), first.stdout + first.stderr);
assert.equal(first.status, 0, "The genuine host must build: build/world-input-control-genuine-build.log");
const guard = guardSources(root, [host, surface]);
const receipt = {format: "godot-fabric.world-input-sabotage/v2", hostSha256: {genuine: guard.genuine[host], a1: digest(readFileSync(a1Host)),
  previous: digest(readFileSync(previousHost))}, sourceSha256: {genuine: guard.genuine[surface]}, runs: []};
assert.ok(new Set(Object.values(receipt.hostSha256)).size === 3, "The genuine, a1 and preceding hosts are three different binaries");

// Runs the test with a flag; the lane's report is deleted first, and a lane with no report afterwards is not rejected.
// `rejected` is what the report must show for the run to count.
async function run(name, lane, args, rejected) {
  for (const file of [`build/world-input-${lane}-report.json`, `build/world-input-${lane}.log`, "build/world-input-report.json"]) {
    remove(file);
  }
  const result = await guard.run(process.execPath, [test, ...args]);
  writeFileSync(path.join(root, `build/world-input-control-${name}-run.log`), result.stdout + result.stderr);
  const report = readReport(lane);
  const failures = report?.checks.filter(row => !row.passed).map(row => row.name) ?? null;
  const entry = {name, lane, args, status: result.status, reportPresent: report != null, failures: failures?.length ?? null,
    rejected: report != null && result.status === 0 && rejected(report, failures)};
  receipt.runs.push(entry);
  return entry;
}

const sabotaged = ({name, must}) => (report, failures) => report.sabotage === name && failures.length > 0 &&
  must.every(part => failures.some(failure => failure.startsWith(part)));
try {
  for (const variant of sceneVariants) {
    await run(variant.name, `sabotage-${variant.name}`, [`--sabotage=${variant.name}`], sabotaged(variant));
  }
  guard.swap(host, readFileSync(a1Host));
  await run("a1-host", "a1", ["--allow-a1-negative"], (report, failures) => report.a1NegativeObserved && failures.length === report.expectedA1Failures.length);
  guard.swap(host, readFileSync(previousHost));
  await run("previous-host", "original", ["--allow-original-negative"],
    (report, failures) => report.originalNegativeObserved && failures.length === report.expectedOriginalFailures.length);
  guard.restore();
  for (const variant of sourceVariants) {
    try {
      const broken = guard.sabotaged(variant);
      Object.assign(receipt, {[`${variant.name}Source`]: {file: variant.file, find: variant.find, replace: variant.replace, sourceSha256: digest(broken)}});
      guard.swap(variant.file, broken);
      await build(guard, variant.name);
      const built = digest(readFileSync(path.join(root, host)));
      assert.notEqual(built, receipt.hostSha256.genuine, `The ${variant.name} host differs from the genuine one`);
      const entry = await run(variant.name, `sabotage-${variant.name}`, [`--sabotage=${variant.name}`], sabotaged(variant));
      entry.hostSha256 = built;
    } finally {
      guard.restore();
    }
  }
} finally {
  receipt.hostSha256.restoredBytes = guard.restore()[host];
}
// The genuine host rebuilt from the restored sources is the genuine host.
await build(guard, "restored");
receipt.hostSha256.restored = digest(readFileSync(path.join(root, host)));
receipt.sourceSha256.restored = guard.restore()[surface];
assert.equal(receipt.hostSha256.restoredBytes, receipt.hostSha256.genuine, "The genuine host is back byte for byte");
assert.equal(receipt.hostSha256.restored, receipt.hostSha256.genuine, "The host rebuilt from the restored sources is the genuine one");
assert.equal(receipt.sourceSha256.restored, receipt.sourceSha256.genuine, "The source is back byte for byte");
await run("current", "current", [], (report, failures) => failures.length === 0 && report.allCurrentAssertionsPassed === true);
writeFileSync(path.join(root, "build/world-input-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.runs) {
  assert.ok(entry.reportPresent, `The ${entry.name} run left no report, so it counts as not rejected: build/world-input-control-${entry.name}-run.log`);
  assert.ok(entry.rejected, `The ${entry.name} run must be rejected, or accepted as its control: build/world-input-control-${entry.name}-run.log`);
}
console.log(JSON.stringify(receipt, null, 2));
