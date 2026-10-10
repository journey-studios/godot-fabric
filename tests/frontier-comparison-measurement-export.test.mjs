import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { runSelfCheck } from "../scripts/frontier-comparison-campaign-instrument.mjs";
import { runCampaign } from "../scripts/frontier-comparison-campaign.mjs";
import { createReleaseLauncher } from "../scripts/frontier-comparison-campaign-launchers.mjs";
import { armProject } from "../scripts/frontier-comparison-arms.mjs";
import {
  APP_NAMES, MIN_FREE_BYTES, appBytes, exportArm, exportMeasurementProject, exportProbe, manifestOf, writeManifest,
} from "../scripts/frontier-comparison-measurement-export.mjs";
import { MANIFEST_FILE, hashesOf, hashProblems, manifestErrors, readExports, readProbeExport } from "../scripts/frontier-comparison-release.mjs";
import { sha256 } from "../scripts/frontier-comparison-run-campaign.mjs";
import { MEASUREMENT_FILES, scriptsOf } from "../scripts/frontier-comparison-run.mjs";
import { fakeClock, scriptedLoad, where } from "./frontier-comparison-campaign-fake.mjs";
import { createFakeExports } from "./frontier-comparison-release-fake-app.mjs";

// The script that exports the Release measurement apps (scripts/frontier-comparison-measurement-export.mjs, V05-10 `execucao`), Node only, with the copy of civ-lite and `exportPreparedProject` replaced by
// fakes: what is exported with which options, in which order, with and without the measurement files in the copy, the sizes of the product, the manifest that is written and read back by the launcher's
// own readers, and what the script refuses. The Release launcher in its headless rehearsal mode is tried over the fake exports of the launcher's tests. Nothing here exports or runs an app;
// tests/frontier-comparison-measurement-export-native.test.mjs does, with the real template.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const civLite = await readFile(path.join(root, "consumers", "civ-lite", "project.godot"), "utf8");
const protocolBytes = await readFile(path.join(root, "docs", "research", "frontier-comparison-protocol.json"));
const protocol = JSON.parse(protocolBytes);
const exists = (file) => stat(file).then(() => true, () => false);
// Scenario files as the copy has them: by repository path, copied to comparison/<name>.
const SCENARIO_KEYS = ["tests/frontier-comparison-scenario.gd", "tests/frontier-comparison-hud.gd", "tests/cpu-time-instrument.gd"];

let scratch = null;
let counter = 0;
before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "frontier-comparison-measurement-export-"));
});
after(async () => {
  await rm(scratch, { recursive: true, force: true });
});
const folder = async (name) => {
  const directory = path.join(scratch, `${name}-${counter++}`);
  await mkdir(directory, { recursive: true });
  return directory;
};

// A copy as prepareProject leaves it: the project with the extension, the HUD built, the scenario in comparison/ and the entry files. `imports` records the editor's imports; the import rewrites the
// cache of global classes, which names the entry class only while its file is there.
async function fakePrepare(parent, { arm, imports }) {
  const project = path.join(parent, `project-${arm}`);
  const directory = path.join(parent, `harness-${arm}`);
  await mkdir(path.join(directory, "template-engine"), { recursive: true });
  const files = { "project.godot": civLite, "main.tscn": "scene C\n", "main_bare.tscn": "scene A\n", "main_native.tscn": "scene B\n", "addons/godot_fabric/plugin.cfg": "plugin\n",
    ".godot/extension_list.cfg": "list\n", ".godot_fabric/app.js": "bundle\n", "game/rules.gd": "rules\n" };
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(project, file)), { recursive: true });
    await writeFile(path.join(project, file), content);
  }
  const hashes = {};
  for (const key of SCENARIO_KEYS) {
    const content = `fake ${key}\n`;
    await mkdir(path.join(project, "comparison"), { recursive: true });
    await writeFile(path.join(project, "comparison", path.basename(key)), content);
    hashes[key] = sha256(content);
  }
  for (const [file, content] of Object.entries(MEASUREMENT_FILES)) {
    await writeFile(path.join(project, file), content);
    hashes[file] = sha256(content);
  }
  const harness = {
    project,
    directory,
    godot: "the-engine",
    async run(label) {
      imports.push({ label, comparison: await exists(path.join(project, "comparison")), override: await exists(path.join(project, "override.cfg")) });
      await mkdir(path.join(project, ".godot"), { recursive: true });
      const entry = (await exists(path.join(project, "comparison", "frontier-comparison-entry.gd"))) ? "FrontierComparisonEntry" : "";
      await writeFile(path.join(project, ".godot", "global_script_class_cache.cfg"), `list=[${entry}]\n`);
      return "";
    },
    async cleanup() {
      await rm(project, { recursive: true, force: true });
    },
  };
  return { harness, scripts: scriptsOf(hashes) };
}

// exportPreparedProject, replaced: it records how it was called and what the copy held at that moment, and writes an .app whose executable, PCK and (with frameworks) framework have sizes
// of their own. `skew` makes the second export of a product one byte larger than the first.
function fakeExporter(calls, { skew = false } = {}) {
  return async ({ harness, template, staging, bundleIdentifier, templateMember, receipt, ...options }) => {
    const measurement = options.includeFilter.includes("override.cfg");
    const product = calls.filter((call) => !call.measurement && call.project === harness.project).length;
    calls.push({ project: harness.project, staging, bundleIdentifier, templateMember, options, measurement, comparison: await exists(path.join(harness.project, "comparison")), override: await exists(path.join(harness.project, "override.cfg")) });
    const executable = path.join(staging, "Contents", "MacOS", "Frontier");
    const pck = path.join(staging, "Contents", "Resources", "Frontier.pck");
    await mkdir(path.dirname(executable), { recursive: true });
    await mkdir(path.dirname(pck), { recursive: true });
    await writeFile(executable, "e".repeat(100));
    await writeFile(pck, "p".repeat(measurement ? 300 : 200) + (skew && product === 1 ? "!" : ""));
    if (options.frameworks) {
      await mkdir(path.join(staging, "Contents", "Frameworks"), { recursive: true });
      await writeFile(path.join(staging, "Contents", "Frameworks", "framework.bin"), "f".repeat(1000));
    }
    await symlink("framework.bin", path.join(staging, "Contents", "link"));
    const member = { sha256: sha256("member"), archiveSha256: sha256("template") };
    return {
      app: { path: staging, sha256: sha256(staging) },
      executable: { path: executable, sha256: sha256(await readFile(executable)) },
      pck: { path: pck, sha256: sha256(await readFile(pck)) },
      templateSha256: member.archiveSha256,
      engineVersion: "4.7.2.stable.fake",
      receipt: { templateMember: member, stages: [] },
      pack: { fileCount: 3, paths: ["a", "b", "c"] },
    };
  };
}

const depsOf = (parent, calls, imports, extra = {}) => ({
  prepare: async ({ name }) => fakePrepare(parent, { arm: name.at(-1).toUpperCase(), imports }),
  exportApp: fakeExporter(calls, extra.exporter),
  freeBytes: extra.freeBytes ?? (async () => 10 * MIN_FREE_BYTES),
  prepareProbe: async (directory) => {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "project.godot"), "config_version=5\n\n[application]\n\nconfig/name=\"probe\"\n\n[rendering]\n\nrenderer/rendering_method=\"gl_compatibility\"\n");
    return { scripts: scriptsOf({ "tests/cpu-time-instrument.gd": sha256("instrument"), "project.godot": sha256("the probe's own project.godot") }) };
  },
  makeHarness: async ({ name }) => {
    const directory = path.join(parent, `harness-${name}`);
    await mkdir(path.join(directory, "template-engine"), { recursive: true });
    return { project: path.join(parent, `project-${name}`), directory, godot: "the-engine", async cleanup() {} };
  },
});

test("each arm is exported with its own options: the measurement project once, with the measurement files in the copy, and the product twice, without them", async () => {
  for (const arm of ["A", "B", "C"]) {
    const parent = await folder(`options-${arm}`);
    const calls = [];
    const imports = [];
    const result = await exportArm({ arm, out: path.join(parent, "out"), template: "template.zip", deps: depsOf(parent, calls, imports) });
    const set = armProject(arm);
    assert.deepEqual(calls.map((call) => call.options), [set.measurement, set.product, set.product], `${arm}: the measurement project, then the product twice`);
    assert.deepEqual(calls.map((call) => [call.comparison, call.override]), [[true, true], [false, false], [false, false]], "the product is exported from a copy that never has the measurement files");
    assert.equal(calls[0].staging, path.join(parent, "out", arm, APP_NAMES[arm]));
    assert.deepEqual(calls.slice(1).map((call) => path.basename(call.staging)), [`.${arm}-product-1.app`, `.${arm}-product-2.app`]);
    assert.deepEqual(calls.map((call) => call.bundleIdentifier), Array(3).fill(`org.journeystudios.godotfabric.comparison.${arm.toLowerCase()}`));
    assert.equal(calls[0].templateMember, null, "the first export inspects the template");
    assert.deepEqual(calls[1].templateMember, calls[2].templateMember, "and the later ones are handed what it found");
    assert.equal(calls[1].templateMember.sha256, sha256("member"));
    // The shape: A and B lost the extension and took their scene; the measurement files left the copy before the product, with an import in between.
    assert.equal(await exists(path.join(parent, "out", `.${arm}-product-1.app`)), false, "a product app is removed as soon as it was measured");
    assert.equal(await exists(path.join(parent, "out", arm, APP_NAMES[arm])), true);
    assert.deepEqual(imports.map((entry) => [entry.label, entry.comparison]), [[`import-${arm.toLowerCase()}-measurement`, true], [`import-${arm.toLowerCase()}-product`, false]]);
    // The sizes: the whole app (the engine, the PCK and, in C, the framework; the link counts for nothing), twice.
    const expected = 100 + 200 + (arm === "C" ? 1000 : 0);
    assert.deepEqual(result.manifest.exportBytes, [expected, expected]);
    assert.deepEqual(result.products.map((product) => [product.appBytes, product.pckBytes]), [[expected, 200], [expected, 200]]);
    assert.deepEqual([result.measurement.appBytes, result.measurement.pckBytes], [expected + 100, 300]);
  }
});

test("the manifest of each export is written beside its app, and the launcher's own readers read the four back", async () => {
  const parent = await folder("manifests");
  const out = path.join(parent, "exports");
  const calls = [];
  const log = [];
  const { summary, arms, probe } = await exportMeasurementProject({ out, template: "template.zip", log: (line) => log.push(line), deps: depsOf(parent, calls, []) });
  const entries = await readExports(out);
  const probeEntry = await readProbeExport(out);
  assert.deepEqual(Object.keys(entries), ["A", "B", "C"]);
  assert.equal(probeEntry.manifest.arm, "probe");
  for (const arm of ["A", "B", "C"]) {
    const { manifest } = entries[arm];
    assert.deepEqual(manifestErrors(manifest, arm), []);
    assert.deepEqual([manifest.app, manifest.executable, manifest.pck], [APP_NAMES[arm], `${APP_NAMES[arm]}/Contents/MacOS/Frontier`, `${APP_NAMES[arm]}/Contents/Resources/Frontier.pck`]);
    assert.deepEqual(hashProblems(entries[arm], await hashesOf(entries[arm])), [], `${arm}: the hashes in the manifest are those of the files`);
    assert.equal(manifest.godot, "4.7.2.stable.fake");
    assert.equal(manifest.templateSha256, sha256("template"));
    assert.equal(manifest.scriptSha256, scriptsOf(manifest.scriptFiles).sha256);
    assert.deepEqual(Object.keys(manifest.scriptFiles).sort(), [...SCENARIO_KEYS, ...Object.keys(MEASUREMENT_FILES)].sort(), "the files of the scenario in the copy, as prepareProject hashed them");
    assert.deepEqual(manifest.exportBytes, arms[arm].products.map((product) => product.appBytes));
  }
  assert.ok(entries.C.manifest.exportBytes[0] > entries.A.manifest.exportBytes[0], "C weighs what its frameworks weigh more than A");
  assert.equal(entries.A.manifest.exportBytes[0], entries.B.manifest.exportBytes[0]);
  // The probe: one export with no frameworks and the include filter that brings override.cfg into the PCK, its size twice, and the project.godot it exported hashed.
  assert.deepEqual(probe.options, { exportFilter: "all_resources", includeFilter: "override.cfg", excludeFilter: "", frameworks: false });
  assert.deepEqual(calls.at(-1).options, probe.options);
  assert.deepEqual(probeEntry.manifest.exportBytes, [probe.measurement.appBytes, probe.measurement.appBytes]);
  assert.notEqual(probeEntry.manifest.scriptFiles["project.godot"], sha256("the probe's own project.godot"), "the export adds the texture formats to project.godot, and the hash follows");
  assert.equal(calls.length, 10, "three exports for each of three arms, and one of the probe");
  assert.equal(log.at(-1), "the manifests of the three arms and of the probe were read and checked by the launcher's readers");
  // The summary beside them says what it is.
  const written = JSON.parse(await readFile(path.join(out, "export-summary.json"), "utf8"));
  assert.match(written.notAResult, /not the package-size axis of the report/);
  assert.deepEqual(Object.keys(written.arms), ["A", "B", "C"]);
  assert.deepEqual(written.arms.C.set.product, armProject("C").product);
  assert.equal(written.templateSha256, sha256("template"));
  assert.deepEqual(summary, written);
  await assert.rejects(readFile(path.join(out, "A", "stray"), "utf8"));
});

test("what the script refuses: unequal product sizes, a copy that is not the script's, a stale class cache, too little disk and a name that is not an export", async () => {
  // The two exports of a product differ by a byte: no manifest is written for the arm.
  const unequal = await folder("unequal");
  await assert.rejects(exportArm({ arm: "B", out: path.join(unequal, "out"), template: "t.zip", deps: depsOf(unequal, [], [], { exporter: { skew: true } }) }), /the two exports of the product of arm B differ in size: 300 \(pck 200\) and 301 \(pck 201\)/);
  assert.equal(await exists(path.join(unequal, "out", "B", MANIFEST_FILE)), false);
  // The script registered a hash that the copy's file does not have: nothing is exported.
  const stale = await folder("stale");
  const calls = [];
  const deps = depsOf(stale, calls, []);
  const prepare = deps.prepare;
  deps.prepare = async (request) => {
    const prepared = await prepare(request);
    await writeFile(path.join(prepared.harness.project, "comparison", "frontier-comparison-hud.gd"), "another file\n");
    return prepared;
  };
  await assert.rejects(exportArm({ arm: "A", out: path.join(stale, "out"), template: "t.zip", deps }), /tests\/frontier-comparison-hud\.gd is [0-9a-f]{64} in the copy that is exported, and the script registered [0-9a-f]{64}/);
  assert.deepEqual(calls, []);
  // The import after the measurement files left still names the entry class: the product would carry it.
  const cache = await folder("cache");
  const dirty = depsOf(cache, [], []);
  const dirtyPrepare = dirty.prepare;
  dirty.prepare = async (request) => {
    const prepared = await dirtyPrepare(request);
    prepared.harness.run = async () => {
      await mkdir(path.join(prepared.harness.project, ".godot"), { recursive: true });
      await writeFile(path.join(prepared.harness.project, ".godot", "global_script_class_cache.cfg"), "list=[FrontierComparisonEntry]\n");
      return "";
    };
    return prepared;
  };
  await assert.rejects(exportArm({ arm: "C", out: path.join(cache, "out"), template: "t.zip", deps: dirty }), /the cache of global classes still names the measurement entry/);
  // Less than the minimum free: the export does not start, and the temporary copy is cleaned all the same.
  const full = await folder("full");
  const fullCalls = [];
  await assert.rejects(
    exportArm({ arm: "A", out: path.join(full, "out"), template: "t.zip", deps: depsOf(full, fullCalls, [], { freeBytes: async () => MIN_FREE_BYTES - 1 }) }),
    /only 599 MB are free where .* is, and an export needs 600 MB at least/,
  );
  assert.deepEqual(fullCalls, []);
  assert.equal(await exists(path.join(full, "project-A")), false, "the copy is removed when the export is refused");
  assert.equal(await exists(path.join(full, "harness-A", "template-engine")), false, "and so is the extracted engine");
  await assert.rejects(exportProbe({ out: path.join(full, "out"), template: "t.zip", deps: depsOf(full, fullCalls, [], { freeBytes: async () => 0 }) }), /an export needs 600 MB at least/);
  assert.deepEqual(fullCalls, []);
  await assert.rejects(exportMeasurementProject({ out: path.join(full, "out"), template: "t.zip", only: ["A", "D"], deps: depsOf(full, fullCalls, []) }), /--only takes A, B, C, probe; not D/);
});

test("a manifest that is not good is not written, the size of an app counts its files and no link, and the paths are relative to the arm's folder", async () => {
  const parent = await folder("manifest-unit");
  const app = path.join(parent, "x", "X.app");
  await mkdir(path.join(app, "Contents", "MacOS"), { recursive: true });
  await mkdir(path.join(app, "Contents", "Resources"), { recursive: true });
  await writeFile(path.join(app, "Contents", "MacOS", "X"), "12345");
  await writeFile(path.join(app, "Contents", "Resources", "X.pck"), "123");
  await symlink("MacOS/X", path.join(app, "Contents", "link"));
  assert.equal(await appBytes(app), 8, "the link is not a file of the bundle");
  const exported = { app: { path: app }, executable: { path: path.join(app, "Contents", "MacOS", "X"), sha256: sha256("5") }, pck: { path: path.join(app, "Contents", "Resources", "X.pck"), sha256: sha256("3") },
    templateSha256: sha256("t"), engineVersion: "4.7.2.stable.fake" };
  const scripts = scriptsOf({ "tests/cpu-time-instrument.gd": sha256("i") });
  const manifest = manifestOf({ arm: "A", directory: path.join(parent, "x"), exported, scripts, sizes: [8, 8] });
  assert.deepEqual([manifest.app, manifest.executable, manifest.pck], ["X.app", "X.app/Contents/MacOS/X", "X.app/Contents/Resources/X.pck"]);
  assert.deepEqual(manifestErrors(manifest, "A"), []);
  const file = await writeManifest(path.join(parent, "x"), manifest);
  assert.equal(file, path.join(parent, "x", MANIFEST_FILE));
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), manifest);
  const bad = manifestOf({ arm: "A", directory: path.join(parent, "x"), exported, scripts, sizes: [8, 9] });
  await assert.rejects(writeManifest(path.join(parent, "y"), bad), /the manifest of A is not good, and was not written:\nexportBytes are 8 and 9/);
  assert.deepEqual(await readdir(parent), ["x"], "nothing was written for the bad one");
});

test("the Release launcher in its rehearsal mode runs the exports headless, says so, and a campaign refuses it unless it is a rehearsal", async () => {
  const parent = await folder("headless");
  const exports = await createFakeExports(parent, { probe: {}, programs: { A: { report: null }, B: { report: null }, C: { report: null } } });
  const windowed = createReleaseLauncher({ exportsDirectory: exports.directory });
  assert.deepEqual([windowed.windowed, windowed.rehearsalOnly], [true, false]);
  const headless = createReleaseLauncher({ exportsDirectory: exports.directory, windowed: false });
  assert.deepEqual([headless.build, headless.windowed, headless.rehearsalOnly], ["release", false, true]);
  assert.match(headless.name, /headless/);
  const prepared = await headless.prepare();
  assert.equal(prepared.deviations.length, 1);
  assert.match(prepared.deviations[0], /^the Release exports ran headless \(--headless\).*because this is a rehearsal.*a campaign proper runs windowed$/);
  assert.deepEqual((await windowed.prepare()).deviations, []);
  assert.notEqual(headless.selfCheck, "unsupported", "the probe's export gives the self-check its entry");
  const out = path.join(parent, "launch-out");
  await mkdir(out);
  await headless.launch({ arm: "B", lane: "unlimited" });
  const launched = (await exports.launches()).map((launch) => launch.arguments);
  assert.equal(launched.length, 1);
  assert.deepEqual(launched[0].slice(0, 4), ["--headless", "--", "--arm=B", "--lane=unlimited"]);
  await headless.cleanup();
  await windowed.cleanup();

  // The campaign: refused without --rehearsal, before the state, the self-check or any process; with it, the gate runs headless through the probe and the slot runs headless.
  const refused = path.join(parent, "refused");
  await assert.rejects(
    runCampaign({ launcher: createReleaseLauncher({ exportsDirectory: exports.directory, windowed: false }), protocol, protocolSha256: sha256(protocolBytes), out: refused, lanes: ["presented"], rehearsal: false, lockFile: path.join(parent, "campaign.lock"),
      runCheck: () => assert.fail("the self-check ran") }),
    /cannot run the campaign:\nthe launcher runs headless \(release: the exports in .*headless\)\), which only a rehearsal does: add --rehearsal, or use a windowed launcher/,
  );
  assert.equal(await exists(refused), false, "no directory was made");
  assert.equal((await exports.launches()).length, 1, "and no process was launched");
  const requests = [];
  // The real self-check, over the fake probe app: the headless judge is the test's, and the instrument's hash is the repository's file's, as the launcher registers it.
  const judged = () => ({ judged: true, violations: [] });
  const result = await runCampaign({
    launcher: createReleaseLauncher({ exportsDirectory: exports.directory, windowed: false }),
    protocol,
    protocolSha256: sha256(protocolBytes),
    out: path.join(parent, "rehearsal"),
    lanes: ["presented"],
    slots: [1, 1],
    rehearsal: true,
    assumeRefreshHz: 60,
    runCheck: async (request) => {
      requests.push(request);
      return runSelfCheck({ ...request, judge: judged });
    },
    read: scriptedLoad([0.5]),
    clock: fakeClock(),
    where,
    lockFile: path.join(parent, "campaign.lock"),
  });
  assert.deepEqual(requests.map((request) => [request.windowed, request.entry, request.executable]), [[false, "release", exports.apps.probe.executable]]);
  assert.deepEqual([result.state.selfCheck.passed, result.state.selfCheck.entry, result.state.selfCheck.lane], [true, "release", "headless"]);
  assert.deepEqual(result.state.stopped, []);
  const deviations = result.state.launcher.deviations.join("\n");
  assert.match(deviations, /the Release exports ran headless/);
  assert.equal(result.state.launcher.build, "release");
  // The launches so far: the B above, the probe (its flag is --report), and the one execution of slot 1.
  const launches = (await exports.launches()).map((launch) => launch.arguments);
  assert.equal(launches.length, 3);
  assert.deepEqual(launches[1].slice(0, 2), ["--headless", "--"]);
  assert.match(launches[1][2], /^--report=\/.+probe-report\.json$/);
  assert.deepEqual(launches[2].slice(0, 4), ["--headless", "--", "--arm=A", "--lane=presented"]);
  assert.equal(JSON.parse(await readFile(path.join(parent, "rehearsal", "rehearsal.json"), "utf8")).sizesAre.startsWith("the size of the whole .app"), true);
});
