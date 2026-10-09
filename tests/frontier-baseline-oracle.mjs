import assert from "node:assert/strict";
import {HEAP_STEADY_GROWTH_LIMIT_BYTES} from "./performance-cases.mjs";
import {nearestRank, round, summary, verifyGrowth, verifyReading} from "./performance-oracle.mjs";
import {BASE_NATIVE_NODES, GRAPHICS_RUNS, GRAPHICS_VIEWPORT, HEAP_WINDOW_ROUNDS, IDLE_FRAMES, NATIVE_NODES, PANELS, REST_FRAMES, ROUNDS, SHAPES,
  STABLE_FRAMES, TAB, TOUR, WARMUP_ROUNDS} from "./frontier-baseline-cases.mjs";

// Independent oracle for the performance baseline on the Frontier HUD's scene, written from the contract of the experiment and
// from what the engine itself counts, not from the probe: it takes the raw readings the probe recorded, one after every swap and
// one at rest at the end of every round, and recomputes from them what must hold at any pace of the machine. The percentiles of
// the host's own series are recomputed by the performance oracle (tests/performance-oracle.mjs, the GF-30 one) from the
// samples the host reports, and the ones recorded here are computed from the raw samples with its nearest rank.
//
// The contract. The HUD has a base (no panel) and four panels whose native nodes follow from their shapes: a root, a header, a View and a
// Text for every chip, and for the city its production bar. A swap by a click on the button of panel B, from A, creates the nodes of B
// and deletes those of A, and leaves the SceneTree, the host's native views and the Surface holding the base plus the nodes of B. A click swaps once
// and never reaches the world. A round (every ordered pair of panels once) ends at the base. The live heap at rest, read after a
// forced collection, does not grow more than HEAP_STEADY_GROWTH_LIMIT_BYTES (the GF-30 limit) from the first steady rounds to the last.
//
// Nothing here judges a duration, the frames a click takes (recorded as measured), the resident memory or Godot's static memory:
// they depend on the pace of the machine (docs/research/frontier-baseline.md).
const EPSILON = 1e-9;
const stats = values => ({...summary(values), p99: nearestRank(values, 99)});
const quartiles = values => ({median: nearestRank(values, 50), q1: nearestRank(values, 25), q3: nearestRank(values, 75),
  iqr: nearestRank(values, 75) - nearestRank(values, 25), min: Math.min(...values), max: Math.max(...values)});
const heapOf = reading => reading.performance.hermes.heap.hermes_allocatedBytes;
const sum = values => values.reduce((total, value) => total + value, 0);

// The nodes of a panel from its shape: a root, a header, two nodes a chip (the View and its Text) and the city's production bar.
const nodesOfShape = shape => shape === null ? 0 : 2 + 2 * shape.chips + (shape.footer ? 1 : 0);
// The base from the bar: the Surface's root, the HUD's root and the bar, a button and a label for every panel, and the region.
const baseOfBar = panels => 3 + 2 * panels.length + 1;

function verifyExperiment(config) {
  assert.deepEqual(config.panels, PANELS, "The probe ran the panels this oracle recomputes");
  const derived = Object.fromEntries(PANELS.map(panel => [panel, nodesOfShape(SHAPES[panel])]));
  assert.deepEqual(derived, NATIVE_NODES, "The sizes pinned in the cases are what the shapes give: a root, a header, two nodes a chip");
  assert.deepEqual(config.nativeNodes, derived, "and the probe swapped panels of these sizes");
  assert.deepEqual(Object.values(derived).slice(0, 3), [50, 75, 100], "the 50 to 100 nodes per swap of the milestone");
  assert.equal(baseOfBar(PANELS), BASE_NATIVE_NODES, "The base is what the bar and the region give");
  assert.equal(config.baseNativeNodes, BASE_NATIVE_NODES);
  assert.deepEqual(config.tab, TAB);
  assert.deepEqual(config.tour, TOUR);
  // The tour is a closed walk from the base that takes every ordered pair of panels once.
  assert.ok(TOUR[0] === "empty" && TOUR.at(-1) === "empty", "A round starts and ends at the base");
  const pairs = new Set(TOUR.slice(1).map((panel, index) => `${TOUR[index]}>${panel}`));
  assert.equal(pairs.size, TOUR.length - 1, "no pair twice");
  assert.equal(pairs.size, PANELS.length * (PANELS.length - 1), "and none left out");
  assert.ok(TOUR.every((panel, index) => index === 0 || panel !== TOUR[index - 1]), "a swap changes the panel");
  assert.deepEqual([config.warmupRounds, config.rounds, config.stableFrames], [WARMUP_ROUNDS, ROUNDS, STABLE_FRAMES], "with these parameters");
  return derived;
}

function verifyProvenance(provenance) {
  assert.match(provenance.godot, /^4\.\d+\.\d+-stable/, "The report names the Godot version");
  assert.match(provenance.hermes, /^\d+\.\d+\.\d+$/, "and the Hermes version");
  for (const key of ["architecture", "os", "displayServer", "renderingDriver", "renderingMethod", "processor"]) {
    assert.ok(typeof provenance[key] === "string" && provenance[key].length > 0, `and the ${key}`);
  }
  assert.ok(Number.isInteger(provenance.vsyncMode) && Number.isFinite(provenance.refreshRate), "and the vsync mode and refresh rate it read back");
}

// The heap at rest after each round, judged on the floor of windows of rounds: a reading can carry a transient allocation that the next
// does not (a step of 2,056 bytes, in one to three consecutive rounds), which only adds; a leak raises the floor as it raises the rest.
function heapAtRest(rests) {
  const steady = rests.slice(WARMUP_ROUNDS).map(entry => heapOf(entry.reading));
  assert.ok(steady.length >= 2 * HEAP_WINDOW_ROUNDS, "The steady rounds fill two windows");
  const firstFloor = Math.min(...steady.slice(0, HEAP_WINDOW_ROUNDS));
  const lastFloor = Math.min(...steady.slice(-HEAP_WINDOW_ROUNDS));
  const floor = Math.min(...steady);
  assert.ok(floor > 0, "The heap at rest is read");
  assert.ok(lastFloor - firstFloor <= HEAP_STEADY_GROWTH_LIMIT_BYTES,
    `The live heap at rest rose ${lastFloor - firstFloor} bytes from the first ${HEAP_WINDOW_ROUNDS} steady rounds to the last, over the limit of ${HEAP_STEADY_GROWTH_LIMIT_BYTES}`);
  let largestStep = 0;
  for (let index = 1; index < steady.length; ++index) {
    largestStep = Math.max(largestStep, Math.abs(steady[index] - steady[index - 1]));
  }
  return {steadyRounds: steady.length, firstFloor, lastFloor, growth: lastFloor - firstFloor, firstSteady: steady[0], last: steady.at(-1),
    lastMinusFirst: steady.at(-1) - steady[0], highestAboveFloor: Math.max(...steady) - floor, largestStep,
    roundsAboveFloor: steady.filter(value => value > floor).length};
}

// ----------------------------------------------------------------------- the swaps
function verifySwaps(stages, derived) {
  const {base, swaps, rests} = stages;
  const steps = TOUR.length - 1;
  assert.equal(stages.aborted, null, "A click showed its panel: the run was not cut short");
  assert.equal(swaps.length, (WARMUP_ROUNDS + ROUNDS) * steps, "The probe made every swap of every round");
  assert.equal(rests.length, WARMUP_ROUNDS + ROUNDS, "and read the heap at rest at the end of every round");
  assert.equal(base.surface.nativeTags, BASE_NATIVE_NODES, "The Surface holds the base's native nodes");
  assert.equal(base.reading.performance.counters.nativeViews, BASE_NATIVE_NODES, "and so does the host");
  assert.equal(base.reading.performance.counters.liveRoots, 1, "in one root");
  const baseViews = base.reading.performance.counters.nativeViews;
  let previous = base.reading;
  let previousSurface = base.surface;
  swaps.forEach((swap, index) => {
    const label = `swap ${index} (${swap.from} to ${swap.to})`;
    const round = Math.floor(index / steps);
    const step = index % steps;
    assert.deepEqual([swap.round, swap.step, swap.from, swap.to], [round, step, TOUR[step], TOUR[step + 1]], `${label}: in the order of the tour`);
    const size = derived[swap.to];
    const fromSize = derived[swap.from];
    const counters = swap.after.performance.counters;
    // The tree, the host and the Surface hold the base plus the new panel.
    assert.equal(swap.treeNodes, base.baseNodes + size, `${label}: the SceneTree holds the base's nodes plus the new panel's`);
    assert.equal(swap.after.godot.nodes, base.reading.godot.nodes + size, `${label}: and so does the reading`);
    assert.equal(swap.after.godot.nodeMonitor, base.reading.godot.nodeMonitor + size, `${label}: and Godot's node monitor`);
    assert.equal(swap.after.godot.orphans, base.reading.godot.orphans, `${label}: Godot counts no orphan beyond the base's`);
    assert.equal(counters.nativeViews, baseViews + size, `${label}: the host holds the base's native views plus the new panel's`);
    assert.equal(swap.surface.nativeTags, base.surface.nativeTags + size, `${label}: and so does the Surface`);
    assert.equal(swap.surface.state, "mounted", `${label}: the Surface stays mounted`);
    assert.equal(counters.creates - counters.deletes, counters.nativeViews, `${label}: created minus deleted views are the views alive`);
    // The swap creates the nodes of the new panel and deletes those of the old one, in the host's counters, in the Surface's and in
    // the application's snapshot as the probe read it before and after the click.
    assert.equal(counters.creates - previous.performance.counters.creates, size, `${label}: the host created the ${size} nodes of the new panel`);
    assert.equal(counters.deletes - previous.performance.counters.deletes, fromSize, `${label}: and deleted the ${fromSize} of the old one`);
    assert.equal(swap.surface.creates - previousSurface.creates, size, `${label}: the Surface counted the nodes created`);
    assert.equal(swap.surface.deletes - previousSurface.deletes, fromSize, `${label}: and deleted`);
    assert.equal(swap.host.creates, size, `${label}: the snapshot read around the click saw the same creations`);
    assert.equal(swap.host.deletes, fromSize, `${label}: and deletions`);
    assert.ok(swap.host.commits >= 1 && counters.commits - previous.performance.counters.commits >= 1, `${label}: the click committed`);
    // One click, one swap, and the world heard nothing.
    const presses = Object.values(swap.rn.presses).reduce((total, count) => total + count, 0);
    assert.equal(presses, 1, `${label}: the click pressed one button once`);
    assert.equal(swap.rn.presses[swap.to], 1, `${label}: the button of the new panel`);
    assert.equal(swap.rn.changes, 1, `${label}: and changed the state once`);
    assert.equal(swap.rn.shown, swap.to, `${label}: to the new panel`);
    assert.equal(swap.worldEvents, 0, `${label}: and no event of the click reached the Godot world`);
    assert.equal(swap.snapshotComplete, true, `${label}: when the tree held the new panel, the snapshot held its last node`);
    assert.deepEqual(swap.shownRoots, swap.to === "empty" ? [] : [swap.to], `${label}: and the root of no other panel`);
    // What is recorded: shaped, finite, and not judged.
    assert.ok(Number.isInteger(swap.latencyFrames) && swap.latencyFrames >= 0, `${label}: the click showed its panel within the bound`);
    assert.ok(swap.frameUsec.length >= 1 && swap.frameUsec.every(value => Number.isInteger(value) && value > 0), `${label}: the frames of the swap were timed`);
    assert.ok(Number.isInteger(swap.flushUsec) && swap.flushUsec > 0 && Number.isInteger(swap.latencyUsec) && swap.latencyUsec >= swap.flushUsec,
      `${label}: and so were the injection and the time to the nodes`);
    for (const name of ["pump", "js", "mount", "layout"]) {
      assert.ok(swap.host[`${name}Ms`] >= 0 && swap.host[`${name}Count`] >= 0, `${label}: the ${name} phase is recorded`);
    }
    assert.ok(swap.host.mountMs + swap.host.layoutMs + swap.host.jsMs <= swap.host.pumpMs * (1 + 1e-12) + EPSILON, `${label}: the phases fit in the pump`);
    previous = swap.after;
    previousSurface = swap.surface;
  });
  // A round ends at the base.
  rests.forEach((entry, index) => {
    const {reading} = entry;
    assert.equal(entry.round, index, `rest ${index}: in order`);
    assert.equal(reading.godot.nodes, base.reading.godot.nodes, `rest ${index}: the SceneTree holds the nodes the base holds`);
    assert.equal(reading.godot.nodeMonitor, base.reading.godot.nodeMonitor, `rest ${index}: and so does Godot's node monitor`);
    assert.equal(reading.godot.orphans, base.reading.godot.orphans, `rest ${index}: Godot counts no orphan beyond the base's`);
    assert.equal(reading.performance.counters.nativeViews, baseViews, `rest ${index}: the host holds the base's native views`);
    assert.equal(reading.host.rootCount, base.reading.host.rootCount, `rest ${index}: in the one root`);
  });
}

// What was recorded, summarized per ordered pair of panels and per nodes the swap creates (the size of the new panel, which is where most of its
// time goes), over the steady rounds.
function summarizeSwaps(stages, derived) {
  const steady = stages.swaps.filter(swap => swap.round >= WARMUP_ROUNDS);
  const baseHeap = heapOf(stages.base.reading);
  const frameMs = swap => sum(swap.frameUsec) / 1000;
  const row = group => ({
    swaps: group.length, latencyFrames: stats(group.map(swap => swap.latencyFrames)),
    flushMs: stats(group.map(swap => round(swap.flushUsec / 1000, 3))), swapFrameMs: stats(group.map(swap => round(frameMs(swap), 3))),
    pumpMs: stats(group.map(swap => round(swap.host.pumpMs, 3))), jsMs: stats(group.map(swap => round(swap.host.jsMs, 3))),
    mountMs: stats(group.map(swap => round(swap.host.mountMs, 3))), layoutMs: stats(group.map(swap => round(swap.host.layoutMs, 3))),
    heapOverBaseBytes: stats(group.map(swap => heapOf(swap.after) - baseHeap)), treeNodes: stats(group.map(swap => swap.treeNodes)),
    rssKb: {min: Math.min(...group.map(swap => swap.after.godot.rssKb)), max: Math.max(...group.map(swap => swap.after.godot.rssKb))}});
  const perPair = {};
  const byCreated = {};
  for (const swap of steady) {
    const key = `${swap.from}>${swap.to}`;
    (perPair[key] ??= []).push(swap);
    (byCreated[derived[swap.to]] ??= []).push(swap);
  }
  for (const [key, group] of Object.entries(perPair)) {
    assert.equal(group.length, ROUNDS, `${key}: ${ROUNDS} steady swaps`);
  }
  return {perPair: Object.fromEntries(Object.entries(perPair).map(([key, group]) => [key, row(group)])),
    byNodesCreated: Object.fromEntries(Object.entries(byCreated).map(([created, group]) => [created, row(group)])), all: row(steady)};
}

function summarizeMemory(stages) {
  const rss = [stages.base.reading, ...stages.swaps.map(swap => swap.after), ...stages.rests.map(entry => entry.reading)].map(reading => reading.godot.rssKb);
  const first = stages.rests[WARMUP_ROUNDS].reading.godot;
  const last = stages.rests.at(-1).reading.godot;
  return {rssKb: {min: Math.min(...rss), max: Math.max(...rss), firstSteadyRest: first.rssKb, lastRest: last.rssKb},
    staticBytesPerRound: round((last.staticMemory - first.staticMemory) / (stages.rests.length - 1 - WARMUP_ROUNDS), 1)};
}

// ----------------------------------------------------------------- the report
export function verifyFrontierBaselineReport(report) {
  const {stages} = report;
  assert.equal(report.scenario, "frontier-baseline");
  const derived = verifyExperiment(stages.config);
  assert.deepEqual([stages.config.restFrames, stages.config.heapWindowRounds, stages.config.heapGrowthLimitBytes],
    [REST_FRAMES, HEAP_WINDOW_ROUNDS, HEAP_STEADY_GROWTH_LIMIT_BYTES], "and these for the heap at rest");
  verifyProvenance(stages.provenance);
  assert.equal(stages.provenance.displayServer, "headless");
  assert.equal(report.displayServer, "headless");
  assert.equal(stages.scene.mounted, true, "The HUD mounted over the world");
  assert.equal(stages.scene.mouseFilter, 2, "in a Surface that takes no pointer (IGNORE)");
  // The chain of readings in the order they were taken: every one holds the invariants of the host's performance section, was read
  // after a forced collection of Hermes' heap, and none goes backwards.
  const chain = [["base", stages.base.reading]];
  stages.swaps.forEach((swap, index) => {
    chain.push([`swap ${index}`, swap.after]);
    if (swap.step === TOUR.length - 2 && stages.rests[swap.round] !== undefined) {
      chain.push([`rest ${swap.round}`, stages.rests[swap.round].reading]);
    }
  });
  chain.push(["final", stages.final]);
  const windowed = new Set([stages.base.reading, stages.final]);
  chain.forEach(([label, reading], index) => {
    verifyReading(reading, label, windowed.has(reading));
    if (index > 0) {
      verifyGrowth(chain[index - 1][1], reading, label);
    }
  });
  assert.equal(stages.base.reading.host.rootCount, 1, "One root is mounted at the base");
  verifySwaps(stages, derived);
  const heap = heapAtRest(stages.rests);
  const {perPair, byNodesCreated, all} = summarizeSwaps(stages, derived);
  const final = stages.final.performance;
  const series = value => ({count: value.count, p50Ms: round(value.p50Ms), p95Ms: round(value.p95Ms), p99Ms: round(value.p99Ms), maxMs: round(value.maxMs)});
  return {provenance: {godot: stages.provenance.godot, hermes: stages.provenance.hermes, architecture: stages.provenance.architecture,
    os: stages.provenance.os, displayServer: stages.provenance.displayServer, renderingDriver: stages.provenance.renderingDriver,
    processor: stages.provenance.processor, vsyncMode: stages.provenance.vsyncMode, refreshRate: stages.provenance.refreshRate},
  nativeNodes: derived, baseNativeNodes: BASE_NATIVE_NODES, swaps: stages.swaps.length, steadySwaps: all.swaps, heap, perPair, byNodesCreated,
  hostWindow: {window: final.windowSize, pump: series(final.pump), js: series(final.phases.js), mount: series(final.phases.mount),
    layout: series(final.phases.layout)}, memory: summarizeMemory(stages), readings: chain.length};
}

// ----------------------------------------------------------- the windowed lane
// One run of the windowed lane (tests/frontier-baseline-graphics-probe.gd): the same swaps, with the frame intervals of the idle
// window and of the swaps, exact where the headless lane is exact, and the vsync mode and refresh rate it read back.
export function verifyGraphicsRun(run) {
  assert.equal(run.scenario, "frontier-baseline-graphics");
  const derived = verifyExperiment(run.config);
  verifyProvenance(run.provenance);
  assert.notEqual(run.provenance.displayServer, "headless", "The run drew in a window");
  assert.deepEqual(run.viewport, GRAPHICS_VIEWPORT);
  assert.equal(run.aborted, null, "A click showed its panel: the run was not cut short");
  const steps = TOUR.length - 1;
  assert.equal(run.swaps.length, (WARMUP_ROUNDS + ROUNDS) * steps, "The run made every swap of every round");
  assert.equal(run.baseNodes, run.base.treeNodes, "The base is read once");
  assert.equal(run.base.surface.nativeTags, BASE_NATIVE_NODES, "The Surface holds the base's native nodes");
  run.swaps.forEach((swap, index) => {
    const label = `run ${run.run} swap ${index} (${swap.from} to ${swap.to})`;
    const step = index % steps;
    assert.deepEqual([swap.round, swap.step, swap.from, swap.to], [Math.floor(index / steps), step, TOUR[step], TOUR[step + 1]], `${label}: in the order of the tour`);
    const size = derived[swap.to];
    assert.equal(swap.treeNodes, run.baseNodes + size, `${label}: the SceneTree holds the base's nodes plus the new panel's`);
    assert.equal(swap.surface.nativeTags, run.base.surface.nativeTags + size, `${label}: and the Surface its native nodes`);
    assert.equal(swap.host.creates, size, `${label}: the host created the nodes of the new panel`);
    assert.equal(swap.host.deletes, derived[swap.from], `${label}: and deleted those of the old one`);
    assert.equal(Object.values(swap.rn.presses).reduce((total, count) => total + count, 0), 1, `${label}: one press`);
    assert.equal(swap.rn.presses[swap.to], 1, `${label}: on the button of the new panel`);
    assert.equal(swap.rn.changes, 1, `${label}: and one change of state`);
    assert.equal(swap.rn.shown, swap.to);
    // A window on a display also gets the motion of the real pointer, which is the map's: the presses, releases and touches are judged.
    assert.equal(swap.worldClicks, 0, `${label}: and none of its presses, releases or touches reached the world`);
    assert.ok(Number.isInteger(swap.worldEvents) && swap.worldEvents >= swap.worldClicks, `${label}: the other events the map heard are recorded`);
    assert.equal(swap.snapshotComplete, true, `${label}: the snapshot held the new panel complete`);
    assert.deepEqual(swap.shownRoots, swap.to === "empty" ? [] : [swap.to], `${label}: and no other panel`);
    assert.ok(Number.isInteger(swap.latencyFrames) && swap.latencyFrames >= 0, `${label}: the click showed its panel within the bound`);
    assert.ok(swap.frameUsec.length >= 1 && swap.frameUsec.every(value => Number.isInteger(value) && value > 0), `${label}: the swap's frames were timed`);
    assert.ok(Number.isInteger(swap.flushUsec) && swap.flushUsec > 0, `${label}: and so was the injection`);
    assert.ok(swap.drawUsec === null || (Number.isInteger(swap.drawUsec) && swap.drawUsec > 0), `${label}: the time to the first drawn frame, when one was seen`);
  });
  assert.equal(run.idle.intervalsUsec.length, IDLE_FRAMES, "The idle window has its frames");
  assert.ok(run.idle.intervalsUsec.every(value => Number.isInteger(value) && value > 0), "and each was timed");
  assert.ok(run.checks.length > 0 && run.checks.every(check => check.passed), "Every check of the run passed");
  assert.equal(new Set(run.checks.map(check => check.name)).size, run.checks.length);
}

// A window that the system does not present is not a measurement of a displayed application, in two ways, and a run has to survive both:
//  - the window does not draw (covered by other windows, or the display asleep): a frame has to have been drawn after every click of the
//    steady rounds and in at least nine of ten frames of the idle window;
//  - the window draws but no display paces the loop (the display off or showing the lock screen: the vsync mode still reads back enabled
//    and frame_post_draw still fires, but a frame takes a fraction of the refresh period): the median interval of the idle window has to be at
//    least half of the refresh period that the window read back. A presented window at 120 Hz idles at about 7.8 ms and an unpaced one at about
//    0.5 ms, against a threshold of 4.17 ms.
// An invalid run is kept in the receipt, with its reason and its raw intervals, and repeated; no statistic of it is ever reported as a frame time.
export const UNPACED = "unpaced: the display is not presenting";
const UNDRAWN = "undrawn: the window did not draw throughout";
export function graphicsRunValidity(run) {
  const undrawnSwaps = run.swaps.filter(swap => swap.round >= WARMUP_ROUNDS && swap.drawUsec === null).length;
  const drew = undrawnSwaps === 0 && run.idle.draws >= 0.9 * run.idle.frames;
  const idle = run.idle.intervalsUsec.map(value => value / 1000);
  const idleMedianMs = nearestRank(idle, 50);
  const periodMs = run.provenance.refreshRate > 0 ? 1000 / run.provenance.refreshRate : null;
  const minimumIdleMedianMs = periodMs === null ? null : periodMs / 2;
  const paced = minimumIdleMedianMs !== null && idleMedianMs >= minimumIdleMedianMs;
  return {valid: drew && paced, drew, paced, reason: !drew ? UNDRAWN : !paced ? UNPACED : null, undrawnSwaps, idleDraws: run.idle.draws,
    idleFrames: run.idle.frames, processFrames: run.frames.processed, drawnFrames: run.frames.drawn, idleMedianMs: round(idleMedianMs, 3),
    idleMeanMs: round(sum(idle) / idle.length, 3), refreshPeriodMs: periodMs === null ? null : round(periodMs, 3),
    minimumIdleMedianMs: minimumIdleMedianMs === null ? null : round(minimumIdleMedianMs, 3)};
}

// The receipt of the windowed lane (scripts/frontier-baseline-graphics.mjs), judged from what it carries: an accepted run that no display paced
// is refused, a lane that did not complete its runs reports no frame-time statistic at all, and a lane that did reports them.
export function verifyGraphicsReceipt(receipt) {
  assert.equal(typeof receipt.presented, "boolean", "The receipt says whether the lane was presented");
  const period = receipt.provenance.refreshRate > 0 ? 1000 / receipt.provenance.refreshRate : null;
  assert.ok(period !== null, "The receipt carries the refresh rate that the window read back");
  for (const raw of receipt.raw) {
    const idleMedian = nearestRank(raw.idleIntervalsUsec.map(value => value / 1000), 50);
    assert.ok(idleMedian >= period / 2,
      `Run ${raw.run} is accepted but unpaced: its idle frame median is ${round(idleMedian, 3)} ms, under half of the refresh period (${round(period / 2, 3)} ms)`);
  }
  for (const attempt of receipt.rejectedAttempts) {
    assert.ok(typeof attempt.reason === "string" && attempt.reason.length > 0, "A rejected attempt says why");
    assert.ok(attempt.raw != null && attempt.raw.idleIntervalsUsec.length > 0, "and keeps its raw intervals");
  }
  assert.equal(receipt.attempts.length, receipt.raw.length + receipt.rejectedAttempts.length, "Every attempt is accepted or rejected");
  if (receipt.presented) {
    assert.equal(receipt.raw.length, GRAPHICS_RUNS, "A presented lane has all its runs");
    assert.ok(receipt.summary != null && receipt.summary.runs.length === GRAPHICS_RUNS, "and their statistics");
    assert.equal(receipt.status, "presented");
  } else {
    assert.equal(receipt.summary, null, "A lane that was not presented reports no frame-time statistic");
    assert.match(receipt.status, /^not presented: /);
  }
}

// The statistics of one run, from its raw intervals: the idle window and the frames that took a click, with the frames above twice the idle
// median and above 100 ms (the counts the final comparison V05-10 asks for). No "missed frame" is read from them: on a display with the vsync on
// the process frames come in clusters (docs/research/frame-clock.md, about 3 ms and 13 ms apart at 120 Hz), so an interval longer than the
// refresh period is not an image the display showed twice.
function summarizeGraphicsRun(run) {
  const steady = run.swaps.filter(swap => swap.round >= WARMUP_ROUNDS);
  const toMs = values => values.map(value => value / 1000);
  const idle = toMs(run.idle.intervalsUsec);
  const swapFrames = toMs(steady.map(swap => swap.frameUsec[0]));
  const idleMedian = nearestRank(idle, 50);
  const frame = values => ({samples: values.length, p50: round(nearestRank(values, 50), 3), p95: round(nearestRank(values, 95), 3),
    p99: round(nearestRank(values, 99), 3), max: round(Math.max(...values), 3),
    aboveTwiceIdleMedian: values.filter(value => value > 2 * idleMedian).length, above100ms: values.filter(value => value > 100).length});
  const byCreated = {};
  for (const swap of steady) {
    (byCreated[run.config.nativeNodes[swap.to]] ??= []).push(swap.frameUsec[0] / 1000);
  }
  return {run: run.run, mapMotionEvents: sum(run.swaps.map(swap => swap.worldEvents - swap.worldClicks)),
    idleFrameMs: frame(idle), swapFrameMs: frame(swapFrames),
    swapFrameMsByNodesCreated: Object.fromEntries(Object.entries(byCreated).map(([nodes, values]) => [nodes, frame(values)])),
    injectionMs: {p50: round(nearestRank(toMs(steady.map(swap => swap.flushUsec)), 50), 3), p95: round(nearestRank(toMs(steady.map(swap => swap.flushUsec)), 95), 3)},
    clickToNodesMs: {p50: round(nearestRank(toMs(steady.map(swap => swap.latencyUsec)), 50), 3), p95: round(nearestRank(toMs(steady.map(swap => swap.latencyUsec)), 95), 3)},
    clickToDrawMs: steady.every(swap => swap.drawUsec !== null)
      ? {p50: round(nearestRank(toMs(steady.map(swap => swap.drawUsec)), 50), 3), p95: round(nearestRank(toMs(steady.map(swap => swap.drawUsec)), 95), 3),
        p99: round(nearestRank(toMs(steady.map(swap => swap.drawUsec)), 99), 3)} : null,
    latencyFrames: {p50: nearestRank(steady.map(swap => swap.latencyFrames), 50), max: Math.max(...steady.map(swap => swap.latencyFrames))},
    vsyncMode: run.provenance.vsyncMode, vsyncModeName: run.provenance.vsyncModeName, refreshRate: run.provenance.refreshRate};
}

// The runs together: for every statistic, the median and the interquartile range (nearest rank) across the runs, which are
// separate processes, plus the raw per-run summaries. Nothing is discarded: an outlier run stays in and shows in the range.
export function summarizeGraphicsRuns(runs) {
  assert.equal(runs.length, GRAPHICS_RUNS, "The execution has its runs");
  for (const run of runs) {
    const validity = graphicsRunValidity(run);
    assert.ok(validity.valid, `and the display presented the window throughout every one: run ${run.run} is ${validity.reason} (idle median ${validity.idleMedianMs} ms, at least ${validity.minimumIdleMedianMs} ms wanted)`);
  }
  const summaries = runs.map(summarizeGraphicsRun);
  const across = pick => quartiles(summaries.map(pick));
  const frame = name => Object.fromEntries(["p50", "p95", "p99", "max", "aboveTwiceIdleMedian", "above100ms"].map(key => [key, across(summary => summary[name][key])]));
  return {runs: summaries, across: {idleFrameMs: frame("idleFrameMs"), swapFrameMs: frame("swapFrameMs"),
    injectionMsP50: across(summary => summary.injectionMs.p50), clickToNodesMsP50: across(summary => summary.clickToNodesMs.p50),
    clickToDrawMsP50: summaries.every(summary => summary.clickToDrawMs !== null) ? across(summary => summary.clickToDrawMs.p50) : null,
    clickToDrawMsP95: summaries.every(summary => summary.clickToDrawMs !== null) ? across(summary => summary.clickToDrawMs.p95) : null,
    vsync: [...new Set(summaries.map(summary => summary.vsyncModeName))], refreshRate: [...new Set(summaries.map(summary => summary.refreshRate))]}};
}
