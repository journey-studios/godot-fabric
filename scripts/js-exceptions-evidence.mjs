import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES} from "../tests/js-exceptions-sabotages.mjs";
import {exceptionsDerivedChecks, exceptionsExpectations, exceptionsOracleRejection, verifyJsExceptionsReport} from "../tests/js-exceptions-oracle.mjs";

// Writes docs/evidence/runtime/js-exceptions.json, the committed record of the callback exceptions slice's executed lanes, from the reports that the lanes left in
// build/ (which Git does not keep). It re-judges every report before it writes anything:
//
//   - the current lane's report passes the independent oracle, and every other lane's report is rejected by it with the verdicts the probe gave;
//   - every lane bundled the sources that are on disk now, and the current lane ran on the host that is in addons/ now, so the record is of this tree and not of an
//     earlier one; the previous host's lane ran on the host that build/gf05-exceptions-previous-host/ keeps.
//
// The lanes run before it: `node tests/js-exceptions-native.test.mjs --allow-original-negative` with the previous host in addons/ (the current host put back after),
// `node scripts/js-exceptions-sabotage.mjs` (the sabotages, then the current lane). With --commit <sha> it also checks every pin of a repository file against
// `git show <sha>:<path>` and records the commit, which is how the pins are tied to the implementation commit once it exists.
//
// Two commits are recorded and neither is derived from the HEAD of the moment the record is written:
//   - executionBaseCommit and sourceDirtyDuringExecution are what each lane saw when it ran (tests/js-exceptions-native.test.mjs records the commit it stood on and every
//     path that differed from it in the report's provenance). The lanes must agree on the commit; the record is dirty when the current lane ran with any uncommitted path,
//     whether or not --commit is given: --commit ties the executed sources to a commit, it does not say they were committed when they ran.
//   - previousHost.sourceCommit is the commit the previous host's binary was built from, which only the person who built it knows. It is required:
//     --previous-host-commit <sha>, a commit in the history of HEAD. A missing or unknown one is an error, never a guess.
// Run with:
//   node scripts/js-exceptions-evidence.mjs --previous-host-commit <sha> [--commit <sha>]
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
  throw new Error("E_PREVIOUS_HOST_COMMIT: pass --previous-host-commit <40-character sha>, the commit build/gf05-exceptions-previous-host/fabric_godot.dylib was built from; "
    + "it is not HEAD and the script does not guess it");
}
try {
  git("cat-file", "-e", `${previousHostCommit}^{commit}`);
  git("merge-base", "--is-ancestor", previousHostCommit, "HEAD");
} catch {
  throw new Error(`E_PREVIOUS_HOST_COMMIT: ${previousHostCommit} is not a commit in the history of HEAD`);
}

const expected = await exceptionsExpectations(root);
const failures = report => report.checks.filter(row => !row.passed).map(row => row.name);
const lane = (name, {rejected}) => {
  const report = readJson(`build/js-exceptions-${name}-report.json`);
  assert.deepEqual(exceptionsDerivedChecks(report, expected), report.checks, `${name}: the oracle derives the verdicts the probe gave`);
  const oracle = rejected ? exceptionsOracleRejection(report, expected) : null;
  if (rejected) {
    assert.ok(failures(report).length > 0 && oracle !== null, `${name}: the probe and the oracle reject it`);
  } else {
    verifyJsExceptionsReport(report, expected);
  }
  return {report, oracle, logSha256: sha(`build/js-exceptions-${name}.log`)};
};

const current = lane("current", {rejected: false});
const original = lane("original", {rejected: true});
const sabotages = SABOTAGES.map(variant => ({variant, ...lane(`sabotage-${variant.name}`, {rejected: true})}));
const bundleOf = report => report.provenance.bundle;

// The record is of this tree: every lane bundled the files that are on disk now (the previous host's lane and the sabotages of the host differ from the current one only in
// the compiled native producers, which are pinned for the tree and not for the old binary), and the current lane ran on today's host. A sabotage of the host ran with its one
// source broken: the pin of that file is the hash of the genuine text with the sabotage's replacement made, which is proof of what the lane executed.
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
const previousHostSha256 = sha("build/gf05-exceptions-previous-host/fabric_godot.dylib");
assert.equal(original.report.provenance.nativeHostSha256, previousHostSha256, "The control ran on the host that build/gf05-exceptions-previous-host/ keeps");
assert.notEqual(previousHostSha256, hostSha256, "The control ran on another host");
assert.equal(bundleOf(original.report).bundle.sha256, bundleOf(current.report).bundle.sha256, "The previous host ran the same bundle");
for (const {variant, report} of sabotages) {
  assert.equal(bundleOf(report).bundle.sha256, bundleOf(current.report).bundle.sha256, `${variant.name} runs the current bundle`);
  assert.equal(report.provenance.nativeHostSha256, sha(`${variant.hostDirectory}/fabric_godot.dylib`), `${variant.name} ran on the host it kept`);
  assert.notEqual(report.provenance.nativeHostSha256, hostSha256);
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
  assert.ok(gitOf({report}).dirtyPaths.includes(variant.file), `${variant.name} ran with ${variant.file} broken, which git sees`);
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

// A citation of a pinned RN file (or of the host's), as file:line, found by its text so that it cannot drift from the source it names.
const cite = (file, snippet, occurrence = 1) => {
  const real = file.startsWith("native/") ? file : `node_modules/react-native/${file}`;
  const lines = readFileSync(path.join(root, real), "utf8").split("\n");
  const hits = lines.flatMap((line, index) => (line.includes(snippet) ? [index + 1] : []));
  assert.ok(hits.length >= occurrence, `${file} no longer says ${snippet}`);
  return `${file}:${hits[occurrence - 1]}`;
};
const RS = "ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp";
const TM = "ReactCommon/react/runtime/TimerManager.cpp";
const RI = "ReactCommon/react/runtime/ReactInstance.cpp";
const HOST = "native/application_runtime.cpp";

// A case, summarized: what ran in which order, what the host recorded for it, and what it counted.
const caseSummary = name => {
  const record = stages.cases[name];
  const errors = record.errors.map(text => text.split("\n")[0]);
  return {journal: record.record.journal.map(entry => (Object.keys(entry.chains).length === 0 ? entry.label : `${entry.label} ${JSON.stringify(entry.chains)}`)),
    failureCount: errors.length, failures: errors.length > 12 ? {first: errors.slice(0, 2), around: errors.slice(253, 258), last: errors.slice(-1)} : errors,
    moduleFatal: Number(record.after.module.fatal) - Number(record.before.module.fatal), moduleSoft: Number(record.after.module.soft) - Number(record.before.module.soft),
    handlerReports: Number(record.after.handler.fatal) - Number(record.before.handler.fatal) + Number(record.after.handler.soft) - Number(record.before.handler.soft),
    consoleLines: record.logged.length};
};
const wedgeStages = stages.wedge;

const record = {
  schemaVersion: 1,
  scenario: "js-exceptions",
  status: "verified-local-headless-previous-host-control-five-sabotages",
  at: new Date().toISOString(),
  executionBaseCommit: executionGit.head,
  sourceDirtyDuringExecution: executionGit.dirtyPaths.length > 0,
  dirtyPathsDuringExecution: executionGit.dirtyPaths,
  implementationCommit: commit,
  pinning: commit === null
    ? "The lanes ran on the working tree on top of executionBaseCommit, before the implementation commit existed (dirtyPathsDuringExecution lists what differed from it). sourcePins are the SHA-256 of the files they executed; rerun scripts/js-exceptions-evidence.mjs --commit <sha> to check each against git show <sha>:<path> and record the commit."
    : `Every sourcePins entry equals git show <implementationCommit>:<path>. ${executionGit.dirtyPaths.length > 0 ? "The lanes ran on top of executionBaseCommit with the uncommitted paths of dirtyPathsDuringExecution, so the pins, not the commit the lanes ran on, tie what they executed to the implementation commit." : "The lanes ran on a clean tree at executionBaseCommit."}`,
  environment: {
    godot: current.report.godot, reactNative: current.report.reactNative, node: current.report.provenance.node, platform: "macOS arm64", displayServer: current.report.displayServer,
    nativeHostSha256: hostSha256, previousHostSha256,
    previousHost: {
      sourceCommit: previousHostCommit,
      sourceCommitSubject: git("log", "-1", "--format=%s", previousHostCommit),
      nativeTreeAtSourceCommit: git("rev-parse", `${previousHostCommit}:native`),
      sha256: previousHostSha256,
      copy: "build/gf05-exceptions-previous-host/fabric_godot.dylib (local, not in Git)",
      provenance: "The commit is given by whoever built the host (--previous-host-commit); no build receipt was recorded for the copy. It is the host of the web globals slice's tip, taken from addons/ before this slice changed any native file, after a build from those sources reported nothing to do; the native/ tree of that commit is nativeTreeAtSourceCommit.",
    },
  },
  commands: ["npm run test:js-exceptions", "node tests/js-exceptions-native.test.mjs --allow-original-negative (previous host in addons/)",
    "node scripts/js-exceptions-sabotage.mjs", "node scripts/js-exceptions-evidence.mjs --previous-host-commit <sha> [--commit <sha>]"],
  currentLane: {
    ...summary(current),
    result: `JS_EXCEPTIONS_PASSED: ${current.report.checks.length}`,
    checkVerdicts: current.report.checks,
    bundleInputs: {count: inputs.length, injectedFirst: inputs.slice(0, 3)},
    originalReactNativeSources: bundleOf(current.report).originalReactNativeSources,
    environment: stages.environment.host,
    cases: Object.fromEntries(Object.keys(stages.cases).map(name => [name, caseSummary(name)])),
    wedgeLane: {retryBoundPress: caseSummary("retry-bound-press"), secondPress: {presses: wedgeStages["press-after"].state.presses, entered: wedgeStages["press-after"].record.entered,
      done: wedgeStages["press-after"].record.done, waitedFrames: wedgeStages["press-after"].waitedFrames}, stopped: stages.wedge_stop.application.stopped},
    rejectionTrackerControl: stages.tracked,
    hostFailureLines: [...stages.stop.application.errors, ...stages.wedge_stop.application.errors].length,
    hostCounters: {main: stages.stop.application.jsErrors, wedge: stages.wedge_stop.application.jsErrors},
  },
  previousHostControl: {
    ...summary(original),
    sameBundleAsCurrent: true,
    result: `JS_EXCEPTIONS_ORIGINAL_NEGATIVE: ${failures(original.report).length}`,
    expectedOriginalFailures: original.report.expectedOriginalFailures,
    note: "The same bundle runs on the host that recorded a callback's exception where it caught it (error.what(), without RN's message and stack) and drained the microtasks with a single call: it fails exactly the checks that need the new routing, and holds the rest (the scheduler's own routes, the Promise reactions, the storm, the bound reached by RN's own checkpoint up to the format of the rest of the chain). Its native producers are pinned for the tree; the old binary was built from environment.previousHost.sourceCommit, not from executionBaseCommit.",
  },
  retainedSabotage: {
    script: "scripts/js-exceptions-sabotage.mjs",
    table: "tests/js-exceptions-sabotages.mjs",
    mechanism: "every sabotage breaks one line of native/application_runtime.cpp, rebuilds the host, keeps it in the variant's hostDirectory and restores the source byte for byte (scripts/sabotage-sources.mjs)",
    variants: sabotages.map(({variant, report, oracle, logSha256}) => ({name: variant.name, file: variant.file, find: variant.find, replace: variant.replace,
      ...summary({report, oracle, logSha256})})),
  },
  oracle: {
    file: "tests/js-exceptions-oracle.mjs",
    independence: "Written from RN's pinned sources, not from the probe: the constants and the loop of performMicrotaskCheckpoint, the task error handler and the runtime executor's catch, TimerManager's missing catch and the executor it runs on, immediateShim, NativeMicrotasks, NativeIdleCallbacks, the renderer's rethrow after the listeners, the files that can enable Hermes' rejection tracker and the iOS frame paths are read from the files; the host's checkpoint is compared with RN's loop token by token; each case is run through a model of the host's event loop (RN's RuntimeScheduler rules, V8's microtask queue) and the chains are counted from the bound RN's source states; every verdict of the probe is derived again from the report's raw observations.",
    fromRn: {retryBound: expected.facts.checkpoint.bound, retryCounterType: expected.facts.checkpoint.retriesType, boundMessage: expected.facts.checkpoint.boundMessage,
      schedulerWrap: expected.facts.checkpoint.wrap, runtimeExecutorWrap: expected.facts.instance.wrap, queueClearingOnErrorDefault: expected.facts.checkpoint.clearsQueues,
      loopShape: expected.facts.checkpoint.loopShape, trackerMentions: expected.facts.tracker.mentions},
    modelJournals: expected.journals,
    modelFatalErrors: expected.fatal,
    modelRetryBlocks: Object.fromEntries(Object.entries(expected.retry).map(([name, retry]) => [name, {blocks: retry.blocks, boundaries: retry.boundaries, wedges: retry.wedges}])),
  },
  // The rows of the table of the README's section "Callback exceptions and starvation (slice F)": per kind of callback, who calls it in RN bridgeless, where its exception
  // goes, whether the rest of the queue runs, and what the host did before this slice and does now. Each citation is found in the pinned file by its text.
  rnBehaviour: [
    {kind: "setTimeout", caller: [cite(TM, "void TimerManager::callTimer"), cite(TM, "timerCallback.invoke(runtime);"), `${cite(RI, "bufferedRuntimeExecutor_ = std::make_shared")} (the buffered executor)`,
      cite("ReactCommon/react/runtime/platform/ios/ReactCommon/RCTInstance.mm", "timerManager->setRuntimeExecutor(bufferedRuntimeExecutor);"),
      cite("ReactAndroid/src/main/jni/react/runtime/jni/JReactInstance.cpp", "timerManager->setRuntimeExecutor(bufferedRuntimeExecutor);"), cite(RS, "scheduleTask(SchedulerPriority::ImmediatePriority")],
    exception: `not caught by TimerManager; leaves an Immediate task of the RuntimeScheduler: executeTask (${cite(RS, "} catch (jsi::JSError& error) {")}) -> handleTaskError (${cite(RS, "void RuntimeScheduler_Modern::handleTaskError")}) -> the task error handler, JsErrorHandler::handleError(..., true) (${cite(RI, "jsErrorHandler->handleError(runtime, error, true);")}): FATAL`,
    restOfQueue: `yes: every other timer is a task of its own, and the queue is not cleared (${cite("ReactCommon/react/featureflags/ReactNativeFeatureFlagsDefaults.h", "bool enableRuntimeSchedulerQueueClearingOnError")} is false); a one-shot timer keeps its TimerManager entry (${cite(TM, "timers_.erase(timerHandle);", 3)} is skipped)`,
    hostBefore: "catch in the timer's work item: fail(error.what())", hostNow: "JsErrorPath::handle_fatal (a fatal error; the other timers still run)"},
    {kind: "setInterval", caller: [cite(TM, "createRecurringTimer(", 3)], exception: "as setTimeout", restOfQueue: "yes; the recurring timer is not erased, so the next tick runs",
      hostBefore: "as setTimeout", hostNow: "as setTimeout; the interval keeps ticking"},
    {kind: "requestAnimationFrame", caller: [`${cite(TM, '"requestAnimationFrame",')} (a timer with a zero delay: ${cite(TM, "TimerSource::RequestAnimationFrame);")})`],
      exception: "as setTimeout: FATAL through the task error handler (ReactInstance has no frame loop)", restOfQueue: "yes: another callback is another timer",
      hostBefore: "catch around the frame callback: fail(error.what())", hostNow: "JsErrorPath::handle_fatal; the other callbacks of the tick still run"},
    {kind: "setImmediate (immediateShim)", caller: [`${cite("Libraries/Core/Timers/immediateShim.js", "global.queueMicrotask(() => {")} (one queueMicrotask per call; there is no batch loop)`],
      exception: "as queueMicrotask", restOfQueue: "yes: every immediate is a microtask of its own, and the checkpoint carries on after a throw",
      hostBefore: "the throw left drainMicrotasks() into pump()'s outer catch: fail(error.what()), the rest of that pump skipped", hostNow: "the checkpoint below"},
    {kind: "queueMicrotask", caller: [cite("ReactCommon/react/nativemodule/microtasks/NativeMicrotasks.cpp", "runtime.queueMicrotask(callback);"),
      `${cite(RS, "void RuntimeScheduler_Modern::performMicrotaskCheckpoint")} (after each task: ${cite(RS, "performMicrotaskCheckpoint(runtime);")})`],
    exception: `drainMicrotasks throws and discards the job (${cite("ReactCommon/jsi/jsi/jsi.h", "When there were exceptions thrown from the execution of microtasks")}); the checkpoint hands the error to handleTaskError (FATAL) and drains again (${cite(RS, "runtime.drainMicrotasks()")}); after ${expected.facts.checkpoint.bound} failures (${cite(RS, "kRetriesBound = 255")}) it throws std::runtime_error("${expected.facts.checkpoint.boundMessage}") (${cite(RS, "Hits microtasks retries bound")}), which leaves runEventLoopTick for the runtime executor's catch (${cite(RI, "} catch (jsi::JSError& originalError) {")}): FATAL, wrapped "${expected.facts.instance.wrap}"`,
    restOfQueue: "yes: the next drain runs the jobs behind the one that threw, up to the bound; the rest of the chain runs in the next checkpoint",
    hostBefore: "a throw left drainMicrotasks() into pump()'s outer catch (fail(error.what()), rest of the pump skipped); stop() drained once", hostNow: "perform_microtask_checkpoint: the same loop, constants and report, at the head of the pump, after each frame callback, after each work item, at its end and at the head of stop()"},
    {kind: "Promise reaction (then, catch) and unhandled rejection", caller: ["Hermes' own microtask queue (the same queue as queueMicrotask's)"],
      exception: `a reaction that throws rejects the promise it returned; Promise jobs never propagate to the host (${cite("ReactCommon/jsi/jsi/jsi.h", "Exceptions from ECMA-262 Promise Jobs")}). An unhandled rejection is not tracked in a release build: ${cite("Libraries/Core/polyfillPromise.js", "enablePromiseRejectionTracker")} runs under __DEV__ only (${cite("Libraries/Core/polyfillPromise.js", "if (__DEV__) {")}), setUpErrorHandling does not enable it (${cite("Libraries/Core/setUpErrorHandling.js", "ExceptionsManager.installConsoleErrorReporter();")} is all it installs for errors), and in a development bundle the options report it as a SOFT error (${cite("Libraries/promiseRejectionTrackingOptions.js", "ExceptionsManager.handleException(")}): swallowed`,
      restOfQueue: "yes", hostBefore: "same (the engine's)", hostNow: "same; certified: nothing reported, logged or recorded"},
    {kind: "requestIdleCallback", caller: [cite("ReactCommon/react/nativemodule/idlecallbacks/NativeIdleCallbacks.cpp", "userCallbackShared->call(std::move(idleDeadline));"), `${cite(RS, "void RuntimeScheduler_Modern::executeTask")} (an Idle-priority task)`],
      exception: "propagates out of the task: executeTask -> handleTaskError -> the task error handler: FATAL (wrapped 'Non-js exception: ' by the host's linkage, slice C's finding)",
      restOfQueue: "yes: the queue is not cleared on an error", hostBefore: "unchanged (slice C routed the scheduler's handler)", hostNow: "unchanged; certified"},
    {kind: "event handler (dispatchEvent)", caller: [cite("ReactCommon/react/renderer/uimanager/UIManagerBinding.cpp", "eventHandler_->call("), cite("ReactCommon/react/renderer/core/EventBeat.cpp", "runtimeScheduler_.scheduleWork(std::move(beat));"),
      `${cite("Libraries/Renderer/implementations/ReactFabric-prod.js", "function executeDispatch(event, listener, inst) {")} (keeps the first exception and rethrows it after every listener: ${cite("Libraries/Renderer/implementations/ReactFabric-prod.js", "if (hasError)")})`],
    exception: "escapes UIManagerBinding and EventQueueProcessor (neither catches) out of the event beat's Immediate task: executeTask -> handleTaskError: FATAL",
    restOfQueue: `yes for the scheduler's tasks; the events behind it in that flush are not dispatched (${cite("ReactCommon/react/renderer/core/EventQueueProcessor.cpp", "for (const auto& event : events) {", 3)} has no catch; read, not exercised)`,
    hostBefore: "unchanged (slice C)", hostNow: "unchanged; certified"},
  ],
  catchSites: [
    {site: "TimerManager's runtime executor (timers, immediates)", rn: "a task of the RuntimeScheduler: executeTask's catch", before: "fail(error.what())",
      now: `JsErrorPath::handle_fatal (${cite(HOST, "js_errors->handle_fatal(rt, error); }", 2)})`, certifiedBy: "timeout/ and interval/ checks, previous-host control and the timer-site and drop-remaining sabotages"},
    {site: "requestAnimationFrame callbacks", rn: "a TimerManager timer, so the same", before: "fail(error.what())", now: "JsErrorPath::handle_fatal", certifiedBy: "raf/ checks"},
    {site: "the host's microtask drains (head of the pump, after each frame callback, after each work item, end of the pump, head of stop())", rn: `performMicrotaskCheckpoint (${cite(RS, "void RuntimeScheduler_Modern::performMicrotaskCheckpoint")})`,
      before: "runtime->drainMicrotasks(), once, uncaught in the pump (the pump's outer catch recorded error.what() and skipped the rest of it) and caught once at stop()",
      now: `${cite(HOST, "void perform_microtask_checkpoint()")}: RN's loop, with its constants and its report; ${cite(HOST, "void microtask_checkpoint()")} reports the bound as the runtime executor's catch does`,
      certifiedBy: "microtask-*, retry-bound-*, storm-* and stop/ checks and the no-retry-bound and no-resume sabotages"},
    {site: "Native Animated frame, LayoutAnimation tick", rn: "none: iOS drives them from a CADisplayLink and a run loop observer (RCTScheduler.mm), Android through JNI calls from its frame callbacks (FabricUIManagerBinding.cpp), and no C++ on either path catches: the exception is not handed to JsErrorHandler, it is uncaught",
      before: "fail(error.what())", now: "unchanged: a recorded failure with the exception's text, this host's continuation of RN's fatal (V2-D26). No JS runs inside them; their JS callbacks go through the runtime executor, which the work queue's catch handles",
      certifiedBy: "not exercised (no JS reaches them); the oracle reads RN's frame paths"},
    {site: "FabricApplication.evaluate (the validation seam)", rn: "none: a host API", before: "fail(error.what())", now: "unchanged", certifiedBy: "not RN's"},
  ],
  sourcePins: pins,
  scope: {actualHermesRuntime: true, actualFabricApplication: true, headless: true, realEventPath: true, applications: ["main", "wedge"]},
  limits: ["The catches of the Native Animated frame and of the LayoutAnimation tick keep a recorded failure: RN does not catch there either, and no JS callback runs inside them, so no case reaches them.",
    "The bound that RN's own checkpoint (after a task of its RuntimeScheduler) throws leaves the scheduler with a task queued and no loop scheduled, so the application that reaches it takes no further scheduler task (events, idle callbacks, React's own tasks); RN ends the process on that fatal error. The host's timers, frame callbacks and checkpoints keep running. GF-07's error cleanup owns any change.",
    "RN's own scheduler wraps what Hermes throws as 'Non-js exception: <what>' (the two jsi::JSError classes differ), so an idle callback, an event handler and a microtask at RN's own checkpoint are reported with that text, where a timer, a frame callback and a microtask at the host's checkpoints are reported as the JS error they are.",
    "The model of the event loop derives the order of the cases; the retry-bound and storm cases are judged by the boundaries between checkpoints, not by the position of a timer or a frame callback inside them, which depends on how many drains the host performs in a pump.",
    "The headless desktop host only; no mobile export has run this bundle.",
    "Hosted CI is pending: the record is of the local run."],
};
writeFileSync(path.join(root, "docs/evidence/runtime/js-exceptions.json"), JSON.stringify(record, null, 2) + "\n");
console.log(`JS_EXCEPTIONS_EVIDENCE_WRITTEN: ${current.report.checks.length} checks, ${original.report.checks.length - failures(original.report).length} held on the previous host, ${sabotages.length} sabotages`);
