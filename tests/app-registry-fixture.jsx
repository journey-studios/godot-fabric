import React, {useContext, useEffect, useState} from "react";
import {AppRegistry, RootTagContext, View} from "react-native";

// Records what JS observes of the public AppRegistry facade. A deterministic script of registry calls runs at bundle
// evaluation (before any root exists) and records each outcome; the roots the probe then mounts render the components below
// and report what the providers, the instrumentation hook and the runnables received. Everything is read through the public
// react-native import; RN's own log and error lines are captured from the console the host installs.
const members = Object.keys(AppRegistry).sort();
const frozen = Object.isFrozen(AppRegistry);
const memberTypes = Object.fromEntries(members.map(name => [name, typeof AppRegistry[name]]));
const keysAtEvaluation = [...AppRegistry.getAppKeys()];

const renders = [];
const effects = [];
const calls = {wrapper: [], style: [], hook: [], run: [], wrapperRenders: [], instrumentedRenders: []};
const logs = [];
const warnings = [];
const errors = [];
let instances = 0;

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
console.log = (...args) => {
  logs.push(args.join(" "));
  originalLog(...args);
};
console.warn = (...args) => {
  warnings.push(args.join(" "));
  originalWarn(...args);
};
console.error = (...args) => {
  errors.push(args.join(" "));
  originalError(...args);
};

function Plain(props) {
  const tag = useContext(RootTagContext);
  useEffect(() => {
    effects.push({component: "Plain", label: props.label, event: "mount"});
    return () => effects.push({component: "Plain", label: props.label, event: "cleanup"});
  }, []);
  renders.push({component: "Plain", instance: 0, label: props.label ?? null, rootTagProp: props.rootTag, rootTagContext: tag,
    props: Object.keys(props).sort()});
  return <View testID="registry-content" style={{width: 100, height: 40, backgroundColor: "#2563eb"}} />;
}

// State survives setSurfaceProps: `instance` changes only when React mounts the component again.
function Counter(props) {
  const tag = useContext(RootTagContext);
  const [instance] = useState(() => ++instances);
  useEffect(() => {
    effects.push({component: "Counter", label: props.label, event: "mount", instance});
    return () => effects.push({component: "Counter", label: props.label, event: "cleanup", instance});
  }, []);
  renders.push({component: "Counter", instance, label: props.label ?? null, rootTagProp: props.rootTag, rootTagContext: tag,
    props: Object.keys(props).sort()});
  return <View testID="registry-content" style={{width: 100, height: 40, backgroundColor: "#16a34a"}} />;
}

// A runnable that mounts nothing itself: it records what the host passes and hands the same parameters to a registered
// component's runnable, so the providers still apply.
function custom(appParameters, displayMode) {
  calls.run.push({rootTag: appParameters.rootTag, initialProps: appParameters.initialProps ?? null, fabric: appParameters.fabric ?? null,
    displayMode});
  AppRegistry.getRunnable("Plain")(appParameters, displayMode);
}

const provider = {plain: () => Plain, counter: () => Counter};
const resolve = value => {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.provider === "string") {
      return provider[value.provider];
    }
    if (value.run === "custom") {
      return custom;
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolve(entry)]));
  }
  return Array.isArray(value) ? value.map(resolve) : value;
};
const plain = {provider: "plain"};
const counter = {provider: "counter"};
const run = {run: "custom"};

function outcome(callback) {
  try {
    return {returned: callback() ?? null};
  } catch (error) {
    return {threw: {name: error?.name ?? null, code: error?.code ?? null, message: String(error?.message ?? error),
      isError: error instanceof Error, isTypeError: error instanceof TypeError}};
  }
}

// Reads of the registry, as plain data. The identity checks say whether a map holds the very function the registry answers.
const queries = {
  getAppKeys: () => [...AppRegistry.getAppKeys()],
  getSectionKeys: () => [...AppRegistry.getSectionKeys()],
  getSections: () => {
    const sections = AppRegistry.getSections();
    return {keys: Object.keys(sections), same: Object.keys(sections).map(key => sections[key] === AppRegistry.getRunnable(key))};
  },
  getRegistry: () => {
    const registry = AppRegistry.getRegistry();
    return {sections: [...registry.sections], runnables: Object.keys(registry.runnables),
      same: Object.keys(registry.runnables).map(key => registry.runnables[key] === AppRegistry.getRunnable(key))};
  },
  getRunnable: key => {
    const found = AppRegistry.getRunnable(key);
    return {type: typeof found};
  },
  // The answers are copies: changing them changes nothing the registry holds.
  copies: () => {
    const before = [AppRegistry.getAppKeys().length, AppRegistry.getSectionKeys().length, Object.keys(AppRegistry.getSections()).length,
      AppRegistry.getRegistry().sections.length, Object.keys(AppRegistry.getRegistry().runnables).length];
    const sections = AppRegistry.getSections();
    delete sections[Object.keys(sections)[0]];
    const registry = AppRegistry.getRegistry();
    registry.sections.push("Injected");
    delete registry.runnables[Object.keys(registry.runnables)[0]];
    const after = [AppRegistry.getAppKeys().length, AppRegistry.getSectionKeys().length, Object.keys(AppRegistry.getSections()).length,
      AppRegistry.getRegistry().sections.length, Object.keys(AppRegistry.getRegistry().runnables).length];
    return {unchanged: before.join() === after.join()};
  },
};

// The script: each row is data, so the independent oracle replays the very same rows against its own model of RN's registry.
const SCRIPT = [
  {id: "reg-plain", call: "registerComponent", args: ["Plain", plain]},
  {id: "reg-counter", call: "registerComponent", args: ["Counter", counter, false]},
  {id: "reg-menu", call: "registerSection", args: ["Menu", plain]},
  {id: "reg-hub", call: "registerComponent", args: ["Hub", plain, true]},
  {id: "reg-custom", call: "registerRunnable", args: ["Custom", run]},
  {id: "reg-config", call: "registerConfig", args: [[{appKey: "CfgComponent", component: plain}, {appKey: "CfgRun", run},
    {appKey: "CfgSection", component: plain, section: true}]]},
  {id: "reg-config-partial", call: "registerConfig", args: [[{appKey: "Early", component: plain}, {appKey: "Neither"}]]},
  {id: "keys", query: "getAppKeys", args: []},
  {id: "section-keys", query: "getSectionKeys", args: []},
  {id: "sections", query: "getSections", args: []},
  {id: "registry", query: "getRegistry", args: []},
  {id: "runnable-plain", query: "getRunnable", args: ["Plain"]},
  {id: "runnable-section", query: "getRunnable", args: ["Menu"]},
  {id: "runnable-missing", query: "getRunnable", args: ["Missing"]},
  {id: "runnable-inherited", query: "getRunnable", args: ["toString"]},
  {id: "copies", query: "copies", args: []},
  {id: "dup-component", call: "registerComponent", args: ["Plain", plain]},
  {id: "dup-section", call: "registerSection", args: ["Plain", plain]},
  {id: "dup-runnable", call: "registerRunnable", args: ["Plain", run]},
  {id: "dup-config", call: "registerConfig", args: [[{appKey: "Plain", component: plain}]]},
  {id: "dup-config-twice", call: "registerConfig", args: [[{appKey: "Twice", component: plain}, {appKey: "Twice", component: plain}]]},
  {id: "dup-section-flag", call: "registerComponent", args: ["Menu", plain, true]},
  {id: "reserved-component", call: "registerComponent", args: ["__proto__", plain]},
  {id: "reserved-runnable", call: "registerRunnable", args: ["constructor", run]},
  {id: "reserved-section", call: "registerSection", args: ["prototype", plain]},
  {id: "reserved-config", call: "registerConfig", args: [[{appKey: "__proto__", component: plain}]]},
  {id: "empty-key", call: "registerComponent", args: ["", plain]},
  {id: "blank-key", call: "registerComponent", args: ["  ", plain]},
  {id: "number-key", call: "registerComponent", args: [3, plain]},
  {id: "no-provider", call: "registerComponent", args: ["NoProvider", "provider"]},
  {id: "no-run", call: "registerRunnable", args: ["NoRun", null]},
  {id: "config-not-array", call: "registerConfig", args: [{}]},
  {id: "config-bad-entry", call: "registerConfig", args: [[null]]},
  {id: "keys-after-refusals", query: "getAppKeys", args: []},
  {id: "headless-register", call: "registerHeadlessTask", args: ["task", plain]},
  {id: "headless-register-cancellable", call: "registerCancellableHeadlessTask", args: ["task", plain, plain]},
  {id: "headless-start", call: "startHeadlessTask", args: [1, "task", {}]},
  {id: "headless-cancel", call: "cancelHeadlessTask", args: [1, "task"]},
  {id: "keys-after-headless", query: "getAppKeys", args: []},
];

const executed = SCRIPT.map(row => {
  const args = resolve(row.args);
  const result = row.query
    ? outcome(() => queries[row.query](...args))
    : outcome(() => AppRegistry[row.call](...args));
  return {id: row.id, call: row.call ?? row.query, query: row.query !== undefined, args: row.args, ...result};
});

// The providers the probe installs after the first root: a wrapper, a root view style and an instrumentation hook.
const rootStyle = {flex: 1, padding: 8, backgroundColor: "#0f172a", borderRadius: 12};
const wrapperStyle = {flex: 1, padding: 6, backgroundColor: "#1e293b"};
function Wrapper({children, initialProps}) {
  calls.wrapperRenders.push({label: initialProps?.label ?? null, keys: Object.keys(initialProps ?? {}).sort()});
  return <View testID="registry-wrapper" style={wrapperStyle}>{children}</View>;
}
// The hook keeps one wrapping component for each component it is given: a new one on every run would remount the root.
const instrumented = new Map();
function hook(componentProvider, logger) {
  calls.hook.push({providerType: typeof componentProvider, loggerType: typeof logger, loggerHasGetExtras: typeof logger?.getExtras === "function"});
  const Inner = componentProvider();
  if (!instrumented.has(Inner)) {
    instrumented.set(Inner, function Instrumented(props) {
      calls.instrumentedRenders.push({inner: Inner === Plain ? "Plain" : "Counter", label: props.label ?? null});
      return <Inner {...props} />;
    });
  }
  return instrumented.get(Inner);
}

const reply = value => JSON.parse(JSON.stringify(value));
globalThis.AppRegistryProbe = {
  initial() {
    return reply({members, frozen, memberTypes, keysAtEvaluation});
  },
  script() {
    return reply(executed);
  },
  snapshot() {
    return reply({renders, effects, calls, logs, warnings, errors, keys: AppRegistry.getAppKeys()});
  },
  install() {
    AppRegistry.setWrapperComponentProvider((appParameters, appKey) => {
      calls.wrapper.push({appKey, rootTag: appParameters.rootTag, initialProps: appParameters.initialProps ?? null});
      return Wrapper;
    });
    AppRegistry.setRootViewStyleProvider(appParameters => {
      calls.style.push({rootTag: appParameters.rootTag});
      return rootStyle;
    });
    AppRegistry.setComponentProviderInstrumentationHook(hook);
    return reply({rootStyle, wrapperStyle, mark: {logs: logs.length, renders: renders.length}});
  },
  // Registers after the roots exist, as the host does for a later bundle section.
  late(key) {
    return reply(outcome(() => AppRegistry.registerComponent(key, () => Plain)));
  },
  // The JS side of the surface members, called with the tag the host gave the root.
  setProps(key, rootTag, initialProps, displayMode) {
    return reply(outcome(() => AppRegistry.setSurfaceProps(key, {rootTag, initialProps}, displayMode)));
  },
  runApp(key, rootTag, initialProps) {
    return reply(outcome(() => AppRegistry.runApplication(key, {rootTag, initialProps})));
  },
  unmount(rootTag) {
    const seen = errors.length;
    const result = outcome(() => AppRegistry.unmountApplicationComponentAtRootTag(rootTag));
    return reply({...result, errors: errors.slice(seen)});
  },
};
