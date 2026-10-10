import assert from "node:assert/strict";
import path from "node:path";
import {existsSync, readdirSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {copyFile, cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import test from "node:test";
import {createHarness, hash, root} from "../scripts/consumer-harness.mjs";
import {assertHudReport, categoriesOf, COVERING, judgeHudReport, TABLE} from "./civ-lite-ui-oracle.mjs";
import {assertOverlayReport, judgeOverlayReport} from "./civ-lite-overlay-oracle.mjs";
import {assertStabilityReport, judgeStabilityReport} from "./civ-lite-stability-oracle.mjs";
import {leftOut, scanHud} from "./civ-lite-hud-scan.mjs";
import {renderIcons} from "../scripts/civ-lite-icons.mjs";

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
// A third probe, stability_validation.gd (`-- --validate-stability`, judged by tests/civ-lite-stability-oracle.mjs), opens and closes each overlay twenty
// times (the city screen by a real click and a real press on Close, then by Escape; the dialog by a new game played to turn 5 and the three events answered by
// real presses) and measures at rest after every close what a leak would grow: the tree's nodes, orphans and Windows, the native views, the pointer routes, the
// registry's subscriptions, the HUD's connections, the signal's, the Hermes heap; focus as the host can say it; and the Images (the HUD's icons) that each
// context mounts, inside and outside the Modal. The static scan also reads the HUD against the 0.5 manifest (tests/civ-lite-hud-scan.mjs).
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
// Arm B of the 0.5 comparison (V05-10, `braco-b`): the same game with a native Godot HUD (consumers/civ-lite/native_hud/), on the second scene
// main_native.tscn. A second test below runs the same probes on it, through the reader seam (hud_reader.gd), and judges them with the same
// oracles: the same table of panels per context, the same 46 steps of the matrix, the same rules. Its causal control is a native HUD that ignores
// the context, and its retained sabotages (the `native-*` ones below) break the native HUD on purpose.
//
// --capture adds the headed runs: one PNG per context (seven) and one during the AI phase with the spinner, and the city overlay and the
// dialog at 1 of 3, at 2 of 3 after the remount and at 3 of 3; and, of the stability run, the bar, the actions and the city screen with their icons, and the
// city screen and the dialog in the first and in the last cycle.
const capture = process.argv.includes("--capture");
const requireControl = process.argv.includes("--control");
const sabotageArgument = process.argv.find(argument => argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : sabotageArgument.slice("--sabotage=".length);
// The two probes: the flag that runs each, the report it writes and the marker it prints.
const PROBES = {
  hud: {flag: "--validate-hud", report: "civ-lite-ui-report.json", marker: "CIVLITE_UI"},
  overlays: {flag: "--validate-overlays", report: "civ-lite-overlay-report.json", marker: "CIVLITE_OVERLAYS"},
  stability: {flag: "--validate-stability", report: "civ-lite-stability-report.json", marker: "CIVLITE_STABILITY"},
};
const CONTEXTS = Object.keys(TABLE);
// The second scene: the game with the native HUD, no Application and no Surface.
const NATIVE_SCENE = "res://main_native.tscn";
const CONTROL_COMMIT = "5e1f6a1";
// The commit before the queue and the overlays: the game and the HUD of slice 1.
const OVERLAY_CONTROL_COMMIT = "622102e";
const CONTROL_SHA256 = "d477f51cfd3550c43087d92e552bf403a82abc329fdceaf2b581a885a9a09346";
// What hud_validation.gd and overlay_validation.gd count in a run with no capture (the HUD probe's last eight are the stress stage's, the overlay probe's last two are the Escape checks), and the captures a headed run adds (nine, and four).
const EXPECTED_CHECKS = 152;
const EXPECTED_OVERLAY_CHECKS = 28;
// What stability_validation.gd counts: 41 in a run with no capture, and the seven pictures and the comparison of the last cycle's a headed run adds.
const EXPECTED_STABILITY_CHECKS = 41;
const CAPTURES = [...CONTEXTS, "ai-phase", "stress"];
const OVERLAY_CAPTURES = ["city", "dialog-1", "dialog-2-remounted", "dialog-3"];
const STABILITY_CAPTURES = ["bar", "actions", "city", "city-1", "city-20", "dialog-1", "dialog-20"];
// The commit before this slice: its HUD has no icons and its manifest does not decide AppRegistry.
const STABILITY_CONTROL_COMMIT = "e108e9d";
const ICON_NAMES = ["settler", "warrior", "city", "food", "production", "science"];
// The generator draws one more, which neither HUD has to import to load: the Irrigate action's and the irrigated tile's (the cost-of-change experiment's base).
// What each arm does with it is measured by the lane's irrigation stage, which looks at the Images and Controls the HUD shows.
const DRAWN_ICON_NAMES = [...ICON_NAMES, "irrigation"];
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
  // The sabotages of the stress mode and of the runner's stats(): the HUD probe's stress stage rejects each, the oracle by the rule it breaks.
  "stress-rows-rebuilt": {categories: ["stress"], failed: [/Twenty steps, one a frame/]},
  "stress-end-keeps-overlay": {categories: ["stress"], failed: [/Leaving the mode removes the panel/]},
  "stats-miss-turn-ended": {categories: ["stats"], failed: [/Over a whole turn the runner's stats\(\)/]},
  "native-stress-rows-rebuilt": {arm: "native", categories: ["stress"], failed: [/Twenty steps, one a frame/]},
  "native-stats-miss-turn-ended": {arm: "native", categories: ["stats"], failed: [/Over a whole turn the runner's stats\(\)/]},
  // The sabotages of arm B break the native HUD (`arm: "native"`): the same two probes run on main_native.tscn.
  "native-city-shows-tile": {arm: "native", categories: ["panels"], failed: [/the HUD showed .* for the city context/]},
  "native-overlay-not-blocking": {arm: "native", categories: ["map", "blocking"], failed: [/The Modal covers the whole map in every step of the city and dialog contexts/,
    /With the city screen open, 100 left clicks, 100 right clicks and 100 wheel ticks on the map reach the World 0 times/]},
  "native-end-turn-by-phase": {arm: "native", categories: ["bar"], failed: [/the bar's End turn is enabled exactly as the game's end_turn action says/]},
  // The sabotages of the stability lane run its probe alone (`mode: "stability"`), or only the static scan (`mode: "scan"`, `categories` are then the findings' kinds).
  "close-leaks-connection": {mode: "stability", categories: ["leak"], failed: [/the registry's subscriptions and pending work, the HUD's connections and the signal's are the first cycle's/]},
  "modal-stays-mounted": {mode: "stability", categories: ["leak", "coverage"], failed: [/after every close the screen is at rest with the Windows the game had before/]},
  "focus-grabbed": {mode: "stability", categories: ["focus"], failed: [/no Control under it has the focus/]},
  "icon-missing": {mode: "stability", categories: ["icons"], failed: [/is visible and drew once loaded, with no error/]},
  "import-outside-manifest": {mode: "scan", categories: ["import"], failed: []},
};
assert.ok(sabotage === null || sabotage in SABOTAGES, `Unknown sabotage: ${sabotage}`);

const lane = sabotage === null ? "civ-lite-ui" : `civ-lite-ui-sabotage-${sabotage}`;
const sourcesUnder = (directory, prefix = "") => readdirSync(directory, {withFileTypes: true}).flatMap(entry => entry.isDirectory()
  ? sourcesUnder(path.join(directory, entry.name), `${prefix}${entry.name}/`) : /\.tsx?$/.test(entry.name) ? [`${prefix}${entry.name}`] : []);

// A check's name is its identity: a hosted run is compared with the committed one by the digest of the names. So no name may carry a count of
// what was observed (frames, snapshots, cards) or a time, which depend on the machine's pace: those counts are in the report's data. And the
// names a headed run shares with the headless one (all but the captures) are the same, in the same order.
const PACE_IN_A_NAME = /\b\d+ (frames?|snapshots?|cards?|samples?|published|observed|ms|milliseconds?|seconds?)\b/i;
const namesOf = report => report.checks.map(check => check.name);
const assertNamesDoNotDependOnPace = (label, report) => assert.deepEqual(namesOf(report).filter(name => PACE_IN_A_NAME.test(name)), [], `${label}: no check name carries a count that depends on the pace`);
const assertSameNamesAsHeadless = (label, headed, headless) => assert.deepEqual(namesOf(headed).filter(name => !name.startsWith("Capture saved: ")), namesOf(headless), `${label}: the headed run has the checks of the headless one, with the same names`);

// One probe run on a provisioned project: the log and the report it wrote, both kept in build/<lane>/.
async function probe(harness, label, {mode = "hud", headed = false, expectFailures = false, scene = null} = {}) {
  const {flag, report: reportFile} = PROBES[mode];
  await rm(path.join(harness.project, reportFile), {force: true});
  const log = await harness.run(label, harness.godot, ["--path", harness.project, ...(headed ? [] : ["--headless"]), ...(scene === null ? [] : [scene]), "--", flag,
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

// Directories of the template as a commit had them, by `git archive` into build/<target>/, with a digest of the archive.
async function previousTemplate(commit, names, target = "civ-lite-overlays-previous") {
  const directory = path.join(root, "build", target);
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

// The files of the HUD proper (the entry and the panels) as text, from a directory of `ui/` sources, for the static scan.
const hudSourcesIn = async ui => Object.fromEntries(await Promise.all(sourcesUnder(ui).filter(file => file === "index.tsx" || file.startsWith("hud/"))
  .map(async file => [file, await readFile(path.join(ui, file), "utf8")])));
const manifestAt = commit => JSON.parse(spawnSync("git", ["show", `${commit}:docs/compatibility/scope-0.5.json`], {cwd: root, maxBuffer: 64 * 1024 * 1024, encoding: "utf8"}).stdout);
const manifestNow = async () => JSON.parse(await readFile(path.join(root, "docs", "compatibility", "scope-0.5.json"), "utf8"));

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
  {name: "the stress panel is missing a log row", category: "stress", change: report => { report.stress.begun.log.pop(); }},
  {name: "a step built a log row again", category: "stress", change: report => { report.stress.steps.view.log[0].instance += 1; }},
  {name: "the last line the HUD shows is not the game's", category: "stress", change: report => { report.stress.steps.view.log.at(-1).text = "00220 · stale"; }},
  {name: "the HUD shows a changed item as it was", category: "stress", change: report => { report.stress.steps.view.production[0].text = "Item 00 0/100"; }},
  {name: "the snapshot after the mode differs from the one before", category: "stress", change: report => { report.stress.snapshots.after += " "; }},
  {name: "begin while a turn runs was accepted", category: "stress", change: report => { report.stress.turn.refused.ok = 1; report.stress.turn.refused.code = "ok"; }},
  {name: "the stress panel changed the panels of the context", category: "stress", change: report => { report.stress.begun.panels.push("hud-city"); }},
  {name: "a second begin was accepted", category: "stress", change: report => { report.stress.again.ok = 1; }},
  {name: "the runner's events differ from what the node emitted", category: "stats", change: report => { report.stress.final.stats.events -= 1; }},
  {name: "over a turn stats() missed a snapshot", category: "stats", change: report => { report.stress.turn.statsAfter.snapshots -= 1; }},
  {name: "stats() has a key the contract does not", category: "stats", change: report => { report.stress.turn.statsAfter.extra = 1; }},
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
  {name: "Escape on the city screen did not clear the selection", category: "escape", change: report => { report.escape.city.clearCalls = 0; }},
  {name: "Escape on the dialog answered the event", category: "escape", change: report => { report.escape.dialog.sameHead = false; }},
  {name: "Escape on the dialog reached the game", category: "escape", change: report => { report.escape.dialog.calls = 1; }},
  {name: "the new session kept the queue", category: "newgame", change: report => { report.newGame.fresh.events.queue = ["scholar"]; }},
  {name: "the new session did not raise its own events", category: "newgame", change: report => { report.newGame.raised.events.queue = []; }},
];

// The same for the stability oracle: a copy of the genuine report with one thing broken, and the category that must say so.
const cityRound = (report, index) => report.city.rounds[index];
const cityRounds = (report, how) => report.city.rounds.filter(row => row.how === how);
const dialogCycle = (report, index) => report.dialog.cycles[index];
const iconsIn = (report, label) => report.icons.find(entry => entry.label === label);
const imageIn = (report, label, testID) => iconsIn(report, label).images.find(image => image.testID === testID);
const STABILITY_MUTATIONS = [
  {name: "a city cycle leaves a node behind", category: "leak", change: report => { cityRound(report, 10).after.nodes += 1; }},
  {name: "a Window stays open after a close", category: "leak", change: report => { cityRound(report, 12).after.windows += 1; }},
  {name: "a native view is not released", category: "leak", change: report => { cityRound(report, 6).after.nativeViews += 1; }},
  {name: "a connection of the registry is not released", category: "leak", change: report => { dialogCycle(report, 7).answers[2].after.subscriptions += 1; }},
  {name: "the HUD holds a third connection while the screen is open", category: "leak", change: report => { cityRound(report, 4).open.hudSubscriptions = 3; }},
  {name: "the signal keeps a connection of a freed World", category: "leak", change: report => { dialogCycle(report, 8).open.connections += 1; }},
  {name: "a route of the pointer stays stored after a close", category: "leak", change: report => { cityRound(report, 8).after.pointerStored = 1; }},
  {name: "a suppressed pointer is left", category: "leak", change: report => { cityRound(report, 9).after.pointerSuppressed = 1; }},
  {name: "work is still pending at rest", category: "leak", change: report => { dialogCycle(report, 3).open.pendingWork = 1; }},
  {name: "a node is orphaned", category: "leak", change: report => { cityRound(report, 2).after.orphans = 1; }},
  {name: "what a cycle created it did not delete", category: "leak", change: report => { cityRound(report, 5).after.deletes -= 1; }},
  {name: "the Modal is remounted between two answers of the dialog", category: "leak", change: report => { dialogCycle(report, 6).answers[0].after.windows = 0; }},
  {name: "the heap grows by 400 bytes a cycle", category: "heap", change: report => { cityRounds(report, "close").forEach((row, index) => { row.after.heap += index * 400; }); }},
  {name: "the engine's objects grow by two a cycle", category: "heap", change: report => { report.dialog.cycles.forEach((row, index) => { row.answers.at(-1).after.objects += index * 2; }); }},
  {name: "a heap was read before a collection", category: "heap", change: report => { cityRound(report, 3).after.collected = false; }},
  {name: "the telemetry's lists were not filled", category: "heap", change: report => { report.fill.kept = 12; }},
  {name: "the focus after a close is not the one before the open", category: "focus", change: report => { cityRound(report, 6).after.focus.root = 4242; }},
  {name: "a Control under the dialog has the focus while it is open", category: "focus", change: report => { dialogCycle(report, 9).open.focus.root = 4242; }},
  {name: "a Control under the city screen reports itself focused", category: "focus", change: report => { cityRound(report, 0).open.focus.focused.push({testID: "hud-bar", modal: false}); }},
  {name: "two Windows are exclusive", category: "focus", change: report => { const focus = cityRound(report, 2).open.focus; focus.modals.push({...focus.modals[0], id: 7}); }},
  {name: "the overlay's Window is not exclusive", category: "focus", change: report => { cityRound(report, 2).open.focus.modals[0].exclusive = false; }},
  {name: "a click reached the world under the city screen in the last cycle", category: "blocking", change: report => { cityRound(report, 38).blocking[0].heardAfter.buttons += 2; }},
  {name: "a wheel tick selected a tile under the dialog", category: "blocking", change: report => { dialogCycle(report, 19).blocking[2].selectCalls = 1; }},
  {name: "the burst was not pushed in the last cycle", category: "blocking", change: report => { delete dialogCycle(report, 19).blocking; }},
  {name: "Escape on the dialog answered the event", category: "escape", change: report => { dialogCycle(report, 4).escape.sameHead = false; }},
  {name: "Escape on the dialog did not reach its Window", category: "escape", change: report => { dialogCycle(report, 4).escape.heard = 0; }},
  {name: "Escape on the city screen did not clear the selection", category: "escape", change: report => { cityRound(report, 7).clearCalls = 0; }},
  {name: "an icon of the bar failed to draw", category: "icons", change: report => { iconsIn(report, "none").images[0].errors = 1; }},
  {name: "an icon of the bar is missing", category: "icons", change: report => { iconsIn(report, "stack").images.shift(); }},
  {name: "the Images were read before they settled", category: "icons", change: report => { iconsIn(report, "city").rested = false; }},
  {name: "an Image was still loading when the screen was called at rest", category: "icons", change: report => { Object.assign(cityRound(report, 12).openImages[1], {status: "loading", loads: 0, drawn: false}); }},
  {name: "an item's icon is not in the Modal's window", category: "icons", change: report => { imageIn(report, "city", "hud-city-item-granary-icon").modal = false; }},
  {name: "the granary shows another asset", category: "icons", change: report => { const image = imageIn(report, "city", "hud-city-item-granary-icon"); image.uri = image.uri.replace("food.png", "science.png"); }},
  {name: "an action's icon is not its unit's", category: "icons", change: report => { const image = imageIn(report, "stack", "hud-actions-select_unit-1-icon"); image.uri = image.uri.replace("settler.png", "warrior.png"); }},
  {name: "the city screen's icons did not draw in the last cycle", category: "icons", change: report => { cityRound(report, 39).openImages[0].drawn = false; }},
  {name: "a cycle of the city screen is missing", category: "coverage", change: report => { report.city.rounds.pop(); }},
  {name: "the dialog's events were answered out of order", category: "coverage", change: report => { const answers = dialogCycle(report, 5).answers; [answers[0].event, answers[1].event] = [answers[1].event, answers[0].event]; }},
  {name: "the city screen was not opened by a real click", category: "coverage", change: report => { cityRound(report, 9).opened = false; }},
];

// The static scan's own proof that it can fail: each change of a copy of the HUD's sources must be found, by the kind and the words it breaks; `clean` ones must not.
const swap = (from, to) => source => source.replace(from, to);
const SCAN_MUTATIONS = [
  {name: "FlatList is imported", file: "hud/kit.tsx", change: swap('import { Image, Pressable', 'import { FlatList, Image, Pressable'), kind: "import", match: /FlatList is out of the 0\.5 scope/},
  {name: "TextInput is imported", file: "hud/kit.tsx", change: swap('import { Image, Pressable', 'import { Image, Pressable, TextInput'), kind: "import", match: /TextInput is out of the 0\.5 scope/},
  {name: "Keyboard is imported", file: "hud/hud.tsx", change: swap('import { Text, View } from "react-native";', 'import { Keyboard, Text, View } from "react-native";'), kind: "import", match: /Keyboard is out of the 0\.5 scope/},
  {name: "a name the manifest does not decide is imported", file: "hud/hud.tsx", change: swap('import { Text, View } from "react-native";', 'import { NativeModules, Text, View } from "react-native";'), kind: "import", match: /NativeModules is in neither/},
  {name: "react-native is imported as a namespace", file: "hud/hud.tsx", change: swap('import { Text, View } from "react-native";', 'import * as Native from "react-native";\nimport { Text, View } from "react-native";'), kind: "import", match: /default or a namespace/},
  {name: "react-native is required", file: "hud/hud.tsx", change: source => `${source}\nconst native = require("react-native");\n`, kind: "import", match: /`require`/},
  {name: "a Pressable gets a hover handler", file: "hud/kit.tsx", change: swap('<Pressable testID={id} disabled={!enabled} onPress={onPress}', '<Pressable testID={id} disabled={!enabled} onPress={onPress} onHoverIn={onPress}'), kind: "prop", match: /<Pressable onHoverIn> is refused/},
  {name: "a Pressable gets a right-click handler", file: "hud/kit.tsx", change: swap('<Pressable testID={id} disabled={!enabled} onPress={onPress}', '<Pressable testID={id} disabled={!enabled} onPress={onPress} onContextMenu={onPress}'), kind: "prop", match: /<Pressable onContextMenu> is not a prop/},
  {name: "a View gets a mouse-enter handler", file: "hud/hud.tsx", change: swap('<View testID="hud-root" pointerEvents="box-none"', '<View testID="hud-root" onMouseEnter={mustAnswer} pointerEvents="box-none"'), kind: "prop", match: /<View onMouseEnter> is accepted and changes nothing/},
  {name: "the Modal slides in", file: "hud/overlay.tsx", change: swap('animationType="none"', 'animationType="slide"'), kind: "prop", match: /<Modal animationType> is refused/},
  {name: "an Image is given children", file: "hud/kit.tsx", change: swap('return <Image testID={id} source={ICONS[name]} style={{ width: size, height: size }} />;', 'return <Image testID={id} source={ICONS[name]} style={{ width: size, height: size }}><View /></Image>;'), kind: "prop", match: /<Image> is given children/},
  {name: "a View takes a spread of props", file: "hud/kit.tsx", change: swap('return <View testID={id}\n', 'return <View {...style} testID={id}\n'), kind: "prop", match: /takes a spread/},
  {name: "AppRegistry runs an application", file: "index.tsx", change: source => `${source}\nAppRegistry.runApplication("FrontierHUD", {});\n`, kind: "member", match: /AppRegistry\.runApplication is not a member/},
  {name: "a type-only import of a type the manifest does not decide is not a name", file: "hud/kit.tsx", change: swap('import type { ReactNode } from "react";', 'import type { ReactNode } from "react";\nimport type { ViewStyle } from "react-native";'), clean: true},
  // A subpath of react-native reaches past the names the manifest decides, however it is reached.
  {name: "a static import of a subpath of react-native", file: "hud/kit.tsx", change: swap('import type { ReactNode } from "react";', 'import type { ReactNode } from "react";\nimport Animated from "react-native/Libraries/Animated/Animated";'), kind: "import", match: /subpath react-native\/Libraries\/Animated\/Animated/},
  {name: "a re-export from a subpath of react-native", file: "hud/kit.tsx", change: source => `${source}\nexport { default as Deep } from "react-native/Libraries/Animated/Animated";\n`, kind: "import", match: /re-exports the subpath/},
  {name: "a require of a subpath of react-native", file: "hud/hud.tsx", change: source => `${source}\nconst deep = require("react-native/Libraries/Animated/Animated");\n`, kind: "import", match: /loads the subpath/},
  {name: "a dynamic import of a subpath of react-native", file: "hud/hud.tsx", change: source => `${source}\nconst later = import("react-native/Libraries/Animated/Animated");\n`, kind: "import", match: /loads the subpath/},
  // A name with a list of members is read as Name.member, or by destructuring members of the list: nothing else can be checked against it.
  {name: "AppRegistry is destructured into a member outside the subset", file: "index.tsx", change: source => `${source}\nconst { runApplication } = AppRegistry;\n`, kind: "member", match: /AppRegistry\.runApplication is not a member .* destructured/},
  {name: "AppRegistry is destructured with a rest element", file: "index.tsx", change: source => `${source}\nconst { ...everything } = AppRegistry;\n`, kind: "member", match: /destructured with a rest element/},
  {name: "AppRegistry is aliased before a member outside the subset is read", file: "index.tsx", change: source => `${source}\nconst Registry = AppRegistry;\nRegistry.runApplication("FrontierHUD", {});\n`, kind: "member", match: /AppRegistry is used as a value/},
  {name: "AppRegistry is passed as an argument", file: "index.tsx", change: source => `${source}\nObject.keys(AppRegistry);\n`, kind: "member", match: /AppRegistry is used as a value/},
  {name: "a member of the subset destructured from AppRegistry is let through", file: "index.tsx", change: source => `${source}\nconst { getAppKeys } = AppRegistry;\n`, clean: true},
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

    // The HUD against the 0.5 manifest, read from the manifest and not from a copy: every name it imports from react-native is one the manifest decides
    // and none one it leaves out, every prop is one it supports for the component, every member one of the subset.
    const manifest = await manifestNow();
    const hudSources = await hudSourcesIn(ui);
    assert.deepEqual(scanHud(hudSources, manifest), [], "the HUD uses only the names, props and members the manifest decides");
    assert.ok(manifest.names.some(row => row.name === "AppRegistry"), "the manifest decides AppRegistry, the HUD's entry point");
    for (const name of ["TextInput", "Keyboard", "FlatList"]) {
      assert.ok(leftOut(manifest).has(name), `the manifest leaves ${name} out`);
    }
    verify(true, `The HUD's imports from react-native, the props of its components and the members it reads are all decided by the manifest (${manifest.names.length} names; none of the ${leftOut(manifest).size} it leaves out)`);
    const scanned = [];
    for (const mutation of SCAN_MUTATIONS) {
      const changed = {...hudSources, [mutation.file]: mutation.change(hudSources[mutation.file])};
      assert.notEqual(changed[mutation.file], hudSources[mutation.file], `${mutation.name}: the change touched nothing`);
      const found = scanHud(changed, manifest);
      if (mutation.clean === true) {
        assert.deepEqual(found, [], `${mutation.name}: the scan must not flag it`);
      } else {
        assert.ok(found.some(finding => finding.kind === mutation.kind && mutation.match.test(finding.message)), `${mutation.name}: the scan must find ${mutation.match}, and found ${JSON.stringify(found)}`);
      }
      scanned.push({name: mutation.name, kind: mutation.kind ?? "clean"});
    }
    const changesFound = SCAN_MUTATIONS.filter(mutation => mutation.clean !== true).length;
    verify(true, `The scan finds each of ${changesFound} changes of a copy of the HUD (an import out of scope or by a subpath, a refused or unknown or ignored prop, a member out of the subset, read by destructuring, by an alias or by a loose use) and lets ${SCAN_MUTATIONS.length - changesFound} others through (a type-only import, a member of the subset destructured)`);

    // The icons: seven PNGs the template draws itself, byte for byte what scripts/civ-lite-icons.mjs makes, six of them imported by the HUD as assets an Image draws.
    const drawn = renderIcons();
    assert.deepEqual(Object.keys(drawn).sort(), DRAWN_ICON_NAMES.map(name => `${name}.png`).sort());
    for (const [file, bytes] of Object.entries(drawn)) {
      const committed = await readFile(path.join(ui, "icons", file));
      assert.ok(committed.equals(bytes), `ui/icons/${file} is what the generator draws`);
      assert.deepEqual([...committed.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${file} is a PNG`);
      assert.deepEqual([committed.readUInt32BE(16), committed.readUInt32BE(20)], [32, 32], `${file} is 32x32`);
    }
    assert.match(await source("assets.d.ts"), /declare module "\*\.png"[\s\S]*ImageSourcePropType/);
    const iconModule = await source("hud/icons.ts");
    for (const name of ICON_NAMES) {
      assert.match(iconModule, new RegExp(`import ${name} from "\\.\\./icons/${name}\\.png"`), `the HUD imports ${name}.png as an asset`);
    }
    assert.match(await source("hud/kit.tsx"), /<Image testID=\{id\} source=\{ICONS\[name\]\}/);
    for (const [file, pattern] of [["hud/bar.tsx", /<Icon id=\{`hud-bar-\$\{name\}-icon`\}/], ["hud/actions.tsx", /icon=\{iconOf\(action, units\)\}/],
      ["hud/tile.tsx", /<Icon key=\{unit\.id\} id=\{`hud-tile-unit-\$\{unit\.id\}-icon`\}/], ["hud/city.tsx", /icon=\{itemIcon\(item\.id\)\}/]]) {
      assert.match(await source(file), pattern, `${file} shows its icons`);
    }
    verify(true, "The seven icons (settler, warrior, city, food, production, science, irrigation) are 32x32 PNGs the generator draws; the first six are imported as assets and shown by Images in the bar, the actions, the tile card and the city screen");

    // The genuine run, headless.
    const {log, report} = await probe(harness, "headless");
    assert.match(log, /CIVLITE_UI_PASSED/);
    assert.deepEqual(failedChecks(report), [], "every check of the probe passed");
    assert.equal(report.checks.length, EXPECTED_CHECKS, "the probe ran the checks it is built of");
    assertNamesDoNotDependOnPace("the HUD probe", report);
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
    assertNamesDoNotDependOnPace("the overlay probe", overlays.report);
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

    // The stability probe: twenty cycles of each overlay, headless.
    const stability = await probe(harness, "stability", {mode: "stability"});
    assert.match(stability.log, /CIVLITE_STABILITY_PASSED/);
    assert.deepEqual(failedChecks(stability.report), [], "every check of the stability probe passed");
    assert.equal(stability.report.checks.length, EXPECTED_STABILITY_CHECKS, "the stability probe ran the checks it is built of");
    assertNamesDoNotDependOnPace("the stability probe", stability.report);
    assertStabilityReport(stability.report);
    verify(true, `The stability probe ran ${stability.report.checks.length} checks and the independent oracle accepts them: twenty cycles of the city screen (a click and Close, a click and Escape) and of the dialog (a game to turn 5 and three answers by real presses), nothing leaked, focus kept, the map blocked, every icon drawn`);
    assert.deepEqual(judgeStabilityReport(stability.report), []);
    for (const mutation of STABILITY_MUTATIONS) {
      const mutated = structuredClone(stability.report);
      mutation.change(mutated);
      assert.notDeepEqual(mutated, stability.report, `${mutation.name}: the mutation changed nothing`);
      const found = judgeStabilityReport(mutated);
      assert.ok(categoriesOf(found).includes(mutation.category), `${mutation.name}: the stability oracle must report ${mutation.category}, and found ${JSON.stringify(categoriesOf(found))}`);
    }
    verify(true, `The stability oracle rejects each of ${STABILITY_MUTATIONS.length} mutated copies of its report, in the category each breaks`);
    const rest = (rows, field) => ({first: rows[0][field], last: rows.at(-1)[field]});
    const closes = cityRounds(stability.report, "close").map(row => row.after);
    const escapes = cityRounds(stability.report, "escape").map(row => row.after);
    const closed = stability.report.dialog.cycles.map(row => row.answers.at(-1).after);
    const numbers = rows => Object.fromEntries(["nodes", "orphans", "objects", "windows", "nativeViews", "nativeTags", "subscriptions", "hudSubscriptions", "connections", "pointerStored",
      "pointerSuppressed", "heap"].map(field => [field, rest(rows, field)]));
    summary.stability = {checks: stability.report.checks.length, cycles: {city: cityRounds(stability.report, "close").length, dialog: closed.length},
      atRest: {cityClose: numbers(closes), cityEscape: numbers(escapes), dialogLastAnswer: numbers(closed)},
      heap: {cityClose: closes.map(row => row.heap), cityEscape: escapes.map(row => row.heap), dialogLastAnswer: closed.map(row => row.heap)},
      icons: stability.report.icons.map(entry => ({context: entry.label, images: entry.images.length, modal: entry.images.filter(image => image.modal).length})),
      mutations: STABILITY_MUTATIONS.map(mutation => ({name: mutation.name, category: mutation.category})), scanMutations: SCAN_MUTATIONS.map(mutation => ({name: mutation.name, kind: mutation.kind ?? "clean"}))};
    await writeFile(path.join(directory, "stability-series.json"), JSON.stringify({format: "godot-fabric.civ-lite-stability-series/v1", base: stability.report.base,
      city: stability.report.city.rounds.map(row => ({cycle: row.cycle, how: row.how, before: row.before, open: row.open, after: row.after, clearCalls: row.clearCalls})),
      dialog: stability.report.dialog.cycles.map(row => ({cycle: row.cycle, before: row.before, open: row.open, answers: row.answers.map(answer => answer.after), escape: row.escape}))}) + "\n");

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

    // The causal control of the stability lane: the HUD and the game of e108e9d (no icons, a manifest that does not decide AppRegistry) on the same probe.
    let stabilityControlSummary = {commit: STABILITY_CONTROL_COMMIT, skipped: "the commit is not in this checkout"};
    if (requireControl || commitAvailable(STABILITY_CONTROL_COMMIT)) {
      const previous = await previousTemplate(STABILITY_CONTROL_COMMIT, ["game", "services", "ui"], "civ-lite-stability-previous");
      const oldSources = await hudSourcesIn(path.join(previous.directory, "ui"));
      const scanThen = scanHud(oldSources, manifestAt(STABILITY_CONTROL_COMMIT));
      const scanNow = scanHud(oldSources, manifest);
      assert.deepEqual(scanThen.map(finding => [finding.file, finding.kind, finding.message.split(" ")[0]]), [["index.tsx", "import", "AppRegistry"]],
        `the HUD of ${STABILITY_CONTROL_COMMIT} against its manifest fails the scan on AppRegistry and on nothing else: ${JSON.stringify(scanThen)}`);
      assert.deepEqual(scanNow, [], "the same HUD passes the scan against the manifest of this slice, which decides AppRegistry");
      const control = await createHarness({template: "civ-lite", name: "civ-lite-stability-control"});
      t.after(() => control.cleanup());
      await control.provision();
      for (const directoryName of ["game", "services", "ui"]) {
        await rm(path.join(control.project, directoryName), {recursive: true, force: true});
        await cp(path.join(previous.directory, directoryName), path.join(control.project, directoryName), {recursive: true});
      }
      await control.editor("editor");
      const controlRun = await probe(control, "control", {mode: "stability", expectFailures: true});
      // The tree of e108e9d registers 15 bindings: the three methods of the stress mode came after it.
      const controlFindings = judgeStabilityReport(controlRun.report, {bindings: 15});
      const controlFailed = failedChecks(controlRun.report);
      assert.ok(controlFailed.length > 0 && controlFindings.length > 0, `the HUD and the game of ${STABILITY_CONTROL_COMMIT} must fail the stability lane`);
      assert.ok(controlFailed.every(name => name.startsWith("Icons: ")) && categoriesOf(controlFindings).join() === "icons",
        `the HUD of ${STABILITY_CONTROL_COMMIT} fails the icon checks and nothing else (it does not leak): ${JSON.stringify({controlFailed, categories: categoriesOf(controlFindings)})}`);
      await writeFile(path.join(directory, "stability-control-observed.json"), JSON.stringify({
        format: "godot-fabric.civ-lite-stability-control/v1", commit: STABILITY_CONTROL_COMMIT, archived: previous.sha256, failedChecks: controlFailed, categories: categoriesOf(controlFindings),
        findingCounts: Object.fromEntries(categoriesOf(controlFindings).map(category => [category, controlFindings.filter(finding => finding.category === category).length])),
        findings: controlFindings.slice(0, 8).map(finding => `[${finding.category}] ${finding.message.slice(0, 240)}`),
        scan: {against: STABILITY_CONTROL_COMMIT, findings: scanThen.map(finding => `${finding.file}: ${finding.message}`), againstThisSlice: scanNow.length},
        images: controlRun.report.icons.map(entry => ({context: entry.label, images: entry.images.length})),
        leaks: {cyclesRun: controlRun.report.city.rounds.length + controlRun.report.dialog.cycles.length, categoriesOtherThanIcons: categoriesOf(controlFindings).filter(category => category !== "icons")},
      }, null, 2) + "\n");
      verify(true, `The HUD of ${STABILITY_CONTROL_COMMIT} fails the lane where it should: its scan against its own manifest finds AppRegistry, and the probe finds no Image where the icons are (${controlFailed.length} checks, category ${JSON.stringify(categoriesOf(controlFindings))}); it leaks nothing`);
      stabilityControlSummary = {commit: STABILITY_CONTROL_COMMIT, categories: categoriesOf(controlFindings), failedChecks: controlFailed.length, scanFindings: scanThen.length};
    } else {
      console.log(`CIVLITE_UI_CONTROL_SKIPPED: ${STABILITY_CONTROL_COMMIT} is not in this checkout (a shallow clone); run with --control where it is`);
    }

    if (capture) {
      const {log: headedLog, report: headed} = await probe(harness, "graphical", {headed: true});
      assert.match(headedLog, /CIVLITE_UI_PASSED/);
      assert.deepEqual(failedChecks(headed), [], "every check of the headed run passed");
      assert.equal(headed.checks.length, report.checks.length + CAPTURES.length, "the headed run adds the nine captures");
      assertSameNamesAsHeadless("the HUD probe", headed, report);
      assertHudReport(headed);
      const captures = {};
      for (const stage of CAPTURES) {
        const file = path.join(directory, `${stage}.png`);
        await copyFile(path.join(project, `civ-lite-ui-${stage}.png`), file);
        const bytes = await readFile(file);
        assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${stage}.png is a PNG`);
        captures[stage] = {sha256: hash(bytes), bytes: bytes.length};
      }
      assert.equal(new Set(Object.values(captures).map(entry => entry.sha256)).size, CAPTURES.length, "the nine captures are nine different pictures");
      summary.captures = captures;
      verify(true, `The headed run saved ${CAPTURES.length} captures: one per context, one in the AI phase and one with the stress panel full`);
      const {log: overlaysLog, report: overlaysHeaded} = await probe(harness, "overlays-graphical", {mode: "overlays", headed: true});
      assert.match(overlaysLog, /CIVLITE_OVERLAYS_PASSED/);
      assert.deepEqual(failedChecks(overlaysHeaded), [], "every check of the headed overlay run passed");
      assert.equal(overlaysHeaded.checks.length, overlays.report.checks.length + OVERLAY_CAPTURES.length, "the headed overlay run adds its four captures");
      assertSameNamesAsHeadless("the overlay probe", overlaysHeaded, overlays.report);
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
      const {log: stabilityLog, report: stabilityHeaded} = await probe(harness, "stability-graphical", {mode: "stability", headed: true});
      assert.match(stabilityLog, /CIVLITE_STABILITY_PASSED/);
      assert.deepEqual(failedChecks(stabilityHeaded), [], "every check of the headed stability run passed");
      assert.equal(stabilityHeaded.checks.length, stability.report.checks.length + STABILITY_CAPTURES.length + 1, "the headed stability run adds its seven captures and the comparison of the last cycle's");
      assertSameNamesAsHeadless("the stability probe", stabilityHeaded, stability.report);
      assertStabilityReport(stabilityHeaded);
      const drifted = structuredClone(stabilityHeaded);
      drifted.drift.same = false;
      assert.ok(categoriesOf(judgeStabilityReport(drifted)).includes("drift"), "the oracle rejects a last cycle whose pictures are not the first's");
      summary.stabilityCaptures = {};
      for (const stage of STABILITY_CAPTURES) {
        const file = path.join(directory, `stability-${stage}.png`);
        await copyFile(path.join(project, `civ-lite-stability-${stage}.png`), file);
        const bytes = await readFile(file);
        assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `stability-${stage}.png is a PNG`);
        summary.stabilityCaptures[stage] = {sha256: hash(bytes), bytes: bytes.length};
      }
      const distinct = ["bar", "actions", "city", "city-1", "dialog-1"].map(stage => summary.stabilityCaptures[stage].sha256);
      assert.equal(new Set(distinct).size, distinct.length, "the bar, the actions, the city screen of the icons, and the first cycles' city screen and dialog are five different pictures");
      summary.stabilityDrift = {...stabilityHeaded.drift, sameBytes: {city: summary.stabilityCaptures["city-1"].sha256 === summary.stabilityCaptures["city-20"].sha256,
        dialog: summary.stabilityCaptures["dialog-1"].sha256 === summary.stabilityCaptures["dialog-20"].sha256}};
      verify(true, `The headed stability run saved ${STABILITY_CAPTURES.length} captures (the bar, the actions and the city screen with their icons, the city screen and the dialog in the first and the last cycle), and the last cycle's pictures are the first's but for the first row of the bar`);
    }

    summary.control = controlSummary;
    summary.overlaysControl = overlayControlSummary;
    summary.stabilityControl = stabilityControlSummary;
    await writeFile(path.join(directory, "summary.json"), JSON.stringify({...summary, checks: harness.checks}, null, 2) + "\n");
    assert.ok(existsSync(path.join(directory, "headless.json")));
    console.log(`CIVLITE_UI_LANE_PASSED: ${report.checks.length} + ${overlays.report.checks.length} + ${stability.report.checks.length} probe checks; ${MUTATIONS.length} + ${OVERLAY_MUTATIONS.length} + ${STABILITY_MUTATIONS.length} oracle mutations and ${SCAN_MUTATIONS.length} of the scan; controls ${controlSummary.categories === undefined ? "not run" : `fail ${JSON.stringify(controlSummary.categories)}`}, ${overlayControlSummary.categories === undefined ? "not run" : `fail ${JSON.stringify(overlayControlSummary.categories)}`} and ${stabilityControlSummary.categories === undefined ? "not run" : `fail ${JSON.stringify(stabilityControlSummary.categories)}`}`);
  });

  // Arm B: the native Godot HUD on the second scene, held to parity by the same matrix and the same oracles.
  test("Frontier's native HUD (arm B) shows the table's panels in each of the seven contexts, as the React Native HUD does", {timeout: 1500000}, async t => {
    const harness = await createHarness({template: "civ-lite", name: "civ-lite-ui-native-hud"});
    t.after(() => harness.cleanup());
    const {directory, project, verify} = harness;
    await harness.provision();

    // The second scene mirrors main.tscn without the Application and without the Surface, and the HUD is Godot's own: a scene with a script for each
    // panel, no TSX, no host and no registered service.
    const scene = await readFile(path.join(project, "main_native.tscn"), "utf8");
    assert.match(scene, /^\[node name="GameServices" type="Node"\]/m);
    assert.match(scene, /\[node name="World" parent="\." instance=ExtResource\("\d+"\)\]/);
    assert.match(scene, /\[node name="HUD" parent="HUDLayer" instance=ExtResource\("\d+"\)\]/);
    assert.doesNotMatch(scene, /Application|FabricSurface|godot_fabric|fabric_api/, "the native scene has no Application, no Surface and no facade");
    assert.ok(scene.indexOf('name="World"') < scene.indexOf('name="HUDLayer"'), "the World is ahead of the HUD's layer, as in main.tscn");
    const hudFolder = path.join(project, "native_hud");
    const hudScripts = readdirSync(hudFolder).filter(file => file.endsWith(".gd"));
    for (const file of ["hud", "bar", "actions", "tile", "city", "research", "dialog", "overlay", "menu"]) {
      assert.ok(existsSync(path.join(hudFolder, `${file}.gd`)), `native_hud/${file}.gd exists`);
    }
    for (const file of ["hud", "bar", "actions", "tile", "city", "research", "dialog", "menu"]) {
      assert.ok(existsSync(path.join(hudFolder, `${file}.tscn`)), `native_hud/${file}.tscn exists`);
    }
    for (const file of hudScripts) {
      assert.doesNotMatch((await readFile(path.join(hudFolder, file), "utf8")).replace(/#.*$/gm, ""), /\b(GodotFabric|FabricSurface|fabric_api|runtime_available)\b/,
        `native_hud/${file} talks to no React Native host`);
    }
    verify(true, `The second scene is the game with a native HUD: GameServices, the World ahead of the HUD's layer and ${hudScripts.length} scripts of the HUD, with no Application, no Surface and no facade`);
    await harness.editor("editor");

    // Arm A's scene, the game with no HUD (GameServices and the World), boots with no error and exits 0.
    const bare = await harness.run("bare-boot", harness.godot, ["--path", project, "--headless", "res://main_bare.tscn", "--quit-after", "60"]);
    assert.doesNotMatch(bare, /(?:^|\n)ERROR:|FABRIC_ERROR/, "the bare scene logs no engine error");
    verify(true, "main_bare.tscn, the game with no HUD for arm A, boots headless with no error and exits 0");

    // The genuine run, headless: the same probe, the same checks, the same report, judged by the same oracle.
    const {log, report} = await probe(harness, "native-headless", {scene: NATIVE_SCENE});
    assert.match(log, /CIVLITE_UI_PASSED/);
    assert.doesNotMatch(log, /(?:^|\n)ERROR:|FABRIC_ERROR/, "the native run logs no engine error");
    assert.deepEqual(failedChecks(report), [], "every check of the probe passed on the native HUD");
    assert.equal(report.arm, "native");
    assert.equal(report.checks.length, EXPECTED_CHECKS, "the probe ran the same checks on both arms");
    assertNamesDoNotDependOnPace("the HUD probe on the native HUD", report);
    verify(report.checks.length > 0 && report.displayServer === "headless", `The probe ran ${report.checks.length} checks headless on the native HUD and every one passed`);
    assertHudReport(report);
    verify(true, "The independent oracle accepts the native run: the panels of the seven contexts, the actions, the bar, the turn, the pointer");
    assert.equal(report.matrix.length, 46);
    assert.deepEqual(Object.fromEntries(CONTEXTS.map(context => [context, row(report, context).snapshot.context])), Object.fromEntries(CONTEXTS.map(context => [context, context])));
    const parity = {};
    for (const context of CONTEXTS) {
      assert.deepEqual(row(report, context).panels.map(id => id.slice("hud-".length)), TABLE[context], `${context} mounts ${TABLE[context].join(", ")}`);
      parity[context] = row(report, context).panels;
    }
    verify(true, "The seven covering steps (stack 2, settler 3, warrior 9, city 18, tile 32, none 33, dialog 45) showed exactly the table's panels on the native HUD");

    // The oracle can fail on the native report as it does on the host's: each mutation of a copy is rejected in the category it breaks.
    assert.deepEqual(judgeHudReport(report), []);
    for (const mutation of MUTATIONS) {
      const mutated = structuredClone(report);
      mutation.change(mutated);
      assert.notDeepEqual(mutated, report, `${mutation.name}: the mutation changed nothing`);
      const found = judgeHudReport(mutated);
      assert.ok(categoriesOf(found).includes(mutation.category), `${mutation.name}: the oracle must report ${mutation.category} on the native report, and found ${JSON.stringify(categoriesOf(found))}`);
    }
    verify(true, `The oracle rejects each of ${MUTATIONS.length} mutated copies of the native report, in the category each breaks`);
    const summary = {format: "godot-fabric.civ-lite-ui-native/v1", arm: "native", scene: NATIVE_SCENE, steps: report.matrix.length, checks: report.checks.length, covering: report.covering, parity,
      published: report.phase.published.map(entry => entry.phase), framesObserved: report.phase.free.samples.length,
      mutations: MUTATIONS.map(mutation => ({name: mutation.name, category: mutation.category}))};

    // The overlay probe on the native HUD: the queue of three, the blocking overlays and a new game. What the arm cannot say is on record.
    const overlays = await probe(harness, "native-overlays", {mode: "overlays", scene: NATIVE_SCENE});
    assert.match(overlays.log, /CIVLITE_OVERLAYS_PASSED/);
    assert.doesNotMatch(overlays.log, /(?:^|\n)ERROR:|FABRIC_ERROR/, "the native overlay run logs no engine error");
    assert.deepEqual(failedChecks(overlays.report), [], "every check of the overlay probe passed on the native HUD");
    assert.equal(overlays.report.arm, "native");
    assert.equal(overlays.report.checks.length, EXPECTED_OVERLAY_CHECKS, "the overlay probe ran the same checks on both arms");
    assertNamesDoNotDependOnPace("the overlay probe on the native HUD", overlays.report);
    assertOverlayReport(overlays.report);
    assert.deepEqual(overlays.report.notApplicable, ["the application's error list after a remount (there is no Application node)"]);
    verify(true, `The overlay probe ran ${overlays.report.checks.length} checks on the native HUD and the independent oracle accepts them: the queue of three in order, the HUD taken out of the tree and put back, the blocking overlays, a new game`);
    for (const mutation of OVERLAY_MUTATIONS) {
      const mutated = structuredClone(overlays.report);
      mutation.change(mutated);
      assert.notDeepEqual(mutated, overlays.report, `${mutation.name}: the mutation changed nothing`);
      const found = judgeOverlayReport(mutated);
      assert.ok(categoriesOf(found).includes(mutation.category), `${mutation.name}: the overlay oracle must report ${mutation.category} on the native report, and found ${JSON.stringify(categoriesOf(found))}`);
    }
    const unlisted = structuredClone(overlays.report);
    unlisted.notApplicable = [];
    assert.ok(judgeOverlayReport(unlisted).length > 0, "an arm that skips a check without listing it is rejected");
    verify(true, `The overlay oracle rejects each of ${OVERLAY_MUTATIONS.length} mutated copies of the native report, and a native report that does not list what it cannot say`);
    summary.overlays = {checks: overlays.report.checks.length, rounds: overlays.report.queue.rounds.map(entry => [entry.dialog.id, entry.dialog.index, entry.dialog.count, entry.pick]),
      remountFrames: overlays.report.remount.remounted.samples.length, notApplicable: overlays.report.notApplicable, mutations: OVERLAY_MUTATIONS.map(mutation => ({name: mutation.name, category: mutation.category}))};

    // The causal control: a native HUD that ignores the context (it mounts the actions and the tile card in all seven) on the same scene and probe.
    const control = await createHarness({template: "civ-lite", name: "civ-lite-ui-native-control"});
    t.after(() => control.cleanup());
    await control.provision();
    const hudSource = path.join(control.project, "native_hud", "hud.gd");
    const genuine = await readFile(hudSource, "utf8");
    const table = /const PANELS := \{[^}]*\}\n/;
    assert.match(genuine, table, "the HUD has its table of panels");
    const ignoring = genuine.replace(table, `const PANELS := {${CONTEXTS.map(context => `"${context}": ["actions", "tile"]`).join(", ")}}\n`);
    assert.notEqual(ignoring, genuine);
    await writeFile(hudSource, ignoring);
    await control.editor("editor");
    const controlRun = await probe(control, "native-control", {scene: NATIVE_SCENE, expectFailures: true});
    const controlFindings = judgeHudReport(controlRun.report);
    const controlFailed = failedChecks(controlRun.report);
    assert.ok(controlFailed.length > 0 && controlFindings.length > 0, "a native HUD that ignores the context must fail the matrix");
    assert.ok(categoriesOf(controlFindings).includes("panels") && categoriesOf(controlFindings).includes("map"), `the broken native HUD fails the panels and the map: ${JSON.stringify(categoriesOf(controlFindings))}`);
    const panelsFailed = controlFailed.filter(name => /the HUD showed .* for the (none|city|dialog) context/.test(name));
    assert.ok(panelsFailed.length > 0, "the probe's own matrix check fails for the contexts that mount other panels");
    await writeFile(path.join(directory, "control-observed.json"), JSON.stringify({
      format: "godot-fabric.civ-lite-ui-native-control/v1", broken: "a native HUD whose table mounts the actions and the tile card in all seven contexts", failedChecks: controlFailed, categories: categoriesOf(controlFindings),
      findingCounts: Object.fromEntries(categoriesOf(controlFindings).map(category => [category, controlFindings.filter(finding => finding.category === category).length])),
      findings: controlFindings.filter(finding => finding.category !== "phase").slice(0, 40).map(finding => `[${finding.category}] ${finding.message.slice(0, 240)}`),
      matrixSteps: controlRun.report.matrix.length, panelsShownAtCovering: Object.fromEntries(CONTEXTS.map(context => [context, row(controlRun.report, context).panels])),
    }, null, 2) + "\n");
    verify(true, `A native HUD that ignores the context fails the matrix: ${JSON.stringify(categoriesOf(controlFindings))} (${controlFailed.length} checks of the probe)`);
    summary.control = {categories: categoriesOf(controlFindings), failedChecks: controlFailed.length};

    if (capture) {
      const {log: headedLog, report: headed} = await probe(harness, "native-graphical", {headed: true, scene: NATIVE_SCENE});
      assert.match(headedLog, /CIVLITE_UI_PASSED/);
      assert.deepEqual(failedChecks(headed), [], "every check of the headed native run passed");
      assert.equal(headed.checks.length, report.checks.length + CAPTURES.length, "the headed native run adds the nine captures");
      assertSameNamesAsHeadless("the HUD probe on the native HUD", headed, report);
      assertHudReport(headed);
      summary.captures = {};
      for (const stage of CAPTURES) {
        const file = path.join(directory, `${stage}.png`);
        await copyFile(path.join(project, `civ-lite-ui-${stage}.png`), file);
        const bytes = await readFile(file);
        assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${stage}.png is a PNG`);
        summary.captures[stage] = {sha256: hash(bytes), bytes: bytes.length};
      }
      assert.equal(new Set(Object.values(summary.captures).map(entry => entry.sha256)).size, CAPTURES.length, "the nine captures are nine different pictures");
      const overlaysHeaded = await probe(harness, "native-overlays-graphical", {mode: "overlays", headed: true, scene: NATIVE_SCENE});
      assert.match(overlaysHeaded.log, /CIVLITE_OVERLAYS_PASSED/);
      assert.deepEqual(failedChecks(overlaysHeaded.report), [], "every check of the headed native overlay run passed");
      assert.equal(overlaysHeaded.report.checks.length, overlays.report.checks.length + OVERLAY_CAPTURES.length);
      assertSameNamesAsHeadless("the overlay probe on the native HUD", overlaysHeaded.report, overlays.report);
      assertOverlayReport(overlaysHeaded.report);
      summary.overlayCaptures = {};
      for (const stage of OVERLAY_CAPTURES) {
        const file = path.join(directory, `overlay-${stage}.png`);
        await copyFile(path.join(project, `civ-lite-overlay-${stage}.png`), file);
        const bytes = await readFile(file);
        assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `overlay-${stage}.png is a PNG`);
        summary.overlayCaptures[stage] = {sha256: hash(bytes), bytes: bytes.length};
      }
      assert.equal(new Set(Object.values(summary.overlayCaptures).map(entry => entry.sha256)).size, OVERLAY_CAPTURES.length, "the four overlay captures are four different pictures");
      verify(true, `The headed native run saved ${CAPTURES.length} captures (one per context, one in the AI phase and one with the stress panel full) and ${OVERLAY_CAPTURES.length} of the overlays`);
    }

    await writeFile(path.join(directory, "summary.json"), JSON.stringify({...summary, checks: harness.checks}, null, 2) + "\n");
    console.log(`CIVLITE_UI_NATIVE_PASSED: ${report.checks.length} + ${overlays.report.checks.length} probe checks on the native HUD; ${MUTATIONS.length} + ${OVERLAY_MUTATIONS.length} oracle mutations; control fails ${JSON.stringify(summary.control.categories)}`);
  });
} else {
  // A retained sabotage: the project was broken on purpose, and the probe and the oracle must both reject it.
  test(`the ${sabotage} sabotage is rejected by the probe and by the oracle`, {timeout: 600000}, async t => {
    const harness = await createHarness({template: "civ-lite", name: lane});
    t.after(() => harness.cleanup());
    const expected = SABOTAGES[sabotage];
    await rm(path.join(harness.directory, "observed.json"), {force: true});
    await harness.provision();
    let failed;
    let findings;
    if (expected.mode === "scan") {
      // Only the static scan can see this one: an import the manifest does not decide never runs. Nothing is built.
      const found = scanHud(await hudSourcesIn(path.join(harness.project, "ui")), await manifestNow());
      failed = found.map(finding => `${finding.file}: ${finding.message}`);
      findings = found.map(finding => ({category: finding.kind, message: `${finding.file}: ${finding.message}`}));
    } else {
      await harness.editor("editor");
      // The probes run on the broken project, each with the verdict of its own; what they and the oracles say is added up.
      const scene = expected.arm === "native" ? NATIVE_SCENE : null;
      const runs = expected.mode === "stability" ? [[await probe(harness, "stability", {mode: "stability", expectFailures: true}), judgeStabilityReport]]
        : [[await probe(harness, "headless", {expectFailures: true, scene}), judgeHudReport], [await probe(harness, "overlays", {mode: "overlays", expectFailures: true, scene}), judgeOverlayReport]];
      failed = runs.flatMap(([run]) => failedChecks(run.report));
      findings = runs.flatMap(([run, judge]) => judge(run.report));
      for (const [run] of runs) {
        const own = failedChecks(run.report).length;
        assert.ok(own === 0 || new RegExp(`_REJECTED: ${own}\\b`).test(run.log), "a probe that has failed checks says it rejected the project");
      }
    }
    assert.ok(failed.length > 0, "the probes (or the scan) reject the sabotaged project");
    assert.ok(findings.length > 0, "the oracles (or the scan) reject the sabotaged project");
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
