import assert from "node:assert/strict";
import {HEAP_STEADY_GROWTH_LIMIT_BYTES} from "./performance-cases.mjs";
import {nearestRank, round, verifyGrowth, verifyReading} from "./performance-oracle.mjs";
import {heapAtRest, verifyPresence} from "./frontier-baseline-oracle.mjs";
import {RSS_GROWTH_LIMIT_KB} from "./frontier-soak-cases.mjs";
import {rssGrowthAtRest} from "./frontier-soak-oracle.mjs";
import {CLICK_FRAME_LIMIT, EVENT_QUEUE, GAME_CONTEXTS, HUD_CONNECTIONS, IDLE_FRAMES, MARKERS, HUD_PANELS, MODAL_CONTEXTS, PHASES, REST_FRAMES, STEADY_ROUNDS, STABLE_FRAMES, STEPS,
  CONTEXT_PANELS, TURNS_PER_ROUND, TURN_FRAME_LIMIT, WARMUP_ROUNDS} from "./frontier-turn-cases.mjs";

// Independent oracle for the turn measured on the Frontier game as a consumer has it (V05-06, criterion `turno`), written from the contract of the
// experiment and from what the game and the engine themselves count, not from the probe: it takes the raw report of the headless lane and judges, rule
// by rule, what must hold at any pace of the machine.
//
// The contract. A round is a tour of 19 real clicks over a new game: a tile of the map, the buttons of the actions panel, the Close of the city screen, the End turn of
// the bar four times and the answers to the three events of the queue, in order. The city screen and the dialog are blocking Modals, so no click of the map or of the bar
// is made while one is open. Every click makes exactly one call to the game, the intent of its step, and the map hears a click on the map and no other. The dialog shows,
// at each arrival, the position the game gives it ("1 of 3" to "3 of 3") and the two choices of the event at the head of the queue, which this file writes again. The HUD shows the panels of the context the click leads to (the table of consumers/civ-lite/hud_validation.gd) within a ceiling of frames
// that catches a stall: how many frames it really takes is recorded and never fixed. At rest, after REST_FRAMES idle frames, the HUD holds the same
// native views, the SceneTree the same nodes and Godot no orphan every time a context comes back. The end of a turn runs one phase in each frame, in the
// order of the service, publishes a snapshot in each and the end of the turn once. The live heap at rest does not grow past the GF-30 limit by the
// baseline's rule over the medians of the halves, and the resident memory by the soak's loose one. No error is unhandled.
//
// What the timed frames measure is the game's and the HUD's, and nothing the probe adds by looking: no interval between two timed frames (the frames of a click and
// of a turn) contains a read of the Surface's snapshot, and the cheap reading the frames make of the Controls says what a full reading says when the click arrives. The
// snapshot carries the whole application's status, among it the loader's log of every image it loaded, so a read costs what the application has accumulated and not what
// the HUD shows: two reads in each timed frame of the turn were 4.6 ms of its frames once the HUD had icons (docs/evidence/civ-lite-ui/README.md).
//
// Nothing here judges a duration, the frames a click takes (against the ceiling only), the host's phases or the resident memory's level: they are recorded
// and summarized (docs/research/frontier-turn.md).
const stats = values => ({samples: values.length, min: Math.min(...values), p50: nearestRank(values, 50), p95: nearestRank(values, 95), max: Math.max(...values)});
const median = values => nearestRank(values, 50);
const ms = (value, digits = 3) => round(value / 1000, digits);
const heapOf = reading => reading.performance.hermes.heap.hermes_allocatedBytes;
const unique = values => [...new Set(values)];
const SERIES_START = "start";
const RECORDED_EXACTLY = 1e-9;

// Every record of the steps, in the order of the run, and every series of readings at rest: the start of a round and each step.
const recordsOf = stages => stages.rounds.flatMap(row => row.steps);
const seriesOf = stages => ({[SERIES_START]: stages.rounds.map(row => row.start), ...Object.fromEntries(STEPS.map((step, index) =>
  [step.id, stages.rounds.map(row => row.steps[index].rest)]))});
const steadyOf = list => list.slice(WARMUP_ROUNDS);

function verifyProvenance(provenance) {
  assert.match(provenance.godot, /^4\.\d+\.\d+-stable/, "The report names the Godot version");
  assert.match(provenance.hermes, /^\d+\.\d+\.\d+$/, "and the Hermes version");
  for (const key of ["architecture", "os", "displayServer", "renderingDriver", "renderingMethod", "processor"]) {
    assert.ok(typeof provenance[key] === "string" && provenance[key].length > 0, `and the ${key}`);
  }
  assert.ok(Number.isInteger(provenance.vsyncMode) && Number.isFinite(provenance.refreshRate), "and the vsync mode and refresh rate it read back");
}

// ------------------------------------------------------------------------------------------------------ the rules
function verifyConfig(report) {
  const {config} = report.stages;
  assert.equal(report.scenario, "frontier-turn");
  assert.equal(report.lane, "headless");
  assert.deepEqual(config.steps, STEPS, "The probe ran the steps of the cases, in their order");
  assert.deepEqual([config.warmupRounds, config.rounds, config.restFrames, config.stableFrames, config.clickFrameLimit, config.turnFrameLimit],
    [WARMUP_ROUNDS, STEADY_ROUNDS, REST_FRAMES, STABLE_FRAMES, CLICK_FRAME_LIMIT, TURN_FRAME_LIMIT], "with these rounds and frames");
  // The device, the viewport and the map are the validation's (consumers/civ-lite/hud_validation.gd, which the probe reads them from): the report carries them and
  // the scene below shows that the game was really in that viewport and on that device. The table is written here once (tests/civ-lite-ui-oracle.mjs) and the
  // probe echoes the validation's own, so that the two sources are shown to agree.
  assert.ok(Number.isInteger(config.device) && config.device > 0, "on the validation device");
  assert.deepEqual(config.table, CONTEXT_PANELS, "and the table of contexts to panels of the validation");
  assert.deepEqual(config.markers, MARKERS);
  assert.deepEqual(config.phases, PHASES);
  assert.deepEqual([...config.panels].sort(), [...HUD_PANELS].sort());
  assert.deepEqual([config.heapGrowthLimitBytes, config.rssGrowthLimitKb], [HEAP_STEADY_GROWTH_LIMIT_BYTES, RSS_GROWTH_LIMIT_KB],
    "with the GF-30 heap limit and the soak's resident-memory rule");
  assert.ok(STEPS.length === 19 && STEPS.filter(step => step.kind === "turn").length === TURNS_PER_ROUND, "The tour is 19 clicks and presses End turn four times a round");
  assert.deepEqual(unique(STEPS.map(step => step.to)).sort(), [...GAME_CONTEXTS].sort(), "and visits all seven contexts of the game");
  STEPS.forEach((step, index) => assert.equal(step.from, index === 0 ? "none" : STEPS[index - 1].to, `step ${step.id} starts where the previous one ended`));
  assert.ok(STEADY_ROUNDS >= 30 && STEPS.filter(step => step.kind === "turn").length * STEADY_ROUNDS >= 30, "At least 30 steady rounds and 30 steady turns");
  verifyTourOfTheQueue(config.steps);
}

// The tour against the contract of the Modals and of the queue, with nothing read from the probe: the dialog's steps are the three events answered in the order of the
// table, each with the first choice of its head, and each leads to the head that follows (the End turn of the fourth turn to the first); no click of the map or of the bar is
// made in a context that holds a Modal open, and each time the city screen opens the next click is its Close.
export function verifyTourOfTheQueue(steps) {
  const answers = steps.filter(step => step.kind === "dialog");
  assert.deepEqual(answers.map(step => step.target), EVENT_QUEUE.map(event => `hud-dialog-choice-${event.choices[0]}`), "The tour answers the three events in the order of the queue, each with its first choice");
  const heads = steps.filter(step => step.head !== undefined);
  assert.deepEqual(heads.map(step => step.head), EVENT_QUEUE.map(event => event.choices[0]), "and each step that opens an event names the first choice of the head it leads to");
  assert.deepEqual(heads.map(step => step.id), [steps.find(step => step.to === "dialog" && step.kind === "turn").id, ...answers.slice(0, -1).map(step => step.id)],
    "the End turn that raises the events opens the first, and every answer but the last opens the next");
  assert.deepEqual(answers.map(step => step.to), ["dialog", "dialog", "none"], "and the last answer closes the dialog");
  steps.forEach((step, index) => {
    assert.ok(!(step.from in MODAL_CONTEXTS) || !["map", "turn"].includes(step.kind), `step ${step.id}: no click of the map or of the bar while a Modal is open (${step.from})`);
    if (step.to === "city") {
      assert.deepEqual([steps[index + 1]?.kind, steps[index + 1]?.target, steps[index + 1]?.from], ["overlay", "hud-city-close", "city"], `step ${step.id}: the city screen opens and the next click is its Close`);
    }
  });
}

function verifyScene(stages) {
  verifyProvenance(stages.provenance);
  assert.equal(stages.provenance.displayServer, "headless");
  const {scene, base} = stages;
  assert.equal(scene.mounted, true, "The provisioned game mounted its HUD");
  assert.equal(scene.device, stages.config.device);
  assert.deepEqual(scene.viewport, stages.config.viewport, "in the viewport the HUD is laid out for");
  assert.equal(base.context, "none", "The base is the game at rest in the none context");
  assert.deepEqual(base.panels, CONTEXT_PANELS.none, "with the bar only");
  assert.equal(base.surface.state, "mounted");
  assert.ok(base.surface.nativeTags > 0 && base.surface.nativeTags === base.reading.performance.counters.nativeViews, "and the Surface and the host agree on its native views");
  assert.equal(base.reading.host.rootCount, 1, "in one root");
}

function verifyShape(stages) {
  assert.equal(stages.aborted, null, "No click was cut short: every click showed its panels");
  assert.equal(stages.rounds.length, WARMUP_ROUNDS + STEADY_ROUNDS, "The probe made every round");
  stages.rounds.forEach((row, index) => {
    assert.equal(row.round, index, `round ${index}: in order`);
    assert.equal(row.steps.length, STEPS.length, `round ${index}: every step was taken`);
    row.steps.forEach((record, step) => assert.deepEqual([record.round, record.step, record.id, record.kind, record.from, record.to, record.intent],
      [index, step, STEPS[step].id, STEPS[step].kind, STEPS[step].from, STEPS[step].to, STEPS[step].intent], `round ${index} step ${step}: the step of the tour`));
  });
}

// The chain of readings in the order they were taken: every one holds the invariants of the host's performance section, was read after a forced
// collection of Hermes' heap and none goes backwards; the host holds one root and no error at any of them.
function verifyReadings(stages) {
  const chain = [["base", stages.base.reading]];
  stages.rounds.forEach(row => {
    chain.push([`round ${row.round} start`, row.start.reading]);
    row.steps.forEach(record => chain.push([`round ${row.round} ${record.id}`, record.rest.reading]));
  });
  chain.push(["final", stages.final]);
  const windowed = new Set([stages.base.reading, stages.final]);
  chain.forEach(([label, reading], index) => {
    verifyReading(reading, label, windowed.has(reading));
    if (index > 0) {
      verifyGrowth(chain[index - 1][1], reading, label);
    }
    assert.equal(reading.host.rootCount, 1, `${label}: one root`);
    assert.equal(reading.host.errors, 0, `${label}: the host reports no error`);
  });
  return chain.length;
}

// The dialog as the HUD showed it when the step arrived: the position and the two choices of the head of the queue the step leads to (the table of the cases, written again
// there), and nothing when the click leads to no dialog.
function verifyDialog(record, label) {
  const head = EVENT_QUEUE.findIndex(event => event.choices[0] === STEPS[record.step].head);
  assert.deepEqual(record.dialog, record.to === "dialog" ? {choices: EVENT_QUEUE[head].choices.map(choice => `hud-dialog-choice-${choice}`).sort(), position: `${head + 1} of ${EVENT_QUEUE.length}`}
    : {choices: [], position: ""}, `${label}: the dialog showed ${record.to === "dialog" ? `the event ${head + 1} of the queue, with its own choices` : "nothing"}`);
}

function verifyClicks(stages) {
  for (const record of recordsOf(stages)) {
    const label = `round ${record.round} ${record.id}`;
    const limit = record.kind === "turn" ? TURN_FRAME_LIMIT : CLICK_FRAME_LIMIT;
    assert.ok(Number.isInteger(record.frames) && record.frames >= 0 && record.frames <= limit,
      `${label}: the HUD showed the panels of ${record.to} within ${limit} frames of the click (${record.frames})`);
    assert.deepEqual(record.shown, CONTEXT_PANELS[record.to], `${label}: the panels shown when it arrived are the ${record.to} context's`);
    assert.equal(record.contextAtArrival, record.to, `${label}: and the game is in the context the click leads to`);
    assert.deepEqual(record.callbacks, {[record.intent]: 1}, `${label}: the click made one call to the game, ${record.intent}`);
    assert.equal(record.worldClicks, record.kind === "map" ? 2 : 0, `${label}: the press and release ${record.kind === "map" ? "reached" : "did not reach"} the World`);
    assert.equal(record.hudCalls, record.kind === "map" ? 0 : 1, `${label}: the HUD made ${record.kind === "map" ? "no call" : "one call"}`);
    assert.equal(record.hudProblems, 0, `${label}: the HUD had no rejected call`);
    verifyDialog(record, label);
    assert.ok(Number.isInteger(record.flushUsec) && record.flushUsec > 0 && Number.isInteger(record.latencyUsec) && record.latencyUsec >= record.flushUsec,
      `${label}: the injection and the time to the panels were timed`);
    assert.ok(record.frameUsec.length >= 1 && record.frameUsec.every(value => Number.isInteger(value) && value > 0), `${label}: and so were the frames in between`);
  }
}

// What the loader's log (images.jobs in the snapshot) can hold: native/image_loader.cpp, `max_records`.
const LOADER_RECORDS_LIMIT = 256;

// A step's timed frames, judged on what the probe read inside them: the reads of the Surface's snapshot are counted in every interval between two stamps (the frames of the
// click, and the frames of a turn again one by one) and none was made, and the full reading taken once the click arrived says what the Controls the frames read said.
function verifyObserved(record, label) {
  assert.ok(Array.isArray(record.frameReads) && record.frameReads.length === record.frameUsec.length && record.frameReads.every(reads => Number.isInteger(reads) && reads >= 0),
    `${label}: the reads of the Surface's snapshot were counted in every timed frame`);
  assert.ok(record.frameReads.every(reads => reads === 0), `${label}: and no timed frame contains one (${record.frameReads.join(", ")})`);
  if (record.kind === "turn") {
    assert.ok(record.turn.frames.every(frame => frame.surfaceReads === 0), `${label}: nor does any frame of the turn (${record.turn.frames.map(frame => frame.surfaceReads).join(", ")})`);
  }
  assert.equal(record.fullAgrees, true, `${label}: and the Controls the frames read and the full reading of the Surface say the same when the click arrives`);
}

// What a read of the snapshot weighs, recorded at every rest of both lanes: its bytes, and the records of the loader's log it carries, which only grow with the Images mounted
// and are never more than the log keeps nor more than the loads asked for.
function verifySnapshotWeight(rest, label) {
  const {bytes, loaderRecords, loaderRequests} = rest.surface;
  assert.ok(Number.isInteger(bytes) && bytes > 0 && Number.isInteger(loaderRecords) && loaderRecords >= 0 && loaderRecords <= Math.min(loaderRequests, LOADER_RECORDS_LIMIT),
    `${label}: the snapshot read at rest weighs ${bytes} bytes and carries ${loaderRecords} records of the loader's log, of ${loaderRequests} loads asked for`);
}

function verifyObservation(stages) {
  const records = recordsOf(stages);
  records.forEach(record => verifyObserved(record, `round ${record.round} ${record.id}`));
  for (const [name, rests] of Object.entries(seriesOf(stages))) {
    rests.forEach((rest, round) => verifySnapshotWeight(rest, `${name}, round ${round}`));
  }
  return {timedFrames: records.reduce((total, record) => total + record.frameReads.length, 0), readsInTimedFrames: 0};
}

// At rest the HUD holds the panels of the context, and the same native views, nodes and orphans every time the context comes back.
function verifyRests(stages) {
  const {base} = stages;
  const constant = base.reading.godot.nodes - base.reading.performance.counters.nativeViews;
  const native = {};
  const godot = {};
  const series = seriesOf(stages);
  for (const [name, rests] of Object.entries(series)) {
    assert.equal(rests.length, WARMUP_ROUNDS + STEADY_ROUNDS, `${name}: a reading at rest in every round`);
    rests.forEach((rest, index) => {
      const label = `${name}, round ${index}`;
      const counters = rest.reading.performance.counters;
      assert.deepEqual(rest.panels, CONTEXT_PANELS[rest.context], `${label}: at rest the Surface holds the panels of the ${rest.context} context`);
      assert.deepEqual(rest.markers, rest.context in MARKERS ? [rest.context] : [], `${label}: and the marker of no other context`);
      assert.equal(rest.surface.state, "mounted", `${label}: the Surface stays mounted`);
      assert.equal(rest.surface.nativeTags, counters.nativeViews, `${label}: the Surface and the host agree on the native views`);
      const windows = MODAL_CONTEXTS[rest.context] ?? 0;
      assert.equal(rest.reading.godot.nodes, counters.nativeViews + constant + windows,
        `${label}: the SceneTree holds the host's native views plus the ${constant} of the base${windows > 0 ? ` and the ${windows} Window of the Modal the ${rest.context} context holds open` : ""}`);
      assert.equal(rest.reading.godot.nodeMonitor, rest.reading.godot.nodes, `${label}: and Godot's node monitor counts the same nodes`);
      assert.equal(rest.reading.godot.orphans, 0, `${label}: Godot counts no orphan node`);
      assert.equal(rest.hud.subscriptions, HUD_CONNECTIONS, `${label}: the HUD holds its ${HUD_CONNECTIONS} connections`);
      assert.equal(rest.hud.problemCount, 0, `${label}: and had no rejected call`);
      (native[rest.context] ??= new Set()).add(rest.surface.nativeTags);
      (godot[rest.context] ??= new Set()).add(rest.reading.godot.nodes);
    });
  }
  for (const context of GAME_CONTEXTS) {
    assert.ok(native[context] !== undefined, `The ${context} context was reached`);
    assert.equal(native[context].size, 1, `The ${context} context holds the same native views every time it comes back (${[...native[context]].join(", ")})`);
    assert.equal(godot[context].size, 1, `and the SceneTree the same nodes (${[...godot[context]].join(", ")})`);
  }
  assert.equal([...native.none][0], base.surface.nativeTags, "The none context at rest is the base's native views");
  return {constant, native: Object.fromEntries(GAME_CONTEXTS.map(context => [context, {nativeViews: [...native[context]][0], sceneTreeNodes: [...godot[context]][0]}]))};
}

// The live heap at rest of every series, by the baseline's rule (the median of the last half of the steady rounds against the first's, after a forced
// collection, against the GF-30 limit).
function verifyHeap(stages) {
  const bySeries = {};
  for (const [name, rests] of Object.entries(seriesOf(stages))) {
    const heap = heapAtRest(rests);
    assert.equal(heap.steadyRounds, STEADY_ROUNDS, `${name}: the steady rounds`);
    bySeries[name] = {...heap, levelBytes: median(steadyOf(rests).map(rest => heapOf(rest.reading)))};
  }
  return bySeries;
}

// The resident memory at rest, by the soak's loose rule (`rssGrowthAtRest` of tests/frontier-soak-oracle.mjs, whose result keeps that oracle's names for its
// fields): it moves by tens of MB and down as well as up, so the median of the last half of the steady readings may be at most RSS_GROWTH_LIMIT_KB above the
// first's. A coarse guard: the heap rule is the leak detector. Judged for every series (the start of a round and each step, one reading a round) and for the run
// as a whole, in the order the readings were taken, which is what a leak that no single series isolates would raise.
function verifyRss(stages) {
  const bySeries = Object.fromEntries(Object.entries(seriesOf(stages)).map(([name, rests]) =>
    [name, rssGrowthAtRest(steadyOf(rests).map(rest => rest.reading.godot.rssKb), {unit: "round", subject: name})]));
  const inOrder = stages.rounds.slice(WARMUP_ROUNDS).flatMap(row => [row.start, ...row.steps.map(record => record.rest)]).map(rest => rest.reading.godot.rssKb);
  return {bySeries, all: rssGrowthAtRest(inOrder, {unit: "reading", subject: "all the readings"})};
}

// The turn: from the acceptance every frame advances exactly one phase to idle and publishes a snapshot; the end of the turn is published once in
// the frame that finishes the last phase; the frames after it are the HUD catching up. The turn records are one for each End turn of every round.
export function verifyTurnRecord(record, label) {
  const turn = record.turn;
  const frames = turn.frames;
  assert.ok(frames.length > 0 && frames.length <= TURN_FRAME_LIMIT, `${label}: the frames of the turn were recorded`);
  const firstBusy = frames.findIndex(frame => frame.phase !== "idle");
  assert.ok(firstBusy >= 0, `${label}: the game accepted the turn and left idle`);
  const before = frames.slice(0, firstBusy);
  const busy = frames.slice(firstBusy, firstBusy + PHASES.length);
  const after = frames.slice(firstBusy + PHASES.length);
  assert.deepEqual(busy.map(frame => frame.phase), PHASES, `${label}: the game advanced one phase in each frame, in the order of the service, and ended at idle`);
  assert.ok(before.every(frame => frame.phase === "idle" && frame.snapshots === 0 && frame.turnEnded === 0 && frame.job === 0), `${label}: nothing moved before the acceptance`);
  assert.deepEqual(busy.map(frame => frame.snapshots), Array(PHASES.length).fill(1), `${label}: a snapshot was published in each frame of the turn`);
  assert.deepEqual(busy.map(frame => frame.turnEnded), [0, 0, 0, 0, 0, 0, 1], `${label}: and the end of the turn once, in the frame that finished the last phase`);
  assert.ok(after.every(frame => frame.phase === "idle" && frame.job === 0 && frame.snapshots === 0 && frame.turnEnded === 0), `${label}: then nothing moved while the HUD caught up`);
  assert.ok(busy.slice(0, 6).every(frame => frame.job === turn.job) && busy[6].job === 0, `${label}: the job is the one accepted until the last frame`);
  assert.deepEqual([turn.snapshots, turn.turnEnded, turn.finishedJob], [PHASES.length, 1, 1], `${label}: seven snapshots, one end of the turn, and the job finished once`);
  assert.equal(turn.ended.job, turn.job, `${label}: the end of the turn names the job`);
  assert.deepEqual(turn.ended.phases.map(phase => phase.name), PHASES.slice(0, 6), `${label}: and lists the six phases it ran`);
  assert.ok(frames.every(frame => Number.isInteger(frame.usec) && frame.usec > 0 && Number.isInteger(frame.nodes) && frame.nodes > 0 && typeof frame.spinner === "boolean"),
    `${label}: every frame was timed and counted`);
  const host = turn.host;
  for (const key of ["commits", "creates", "deletes", "updates", "pumpMs", "jsMs", "mountMs", "layoutMs", "pumpCount", "jsCount", "mountCount", "layoutCount"]) {
    assert.ok(Number.isFinite(host[key]) && host[key] >= 0, `${label}: the host's ${key} over the turn is recorded`);
  }
  assert.ok(host.jsMs + host.mountMs + host.layoutMs <= host.pumpMs * (1 + 1e-12) + RECORDED_EXACTLY, `${label}: the phases fit in the pumps`);
  assert.ok(host.pumpCount >= PHASES.length, `${label}: the application pumped in every frame of the turn`);
  assert.equal(turn.pumpWindowMs.length, Math.min(host.pumpCount, 128), `${label}: the pump samples since the click are those of the host's window`);
  return {busy, after, host};
}

function verifyTurns(stages) {
  const turns = recordsOf(stages).filter(record => record.kind === "turn");
  assert.equal(turns.length, (WARMUP_ROUNDS + STEADY_ROUNDS) * TURNS_PER_ROUND, "End turn was pressed four times in every round");
  assert.ok(turns.every(record => record.turn !== null), "and every press has its turn recorded");
  const first = turns[0].turn.job;
  turns.forEach((record, index) => {
    verifyTurnRecord(record, `round ${record.round} ${record.id}`);
    assert.equal(record.turn.job, first + index, `round ${record.round} ${record.id}: the ids of the jobs rise by one`);
  });
  assert.equal(stages.published.turnEnded, turns.length, "The node published the end of the turn once for every turn pressed");
  assert.equal(stages.published.callbacks.end_turn, turns.length, "and was asked for it once for every press");
  assert.equal(stages.published.callbacks.new_game, WARMUP_ROUNDS + STEADY_ROUNDS, "A new game started every round");
  const rounds = WARMUP_ROUNDS + STEADY_ROUNDS;
  for (const intent of unique(STEPS.map(step => step.intent))) {
    assert.equal(stages.published.callbacks[intent], rounds * STEPS.filter(step => step.intent === intent).length, `The game was asked for ${intent} once for every click of that intent, in every round`);
  }
  return turns;
}

function verifyErrors(stages) {
  const {faults, control} = stages;
  assert.equal(faults.global, 0, "No error went unhandled in JavaScript");
  assert.equal(faults.rejections, 0, `and no promise rejection (${faults.last})`);
  assert.equal(faults.handlers.rejectionTracker, true, "and a tracker was watching");
  assert.equal(control.rejections, 1, "The tracker sees one unhandled rejection when there is one (the control after the run)");
  assert.equal(stages.final.host.errors, 0, "The host reports no error at the end");
  assert.equal(stages.hudFinal.problemCount, 0, "and the HUD no rejected call");
  assert.equal(stages.hudFinal.subscriptions, HUD_CONNECTIONS, "and still holds its connections");
}

// ------------------------------------------------------------------------------------------------------ the judgement
const RULES = [["config", verifyConfig, report => report], ["scene", verifyScene, report => report.stages], ["shape", verifyShape, report => report.stages],
  ["readings", verifyReadings, report => report.stages], ["clicks", verifyClicks, report => report.stages], ["rests", verifyRests, report => report.stages],
  ["observation", verifyObservation, report => report.stages], ["heap", verifyHeap, report => report.stages], ["rss", verifyRss, report => report.stages],
  ["turns", verifyTurns, report => report.stages], ["errors", verifyErrors, report => report.stages]];

// Every rule is judged, whatever the others say, so that a report broken for one reason is shown to fail for that one: the failures are the rules
// that did not hold and what they said. The results of the rules that did hold are kept for the summary.
export function judgeFrontierTurnReport(report) {
  const failures = [];
  const results = {};
  for (const [rule, verify, subject] of RULES) {
    try {
      results[rule] = verify(subject(report));
    } catch (error) {
      failures.push({rule, message: String(error.message).split("\n")[0]});
    }
  }
  return {failures, results};
}

// ------------------------------------------------------------------------------------------------------ the summary
const byKey = (list, key) => list.reduce((groups, item) => ((groups[key(item)] ??= []).push(item), groups), {});

// What was recorded, by step and by context, over the steady rounds: the frames and the time from the click to the panels, the turn frame by frame
// (the phase, the interval, the nodes), the host's phases around the turn, and the native views, heap and resident memory at rest.
function summarize(report, results) {
  const {stages} = report;
  const steady = recordsOf(stages).filter(record => record.round >= WARMUP_ROUNDS);
  const clickStats = group => ({frames: stats(group.map(record => record.frames)), latencyMs: stats(group.map(record => ms(record.latencyUsec))),
    injectionMs: stats(group.map(record => ms(record.flushUsec)))});
  const byStep = Object.fromEntries(Object.entries(byKey(steady, record => record.id)).map(([id, group]) => [id,
    {kind: group[0].kind, from: group[0].from, to: group[0].to, intent: group[0].intent, ...clickStats(group)}]));
  const clicks = steady.filter(record => record.kind !== "turn");
  const byContext = Object.fromEntries(GAME_CONTEXTS.map(context => [context, clicks.filter(record => record.to === context)]).filter(([, group]) => group.length > 0)
    .map(([context, group]) => [context, {steps: unique(group.map(record => record.id)), samples: group.length, ...clickStats(group)}]));
  const turns = steady.filter(record => record.kind === "turn");
  const checked = turns.map(record => verifyTurnRecord(record, "summary"));
  const phaseStats = PHASES.map((phase, index) => {
    const frames = checked.map(({busy}) => busy[index]);
    return {phase, intervalMs: stats(frames.map(frame => ms(frame.usec))), nodes: stats(frames.map(frame => frame.nodes)), spinnerShown: frames.filter(frame => frame.spinner).length};
  });
  const hostOf = key => stats(checked.map(({host}) => round(host[key], 3)));
  return {
    provenance: {godot: stages.provenance.godot, hermes: stages.provenance.hermes, architecture: stages.provenance.architecture, os: stages.provenance.os,
      displayServer: stages.provenance.displayServer, renderingDriver: stages.provenance.renderingDriver, processor: stages.provenance.processor},
    rounds: {warmup: WARMUP_ROUNDS, steady: STEADY_ROUNDS, clicks: recordsOf(stages).length, steadyClicks: steady.length, readings: results.readings},
    clickToPanel: {byStep, byContext, ceilings: {click: CLICK_FRAME_LIMIT, turn: TURN_FRAME_LIMIT},
      framesObserved: unique(clicks.map(record => record.frames)).sort((a, b) => a - b)},
    turn: {steadyTurns: turns.length, framesPerTurn: unique(checked.map(({busy, after}) => busy.length + after.length)).sort((a, b) => a - b),
      byPhase: phaseStats, settleFrame: stats(checked.filter(({after}) => after.length > 0).map(({after}) => ms(after[0].usec))),
      busyMs: stats(checked.map(({busy}) => round(busy.reduce((total, frame) => total + frame.usec, 0) / 1000, 3))),
      host: {pumpMs: hostOf("pumpMs"), jsMs: hostOf("jsMs"), mountMs: hostOf("mountMs"), layoutMs: hostOf("layoutMs"), pumpCount: hostOf("pumpCount")},
      pumpSampleMs: stats(turns.flatMap(record => record.turn.pumpWindowMs.map(value => round(value, 3)))),
      clickToPanelsMs: Object.fromEntries(turns.length === 0 ? [] : Object.entries(byKey(turns, record => record.id)).map(([id, group]) => [id, clickStats(group).latencyMs]))},
    nativeNodes: results.rests, heap: results.heap,
    observation: {...results.observation, snapshotBytesAtRoundStart: stats(stages.rounds.map(row => row.start.surface.bytes)),
      loaderRecordsAtRoundStart: stats(stages.rounds.map(row => row.start.surface.loaderRecords)), loadsAsked: stages.rounds.at(-1).start.surface.loaderRequests},
    rss: {bySeries: results.rss.bySeries, run: results.rss.all},
    memory: {staticBytesAtBase: stages.base.reading.godot.staticMemory, staticBytesAtEnd: stages.final.godot.staticMemory},
    errors: {faults: stages.faults, control: stages.control, hud: stages.hudFinal}};
}

export function verifyFrontierTurnReport(report) {
  const {failures, results} = judgeFrontierTurnReport(report);
  if (failures.length > 0) {
    throw new assert.AssertionError({message: failures.map(failure => `${failure.rule}: ${failure.message}`).join("\n")});
  }
  return summarize(report, results);
}

// ------------------------------------------------------------------------------------------------------ the windowed lane
// One run of the windowed lane (tests/frontier-turn-probe.gd --lane=windowed): the same tour in a real window, exact where the headless lane is exact,
// with the intervals between process frames of an idle window, of the frames that took a click and of every frame of the turn, and the vsync mode and
// refresh rate it read back. What is judged is the structure; the validity of the run as a presented one is the baseline's (graphicsRunValidity).
export function verifyTurnGraphicsRun(report) {
  const {stages} = report;
  assert.equal(report.scenario, "frontier-turn-graphics");
  assert.equal(report.lane, "windowed");
  assert.deepEqual(stages.config.steps, STEPS, "The run took the steps of the cases");
  assert.deepEqual([stages.config.warmupRounds, stages.config.rounds, stages.config.idleFrames, stages.config.clickFrameLimit, stages.config.turnFrameLimit],
    [WARMUP_ROUNDS, STEADY_ROUNDS, IDLE_FRAMES, CLICK_FRAME_LIMIT, TURN_FRAME_LIMIT], "with these rounds and frames");
  verifyProvenance(stages.provenance);
  assert.notEqual(stages.provenance.displayServer, "headless", "The run drew in a window");
  assert.equal(stages.aborted, null, "No click was cut short");
  assert.equal(stages.rounds.length, WARMUP_ROUNDS + STEADY_ROUNDS, "The run made every round");
  assert.equal(stages.scene.mounted, true);
  for (const row of stages.rounds) {
    assert.equal(row.steps.length, STEPS.length, `round ${row.round}: every step`);
    verifySnapshotWeight(row.start, `run ${report.run} round ${row.round} start`);
    row.steps.forEach((record, index) => {
      const label = `run ${report.run} round ${row.round} ${record.id}`;
      assert.deepEqual([record.id, record.kind, record.from, record.to, record.intent], [STEPS[index].id, STEPS[index].kind, STEPS[index].from, STEPS[index].to, STEPS[index].intent],
        `${label}: the step of the tour`);
      const limit = record.kind === "turn" ? TURN_FRAME_LIMIT : CLICK_FRAME_LIMIT;
      assert.ok(Number.isInteger(record.frames) && record.frames >= 0 && record.frames <= limit, `${label}: the panels showed within the ceiling`);
      assert.equal(record.contextAtArrival, record.to, `${label}: in the context the click leads to`);
      assert.deepEqual(record.rest.panels, CONTEXT_PANELS[record.to], `${label}: with the panels of the context`);
      assert.deepEqual(record.callbacks, {[record.intent]: 1}, `${label}: one call to the game`);
      verifyDialog(record, label);
      assert.ok(record.frameUsec.length >= 1 && record.frameUsec.every(value => Number.isInteger(value) && value > 0), `${label}: the frames were timed`);
      assert.ok(Number.isInteger(record.flushUsec) && record.flushUsec > 0, `${label}: and so was the injection`);
      assert.ok(record.drawUsec === null || (Number.isInteger(record.drawUsec) && record.drawUsec > 0), `${label}: the time to the first drawn frame, when one was seen`);
      verifyObserved(record, label);
      verifySnapshotWeight(record.rest, label);
      if (record.kind === "turn") {
        verifyTurnRecord(record, label);
      }
    });
  }
  assert.equal(stages.idle.intervalsUsec.length, IDLE_FRAMES, "The idle window has its frames");
  assert.ok(stages.idle.intervalsUsec.every(value => Number.isInteger(value) && value > 0), "and each was timed");
  assert.ok(report.checks.length > 0 && report.checks.every(check => check.passed), "Every check of the run passed");
  assert.equal(new Set(report.checks.map(check => check.name)).size, report.checks.length);
  // The window's presence (tests/window-presence.gd) is newer than the receipts: a run recorded before it has none. Its structure is the baseline's; whether the
  // engine could draw the window does not decide the run's validity.
  if (stages.presence !== undefined) {
    verifyPresence(stages.presence, `run ${report.run}`);
  }
}

// The run in the shape the baseline's validity and statistics read (scripts/frontier-baseline-graphics.mjs): the clicks as `swaps`, the transitions of the
// tour; the native views of each context stand where the baseline has the nodes a swap creates. The End turn clicks stay out of the statistics of a click
// to its panels (their time is the turn's), and in the validity (a frame has to be drawn after every click).
export function graphicsRunOf(report, {withTurns = true} = {}) {
  const {stages} = report;
  const records = recordsOf(stages).filter(record => withTurns || record.kind !== "turn");
  const nativeNodes = {};
  for (const record of recordsOf(stages).filter(entry => entry.round >= WARMUP_ROUNDS)) {
    nativeNodes[record.to] = record.rest.surface.nativeTags;
  }
  return {scenario: report.scenario, run: report.run, godot: report.godot, provenance: stages.provenance, viewport: stages.scene.viewport,
    config: {...stages.config, nativeNodes}, swaps: records, idle: stages.idle, frames: stages.frames, aborted: stages.aborted, checks: report.checks,
    ...(stages.presence === undefined ? {} : {presence: stages.presence})};
}

// The run whose build, window and viewport the receipt of the windowed lane carries as its own: the first accepted run; when no run was accepted, the last
// attempt that was rejected (a windowed run that read its window back, so the receipt still says what display it met); and only when no windowed attempt was
// made at all, the run of the captures, which is not a measurement and is no part of what the receipt claims.
export function graphicsReceiptSource({accepted, attempts, captures}) {
  return accepted[0] ?? attempts.findLast(attempt => attempt.raw !== undefined)?.raw ?? captures;
}

// Quartiles by nearest rank, the baseline's: with five runs the median is the third value and the range between the second and the fourth.
const quartiles = values => ({median: nearestRank(values, 50), q1: nearestRank(values, 25), q3: nearestRank(values, 75),
  iqr: nearestRank(values, 75) - nearestRank(values, 25), min: Math.min(...values), max: Math.max(...values)});

// The frames of the turn in the windowed lane, per phase: each run's p50, p95 and maximum over its steady turns, and the median and range of those across the
// runs. The phase of a frame is the game's at the start of the frame after it, so the first row is the frame that accepts the turn.
export function summarizeTurnFrames(runs) {
  const perRun = runs.map(run => {
    const turns = recordsOf(run.stages).filter(record => record.kind === "turn" && record.round >= WARMUP_ROUNDS);
    const busy = turns.map(record => verifyTurnRecord(record, `run ${run.run}`).busy);
    return {run: run.run, turns: turns.length, byPhase: PHASES.map((phase, index) => ({phase, intervalMs: stats(busy.map(frames => ms(frames[index].usec)))})),
      busyMs: stats(busy.map(frames => round(frames.reduce((total, frame) => total + frame.usec, 0) / 1000, 3)))};
  });
  const across = pick => quartiles(perRun.map(pick));
  return {runs: perRun, across: {byPhase: PHASES.map((phase, index) => ({phase, p50: across(row => row.byPhase[index].intervalMs.p50),
    p95: across(row => row.byPhase[index].intervalMs.p95), max: across(row => row.byPhase[index].intervalMs.max)})),
  busyMs: {p50: across(row => row.busyMs.p50), p95: across(row => row.busyMs.p95), max: across(row => row.busyMs.max)}}};
}
