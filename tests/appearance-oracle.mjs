import assert from "node:assert/strict";

const steps = ["system-dark", "system-dark-repeat", "override-light", "system-light-overridden", "override-dark",
  "unspecified", "auto-unchanged", "override-same", "unknown-override", "remove", "unmount-a"];
const colors = {light: "e2e8f0ff", dark: "0f172aff"};

// Independent oracle, written from RN rather than from the probe. RCTConvert
// maps light and dark to an explicit interface style and auto or unspecified to
// UIUserInterfaceStyleUnspecified, which follows the system; RCTAppearance and
// Android's AppearanceModule report the system style otherwise, light when it is
// not dark, and send appearanceChanged only for a scheme that differs from the
// last one sent. Godot rejects any other override instead of ignoring it.
class Scheme {
  style = "unspecified";
  system = {supported: false, dark: false};
  constructor() {
    this.sent = this.current;
  }
  get current() {
    if (this.style === "light" || this.style === "dark") {
      return this.style;
    }
    return this.system.supported && this.system.dark ? "dark" : "light";
  }
  // Returns whether the action is accepted; an accepted change is sent once.
  apply(action) {
    if (action.kind === "system") {
      this.system = {supported: true, dark: action.value === "dark"};
    } else if (action.kind === "override") {
      if (!["light", "dark", "auto", "unspecified"].includes(action.value)) {
        return false;
      }
      this.style = action.value === "auto" ? "unspecified" : action.value;
    }
    return true;
  }
  flush() {
    if (this.current === this.sent) {
      return null;
    }
    this.sent = this.current;
    return this.sent;
  }
}

// Listeners in subscription order: the library at bundle evaluation, then each
// root in mount order while the fixture records it as listening.
function listenersOf(js) {
  const roots = Object.entries(js.roots).filter(([, root]) => root.listening).map(([name]) => name);
  return ["library", ...roots];
}
const rows = entries => entries.map(row => [row.root, row.event, row.colorScheme, row.read]);
function byRoot(entries) {
  const result = {};
  for (const entry of entries) {
    result[entry.root] ??= [];
    result[entry.root].push(entry.scheme);
  }
  return result;
}

// Re-derives every step of a current-host report from the probe's actions and
// the fixture's own subscription records; throws on any difference.
export function verifyAppearanceReport(report) {
  const scheme = new Scheme();
  const totals = {events: 0, notifications: 0, overrides: 0, unobserved: 0};
  const log = report.stages.stop.late.log;
  const renders = report.stages.stop.late.renders;
  const initial = report.stages.initial;
  assert.equal(initial.js.colorScheme, "light");
  assert.equal(initial.js.nativeModule, true);
  assert.equal(initial.js.deviceListeners, 1);
  assert.deepEqual(initial.js.log, []);
  assert.deepEqual(byRoot(initial.js.renders), {A: ["light"], B: ["light"]});
  assert.deepEqual(initial.backgrounds, {A: colors.light, B: colors.light});
  let logCursor = 0;
  let renderCursor = initial.js.renders.length;
  for (const name of steps) {
    const stage = report.stages[name];
    const expected = [];
    let rejected = 0;
    for (const action of stage.actions) {
      if (action.kind === "unmount") {
        expected.push([action.value, "cleanup", null, scheme.sent]);
      }
      if (!scheme.apply(action)) {
        rejected += 1;
      } else if (action.kind === "system") {
        totals.notifications += 1;
      } else if (action.kind === "override") {
        totals.overrides += 1;
      }
    }
    const sent = scheme.flush();
    const expectedRenders = {};
    if (sent != null) {
      totals.events += 1;
      for (const listener of listenersOf(stage.js)) {
        expected.push([listener, "change", sent, sent]);
      }
      for (const [root, state] of Object.entries(stage.js.roots)) {
        if (state.mounted) {
          expectedRenders[root] = [sent];
        }
      }
    }
    const actual = rows(log.slice(logCursor, logCursor + expected.length));
    assert.deepEqual(actual, expected, name);
    assert.deepEqual(stage.observed, expected, name);
    logCursor += expected.length;
    const actualRenders = renders.slice(renderCursor, renderCursor + Object.keys(expectedRenders).length);
    assert.deepEqual(byRoot(actualRenders), expectedRenders, name);
    renderCursor += actualRenders.length;
    assert.equal(stage.js.colorScheme, scheme.sent, name);
    // The rendering roots' native Views carry the scheme their hook returned.
    const mounted = Object.entries(stage.js.roots).filter(([, state]) => state.mounted).map(([root]) => root);
    assert.deepEqual(stage.backgrounds, Object.fromEntries(mounted.map(root => [root, colors[scheme.sent]])), name);
    assert.equal(stage.native.scheme, scheme.current, name);
    assert.equal(stage.native.override, scheme.style, name);
    assert.deepEqual(stage.native.system, scheme.system, name);
    assert.equal(stage.native.observed, true, name);
    assert.equal(stage.native.listeners, 1, name);
    assert.equal(stage.native.callbackRegistered, true, name);
    for (const key of Object.keys(totals)) {
      assert.equal(stage.native[key], totals[key], name + ": " + key);
    }
    if (rejected) {
      assert.match(stage.result.error, /E_ARGUMENT: Appearance\.setColorScheme expects light, dark, auto or unspecified/);
      assert.equal(stage.result.colorScheme, scheme.sent);
    }
  }
  // Stop runs B's cleanup and nothing else; the later system change is counted
  // natively but reaches no listener, not even the library's.
  const stop = report.stages.stop;
  assert.deepEqual(rows(log.slice(logCursor)), [["B", "cleanup", null, scheme.sent]]);
  assert.equal(renders.length, renderCursor);
  const delivered = scheme.sent;
  for (const action of stop.actions) {
    assert.ok(scheme.apply(action));
    totals.notifications += 1;
  }
  if (scheme.flush() != null) {
    totals.unobserved += 1;
  }
  assert.equal(stop.late.log.length, stop.after.log.length);
  assert.deepEqual(stop.native, {scheme: scheme.current, override: scheme.style, system: scheme.system,
    observed: false, observers: 1, listeners: 1, callbackRegistered: true, ...totals});
  assert.equal(stop.after.colorScheme, delivered);
  assert.match(stop.retained.retainedGetColorScheme, /E_MODULE_DISPOSED: Appearance/);
  assert.match(stop.retained.lookup, /E_RUNTIME_STOPPED/);
  assert.equal(stop.disposed.environment.appearance, 0);
  assert.equal(stop.disposed.colorScheme, delivered);
  assert.equal(stop.disposed.log, stop.after.log.length);
  assert.ok(stop.application.stopped && stop.application.rootCount === 0);
  assert.deepEqual(stop.application.errors, []);
  assert.deepEqual(report.counts, totals);
  // A new application reads a supported dark system when its module starts.
  const dark = report.stages["initial-dark"];
  assert.equal(dark.js.colorScheme, "dark");
  assert.deepEqual(byRoot(dark.js.renders), {C: ["dark"]});
  assert.deepEqual(dark.js.log, []);
  assert.deepEqual(dark.native.system, {supported: true, dark: true});
  assert.equal(dark.native.scheme, "dark");
  assert.equal(dark.native.events, 0);
  assert.deepEqual(dark.backgrounds, {C: colors.dark});
}
