import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { REQUIRED_DECISIONS, STATUSES, checkBootstrapAudit, metroPolyfills } from "../scripts/bootstrap-audit.mjs";
import { scanBootstrap } from "../scripts/parity-upstream-scan.mjs";
import { METRO_POLYFILLS, metroPolyfills as injectInputs } from "../sdk/toolchain/metro-polyfills.mjs";

// GF-05 slice A. docs/compatibility/bootstrap-audit-0.87.1.json says, step by step, what replaces each module of RN's InitializeCore
// chain. This gate fails when the pinned chain and the audit disagree, when the evidence the audit cites is stale, and when a step
// has no status or no reason. The mutation tests below prove each failure mode on a copy of the real inputs.

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => {
  const full = path.join(root, file);
  return existsSync(full) ? readFileSync(full, "utf8") : undefined;
};

let inputs;
before(() => {
  const upstream = path.join(root, "node_modules/react-native");
  inputs = {
    audit: JSON.parse(read("docs/compatibility/bootstrap-audit-0.87.1.json")),
    scan: scanBootstrap({ ts, upstream }),
    polyfills: metroPolyfills(ts, read("node_modules/@react-native/js-polyfills/index.js")),
    version: JSON.parse(read("node_modules/react-native/package.json")).version,
    tasks: new Set(JSON.parse(read("dashboard/migration.json")).tasks.map((task) => task.id)),
    ts,
    readSource: read,
  };
});

// A mutation changes a copy of one input and returns the gate's issues; the committed inputs are never touched.
const mutate = (change) => {
  const copy = { ...inputs, audit: structuredClone(inputs.audit), scan: structuredClone(inputs.scan), polyfills: [...inputs.polyfills] };
  const replaced = change(copy);
  return checkBootstrapAudit(replaced ?? copy);
};
const step = (copy, file) => copy.audit.steps.find((entry) => entry.file === file);
const part = (copy, file, name) => step(copy, file).parts.find((entry) => entry.name === name);
const mentions = (issues, ...fragments) => issues.some((line) => fragments.every((fragment) => line.includes(fragment)));
const explain = (issues) => `${issues.length} issue(s):\n${issues.join("\n")}`;

const TIMERS = "Libraries/Core/setUpTimers.js";
const XHR = "Libraries/Core/setUpXHR.js";
const GLOBALS = "Libraries/Core/setUpGlobals.js";
const NAVIGATOR = "Libraries/Core/setUpNavigator.js";
const DOM = "src/private/setup/setUpDOM.js";
const ERROR_HANDLING = "Libraries/Core/setUpErrorHandling.js";
// Slice C made the last two pending steps run. The mutations below that need a pending entry make one of a not-applicable step.
const ALERT = "Libraries/Core/setUpAlert.js";
const toPending = (copy, file, slice = "D2") => {
  const entry = step(copy, file);
  delete entry.owner;
  Object.assign(entry, { status: "pending", slice });
};
const POLYFILL_LIST = "sdk/toolchain/metro-polyfills.mjs";
const CONSOLE = "@react-native/js-polyfills/console.js";
const ERROR_GUARD = "@react-native/js-polyfills/error-guard.js";
const polyfill = (copy, file) => copy.audit.polyfills.find((entry) => entry.file === file);
// A copy of the toolchain's polyfill list with another list of polyfills in it.
const listing = (files) => `export const METRO_POLYFILLS = [${files.map((file) => JSON.stringify(file)).join(", ")}];\n`;

test("the committed audit matches RN's pinned chain and every piece of evidence it cites", () => {
  const issues = checkBootstrapAudit(inputs);
  assert.deepEqual(issues, [], explain(issues));
});

test("the audit covers the whole pinned chain, the Metro polyfills and the user's decisions of 2026-10-13", () => {
  const { audit, scan } = inputs;
  assert.deepEqual(audit.steps.map((entry) => entry.file), scan.steps.map((entry) => entry.file));
  assert.deepEqual(audit.polyfills.map((entry) => entry.file), inputs.polyfills);
  const statusOf = (entry) => entry.status ?? entry.parts.map((each) => each.status);
  for (const status of audit.steps.flatMap((entry) => [statusOf(entry)].flat())) {
    assert.ok(STATUSES.includes(status), status);
  }
  assert.deepEqual(REQUIRED_DECISIONS.filter((id) => !audit.decisions.some((decision) => decision.id === id)), []);
  // The decisions land where they apply: performance on setUpPerformance, the classes on its modern branch, and encoding and
  // starvation on the slices that probe and measure them.
  const byId = new Map(audit.decisions.map((decision) => [decision.id, decision]));
  assert.equal(byId.get("performance-classes").scope, "post_1_0");
  assert.equal(byId.get("performance-classes").globals.length, 11);
  assert.equal(byId.get("performance-classes").parityGap, true);
  assert.equal(byId.get("encoding").slice, "E");
  assert.equal(byId.get("starvation").slice, "F");
  assert.equal(step({ audit }, "Libraries/Core/setUpPerformance.js").decision, "performance");
  assert.equal(step({ audit }, "src/private/setup/setUpPerformanceModern.js").decision, "performance-classes");
});

test("the polyfills the toolchain injects are the ones the audit marks runs, resolved to RN's own files", () => {
  assert.deepEqual(METRO_POLYFILLS, inputs.audit.polyfills.filter((entry) => entry.status === "runs").map((entry) => entry.file));
  const resolve = (specifier) => path.join(root, "node_modules", specifier);
  assert.deepEqual(injectInputs(resolve), METRO_POLYFILLS.map(resolve));
  for (const file of injectInputs(resolve)) {
    assert.ok(existsSync(file), file);
  }
});

test("fails when RN's chain gains a step the audit does not list", () => {
  const issues = mutate((copy) => {
    copy.scan.steps.splice(5, 0, { file: "Libraries/Core/setUpFutureThing.js", role: "installer", installer: "Libraries/Core/setUpFutureThing.js", gates: [], globals: ["futureThing"] });
  });
  assert.ok(mentions(issues, "setUpFutureThing.js", "does not list it"), explain(issues));
});

test("fails when RN's chain loses a step the audit lists", () => {
  const issues = mutate((copy) => {
    copy.scan.steps = copy.scan.steps.filter((entry) => entry.file !== NAVIGATOR);
  });
  assert.ok(mentions(issues, NAVIGATOR, "no longer has it"), explain(issues));
});

test("fails when RN renames a step", () => {
  const issues = mutate((copy) => {
    copy.scan.steps.find((entry) => entry.file === NAVIGATOR).file = "Libraries/Core/setUpBrowserNavigator.js";
  });
  assert.ok(mentions(issues, "setUpBrowserNavigator.js", "does not list it"), explain(issues));
  assert.ok(mentions(issues, NAVIGATOR, "no longer has it"), explain(issues));
});

test("fails when RN reorders the chain", () => {
  const issues = mutate((copy) => {
    const [first, second] = copy.scan.steps.filter((entry) => entry.role === "installer");
    const firstAt = copy.scan.steps.indexOf(first);
    const secondAt = copy.scan.steps.indexOf(second);
    copy.scan.steps[firstAt] = second;
    copy.scan.steps[secondAt] = first;
  });
  assert.ok(mentions(issues, "order"), explain(issues));
});

test("fails when a condition around a step changes", () => {
  const issues = mutate((copy) => {
    copy.scan.steps.find((entry) => entry.file === "Libraries/Core/setUpDeveloperTools.js").gates = [];
  });
  assert.ok(mentions(issues, "setUpDeveloperTools.js", "conditions around it changed"), explain(issues));
});

test("fails when a step changes its role", () => {
  const issues = mutate((copy) => {
    copy.scan.steps.find((entry) => entry.file === NAVIGATOR).role = "nested";
  });
  assert.ok(mentions(issues, NAVIGATOR, "RN's chain has it as nested"), explain(issues));
});

test("fails when a step installs a global the audit does not list", () => {
  const single = mutate((copy) => {
    copy.scan.steps.find((entry) => entry.file === NAVIGATOR).globals.push("navigator.language");
  });
  assert.ok(mentions(single, NAVIGATOR, "not listed: navigator.language"), explain(single));
  const split = mutate((copy) => {
    copy.scan.steps.find((entry) => entry.file === TIMERS).globals.push("setAnimationFrameTimeout");
  });
  assert.ok(mentions(split, TIMERS, "not covered: setAnimationFrameTimeout"), explain(split));
});

test("fails when the audit lists a global the step does not install", () => {
  const issues = mutate((copy) => {
    step(copy, NAVIGATOR).globals.push("navigator.userAgent");
  });
  assert.ok(mentions(issues, NAVIGATOR, "not installed: navigator.userAgent"), explain(issues));
});

test("fails when two parts of a step claim the same global", () => {
  const issues = mutate((copy) => {
    part(copy, TIMERS, "immediate").globals.push("queueMicrotask");
  });
  assert.ok(mentions(issues, "queueMicrotask", "also covered by part"), explain(issues));
});

test("fails when RN moves to another version", () => {
  const issues = mutate((copy) => {
    copy.version = "0.87.2";
  });
  assert.ok(mentions(issues, "audits RN 0.87.1 but the pinned RN is 0.87.2"), explain(issues));
});

test("fails when the audit names another host entry or wrapper than the pinned chain", () => {
  const host = mutate((copy) => {
    copy.audit.derivation.host = "src/bootstrap.js";
  });
  assert.ok(mentions(host, "audit.derivation", "src/initialize.js"), explain(host));
  const wrapper = mutate((copy) => {
    copy.audit.derivation.wrapper = "Libraries/Core/InitializeCore2.js";
  });
  assert.ok(mentions(wrapper, "audit.derivation", "Libraries/Core/InitializeCore.js"), explain(wrapper));
});

test("fails when the Metro polyfills change", () => {
  const added = mutate((copy) => {
    copy.polyfills.push("@react-native/js-polyfills/object-es8.js");
  });
  assert.ok(mentions(added, "object-es8.js", "does not list it"), explain(added));
  const removed = mutate((copy) => {
    copy.polyfills = copy.polyfills.filter((file) => !file.endsWith("error-guard.js"));
  });
  assert.ok(mentions(removed, "error-guard.js", "no longer has it"), explain(removed));
});

test("fails when evidence names a symbol its file no longer holds", () => {
  const issues = mutate((copy) => {
    const evidence = part(copy, TIMERS, "queue-microtask").evidence[0];
    evidence.symbol = "globalThis.queueMicrotaskRenamed";
  });
  assert.ok(mentions(issues, "setUpTimers.js part queue-microtask", "src/runtime.js", "globalThis.queueMicrotaskRenamed"), explain(issues));
});

test("fails when a cited symbol is renamed or removed in its file", () => {
  const renamed = mutate((copy) => {
    copy.readSource = (file) => file === "src/runtime.js" ? read(file).replace("globalThis.queueMicrotask =", "globalThis.enqueueMicrotask =") : read(file);
  });
  assert.ok(mentions(renamed, "part queue-microtask", "src/runtime.js no longer contains", "globalThis.queueMicrotask ="), explain(renamed));
  const removed = mutate((copy) => {
    copy.readSource = (file) => file === "native/application_runtime.cpp" ? read(file).replace("globalThis.__DEV__=false;", "") : read(file);
  });
  assert.ok(mentions(removed, "native/application_runtime.cpp no longer contains", "globalThis.__DEV__=false"), explain(removed));
});

test("does not fail when unrelated code is edited above or around the cited symbols", () => {
  const prefix = "// an unrelated edit\n".repeat(60);
  const issues = mutate((copy) => {
    const edited = ["src/", "native/", "sdk/"];
    copy.readSource = (file) => edited.some((root) => file.startsWith(root)) ? `${prefix}${read(file)}\n// and below\n` : read(file);
  });
  assert.deepEqual(issues, [], explain(issues));
});

test("fails when evidence points at a file that is gone", () => {
  const gone = mutate((copy) => {
    step(copy, "Libraries/Core/polyfillPromise.js").evidence[0].file = "native/no_such_runtime.cpp";
  });
  assert.ok(mentions(gone, "native/no_such_runtime.cpp does not exist"), explain(gone));
});

test("fails when a symbol that occurs several times has no anchor, or its anchor is ambiguous, stale or foreign", () => {
  const bare = mutate((copy) => {
    step(copy, "Libraries/Core/polyfillPromise.js").evidence[1] = { file: "src/runtime.js", symbol: "globalThis" };
  });
  assert.ok(mentions(bare, "src/runtime.js", "occurs", "times; add an anchor"), explain(bare));
  const ambiguous = mutate((copy) => {
    step(copy, "Libraries/Core/polyfillPromise.js").evidence[1] = { file: "src/runtime.js", symbol: "globalThis", anchor: "globalThis" };
  });
  assert.ok(mentions(ambiguous, "the anchor", "is ambiguous", "times"), explain(ambiguous));
  const stale = mutate((copy) => {
    step(copy, "Libraries/Core/polyfillPromise.js").evidence[1] = { file: "src/runtime.js", symbol: "globalThis.queueMicrotask =", anchor: "globalThis.queueMicrotask = gone" };
  });
  assert.ok(mentions(stale, "the anchor", "is no longer in the file"), explain(stale));
  const foreign = mutate((copy) => {
    step(copy, "Libraries/Core/polyfillPromise.js").evidence[1] = { file: "src/runtime.js", symbol: "globalThis.queueMicrotask =", anchor: "globalThis.setImmediate = setImmediate" };
  });
  assert.ok(mentions(foreign, "does not contain the symbol"), explain(foreign));
  const empty = mutate((copy) => {
    step(copy, "Libraries/Core/polyfillPromise.js").evidence[1].anchor = "";
  });
  assert.ok(mentions(empty, "non-empty anchor"), explain(empty));
});

test("the committed evidence that needs an anchor has one, and loses it loudly", () => {
  const issues = mutate((copy) => {
    const item = step(copy, "Libraries/Core/setUpBatchedBridge.js").evidence.find((each) => each.anchor !== undefined);
    assert.ok(item, "setUpBatchedBridge cites an anchored symbol");
    delete item.anchor;
  });
  assert.ok(mentions(issues, "native/turbo_module_registry.cpp", "occurs 2 times; add an anchor"), explain(issues));
});

test("fails when evidence still carries a line number", () => {
  const issues = mutate((copy) => {
    step(copy, "Libraries/Core/polyfillPromise.js").evidence[0].line = 564;
  });
  assert.ok(mentions(issues, "polyfillPromise.js", "unknown field line"), explain(issues));
});

test("fails when a replaced or host step cites no evidence", () => {
  const replaced = mutate((copy) => {
    delete step(copy, "Libraries/ReactNative/AppRegistry.js").evidence;
  });
  assert.ok(mentions(replaced, "AppRegistry.js", "a replaced entry needs evidence"), explain(replaced));
  const hosted = mutate((copy) => {
    step(copy, "Libraries/Core/setUpRegeneratorRuntime.js").evidence = [];
  });
  assert.ok(mentions(hosted, "setUpRegeneratorRuntime.js", "a host entry needs evidence"), explain(hosted));
});

test("fails when a step has no status or an unknown one", () => {
  const missing = mutate((copy) => {
    delete step(copy, NAVIGATOR).status;
  });
  assert.ok(mentions(missing, NAVIGATOR, "status must be one of"), explain(missing));
  const unknown = mutate((copy) => {
    step(copy, NAVIGATOR).status = "done";
  });
  assert.ok(mentions(unknown, NAVIGATOR, "status must be one of"), explain(unknown));
  const inPart = mutate((copy) => {
    delete part(copy, TIMERS, "idle-callbacks").status;
  });
  assert.ok(mentions(inPart, "part idle-callbacks", "status must be one of"), explain(inPart));
});

test("fails when a step has no reason where one is required", () => {
  for (const [file, status] of [[ALERT, "pending"], ["Libraries/ReactNative/AppRegistry.js", "replaced"], ["Libraries/Core/setUpRegeneratorRuntime.js", "host"], ["Libraries/Core/checkNativeVersion.js", "not-applicable"]]) {
    const prepare = (copy) => {
      if (status === "pending") {
        toPending(copy, file);
      }
    };
    const missing = mutate((copy) => {
      prepare(copy);
      delete step(copy, file).reason;
    });
    assert.ok(mentions(missing, file, `a ${status} entry needs a reason`), explain(missing));
    const blank = mutate((copy) => {
      prepare(copy);
      step(copy, file).reason = "   ";
    });
    assert.ok(mentions(blank, file, `a ${status} entry needs a reason`), explain(blank));
  }
  const inPart = mutate((copy) => {
    delete part(copy, TIMERS, "idle-callbacks").reason;
  });
  assert.ok(mentions(inPart, "part idle-callbacks", "a pending entry needs a reason"), explain(inPart));
  const runs = mutate((copy) => {
    delete step(copy, XHR).reason;
  });
  assert.deepEqual(runs, [], "a runs step needs no reason");
});

test("fails when a pending step names a slice that is not in the plan", () => {
  const unknown = mutate((copy) => {
    toPending(copy, ALERT);
    step(copy, ALERT).slice = "Z";
  });
  assert.ok(mentions(unknown, ALERT, "names a slice of the plan"), explain(unknown));
  const none = mutate((copy) => {
    delete part(copy, TIMERS, "idle-callbacks").slice;
  });
  assert.ok(mentions(none, "part idle-callbacks", "names a slice of the plan"), explain(none));
  const misplaced = mutate((copy) => {
    step(copy, "Libraries/Core/checkNativeVersion.js").slice = "B";
  });
  assert.ok(mentions(misplaced, "checkNativeVersion.js", "slice belongs to pending entries"), explain(misplaced));
});

test("fails when a cross reference does not resolve", () => {
  const owner = mutate((copy) => {
    step(copy, "Libraries/Core/checkNativeVersion.js").owner = "GF-99";
  });
  assert.ok(mentions(owner, "checkNativeVersion.js", "owner GF-99"), explain(owner));
  const own = mutate((copy) => {
    step(copy, "Libraries/Core/checkNativeVersion.js").owner = "GF-05";
  });
  assert.ok(mentions(own, "checkNativeVersion.js", "owner GF-05"), explain(own));
  const decision = mutate((copy) => {
    step(copy, "Libraries/Core/setUpPerformance.js").decision = "unrecorded";
  });
  assert.ok(mentions(decision, "setUpPerformance.js", "decision unrecorded is not recorded"), explain(decision));
  const verify = mutate((copy) => {
    part(copy, TIMERS, "timers").verifyIn = ["Q"];
  });
  assert.ok(mentions(verify, "part timers", "verifyIn names Q"), explain(verify));
});

test("fails when a runs step is not imported by src/initialize.js", () => {
  const dropped = mutate((copy) => {
    copy.readSource = (file) => file === "src/initialize.js" ? read(file).replace('import "react-native/Libraries/Core/setUpXHR";', "") : read(file);
  });
  assert.ok(mentions(dropped, XHR, "claims runs", "does not import react-native/Libraries/Core/setUpXHR"), explain(dropped));
  const claimed = mutate((copy) => {
    delete step(copy, ALERT).owner;
    Object.assign(step(copy, ALERT), { status: "runs" });
  });
  assert.ok(mentions(claimed, ALERT, "claims runs"), explain(claimed));
});

test("the error path runs since slice C: the gate notices when setUpErrorHandling is not imported or error-guard is not injected", () => {
  assert.equal(step(inputs, ERROR_HANDLING)?.status, "runs");
  assert.equal(polyfill(inputs, ERROR_GUARD)?.status, "runs");
  const dropped = mutate((copy) => {
    copy.readSource = (file) => file === "src/initialize.js" ? read(file).replace('import "react-native/Libraries/Core/setUpErrorHandling";', "") : read(file);
  });
  assert.ok(mentions(dropped, ERROR_HANDLING, "claims runs", "does not import react-native/Libraries/Core/setUpErrorHandling"), explain(dropped));
  const uninjected = mutate((copy) => {
    copy.readSource = (file) => file === POLYFILL_LIST ? listing([CONSOLE]) : read(file);
  });
  assert.ok(mentions(uninjected, `polyfill ${ERROR_GUARD}`, "claims runs", `${POLYFILL_LIST} does not inject it`), explain(uninjected));
});

test("fails when a runs step imports a setup function without calling it", () => {
  const claim = (copy) => {
    const dom = step(copy, DOM);
    for (const key of ["status", "slice", "reason", "evidence"]) {
      delete dom[key];
    }
    dom.status = "runs";
  };
  const imported = mutate((copy) => {
    claim(copy);
    copy.readSource = (file) => file === "src/initialize.js" ? `${read(file)}\nimport "react-native/src/private/setup/setUpDOM";\n` : read(file);
  });
  assert.ok(mentions(imported, DOM, "must import and call it"), explain(imported));
  const called = mutate((copy) => {
    claim(copy);
    copy.readSource = (file) => file === "src/initialize.js" ? `${read(file)}\nimport setUpDOM from "react-native/src/private/setup/setUpDOM";\nsetUpDOM();\n` : read(file);
  });
  assert.deepEqual(called, [], "an imported and called setup function runs");
});

test("the real bootstrap imports and calls setUpDOM, and the gate notices when it does neither", () => {
  assert.deepEqual(checkBootstrapAudit(inputs), []);
  const uncalled = mutate((copy) => {
    copy.readSource = (file) => file === "src/initialize.js" ? read(file).replace("\nsetUpDOM();\n", "\n") : read(file);
  });
  assert.ok(mentions(uncalled, DOM, "must import and call it"), explain(uncalled));
  const unimported = mutate((copy) => {
    copy.readSource = (file) => file === "src/initialize.js" ? read(file).replace(/import setUpDOM from "[^"]+";\n/, "").replace("\nsetUpDOM();\n", "\n") : read(file);
  });
  assert.ok(mentions(unimported, DOM, "claims runs", "does not import react-native/src/private/setup/setUpDOM"), explain(unimported));
});

test("fails when a polyfill the audit marks runs is not injected by the toolchain", () => {
  assert.equal(polyfill(inputs, CONSOLE)?.status, "runs");
  const dropped = mutate((copy) => {
    copy.readSource = (file) => file === POLYFILL_LIST ? listing([]) : read(file);
  });
  assert.ok(mentions(dropped, `polyfill ${CONSOLE}`, "claims runs", `${POLYFILL_LIST} does not inject it`), explain(dropped));
  const missing = mutate((copy) => {
    copy.readSource = (file) => file === POLYFILL_LIST ? undefined : read(file);
  });
  assert.ok(mentions(missing, "polyfills", "does not export METRO_POLYFILLS as a list of strings"), explain(missing));
  const reshaped = mutate((copy) => {
    copy.readSource = (file) => file === POLYFILL_LIST ? "export const METRO_POLYFILLS = polyfillsOf();\n" : read(file);
  });
  assert.ok(mentions(reshaped, "does not export METRO_POLYFILLS as a list of strings"), explain(reshaped));
});

test("fails when the toolchain injects a polyfill the audit does not mark runs, or one RN does not hand Metro", () => {
  const pending = mutate((copy) => {
    Object.assign(polyfill(copy, ERROR_GUARD), { status: "pending", slice: "C" });
    delete polyfill(copy, ERROR_GUARD).evidence;
    copy.readSource = (file) => file === POLYFILL_LIST ? listing([CONSOLE, ERROR_GUARD]) : read(file);
  });
  assert.ok(mentions(pending, `polyfill ${ERROR_GUARD}`, "does not mark it runs"), explain(pending));
  const foreign = mutate((copy) => {
    copy.readSource = (file) => file === POLYFILL_LIST ? listing(["@react-native/js-polyfills/object-es8.js", CONSOLE]) : read(file);
  });
  assert.ok(mentions(foreign, "object-es8.js", "does not hand it to Metro"), explain(foreign));
});

test("fails when the toolchain injects the polyfills in another order than RN hands them to Metro", () => {
  const swapped = mutate((copy) => {
    copy.readSource = (file) => file === POLYFILL_LIST ? listing([ERROR_GUARD, CONSOLE]) : read(file);
  });
  assert.ok(mentions(swapped, "injects them in an order other than the one RN hands them to Metro"), explain(swapped));
  const inOrder = mutate((copy) => {
    copy.readSource = (file) => file === POLYFILL_LIST ? listing([CONSOLE, ERROR_GUARD]) : read(file);
  });
  assert.deepEqual(inOrder, [], explain(inOrder));
});

test("fails when a step has both a status and parts, or too few parts", () => {
  const both = mutate((copy) => {
    step(copy, TIMERS).status = "host";
  });
  assert.ok(mentions(both, TIMERS, "carries status on its parts"), explain(both));
  const few = mutate((copy) => {
    step(copy, TIMERS).parts.length = 1;
  });
  assert.ok(mentions(few, TIMERS, "at least two"), explain(few));
});

test("fails when an entry carries a field the audit does not define", () => {
  const issues = mutate((copy) => {
    step(copy, NAVIGATOR).reson = "typo";
  });
  assert.ok(mentions(issues, NAVIGATOR, "unknown field reson"), explain(issues));
});

test("fails when one of the user's decisions is dropped or malformed", () => {
  for (const id of REQUIRED_DECISIONS) {
    const issues = mutate((copy) => {
      copy.audit.decisions = copy.audit.decisions.filter((decision) => decision.id !== id);
    });
    assert.ok(mentions(issues, `decision ${id} of 2026-10-13 is missing`), explain(issues));
  }
  const noRoadmap = mutate((copy) => {
    delete copy.audit.decisions.find((decision) => decision.id === "performance-classes").roadmap;
  });
  assert.ok(mentions(noRoadmap, "decision performance-classes", "roadmap task"), explain(noRoadmap));
  const unknownRoadmap = mutate((copy) => {
    copy.audit.decisions.find((decision) => decision.id === "performance-classes").roadmap = "GF-99";
  });
  assert.ok(mentions(unknownRoadmap, "roadmap GF-99"), explain(unknownRoadmap));
  const noSlice = mutate((copy) => {
    delete copy.audit.decisions.find((decision) => decision.id === "starvation").slice;
  });
  assert.ok(mentions(noSlice, "decision starvation", "slice that delivers it"), explain(noSlice));
  const strayGlobal = mutate((copy) => {
    copy.audit.decisions.find((decision) => decision.id === "performance-classes").globals.push("PerformanceNavigation");
  });
  assert.ok(mentions(strayGlobal, "PerformanceNavigation is not installed by the pinned chain"), explain(strayGlobal));
  const noReason = mutate((copy) => {
    copy.audit.decisions.find((decision) => decision.id === "encoding").reason = "";
  });
  assert.ok(mentions(noReason, "decision encoding", "reason is required"), explain(noReason));
});

test("fails when a step is listed twice or two entries share an id", () => {
  const twice = mutate((copy) => {
    copy.audit.steps.push(structuredClone(step(copy, NAVIGATOR)));
  });
  assert.ok(mentions(twice, NAVIGATOR, "listed twice"), explain(twice));
  const shared = mutate((copy) => {
    step(copy, NAVIGATOR).id = step(copy, GLOBALS).id;
  });
  assert.ok(mentions(shared, NAVIGATOR, "id that no other entry uses"), explain(shared));
});

// A hand-edited audit can hold anything where an entry belongs. The gate reports each such entry, by its index, and carries on with the rest:
// it never reads a field of one, so it never throws.
const MALFORMED = [null, 42, "console", [], {}, { file: 7 }, { file: "  " }];

test("reports a malformed step or polyfill entry by its index instead of throwing", () => {
  for (const value of MALFORMED) {
    const label = JSON.stringify(value);
    const asStep = mutate((copy) => {
      copy.audit.steps[3] = value;
    });
    assert.ok(mentions(asStep, "step #3", "must be an object with a string file"), `${label}: ${explain(asStep)}`);
    const asPolyfill = mutate((copy) => {
      copy.audit.polyfills[0] = value;
    });
    assert.ok(mentions(asPolyfill, "polyfill #0", "must be an object with a string file"), `${label}: ${explain(asPolyfill)}`);
  }
  // The entry it replaced is a step RN has and the audit no longer lists, and the other entries are still judged.
  const issues = mutate((copy) => {
    copy.audit.steps[3] = null;
    copy.audit.steps.find((entry) => entry?.file === NAVIGATOR).status = "done";
  });
  assert.ok(mentions(issues, "does not list it"), explain(issues));
  assert.ok(mentions(issues, NAVIGATOR, "status must be one of"), explain(issues));
});

test("reports a malformed part of a split step instead of throwing", () => {
  for (const value of [null, 7, "queue-microtask", [], undefined]) {
    const issues = mutate((copy) => {
      step(copy, TIMERS).parts[1] = value;
    });
    assert.ok(mentions(issues, TIMERS, "part #1", "must be an object"), `${JSON.stringify(value)}: ${explain(issues)}`);
    assert.ok(mentions(issues, TIMERS, "the parts must cover exactly what the step installs"), explain(issues));
  }
});

test("reports a malformed decision or list instead of throwing", () => {
  for (const value of [null, 7, "encoding", []]) {
    const issues = mutate((copy) => {
      copy.audit.decisions[1] = value;
    });
    assert.ok(mentions(issues, "decision #1", "must be an object"), `${JSON.stringify(value)}: ${explain(issues)}`);
  }
  const notLists = mutate((copy) => {
    copy.audit.decisions = "none";
    copy.audit.steps = null;
    copy.audit.polyfills = { file: "console.js" };
  });
  assert.ok(mentions(notLists, "step", "must be a list"), explain(notLists));
  assert.ok(mentions(notLists, "polyfill", "must be a list"), explain(notLists));
  assert.ok(mentions(notLists, "audit.decisions", "must be a list"), explain(notLists));
  for (const audit of [null, "audit", 3, []]) {
    assert.deepEqual(mutate((copy) => {
      copy.audit = audit;
    }), ["audit: must be an object"]);
  }
  const entries = mutate((copy) => {
    step(copy, GLOBALS).evidence = [null, 3, "text", []];
    step(copy, GLOBALS).verifyIn = 5;
    copy.audit.decisions.find((decision) => decision.id === "performance-classes").globals = 5;
  });
  assert.ok(mentions(entries, GLOBALS, "must be {file, symbol}"), explain(entries));
  assert.ok(mentions(entries, GLOBALS, "verifyIn must be a list"), explain(entries));
  assert.ok(mentions(entries, "decision performance-classes", "globals must be a list"), explain(entries));
});
