import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classifyAttempt, decideVerdict, engineFixedMessage } from "../scripts/cold-start-boundary.mjs";

// The verdict logic and the runner of scripts/cold-start-boundary.mjs, with no Godot: the classification of
// what an import did and the decision over a set of imports are pure, and the runner is driven against a
// simulated executable. The native control itself (the official engine) runs in the native-cold-start job.

const root = fileURLToPath(new URL("..", import.meta.url));
const VERSION = "4.7.2.stable.official.ed1daf0bf";
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

const crashLog = [
  "ERROR: something unrelated before the crash",
  "handle_crash: Program crashed with signal 11",
  "[2] 106b94dbc (main+21b8dbc) - EditorHelp::_gen_extensions_docs() + 44",
  "[3] 106b743c0 (main+21983c0) - SDL_GetPerformanceFrequency + 4029220",
].join("\n");
const cleanLog = "Godot Engine v4.7.2.stable.official.ed1daf0bf - https://godotengine.org\n[ DONE ] first_scan_filesystem\n";

const crashed = { outcome: "crashed" };
const clean = { outcome: "clean" };
const failed = { outcome: "failed", reason: "exited with status 1" };
const repeat = (attempt, times) => Array.from({ length: times }, (_value, index) => ({ ...attempt, index: index + 1 }));

test("a death by SIGSEGV or SIGBUS is the crash signature, with or without output", () => {
  for (const signal of ["SIGSEGV", "SIGBUS"]) {
    const result = classifyAttempt({ status: null, signal, log: "" });
    assert.equal(result.outcome, "crashed");
    assert.match(result.reason, new RegExp(`died by ${signal}`));
    assert.equal(result.crashText, false);
  }
});

test("Godot's crash text is the crash signature even though the handler ends the process with SIGABRT", () => {
  const result = classifyAttempt({ status: null, signal: "SIGABRT", log: crashLog });
  assert.equal(result.outcome, "crashed");
  assert.equal(result.crashText, true);
  assert.match(result.reason, /logged Program crashed with signal 11/);
  assert.doesNotMatch(result.reason, /died by/);
  // The crash text alone decides: the exit status and the signal as the shell reports them do not matter.
  assert.equal(classifyAttempt({ status: 134, signal: null, log: crashLog }).outcome, "crashed");
});

test("backtrace frames that name the editor documentation are recorded and never required", () => {
  assert.deepEqual(classifyAttempt({ signal: "SIGABRT", log: crashLog }).editorHelpFrames, [
    "[2] 106b94dbc (main+21b8dbc) - EditorHelp::_gen_extensions_docs() + 44",
  ]);
  const stripped = "handle_crash: Program crashed with signal 11\n[2] 106b94dbc (main+21b8dbc) - SDL_GetPerformanceFrequency + 4162848";
  const result = classifyAttempt({ signal: "SIGABRT", log: stripped });
  assert.equal(result.outcome, "crashed");
  assert.deepEqual(result.editorHelpFrames, []);
});

test("exit 0 with a clean log is a clean import", () => {
  const result = classifyAttempt({ status: 0, signal: null, log: cleanLog });
  assert.equal(result.outcome, "clean");
  assert.deepEqual(result.editorHelpFrames, []);
});

test("every other end is a failure, never the upstream bug", () => {
  const cases = {
    "an abort with no crash text": { status: null, signal: "SIGABRT", log: cleanLog },
    "a termination by SIGKILL": { status: null, signal: "SIGKILL", log: "" },
    "a non-zero exit": { status: 1, signal: null, log: cleanLog },
    "the hang guard": { status: null, signal: "SIGTERM", log: "", error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }) },
    "an executable that cannot run": { status: null, signal: null, log: "", error: Object.assign(new Error("spawnSync x ENOENT"), { code: "ENOENT" }) },
    "an error line at exit 0": { status: 0, signal: null, log: `${cleanLog}ERROR: Cannot open file 'res://x'\n` },
    "a script error at exit 0": { status: 0, signal: null, log: `${cleanLog}SCRIPT ERROR: boom\n` },
    "another crash signal": { status: null, signal: "SIGABRT", log: "handle_crash: Program crashed with signal 6\n" },
  };
  for (const [name, input] of Object.entries(cases)) {
    assert.equal(classifyAttempt(input).outcome, "failed", name);
  }
  assert.match(classifyAttempt(cases["the hang guard"]).reason, /hang guard/);
  assert.match(classifyAttempt(cases["a non-zero exit"]).reason, /status 1/);
});

test("every unprepared import crashing and every prepared import clean is boundary-holds", () => {
  const verdict = decideVerdict({ unprepared: repeat(crashed, 5), prepared: repeat(clean, 5), version: VERSION });
  assert.equal(verdict.verdict, "boundary-holds");
  assert.equal(verdict.ok, true);
  assert.match(verdict.message, /5\/5 unprepared imports crashed/);
  assert.match(verdict.message, /5\/5 prepared imports clean/);
});

test("no unprepared import crashing is engine-fixed and fails with the retirement message", () => {
  const verdict = decideVerdict({ unprepared: repeat(clean, 5), prepared: repeat(clean, 5), version: VERSION });
  assert.equal(verdict.verdict, "engine-fixed");
  assert.equal(verdict.ok, false);
  assert.equal(verdict.message, `the upstream editor bug no longer reproduces on ${VERSION}: requalify the engine and retire the startup containment (GF-02)`);
  assert.equal(verdict.message, engineFixedMessage(VERSION));
});

test("a mixed set of unprepared imports is reported as measured, with no threshold", () => {
  for (const crashes of [1, 2, 4]) {
    const unprepared = [...repeat(crashed, crashes), ...repeat(clean, 5 - crashes)];
    const verdict = decideVerdict({ unprepared, prepared: repeat(clean, 5), version: VERSION });
    assert.equal(verdict.verdict, "mixed", `${crashes} crashes`);
    assert.equal(verdict.ok, false);
    assert.match(verdict.message, new RegExp(`${crashes}/5 crashed`));
    assert.match(verdict.message, /no threshold is assumed/);
  }
});

test("unprepared imports that fail another way are never read as the engine being fixed", () => {
  const verdict = decideVerdict({ unprepared: [...repeat(clean, 3), ...repeat(failed, 2)], prepared: repeat(clean, 5), version: VERSION });
  assert.equal(verdict.verdict, "mixed");
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /no unprepared import crashed/);
  assert.match(verdict.message, /cannot be concluded/);
  const allFailed = decideVerdict({ unprepared: repeat(failed, 5), prepared: repeat(clean, 5), version: VERSION });
  assert.equal(allFailed.verdict, "mixed");
});

test("a prepared import that is not clean fails the control before the engine is judged", () => {
  for (const unprepared of [repeat(crashed, 5), repeat(clean, 5)]) {
    for (const bad of [failed, crashed]) {
      const prepared = [...repeat(clean, 4), { ...bad, index: 5 }];
      const verdict = decideVerdict({ unprepared, prepared, version: VERSION });
      assert.equal(verdict.verdict, "prepared-failed");
      assert.equal(verdict.ok, false);
      assert.match(verdict.message, /1 of 5 prepared imports were not clean/);
    }
  }
});

test("a verdict needs attempts in both lanes", () => {
  assert.throws(() => decideVerdict({ unprepared: [], prepared: repeat(clean, 5), version: VERSION }), /needs unprepared and prepared attempts/);
  assert.throws(() => decideVerdict({ unprepared: repeat(crashed, 5), prepared: [], version: VERSION }), /needs unprepared and prepared attempts/);
});

// The runner against a simulated executable. The behavior follows what the fixture holds, as the engine does:
// the bug fires only on an empty cache, that is, a project without the startup list.
const FAKE_ENGINE = `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log(process.env.FAKE_GODOT_VERSION ?? "${VERSION}");
  process.exit(0);
}
const project = args[args.indexOf("--path") + 1];
const startupList = path.join(project, ".godot/extension_list.cfg");
const prepared = existsSync(startupList);
const sawCache = existsSync(path.join(project, ".godot"));
console.log("fixture " + readdirSync(project).sort().join(",") + " cache=" + sawCache + " list=" + (prepared ? readFileSync(startupList, "utf8").trim() : "none"));
console.log("flags " + args.filter((arg) => arg.startsWith("--")).join(" "));
const counter = process.env.FAKE_GODOT_COUNTER;
let call = 1;
if (counter) {
  call = existsSync(counter) ? parseInt(readFileSync(counter, "utf8"), 10) + 1 : 1;
  writeFileSync(counter, String(call));
}
const mode = process.env.FAKE_GODOT_MODE;
const bug = !prepared && (mode === "bug" || mode === "prepared-broken" || (mode === "flaky" && call % 2 === 1));
if (bug) {
  console.error("handle_crash: Program crashed with signal 11");
  console.error("[2] 106b94dbc (main+21b8dbc) - EditorHelp::_gen_extensions_docs() + 44");
  process.exit(134);
}
if (prepared && mode === "prepared-broken") {
  console.error("ERROR: the startup list was not enough");
}
`;

function withRoot(action) {
  const directory = mkdtempSync(path.join(tmpdir(), "fabric-boundary-test-"));
  try {
    const project = path.join(directory, "project");
    const scratch = path.join(directory, "scratch");
    mkdirSync(path.join(project, "scripts"), { recursive: true });
    mkdirSync(path.join(project, "build"));
    mkdirSync(path.join(project, "addons/frameworks"), { recursive: true });
    mkdirSync(scratch);
    for (const file of ["scripts/cold-start-boundary.mjs", "scripts/godot-binary.mjs", "scripts/extension_startup.py", "dependencies.json", "fabric.gdextension"]) {
      cpSync(path.join(root, file), path.join(project, file));
    }
    writeFileSync(path.join(project, "addons/fabric_godot.dylib"), "fixture library");
    writeFileSync(path.join(project, "addons/frameworks/framework"), "fixture framework");
    const binary = path.join(directory, "Godot with spaces");
    writeFileSync(binary, FAKE_ENGINE, { mode: 0o755 });
    return action({ directory, project, scratch, binary });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runControl({ project, scratch, binary, directory }, mode, extra = [], env = {}) {
  return spawnSync(process.execPath, [path.join(project, "scripts/cold-start-boundary.mjs"), ...extra], {
    encoding: "utf8",
    timeout: 60000,
    env: {
      ...process.env, GODOT_BIN: binary, FAKE_GODOT_MODE: mode, FAKE_GODOT_COUNTER: path.join(directory, "counter"),
      TMPDIR: scratch, TMP: scratch, TEMP: scratch, ...env,
    },
  });
}

const readReport = (project) => JSON.parse(readFileSync(path.join(project, "build/cold-start-boundary.json"), "utf8"));

test("the runner passes when the engine crashes without the startup list and is clean with it", () => {
  withRoot((context) => {
    const result = runControl(context, "bug");
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /COLD_START_BOUNDARY_HOLDS/);
    const report = readReport(context.project);
    assert.equal(report.verdict, "boundary-holds");
    assert.equal(report.engine.version, VERSION);
    assert.equal(report.engine.executableSha256, sha256(readFileSync(context.binary)));
    assert.equal(report.host.librarySha256, sha256("fixture library"));
    assert.equal(report.attemptsPerLane, 5);
    assert.deepEqual(report.summary, {
      unprepared: { attempts: 5, crashed: 5, clean: 0, failed: 0 },
      prepared: { attempts: 5, crashed: 0, clean: 5, failed: 0 },
    });
    assert.equal(report.unprepared.length, 5);
    assert.equal(report.prepared.length, 5);
    for (const attempt of [...report.unprepared, ...report.prepared]) {
      const log = readFileSync(path.join(context.project, "build", attempt.logFile), "utf8");
      assert.equal(attempt.logSha256, sha256(log));
      assert.equal(attempt.logBytes, Buffer.byteLength(log));
      // Every attempt is a fresh Fabric-only project, imported by the import-only editor.
      assert.match(log, /fixture (?:\.godot,)?addons,fabric\.gdextension,project\.godot /);
      assert.match(log, /flags --path --headless --editor --import/);
    }
    for (const attempt of report.unprepared) {
      assert.equal(attempt.outcome, "crashed");
      assert.equal(attempt.exitStatus, 134);
      assert.equal(attempt.crashText, true);
      assert.deepEqual(attempt.editorHelpFrames, ["[2] 106b94dbc (main+21b8dbc) - EditorHelp::_gen_extensions_docs() + 44"]);
      assert.match(readFileSync(path.join(context.project, "build", attempt.logFile), "utf8"), /cache=false list=none/);
    }
    for (const attempt of report.prepared) {
      assert.equal(attempt.outcome, "clean");
      assert.equal(attempt.exitStatus, 0);
      assert.match(readFileSync(path.join(context.project, "build", attempt.logFile), "utf8"), /cache=true list=res:\/\/fabric\.gdextension/);
    }
    assert.deepEqual(readdirSync(context.scratch), [], "the disposable projects are removed");
  });
});

test("the runner fails with the retirement message when the engine no longer crashes", () => {
  withRoot((context) => {
    const result = runControl(context, "fixed");
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(engineFixedMessage(VERSION)), result.stderr);
    const report = readReport(context.project);
    assert.equal(report.verdict, "engine-fixed");
    assert.equal(report.message, engineFixedMessage(VERSION));
    assert.equal(report.summary.unprepared.crashed, 0);
    assert.deepEqual(readdirSync(context.scratch), []);
  });
});

test("the runner fails and reports the measured rate when the crash is not deterministic", () => {
  withRoot((context) => {
    const result = runControl(context, "flaky");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not deterministic/);
    assert.match(result.stderr, /no threshold is assumed/);
    const report = readReport(context.project);
    assert.equal(report.verdict, "mixed");
    assert.equal(report.summary.unprepared.crashed + report.summary.unprepared.clean, 5);
    assert.ok(report.summary.unprepared.crashed > 0 && report.summary.unprepared.clean > 0);
  });
});

test("the runner fails when a prepared import is not clean", () => {
  withRoot((context) => {
    const result = runControl(context, "prepared-broken");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /prepared imports were not clean/);
    const report = readReport(context.project);
    assert.equal(report.verdict, "prepared-failed");
    assert.equal(report.summary.prepared.failed, 5);
    assert.equal(report.summary.unprepared.crashed, 5);
  });
});

test("the runner counts attempts per lane and refuses fewer than five", () => {
  withRoot((context) => {
    const result = runControl(context, "bug", ["--attempts", "7"]);
    assert.equal(result.status, 0, result.stderr);
    const report = readReport(context.project);
    assert.equal(report.attemptsPerLane, 7);
    assert.equal(report.unprepared.length, 7);
    assert.equal(report.prepared.length, 7);
  });
  withRoot((context) => {
    const stale = path.join(context.project, "build/cold-start-boundary.json");
    for (const value of ["4", "0", "five"]) {
      writeFileSync(stale, '{"verdict":"boundary-holds"}\n');
      const result = runControl(context, "bug", ["--attempts", value]);
      assert.notEqual(result.status, 0, value);
      assert.match(result.stderr, /--attempts must be an integer of at least 5/);
      assert.equal(existsSync(stale), false, "a refused run leaves no earlier report standing");
    }
  });
});

test("an engine that is not the pinned stable one is refused and no earlier report stands", () => {
  withRoot((context) => {
    const stale = path.join(context.project, "build/cold-start-boundary.json");
    writeFileSync(stale, '{"verdict":"boundary-holds"}\n');
    const result = runControl(context, "bug", [], { FAKE_GODOT_VERSION: "4.6.2.stable.official.hash" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /4\.7\.2\.stable required/);
    assert.equal(existsSync(stale), false);
    assert.deepEqual(readdirSync(context.scratch), []);
  });
});
