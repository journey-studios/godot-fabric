import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleFrontierServicesProbe, frontierServicesGameSources} from "../scripts/frontier-services-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {guardSources} from "../scripts/sabotage-sources.mjs";
import {diffRegistrations, extractFrontierSchemas, verifyFrontierServicesReport, verifyRuleLane} from "./frontier-services-oracle.mjs";

// Frontier's services, run for real: the persistent GameServices node, a FabricApplication with a bundle that stands in
// for the HUD, and a FabricSurface, in the official headless Godot on the root project. The bundle plays the game's
// 12-turn roteiro through the typed services, and the probe compares every step with a second session of the game that
// the services never touch. This test runs the probe in two processes, requires the golden hash from the services, and
// hands the raw report to the independent oracle (tests/frontier-services-oracle.mjs), which validates every snapshot
// against the schema derived from the TypeScript types. The names and shapes against Godot are
// tests/frontier-services-parity.test.mjs, which reads the report this test leaves.
//
// The end of a turn is a job (docs/research/frontier-services.md): accepted, advanced one phase per frame in the node, finished once. The
// probe plays it through the roteiro, with the surface closed during one of them, and the oracle judges what JavaScript saw and
// what the registry held per frame. The plain test also runs the rule lane twice, once on the genuine rules and once with one
// constant of rules.gd mutated by scripts/sabotage-sources.mjs and restored byte for byte, with the same bundle; it is a lane of
// this test and not a sabotage, and it passes only if the only difference in what JavaScript received is what the rule predicts.
//
// There is no C++ in this slice, so there is no previous host to compare with.
//
// With --sabotage=<name> the same test runs against a node whose source scripts/frontier-services-sabotage.mjs broke on
// purpose, and passes only if the probe's checks, the oracle or the parity reject it, for the reason it was broken.
const root = fileURLToPath(new URL("..", import.meta.url));
const SABOTAGES = ["schema-drift", "late-register", "silent-intent", "frozen-epoch", "emit-on-refusal", "action-args-drift", "turn-ended-order",
  "double-finish", "job-dies-with-screen", "sync-end-turn", "stale-snapshot"];
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? "unnamed");
assert.ok(sabotage === null || SABOTAGES.includes(sabotage), `Unknown sabotage: ${sabotage}`);
const lane = sabotage === null ? "current" : `sabotage-${sabotage}`;
const EXECUTIONS = 2;
// The golden and trace hashes of the game (tests/civ-lite-game-native.test.mjs). The services must leave the same state
// the game's own replay leaves, and pass through the same states on the way; the test below proves these are the game's.
const GOLDEN_HASH = "0949b36d7438ce57c86f3952c9cfa47bb8ef6874edc762b5caf8d8ba4fbddbf1";
const TRACE_HASH = "a36c0f32707e9a8439bf276548d907d6bcc0821351a6014ab46ab617bf6b31ba";
const digest = value => createHash("sha256").update(value).digest("hex");
// A schema spelled out in the node itself would be a second source: the node registers from schema.gd and nowhere else.
const INLINE_SCHEMA = /"(object|array|integer)"/;
const code = line => line.replace(/#.*$/, "");
// The rule lane's mutation: one constant of the rules, the Settler's movement points, which the snapshot shows on the unit's card
// and which the game's own rule turns into found_city's `enabled` and `reason`.
const MUTATION = {name: "settler-moves", file: "consumers/civ-lite/game/rules.gd",
  find: "  \"settler\": {\"name\": \"Settler\", \"moves\": 2},\n", replace: "  \"settler\": {\"name\": \"Settler\", \"moves\": 0},\n"};
const settlerMoves = text => Number(/"settler": \{"name": "Settler", "moves": (\d+)\}/.exec(text)?.[1]);

function runProbe(binary, extra = []) {
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/frontier-services-probe.gd", "--",
    ...(sabotage === null ? [] : ["--sabotage"]), ...extra], {encoding: "utf8", timeout: 240000, maxBuffer: 32 * 1024 * 1024});
  return {result, log: (result.stdout ?? "") + (result.stderr ?? "")};
}

async function collect(execution, probe, bundle, laneName = lane) {
  await writeFile(path.join(root, `build/frontier-services-${laneName}-${execution}.log`), probe.log);
  let report = null;
  try {
    report = JSON.parse(await readFile(path.join(root, "build/frontier-services-report.json"), "utf8"));
  } catch (error) {
    assert.equal(error.code, "ENOENT", String(error));
  }
  if (report !== null) {
    report.provenance = {node: process.version, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/frontier-services-${laneName}-${execution}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  return report;
}

// One run of the probe in its rule lane, genuine or with the rules mutated: the report and what proves what ran.
async function ruleLane(label, binary, bundle, {guard = null} = {}) {
  await rm(path.join(root, "build/frontier-services-report.json"), {force: true});
  let probe;
  if (guard === null) {
    probe = runProbe(binary, ["--rule-lane"]);
  } else {
    // The same arguments, run as a guarded child: whatever ends it, the rules go back byte for byte.
    const result = await guard.run(binary, ["--path", root, "--headless", "--script", "res://tests/frontier-services-probe.gd", "--", "--rule-lane"],
      {timeout: 240000});
    probe = {result, log: (result.stdout ?? "") + (result.stderr ?? "")};
  }
  const report = await collect(1, probe, bundle, `rule-${label}`);
  assert.equal(probe.result.error ?? undefined, undefined, probe.log);
  assert.equal(probe.result.status, 0, probe.log);
  assert.doesNotMatch(probe.log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use|^ERROR:/m, `${label}: no engine, script or check error`);
  assert.ok(report !== null, probe.log);
  assert.equal(report.allPassed, true, `${label}: every check of the rule lane passed`);
  assert.deepEqual(report.checks.filter(row => !row.passed), [], label);
  assert.match(probe.log, /^FRONTIER_SERVICES_RULE_LANE_PASSED: \d+$/m, label);
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
      mentions(/turn_ended comes before the snapshot of the turn that begins/, failed);
      assert.match(oracle, /turn_ended comes after the snapshot of the last phase and before the snapshot of the turn that begins/);
    } else if (sabotage === "double-finish") {
      // The job finishes twice: JavaScript's own subscription receives turn_ended twice for the same job.
      mentions(/^step \d+ end_turn\[\] ends a turn exactly when an end_turn is accepted$/, failed);
      assert.match(oracle, /turn_ended is emitted exactly once per accepted end_turn, and by nothing else/);
    } else if (sabotage === "job-dies-with-screen") {
      // The driver stops with the screen: the job accepted before the surface closed never finishes.
      mentions(/^persistence: the surface was closed with the job accepted and not run/, failed);
      mentions(/^persistence: the job finished with no surface, exactly once, and the game's turn advanced$/, failed);
      assert.match(oracle, /snapshots of its job|publishes exactly the seven/);
    } else if (sabotage === "sync-end-turn") {
      // Every phase runs inside the callback: no frame is a phase, and the turn is not in progress when a call arrives.
      mentions(/the node ran one phase a frame/, failed);
      mentions(/every call made while the job ran was refused with turn_in_progress/, failed);
      assert.match(oracle, /the node ran one phase a frame|every one of the seven|turn_in_progress/);
    } else if (sabotage === "stale-snapshot") {
      // One phase's snapshot is not published: the turn skips a phase for the HUD.
      mentions(/^step \d+ end_turn\[\] publishes the seven snapshots of its job if accepted and none if refused$/, failed);
      assert.match(oracle, /an accepted end_turn publishes exactly the seven snapshots of its job/);
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

  // The rule lane: the genuine rules, then one constant mutated, with the same bundle. The bundle is rebuilt for the mutated run and
  // must be the same bytes, because it contains no .gd; the rules are restored byte for byte, and the receipt is made again.
  const rulesText = await readFile(path.join(root, MUTATION.file), "utf8");
  const genuineLane = await ruleLane("genuine", binary, bundle);
  const guard = guardSources(root, [MUTATION.file]);
  let mutatedLane;
  let mutatedBundle;
  let mutatedText;
  try {
    mutatedText = guard.sabotaged(MUTATION);
    guard.swap(MUTATION.file, mutatedText);
    mutatedBundle = await bundleFrontierServicesProbe();
    mutatedLane = await ruleLane("mutated", binary, mutatedBundle, {guard});
  } finally {
    guard.restore();
  }
  const restoredBundle = await bundleFrontierServicesProbe();
  assert.equal(restoredBundle.bundle.sha256, bundle.bundle.sha256, "The bundle rebuilt from the restored rules is the genuine one");
  assert.equal(restoredBundle.sources[MUTATION.file], bundle.sources[MUTATION.file], "The rules are restored byte for byte");
  assert.deepEqual(await readFile(path.join(root, MUTATION.file), "utf8"), rulesText);
  const ruleResult = verifyRuleLane(genuineLane, mutatedLane, {genuineMoves: settlerMoves(rulesText), mutatedMoves: settlerMoves(mutatedText), typesText,
    bundleSha256: {genuine: bundle.bundle.sha256, mutated: mutatedBundle.bundle.sha256},
    genuineRulesSha256: bundle.sources[MUTATION.file], mutatedRulesSha256: mutatedBundle.sources[MUTATION.file]});
  const provenance = report => ({bundleSha256: report.provenance.bundle.bundle.sha256, nativeHostSha256: report.provenance.nativeHostSha256, node: report.provenance.node,
    rulesSha256: report.provenance.bundle.sources[MUTATION.file], settlerMoves: report.ruleLane.settlerMoves});
  await writeFile(path.join(root, "build/frontier-services-mutation.json"), JSON.stringify({format: "godot-fabric.frontier-services-mutation/v1",
    mutation: {name: MUTATION.name, file: MUTATION.file, find: MUTATION.find, replace: MUTATION.replace},
    genuine: provenance(genuineLane), mutated: provenance(mutatedLane), observed: ruleResult,
    changed: {...ruleResult.differences, move_unit: ruleResult.moveUnit}}, null, 2) + "\n");

  await writeFile(path.join(root, "build/frontier-services-summary.json"), JSON.stringify({format: "godot-fabric.frontier-services-summary/v1",
    scenario: first.scenario, godot: first.godot, executions: EXECUTIONS, checks: first.checks.length, goldenHash: GOLDEN_HASH, traceHash: TRACE_HASH,
    finalHash: first.finalHash, jobs: verified.jobs, stress: verified.stress, ruleLane: ruleResult, steps: verified.steps, accepted: verified.accepted, refused: verified.refused, refusals: verified.refusals, turns: verified.turns, actionsSentBack: verified.actionsSentBack,
    epochs: first.epochs.map(entry => ({number: entry.number, epoch: entry.epoch, hash: entry.hash, turn: entry.turn})), initialHash: first.initialHash,
    violations: first.violations.map(entry => ({label: entry.label, name: entry.name, code: entry.result.error.code, callbacksDelta: entry.callbacksDelta})),
    registered: first.registered.map(entry => ({name: entry.name, kind: entry.kind})), largestSnapshot: first.limits, callbacks: first.callbacks,
    persistence: {before: first.persistence.before, remounted: first.persistence.remounted, playedUnmountedStep: first.persistence.playedUnmountedStep},
    bundleSha256: bundle.bundle.sha256, nativeHostSha256: first.provenance.nativeHostSha256}, null, 2) + "\n");
});
