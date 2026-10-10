// The independent oracle of Frontier's overlays: the queue of three events, the HUD's remount and the blocking Modals. It judges the raw
// observations of consumers/civ-lite/overlay_validation.gd (what the game said, what the HUD's tree showed in the Modal's window, every
// frame of each change, the intents the game refused, and the world's counters under real pointer events) and none of the probe's verdicts.
// The three events, their texts, their choices and the order the queue answers them in are written here, apart from the game's table
// (consumers/civ-lite/game/rules.gd), so a queue that answers out of order, a dialog that says another event's words or a position that is
// not the game's shows as a disagreement.
//
// Categories:
//   queue     the dialog shows the three events in order, "1 of 3" to "3 of 3", with the table's words, in the Modal's window; every other
//             intent is refused with the state untouched, a choice of another event is unknown; a real press answers the head, once, and the
//             game records the answers in order; between two heads the HUD shows the old event or the next and never another; each event is
//             a subtree of its own
//   remount   with the second event at the head the Surface unmounts and mounts again: the first thing it shows is the second event, "2 of 3",
//             with no other event in any frame, and the queue goes on to the third; the city screen comes back as an overlay
//   blocking  with the city screen open and with the dialog open, 100 real left clicks, right clicks and wheel ticks on the map reach the world
//             0 times and select nothing, the overlay's Pressables work, and with it closed the same 100 reach the world again
//   escape    the Escape key on the city screen is the game's `clear_selection`, once, and the overlay is gone; on the dialog it changes nothing:
//             the same event is the head, no call reaches the game and the dialog stays open
//   newgame   a new session started with events waiting has no queue until its own turn 5, and then raises its own three
//
// The probe runs on both arms of the 0.5 comparison, and the report says which (`arm`: "rn" for the React Native HUD, "native" for the Godot
// one). What the native arm cannot say is listed in the report by the probe (`notApplicable`) and written here, so that a check the oracle
// skips is a check on record: the oracle requires the list to be exactly the arm's, and skips only what is on it.

// What each arm cannot say. The host's HUD has an Application whose error list the remount reads; the native HUD has none.
const APPLICATION_ERRORS = "the application's error list after a remount (there is no Application node)";
const NOT_APPLICABLE = {rn: [], native: [APPLICATION_ERRORS]};

const EVENTS = [
  {id: "wanderers", title: "Wanderers at the gate", text: "A band of wanderers asks to settle beside your city.", choices: [
    {id: "welcome", label: "Welcome them", detail: "Food +6 to +9"}, {id: "turn_away", label: "Turn them away", detail: "Production +4"}]},
  {id: "traders", title: "Traders at the crossroads", text: "A caravan stops outside the walls and offers to sell what it carries.", choices: [
    {id: "buy_grain", label: "Buy grain", detail: "Food +3"}, {id: "buy_tools", label: "Buy tools", detail: "Production +3"}]},
  {id: "scholar", title: "A scholar asks for shelter", text: "A wandering scholar offers to teach in exchange for a roof.", choices: [
    {id: "host", label: "Host the scholar", detail: "Science +3"}, {id: "send_on", label: "Send the scholar on", detail: "Food +2"}]},
];
// The choice the probe presses for each event: the first of the wanderers (it draws from the PRNG), then the second of each other.
const PICKS = ["welcome", "buy_tools", "send_on"];
const WAITING = ["select_tile", "select_unit", "clear_selection", "move_unit", "found_city", "fortify", "set_production", "set_research", "end_turn"];
const FOREIGN = ["buy_grain", "host", "welcome"];
const CLICKS = 100;
const EVENT_TURN = 5;
const ids = events => events.map(event => event.id);
const inOrder = EVENTS.map(event => event.id);

// JSON with the keys of every object sorted: the probe's dictionaries come out of Godot in an order that means nothing.
const canon = value => JSON.stringify(value, (_key, item) => (item !== null && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1))) : item));

export function judgeOverlayReport(report) {
  const findings = [];
  const fail = (category, message) => findings.push({category, message});
  const same = (category, actual, expected, message) => {
    if (canon(actual) !== canon(expected)) {
      fail(category, `${message}: ${canon(actual)}, expected ${canon(expected)}`);
    }
  };
  if (report.schemaVersion !== 1 || report.queue === undefined || report.remount === undefined || report.blocking === undefined || report.newGame === undefined) {
    fail("queue", "the report is not the overlay probe's: it has no queue, remount, blocking or newGame");
    return findings;
  }
  // The probe names the arm it ran on (hud_probe.gd writes it into every report), so a report without one is not this probe's.
  const {arm} = report;
  if (!Object.hasOwn(NOT_APPLICABLE, arm)) {
    fail("queue", `the report names the arm ${JSON.stringify(arm)}, which is neither "rn" nor "native"`);
    return findings;
  }
  same("queue", report.notApplicable ?? [], NOT_APPLICABLE[arm], "what the probe says the arm cannot say");
  const words = event => ({title: event.title, text: event.text});
  const choicesOf = event => event.choices.map(choice => ({id: choice.id, label: choice.label, detail: choice.detail, disabled: false}));
  const position = round => `${round + 1} of ${EVENTS.length}`;

  // --- The queue ----------------------------------------------------------------------------------------------------------
  const rounds = report.queue.rounds;
  same("queue", rounds.map(row => row.dialog.id), inOrder, "the dialog showed the events in the order of the table");
  for (const [round, row] of rounds.entries()) {
    const event = EVENTS[round];
    if (event === undefined) {
      fail("queue", `round ${round} has no event in the table`);
      continue;
    }
    const where = `round ${round + 1} (${event.id})`;
    same("queue", [row.context, row.dialog.open, row.dialog.index, row.dialog.count], ["dialog", 1, round + 1, EVENTS.length], `${where}: the game's dialog and its place in the queue`);
    same("queue", {title: row.dialog.title, text: row.dialog.text}, words(event), `${where}: the game's words`);
    same("queue", row.dialog.choices, event.choices.map(({id, label, detail}) => ({id, label, detail})), `${where}: the game's choices`);
    same("queue", [row.hud.shown, row.hud.modal, row.hud.position], [true, true, position(round)], `${where}: the HUD shows the dialog in the Modal's window, at the game's position`);
    same("queue", {title: row.hud.title, text: row.hud.text}, words(event), `${where}: the HUD says the event's words`);
    same("queue", row.hud.choices, choicesOf(event), `${where}: the HUD offers the event's own choices`);
    same("queue", row.refusals.map(entry => [entry.intent, entry.ok, entry.code]), [
      ...WAITING.map(intent => [intent, 0, "event_pending"]),
      [`resolve_event:${FOREIGN[round]}`, 0, "unknown_choice"], ["resolve_event:bogus", 0, "unknown_choice"]], `${where}: what the game refuses while it waits`);
    if (row.untouched !== true) {
      fail("queue", `${where}: the refused intents changed the state or reached a method that counts`);
    }
    same("queue", [row.pick, row.pressed, row.moved, row.settled, row.resolveCalls], [PICKS[round], true, true, true, 1], `${where}: a real press on the pick answers the head once`);
    const answered = EVENTS.slice(0, round + 1).map((entry, index) => ({id: entry.id, choice: PICKS[index]}));
    same("queue", [ids(EVENTS.slice(round + 1)), row.after.events.resolved], [row.after.events.queue, answered], `${where}: the game's queue and the answers it recorded after`);
    const next = EVENTS[round + 1];
    if (next === undefined) {
      same("queue", [row.after.context, row.after.dialog.open, row.after.dialog.index, row.after.dialog.count, row.after.hud.shown], ["none", 0, 0, 0, false],
        `${where}: after the last answer the dialog is closed and the Modal gone`);
    } else {
      same("queue", [row.after.context, row.after.dialog.id, row.after.dialog.index, row.after.dialog.count, row.after.hud.shown, row.after.hud.position, row.after.hud.title],
        ["dialog", next.id, round + 2, EVENTS.length, true, position(round + 1), next.title], `${where}: after the press the next event is the head, in the game and in the HUD`);
    }
    // Every frame between the press and the settled HUD shows this event or the next one, never another.
    const allowed = [event, next].filter(entry => entry !== undefined);
    row.samples.forEach((sample, index) => {
      if (sample.shown && !allowed.some(entry => entry.title === sample.title && sample.position === position(EVENTS.indexOf(entry)))) {
        fail("queue", `${where}: frame ${index} of the change shows "${sample.position}" "${sample.title}", which is neither this event nor the next`);
      }
    });
  }
  const instances = rounds.map(row => row.hud.instance);
  if (new Set(instances).size !== instances.length || instances.includes(0)) {
    fail("queue", `each event must be a subtree of its own, a new Control every time: ${JSON.stringify(instances)}`);
  }

  // --- The remount --------------------------------------------------------------------------------------------------------
  const remount = report.remount;
  const second = EVENTS[1];
  same("remount", [remount.first.moved, remount.first.after.dialog.id, remount.first.after.dialog.index], [true, second.id, 2], "the first event was answered and the second is the head");
  same("remount", [remount.remounted.gone, remount.remounted.back, remount.remounted.settled], [true, true, true], "the Surface left the tree and came back");
  same("remount", [remount.remounted.whileUnmounted.context, remount.remounted.whileUnmounted.dialog.id, remount.remounted.whileUnmounted.events.queue],
    ["dialog", second.id, ids(EVENTS.slice(1))], "the game kept its queue while the Surface was unmounted");
  same("remount", [remount.remounted.hud.shown, remount.remounted.hud.modal, remount.remounted.hud.position, remount.remounted.hud.title, remount.remounted.hud.text],
    [true, true, position(1), second.title, second.text], "the remounted HUD shows the second event, in the Modal's window");
  same("remount", remount.remounted.hud.choices, choicesOf(second), "the remounted HUD offers the second event's choices");
  if (remount.remounted.samples.length === 0) {
    fail("remount", "no frame between the mount and the settled HUD was observed");
  }
  remount.remounted.samples.forEach((sample, index) => {
    if (sample.shown && (sample.title !== second.title || sample.position !== position(1))) {
      fail("remount", `frame ${index} after the mount shows "${sample.position}" "${sample.title}": another event than the second`);
    }
  });
  if (!NOT_APPLICABLE[arm].includes(APPLICATION_ERRORS)) {
    same("remount", remount.remounted.errors, [], "the application reports no error after the remount");
  }
  same("remount", remount.rest.map(row => [row.dialog.id, row.pressed, row.moved, row.resolveCalls]), [[EVENTS[1].id, true, true, 1], [EVENTS[2].id, true, true, 1]],
    "after the remount the queue went on, by real presses, to the third event");
  same("remount", [remount.rest.at(-1)?.after.context, remount.rest.at(-1)?.after.events.queue, remount.rest.at(-1)?.after.events.resolved.map(answer => answer.id)],
    ["none", [], inOrder], "the queue ended with the three answers in order");
  same("remount", [remount.city.gone, remount.city.back, remount.city.settled, remount.city.modal, remount.city.research, remount.city.panels],
    [true, true, true, true, true, ["hud-bar", "hud-city", "hud-research"]], "the city screen came back after a remount as an overlay, with the research list");

  // --- The overlays block --------------------------------------------------------------------------------------------------
  const blocking = report.blocking;
  const silent = row => row.count === CLICKS && canon(row.heardAfter) === canon(row.heardBefore) && row.selectCalls === 0
    && canon(row.selectionAfter) === canon(row.selectionBefore);
  const reached = (row, selects) => row.count === CLICKS && row.heardAfter.buttons - row.heardBefore.buttons === 2 * CLICKS && row.selectCalls === selects;
  same("blocking", blocking.cityOpen.map(row => row.kind), ["left", "right", "wheel"], "the inputs tried with the city screen open");
  blocking.cityOpen.forEach(row => {
    if (!silent(row)) {
      fail("blocking", `with the city screen open ${row.count} ${row.kind} inputs on the map must reach the world 0 times and select nothing: ${JSON.stringify(row)}`);
    }
  });
  same("blocking", [blocking.cityPress.pressed, blocking.cityPress.calls, blocking.cityPress.queue], [true, 1, ["warrior"]], "a Pressable in the city overlay works");
  same("blocking", [blocking.cityClosePressed, blocking.cityClosed], [true, true], "the city overlay's Close is a real press that closes it");
  blocking.cityAfter.forEach(row => {
    if (!reached(row, row.kind === "left" ? CLICKS : 0)) {
      fail("blocking", `with the city screen closed ${row.count} ${row.kind} inputs on the map must reach the world ${CLICKS} of ${CLICKS} times${row.kind === "left" ? " and select" : ""}: ${JSON.stringify(row)}`);
    }
  });
  same("blocking", blocking.dialogContext, "dialog", "the context the dialog was blocked in");
  blocking.dialogOpen.forEach(row => {
    if (!silent(row)) {
      fail("blocking", `with the dialog open ${row.count} ${row.kind} inputs on the map must reach the world 0 times and select nothing: ${JSON.stringify(row)}`);
    }
  });
  same("blocking", blocking.dialogAnswers, [true, true, true], "the dialog's Pressables work: the three events were answered by real presses");
  blocking.dialogAfter.forEach(row => {
    if (!reached(row, row.kind === "left" ? CLICKS : 0)) {
      fail("blocking", `with the queue answered ${row.count} ${row.kind} inputs on the map must reach the world ${CLICKS} of ${CLICKS} times${row.kind === "left" ? " and select" : ""}: ${JSON.stringify(row)}`);
    }
  });

  // --- Escape ------------------------------------------------------------------------------------------------------------
  const escape = report.escape;
  if (escape === undefined) {
    fail("escape", "the report has no escape section");
  } else {
    same("escape", [escape.city.contextBefore, escape.city.shownBefore, escape.city.clearCalls, escape.city.contextAfter, escape.city.shownAfter], ["city", true, 1, "none", false],
      "Escape on the city screen is the game's clear_selection, once, and the overlay is gone");
    same("escape", [escape.dialog.contextBefore, escape.dialog.shownBefore, escape.dialog.sameHead, escape.dialog.calls, escape.dialog.unchanged, escape.dialog.contextAfter, escape.dialog.shownAfter],
      ["dialog", true, true, 0, true, "dialog", true], "Escape on the dialog does nothing");
  }

  // --- A new game with events waiting --------------------------------------------------------------------------------------
  const game = report.newGame;
  same("newgame", [game.before.dialog.index, game.before.dialog.count, game.before.events.queue, game.before.events.resolved],
    [2, EVENTS.length, ids(EVENTS.slice(1)), [{id: EVENTS[0].id, choice: PICKS[0]}]], "the session dropped had one event answered and two waiting");
  same("newgame", [game.fresh.settled, game.fresh.worldReady, game.fresh.epoch, game.fresh.context, game.fresh.dialog.open, game.fresh.events.queue, game.fresh.events.resolved, game.fresh.hud.shown],
    [true, true, game.before.epoch + 1, "none", 0, [], [], false], "the new session has no queue, no dialog and no Modal until its own turn 5");
  same("newgame", [game.raised.settled, game.raised.turn, game.raised.context, game.raised.events.queue, game.raised.events.resolved, game.raised.dialog.index, game.raised.dialog.count],
    [true, EVENT_TURN, "dialog", inOrder, [], 1, EVENTS.length], "at its turn 5 the new session raised its own three events");
  same("newgame", [game.raised.hud.shown, game.raised.hud.modal, game.raised.hud.position, game.raised.hud.title], [true, true, position(0), EVENTS[0].title],
    "and the HUD showed the first, 1 of 3, in the Modal's window");
  return findings;
}

/** Throws when the report is not clean, with the findings. */
export function assertOverlayReport(report) {
  const findings = judgeOverlayReport(report);
  if (findings.length > 0) {
    throw new Error(`The overlay report has ${findings.length} findings:\n${findings.slice(0, 40).map(finding => `[${finding.category}] ${finding.message}`).join("\n")}`);
  }
}
