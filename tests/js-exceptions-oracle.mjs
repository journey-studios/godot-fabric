import assert from "node:assert/strict";
import {readdirSync, readFileSync, statSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {isDeepStrictEqual} from "node:util";
import vm from "node:vm";
import {build} from "esbuild";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";
import {metroPolyfills} from "../sdk/toolchain/metro-polyfills.mjs";
import {godotExtensions} from "../sdk/toolchain/platform-resolution.mjs";
import {callbackOf, cases, laneOf, messageOf, stopTurn, total} from "./js-exceptions-cases.mjs";
import {cppFunction, found, immediateShimBundle, schedulerFacts} from "./react-microtasks-oracle.mjs";

// The independent oracle of the callback exceptions slice (GF-05 slice F). It is written from RN, not from the probe, in three ways:
//   - the facts RN's sources state are read out of the pinned files: who runs each kind of callback and where its exception goes (TimerManager has no catch and runs on
//     the buffered runtime executor, which schedules work for the RuntimeScheduler; executeTask and performMicrotaskCheckpoint hand an exception to the task error handler,
//     which ReactInstance makes a fatal error for JsErrorHandler; the runtime executor's catch does the same), the loop and the constants of performMicrotaskCheckpoint
//     (kRetriesBound, its message, what it counts), the flag that would clear the scheduler's queues, what immediateShim, NativeMicrotasks and NativeIdleCallbacks do with a
//     callback, how the event system rethrows a handler's exception, and which RN files can enable Hermes' rejection tracker;
//   - the host's own sources are read the same way: its checkpoint is RN's loop (the same tokens, the same constants), every drain of its pump and of its stop goes through it,
//     and each catch site routes as the section "Callback exceptions and starvation (slice F)" of docs/evidence/runtime/README.md says;
//   - what each case comes out as is derived by running it through a model of the host's event loop, in which the scheduler is RN's (a queue of tasks, the loop that is
//     scheduled once, a checkpoint after each task, the executed task that stays queued until the next selection) and the microtask queue is V8's own (Promise reactions,
//     queueMicrotask and RN's immediateShim run in a vm context). The chains are counted from the constants RN's source states: a checkpoint is cut after kRetriesBound
//     failures, and a chain that does not throw is not bounded at all.
// The report's raw observations are judged against that, and every verdict the probe gave is derived again here and must agree.

const same = isDeepStrictEqual;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const requireSdk = createRequire(path.join(root, "package.json"));
const sorted = values => [...values].sort();
const squash = text => text.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").replace(/ \./g, ".").trim();
const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
// C++ or JS without its comments, on one line.
const code = text => squash(strip(text));
const has = (text, part, what) => {
  assert.ok(text.includes(part), `RN's sources no longer say ${what}`);
  return true;
};

// The tokens of a checkpoint loop that matter, in order: RN's and the host's must be the same sequence (RN's two catch clauses, which only differ in what they wrap, are one).
function loopShape(text) {
  const tokens = [...text.matchAll(/while \(retries < kRetriesBound\)|\btry\b|drainMicrotasks\(\)|\bbreak;|\bcatch\b|\bhandle_?(?:[Tt]ask)?_?[Ee]rror\b|\bretries\+\+;|if \(retries == kRetriesBound\)|throw std::runtime_error\("[^"]*"\)/g)]
    .map(match => match[0].replace(/^handle.*$/, "handle").replace(/^throw std::runtime_error.*$/, "throw"));
  return tokens.join(" ").replace(/\bcatch handle catch handle\b/g, "catch handle");
}

// RuntimeScheduler_Modern.cpp: the checkpoint, the task error handler, and what the loop does when an exception leaves it.
function checkpointFacts(rn) {
  const modern = rn("ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp");
  const defaults = rn("ReactCommon/react/featureflags/ReactNativeFeatureFlagsDefaults.h");
  const checkpoint = code(cppFunction(modern, "void RuntimeScheduler_Modern::performMicrotaskCheckpoint("));
  const execute = code(cppFunction(modern, "void RuntimeScheduler_Modern::executeTask("));
  const handle = code(cppFunction(modern, "void RuntimeScheduler_Modern::handleTaskError("));
  const loop = code(cppFunction(modern, "void RuntimeScheduler_Modern::runEventLoop("));
  const tick = code(cppFunction(modern, "void RuntimeScheduler_Modern::runEventLoopTick("));
  const select = code(cppFunction(modern, "std::shared_ptr<Task> RuntimeScheduler_Modern::selectTask()"));
  const schedule = code(cppFunction(modern, "void RuntimeScheduler_Modern::scheduleTask(std::shared_ptr<Task> task)"));
  const task = code(cppFunction(rn("ReactCommon/react/renderer/runtimescheduler/Task.cpp"), "jsi::Value Task::execute("));
  const clearsQueues = found(defaults, /bool enableRuntimeSchedulerQueueClearingOnError\(\) override \{\s*return (true|false);/, "the default of the flag that clears the scheduler's queues on an error") === "true";
  return {
    bound: Number(found(checkpoint, /const static unsigned int kRetriesBound = (\d+);/, "the checkpoint's retry bound")),
    retriesType: found(checkpoint, /(\w+) retries = 0;/, "the type of the checkpoint's retry counter"),
    boundMessage: found(checkpoint, /throw std::runtime_error\("([^"]*)"\);/, "the message the checkpoint throws at its bound"),
    wrap: found(execute, /std::string\("(Non-js exception: )"\) \+ ex\.what\(\)/, "how executeTask wraps a std::exception"),
    checkpointWrap: found(checkpoint, /std::string\("(Non-js exception: )"\) \+ ex\.what\(\)/, "how the checkpoint wraps a std::exception"),
    loopShape: loopShape(checkpoint),
    // A job that throws is handled and the drain is tried again, up to the bound, and the checkpoint does not nest.
    retriesOnly: checkpoint.includes("catch (jsi::JSError& error) { handleTaskError(runtime, error); }") && checkpoint.includes("retries++; }"),
    drainDefaultIsUnbounded: has(checkpoint, "runtime.drainMicrotasks()", "that the checkpoint drains with the default, unbounded hint"),
    isNotNested: checkpoint.startsWith("void RuntimeScheduler_Modern::performMicrotaskCheckpoint(jsi::Runtime& runtime) { if (performingMicrotaskCheckpoint_) { return; }"),
    clearsQueues,
    // executeTask hands a task's exception to handleTaskError, which clears the queues only under the flag and then calls the task error handler.
    taskErrorGoesToTheHandler: execute.includes("} catch (jsi::JSError& error) { handleTaskError(runtime, error); } catch (std::exception& ex) {")
      && handle === "void RuntimeScheduler_Modern::handleTaskError(jsi::Runtime& runtime, jsi::JSError& error) { if (ReactNativeFeatureFlags::enableRuntimeSchedulerQueueClearingOnError()) { clearQueues(); } onTaskError_(runtime, error); }",
    // The checkpoint follows each task, and nothing around it catches what it throws (the loop and the tick have no try).
    checkpointAfterTask: tick.indexOf("executeTask(runtime, task, didUserCallbackTimeout);") < tick.indexOf("performMicrotaskCheckpoint(runtime);"),
    loopsCatchNothing: !/\bcatch\b|\btry\b/.test(loop) && !/\bcatch\b|\btry\b/.test(tick),
    // The wedge: selectTask resets the scheduled flag before it picks a task, an executed task stays in the queue until the next selection pops it, and a task schedules the
    // loop only when the queue is empty and no loop is scheduled.
    selectResetsFlag: select.includes("isEventLoopScheduled_ = false;") && select.indexOf("isEventLoopScheduled_ = false;") < select.indexOf("while (!taskQueue_.empty() && !taskQueue_.top()->callback)"),
    executedTaskStaysQueued: select.includes("while (!taskQueue_.empty() && !taskQueue_.top()->callback) { taskQueue_.pop(); }") && task.includes("callback.reset();"),
    schedulesLoopOnlyWhenEmpty: schedule.includes("if (taskQueue_.empty() && !isEventLoopScheduled_) { isEventLoopScheduled_ = true; shouldScheduleEventLoop = true; }"),
  };
}

// The runtime executor of ReactInstance, the buffered one the platforms hand the TimerManager, and the RuntimeScheduler's error handler.
function instanceFacts(rn) {
  const instance = code(rn("ReactCommon/react/runtime/ReactInstance.cpp"));
  const buffered = code(rn("ReactCommon/react/runtime/BufferedRuntimeExecutor.cpp"));
  const ios = rn("ReactCommon/react/runtime/platform/ios/ReactCommon/RCTInstance.mm");
  const android = rn("ReactAndroid/src/main/jni/react/runtime/jni/JReactInstance.cpp");
  const wrap = found(instance, /jsi::JSError error\(jsiRuntime, std::string\("(Non-JS exception: )"\) \+ ex\.what\(\)\);/, "how the runtime executor wraps a std::exception");
  return {
    wrap,
    // An exception that leaves a task of the runtime executor is a fatal error for JsErrorHandler (isFatal true), whether it is a JSError or not.
    executorCatchIsFatal: instance.includes("} catch (jsi::JSError& originalError) { jsErrorHandler->handleError(jsiRuntime, originalError, true); } catch (std::exception& ex) {")
      && instance.includes(`std::string("${wrap}") + ex.what()); jsErrorHandler->handleError(jsiRuntime, error, true); }`),
    // The RuntimeScheduler's task error handler is JsErrorHandler::handleError with isFatal true, at both places ReactInstance creates the scheduler.
    schedulerHandlerIsFatal: (instance.match(/createRuntimeScheduler\(\w+, \[jsErrorHandler = jsErrorHandler_\]\(jsi::Runtime& runtime, jsi::JSError& error\) \{ jsErrorHandler->handleError\(runtime, error, true\);/g) ?? []).length === 2,
    // The buffered runtime executor the TimerManager runs on schedules work for the RuntimeScheduler (an Immediate-priority task).
    bufferedSchedulesWork: instance.includes("runtimeScheduler->scheduleWork(std::move(callback));") && instance.includes("bufferedRuntimeExecutor_ = std::make_shared<BufferedRuntimeExecutor>("),
    bufferedForwards: buffered.includes("runtimeExecutor_("),
    timerManagerUsesIt: /getBufferedRuntimeExecutor\(\);\s*timerManager->setRuntimeExecutor\(bufferedRuntimeExecutor\);/.test(ios),
    androidTimerManagerUsesIt: /getBufferedRuntimeExecutor\(\);\s*timerManager->setRuntimeExecutor\(bufferedRuntimeExecutor\);/.test(android),
    scheduleWorkIsImmediate: has(code(rn("ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp")), "scheduleTask(SchedulerPriority::ImmediatePriority, std::move(callback));", "that scheduleWork is an Immediate task"),
  };
}

// TimerManager.cpp, immediateShim.js, NativeMicrotasks.cpp, NativeIdleCallbacks.cpp, the event path and the renderer's executeDispatch: what each does with a callback's exception.
function callbackFacts(rn) {
  const timerSource = rn("ReactCommon/react/runtime/TimerManager.cpp");
  const timer = code(timerSource);
  const callTimer = code(cppFunction(timerSource, "void TimerManager::callTimer("));
  const shim = rn("Libraries/Core/Timers/immediateShim.js");
  const microtasks = code(rn("ReactCommon/react/nativemodule/microtasks/NativeMicrotasks.cpp"));
  const idle = code(rn("ReactCommon/react/nativemodule/idlecallbacks/NativeIdleCallbacks.cpp"));
  const bindingSource = rn("ReactCommon/react/renderer/uimanager/UIManagerBinding.cpp");
  const binding = code(bindingSource);
  const dispatchToJs = code(bindingSource.slice(bindingSource.indexOf("void UIManagerBinding::dispatchEventToJS("), bindingSource.indexOf("void UIManagerBinding::invalidate()")));
  const processor = code(rn("ReactCommon/react/renderer/core/EventQueueProcessor.cpp"));
  const beat = code(rn("ReactCommon/react/renderer/core/EventBeat.cpp"));
  const renderer = rn("Libraries/Renderer/implementations/ReactFabric-prod.js").replace(/\s+/g, " ");
  const dispatchStart = renderer.indexOf("function dispatchEvent(target, topLevelType, nativeEvent) {");
  const dispatchEvent = renderer.slice(dispatchStart, renderer.indexOf("var scheduleCallback$3", dispatchStart));
  const timers = rn("Libraries/Core/setUpTimers.js");
  const immediate = shim.slice(shim.indexOf("export function setImmediate"), shim.indexOf("export function clearImmediate"));
  return {
    // TimerManager runs a timer's callback in a task of the runtime executor, catches nothing, and erases a one-shot timer only after the callback returned.
    timerCallbackIsUncaught: !/\btry\b|\bcatch\b/.test(timer) && callTimer.includes("timerCallback.invoke(runtime);") && callTimer.indexOf("timerCallback.invoke(runtime);") < callTimer.indexOf("timers_.erase(timerHandle);"),
    timerRunsOnTheExecutor: callTimer.startsWith("void TimerManager::callTimer(TimerHandle timerHandle) { runtimeExecutor_("),
    oneShotKeepsItsEntryOnAThrow: callTimer.includes("if (!repeats) {"),
    // requestAnimationFrame is a timer with a zero delay (RN has no frame loop of ReactInstance's), and setInterval a recurring timer.
    rafIsATimer: /createTimer\(\s*std::move\(callback\),\s*std::vector<jsi::Value>\(\),\s*\/\* delay \*\/ 0,\s*TimerSource::RequestAnimationFrame\)/.test(timerSource),
    intervalIsRecurring: timer.includes("createRecurringTimer(") && timer.includes("TimerSource::SetInterval"),
    // setImmediate is one queueMicrotask callback per call: there is no batch and no loop, so every immediate is a microtask of its own.
    immediateIsOneMicrotask: immediate.includes("global.queueMicrotask(() => {") && immediate.includes("callback.apply(undefined, args);") && !/\b(for|while)\b/.test(immediate),
    queueMicrotaskIsTheRuntimes: microtasks.includes("runtime.queueMicrotask(callback);"),
    bridgelessInstallsFromTheModule: /polyfillGlobal\(\s*'queueMicrotask'/.test(timers),
    // An idle callback runs inside the scheduler's task and its exception is not caught there.
    idleCallbackIsUncaught: !/\btry\b|\bcatch\b/.test(idle) && idle.includes("userCallbackShared->call(std::move(idleDeadline));") && idle.includes("scheduleIdleTask(std::move(wrappedCallback))"),
    // The event handler's call, the processor's loop and the beat's task have no catch either: the exception leaves the scheduler's task.
    eventPathIsUncaught: !/\btry\b|\bcatch\b/.test(dispatchToJs) && !/\bcatch\b/.test(processor) && processor.includes("SCOPE_EXIT {") && beat.includes("runtimeScheduler_.scheduleWork(std::move(beat));"),
    eventHandlerCallIsDirect: binding.includes("eventHandler_->call( runtime, std::move(instanceHandle), jsi::String::createFromUtf8(runtime, type), std::move(payload));")
      || /eventHandler_->call\(\s*runtime,\s*std::move\(instanceHandle\)/.test(bindingSource),
    // The renderer runs every listener of an event, keeps the first exception, and rethrows it when the event queue is done.
    rendererRethrowsAfterTheListeners: renderer.includes("function executeDispatch(event, listener, inst) { event.currentTarget = getNodeFromInstance$1(inst); try { listener(event); } catch (error) { hasError || ((hasError = !0), (caughtError = error)); }")
      && /if \(hasError\) throw \( \(\(event = caughtError\), \(hasError = !1\), \(caughtError = null\), event\) \);/.test(dispatchEvent),
  };
}

// Whether Hermes tracks a rejection in a release bundle, from RN's files: the tracker is enabled by polyfillPromise.js and Libraries/Promise.js, each under __DEV__, and by nothing else.
function trackerFacts(base) {
  const rnRoot = path.join(base, "node_modules/react-native");
  const rn = file => readFileSync(path.join(rnRoot, file), "utf8");
  const polyfill = rn("Libraries/Core/polyfillPromise.js");
  const promise = rn("Libraries/Promise.js");
  const walk = directory => readdirSync(path.join(rnRoot, directory)).flatMap(entry => {
    const relative = path.posix.join(directory, entry);
    return statSync(path.join(rnRoot, relative)).isDirectory() ? walk(relative) : [relative];
  });
  const mentions = [...walk("Libraries"), ...walk("src")].filter(file => file.endsWith(".js") && /enablePromiseRejectionTracker|promise\/setimmediate\/rejection-tracking/.test(rn(file)));
  const underDev = (text, word) => {
    const start = text.indexOf("if (__DEV__) {");
    return start !== -1 && text.slice(start).includes(word) && !text.slice(0, start).includes(word);
  };
  const options = rn("Libraries/promiseRejectionTrackingOptions.js");
  return {
    mentions: sorted(mentions),
    polyfillEnablesUnderDev: underDev(polyfill, "enablePromiseRejectionTracker"),
    promiseEnablesUnderDev: underDev(promise, "rejection-tracking"),
    polyfillTakesHermesPromise: polyfill.includes("global?.HermesInternal?.hasPromise?.()"),
    setUpErrorHandlingMentions: /rejection/i.test(rn("Libraries/Core/setUpErrorHandling.js")),
    // In a development bundle the options report an unhandled rejection as a soft error (isFatal false).
    devReportsSoft: /ExceptionsManager\.handleException\(\s*new Error\(\s*`Uncaught \(in promise, id: \$\{id\}\)/.test(options) && /false \/\* isFatal \*\//.test(options),
  };
}

// The host's sources: its checkpoint is RN's loop, every drain goes through it, and each catch site routes as the README says.
function hostFacts(base) {
  const source = readFileSync(path.join(base, "native/application_runtime.cpp"), "utf8");
  const errorPath = readFileSync(path.join(base, "native/js_error_path.cpp"), "utf8");
  const perform = code(source.slice(source.indexOf("  void perform_microtask_checkpoint() {"), source.indexOf("  void microtask_checkpoint() {")));
  const wrapper = code(source.slice(source.indexOf("  void microtask_checkpoint() {"), source.indexOf("  void pump(bool frame_tick = false) {")));
  const pumpText = source.slice(source.indexOf("void pump(bool frame_tick = false) {"), source.indexOf("void unmount(int id, bool legacy_hook = false) {"));
  const pump = code(pumpText);
  const stopStart = source.indexOf("  void stop() {");
  const stop = code(source.slice(stopStart, stopStart + 6000));
  const everything = code(source);
  const timerLambda = code(source.slice(source.indexOf("timer_manager->setRuntimeExecutor("), source.indexOf("timer_manager->attachGlobals(*runtime);")));
  const frameLoop = code(pumpText.slice(pumpText.indexOf("for (int id : frame_ids) {"), pumpText.indexOf("// One native animation frame per tick")));
  const workLoop = code(pumpText.slice(pumpText.indexOf("for (int limit = 0; !stop_requested && !work.empty() && limit < 256; ++limit) {")));
  const nativeFrames = code(pumpText.slice(pumpText.indexOf("// One native animation frame per tick"), pumpText.indexOf("// Bound a frame's work.")));
  const takeDue = pumpText.indexOf("timer_registry->take_due(now_ms())");
  const frames = pumpText.indexOf("for (int id : frame_ids) {");
  const head = pumpText.indexOf("microtask_checkpoint();");
  const drain = pumpText.indexOf("for (int limit = 0; !stop_requested && !work.empty() && limit < 256; ++limit) {");
  const last = pumpText.lastIndexOf("if (!stop_requested) microtask_checkpoint();");
  return {
    loopShape: loopShape(perform),
    bound: Number(found(perform, /const static unsigned int kRetriesBound = (\d+);/, "the host's retry bound")),
    retriesType: found(perform, /(\w+) retries = 0;/, "the type of the host's retry counter"),
    boundMessage: found(perform, /throw std::runtime_error\("([^"]*)"\);/, "the message the host's checkpoint throws"),
    isNotNested: perform.startsWith("void perform_microtask_checkpoint() { if (performing_microtask_checkpoint) return;"),
    handlesAsATaskError: perform.includes("catch (const std::exception &error) { js_errors->handle_task_error(*runtime, error); }"),
    // What follows the bound's throw is the runtime executor's catch: a fatal error for JsErrorHandler (the host goes on).
    wrapperIsTheExecutorsCatch: wrapper === "void microtask_checkpoint() { try { perform_microtask_checkpoint(); } catch (const std::exception &error) { js_errors->handle_fatal(*runtime, error); } }",
    // The only call of drainMicrotasks is the checkpoint's, and every drain of the pump and of the stop path goes through the wrapper.
    drainCalls: (everything.match(/->drainMicrotasks\(\)/g) ?? []).length,
    pumpCheckpoints: (pump.match(/microtask_checkpoint\(\);/g) ?? []).length,
    stopCheckpoints: (stop.match(/microtask_checkpoint\(\);/g) ?? []).length,
    // The pump's order: the checkpoint at its head, the frame callbacks (each followed by a checkpoint), the due timers put on the work queue, the work (each item followed by a
    // checkpoint) and a last checkpoint.
    pumpOrder: head !== -1 && head < frames && frames < takeDue && takeDue < drain && last > drain,
    frameCallbackCheckpoint: frameLoop.includes("microtask_checkpoint();"),
    workItemCheckpoint: workLoop.includes("catch (const std::exception &error) { js_errors->handle_fatal(*runtime, error); } if (!stop_requested) microtask_checkpoint(); }"),
    // The catch sites: a timer and a frame callback are fatal errors through JsErrorHandler (RN's scheduler task), the work queue is the runtime executor's catch.
    timerCatch: timerLambda.includes("try { callback(rt); } catch (const std::exception &error) { js_errors->handle_fatal(rt, error); }"),
    timerReleasesTheEntry: timerLambda.includes("if (!timer_registry->recurring(id)) clear_timer->call(rt, static_cast<double>(id)); timer_registry->finish(id, now_ms());"),
    frameCatch: frameLoop.includes("try { callback.mapped().call(*runtime, frame_time); } catch (const std::exception &error) { js_errors->handle_fatal(*runtime, error); }"),
    schedulerHandler: everything.includes("[this](jsi::Runtime &rt, jsi::JSError &error) { js_errors->handle_fatal(rt, error); }"),
    // The two native frames keep a recorded failure: RN has no catch around them (RCTScheduler.mm) and no JS runs in them.
    nativeFrameCatches: (nativeFrames.match(/catch \(const std::exception &error\) \{ fail\(error\.what\(\)\); \}/g) ?? []).length,
    evaluateSeamKeepsFail: everything.includes("catch (const std::exception &error) { guard->fail(error.what()); return \"null\"; }"),
    taskPrefix: found(errorPath, /task_non_js_exception_prefix = "([^"]*)";/, "the host's wrap for a scheduler task"),
    executorPrefix: found(errorPath, /(?<![a-z_])non_js_exception_prefix = "([^"]*)";/, "the host's wrap for the runtime executor"),
  };
}

// RN's iOS frame paths (CADisplayLink and the run loop observer) call the animation without a catch: a C++ exception there is not handed to JsErrorHandler.
function nativeFrameFacts(rn) {
  const scheduler = rn("React/Fabric/RCTScheduler.mm");
  const tickStart = scheduler.indexOf("- (void)displayLinkTick:(CADisplayLink *)sender\n{");
  const tick = code(scheduler.slice(tickStart, scheduler.indexOf("@end", tickStart)));
  const observerStart = scheduler.indexOf("void activityDidChange(");
  const observer = code(scheduler.slice(observerStart, scheduler.indexOf("private:", observerStart)));
  return {
    displayLinkIsUncaught: tick.includes("_choreographer->onAnimationFrame(") && !/@try|\btry\b|\bcatch\b/.test(tick),
    runLoopObserverIsUncaught: observer.includes("[scheduler animationTick];") && !/@try|\btry\b|\bcatch\b/.test(observer),
    layoutAnimationCallbackGoesThroughTheExecutor: has(code(rn("ReactCommon/react/renderer/animations/LayoutAnimationKeyFrameManager.cpp")), "runtimeExecutor_([callback](jsi::Runtime& runtime) { callback.call(runtime); });", "that LayoutAnimation's JS callback runs on the runtime executor"),
    onRenderIsUncaught: !/\btry\b|\bcatch\b/.test(code(cppFunction(rn("ReactCommon/react/renderer/animated/NativeAnimatedNodesManager.cpp"), "void NativeAnimatedNodesManager::onRender()"))),
  };
}

// RN's own JavaScript in V8: the message ExceptionsManager composes for an Error that is reported as fatal (the module's wrapper receives it), so that what the host records is
// judged against RN's composition and not against a string of the probe's.
async function referenceRun() {
  const result = await build({absWorkingDir: root, stdin: {contents: `
import "react-native/Libraries/Core/setUpErrorHandling";
import native from "react-native/Libraries/Core/NativeExceptionsManager";
globalThis.__nativeExceptionsManager = native;
`, resolveDir: root, sourcefile: "js-exceptions-reference-entry.js"}, bundle: true, write: false, platform: "neutral", format: "iife",
  define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"}, inject: metroPolyfills(id => requireSdk.resolve(id)),
  mainFields: ["main"], resolveExtensions: godotExtensions, plugins: [platformPlugin(path.join(root, "src"), id => requireSdk.resolve(id))]});
  const reports = [];
  const exceptionsManager = {
    reportException: data => reports.push({message: data.message, isFatal: data.isFatal, name: data.name ?? null, stack: data.stack.length}),
    reportSoftException: () => {}, reportFatalException: () => {}, dismissRedbox: () => {},
  };
  const context = vm.createContext({});
  context.global = context;
  context.__DEV__ = false;
  context.nativeLoggingHook = () => {};
  context.RN$Bridgeless = true;
  context.nativeModuleProxy = {};
  context.RN$registerCallableModule = () => {};
  context.__turboModuleProxy = name => name === "ExceptionsManager" ? exceptionsManager : null;
  // The runtime is ready after the bundle, and the flag is at its default: RN$handleException hands every error back to JS.
  context.RN$handleException = () => false;
  context.RN$inExceptionHandler = () => false;
  vm.runInContext(result.outputFiles[0].text, context);
  const makeError = vm.runInContext("(text => new Error(text))", context);
  context.ErrorUtils.reportFatalError(makeError("reference fatal"));
  context.ErrorUtils.reportError(makeError("reference soft"));
  return {fatal: reports.find(entry => entry.isFatal), soft: reports.find(entry => !entry.isFatal)};
}

// ---- The model of the host's event loop --------------------------------------------------------------------------------------------------------------------------

// One macrotask of Node: every microtask that is pending, and those they queue, runs first, in V8's order.
const macrotask = () => new Promise(resolve => setImmediate(resolve));

// Whether a case has a chain: its counts are derived from the constants, not run.
const hasChain = testCase => JSON.stringify(testCase.body).includes('"do":"chain"');

// A checkpoint of RN's loop on a queue in which every job fails (a throwing chain): the failures come in blocks of at most `bound`, and a block of exactly `bound` is cut, which is
// reported (the loop leaves with retries == bound even when the queue happens to be empty then).
function checkpointBlocks(count, bound) {
  const blocks = [];
  for (let remaining = count; remaining > 0;) {
    const failures = Math.min(remaining, bound);
    blocks.push({failures, cut: failures === bound});
    remaining -= failures;
  }
  return blocks;
}

// The event loop of the host, one pump at a time, with RN's RuntimeScheduler in it. A pump (native/application_runtime.cpp, in the order the host facts check): the checkpoint at the
// head, the frame callbacks (a snapshot of the callbacks requested before this tick, each followed by a checkpoint), the due timers put on the work queue, the work queue (each item
// followed by a checkpoint, the scheduler's loop being one item, in which RN's own checkpoint follows each task) and a last checkpoint. A timer or a frame callback requested while
// the pump runs is due in a later pump. The clock is virtual: a pump takes 16 ms.
async function simulate(testCase, facts, shim) {
  const entries = [];
  const reports = [];
  const soft = [];
  const chains = {};
  let finished = false;
  let route = "host";
  const prefix = `js-exceptions ${testCase.name}/`;
  const labelOf = message => (message.startsWith(prefix) ? message.slice(prefix.length) : message);
  const guard = callback => () => {
    try {
      callback();
    } catch (error) {
      reports.push({label: labelOf(error.message), route});
    }
  };
  const context = vm.createContext({});
  vm.runInContext("globalThis.global = globalThis;", context);
  const queue = callback => queueMicrotask(guard(callback));
  context.queueMicrotask = queue;
  vm.runInContext(shim, context);
  const timers = [];
  const frames = [];
  const work = [];
  const scheduler = {tasks: [], loopScheduled: false};
  let sequence = 0;
  let clock = 0;
  const timeouts = facts.scheduler.timeouts;
  const schedule = (priority, callback) => {
    const task = {expiration: clock + timeouts[priority], sequence: sequence++, callback};
    // scheduleTask: the loop is scheduled when the queue is empty and none is scheduled.
    if (scheduler.tasks.length === 0 && !scheduler.loopScheduled) {
      scheduler.loopScheduled = true;
      work.push({loop: true});
    }
    scheduler.tasks.push(task);
  };
  const top = () => scheduler.tasks.reduce((best, task) => best === null || task.expiration < best.expiration || (task.expiration === best.expiration && task.sequence < best.sequence) ? task : best, null);
  const selectTask = () => {
    scheduler.loopScheduled = false;
    while (scheduler.tasks.length > 0 && top().callback === null) {
      scheduler.tasks.splice(scheduler.tasks.indexOf(top()), 1);
    }
    return scheduler.tasks.length === 0 ? null : top();
  };
  const addTimer = (callback, delay, interval) => {
    const timer = {due: clock + delay, delay, sequence: sequence++, callback, interval, cleared: false};
    timers.push(timer);
    return timer;
  };
  const env = {
    mark: label => entries.push({label, chains: {...chains}}),
    makeError: label => new Error(messageOf(testCase.name, label)),
    reportError: error => soft.push(error.message),
    chains,
    finish: () => {
      finished = true;
    },
    setTimeout: (callback, delay) => addTimer(callback, delay, false),
    setInterval: (callback, delay) => addTimer(callback, delay, true),
    clearInterval: timer => {
      timer.cleared = true;
    },
    requestAnimationFrame: callback => frames.push(callback),
    requestIdleCallback: callback => schedule("Idle", callback),
    setImmediate: callback => context.__immediateShim.setImmediate(callback),
    queueMicrotask: queue,
    Promise,
  };
  const checkpoint = async who => {
    route = who;
    await macrotask();
    route = "host";
  };
  // A callback that a timer or a frame stands for: the host's own catch reports its exception.
  const runHost = callback => {
    try {
      callback();
    } catch (error) {
      reports.push({label: labelOf(error.message), route: "host"});
    }
  };
  // RN's runEventLoop: the task's exception is handleTaskError's (reported through the scheduler), and a checkpoint of RN's follows the task.
  const runLoop = async () => {
    for (let task = selectTask(); task !== null; task = selectTask()) {
      const callback = task.callback;
      task.callback = null;
      try {
        callback();
      } catch (error) {
        reports.push({label: labelOf(error.message), route: "scheduler"});
      }
      await checkpoint("scheduler");
    }
  };
  const body = callbackOf(testCase.body, env);
  // The `promise` case leaves rejections nobody handles, as it does in Hermes; Node reports them to whoever listens, so the listeners of the process (the test runner's
  // among them) are put aside for the length of the run and restored after.
  const saved = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", () => {});
  try {
    switch (testCase.source) {
      case "evaluate":
        body();
        break;
      case "timer":
        addTimer(body, 0, false);
        break;
      case "raf":
        frames.push(body);
        break;
      case "press":
        schedule("Immediate", body);
        break;
      default:
        assert.fail(`Unknown source ${testCase.source}`);
    }
    for (let pumps = 0; pumps < 1000; pumps += 1) {
      const pending = timers.some(timer => !timer.cleared) || frames.length > 0 || scheduler.tasks.length > 0 || work.length > 0;
      if (!pending) {
        break;
      }
      clock += 16;
      await checkpoint("host");
      if (frames.length > 0) {
        for (const callback of frames.splice(0)) {
          runHost(callback);
          await checkpoint("host");
        }
      }
      const due = timers.filter(timer => !timer.cleared && timer.due <= clock).sort((a, b) => a.due - b.due || a.sequence - b.sequence);
      for (const timer of due) {
        work.push({timer});
      }
      for (let limit = 0; work.length > 0 && limit < 256; limit += 1) {
        const item = work.shift();
        if (item.loop) {
          await runLoop();
        } else if (!item.timer.cleared) {
          runHost(item.timer.callback);
          if (item.timer.interval) {
            item.timer.due = clock + item.timer.delay;
          } else {
            timers.splice(timers.indexOf(item.timer), 1);
          }
        }
        await checkpoint("host");
      }
      await checkpoint("host");
    }
    await macrotask();
    await macrotask();
  } finally {
    process.removeAllListeners("unhandledRejection");
    for (const listener of saved) {
      process.on("unhandledRejection", listener);
    }
  }
  return {journal: entries.map(entry => entry.label), entries, reports, soft, finished};
}

// A chain that throws on every run, started by a source: the failures in blocks, the bound where a block is full, and the route of each block. The scheduler's own checkpoint
// (a press) performs the first block; its bound leaves the loop with the executed task queued and no loop scheduled, which the scheduler's rules turn into a scheduler that
// takes no further task, so the rest of the chain is the host's.
function modelRetry(testCase, facts) {
  const blocks = checkpointBlocks(total.retry, facts.checkpoint.bound);
  const startedByScheduler = testCase.source === "press";
  const reports = [];
  const boundaries = [];
  let seen = 0;
  for (const [index, block] of blocks.entries()) {
    const route = startedByScheduler && index === 0 ? "scheduler" : "host";
    for (let count = 0; count < block.failures; count += 1) {
      reports.push({label: "retry", route});
    }
    seen += block.failures;
    boundaries.push(seen);
    if (block.cut) {
      reports.push({label: "bound", route: "executor"});
    }
  }
  return {reports, blocks, boundaries, wedges: startedByScheduler && blocks[0].cut && facts.wedge.schedulesNoLoop};
}

// What the scheduler's rules do after an exception left runEventLoop from inside its own checkpoint: selectTask had reset the scheduled flag, the executed task is still queued,
// and scheduleTask schedules the loop only for an empty queue, so a task scheduled now finds the queue non-empty and no loop comes.
function wedgeFacts(checkpoint) {
  assert.ok(checkpoint.selectResetsFlag && checkpoint.executedTaskStaysQueued && checkpoint.schedulesLoopOnlyWhenEmpty && checkpoint.loopsCatchNothing,
    "The scheduler's rules are the ones the wedge is derived from");
  const state = {queue: ["executed task"], loopScheduled: false};
  const schedulesLoop = state.queue.length === 0 && !state.loopScheduled;
  return {schedulesNoLoop: !schedulesLoop};
}

// What RN 0.87.1 does, from the pinned sources under `base` and from running its JavaScript in V8.
export async function exceptionsExpectations(base = root) {
  const rn = file => readFileSync(path.join(base, "node_modules/react-native", file), "utf8");
  const facts = {checkpoint: checkpointFacts(rn), instance: instanceFacts(rn), callbacks: callbackFacts(rn), tracker: trackerFacts(base), host: hostFacts(base),
    nativeFrames: nativeFrameFacts(rn), scheduler: schedulerFacts(rn)};
  facts.wedge = wedgeFacts(facts.checkpoint);
  const jsi = rn("ReactCommon/jsi/jsi/jsi.h").replace(/\/\/\/ ?/g, "").replace(/\\p /g, "").replace(/\s+/g, " ");
  facts.jsiDrainContract = jsi.includes("When there were exceptions thrown from the execution of microtasks, implementations shall discard the exceptional jobs.")
    && jsi.includes("Hosts may call this function again to resume the draining if it was suspended due to either exceptions or the maxMicrotasksHint bound.")
    && jsi.includes("Exceptions from ECMA-262 Promise Jobs are handled internally to VMs and are never propagated to hosts.");
  // JSError::what() is the message, a blank line and the stack (jsi.cpp), which the scheduler's wrap puts after its prefix.
  facts.whatIsMessageBlankLineStack = rn("ReactCommon/jsi/jsi/jsi.cpp").includes('what_ = message_ + "\\n\\n" + stack_;');
  facts.reference = await referenceRun();
  const shim = await immediateShimBundle();
  const models = {};
  for (const testCase of cases) {
    if (laneOf(testCase) === "wedge" || hasChain(testCase)) {
      continue;
    }
    models[testCase.name] = await simulate(testCase, facts, shim);
  }
  // The stop turn is queued by the probe and drained by the stop path's checkpoint, which the host performs.
  models.stop = await simulate({name: "stop", source: "evaluate", body: {label: "queued", throws: false, then: stopTurn}}, facts, shim);
  const journals = Object.fromEntries(Object.entries(models).map(([name, model]) => [name, model.journal]));
  const fatal = Object.fromEntries(Object.entries(models).map(([name, model]) => [name, model.reports.map(entry => [entry.label, entry.route])]));
  const retry = Object.fromEntries(cases.filter(testCase => testCase.name.startsWith("retry-bound")).map(testCase => [testCase.name, modelRetry(testCase, facts)]));
  return {facts, models, journals, fatal, retry, total, bound: facts.checkpoint.bound};
}

// What the oracle checks of the facts themselves: the claims the probe's expectations stand on. They are a property of RN's sources, not of a report.
function assertFacts(expected) {
  const {checkpoint, instance, callbacks, tracker, host, nativeFrames} = expected.facts;
  assert.equal(checkpoint.bound, 255);
  assert.equal(checkpoint.retriesType, "uint8_t");
  assert.equal(checkpoint.boundMessage, "Hits microtasks retries bound.");
  assert.equal(checkpoint.wrap, "Non-js exception: ");
  assert.equal(checkpoint.checkpointWrap, checkpoint.wrap, "The checkpoint wraps what it does not recognise as executeTask does");
  assert.equal(checkpoint.clearsQueues, false, "enableRuntimeSchedulerQueueClearingOnError is false in the pinned defaults, so an error does not clear the scheduler's queues");
  for (const key of ["retriesOnly", "drainDefaultIsUnbounded", "isNotNested", "taskErrorGoesToTheHandler", "checkpointAfterTask", "loopsCatchNothing", "selectResetsFlag",
    "executedTaskStaysQueued", "schedulesLoopOnlyWhenEmpty"]) {
    assert.ok(checkpoint[key], `RN's RuntimeScheduler no longer has the fact ${key}`);
  }
  assert.equal(checkpoint.loopShape, "while (retries < kRetriesBound) try drainMicrotasks() break; catch handle retries++; if (retries == kRetriesBound) throw");
  assert.equal(instance.wrap, "Non-JS exception: ");
  for (const key of ["executorCatchIsFatal", "schedulerHandlerIsFatal", "bufferedSchedulesWork", "bufferedForwards", "timerManagerUsesIt", "androidTimerManagerUsesIt", "scheduleWorkIsImmediate"]) {
    assert.ok(instance[key], `ReactInstance no longer has the fact ${key}`);
  }
  for (const [key, value] of Object.entries(callbacks)) {
    assert.ok(value, `RN's callback path no longer has the fact ${key}`);
  }
  assert.deepEqual(tracker.mentions, ["Libraries/Core/polyfillPromise.js", "Libraries/Promise.js", "Libraries/promiseRejectionTrackingOptions.js"],
    "Only these RN files mention the rejection tracker: the Hermes path, the polyfill path, and the options");
  assert.ok(tracker.polyfillEnablesUnderDev && tracker.promiseEnablesUnderDev && tracker.polyfillTakesHermesPromise && tracker.devReportsSoft, "RN enables the tracker only under __DEV__");
  assert.equal(tracker.setUpErrorHandlingMentions, false, "setUpErrorHandling does not enable a rejection tracker");
  // The host's checkpoint is RN's loop: the same tokens in the same order and the same constants.
  assert.equal(host.loopShape, checkpoint.loopShape, "The host's checkpoint loop is RN's");
  assert.equal(host.bound, checkpoint.bound);
  assert.equal(host.retriesType, checkpoint.retriesType);
  assert.equal(host.boundMessage, checkpoint.boundMessage);
  assert.equal(host.taskPrefix, checkpoint.wrap, "The host's checkpoint wraps a std::exception as RN's checkpoint does");
  assert.equal(host.executorPrefix, instance.wrap, "The host's other catches wrap a std::exception as ReactInstance's runtime executor does");
  for (const key of ["isNotNested", "handlesAsATaskError", "wrapperIsTheExecutorsCatch", "pumpOrder", "frameCallbackCheckpoint", "workItemCheckpoint", "timerCatch", "timerReleasesTheEntry",
    "frameCatch", "schedulerHandler", "evaluateSeamKeepsFail"]) {
    assert.ok(host[key], `The host no longer has the fact ${key}`);
  }
  assert.equal(host.drainCalls, 1, "The only drain of the microtask queue is the checkpoint's");
  assert.equal(host.pumpCheckpoints, 4, "The pump performs the checkpoint at its head, after each frame callback, after each work item and at its end");
  assert.equal(host.stopCheckpoints, 1, "The stop path performs one checkpoint");
  assert.equal(host.nativeFrameCatches, 2, "The Native Animated frame and the LayoutAnimation tick keep a recorded failure");
  for (const [key, value] of Object.entries(nativeFrames)) {
    assert.ok(value, `RN's frame paths no longer have the fact ${key}`);
  }
  assert.ok(expected.facts.jsiDrainContract, "JSI's drainMicrotasks contract is that an exception discards the job and the host drains again");
  assert.ok(expected.facts.whatIsMessageBlankLineStack);
  assert.equal(expected.facts.reference.fatal.message, "Error: reference fatal", "ExceptionsManager composes the name and the message of a fatal Error");
  assert.equal(expected.facts.reference.soft.message, "Error: reference soft");
  assert.equal(expected.facts.reference.fatal.isFatal, true);
  assert.equal(expected.facts.reference.soft.isFatal, false);
  // The chains are sized by the bound: the throwing chain crosses it once and leaves a remainder, and the storm is far beyond anything a bound counts.
  assert.ok(total.retry > checkpoint.bound && total.retry < 2 * checkpoint.bound, "The throwing chain crosses the bound once");
  assert.ok(total.storm > 1000 * checkpoint.bound, "The storm is far beyond the bound");
  assert.deepEqual(checkpointBlocks(total.retry, checkpoint.bound), [{failures: 255, cut: true}, {failures: 45, cut: false}]);
  assert.deepEqual(checkpointBlocks(255, 255), [{failures: 255, cut: true}], "A block of exactly the bound is cut even when the queue is empty then");
  assert.deepEqual(checkpointBlocks(0, 255), []);
  for (const [name, retry] of Object.entries(expected.retry)) {
    assert.deepEqual(retry.boundaries, [255, 300], `${name}: a timer or a frame callback sees a boundary between checkpoints`);
    assert.equal(retry.reports.length, total.retry + 1, `${name}: the failures of the chain, and the bound`);
    assert.equal(retry.reports.filter(entry => entry.label === "bound").length, 1);
    assert.equal(retry.reports[checkpoint.bound].label, "bound", `${name}: the bound is reported after the ${checkpoint.bound}th failure`);
    assert.equal(retry.wedges, name === "retry-bound-press", `${name}: only the bound reached by RN's own checkpoint ends its scheduler`);
  }
  // The model must say the cases are worth running.
  assert.deepEqual(expected.journals["microtask-evaluate"], ["start", "m1", "m2", "p", "i1", "i2", "m3", "m4", "timer"]);
  assert.deepEqual(expected.fatal["microtask-evaluate"], [["m1", "host"], ["i1", "host"]]);
  assert.deepEqual(expected.fatal["microtask-press"], [["m1", "scheduler"], ["i1", "scheduler"]]);
  assert.deepEqual(expected.fatal.idle, [["i1", "scheduler"]]);
  assert.deepEqual(expected.fatal.event, [["onPress", "scheduler"]]);
  assert.deepEqual(expected.fatal.timeout, [["a", "host"]]);
  assert.deepEqual(expected.fatal.promise, [], "Nothing a Promise reaction throws reaches a host");
  assert.equal(expected.models.soft.soft.length, 1);
}

// ---- The verdicts ------------------------------------------------------------------------------------------------------------------------------------------------

const caseOf = (report, name) => report.stages.cases?.[name] ?? null;
const labelsOf = record => (record?.record?.journal ?? []).map(entry => entry.label);
const entryOf = (record, label) => {
  const matching = (record?.record?.journal ?? []).filter(entry => entry.label === label);
  return matching.length === 1 ? matching[0] : null;
};
const counted = (record, route, kind) => Number(record?.after?.[route]?.[kind] ?? 0) - Number(record?.before?.[route]?.[kind] ?? 0);
const finished = record => record?.record?.done === true;
const frameLines = lines => lines.length > 0 && lines.every(line => /^.*@.+:-?\d+(:\d+)?$/.test(line));

// The text of a failure, in the format the host records a fatal error (slice C: the message RN composed, ", stack:" and a frame per line).
function textOf(text, expected, name, label, route) {
  const message = messageOf(name, label);
  const composed = "Error: ";
  if (route === "host") {
    const head = `${composed}${message}, stack:\n`;
    return text.startsWith(head) && frameLines(text.slice(head.length).split("\n").filter(Boolean));
  }
  // The scheduler's wrap: its prefix, the error's what() (the message, a blank line, the stack V8 writes) and then the stack RN parsed.
  const head = `${composed}${expected.facts.checkpoint.wrap}${message}\n\n${composed}${message}\n`;
  const at = text.indexOf(", stack:\n");
  return text.startsWith(head) && at > head.length && frameLines(text.slice(at + ", stack:\n".length).split("\n").filter(Boolean));
}
const boundText = expected => `Error: ${expected.facts.instance.wrap}${expected.facts.checkpoint.boundMessage}, stack:\n`;

// One failure for each fatal error the case makes, in order and by route, each in its format, counted as fatal reports of the module and as nothing else.
function fatalMade(report, expected, name) {
  const record = caseOf(report, name);
  const want = expected.fatal[name];
  const errors = record?.errors ?? [];
  return record != null && want !== undefined && errors.length === want.length && want.every(([label, route], index) => textOf(errors[index], expected, name, label, route))
    && counted(record, "module", "fatal") === want.length && counted(record, "module", "soft") === 0 && counted(record, "handler", "fatal") === 0 && counted(record, "handler", "soft") === 0;
}
const ranAsJournaled = (report, expected, name) => finished(caseOf(report, name)) && same(labelsOf(caseOf(report, name)), expected.journals[name]);
function nothingReported(report, name) {
  const record = caseOf(report, name);
  return record != null && (record.errors ?? []).length === 0 && counted(record, "module", "fatal") === 0 && counted(record, "module", "soft") === 0
    && counted(record, "handler", "fatal") === 0 && counted(record, "handler", "soft") === 0 && (record.logged ?? []).length === 0;
}
function boundReported(report, expected, name) {
  const record = caseOf(report, name);
  const model = expected.retry[name];
  const errors = record?.errors ?? [];
  if (record == null || errors.length !== model.reports.length) {
    return false;
  }
  return model.reports.every((entry, index) => entry.label === "bound" ? errors[index] === boundText(expected) : textOf(errors[index], expected, name, entry.label, entry.route))
    && counted(record, "module", "fatal") === model.reports.length && counted(record, "module", "soft") === 0 && counted(record, "handler", "fatal") === 0;
}
function besideChain(report, name, chain, count, boundaries) {
  const record = caseOf(report, name);
  const order = labelsOf(record);
  const timer = entryOf(record, "alongside-timer");
  const frame = entryOf(record, "alongside-raf");
  const last = entryOf(record, `${chain}-last`);
  const end = entryOf(record, "end");
  if (timer === null || frame === null || last === null || end === null || !finished(record)) {
    return false;
  }
  return order.length === 5 && order[0] === "start" && order[4] === "end" && [timer, frame].every(entry => boundaries.includes(entry.chains?.[chain]))
    && last.chains?.[chain] === count && end.chains?.[chain] === count && order.indexOf("alongside-timer") < 4 && order.indexOf("alongside-raf") < 4;
}

// Every verdict the probe gives, derived again from the raw observations of a report and from RN, in the probe's order and with its names.
export function exceptionsDerivedChecks(report, expected) {
  const stages = report.stages;
  const row = (name, passed) => ({name, passed});
  const mounted = stages.mount?.application;
  const environment = stages.environment ?? {};
  const globals = environment.globals ?? {};
  const tracked = stages.tracked ?? {};
  const rows = [];
  rows.push(row("mount/The root mounts through the original AppRegistry without a diagnostic",
    mounted?.rootCount === 1 && Number(stages.mount?.surfaceId) > 0 && (mounted?.errors ?? [1]).length === 0));
  rows.push(row("release/The bundle is a release build on Hermes' own Promise, and the six callback globals under test are installed",
    environment.host?.dev === false && environment.host?.tracker?.hasPromise === true && environment.promiseIsHermes === true
      && ["queueMicrotask", "setImmediate", "setTimeout", "setInterval", "requestAnimationFrame", "requestIdleCallback"].every(name => globals[name]?.type === "function")));
  rows.push(row("timeout/An exception in a setTimeout callback is a fatal error for JsErrorHandler, with RN's message and stack, and records one host failure",
    fatalMade(report, expected, "timeout")));
  rows.push(row("timeout/The other timers due in the same tick still run, and the runtime keeps running", ranAsJournaled(report, expected, "timeout")));
  rows.push(row("interval/An exception in a setInterval callback is a fatal error, once per tick that threw", fatalMade(report, expected, "interval")));
  rows.push(row("interval/The interval keeps ticking after an exception, and clears itself when it is told to", ranAsJournaled(report, expected, "interval")));
  rows.push(row("raf/An exception in a requestAnimationFrame callback is a fatal error, as RN's timer-based frame callback is", fatalMade(report, expected, "raf")));
  rows.push(row("raf/The other callbacks of the frame, and the ones they request, still run", ranAsJournaled(report, expected, "raf")));
  rows.push(row("idle/An exception in a requestIdleCallback callback leaves its RuntimeScheduler task and is a fatal error through the scheduler's handler",
    fatalMade(report, expected, "idle")));
  rows.push(row("idle/The idle callback queued behind it still runs: the scheduler's queue is not cleared on an error", ranAsJournaled(report, expected, "idle")));
  rows.push(row("event/An exception in an event handler (a Pressable's onPress) reaches the RuntimeScheduler's handler as a fatal error, once", fatalMade(report, expected, "event")));
  rows.push(row("event/The timer the handler queued still runs, and the runtime keeps running: the next press is handled and makes no error",
    ranAsJournaled(report, expected, "event") && ranAsJournaled(report, expected, "event-after") && caseOf(report, "event-after")?.presses === 2 && fatalMade(report, expected, "event-after")));
  const soft = caseOf(report, "soft");
  rows.push(row("soft/A soft exception reported from a timer callback (ErrorUtils.reportError) is counted as soft, logged, and records no failure",
    ranAsJournaled(report, expected, "soft") && (soft?.errors ?? [1]).length === 0 && counted(soft, "module", "soft") === expected.models.soft.soft.length && counted(soft, "module", "fatal") === 0
      && counted(soft, "handler", "soft") === 0 && counted(soft, "handler", "fatal") === 0));
  const wheres = {evaluate: "at the head of the host's pump", timer: "after a timer's work item", raf: "after a frame callback", press: "in RN's own checkpoint after a RuntimeScheduler task"};
  for (const source of ["evaluate", "timer", "raf", "press"]) {
    const name = `microtask-${source}`;
    rows.push(row(`${name}/A throwing queueMicrotask callback and a throwing setImmediate callback are fatal errors ${wheres[source]}`, fatalMade(report, expected, name)));
    rows.push(row(`${name}/The microtasks behind the one that threw still run in order: the other callback, the Promise reaction, the immediate, the nested callback, and the timer after them`,
      ranAsJournaled(report, expected, name)));
  }
  rows.push(row("promise/A Promise reaction that throws, a rejection nobody handles and an async function that throws reach no host: nothing is reported, logged or recorded",
    nothingReported(report, "promise")));
  const lost = (tracked.unhandled ?? []).filter(entry => entry.message === "js-exceptions tracked/unhandled");
  rows.push(row("promise/The reactions ran in order and the catch ran; Hermes tracks a rejection only when told to, and then reports the unhandled one, and the late handler of it",
    ranAsJournaled(report, expected, "promise") && tracked.enabled === true && (tracked.unhandled ?? []).length === 1 && lost.length === 1 && (tracked.handled ?? []).length === 1
      && tracked.handled[0].id === lost[0].id));
  const retryDescription = "A microtask that queues itself and throws every time is cut after RN's 255 retries and reported as \"Hits microtasks retries bound.\"; the rest of the chain runs in the next checkpoint";
  for (const source of ["evaluate", "timer", "raf"]) {
    const name = `retry-bound-${source}`;
    rows.push(row(`${name}/${retryDescription}`, boundReported(report, expected, name)));
    rows.push(row(`${name}/A timer and a frame callback queued beside the chain run only between checkpoints, after the first one was cut, and the chain completes`,
      besideChain(report, name, "retry", total.retry, expected.retry[name].boundaries)));
  }
  for (const source of ["evaluate", "timer"]) {
    const name = `storm-${source}`;
    rows.push(row(`${name}/A Promise storm of a million reactions is bounded by nothing and reported by nothing: no failure, no log, no bound`, nothingReported(report, name)));
    rows.push(row(`${name}/A timer and a frame callback queued beside the storm run only after the whole chain: RN's event loop is starved for its duration, as the host's is`,
      besideChain(report, name, "storm", total.storm, [total.storm])));
  }
  const stop = stages.stop?.application;
  const rootState = stages.stop?.root;
  rows.push(row("stop/The microtasks pending when the application stops complete in one checkpoint even when one throws: its exception is a fatal error and the ones behind it still run",
    fatalMade(report, expected, "stop") && same(labelsOf(caseOf(report, "stop")), expected.journals.stop)));
  rows.push(row("lifecycle/Stop releases the root, and all native Controls of the root are balanced",
    stop?.stopped === true && stop.rootCount === 0 && rootState?.nativeTags === 0 && (rootState?.creates ?? 0) === (rootState?.deletes ?? -1)));
  const everyCase = Object.entries(stages.cases ?? {}).filter(([name]) => name !== "retry-bound-press");
  const expectedTotal = everyCase.reduce((sum, [, record]) => sum + (record.errors ?? []).length, 0);
  const stopErrors = caseOf(report, "stop")?.errors ?? [];
  rows.push(row("errors/The host recorded a failure for every fatal error of the cases and for nothing else: the application's own list is the cases' failures, in order",
    (stop?.errors ?? []).length === expectedTotal && (stages.beforeStop?.errors ?? []).length === expectedTotal - stopErrors.length));
  const press = caseOf(report, "retry-bound-press");
  rows.push(row("retry-bound-press/RN's own checkpoint, after the press task, reports the same bound the host's does: BOUND failures, \"Hits microtasks retries bound.\", then the rest of the chain",
    boundReported(report, expected, "retry-bound-press")));
  rows.push(row("retry-bound-press/The host's timers and frame callbacks keep running after the scheduler's checkpoint gave up, and the chain completes in the host's checkpoint",
    besideChain(report, "retry-bound-press", "retry", total.retry, expected.retry["retry-bound-press"].boundaries)));
  const second = stages.wedge?.["press-after"];
  rows.push(row("retry-bound-press/The bound that escapes RN's runEventLoop leaves its RuntimeScheduler with a queued task and no scheduled loop, so the next press is never delivered",
    expected.retry["retry-bound-press"].wedges === true && second?.state?.presses === 1 && second?.record?.done === false && second?.record?.entered === false && press != null));
  const wedgeStop = stages.wedge_stop?.application;
  rows.push(row("lifecycle/The application that lost its scheduler still stops, and releases its root", wedgeStop?.stopped === true && wedgeStop.rootCount === 0));
  rows.push(row("report/The callback exceptions report is saved with any normative failure visible", true));
  return rows;
}

// The report judged against RN. It holds only for a report of the current host and SDK: every derived verdict must be true and be the verdict the report gave, and the
// constants and tables the probe judges by must be the ones the model derived.
export function verifyJsExceptionsReport(report, expected) {
  assertFacts(expected);
  const derived = exceptionsDerivedChecks(report, expected);
  assert.deepEqual(derived.map(row => row.name), report.checks.map(row => row.name), "The oracle checks what the probe checks");
  const failing = derived.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual(failing, [], `The oracle fails ${failing.length} check(s), the first of them ${failing[0]}`);
  assert.deepEqual(derived, report.checks, "The oracle derives the verdicts the probe gave");
  // The probe's tables are the model's.
  assert.equal(report.constants.bound, expected.bound);
  assert.equal(report.constants.retryTotal, total.retry);
  assert.equal(report.constants.stormTotal, total.storm);
  assert.deepEqual(report.journals, expected.journals, "The probe judges the journals the model derived");
  assert.deepEqual(report.fatal, expected.fatal, "The probe judges the fatal errors the model derived");
  // The cases that ran are the cases of the list (the press the wedged scheduler never delivers is kept apart, with the wedge lane's own stages).
  assert.deepEqual(sorted(Object.keys(report.stages.cases)), sorted(cases.map(testCase => testCase.name).filter(name => name !== "press-after").concat(["stop"])));
  assert.deepEqual(Object.keys(report.stages.wedge).sort(), ["press-after", "retry-bound-press"]);
  return derived;
}

// The oracle's first complaint about a report whose checks all claim to pass, or null when it accepts it.
export function exceptionsOracleRejection(report, expected) {
  try {
    verifyJsExceptionsReport({...report, checks: report.checks.map(row => ({...row, passed: true}))}, expected);
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}
