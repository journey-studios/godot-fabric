import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  compareVersions, createLedger, describeRefusal, fixtureProblems, INCOMPATIBLE_MINIMUM, INSTALL_STEPS, judgeStart, MIN_INSTALLS,
  outsideProblems, parseInstalls, prepareStartup, refusalProblems, sameNames, treeDiff, verifyColdReport,
} from "../scripts/cold-lanes.mjs";
import { occurrences } from "../scripts/sabotage-sources.mjs";

// The judgements of the GF-02 startup lanes (scripts/cold-lanes.mjs), with no Godot, and the lanes themselves
// (scripts/cold-start.mjs, scripts/cold-start-negative.mjs) driven against a simulated engine that can be told to
// misbehave in one way at a time. Every rule has a mutation here that it must reject. The native lanes run in the
// native-cold-start job (docs/evidence/cold-start.md).

const root = fileURLToPath(new URL("..", import.meta.url));
const ENGINE = "4.7.2";
const clone = (value) => JSON.parse(JSON.stringify(value));

// ---- The count of installs and the no-retry rule ----------------------------------------------------------------

const stepsOf = (install) => INSTALL_STEPS.map((name) => ({ step: `${install}-${name}`, attempts: 1, status: 0, signal: null }));
const goodRun = (install) => ({
  install, freshResources: true, freshUserData: true, startupFiles: ["extension_list.cfg"],
  cases: [{ scenario: "react", checks: 36 }, { scenario: "typography", checks: 55 }], warmImport: "passed", steps: stepsOf(install),
});
const goodReport = (installs = 3) => ({
  schemaVersion: 2, status: "passed", startup: "prepared", installs, minimumInstalls: MIN_INSTALLS,
  runs: Array.from({ length: installs }, (_value, index) => goodRun(index + 1)),
});

test("the installs argument is an integer of at least three", () => {
  assert.equal(MIN_INSTALLS, 3);
  assert.equal(parseInstalls("3"), 3);
  assert.equal(parseInstalls("7"), 7);
  for (const bad of ["2", "1", "0", "-3", "3.5", "three", "", "NaN", "Infinity"]) {
    assert.throws(() => parseInstalls(bad), /at least 3/, bad);
  }
});

test("a report of at least three clean, single-attempt installs is accepted", () => {
  assert.deepEqual(verifyColdReport(goodReport(3)), []);
  assert.deepEqual(verifyColdReport(goodReport(5)), []);
  const skipped = goodReport(3);
  skipped.startup = "skipped";
  for (const run of skipped.runs) {
    run.startupFiles = [];
  }
  assert.deepEqual(verifyColdReport(skipped), []);
});

test("mutation: every way a report can fall short of the installs, the plan or the one-attempt rule is rejected", () => {
  const mutate = (change) => {
    const report = goodReport(3);
    change(report);
    return verifyColdReport(report);
  };
  const mutations = {
    "two installs": [(report) => { report.runs.pop(); report.installs = 2; }, /2 fresh installs ran; at least 3/],
    "one install": [(report) => { report.runs.splice(1); report.installs = 1; }, /1 fresh installs ran/],
    "no installs": [(report) => { report.runs = []; report.installs = 0; }, /0 fresh installs ran/],
    "a count that does not match the list": [(report) => { report.installs = 4; }, /counts 4 installs and lists 3/],
    "a lowered minimum cannot lower the bar": [(report) => { report.runs.pop(); report.installs = 2; report.minimumInstalls = 2; }, /at least 3/],
    "a status that is not a pass": [(report) => { report.status = "failed"; }, /not "passed"/],
    "an install numbered twice": [(report) => { report.runs[2].install = 2; }, /install 3: it is numbered 2/],
    "a step that ran twice": [(report) => { report.runs[0].steps.splice(1, 0, { ...report.runs[0].steps[0] }); }, /install 1: its launches are \[1-import, 1-import, 1-react/],
    "a retry under another name": [(report) => { report.runs[1].steps.splice(1, 0, { step: "2-import-retry", attempts: 1, status: 0, signal: null }); }, /install 2: its launches are/],
    "a skipped step": [(report) => { report.runs[2].steps.splice(2, 1); }, /install 3: its launches are/],
    "steps out of order": [(report) => { report.runs[0].steps.reverse(); }, /install 1: its launches are/],
    "a step attempted twice": [(report) => { report.runs[0].steps[0].attempts = 2; }, /1-import was attempted 2 times/],
    "a step that died by a signal": [(report) => { report.runs[1].steps[2].status = null; report.runs[1].steps[2].signal = "SIGSEGV"; }, /2-typography died by SIGSEGV/],
    "a step that exited non-zero": [(report) => { report.runs[2].steps[3].status = 1; }, /3-warm-import exited with status 1/],
    "a warm cache": [(report) => { report.runs[0].freshResources = false; }, /empty resource cache/],
    "inherited user data": [(report) => { report.runs[0].freshUserData = false; }, /fresh user data/],
    "extra files in the cache": [(report) => { report.runs[1].startupFiles = ["extension_list.cfg", "uid_cache.bin"]; }, /the cache held/],
    "a scenario with no checks": [(report) => { report.runs[2].cases[1].checks = 0; }, /did not both report checks/],
    "a missing scenario": [(report) => { report.runs[0].cases.pop(); }, /did not both report checks/],
    "a warm import that did not pass": [(report) => { report.runs[0].warmImport = "failed"; }, /warm import did not pass/],
  };
  for (const [name, [change, expected]] of Object.entries(mutations)) {
    const problems = mutate(change);
    assert.ok(problems.length > 0, `${name}: the report was accepted`);
    assert.match(problems.join("\n"), expected, name);
  }
  assert.ok(verifyColdReport(null).length > 0);
});

test("the ledger launches a step once and refuses a second launch before it runs", () => {
  const ledger = createLedger();
  let launched = 0;
  const failure = ledger.launch("1-import", () => { launched++; return { status: 1, signal: null }; });
  assert.equal(failure.status, 1);
  assert.throws(() => ledger.launch("1-import", () => { launched++; return { status: 0, signal: null }; }), /Retry refused: 1-import/);
  assert.equal(launched, 1, "the second launch ran");
  ledger.launch("1-react", () => ({ status: null, signal: "SIGKILL" }));
  assert.deepEqual(ledger.entries(), [
    { step: "1-import", attempts: 1, status: 1, signal: null },
    { step: "1-react", attempts: 1, status: null, signal: "SIGKILL" },
  ]);
});

test("a start is judged clean only on exit 0 with no signal, no crash, no error and the marker", () => {
  assert.equal(judgeStart({ status: 0, signal: null, log: "ok\nFABRIC_VALIDATION_PASSED\n" }, "FABRIC_VALIDATION_PASSED"), null);
  assert.equal(judgeStart({ status: 0, signal: null, log: "ok" }), null);
  const mutations = {
    "a signal": [{ status: null, signal: "SIGSEGV", log: "" }, /died by SIGSEGV/],
    "a non-zero exit": [{ status: 2, signal: null, log: "" }, /exited with status 2/],
    "a hang": [{ status: null, signal: "SIGTERM", error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }), log: "" }, /hang guard/],
    "an executable that cannot run": [{ status: null, signal: null, error: Object.assign(new Error("spawnSync x ENOENT"), { code: "ENOENT" }), log: "" }, /could not run/],
    "Godot's crash text at exit 0": [{ status: 0, signal: null, log: "handle_crash: Program crashed with signal 11\n" }, /error or a crash/],
    "an error line at exit 0": [{ status: 0, signal: null, log: "ok\nERROR: Cannot open file\n" }, /error or a crash/],
    "a script error at exit 0": [{ status: 0, signal: null, log: "SCRIPT ERROR: boom\n" }, /error or a crash/],
    "a Fabric error at exit 0": [{ status: 0, signal: null, log: "FABRIC_ERROR: boom\n" }, /error or a crash/],
  };
  for (const [name, [start, expected]] of Object.entries(mutations)) {
    assert.match(judgeStart(start) ?? "", expected, name);
  }
  assert.match(judgeStart({ status: 0, signal: null, log: "ok" }, "FABRIC_VALIDATION_PASSED") ?? "", /did not print FABRIC_VALIDATION_PASSED/);
});

// ---- The failed start --------------------------------------------------------------------------------------------

// Godot 4.7.2's lines, as a real start printed them with compatibility_minimum = "4.99.0" (docs/evidence/cold-start.md).
const REFUSED = "ERROR: GDExtension only compatible with Godot version 4.99.0 or later: res://fabric.gdextension, but your Godot version is 4.7.2";
const REFUSAL_LOG = [
  "Godot Engine v4.7.2.stable.official.ed1daf0bf - https://godotengine.org",
  REFUSED, "   at: parse_gdextension_file (core/extension/gdextension_library_loader.cpp:327)",
  "ERROR: Can't open GDExtension dynamic library: 'res://fabric.gdextension'.", "   at: open_library (core/extension/gdextension.cpp:811)",
  "ERROR: Error loading extension: 'res://fabric.gdextension'.", "   at: load_extensions (core/extension/gdextension_manager.cpp:333)",
  REFUSED, "ERROR: Can't open GDExtension dynamic library: 'res://fabric.gdextension'.",
  'SCRIPT ERROR: Parse Error: Could not resolve class "res://scripts/validation_base.gd".', "          at: GDScript::reload (res://scripts/validation.gd:1)",
  'SCRIPT ERROR: Parse Error: Identifier "FabricSurface" not declared in the current scope.', "          at: GDScript::reload (res://scripts/validation.gd:7)",
  'ERROR: Failed to load script "res://scripts/validation.gd" with error "Parse error".', "",
].join("\n");
const refusedStart = (change = {}) => ({ status: 0, signal: null, error: null, log: REFUSAL_LOG, ...change });
const judgeRefused = (start) => refusalProblems({ start, required: INCOMPATIBLE_MINIMUM, engine: ENGINE });

test("versions compare numerically", () => {
  assert.equal(compareVersions("4.99.0", "4.7.2"), 1);
  assert.equal(compareVersions("4.7.2", "4.7.2"), 0);
  assert.equal(compareVersions("4.7", "4.7.2"), -1);
  assert.equal(compareVersions("4.10.0", "4.9.9"), 1);
});

test("a cache listing is compared as a set of names, whatever order the directory returns them in", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "fabric-cold-names-"));
  try {
    // Created in reverse name order; the order of the listing is not forced, and the comparison must not depend on it.
    writeFileSync(path.join(folder, "b.cfg"), "");
    writeFileSync(path.join(folder, "a.cfg"), "");
    const listing = readdirSync(folder);
    for (const expected of [["a.cfg", "b.cfg"], ["b.cfg", "a.cfg"]]) {
      assert.equal(sameNames(listing, expected), true, JSON.stringify(expected));
      assert.equal(sameNames([...listing].reverse(), expected), true, `reversed ${JSON.stringify(expected)}`);
    }
    // Mutations: a name missing, extra, repeated or different is not the same set.
    for (const expected of [["a.cfg"], ["a.cfg", "b.cfg", "c.cfg"], ["a.cfg", "a.cfg"], ["a.cfg", "c.cfg"], []]) {
      assert.equal(sameNames(listing, expected), false, JSON.stringify(expected));
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("the startup preparation returns the cache listing sorted and refuses a cache that holds anything else", () => {
  const checkout = mkdtempSync(path.join(tmpdir(), "fabric-cold-startup-"));
  try {
    mkdirSync(path.join(checkout, "scripts"));
    mkdirSync(path.join(checkout, "project/addons"), { recursive: true });
    cpSync(path.join(root, "scripts/extension_startup.py"), path.join(checkout, "scripts/extension_startup.py"));
    writeFileSync(path.join(checkout, "project/fabric.gdextension"), "[configuration]\n");
    writeFileSync(path.join(checkout, "project/addons/fabric_godot.dylib"), "library");
    assert.deepEqual(prepareStartup({ root: checkout, project: path.join(checkout, "project") }), ["extension_list.cfg"]);
    // Mutation: a cache that already holds another file is not a fresh install.
    writeFileSync(path.join(checkout, "project/.godot/uid_cache.bin"), "x");
    assert.throws(() => prepareStartup({ root: checkout, project: path.join(checkout, "project") }), /unexpected cache state/);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});

test("Godot's own refusal, ending by itself and without a crash, is accepted", () => {
  assert.deepEqual(judgeRefused(refusedStart()), []);
  const found = describeRefusal(REFUSAL_LOG);
  assert.equal(found.first, REFUSED);
  assert.equal(found.refusals, 2);
  assert.equal(found.notOpened, 2);
  assert.equal(found.notLoaded, 1);
  assert.equal(found.consequences, 3);
  assert.deepEqual(found.unrelated, []);
});

test("mutation: a start that was not refused, or not refused clearly, or not cleanly, is rejected", () => {
  const without = (pattern) => REFUSAL_LOG.split("\n").filter((line) => !pattern.test(line)).join("\n");
  const mutations = {
    "the log of a clean start": [refusedStart({ log: "Godot Engine v4.7.2.stable.official.ed1daf0bf\n[ DONE ] first_scan_filesystem\n" }), /was not refused/],
    "an empty log": [refusedStart({ log: "" }), /was not refused/],
    "a death by a signal": [refusedStart({ status: null, signal: "SIGKILL" }), /died by SIGKILL/],
    "Godot's crash text": [refusedStart({ log: `${REFUSAL_LOG}handle_crash: Program crashed with signal 11\n` }), /crash text/],
    "a hang": [refusedStart({ status: null, signal: "SIGTERM", error: Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }) }), /hang guard/],
    "a start that never exited": [refusedStart({ status: null }), /did not end by itself/],
    "another minimum": [refusedStart({ log: REFUSAL_LOG.replaceAll("version 4.99.0", "version 4.98.0") }), /names the minimum \["4\.98\.0"\]/],
    "another engine": [refusedStart({ log: REFUSAL_LOG.replaceAll("is 4.7.2", "is 4.6.2") }), /names the engine \["4\.6\.2"\]/],
    "another extension": [refusedStart({ log: REFUSAL_LOG.replaceAll("res://fabric.gdextension", "res://other.gdextension") }), /names \["res:\/\/other\.gdextension"\]/],
    "a library that may have been opened": [refusedStart({ log: without(/Can't open GDExtension dynamic library/) }), /could not open the library/],
    "an error that is not the refusal": [refusedStart({ log: `${REFUSAL_LOG}ERROR: Cannot open file 'res://x.png'\n` }), /neither the refusal nor a consequence/],
    "a script error that is not a consequence": [refusedStart({ log: `${REFUSAL_LOG}SCRIPT ERROR: Parse Error: Identifier "typo" not declared in the current scope.\n` }), /neither the refusal nor a consequence/],
    "a Fabric error": [refusedStart({ log: `${REFUSAL_LOG}FABRIC_ERROR: boom\n` }), /neither the refusal nor a consequence/],
    "an error before the refusal": [refusedStart({ log: `ERROR: Something else first\n${REFUSAL_LOG}` }), /first error of the log is not the refusal/],
  };
  for (const [name, [start, expected]] of Object.entries(mutations)) {
    const problems = judgeRefused(start);
    assert.ok(problems.length > 0, `${name}: the start was accepted as refused`);
    assert.match(problems.join("\n"), expected, name);
  }
});

test("causal control: the refusal assertions fail on the log of a start whose metadata was not changed", () => {
  const unchanged = "Godot Engine v4.7.2.stable.official.ed1daf0bf - https://godotengine.org\n[ DONE ] first_scan_filesystem\n[ DONE ] loading_editor_layout\n";
  const problems = judgeRefused({ status: 0, signal: null, error: null, log: unchanged });
  assert.ok(problems.length >= 2);
  assert.match(problems.join("\n"), /was not refused/);
  assert.match(problems.join("\n"), /could not open the library/);
});

const file = (name, sha = `sha:${name}`) => ({ path: name, kind: "file", sha256: sha });
const directory = (name) => ({ path: name, kind: "dir" });
const handed = [directory(".godot"), file(".godot/extension_list.cfg"), file("project.godot"), file("fabric.gdextension"), directory("scripts"), file("scripts/a.gd")];
const engineMade = [directory(".godot/imported"), file(".godot/uid_cache.bin", "cache:1"), file("fabric.gdextension.uid"), file("scripts/a.gd.uid"), directory("build"), file("build/report.json", "report:1")];
const control = { before: handed, after: [...handed, ...engineMade] };
// The refused fixture was handed over with the incompatible metadata, so one file has another hash there.
const refusedBefore = handed.map((entry) => (entry.path === "fabric.gdextension" ? file("fabric.gdextension", "sha:incompatible") : entry));
const cleanRefusal = () => ({ before: refusedBefore, refused: [...refusedBefore, ...engineMade.filter((entry) => !entry.path.startsWith("build"))], recovered: clone(control.after), control });

test("the tree diff names what was added, removed and changed", () => {
  assert.deepEqual(treeDiff([file("a"), file("b"), file("c")], [file("a"), file("b", "other"), file("d")]), { added: ["d"], removed: ["c"], changed: ["b"] });
  assert.deepEqual(treeDiff([file("a")], [{ path: "a", kind: "dir" }]), { added: [], removed: [], changed: ["a"] });
});

test("a refused start that leaves only what a clean start leaves, and a recovery that matches the control, leave no residue", () => {
  assert.deepEqual(fixtureProblems(cleanRefusal()), []);
  // The cache files may differ in content between starts; they are compared by name.
  const recovered = clone(control.after).map((entry) => (entry.path === ".godot/uid_cache.bin" ? file(entry.path, "cache:2") : entry));
  assert.deepEqual(fixtureProblems({ ...cleanRefusal(), recovered }), []);
});

test("mutation: every kind of residue inside the fixture is rejected", () => {
  const mutations = {
    "a source removed by the refused start": [(input) => { input.refused = input.refused.filter((entry) => entry.path !== "scripts/a.gd"); }, /removed scripts\/a\.gd/],
    "a file only the refused start left": [(input) => { input.refused.push(file("stray.bin")); }, /left stray\.bin, which a clean start does not touch/],
    "metadata rewritten by the refused start": [(input) => { input.refused = input.refused.map((entry) => (entry.path === "fabric.gdextension" ? file(entry.path, "sha:fixed") : entry)); }, /left fabric\.gdextension/],
    "the startup list rewritten": [(input) => { input.refused = input.refused.map((entry) => (entry.path === ".godot/extension_list.cfg" ? file(entry.path, "sha:other") : entry)); }, /left \.godot\/extension_list\.cfg/],
    "a staging file in the cache": [(input) => { input.refused.push(file(".godot/.extension-list-ab12")); }, /staging file: \.godot\/\.extension-list-ab12/],
    "a partial cache file": [(input) => { input.refused.push(file(".godot/uid_cache.bin.tmp")); }, /staging file: \.godot\/uid_cache\.bin\.tmp/],
    "a file the control lacks after the recovery": [(input) => { input.recovered.push(file("scripts/b.gd")); }, /after the recovery the fixture has scripts\/b\.gd/],
    "a file the control has, missing after the recovery": [(input) => { input.recovered = input.recovered.filter((entry) => entry.path !== ".godot/uid_cache.bin"); }, /after the recovery the fixture lacks \.godot\/uid_cache\.bin/],
    "a source that differs after the recovery": [(input) => { input.recovered = input.recovered.map((entry) => (entry.path === "scripts/a.gd" ? file(entry.path, "sha:edited") : entry)); }, /after the recovery scripts\/a\.gd differs/],
    "the metadata left incompatible after the recovery": [(input) => { input.recovered = input.recovered.map((entry) => (entry.path === "fabric.gdextension" ? file(entry.path, "sha:incompatible") : entry)); }, /fabric\.gdextension differs/],
  };
  for (const [name, [change, expected]] of Object.entries(mutations)) {
    const input = cleanRefusal();
    change(input);
    const problems = fixtureProblems(input);
    assert.ok(problems.length > 0, `${name}: accepted`);
    assert.match(problems.join("\n"), expected, name);
  }
});

const clean = [
  "home", "home/Library", "home/Library/Application Support", "home/Library/Application Support/Godot",
  "home/Library/Application Support/Godot/editor_settings-4.7.tres", "home/Library/Caches", "home/Library/Caches/Godot",
  "home/Library/Caches/Godot/editor_doc_cache-4.7.res", "tmp", "cwd",
];

test("a refused start that writes only the engine's own user data, as a clean start does, leaves nothing outside the fixture", () => {
  assert.deepEqual(outsideProblems({ outside: clean, control: clean }), []);
  // Fewer paths than the control is fine.
  assert.deepEqual(outsideProblems({ outside: clean.slice(0, 5), control: clean }), []);
});

test("mutation: every file outside the fixture or outside the engine's user data is rejected", () => {
  const mutations = {
    "a file in the temporary directory": ["tmp/leftover.bin", /tmp\/leftover\.bin is outside the fixture/],
    "a file in the working directory": ["cwd/godot.log", /cwd\/godot\.log is outside the fixture/],
    "a file in the home directory itself": ["home/.fabric-cache", /home\/\.fabric-cache is outside/],
    "another directory of the user's library": ["home/Library/Preferences/fabric.plist", /Preferences\/fabric\.plist is outside/],
    "a root that only starts like the engine's": ["home/Library/Application Support/GodotX/data", /GodotX\/data is outside/],
    "a user-data file a clean start does not write": ["home/Library/Application Support/Godot/extension_cache.cfg", /left home\/Library\/Application Support\/Godot\/extension_cache\.cfg, which a clean start does not/],
  };
  for (const [name, [added, expected]] of Object.entries(mutations)) {
    const problems = outsideProblems({ outside: [...clean, added], control: clean });
    assert.ok(problems.length > 0, `${name}: accepted`);
    assert.match(problems.join("\n"), expected, name);
  }
  // Residue the control shares is still residue when it is outside the engine's own data.
  assert.match(outsideProblems({ outside: [...clean, "tmp/shared"], control: [...clean, "tmp/shared"] }).join("\n"), /tmp\/shared is outside/);
});

// ---- The lanes against a simulated engine ------------------------------------------------------------------------

// A Godot that is told how to misbehave by FAKE_MODE (one JSON object) and numbers its own launches in FAKE_LAUNCHES.
// It honours compatibility_minimum, writes the caches a real start writes (in the project and under HOME), and
// prints the lines of a real refusal. badReportAtLaunch writes a validation report that is not JSON and bigFileAtLaunch leaves
// a sparse file that node refuses to read, so that the lane meets an error of its own. Launches of the negative lane: 1 control-import, 2 control-react, 3 refused-import,
// 4 recovered-import, 5 recovered-react.
const FAKE_ENGINE = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("4.7.2.stable.official.ed1daf0bf"); process.exit(0); }
const project = args[args.indexOf("--path") + 1];
const mode = JSON.parse(process.env.FAKE_MODE || "{}");
fs.appendFileSync(process.env.FAKE_LAUNCHES, args.slice(2).join(" ") + "\n");
const launch = fs.readFileSync(process.env.FAKE_LAUNCHES, "utf8").trim().split("\n").length;
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text === undefined ? "x" : text); };
const minimum = /^compatibility_minimum\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(project, "fabric.gdextension"), "utf8"))[1];
const newer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
const refuses = newer(minimum, "4.7.2") && !mode.neverRefuses;
if (mode.failLaunch === launch) {
  if (mode.failKind === "signal") { process.kill(process.pid, "SIGKILL"); }
  if (mode.failKind === "crash-text") { console.error("handle_crash: Program crashed with signal 11"); process.exit(0); }
  console.error("ERROR: FAKE_FAILURE"); process.exit(1);
}
if (mode.flakyOnce && launch === 1) { console.error("ERROR: FAKE_FLAKE"); process.exit(1); }
if (args.includes("--script") || args.some((arg) => arg === "res://parity.tscn")) { console.log("FABRIC_PARITY_GUARDS_PASSED FABRIC_PARITY_PASSED"); process.exit(0); }
const scene = args.find((arg) => arg.startsWith("res://"));
if (scene) {
  if (refuses) { console.error("ERROR: the extension is not loaded"); process.exit(1); }
  write(path.join(project, "build/report.json"), JSON.stringify({ scenario: scene.includes("typography") ? "typography" : "react", checks: [{ id: "a", passed: true }] }));
  if (mode.badReportAtLaunch === launch) { write(path.join(project, "build/report.json"), "not json"); }
  console.log("FABRIC_VALIDATION_PASSED"); process.exit(0);
}
const home = process.env.HOME;
write(path.join(home, "Library/Application Support/Godot/editor_settings-4.7.tres"));
write(path.join(home, "Library/Caches/Godot/editor_doc_cache-4.7.res"));
write(path.join(project, ".godot/imported/a.md5"));
write(path.join(project, ".godot/global_script_class_cache.cfg"));
write(path.join(project, ".godot/uid_cache.bin"), String(launch));
write(path.join(project, "fabric.gdextension.uid"));
if (mode.bigFileAtLaunch === launch) { const big = path.join(project, ".godot/big.bin"); write(big); fs.truncateSync(big, 3000000000); }
console.log("[ DONE ] first_scan_filesystem");
if (mode.extraAtLaunch === launch) { write(path.join(project, ".godot/leftover.bin")); }
if (refuses) {
  const said = mode.wrongMinimum || minimum;
  const line = "ERROR: GDExtension only compatible with Godot version " + said + " or later: res://fabric.gdextension, but your Godot version is 4.7.2";
  console.error(line + "\nERROR: Can't open GDExtension dynamic library: 'res://fabric.gdextension'.\nERROR: Error loading extension: 'res://fabric.gdextension'.");
  console.error('SCRIPT ERROR: Parse Error: Identifier "FabricSurface" not declared in the current scope.');
  if (mode.unrelatedError) { console.error("ERROR: Cannot open file 'res://missing.png'."); }
  if (mode.strayCwd) { write(path.join(process.cwd(), "godot.log")); }
  if (mode.strayTmp) { write(path.join(process.env.TMPDIR, "godot-partial.tmp")); }
  if (mode.strayHome) { write(path.join(home, ".fabric-state")); }
  if (mode.staging) { write(path.join(project, ".godot/.extension-list-ab12cd")); }
  if (mode.rewriteMetadata) { write(path.join(project, "fabric.gdextension"), fs.readFileSync(path.join(project, "fabric.gdextension"), "utf8").replace(minimum, "4.7.2")); }
  if (mode.removeSource) { fs.rmSync(path.join(project, "scripts/validation.gd")); }
  if (mode.crash) { console.error("handle_crash: Program crashed with signal 11"); process.kill(process.pid, "SIGKILL"); }
}
process.exit(0);
`;

const LAUNCH_FILES = ["scripts/cold-start.mjs", "scripts/cold-start-negative.mjs", "scripts/cold-lanes.mjs", "scripts/godot-binary.mjs",
  "scripts/extension_startup.py", "dependencies.json", "fabric.gdextension", "project.godot"];

// A checkout with the real lane scripts and a stub of everything the lanes copy, and the simulated engine.
function withLab(action) {
  const lab = mkdtempSync(path.join(tmpdir(), "fabric-cold-lanes-"));
  try {
    const checkout = path.join(lab, "checkout");
    const scratch = path.join(lab, "scratch");
    mkdirSync(path.join(checkout, "scripts"), { recursive: true });
    for (const folder of ["build", "addons", "assets", "examples"]) {
      mkdirSync(path.join(checkout, folder), { recursive: true });
    }
    mkdirSync(scratch);
    for (const name of LAUNCH_FILES) {
      cpSync(path.join(root, name), path.join(checkout, name));
    }
    writeFileSync(path.join(checkout, "addons/fabric_godot.dylib"), "library");
    writeFileSync(path.join(checkout, "build/app.js"), "bundle");
    writeFileSync(path.join(checkout, "assets/font.txt"), "font");
    writeFileSync(path.join(checkout, "examples/catalog.txt"), "catalog");
    writeFileSync(path.join(checkout, "scripts/validation.gd"), "extends Node\n");
    writeFileSync(path.join(checkout, "main.tscn"), "[gd_scene]\n");
    writeFileSync(path.join(checkout, "typography.tscn"), "[gd_scene]\n");
    const binary = path.join(lab, "Godot");
    writeFileSync(binary, FAKE_ENGINE, { mode: 0o755 });
    const launchFile = path.join(lab, "launches.log");
    writeFileSync(launchFile, "");
    const run = (script, { mode = {}, args = [] } = {}) => spawnSync(process.execPath, [path.join(checkout, "scripts", script), ...args], {
      encoding: "utf8", timeout: 120000,
      env: { ...process.env, GODOT_BIN: binary, FAKE_MODE: JSON.stringify(mode), FAKE_LAUNCHES: launchFile, TMPDIR: scratch },
    });
    const launches = () => readFileSync(launchFile, "utf8").split("\n").filter(Boolean);
    return action({ checkout, scratch, run, launches, lab, binary });
  } finally {
    rmSync(lab, { recursive: true, force: true });
  }
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const coldReport = (checkout) => path.join(checkout, "build/cold-start.json");
const negativeReport = (checkout) => path.join(checkout, "build/cold-start-negative.json");

test("test:cold makes three fresh installs by default, each step once, in disposable sandboxes", () => {
  withLab(({ checkout, scratch, run, launches }) => {
    const result = run("cold-start.mjs");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /COLD_START_PASSED: 3 fresh installs/);
    const report = readJson(coldReport(checkout));
    assert.equal(report.installs, 3);
    assert.deepEqual(verifyColdReport(report), []);
    // Four launches per install, twelve in all, and the engine saw each of them once.
    const commands = ["--headless --editor --import", "--headless res://main.tscn -- --validate", "--headless res://typography.tscn -- --validate", "--headless --editor --import"];
    assert.deepEqual(launches(), [...commands, ...commands, ...commands]);
    assert.deepEqual(readdirSync(scratch), [], "a sandbox was left behind");
  });
});

test("mutation: fewer than three installs are refused before any engine starts, and a stale report does not stand", () => {
  withLab(({ checkout, run, launches }) => {
    for (const bad of ["2", "1", "0", "x"]) {
      writeFileSync(coldReport(checkout), '{"status":"passed"}\n');
      const result = run("cold-start.mjs", { args: ["--installs", bad] });
      assert.notEqual(result.status, 0, bad);
      assert.match(result.stderr, /--installs must be an integer of at least 3/);
      assert.equal(existsSync(coldReport(checkout)), false, "the report of an earlier run stood");
    }
    assert.equal(launches().length, 0);
    const five = run("cold-start.mjs", { args: ["--installs", "5"] });
    assert.equal(five.status, 0, five.stderr);
    assert.equal(readJson(coldReport(checkout)).installs, 5);
  });
});

test("mutation: a failed, crashed or killed install fails the run on its first attempt and is not run again", () => {
  const faults = {
    "a non-zero exit": [{ failLaunch: 1 }, /1-import failed: it exited with status 1/],
    "a death by SIGKILL": [{ failLaunch: 1, failKind: "signal" }, /1-import failed: it died by SIGKILL/],
    "Godot's crash text at exit 0": [{ failLaunch: 1, failKind: "crash-text" }, /1-import failed: it logged an error or a crash/],
    "a failure in the second install": [{ failLaunch: 6 }, /2-react failed/],
  };
  for (const [name, [mode, expected]] of Object.entries(faults)) {
    withLab(({ checkout, scratch, run, launches }) => {
      const result = run("cold-start.mjs", { mode });
      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr, expected, name);
      assert.equal(launches().length, mode.failLaunch, `${name}: the engine started again after the failure`);
      assert.equal(existsSync(coldReport(checkout)), false, `${name}: a report was written`);
      assert.deepEqual(readdirSync(scratch), [], `${name}: a sandbox was left behind`);
    });
  }
});

// The retry sabotage: the step runner starts the engine again when the first start was not clean.
const RETRY = {
  file: "scripts/cold-start.mjs",
  find: "  const start = startGodot({ ledger, step: name, binary, sandbox, args, timeout });\n",
  replace: "  let start = startGodot({ ledger, step: name, binary, sandbox, args, timeout });\n  if (judgeStart(start, marker)) {\n    start = startGodot({ ledger, step: name, binary, sandbox, args, timeout });\n  }\n",
};
const LEDGER_OFF = { file: "scripts/cold-lanes.mjs", find: "      if (entries.some((entry) => entry.step === step)) {\n", replace: "      if (false) {\n" };
const REPORT_UNCHECKED = { file: "scripts/cold-start.mjs", find: "const problems = verifyColdReport(report);\n", replace: "const problems = [];\n" };

function sabotage(checkout, ...edits) {
  for (const { file: name, find, replace } of edits) {
    const target = path.join(checkout, name);
    const text = readFileSync(target, "utf8");
    assert.equal(occurrences(text, find), 1, `${name}: the sabotage must find exactly one place`);
    writeFileSync(target, text.replace(find, () => replace));
  }
}

test("causal control: a sabotage that retries a failed install is rejected by the no-retry rule", () => {
  // The engine fails its very first start, once. The honest lane reports it; the retrying lane would turn it into a pass.
  withLab(({ run, launches }) => {
    const honest = run("cold-start.mjs", { mode: { flakyOnce: true } });
    assert.notEqual(honest.status, 0);
    assert.match(honest.stderr, /1-import failed: it exited with status 1/);
    assert.equal(launches().length, 1);
  });
  withLab(({ checkout, run, launches }) => {
    sabotage(checkout, RETRY);
    const retrying = run("cold-start.mjs", { mode: { flakyOnce: true } });
    assert.notEqual(retrying.status, 0, "the retry turned a failed install into a pass");
    assert.match(retrying.stderr, /Retry refused: 1-import already ran once/);
    assert.equal(launches().length, 1, "the refused retry still started the engine");
    assert.equal(existsSync(coldReport(checkout)), false);
  });
});

test("causal control: the report check is a second wall, and without both rules the retry would pass", () => {
  withLab(({ checkout, run }) => {
    sabotage(checkout, RETRY, LEDGER_OFF);
    const walled = run("cold-start.mjs", { mode: { flakyOnce: true } });
    assert.notEqual(walled.status, 0, "the report accepted a repeated step");
    assert.match(walled.stderr, /The cold-start report is not a pass/);
    assert.match(walled.stderr, /its launches are \[1-import, 1-import, 1-react/);
    assert.match(walled.stderr, /1-import exited with status 1/);
    assert.equal(existsSync(coldReport(checkout)), false);
  });
  withLab(({ checkout, run }) => {
    sabotage(checkout, RETRY, LEDGER_OFF, REPORT_UNCHECKED);
    const bare = run("cold-start.mjs", { mode: { flakyOnce: true } });
    assert.equal(bare.status, 0, "the control has no teeth: the retry does not even pass without the rules");
    assert.match(bare.stdout, /COLD_START_PASSED/);
  });
});

test("test:cold:negative refuses an incompatible minimum, leaves no residue and recovers on the next start", () => {
  withLab(({ checkout, scratch, run, launches }) => {
    const result = run("cold-start-negative.mjs");
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /COLD_START_NEGATIVE_PASSED/);
    const report = readJson(negativeReport(checkout));
    assert.equal(report.status, "passed");
    assert.deepEqual(report.problems, []);
    assert.equal(report.declaredMinimum, "4.7.2");
    assert.equal(report.incompatibleMinimum, "4.99.0");
    assert.match(report.refusal.message, /^ERROR: GDExtension only compatible with Godot version 4\.99\.0 or later: res:\/\/fabric\.gdextension, but your Godot version is 4\.7\.2$/);
    assert.equal(report.refusal.signal, null);
    assert.equal(report.refusal.crashText, false);
    assert.equal(report.recovery.metadataRestoredByteForByte, true);
    assert.equal(report.causalControl.unchangedMetadataLogFailsTheRefusalAssertions, true);
    assert.deepEqual(report.steps.map((entry) => [entry.step, entry.attempts]), [
      ["control-import", 1], ["control-react", 1], ["refused-import", 1], ["recovered-import", 1], ["recovered-react", 1],
    ]);
    assert.equal(launches().length, 5);
    // The fixture the lane edited is gone with its sandbox; the repository's metadata was never touched.
    assert.equal(readFileSync(path.join(checkout, "fabric.gdextension"), "utf8"), readFileSync(path.join(root, "fabric.gdextension"), "utf8"));
    assert.deepEqual(readdirSync(scratch), []);
  });
});

test("causal control: with the metadata unchanged nothing is refused and the lane fails", () => {
  withLab(({ checkout, run }) => {
    const result = run("cold-start-negative.mjs", { args: ["--keep-metadata"] });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /COLD_START_NEGATIVE_FAILED/);
    assert.match(result.stderr, /no line says that the extension is only compatible with Godot 4\.99\.0 or later: the extension was not refused/);
    assert.match(result.stderr, /could not open the library/);
    const report = readJson(negativeReport(checkout));
    assert.equal(report.status, "failed");
    assert.equal(report.mode, "causal-control-metadata-kept");
  });
});

test("an engine that does not enforce the minimum is reported, not worked around", () => {
  withLab(({ checkout, run }) => {
    const result = run("cold-start-negative.mjs", { mode: { neverRefuses: true } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /the extension was not refused/);
    assert.equal(readJson(negativeReport(checkout)).status, "failed");
  });
});

test("mutation: every way the failed start can misbehave is rejected by the lane", () => {
  const faults = {
    "a crash on refusal": [{ crash: true }, /died by SIGKILL/],
    "a message with another minimum": [{ wrongMinimum: "4.98.0" }, /names the minimum \["4\.98\.0"\]/],
    "an error that is not the refusal": [{ unrelatedError: true }, /neither the refusal nor a consequence of it/],
    "a file left in the working directory": [{ strayCwd: true }, /after the refused start: cwd\/godot\.log is outside the fixture/],
    "a file left in the temporary directory": [{ strayTmp: true }, /after the refused start: tmp\/godot-partial\.tmp is outside the fixture/],
    "a file left in the home directory": [{ strayHome: true }, /after the refused start: home\/\.fabric-state is outside/],
    "a staging file left in the cache": [{ staging: true }, /left a staging file: \.godot\/\.extension-list-ab12cd/],
    "the metadata rewritten by the engine": [{ rewriteMetadata: true }, /the refused start left fabric\.gdextension/],
    "a source removed by the engine": [{ removeSource: true }, /the refused start removed scripts\/validation\.gd/],
    "a next start that is not clean": [{ failLaunch: 4 }, /the next import with the correct metadata was not clean: it exited with status 1/],
    "a next runtime start that is not clean": [{ failLaunch: 5, failKind: "crash-text" }, /the next runtime start with the correct metadata was not clean/],
    "state left by the recovery that the control does not have": [{ extraAtLaunch: 4 }, /after the recovery the fixture has \.godot\/leftover\.bin/],
  };
  for (const [name, [mode, expected]] of Object.entries(faults)) {
    withLab(({ checkout, scratch, run }) => {
      const result = run("cold-start-negative.mjs", { mode });
      assert.equal(result.status, 1, `${name}: ${result.stderr}`);
      assert.match(result.stderr, expected, name);
      assert.equal(readJson(negativeReport(checkout)).status, "failed", name);
      assert.deepEqual(readdirSync(scratch), [], `${name}: a sandbox was left behind`);
    });
  }
});

// The negative lane's own sabotages: a step launched under a name that already ran, which the ledger refuses.
const RECOVERY_REPEATS_A_STEP = {
  file: "scripts/cold-start-negative.mjs",
  find: 'const validated = step(sandbox, "recovered-react", REACT);', replace: 'const validated = step(sandbox, "recovered-import", REACT);',
};
const REFUSED_START_REPEATS_A_STEP = {
  file: "scripts/cold-start-negative.mjs",
  find: 'state.refused = step(sandbox, "refused-import", IMPORT, 120000);', replace: 'state.refused = step(sandbox, "control-import", IMPORT, 120000);',
};

test("mutation: an error thrown anywhere in the negative lane still writes a failed report that names it, and never a TypeError", () => {
  // `known` lists what the report must still say about the steps that did run; the rest is null, not a crash of the lane.
  const points = {
    "a positive control that is broken": { mode: { failLaunch: 1 }, error: /The positive control is broken: control-import failed/, refusal: false, control: false, afterRefusal: false, afterRecovery: false },
    "a missing bundle": { prepare: (checkout) => rmSync(path.join(checkout, "build/app.js")), error: /Missing build\/app\.js/, refusal: false, control: false, afterRefusal: false, afterRecovery: false },
    "a step that the ledger refuses before the refused start ran": { edit: REFUSED_START_REPEATS_A_STEP, error: /Retry refused: control-import already ran once/, refusal: false, control: true, afterRefusal: false, afterRecovery: false },
    "a tree that cannot be listed after the refused start": { mode: { bigFileAtLaunch: 3 }, error: /the lane stopped on an error: .*(2 GiB|too large)/i, refusal: true, control: true, afterRefusal: false, afterRecovery: false },
    "a step that the ledger refuses during the recovery": { edit: RECOVERY_REPEATS_A_STEP, error: /Retry refused: recovered-import already ran once/, refusal: true, control: true, afterRefusal: true, afterRecovery: false },
    "a validation report that is not JSON": { mode: { badReportAtLaunch: 5 }, error: /the lane stopped on an error: .*JSON/, refusal: true, control: true, afterRefusal: true, afterRecovery: false },
  };
  for (const [name, point] of Object.entries(points)) {
    withLab(({ checkout, scratch, run }) => {
      point.prepare?.(checkout);
      if (point.edit) {
        sabotage(checkout, point.edit);
      }
      const result = run("cold-start-negative.mjs", { mode: point.mode });
      assert.equal(result.status, 1, `${name}: ${result.stderr}`);
      assert.doesNotMatch(result.stderr, /TypeError/, name);
      assert.match(result.stderr, /COLD_START_NEGATIVE_FAILED/, name);
      assert.match(result.stderr, point.error, name);
      const report = readJson(negativeReport(checkout));
      assert.equal(report.status, "failed", name);
      assert.match(report.problems.join("\n"), /the lane stopped on an error/, name);
      assert.match(report.problems.join("\n"), point.error, name);
      assert.equal(report.refusal !== null, point.refusal, `${name}: refusal`);
      assert.equal(report.causalControl !== null, point.control, `${name}: causal control`);
      assert.equal(report.residue.controlOutsidePaths !== null, point.control, `${name}: control residue`);
      assert.equal(report.residue.refusedOutsidePaths !== null, point.afterRefusal, `${name}: residue after the refusal`);
      assert.equal(report.residue.recoveredOutsidePaths !== null, point.afterRecovery, `${name}: residue after the recovery`);
      assert.deepEqual(readdirSync(scratch), [], `${name}: a sandbox was left behind`);
    });
  }
});

test("a failed negative lane never leaves the report of an earlier run standing", () => {
  withLab(({ checkout, run }) => {
    writeFileSync(negativeReport(checkout), '{"status":"passed"}\n');
    const result = run("cold-start-negative.mjs", { mode: { failLaunch: 1 } });
    assert.equal(result.status, 1);
    assert.equal(readJson(negativeReport(checkout)).status, "failed");
  });
});
