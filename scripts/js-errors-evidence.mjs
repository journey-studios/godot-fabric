import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES} from "../tests/js-errors-sabotages.mjs";
import {derivedChecks, oracleRejection, rnExpectations, verifyJsErrorsReport} from "../tests/js-errors-oracle.mjs";

// Writes docs/evidence/runtime/js-errors.json, the committed record of the error path slice's executed lanes, from the reports that the
// lanes left in build/ (which Git does not keep). It re-judges every report before it writes anything:
//
//   - the current lane's report passes the independent oracle, and every other lane's report is rejected by it with the verdicts the probe gave;
//   - every lane bundled the sources that are on disk now, and the current lane ran on the host that is in addons/ now, so the record
//     is of this tree and not of an earlier one; the previous host's lane ran on the host that build/gf05-errors-previous-host/ keeps.
//
// The lanes run before it: `node tests/js-errors-native.test.mjs --allow-original-negative` with the previous host in addons/ (the
// current host put back after), `node scripts/js-errors-sabotage.mjs` (the sabotages, then the current lane). With --commit <sha> it
// also checks every pin of a repository file against `git show <sha>:<path>` and records the commit, which is how the pins are tied
// to the implementation commit once it exists.
//
// Two commits are recorded and neither is derived from the HEAD of the moment the record is written:
//   - executionBaseCommit and sourceDirtyDuringExecution are what each lane saw when it ran (tests/js-errors-native.test.mjs records the commit
//     it stood on and every path that differed from it in the report's provenance). The lanes must agree on the commit; the record is dirty
//     when the current lane ran with any uncommitted path, whether or not --commit is given: --commit ties the executed sources to a commit,
//     it does not say they were committed when they ran.
//   - previousHost.sourceCommit is the commit the previous host's binary was built from, which only the person who built it knows. It is
//     required: --previous-host-commit <sha>, a commit in the history of HEAD. A missing or unknown one is an error, never a guess.
// Run with:
//   node scripts/js-errors-evidence.mjs --previous-host-commit <sha> [--commit <sha>]
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const readJson = file => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const sha = file => digest(readFileSync(path.join(root, file)));
const git = (...args) => execFileSync("git", args, {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}).trim();
const commitArgument = process.argv.indexOf("--commit");
const commit = commitArgument === -1 ? null : process.argv[commitArgument + 1];
const previousArgument = process.argv.indexOf("--previous-host-commit");
const previousHostCommit = previousArgument === -1 ? null : process.argv[previousArgument + 1];
// The commit the previous host was built from cannot be read from the host or from HEAD, so it is an input, and a checked one.
if (!/^[0-9a-f]{40}$/.test(previousHostCommit ?? "")) {
  throw new Error("E_PREVIOUS_HOST_COMMIT: pass --previous-host-commit <40-character sha>, the commit build/gf05-errors-previous-host/fabric_godot.dylib was built from; "
    + "it is not HEAD and the script does not guess it");
}
try {
  git("cat-file", "-e", `${previousHostCommit}^{commit}`);
  git("merge-base", "--is-ancestor", previousHostCommit, "HEAD");
} catch {
  throw new Error(`E_PREVIOUS_HOST_COMMIT: ${previousHostCommit} is not a commit in the history of HEAD`);
}

const expected = await rnExpectations(root);
const failures = report => report.checks.filter(row => !row.passed).map(row => row.name);
const lane = (name, {rejected}) => {
  const report = readJson(`build/js-errors-${name}-report.json`);
  assert.deepEqual(derivedChecks(report, expected), report.checks, `${name}: the oracle derives the verdicts the probe gave`);
  const oracle = rejected ? oracleRejection(report, expected) : null;
  if (rejected) {
    assert.ok(failures(report).length > 0 && oracle !== null, `${name}: the probe and the oracle reject it`);
  } else {
    verifyJsErrorsReport(report, expected);
  }
  return {report, oracle, logSha256: sha(`build/js-errors-${name}.log`)};
};

const current = lane("current", {rejected: false});
const original = lane("original", {rejected: true});
const sabotages = SABOTAGES.map(variant => ({variant, ...lane(`sabotage-${variant.name}`, {rejected: true})}));
const bundleOf = report => report.provenance.bundle;

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
const lanes = [{...current, variant: null}, {...original, variant: null}, ...sabotages];
for (const {report, variant} of lanes) {
  for (const [file, pin] of Object.entries(bundleOf(report).sources)) {
    assert.equal(pinOf(file, variant), pin, `${report.provenance.lane}: ${file} changed after the lane ran; run the lanes again`);
  }
}
const hostSha256 = sha("addons/fabric_godot.dylib");
assert.equal(current.report.provenance.nativeHostSha256, hostSha256, "The current lane ran on the host that is in addons/ now");
const previousHostSha256 = sha("build/gf05-errors-previous-host/fabric_godot.dylib");
assert.equal(original.report.provenance.nativeHostSha256, previousHostSha256, "The control ran on the host that build/gf05-errors-previous-host/ keeps");
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

// What the lanes saw of the tree when they ran. A lane that could not ask git has no state, and a record cannot say the sources were clean then.
const gitOf = ({report}) => {
  const state = report.provenance.git;
  assert.ok(state != null && typeof state.head === "string" && Array.isArray(state.dirtyPaths), `${report.provenance.lane}: the lane recorded no git state; run the lanes again`);
  return state;
};
const executionGit = gitOf(current);
for (const entry of [original, ...sabotages]) {
  assert.equal(gitOf(entry).head, executionGit.head, `${entry.report.provenance.lane} ran on another commit than the current lane; run the lanes again`);
}
for (const {variant, report} of sabotages) {
  if (variant.host === true) {
    assert.ok(gitOf({report}).dirtyPaths.includes(variant.file), `${variant.name} ran with ${variant.file} broken, which git sees`);
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
const caseSummary = name => {
  const record = stages.cases[name];
  return {steps: record.result.steps, wrapperReports: record.result.reports.map(entry => ({message: entry.message, name: entry.name, isFatal: entry.isFatal,
    frames: entry.stack.length})), hostFailures: record.errors.map(text => text.split("\n")[0]),
    consoleLines: record.result.logged, nativeDelta: {moduleSoft: Number(record.after.module.soft) - Number(record.before.module.soft),
      moduleFatal: Number(record.after.module.fatal) - Number(record.before.module.fatal)}};
};

const record = {
  schemaVersion: 1,
  scenario: "js-errors",
  status: "verified-local-headless-previous-host-control-seven-sabotages",
  at: new Date().toISOString(),
  executionBaseCommit: executionGit.head,
  sourceDirtyDuringExecution: executionGit.dirtyPaths.length > 0,
  dirtyPathsDuringExecution: executionGit.dirtyPaths,
  implementationCommit: commit,
  pinning: commit === null
    ? "The lanes ran on the working tree on top of executionBaseCommit, before the implementation commit existed (dirtyPathsDuringExecution lists what differed from it). sourcePins are the SHA-256 of the files they executed; rerun scripts/js-errors-evidence.mjs --commit <sha> to check each against git show <sha>:<path> and record the commit."
    : `Every sourcePins entry equals git show <implementationCommit>:<path>. ${executionGit.dirtyPaths.length > 0 ? "The lanes ran on top of executionBaseCommit with the uncommitted paths of dirtyPathsDuringExecution, so the pins, not the commit the lanes ran on, tie what they executed to the implementation commit." : "The lanes ran on a clean tree at executionBaseCommit."}`,
  environment: {
    godot: current.report.godot, reactNative: current.report.reactNative, node: current.report.provenance.node, platform: "macOS arm64",
    displayServer: current.report.displayServer,
    nativeHostSha256: hostSha256, previousHostSha256,
    previousHost: {
      sourceCommit: previousHostCommit,
      sourceCommitSubject: git("log", "-1", "--format=%s", previousHostCommit),
      nativeTreeAtSourceCommit: git("rev-parse", `${previousHostCommit}:native`),
      sha256: previousHostSha256,
      copy: "build/gf05-errors-previous-host/fabric_godot.dylib (local, not in Git)",
      provenance: "The commit is given by whoever built the host (--previous-host-commit); no build receipt was recorded for the copy. It is a host with the bare failure recording and without RN's error path, taken from addons/ at the start of the slice, when the worktree was clean at that commit, and the js-globals suite passed on it then; the native/ tree of that commit is nativeTreeAtSourceCommit.",
    },
  },
  commands: ["npm run test:js-errors", "node tests/js-errors-native.test.mjs --allow-original-negative (previous host in addons/)",
    "node scripts/js-errors-sabotage.mjs", "node scripts/js-errors-evidence.mjs --previous-host-commit <sha> [--commit <sha>]"],
  currentLane: {
    ...summary(current),
    result: `JS_ERRORS_PASSED: ${current.report.checks.length}`,
    checkVerdicts: current.report.checks,
    bundleInputs: {count: inputs.length, injectedFirst: inputs.slice(0, 3),
      bootstrapPositions: Object.fromEntries(["src/initialize.js", ...Object.keys(bundleOf(current.report).originalReactNativeSources)
        .filter(file => /^(?:Libraries\/Core\/(?:setUpErrorHandling|ExceptionsManager|NativeExceptionsManager)|Libraries\/vendor\/core\/ErrorUtils)/.test(file))
        .map(file => "node_modules/react-native/" + file)].filter(file => inputs.includes(file)).map(file => [file, inputs.indexOf(file)]))},
    originalReactNativeSources: bundleOf(current.report).originalReactNativeSources,
    hostGlobals: stages.host.globals,
    errorUtils: {members: stages.environment.errorUtils.names, handler: stages.environment.handler, console: stages.environment.console},
    readyLane: Object.fromEntries(["console-string", "console-error", "console-multi", "console-warning", "report-error", "report-error-string", "guard",
      "fatal-error", "fatal-string", "deprecated-soft", "direct"].map(name => [name, caseSummary(name)])),
    schedulerTask: {wrapperReports: stages.cases["scheduler-task"].result.reports.map(entry => ({message: entry.message, isFatal: entry.isFatal, frames: entry.stack.length})),
      hostFailures: stages.cases["scheduler-task"].errors.map(text => text.split("\n")[0])},
    hostCounters: {ready: stages.settled.jsErrors, early: stages.early_settled.jsErrors, escape: stages.escape.application.jsErrors},
    hostFailureLines: [...stages.settled.errors, ...stages.early_settled.errors, ...stages.escape.application.errors].map(text => text.split("\n")[0]),
    earlyLane: {listenerSaw: stages.early_lane.cases.map(entry => ({name: entry.name, seen: entry.seen, consoleLines: entry.logged})),
      lateCall: stages.early_late.result.steps},
    escapeLane: {surfaceId: stages.escape.surfaceId, bundleEvaluations: stages.escape.application.bundleEvaluations, stopped: stages.escape.application.stopped},
  },
  previousHostControl: {
    ...summary(original),
    sameBundleAsCurrent: true,
    result: `JS_ERRORS_ORIGINAL_NEGATIVE: ${failures(original.report).length}`,
    expectedOriginalFailures: original.report.expectedOriginalFailures,
    hostGlobals: original.report.stages.host.globals,
    nativeModuleLoaded: original.report.stages.environment.native.loaded,
    note: "The same bundle runs on the host that recorded an error where it caught it and had no ErrorUtils path: it fails exactly the checks that need the new host, and holds the nine that need only the JS RN runs. Its native producers are pinned for the tree; the old binary was built from environment.previousHost.sourceCommit, not from executionBaseCommit.",
  },
  retainedSabotage: {
    script: "scripts/js-errors-sabotage.mjs",
    table: "tests/js-errors-sabotages.mjs",
    mechanism: "no-error-guard and no-setup are in-memory esbuild overrides (scripts/js-errors-bundle.mjs), no file is edited; the five sabotages of the host break one line of native/application_runtime.cpp, rebuild the host, keep it in the variant's hostDirectory and restore the source byte for byte (scripts/sabotage-sources.mjs)",
    variants: sabotages.map(({variant, report, oracle, logSha256}) => ({name: variant.name, host: variant.host === true, file: variant.file, find: variant.find,
      replace: variant.replace, ...summary({report, oracle, logSha256})})),
  },
  oracle: {
    file: "tests/js-errors-oracle.mjs",
    independence: "Written from RN's pinned sources, not from the probe: the members of ErrorUtils, the handler setUpErrorHandling registers, the error family ReactInstance defines with its arities and refusals, the flag default and the not-ready prefix are read from the files; RN's own error-guard, setUpErrorHandling, ExceptionsManager and NativeExceptionsManager are bundled by the same toolchain and run in V8 against a native module that records its calls, and what Hermes did with the same cases must be what V8 did; JsErrorHandler's pipeline before the runtime is ready is a model written from JsErrorHandler.cpp, whose anchors it finds in the source; every verdict of the probe is derived again from the report's raw observations.",
    fromRn: {errorUtilsMembers: expected.errorUtilsMembers, handlerName: expected.handler.name, handlerArity: expected.handler.arity,
      reporter: expected.reporter, consoleOriginal: expected.original, errorFamily: expected.family, installedArities: expected.installed,
      refusals: expected.refusals, flagDefault: expected.flag, notReadyPrefix: expected.prefix, schedulerWrap: expected.schedulerWrap,
      runtimeExecutorWrap: expected.executorWrap,
      earlyModel: expected.early},
    referenceRun: Object.fromEntries(Object.entries(expected.reference.cases).map(([name, entry]) => [name, {reports: entry.reports, console: entry.logged,
      softReports: entry.softCount, fatalReports: entry.fatalCount}])),
  },
  catchSites: [
    {site: "RuntimeScheduler task error handler", reactInstance: "ReactInstance.cpp:128-131 (handleError(runtime, error, true))",
      before: "fail(error.what())", now: "JsErrorPath::handle_fatal -> JsErrorHandler::handleError, fatal. RN's own scheduler wraps what Hermes throws as 'Non-js exception: <what>' (RuntimeScheduler_Modern.cpp:402; ReactInstance's runtime executor spells its wrap 'Non-JS exception: ', ReactInstance.cpp:107, and that is the spelling of the host's own catches).",
      certifiedBy: "fatal/An exception that escapes a task of RN's RuntimeScheduler ..."},
    {site: "pump(): the work queue (the host's runtime executor)", reactInstance: "ReactInstance.cpp:92-109 (the runtime executor's catch)",
      before: "fail(error.what())", now: "JsErrorPath::handle_fatal; a Hermes JSError is recognised by its type name and reported as the JS error it is",
      certifiedBy: "none by a case of its own: native errors thrown by a work item are not reachable from JS; the scheduler site above is the one a JS error takes"},
    {site: "ApplicationRuntime::load_bundle / FabricApplication::mount", reactInstance: "ReactInstance::loadScript, then the runtime executor's catch; setRuntimeReady after the evaluation (ReactInstance.cpp:287-299)",
      before: "mount's catch: report_error(error.what()), then stop", now: "load_bundle: handle_fatal while the runtime is not ready, bundle_evaluated() after a clean evaluation; mount stops the application without reporting twice",
      certifiedBy: "escape/ and early/ checks"},
    {site: "TimerManager's runtime executor (timers, immediates)", reactInstance: "the runtime executor's catch (ReactInstance.cpp:92-109)",
      before: "fail(error.what())", now: "unchanged: slice F certifies callback exceptions against RN", certifiedBy: "test:runtime (callback failures), unchanged"},
    {site: "requestAnimationFrame callbacks, native animated and layout animation frames", reactInstance: "none: ReactInstance has no frame loop",
      before: "fail(error.what())", now: "unchanged", certifiedBy: "test:runtime, test:animated, test:layout-animation, unchanged"},
    {site: "FabricApplication.evaluate (the validation seam)", reactInstance: "none", before: "fail(error.what())", now: "unchanged", certifiedBy: "not RN's"},
  ],
  sourcePins: pins,
  scope: {actualHermesRuntime: true, actualFabricApplication: true, headless: true, lanes: ["ready", "early", "escape"],
    rnModules: ["error-guard", "setUpErrorHandling", "ExceptionsManager", "NativeExceptionsManager"], jsErrorHandler: true},
  limits: ["The timer, immediate, microtask and animation-frame catch sites keep the host's direct failure record; slice F measures callback exceptions against RN.",
    "RN$hasHandledFatalException and RN$notifyOfFatalException are not installed: excluded by V2-D26 (the runtime keeps running after an uncaught error, with root-scoped recovery); with them ExceptionsManager.js reports only the first fatal exception. GF-07's error-cleanup slice owns any change.",
    "Hermes' JSError and the host's have different type_info, so RN's own catch (jsi::JSError &) in JsErrorHandler and RuntimeScheduler does not match what Hermes throws: the scheduler reports 'Non-js exception: <what>', and an error raised while JsErrorHandler reports (a listener that throws) reaches the host's safety net instead of the next listener.",
    "A soft exception is a log line, as on Android; iOS drops it without a redbox or a delegate. A fatal exception is a recorded failure and the application keeps running, where RN's release builds crash.",
    "V2-D26's root-scoped unmount on an uncaught error belongs to GF-07's error-cleanup slice.",
    "The headless desktop host only; no mobile export has run this bundle.",
    "The lanes of this record are local. Hosted run 38481790977 (https://github.com/journey-studios/godot-fabric/actions/runs/38481790977), on head 26a3a908 (the slice before the review fixes), passed every job, native-suites-runtime with test:js-errors among them. The branch's later commits changed the evidence script, the oracle, the lane runner's provenance record, a named constant in native/js_error_path.cpp (the host built from it is byte-identical to the one built before it) and docs, so that run did not execute these exact bytes."],
};
writeFileSync(path.join(root, "docs/evidence/runtime/js-errors.json"), JSON.stringify(record, null, 2) + "\n");
console.log(`JS_ERRORS_EVIDENCE_WRITTEN: ${current.report.checks.length} checks, ${original.report.checks.length - failures(original.report).length} held on the previous host, ${sabotages.length} sabotages`);
