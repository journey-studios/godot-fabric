import assert from "node:assert/strict";
import path from "node:path";
import {existsSync, readdirSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {copyFile, cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import test from "node:test";
import {createHarness, hash, root} from "../scripts/consumer-harness.mjs";
import {assertHudReport, categoriesOf, COVERING, judgeHudReport, TABLE} from "./civ-lite-ui-oracle.mjs";
import {assertOverlayReport, judgeOverlayReport} from "./civ-lite-overlay-oracle.mjs";

// V05-05 `matriz`, `mapa` and `overlays`: Frontier's context-driven HUD and its blocking overlays, run for real. The consumer template (consumers/civ-lite) is provisioned
// into a project outside the checkout, built by the editor plugin with no Node of its own, and run in the official Godot with its own
// scene: the persistent GameServices node, the World, and the HUD in a full-screen FabricSurface. hud_validation.gd (in the template,
// inert unless run with `-- --validate-hud`) plays the roteiro's steps 0 to 45 through the services and observes the HUD's tree after
// each, runs the end of a turn through the HUD (every frame, then held at an AI phase), and drives real pointer events through the
// viewport. It writes the raw observations; tests/civ-lite-ui-oracle.mjs judges them again on its own, from the table of panels per
// context, the format of what each panel says and the geometry of the map, never from the probe's verdicts.
//
// A second probe, overlay_validation.gd (`-- --validate-overlays`, judged by tests/civ-lite-overlay-oracle.mjs), runs the queue of three events
// the game now holds: the dialog answered by real presses one event at a time, the HUD's Surface unmounted and mounted again with the second
// event at the head, 100 real clicks, right clicks and wheel ticks on the map under each overlay (the city screen and the dialog are
// blocking Modals) and with them closed, and a new game started with events waiting.
//
// The same run is also judged here by three things the probes cannot say of themselves:
//   - the oracle is not vacuous: a copy of the genuine report with one thing broken each, in memory, is rejected in the category it
//     breaks;
//   - two causal controls: the HUD of 5e1f6a1, taken from git into build/civ-lite-ui-previous/ when the test runs (and checked against its
//     pinned sha256), on the same scene fails the matrix and the map checks it reaches; and the game and the HUD of 622102e (the slice before
//     the queue and the overlays: one event and panels in the tree), taken by `git archive` into build/civ-lite-overlays-previous/, fail
//     the queue, the remount and the blocking checks they reach. The test records exactly which. Both need their commit in the checkout: a
//     shallow clone (hosted CI) says so and skips them, and --control makes their absence an error;
//   - with --sabotage=<name> the same test runs a project whose source scripts/civ-lite-ui-sabotage.mjs broke on purpose, and it passes
//     only if the probe's checks and the oracle both reject it, each for the reason it was broken.
//
// --capture adds the headed runs: one PNG per context (seven) and one during the AI phase with the spinner, and the city overlay and the
// dialog at 1 of 3, at 2 of 3 after the remount and at 3 of 3.
const capture = process.argv.includes("--capture");
const requireControl = process.argv.includes("--control");
const sabotageArgument = process.argv.find(argument => argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : sabotageArgument.slice("--sabotage=".length);
// The two probes: the flag that runs each, the report it writes and the marker it prints.
const PROBES = {
  hud: {flag: "--validate-hud", report: "civ-lite-ui-report.json", marker: "CIVLITE_UI"},
  overlays: {flag: "--validate-overlays", report: "civ-lite-overlay-report.json", marker: "CIVLITE_OVERLAYS"},
};
const CONTEXTS = Object.keys(TABLE);
const CONTROL_COMMIT = "5e1f6a1";
// The commit before the queue and the overlays: the game and the HUD of slice 1.
const OVERLAY_CONTROL_COMMIT = "622102e";
const CONTROL_SHA256 = "d477f51cfd3550c43087d92e552bf403a82abc329fdceaf2b581a885a9a09346";
// What hud_validation.gd and overlay_validation.gd count in a run with no capture, and the captures a headed run adds (eight, and four).
const EXPECTED_CHECKS = 144;
const EXPECTED_OVERLAY_CHECKS = 26;
const CAPTURES = [...CONTEXTS, "ai-phase"];
const OVERLAY_CAPTURES = ["city", "dialog-1", "dialog-2-remounted", "dialog-3"];
// What each retained sabotage must make the probe and the oracle say. `failed` are patterns of the probe's failed checks and
// `categories` the oracle's categories that must be among the findings (scripts/civ-lite-ui-sabotage.mjs says what each breaks).
const SABOTAGES = {
  "city-by-data": {categories: ["panels"], failed: [/the HUD showed .* for the (none|tile|stack|settler|warrior|dialog) context/]},
  "actions-reversed": {categories: ["actions"], failed: [/the actions panel lists the snapshot's actions but End turn, in order/]},
  "spinner-always": {categories: ["bar", "phase"], failed: [/the bar's End turn is enabled exactly as the game's end_turn action says/, /At rest before the job the spinner is not shown/]},
  "end-turn-by-phase": {categories: ["bar"], failed: [/the bar's End turn is enabled exactly as the game's end_turn action says/]},
  "spacer": {categories: ["map", "input"], failed: [/No Control of the HUD in the tree that stops the pointer covers the map/, /A real left click on tile \(6, 8\) selected it/]},
  "hover-unpublished": {categories: ["input"], failed: [/The pointer over tile \(12, 4\) published the hover/]},
  "world-behind-hud": {categories: ["input"], failed: [/Through the menu and back, the World returned ahead of the HUD's layer/, /After the menu, a click and a tick of the wheel on a panel still do not reach the World/]},
  "disabled-ignored": {categories: ["actions", "bar", "phase", "input"], failed: [/the actions panel lists the snapshot's actions but End turn, in order/, /A press on the disabled End turn asks nothing of the game/]},
  "queue-out-of-order": {categories: ["queue", "remount"], failed: [/The dialog showed the three events in the game's order, one at a time/, /A real press on a choice answered the head once and the game moved on/]},
  "position-in-js": {categories: ["queue"], failed: [/the HUD showed the position the game gave/]},
  "city-in-tree": {categories: ["panels", "map", "blocking"], failed: [/The Modal covers the whole map in every step of the city and dialog contexts/, /With the city screen open, 100 left clicks, 100 right clicks and 100 wheel ticks on the map reach the World 0 times/]},
  "dialog-unkeyed": {categories: ["queue"], failed: [/Each event of the queue was a subtree of its own/]},
};
assert.ok(sabotage === null || sabotage in SABOTAGES, `Unknown sabotage: ${sabotage}`);

const lane = sabotage === null ? "civ-lite-ui" : `civ-lite-ui-sabotage-${sabotage}`;
const sourcesUnder = (directory, prefix = "") => readdirSync(directory, {withFileTypes: true}).flatMap(entry => entry.isDirectory()
  ? sourcesUnder(path.join(directory, entry.name), `${prefix}${entry.name}/`) : /\.tsx?$/.test(entry.name) ? [`${prefix}${entry.name}`] : []);

// One probe run on a provisioned project: the log and the report it wrote, both kept in build/<lane>/.
async function probe(harness, label, {mode = "hud", headed = false, expectFailures = false} = {}) {
  const {flag, report: reportFile} = PROBES[mode];
  await rm(path.join(harness.project, reportFile), {force: true});
  const log = await harness.run(label, harness.godot, ["--path", harness.project, ...(headed ? [] : ["--headless"]), "--", flag,
    ...(headed ? ["--capture"] : []), ...(expectFailures ? ["--sabotage"] : [])]);
  const report = JSON.parse(await readFile(path.join(harness.project, reportFile), "utf8"));
  await writeFile(path.join(harness.directory, `${label}.json`), JSON.stringify(report, null, 2) + "\n");
  return {log, report};
}

const IMPORT = /^\s*import\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;
// The HUD of the commit before this slice, as git has it: the control's `ui/index.tsx`, byte for byte.
const commitAvailable = commit => spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], {cwd: root}).status === 0;
const controlAvailable = () => commitAvailable(CONTROL_COMMIT);
async function previousHud() {
  const shown = spawnSync("git", ["show", `${CONTROL_COMMIT}:consumers/civ-lite/ui/index.tsx`], {cwd: root, maxBuffer: 8 * 1024 * 1024});
  assert.equal(shown.status, 0, `git show ${CONTROL_COMMIT}:consumers/civ-lite/ui/index.tsx: ${shown.stderr}`);
  assert.equal(hash(shown.stdout), CONTROL_SHA256, `the control is the HUD of ${CONTROL_COMMIT}, byte for byte`);
  const directory = path.join(root, "build", "civ-lite-ui-previous");
  await mkdir(directory, {recursive: true});
  await writeFile(path.join(directory, "index.tsx"), shown.stdout);
  return readFile(path.join(directory, "index.tsx"));
}

// Directories of the template as a commit had them, by `git archive` into build/civ-lite-overlays-previous/, with a digest of the archive.
async function previousTemplate(commit, names) {
  const directory = path.join(root, "build", "civ-lite-overlays-previous");
  await rm(directory, {recursive: true, force: true});
  await mkdir(directory, {recursive: true});
  const archive = spawnSync("git", ["archive", commit, ...names.map(name => `consumers/civ-lite/${name}`)], {cwd: root, maxBuffer: 64 * 1024 * 1024});
  assert.equal(archive.status, 0, `git archive ${commit}: ${archive.stderr}`);
  const unpack = spawnSync("tar", ["-x", "-C", directory], {input: archive.stdout});
  assert.equal(unpack.status, 0, String(unpack.stderr));
  // The template's own directories are at consumers/civ-lite/ inside the archive.
  const inner = path.join(directory, "consumers", "civ-lite");
  return {directory: inner, sha256: hash(archive.stdout)};
}

const failedChecks = report => report.checks.filter(check => !check.passed).map(check => check.name);

// The oracle's own proof that it can fail: each case breaks one thing in a copy of the genuine report and names the category the
// oracle must report. A case that finds nothing to break is an error, so a change of the report cannot make a mutation vacuous.
const row = (report, context) => report.matrix[COVERING[context]];
const node = (observed, id) => observed.nodes.find(entry => entry.testID === id);
const inputStep = (report, label) => report.input.find(entry => entry.label === label);
const MUTATIONS = [
  {name: "a panel the context mounts is missing", category: "panels", change: report => { node(row(report, "city").observed, "hud-city").visible = false; }},
  {name: "a panel the context does not mount is shown", category: "panels", change: report => { row(report, "none").observed.nodes.push({testID: "hud-tile", kind: "view", visible: true, text: "", rect: [24, 416, 576, 92], stops: true, disabled: false, animating: false, modal: false}); }},
  {name: "an unowned testID is mounted", category: "panels", change: report => { row(report, "tile").observed.nodes.push({testID: "hud-extra", kind: "view", visible: false, text: "", rect: [0, 0, 1, 1], stops: false, disabled: false, animating: false, modal: false}); }},
  {name: "the actions are listed in another order", category: "actions", change: report => { const [first, second] = ["hud-actions-select_unit-1", "hud-actions-select_unit-2"].map(id => node(row(report, "stack").observed, id)); [first.rect, second.rect] = [second.rect, first.rect]; }},
  {name: "a disabled action is shown enabled", category: "actions", change: report => { node(row(report, "settler").observed, "hud-actions-fortify-1").disabled = false; }},
  {name: "a reason is not the game's", category: "actions", change: report => { node(row(report, "settler").observed, "hud-actions-fortify-1-reason").text = "Nope."; }},
  {name: "the spinner is shown at rest", category: "bar", change: report => { row(report, "none").observed.nodes.push({testID: "hud-turn-spinner", kind: "activity", visible: true, text: "", rect: [0, 0, 20, 20], stops: false, disabled: false, animating: true, modal: false}); }},
  {name: "End turn is enabled while the game says it is not", category: "bar", change: report => { node(row(report, "dialog").observed, "hud-bar-end-turn").disabled = false; }},
  {name: "a resource is not the snapshot's", category: "bar", change: report => { node(row(report, "city").observed, "hud-bar-food").text = "Food 99 (+0)"; }},
  {name: "a Control in the tree that stops the pointer covers the map", category: "map", change: report => { row(report, "none").observed.stoppers.push({testID: "", rect: [0, 0, 624, 600], modal: false}); }},
  {name: "the overlay of the dialog does not block the map", category: "map", change: report => { row(report, "dialog").observed.stoppers = row(report, "dialog").observed.stoppers.filter(stopper => !stopper.modal); }},
  {name: "a Modal's window is open in a context that has no overlay", category: "map", change: report => { row(report, "tile").observed.stoppers.push({testID: "hud-city-overlay", rect: [0, 0, 1080, 600], modal: true}); }},
  {name: "the city screen is in the tree and not in the Modal", category: "panels", change: report => { node(row(report, "city").observed, "hud-city").modal = false; }},
  {name: "the tile card says another tile", category: "content", change: report => { node(row(report, "tile").observed, "hud-tile-title").text = "Selected · (1, 1) Water"; }},
  {name: "the dialog's position is not the game's", category: "content", change: report => { node(row(report, "dialog").observed, "hud-dialog-position").text = "3 of 3"; }},
  {name: "the dialog's choice is not the game's", category: "content", change: report => { node(row(report, "dialog").observed, "hud-dialog-choice-welcome-label").text = "Run away"; }},
  {name: "a frame of the job shows the spinner at an idle phase", category: "phase", change: report => { report.phase.free.samples.push({phase: "idle", spinner: true, animating: true, endTurnDisabled: false, endTurnReason: "", turn: ""}); }},
  {name: "the disabled End turn asked the game", category: "phase", change: report => { report.phase.held.disabledPress.callbacksAfter += 1; }},
  {name: "no snapshot was published at an AI phase", category: "phase", change: report => { report.phase.published = report.phase.published.filter(entry => !["ai_plan", "ai_move"].includes(entry.phase)); }},
  {name: "a click selected another tile than the one under it", category: "input", change: report => { inputStep(report, "click-tile-9-8").selection.x = 10; }},
  {name: "the hover is not the tile under the pointer", category: "input", change: report => { inputStep(report, "hover-tile-12-4").hover.x = 3; }},
  {name: "a click on a panel reached the World", category: "input", change: report => { inputStep(report, "click-on-panels").panelClicks[0].heardAfter.buttons += 2; }},
  {name: "a tick of the wheel on a panel reached the World", category: "input", change: report => { inputStep(report, "click-on-panels-after-menu").panelClicks[1].heardAfterWheel.buttons += 2; }},
  {name: "the node published the same hover card twice running", category: "input", change: report => { report.hoverPublished.splice(1, 0, structuredClone(report.hoverPublished[0])); }},
  {name: "a bar that forgot the game's reason", category: "bar", change: report => { node(row(report, "dialog").observed, "hud-bar-end-turn-reason").text = ""; }},
  {name: "a press on a disabled action asked the game", category: "input", change: report => { inputStep(report, "press-disabled-fortify").callbacksTotalAfter += 1; }},
  {name: "the World came back behind the HUD's layer", category: "input", change: report => { const menu = inputStep(report, "after-menu"); menu.worldIndex = menu.layerIndex + 1; }},
];

// The same for the overlay oracle: a copy of the genuine overlay report with one thing broken, and the category that must say so.
const round = (report, index) => report.queue.rounds[index];
const OVERLAY_MUTATIONS = [
  {name: "the dialog showed the events out of order", category: "queue", change: report => { [round(report, 0).dialog.id, round(report, 1).dialog.id] = [round(report, 1).dialog.id, round(report, 0).dialog.id]; }},
  {name: "the HUD's position is not the game's", category: "queue", change: report => { round(report, 1).hud.position = "1 of 3"; }},
  {name: "the HUD says another event's words", category: "queue", change: report => { round(report, 2).hud.title = "Wanderers at the gate"; }},
  {name: "another intent was accepted while an event waited", category: "queue", change: report => { Object.assign(round(report, 0).refusals[0], {ok: 1, code: "ok"}); }},
  {name: "a refused intent changed the state", category: "queue", change: report => { round(report, 1).untouched = false; }},
  {name: "a press answered the head twice", category: "queue", change: report => { round(report, 0).resolveCalls = 2; }},
  {name: "the game recorded the answers out of order", category: "queue", change: report => { round(report, 2).after.events.resolved.reverse(); }},
  {name: "a frame between two heads showed a third event", category: "queue", change: report => { round(report, 0).samples.push({shown: true, modal: true, instance: 1, position: "3 of 3", title: "A scholar asks for shelter", text: "", choices: []}); }},
  {name: "two events shared a subtree", category: "queue", change: report => { round(report, 1).hud.instance = round(report, 0).hud.instance; }},
  {name: "the dialog is in the tree and not in the Modal", category: "queue", change: report => { round(report, 0).hud.modal = false; }},
  {name: "the remounted HUD shows the first event", category: "remount", change: report => { Object.assign(report.remount.remounted.hud, {title: "Wanderers at the gate", position: "1 of 3"}); }},
  {name: "a frame after the mount flashed another event", category: "remount", change: report => { report.remount.remounted.samples.push({shown: true, modal: true, instance: 1, position: "1 of 3", title: "Wanderers at the gate", text: "", choices: []}); }},
  {name: "the game lost its queue while the Surface was unmounted", category: "remount", change: report => { report.remount.remounted.whileUnmounted.events.queue = []; }},
  {name: "the city screen came back in the tree", category: "remount", change: report => { report.remount.city.modal = false; }},
  {name: "a click reached the world under the city overlay", category: "blocking", change: report => { report.blocking.cityOpen[0].heardAfter.buttons += 2; }},
  {name: "a wheel tick selected a tile under the dialog", category: "blocking", change: report => { report.blocking.dialogOpen[2].selectCalls = 1; }},
  {name: "the clicks do not reach the world after the overlay closed", category: "blocking", change: report => { report.blocking.cityAfter[0].heardAfter.buttons -= 2; }},
  {name: "a Pressable in the overlay does nothing", category: "blocking", change: report => { report.blocking.cityPress.calls = 0; }},
  {name: "the new session kept the queue", category: "newgame", change: report => { report.newGame.fresh.events.queue = ["scholar"]; }},
  {name: "the new session did not raise its own events", category: "newgame", change: report => { report.newGame.raised.events.queue = []; }},
];

if (sabotage === null) {
  test("Frontier's HUD mounts the panels of each context, shows the turn and takes the pointer the World leaves it", {timeout: 900000}, async t => {
    const harness = await createHarness({template: "civ-lite", name: lane});
    t.after(() => harness.cleanup());
    const {directory, project, verify} = harness;
    await harness.provision();
    await harness.editor("editor");

    // The sources the V05-05 criteria name: a store at module scope, six panels in one folder, public imports, no hover, no right click
    // and no listener of the HUD's own anywhere but the store's subscription.
    const ui = path.join(project, "ui");
    const files = sourcesUnder(ui);
    const panels = ["actions", "bar", "city", "dialog", "research", "tile"];
    verify(["index.tsx", "store.ts", "telemetry.ts", "frontier-types.ts", "hud/hud.tsx", "hud/kit.tsx", "hud/overlay.tsx", ...panels.map(name => `hud/${name}.tsx`)].every(file => files.includes(file)),
      "The HUD is a store at module scope, one file for each of the six panels and the switch");
    const source = async file => (await readFile(path.join(ui, file), "utf8")).replace(/^\s*\/\/.*$/gm, "");
    const hudFiles = files.filter(file => file === "index.tsx" || file.startsWith("hud/"));
    const forbidden = /\b(useEffect|useLayoutEffect|useRef|useImperativeHandle|addEventListener|removeEventListener|onHoverIn|onHoverOut|onContextMenu|onAuxClick|onMouseEnter|onMouseLeave|GodotFabric|callFrontier)\b/;
    for (const file of hudFiles) {
      assert.doesNotMatch(await source(file), forbidden, `${file} holds an effect, a listener, a hover or right-click handler or talks to the game: only the store does`);
    }
    verify(true, "No panel, the switch or the entry holds an effect, a ref, an event listener, a hover or right-click handler, and none talks to the game itself");
    const store = await source("store.ts");
    assert.match(store, /useSyncExternalStore/);
    assert.doesNotMatch(store, /\b(useEffect|addEventListener|removeEventListener)\b/);
    assert.equal((store.match(/GodotFabric\.connect</g) ?? []).length, 2, "the store holds one connection to the snapshot and one to the hover");
    verify(true, "The store reads through useSyncExternalStore and connects to exactly two states, the snapshot and the hover, with no effect and no listener");
    // What the validation reads is not the store's: it lives in telemetry.ts, which talks to nothing of the game.
    const telemetry = await source("telemetry.ts");
    assert.doesNotMatch(telemetry, /@godot-fabric\/runtime|GodotFabric|useSyncExternalStore/);
    assert.match(telemetry, /globalThis\.FrontierHud/);
    assert.doesNotMatch(store, /globalThis|\bseen\b|\bKEPT\b/);
    verify(true, "The validation's telemetry (FrontierHud) is a module of its own that the store only tells what it received and sent");
    const switchSource = await source("hud/hud.tsx");
    assert.doesNotMatch(switchSource, /\.present\b/, "a panel is gated on the context, never on whether the city or the dialog has data");
    assert.match(switchSource, /<Overlay id="hud-city-overlay"/);
    assert.match(switchSource, /<Overlay id="hud-dialog-overlay"/);
    assert.match(await source("hud/overlay.tsx"), /<Modal [^>]*transparent[^>]*animationType="none"[^>]*presentationStyle="overFullScreen"/);
    verify(true, "The switch gates the panels on the context alone: no panel looks at city.present or dialog.open");
    const imported = await Promise.all(files.map(async file => [...(await source(file)).matchAll(IMPORT)].map(match => match[1])));
    const imports = new Set(imported.flat());
    verify([...imports].every(name => ["react", "react-native", "@godot-fabric/runtime"].includes(name) || name.startsWith(".")),
      `The HUD imports ${[...imports].filter(name => !name.startsWith(".")).sort().join(", ")} and its own files`);

    // The genuine run, headless.
    const {log, report} = await probe(harness, "headless");
    assert.match(log, /CIVLITE_UI_PASSED/);
    assert.deepEqual(failedChecks(report), [], "every check of the probe passed");
    assert.equal(report.checks.length, EXPECTED_CHECKS, "the probe ran the checks it is built of");
    verify(report.checks.length > 0 && report.displayServer === "headless", `The probe ran ${report.checks.length} checks headless and every one passed`);
    assertHudReport(report);
    verify(true, "The independent oracle accepts the run: the panels of the seven contexts, the actions, the bar, the turn, the pointer");

    // The shape of what was observed, read again here: the oracle judged it, this says what it covered.
    assert.equal(report.matrix.length, 46);
    assert.deepEqual(Object.fromEntries(CONTEXTS.map(context => [context, row(report, context).snapshot.context])), Object.fromEntries(CONTEXTS.map(context => [context, context])));
    for (const context of CONTEXTS) {
      assert.deepEqual(row(report, context).panels.map(id => id.slice("hud-".length)), TABLE[context], `${context} mounts ${TABLE[context].join(", ")}`);
    }
    verify(true, "The seven covering steps (stack 2, settler 3, warrior 9, city 18, tile 32, none 33, dialog 45) mounted exactly the table's panels");

    // The oracle can fail: each mutation of a copy of the report is rejected in the category it breaks.
    assert.deepEqual(judgeHudReport(report), []);
    for (const mutation of MUTATIONS) {
      const mutated = structuredClone(report);
      mutation.change(mutated);
      assert.notDeepEqual(mutated, report, `${mutation.name}: the mutation changed nothing`);
      const found = judgeHudReport(mutated);
      assert.ok(categoriesOf(found).includes(mutation.category), `${mutation.name}: the oracle must report ${mutation.category}, and found ${JSON.stringify(categoriesOf(found))}`);
    }
    verify(true, `The oracle rejects each of ${MUTATIONS.length} mutated copies of the report, in the category each breaks`);
    const summary = {format: "godot-fabric.civ-lite-ui/v2", steps: report.matrix.length, checks: report.checks.length, covering: report.covering,
      published: report.phase.published.map(entry => entry.phase), framesObserved: report.phase.free.samples.length,
      mutations: MUTATIONS.map(mutation => ({name: mutation.name, category: mutation.category}))};

    // The overlay probe: the queue of three, the remount and the blocking Modals, headless.
    const overlays = await probe(harness, "overlays", {mode: "overlays"});
    assert.match(overlays.log, /CIVLITE_OVERLAYS_PASSED/);
    assert.deepEqual(failedChecks(overlays.report), [], "every check of the overlay probe passed");
    assert.equal(overlays.report.checks.length, EXPECTED_OVERLAY_CHECKS, "the overlay probe ran the checks it is built of");
    assertOverlayReport(overlays.report);
    verify(true, `The overlay probe ran ${overlays.report.checks.length} checks and the independent oracle accepts them: the queue of three in order, the remount, the blocking Modals`);
    assert.deepEqual(judgeOverlayReport(overlays.report), []);
    for (const mutation of OVERLAY_MUTATIONS) {
      const mutated = structuredClone(overlays.report);
      mutation.change(mutated);
      assert.notDeepEqual(mutated, overlays.report, `${mutation.name}: the mutation changed nothing`);
      const found = judgeOverlayReport(mutated);
      assert.ok(categoriesOf(found).includes(mutation.category), `${mutation.name}: the overlay oracle must report ${mutation.category}, and found ${JSON.stringify(categoriesOf(found))}`);
    }
    verify(true, `The overlay oracle rejects each of ${OVERLAY_MUTATIONS.length} mutated copies of its report, in the category each breaks`);
    summary.overlays = {checks: overlays.report.checks.length, rounds: overlays.report.queue.rounds.map(entry => [entry.dialog.id, entry.dialog.index, entry.dialog.count, entry.pick]),
      remountFrames: overlays.report.remount.remounted.samples.length, mutations: OVERLAY_MUTATIONS.map(mutation => ({name: mutation.name, category: mutation.category}))};

    // The causal control: the HUD of 5e1f6a1 on the same scene fails what the new HUD passes.
    let controlSummary = {commit: CONTROL_COMMIT, skipped: "the commit is not in this checkout"};
    if (requireControl || controlAvailable()) {
      const control = await createHarness({template: "civ-lite", name: "civ-lite-ui-control"});
      t.after(() => control.cleanup());
      await control.provision();
      const old = await previousHud();
      await rm(path.join(control.project, "ui", "hud"), {recursive: true, force: true});
      await rm(path.join(control.project, "ui", "store.ts"), {force: true});
      await rm(path.join(control.project, "ui", "telemetry.ts"), {force: true});
      await writeFile(path.join(control.project, "ui", "index.tsx"), old);
      await control.editor("editor");
      const controlRun = await probe(control, "control", {expectFailures: true});
      const controlFindings = judgeHudReport(controlRun.report);
      const controlFailed = failedChecks(controlRun.report);
      assert.ok(controlFailed.length > 0 && controlFindings.length > 0, `the HUD of ${CONTROL_COMMIT} must fail the lane`);
      await writeFile(path.join(directory, "control-observed.json"), JSON.stringify({
        format: "godot-fabric.civ-lite-ui-control/v1", commit: CONTROL_COMMIT, sha256: CONTROL_SHA256, failedChecks: controlFailed, categories: categoriesOf(controlFindings),
        findingCounts: Object.fromEntries(categoriesOf(controlFindings).map(category => [category, controlFindings.filter(finding => finding.category === category).length])),
        findings: controlFindings.filter(finding => finding.category !== "phase").slice(0, 60).map(finding => `[${finding.category}] ${finding.message.slice(0, 240)}`),
        phaseFindings: controlFindings.filter(finding => finding.category === "phase").slice(0, 6).map(finding => finding.message.slice(0, 240)),
        matrixSteps: controlRun.report.matrix.length, panelsShownAtCovering: Object.fromEntries(CONTEXTS.map(context => [context, row(controlRun.report, context).panels])),
      }, null, 2) + "\n");
      assert.ok(categoriesOf(controlFindings).includes("panels") && categoriesOf(controlFindings).includes("input"), `the HUD of ${CONTROL_COMMIT} fails the matrix and the map input: ${JSON.stringify(categoriesOf(controlFindings))}`);
      verify(true, `The HUD of ${CONTROL_COMMIT} fails the lane: ${JSON.stringify(categoriesOf(controlFindings))} (${controlFailed.length} checks of the probe)`);
      controlSummary = {commit: CONTROL_COMMIT, categories: categoriesOf(controlFindings), failedChecks: controlFailed.length};
    } else {
      console.log(`CIVLITE_UI_CONTROL_SKIPPED: ${CONTROL_COMMIT} is not in this checkout (a shallow clone); run with --control where it is`);
    }

    // The causal control of the overlays: the game and the HUD of 622102e (one event, panels in the tree) on the same scene and probe.
    let overlayControlSummary = {commit: OVERLAY_CONTROL_COMMIT, skipped: "the commit is not in this checkout"};
    if (requireControl || commitAvailable(OVERLAY_CONTROL_COMMIT)) {
      const control = await createHarness({template: "civ-lite", name: "civ-lite-overlays-control"});
      t.after(() => control.cleanup());
      await control.provision();
      const previous = await previousTemplate(OVERLAY_CONTROL_COMMIT, ["game", "services", "ui"]);
      for (const directoryName of ["game", "services", "ui"]) {
        await rm(path.join(control.project, directoryName), {recursive: true, force: true});
        await cp(path.join(previous.directory, directoryName), path.join(control.project, directoryName), {recursive: true});
      }
      await control.editor("editor");
      const controlRun = await probe(control, "overlays-control", {mode: "overlays", expectFailures: true});
      const controlFindings = judgeOverlayReport(controlRun.report);
      const controlFailed = failedChecks(controlRun.report);
      assert.ok(controlFailed.length > 0 && controlFindings.length > 0, `the game and the HUD of ${OVERLAY_CONTROL_COMMIT} must fail the overlay lane`);
      await writeFile(path.join(directory, "overlays-control-observed.json"), JSON.stringify({
        format: "godot-fabric.civ-lite-overlays-control/v1", commit: OVERLAY_CONTROL_COMMIT, archived: previous.sha256, failedChecks: controlFailed, categories: categoriesOf(controlFindings),
        findingCounts: Object.fromEntries(categoriesOf(controlFindings).map(category => [category, controlFindings.filter(finding => finding.category === category).length])),
        findings: controlFindings.slice(0, 60).map(finding => `[${finding.category}] ${finding.message.slice(0, 240)}`),
      }, null, 2) + "\n");
      for (const category of ["queue", "remount", "blocking"]) {
        assert.ok(categoriesOf(controlFindings).includes(category), `the game and the HUD of ${OVERLAY_CONTROL_COMMIT} fail ${category}: ${JSON.stringify(categoriesOf(controlFindings))}`);
      }
      verify(true, `The game and the HUD of ${OVERLAY_CONTROL_COMMIT} fail the overlay lane: ${JSON.stringify(categoriesOf(controlFindings))} (${controlFailed.length} checks of the probe)`);
      overlayControlSummary = {commit: OVERLAY_CONTROL_COMMIT, categories: categoriesOf(controlFindings), failedChecks: controlFailed.length};
    } else {
      console.log(`CIVLITE_UI_CONTROL_SKIPPED: ${OVERLAY_CONTROL_COMMIT} is not in this checkout (a shallow clone); run with --control where it is`);
    }

    if (capture) {
      const {log: headedLog, report: headed} = await probe(harness, "graphical", {headed: true});
      assert.match(headedLog, /CIVLITE_UI_PASSED/);
      assert.deepEqual(failedChecks(headed), [], "every check of the headed run passed");
      assert.equal(headed.checks.length, report.checks.length + CAPTURES.length, "the headed run adds the eight captures");
      assertHudReport(headed);
      const captures = {};
      for (const stage of CAPTURES) {
        const file = path.join(directory, `${stage}.png`);
        await copyFile(path.join(project, `civ-lite-ui-${stage}.png`), file);
        const bytes = await readFile(file);
        assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${stage}.png is a PNG`);
        captures[stage] = {sha256: hash(bytes), bytes: bytes.length};
      }
      assert.equal(new Set(Object.values(captures).map(entry => entry.sha256)).size, CAPTURES.length, "the eight captures are eight different pictures");
      summary.captures = captures;
      verify(true, `The headed run saved ${CAPTURES.length} captures: one per context and one in the AI phase`);
      const {log: overlaysLog, report: overlaysHeaded} = await probe(harness, "overlays-graphical", {mode: "overlays", headed: true});
      assert.match(overlaysLog, /CIVLITE_OVERLAYS_PASSED/);
      assert.deepEqual(failedChecks(overlaysHeaded), [], "every check of the headed overlay run passed");
      assert.equal(overlaysHeaded.checks.length, overlays.report.checks.length + OVERLAY_CAPTURES.length, "the headed overlay run adds its four captures");
      assertOverlayReport(overlaysHeaded);
      summary.overlayCaptures = {};
      for (const stage of OVERLAY_CAPTURES) {
        const file = path.join(directory, `overlay-${stage}.png`);
        await copyFile(path.join(project, `civ-lite-overlay-${stage}.png`), file);
        const bytes = await readFile(file);
        assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `overlay-${stage}.png is a PNG`);
        summary.overlayCaptures[stage] = {sha256: hash(bytes), bytes: bytes.length};
      }
      assert.equal(new Set(Object.values(summary.overlayCaptures).map(entry => entry.sha256)).size, OVERLAY_CAPTURES.length, "the four overlay captures are four different pictures");
      verify(true, `The headed overlay run saved ${OVERLAY_CAPTURES.length} captures: the city overlay and the dialog at 1 of 3, 2 of 3 after the remount and 3 of 3`);
    }

    summary.control = controlSummary;
    summary.overlaysControl = overlayControlSummary;
    await writeFile(path.join(directory, "summary.json"), JSON.stringify({...summary, checks: harness.checks}, null, 2) + "\n");
    assert.ok(existsSync(path.join(directory, "headless.json")));
    console.log(`CIVLITE_UI_LANE_PASSED: ${report.checks.length} + ${overlays.report.checks.length} probe checks; ${MUTATIONS.length} + ${OVERLAY_MUTATIONS.length} oracle mutations; controls ${controlSummary.categories === undefined ? "not run" : `fail ${JSON.stringify(controlSummary.categories)}`} and ${overlayControlSummary.categories === undefined ? "not run" : `fail ${JSON.stringify(overlayControlSummary.categories)}`}`);
  });
} else {
  // A retained sabotage: the project was broken on purpose, and the probe and the oracle must both reject it.
  test(`the ${sabotage} sabotage is rejected by the probe and by the oracle`, {timeout: 600000}, async t => {
    const harness = await createHarness({template: "civ-lite", name: lane});
    t.after(() => harness.cleanup());
    const expected = SABOTAGES[sabotage];
    await rm(path.join(harness.directory, "observed.json"), {force: true});
    await harness.provision();
    await harness.editor("editor");
    // Both probes run on the broken project, each with the verdict of its own; what they and the oracles say is added up.
    const hudRun = await probe(harness, "headless", {expectFailures: true});
    const overlayRun = await probe(harness, "overlays", {mode: "overlays", expectFailures: true});
    const failed = [...failedChecks(hudRun.report), ...failedChecks(overlayRun.report)];
    const findings = [...judgeHudReport(hudRun.report), ...judgeOverlayReport(overlayRun.report)];
    for (const run of [hudRun, overlayRun]) {
      const own = failedChecks(run.report).length;
      assert.ok(own === 0 || new RegExp(`_REJECTED: ${own}\\b`).test(run.log), "a probe that has failed checks says it rejected the project");
    }
    assert.ok(failed.length > 0, "the probes reject the sabotaged project");
    assert.ok(findings.length > 0, "the oracles reject the sabotaged project");
    for (const pattern of expected.failed) {
      assert.ok(failed.some(name => pattern.test(name)), `${pattern} is among the failed checks:\n${failed.join("\n")}`);
    }
    for (const category of expected.categories) {
      assert.ok(categoriesOf(findings).includes(category), `the oracle must report ${category}, and found ${JSON.stringify(categoriesOf(findings))}:\n${findings.slice(0, 8).map(finding => finding.message).join("\n")}`);
    }
    await writeFile(path.join(harness.directory, "observed.json"), JSON.stringify({
      format: "godot-fabric.civ-lite-ui-sabotage-run/v1", sabotage, failedChecks: failed, categories: categoriesOf(findings),
      findings: findings.slice(0, 12).map(finding => `[${finding.category}] ${finding.message.slice(0, 240)}`),
    }, null, 2) + "\n");
    console.log(`CIVLITE_UI_SABOTAGE_REJECTED: ${sabotage}: ${failed.length} failed checks, ${findings.length} findings in ${JSON.stringify(categoriesOf(findings))}`);
  });
}
