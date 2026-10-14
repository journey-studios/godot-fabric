import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES} from "../tests/react-microtasks-sabotages.mjs";
import {derivedChecks, explainedByModel, oracleRejection, rnExpectations, verifyReactMicrotasksReport} from "../tests/react-microtasks-oracle.mjs";

// Writes docs/evidence/runtime/react-microtasks.json, the committed record of the React microtasks slice's executed lanes, from the reports that the
// lanes left in build/ (which Git does not keep). It re-judges every report before it writes anything:
//
//   - the current lane's report passes the independent oracle, and every other lane's report is rejected by it with the verdicts the probe gave;
//   - every lane bundled the sources that are on disk now, and the current lane ran on the host that is in addons/ now, so the record
//     is of this tree and not of an earlier one; the previous host's lane ran on the host that build/gf05-microtasks-previous-host/ keeps.
//
// The lanes run before it: `node tests/react-microtasks-native.test.mjs --allow-original-negative` with the previous host in addons/ (the
// current host put back after), `node scripts/react-microtasks-sabotage.mjs` (the sabotages, then the current lane). With --commit <sha> it
// also checks every pin of a repository file against `git show <sha>:<path>` and records the commit, which is how the pins are tied
// to the implementation commit once it exists. Run with:
//   node scripts/react-microtasks-evidence.mjs [--commit <sha>]
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const readJson = file => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const sha = file => digest(readFileSync(path.join(root, file)));
const git = (...args) => execFileSync("git", args, {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}).trim();
const commitArgument = process.argv.indexOf("--commit");
const commit = commitArgument === -1 ? null : process.argv[commitArgument + 1];

const expected = await rnExpectations(root);
const failures = report => report.checks.filter(row => !row.passed).map(row => row.name);
const lane = (name, {rejected}) => {
  const report = readJson(`build/react-microtasks-${name}-report.json`);
  assert.deepEqual(derivedChecks(report, expected), report.checks, `${name}: the oracle derives the verdicts the probe gave`);
  const oracle = rejected ? oracleRejection(report, expected) : null;
  if (rejected) {
    assert.ok(failures(report).length > 0 && oracle !== null, `${name}: the probe and the oracle reject it`);
  } else {
    verifyReactMicrotasksReport(report, expected);
  }
  return {report, oracle, logSha256: sha(`build/react-microtasks-${name}.log`)};
};

const current = lane("current", {rejected: false});
// Since slice D2 imports RN's setUpTimers unchanged, a host without NativeMicrotasksCxx cannot evaluate the bundle (the renderer reads queueMicrotask when it evaluates, which
// resolves RN's getter), so the previous host's lane is no longer the control that fails exactly the checks that need the module: it fails all but one. The record keeps
// the lane when its report is there and says what it is; the `no-module` sabotage is the control that the lanes still run.
const original = existsSync(path.join(root, "build/react-microtasks-original-report.json")) ? lane("original", {rejected: true}) : null;
const sabotages = SABOTAGES.map(variant => ({variant, ...lane(`sabotage-${variant.name}`, {rejected: true})}));
const bundleOf = report => report.provenance.bundle;
const ordersOf = report => Object.fromEntries(Object.keys(expected.orders.on).map(name => [name, report.stages[`case_${name.replace("-", "_")}`]?.labels ?? []]));

// The record is of this tree: every lane bundled the files that are on disk now (the previous host's lane and the sabotages of the host
// differ from the current one only in the compiled native producers, which are pinned for the tree and not for the old binary), and the
// current lane ran on today's host.
// A sabotage of the host ran with its one source broken: the pin of that file is the hash of the genuine text with the sabotage's
// replacement made, which is proof of what the lane executed.
const pinOf = (file, variant) => {
  if (variant?.host === true && file === variant.file) {
    const text = readFileSync(path.join(root, file), "utf8");
    assert.equal(text.split(variant.find).length, 2, `${variant.name} still replaces exactly one place in ${file}`);
    return digest(text.replace(variant.find, () => variant.replace));
  }
  return sha(file);
};
const lanes = [{...current, variant: null}, ...(original === null ? [] : [{...original, variant: null}]), ...sabotages];
for (const {report, variant} of lanes) {
  for (const [file, pin] of Object.entries(bundleOf(report).sources)) {
    assert.equal(pinOf(file, variant), pin, `${report.provenance.lane}: ${file} changed after the lane ran; run the lanes again`);
  }
}
const hostSha256 = sha("addons/fabric_godot.dylib");
assert.equal(current.report.provenance.nativeHostSha256, hostSha256, "The current lane ran on the host that is in addons/ now");
const previousHostSha256 = sha("build/gf05-microtasks-previous-host/fabric_godot.dylib");
assert.notEqual(previousHostSha256, hostSha256, "The control ran on another host");
if (original !== null) {
  assert.equal(original.report.provenance.nativeHostSha256, previousHostSha256, "The control ran on the host that build/gf05-microtasks-previous-host/ keeps");
  assert.equal(bundleOf(original.report).bundle.sha256, bundleOf(current.report).bundle.sha256, "The previous host ran the same bundle");
}
for (const {variant, report} of sabotages) {
  if (variant.host === true) {
    assert.equal(bundleOf(report).bundle.sha256, bundleOf(current.report).bundle.sha256, `${variant.name} runs the current bundle`);
    assert.equal(report.provenance.nativeHostSha256, sha(`${variant.hostDirectory}/fabric_godot.dylib`), `${variant.name} ran on the host it kept`);
    assert.notEqual(report.provenance.nativeHostSha256, hostSha256);
  } else {
    assert.notEqual(bundleOf(report).bundle.sha256, bundleOf(current.report).bundle.sha256, `${variant.name} bundles another SDK`);
    assert.equal(report.provenance.nativeHostSha256, hostSha256);
  }
}
const flagUnset = sabotages.find(entry => entry.variant.name === "flag-unset");
assert.equal(explainedByModel(flagUnset.report, expected), null, "The flag-unset lane comes out in the order the model gives for the flag off");
assert.equal(explainedByModel(current.report, expected), null, "The current lane comes out in the order the model gives for the flag on");

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
  scenario: "react-microtasks",
  status: original === null ? "verified-local-headless-seven-sabotages" : "verified-local-headless-previous-host-control-seven-sabotages",
  at: new Date().toISOString(),
  executionBaseCommit: git("rev-parse", "HEAD"),
  sourceDirtyDuringExecution: commit === null,
  implementationCommit: commit,
  pinning: commit === null
    ? "The lanes ran on the working tree on top of executionBaseCommit, before the implementation commit existed. sourcePins are the SHA-256 of the files they executed; rerun scripts/react-microtasks-evidence.mjs --commit <sha> to check each against git show <sha>:<path> and record the commit."
    : "Every sourcePins entry equals git show <implementationCommit>:<path>.",
  environment: {
    godot: current.report.godot, reactNative: current.report.reactNative, node: current.report.provenance.node, platform: "macOS arm64",
    displayServer: current.report.displayServer,
    nativeHostSha256: hostSha256, previousHostSha256,
    previousHost: "built from executionBaseCommit (the tip of feat/gf-05-error-path), which registers no NativeMicrotasksCxx module; kept in build/gf05-microtasks-previous-host/ (local, not in Git)",
  },
  commands: ["npm run test:react-microtasks", ...(original === null ? [] : ["node tests/react-microtasks-native.test.mjs --allow-original-negative (previous host in addons/)"]),
    "node scripts/react-microtasks-sabotage.mjs", "node scripts/react-microtasks-evidence.mjs"],
  currentLane: {
    ...summary(current),
    result: `REACT_MICROTASKS_PASSED: ${current.report.checks.length}`,
    checkVerdicts: current.report.checks,
    bundleInputs: {count: inputs.length, injectedFirst: inputs[0],
      positions: Object.fromEntries(["src/runtime.js", "src/initialize.js", "node_modules/react-native/src/private/webapis/microtasks/specs/NativeMicrotasks.js",
        "node_modules/react-native/Libraries/Core/Timers/immediateShim.js"].filter(file => inputs.includes(file)).map(file => [file, inputs.indexOf(file)])),
      portableQueueMicrotaskBundled: inputs.includes("node_modules/react-native/Libraries/Core/Timers/queueMicrotask.js")},
    originalReactNativeSources: bundleOf(current.report).originalReactNativeSources,
    flagAndGlobal: {environment: {flag: stages.environment.flag, queueMicrotask: stages.environment.queueMicrotask, setImmediate: stages.environment.setImmediate},
      hostBeforeTheBundle: stages.host.before, accessorLog: stages.environment.events},
    module: {native: stages.environment.native, registry: stages.registry, batch: stages.queue_many, drained: stages.drained},
    orders: ordersOf(current.report),
    modelOrders: expected.orders,
    casesThatDifferWithTheFlagOff: expected.differing,
    gate: {state: stages.gate.state, afterStop: stages.after_stop, finalApplication: {stopped: stages.stop.application.stopped, rootCount: stages.stop.application.rootCount},
      reentrant: {requests: stages.reentrant.requests, controlFound: stages.reentrant.controlFound, state: stages.reentrant.state,
        stopped: stages.reentrant.application.stopped, rootCount: stages.reentrant.application.rootCount}},
  },
  previousHostControl: original === null ? {
    reproducible: false,
    note: "Not run for this record. The control of slice D1 was the bundle on the host that registers no NativeMicrotasksCxx, which fails exactly the checks that need the new module. Slice D2 imports RN's setUpTimers unchanged: the renderer reads queueMicrotask when it evaluates, which resolves RN's lazy getter, so on that host the bundle does not evaluate and every check but the report one fails, as RN's does without the module. The no-module sabotage is the same control and runs with the other sabotages.",
  } : {
    ...summary(original),
    sameBundleAsCurrent: true,
    result: original.report.originalNegativeObserved ? `REACT_MICROTASKS_ORIGINAL_NEGATIVE: ${failures(original.report).length}` : `REACT_MICROTASKS_FAILED: ${failures(original.report).length}`,
    expectedOriginalFailures: original.report.expectedOriginalFailures,
    nativeModuleLoaded: original.report.stages.environment?.native?.loaded ?? false,
    note: original.report.originalNegativeObserved ? "The same bundle runs on the host that registers no NativeMicrotasksCxx: queueMicrotask has nothing to reach, so React's first update throws and the root does not mount. It fails exactly the checks that need the new module, and holds the three that need only the JS the bundle runs (the flag, and the global installed before the renderer reads it) and the lifecycle and report checks. Its native producers are pinned for the tree; the old binary was built from executionBaseCommit." : "The same bundle on the host that registers no NativeMicrotasksCxx does not evaluate (slice D2's setUpTimers resolves the module when the renderer evaluates), so it fails more checks than the ones that need the module.",
  },
  retainedSabotage: {
    script: "scripts/react-microtasks-sabotage.mjs",
    table: "tests/react-microtasks-sabotages.mjs",
    mechanism: "flag-unset (RN's setUpTimers.js), promise-shim and gate-removed (src/runtime.js) are in-memory esbuild overrides (scripts/react-microtasks-bundle.mjs), no file is edited; no-module, gate-closed, request-closes-gate and checkpoint-gate-closed each break one line of native/application_runtime.cpp, rebuild the host, keep it in the variant's hostDirectory and restore the source byte for byte (scripts/sabotage-sources.mjs)",
    variants: sabotages.map(({variant, report, oracle, logSha256}) => ({name: variant.name, host: variant.host === true, file: variant.file, find: variant.find,
      replace: variant.replace, ...summary({report, oracle, logSha256}), orders: ordersOf(report)})),
    flagUnsetMatchesModel: "The flag-unset lane comes out, case by case, in the order the oracle's model gives for the flag off (modelOrders.off), which says the model describes this host in the direction the passing lane does not show.",
  },
  oracle: {
    file: "tests/react-microtasks-oracle.mjs",
    independence: "Written from RN's pinned sources, not from the probe: setUpTimers' flag and where it installs queueMicrotask from, the spec and C++ of the NativeMicrotasks module, the renderer's flag branch (supportsMicrotasks, scheduleMicrotask, scheduleImmediateRootScheduleTask and the job it queues, read from ReactFabric-prod.js by the structure of its code), how a touch end becomes a discrete update, and the RuntimeScheduler's priority timeouts, checkpoint and ordering are read from the files; the order of each case is derived by a model of the host's event loop whose microtask queue is V8's own (Promise reactions, queueMicrotask and RN's immediateShim run in a vm context) and in which React's job goes where the flag branch puts it; every verdict of the probe is derived again from the report's raw observations.",
    fromRn: {flag: expected.flag, flagName: expected.flagName, moduleName: expected.moduleName, methods: expected.methods, queueSpec: expected.specFile,
      renderer: expected.renderer, scheduler: expected.scheduler, events: expected.events, host: expected.host},
  },
  sourcePins: pins,
  scope: {actualHermesRuntime: true, actualFabricApplication: true, headless: true, realEventPath: true, nativeMicrotasksModule: true},
  limits: ["The cases are the handler of a Pressable's onPress in one headless root; the order of the commit relative to other work is certified for sync-lane updates of a discrete event, not for every lane.",
    "The timer cases depend on the host taking a timer registered in a handler in a later pump than the RuntimeScheduler's loop; the oracle reads that order from native/application_runtime.cpp.",
    "The gate is the host's extension (V2-D27); callback exceptions and a Promise storm are slice F's. Hermes ignores the hint of drainMicrotasks(int), so the checkpoint at the head of stop() is bounded as every pump is: by the queue.",
    "The registry counts the calls that reach RN's module in front of RN's own invoker; the module's C++ is compiled unchanged.",
    "The headless desktop host only; no mobile export has run this bundle.",
    "Hosted CI is pending: the record is of the local run."],
};
writeFileSync(path.join(root, "docs/evidence/runtime/react-microtasks.json"), JSON.stringify(record, null, 2) + "\n");
console.log(`REACT_MICROTASKS_EVIDENCE_WRITTEN: ${current.report.checks.length} checks, ${original === null ? "no previous host lane" : `${original.report.checks.length - failures(original.report).length} held on the previous host`}, ${sabotages.length} sabotages`);
