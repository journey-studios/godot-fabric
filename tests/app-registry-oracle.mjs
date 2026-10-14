import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";

// The independent oracle of the AppRegistry slice. It shares no code with the fixture, the probe or the facade, and it judges the
// raw report without the probe's verdicts:
//   members   the facade's members are exactly the functions RN's own declaration exports (read from the installed package)
//   script    each row of the fixture's script is replayed against a model of RN's AppRegistryImpl, written from its source,
//             with V2-D01's rule (a key is registered once, whatever the route) added; the model says what each call returns
//             and how it must fail
//   mount     the native Controls of the roots: geometry and colors follow from the styles the providers returned
//   runs      every run of a registered component called each provider and the hook once, RN logged each run, and the root tag
//             in the props, in RootTagContext and in the host's snapshot agree
//   surfaces  a tag no surface owns, and the tag of a stopped root, render nothing and fail with the documented code; the
//             unmount member logs RN's error and unmounts nothing
//   stop      the stopped application holds no root and reported no error
// The strings that RN owns (the log lines, the invariant, the unmount error) are read from AppRegistryImpl.js itself.
const requireRn = createRequire(import.meta.url);
const rnRoot = path.dirname(requireRn.resolve("react-native/package.json"));
const rnSource = readFileSync(path.join(rnRoot, "Libraries/ReactNative/AppRegistryImpl.js"), "utf8");
const declaration = readFileSync(path.join(rnRoot, "types_generated/Libraries/ReactNative/AppRegistryImpl.d.ts"), "utf8");
export const declaredMembers = [...declaration.matchAll(/^export declare function (\w+)/gm)].map(match => match[1]).sort();
const UNMOUNT_ERROR = /'(Unexpected call to unmountApplicationComponentAtRootTag in Fabric\.)'/.exec(rnSource)?.[1];
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);
const HEADLESS = new Set(["registerHeadlessTask", "registerCancellableHeadlessTask", "startHeadlessTask", "cancelHeadlessTask"]);
const isKey = key => typeof key === "string" && key.trim() !== "";
// The fixture writes a function as {provider} or {run}; any other value is not one.
const isFunction = value => value !== null && typeof value === "object" && !Array.isArray(value) && (typeof value.provider === "string" || value.run === "custom");

// RN's registry (AppRegistryImpl.js): one table of runnables and the keys that are sections, in registration order.
function referenceRegistry() {
  const runnables = [];
  const sections = [];
  const refusal = (key, pending = []) => (runnables.includes(key) || RESERVED.has(key) || pending.includes(key) ? {threw: {type: "refused", key}} : null);
  const register = (key, section) => {
    runnables.push(key);
    if (section) {
      sections.push(key);
    }
  };
  const typeError = {threw: {type: "type-error"}};
  const calls = {
    registerComponent: ([key, provider, section]) => {
      if (!isKey(key) || !isFunction(provider)) {
        return typeError;
      }
      return refusal(key) ?? (register(key, section), {returned: key});
    },
    registerSection: ([key, provider]) => {
      if (!isKey(key) || !isFunction(provider)) {
        return typeError;
      }
      return refusal(key) ?? (register(key, true), {returned: null});
    },
    registerRunnable: ([key, run]) => {
      if (!isKey(key) || !isFunction(run)) {
        return typeError;
      }
      return refusal(key) ?? (register(key, false), {returned: key});
    },
    registerConfig: ([config]) => {
      if (!Array.isArray(config)) {
        return typeError;
      }
      const pending = [];
      for (const entry of config) {
        const shaped = entry !== null && typeof entry === "object" && isKey(entry.appKey) && (entry.run == null || isFunction(entry.run))
          && (entry.component == null || isFunction(entry.component));
        if (!shaped) {
          return typeError;
        }
        const refused = refusal(entry.appKey, pending);
        if (refused) {
          return refused;
        }
        pending.push(entry.appKey);
      }
      // AppRegistryImpl.js registerConfig: a run wins, then a component, and neither is an invariant after the entries before it.
      for (const entry of config) {
        if (entry.run) {
          register(entry.appKey, false);
        } else if (entry.component == null) {
          return {threw: {type: "invariant", key: entry.appKey}};
        } else {
          register(entry.appKey, entry.section);
        }
      }
      return {returned: null};
    },
    getAppKeys: () => ({returned: [...runnables]}),
    getSectionKeys: () => ({returned: [...sections]}),
    getSections: () => ({returned: {keys: [...sections], same: sections.map(() => true)}}),
    getRegistry: () => ({returned: {sections: [...sections], runnables: [...runnables], same: runnables.map(() => true)}}),
    getRunnable: ([key]) => ({returned: {type: runnables.includes(key) ? "function" : "undefined"}}),
    copies: () => ({returned: {unchanged: true}}),
  };
  return {runnables, call: (name, args) => (HEADLESS.has(name) ? {threw: {type: "headless", member: name}} : calls[name](args))};
}

function thrownProblem(expected, threw, name) {
  if (expected.type === "type-error") {
    return threw.isTypeError && threw.code === null ? null : "a TypeError was expected";
  }
  if (expected.type === "refused") {
    return (threw.message === `AppRegistry component key is already registered or reserved: ${expected.key}`
      && threw.isError && !threw.isTypeError && threw.code === null) ? null : `the refusal of ${expected.key} was expected`;
  }
  if (expected.type === "invariant") {
    return (threw.name === "Invariant Violation" && threw.message.includes(`\`${expected.key}\` has neither`) && threw.code === null)
      ? null : "RN's invariant was expected";
  }
  return (threw.code === "E_APP_REGISTRY_HEADLESS_TASK" && threw.isError && !threw.isTypeError
    && threw.message.startsWith(`E_APP_REGISTRY_HEADLESS_TASK: AppRegistry.${name} is not implemented`)) ? null : "the typed headless error was expected";
}

const hex = color => `${color.slice(1).toLowerCase()}ff`;
const rootOf = nodes => nodes.find(node => node.testID === "");
const byId = (nodes, id) => nodes.find(node => node.testID === id);
const box = node => (node ? [node.x, node.y, node.width, node.height] : null);
const same = (actual, expected, what) => assert.deepEqual(actual, expected, what);

export const sections = {
  members(report) {
    assert.ok(declaredMembers.length === 19 && declaredMembers.includes("registerComponent"), "RN declares nineteen members");
    same(report.stages.initial.members, declaredMembers, "the facade exposes exactly the members RN declares");
    assert.ok(report.stages.initial.frozen);
    for (const name of declaredMembers) {
      assert.equal(report.stages.initial.memberTypes[name], "function", name);
    }
  },
  script(report) {
    const model = referenceRegistry();
    for (const row of report.stages.script) {
      const expected = model.call(row.call, row.args);
      if (expected.threw) {
        assert.ok(row.threw && row.returned === undefined, `${row.id}: it must fail`);
        const problem = thrownProblem(expected.threw, row.threw, row.call);
        assert.equal(problem, null, `${row.id}: ${problem}`);
      } else {
        assert.ok(row.threw === undefined, `${row.id}: it must not fail (${row.threw?.message})`);
        same(row.returned, expected.returned, `${row.id}: what it returns`);
      }
    }
    assert.ok(report.stages.script.length > 30);
  },
  mount(report) {
    const {surface} = report.stages.final;
    const before = report.stages.mountA.nodes;
    const content = byId(before, "registry-content");
    same(box(rootOf(before)), [0, 0, surface.width, surface.height], "RN's default root fills the surface");
    assert.equal(rootOf(before).appearance.background, "00000000", "the default root has no background");
    assert.equal(byId(before, "registry-wrapper"), undefined);
    same(box(content), [0, 0, content.width, content.height]);
    const {rootStyle, wrapperStyle} = report.stages.install;
    const after = report.stages.mountB.nodes;
    const outer = rootStyle.padding;
    same(box(rootOf(after)), [0, 0, surface.width, surface.height]);
    assert.equal(rootOf(after).appearance.background, hex(rootStyle.backgroundColor), "the style provider's background");
    same(rootOf(after).appearance.cornerRadii, Array(4).fill(rootStyle.borderRadius), "the style provider's radius");
    same(box(byId(after, "registry-wrapper")), [outer, outer, surface.width - 2 * outer, surface.height - 2 * outer], "the wrapper inside the root's padding");
    assert.equal(byId(after, "registry-wrapper").appearance.background, hex(wrapperStyle.backgroundColor));
    same(box(byId(after, "registry-content")), [outer + wrapperStyle.padding, outer + wrapperStyle.padding, content.width, content.height],
      "the content inside the wrapper's padding");
    const rerun = report.stages.rerunA.nodes;
    assert.ok(byId(rerun, "registry-wrapper") && rootOf(rerun).appearance.background === hex(rootStyle.backgroundColor), "a running root takes the providers at its next run");
  },
  runs(report) {
    const {snapshot, tags} = report.stages.final;
    const {mark} = report.stages.install;
    const registered = new Set(snapshot.keys);
    const owned = Object.values(tags);
    assert.ok(owned.every(tag => Number.isInteger(tag) && tag > 0 && tag % 10 === 1), "RN's root tags end in 1");
    assert.equal(new Set(owned).size, owned.length, "every surface has its own tag");
    // AppRegistryImpl.js: runApplication logs `Running "<key>"`, setSurfaceProps `Updating props for Surface "<key>" with <json>`.
    assert.ok(rnSource.includes("`Running \"${appKey}\"${logParams}`") && rnSource.includes("'Updating props for Surface \"'"));
    const runs = snapshot.logs.map(line => {
      const found = /^Running "(.+)"$/.exec(line) ?? /^Updating props for Surface "(.+)" with (.+)$/.exec(line);
      assert.ok(found, `an RN log line: ${line}`);
      return {key: found[1], payload: found[2] === undefined ? null : JSON.parse(found[2])};
    });
    const later = runs.slice(mark.logs).filter(run => registered.has(run.key));
    const {wrapper, style, hook, instrumentedRenders} = snapshot.calls;
    same([wrapper.length, style.length, hook.length], [later.length, later.length, later.length], "each run after the providers called each of them once");
    assert.ok(wrapper.every(call => registered.has(call.appKey) && owned.includes(call.rootTag) && call.initialProps !== null));
    assert.ok(style.every(call => owned.includes(call.rootTag)));
    assert.ok(runs.filter(run => run.payload !== null).every(run => owned.includes(run.payload.rootTag)), "an update names the root it updates");
    for (const render of snapshot.renders) {
      assert.ok(owned.includes(render.rootTagProp) && render.rootTagContext === render.rootTagProp, "the tag in the props and in RootTagContext");
      assert.deepEqual(render.props, ["label", "rootTag"]);
    }
    const counters = snapshot.renders.filter(render => render.component === "Counter");
    assert.equal(new Set(counters.map(render => render.instance)).size, 1, "setSurfaceProps and runApplication keep the component's state");
    assert.ok(counters.every(render => render.rootTagProp === tags.B));
    assert.ok(instrumentedRenders.length > 0 && instrumentedRenders.every(entry => entry.label !== null), "the hook's component rendered the roots after it was set");
    assert.ok(hook.every(call => call.providerType === "function" && call.loggerType === "object"));
    // The scenario updates root B by setSurfaceProps (B2), runApplication (B3), the host (B4) and setSurfaceProps again (B6); B5 asked
    // for a suspended display mode and was refused, so it never rendered.
    same(counters.map(render => render.label), ["B", "B2", "B3", "B4", "B6"], "the labels follow the updates in order");
  },
  surfaces(report) {
    const {tags, snapshot} = report.stages.final;
    const unknown = report.stages.unknownRoot;
    for (const result of [unknown.run, unknown.props, report.stages.stopA.stale]) {
      assert.ok(result.threw && result.threw.code === "E_APP_REGISTRY_UNKNOWN_ROOT" && result.threw.isError && result.threw.message.startsWith("E_APP_REGISTRY_UNKNOWN_ROOT: "),
        "a tag no surface owns fails with the documented code");
    }
    assert.equal(unknown.snapshot.renders.length, unknown.rendersBefore, "nothing rendered for the unknown tag");
    assert.equal(report.stages.stopA.rendersAfter, report.stages.stopA.rendersBefore, "nothing rendered for the stopped root's tag");
    assert.ok(snapshot.renders.every(render => Object.values(tags).includes(render.rootTagProp)), "no component ever rendered for a tag the host did not give");
    assert.ok(UNMOUNT_ERROR !== undefined);
    const unmount = report.stages.unmountApi;
    same(unmount.result.errors, [UNMOUNT_ERROR], "RN's Fabric logs an error for the unmount");
    assert.ok(unmount.result.threw === undefined && unmount.nodes.length > 0, "and unmounts nothing");
    same(snapshot.errors, [UNMOUNT_ERROR], "that is the only error RN logged");
    same(snapshot.warnings, [], "RN warned of nothing");
  },
  stop(report) {
    const {rootCount, tags} = report.stages.final;
    assert.equal(rootCount, Object.keys(tags).length - 1, "one root was stopped");
    const {application} = report.stages.stop;
    assert.ok(application.stopped && application.rootCount === 0 && application.errors.length === 0);
    const effects = report.stages.final.snapshot.effects.filter(effect => effect.component === "Plain" && ["A", "A2"].includes(effect.label));
    same(effects.map(effect => effect.event), ["mount", "cleanup", "mount", "cleanup"], "the stopped root's content ran its cleanup");
  },
};

export function oracleRejections(report) {
  return Object.fromEntries(Object.entries(sections).map(([name, judge]) => {
    try {
      judge(report);
      return [name, null];
    } catch (error) {
      return [name, String(error.message).split("\n")[0]];
    }
  }));
}

export function verifyAppRegistryReport(report) {
  const rejected = Object.entries(oracleRejections(report)).filter(([, reason]) => reason !== null);
  assert.deepEqual(rejected, [], "the oracle accepts every section");
}
