import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// What the startup lanes of GF-02 share (docs/evidence/cold-start.md): scripts/cold-start.mjs (repeated first installs),
// scripts/cold-start-negative.mjs (a failed start with an incompatible minimum) and scripts/parity-godot.mjs (the shared
// parity fixture from a cold project). The judgements are pure functions covered by tests/cold-lanes.test.mjs with no
// Godot; the I/O helpers at the end only copy, spawn and list.

export const MIN_INSTALLS = 3;
// A fresh install: the project cache holds the startup list and nothing else (scripts/extension_startup.py).
const STARTUP_FILES = ["extension_list.cfg"];
export const INSTALL_STEPS = ["import", "react", "typography", "warm-import"];
const EXTENSION_PATH = "res://fabric.gdextension";
export const INCOMPATIBLE_MINIMUM = "4.99.0";
// The markers every lane has always treated as a failed start (scripts/cold-start.mjs).
const FAILURE_MARKERS = /SCRIPT ERROR|(?:^|\n)ERROR:|Program crashed|FABRIC_ERROR|FABRIC_CHECK_FAILED/;
const CRASH_TEXT = /Program crashed/;
const STAGING_NAME = /^\.extension-list-|\.(?:tmp|part)$|~$/;

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export function parseInstalls(value) {
  const installs = Number(value);
  if (!Number.isInteger(installs) || installs < MIN_INSTALLS) {
    throw new Error(`--installs must be an integer of at least ${MIN_INSTALLS}`);
  }
  return installs;
}

// ---- The no-retry rule ------------------------------------------------------------------------------------------

// Every start of Godot goes through here: one launch per step, whatever its outcome. A second launch of a step is
// refused before it runs, so a failure can only be reported, never run again until it passes.
export function createLedger() {
  const entries = [];
  return {
    launch(step, action) {
      if (entries.some((entry) => entry.step === step)) {
        throw new Error(`Retry refused: ${step} already ran once; a failed start is reported and never run again`);
      }
      const entry = { step, attempts: 1, status: null, signal: null };
      entries.push(entry);
      const outcome = action();
      entry.status = outcome.status ?? null;
      entry.signal = outcome.signal ?? null;
      return outcome;
    },
    entries: () => entries.map((entry) => ({ ...entry })),
  };
}

// What a start did, judged the same way for every lane. A signal, a crash or a timeout is a failure, never a retry.
export function judgeStart({ status = null, signal = null, error = null, log = "" }, marker = null) {
  if (error) {
    return error.code === "ETIMEDOUT" ? "it hit the hang guard" : `it could not run: ${error.message}`;
  }
  if (signal) {
    return `it died by ${signal}`;
  }
  if (status !== 0) {
    return `it exited with status ${status}`;
  }
  if (FAILURE_MARKERS.test(log)) {
    return "it logged an error or a crash";
  }
  if (marker && !log.includes(marker)) {
    return `it did not print ${marker}`;
  }
  return null;
}

// The report of test:cold, judged again from its data before it is written: the count, the plan of every install
// and the one-attempt rule. A report that fails this is never saved as a pass.
export function verifyColdReport(report) {
  const problems = [];
  const runs = Array.isArray(report?.runs) ? report.runs : [];
  if (report?.status !== "passed") {
    problems.push(`the status is ${JSON.stringify(report?.status)}, not "passed"`);
  }
  if (runs.length < MIN_INSTALLS) {
    problems.push(`${runs.length} fresh installs ran; at least ${MIN_INSTALLS} are required`);
  }
  if (report?.installs !== runs.length) {
    problems.push(`the report counts ${report?.installs} installs and lists ${runs.length}`);
  }
  const startup = report?.startup === "skipped" ? [] : STARTUP_FILES;
  for (const [position, run] of runs.entries()) {
    const label = `install ${position + 1}`;
    if (run.install !== position + 1) {
      problems.push(`${label}: it is numbered ${run.install}`);
    }
    const expected = INSTALL_STEPS.map((name) => `${position + 1}-${name}`);
    const steps = Array.isArray(run.steps) ? run.steps : [];
    if (JSON.stringify(steps.map((step) => step.step)) !== JSON.stringify(expected)) {
      problems.push(`${label}: its launches are [${steps.map((step) => step.step).join(", ")}], not the plan [${expected.join(", ")}]: a step was repeated, added or skipped`);
    }
    for (const step of steps) {
      if (step.attempts !== 1) {
        problems.push(`${label}: ${step.step} was attempted ${step.attempts} times`);
      }
      if (step.signal !== null) {
        problems.push(`${label}: ${step.step} died by ${step.signal}`);
      }
      if (step.status !== 0) {
        problems.push(`${label}: ${step.step} exited with status ${step.status}`);
      }
    }
    if (run.freshResources !== true || run.freshUserData !== true) {
      problems.push(`${label}: it did not start from an empty resource cache and fresh user data`);
    }
    if (JSON.stringify(run.startupFiles) !== JSON.stringify(startup)) {
      problems.push(`${label}: the cache held ${JSON.stringify(run.startupFiles)} before the import, not ${JSON.stringify(startup)}`);
    }
    if (!Array.isArray(run.cases) || run.cases.length !== 2 || run.cases.some((entry) => !(entry.checks > 0))) {
      problems.push(`${label}: the React and typography scenarios did not both report checks`);
    }
    if (run.warmImport !== "passed") {
      problems.push(`${label}: the warm import did not pass`);
    }
  }
  return problems;
}

// ---- A failed start with an incompatible minimum ----------------------------------------------------------------

// Godot 4.7.2's own words (core/extension/gdextension_library_loader.cpp, parse_gdextension_file), read from a real
// start with compatibility_minimum = "4.99.0" in docs/evidence/cold-start.md: nothing here is a guess of the message.
const REFUSED = /^ERROR: GDExtension only compatible with Godot version (\S+) or later: (\S+), but your Godot version is (\S+)\s*$/;
const NOT_OPENED = /^ERROR: Can't open GDExtension dynamic library: '(\S+)'\.\s*$/;
const NOT_LOADED = /^ERROR: Error loading extension: '(\S+)'\.\s*$/;

const versionParts = (version) => version.split(".").map((part) => Number.parseInt(part, 10));

export function compareVersions(left, right) {
  const [a, b] = [versionParts(left), versionParts(right)];
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

// What follows from the refusal in a project whose scripts name the extension's classes: the classes are never
// registered, so those scripts cannot be parsed. Godot reports it after the refusal, once per script it loads.
const CONSEQUENCES = [
  /^SCRIPT ERROR: Parse Error: Identifier "(?:Fabric\w+|Godot[A-Z]\w+)" not declared in the current scope\.\s*$/,
  /^SCRIPT ERROR: Parse Error: Could not resolve class "res:\/\/[^"]+\.gd"\.\s*$/,
  /^ERROR: Failed to load script "res:\/\/[^"]+\.gd" with error "Parse error"\.\s*$/,
];
const isErrorLine = (line) => /^(?:SCRIPT )?ERROR:/.test(line);

// The extension's refusal in a log: how many times Godot said it, with what versions and path, the errors that follow
// from it, and every error line that is neither.
export function describeRefusal(log) {
  const lines = log.split("\n");
  const messages = lines.map((line) => REFUSED.exec(line)).filter(Boolean);
  const notOpened = lines.map((line) => NOT_OPENED.exec(line)).filter(Boolean);
  const notLoaded = lines.map((line) => NOT_LOADED.exec(line)).filter(Boolean);
  const consequences = lines.filter((line) => CONSEQUENCES.some((pattern) => pattern.test(line)));
  const refusal = (line) => REFUSED.test(line) || NOT_OPENED.test(line) || NOT_LOADED.test(line) || CONSEQUENCES.some((pattern) => pattern.test(line));
  const unrelated = lines.filter((line) => (isErrorLine(line) || /FABRIC_ERROR|FABRIC_CHECK_FAILED/.test(line)) && !refusal(line));
  return {
    first: lines.find((line) => REFUSED.test(line))?.trim() ?? null,
    firstError: lines.find(isErrorLine)?.trim() ?? null,
    refusals: messages.length,
    notOpened: notOpened.length,
    notLoaded: notLoaded.length,
    consequences: consequences.length,
    required: [...new Set(messages.map((match) => match[1]))],
    engines: [...new Set(messages.map((match) => match[3]))],
    extensions: [...new Set([...messages.map((match) => match[2]), ...notOpened.map((match) => match[1]), ...notLoaded.map((match) => match[1])])],
    unrelated: unrelated.map((line) => line.trim()),
    crashText: CRASH_TEXT.test(log),
  };
}

// The assertions of the failed-start negative: the process ended by itself without a crash, Godot said in its own
// words, before anything else, that it refused this extension at this minimum on this engine, did not open the
// library, and printed no error that is neither part of the refusal nor a consequence of it.
export function refusalProblems({ start, required, engine, extension = EXTENSION_PATH }) {
  const problems = [];
  const log = start.log ?? "";
  if (start.error) {
    problems.push(start.error.code === "ETIMEDOUT" ? "the start hit the hang guard" : `the start could not run: ${start.error.message}`);
  }
  if (start.signal) {
    problems.push(`the start died by ${start.signal}`);
  } else if (!start.error && typeof start.status !== "number") {
    problems.push("the start did not end by itself");
  }
  const found = describeRefusal(log);
  if (found.crashText) {
    problems.push("the log has Godot's crash text");
  }
  if (found.refusals === 0) {
    problems.push(`no line says that the extension is only compatible with Godot ${required} or later: the extension was not refused`);
  } else {
    if (found.required.length !== 1 || found.required[0] !== required) {
      problems.push(`the refusal names the minimum ${JSON.stringify(found.required)}, not ${required}`);
    }
    if (found.engines.length !== 1 || found.engines[0] !== engine) {
      problems.push(`the refusal names the engine ${JSON.stringify(found.engines)}, not ${engine}`);
    }
    if (found.extensions.length !== 1 || found.extensions[0] !== extension) {
      problems.push(`the refusal names ${JSON.stringify(found.extensions)}, not ${extension}`);
    }
    if (found.firstError !== found.first) {
      problems.push(`the first error of the log is not the refusal: ${found.firstError}`);
    }
  }
  if (found.notOpened === 0) {
    problems.push("Godot did not report that it could not open the library, so the library may have been loaded");
  }
  if (found.unrelated.length) {
    problems.push(`the log has an error that is neither the refusal nor a consequence of it: ${found.unrelated[0]}`);
  }
  return problems;
}

// ---- Residue ----------------------------------------------------------------------------------------------------

const insideCache = (entry) => entry.path === ".godot" || entry.path.startsWith(".godot/");
const keyed = (tree) => new Map(tree.map((entry) => [entry.path, entry]));
const same = (a, b) => a.kind === b.kind && a.sha256 === b.sha256;

export function treeDiff(from, to) {
  const before = keyed(from);
  const after = keyed(to);
  return {
    added: [...after.keys()].filter((name) => !before.has(name)).sort(),
    removed: [...before.keys()].filter((name) => !after.has(name)).sort(),
    changed: [...after.keys()].filter((name) => before.has(name) && !same(before.get(name), after.get(name))).sort(),
  };
}

// What the failed start left in the fixture. `before` is the fixture as it was handed to Godot, `refused` right after
// the refused start, `recovered` after the correct metadata was restored and a start succeeded. `control` is the
// fixture of the positive control, handed over and then started cleanly. Everything is judged against what a clean
// start does, measured, rather than against a list written here.
export function fixtureProblems({ before, refused, recovered, control }) {
  const problems = [];
  const clean = treeDiff(control.before, control.after);
  const allowed = new Set([...clean.added, ...clean.changed]);
  const refusal = treeDiff(before, refused);
  for (const name of refusal.removed) {
    problems.push(`the refused start removed ${name}`);
  }
  for (const name of [...refusal.added, ...refusal.changed]) {
    if (!allowed.has(name)) {
      problems.push(`the refused start left ${name}, which a clean start does not touch`);
    }
  }
  for (const entry of refused) {
    if (STAGING_NAME.test(path.posix.basename(entry.path))) {
      problems.push(`the refused start left a staging file: ${entry.path}`);
    }
  }
  const outcome = treeDiff(control.after, recovered);
  for (const name of outcome.added) {
    problems.push(`after the recovery the fixture has ${name}, which the control does not`);
  }
  for (const name of outcome.removed) {
    problems.push(`after the recovery the fixture lacks ${name}, which the control has`);
  }
  // Only what was put there is compared by content; the engine's cache files are compared by name.
  const handed = keyed(control.before);
  for (const name of outcome.changed) {
    if (handed.has(name) && !insideCache(handed.get(name))) {
      problems.push(`after the recovery ${name} differs from the control's`);
    }
  }
  return problems;
}

// What the failed start left outside the fixture. `outside` and `control` are paths relative to the sandbox, with the
// project left out. The engine's own user data is the only place a start may write; the working directory and the
// temporary directory must stay empty; and the refused start may write nothing that a clean start does not.
export function outsideProblems({ outside, control, home = "home", scratch = ["tmp", "cwd"] }) {
  const problems = [];
  const roots = [`${home}/Library/Application Support/Godot`, `${home}/Library/Caches/Godot`];
  const ancestors = new Set([home, `${home}/Library`, `${home}/Library/Application Support`, `${home}/Library/Caches`, ...scratch]);
  const known = new Set(control);
  for (const name of outside) {
    const owned = ancestors.has(name) || roots.some((root) => name === root || name.startsWith(`${root}/`));
    if (!owned) {
      problems.push(`${name} is outside the fixture and outside the engine's own user data`);
    } else if (!known.has(name)) {
      problems.push(`the refused start left ${name}, which a clean start does not`);
    }
  }
  return problems;
}

// ---- I/O --------------------------------------------------------------------------------------------------------

// One disposable sandbox per project: the fixture, a fresh HOME for the engine's user data, a temporary directory and
// a working directory, all under one mkdtemp root. A lane can then say what a start left outside the fixture.
export function createSandbox(prefix) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  const parts = { directory, project: path.join(directory, "project"), home: path.join(directory, "home"), scratch: path.join(directory, "tmp"), cwd: path.join(directory, "cwd") };
  for (const name of ["project", "home", "scratch", "cwd"]) {
    mkdirSync(parts[name]);
  }
  return {
    ...parts,
    env: { ...process.env, HOME: parts.home, TMPDIR: parts.scratch },
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  };
}

// The project of a fresh install: the sources, scenes, assets, extension metadata, built libraries and bundle, and no
// cache. `extra` names more files of the checkout to copy (relative paths).
export function populateColdProject({ root, project, extra = [] }) {
  for (const entry of readdirSync(root)) {
    if (/\.(?:gd|tscn|gdextension)$/.test(entry) || ["project.godot", "assets", "addons", "examples"].includes(entry)) {
      cpSync(path.join(root, entry), path.join(project, entry), { recursive: true, verbatimSymlinks: true });
    }
  }
  cpSync(path.join(root, "scripts"), path.join(project, "scripts"), {
    recursive: true, filter: (source) => !path.extname(source) || source.endsWith(".gd"),
  });
  mkdirSync(path.join(project, "build"));
  cpSync(path.join(root, "build/app.js"), path.join(project, "build/app.js"));
  for (const file of extra) {
    mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
    cpSync(path.join(root, file), path.join(project, file));
  }
  if (existsSync(path.join(project, ".godot"))) {
    throw new Error("Cold fixture unexpectedly contains a cache");
  }
}

// scripts/extension_startup.py: the cache must then hold the startup list and nothing else.
export function prepareStartup({ root, project }) {
  const prepared = spawnSync("python3", [path.join(root, "scripts/extension_startup.py"), project], { encoding: "utf8", timeout: 10000 });
  if (prepared.error || prepared.status !== 0) {
    throw new Error(prepared.stderr || String(prepared.error));
  }
  const files = readdirSync(path.join(project, ".godot"));
  if (JSON.stringify(files) !== JSON.stringify(STARTUP_FILES)) {
    throw new Error("Startup copied unexpected cache state");
  }
  return files;
}

// The one place a lane starts Godot. Fresh HOME and TMPDIR, an empty working directory, one launch per step.
export function startGodot({ ledger, step, binary, sandbox, args, timeout = 45000 }) {
  return ledger.launch(step, () => {
    const result = spawnSync(binary, ["--path", sandbox.project, ...args], {
      cwd: sandbox.cwd, env: sandbox.env, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024,
    });
    return { status: result.status, signal: result.signal ?? null, error: result.error ?? null, log: (result.stdout ?? "") + (result.stderr ?? "") };
  });
}

export function listTree(directory) {
  const entries = [];
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      const relative = path.relative(directory, full).split(path.sep).join("/");
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        entries.push({ path: relative, kind: "symlink", sha256: sha256(readlinkSync(full)) });
      } else if (stat.isDirectory()) {
        entries.push({ path: relative, kind: "dir" });
        walk(full);
      } else {
        entries.push({ path: relative, kind: "file", sha256: sha256(readFileSync(full)) });
      }
    }
  };
  walk(directory);
  return entries;
}

export const treeSha256 = (tree) => sha256(tree.map((entry) => `${entry.path}\t${entry.kind}\t${entry.sha256 ?? ""}\n`).join(""));
