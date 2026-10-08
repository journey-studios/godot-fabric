import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleFrontierServicesProbe, frontierServicesGameSources} from "../scripts/frontier-services-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {diffRegistrations, extractFrontierSchemas, verifyFrontierServicesReport} from "./frontier-services-oracle.mjs";

// Frontier's services, run for real: the persistent GameServices node, a FabricApplication with a bundle that stands in
// for the HUD, and a FabricSurface, in the official headless Godot on the root project. The bundle plays the game's
// 12-turn roteiro through the typed services, and the probe compares every step with a second session of the game that
// the services never touch. This test runs the probe in two processes, requires the golden hash from the services, and
// hands the raw report to the independent oracle (tests/frontier-services-oracle.mjs), which validates every snapshot
// against the schema derived from the TypeScript types. The names and shapes against Godot are
// tests/frontier-services-parity.test.mjs, which reads the report this test leaves.
//
// There is no C++ in this slice, so there is no previous host to compare with.
//
// With --sabotage=<name> the same test runs against a node whose source scripts/frontier-services-sabotage.mjs broke on
// purpose, and passes only if the probe's checks, the oracle or the parity reject it, for the reason it was broken.
const root = fileURLToPath(new URL("..", import.meta.url));
const SABOTAGES = ["schema-drift", "late-register", "silent-intent", "frozen-epoch", "emit-on-refusal", "action-args-drift", "turn-ended-order"];
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? "unnamed");
assert.ok(sabotage === null || SABOTAGES.includes(sabotage), `Unknown sabotage: ${sabotage}`);
const lane = sabotage === null ? "current" : `sabotage-${sabotage}`;
const EXECUTIONS = 2;
// The golden and trace hashes of the game (tests/civ-lite-game-native.test.mjs). The services must leave the same state
// the game's own replay leaves, and pass through the same states on the way; the test below proves these are the game's.
const GOLDEN_HASH = "275b7c6182605a784d8be3565d4df38a5bb130aaa6c0ea7640abe4c521427d29";
const TRACE_HASH = "fba99004fa12e253b9a6fe7f8bbee0cbd6e468a67308d25d0c40236f48c68cb8";
const digest = value => createHash("sha256").update(value).digest("hex");
// A schema spelled out in the node itself would be a second source: the node registers from schema.gd and nowhere else.
const INLINE_SCHEMA = /"(object|array|integer)"/;
const code = line => line.replace(/#.*$/, "");

function runProbe(binary) {
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/frontier-services-probe.gd", "--",
    ...(sabotage === null ? [] : ["--sabotage"])], {encoding: "utf8", timeout: 240000, maxBuffer: 32 * 1024 * 1024});
  return {result, log: (result.stdout ?? "") + (result.stderr ?? "")};
}

async function collect(execution, probe, bundle) {
  await writeFile(path.join(root, `build/frontier-services-${lane}-${execution}.log`), probe.log);
  let report = null;
  try {
    report = JSON.parse(await readFile(path.join(root, "build/frontier-services-report.json"), "utf8"));
  } catch (error) {
    assert.equal(error.code, "ENOENT", String(error));
  }
  if (report !== null) {
    report.provenance = {node: process.version, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/frontier-services-${lane}-${execution}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  return report;
}

function oracleRejection(report, types) {
  try {
    verifyFrontierServicesReport({...report, checks: report.checks.map(row => ({...row, passed: true}))}, {goldenHash: GOLDEN_HASH, traceHash: TRACE_HASH, typesText: types});
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

test("Frontier's services play the 12-turn roteiro to the golden hash, and an independent oracle agrees", async () => {
  const bundle = await bundleFrontierServicesProbe();
  const binary = await ensureGodotBinary();
  await mkdir(path.join(root, "build"), {recursive: true});
  const typesText = await readFile(path.join(root, "consumers/civ-lite/ui/frontier-types.ts"), "utf8");
  // The hashes this test pins are the game's own: the game's test is where they are fixed.
  const gameTest = await readFile(path.join(root, "tests/civ-lite-game-native.test.mjs"), "utf8");
  assert.equal(/const GOLDEN_HASH = "([0-9a-f]{64})"/.exec(gameTest)?.[1], GOLDEN_HASH, "The golden hash is the game's");
  assert.equal(/const TRACE_HASH = "([0-9a-f]{64})"/.exec(gameTest)?.[1], TRACE_HASH, "The trace hash is the game's");

  const runs = [];
  for (let execution = 1; execution <= (sabotage === null ? EXECUTIONS : 1); execution += 1) {
    await rm(path.join(root, "build/frontier-services-report.json"), {force: true});
    const probe = runProbe(binary);
    runs.push({probe, report: await collect(execution, probe, bundle)});
  }
  for (const {probe, report} of runs) {
    assert.equal(probe.result.error, undefined, probe.log);
    assert.equal(probe.result.signal, null, probe.log);
    assert.doesNotMatch(probe.log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
    assert.ok(report !== null, probe.log);
    assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length, "check names are unique");
    assert.equal(report.displayServer, "headless");
  }

  if (sabotage !== null) {
    // The node was broken on purpose. The probe's own checks, the oracle and the parity must reject it, and for the
    // reason it was broken.
    const {probe, report} = runs[0];
    assert.equal(probe.result.status, 0, probe.log);
    const failed = report.checks.filter(row => !row.passed).map(row => row.name);
    assert.ok(failed.length > 0, "The probe's checks reject the sabotaged node");
    assert.match(probe.log, new RegExp(`FRONTIER_SERVICES_SABOTAGE_REJECTED: ${failed.length}`));
    const oracle = oracleRejection(report, typesText);
    assert.ok(oracle !== null, "The oracle rejects the sabotaged report");
    const parity = diffRegistrations(extractFrontierSchemas(typesText).registrations, report.registered);
    await writeFile(path.join(root, `build/frontier-services-sabotage-${sabotage}.json`), JSON.stringify({format: "godot-fabric.frontier-services-sabotage-run/v1",
      sabotage, failedChecks: failed, oracle, parity, finalHash: report.finalHash ?? null, registrationErrors: report.registration.application.errors},
    null, 2) + "\n");
    const mentions = (pattern, list) => assert.ok(list.some(entry => pattern.test(entry)), `${pattern} in:\n${list.join("\n")}`);
    if (sabotage === "schema-drift") {
      // The DTO's schema lost a field. The getter's snapshot no longer matches it, so the registry refuses the first
      // connection; and the schema Godot registered is one field short of the types.
      mentions(/^frontier\.snapshot\.actions\[\]\.reason_text: declared in TypeScript, missing from Godot's schema$/, parity);
      mentions(/^registration: the bundle's first connections/, failed);
      assert.match(oracle, /^registration:/);
    } else if (sabotage === "late-register") {
      // Registered after the bundle asked: the first connection is told the service does not exist.
      assert.ok(report.registration.application.errors.some(entry => entry.code === "E_SERVICE_MISSING"), JSON.stringify(report.registration));
      mentions(/^registration: the bundle's first connections/, failed);
      assert.match(oracle, /^registration:/);
      assert.deepEqual(parity, [], "the schemas themselves are still the types'");
    } else if (sabotage === "silent-intent") {
      // found_city is accepted and publishes nothing: what JavaScript holds is the snapshot from before it.
      mentions(/^step \d+ found_city\[1\] the snapshot JavaScript holds is the node's, field for field$/, failed);
      mentions(/^step \d+ found_city\[1\] publishes the snapshot once if accepted and never if refused$/, failed);
      assert.match(oracle, /^step \d+ found_city\(1\): an accepted intent publishes exactly one snapshot/);
    } else if (sabotage === "frozen-epoch") {
      mentions(/^epoch: new_game 1 raises the epoch to 2$/, failed);
      assert.match(oracle, /^new_game 1: the epoch rises strictly/);
    } else if (sabotage === "emit-on-refusal") {
      mentions(/publishes the snapshot once if accepted and never if refused$/, failed);
      assert.match(oracle, /a refused intent publishes nothing/);
    } else if (sabotage === "action-args-drift") {
      // found_city is offered with no argument: sent back as it comes, it is not a call its method accepts.
      mentions(/^step 03 select_unit\[1\] every action of the snapshot, sent back as frontier\.<id>\(args\) on a copy of the reference game, is accepted exactly when enabled$/, failed);
      assert.match(oracle, /^step 3 select_unit\(1\): the action found_city carries as many arguments as its method \(1\)/);
      assert.deepEqual(parity, [], "the schemas themselves are still the types'");
    } else if (sabotage === "turn-ended-order") {
      mentions(/turn_ended comes before the snapshot of the turn that begins$/, failed);
      assert.match(oracle, /turn_ended comes before the snapshot of the turn that begins/);
    }
    return;
  }

  // The plain run.
  for (const [position, {probe, report}] of runs.entries()) {
    const label = `execution ${position + 1}`;
    assert.equal(probe.result.status, 0, probe.log);
    assert.doesNotMatch(probe.log, /^ERROR:/m, `${label}: no engine, script or check error`);
    assert.equal(report.allPassed, true, `${label}: every probe check passed`);
    assert.deepEqual(report.checks.filter(row => !row.passed), [], label);
    assert.match(probe.log, /^FRONTIER_SERVICES_PASSED: \d+$/m, label);
    assert.equal(probe.log.match(/^FRONTIER_SERVICES_HASH: ([0-9a-f]{64})$/m)?.[1], report.finalHash, `${label}: the printed hash is the report's`);
    assert.equal(report.finalHash, GOLDEN_HASH, `${label}: the services leave the game's golden hash`);
  }
  const [first, second] = runs.map(run => run.report);
  const verified = verifyFrontierServicesReport(first, {goldenHash: GOLDEN_HASH, traceHash: TRACE_HASH, typesText});
  const verifiedAgain = verifyFrontierServicesReport(second, {goldenHash: GOLDEN_HASH, traceHash: TRACE_HASH, typesText});
  assert.deepEqual(verifiedAgain, verified, "The oracle reads the same of two executions");
  // What a step did is not a matter of timing: the two executions agree on every state, snapshot and event.
  const observed = report => report.steps.map(step => [step.hash, step.jsSnapshot, step.revision, step.snapshotSeq, step.turnEndedSeq, step.turnEnded, step.result.value]);
  assert.deepEqual(observed(second), observed(first), "Two executions observe the same on every step");
  assert.deepEqual(second.epochs.map(entry => [entry.epoch, entry.hash, entry.jsSnapshot]), first.epochs.map(entry => [entry.epoch, entry.hash, entry.jsSnapshot]));

  // The node registers from schema.gd and nowhere else, and everything the run executed is pinned.
  const node = await readFile(path.join(root, "consumers/civ-lite/services/game_services.gd"), "utf8");
  assert.deepEqual(node.split("\n").flatMap((line, position) => (INLINE_SCHEMA.test(code(line)) ? [position + 1] : [])), [],
    "game_services.gd spells out no schema: they all come from schema.gd");
  for (const file of ["tests/frontier-services-fixture.jsx", "tests/frontier-services-probe.gd", "tests/frontier-services-native.test.mjs",
    "tests/frontier-services-oracle.mjs", "tests/frontier-services-parity.test.mjs", "scripts/frontier-services-bundle.mjs", "consumers/civ-lite/ui/frontier-types.ts",
    "src/godot-fabric.js", ...frontierServicesGameSources]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, `Pin every executed producer: ${file}`);
  }
  assert.ok(bundle.bundle.inputs.includes("consumers/civ-lite/ui/frontier-types.ts"), "The bundle contains the hand-written types' module");
  assert.match(bundle.originalReactNativeSources["Libraries/TurboModule/TurboModuleRegistry.js"], /^[0-9a-f]{64}$/);

  await writeFile(path.join(root, "build/frontier-services-summary.json"), JSON.stringify({format: "godot-fabric.frontier-services-summary/v1",
    scenario: first.scenario, godot: first.godot, executions: EXECUTIONS, checks: first.checks.length, goldenHash: GOLDEN_HASH, traceHash: TRACE_HASH,
    finalHash: first.finalHash, steps: verified.steps, accepted: verified.accepted, refused: verified.refused, refusals: verified.refusals, turns: verified.turns, actionsSentBack: verified.actionsSentBack,
    epochs: first.epochs.map(entry => ({number: entry.number, epoch: entry.epoch, hash: entry.hash, turn: entry.turn})), initialHash: first.initialHash,
    violations: first.violations.map(entry => ({label: entry.label, name: entry.name, code: entry.result.error.code, callbacksDelta: entry.callbacksDelta})),
    registered: first.registered.map(entry => ({name: entry.name, kind: entry.kind})), largestSnapshot: first.limits, callbacks: first.callbacks,
    persistence: {before: first.persistence.before, remounted: first.persistence.remounted, playedUnmountedStep: first.persistence.playedUnmountedStep},
    bundleSha256: bundle.bundle.sha256, nativeHostSha256: first.provenance.nativeHostSha256}, null, 2) + "\n");
});
