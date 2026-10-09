import assert from "node:assert/strict";
import path from "node:path";
import {existsSync, readdirSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {copyFile, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import test from "node:test";
import {createHarness, hash, root} from "../scripts/consumer-harness.mjs";
import {assertHudReport, categoriesOf, COVERING, judgeHudReport, TABLE} from "./civ-lite-ui-oracle.mjs";

// V05-05 `matriz` and `mapa`: Frontier's context-driven HUD, run for real. The consumer template (consumers/civ-lite) is provisioned
// into a project outside the checkout, built by the editor plugin with no Node of its own, and run in the official Godot with its own
// scene: the persistent GameServices node, the World, and the HUD in a full-screen FabricSurface. hud_validation.gd (in the template,
// inert unless run with `-- --validate-hud`) plays the roteiro's steps 0 to 45 through the services and observes the HUD's tree after
// each, runs the end of a turn through the HUD (every frame, then held at an AI phase), and drives real pointer events through the
// viewport. It writes the raw observations; tests/civ-lite-ui-oracle.mjs judges them again on its own, from the table of panels per
// context, the format of what each panel says and the geometry of the map, never from the probe's verdicts.
//
// The same run is also judged here by three things the probe cannot say of itself:
//   - the oracle is not vacuous: a copy of the genuine report with one thing broken each, in memory, is rejected in the category it
//     breaks;
//   - a causal control: the HUD of 5e1f6a1, taken from git into build/civ-lite-ui-previous/ when the test runs (and checked against its
//     pinned sha256), on the same scene fails the matrix and the map checks it reaches, and the test records exactly which. It needs the
//     commit in the checkout: a shallow clone (hosted CI) says so and skips it, and --control makes its absence an error;
//   - with --sabotage=<name> the same test runs a project whose source scripts/civ-lite-ui-sabotage.mjs broke on purpose, and it passes
//     only if the probe's checks and the oracle both reject it, each for the reason it was broken.
//
// --capture adds the headed run: one PNG per context (seven) and one during the AI phase with the spinner.
const capture = process.argv.includes("--capture");
const requireControl = process.argv.includes("--control");
const sabotageArgument = process.argv.find(argument => argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : sabotageArgument.slice("--sabotage=".length);
const REPORT = "civ-lite-ui-report.json";
const CONTEXTS = Object.keys(TABLE);
const CONTROL_COMMIT = "5e1f6a1";
const CONTROL_SHA256 = "d477f51cfd3550c43087d92e552bf403a82abc329fdceaf2b581a885a9a09346";
// What hud_validation.gd counts in a run with no capture, and the eight a headed run adds.
const EXPECTED_CHECKS = 143;
const CAPTURES = [...CONTEXTS, "ai-phase"];
// What each retained sabotage must make the probe and the oracle say. `failed` are patterns of the probe's failed checks and
// `categories` the oracle's categories that must be among the findings (scripts/civ-lite-ui-sabotage.mjs says what each breaks).
const SABOTAGES = {
  "city-by-data": {categories: ["panels"], failed: [/the HUD showed .* for the (none|tile|stack|settler|warrior|dialog) context/]},
  "actions-reversed": {categories: ["actions"], failed: [/the actions panel lists the snapshot's actions but End turn, in order/]},
  "spinner-always": {categories: ["bar", "phase"], failed: [/the bar's End turn is enabled exactly as the game's end_turn action says/, /At rest before the job the spinner is not shown/]},
  "end-turn-by-phase": {categories: ["bar"], failed: [/the bar's End turn is enabled exactly as the game's end_turn action says/]},
  "spacer": {categories: ["map", "input"], failed: [/No Control of the HUD that stops the pointer covers the map/, /A real left click on tile \(6, 8\) selected it/]},
  "hover-unpublished": {categories: ["input"], failed: [/The pointer over tile \(12, 4\) published the hover/]},
  "world-behind-hud": {categories: ["input"], failed: [/Through the menu and back, the World returned ahead of the HUD's layer/, /After the menu, a click and a tick of the wheel on a panel still do not reach the World/]},
  "disabled-ignored": {categories: ["actions", "bar", "phase", "input"], failed: [/the actions panel lists the snapshot's actions but End turn, in order/, /A press on the disabled End turn asks nothing of the game/]},
};
assert.ok(sabotage === null || sabotage in SABOTAGES, `Unknown sabotage: ${sabotage}`);

const lane = sabotage === null ? "civ-lite-ui" : `civ-lite-ui-sabotage-${sabotage}`;
const sourcesUnder = (directory, prefix = "") => readdirSync(directory, {withFileTypes: true}).flatMap(entry => entry.isDirectory()
  ? sourcesUnder(path.join(directory, entry.name), `${prefix}${entry.name}/`) : /\.tsx?$/.test(entry.name) ? [`${prefix}${entry.name}`] : []);

// One probe run on a provisioned project: the log and the report it wrote, both kept in build/<lane>/.
async function probe(harness, label, {headed = false, expectFailures = false} = {}) {
  await rm(path.join(harness.project, REPORT), {force: true});
  const log = await harness.run(label, harness.godot, ["--path", harness.project, ...(headed ? [] : ["--headless"]), "--", "--validate-hud",
    ...(headed ? ["--capture"] : []), ...(expectFailures ? ["--sabotage"] : [])]);
  const report = JSON.parse(await readFile(path.join(harness.project, REPORT), "utf8"));
  await writeFile(path.join(harness.directory, `${label}.json`), JSON.stringify(report, null, 2) + "\n");
  return {log, report};
}

const IMPORT = /^\s*import\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;
// The HUD of the commit before this slice, as git has it: the control's `ui/index.tsx`, byte for byte.
const controlAvailable = () => spawnSync("git", ["cat-file", "-e", `${CONTROL_COMMIT}^{commit}`], {cwd: root}).status === 0;
async function previousHud() {
  const shown = spawnSync("git", ["show", `${CONTROL_COMMIT}:consumers/civ-lite/ui/index.tsx`], {cwd: root, maxBuffer: 8 * 1024 * 1024});
  assert.equal(shown.status, 0, `git show ${CONTROL_COMMIT}:consumers/civ-lite/ui/index.tsx: ${shown.stderr}`);
  assert.equal(hash(shown.stdout), CONTROL_SHA256, `the control is the HUD of ${CONTROL_COMMIT}, byte for byte`);
  const directory = path.join(root, "build", "civ-lite-ui-previous");
  await mkdir(directory, {recursive: true});
  await writeFile(path.join(directory, "index.tsx"), shown.stdout);
  return readFile(path.join(directory, "index.tsx"));
}

const failedChecks = report => report.checks.filter(check => !check.passed).map(check => check.name);

// The oracle's own proof that it can fail: each case breaks one thing in a copy of the genuine report and names the category the
// oracle must report. A case that finds nothing to break is an error, so a change of the report cannot make a mutation vacuous.
const row = (report, context) => report.matrix[COVERING[context]];
const node = (observed, id) => observed.nodes.find(entry => entry.testID === id);
const inputStep = (report, label) => report.input.find(entry => entry.label === label);
const MUTATIONS = [
  {name: "a panel the context mounts is missing", category: "panels", change: report => { node(row(report, "city").observed, "hud-city").visible = false; }},
  {name: "a panel the context does not mount is shown", category: "panels", change: report => { row(report, "none").observed.nodes.push({testID: "hud-tile", kind: "view", visible: true, text: "", rect: [24, 416, 576, 92], stops: true, disabled: false, animating: false}); }},
  {name: "an unowned testID is mounted", category: "panels", change: report => { row(report, "tile").observed.nodes.push({testID: "hud-extra", kind: "view", visible: false, text: "", rect: [0, 0, 1, 1], stops: false, disabled: false, animating: false}); }},
  {name: "the actions are listed in another order", category: "actions", change: report => { const [first, second] = ["hud-actions-select_unit-1", "hud-actions-select_unit-2"].map(id => node(row(report, "stack").observed, id)); [first.rect, second.rect] = [second.rect, first.rect]; }},
  {name: "a disabled action is shown enabled", category: "actions", change: report => { node(row(report, "settler").observed, "hud-actions-fortify-1").disabled = false; }},
  {name: "a reason is not the game's", category: "actions", change: report => { node(row(report, "settler").observed, "hud-actions-fortify-1-reason").text = "Nope."; }},
  {name: "the spinner is shown at rest", category: "bar", change: report => { row(report, "none").observed.nodes.push({testID: "hud-turn-spinner", kind: "activity", visible: true, text: "", rect: [0, 0, 20, 20], stops: false, disabled: false, animating: true}); }},
  {name: "End turn is enabled while the game says it is not", category: "bar", change: report => { node(row(report, "dialog").observed, "hud-bar-end-turn").disabled = false; }},
  {name: "a resource is not the snapshot's", category: "bar", change: report => { node(row(report, "city").observed, "hud-bar-food").text = "Food 99 (+0)"; }},
  {name: "a Control that stops the pointer covers the map", category: "map", change: report => { row(report, "none").observed.stoppers.push({testID: "", rect: [0, 0, 624, 600]}); }},
  {name: "the tile card says another tile", category: "content", change: report => { node(row(report, "tile").observed, "hud-tile-title").text = "Selected · (1, 1) Water"; }},
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
    verify(["index.tsx", "store.ts", "telemetry.ts", "frontier-types.ts", "hud/hud.tsx", "hud/kit.tsx", ...panels.map(name => `hud/${name}.tsx`)].every(file => files.includes(file)),
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
    const summary = {format: "godot-fabric.civ-lite-ui/v1", steps: report.matrix.length, checks: report.checks.length, covering: report.covering,
      published: report.phase.published.map(entry => entry.phase), framesObserved: report.phase.free.samples.length,
      mutations: MUTATIONS.map(mutation => ({name: mutation.name, category: mutation.category}))};

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
    }

    summary.control = controlSummary;
    await writeFile(path.join(directory, "summary.json"), JSON.stringify({...summary, checks: harness.checks}, null, 2) + "\n");
    assert.ok(existsSync(path.join(directory, "headless.json")));
    console.log(`CIVLITE_UI_LANE_PASSED: ${report.checks.length} probe checks; ${MUTATIONS.length} oracle mutations; control ${controlSummary.categories === undefined ? "not run" : `fails ${JSON.stringify(controlSummary.categories)}`}`);
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
    const {log, report} = await probe(harness, "headless", {expectFailures: true});
    const failed = failedChecks(report);
    const findings = judgeHudReport(report);
    assert.ok(failed.length > 0 && new RegExp(`CIVLITE_UI_REJECTED: ${failed.length}\\b`).test(log), "the probe rejects the sabotaged project");
    assert.ok(findings.length > 0, "the oracle rejects the sabotaged project");
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
