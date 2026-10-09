// The independent oracle of Frontier's HUD lane. It judges the raw observations of consumers/civ-lite/hud_validation.gd (the
// HUD's tree as the native host reported it after each step, the frames of a job, the real pointer events and what the game and
// the World counted) and none of the probe's verdicts (`checks`). It never reads the HUD's sources and it does not take the panels
// from the probe: the table of panels per context, the format of what each panel says and the geometry of the map are written
// here from docs/research/frontier-game.md and consumers/civ-lite/world/world.gd's contract, and each snapshot the report carries
// is the game's own, so what a panel must show is derived from it.
//
// What it requires, per category (a finding names its category; the lane test and the sabotage receipts read them):
//   coverage     the seven contexts were reached at the roteiro's covering steps, by the game's own results and contexts
//   panels       at each step the set of visible panel testIDs is exactly the table's for the context, and no testID outside the
//                six panels, the root and the spinner is mounted
//   actions      the actions panel lists the snapshot's actions but End turn, in order, with label, enabled flag and reason
//   bar          the bar shows the turn, the phase and the three resources, End turn is the `end_turn` action (enabled by the game's
//                flag, with its reason) and the spinner is there exactly while the phase is not idle
//   content      the tile card, the city screen, the research panel and the dialog say what their part of the snapshot says
//   map          no Control that stops the pointer and no panel covers a tile of the map
//   phase        every published snapshot of a turn in progress disables End turn; every frame of the job shows spinner and disabled
//                End turn exactly while the phase is not idle and only phases the game published; held at an AI phase the spinner
//                spins and a press on the disabled End turn asks nothing of the game; released, the turn is at rest again
//   input        a real click on a tile selects the tile the geometry gives; the pointer over a tile publishes the hover and the
//                card shows it; over a panel or off the map it is cleared; a click on a panel does not reach the World; an enabled
//                action is performed by a real press and a disabled one is not, with its reason shown; after the menu the World is
//                ahead of the HUD's layer and all of that still holds

const PANEL_NAMES = ["bar", "actions", "tile", "city", "research", "dialog"];
// The table (docs/research/frontier-game.md): the panels each context mounts. The bar is in all of them.
export const TABLE = {
  none: ["bar"],
  tile: ["bar", "tile"],
  settler: ["bar", "actions", "tile"],
  warrior: ["bar", "actions", "tile"],
  stack: ["bar", "actions", "tile"],
  city: ["bar", "city", "research"],
  dialog: ["bar", "dialog"],
};
// The steps of the roteiro that cover each context (docs/research/frontier-game.md, "The seven contexts").
export const COVERING = {stack: 2, settler: 3, warrior: 9, city: 18, tile: 32, none: 33, dialog: 45};
const LAST_STEP = 45;
const PHASES = ["ai_plan", "ai_move", "production", "growth", "research", "refresh", "idle"];
const AI_PHASES = ["ai_plan", "ai_move"];
const TURN_IN_PROGRESS = "The turn is being processed.";

const panelId = name => `hud-${name}`;
const signed = value => (value >= 0 ? `+${value}` : `${value}`);

function nodeOf(observed, id) {
  return observed.nodes.find(entry => entry.testID === id);
}
const shown = (observed, id) => nodeOf(observed, id)?.visible === true;
const textOf = (observed, id) => nodeOf(observed, id)?.text;
const rectOverlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const inside = (point, rect) => point[0] >= rect[0] && point[0] < rect[0] + rect[2] && point[1] >= rect[1] && point[1] < rect[1] + rect[3];

// Which panel a testID belongs to: the panel's root or a child named under it. The spinner is the one name the bar's content has
// outside that rule (`hud-turn-spinner`); the root and the connecting screen are not panels.
function panelOf(testID) {
  if (testID === "hud-turn-spinner") {
    return "bar";
  }
  return PANEL_NAMES.find(name => testID === panelId(name) || testID.startsWith(`${panelId(name)}-`)) ?? null;
}
const NOT_PANELS = ["hud-root", "hud-connecting"];

// The key the HUD names an action's Pressable by: the id and the arguments, joined.
const actionKey = action => [action.id, ...action.args].join("-");

// The actions panel as the tree shows it: the Pressables in the order they are drawn, with the label and the reason beside them.
function renderedActions(observed) {
  const rows = [];
  for (const entry of observed.nodes) {
    const id = entry.testID;
    if (!entry.visible || !id.startsWith("hud-actions-") || id === "hud-actions-title" || id.endsWith("-label") || id.endsWith("-reason")) {
      continue;
    }
    rows.push({key: id.slice("hud-actions-".length), label: textOf(observed, `${id}-label`) ?? "", enabled: !entry.disabled,
      reason: textOf(observed, `${id}-reason`) ?? "", x: entry.rect[0], y: entry.rect[1]});
  }
  rows.sort((a, b) => a.y - b.y || a.x - b.x);
  return rows.map(({key, label, enabled, reason}) => ({key, label, enabled, reason}));
}

// The game's own rows: the snapshot's actions but End turn, which lives on the bar.
function expectedActions(snapshot) {
  return snapshot.actions.filter(action => action.id !== "end_turn").map(action => ({
    key: actionKey(action), label: action.label, enabled: action.enabled === 1, reason: action.enabled === 1 ? "" : action.reason_text,
  }));
}

// A list of Pressables named `<prefix><id>` (the city's items, the research's techs) with a label and a reason: the rows in order.
function renderedRows(observed, prefix, ids) {
  return ids.map(id => {
    const entry = nodeOf(observed, `${prefix}${id}`);
    return entry === undefined || !entry.visible ? null
      : {id, label: textOf(observed, `${prefix}${id}-label`) ?? "", enabled: !entry.disabled, reason: textOf(observed, `${prefix}${id}-reason`) ?? ""};
  });
}
const expectedRows = (entries, label) => entries.map(entry => ({id: entry.id, label: label(entry), enabled: entry.enabled === 1,
  reason: entry.enabled === 1 ? "" : entry.reason_text}));

export function judgeHudReport(report) {
  const findings = [];
  const fail = (category, message) => findings.push({category, message});
  const same = (category, actual, expected, message) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(category, `${message}: ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
  };
  if (report.schemaVersion !== 1 || !Array.isArray(report.matrix) || report.phase === undefined || !Array.isArray(report.input)) {
    fail("coverage", "the report is not the HUD lane's: it has no matrix, no phase or no input");
    return findings;
  }
  const map = report.map;
  const mapRect = [map.origin[0], map.origin[1], map.columns * map.tile, map.rows * map.tile];
  // The tile under a point of the screen, from the geometry alone.
  const tileAt = point => [Math.floor((point[0] - map.origin[0]) / map.tile), Math.floor((point[1] - map.origin[1]) / map.tile)];
  const onMap = tile => tile[0] >= 0 && tile[0] < map.columns && tile[1] >= 0 && tile[1] < map.rows;

  // --- The matrix ---------------------------------------------------------------------------------------------------
  same("coverage", report.matrix.map(row => row.index), Array.from({length: LAST_STEP + 1}, (_, index) => index), "the steps played");
  for (const [context, index] of Object.entries(COVERING)) {
    const row = report.matrix[index];
    if (row === undefined || row.label !== `cover-${context}` || row.snapshot.context !== context) {
      fail("coverage", `step ${index} must cover the ${context} context: it is labelled ${row?.label} and the game's context was ${row?.snapshot.context}`);
    }
  }
  for (const row of report.matrix) {
    if (row.code !== row.expectedCode || row.snapshot.context !== row.expectedContext) {
      fail("coverage", `step ${row.index} (${row.intent}) answered ${row.code} in context ${row.snapshot.context}; the roteiro says ${row.expectedCode} in ${row.expectedContext}`);
    }
    if (row.settled !== true) {
      fail("panels", `step ${row.index} (${row.intent}): the HUD did not catch up with the game's snapshot before its wait ran out`);
    }
    judgeStep(row);
  }

  function judgeStep(row) {
    const label = `step ${row.index} (${row.intent}, ${row.snapshot.context})`;
    const snapshot = row.snapshot;
    const seen = row.observed;
    const expectedPanels = TABLE[snapshot.context];
    if (expectedPanels === undefined) {
      fail("coverage", `${label}: ${snapshot.context} is not one of the seven contexts`);
      return;
    }
    const visiblePanels = PANEL_NAMES.filter(name => shown(seen, panelId(name)));
    same("panels", visiblePanels, PANEL_NAMES.filter(name => expectedPanels.includes(name)), `${label}: the visible panels`);
    for (const entry of seen.nodes) {
      const owner = panelOf(entry.testID);
      if (owner === null && !NOT_PANELS.includes(entry.testID)) {
        fail("panels", `${label}: ${entry.testID} belongs to no panel`);
      } else if (owner !== null && entry.visible && !expectedPanels.includes(owner)) {
        fail("panels", `${label}: ${entry.testID} is shown and belongs to the ${owner} panel, which the ${snapshot.context} context does not mount`);
      }
    }
    for (const name of PANEL_NAMES) {
      const entry = nodeOf(seen, panelId(name));
      if (entry !== undefined && entry.visible && rectOverlaps(entry.rect, mapRect)) {
        fail("map", `${label}: the ${name} panel covers a tile of the map`);
      }
    }
    for (const stopper of seen.stoppers) {
      if (rectOverlaps(stopper.rect, mapRect)) {
        fail("map", `${label}: a Control that stops the pointer (${stopper.testID === "" ? "no testID" : stopper.testID}) covers a tile of the map`);
      }
    }
    // The bar.
    if (shown(seen, "hud-bar")) {
      const endTurn = snapshot.actions.find(action => action.id === "end_turn");
      same("bar", textOf(seen, "hud-bar-turn"), `Turn ${snapshot.turn} · epoch ${snapshot.epoch}`, `${label}: the turn`);
      same("bar", textOf(seen, "hud-bar-phase"), snapshot.phase, `${label}: the phase`);
      for (const [name, title] of [["food", "Food"], ["production", "Production"], ["science", "Science"]]) {
        const stock = snapshot.resources[name];
        same("bar", textOf(seen, `hud-bar-${name}`), `${title} ${stock.stock} (${signed(stock.rate)})`, `${label}: ${name}`);
      }
      const button = nodeOf(seen, "hud-bar-end-turn");
      same("bar", [button?.visible, button?.disabled, textOf(seen, "hud-bar-end-turn-label")], [true, endTurn.enabled === 0, "End turn"],
        `${label}: End turn is visible, disabled exactly when the game's end_turn action is, and labelled`);
      same("bar", textOf(seen, "hud-bar-end-turn-reason"), endTurn.enabled === 0 ? endTurn.reason_text : undefined, `${label}: the reason End turn gives`);
      same("bar", shown(seen, "hud-turn-spinner"), snapshot.phase !== "idle", `${label}: the spinner is shown exactly while the phase is not idle`);
      for (const id of ["hud-bar-menu", "hud-bar-new-game"]) {
        if (!shown(seen, id) || nodeOf(seen, id).disabled) {
          fail("bar", `${label}: ${id} must be shown and enabled`);
        }
      }
    }
    if (expectedPanels.includes("actions")) {
      same("actions", renderedActions(seen), expectedActions(snapshot), `${label}: the actions panel`);
    }
    judgeContent(label, seen, snapshot, expectedPanels);
  }

  // What the panels say of their part of the snapshot. The pointer is not over the map in the matrix, so the card is the selected tile's.
  function judgeContent(label, seen, snapshot, expectedPanels) {
    if (expectedPanels.includes("tile")) {
      const card = snapshot.tile;
      const units = card.units.length === 0 ? "No units"
        : card.units.map(unit => `${unit.name} (${unit.owner === 1 ? "yours" : "foreign"}) ${unit.moves}/${unit.max_moves}${unit.fortified === 1 ? " fortified" : ""}`).join(" · ");
      same("content", [textOf(seen, "hud-tile-title"), textOf(seen, "hud-tile-yields"), textOf(seen, "hud-tile-units")], [
        card.present === 1 ? `Selected · (${card.x}, ${card.y}) ${card.terrain_name}` : "No tile",
        card.present === 1 ? `Food ${card.food} · Production ${card.production} · Science ${card.science} · Move ${card.move_cost}${card.city === 1 ? " · City" : ""}` : undefined,
        card.present === 1 ? units : undefined], `${label}: the tile card`);
    }
    if (expectedPanels.includes("city")) {
      const city = snapshot.city;
      same("content", [textOf(seen, "hud-city-title"), textOf(seen, "hud-city-rates"), textOf(seen, "hud-city-queue-title"),
        textOf(seen, "hud-city-buildings"), textOf(seen, "hud-city-garrison")], [
        city.present === 1 ? `${city.name} · size ${city.size}/${city.max_size}` : "No city yet",
        `Food ${snapshot.resources.food.stock}/${city.food_needed} (+${city.food_rate}) · Production +${city.production_rate} · Science +${city.science_rate}`,
        `Queue ${city.queue.length}/${city.queue_max}`,
        `Buildings: ${city.buildings.length === 0 ? "none" : city.buildings.join(", ")}`,
        `Garrison: ${city.garrison.length === 0 ? "none" : city.garrison.map(unit => `${unit.kind} #${unit.id}`).join(", ")}`], `${label}: the city screen`);
      same("content", city.queue.map(entry => textOf(seen, `hud-city-queue-${entry.slot}`)),
        city.queue.map(entry => `${entry.slot + 1}. ${entry.label} ${entry.stock}/${entry.cost}`), `${label}: the city's queue`);
      same("content", renderedRows(seen, "hud-city-item-", city.items.map(item => item.id)),
        expectedRows(city.items, item => `${item.label} (${item.cost})`), `${label}: the city's items`);
    }
    if (expectedPanels.includes("research")) {
      const research = snapshot.research;
      const current = research.techs.find(tech => tech.id === research.current);
      same("content", [textOf(seen, "hud-research-title"), textOf(seen, "hud-research-progress")], [`Research: ${current === undefined ? "none" : current.label}`,
        research.needed === 0 ? `${research.known} learned (+${research.rate})`
          : `${snapshot.resources.science.stock}/${research.needed} (+${research.rate}) · ${research.known} learned`], `${label}: the research panel`);
      same("content", renderedRows(seen, "hud-research-tech-", research.techs.map(tech => tech.id)),
        expectedRows(research.techs, tech => `${tech.label} (${tech.cost}) · ${tech.state}`), `${label}: the technologies`);
    }
    if (expectedPanels.includes("dialog")) {
      const dialog = snapshot.dialog;
      same("content", [textOf(seen, "hud-dialog-title"), textOf(seen, "hud-dialog-text")], [dialog.title, dialog.text], `${label}: the dialog`);
      same("content", dialog.choices.map(choice => [textOf(seen, `hud-dialog-choice-${choice.id}-label`), textOf(seen, `hud-dialog-choice-${choice.id}-detail`),
        nodeOf(seen, `hud-dialog-choice-${choice.id}`)?.disabled]), dialog.choices.map(choice => [choice.label, choice.detail, false]), `${label}: the dialog's choices`);
    }
  }

  // --- The turn the game processes ------------------------------------------------------------------------------------
  const phase = report.phase;
  const published = phase.published ?? [];
  if (!published.some(entry => AI_PHASES.includes(entry.phase))) {
    fail("phase", `no snapshot published at an AI phase: ${JSON.stringify(published.map(entry => entry.phase))}`);
  }
  for (const entry of published) {
    if (!PHASES.includes(entry.phase)) {
      fail("phase", `a published snapshot has the phase ${entry.phase}, which is none of the game's`);
    }
    if (entry.phase !== "idle" && (entry.endTurnEnabled !== 0 || entry.endTurnReason !== "turn_in_progress")) {
      fail("phase", `the snapshot published at ${entry.phase} leaves End turn enabled (${entry.endTurnEnabled}, ${entry.endTurnReason})`);
    }
  }
  const free = phase.free;
  const publishedPhases = new Set(published.map(entry => entry.phase));
  if (!(free.pressed && free.finished && free.settled) || free.turnAfter !== free.turnBefore + 1 || free.lastJob === 0) {
    fail("phase", `End turn pressed on the HUD must run a job to rest and advance the turn: ${JSON.stringify({...free, samples: undefined})}`);
  }
  if (free.samples.length === 0) {
    fail("phase", "no frame of the job was observed");
  }
  for (const [index, sample] of free.samples.entries()) {
    const running = sample.phase !== "idle";
    if (sample.spinner !== running || sample.endTurnDisabled !== running) {
      fail("phase", `frame ${index} of the job shows the phase "${sample.phase}" with the spinner ${sample.spinner} and End turn ${sample.endTurnDisabled ? "disabled" : "enabled"}`);
    }
    if (!publishedPhases.has(sample.phase)) {
      fail("phase", `frame ${index} of the job shows the phase "${sample.phase}", which the game did not publish`);
    }
  }
  for (const [name, sample] of [["before the job", free.idleBefore], ["after the job", free.idleAfter]]) {
    if (sample.phase !== "idle" || sample.spinner || sample.endTurnDisabled) {
      fail("phase", `at rest ${name} the bar must show idle, no spinner and End turn enabled: ${JSON.stringify(sample)}`);
    }
  }
  const held = phase.held;
  if (!AI_PHASES.includes(held.gamePhase) || held.sample.phase !== held.gamePhase || !held.sample.spinner || !held.sample.animating || !held.sample.endTurnDisabled) {
    fail("phase", `held at ${held.gamePhase}, the bar must show it with the spinner spinning and End turn disabled: ${JSON.stringify(held.sample)}`);
  }
  if (held.sample.endTurnReason !== TURN_IN_PROGRESS) {
    fail("phase", `held at an AI phase, End turn must give the game's reason "${TURN_IN_PROGRESS}": ${JSON.stringify(held.sample.endTurnReason)}`);
  }
  const press = held.disabledPress;
  if (held.acceptedCalls !== 1 || press.callbacksBefore !== press.callbacksAfter || press.jobBefore !== press.jobAfter || press.hudCallsBefore !== press.hudCallsAfter) {
    fail("phase", `a press on the disabled End turn must ask nothing of the game: ${JSON.stringify({accepted: held.acceptedCalls, ...press})}`);
  }
  if (!held.finished || !held.settledAfter || held.idleAfter.spinner || held.idleAfter.endTurnDisabled || held.idleAfter.phase !== "idle" || held.turnAfter !== free.turnBefore + 2) {
    fail("phase", `released, the held job must finish with the spinner gone and End turn enabled: ${JSON.stringify(held.idleAfter)}`);
  }

  // --- Real input -----------------------------------------------------------------------------------------------------
  const step = Object.fromEntries(report.input.map(entry => [entry.label, entry]));
  const required = ["click-tile-6-8", "click-tile-9-8", "hover-tile-12-4", "hover-over-bar", "hover-off-map", "click-on-panels", "press-select-warrior",
    "press-fortify", "press-disabled-fortify", "after-menu", "click-tile-after-menu", "click-on-panels-after-menu"];
  for (const label of required) {
    if (step[label] === undefined) {
      fail("input", `the step ${label} was not run`);
    }
  }
  if (required.some(label => step[label] === undefined)) {
    return findings;
  }
  for (const [label, expectedContext] of [["click-tile-6-8", "stack"], ["click-tile-9-8", "tile"], ["click-tile-after-menu", "tile"]]) {
    const entry = step[label];
    const tile = tileAt(entry.point);
    if (!entry.reached || entry.selection.x !== tile[0] || entry.selection.y !== tile[1] || entry.context !== expectedContext) {
      fail("input", `a real left click at ${JSON.stringify(entry.point)} is on tile ${JSON.stringify(tile)}: the game's selection was (${entry.selection.x}, ${entry.selection.y}) in context ${entry.context}, expected ${expectedContext}`);
    }
    if (entry.heard.buttons < 2) {
      fail("input", `${label}: the World heard ${entry.heard.buttons} button events of the press and release`);
    }
    same("input", entry.panels, PANEL_NAMES.filter(name => TABLE[expectedContext].includes(name)).map(panelId), `${label}: the panels after the click`);
  }
  // The pointer is still over the tile it clicked, so the card is that tile's, the hovered one.
  same("input", step["click-tile-9-8"].tileTitle, "Pointer · (9, 8) Plain", "the card after the click, the pointer still over the tile");
  const hovering = step["hover-tile-12-4"];
  const hoveredTile = tileAt(hovering.point);
  if (!onMap(hoveredTile) || !hovering.reached || hovering.hover.present !== 1 || hovering.hover.x !== hoveredTile[0] || hovering.hover.y !== hoveredTile[1]
      || !hovering.tileTitle.startsWith(`Pointer · (${hoveredTile[0]}, ${hoveredTile[1]}) `)) {
    fail("input", `the pointer at ${JSON.stringify(hovering.point)} is over tile ${JSON.stringify(hoveredTile)}: the hover was ${JSON.stringify(hovering.hover)} and the card "${hovering.tileTitle}"`);
  }
  if (hovering.selection.x !== 9 || hovering.selection.y !== 8 || hovering.context !== "tile") {
    fail("input", `hovering must change no selection: (${hovering.selection.x}, ${hovering.selection.y}) in ${hovering.context}`);
  }
  for (const label of ["hover-over-bar", "hover-off-map"]) {
    const entry = step[label];
    if (!entry.reached || entry.hover.present !== 0 || entry.hover.x !== -1) {
      fail("input", `${label}: the pointer left the map and the hover must be cleared: ${JSON.stringify(entry.hover)}`);
    }
  }
  if (!inside(step["hover-over-bar"].point, step["hover-over-bar"].barRect) || onMap(tileAt(step["hover-over-bar"].point))) {
    fail("input", "the pointer meant to be over the bar is not over it, or is over the map");
  }
  same("input", step["hover-over-bar"].tileTitle, "Selected · (9, 8) Plain", "the card with the pointer over a panel is the selected tile's");
  if (onMap(tileAt(step["hover-off-map"].point))) {
    fail("input", "the pointer meant to be off the map is over a tile");
  }
  for (const label of ["click-on-panels", "click-on-panels-after-menu"]) {
    const clicks = step[label].panelClicks;
    same("input", clicks.map(click => click.panel), ["hud-tile", "hud-bar"], `${label}: the panels clicked`);
    for (const click of clicks) {
      if (!click.present || !inside(click.point, click.rect) || JSON.stringify(click.heardBefore) !== JSON.stringify(click.heardAfter)
          || JSON.stringify(click.heardAfter) !== JSON.stringify(click.heardAfterWheel) || JSON.stringify(click.selectionBefore) !== JSON.stringify(click.selectionAfter)) {
        fail("input", `${label}: a click or a tick of the wheel on ${click.panel} reached the World or moved the selection: ${JSON.stringify(click)}`);
      }
    }
  }
  // The hover is published as a change: at least one card, never the same twice running, each over a tile of the map or the absent card.
  const hovers = report.hoverPublished ?? [];
  if (hovers.length < 2) {
    fail("input", `the node published ${hovers.length} hover cards`);
  }
  for (const [index, card] of hovers.entries()) {
    if (index > 0 && JSON.stringify(card) === JSON.stringify(hovers[index - 1])) {
      fail("input", `hover card ${index} is the same as the one before it: ${JSON.stringify(card)}`);
    }
    if (card.present === 1 ? !onMap([card.x, card.y]) : (card.x !== -1 || card.y !== -1)) {
      fail("input", `hover card ${index} is over no tile of the map: ${JSON.stringify(card)}`);
    }
  }
  const selectWarrior = step["press-select-warrior"];
  if (!selectWarrior.pressed || !selectWarrior.reached || selectWarrior.context !== "warrior" || selectWarrior.selection.unit !== 2) {
    fail("input", `a real press on "Select Warrior" must select unit 2: ${JSON.stringify({context: selectWarrior.context, selection: selectWarrior.selection})}`);
  }
  const fortify = step["press-fortify"];
  const warrior = fortify.units.find(unit => unit.id === 2);
  if (!fortify.pressed || !fortify.reached || warrior?.fortified !== 1 || (fortify.callbacks.fortify ?? 0) !== fortify.fortifyCallsBefore + 1) {
    fail("input", `a real press on the enabled "Fortify" must fortify unit 2 with one call: ${JSON.stringify({unit: warrior, calls: fortify.callbacks.fortify, before: fortify.fortifyCallsBefore})}`);
  }
  const disabled = step["press-disabled-fortify"];
  const fortifyRow = disabled.actions.find(row => row.key === "fortify-2");
  if (!disabled.pressed || disabled.callbacksTotalBefore !== disabled.callbacksTotalAfter || fortifyRow === undefined || fortifyRow.enabled
      || fortifyRow.reason !== "The unit is already fortified.") {
    fail("input", `a press on the disabled "Fortify" must ask nothing of the game and the HUD must show its reason: ${JSON.stringify({pressed: disabled.pressed, row: fortifyRow, before: disabled.callbacksTotalBefore, after: disabled.callbacksTotalAfter})}`);
  }
  const menu = step["after-menu"];
  if (!menu.menuPressed || !menu.inMenu || !menu.newPressed || !menu.back || menu.hoverInMenu.present !== 0 || !(menu.worldIndex >= 0 && menu.worldIndex < menu.layerIndex)) {
    fail("input", `after the menu the World must be back, ahead of the HUD's layer (${menu.worldIndex} against ${menu.layerIndex}): ${JSON.stringify({...menu, units: undefined})}`);
  }
  return findings;
}

/** The categories a list of findings falls in, sorted. */
export const categoriesOf = findings => [...new Set(findings.map(finding => finding.category))].sort();

/** Throws when the report is not clean, with the findings. */
export function assertHudReport(report) {
  const findings = judgeHudReport(report);
  if (findings.length > 0) {
    throw new Error(`The HUD report has ${findings.length} findings:\n${findings.slice(0, 40).map(finding => `[${finding.category}] ${finding.message}`).join("\n")}`);
  }
}
