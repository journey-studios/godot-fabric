// Executable in the actual Hermes application, never in a mocked JS runtime.
import { NativeModules, TurboModuleRegistry as Registry, NativeEventEmitter, AppRegistry } from "react-native";
import registerCallableModule from "react-native/Libraries/Core/registerCallableModule";

const result = { checks: [], typed: [], legacy: [], promises: [], callable: [], factories: 0,
  replacementFactories: 0, registeredAfterInvocation: false };
function verify(condition, name) {
  result.checks.push({ name, passed: Boolean(condition) });
  if (!condition) throw new Error(`TURBO_MODULE_CHECK_FAILED: ${name}`);
}
function rejects(callback, expected, name) {
  let message = "";
  try { callback(); } catch (error) { message = error.message; }
  verify(message.includes(expected), name);
}

verify(Registry.get("MissingGodotFixture") === null, "Upstream get returns null for missing modules");
verify(NativeModules.MissingGodotFixture === null, "Original NativeModules reads the missing native JSI provider");
rejects(() => Registry.getEnforcing("MissingGodotFixture"), "could not be found", "Upstream getEnforcing reports missing modules");

const sourceCode = Registry.getEnforcing("SourceCode");
const retainedSourceCodeMethod = sourceCode.getConstants;
verify(sourceCode === NativeModules.SourceCode, "Public NativeModules and TurboModuleRegistry share the SourceCode provider");
result.sourceCode = sourceCode.getConstants();
verify(typeof result.sourceCode.scriptURL === "string" && result.sourceCode.scriptURL.length > 0 &&
  sourceCode.getConstants().scriptURL === result.sourceCode.scriptURL,
  "Generated SourceCode contract returns the application's real bundle URL");
const NativeFeatureFlags = Registry.getEnforcing("NativeReactNativeFeatureFlagsCxx");
verify(NativeFeatureFlags === NativeModules.NativeReactNativeFeatureFlagsCxx,
  "Public NativeModules and TurboModuleRegistry share the original C++ feature flag module");
result.featureFlags = {
  commonTestFlag: NativeFeatureFlags.commonTestFlag(),
  preparedTextCacheSize: NativeFeatureFlags.preparedTextCacheSize(),
};
verify(result.featureFlags.commonTestFlag === false && result.featureFlags.preparedTextCacheSize === 200,
  "Original generated feature flag methods return the pinned upstream boolean and numeric defaults");

const module = Registry.getEnforcing("GodotFabricNativeFixture");
const retainedMethod = module.add;
verify(module === Registry.getEnforcing("GodotFabricNativeFixture") && module === NativeModules.GodotFabricNativeFixture,
  "TurboModuleRegistry and NativeModules share one lazy native module identity");
result.constants = module.getConstants();
verify(result.constants.apiVersion === 1 && typeof result.constants.runtimeId === "string" &&
  result.constants.implementation === "upstream-cxx-turbomodule", "Native constants identify the runtime and concrete C++ implementation");
verify(module.add(19, 23) === 42, "Native synchronous invocation returns its result");
verify(module.unregisteredMethod === undefined, "Original TurboModule returns undefined for unregistered properties");
rejects(() => module.add(1, "2"), "E_ARGUMENT", "Native argument validation rejects invalid types");
rejects(() => module.add(Number.MAX_VALUE, Number.MAX_VALUE), "E_ARGUMENT", "Native argument validation rejects overflowing numeric results");
rejects(() => module.failSync(), "E_FIXTURE_SYNC", "Native synchronous exceptions reach JavaScript");

let completed = false;
module.addAsync(19, 23).then((value) => {
  completed = true;
  result.promises.push({ kind: "fulfilled", value });
});
verify(!completed, "Native asynchronous operation does not settle reentrantly");
module.failAsync().then(
  () => result.promises.push({ kind: "unexpected-success" }),
  (error) => result.promises.push({ kind: "rejected", message: error.message }),
);

const typed = module.onValue((value) => result.typed.push(value));
module.emitValue(11);
module.emitValue(12);
verify(result.typed.length === 0, "Typed native events enter RN's executor without reentrant listeners");

const emitter = new NativeEventEmitter(module);
const legacy = emitter.addListener("GodotFabricNativeFixture.value", (value) => result.legacy.push(value));
verify(module.getStats().listeners === 1, "Original NativeEventEmitter increments the native listener count");
module.emitLegacy(21);

function unexpectedReplacementFactory() {
  result.replacementFactories++;
  throw new Error("A repeated callable registration replaced the original module");
}
registerCallableModule("GodotFabricFixtureCallable", () => {
  result.factories++;
  return { accept(value) {
    result.callable.push(value);
    if (result.callable.length === 1) {
      registerCallableModule("GodotFabricFixtureCallable", unexpectedReplacementFactory);
      result.registeredAfterInvocation = true;
    }
  } };
});
verify(result.factories === 0, "Original registerCallableModule preserves lazy callable factories");
registerCallableModule("GodotFabricFixtureCallable", unexpectedReplacementFactory);
verify(result.factories === 0 && result.replacementFactories === 0,
  "Repeated callable registration before invocation preserves the first lazy factory");

AppRegistry.registerComponent("NativeModulesFixture", () => function NativeModulesFixture() { return null; });
globalThis.NativeModuleFixture = {
  stats() { return { ...result, native: module.getStats() }; },
  setValue(value) { module.emitValue(value); },
  afterDelivery() {
    verify(result.typed.join(",") === "11,12", "Two typed native events preserve emission order");
    verify(result.legacy.join(",") === "21", "NativeEventEmitter receives its original device-emitter payload");
    verify(result.promises.some((event) => event.kind === "fulfilled" && event.value === 42), "Native Promise fulfills through the upstream async bridge");
    verify(result.promises.some((event) => event.kind === "rejected" && event.message.includes("E_FIXTURE_ASYNC")), "Native Promise rejects with a distinguishable error");
    typed.remove();
    typed.remove();
    legacy.remove();
    legacy.remove();
    verify(module.getStats().listeners === 0, "Double subscription cleanup is idempotent and releases native listeners");
    module.emitValue(13);
    module.emitLegacy(22);
  },
  afterRemoval() {
    verify(result.typed.join(",") === "11,12" && result.legacy.join(",") === "21", "Removed listeners do not receive subsequent native events");
    verify(result.factories === 1 && result.callable.join(",") === "31,32", "Native callable invocation constructs once and preserves ordered arguments");
    verify(result.registeredAfterInvocation && result.replacementFactories === 0,
      "Repeated callable registration after invocation preserves the resolved module without calling a replacement factory");
  },
  dispose() {
    const cachedSubscribe = module.onValue;
    const late = module.onValue((value) => result.typed.push(value));
    const lateLegacy = emitter.addListener("GodotFabricNativeFixture.value", (value) => result.legacy.push(value));
    module.emitValue(99);
    module.emitLegacy(99);
    module.addAsync(1, 2).then(
      () => result.promises.push({ kind: "unexpected-after-dispose" }),
      (error) => result.promises.push({ kind: "disposed", message: error.message }),
    );
    module.dispose();
    module.dispose();
    late.remove();
    lateLegacy.remove();
    lateLegacy.remove();
    verify(emitter.listenerCount("GodotFabricNativeFixture.value") === 0,
      "Legacy cleanup after native disposal is idempotent and releases the JS subscription");
    rejects(() => module.add(1, 2), "E_MODULE_DISPOSED", "Cached native method rejects after module disposal");
    rejects(() => cachedSubscribe(() => {}), "E_MODULE_DISPOSED", "Cached typed subscription factory rejects after module disposal");
  },
  afterDisposal() {
    verify(!result.typed.includes(99) && !result.legacy.includes(99), "Queued typed and legacy native events cannot cross module disposal");
    verify(result.promises.some((event) => event.kind === "disposed" && event.message.includes("E_MODULE_DISPOSED")), "Accepted pending operation rejects when its native module is disposed");
  },
  // Disposal checks need stats after the fixture method guard has closed.
  report() { return { ...result }; },
  retainedMethod() { return retainedMethod(1, 2); },
  retainedSourceCodeMethod() { return retainedSourceCodeMethod(); },
};
