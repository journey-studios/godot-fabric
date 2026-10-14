import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ensureGodotBinary, GODOT_VERSION } from "./godot-binary.mjs";
import {
  compareVersions, createLedger, createSandbox, describeRefusal, fixtureProblems, INCOMPATIBLE_MINIMUM, judgeStart, listTree,
  outsideProblems, populateColdProject, prepareStartup, refusalProblems, sha256, startGodot,
} from "./cold-lanes.mjs";

// The failed start of GF-02 (docs/evidence/cold-start.md, "Failed start with an incompatible minimum"), with the real
// engine: a fresh fixture whose fabric.gdextension asks for a Godot newer than the one running must be refused in
// Godot's own words, end without a crash and leave no residue; the very next start of the same fixture with the
// correct metadata must be clean. A positive control with the unmodified metadata is started the same way, measures
// what a clean start leaves, and its log must fail the refusal assertions.
const root = fileURLToPath(new URL("..", import.meta.url));
const { values } = parseArgs({ options: { "keep-metadata": { type: "boolean", default: false } } });
// The causal control of the lane: the metadata stays as it is, so nothing is refused and the lane has to fail.
const keepMetadata = values["keep-metadata"];
const reportFile = path.join(root, "build/cold-start-negative.json");
mkdirSync(path.join(root, "build"), { recursive: true });
// A report of an earlier run never stands for this one, not even when the engine is refused.
rmSync(reportFile, { force: true });
let binary;
const ledger = createLedger();
const logs = [];
const outsideOf = (sandbox) => listTree(sandbox.directory).map((entry) => entry.path).filter((name) => name !== "project" && !name.startsWith("project/"));
const gdextension = (sandbox) => path.join(sandbox.project, "fabric.gdextension");

function step(sandbox, name, args, timeout) {
  const start = startGodot({ ledger, step: name, binary, sandbox, args, timeout });
  const logFile = `cold-start-negative-${name}.log`;
  writeFileSync(path.join(root, "build", logFile), start.log);
  logs.push({ step: name, status: start.status, signal: start.signal, logFile, logSha256: sha256(start.log), logBytes: Buffer.byteLength(start.log) });
  return start;
}

const IMPORT = ["--headless", "--editor", "--import"];
const REACT = ["--headless", "res://main.tscn", "--", "--validate"];
const MARKER = "FABRIC_VALIDATION_PASSED";

function fresh(prefix) {
  const sandbox = createSandbox(prefix);
  try {
    populateColdProject({ root, project: sandbox.project });
    prepareStartup({ root, project: sandbox.project });
  } catch (error) {
    sandbox.dispose();
    throw error;
  }
  return sandbox;
}

function withMinimum(text, minimum) {
  const line = /^(compatibility_minimum\s*=\s*)"[^"]*"/m;
  if (!line.test(text)) {
    throw new Error("fabric.gdextension has no compatibility_minimum line");
  }
  return text.replace(line, `$1"${minimum}"`);
}

const problems = [];
// What the lane measured so far. A step that never ran leaves its entry null, and the report says so.
const state = {
  version: null, measured: null, declaredMinimum: null, refused: null, outsideAfterRefusal: null, outsideAfterRecovery: null,
  metadataRestored: null, recoveredChecks: null, causal: null,
};

async function lane() {
  binary = await ensureGodotBinary();
  for (const file of ["build/app.js", "addons/fabric_godot.dylib"]) {
    if (!existsSync(path.join(root, file))) {
      throw new Error(`Missing ${file}; run npm run setup first`);
    }
  }
  if (compareVersions(INCOMPATIBLE_MINIMUM, GODOT_VERSION) <= 0) {
    throw new Error(`${INCOMPATIBLE_MINIMUM} is not above the engine ${GODOT_VERSION}`);
  }
  state.version = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 10000 }).stdout.trim();
  measureControl();
  runNegative();
}

// The positive control: the unmodified metadata, started the same way.
function measureControl() {
  const control = fresh("godot-fabric-control-");
  try {
    const before = listTree(control.project);
    const started = (name, args, marker, timeout) => {
      const start = step(control, name, args, timeout);
      const failure = judgeStart(start, marker);
      if (failure) {
        throw new Error(`The positive control is broken: ${name} failed: ${failure}\n${start.log}`);
      }
      return start;
    };
    const imported = started("control-import", IMPORT, null, 120000);
    started("control-react", REACT, MARKER);
    state.measured = { before, after: listTree(control.project), outside: outsideOf(control), importLog: imported.log };
  } finally {
    control.dispose();
  }
  // The causal control: the refusal assertions, applied to the real log of a start whose metadata was not changed, must fail.
  state.causal = refusalProblems({ start: { status: 0, signal: null, error: null, log: state.measured.importLog }, required: INCOMPATIBLE_MINIMUM, engine: GODOT_VERSION });
  if (state.causal.length === 0) {
    problems.push("the refusal assertions accept a start whose metadata was not changed: they prove nothing");
  }
}

function runNegative() {
  const { measured } = state;
  const sandbox = fresh("godot-fabric-negative-");
  try {
    const original = readFileSync(gdextension(sandbox), "utf8");
    state.declaredMinimum = /^compatibility_minimum\s*=\s*"([^"]+)"/m.exec(original)?.[1] ?? null;
    if (!keepMetadata) {
      writeFileSync(gdextension(sandbox), withMinimum(original, INCOMPATIBLE_MINIMUM));
    }
    const before = listTree(sandbox.project);
    state.refused = step(sandbox, "refused-import", IMPORT, 120000);
    const refusedTree = listTree(sandbox.project);
    state.outsideAfterRefusal = outsideOf(sandbox);
    // The correct metadata is back, byte for byte, and the very next start is the same fixture's.
    writeFileSync(gdextension(sandbox), original);
    state.metadataRestored = readFileSync(gdextension(sandbox), "utf8") === original;
    const imported = step(sandbox, "recovered-import", IMPORT, 120000);
    const validated = step(sandbox, "recovered-react", REACT);
    for (const [name, start, marker] of [["the next import", imported, null], ["the next runtime start", validated, MARKER]]) {
      const failure = judgeStart(start, marker);
      if (failure) {
        problems.push(`${name} with the correct metadata was not clean: ${failure}`);
      }
    }
    if (!judgeStart(validated, MARKER)) {
      const { checks } = JSON.parse(readFileSync(path.join(sandbox.project, "build/report.json"), "utf8"));
      state.recoveredChecks = Array.isArray(checks) ? checks.length : null;
    }
    state.outsideAfterRecovery = outsideOf(sandbox);
    const recovered = listTree(sandbox.project);
    problems.push(...refusalProblems({ start: state.refused, required: INCOMPATIBLE_MINIMUM, engine: GODOT_VERSION }));
    problems.push(...fixtureProblems({ before, refused: refusedTree, recovered, control: measured }));
    problems.push(...outsideProblems({ outside: state.outsideAfterRefusal, control: measured.outside }).map((text) => `after the refused start: ${text}`));
    problems.push(...outsideProblems({ outside: state.outsideAfterRecovery, control: measured.outside }).map((text) => `after the recovery: ${text}`));
    if (!state.metadataRestored) {
      problems.push("the correct metadata was not restored byte for byte");
    }
  } finally {
    sandbox.dispose();
  }
}

// Any error of the lane, wherever it is thrown, is a failed lane with a report that names it.
let stopped = null;
try {
  await lane();
} catch (error) {
  stopped = error;
  problems.push(`the lane stopped on an error: ${String(error?.message ?? error).split("\n")[0]}`);
}

const hashOf = (file) => {
  try {
    return sha256(readFileSync(file));
  } catch {
    return null;
  }
};
const found = state.refused ? describeRefusal(state.refused.log) : null;
const report = {
  schemaVersion: 1,
  status: problems.length ? "failed" : "passed",
  mode: keepMetadata ? "causal-control-metadata-kept" : "incompatible-minimum",
  engine: { version: state.version, pin: GODOT_VERSION, executableSha256: binary ? hashOf(binary) : null },
  host: { librarySha256: hashOf(path.join(root, "addons/fabric_godot.dylib")) },
  platform: process.platform,
  architecture: process.arch,
  declaredMinimum: state.declaredMinimum,
  incompatibleMinimum: INCOMPATIBLE_MINIMUM,
  refusal: found && {
    message: found.first, refusals: found.refusals, notOpened: found.notOpened, notLoaded: found.notLoaded,
    consequences: found.consequences, unrelatedErrors: found.unrelated,
    exitStatus: state.refused.status, signal: state.refused.signal, crashText: found.crashText,
  },
  recovery: { metadataRestoredByteForByte: state.metadataRestored, reactChecks: state.recoveredChecks },
  residue: {
    controlOutsidePaths: state.measured?.outside.length ?? null,
    refusedOutsidePaths: state.outsideAfterRefusal?.length ?? null,
    recoveredOutsidePaths: state.outsideAfterRecovery?.length ?? null,
    controlFixtureEntries: state.measured?.after.length ?? null,
  },
  causalControl: state.causal && { unchangedMetadataLogFailsTheRefusalAssertions: state.causal.length > 0, problems: state.causal },
  steps: ledger.entries(),
  logs,
  problems,
};
writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
if (problems.length) {
  console.error(`COLD_START_NEGATIVE_FAILED:\n- ${problems.join("\n- ")}`);
  if (stopped) {
    console.error(stopped.stack ?? String(stopped));
  }
  process.exitCode = 1;
} else {
  console.log(`COLD_START_NEGATIVE_PASSED: refused (${found.refusals} messages, exit ${state.refused.status}), no residue, the next start clean`);
}
