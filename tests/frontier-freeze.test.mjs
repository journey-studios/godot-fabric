import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {NATIVE_NODES, WARMUP_ROUNDS} from "./frontier-baseline-cases.mjs";
import {nearestRank, quartiles} from "./performance-oracle.mjs";
import {budgetOf, buildFreeze, checkFreeze, derivationRow, fromReceipts, inputsProblems, serialize} from "../scripts/frontier-freeze.mjs";
import {CORROBORATION_ROLES, RECEIPTS, baselineRunsOfSummary, extractTurnRun} from "../scripts/frontier-freeze-receipts.mjs";

// The single freeze of the performance budget (V05-06, criterion `congelado`) and of the five thresholds of the final comparison's protocol (V05-10, criterion `protocolo`):
// scripts/frontier-freeze.mjs, its inputs and its freeze in docs/evidence/frontier-freeze/, and the numbers written in the research notes. This test runs no game and reads
// no receipt that is not in the repository: the receipts of the turn and of the corroboration stay outside of it, with their SHA-256, and this test works on the extract that
// the repository holds (inputs.json), which the rule reads. It imports no oracle of the turn.
const root = fileURLToPath(new URL("../", import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const json = file => JSON.parse(read(file));
const inputs = json("docs/evidence/frontier-freeze/inputs.json");
const freeze = json("docs/evidence/frontier-freeze/freeze.json");
const protocol = json("docs/research/frontier-comparison-protocol.json");
const baselineNote = read("docs/research/frontier-baseline.md");
const protocolNote = read("docs/research/frontier-comparison-protocol.md");
const freezeNote = read("docs/research/frontier-freeze.md");
const sha256 = data => createHash("sha256").update(data).digest("hex");
const ms = usec => (usec / 1000).toFixed(3);
const check = ({changedInputs = inputs, changedFreeze = freeze, changedProtocol = protocol} = {}) => checkFreeze({inputs: changedInputs, freeze: changedFreeze, protocol: changedProtocol});
const withInputs = change => {
  const clone = structuredClone(inputs);
  change(clone);
  return clone;
};
const derivation = id => freeze.derivations.find(each => each.id === id);

// ---- the rule ----
// The rows of the derivation table of docs/research/frontier-baseline.md for the execution of 1bc3a3c, as the five per-run values in microseconds, with the bound the note gives.
const TABLE_OF_1BC3A3C = [
  {row: "Swap frame p50, 0 nodes created", values: [3565, 3653, 3662, 3667, 3731], medianPlus3Iqr: 3704, limit: 4000},
  {row: "Swap frame p95, 0 nodes created", values: [13632, 13690, 13714, 13721, 13794], medianPlus3Iqr: 13807, limit: 14000},
  {row: "Swap frame p99, 0 nodes created", values: [13897, 14251, 14284, 14983, 15141], medianPlus3Iqr: 16480, limit: 16500},
  {row: "Swap frame p95, 75 nodes created", values: [13426, 13533, 14080, 15409, 15420], medianPlus3Iqr: 19708, limit: 20000},
  {row: "Swap frame p99, 50 nodes created", values: [12201, 13282, 15565, 17241, 20135], medianPlus3Iqr: 27442, limit: 27500},
  {row: "Swap frame p99, 100 nodes created", values: [16615, 20404, 24607, 25918, 60024], medianPlus3Iqr: 41149, limit: 41500},
  {row: "Idle frame p99", values: [14854, 15169, 15213, 15509, 15604], medianPlus3Iqr: 16233, limit: 16500},
  {row: "Swap frame p95, all swaps (reference)", values: [14217, 14497, 14835, 14875, 15928], medianPlus3Iqr: 15969, limit: 16000}
];

test("budgetOf reproduces the rows of the derivation table of the baseline note, from the five values of each run", () => {
  for (const {row, values, medianPlus3Iqr, limit} of TABLE_OF_1BC3A3C) {
    const budget = budgetOf(values);
    assert.equal(budget.medianPlus3Iqr, medianPlus3Iqr, `${row}: the median plus three IQR`);
    assert.equal(budget.limit, limit, `${row}: up to 0.5 ms`);
  }
  // The row the specification names: 13.632 / 13.690 / 13.714 / 13.721 / 13.794 gives Q1 13.690, median 13.714, Q3 13.721, IQR 0.031 and 14.0, whatever the order they come in.
  assert.deepEqual(budgetOf([13794, 13632, 13721, 13714, 13690]), {sorted: [13632, 13690, 13714, 13721, 13794], q1: 13690, median: 13714, q3: 13721, iqr: 31, medianPlus3Iqr: 13807, limit: 14000});
  // The p99 of 90 swaps with 50 nodes created gives 27.5, which is the bound that one swap a run fixes, and is why those rows are out.
  assert.equal(budgetOf([12201, 13282, 15565, 17241, 20135]).limit / 1000, 27.5);
  // The counts of frames of 100 ms or more: all zero gives zero, and a count is not rounded.
  assert.equal(budgetOf([0, 0, 0, 0, 0], {roundTo: null}).limit, 0);
  assert.deepEqual(budgetOf([3, 0, 2, 1, 0], {roundTo: null}), {sorted: [0, 0, 1, 2, 3], q1: 0, median: 1, q3: 2, iqr: 2, medianPlus3Iqr: 7, limit: 7});
});

test("the rounding is up to 0.5 ms: an exact multiple stays, one microsecond more goes to the next, and the values are not changed", () => {
  assert.equal(budgetOf([1000, 1000, 1000, 1000, 1000]).limit, 1000);
  assert.equal(budgetOf([1001, 1001, 1001, 1001, 1001]).limit, 1500);
  assert.equal(budgetOf([1500, 1500, 1500, 1500, 1500]).limit, 1500);
  assert.equal(budgetOf([0, 0, 0, 0, 0]).limit, 0);
  const values = [5, 3, 4, 1, 2];
  budgetOf(values);
  assert.deepEqual(values, [5, 3, 4, 1, 2]);
});

test("the quartiles of five are the second, third and fourth values by nearest rank, those of the performance oracle that the script and this test import", () => {
  assert.deepEqual(quartiles([5, 1, 4, 2, 3]), {median: 3, q1: 2, q3: 4, iqr: 2, min: 1, max: 5});
  const {q1, median, q3, iqr} = budgetOf([5, 1, 4, 2, 3]);
  assert.deepEqual([q1, median, q3, iqr], [2, 3, 4, 2]);
  // Nearest rank over a run: the p95 of 720 values is the 684th, and of 240 the 228th.
  const ascending = Array.from({length: 720}, (_, index) => index + 1);
  assert.equal(nearestRank(ascending, 95), 684);
  assert.equal(nearestRank(ascending.slice(0, 240), 95), 228);
});

// ---- the committed freeze ----
test("the freeze is the one the inputs give by the rule, and the protocol carries its values: the check passes, in the module and as the command", () => {
  assert.deepEqual(check(), []);
  const command = spawnSync(process.execPath, [path.join(root, "scripts/frontier-freeze.mjs"), "--check"], {encoding: "utf8"});
  assert.equal(command.status, 0, command.stderr);
  assert.match(command.stdout, /^FRONTIER_FREEZE_CHECK_PASSED: 5 thresholds, \d+ budget rows, \d+ derivations, frozen on \d{4}-\d{2}-\d{2}$/m);
  assert.deepEqual(buildFreeze(inputs, {frozenAt: freeze.frozenAt}), freeze, "rebuilt from the inputs, byte for byte as data");
});

test("the committed files are what the writer writes, so that nobody edited them by hand", () => {
  for (const file of ["inputs.json", "freeze.json"]) {
    const text = read(`docs/evidence/frontier-freeze/${file}`);
    assert.equal(text, `${serialize(JSON.parse(text))}\n`, file);
  }
  const sample = {a: [1, 2, 3], b: {c: "x", d: null}, e: [[1, 2], [3]], f: [], g: {}, h: [{i: 1}]};
  assert.deepEqual(JSON.parse(serialize(sample)), sample);
  assert.match(serialize(sample), /"a": \[1, 2, 3\]/);
});

test("the inputs are the executions registered: their SHA-256, commits, bundles and hosts, and the raw baseline receipt is the one committed byte for byte", () => {
  assert.deepEqual(inputsProblems(inputs), []);
  assert.deepEqual(Object.keys(inputs.receipts), ["baseline", "turn", ...CORROBORATION_ROLES]);
  const table = Object.fromEntries(Object.entries(inputs.receipts).map(([role, receipt]) => [role, [receipt.sha256, receipt.commit.slice(0, 7), receipt.bundleSha256.slice(0, 8), receipt.hostSha256.slice(0, 8)]]));
  assert.deepEqual(table, {
    baseline: ["36b32e0d6d1418af122260aa453bdd77bd9619811181731a88855a1e526e13b7", "1bc3a3c", "7895d359", "212d0f6e"],
    turn: ["8dd6ec9cf4776a8026c3056c337da9a9bb7c811b6b529f05c1ecee3ca111e90f", "1bc3a3c", "fce50a0a", "212d0f6e"],
    "baseline-main": ["9959a269a61b615d5ccfff3864f262732f2fd28bcbf240f01987c29e3027e9f4", "916387e", "7895d359", "497e4f95"],
    "turn-main": ["4708f22b7dc62544a1e22b1c7e1e4f96cc7895216ae7b68c9f4ff62a4da370ca", "916387e", "54b8af7d", "497e4f95"],
    "turn-main-pre-100-hud": ["244f6ffd37eef631df4587abc8eb5542af3d89524a130e7a7771cd7ef0c13545", "916387e", "fce50a0a", "497e4f95"]
  });
  assert.equal(inputs.receipts["turn-main-pre-100-hud"].consumerCommit, "fb51c07162bb52eb418f3a3c5c4a19798b148eab", "the A/B restored only the consumer of the commit before #100");
  for (const receipt of Object.values(inputs.receipts)) {
    assert.deepEqual([receipt.presented, receipt.runsAccepted, receipt.attempts, receipt.rejectedAttempts, receipt.refreshRate, receipt.vsyncMode], [true, 5, 5, 0, 120, "enabled"]);
  }
  // The raw receipt of the baseline is in the repository: its hash is the registered one, the extract is what its summary says, and each number of it is recomputed here from the
  // raw intervals (nearest rank, in microseconds), so that the extract does not rest on the summary alone.
  const raw = fs.readFileSync(path.join(root, inputs.receipts.baseline.committedAs));
  assert.equal(sha256(raw), inputs.receipts.baseline.sha256);
  assert.equal(raw.length, inputs.receipts.baseline.bytes);
  const receipt = JSON.parse(raw.toString("utf8"));
  assert.deepEqual(baselineRunsOfSummary(receipt), inputs.baseline.runs, "the extract of the baseline is what the receipt's summary says, in microseconds");
  const stats = frames => ({samples: frames.length, p50: nearestRank(frames, 50), p95: nearestRank(frames, 95), p99: nearestRank(frames, 99)});
  receipt.raw.forEach((run, index) => {
    const steady = run.swaps.filter(swap => swap[0] >= WARMUP_ROUNDS);
    const mine = inputs.baseline.runs[index];
    assert.deepEqual(mine.swapFrame.all, stats(steady.map(swap => swap[8][0])), `run ${run.run}: all the swaps`);
    assert.deepEqual([mine.idle.samples, mine.idle.p99], [run.idleIntervalsUsec.length, nearestRank(run.idleIntervalsUsec, 99)], `run ${run.run}: the idle window`);
    assert.deepEqual(mine.injection, {p50: nearestRank(steady.map(swap => swap[5]), 50), p95: nearestRank(steady.map(swap => swap[5]), 95)}, `run ${run.run}: the injection`);
    for (const size of [0, 50, 75, 100]) {
      const frames = steady.filter(swap => NATIVE_NODES[swap[3]] === size).map(swap => swap[8][0]);
      assert.equal(frames.length, 90);
      assert.deepEqual(mine.swapFrame.bySize[size], stats(frames), `run ${run.run}, ${size} nodes created`);
      // The p99 of the 90 swaps of a size is the largest of them (nearest rank 90): why the rows of the p99 by size are out.
      assert.equal(mine.swapFrame.bySize[size].p99, Math.max(...frames), `run ${run.run}, ${size} nodes created: the p99 is the maximum`);
    }
  });
});

// ---- what is frozen, recomputed here by a formula of this file ----
const bound = perRun => {
  const {median, iqr} = quartiles(perRun);
  return Math.ceil((median + 3 * iqr) / 500) * 500 / 1000;
};

test("the three numeric thresholds are the rule applied to the raw intervals, recomputed here with the performance oracle's own functions", () => {
  const byRun = pick => inputs.turn.runs.map(pick);
  const aiPhase = byRun(run => nearestRank(run.aiPhaseUsec.flat(), 95));
  const eventBurst = byRun(run => nearestRank(run.eventBurstUsec.flat(), 95));
  const contextSwitches = inputs.baseline.runs.map(run => run.swapFrame.all.p95);
  assert.deepEqual(aiPhase, [14642, 14539, 14799, 14928, 13784], "720 frames a run: the first six busy frames of 120 steady turns");
  assert.deepEqual(eventBurst, [14677, 14847, 14868, 14952, 14715], "240 frames a run: the seventh busy frame and the one after it");
  assert.deepEqual(contextSwitches, [14835, 14497, 15928, 14217, 14875], "the swap frame p95 over all the swaps of each run: the receipt's own summary");
  const frozen = Object.fromEntries(protocol.thresholds.map(threshold => [threshold.id, threshold.frozenValue]));
  assert.equal(frozen["budget-p95-ai-phase"], bound(aiPhase));
  assert.equal(frozen["budget-p95-event-burst"], bound(eventBurst));
  assert.equal(frozen["budget-p95-context-switches"], bound(contextSwitches));
  assert.deepEqual([frozen["budget-p95-ai-phase"], frozen["budget-p95-event-burst"], frozen["budget-p95-context-switches"]], [15.5, 15.5, 16]);
  for (const run of inputs.turn.runs) {
    assert.equal(run.aiPhaseUsec.flat().length, 720);
    assert.equal(run.eventBurstUsec.flat().length, 240, "two frames of the end of a turn are recorded, and the protocol's window has at least five");
  }
  assert.deepEqual(freeze.corroboration.frozenTurn.framesAfterTheEndOfTheTurn, [1], "one frame after the one that delivers turn_ended, in every turn");
});

test("the budget rows: kept, recomputed, added and removed, each with its reason, and the p99 by size is out", () => {
  const decisions = Object.groupBy(freeze.budget, row => row.decision);
  assert.deepEqual(Object.keys(decisions).sort(), ["added", "kept", "recomputed", "removed"]);
  assert.deepEqual(decisions.removed.map(row => row.id), ["swap-frame-p99-by-nodes"]);
  assert.match(decisions.removed[0].reason, /the p99 of 90 swaps is the largest of them/);
  assert.match(decisions.removed[0].reason, /count of frames of 100 ms or more/);
  assert.deepEqual(decisions.added.map(row => row.id), ["ai-phase-p95", "event-burst-p95"], "the two rows of the turn");
  assert.deepEqual(decisions.recomputed.map(row => row.id), ["swap-frame-p50-by-nodes", "swap-frame-p95-by-nodes", "swap-frame-p95-all", "idle-frame-p99", "frames-of-100-ms-or-more"]);
  assert.deepEqual(decisions.kept.map(row => row.id), ["native-nodes-after-swap", "nodes-created-and-deleted", "one-click-one-swap", "heap-at-rest", "frames-click-to-panel", "cpu-time-of-the-swap",
    "heap-of-a-mounted-panel", "resident-and-static-memory"], "the rows of the headless lane pinned in #77 and the memory, by id");
  assert.ok(decisions.kept.every(row => row.reason.length > 0 && row.derivations.length === 0 && row.source === "headless-77" && row.bounds === undefined), "they are not recomputed and copy no cell of the note");
  // Every row is data: an id, a decision, a reason, a source that the freeze lists and the derivations it reads; the recomputed and the added carry the bounds they give.
  for (const row of freeze.budget) {
    assert.deepEqual(Object.keys(row).slice(0, 5), ["id", "decision", "reason", "source", "derivations"], row.id);
    assert.ok(Object.hasOwn(freeze.sources, row.source), `${row.id}: its source is listed`);
    assert.ok(row.derivations.every(id => derivation(id) !== undefined), `${row.id}: the derivations it reads exist`);
    if (row.decision === "recomputed" || row.decision === "added") {
      assert.deepEqual(row.bounds, row.derivations.map(id => (row.unit === "count" ? derivation(id).limit : derivation(id).limit / 1000)), `${row.id}: the bounds are the derivations' limits`);
    }
  }
  // The values the proposal had are the ones recomputed: nothing moved between the proposal and the freeze.
  assert.deepEqual(freeze.budget.filter(row => row.bounds !== undefined && row.bounds !== null).map(row => [row.id, row.unit, row.bounds]), [
    ["swap-frame-p50-by-nodes", "ms", [4, 9, 12, 13.5]],
    ["swap-frame-p95-by-nodes", "ms", [14, 12.5, 20, 17]],
    ["swap-frame-p95-all", "ms", [16]],
    ["idle-frame-p99", "ms", [16.5]],
    ["frames-of-100-ms-or-more", "count", [0, 0]],
    ["ai-phase-p95", "ms", [15.5]],
    ["event-burst-p95", "ms", [15.5]]
  ]);
  assert.deepEqual(decisions.removed[0].proposedBounds, [16.5, 27.5, 29.5, 41.5], "the p99 by size that the proposal had, not frozen");
  assert.equal(decisions.removed[0].bounds, null);
});

// ---- the check accuses what diverges ----
test("a changed value of an execution changes a bound, and the check accuses it", () => {
  // The run whose swap frame p95 is the smallest becomes the greatest: the median and the third quartile move, and so does the bound.
  const smallest = inputs.baseline.runs.reduce((best, run) => (run.swapFrame.all.p95 < best.swapFrame.all.p95 ? run : best));
  const baseline = withInputs(changed => {
    changed.baseline.runs[smallest.run - 1].swapFrame.all.p95 = 30000;
  });
  const problems = check({changedInputs: baseline});
  assert.ok(problems.some(problem => /^freeze\.json is not what inputs\.json gives by the rule, at \$\.derivations/.test(problem)), problems.join("\n"));
  assert.ok(problems.some(problem => /protocol threshold budget-p95-context-switches: frozenValue is 16, the freeze gives 18\.5/.test(problem)), problems.join("\n"));
  // A turn run: 40 of its 720 frames of the AI phase become 90 ms, which moves the p95 of the run (the 36 slowest frames are the 5%).
  const lowest = inputs.turn.runs.reduce((best, run) => (nearestRank(run.aiPhaseUsec.flat(), 95) < nearestRank(best.aiPhaseUsec.flat(), 95) ? run : best));
  const turn = withInputs(changed => {
    changed.turn.runs[lowest.run - 1].aiPhaseUsec.slice(0, 40).forEach(frames => {
      frames[0] = 90000;
    });
  });
  const turnProblems = check({changedInputs: turn});
  assert.ok(turnProblems.some(problem => /protocol threshold budget-p95-ai-phase: frozenValue is 15\.5, the freeze gives 16/.test(problem)), turnProblems.join("\n"));
  // A frame fewer in a turn, a run fewer, a receipt that is not the registered one, a corroboration that is missing: the inputs are refused before any number is read.
  const short = withInputs(changed => {
    changed.turn.runs[0].eventBurstUsec.pop();
  });
  assert.ok(check({changedInputs: short}).some(problem => /not 120 steady turns/.test(problem)));
  const fewer = withInputs(changed => {
    changed.baseline.runs.pop();
  });
  assert.ok(check({changedInputs: fewer}).some(problem => /not the five runs/.test(problem)));
  const swapped = withInputs(changed => {
    changed.receipts.turn.sha256 = "0".repeat(64);
  });
  assert.ok(check({changedInputs: swapped}).some(problem => /turn: the receipt is not the one registered/.test(problem)));
  const unknown = withInputs(changed => {
    delete changed.corroboration["turn-main"];
  });
  assert.ok(check({changedInputs: unknown}).some(problem => /the corroboration is not/.test(problem)));
});

test("a freeze that was edited by hand, or a protocol that does not carry it, is accused", () => {
  const edited = structuredClone(freeze);
  edited.derivations.find(each => each.id === "idle-frame-p99").limit = 17000;
  assert.ok(check({changedFreeze: edited}).some(problem => /freeze\.json is not what inputs\.json gives by the rule/.test(problem)));
  const redated = structuredClone(freeze);
  redated.frozenAt = "2026-10-11";
  const dated = check({changedFreeze: redated});
  assert.ok(dated.some(problem => /frozenAt is 2026-10-10, not 2026-10-11/.test(problem)), "the thresholds were frozen on the date of the freeze, and only on it");
  const protocolWith = change => {
    const clone = structuredClone(protocol);
    change(clone);
    return clone;
  };
  const threshold = (clone, id) => clone.thresholds.find(each => each.id === id);
  const first = check({changedProtocol: protocolWith(clone => {
    threshold(clone, "budget-p95-ai-phase").frozenValue = 15;
  })});
  assert.ok(first.some(problem => /protocol threshold budget-p95-ai-phase: frozenValue is 15, the freeze gives 15\.5/.test(problem)));
  const unfrozen = check({changedProtocol: protocolWith(clone => {
    threshold(clone, "budget-p95-stress").frozenValue = null;
    threshold(clone, "budget-p95-stress").frozenAt = null;
  })});
  assert.ok(unfrozen.some(problem => /budget-p95-stress: frozenValue is null/.test(problem)));
  assert.ok(unfrozen.some(problem => /budget-p95-stress: frozenAt is null/.test(problem)));
  const dateless = check({changedProtocol: protocolWith(clone => {
    threshold(clone, "budget-p95-event-burst").frozenAt = "2026-10-09";
  })});
  assert.ok(dateless.some(problem => /budget-p95-event-burst: frozenAt is 2026-10-09, not 2026-10-10/.test(problem)), "one date for the five");
  const reordered = check({changedProtocol: protocolWith(clone => {
    clone.thresholds.reverse();
  })});
  assert.ok(reordered.some(problem => /not the five that the freeze fills, in order/.test(problem)));
  const instrument = check({changedProtocol: protocolWith(clone => {
    delete threshold(clone, "cpu-time-instrument").frozenValue.gate;
  })});
  assert.ok(instrument.some(problem => /cpu-time-instrument: frozenValue is/.test(problem)));
  const load = check({changedProtocol: protocolWith(clone => {
    clone.runs.load.limit1MinuteAverage = 3;
  })});
  assert.ok(load.some(problem => /the protocol's load limit is 3/.test(problem)));
  // A freeze that follows its inputs but whose protocol still has the numbers of before: the thresholds are the ones accused.
  const moved = withInputs(changed => {
    changed.turn.runs[4].aiPhaseUsec.slice(0, 40).forEach(frames => {
      frames[0] = 90000;
    });
  });
  const consistent = check({changedInputs: moved, changedFreeze: buildFreeze(moved, {frozenAt: freeze.frozenAt})});
  assert.ok(consistent.some(problem => /protocol threshold budget-p95-ai-phase/.test(problem)));
  assert.ok(consistent.every(problem => problem.startsWith("protocol threshold")), consistent.join("\n"));
});

// ---- the protocol: five thresholds frozen together, on one date, and nothing else of it ----
test("the protocol has its five thresholds frozen on one date, the stress as N/A with its reason and the instrument with its six keys", () => {
  const {thresholds} = protocol;
  assert.deepEqual(thresholds.map(threshold => threshold.id), ["cpu-time-instrument", "budget-p95-ai-phase", "budget-p95-event-burst", "budget-p95-context-switches", "budget-p95-stress"]);
  assert.ok(thresholds.every(threshold => threshold.frozenValue !== null && threshold.frozenAt !== null), "all frozen");
  assert.equal(new Set(thresholds.map(threshold => threshold.frozenAt)).size, 1, "on one date");
  assert.match(thresholds[0].frozenAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(thresholds[0].frozenAt, freeze.frozenAt, "the date of the freeze");
  const [instrument, aiPhase, eventBurst, contextSwitches, stress] = thresholds.map(threshold => threshold.frozenValue);
  assert.deepEqual([typeof aiPhase, typeof eventBurst, typeof contextSwitches], ["number", "number", "number"]);
  assert.match(stress, /^N\/A: /);
  assert.match(stress, /no log of 200 lines and no production list of 100 items/);
  assert.match(stress, /judged by the relative rule alone$/);
  assert.deepEqual(Object.keys(instrument), ["quantity", "reading", "alignment", "observedError", "gate", "evidence"]);
  for (const key of ["quantity", "reading", "alignment", "observedError", "gate"]) {
    assert.ok(typeof instrument[key] === "string" && instrument[key].length > 40, key);
  }
  assert.deepEqual(Object.keys(instrument.evidence), ["research", "record", "pinnedCommit"]);
  assert.match(instrument.evidence.pinnedCommit, /^[0-9a-f]{40}$/);
  for (const file of [instrument.evidence.research, instrument.evidence.record]) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
  }
  assert.match(instrument.reading, /never Performance\.TIME_PROCESS/);
  assert.match(instrument.alignment, /6 draws later/);
  assert.match(instrument.observedError, /at most 0\.16% at 2, 5, 10 and 20 ms headless and at most 1\.5% in a presented window/);
  // The pin and the rest of the file are the protocol test's: the freeze fills the two fields of each threshold and nothing else of the JSON (its status, `baseline.windowed` and the
  // first open item keep the text of the pre-registration, which the pin hashes).
  assert.match(protocol.status, /^pre-registered/);
  assert.match(protocol.baseline.windowed, /^pending/);
  assert.equal(protocol.open[0].id, "windowed-baseline");
  assert.equal(protocol.amendments.length, 4);
});

// ---- the corroboration: what the other executions of the same night show, and no threshold ----
test("the corroboration shows what the notes say of it: the turn before #100 reproduces the frozen one and the one with its HUD is over the bounds", () => {
  const {frozenTurn, roles} = freeze.corroboration;
  const sumP50 = values => ms(quartiles(values).median);
  assert.equal(sumP50(frozenTurn.busySumP50), "54.234", "the seven frames of the job, the frozen execution: p50 across the runs");
  const before = roles["turn-main-pre-100-hud"];
  assert.equal(sumP50(before.busySumP50), "54.911");
  assert.deepEqual([before.aiPhaseP95.limit, before.eventBurstP95.limit], [15500, 15000], "the bounds the rule gives on the HUD of before #100: 15.5 and 15.0 ms");
  assert.ok(before.aiPhaseP95.perRun.every(value => value >= 14500 && value <= 14800), "the p95 of the AI phase in each run: 14.5 to 14.8 ms");
  assert.equal(before.againstTheFrozenBounds.aiPhase.met && before.againstTheFrozenBounds.eventBurst.met, true);
  const current = roles["turn-main"];
  assert.equal(sumP50(current.busySumP50), "94.688");
  assert.deepEqual([current.aiPhaseP95.limit, current.eventBurstP95.limit], [18500, 18500]);
  assert.deepEqual([current.againstTheFrozenBounds.aiPhase.met, current.againstTheFrozenBounds.eventBurst.met], [false, false], "the turn lane with the HUD of #100 is over the frozen bounds of the turn");
  assert.ok(current.phaseP50.slice(1).every(value => value > 14000 && value < 14400), "each phase after the first has a p50 of about 14 ms, over the 8.33 ms period");
  const quiet = roles["baseline-main"];
  assert.ok(quiet.injectionP50.every(value => value >= 8300 && value <= 9100), "the injection and flush p50: 8.3 to 9.0 ms against 6.8 to 7.3");
  assert.ok(quiet.frozenRuns.injectionP50.every(value => value >= 6800 && value <= 7400));
  assert.ok(quiet.swapFrameAllP95.perRun.every(value => value >= 18700 && value <= 20500), "the p95 of the swap frame over all swaps: 18.8 to 20.4 ms against 14.2 to 15.9");
  assert.ok(quiet.frozenRuns.swapFrameAllP95.every(value => value >= 14200 && value <= 15950));
  assert.deepEqual(freeze.corroboration.roles["baseline-main"].framesAtLeast100ms, [0, 0, 0, 0, 1], "one frame of 100 ms or more in the last run of the corroboration, none in the others");
});

test("every execution of the freeze ran above the protocol's load limit, and the freeze says so", () => {
  assert.equal(freeze.loads.limit1MinuteAverage, protocol.runs.load.limit1MinuteAverage);
  assert.equal(freeze.loads.everyFrozenReadingAboveTheLimit, true);
  assert.deepEqual(freeze.loads.frozen.baseline, {min: 5.26, max: 6.16, lane: {before: "{ 5.41 5.71 7.07 }", after: "{ 6.79 6.05 6.87 }"}});
  assert.deepEqual([freeze.loads.frozen.turn.min, freeze.loads.frozen.turn.max], [5.35, 7.55]);
  assert.deepEqual(Object.fromEntries(CORROBORATION_ROLES.map(role => [role, [inputs.receipts[role].load.oneMinute.min, inputs.receipts[role].load.oneMinute.max]])),
    {"baseline-main": [8.34, 13.55], "turn-main": [6.56, 10.53], "turn-main-pre-100-hud": [5.75, 8.6]});
});

// ---- the extraction of the turn's windows, on turns made for it (the receipts of the turn stay outside the repository) ----
const PHASES = ["ai_plan", "ai_move", "production", "growth", "research", "refresh", "idle"];
const turnFrames = (base, {before = [], after = [["idle", 6000, 24, 0, 0]]} = {}) => [...before, ...PHASES.map((phase, index) => [phase, base + index * 100, 56, 1, index === 6 ? 1 : 0]), ...after];
const rawOf = turns => ({run: 1, turns: turns.map(([round, id, frames]) => [round, id, frames, [0, 0, 0, 0]])});
const extract = turns => extractTurnRun(rawOf(turns), {warmupRounds: 2, phases: PHASES});

test("the AI phase is the first six busy frames of a steady turn and the end of the turn is the seventh and the frames after it, the warm-up left out", () => {
  const run = extract([
    [0, "end-turn-1", turnFrames(5000)],
    [1, "end-turn-1", turnFrames(5100)],
    [2, "end-turn-1", turnFrames(7000, {before: [["idle", 6500, 24, 0, 0]]})],
    [2, "end-turn-2", turnFrames(8000, {after: [["idle", 6100, 24, 0, 0], ["idle", 6200, 24, 0, 0]]})]
  ]);
  assert.equal(run.turns, 2, "the two warm-up rounds are not in it");
  assert.deepEqual(run.aiPhaseUsec, [[7000, 7100, 7200, 7300, 7400, 7500], [8000, 8100, 8200, 8300, 8400, 8500]], "a frame before the acceptance is not in the window");
  assert.deepEqual(run.eventBurstUsec, [[7600, 6000], [8600, 6100, 6200]], "the frame that delivers turn_ended and those after it, as many as were recorded");
});

test("a turn whose frames do not advance one phase each, publish a snapshot each and end the turn once is refused", () => {
  const refused = (frames, message) => assert.throws(() => extract([[2, "end-turn-1", frames]]), message);
  const merged = turnFrames(7000);
  merged.splice(1, 1);
  refused(merged, /do not advance one phase each/);
  const twice = turnFrames(7000);
  twice[3][4] = 1;
  refused(twice, /the end of the turn once/);
  const silent = turnFrames(7000);
  silent[2][3] = 0;
  refused(silent, /a snapshot in each busy frame/);
  refused(turnFrames(7000, {after: []}), /not the HUD catching up/);
  refused(turnFrames(7000, {after: [["idle", 6000, 24, 1, 0]]}), /not the HUD catching up/);
  refused(turnFrames(7000, {before: [["idle", 6500, 24, 1, 0]]}), /something moved before the acceptance/);
  refused([["idle", 6000, 24, 0, 0], ["idle", 6000, 24, 0, 0]], /never left idle/);
});

// ---- the script refuses a receipt that is not the registered one ----
test("--from-receipts refuses a receipt whose SHA-256 is not the registered one, and writes nothing", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-freeze-test-"));
  try {
    const bytes = fs.readFileSync(path.join(root, inputs.receipts.baseline.committedAs));
    const tampered = path.join(directory, "baseline.json");
    fs.writeFileSync(tampered, Buffer.concat([bytes, Buffer.from(" ")]));
    const output = path.join(directory, "out");
    await assert.rejects(fromReceipts({baseline: tampered, turn: tampered, directory: output, frozenAt: "2026-10-10"}), /baseline: the SHA-256 of baseline\.json is [0-9a-f]{64}, not the registered 36b32e0d/);
    assert.equal(fs.existsSync(output), false);
    await assert.rejects(fromReceipts({baseline: tampered, turn: tampered, directory: output, frozenAt: "yesterday"}), /--date is not YYYY-MM-DD/);
    await assert.rejects(fromReceipts({baseline: tampered, turn: tampered, corroborate: {nothing: tampered}, directory: output, frozenAt: "2026-10-10"}), /--corroborate nothing: the roles are/);
    assert.deepEqual(Object.keys(RECEIPTS), ["baseline", "turn", ...CORROBORATION_ROLES]);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

// ---- the research notes say what the freeze says ----
// The line of the note's budget table that each recomputed or added row of the freeze is.
const NOTE_ROWS = {
  "swap-frame-p50-by-nodes": "| Swap frame p50, by nodes created",
  "swap-frame-p95-by-nodes": "| Swap frame p95, by nodes created",
  "swap-frame-p95-all": "| Swap frame p95, all swaps (windowed",
  "idle-frame-p99": "| Idle frame p99 (windowed",
  "frames-of-100-ms-or-more": "| Swap frames and idle frames of 100 ms or more",
  "ai-phase-p95": "| AI phase frame p95",
  "event-burst-p95": "| End-of-turn frame p95"
};
const linksOf = text => [...text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)].map(match => match[1]).filter(target => !/^[a-z]+:/.test(target));

test("the baseline note's budget is the frozen one: its heading, its table and its derivation are the freeze's rows", () => {
  assert.match(baselineNote, new RegExp(`^## The budget, frozen on ${freeze.frozenAt}$`, "m"));
  assert.doesNotMatch(baselineNote, /^## The proposed budget$/m);
  assert.doesNotMatch(baselineNote, /PROPOSAL, not frozen/);
  // The rows that the freeze recomputes or adds are lines of the note's budget table, and the line has the bounds the freeze gives, as the table writes them.
  const lines = baselineNote.split("\n");
  for (const row of freeze.budget.filter(each => each.bounds !== undefined && each.bounds !== null)) {
    const line = lines.find(each => each.startsWith(NOTE_ROWS[row.id]));
    assert.ok(line !== undefined, `the table has the row ${row.id}`);
    const written = row.unit === "count" ? String(row.bounds[0]) : `${row.bounds.map(value => value.toFixed(1)).join(" / ")} ms`;
    assert.equal(line.split(" | ")[2], written, `${row.id}: the frozen bound of its line is ${written}`);
  }
  const removed = freeze.budget.find(row => row.decision === "removed");
  assert.match(baselineNote, /the p99 of 90 swaps is the largest of them \(nearest rank 90\), so the bound by size is fixed by one swap a run/, "and the note says why the p99 by size is out");
  assert.ok(baselineNote.includes(`proposed as ${removed.proposedBounds.map(value => value.toFixed(1)).join(" / ")} ms`), "and what the proposal had");
  for (const each of freeze.derivations) {
    assert.ok(baselineNote.includes(derivationRow(each)), `the derivation has the row ${each.id}: ${derivationRow(each)}`);
  }
  assert.match(baselineNote, /\[the freeze\]\(frontier-freeze\.md\)/);
  assert.doesNotMatch(baselineNote, /Hosted CI and the Pages publication are pending/);
  assert.doesNotMatch(baselineNote, /^- Hosted CI is pending/m);
  assert.match(baselineNote, /hosted-ci\.json/);
});

test("the protocol note's section The freeze names the five thresholds and what stays as the pre-registration wrote it, and the freeze note is the whole account", () => {
  assert.match(protocolNote, /^## The freeze$/m);
  const section = protocolNote.slice(protocolNote.indexOf("\n## The freeze\n"), protocolNote.indexOf("\n## Reproducing\n"));
  for (const threshold of protocol.thresholds) {
    assert.ok(section.includes(`\`${threshold.id}\``), `the section names \`${threshold.id}\``);
  }
  assert.ok(section.includes(freeze.frozenAt));
  assert.match(section, /frontier-freeze\.md/);
  assert.match(section, /`status`, `baseline\.windowed` and the first `open` item/);
  assert.match(protocolNote, /^## Amendments$/m, "the headings the protocol test asks for are still there");
  for (const text of [`\`${protocol.thresholds[1].id}\``, "frozenValue", "frozenAt"]) {
    assert.ok(freezeNote.includes(text), `the freeze note has ${text}`);
  }
  // The freeze note names every threshold and every frozen value, and the observations that change no rule.
  for (const threshold of protocol.thresholds) {
    assert.ok(freezeNote.includes(`\`${threshold.id}\``), `the freeze note names \`${threshold.id}\``);
  }
  for (const value of [15.5, 16]) {
    assert.ok(freezeNote.includes(`${value.toFixed(1)} ms`), `the freeze note shows ${value.toFixed(1)} ms`);
  }
  for (const heading of ["The question", "The inputs", "The rule", "What is frozen", "Decisions", "What does not change", "What is still open", "Reproducing"]) {
    assert.match(freezeNote, new RegExp(`^## ${heading}$`, "m"), heading);
  }
  assert.match(freezeNote, /vm\.loadavg|load average/);
  assert.match(freezeNote, /absoluteBudget/);
  assert.match(freezeNote, /HUD of #100/);
  for (const note of [["docs/research/frontier-freeze.md", freezeNote], ["docs/research/frontier-baseline.md", baselineNote], ["docs/research/frontier-comparison-protocol.md", protocolNote]]) {
    for (const target of linksOf(note[1])) {
      assert.ok(fs.existsSync(path.join(root, path.dirname(note[0]), target)), `${note[0]} links to ${target}, which is not there`);
    }
  }
  assert.match(freezeNote, /\]\(\.\.\/evidence\/frontier-freeze\/freeze\.json\)/);
  for (const note of [freezeNote, baselineNote, protocolNote]) {
    assert.match(note, /\]\(\.\.\/evidence\/frontier-freeze\/README\.md\)/, "each note points to the evidence record");
  }
});

test("the freeze note's table of values has the five thresholds and the numbers of the freeze", () => {
  for (const id of ["ai-phase-p95", "event-burst-p95", "swap-frame-p95-all"]) {
    const each = derivation(id);
    assert.ok(freezeNote.includes(`| ${each.sorted.map(ms).join(" / ")} |`) || freezeNote.includes(each.sorted.map(ms).join(" / ")), `the freeze note shows the five runs of ${id}`);
    assert.ok(freezeNote.includes(ms(each.medianPlus3Iqr)), `the freeze note shows the median plus three IQR of ${id}`);
  }
});

// ---- the evidence record, in Portuguese, and the index ----
test("the evidence record is pinned, has the inputs, the account of every value and the open cause, and the index lists it", () => {
  const record = read("docs/evidence/frontier-freeze/README.md");
  assert.ok(record.includes("a6210dc2c09ca63155511f36898f72fc56385798"), "pinned at the implementation commit");
  assert.ok(record.includes(freeze.frozenAt));
  assert.doesNotMatch(record, /\/Users\/|\/private\//, "no local path");
  for (const receipt of Object.values(inputs.receipts)) {
    assert.ok(record.includes(receipt.sha256), `the record has the SHA-256 ${receipt.sha256}`);
  }
  for (const threshold of protocol.thresholds) {
    assert.ok(record.includes(`\`${threshold.id}\``), `the record names \`${threshold.id}\``);
  }
  // Every row of the derivation table is in the record with the numbers of the freeze (its labels are in Portuguese and its decimal separator is the comma).
  const lines = record.split("\n");
  for (const each of freeze.derivations) {
    const row = derivationRow(each);
    const cells = row.slice(row.indexOf(" | ", 2)).replaceAll(".", ",");
    assert.ok(lines.some(line => line.endsWith(cells)), `the record has the derivation of ${each.id}: ${cells}`);
  }
  const decisions = {kept: "mantida", recomputed: "recalculada", added: "adicionada", removed: "**removida**"};
  for (const row of freeze.budget) {
    assert.ok(lines.some(line => line.startsWith(`| \`${row.id}\` | ${decisions[row.decision]} |`)), `the record has the budget row ${row.id}`);
  }
  for (const heading of ["As entradas", "A regra", "Os valores congelados", "As decisões", "Quatro observações que não mudam nenhuma regra", "Limites", "CI hospedada e Pages", "Reproduzindo"]) {
    assert.match(record, new RegExp(`^## ${heading}$`, "m"), heading);
  }
  // The cause of the turn's frames over the frozen bounds is confirmed and fixed in #108, and the record says it was the turn lane's probe, not the HUD or the host.
  assert.match(record, /\*\*A causa foi confirmada e corrigida no \[#108\]\(https:\/\/github\.com\/journey-studios\/godot-fabric\/pull\/108\) \(commit `09ed8f7`\): era a sonda da faixa do turno \(a leitura que ela faz do snapshot da Surface\), não a HUD nem o host\.\*\*/);
  assert.match(record, /--check/);
  assert.match(record, /--from-receipts/);
  assert.match(record, /\*\*A saída X6 \(orçamento de desempenho pré-registrado e cumprido\) continua aberta\*\*/);
  for (const target of linksOf(record)) {
    assert.ok(fs.existsSync(path.join(root, "docs/evidence/frontier-freeze", target)), `the record links to ${target}, which is not there`);
  }
  const index = read("docs/evidence/README.md");
  assert.match(index, /The \[freeze record\]\(frontier-freeze\/README\.md\), pinned at `a6210dc`/);
});

test("this test and the script are part of the contracts", () => {
  const scripts = json("package.json").scripts;
  assert.ok(scripts["test:contracts"].split("&&").some(command => command.includes("tests/frontier-freeze.test.mjs")), "test:contracts runs this test");
});
