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
const binary = await ensureGodotBinary();
for (const file of ["build/app.js", "addons/fabric_godot.dylib"]) {
  if (!existsSync(path.join(root, file))) {
    throw new Error(`Missing ${file}; run npm run setup first`);
  }
}
if (compareVersions(INCOMPATIBLE_MINIMUM, GODOT_VERSION) <= 0) {
  throw new Error(`${INCOMPATIBLE_MINIMUM} is not above the engine ${GODOT_VERSION}`);
}

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
  populateColdProject({ root, project: sandbox.project });
  prepareStartup({ root, project: sandbox.project });
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
const version = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 10000 }).stdout.trim();
let measured;

// The positive control: the unmodified metadata, started the same way.
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
  measured = { before, after: listTree(control.project), outside: outsideOf(control), importLog: imported.log };
} finally {
  control.dispose();
}

const sandbox = fresh("godot-fabric-negative-");
let declaredMinimum;
let refused;
let outsideAfterRefusal;
let outsideAfterRecovery;
let metadataRestored;
let recoveredChecks = null;
try {
  const original = readFileSync(gdextension(sandbox), "utf8");
  declaredMinimum = /^compatibility_minimum\s*=\s*"([^"]+)"/m.exec(original)?.[1] ?? null;
  if (!keepMetadata) {
    writeFileSync(gdextension(sandbox), withMinimum(original, INCOMPATIBLE_MINIMUM));
  }
  const before = listTree(sandbox.project);
  refused = step(sandbox, "refused-import", IMPORT, 120000);
  const refusedTree = listTree(sandbox.project);
  outsideAfterRefusal = outsideOf(sandbox);
  // The correct metadata is back, byte for byte, and the very next start is the same fixture's.
  writeFileSync(gdextension(sandbox), original);
  metadataRestored = readFileSync(gdextension(sandbox), "utf8") === original;
  const imported = step(sandbox, "recovered-import", IMPORT, 120000);
  const validated = step(sandbox, "recovered-react", REACT);
  for (const [name, start, marker] of [["the next import", imported, null], ["the next runtime start", validated, MARKER]]) {
    const failure = judgeStart(start, marker);
    if (failure) {
      problems.push(`${name} with the correct metadata was not clean: ${failure}`);
    }
  }
  if (!judgeStart(validated, MARKER)) {
    recoveredChecks = JSON.parse(readFileSync(path.join(sandbox.project, "build/report.json"), "utf8")).checks.length;
  }
  outsideAfterRecovery = outsideOf(sandbox);
  const recovered = listTree(sandbox.project);
  problems.push(...refusalProblems({ start: refused, required: INCOMPATIBLE_MINIMUM, engine: GODOT_VERSION }));
  problems.push(...fixtureProblems({ before, refused: refusedTree, recovered, control: measured }));
  problems.push(...outsideProblems({ outside: outsideAfterRefusal, control: measured.outside }).map((text) => `after the refused start: ${text}`));
  problems.push(...outsideProblems({ outside: outsideAfterRecovery, control: measured.outside }).map((text) => `after the recovery: ${text}`));
  if (!metadataRestored) {
    problems.push("the correct metadata was not restored byte for byte");
  }
} finally {
  sandbox.dispose();
}

// The causal control: the refusal assertions, applied to the real log of a start whose metadata was not changed, must fail.
const causal = refusalProblems({ start: { status: 0, signal: null, error: null, log: measured.importLog }, required: INCOMPATIBLE_MINIMUM, engine: GODOT_VERSION });
if (causal.length === 0) {
  problems.push("the refusal assertions accept a start whose metadata was not changed: they prove nothing");
}

const found = describeRefusal(refused.log);
const report = {
  schemaVersion: 1,
  status: problems.length ? "failed" : "passed",
  mode: keepMetadata ? "causal-control-metadata-kept" : "incompatible-minimum",
  engine: { version, pin: GODOT_VERSION, executableSha256: sha256(readFileSync(binary)) },
  host: { librarySha256: sha256(readFileSync(path.join(root, "addons/fabric_godot.dylib"))) },
  platform: process.platform,
  architecture: process.arch,
  declaredMinimum,
  incompatibleMinimum: INCOMPATIBLE_MINIMUM,
  refusal: {
    message: found.first, refusals: found.refusals, notOpened: found.notOpened, notLoaded: found.notLoaded,
    consequences: found.consequences, unrelatedErrors: found.unrelated,
    exitStatus: refused.status, signal: refused.signal, crashText: found.crashText,
  },
  recovery: { metadataRestoredByteForByte: metadataRestored, reactChecks: recoveredChecks },
  residue: {
    controlOutsidePaths: measured.outside.length, refusedOutsidePaths: outsideAfterRefusal.length, recoveredOutsidePaths: outsideAfterRecovery.length,
    controlFixtureEntries: measured.after.length,
  },
  causalControl: { unchangedMetadataLogFailsTheRefusalAssertions: causal.length > 0, problems: causal },
  steps: ledger.entries(),
  logs,
  problems,
};
writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
if (problems.length) {
  console.error(`COLD_START_NEGATIVE_FAILED:\n- ${problems.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`COLD_START_NEGATIVE_PASSED: refused (${found.refusals} messages, exit ${refused.status}), no residue, the next start clean`);
}
