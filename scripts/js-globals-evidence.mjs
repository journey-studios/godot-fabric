import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES} from "../tests/js-globals-sabotages.mjs";
import {derivedChecks, oracleRejection, rnExpectations, verifyJsGlobalsReport} from "../tests/js-globals-oracle.mjs";

// Writes docs/evidence/runtime/js-globals.json, the committed record of the JS globals slice's executed lanes, from the reports that the
// lanes left in build/ (which Git does not keep). It re-judges every report before it writes anything:
//
//   - the current lane's report passes the independent oracle, and every other lane's report is rejected by it with the verdicts the probe gave;
//   - every lane bundled the sources that are on disk now, and the current lane ran on the host that is in addons/ now, so the record
//     is of this tree and not of an earlier one.
//
// The lanes run before it: `node tests/js-globals-native.test.mjs --allow-original-negative` with the previous host in addons/ (the
// current host put back after), `node scripts/js-globals-sabotage.mjs` (the sabotages, then the current lane). With --commit <sha> it
// also checks every pin of a repository file against `git show <sha>:<path>` and records the commit, which is how the pins are tied
// to the implementation commit once it exists. Run with:
//   node scripts/js-globals-evidence.mjs [--commit <sha>]
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const readJson = file => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const sha = file => digest(readFileSync(path.join(root, file)));
const git = (...args) => execFileSync("git", args, {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}).trim();
const commitArgument = process.argv.indexOf("--commit");
const commit = commitArgument === -1 ? null : process.argv[commitArgument + 1];

const expected = rnExpectations(root);
const failures = report => report.checks.filter(row => !row.passed).map(row => row.name);
const lane = (name, {rejected}) => {
  const report = readJson(`build/js-globals-${name}-report.json`);
  assert.deepEqual(derivedChecks(report, expected), report.checks, `${name}: the oracle derives the verdicts the probe gave`);
  const oracle = rejected ? oracleRejection(report, expected) : null;
  if (rejected) {
    assert.ok(failures(report).length > 0 && oracle !== null, `${name}: the probe and the oracle reject it`);
  } else {
    verifyJsGlobalsReport(report, expected);
  }
  return {report, oracle, logSha256: sha(`build/js-globals-${name}.log`)};
};

const current = lane("current", {rejected: false});
const original = lane("original", {rejected: true});
const sabotages = SABOTAGES.map(variant => ({variant, ...lane(`sabotage-${variant.name}`, {rejected: true})}));
const bundleOf = report => report.provenance.bundle;

// The record is of this tree: every lane bundled the files that are on disk now (the previous host's lane differs from the current one only
// in the compiled native producers, which are pinned for the tree and not for the old binary), and the current lane ran on today's host.
const lanes = [current, original, ...sabotages];
for (const {report} of lanes) {
  for (const [file, pin] of Object.entries(bundleOf(report).sources)) {
    assert.equal(sha(file), pin, `${report.provenance.lane}: ${file} changed after the lane ran; run the lanes again`);
  }
}
const hostSha256 = sha("addons/fabric_godot.dylib");
assert.equal(current.report.provenance.nativeHostSha256, hostSha256, "The current lane ran on the host that is in addons/ now");
for (const {report} of [...sabotages]) {
  assert.equal(report.provenance.nativeHostSha256, hostSha256);
}
assert.notEqual(original.report.provenance.nativeHostSha256, hostSha256, "The control ran on another host");
assert.equal(bundleOf(original.report).bundle.sha256, bundleOf(current.report).bundle.sha256, "The previous host ran the same bundle");

const pins = bundleOf(current.report).sources;
if (commit !== null) {
  for (const [file, pin] of Object.entries(pins)) {
    assert.equal(digest(execFileSync("git", ["show", `${commit}:${file}`], {cwd: root, maxBuffer: 64 * 1024 * 1024})), pin, `${file} at ${commit}`);
  }
}
const inputs = bundleOf(current.report).bundle.inputs;
const stages = current.report.stages;
const summary = ({report, oracle, logSha256}) => ({
  checks: report.checks.length, failedChecks: failures(report), oracleVerdict: oracle, bundleSha256: bundleOf(report).bundle.sha256,
  nativeHostSha256: report.provenance.nativeHostSha256, logSha256,
});

const record = {
  schemaVersion: 1,
  scenario: "js-globals",
  status: "verified-local-headless-previous-host-control-five-sabotages",
  at: new Date().toISOString(),
  executionBaseCommit: git("rev-parse", "HEAD"),
  sourceDirtyDuringExecution: commit === null,
  implementationCommit: commit,
  pinning: commit === null
    ? "The lanes ran on the working tree on top of executionBaseCommit, before the implementation commit existed. sourcePins are the SHA-256 of the files they executed; rerun scripts/js-globals-evidence.mjs --commit <sha> to check each against git show <sha>:<path> and record the commit."
    : "Every sourcePins entry equals git show <implementationCommit>:<path>.",
  environment: {
    godot: current.report.godot, reactNative: current.report.reactNative, node: current.report.provenance.node, platform: "macOS arm64",
    displayServer: current.report.displayServer,
    nativeHostSha256: hostSha256, previousHostSha256: original.report.provenance.nativeHostSha256,
    previousHost: "built from executionBaseCommit, with the host's performance and console stubs; kept in build/gf05-globals-previous-host/ (local, not in Git)",
  },
  commands: ["npm run test:js-globals", "node tests/js-globals-native.test.mjs --allow-original-negative (previous host in addons/)",
    "node scripts/js-globals-sabotage.mjs", "node scripts/js-globals-evidence.mjs"],
  currentLane: {
    ...summary(current),
    result: `JS_GLOBALS_PASSED: ${current.report.checks.length}`,
    checkVerdicts: current.report.checks,
    bundleInputs: {count: inputs.length, injectedFirst: inputs.slice(0, 2),
      bootstrapPositions: Object.fromEntries(["src/initialize.js", ...Object.keys(bundleOf(current.report).originalReactNativeSources)
        .filter(file => /^(?:Libraries\/Core\/setUp|src\/private\/setup\/setUp)/.test(file)).map(file => "node_modules/react-native/" + file)]
        .filter(file => inputs.includes(file)).map(file => [file, inputs.indexOf(file)]))},
    originalReactNativeSources: bundleOf(current.report).originalReactNativeSources,
    hostPrintedMessages: current.report.stages.early.length + current.report.stages.console.perCall.reduce((sum, call) => sum + call.logged.length, 0),
    consoleScenario: current.report.stages.console.perCall.map(call => ({method: call.method, args: call.args, logged: call.logged})),
    firstModule: {atFirstModule: stages.first, hostBeforeBundle: stages.host},
    clock: {frames: stages.clock.frames.length, godotBracket: stages.clock.godot},
  },
  previousHostControl: {
    ...summary(original),
    sameBundleAsCurrent: true,
    result: `JS_GLOBALS_ORIGINAL_NEGATIVE: ${failures(original.report).length}`,
    expectedOriginalFailures: original.report.expectedOriginalFailures,
    hostBeforeBundle: original.report.stages.host,
    performanceMembers: original.report.stages.environment.performance.ownKeys,
    note: "The same bundle runs on the host that defined a performance with only now and a console of three functions before any JS: it fails exactly the three checks that need the new host. Its native producers are pinned for the tree; the old binary was built from executionBaseCommit.",
  },
  retainedSabotage: {
    script: "scripts/js-globals-sabotage.mjs",
    table: "tests/js-globals-sabotages.mjs",
    mechanism: "in-memory esbuild overrides of one file each (scripts/js-globals-bundle.mjs); no file is edited",
    variants: sabotages.map(({variant, report, oracle, logSha256}) => ({name: variant.name, file: variant.file, find: variant.find, replace: variant.replace,
      ...summary({report, oracle, logSha256})})),
  },
  oracle: {
    file: "tests/js-globals-oracle.mjs",
    independence: "Written from RN's pinned sources, not from the probe: the globals each setup module installs are read with the TypeScript parser and the bootstrap audit's scan, RN's own console.js runs in Node (V8) against a recording hook for the whole scenario, and every verdict of the probe is derived again from the report's raw observations.",
    fromRn: {window: expected.window, navigator: expected.navigator, nodeEnv: expected.nodeEnv, product: expected.product,
      performanceMembers: expected.performanceMembers, domGlobals: expected.domGlobals, dispatchName: expected.dispatchName,
      consoleMembers: expected.consoleMembers, consoleMarker: expected.marker},
  },
  sourcePins: pins,
  scope: {actualHermesRuntime: true, actualFabricApplication: true, headless: true, rnSetupModules: ["setUpGlobals", "setUpDOM", "setUpPerformance", "setUpNavigator"],
    metroConsolePolyfill: true},
  limits: ["The error path (ErrorUtils, RN$handleException) is slice C's and is not certified here.",
    "The 11 Web Performance classes (setUpPerformanceModern) stay not-applicable and owned by GF-40; mark and measure are RN's no-ops.",
    "The level a console call carries reaches the host's hook, which prints every message as a HERMES: line and does not map the level to a Godot log.",
    "The headless desktop host only; no mobile export has run this bundle.",
    "Hosted CI is pending: the record is of the local run."],
};
writeFileSync(path.join(root, "docs/evidence/runtime/js-globals.json"), JSON.stringify(record, null, 2) + "\n");
console.log(`JS_GLOBALS_EVIDENCE_WRITTEN: ${current.report.checks.length} checks, ${original.report.checks.length - failures(original.report).length} held on the previous host, ${sabotages.length} sabotages`);
