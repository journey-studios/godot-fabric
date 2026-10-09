import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {HEAP_STEADY_GROWTH_LIMIT_BYTES} from "./performance-cases.mjs";
import {growthOfHalves, nearestRank, round, verifyGrowth, verifyReading} from "./performance-oracle.mjs";
import {REST_FRAMES, STABLE_FRAMES, WARMUP_ROUNDS} from "./frontier-baseline-cases.mjs";
import {heapAtRest} from "./frontier-baseline-oracle.mjs";
import {CLAIM_POINT, CONTEXTS, EXECUTIONS, GARRISON_CAP, PANEL_SHAPE, PANEL_TOGGLE, PAUSE_FRAMES, PAUSE_TOGGLE, PAUSE_TURN, RSS_GROWTH_LIMIT_KB,
  START_TILE, STRATEGIES, TURNS, VIEWPORT, WARMUP_TURNS} from "./frontier-soak-cases.mjs";

// Independent oracle for the 100-turn soak (V05-06, criterion `soak`), written from the contract of the experiment and from what the game and
// the engine themselves count, not from the probe: it takes the raw report of one execution and recomputes what must hold, and takes the
// reports of the executions together and requires that the game is the same in all of them.
//
// The contract. A scripted player plays TURNS complete turns through the services, one intent at a time, every one of them accepted, and ends
// each turn with an accepted job that publishes seven snapshots in seven frames and one turn_ended. The game's state is the same in every
// execution, byte for byte: the hash of every turn's canonical serialization, and the last, are identical. The HUD is a function of the
// snapshot and of two switches (the panel, the marker): its native views at rest follow from the context's actions, the dialog, the marker
// and the strategy that closes the heavy panel. The SceneTree holds the host's native views plus a constant, with no orphan. The registry
// holds the same subscriptions at every reading. No error is unhandled. The live heap at rest does not grow past the GF-30 limit from the
// first half of the steady turns to the last, by the baseline's rule over the medians; the resident memory, which moves by tens of MB, is
// judged loosely by the same halves. The pause holds the job at its phase while the HUD answers. A closed panel does not claim the map.
//
// Nothing here judges a duration: the clicks' times and the turns' times are recorded and summarized (docs/research/frontier-soak.md).
const sha256 = text => createHash("sha256").update(text).digest("hex");
const median = values => nearestRank(values, 50);
const PHASES = ["ai_plan", "ai_move", "production", "growth", "research", "refresh"];
// What the game node registers: two states (`frontier.snapshot` and `frontier.hover`), the signal `frontier.turn_ended` and the twelve methods (one for each
// intent, `new_game` and `open_menu`). It was 14 before the pointer's state `frontier.hover` (P8 V05-05 slice 1, #82); the soak asserts the count the node
// registers, it does not depend on what the services are.
const BINDINGS = 15;

// The nodes of the heavy panel from its shape: a root, a header and two nodes a chip (the View and its Text).
const PANEL_NODES = 2 + 2 * PANEL_SHAPE.chips;
// The HUD's nodes that do not depend on the snapshot: the Surface's root and the HUD's root, the top bar and its four texts, the controls and
// their two buttons (a Pressable and a Text each), the region the panel stands in, and the container of the actions.
const HUD_FIXED = 1 + 1 + (1 + 4) + (1 + 2 * 2) + 1 + 1;
// The event's dialog: a View, a title and a text, and a Pressable with a Text for each choice. The marker is one View.
const dialogNodes = choices => 3 + 2 * choices;

// The native views the HUD holds in a state: an action is a Pressable and a Text; the panel is mounted while it is open, or always when the
// strategy keeps it mounted.
function hudNodes({actions, dialog, choices, pulse, panelOpen}, strategy) {
  return HUD_FIXED + 2 * actions + (dialog === 1 ? dialogNodes(choices) : 0) + (pulse ? 1 : 0) + (strategy === "hide" || panelOpen ? PANEL_NODES : 0);
}

const trailHash = hashes => sha256(hashes.map(hash => `${hash}\n`).join(""));
const heapOf = reading => reading.performance.hermes.heap.hermes_allocatedBytes;
const viewsOf = reading => reading.performance.counters.nativeViews;

// The resident memory at rest, judged by the medians of the two halves of the steady turns as the heap is. It moves by tens of MB within a run
// (GF-30 saw 90 to 188 MB) and down as well as up, so the rule is loose: the last half may be at most RSS_GROWTH_LIMIT_KB above the first.
// The rule over the readings in KB (the steady ones, in order), by what the medians of the halves are of: `unit` names a reading in the failure ("turn" here, "round" in the
// harnesses that read once a round) and `subject` says whose they are, when there are many. The turn's lane (tests/frontier-turn-oracle.mjs) judges its series by this one.
export function rssGrowthAtRest(steady, {unit = "turn", subject = ""} = {}) {
  const prefix = subject === "" ? "" : `${subject}: `;
  const {half, firstMedian, lastMedian, growth} = growthOfHalves(steady, RSS_GROWTH_LIMIT_KB, {fill: `${prefix}The resident memory is read at every steady ${unit}`,
    read: `${prefix}The resident memory is read at every steady ${unit}`,
    exceeded: ({half: readings, growth: rose}) => `${prefix}The resident memory rose ${rose} KB from the median of the first half (${readings} ${unit}s) of the steady ${unit}s to the median of the last, over the limit of ${RSS_GROWTH_LIMIT_KB}`});
  return {steadyTurns: steady.length, halfTurns: half, firstMedianKb: firstMedian, lastMedianKb: lastMedian, growthKb: growth, limitKb: RSS_GROWTH_LIMIT_KB,
    minKb: Math.min(...steady), maxKb: Math.max(...steady), bandKb: Math.max(...steady) - Math.min(...steady), medianKb: median(steady)};
}

function rssAtRest(rests) {
  return rssGrowthAtRest(rests.slice(WARMUP_TURNS).map(entry => entry.reading.godot.rssKb));
}

function verifyProvenance(provenance) {
  assert.match(provenance.godot, /^4\.\d+\.\d+-stable/, "The report names the Godot version");
  assert.match(provenance.hermes, /^\d+\.\d+\.\d+$/, "and the Hermes version");
  for (const key of ["architecture", "os", "displayServer", "renderingDriver", "renderingMethod", "processor"]) {
    assert.ok(typeof provenance[key] === "string" && provenance[key].length > 0, `and the ${key}`);
  }
}

function verifyConfig(report) {
  const {config} = report.stages;
  assert.deepEqual([config.turns, config.warmupTurns, config.pauseTurn, config.pauseFrames, config.restFrames, config.stableFrames],
    [TURNS, WARMUP_TURNS, PAUSE_TURN, PAUSE_FRAMES, REST_FRAMES, STABLE_FRAMES], "The probe ran the turns, the warm-up, the pause and the frames of the cases");
  assert.equal(WARMUP_TURNS, WARMUP_ROUNDS, "The warm-up is the baseline's: its heap rule drops that many readings from the front of the list it is given");
  assert.deepEqual([config.heapGrowthLimitBytes, config.rssGrowthLimitKb], [HEAP_STEADY_GROWTH_LIMIT_BYTES, RSS_GROWTH_LIMIT_KB], "with the GF-30 heap limit and the soak's resident-memory rule");
  assert.deepEqual(config.viewport, VIEWPORT);
  assert.deepEqual([config.panelToggle.left, config.panelToggle.top, config.panelToggle.width, config.panelToggle.height],
    [PANEL_TOGGLE.left, PANEL_TOGGLE.top, PANEL_TOGGLE.width, PANEL_TOGGLE.height], "and the buttons of the cases");
  assert.deepEqual([config.pauseToggle.left, config.pauseToggle.top, config.pauseToggle.width, config.pauseToggle.height],
    [PAUSE_TOGGLE.left, PAUSE_TOGGLE.top, PAUSE_TOGGLE.width, PAUSE_TOGGLE.height]);
  assert.deepEqual(config.claimPoint, [CLAIM_POINT.x, CLAIM_POINT.y]);
  assert.ok(STRATEGIES.includes(config.strategy), "The strategy is one of the two");
  assert.equal(report.strategy, config.strategy);
  assert.equal(PANEL_NODES, 100, "The heavy panel is the 100 native nodes of the baseline's research panel");
  assert.ok(PAUSE_TURN > WARMUP_TURNS && PAUSE_TURN < TURNS, "The pause is in the middle of the soak, after the warm-up");
}

// ------------------------------------------------------------------------------------------------ the player
// What the player does in a turn, in the order it does it (the rule of tests/frontier-soak-fixture.jsx, written again here from the contract):
// the event if one blocks the game, the research and the production if they are empty, the city, the first unfortified unit and its fortifying,
// an empty tile, clearing the selection and the end of the turn. The first turn also founds the city on the start tile.
const ROUTINE = ["resolve_event", "set_research", "set_production", "city", "select_unit", "fortify", "tile", "clear_selection", "end_turn"];
const CITY = START_TILE;
const NEIGHBOR = {x: START_TILE.x - 1, y: START_TILE.y};

function stepOf(decision) {
  if (decision.id === "select_tile") {
    if (decision.args[0] === CITY.x && decision.args[1] === CITY.y) {
      return "city";
    }
    if (decision.args[0] === NEIGHBOR.x && decision.args[1] === NEIGHBOR.y) {
      return "tile";
    }
    return null;
  }
  return decision.id;
}

function verifyDecisions(row, index) {
  const label = `turn ${index + 1}`;
  assert.ok(row.decisions.length >= 1 && row.decisions.length <= 12, `${label}: the player made a handful of decisions`);
  row.decisions.forEach(decision => {
    assert.equal(decision.state, "done", `${label}: every call settled`);
    assert.equal(decision.ok, 1, `${label}: the game accepted ${decision.id}(${decision.args}) (${decision.code})`);
    assert.equal(decision.code, "ok");
    assert.equal(decision.turn, index + 1, `${label}: decided in its own turn`);
  });
  assert.equal(row.decisions.at(-1).id, "end_turn", `${label}: the player ends the turn`);
  assert.equal(row.decisions.filter(decision => decision.id === "end_turn").length, 1, `${label}: once`);
  assert.equal(row.decisions.at(-1).job, index + 1, `${label}: the end of the turn is accepted as job ${index + 1}, the ids rise by one`);
  assert.equal(row.decisions.slice(0, -1).every(decision => decision.job === 0), true, `${label}: and no other call starts a job`);
  let preamble = 0;
  if (index === 0) {
    // The first turn founds the city: select the start tile (a stack of two units), select the Settler, found the city.
    assert.deepEqual(row.decisions.slice(0, 3).map(decision => [decision.id, decision.args, decision.context]),
      [["select_tile", [START_TILE.x, START_TILE.y], "none"], ["select_unit", [1], "stack"], ["found_city", [1], "settler"]],
      `${label}: the Settler founds the city on the start tile`);
    preamble = 3;
  }
  let last = -1;
  row.decisions.slice(preamble).forEach(decision => {
    const step = stepOf(decision);
    const rank = ROUTINE.indexOf(step);
    assert.ok(rank > last, `${label}: ${decision.id}(${decision.args}) is a step of the routine, once and in its order`);
    last = rank;
  });
  const first = row.decisions[preamble];
  if (index === 4) {
    assert.deepEqual([first.id, first.context], ["resolve_event", "dialog"], `${label}: the event that blocks the game is the first thing resolved`);
  } else {
    assert.ok(row.decisions.every(decision => decision.id !== "resolve_event"), `${label}: no event is waiting`);
  }
  if (index === 0) {
    assert.deepEqual(row.decisions.slice(3).map(decision => decision.id), ["set_research", "set_production", "select_tile", "select_unit", "fortify", "select_tile", "clear_selection", "end_turn"],
      `${label}: and sets the research and the production, selects the city and fortifies the Warrior`);
  }
}

// ----------------------------------------------------------------------------------------------- the jobs
function verifyJob(row, index) {
  const label = `turn ${index + 1}`;
  const job = index + 1;
  assert.equal(row.job.id, job, `${label}: job ${job}`);
  const {rows} = row.job;
  assert.equal(rows.length, 8, `${label}: seven snapshots and one turn_ended`);
  const snapshots = rows.filter(entry => entry.kind === "snapshot");
  const ended = rows.filter(entry => entry.kind === "turn_ended");
  assert.equal(snapshots.length, 7, `${label}: seven snapshots`);
  assert.equal(ended.length, 1, `${label}: one turn_ended`);
  assert.equal(rows[6].kind, "turn_ended", `${label}: turn_ended comes after the snapshot of the last phase`);
  assert.equal(rows[7].kind, "snapshot", `${label}: and before the snapshot of the turn that begins`);
  assert.deepEqual(snapshots.map(entry => entry.phase), [...PHASES, "idle"], `${label}: the job goes through the six phases and arrives at rest`);
  assert.deepEqual(snapshots.map(entry => [entry.turn, entry.last_job]),
    [...PHASES.map(() => [index + 1, job - 1]), [index + 2, job]], `${label}: the snapshots show the old turn and last_job until the job finishes`);
  assert.deepEqual([ended[0].turn, ended[0].job], [index + 2, job], `${label}: turn_ended carries the turn that begins and the job`);
  const frames = snapshots.map(entry => entry.frame);
  const from = index + 1 === PAUSE_TURN ? 2 : 1;
  for (let position = from; position < frames.length; ++position) {
    assert.equal(frames[position], frames[position - 1] + 1, `${label}: one phase a frame`);
  }
  if (index + 1 === PAUSE_TURN) {
    assert.ok(frames[1] - frames[0] >= PAUSE_FRAMES, `${label}: the paused job waited at least ${PAUSE_FRAMES} frames for its first phase`);
  }
  assert.equal(ended[0].frame, frames[6], `${label}: turn_ended is emitted in the frame of the last snapshot`);
}

// ----------------------------------------------------------------------------------------------- the nodes
// Every light reading (after each intent that changes what is selected, and with the panel open and closed) and every reading at rest.
function lightReadings(stages) {
  const readings = [{...stages.base.light, label: "base"}];
  stages.turns.forEach((row, index) => {
    row.contexts.forEach(reading => readings.push({...reading, label: `turn ${index + 1} ${reading.label}`}));
    readings.push({...row.panel.open.reading, label: `turn ${index + 1} panel open`}, {...row.panel.closed.reading, label: `turn ${index + 1} panel closed`});
  });
  readings.push({...stages.finalLight, label: "final"});
  return readings;
}

function verifyNodes(stages, strategy) {
  const base = stages.base.light;
  const offset = base.nodes - base.native;
  const monitorOffset = base.nodeMonitor - base.native;
  const contexts = {};
  for (const reading of lightReadings(stages)) {
    assert.equal(reading.native, hudNodes(reading, strategy), `${reading.label}: the HUD holds the native views its state gives (context ${reading.context}, ${reading.actions} actions, panel ${reading.panelOpen ? "open" : "closed"})`);
    assert.equal(reading.nodes - reading.native, offset, `${reading.label}: the SceneTree holds the host's native views plus a constant`);
    assert.equal(reading.nodeMonitor - reading.native, monitorOffset, `${reading.label}: and so does Godot's node monitor`);
    assert.equal(reading.orphans, base.orphans, `${reading.label}: and Godot counts no orphan beyond the base's`);
    assert.equal(reading.rootCount, 1, `${reading.label}: in one root`);
    assert.deepEqual([reading.mounts, reading.unmounts], [1, 0], `${reading.label}: the HUD mounted once and was never unmounted`);
    assert.equal(reading.errors, 0, `${reading.label}: the application saw no error`);
    assert.equal(reading.strategy, strategy, `${reading.label}: the HUD ran the strategy of the execution`);
    const key = `${reading.context}`;
    contexts[key] ??= new Set();
    contexts[key].add(reading.native);
  }
  stages.turns.forEach((row, index) => {
    const rest = row.rest;
    const label = `rest of turn ${index + 1}`;
    const state = {actions: rest.latest.actions, dialog: rest.latest.dialog, choices: rest.latest.choices, pulse: rest.ui.pulse, panelOpen: rest.ui.panelOpen};
    assert.equal(viewsOf(rest.reading), hudNodes(state, strategy), `${label}: the HUD at rest holds the native views its context gives (${rest.latest.context})`);
    assert.equal(rest.reading.godot.nodes - viewsOf(rest.reading), offset, `${label}: the SceneTree holds the host's native views plus the constant`);
    assert.equal(rest.reading.godot.nodeMonitor - viewsOf(rest.reading), monitorOffset, `${label}: and so does Godot's node monitor`);
    assert.equal(rest.reading.godot.orphans, base.orphans, `${label}: with no orphan beyond the base's`);
    assert.equal(rest.reading.host.rootCount, 1, `${label}: in one root`);
    assert.equal(rest.reading.host.errors, 0, `${label}: and no error`);
    assert.equal(rest.ui.panelOpen, false, `${label}: the panel is closed at rest`);
    assert.equal(rest.ui.pulse, false, `${label}: and so is the marker`);
    const key = `${rest.latest.context}`;
    contexts[key] ??= new Set();
    contexts[key].add(viewsOf(rest.reading));
  });
  // Every context comes back with the same native views when the HUD is in the same state: one count for each state of (context, actions,
  // dialog, panel). The cases above already require it of each reading; this is the table of it.
  assert.deepEqual(Object.keys(contexts).sort(), [...CONTEXTS].sort(), "The player visited the seven contexts of the game");
  return Object.fromEntries(Object.entries(contexts).map(([context, views]) => [context, [...views].sort((a, b) => a - b)]));
}

// ------------------------------------------------------------------------------------------------- memory
function verifyMemory(stages) {
  const chain = [["base", stages.base.reading], ...stages.turns.map((row, index) => [`rest ${index + 1}`, row.rest.reading]), ["final", stages.final]];
  const windowed = new Set([stages.base.reading, stages.final]);
  chain.forEach(([label, reading], index) => {
    verifyReading(reading, label, windowed.has(reading));
    if (index > 0) {
      verifyGrowth(chain[index - 1][1], reading, label);
    }
  });
  const rests = stages.turns.map(row => ({reading: row.rest.reading}));
  const heap = heapAtRest(rests);
  const rss = rssAtRest(rests);
  const heaps = rests.map(entry => heapOf(entry.reading));
  return {heap: {...heap, medianBytes: median(heaps.slice(WARMUP_TURNS))}, rss};
}

// ------------------------------------------------------------------------------------------------- errors
function verifyErrors(stages) {
  const {faults, control} = stages;
  assert.equal(faults.global, 0, "No error went unhandled in JavaScript");
  assert.equal(faults.rejections, 0, "and no promise was rejected with no handler");
  assert.equal(faults.handlers.rejectionTracker, true, "with Hermes' tracker watching (the runtime has no ErrorUtils: the host's own error list is the other watch)");
  assert.equal(control.rejections, 1, "The tracker sees an unhandled rejection when there is one (the control after the soak): zero is not blindness");
  const base = stages.base.registry;
  assert.deepEqual([base.bindings, base.errors], [BINDINGS, 0], `The registry holds the ${BINDINGS} bindings of the game and no error`);
  assert.ok(base.subscriptions >= 2, "with the application's two connections");
  const registries = [stages.base.light.registry, ...lightReadings(stages).map(reading => reading.registry), ...stages.turns.map(row => row.rest.registry)];
  registries.forEach(registry => {
    assert.equal(registry.subscriptions, base.subscriptions, "The registry holds the same subscriptions at every reading: a connection never removed would grow them");
    assert.equal(registry.bindings, BINDINGS);
    assert.equal(registry.errors, 0, "and no error");
  });
  assert.equal(stages.finalLight.errors, 0);
  return {subscriptions: base.subscriptions, handlers: faults.handlers};
}

// -------------------------------------------------------------------------------------------------- hashes
function verifyGame(stages) {
  const hashes = stages.turns.map(row => row.hash);
  stages.turns.forEach((row, index) => {
    assert.equal(sha256(row.serialization), row.hash, `turn ${index + 1}: the hash is the SHA-256 of the canonical serialization`);
    const state = JSON.parse(row.serialization);
    assert.equal(state.turn, index + 2, `turn ${index + 1}: the game is at turn ${index + 2} after it`);
    assert.equal(state.phase, "idle", `turn ${index + 1}: and at rest`);
    assert.equal(state.cities.length, 1, `turn ${index + 1}: with the one city the scenario allows`);
    assert.deepEqual([state.cities[0].x, state.cities[0].y], [START_TILE.x, START_TILE.y], `turn ${index + 1}: on the start tile`);
    assert.ok(state.units.filter(unit => unit.owner === 1).length <= GARRISON_CAP, `turn ${index + 1}: the player keeps at most ${GARRISON_CAP} units, so the state is bounded`);
    assert.ok(state.log.length <= 32, `turn ${index + 1}: and the log is capped`);
    assert.equal(state.event.resolved, index + 1 >= 5 ? 1 : 0, `turn ${index + 1}: the event is resolved from turn 5 on`);
  });
  assert.equal(new Set(hashes).size, TURNS, "No two turns left the game in the same state");
  assert.equal(stages.game.hash, hashes.at(-1), "The final hash is the last turn's");
  assert.equal(sha256(stages.game.serialization), stages.game.hash, "and the SHA-256 of the final serialization");
  assert.deepEqual([stages.game.turn, stages.game.lastJob, stages.game.nextJob, stages.game.epoch], [TURNS + 1, TURNS, TURNS + 1, 1],
    "The game ends at the next turn with every job finished and the first session");
  assert.deepEqual([stages.calls.turnEnded, stages.calls.decisions], [TURNS, stages.turns.reduce((total, row) => total + row.decisions.length, 0)],
    "JavaScript received one turn_ended for each job and made every decision the turns recorded");
  const finishedJobs = stages.game.finishedJobs;
  assert.equal(finishedJobs, TURNS, "The node finished one job for each turn");
  return {hashes, finalHash: stages.game.hash, trailHash: trailHash(hashes)};
}

// ---------------------------------------------------------------------------------------------- the pause
function verifyPause(stages) {
  const row = stages.turns[PAUSE_TURN - 1];
  const warm = stages.turns[WARMUP_TURNS - 1].warm;
  assert.deepEqual([warm.markerShown, warm.markerGone, warm.clicks], [true, true, 2], "The marker's code was warmed up in a warm-up turn, so the steady heap does not see a first use");
  const pause = row.pause;
  assert.deepEqual([pause.job, pause.before.job, pause.before.phase, pause.before.turn], [PAUSE_TURN, PAUSE_TURN, "ai_plan", PAUSE_TURN],
    "The end of the turn was accepted as a job and the game paused with it at its first phase");
  assert.equal(pause.during.paused, true, "The tree was paused");
  assert.ok(pause.during.frames >= PAUSE_FRAMES && pause.pauseFrames === PAUSE_FRAMES, `for ${PAUSE_FRAMES} frames`);
  assert.deepEqual([pause.during.phase, pause.still.phase, pause.during.turn], ["ai_plan", "ai_plan", PAUSE_TURN], "and the job did not advance a phase");
  assert.deepEqual([pause.during.job, pause.still.job], [PAUSE_TURN, PAUSE_TURN], "it was still the job in progress");
  assert.deepEqual([pause.during.rows, pause.still.rows, pause.during.turnEnded], [1, 1, 0], "no snapshot but the acceptance's was published and no turn ended");
  assert.ok(pause.during.pumps >= PAUSE_FRAMES, "The application kept pumping, a pump a frame: the FabricApplication always processes");
  assert.equal(pause.markerBefore, false, "The marker was off");
  assert.deepEqual([pause.ui.clicksAfterFirst - pause.ui.clicksBefore, pause.ui.clicksAfterSecond - pause.ui.clicksBefore], [1, 2],
    "The HUD answered while the game was paused: each click reached its handler once");
  assert.deepEqual([pause.ui.markerShown, pause.ui.pulseAfterFirst, pause.ui.markerGone], [true, true, true], "React changed its state and the marker was a native node, and went");
  assert.equal(pause.finished, true, "After the game resumed the job finished");
  assert.deepEqual(pause.rows.map(entry => entry.kind), ["snapshot", "snapshot", "snapshot", "snapshot", "snapshot", "snapshot", "turn_ended", "snapshot"],
    "with its seven snapshots and one turn_ended");
  // The scene's side of it, which the behavior above does not need to be told: the layer the Surface stands in keeps processing while the tree is paused.
  assert.equal(stages.scene.hudProcessMode, stages.scene.alwaysMode, "The HUD's layer keeps processing while the tree is paused (PROCESS_MODE_ALWAYS)");
  return {turn: PAUSE_TURN, frames: pause.during.frames, pumps: pause.during.pumps, phase: pause.during.phase, clicks: 2, markerShown: pause.ui.markerShown};
}

// ------------------------------------------------------------------------------------------ the heavy panel
const ms = usec => round(usec / 1000, 3);
const series = values => ({samples: values.length, p50: round(nearestRank(values, 50), 3), p95: round(nearestRank(values, 95), 3), max: round(Math.max(...values), 3)});

function verifyPanel(stages, strategy) {
  const steady = stages.turns.slice(WARMUP_TURNS);
  const claims = {before: [], open: [], closed: []};
  stages.turns.forEach((row, index) => {
    const label = `turn ${index + 1}`;
    const {panel} = row;
    assert.ok(panel.open !== undefined, `${label}: the panel opened and closed`);
    assert.equal(panel.open.reading.panelOpen, true, `${label}: the panel was open`);
    assert.equal(panel.closed.reading.panelOpen, false, `${label}: and closed`);
    const open = panel.open.click.host;
    const closed = panel.closed.click.host;
    assert.ok(open.commits >= 1 && closed.commits >= 1, `${label}: each click committed`);
    if (strategy === "unmount") {
      assert.deepEqual([open.creates, open.deletes, closed.creates, closed.deletes], [PANEL_NODES, 0, 0, PANEL_NODES], `${label}: opening creates the panel's ${PANEL_NODES} native nodes and closing deletes them`);
      assert.equal(panel.open.reading.native - panel.closed.reading.native, PANEL_NODES, `${label}: the open panel holds ${PANEL_NODES} nodes more than the closed one`);
    } else {
      assert.deepEqual([open.creates, open.deletes, closed.creates, closed.deletes], [0, 0, 0, 0], `${label}: opening and closing a mounted panel creates and deletes no node`);
      assert.equal(panel.open.reading.native, panel.closed.reading.native, `${label}: the hidden panel holds the nodes of the open one`);
    }
    // a2: the world hears a click where the panel stands unless the panel is open (its hit test claims the map).
    assert.equal(panel.before.claim.presses, 1, `${label}: the world hears the click where the closed panel stands`);
    assert.equal(panel.open.claim.presses, 0, `${label}: the open panel claims the map: the world hears no press`);
    assert.equal(panel.closed.claim.presses, 1, `${label}: the panel closed again does not claim the map, however it was closed`);
    claims.before.push(panel.before.claim.presses);
    claims.open.push(panel.open.claim.presses);
    claims.closed.push(panel.closed.claim.presses);
  });
  const opens = steady.map(row => row.panel.open.click);
  const closes = steady.map(row => row.panel.closed.click);
  const host = (clicks, key) => series(clicks.map(click => click.host[key]));
  return {strategy, raw: {openMs: opens.map(click => ms(click.flushUsec)), closeMs: closes.map(click => ms(click.flushUsec))},
    claims: {turns: stages.turns.length, closedPressesWorldHeard: 1, openPressesWorldHeard: 0},
    open: {flushMs: series(opens.map(click => ms(click.flushUsec))), pumpMs: host(opens, "pump"), jsMs: host(opens, "js"), mountMs: host(opens, "mount"),
      created: median(opens.map(click => click.host.creates)), updated: median(opens.map(click => click.host.updates))},
    close: {flushMs: series(closes.map(click => ms(click.flushUsec))), pumpMs: host(closes, "pump"), jsMs: host(closes, "js"), mountMs: host(closes, "mount"),
      deleted: median(closes.map(click => click.host.deletes)), updated: median(closes.map(click => click.host.updates))},
    nativeClosed: median(steady.map(row => row.panel.closed.reading.native)), nativeOpen: median(steady.map(row => row.panel.open.reading.native))};
}

// ----------------------------------------------------------------------------------------- one execution
export function verifyFrontierSoakReport(report) {
  assert.equal(report.scenario, "frontier-soak");
  const {stages} = report;
  verifyConfig(report);
  verifyProvenance(stages.provenance);
  assert.equal(stages.provenance.displayServer, "headless");
  assert.equal(report.displayServer, "headless");
  assert.equal(stages.aborted, null, "The soak ran every turn: nothing aborted it");
  assert.equal(stages.turns.length, TURNS, `and played ${TURNS} turns`);
  assert.equal(stages.scene.mounted, true, "The HUD mounted over the world");
  assert.equal(stages.scene.mouseFilter, 2, "in a Surface that takes no pointer (IGNORE)");
  assert.equal(stages.scene.worldFirst, true, "in a layer after the world, the order a2 needs");
  assert.deepEqual([stages.base.epoch, stages.base.light.turn, stages.base.light.phase, stages.base.light.context], [1, 1, "idle", "none"], "The soak starts at turn 1 of the first session, at rest");
  stages.turns.forEach((row, index) => {
    assert.equal(row.aborted, "", `turn ${index + 1}: nothing aborted it`);
    assert.equal(row.index, index);
    assert.equal(row.turn, index + 1, `turn ${index + 1}: the turn counter is the turn's`);
    verifyDecisions(row, index);
    verifyJob(row, index);
    assert.deepEqual([row.rest.latest.turn, row.rest.latest.phase, row.rest.latest.lastJob], [index + 2, "idle", index + 1], `turn ${index + 1}: the game rests at the next turn with its job finished`);
    assert.equal(row.rest.reading.performance.hermes.collectedBeforeReading, true, `turn ${index + 1}: the heap is read after a forced collection`);
  });
  // The dialog is raised at the end of turn 4 and is the context of that rest; no other turn rests in a dialog.
  assert.deepEqual(stages.turns.map(row => row.rest.latest.context === "dialog"), stages.turns.map((_, index) => index === 3), "Only turn 4 rests in the dialog context");
  const nodes = verifyNodes(stages, report.strategy);
  const memory = verifyMemory(stages);
  const errors = verifyErrors(stages);
  const game = verifyGame(stages);
  const pause = verifyPause(stages);
  const panel = verifyPanel(stages, report.strategy);
  const turnMs = stages.turns.map(row => row.turnMs);
  return {strategy: report.strategy, ...game, nodes, memory, errors, pause, panel, turns: stages.turns.length, provenance: {godot: stages.provenance.godot, hermes: stages.provenance.hermes,
    architecture: stages.provenance.architecture, os: stages.provenance.os, processor: stages.provenance.processor},
  turnMs: {p50: round(median(turnMs), 1), p95: round(nearestRank(turnMs, 95), 1), max: round(Math.max(...turnMs), 1)},
  readings: {light: lightReadings(stages).length, rests: stages.turns.length}};
}

// ------------------------------------------------------------------------- the executions, together
// The game one execution played, on its own: the hash of every turn from its serialization, the trail and the final hash.
export function gameOf(report) {
  return verifyGame(report.stages);
}

// The game is the same in every execution: the final hash, the trail hash and the hash of every turn. A player that decides by anything but the
// snapshot (the clock, a random number) forks them.
export function verifySameGame(summaries) {
  assert.ok(summaries.length >= 2, "There are at least two executions to compare");
  const [first] = summaries;
  summaries.forEach((summary, index) => {
    assert.equal(summary.finalHash, first.finalHash, `Execution ${index + 1}: the final hash is the first's`);
    assert.equal(summary.trailHash, first.trailHash, `Execution ${index + 1}: the trail hash is the first's`);
    assert.deepEqual(summary.hashes, first.hashes, `Execution ${index + 1}: every turn's hash is the first's`);
  });
  return {finalHash: first.finalHash, trailHash: first.trailHash, turns: first.hashes.length, executions: summaries.length};
}

// The executions of the cases, together. The strategy changes the HUD only, so the game is the same whichever it ran, and the two strategies
// differ by what they say they differ by.
export function verifyFrontierSoakRuns(summaries) {
  assert.deepEqual(summaries.map(summary => summary.strategy), EXECUTIONS, "The executions ran the strategies of the cases, in order");
  const same = verifySameGame(summaries);
  const [first] = summaries;
  const by = strategy => summaries.filter(summary => summary.strategy === strategy);
  const pooled = (strategy, pick) => by(strategy).flatMap(pick);
  const unmount = summaries.find(summary => summary.strategy === "unmount");
  const hide = summaries.find(summary => summary.strategy === "hide");
  assert.ok(unmount !== undefined && hide !== undefined, "Both strategies ran");
  // The numbers of the decision: what a closed panel holds, in nodes (exact) and in heap, and what opening and closing it costs.
  assert.equal(hide.panel.nativeClosed - unmount.panel.nativeClosed, PANEL_NODES, `A hidden panel holds ${PANEL_NODES} native nodes more than an unmounted one`);
  assert.equal(unmount.panel.nativeOpen - unmount.panel.nativeClosed, PANEL_NODES, `and an unmounted panel gets them back when it opens`);
  assert.equal(hide.panel.nativeOpen - hide.panel.nativeClosed, 0, `while a hidden one holds them either way`);
  assert.equal(hide.panel.nativeOpen, unmount.panel.nativeOpen, "An open panel is the same tree in both strategies");
  const heap = strategy => median(by(strategy).map(summary => summary.memory.heap.medianBytes));
  assert.ok(heap("hide") > heap("unmount"), "The hidden panel keeps its fibers: the live heap at rest is higher than the unmounted one's");
  const decision = strategy => ({
    executions: by(strategy).length,
    nativeNodesClosed: by(strategy)[0].panel.nativeClosed, nativeNodesOpen: by(strategy)[0].panel.nativeOpen,
    heapAtRestBytes: heap(strategy), heapPerExecution: by(strategy).map(summary => summary.memory.heap.medianBytes),
    open: {flushMs: series(pooled(strategy, summary => summary.panel.raw.openMs)), created: by(strategy)[0].panel.open.created, updated: by(strategy)[0].panel.open.updated},
    close: {flushMs: series(pooled(strategy, summary => summary.panel.raw.closeMs)), deleted: by(strategy)[0].panel.close.deleted, updated: by(strategy)[0].panel.close.updated},
    perExecution: by(strategy).map(summary => ({open: summary.panel.open, close: summary.panel.close})),
    claim: by(strategy)[0].panel.claims,
    rssMedianKb: by(strategy).map(summary => summary.memory.rss.medianKb),
  });
  return {...same,
    decision: {unmount: decision("unmount"), hide: decision("hide"), panelNodes: PANEL_NODES,
      heapCostOfHiddenBytes: heap("hide") - heap("unmount")}};
}
