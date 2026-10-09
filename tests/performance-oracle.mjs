import assert from "node:assert/strict";
import {BURNS, BURN_MS, COMPONENTS, CYCLES, HEAP_STEADY_GROWTH_LIMIT_BYTES, LIST_ROWS, RETAIN_MIN_BYTES_PER_OBJECT, RETAIN_OBJECTS,
  WARMUP_CYCLES, WORKLOADS} from "./performance-cases.mjs";

// Independent oracle, written from the contract the performance section states and from what the
// engine itself counts, not from the probe or the C++: it takes the readings the probe recorded,
// one per point of the run, and recomputes from them what must hold at any pace of the machine.
//
// The contract. Counters are exact: the native views created minus the ones deleted are the
// ones alive, and every counter, sample count and total only grows from one reading to the next.
// A phase's time is exclusive (a mount inside a JS turn is the mount's), so the phases together
// never account for more than the pumps did, and none has more samples than there were pumps. The
// durations come with the samples their percentiles are taken from, nearest rank over a window of
// the last `windowSize`: the oracle sorts the samples and takes the rank itself, and where the
// window holds every sample (a series of at most `windowSize`) it also adds them up and finds the
// largest, which must be the total and the maximum the host reports. Hermes' heap is read after a
// collection and must follow what JS holds: retained objects raise it by at least what they
// occupy, released ones lower it, and the collection count rises with every reading. After a
// cycle of any workload the SceneTree holds the nodes the baseline of the run holds, Godot counts
// no orphan beyond it and the host holds no native view.
//
// The live heap at rest, after a full collection, may rise at most HEAP_STEADY_GROWTH_LIMIT_BYTES above
// its value after the first steady cycle of a workload (docs/research/performance.md).
//
// Nothing here judges a duration, the resident memory or Godot's static memory: they are
// recorded, summarised from their raw samples and returned. Nothing asks the machine for a pace.

const EPSILON = 1e-9;
const SERIES_PATHS = [["pump"], ["phases", "js"], ["phases", "mount"], ["phases", "layout"], ["surfaces", "start"], ["surfaces", "retire"]];
const PHASES = ["js", "mount", "layout"];

const at = (value, path) => path.reduce((current, key) => current?.[key], value);
const isCount = value => Number.isInteger(value) && value >= 0;
const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);

// Nearest rank: the sample of rank ceil(percent * n / 100) once they are sorted, in integers.
export function nearestRank(values, percent) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(Math.max(Math.floor((percent * sorted.length + 99) / 100), 1), sorted.length);
  return sorted[rank - 1];
}
export const summary = values => ({samples: values.length, p50: nearestRank(values, 50), p95: nearestRank(values, 95), max: Math.max(...values)});
export const round = (value, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;

function finiteAndNotNegative(value, label) {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value) && value >= 0, `${label}: ${value} is not a finite, non-negative number`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => finiteAndNotNegative(item, `${label}[${index}]`));
  } else if (value !== null && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => finiteAndNotNegative(item, `${label}.${key}`));
  }
}

// ------------------------------------------------------------------ one series
function verifySeries(series, label, windowSize, windowed) {
  assert.ok(series != null, `${label}: the host reports the series`);
  assert.ok(isCount(series.count) && isCount(series.rejected), `${label}: counts are whole numbers`);
  assert.equal(series.rejected, 0, `${label}: the host's clock never gave a duration that is not one`);
  assert.ok(series.p50Ms <= series.p95Ms && series.p95Ms <= series.p99Ms && series.p99Ms <= series.maxMs + EPSILON, `${label}: percentiles are ordered`);
  assert.ok(series.totalMs <= series.maxMs * series.count + 1e-6, `${label}: the total is at most the maximum times the samples`);
  assert.ok(series.count > 0 || (series.totalMs === 0 && series.maxMs === 0 && series.p99Ms === 0), `${label}: no sample, no time`);
  // The host publishes the samples only to a run that asks for them, and the probe keeps them in the readings it
  // names (the baseline and the end of each workload).
  assert.equal(series.windowMs !== undefined, windowed, `${label}: the samples are in the readings that kept them`);
  if (!windowed) {
    return;
  }
  const window = series.windowMs;
  assert.equal(window.length, Math.min(series.count, windowSize), `${label}: the window holds the last ${windowSize} samples, or all of them`);
  for (const [name, percent] of [["p50Ms", 50], ["p95Ms", 95], ["p99Ms", 99]]) {
    assert.equal(series[name], nearestRank(window, percent), `${label}: ${name} is the nearest rank of the samples the host reports`);
  }
  assert.ok(window.every(value => value <= series.maxMs + EPSILON), `${label}: no sample is above the maximum`);
  if (series.count <= windowSize) {
    // The window is every sample the series took, so the exact figures follow from it.
    near(window.reduce((sum, value) => sum + value, 0), series.totalMs, 1e-9 * Math.max(1, series.totalMs), `${label}: the samples add up to the total`);
    assert.equal(Math.max(0, ...window), series.maxMs, `${label}: the largest sample is the maximum`);
  }
}

// ------------------------------------------------------------------ one reading
export function verifyReading(reading, label, windowed = false) {
  const perf = reading.performance;
  assert.ok(perf != null && Object.keys(perf).length > 0, `${label}: the application reports a performance section`);
  finiteAndNotNegative(perf, `${label}.performance`);
  finiteAndNotNegative(reading.godot, `${label}.godot`);
  const {counters, hermes} = perf;
  for (const name of ["commits", "creates", "deletes", "updates", "nativeViews", "liveRoots", "retiredRoots"]) {
    assert.ok(isCount(counters[name]), `${label}: counter ${name} is a whole number`);
  }
  assert.equal(counters.creates - counters.deletes, counters.nativeViews, `${label}: created minus deleted views are the views alive`);
  assert.equal(hermes.source, "jsi::Instrumentation::getHeapInfo", `${label}: Hermes' heap comes from the instrumentation`);
  assert.equal(hermes.collectedBeforeReading, true, `${label}: Hermes' heap is read after a collection`);
  assert.ok(hermes.heap.hermes_allocatedBytes > 0 && hermes.heap.hermes_numCollections > 0, `${label}: the heap counts live bytes and collections`);
  assert.ok(Number.isInteger(perf.windowSize) && perf.windowSize > 0, `${label}: the host states its window`);
  for (const path of SERIES_PATHS) {
    verifySeries(at(perf, path), `${label}.${path.join(".")}`, perf.windowSize, windowed);
  }
  const pump = perf.pump;
  let phases = 0;
  for (const name of PHASES) {
    const phase = perf.phases[name];
    assert.ok(phase.count <= pump.count, `${label}: phase ${name} has at most one sample per pump (${phase.count} > ${pump.count})`);
    phases += phase.totalMs;
  }
  assert.ok(phases <= pump.totalMs * (1 + 1e-12) + EPSILON, `${label}: the phases (${phases} ms) add up to no more than the pumps (${pump.totalMs} ms)`);
}

export function verifyGrowth(previous, reading, label) {
  for (const name of ["commits", "creates", "deletes", "updates", "retiredRoots"]) {
    assert.ok(reading.performance.counters[name] >= previous.performance.counters[name], `${label}: counter ${name} never goes down`);
  }
  for (const path of SERIES_PATHS) {
    const now = at(reading.performance, path);
    const then = at(previous.performance, path);
    assert.ok(now.count >= then.count && now.totalMs >= then.totalMs && now.maxMs >= then.maxMs,
      `${label}: ${path.join(".")} never goes down`);
  }
  assert.ok(reading.performance.hermes.heap.hermes_numCollections >= previous.performance.hermes.heap.hermes_numCollections, `${label}: collections never go down`);
}

const heapOf = reading => reading.performance.hermes.heap.hermes_allocatedBytes;
const collectionsOf = reading => reading.performance.hermes.heap.hermes_numCollections;
const delta = (after, before, path) => at(after.performance, path) - at(before.performance, path);

// ------------------------------------------------------------------ the stages
function verifyHeapSource(source) {
  assert.equal(source.retainedObjects, RETAIN_OBJECTS, "The fixture retained the objects this oracle expects");
  assert.equal(source.releasedObjects, RETAIN_OBJECTS, "and released the same ones");
  const floor = RETAIN_OBJECTS * RETAIN_MIN_BYTES_PER_OBJECT;
  assert.ok(heapOf(source.retained) - heapOf(source.rest) >= floor,
    `Retaining ${RETAIN_OBJECTS} objects raised the heap by ${heapOf(source.retained) - heapOf(source.rest)} bytes, under ${floor}`);
  assert.ok(heapOf(source.retained) - heapOf(source.released) >= floor,
    `Releasing them lowered the heap by ${heapOf(source.retained) - heapOf(source.released)} bytes, under ${floor}`);
  assert.ok(collectionsOf(source.rest) < collectionsOf(source.retained) && collectionsOf(source.retained) < collectionsOf(source.released),
    "Every reading ran a collection");
  return {restBytes: heapOf(source.rest), retainedBytes: heapOf(source.retained), releasedBytes: heapOf(source.released),
    bytesPerObject: round((heapOf(source.retained) - heapOf(source.rest)) / RETAIN_OBJECTS, 2)};
}

// Without the validation_performance_samples meta the section reports aggregates and no samples (what every other
// reader of the snapshot gets); with it, the samples too, and the section weighs more.
function verifyWindows(windows) {
  const {withoutMeta: plain, withMeta: sampled} = windows;
  assert.ok(plain.aggregates && !plain.samples, "Without the meta the section reports aggregates and no samples");
  assert.ok(sampled.aggregates && sampled.samples, "With the meta it reports the samples too");
  assert.ok(plain.performanceBytes > 0 && plain.performanceBytes < sampled.performanceBytes, "and the samples are what makes it heavier");
  assert.ok(plain.snapshotBytes < sampled.snapshotBytes, "so does the whole snapshot");
  return {performanceBytes: {withoutMeta: plain.performanceBytes, withMeta: sampled.performanceBytes},
    snapshotBytes: {withoutMeta: plain.snapshotBytes, withMeta: sampled.snapshotBytes}};
}

// A stopped application has one state: its snapshot is the same text however often it is read, with the validation metas or without.
function verifyStopped(stopped) {
  assert.ok(stopped.stopped === true && stopped.rootCount === 0, "The application is stopped and holds no root");
  assert.match(stopped.plain[0], /^[0-9a-f]{64}$/, "and its snapshot was read");
  assert.equal(stopped.plain[1], stopped.plain[0], "A stopped application's snapshot is the same on a second reading");
  assert.equal(stopped.withMetas[1], stopped.withMetas[0], "and with the validation metas set");
  return {snapshotBytes: stopped.bytes};
}

function verifyBurns(burns) {
  assert.equal(burns.length, BURNS, "The probe asked for the busy turns the oracle expects");
  return burns.map(({label, requestedMs, ranMs, before, after}) => {
    assert.equal(requestedMs, BURN_MS, `${label}: the request`);
    assert.ok(ranMs >= requestedMs, `${label}: JS was busy by the host's own clock for the time asked (${ranMs} ms)`);
    const js = delta(after, before, ["phases", "js", "totalMs"]);
    const pumps = delta(after, before, ["pump", "totalMs"]);
    let phases = 0;
    for (const name of PHASES) {
      phases += delta(after, before, ["phases", name, "totalMs"]);
    }
    assert.ok(js >= ranMs - 1e-6, `${label}: the JS phase accounted ${js} ms for a turn that was busy ${ranMs} ms`);
    assert.ok(js <= pumps + 1e-6 && phases <= pumps + 1e-6, `${label}: the phases (${phases} ms) fit in the pumps (${pumps} ms)`);
    return {label, ranMs: round(ranMs, 3), jsPhaseMs: round(js, 3), pumpsMs: round(pumps, 3)};
  });
}

// The live heap after each cycle, from the first steady cycle on: the growth is the last minus the first
// and the largest step the biggest change from one cycle to the next. Not judged yet.
function heapGrowth(series) {
  const steady = series.slice(WARMUP_CYCLES);
  let largestStep = 0;
  for (let index = 1; index < steady.length; ++index) {
    largestStep = Math.max(largestStep, Math.abs(steady[index] - steady[index - 1]));
  }
  return {steadyCycles: steady.length, firstSteady: steady[0], last: steady.at(-1), growth: steady.at(-1) - steady[0],
    largestStep, highestAboveFirst: Math.max(...steady) - steady[0]};
}

function verifySoak(workload, soak, baseline) {
  assert.equal(soak.component, COMPONENTS[workload], `${workload}: the component`);
  const {cycles} = soak;
  assert.equal(cycles.length, CYCLES, `${workload}: the cycles of the soak`);
  const rows = {created: [], commits: []};
  const per = {mountPump: [], mountJs: [], mountMount: [], mountLayout: [], unmountPump: [], unmountJs: [], unmountMount: [],
    unmountLayout: [], retire: [], mountWall: [], unmountWall: []};
  cycles.forEach((cycle, index) => {
    const label = `${workload} cycle ${index}`;
    assert.equal(cycle.index, index, `${label}: in order`);
    for (const point of ["before", "mounted", "after"]) {
      verifyReading(cycle[point], `${label} ${point}`);
    }
    // Back to the baseline of this run, whatever the pace: the engine's own counts.
    assert.equal(cycle.after.godot.nodes, baseline.godot.nodes, `${label}: the SceneTree holds the nodes the baseline holds`);
    assert.equal(cycle.after.godot.nodeMonitor, baseline.godot.nodeMonitor, `${label}: and so does Godot's node monitor`);
    assert.equal(cycle.after.godot.orphans, baseline.godot.orphans, `${label}: Godot counts no orphan beyond the baseline's`);
    assert.equal(cycle.after.host.rootCount, 0, `${label}: the host holds no root`);
    assert.equal(cycle.after.host.pendingRootRetirements, 0, `${label}: and no retirement is pending`);
    const counters = cycle.after.performance.counters;
    assert.ok(counters.nativeViews === 0 && counters.liveRoots === 0 && counters.creates === counters.deletes, `${label}: the host holds no native view`);
    // What the surface says of itself while it is mounted and after it is retired.
    const {mountedSurface: mounted, retiredSurface: retired} = cycle;
    assert.ok(mounted.state === "mounted" && mounted.nativeTags > 0 && mounted.creates - mounted.deletes === mounted.nativeTags,
      `${label}: a mounted surface holds the views it created minus the ones it deleted`);
    assert.ok(retired.state === "unmounted" && retired.nativeTags === 0 && retired.creates === retired.deletes && retired.creates === mounted.creates,
      `${label}: a retired surface deleted every view it created`);
    assert.ok(cycle.mountFrames > 0 && cycle.unmountFrames > 0, `${label}: the surface settled and was retired`);
    // The notification of the unmount is the snapshot taken as the root ended, with the root counts brought up to the retirement.
    assert.ok(mounted.liveRoots >= 1 && mounted.liveRoots === mounted.rootCount && mounted.retiredRoots === cycle.before.performance.counters.retiredRoots,
      `${label}: a mounted surface reports the live and retired roots of the application`);
    assert.ok(retired.liveRoots >= 0 && retired.liveRoots === retired.rootCount && retired.retiredRoots === cycle.after.performance.counters.retiredRoots,
      `${label}: the unmount notification's live roots agree with its root count and its retired roots with the application's`);
    const created = cycle.after.performance.counters.creates - cycle.before.performance.counters.creates;
    const deleted = cycle.after.performance.counters.deletes - cycle.before.performance.counters.deletes;
    assert.equal(created, mounted.creates, `${label}: the host counted the views the surface created`);
    assert.equal(deleted, created, `${label}: and deleted every one of them`);
    rows.created.push(created);
    rows.commits.push(cycle.after.performance.counters.commits - cycle.before.performance.counters.commits);
    assert.ok(rows.commits.at(-1) >= 1, `${label}: the cycle committed`);
    // Durations: summarised from the cycle's own raw readings.
    per.mountPump.push(delta(cycle.mounted, cycle.before, ["pump", "totalMs"]));
    per.unmountPump.push(delta(cycle.after, cycle.mounted, ["pump", "totalMs"]));
    for (const [name, key] of [["js", "Js"], ["mount", "Mount"], ["layout", "Layout"]]) {
      per[`mount${key}`].push(delta(cycle.mounted, cycle.before, ["phases", name, "totalMs"]));
      per[`unmount${key}`].push(delta(cycle.after, cycle.mounted, ["phases", name, "totalMs"]));
    }
    per.retire.push(delta(cycle.after, cycle.before, ["surfaces", "retire", "totalMs"]));
    per.mountWall.push(cycle.mountWallMs);
    per.unmountWall.push(cycle.unmountWallMs);
  });
  assert.ok(rows.created.every(count => count === rows.created[0]), `${workload}: every cycle creates the same ${rows.created[0]} views`);
  const final = soak.final;
  verifyReading(final, `${workload} final`, true);
  assert.ok(final.performance.phases.mount.count > 0 && final.performance.phases.layout.count > 0 && final.performance.phases.layout.totalMs > 0,
    `${workload}: the mount and layout phases saw its commits`);
  assert.ok(final.performance.surfaces.retire.count >= CYCLES, `${workload}: the host timed each surface's retirement`);
  const rest = cycles.map(cycle => heapOf(cycle.after));
  const growth = heapGrowth(rest);
  assert.ok(growth.highestAboveFirst <= HEAP_STEADY_GROWTH_LIMIT_BYTES,
    `${workload}: the live heap at rest rose ${growth.highestAboveFirst} bytes above its first steady value, over the limit of ${HEAP_STEADY_GROWTH_LIMIT_BYTES}`);
  const mountedHeap = cycles.map(cycle => heapOf(cycle.mounted));
  const rss = cycles.flatMap(cycle => [cycle.mounted.godot.rssKb, cycle.after.godot.rssKb]);
  const staticPerCycle = (cycles.at(-1).after.godot.staticMemory - cycles[WARMUP_CYCLES].after.godot.staticMemory) / (CYCLES - 1 - WARMUP_CYCLES);
  const sums = Object.fromEntries(Object.entries(per).map(([key, values]) => [key, summary(values.map(value => round(value, 4)))]));
  return {views: rows.created[0], commitsPerCycle: summary(rows.commits), heapRest: growth,
    heapMounted: {median: nearestRank(mountedHeap.slice(WARMUP_CYCLES), 50), ...heapGrowth(mountedHeap)},
    mountedOverRestBytes: nearestRank(cycles.slice(WARMUP_CYCLES).map(cycle => heapOf(cycle.mounted) - heapOf(cycle.after)), 50),
    durationsMs: sums, rssKb: {min: Math.min(...rss), max: Math.max(...rss)}, staticBytesPerCycle: round(staticPerCycle, 1),
    hostWindow: {pump: final.performance.pump.count, p50Ms: round(final.performance.pump.p50Ms, 6), p95Ms: round(final.performance.pump.p95Ms, 6)}};
}

// ----------------------------------------------------------------- the report
export function verifyPerformanceReport(report) {
  const {stages} = report;
  assert.equal(report.scenario, "performance");
  assert.deepEqual(stages.config.workloads, WORKLOADS, "The probe ran the workloads this oracle recomputes");
  assert.deepEqual(stages.config.components, COMPONENTS);
  assert.deepEqual([stages.config.cycles, stages.config.warmupCycles, stages.config.listRows, stages.config.retainObjects,
    stages.config.retainMinBytesPerObject, stages.config.burnMs, stages.config.burns, stages.config.heapGrowthLimitBytes],
  [CYCLES, WARMUP_CYCLES, LIST_ROWS, RETAIN_OBJECTS, RETAIN_MIN_BYTES_PER_OBJECT, BURN_MS, BURNS, HEAP_STEADY_GROWTH_LIMIT_BYTES],
  "and with these parameters");
  const provenance = stages.provenance;
  assert.match(provenance.godot, /^4\.\d+\.\d+-stable/, "The report names the Godot version");
  assert.match(provenance.hermes, /^\d+\.\d+\.\d+$/, "and the Hermes version");
  for (const key of ["architecture", "os", "displayServer", "renderingDriver", "renderingMethod"]) {
    assert.ok(typeof provenance[key] === "string" && provenance[key].length > 0, `and the ${key}`);
  }
  // The chain of readings in the order they were taken: every one holds the invariants, none goes backwards.
  const baseline = stages.baseline;
  const source = stages.heapSource;
  const chain = [["baseline", baseline], ["heap rest", source.rest], ["heap retained", source.retained], ["heap released", source.released]];
  stages.burn.forEach(({before, after}, index) => chain.push([`burn ${index} before`, before], [`burn ${index} after`, after]));
  for (const workload of WORKLOADS) {
    stages.workloads[workload].cycles.forEach((cycle, index) => chain.push(
      [`${workload} ${index} before`, cycle.before], [`${workload} ${index} mounted`, cycle.mounted], [`${workload} ${index} after`, cycle.after]));
    chain.push([`${workload} final`, stages.workloads[workload].final]);
  }
  const windowed = new Set([baseline, ...WORKLOADS.map(workload => stages.workloads[workload].final)]);
  chain.forEach(([label, reading], index) => {
    verifyReading(reading, label, windowed.has(reading));
    if (index > 0) {
      verifyGrowth(chain[index - 1][1], reading, label);
    }
  });
  assert.equal(baseline.host.rootCount, 0, "Nothing is mounted at the baseline");
  assert.equal(baseline.performance.counters.nativeViews, 0, "and the host holds no native view");
  const snapshot = {...verifyWindows(stages.windows), stoppedSnapshotBytes: verifyStopped(stages.stopped).snapshotBytes};
  const heap = verifyHeapSource(source);
  const burns = verifyBurns(stages.burn);
  const workloads = {};
  for (const workload of WORKLOADS) {
    workloads[workload] = verifySoak(workload, stages.workloads[workload], baseline);
    // The probe's own account of the steady heap is the one the oracle computes.
    const observed = stages.observedHeap[workload];
    assert.equal(observed.growth, workloads[workload].heapRest.growth, `${workload}: the probe's growth is the oracle's`);
    assert.equal(observed.largestStep, workloads[workload].heapRest.largestStep, `${workload}: and so is its largest step`);
  }
  // The control takes the same readings and mounts nothing: it tells what the probe's own bookkeeping costs.
  const control = stages.control.cycles;
  assert.equal(control.length, CYCLES, "The control took as many readings as the soaks");
  control.forEach((cycle, index) => {
    for (const point of ["before", "mounted", "after"]) {
      verifyReading(cycle[point], `control ${index} ${point}`);
    }
    assert.equal(cycle.after.performance.counters.nativeViews, 0, `control ${index}: nothing was mounted`);
  });
  const controlStatic = (control.at(-1).after.godot.staticMemory - control[WARMUP_CYCLES].after.godot.staticMemory) / (CYCLES - 1 - WARMUP_CYCLES);
  return {provenance: {godot: provenance.godot, hermes: provenance.hermes, architecture: provenance.architecture, os: provenance.os,
    displayServer: provenance.displayServer, renderingDriver: provenance.renderingDriver, processor: provenance.processor},
  snapshot, heapSource: heap, burns, workloads, controlStaticBytesPerCycle: round(controlStatic, 1),
  window: baseline.performance.windowSize, readings: chain.length};
}
