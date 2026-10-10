import { measuredOf } from "./frontier-comparison-format.mjs";
import { idleReference, median, nearestRank } from "./frontier-comparison-statistics.mjs";

// The per-execution values that the statistics take, from the raw data of one accepted execution (docs/research/frontier-comparison-protocol.json: `primaryOutcome.perRun` and the
// `observation` of each secondary outcome). Times in the data are integer microseconds; the values here are in the protocol's units (ms).

const USEC_PER_MS = 1000;
// The factor of the outcome `frames-above-twice-idle-reference`, which says it in its id.
const TWICE = 2;

// The ids of the outcomes of the CPU time per frame by percentile (cpu-time-p95, the primary outcome, cpu-time-p50, cpu-time-p99), the percent being in the id.
const percentileOf = (id) => parseInt(/^cpu-time-p(\d+)$/.exec(id)?.[1] ?? "", 10);

// The series of values that each window gives for an execution, by id: the primary outcome first and then the descriptive ones. The ones that count frames give two series, the count and the
// share of the window's frames (the outcome's unit: "count and share of the window's frames").
export function windowSeriesOf(protocol) {
  const secondary = protocol.secondaryOutcomes.map((outcome) => outcome.id);
  const percentiles = [protocol.primaryOutcome.id, ...secondary.filter((id) => /^cpu-time-p\d+$/.test(id))];
  const idle = secondary.find((id) => id === "frames-above-twice-idle-reference");
  const slow = secondary.find((id) => /^frames-above-\d+-ms$/.test(id));
  const counting = [idle, slow].filter((id) => id !== undefined).flatMap((id) => [`${id}.count`, `${id}.share`]);
  return {
    primary: protocol.primaryOutcome.id,
    series: [...percentiles.map((id) => ({ id, outcome: id, unit: "ms" })), ...counting.map((id) => ({ id, outcome: id.split(".")[0], unit: id.endsWith(".count") ? "frames" : "share" }))],
  };
}

// The values of one window of one execution, for the series of windowSeriesOf, by series id. primaryOutcome.perRun: the percentile by nearest rank of the CPU time of the frames of the window's measured occurrences (the
// warm-up occurrences are left out). The frames above twice the run's idle reference compare the CPU time of a frame with 2 x idleReference.rule's median of half-sums of the idle window's CPU
// time; the frames above 100 ms, with 100 ms.
export function windowMeasures(execution, window, series) {
  const frames = measuredOf(execution.windows[window.id]).flatMap((occurrence) => occurrence.frameUsec);
  const twiceIdle = TWICE * idleReference(execution.idle.cpuUsec);
  const values = {};
  for (const { id, unit } of series) {
    const [outcome, part] = id.split(".");
    if (part === undefined) {
      values[id] = nearestRank(frames, percentileOf(outcome)) / USEC_PER_MS;
      continue;
    }
    const limit = outcome === "frames-above-twice-idle-reference" ? twiceIdle : parseInt(/\d+/.exec(outcome)[0], 10) * USEC_PER_MS;
    const count = frames.filter((frame) => frame > limit).length;
    values[id] = unit === "frames" ? count : count / frames.length;
  }
  return values;
}

// The once-per-execution readings, by series id. click-to-panel: the median of the measured clicks (the protocol's median); rss: the reading at the end of the run, and its maximum as a
// descriptive series (`rss.max`); the Hermes heap and the native views; the nodes of the SceneTree; the time to the interactive HUD. Only the readings the arm has are returned.
export function readingValues(execution) {
  const { readings } = execution;
  const values = {};
  if (Object.hasOwn(readings, "clickToPanelFrames")) {
    values["click-to-panel"] = median(readings.clickToPanelFrames);
  }
  if (Object.hasOwn(readings, "rssMb")) {
    values.rss = readings.rssMb.end;
    values["rss.max"] = readings.rssMb.max;
  }
  if (Object.hasOwn(readings, "hermes")) {
    values["hermes-heap.bytes"] = readings.hermes.heapBytes;
    values["hermes-heap.nativeViews"] = readings.hermes.nativeViews;
  }
  if (Object.hasOwn(readings, "sceneNodes")) {
    values["scene-nodes"] = readings.sceneNodes;
  }
  if (Object.hasOwn(readings, "timeToInteractiveHudMs")) {
    values["time-to-interactive-hud"] = readings.timeToInteractiveHudMs;
  }
  return values;
}
