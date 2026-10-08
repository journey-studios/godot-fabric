import assert from "node:assert/strict";

// Independent oracle, written from RN's rules and not from the probe or the host. It replays the commands every step of
// a report ran against a model of what RN's original AccessibilityInfo does over the iOS contract (AccessibilityInfo.js
// and RCTAccessibilityManager.mm), and compares calls, events and the host's counters with it; it throws on any
// difference.
//
// The rules the model follows:
//  - AccessibilityInfo.js looks its native module up when it is imported, so the first public read creates
//    AccessibilityManager, and RCTAccessibilityManager's init reads the settings then: that is the baseline.
//  - Each getter hands the setting it last knew to a success callback; a setting the platform cannot report (-1 from
//    the DisplayServer) goes to the error callback, so the promise rejects, and is never false. The settings Godot has
//    no way to read always reject. high text contrast resolves false, the Android service rejects and the recommended
//    timeout is the one given, without the host.
//  - A change is a known value that differs from the last known one: the device event reaches every listener of the
//    event once, in subscription order, and "change" is an alias of screenReaderChanged. Nothing is emitted when a
//    setting becomes unknown, nor for -1 after -1, nor when it comes back to the value it last had.
//  - boldTextChanged, grayscaleChanged, invertColorsChanged and announcementFinished never fire.
//  - The multipliers of setAccessibilityContentSizeMultipliers are numbers above zero (RCTAccessibilityManager.mm
//    ignores any other); a valid call, the announcements and the programmatic focus are refused with E_UNSUPPORTED.
//  - sendAccessibilityEvent reaches the host's UIManager delegate; iOS acts on focus alone (RCTMountingManager.mm).
const settings = [
  {name: "screenReader", key: "screen_reader", event: "screenReaderChanged", getter: "isScreenReaderEnabled", method: "getCurrentVoiceOverState"},
  {name: "reduceMotion", key: "reduce_animation", event: "reduceMotionChanged", getter: "isReduceMotionEnabled", method: "getCurrentReduceMotionState"},
  {name: "reduceTransparency", key: "reduce_transparency", event: "reduceTransparencyChanged", getter: "isReduceTransparencyEnabled",
    method: "getCurrentReduceTransparencyState"},
  {name: "increaseContrast", key: "increase_contrast", event: "darkerSystemColorsChanged", getter: "isDarkerSystemColorsEnabled",
    method: "getCurrentDarkerSystemColorsState"},
];
const unbackedSettings = [
  {name: "boldText", getter: "isBoldTextEnabled", method: "getCurrentBoldTextState"},
  {name: "grayscale", getter: "isGrayscaleEnabled", method: "getCurrentGrayscaleState"},
  {name: "invertColors", getter: "isInvertColorsEnabled", method: "getCurrentInvertColorsState"},
  {name: "crossFadeTransitions", getter: "prefersCrossFadeTransitions", method: "getCurrentPrefersCrossFadeTransitionsState"},
];
const silentEvents = ["boldTextChanged", "grayscaleChanged", "invertColorsChanged", "announcementFinished"];
const deviceEvents = [...settings.map(entry => entry.event), ...silentEvents];
// AccessibilityInfo.js's EventNames on the iOS branch: a public name the map does not hold registers nothing.
const iosEventNames = new Map([["announcementFinished", "announcementFinished"], ["boldTextChanged", "boldTextChanged"],
  ["change", "screenReaderChanged"], ["grayscaleChanged", "grayscaleChanged"], ["invertColorsChanged", "invertColorsChanged"],
  ["reduceMotionChanged", "reduceMotionChanged"], ["reduceTransparencyChanged", "reduceTransparencyChanged"],
  ["screenReaderChanged", "screenReaderChanged"], ["darkerSystemColorsChanged", "darkerSystemColorsChanged"]]);
const categories = ["extraSmall", "small", "medium", "large", "extraLarge", "extraExtraLarge", "extraExtraExtraLarge", "accessibilityMedium",
  "accessibilityLarge", "accessibilityExtraLarge", "accessibilityExtraExtraLarge", "accessibilityExtraExtraExtraLarge"];
const focusMessage = "focus is not implemented yet (GF-20 slice 2b)";
const decode = value => {
  if (value != null && typeof value === "object" && !Array.isArray(value) && "$number" in value) {
    return Number(value.$number);
  }
  if (Array.isArray(value)) {
    return value.map(decode);
  }
  if (value != null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
  }
  return value;
};

const stepsA = ["early", "lazy-before", "lazy-read", "getters", "unbacked", "subscribe", "quiet", "motion-on", "alias", "transparency-on",
  "contrast-appears", "contrast-on", "together", "unknown", "unknown-back", "unknown-different", "key-removed", "invalid-values", "restored",
  "direct-getters", "content-size", "announce", "ui-events", "unsubscribe", "unmount", "stop"];
const stepsR = ["real-read", "real-getters", "real-subscribe", "real-after", "real-stop"];

// One application's accessibility state as RN's rules and the contract define it.
class Device {
  constructor({meta, mounted}) {
    Object.assign(this, {meta, meta0: meta, mounted: new Set(mounted)});
    this.created = false;
    this.stopped = false;
    this.last = Object.fromEntries(settings.map(entry => [entry.name, -1]));
    this.known = Object.fromEntries(settings.map(entry => [entry.name, null]));
    this.resolved = Object.fromEntries(settings.map(entry => [entry.name, 0]));
    this.rejectedUnknown = Object.fromEntries(settings.map(entry => [entry.name, 0]));
    this.events = Object.fromEntries(deviceEvents.map(event => [event, 0]));
    this.unbacked = Object.fromEntries(unbackedSettings.map(entry => [entry.name, 0]));
    this.refused = {contentSize: 0, contentSizeInvalid: 0, announce: 0, announceWithOptions: 0, focus: 0};
    this.ui = {ignored: 0, unsupported: 0, byType: {}};
    this.errors = [];
    // The listeners in subscription order: id, the public name it subscribed with and the device event it hears.
    this.subscriptions = [];
    // What the platform reported at each poll that changed something: which settings changed together.
    this.changes = [];
  }
  // The DisplayServer reads -1 for a key the meta does not name here (headless), and for a value that is not -1, 0 or 1.
  platform(entry) {
    if (this.meta == null || !(entry.key in this.meta)) {
      return -1;
    }
    const value = this.meta[entry.key];
    return Number.isInteger(value) && [-1, 0, 1].includes(value) ? value : -1;
  }
  create() {
    if (this.created || this.stopped) {
      return;
    }
    this.created = true;
    for (const entry of settings) {
      const reading = this.platform(entry);
      this.last[entry.name] = reading;
      this.known[entry.name] = reading === -1 ? null : reading === 1;
    }
  }
  // One frame's poll, as the host does it once per pump.
  poll(outcome) {
    if (!this.created || this.stopped) {
      return;
    }
    const changed = [];
    for (const entry of settings) {
      const reading = this.platform(entry);
      this.last[entry.name] = reading;
      if (reading === -1) {
        continue;
      }
      const value = reading === 1;
      if (this.known[entry.name] === value) {
        continue;
      }
      this.known[entry.name] = value;
      this.events[entry.event] += 1;
      changed.push(entry.name);
      outcome.rows.push(...this.subscriptions.filter(subscription => subscription.device === entry.event)
        .map(subscription => [subscription.id, subscription.event, value]));
    }
    if (changed.length > 0) {
      this.changes.push(changed);
    }
  }
}

// What one command makes happen, and what it expects of JS: the calls it makes in order and the event rows.
function replay(device, command, outcome) {
  const args = decode(command.args ?? []);
  const expect = (label, api, expected) => outcome.calls.push({label, api, ...expected});
  switch (command.do) {
    case "read":
      device.create();
      assert.deepEqual(command.result, {available: true, sameAsOriginal: true, error: null}, "reading AccessibilityInfo");
      break;
    case "android":
      assert.equal(command.result, false, "RN's Android module is not the host's");
      break;
    case "retain":
      device.create();
      assert.deepEqual(command.result, {AccessibilityManager: true}, "retaining the module");
      break;
    case "subscribe": {
      device.create();
      const mapped = iosEventNames.get(command.event) ?? null;
      assert.equal(command.result?.removable, true, "every subscription can be removed: " + command.id);
      // A name the map does not hold gets a subscription that hears nothing and is still removable.
      device.subscriptions.push({id: command.id, event: command.event, device: mapped, root: command.root});
      break;
    }
    case "unsubscribe":
      device.subscriptions = device.subscriptions.filter(subscription => subscription.id !== command.id);
      break;
    case "meta":
      device.meta = command.value;
      break;
    case "wait":
      assert.equal(command.reached, true, "the host delivered the frames the probe waited for");
      device.poll(outcome);
      break;
    case "settle":
      device.poll(outcome);
      break;
    case "unmount": {
      // An unmounted root's effect cleanup removes its subscriptions and records itself.
      const unmounted = command.surface.slice(1);
      device.mounted.delete(unmounted);
      device.subscriptions = device.subscriptions.filter(subscription => subscription.root !== unmounted);
      outcome.cleanups.push(unmounted);
      break;
    }
    case "stop":
      // Stop runs the cleanup of every root still mounted; the subscriptions of the libraries stay.
      outcome.cleanups.push(...device.mounted);
      device.subscriptions = device.subscriptions.filter(subscription => !device.mounted.has(subscription.root));
      device.mounted.clear();
      device.stopped = true;
      break;
    case "call":
      callApi(device, expect, command.label, command.api, args);
      break;
    case "send":
      device.create();
      expect(command.label, "AccessibilityInfo.sendAccessibilityEvent", {state: "returned"});
      // iOS acts on focus alone; the other types are ignored and counted by type.
      if (command.type === "focus") {
        device.ui.unsupported += 1;
        device.errors.push(focusMessage);
      } else {
        device.ui.ignored += 1;
        device.ui.byType[command.type] = (device.ui.byType[command.type] ?? 0) + 1;
      }
      break;
    case "direct":
      device.create();
      callModule(device, expect, command.label, command.method, args);
      break;
    default:
      throw new Error("accessibility info oracle: unknown command " + command.do);
  }
}

function callApi(device, expect, label, name, args) {
  device.create();
  const api = "AccessibilityInfo." + name;
  assert.ok(!(device.stopped && ["isScreenReaderEnabled", "isReduceMotionEnabled", "isReduceTransparencyEnabled", "isDarkerSystemColorsEnabled",
    "isBoldTextEnabled", "isGrayscaleEnabled", "isInvertColorsEnabled", "prefersCrossFadeTransitions"].includes(name)),
  "a stopped runtime drains no promise reactions, so a public getter after stop cannot be observed: " + label);
  const backed = settings.find(entry => entry.getter === name);
  if (backed) {
    const reading = device.last[backed.name];
    if (reading === -1) {
      device.rejectedUnknown[backed.name] += 1;
      expect(label, api, {state: "rejected", error: /E_ACCESSIBILITY_UNKNOWN/});
    } else {
      device.resolved[backed.name] += 1;
      expect(label, api, {state: "resolved", value: reading === 1});
    }
    return;
  }
  const unbacked = unbackedSettings.find(entry => entry.getter === name);
  if (unbacked) {
    device.unbacked[unbacked.name] += 1;
    expect(label, api, {state: "rejected", error: /E_ACCESSIBILITY_UNAVAILABLE/});
    return;
  }
  switch (name) {
    case "isHighTextContrastEnabled":
      expect(label, api, {state: "resolved", value: false});
      break;
    case "isAccessibilityServiceEnabled":
      expect(label, api, {state: "rejected", error: "only available on Android"});
      break;
    case "getRecommendedTimeoutMillis":
      expect(label, api, {state: "resolved", value: args[0]});
      break;
    case "announceForAccessibility":
    case "announceForAccessibilityWithOptions":
    case "setAccessibilityFocus": {
      if (device.stopped) {
        expect(label, api, {state: "threw", error: /E_MODULE_DISPOSED/});
        break;
      }
      const counter = {announceForAccessibility: "announce", announceForAccessibilityWithOptions: "announceWithOptions", setAccessibilityFocus: "focus"}[name];
      device.refused[counter] += 1;
      expect(label, api, {state: "threw", error: /E_UNSUPPORTED.*GF-20 slice 2b/});
      break;
    }
    default:
      throw new Error("accessibility info oracle: unknown call " + name);
  }
}

// The multipliers the module accepts are numbers above zero; null and undefined leave a category alone and keys that
// are not categories are ignored.
function invalidMultiplier(multipliers) {
  for (const category of categories) {
    const value = multipliers[category];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) {
      return category;
    }
  }
  return null;
}

function callModule(device, expect, label, method, args) {
  const api = "AccessibilityManager." + method;
  if (device.stopped) {
    expect(label, api, {state: "threw", error: /E_MODULE_DISPOSED/, callbacks: []});
    return;
  }
  const backed = settings.find(entry => entry.method === method);
  if (backed) {
    const reading = device.last[backed.name];
    if (reading === -1) {
      device.rejectedUnknown[backed.name] += 1;
      expect(label, api, {state: "returned", callbacks: [{name: "error", isError: true, message: /^E_ACCESSIBILITY_UNKNOWN/}]});
    } else {
      device.resolved[backed.name] += 1;
      expect(label, api, {state: "returned", callbacks: [{name: "success", isError: false, value: reading === 1}]});
    }
    return;
  }
  const unbacked = unbackedSettings.find(entry => entry.method === method);
  if (unbacked) {
    device.unbacked[unbacked.name] += 1;
    expect(label, api, {state: "returned", callbacks: [{name: "error", isError: true, message: /^E_ACCESSIBILITY_UNAVAILABLE/}]});
    return;
  }
  switch (method) {
    case "setAccessibilityContentSizeMultipliers": {
      if (invalidMultiplier(args[0]) != null) {
        device.refused.contentSizeInvalid += 1;
        expect(label, api, {state: "threw", error: /E_ARGUMENT/, callbacks: []});
      } else {
        device.refused.contentSize += 1;
        expect(label, api, {state: "threw", error: /E_UNSUPPORTED/, callbacks: []});
      }
      break;
    }
    case "setAccessibilityFocus":
      device.refused.focus += 1;
      expect(label, api, {state: "threw", error: /E_UNSUPPORTED.*GF-20 slice 2b/, callbacks: []});
      break;
    case "announceForAccessibility":
      device.refused.announce += 1;
      expect(label, api, {state: "threw", error: /E_UNSUPPORTED.*GF-20 slice 2b/, callbacks: []});
      break;
    case "announceForAccessibilityWithOptions":
      device.refused.announceWithOptions += 1;
      expect(label, api, {state: "threw", error: /E_UNSUPPORTED.*GF-20 slice 2b/, callbacks: []});
      break;
    default:
      throw new Error("accessibility info oracle: unknown module method " + method);
  }
}

function matches(actual, expected) {
  return expected instanceof RegExp ? expected.test(String(actual)) : String(actual).includes(expected);
}

// One step of a report against the model.
function verifyStep(report, device, app, name) {
  const step = report.stages[app][name];
  const outcome = {calls: [], rows: [], cleanups: []};
  for (const command of step.commands) {
    replay(device, command, outcome);
  }
  // The step ends after frames have passed, and the host polls on each of them.
  device.poll(outcome);
  assert.deepEqual(step.calls.map(entry => entry.label), outcome.calls.map(entry => entry.label), name + ": calls");
  step.calls.forEach((entry, index) => {
    const expected = outcome.calls[index];
    const where = `${app}/${name}/${expected.label}`;
    assert.equal(entry.api, expected.api, where);
    assert.equal(entry.state, expected.state, `${where}: ${entry.state} ${entry.error ?? ""}`);
    if ("value" in expected) {
      assert.deepEqual(entry.value, expected.value, where);
    }
    if ("error" in expected) {
      assert.ok(matches(entry.error, expected.error), `${where}: error ${entry.error}`);
    }
    if ("callbacks" in expected) {
      assert.equal(entry.callbacks.length, expected.callbacks.length, where + ": callbacks");
      expected.callbacks.forEach((callback, position) => {
        const actual = entry.callbacks[position];
        assert.equal(actual.name, callback.name, where);
        assert.equal(actual.isError, callback.isError, where);
        if ("value" in callback) {
          assert.equal(actual.value, callback.value, where);
        }
        if ("message" in callback) {
          assert.ok(callback.message.test(String(actual.message)), `${where}: message ${actual.message}`);
        }
      });
    }
  });
  const rows = step.events.filter(event => !event.cleanup).map(event => [event.id, event.event, event.value]);
  assert.deepEqual(rows, outcome.rows, `${app}/${name}: events`);
  assert.deepEqual(step.events.filter(event => event.cleanup).map(event => event.id).sort(), outcome.cleanups.sort(), `${app}/${name}: cleanups`);
  // JS saw the listeners the model holds, by device event and by id. Before the first root mounts there is no JS to ask.
  if (Object.keys(step.js.listeners).length > 0) {
    for (const event of deviceEvents) {
      assert.equal(step.js.listeners[event], device.subscriptions.filter(subscription => subscription.device === event).length,
        `${app}/${name}: listeners of ${event}`);
    }
  }
  assert.deepEqual(Object.fromEntries(device.subscriptions.map(subscription => [subscription.id, subscription.event])), step.js.subscriptions,
    `${app}/${name}: subscriptions`);
  assert.deepEqual(step.errors, device.errors, `${app}/${name}: the application's errors`);
  return step;
}

function verifyCounters(step, device, previous, app, name) {
  const info = step.info;
  const where = `${app}/${name}`;
  assert.equal(info.stopped, device.stopped, where + ": stopped");
  assert.equal(info.started, device.created, where + ": started");
  assert.deepEqual(info.modules, {AccessibilityManager: device.created ? 1 : 0}, where + ": created modules");
  assert.ok(Number.isInteger(info.polls) && info.polls >= 0, where + ": polls");
  if (!device.created) {
    assert.equal(info.polls, 0, where + ": nothing is polled before the module exists");
  }
  for (const entry of settings) {
    assert.deepEqual(info.settings[entry.name], {last: device.created ? device.last[entry.name] : -1,
      known: device.known[entry.name], reads: device.created ? 1 + info.polls : 0, resolved: device.resolved[entry.name],
      rejectedUnknown: device.rejectedUnknown[entry.name], events: device.events[entry.event]}, `${where}: ${entry.name}`);
  }
  assert.deepEqual(info.events, device.events, where + ": events by name");
  assert.deepEqual(info.unbacked, device.unbacked, where + ": settings with no backing");
  assert.deepEqual(info.refused, device.refused, where + ": refused calls");
  assert.deepEqual(info.uiEvents, {ignored: device.ui.ignored, ignoredOther: 0, unsupported: device.ui.unsupported, byType: device.ui.byType},
    where + ": UIManager events");
  assert.equal(info.eventsUnobserved, 0, where + ": every event found its module");
  // The host polls at least as many frames as the probe waited for, and never after it stopped.
  if (previous != null) {
    assert.ok(info.polls >= previous.polls, where + ": polls never go back");
    if (device.stopped && previous.stopped) {
      assert.equal(info.polls, previous.polls, where + ": a stopped application polls no more");
    }
  }
}

function verifyApplication(report, app, names, device) {
  assert.deepEqual(Object.keys(report.stages[app]).sort(), [...names].sort(), app + ": the whole script ran");
  let previous = null;
  for (const name of names) {
    const step = verifyStep(report, device, app, name);
    verifyCounters(step, device, previous, app, name);
    const waited = step.commands.filter(command => command.do === "wait").reduce((total, command) => total + command.polls, 0);
    if (device.created && !device.stopped && previous != null && previous.created) {
      assert.ok(step.info.polls - previous.polls >= waited, `${app}/${name}: the host polled the frames the probe waited for`);
    }
    if (name === "stop" || name === "real-stop") {
      // Stop ends the polling in the very frame it is called: the step before it already holds the final count.
      assert.equal(step.info.polls, previous.polls, `${app}: nothing is polled after stop`);
    }
    previous = {...step.info, created: device.created};
  }
}

// The script has to be able to tell the settings apart and to tell a change from a repeat.
function coverage(report, a) {
  const all = Object.values(report.stages.A).flatMap(step => step.commands);
  const metas = all.filter(command => command.do === "meta").map(command => command.value);
  const values = metas.flatMap(meta => Object.values(meta));
  assert.ok(values.includes(-1) && values.includes(0) && values.includes(1), "-1, 0 and 1 are reported");
  assert.ok(values.some(value => typeof value === "string") && values.some(value => Number.isInteger(value) && ![-1, 0, 1].includes(value)),
    "values that are not -1, 0 or 1 are reported");
  assert.ok(!("increase_contrast" in a.meta0) && metas.some(meta => !("reduce_transparency" in meta)),
    "a key the meta leaves out is the DisplayServer's reading");
  for (const entry of settings) {
    assert.ok(a.changes.some(changed => changed.length === 1 && changed[0] === entry.name), `${entry.name} is the only setting that changes at some frame`);
    assert.ok(a.events[entry.event] >= 2, `${entry.name} changes more than once`);
  }
  assert.ok(a.changes.some(changed => changed.length === settings.length), "all four settings change in one frame");
  // Every event the host can send has a listener, and so do the events it never can.
  const names = new Set(all.filter(command => command.do === "subscribe").map(command => command.event));
  for (const name of [...iosEventNames.keys(), "highTextContrastChanged", "nonsense"]) {
    assert.ok(names.has(name), "a listener of " + name);
  }
  const categoriesSeen = new Set(all.filter(command => command.method === "setAccessibilityContentSizeMultipliers").flatMap(command => command.args.flatMap(Object.keys)));
  assert.ok(categoriesSeen.has("notACategory") && categoriesSeen.has("large") && categoriesSeen.has("medium"), "the multipliers include invalid and unknown entries");
}

// Re-derives every step of a current-host report; throws on any difference.
export function verifyAccessibilityInfoReport(report) {
  assert.ok(report.initialMeta?.A != null && report.initialMeta.R === null, "the report says what each application started with");
  const a = new Device({meta: report.initialMeta.A, mounted: ["A", "B"]});
  verifyApplication(report, "A", stepsA, a);
  assert.equal(report.stages.A.stop.info.stopped, true);
  coverage(report, a);
  const r = new Device({meta: null, mounted: ["R"]});
  verifyApplication(report, "R", stepsR, r);
  // The real backend in headless reports nothing: no setting is ever known, and no event reached its listeners.
  assert.deepEqual(Object.values(r.known), [null, null, null, null]);
  assert.deepEqual(r.events, Object.fromEntries(deviceEvents.map(event => [event, 0])), "R never emitted");
  assert.deepEqual(Object.values(report.stages.R).flatMap(step => step.events.filter(event => !event.cleanup)), [], "R's listeners heard nothing");
  return {steps: {A: stepsA.length, R: stepsR.length}, events: a.events, changes: a.changes.length, checks: report.checks.length};
}
