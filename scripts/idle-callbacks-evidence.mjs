import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES} from "../tests/idle-callbacks-sabotages.mjs";
import {idleDerivedChecks, idleOracleRejection, idleExpectations, verifyIdleCallbacksReport} from "../tests/idle-callbacks-oracle.mjs";

// Writes docs/evidence/runtime/idle-callbacks.json, the committed record of the idle callbacks slice's executed lanes, from the reports that the lanes left
// in build/ (which Git does not keep). It re-judges every report before it writes anything:
//
//   - the current lane's report passes the independent oracle, and every other lane's report is rejected by it with the verdicts the probe gave;
//   - every lane bundled the sources that are on disk now, and the current lane ran on the host that is in addons/ now, so the record is of this tree and not of
//     an earlier one; the previous host's lane ran on the host that build/gf05-idle-previous-host/ keeps.
//
// The lanes run before it: `node tests/idle-callbacks-native.test.mjs --allow-original-negative` with the previous host in addons/ (the current host put back
// after), `node scripts/idle-callbacks-sabotage.mjs` (the sabotages, then the current lane). With --commit <sha> it also checks every pin of a repository file
// against `git show <sha>:<path>` and records the commit, which is how the pins are tied to the implementation commit once it exists. Run with:
//   node scripts/idle-callbacks-evidence.mjs [--commit <sha>]
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const readJson = file => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const sha = file => digest(readFileSync(path.join(root, file)));
const git = (...args) => execFileSync("git", args, {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}).trim();
const commitArgument = process.argv.indexOf("--commit");
const commit = commitArgument === -1 ? null : process.argv[commitArgument + 1];

const expected = await idleExpectations(root);
const failures = report => report.checks.filter(row => !row.passed).map(row => row.name);
const lane = (name, {rejected}) => {
  const report = readJson(`build/idle-callbacks-${name}-report.json`);
  assert.deepEqual(idleDerivedChecks(report, expected), report.checks, `${name}: the oracle derives the verdicts the probe gave`);
  const oracle = rejected ? idleOracleRejection(report, expected) : null;
  if (rejected) {
    assert.ok(failures(report).length > 0 && oracle !== null, `${name}: the probe and the oracle reject it`);
  } else {
    verifyIdleCallbacksReport(report, expected);
  }
  return {report, oracle, logSha256: sha(`build/idle-callbacks-${name}.log`)};
};

const current = lane("current", {rejected: false});
const original = lane("original", {rejected: true});
const sabotages = SABOTAGES.map(variant => ({variant, ...lane(`sabotage-${variant.name}`, {rejected: true})}));
const bundleOf = report => report.provenance.bundle;
const ordersOf = report => Object.fromEntries(Object.keys(expected.orders).map(name => [name, report.stages[`case_${name.replace("-", "_")}`]?.labels ?? []]));

// The record is of this tree: every lane bundled the files that are on disk now (the previous host's lane and the sabotages of the host differ from the
// current one only in the compiled native producers, which are pinned for the tree and not for the old binary), and the current lane ran on today's host.
// A sabotage of the host ran with its one source broken: the pin of that file is the hash of the genuine text with the sabotage's replacement made, which is
// proof of what the lane executed.
const pinOf = (file, variant) => {
  if (variant?.host === true && file === variant.file) {
    const text = readFileSync(path.join(root, file), "utf8");
    assert.equal(text.split(variant.find).length, 2, `${variant.name} still replaces exactly one place in ${file}`);
    return digest(text.replace(variant.find, () => variant.replace));
  }
  return sha(file);
};
const lanes = [{...current, variant: null}, {...original, variant: null}, ...sabotages];
for (const {report, variant} of lanes) {
  for (const [file, pin] of Object.entries(bundleOf(report).sources)) {
    assert.equal(pinOf(file, variant), pin, `${report.provenance.lane}: ${file} changed after the lane ran; run the lanes again`);
  }
}
const hostSha256 = sha("addons/fabric_godot.dylib");
assert.equal(current.report.provenance.nativeHostSha256, hostSha256, "The current lane ran on the host that is in addons/ now");
const previousHostSha256 = sha("build/gf05-idle-previous-host/fabric_godot.dylib");
assert.equal(original.report.provenance.nativeHostSha256, previousHostSha256, "The control ran on the host that build/gf05-idle-previous-host/ keeps");
assert.notEqual(previousHostSha256, hostSha256, "The control ran on another host");
assert.equal(bundleOf(original.report).bundle.sha256, bundleOf(current.report).bundle.sha256, "The previous host ran the same bundle");
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
const idleOf = (name, owner) => stages[`case_${name.replace("-", "_")}`].record.idle[owner];
const readings = (name, owner) => Object.fromEntries(idleOf(name, owner).samples.map(sample => [sample.label, sample.value]));

const record = {
  schemaVersion: 1,
  scenario: "idle-callbacks",
  status: "verified-local-headless-previous-host-control-nine-sabotages",
  at: new Date().toISOString(),
  executionBaseCommit: git("rev-parse", "HEAD"),
  sourceDirtyDuringExecution: commit === null,
  implementationCommit: commit,
  pinning: commit === null
    ? "The lanes ran on the working tree on top of executionBaseCommit, before the implementation commit existed. sourcePins are the SHA-256 of the files they executed; rerun scripts/idle-callbacks-evidence.mjs --commit <sha> to check each against git show <sha>:<path> and record the commit."
    : "Every sourcePins entry equals git show <implementationCommit>:<path>.",
  environment: {
    godot: current.report.godot, reactNative: current.report.reactNative, node: current.report.provenance.node, platform: "macOS arm64",
    displayServer: current.report.displayServer,
    nativeHostSha256: hostSha256, previousHostSha256,
    previousHost: "built from executionBaseCommit (the tip of feat/gf-05-microtasks, slice D1), which registers no NativeIdleCallbacksCxx module; kept in build/gf05-idle-previous-host/ (local, not in Git)",
  },
  commands: ["npm run test:idle-callbacks", "node tests/idle-callbacks-native.test.mjs --allow-original-negative (previous host in addons/)",
    "node scripts/idle-callbacks-sabotage.mjs", "node scripts/idle-callbacks-evidence.mjs"],
  currentLane: {
    ...summary(current),
    result: `IDLE_CALLBACKS_PASSED: ${current.report.checks.length}`,
    checkVerdicts: current.report.checks,
    bundleInputs: {count: inputs.length, injectedFirst: inputs[0],
      positions: Object.fromEntries(["src/runtime.js", "src/initialize.js", "node_modules/react-native/Libraries/Core/setUpTimers.js",
        "node_modules/react-native/src/private/webapis/idlecallbacks/specs/NativeIdleCallbacks.js", "node_modules/react-native/src/private/webapis/microtasks/specs/NativeMicrotasks.js",
        "node_modules/react-native/Libraries/Core/Timers/immediateShim.js"].filter(file => inputs.includes(file)).map(file => [file, inputs.indexOf(file)])),
      portableQueueMicrotaskBundled: inputs.includes("node_modules/react-native/Libraries/Core/Timers/queueMicrotask.js"),
      portableQueueMicrotaskNote: "setUpTimers' non-bridgeless branch requires it, so the bundler holds it; RN$Bridgeless is true and the branch never runs."},
    originalReactNativeSources: bundleOf(current.report).originalReactNativeSources,
    setUpTimers: {environment: {flag: stages.environment.flag, queueMicrotask: stages.environment.queueMicrotask, requestIdleCallback: stages.environment.requestIdleCallback,
      cancelIdleCallback: stages.environment.cancelIdleCallback, setImmediate: stages.environment.setImmediate, clearImmediate: stages.environment.clearImmediate,
      descriptorsAfterRead: stages.environment.descriptors, kindsBeforeAnyRead: stages.environment.kindsAtStart}, hostBeforeTheBundle: stages.host.before,
      accessorLog: stages.environment.events},
    module: {native: stages.environment.native, registry: stages.registry.nativeModules, requestBatch: stages.request_many, runBatch: stages.many_done,
      cancelBatch: stages.cancel_many, cancelEdges: stages.edges},
    orders: ordersOf(current.report),
    modelOrders: expected.orders,
    readings: {deadline: readings("deadline", "idle"), yield: readings("yield", "idle-a"), "yield-immediate": readings("yield-immediate", "idle"),
      note: "Milliseconds, as the callback read them in the lane of record. The oracle judges each against the timestamps the report carries, not against these values."},
    didTimeout: Object.fromEntries(Object.keys(expected.didTimeout.timeout).map(owner => [owner, {timeout: idleOf("timeout", owner).timeout, didTimeout: idleOf("timeout", owner).didTimeout}])),
    gate: {state: stages.gate.state, afterStop: stages.after_stop, finalApplication: {stopped: stages.stop.application.stopped, rootCount: stages.stop.application.rootCount}},
  },
  previousHostControl: {
    ...summary(original),
    sameBundleAsCurrent: true,
    result: `IDLE_CALLBACKS_ORIGINAL_NEGATIVE: ${failures(original.report).length}`,
    expectedOriginalFailures: original.report.expectedOriginalFailures,
    nativeModuleLoaded: original.report.stages.environment.native.loaded,
    note: "The same bundle runs on the host that registers no NativeIdleCallbacksCxx: the idle callbacks are lazy getters, so the bundle evaluates, the root mounts and queueMicrotask and setImmediate work, and the first read of requestIdleCallback or cancelIdleCallback fails. It fails exactly the checks that need the new module, and holds the five that need only the JS the bundle runs (the flag, the globals before the bundle and the lazy getters, RN's immediateShim, setImmediate over the microtask module) and the lifecycle and report checks. Its native producers are pinned for the tree; the old binary was built from executionBaseCommit.",
  },
  retainedSabotage: {
    script: "scripts/idle-callbacks-sabotage.mjs",
    table: "tests/idle-callbacks-sabotages.mjs",
    mechanism: "set-up-timers-not-imported, timeout-ignored, reimplemented, cancel-dropped, gate-removed and window-open are in-memory esbuild overrides (scripts/idle-callbacks-bundle.mjs), no file is edited; no-module, strict-ignored and strict-waits-for-teardown break one line of native/application_runtime.cpp, rebuild the host, keep it in the variant's hostDirectory and restore the source byte for byte (scripts/sabotage-sources.mjs)",
    variants: sabotages.map(({variant, report, oracle, logSha256}) => ({name: variant.name, host: variant.host === true, file: variant.file, find: variant.find,
      replace: variant.replace, ...summary({report, oracle, logSha256}), orders: ordersOf(report)})),
  },
  oracle: {
    file: "tests/idle-callbacks-oracle.mjs",
    independence: "Written from RN's pinned sources, not from the probe: what setUpTimers' bridgeless branch installs and from where, the spec and C++ of the NativeIdleCallbacks module (the 50 ms deadline, the timeout that only drives didTimeout and never reaches the scheduler, the timeRemaining rules, the handle, the cancel), and the RuntimeScheduler's priority timeouts, the idle task's default timeout, the smallest expiration first, the yield, the cancel and the checkpoint after each task are read from the files; the order of each case and what each idle callback is told are derived by a model of the host's event loop whose scheduler is the C++ one over a virtual clock that only a spin advances and whose microtask queue is V8's own (Promise reactions, queueMicrotask and RN's immediateShim run in a vm context); a reading of timeRemaining is judged against the timestamps the report carries and the 50 ms of the source; every verdict of the probe is derived again from the report's raw observations.",
    fromRn: {flag: expected.flag, flagName: expected.flagName, installs: expected.installs, moduleName: expected.moduleName, methods: expected.methods,
      queueSpec: expected.specFile, idle: expected.idle, scheduler: expected.scheduler, host: expected.host},
    modelDidTimeout: expected.didTimeout,
    modelReadingClasses: expected.samples,
  },
  sourcePins: pins,
  scope: {actualHermesRuntime: true, actualFabricApplication: true, headless: true, realEventPath: true, nativeIdleCallbacksModule: true, setUpTimersUnchanged: true},
  limits: ["The cases are the handler of a Pressable's onPress in one headless root; the order of idle callbacks against other work is certified for work queued from inside a RuntimeScheduler task.",
    "The timer cases depend on the host taking a timer registered in a handler in a later pump than the RuntimeScheduler's loop; the oracle reads that order from native/application_runtime.cpp.",
    "The readings of timeRemaining are bounded by the timestamps of the lane, not fixed: the deadline is measured from a time the C++ takes, which the report brackets between the request and the callback's entry.",
    "The gate is the host's extension (V2-D27); callback exceptions, setImmediate under load and a Promise storm are slice F's.",
    "The registry counts the calls that reach RN's module in front of RN's own invokers; the module's C++ is compiled unchanged.",
    "The headless desktop host only; no mobile export has run this bundle.",
    "Hosted CI is pending: the record is of the local run."],
};
writeFileSync(path.join(root, "docs/evidence/runtime/idle-callbacks.json"), JSON.stringify(record, null, 2) + "\n");
console.log(`IDLE_CALLBACKS_EVIDENCE_WRITTEN: ${current.report.checks.length} checks, ${original.report.checks.length - failures(original.report).length} held on the previous host, ${sabotages.length} sabotages`);
