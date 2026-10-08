import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyFrontierReport} from "./civ-lite-game-oracle.mjs";

// Frontier's rules and scenario, in GDScript, run by the official headless Godot on the root project: there is no host
// and no extension to build. The probe plays a 12-turn roteiro; this test runs it in three processes and requires the
// same golden hash from each, the seven contexts, every refusal with its reason and the snapshot's documented shape,
// and hands the raw observations to the independent oracle (tests/civ-lite-game-oracle.mjs).
//
// With --sabotage=<name> the same test runs against a game whose source scripts/civ-lite-game-sabotage.mjs broke on
// purpose, and passes only if the test and the oracle both reject it.
const root = fileURLToPath(new URL("..", import.meta.url));
const EXECUTIONS = 3;
// The state after the 12th end_turn of replay.gd. It changes when a rule, the map or the roteiro changes, and then
// the new value is reviewed, not accepted.
const GOLDEN_HASH = "275b7c6182605a784d8be3565d4df38a5bb130aaa6c0ea7640abe4c521427d29";
// SHA-256 of the state hashes after every step of the roteiro, one per line. The golden hash pins where the replay ends;
// this one pins how it got there, selection included, which every end_turn resets and the final state does not show.
const TRACE_HASH = "fba99004fa12e253b9a6fe7f8bbee0cbd6e468a67308d25d0c40236f48c68cb8";
const CONTEXTS = ["none", "tile", "settler", "warrior", "stack", "city", "dialog"];
// The refusal codes the roteiro plays, and those the probe builds a state for because the scenario cannot reach them.
const ROTEIRO_REFUSALS = ["out_of_bounds", "not_adjacent", "impassable_terrain", "not_your_unit", "unknown_unit", "no_moves_left", "not_enough_moves",
  "cannot_fortify", "already_fortified", "not_a_settler", "no_city", "unknown_item", "tech_required", "already_built", "already_queued", "bad_slot", "unknown_tech",
  "tech_known", "research_out_of_order", "already_researching", "event_pending", "unknown_choice", "no_event", "nothing_selected"];
const BUILT_REFUSALS = ["city_exists", "too_close_to_edge", "tile_occupied", "queue_full"];
// The turns the probe builds states for, because the roteiro never puts the player on the faction's route.
const WAIT_CASES = ["city-on-route", "city-on-route-next-turn", "unit-on-route"];
const GAME_DIRECTORY = "consumers/civ-lite/game";
// Nothing in the game may draw from the engine's generators: the game's own PRNG is the only source of randomness.
const ENGINE_RANDOMNESS = /\b(randi|randf|randi_range|randf_range|randomize|rand_from_seed|RandomNumberGenerator|pick_random|shuffle)\b/;

const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? "unnamed");
const lane = sabotage === null ? "run" : `sabotage-${sabotage}-run`;
const digest = value => createHash("sha256").update(value).digest("hex");

// The shape of the snapshot, field by field: what the services slice mirrors in TypeScript. "int" and "string" are the
// only leaf types; `[shape]` is an array of that shape; "args" is a record of ints and strings.
const ACTION = {id: "string", label: "string", args: "args", enabled: "int", reason: "string", reason_text: "string"};
const UNIT_CARD = {id: "int", owner: "int", kind: "string", name: "string", moves: "int", max_moves: "int", fortified: "int"};
const CHECKED = {enabled: "int", reason: "string", reason_text: "string"};
const SNAPSHOT_SHAPE = {
  version: "int", epoch: "int", turn: "int", phase: "string", context: "string",
  selection: {x: "int", y: "int", unit: "int"},
  resources: {food: {stock: "int", rate: "int"}, production: {stock: "int", rate: "int"}, science: {stock: "int", rate: "int"}},
  actions: [ACTION],
  tile: {present: "int", x: "int", y: "int", terrain: "int", terrain_name: "string", food: "int", production: "int", science: "int", move_cost: "int",
    city: "int", units: [UNIT_CARD]},
  city: {present: "int", name: "string", x: "int", y: "int", size: "int", max_size: "int", food_needed: "int", food_rate: "int",
    production_rate: "int", science_rate: "int",
    queue: [{slot: "int", item: "string", label: "string", cost: "int", stock: "int"}], queue_max: "int",
    items: [{id: "string", label: "string", kind: "string", cost: "int", tech: "string", ...CHECKED}],
    buildings: ["string"], garrison: [{id: "int", kind: "string"}]},
  research: {current: "string", known: "int", needed: "int", rate: "int",
    techs: [{id: "string", label: "string", cost: "int", state: "string", ...CHECKED}]},
  dialog: {open: "int", id: "string", title: "string", text: "string", choices: [{id: "string", label: "string", detail: "string"}]},
};

function conforms(value, shape, where) {
  if (shape === "int") {
    assert.ok(Number.isInteger(value), `${where} must be an integer`);
  } else if (shape === "string") {
    assert.equal(typeof value, "string", `${where} must be a string`);
  } else if (shape === "args") {
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${where} must be a record`);
    assert.ok(Object.values(value).every(entry => Number.isInteger(entry) || typeof entry === "string"), `${where} holds integers and strings only`);
  } else if (Array.isArray(shape)) {
    assert.ok(Array.isArray(value), `${where} must be an array`);
    value.forEach((item, position) => conforms(item, shape[0], `${where}[${position}]`));
  } else {
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${where} must be an object`);
    assert.deepEqual(Object.keys(value).sort(), Object.keys(shape).sort(), `${where} has exactly the documented fields`);
    for (const key of Object.keys(shape)) {
      conforms(value[key], shape[key], `${where}.${key}`);
    }
  }
}

async function runProbe(binary, execution) {
  const out = `build/civ-lite-game-${lane}-${execution}-report.json`;
  await rm(path.join(root, out), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/civ-lite-game-probe.gd", "--", `--out=${out}`],
    {encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/civ-lite-game-${lane}-${execution}.log`), log);
  let text = null;
  try {
    text = await readFile(path.join(root, out), "utf8");
  } catch (error) {
    assert.equal(error.code, "ENOENT", String(error));
  }
  return {result, log, text, report: text === null ? null : JSON.parse(text)};
}

// The oracle's first complaint about a report, or null when it accepts it.
function oracleRejection(report) {
  try {
    verifyFrontierReport(report);
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

async function sources() {
  const files = (await readdir(path.join(root, GAME_DIRECTORY))).filter(name => name.endsWith(".gd")).sort().map(name => `${GAME_DIRECTORY}/${name}`);
  const pinned = {};
  for (const file of [...files, "tests/civ-lite-game-probe.gd", "tests/civ-lite-game-oracle.mjs", "tests/civ-lite-game-native.test.mjs"]) {
    pinned[file] = digest(await readFile(path.join(root, file)));
  }
  return {files, pinned};
}

// A line of GDScript without its comment, for the scan that keeps the engine's generators out of the game.
const code = line => line.replace(/#.*$/, "");

test("Frontier's rules replay 12 turns to the same golden hash in three processes, and an independent oracle agrees", async () => {
  const binary = await ensureGodotBinary();
  await mkdir(path.join(root, "build"), {recursive: true});
  const {files, pinned} = await sources();
  const scan = [];
  for (const file of files) {
    (await readFile(path.join(root, file), "utf8")).split("\n").forEach((line, position) => {
      if (ENGINE_RANDOMNESS.test(code(line))) {
        scan.push(`${file}:${position + 1}`);
      }
    });
  }

  const runs = [];
  for (let execution = 1; execution <= EXECUTIONS; execution += 1) {
    runs.push(await runProbe(binary, execution));
  }
  const reports = runs.map(run => run.report);
  const hashes = reports.map(report => report?.finalHash ?? null);

  if (sabotage !== null) {
    // The game was broken on purpose. Both the test's own checks and the oracle must reject it, and for the reason it
    // was broken.
    for (const run of runs) {
      assert.equal(run.result.error, undefined, run.log);
      assert.equal(run.result.signal, null, run.log);
      assert.ok(run.report !== null, "A sabotaged game still reports what it did: " + run.log);
    }
    const failed = runs.flatMap(run => run.report.checks.filter(row => !row.passed).map(row => row.name));
    const oracle = runs.map(run => oracleRejection(run.report));
    const rejections = {
      probeChecksFailed: failed.length > 0,
      goldenHashDiffers: hashes.some(hash => hash !== GOLDEN_HASH),
      executionsDiffer: new Set(hashes).size > 1,
      oracleRejects: oracle.every(message => message !== null),
      sourceScanFinds: scan.length > 0,
    };
    await writeFile(path.join(root, `build/civ-lite-game-sabotage-${sabotage}.json`), JSON.stringify({format: "godot-fabric.civ-lite-game-sabotage-run/v1",
      sabotage, hashes, goldenHash: GOLDEN_HASH, rejections, failedChecks: [...new Set(failed)], oracle, scan, sourceSha256: pinned}, null, 2) + "\n");
    assert.ok(rejections.oracleRejects, "The oracle rejects the sabotaged game in every execution");
    if (sabotage.startsWith("ai-")) {
      // The roteiro never puts the player on the faction's route, so its states and the golden hash are the genuine
      // ones: only the states built for the faction's wait can tell, to the probe's checks and to the oracle.
      assert.ok(!rejections.goldenHashDiffers && !rejections.executionsDiffer, "The roteiro does not reach the faction's wait");
      assert.ok(failed.some(name => /^ai wait: /.test(name)), failed.join("\n"));
      assert.ok(oracle.every(message => /^case (city-on-route|unit-on-route)/.test(message)), oracle.join("\n"));
      if (sabotage === "ai-wrong-event") {
        // The faction waits as it should, so the state is the genuine one: only the events it emits tell, and only the
        // oracle's judgment of the log entries a turn appended sees them.
        assert.ok(oracle.every(message => /the faction's phases emit the events the rules give them/.test(message)), oracle.join("\n"));
      }
      if (sabotage === "ai-city") {
        // The defect the review of PR #70 found: the city is not a block, so the faction walks into it.
        assert.ok(oracle.every(message => /^case city-on-route/.test(message)), oracle.join("\n"));
        assert.ok(failed.includes("ai wait: a city on the faction's route keeps the faction where it was"), failed.join("\n"));
      }
      return;
    }
    assert.ok(rejections.goldenHashDiffers, "The golden hash rejects the sabotaged game");
    if (sabotage === "prng") {
      // A generator that is not the game's own gives a different map every process.
      assert.ok(rejections.probeChecksFailed && failed.includes("prng: PCG32 matches its published reference outputs"), failed.join("\n"));
      assert.ok(rejections.executionsDiffer, "Three executions of an engine-random game do not agree");
      assert.ok(rejections.sourceScanFinds, "The scan finds the engine's generator in the game");
    } else if (sabotage === "canon") {
      assert.ok(failed.includes("canon: keys are sorted and nothing else is spaced"), failed.join("\n"));
      assert.ok(oracle.every(message => /canonical serialization/.test(message)), oracle.join("\n"));
    } else if (sabotage === "rule") {
      // The Settler keeps a movement point the roteiro says it has spent.
      assert.ok(failed.some(name => /^step \d+ found_city\[1\] answers no_moves_left$/.test(name)), failed.join("\n"));
      assert.ok(oracle.every(message => /^step \d+ move_unit\(1, 7, 8\)/.test(message)), oracle.join("\n"));
    } else if (sabotage === "economy") {
      // A city that yields one production too many: the oracle that recomputes the economy finds the first end of turn
      // in which the city produced.
      assert.ok(oracle.every(message => /end_turn/.test(message)), oracle.join("\n"));
    } else {
      assert.fail(`Unknown sabotage ${sabotage}`);
    }
    return;
  }

  // The plain run: the game, three times.
  for (const [position, run] of runs.entries()) {
    const label = `execution ${position + 1}`;
    assert.equal(run.result.error, undefined, run.log);
    assert.equal(run.result.signal, null, run.log);
    assert.equal(run.result.status, 0, run.log);
    assert.doesNotMatch(run.log, /SCRIPT ERROR|ERROR:|Program crashed|ObjectDB instances leaked|Resources still in use/, `${label}: no engine, script or check error`);
    assert.ok(run.report !== null, run.log);
    assert.equal(run.report.allPassed, true, `${label}: every probe check passed`);
    assert.equal(new Set(run.report.checks.map(row => row.name)).size, run.report.checks.length, `${label}: check names are unique`);
    assert.deepEqual(run.report.checks.filter(row => !row.passed), [], label);
    assert.match(run.log, /^CIV_LITE_GAME_PASSED: \d+$/m, label);
    assert.equal(run.log.match(/^CIV_LITE_GAME_HASH: ([0-9a-f]{64})$/m)?.[1], run.report.finalHash, `${label}: the printed hash is the report's`);
    assert.equal(run.report.finalHash, GOLDEN_HASH, `${label}: the golden hash`);
  }
  assert.deepEqual(hashes, Array(EXECUTIONS).fill(GOLDEN_HASH), "The golden hash is identical in three of three executions");
  assert.ok(runs.every(run => run.text === runs[0].text), "The three reports, serialization after every step included, are byte-identical");
  assert.deepEqual(scan, [], "Nothing in the game draws from the engine's generators");

  const report = reports[0];
  const verified = verifyFrontierReport(report);
  assert.equal(verified.turns, 12);
  assert.equal(verified.finalHash, GOLDEN_HASH);
  const traceHash = digest(report.steps.map(step => step.hash).join("\n"));
  assert.equal(traceHash, TRACE_HASH, "The state after every step of the roteiro is the one the trace hash pins");

  // The seven contexts, each at a step of the roteiro labelled for it, and the DTO documented for the services slice.
  const coverage = CONTEXTS.map(context => {
    const step = report.steps.find(entry => entry.label === `cover-${context}`);
    assert.ok(step !== undefined, `A step of the roteiro covers ${context}`);
    assert.equal(step.context, context);
    return {context, step: step.index, intent: step.intent, args: step.args, code: step.code};
  });
  assert.deepEqual(Object.keys(report.snapshots).sort(), [...CONTEXTS.map(context => `cover-${context}`), "final"].sort());
  for (const [name, snapshot] of Object.entries(report.snapshots)) {
    conforms(snapshot, SNAPSHOT_SHAPE, `snapshot ${name}`);
    assert.equal(snapshot.epoch, report.epoch);
    assert.equal(snapshot.version, 1);
  }
  const actions = context => report.snapshots[`cover-${context}`].actions.map(action => [action.id, action.enabled, action.reason]);
  assert.deepEqual(actions("none"), [["end_turn", 1, ""]]);
  assert.deepEqual(actions("tile"), [["clear_selection", 1, ""], ["end_turn", 1, ""]]);
  assert.deepEqual(actions("settler"), [["found_city", 1, ""], ["fortify", 0, "cannot_fortify"], ["clear_selection", 1, ""], ["end_turn", 1, ""]]);
  assert.deepEqual(actions("warrior"), [["fortify", 1, ""], ["clear_selection", 1, ""], ["end_turn", 1, ""]]);
  assert.deepEqual(actions("stack"), [["select_unit", 1, ""], ["select_unit", 1, ""], ["clear_selection", 1, ""], ["end_turn", 1, ""]]);
  assert.deepEqual(actions("city"), [["clear_selection", 1, ""], ["end_turn", 1, ""]]);
  assert.deepEqual(actions("dialog"), [["end_turn", 0, "event_pending"]]);
  assert.equal(report.snapshots["cover-dialog"].dialog.open, 1);
  assert.deepEqual(report.snapshots["cover-dialog"].dialog.choices.map(choice => choice.id), ["welcome", "turn_away"]);
  assert.equal(report.snapshots["cover-dialog"].city.items.every(item => item.enabled === 0 && item.reason === "event_pending"), true, "A pending event disables the city screen too");
  assert.equal(report.snapshots["cover-city"].city.present, 1);
  assert.equal(report.snapshots["cover-stack"].tile.units.length, 2);

  // Every refusal the roteiro plays was refused with its reason; the unreachable ones were refused on a state built for them.
  assert.deepEqual(Object.keys(verified.refusals).sort(), [...ROTEIRO_REFUSALS].sort(), "The roteiro refuses with every code it documents");
  assert.deepEqual(report.unreachableRefusals.map(entry => entry.code).sort(), [...BUILT_REFUSALS].sort());

  // The faction's wait: a city and a unit of the player on its route, on states built for it, judged by the oracle.
  assert.deepEqual(verified.waitCases, WAIT_CASES, "The faction waits in every case built for it");
  for (const entry of report.waitCases) {
    const before = JSON.parse(entry.before);
    const after = JSON.parse(entry.after);
    assert.deepEqual([after.ai.step, after.units.find(unit => unit.id === after.ai.unit).x], [0, 17], `${entry.name}: the faction stays on the first tile of its route`);
    assert.deepEqual(before.units.length + (entry.name === "city-on-route" ? 1 : 0), after.units.length, `${entry.name}: the units are the ones that were there, and the one the city finished`);
  }

  await writeFile(path.join(root, "build/civ-lite-game-report.json"), JSON.stringify({format: "godot-fabric.civ-lite-game/v1", godot: report.godot,
    goldenHash: GOLDEN_HASH, traceHash, executions: runs.map((run, position) => ({execution: position + 1, status: run.result.status, finalHash: run.report.finalHash,
      checks: run.report.checks.length, reportSha256: digest(run.text)})),
    byteIdentical: true, steps: report.steps.length, turns: verified.turns, rngDraws: verified.draws, coverage, refusals: verified.refusals,
    unreachableRefusals: report.unreachableRefusals, waitCases: verified.waitCases, oracle: {accepted: true, contexts: verified.contexts}, sourceSha256: pinned}, null, 2) + "\n");
});
