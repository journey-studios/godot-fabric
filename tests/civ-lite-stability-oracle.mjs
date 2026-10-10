import {heapAtRest} from "./frontier-baseline-oracle.mjs";
import {growthOfHalves} from "./performance-oracle.mjs";

// The independent oracle of Frontier's stability lane: opening and closing each overlay twenty times. It judges the raw observations of
// consumers/civ-lite/stability_validation.gd (a measure at rest after every close and open, the focus the host can say, the bursts at the
// map, the Images the HUD mounts) and none of the probe's verdicts. What a screen at rest holds is written here, apart from the probe:
// the registry's 19 bindings and the HUD's two connections, no pending work, no orphan, no route of the pointer left, no Window beyond
// the ones the game had before, and the first cycle's numbers for everything else, exactly. The icons each context must show are derived
// from the game's own snapshot that the report carries, with this file's table of which asset each icon is.
//
// Categories (a finding names its category; the lane test and the sabotage receipts read them):
//   coverage  twenty cycles of each screen were run the way they say: the city by a real click and a real press on Close, then by Escape;
//             the dialog by a new game played to turn 5 and the three events answered by real presses, in the game's order
//   leak      at rest after every close the tree (nodes, orphans, Windows), the native views, the Modal members, the pending work, the
//             pointer routes, the registry's subscriptions and pending work, the HUD's connections and the signal's connections are
//             the first cycle's, and the screen is what it was before the open; what a cycle created it deleted
//   heap      the Hermes heap at rest follows the baseline's rule (the median of the last half of the steady cycles at most 2,048
//             bytes over the median of the first), and the engine's object count at rest at most one object over
//   focus     the root viewport's focus owner after a close is the one before the open; while an overlay is open its Window is the one
//             exclusive Modal Window and no Control under it has the focus
//   blocking  with the overlay open in the first and the last cycle, 100 real left clicks, right clicks and wheel ticks at the map reach
//             the World 0 times and select nothing
//   escape    Escape on the city screen closes it through `clear_selection`; on the dialog it reaches the Window and does nothing
//   icons     the Images each context calls for are mounted, each drew with no error from the asset it must be, the city screen's in the
//             Modal's window, and the city screen's drew in every cycle
//   drift     (headed run) the pictures of the last cycle are the first cycle's, pixel for pixel, but for the first row of the bar

const CYCLES = 20;
const BURST_CYCLES = [1, 20];
const EVENTS = ["wanderers", "traders", "scholar"];
const PICKS = ["welcome", "buy_tools", "send_on"];
// The registry holds one binding for each state, signal and method the node registers: 19 since the Irrigate rule (18 with the stress mode and 15 before it,
// which a control run on an older tree says with `{bindings: 15}`).
const BINDINGS = 19;
const HUD_CONNECTIONS = 2;
const HEAP_LIMIT_BYTES = 2048;
const OBJECTS_LIMIT = 1;
const GROUPS = {
  tree: ["nodes", "orphans", "windows"],
  views: ["nativeViews", "nativeTags", "surfaceNodes", "liveRoots", "retiringTags", "modalNodes", "modalMembers"],
  pointers: ["pointerStored", "pointerSuppressed", "pointerContacts", "pointerActive", "pointerHover", "processorActive", "processorPendingCapture",
    "processorActiveCapture", "processorHover"],
  services: ["bindings", "subscriptions", "pendingHostTasks", "pendingEvents", "hudSubscriptions", "connections", "hoverConnections", "worlds"],
  work: ["pendingWork", "pendingTimers", "pendingAnimationFrames"],
};
const FIELDS = Object.values(GROUPS).flat();
const CAPTURES = ["bar", "actions", "city", "city-1", "city-20", "dialog-1", "dialog-20"].map(name => `civ-lite-stability-${name}.png`);

// Which asset each icon is: the bar's, the units' (by the kind the game gives the unit), the city's, and what each production item is.
const RESOURCE_ICONS = {food: "food.png", production: "production.png", science: "science.png"};
const UNIT_ICONS = {settler: "settler.png", warrior: "warrior.png"};
const ITEM_ICONS = {warrior: "warrior.png", granary: "food.png", workshop: "production.png", library: "science.png"};
const CONTEXT_ORDER = ["none", "stack", "settler", "city"];
const ACTIONS_IN = ["settler", "warrior", "stack"];
const TILE_IN = ["tile", "settler", "warrior", "stack"];

const canon = value => JSON.stringify(value);
const keyOf = action => [action.id, ...action.args].join("-");

// The icons a context must mount: testID -> the asset file, and whether it is in the Modal's window.
function expectedIcons(snapshot) {
  const icons = new Map(Object.entries(RESOURCE_ICONS).map(([name, file]) => [`hud-bar-${name}-icon`, {file, modal: false}]));
  const unitKind = id => snapshot.tile.units.find(unit => unit.id === id)?.kind;
  if (ACTIONS_IN.includes(snapshot.context)) {
    for (const action of snapshot.actions) {
      const file = action.id === "found_city" ? "city.png"
        : action.id === "select_unit" || action.id === "fortify" ? UNIT_ICONS[unitKind(action.args[0])] : undefined;
      if (file !== undefined) {
        icons.set(`hud-actions-${keyOf(action)}-icon`, {file, modal: false});
      }
    }
  }
  if (TILE_IN.includes(snapshot.context)) {
    if (snapshot.tile.city === 1) {
      icons.set("hud-tile-city-icon", {file: "city.png", modal: false});
    }
    for (const unit of snapshot.tile.units) {
      icons.set(`hud-tile-unit-${unit.id}-icon`, {file: UNIT_ICONS[unit.kind], modal: false});
    }
  }
  if (snapshot.context === "city") {
    icons.set("hud-city-icon", {file: "city.png", modal: true});
    for (const id of snapshot.cityItems) {
      icons.set(`hud-city-item-${id}-icon`, {file: ITEM_ICONS[id] ?? "city.png", modal: true});
    }
  }
  return icons;
}

const heapReading = rows => rows.map(row => ({reading: {performance: {hermes: {heap: {hermes_allocatedBytes: row.heap}}}}}));

export function judgeStabilityReport(report, {bindings = BINDINGS} = {}) {
  const findings = [];
  const fail = (category, message) => findings.push({category, message});
  if (report.schemaVersion !== 1 || report.base === undefined || report.city === undefined || report.dialog === undefined || report.icons === undefined) {
    fail("coverage", "the report is not the stability probe's: it has no base, icons, city or dialog");
    return findings;
  }
  const base = report.base;
  if (base.windows !== 0 || base.collected !== true || base.errors !== 0) {
    fail("coverage", `the base measure is of a game with no overlay open, read after a collection, with no error: ${canon({windows: base.windows, collected: base.collected, errors: base.errors})}`);
  }
  if (report.fill?.filled !== true || report.fill.kept !== 64) {
    fail("heap", `the HUD's telemetry lists were not filled to their 64 entries before the first measure: ${canon(report.fill)}`);
  }

  // What every measure at rest says, whatever the screen: the absolute facts of a running game.
  function judgeRest(label, row, open) {
    if (row.rested !== true || row.collected !== true) {
      fail("leak", `${label}: not at rest, or read before a collection (rested ${row.rested}, collected ${row.collected})`);
    }
    const expected = {windows: base.windows + (open ? 1 : 0), modalNodes: open ? 1 : 0, modalMembers: 1, retiringTags: 0, orphans: 0, errors: 0, bindings,
      subscriptions: HUD_CONNECTIONS, hudSubscriptions: HUD_CONNECTIONS, connections: 2, hoverConnections: 2, worlds: 1, pendingHostTasks: 0, pendingEvents: 0,
      pendingWork: 0, pendingTimers: 0, pendingAnimationFrames: 0, pointerSuppressed: 0, pointerActive: 0, liveRoots: 1};
    const wrong = Object.entries(expected).filter(([field, value]) => row[field] !== value).map(([field, value]) => `${field} ${row[field]}, expected ${value}`);
    if (wrong.length > 0) {
      fail("leak", `${label}: a screen at rest with its overlay ${open ? "open" : "closed"} holds ${wrong.join("; ")}`);
    }
    if (row.nativeViews !== row.nativeTags || row.nativeViews !== row.surfaceNodes) {
      fail("leak", `${label}: the native views (${row.nativeViews}), the tags (${row.nativeTags}) and the nodes the host reports (${row.surfaceNodes}) must be the same`);
    }
  }

  // A series of rows at rest (one per cycle) holds the first row's numbers, exactly.
  function judgeSeries(label, rows) {
    for (const [index, row] of rows.entries()) {
      for (const field of FIELDS) {
        if (row[field] !== rows[0][field]) {
          fail("leak", `${label}: ${field} at cycle ${index + 1} is ${row[field]}, the first cycle's is ${rows[0][field]}`);
        }
      }
    }
  }

  // The heap at rest by the baseline's rule, and the engine's objects by the same rule with a limit of one.
  function judgeFlat(label, rows) {
    try {
      heapAtRest(heapReading(rows));
    } catch (error) {
      fail("heap", `${label}: ${error.message}`);
    }
    if (rows.some(row => row.collected !== true)) {
      fail("heap", `${label}: a heap was read before a collection`);
    }
    try {
      growthOfHalves(rows.map(row => row.objects).slice(2), OBJECTS_LIMIT, {fill: `${label}: the steady cycles fill two halves`, read: `${label}: the objects are counted`,
        exceeded: ({half, growth}) => `${label}: the engine's objects at rest rose ${growth} from the median of the first half (${half} cycles) to the median of the last, over ${OBJECTS_LIMIT}`});
    } catch (error) {
      fail("heap", error.message);
    }
  }

  function judgeFocus(label, before, open, after) {
    const kept = before.focus.root === after.focus.root && before.focus.modals.length === 0 && after.focus.modals.length === 0;
    if (!kept) {
      fail("focus", `${label}: the focus after the close is not the one before the open: ${canon({before: before.focus, after: after.focus})}`);
    }
    const {modals, focused, root} = open.focus;
    const top = modals.at(-1);
    if (modals.length !== 1 || top?.exclusive !== true || top.visible !== true) {
      fail("focus", `${label}: while open the overlay's Window must be the one exclusive Modal Window: ${canon(modals)}`);
    }
    if (root !== 0 || focused.some(entry => entry.modal !== true)) {
      fail("focus", `${label}: while open no Control under the overlay may have the focus: ${canon({root, focused})}`);
    }
  }

  function judgeBursts(label, rows) {
    const bursts = rows.filter(row => row.blocking !== undefined);
    if (canon(bursts.map(row => row.cycle)) !== canon(BURST_CYCLES)) {
      fail("blocking", `${label}: the bursts run in cycles ${canon(bursts.map(row => row.cycle))}, expected ${canon(BURST_CYCLES)}`);
    }
    for (const row of bursts) {
      if (canon(row.blocking.map(entry => entry.kind)) !== canon(["left", "right", "wheel"])) {
        fail("blocking", `${label}, cycle ${row.cycle}: the inputs tried are ${canon(row.blocking.map(entry => entry.kind))}`);
      }
      for (const entry of row.blocking) {
        const silent = entry.count === 100 && canon(entry.heardAfter) === canon(entry.heardBefore) && entry.selectCalls === 0
          && canon(entry.selectionAfter) === canon(entry.selectionBefore);
        if (!silent) {
          fail("blocking", `${label}, cycle ${row.cycle}: ${entry.count} ${entry.kind} inputs at the map under the overlay must reach the World 0 times and select nothing: ${canon(entry)}`);
        }
      }
    }
  }

  // --- The icons ----------------------------------------------------------------------------------------------------------
  function judgeImage(label, image, expected) {
    const file = image.uri.split("/").pop();
    if (!(image.visible && image.drawn && image.errors === 0 && image.error === "" && image.draws > 0 && image.loads === 1)) {
      fail("icons", `${label}: ${image.testID} must be visible and have drawn once loaded with no error: ${canon(image)}`);
    }
    if (!image.uri.endsWith(`/assets/ui/icons/${expected.file}`) || file !== expected.file) {
      fail("icons", `${label}: ${image.testID} must draw ${expected.file}, it drew ${image.uri}`);
    }
    if (image.modal !== expected.modal) {
      fail("icons", `${label}: ${image.testID} must be ${expected.modal ? "inside the Modal's window" : "in the tree"}`);
    }
    if (!(image.width > 0 && image.width === image.height)) {
      fail("icons", `${label}: ${image.testID} must be square: ${image.width}x${image.height}`);
    }
  }
  function judgeImages(label, images, snapshot) {
    const expected = expectedIcons(snapshot);
    const seen = images.map(image => image.testID).sort();
    if (canon(seen) !== canon([...expected.keys()].sort())) {
      fail("icons", `${label}: the Images mounted are ${canon(seen)}, the game's snapshot calls for ${canon([...expected.keys()].sort())}`);
    }
    for (const image of images) {
      if (expected.has(image.testID)) {
        judgeImage(label, image, expected.get(image.testID));
      }
    }
  }
  if (canon(report.icons.map(entry => entry.label)) !== canon(CONTEXT_ORDER)
      || canon(report.icons.map(entry => entry.snapshot.context)) !== canon(CONTEXT_ORDER)) {
    fail("coverage", `the icons were observed in ${canon(report.icons.map(entry => [entry.label, entry.snapshot.context]))}, expected ${canon(CONTEXT_ORDER)}`);
  }
  for (const entry of report.icons) {
    if (entry.rested !== true) {
      fail("icons", `icons in the ${entry.label} context: the screen had not come to rest (the Images settled, loaded and drawn or failed) when they were read`);
    }
    judgeImages(`icons in the ${entry.label} context`, entry.images, entry.snapshot);
  }
  const citySnapshot = report.icons.find(entry => entry.label === "city")?.snapshot;

  // --- The city screen ----------------------------------------------------------------------------------------------------
  const rounds = report.city.rounds;
  const expectedHows = Array.from({length: CYCLES}, () => ["close", "escape"]).flat();
  if (canon(rounds.map(row => row.how)) !== canon(expectedHows) || canon(rounds.map(row => row.cycle)) !== canon(expectedHows.map((_, index) => Math.floor(index / 2) + 1))) {
    fail("coverage", `the city rounds are ${rounds.length}: ${CYCLES} cycles of a close and an escape were expected`);
  }
  for (const row of rounds) {
    const label = `city cycle ${row.cycle} (${row.how})`;
    if (!(row.opened === true && row.pressed === true && row.closed === true)) {
      fail("coverage", `${label}: the screen must be opened by a real click on its tile and closed by a real press (Close) or by Escape: ${canon({opened: row.opened, pressed: row.pressed, closed: row.closed})}`);
    }
    if (row.open.context !== "city" || row.after.context !== "none" || row.before.context !== "none") {
      fail("coverage", `${label}: the game's contexts around the screen are none, city, none: ${canon([row.before.context, row.open.context, row.after.context])}`);
    }
    if (row.clearCalls !== 1) {
      fail("escape", `${label}: ${row.how === "escape" ? "Escape" : "Close"} must ask the game once to clear the selection: ${row.clearCalls}`);
    }
    judgeRest(`${label}, before`, row.before, false);
    judgeRest(`${label}, open`, row.open, true);
    judgeRest(`${label}, after`, row.after, false);
    if (row.after.nativeViews !== row.before.nativeViews || row.after.nodes !== row.before.nodes || row.after.windows !== row.before.windows) {
      fail("leak", `${label}: after the close the HUD is not what it was before the open: ${canon({before: [row.before.nodes, row.before.nativeViews, row.before.windows], after: [row.after.nodes, row.after.nativeViews, row.after.windows]})}`);
    }
    if (row.after.creates - row.before.creates !== row.after.deletes - row.before.deletes || row.after.creates - row.before.creates === 0) {
      fail("leak", `${label}: what the cycle created it must delete, and it created something: ${row.after.creates - row.before.creates} created, ${row.after.deletes - row.before.deletes} deleted`);
    }
    judgeFocus(label, row.before, row.open, row.after);
    if (citySnapshot !== undefined) {
      judgeImages(`${label}, open`, row.openImages, citySnapshot);
    }
  }
  for (const how of ["close", "escape"]) {
    const group = rounds.filter(row => row.how === how);
    for (const phase of ["before", "open", "after"]) {
      judgeSeries(`city (${how}), ${phase}`, group.map(row => row[phase]));
    }
    judgeFlat(`city (${how})`, group.map(row => row.after));
  }
  judgeBursts("city", rounds.filter(row => row.how === "close"));

  // --- The event dialog ---------------------------------------------------------------------------------------------------
  const cycles = report.dialog.cycles;
  if (canon(cycles.map(row => row.cycle)) !== canon(Array.from({length: CYCLES}, (_, index) => index + 1))) {
    fail("coverage", `the dialog cycles are ${canon(cycles.map(row => row.cycle))}`);
  }
  for (const row of cycles) {
    const label = `dialog cycle ${row.cycle}`;
    if (row.opened !== true || row.before.context === "dialog" || row.open.context !== "dialog") {
      fail("coverage", `${label}: the events must be raised by the end of turn 5, with no dialog before: ${canon([row.opened, row.before.context, row.open.context])}`);
    }
    if (canon(row.answers.map(answer => [answer.event, answer.pick, answer.pressed, answer.moved, answer.resolveCalls]))
        !== canon(EVENTS.map((event, index) => [event, PICKS[index], true, true, 1]))) {
      fail("coverage", `${label}: the three events must be answered in the game's order by real presses, each once: ${canon(row.answers.map(answer => [answer.event, answer.pick, answer.pressed, answer.moved, answer.resolveCalls]))}`);
    }
    const escape = row.escape;
    if (!(escape.heard === 1 && escape.sameHead && escape.unchanged && escape.stillOpen && escape.windows === 0 && escape.context === "dialog")) {
      fail("escape", `${label}: Escape on the open dialog must reach its Window and do nothing: ${canon(escape)}`);
    }
    judgeRest(`${label}, before`, row.before, false);
    judgeRest(`${label}, open`, row.open, true);
    row.answers.forEach((answer, index) => {
      const last = index === row.answers.length - 1;
      judgeRest(`${label}, answer ${index + 1}`, answer.after, !last);
      if (last && answer.after.context !== "none") {
        fail("coverage", `${label}: after the last answer the context leaves the dialog: ${answer.after.context}`);
      }
    });
    judgeFocus(label, row.before, row.open, row.answers.at(-1).after);
  }
  const phases = [["open", row => row.open], ...EVENTS.map((_, index) => [`answer ${index + 1}`, row => row.answers[index].after])];
  for (const [name, pick] of phases) {
    judgeSeries(`dialog, ${name}`, cycles.map(pick));
  }
  judgeFlat("dialog (last answer)", cycles.map(row => row.answers.at(-1).after));
  judgeBursts("dialog", cycles);

  // --- The pictures -------------------------------------------------------------------------------------------------------
  if (report.capture === true) {
    if (canon([...report.captures].sort()) !== canon([...CAPTURES].sort())) {
      fail("drift", `the headed run saved ${canon(report.captures)}, expected ${canon(CAPTURES)}`);
    }
    if (report.drift?.same !== true) {
      fail("drift", `the pictures of the last cycle must be the first cycle's, but for the first row of the bar: ${canon(report.drift)}`);
    }
  }
  return findings;
}

/** Throws when the report is not clean, with the findings. */
export function assertStabilityReport(report) {
  const findings = judgeStabilityReport(report);
  if (findings.length > 0) {
    throw new Error(`The stability report has ${findings.length} findings:\n${findings.slice(0, 40).map(finding => `[${finding.category}] ${finding.message}`).join("\n")}`);
  }
}
