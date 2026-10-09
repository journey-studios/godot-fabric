import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { cp, readFile, writeFile, rm } from "node:fs/promises";
import { createHarness, hash } from "./consumer-harness.mjs";

// V05-03 `consumidor`: Frontier (consumers/civ-lite) as a consumer project provisioned by the addon, built by the editor plugin
// with no Node of its own and no network, and run through ten cycles that must not leak (docs/research/frontier-consumer.md).
// `--capture` adds the headed run that saves the screenshots of the game and of the menu. `--sabotage=<name>` runs the same
// project with a retained sabotage already in the sources (scripts/consumer-civ-lite-sabotage.mjs swaps them in and out); it
// passes only if the validation rejects the project, for the reason it was broken.
const capture = process.argv.includes("--capture");
const sabotageArgument = process.argv.find(argument => argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : sabotageArgument.slice("--sabotage=".length);
// What validation.gd counts: 6 before the cycles, 12 in the first cycle (it has no cycle to compare with) and 16 in each of the nine
// others, then 3 after them. The headed run adds the three of its captures.
const CYCLES = 10;
const NEW_GAMES_PER_CYCLE = 3;
const BINDINGS = 15;
// The calls the HUD makes in a cycle: New game, three intents, the end of a turn, the menu, New game. The end of a turn is a job.
const CALLS_PER_CYCLE = 7;
const PHASES_SEEN = ["ai_plan", "ai_move", "production", "growth", "research", "refresh", "idle"];
const nativeChecks = 6 + 12 + 9 * 16 + 3;
const graphicalChecks = nativeChecks + 3;
// What a sabotaged run must fail, and the series that shows it. Each pattern names a check of validation.gd.
const SABOTAGES = {
  "hud-leak": { failed: [/the connections the HUD holds are the first cycle's/, /the registry's subscriptions are the first cycle's/, /in the menu the HUD showed it/], grows: ["hudSubscriptions", "subscriptions"] },
  "orphan": { failed: [/the orphan nodes are the first cycle's/, /the two Worlds the cycle dropped .* are freed/], grows: ["orphans"] },
  "epoch-reset": { failed: [/the epoch rose by exactly the 3 new games of the cycle/, /The epoch only rose across the ten cycles/], grows: [] },
  "no-facade": { failed: [/The scene injects the addon's facade/, /The node registered the two states, the signal and the 12 methods/], grows: [], log: /FABRIC_ERROR: GameServices has no fabric_api/ },
  "job-dies-with-menu": { failed: [/the end of the turn pressed in the same frame as the menu finished with the menu open/], grows: [] },
};
assert.ok(sabotage === null || sabotage in SABOTAGES, `Unknown sabotage: ${sabotage}`);

// The imports the HUD may have: the public API of the platform and its own files (the store, the panels and the types of the
// services, all under ui/), nothing of the laboratory.
const publicModules = ["react", "react-native", "@godot-fabric/runtime"];
const importsOf = source => [...source.matchAll(/^\s*import\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm)].map(match => match[1]);
const sourcesUnder = (directory, prefix = "") => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? sourcesUnder(path.join(directory, entry.name), `${prefix}${entry.name}/`) : /\.tsx?$/.test(entry.name) ? [`${prefix}${entry.name}`] : []);

const harness = await createHarness({ template: "civ-lite", name: sabotage === null ? "consumer-civ-lite" : `consumer-civ-lite-sabotage-${sabotage}` });
const { directory, project, env, checks, sdk, verify, run, editor } = harness;
await rm(path.join(directory, sabotage === null ? "report.json" : "observed.json"), { force: true });
const read = async (...names) => JSON.parse(await readFile(path.join(project, ...names), "utf8"));
const rows = series => series.map(row => ({
  cycle: row.cycle, nodes: row.nodes, orphans: row.orphans, bindings: row.bindings, subscriptions: row.subscriptions,
  connections: row.connections, hudSubscriptions: row.hudSubscriptions, epoch: row.epoch, hudEpoch: row.hudEpoch,
  jobs: row.jobs === undefined ? null : [row.jobs.pressed, row.jobs.withMenu.job],
}));
try {
  await harness.provision();
  await cp(path.join(sdk, "manifest.json"), path.join(directory, "sdk-manifest.json"));
  const manifest = await read("addons", "godot_fabric", "manifest.json");
  verify(spawnSync("node", ["--version"], { env }).error?.code === "ENOENT", "Consumer cannot find global Node");

  // The template is a project of its own, with the facade injected by its scene and nothing of the laboratory in it.
  const mainScene = await readFile(path.join(project, "main.tscn"), "utf8");
  const services = await readFile(path.join(project, "services", "game_services.gd"), "utf8");
  const world = await readFile(path.join(project, "world", "world.gd"), "utf8");
  const projectFile = await readFile(path.join(project, "project.godot"), "utf8");
  verify(["project.godot", "main.tscn", "validation.gd", "package.json", "package-lock.json", "tsconfig.json", "ui/application.tres", "ui/index.tsx",
    "ui/frontier-types.ts", "ui/store.ts", "ui/telemetry.ts", "ui/hud/hud.tsx", "ui/hud/bar.tsx", "ui/hud/actions.tsx", "ui/hud/tile.tsx", "ui/hud/city.tsx",
    "ui/hud/research.tsx", "ui/hud/dialog.tsx", "game/game.gd", "services/game_services.gd", "services/schema.gd", "world/world.tscn", "world/world.gd"].every(file => existsSync(path.join(project, file)))
    && ["sdk", "tests", "build", "consumers", "examples", "src", "native"].every(directory => !existsSync(path.join(project, directory))),
  "The provisioned project is the template plus the addon, with no laboratory directory");
  verify(/application="res:\/\/ui\/application\.tres"/.test(projectFile) && /res:\/\/addons\/godot_fabric\/plugin\.cfg/.test(projectFile),
    "The project enables the addon's plugin and names its application Resource");
  const lockPath = path.join(project, "package-lock.json");
  const originalLock = await readFile(lockPath);

  if (sabotage === null) {
    // What the sabotages break is left to the validation, which has to notice it: these read the sources and would stop the run first.
    verify(/path="res:\/\/addons\/godot_fabric\/godot_fabric\.gd"[\s\S]*fabric_api=ExtResource/.test(mainScene) && !mainScene.includes("res://sdk")
      && !services.includes("res://sdk") && !world.includes("res://sdk") && !/\bGodotFabric\b/.test(services.replace(/#.*$/gm, "")),
    "The scene injects the addon's facade and no script of the project names a path to the laboratory SDK or the global class");
    verify(/^\[node name="GameServices" type="Node"\]/m.test(mainScene) && /instance=ExtResource\("5"\)/.test(mainScene) && /type="FabricSurface"/.test(mainScene),
      "The scene's root is the GameServices node, with the Application, the World and a HUD surface under it");
    const hud = sourcesUnder(path.join(project, "ui"));
    const types = await readFile(path.join(project, "ui", "frontier-types.ts"), "utf8");
    const inside = (file, name) => {
      const target = path.posix.join(path.posix.dirname(file), name);
      return name.startsWith(".") && (hud.includes(`${target}.ts`) || hud.includes(`${target}.tsx`));
    };
    const imported = await Promise.all(hud.map(async file => ({ file, names: importsOf(await readFile(path.join(project, "ui", file), "utf8")) })));
    verify(hud.includes("index.tsx") && imported.every(({ file, names }) => names.every(name => publicModules.includes(name) || inside(file, name)))
      && importsOf(types).every(name => name === "@godot-fabric/runtime"),
    "The HUD is public TSX: every file under ui/ imports only react, react-native, @godot-fabric/runtime and another file of ui/");
    const guide = await readFile(path.join(project, "README.md"), "utf8");
    assert.doesNotMatch(guide, /\]\(\.\.\/\.\.\//);
    verify(guide.includes(`https://github.com/journey-studios/godot-fabric/blob/${manifest.sourceCommit}/docs/research/frontier-consumer.md`),
      "The provisioned guide links the research note at the provisioned revision");
  }

  await editor("editor-cold");
  verify(hash(await readFile(lockPath)) === hash(originalLock), "Editor build preserves the project lockfile");

  if (sabotage !== null) {
    // The project is broken on purpose: its own validation must reject it, and the series must show why.
    const expected = SABOTAGES[sabotage];
    const log = await run("runtime", harness.godot, ["--path", project, "--headless", "--", "--validate", "--sabotage"]);
    const report = await read("civ-lite-report.json");
    const failed = report.checks.filter(check => !check.passed).map(check => check.name);
    verify(failed.length > 0 && new RegExp(`CIVLITE_SABOTAGE_REJECTED: ${failed.length}\\b`).test(log), "The validation rejects the sabotaged project");
    for (const pattern of expected.failed) {
      verify(failed.some(name => pattern.test(name)), `${pattern} is among the failed checks:\n${failed.join("\n")}`);
    }
    for (const name of expected.grows) {
      const first = report.series[0][name];
      verify(report.series.at(-1)[name] > first, `${name} grew across the cycles (${report.series.map(row => row[name]).join(", ")})`);
    }
    if (expected.log) {
      verify(expected.log.test(log), `${expected.log} is in the log`);
    }
    await writeFile(path.join(directory, "observed.json"), JSON.stringify({
      format: "godot-fabric.consumer-civ-lite-sabotage-run/v1", sabotage, failedChecks: failed, series: rows(report.series),
      logLines: log.split("\n").filter(line => /FABRIC_ERROR/.test(line)).slice(0, 3),
    }, null, 2) + "\n");
    console.log(`CONSUMER_CIVLITE_SABOTAGE_REJECTED: ${sabotage}: ${failed.length} failed checks`);
  } else {
    const report = await harness.runtime("headless", { marker: /CIVLITE_VALIDATION_PASSED/, report: "civ-lite-report.json", expectedChecks: nativeChecks });
    verify(report.beforeStop.bundleEvaluations === 1, "The consumer executes its bundle once, for ten cycles");

    // The series, read again here: Godot's own comparison is not taken on trust.
    const { series, baseline } = report;
    verify(series.length === CYCLES && series.every((row, index) => row.cycle === index + 1), "The report holds one measurement for each of the ten cycles");
    verify(series.every(row => ["nodes", "orphans", "subscriptions", "connections", "hudSubscriptions"].every(name => row[name] === baseline[name])),
      `Nodes (${baseline.nodes}), orphans (${baseline.orphans}), subscriptions (${baseline.subscriptions}), snapshot_changed connections (${baseline.connections}) and HUD connections (${baseline.hudSubscriptions}) are the first cycle's after every cycle`);
    verify(series.every(row => row.bindings === BINDINGS && row.pendingHostTasks === 0 && row.pendingEvents === 0 && row.worlds === 1),
      "Every cycle ends with the 14 bindings, nothing pending and exactly one World");
    verify(series.every((row, index) => row.epoch === 1 + NEW_GAMES_PER_CYCLE * (index + 1) && row.hudEpoch === row.epoch
      && JSON.stringify(row.epochsSeen) === JSON.stringify([row.epoch - 2, row.epoch - 1, row.epoch])),
    "The epoch rises by exactly the three new games of each cycle, strictly, and the HUD and Godot agree on it");
    verify(series.every(row => row.freed.every(Boolean) && row.menu.screen === "menu" && row.menu.world === false && row.menu.hudSubscriptions === 0
      && row.results.length === CALLS_PER_CYCLE && row.results.every(result => result.ok === 1)),
    "Every cycle went to the menu with no World and no HUD connection, freed the Worlds it dropped, and every call was accepted");
    // The end of a turn is a job (docs/research/frontier-consumer.md): the HUD pressed one, saw it through every phase to rest, and a
    // second one pressed in the same frame as the menu finished with the menu open. The ids are the node's, two a cycle.
    verify(series.every(row => row.jobs.pressed === 2 * row.cycle - 1 && row.jobs.withMenu.job === 2 * row.cycle
      && JSON.stringify(row.jobs.phasesSeen) === JSON.stringify(PHASES_SEEN)
      && row.results.filter(result => result.id === "frontier.end_turn").map(result => result.job).join() === `${row.jobs.pressed},${row.jobs.withMenu.job}`),
    "Every cycle's end of turn was a job accepted with the node's next id, seen by the HUD through every phase");
    verify(series.every(row => row.jobs.withMenu.finished === 1 && row.jobs.withMenu.running === 0 && row.jobs.withMenu.world === false
      && row.jobs.withMenu.turnAfter === row.jobs.withMenu.turnBefore + 1 && row.jobs.withMenu.nextJob === row.jobs.withMenu.job + 1
      && row.jobs.withMenu.finishedTotalAfter === row.jobs.withMenu.finishedTotalBefore + 1),
    "Every cycle's job pressed in the same frame as the menu finished once with the menu open, and the World did not come back");

    if (capture) {
      const graphical = await harness.runtime("graphical", { headed: true, marker: /CIVLITE_VALIDATION_PASSED/, report: "civ-lite-report.json", expectedChecks: graphicalChecks });
      verify(graphical.series.length === CYCLES, "The headed run also ran the ten cycles");
      for (const stage of ["game", "menu"]) {
        await cp(path.join(project, `civ-lite-${stage}.png`), path.join(directory, `${stage}.png`));
      }
    }

    const bundlePath = path.join(project, ".godot_fabric", "app.js");
    const bundleHash = hash(await readFile(bundlePath));
    await cp(bundlePath, path.join(directory, "baseline-bundle.js"));
    const buildReport = await read(".godot_fabric", "build-report.json");
    await cp(path.join(project, ".godot_fabric", "build-report.json"), path.join(directory, "bundle-report.json"));
    const inputs = buildReport.inputs;
    verify(inputs.every(file => !/(?:^|\/)examples\//.test(file) && !file.startsWith("project/../") && !file.startsWith("project/node_modules/")),
      "The bundle has no laboratory, examples or SDK-checkout source, and no project dependency");
    verify(["index.tsx", "store.ts", "frontier-types.ts", "hud/hud.tsx", "hud/bar.tsx"].every(file => inputs.includes(`project/ui/${file}`)),
      "The bundle is built from the project's own TSX: the HUD, its store, its panels and the types of the services");

    await run("offline", "/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)(deny network*)", path.join(sdk, "toolchain", "node", "bin", "node"),
      path.join(sdk, "toolchain", "build.mjs"), project, "res://ui/index.tsx", "res://.godot_fabric/app.js"]);
    verify(hash(await readFile(bundlePath)) === bundleHash, "The provisioned build works with network denied and no global Node, and gives the same bundle");
    verify(hash(await readFile(lockPath)) === hash(originalLock), "Building and running preserve the project lockfile");

    await writeFile(path.join(directory, "series.json"), JSON.stringify(rows(series), null, 2) + "\n");
    await writeFile(path.join(directory, "report.json"), JSON.stringify({
      schemaVersion: 1, host: "macOS arm64", template: "civ-lite", checks, nativeChecks, graphicalChecks: capture ? graphicalChecks : null,
      cycles: CYCLES, newGamesPerCycle: NEW_GAMES_PER_CYCLE, bindings: BINDINGS, baseline, series: rows(series), bundleSha256: bundleHash,
    }, null, 2) + "\n");
    console.log(`CONSUMER_CHECK_PASSED: civ-lite: ${checks.length} build/ownership checks; ${nativeChecks} native checks; ${CYCLES} cycles`);
  }
} finally { await harness.cleanup(); }
