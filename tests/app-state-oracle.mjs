import assert from "node:assert/strict";

const steps = ["focus-in", "focus-out", "focus-out-repeat", "focus-in-again", "memory-warning", "mobile-background",
  "mobile-foreground", "paused-focused", "blur-while-paused", "resume-unfocused", "focus-after-resume", "scene-pause",
  "focus-out-scene-paused", "focus-in-scene-resumed", "remove", "unmount-a"];
// A game pause is not the application lifecycle (V2-D11): these steps run
// with SceneTree.paused set and still deliver every event.
const scenePaused = new Set(["scene-pause", "focus-out-scene-paused"]);

// Independent oracle, written from RN rather than from the probe. RCTAppState
// reports inactive from WillResignActive and background from
// DidEnterBackground, sending appStateDidChange only for a new state; Godot
// reports those as FOCUS_OUT and PAUSED, so while paused the application stays
// background. AppStateModule sends appStateFocusChange on each focus change.
// A Godot notification repeating the current flag is not a transition.
class Lifecycle {
  focused = true;
  paused = false;
  get state() {
    if (this.paused) {
      return "background";
    }
    return this.focused ? "active" : "inactive";
  }
  apply(notification) {
    if (notification === "memoryWarning") {
      return [["memoryWarning", null]];
    }
    const previous = this.state;
    const focusedBefore = this.focused;
    if (notification === "focusIn" || notification === "focusOut") {
      this.focused = notification === "focusIn";
    } else if (notification === "paused" || notification === "resumed") {
      this.paused = notification === "paused";
    } else {
      throw new Error("Unknown Godot notification " + notification);
    }
    const emitted = [];
    if (this.state !== previous) {
      emitted.push(["change", this.state]);
    }
    if (this.focused !== focusedBefore) {
      emitted.push([this.focused ? "focus" : "blur", null]);
    }
    return emitted;
  }
}

// Listeners in RN's device emitter order: the library subscribed at bundle
// evaluation, then each mounted root in mount order with its own subscriptions.
function listenersOf(js, event) {
  const roots = Object.entries(js.roots).filter(([, root]) => root.mounted && root.subscriptions.includes(event));
  return ["library", ...roots.map(([name]) => name)];
}
const rows = entries => entries.map(row => [row.root, row.event, row.value, row.currentState]);

// Re-derives every step of a current-host report from the delivered
// notifications and the fixture's own subscription records; throws on any
// difference.
export function verifyAppStateReport(report) {
  const lifecycle = new Lifecycle();
  const totals = {notifications: {focusIn: 0, focusOut: 0, paused: 0, resumed: 0, memoryWarning: 0},
    events: {change: 0, focus: 0, blur: 0, memoryWarning: 0}};
  // Focus left before the runtime existed: no observer received it.
  const unobserved = lifecycle.apply("focusOut").length;
  totals.notifications.focusOut += 1;
  let jsState = lifecycle.state;
  const log = report.stages.stop.late.log;
  let cursor = 0;
  const initial = report.stages.initial;
  assert.deepEqual(initial.js.log, []);
  assert.equal(initial.initial.constants.initialAppState, "inactive");
  assert.equal(initial.js.currentState, "inactive");
  assert.deepEqual(initial.js.access, {available: true, sameAsOriginal: true, error: null, isAvailable: true});
  assert.equal(initial.initial.unknownEvent, "Trying to subscribe to unknown event: suspend");
  assert.deepEqual(initial.js.listeners, {appStateDidChange: 4, appStateFocusChange: 6, memoryWarning: 3});
  assert.deepEqual(initial.js.queries, [{label: "initial", value: "inactive", error: null}]);
  assert.equal(initial.lifecycle.observers, 1);
  assert.equal(initial.lifecycle.unobserved, unobserved);
  for (const name of steps) {
    const stage = report.stages[name];
    assert.equal(stage.scenePaused, scenePaused.has(name), name);
    const expected = [];
    if (name === "unmount-a") {
      expected.push(["A", "cleanup", null, jsState]);
    }
    for (const notification of stage.notifications) {
      totals.notifications[notification] += 1;
      for (const [event, value] of lifecycle.apply(notification)) {
        if (event === "change") {
          jsState = value;
        }
        totals.events[event] += 1;
        for (const listener of listenersOf(stage.js, event)) {
          expected.push([listener, event, value, jsState]);
        }
      }
    }
    const actual = rows(log.slice(cursor, cursor + expected.length));
    assert.deepEqual(actual, expected, name);
    assert.deepEqual(stage.observed, expected, name);
    cursor += expected.length;
    // Both roots read one application-wide state: wherever both listen to an
    // event, they receive identical rows.
    if (stage.js.roots.A.mounted && stage.js.roots.B.mounted) {
      const shared = ["change", "memoryWarning", "focus", "blur"].filter(event =>
        stage.js.roots.A.subscriptions.includes(event) && stage.js.roots.B.subscriptions.includes(event));
      const of = rootName => actual.filter(row => row[0] === rootName && shared.includes(row[1])).map(row => row.slice(1));
      assert.deepEqual(of("A"), of("B"), name);
    }
    assert.equal(stage.js.currentState, jsState, name);
    assert.deepEqual(stage.js.queries.filter(query => query.label === name), [{label: name, value: lifecycle.state, error: null}], name);
    assert.equal(stage.lifecycle.state, lifecycle.state, name);
    assert.equal(stage.lifecycle.focused, lifecycle.focused, name);
    assert.equal(stage.lifecycle.paused, lifecycle.paused, name);
    assert.equal(stage.lifecycle.observed, true, name);
    assert.deepEqual(stage.lifecycle.notifications, totals.notifications, name);
    assert.deepEqual(stage.lifecycle.events, totals.events, name);
    assert.equal(stage.lifecycle.unobserved, unobserved, name);
  }
  // Stop runs B's cleanup and nothing else; later notifications reach no one.
  const stop = report.stages.stop;
  assert.deepEqual(rows(log.slice(cursor)), [["B", "cleanup", null, jsState]]);
  assert.equal(stop.after.currentState, jsState);
  assert.equal(stop.late.log.length, stop.after.log.length);
  let lateUnobserved = unobserved;
  for (const notification of ["focusOut", "paused", "memoryWarning"]) {
    totals.notifications[notification] += 1;
    lateUnobserved += lifecycle.apply(notification).length;
  }
  assert.deepEqual(stop.lifecycle, {state: lifecycle.state, focused: lifecycle.focused, paused: lifecycle.paused,
    observed: false, observers: 1, notifications: totals.notifications, events: totals.events, unobserved: lateUnobserved});
  assert.deepEqual(report.delivered, totals.notifications);
  assert.equal(stop.retained.currentState, jsState);
  assert.match(stop.retained.retainedGetConstants, /E_MODULE_DISPOSED: AppState/);
  assert.match(stop.retained.lookup, /E_RUNTIME_STOPPED/);
  assert.equal(stop.disposed.environment.appState, 0);
  assert.equal(stop.disposed.log, stop.after.log.length);
  assert.equal(stop.disposed.currentState, jsState);
  assert.ok(stop.application.stopped && stop.application.rootCount === 0);
  assert.deepEqual(stop.application.errors, []);
}
