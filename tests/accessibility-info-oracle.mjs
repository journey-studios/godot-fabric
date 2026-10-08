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
//    ignores any other); a valid call and the programmatic focus are refused with E_UNSUPPORTED.
//  - sendAccessibilityEvent reaches the host's UIManager delegate; iOS acts on focus alone (RCTMountingManager.mm).
//  - An announcement (announceForAccessibility*, RCTAccessibilityManager.mm:319-358) is put in a new element with the text as its
//    value and a live mode, because AccessKit's macOS adapter speaks the value of a live node when it is added: priority "high"
//    is assertive and every other priority, "low" aside, is polite. iOS's queue option and "low" priority have no AccessKit
//    equivalent and are refused. With no screen reader (headless, or the recorder says so) the call returns and the
//    announcement is dropped, never kept for a screen reader that turns on later. The element is made inside an accessibility
//    update, the update is asked for by the frame's pump, and the element is freed outside the next update. The recorder is the
//    AccessibilityServer: it runs the update itself and records every call, so the model below is a state machine over frames
//    whose recorded calls are compared one by one.
// display is the DisplayServer method of Godot 4.7.2 that is the setting's reading (extension_api.json lists each as an int
// with no arguments); it is this list's, not the host's, that the host's names are held to.
const settings = [
  {name: "screenReader", key: "screen_reader", event: "screenReaderChanged", getter: "isScreenReaderEnabled", method: "getCurrentVoiceOverState",
    display: "accessibility_screen_reader_active"},
  {name: "reduceMotion", key: "reduce_animation", event: "reduceMotionChanged", getter: "isReduceMotionEnabled", method: "getCurrentReduceMotionState",
    display: "accessibility_should_reduce_animation"},
  {name: "reduceTransparency", key: "reduce_transparency", event: "reduceTransparencyChanged", getter: "isReduceTransparencyEnabled",
    method: "getCurrentReduceTransparencyState", display: "accessibility_should_reduce_transparency"},
  {name: "increaseContrast", key: "increase_contrast", event: "darkerSystemColorsChanged", getter: "isDarkerSystemColorsEnabled",
    method: "getCurrentDarkerSystemColorsState", display: "accessibility_should_increase_contrast"},
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
// Why the focus and two options of an announcement are refused (the spec of this slice, not the host's strings).
const focusMessage = "E_UNSUPPORTED: Godot has a single focus; moving the screen reader's focus would move the keyboard focus and blur the "
  + "focused control, which iOS does not do";
const queueError = /E_UNSUPPORTED.*the macOS accessibility API has no announcement queue/;
const priorityError = /E_UNSUPPORTED.*AccessKit has only polite and assertive/;
// An announcement that waits for an update that does not come is dropped after this many frames.
const maxPendingPumps = 120;
// The engine API the announcements call, by name (extension_api.json of Godot 4.7.2 and the AccessibilityServer's source).
const announceApi = {server: "AccessibilityServer", methods: ["is_supported", "create_sub_element", "update_set_value", "update_set_live", "free_element"],
  constants: ["ROLE_STATIC_TEXT", "LIVE_POLITE", "LIVE_ASSERTIVE"], tree: "is_accessibility_enabled",
  node: ["get_accessibility_element", "queue_accessibility_update"], missing: []};
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
  "direct-getters", "content-size", "announce-basic", "announce-priorities", "announce-twice", "announce-batch", "announce-empty",
  "announce-refused", "focus-refused", "announce-no-reader", "announce-reader-leaves", "announce-expires", "announce-no-element",
  "ui-events", "unsubscribe", "unmount", "stop"];
const stepsR = ["real-read", "real-getters", "real-subscribe", "real-announce", "real-after", "real-stop"];

// One application's announcements, as a state machine over frames. recorder is the settings of the validation recorder that
// stands in for the AccessibilityServer ({available, element, delivers}, each true unless it says false), or null for the
// real server of a headless engine, where no screen reader is ever there.
class Announcements {
  constructor(recorder) {
    this.recorder = recorder;
    Object.assign(this, {requested: 0, published: 0, released: 0, updatesRequested: 0, updates: 0, lastText: null, lastPriority: null});
    this.dropped = {noScreenReader: 0, empty: 0, expired: 0, stopped: 0};
    this.refused = {queue: 0, priority: 0};
    this.pending = [];
    this.held = [];
    this.log = [];
    this.next = 1;
    this.stopped = false;
  }
  setting(key) {
    return this.recorder != null && this.recorder[key] !== false;
  }
  // A screen reader is there: only the recorder can say so in a headless run.
  get available() {
    return !this.stopped && this.setting("available");
  }
  record(op, handle = 0, text = "") {
    this.log.push({op, handle, text});
  }
  // The result is what the module does with the call: nothing (it returns) or the refusal it throws.
  announce(text, {queue = false, priority = null} = {}) {
    if (this.stopped) {
      return "stopped";
    }
    if (queue === true) {
      this.refused.queue += 1;
      return "queue";
    }
    if (priority === "low") {
      this.refused.priority += 1;
      return "priority";
    }
    const live = priority === "high" ? "assertive" : "polite";
    this.requested += 1;
    this.lastText = text;
    this.lastPriority = live;
    if (text === "") {
      this.dropped.empty += 1;
    } else if (!this.available) {
      this.dropped.noScreenReader += 1;
    } else {
      this.pending.push({text, live, age: 0});
    }
    return "returned";
  }
  // The update the engine would run: a new element for each announcement waiting, with its value and live mode.
  update() {
    this.record("update.begin");
    this.updates += 1;
    for (const {text, live} of this.pending.splice(0)) {
      if (!this.setting("element")) {
        this.dropped.noScreenReader += 1;
        continue;
      }
      const handle = this.next++;
      this.record("create", handle);
      this.record("value", handle, text);
      this.record("live", handle, live);
      this.held.push(handle);
      this.published += 1;
    }
    this.record("update.end");
  }
  // One frame: free what the last update published (outside any update), drop what cannot be heard, ask for the update.
  frame() {
    if (this.stopped) {
      return;
    }
    const freed = this.held.splice(0);
    for (const handle of freed) {
      this.record("free", handle);
      this.released += 1;
    }
    if (this.pending.length > 0) {
      if (!this.available) {
        this.dropped.noScreenReader += this.pending.length;
        this.pending = [];
      } else {
        for (const item of this.pending) {
          item.age += 1;
        }
        const expired = this.pending.filter(item => item.age > maxPendingPumps).length;
        this.dropped.expired += expired;
        this.pending = this.pending.filter(item => item.age <= maxPendingPumps);
      }
    }
    if (freed.length > 0 || this.pending.length > 0) {
      this.updatesRequested += 1;
      if (this.setting("delivers")) {
        this.update();
      }
    }
  }
  // Frames until nothing is waiting and nothing is left to free: a step gives the host more frames than that.
  settle() {
    for (let frames = 0; (this.pending.length > 0 || this.held.length > 0) && !this.stopped; frames += 1) {
      assert.ok(frames < 2 * maxPendingPumps, "the announcements settle");
      this.frame();
    }
  }
  stop() {
    if (this.stopped) {
      return;
    }
    this.dropped.stopped += this.pending.length;
    this.pending = [];
    for (const handle of this.held.splice(0)) {
      this.record("free", handle);
      this.released += 1;
    }
    this.stopped = true;
  }
  // What the host's snapshot must say.
  expected() {
    return {stopped: this.stopped, osTree: this.available, requested: this.requested, published: this.published, released: this.released,
      updatesRequested: this.updatesRequested, updates: this.updates, pending: this.pending.length, held: this.held.length,
      dropped: this.dropped, refused: this.refused, lastText: this.lastText, lastPriority: this.lastPriority, maxPendingPumps,
      api: announceApi, recorded: this.log};
  }
}

// One application's accessibility state as RN's rules and the contract define it.
class Device {
  constructor({meta, mounted, announcer}) {
    Object.assign(this, {meta, meta0: meta, mounted: new Set(mounted), announcer0: announcer});
    this.announcements = new Announcements(announcer);
    this.created = false;
    this.stopped = false;
    this.last = Object.fromEntries(settings.map(entry => [entry.name, -1]));
    this.known = Object.fromEntries(settings.map(entry => [entry.name, null]));
    this.resolved = Object.fromEntries(settings.map(entry => [entry.name, 0]));
    this.rejectedUnknown = Object.fromEntries(settings.map(entry => [entry.name, 0]));
    this.events = Object.fromEntries(deviceEvents.map(event => [event, 0]));
    this.unbacked = Object.fromEntries(unbackedSettings.map(entry => [entry.name, 0]));
    this.refused = {contentSize: 0, contentSizeInvalid: 0, announceInvalid: 0, focus: 0};
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
    case "announcer":
      // The recorder's settings are read on every call of the announcer, so they take effect at once.
      device.announcements.recorder = command.value;
      break;
    case "wait":
      assert.equal(command.reached, true, "the host delivered the frames the probe waited for");
      device.poll(outcome);
      device.announcements.settle();
      break;
    case "settle":
      device.poll(outcome);
      device.announcements.settle();
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
      device.announcements.stop();
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
      announcementCall(device, (state, expected) => expect(label, api, {state, ...expected}), name, args);
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
    case "announceForAccessibility":
    case "announceForAccessibilityWithOptions":
      announcementCall(device, (state, expected) => expect(label, api, {state, ...expected, callbacks: []}), method, args);
      break;
    default:
      throw new Error("accessibility info oracle: unknown module method " + method);
  }
}

// A call of the announcement methods and of the focus, public or direct: what the module returns or throws, and what the
// announcer does. The text is the first argument; the options, when there are any, the second. An option of the wrong type is an
// argument error (queue is read first), and the refusals come from what the options ask for.
function announcementCall(device, expect, name, args) {
  if (name === "setAccessibilityFocus") {
    device.refused.focus += 1;
    expect("threw", {error: focusMessage});
    return;
  }
  let options = {};
  if (name === "announceForAccessibilityWithOptions") {
    const given = args[1];
    const absent = value => value === undefined || value === null;
    if (!absent(given.queue) && typeof given.queue !== "boolean") {
      device.refused.announceInvalid += 1;
      expect("threw", {error: /E_ARGUMENT/});
      return;
    }
    if (!absent(given.priority) && typeof given.priority !== "string") {
      device.refused.announceInvalid += 1;
      expect("threw", {error: /E_ARGUMENT/});
      return;
    }
    options = {queue: given.queue ?? false, priority: given.priority ?? null};
  }
  switch (device.announcements.announce(args[0], options)) {
    case "queue":
      expect("threw", {error: queueError});
      break;
    case "priority":
      expect("threw", {error: priorityError});
      break;
    case "returned":
      expect("returned", {});
      break;
    default:
      throw new Error("accessibility info oracle: the announcer is stopped but the module is not");
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
  device.announcements.settle();
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
    assert.deepEqual(info.settings[entry.name], {displayMethod: entry.display, last: device.created ? device.last[entry.name] : -1,
      known: device.known[entry.name], reads: device.created ? 1 + info.polls : 0, resolved: device.resolved[entry.name],
      rejectedUnknown: device.rejectedUnknown[entry.name], events: device.events[entry.event]}, `${where}: ${entry.name}`);
  }
  assert.deepEqual(info.events, device.events, where + ": events by name");
  assert.deepEqual(info.unbacked, device.unbacked, where + ": settings with no backing");
  assert.deepEqual(info.refused, device.refused, where + ": refused calls");
  // The announcements: the counters, what the last one was, whether an OS tree stands behind the application, the engine API
  // they call and every call the announcer made to the recorder.
  assert.deepEqual(info.announcements, device.announcements.expected(), where + ": announcements");
  const {requested, published, pending} = info.announcements;
  const dropped = Object.values(info.announcements.dropped).reduce((total, count) => total + count, 0);
  assert.equal(requested, published + pending + dropped, where + ": every announcement taken is published, pending or dropped");
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

// The script has to exercise every way an announcement is taken, published, refused or dropped.
function announcementCoverage(report, a) {
  const calls = Object.values(report.stages.A).flatMap(step => step.commands).filter(command => ["call", "direct"].includes(command.do));
  const withOptions = calls.filter(command => (command.api ?? command.method).endsWith("announceForAccessibilityWithOptions"))
    .map(command => decode(command.args)[1]);
  const priorities = new Set(withOptions.map(options => options.priority));
  for (const priority of ["high", "default", "urgent", "low", undefined, null]) {
    assert.ok(priorities.has(priority), "an announcement with priority " + priority);
  }
  assert.ok(withOptions.some(options => options.queue === true) && withOptions.some(options => options.queue === false)
    && withOptions.some(options => options.queue === null), "queue true, false and null");
  assert.ok(withOptions.some(options => typeof options.queue === "string") && withOptions.some(options => typeof options.priority === "number")
    && withOptions.some(options => typeof options.priority === "object" && options.priority !== null), "options of the wrong type");
  assert.ok(calls.some(command => (command.api ?? command.method).endsWith("announceForAccessibility") && decode(command.args)[0] === ""), "an empty text");
  assert.ok(calls.some(command => (command.api ?? command.method).endsWith("announceForAccessibility") && /[^\u0000-\u007f]/.test(decode(command.args)[0])), "a text beyond ASCII");
  const recorders = Object.values(report.stages.A).flatMap(step => step.commands).filter(command => command.do === "announcer").map(command => command.value);
  assert.ok(recorders.some(value => value.available === false) && recorders.some(value => value.delivers === false)
    && recorders.some(value => value.element === false), "a recorder with no screen reader, one that never delivers and one with no element");
  const final = report.stages.A.stop.info.announcements;
  for (const [reason, count] of Object.entries(final.dropped)) {
    assert.ok(count >= 1, "an announcement dropped for " + reason);
  }
  assert.ok(final.refused.queue >= 1 && final.refused.priority >= 1 && final.published >= 5 && a.announcements.stopped, "every outcome happens");
  // Several announcements of one frame share the update, the same text is said twice, and a handle is never reused.
  const creates = final.recorded.filter(entry => entry.op === "create").map(entry => entry.handle);
  assert.equal(new Set(creates).size, creates.length, "no element is made twice with the same handle");
  assert.ok(final.recorded.some((entry, index) => entry.op === "create" && final.recorded[index + 3]?.op === "create"), "an update with several elements");
  const values = final.recorded.filter(entry => entry.op === "value").map(entry => entry.text);
  assert.ok(values.some((text, index) => values.indexOf(text) !== index), "the same text is announced twice");
}

// Re-derives every step of a current-host report; throws on any difference.
export function verifyAccessibilityInfoReport(report) {
  assert.ok(report.initialMeta?.A != null && report.initialMeta.R === null, "the report says what each application started with");
  assert.ok(report.initialAnnouncer?.A != null && report.initialAnnouncer.R === null, "A announces to the recorder and R to the real server");
  const a = new Device({meta: report.initialMeta.A, mounted: ["A", "B"], announcer: report.initialAnnouncer.A});
  verifyApplication(report, "A", stepsA, a);
  assert.equal(report.stages.A.stop.info.stopped, true);
  coverage(report, a);
  announcementCoverage(report, a);
  const r = new Device({meta: null, mounted: ["R"], announcer: null});
  verifyApplication(report, "R", stepsR, r);
  // The method the host reads for each setting is the DisplayServer method the oracle names for it, the engine has that method,
  // and what the engine answers to it is what the host last read (-1 for all four in headless, where R has no meta).
  assert.deepEqual(Object.keys(report.displayMethods).sort(), settings.map(entry => entry.name).sort(), "a display method for each setting");
  for (const entry of settings) {
    const facts = report.displayMethods[entry.name];
    assert.equal(facts.method, entry.display, `${entry.name}: the DisplayServer method`);
    assert.equal(facts.exists, true, `${entry.name}: the DisplayServer has ${entry.display}`);
    assert.equal(facts.reading, r.last[entry.name], `${entry.name}: the DisplayServer's answer is what the host last read`);
    assert.equal(facts.last, r.last[entry.name], `${entry.name}: the host's last reading of the real backend`);
  }
  // The real backend in headless reports nothing: no setting is ever known, and no event reached its listeners.
  assert.deepEqual(Object.values(r.known), [null, null, null, null]);
  assert.deepEqual(r.events, Object.fromEntries(deviceEvents.map(event => [event, 0])), "R never emitted");
  assert.deepEqual(Object.values(report.stages.R).flatMap(step => step.events.filter(event => !event.cleanup)), [], "R's listeners heard nothing");
  // The engine has every name the announcements call, answers from the headless server say no screen reader is there, and the
  // host reports the very names the oracle lists.
  const facts = report.announceFacts;
  assert.deepEqual(report.announceApi, {server: announceApi.server, methods: announceApi.methods, constants: announceApi.constants,
    tree: announceApi.tree, node: announceApi.node}, "the probe asked the engine about the oracle's names");
  assert.equal(facts.serverRegistered, true, "the AccessibilityServer singleton exists");
  assert.deepEqual(facts.methods, Object.fromEntries(announceApi.methods.map(name => [name, true])), "every server method exists");
  assert.deepEqual(facts.constants, Object.fromEntries(announceApi.constants.map(name => [name, true])), "every server constant exists");
  assert.equal(facts.treeMethod, true, "SceneTree has " + announceApi.tree);
  assert.deepEqual(facts.nodeMethods, Object.fromEntries(announceApi.node.map(name => [name, true])), "Node has its two accessibility methods");
  assert.equal(facts.serverSupported, false, "the headless AccessibilityServer is not supported");
  assert.equal(facts.treeEnabled, false, "the headless tree has no accessibility");
  assert.deepEqual(r.announcements.expected().recorded, [], "the real server records nothing");
  assert.equal(r.announcements.available, false, "no screen reader behind the real, headless server");
  return {steps: {A: stepsA.length, R: stepsR.length}, events: a.events, changes: a.changes.length, checks: report.checks.length};
}

// The graphical lane (accessibility-announcements-bridge): what AccessKit asked AppKit to post for each announcement, re-derived
// from the rules (priority high is the high level, 90, and every other accepted priority the medium level, 50; each announcement
// is one post on the window; an empty text, queue: true and priority low post nothing). Throws on any difference. The batch of
// one frame is judged as a set: the order AccessKit posts it in is measured and reported, not assumed.
export function verifyAnnouncementsBridgeReport(report) {
  const level = priority => (priority === "high" ? 90 : 50);
  const post = (text, priority) => [text, level(priority), "GodotWindow"];
  const steps = report.stages.steps;
  assert.deepEqual(steps.saved, [post("Saved")], "an announcement is one post with its text and the medium level");
  assert.deepEqual(steps.again, [post("Saved")], "the same text again is posted again");
  assert.deepEqual(steps.high, [post("Alert", "high")], "priority high is the high level");
  assert.deepEqual(steps.plain, [post("Plain", "default")], "priority default is the medium level");
  assert.deepEqual(steps.odd, [post("Odd", "urgent")], "a priority iOS ignores is the medium level");
  assert.deepEqual([...steps.batch].sort(), [post("First"), post("Second"), post("Third", "high")].sort(), "three announcements of a frame are three posts");
  assert.deepEqual(report.stages.batchOrder.slice().sort(), ["First", "Second", "Third"], "the order measured is of the same three");
  assert.deepEqual(steps.silent, [], "an empty text, queue: true and priority low post nothing");
  assert.deepEqual(report.stages.afterStop.late, [], "nothing is posted after stop");
  const posted = [steps.saved, steps.again, steps.high, steps.plain, steps.odd, steps.batch].reduce((total, rows) => total + rows.length, 0);
  const host = report.stages.beforeStop.announcements;
  assert.equal(host.published, posted, "the host published what AccessKit posted");
  assert.equal(host.recorded.length, 0, "the real server was used, not the recorder");
  return {posts: posted, batchOrder: report.stages.batchOrder};
}
