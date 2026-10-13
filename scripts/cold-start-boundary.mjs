import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ensureGodotBinary, GODOT_VERSION } from "./godot-binary.mjs";

// The engine boundary of GF-02 as an executable control (docs/evidence/cold-start.md, "Executable engine boundary").
// Godot's editor queues the documentation of a GDExtension's classes and, on an empty cache, runs that callback
// after its own cleanup (godotengine/godot#111645). Startup preparation (scripts/extension_startup.py) avoids it.
// This control keeps the claim honest in both directions: the official engine must still crash without the
// preparation, and must import cleanly with it. If the engine stops crashing, the control fails on purpose, to
// say the containment can be retired and the engine requalified.

const UPSTREAM_ISSUE = "https://github.com/godotengine/godot/issues/111645";
const UPSTREAM_FIX = "https://github.com/godotengine/godot/pull/123658";
const MIN_ATTEMPTS = 5;
const DEFAULT_ATTEMPTS = 5;
// A hang guard only. No outcome is decided from how long an import took.
const HANG_GUARD_MS = 180_000;

// The crash signature: the process dies by SIGSEGV or SIGBUS, or Godot's crash handler logs signal 11. The handler
// prints the backtrace and then aborts, so the parent sees SIGABRT with that text; the stripped official binary
// prints no symbols, so frames that name the editor documentation are recorded when present and never required.
const CRASH_TEXT = /Program crashed with signal 11\b/;
const CRASH_SIGNALS = new Set(["SIGSEGV", "SIGBUS"]);
const EDITOR_HELP_FRAME = /EditorHelp|_gen_extensions_docs/;
// Anything else that makes an import not clean (the same markers as scripts/cold-start.mjs).
const FAILURE_MARKERS = /SCRIPT ERROR|(?:^|\n)ERROR:|Program crashed|FABRIC_ERROR|FABRIC_CHECK_FAILED/;

export const engineFixedMessage = (version) =>
  `the upstream editor bug no longer reproduces on ${version}: requalify the engine and retire the startup containment (GF-02)`;

// One import, from what the process did. `crashed` is the upstream bug's signature; `clean` is exit 0 with no
// signal, no crash text and no error line; every other end is `failed` and is never read as the bug.
export function classifyAttempt({ status = null, signal = null, log = "", error = null }) {
  const crashText = CRASH_TEXT.test(log);
  const editorHelpFrames = log.split("\n").filter((line) => EDITOR_HELP_FRAME.test(line)).map((line) => line.trim());
  if (crashText || CRASH_SIGNALS.has(signal)) {
    const how = [CRASH_SIGNALS.has(signal) ? `died by ${signal}` : null, crashText ? "logged Program crashed with signal 11" : null];
    return { outcome: "crashed", reason: how.filter(Boolean).join(" and "), crashText, editorHelpFrames };
  }
  const reasons = [];
  if (error) {
    reasons.push(error.code === "ETIMEDOUT" ? "hit the hang guard" : `could not run: ${error.message}`);
  }
  if (signal) {
    reasons.push(`died by ${signal}`);
  }
  if (!signal && status !== 0) {
    reasons.push(`exited with status ${status}`);
  }
  if (FAILURE_MARKERS.test(log)) {
    reasons.push("logged an error or another crash");
  }
  return { outcome: reasons.length ? "failed" : "clean", reason: reasons.join("; ") || "exited 0 with a clean log", crashText: false, editorHelpFrames };
}

const count = (attempts, outcome) => attempts.filter((attempt) => attempt.outcome === outcome).length;

function summarize(attempts) {
  return { attempts: attempts.length, crashed: count(attempts, "crashed"), clean: count(attempts, "clean"), failed: count(attempts, "failed") };
}

// The verdict of the whole control. Only `boundary-holds` is a pass: every unprepared attempt crashed and every
// prepared attempt was clean. No threshold is assumed for a mixed result; it is reported as measured.
export function decideVerdict({ unprepared, prepared, version }) {
  if (!unprepared.length || !prepared.length) {
    throw new Error("The control needs unprepared and prepared attempts");
  }
  const before = summarize(unprepared);
  const after = summarize(prepared);
  if (after.clean !== after.attempts) {
    const first = prepared.find((attempt) => attempt.outcome !== "clean");
    return {
      verdict: "prepared-failed",
      ok: false,
      message: `${after.attempts - after.clean} of ${after.attempts} prepared imports were not clean (${first.reason}): the startup containment does not hold on ${version}, or the control is broken`,
    };
  }
  if (before.crashed === before.attempts) {
    return {
      verdict: "boundary-holds",
      ok: true,
      message: `the upstream editor bug still reproduces on ${version} (${before.crashed}/${before.attempts} unprepared imports crashed) and the startup containment holds (${after.clean}/${after.attempts} prepared imports clean)`,
    };
  }
  if (before.clean === before.attempts) {
    return { verdict: "engine-fixed", ok: false, message: engineFixedMessage(version) };
  }
  const rate = `${before.crashed}/${before.attempts}`;
  return {
    verdict: "mixed",
    ok: false,
    message: before.crashed
      ? `the unprepared import is not deterministic on ${version}: ${rate} crashed, ${before.clean} clean, ${before.failed} failed; stop and decide, no threshold is assumed`
      : `no unprepared import crashed on ${version}, but ${before.failed} of ${before.attempts} failed another way, so the upstream fix cannot be concluded from them`,
  };
}

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

// The smallest reproduction the record names: the Fabric extension alone, no scenes, assets or JavaScript.
const PROJECT = 'config_version=5\n\n[application]\nconfig/name="Fabric engine boundary control"\n';

function attempt({ root, binary, mode, index }) {
  const project = mkdtempSync(path.join(tmpdir(), "godot-fabric-boundary-"));
  try {
    writeFileSync(path.join(project, "project.godot"), PROJECT);
    cpSync(path.join(root, "fabric.gdextension"), path.join(project, "fabric.gdextension"));
    cpSync(path.join(root, "addons"), path.join(project, "addons"), { recursive: true, verbatimSymlinks: true });
    if (existsSync(path.join(project, ".godot"))) {
      throw new Error("Boundary fixture unexpectedly contains a cache");
    }
    if (mode === "prepared") {
      const prepared = spawnSync("python3", [path.join(root, "scripts/extension_startup.py"), project], { encoding: "utf8", timeout: 10000 });
      if (prepared.error || prepared.status !== 0) {
        throw new Error(prepared.stderr || String(prepared.error));
      }
      const files = readdirSync(path.join(project, ".godot"));
      if (files.length !== 1 || files[0] !== "extension_list.cfg") {
        throw new Error("Startup copied unexpected cache state");
      }
    }
    const result = spawnSync(binary, ["--path", project, "--headless", "--editor", "--import"], {
      encoding: "utf8", timeout: HANG_GUARD_MS, maxBuffer: 8 * 1024 * 1024,
    });
    const log = (result.stdout ?? "") + (result.stderr ?? "");
    const logFile = `cold-start-boundary-${mode}-${index}.log`;
    writeFileSync(path.join(root, "build", logFile), log);
    const classified = classifyAttempt({ status: result.status, signal: result.signal, log, error: result.error ?? null });
    return {
      mode, index, ...classified,
      exitStatus: result.status, signal: result.signal ?? null, logSha256: sha256(log), logBytes: Buffer.byteLength(log), logFile,
    };
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

async function runBoundary({ root, attempts }) {
  mkdirSync(path.join(root, "build"), { recursive: true });
  const reportFile = path.join(root, "build/cold-start-boundary.json");
  // A report from an earlier run never stands for this one, not even when the arguments or the engine are refused.
  rmSync(reportFile, { force: true });
  if (!Number.isInteger(attempts) || attempts < MIN_ATTEMPTS) {
    throw new Error(`--attempts must be an integer of at least ${MIN_ATTEMPTS}`);
  }
  const binary = await ensureGodotBinary();
  if (!existsSync(path.join(root, "addons/fabric_godot.dylib"))) {
    throw new Error("Missing Fabric library; run npm run setup first");
  }
  const version = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 10000 }).stdout.trim();
  const unprepared = [];
  const prepared = [];
  for (const [mode, list] of [["unprepared", unprepared], ["prepared", prepared]]) {
    for (let index = 1; index <= attempts; index++) {
      const result = attempt({ root, binary, mode, index });
      list.push(result);
      console.log(`${mode} import ${index}/${attempts}: ${result.outcome} (${result.reason})`);
    }
  }
  const decision = decideVerdict({ unprepared, prepared, version });
  const report = {
    schemaVersion: 1,
    verdict: decision.verdict,
    message: decision.message,
    engine: { version, pin: GODOT_VERSION, executableSha256: sha256(readFileSync(binary)) },
    host: { librarySha256: sha256(readFileSync(path.join(root, "addons/fabric_godot.dylib"))) },
    platform: process.platform,
    architecture: process.arch,
    project: "fabric-only: project.godot, fabric.gdextension and addons/, an empty resource cache, import-only editor",
    attemptsPerLane: attempts,
    upstream: { issue: UPSTREAM_ISSUE, fix: UPSTREAM_FIX },
    summary: { unprepared: summarize(unprepared), prepared: summarize(prepared) },
    unprepared,
    prepared,
  };
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
  return decision;
}

if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { attempts: { type: "string", default: String(DEFAULT_ATTEMPTS) } } });
  const decision = await runBoundary({ root: fileURLToPath(new URL("..", import.meta.url)), attempts: Number(values.attempts) });
  if (decision.ok) {
    console.log(`COLD_START_BOUNDARY_HOLDS: ${decision.message}`);
  } else {
    console.error(`COLD_START_BOUNDARY_${decision.verdict.toUpperCase().replaceAll("-", "_")}: ${decision.message}`);
    process.exitCode = 1;
  }
}
