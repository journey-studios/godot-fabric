import assert from "node:assert/strict";

// Independent oracle, written from RN's rules and not from the probe or the host.
// It replays the commands every step of a report ran against a model of what RN's
// original Linking, Clipboard and Vibration do over the native contract, and
// compares calls, backend log, events and the host's counters with it; it throws
// on any difference.
//
// RN's rules the model follows:
//  - Linking.js validates a URL in JavaScript (a non-string, then the empty
//    string) before any native call; RCTLinkingManager's iOS contract then has
//    openURL resolve true or reject "Unable to open URL: <url>", canOpenURL resolve
//    a boolean and getInitialURL resolve the launch URL or null. openSettings
//    never resolves on Godot, and sendIntent rejects "Unsupported" outside Android.
//  - The "url" event reaches every listener of the one RCTDeviceEventEmitter once,
//    in subscription order, and only a module that exists carries it.
//  - Vibration.js (Platform.OS other than android) calls the native vibrate for a
//    number, schedules an array in JavaScript with one vibrate(400) per step and
//    ignores any vibrate() while a pattern runs; a repeating pattern never ends
//    and cancel() does not stop it (Vibration.js:90,106-110).
//  - Clipboard resolves the text, "" for an empty clipboard; setString returns nothing.
const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:[\s\S]/u;
const hasScheme = url => scheme.test(url);
const decode = value => value != null && typeof value === "object" && !Array.isArray(value) && "$number" in value ? Number(value.$number) : value;
const moduleOf = {Linking: "LinkingManager", Clipboard: "Clipboard", Vibration: "Vibration"};
const unavailable = /E_CLIPBOARD_UNAVAILABLE/;
const disposed = /E_MODULE_DISPOSED/;
const isHazard = name => name.startsWith("hazard-");

const stepsA = ["early", "lazy-clipboard", "lazy-vibration", "lazy-linking", "clipboard-ascii", "clipboard-unicode", "clipboard-newlines",
  "clipboard-empty", "clipboard-overwrite", "clipboard-external", "clipboard-external-again", "clipboard-same-tick", "clipboard-bridge",
  "clipboard-unavailable", "linking-can-open", "linking-open", "linking-open-refused", "linking-open-invalid", "linking-open-javascript",
  "linking-settings", "linking-initial", "deep-link-subscribe", "deep-link-one", "deep-link-order", "deep-link-invalid", "deep-link-remove",
  "deep-link-unmount", "linking-initial-stable", "vibration-default", "vibration-pattern", "vibration-after-pattern", "vibration-cancel",
  "vibration-argument", "vibration-native-arguments", "vibration-constants", "hazard-repeat", "hazard-cancel", "hazard-ignored", "stop"];
const stepsR = ["real-clipboard", "real-vibration", "real-linking", "stop"];

// One application's device state as RN's rules and the contract define it.
class Device {
  constructor({recording, launch, pasteboard = "", openCode = 0, mounted}) {
    Object.assign(this, {recording, launch, pasteboard, openCode, mounted: new Set(mounted)});
    // A recording application replaces the whole backend and has a clipboard; the real one has none in headless.
    this.available = recording;
    this.vibrating = false;
    this.stopped = false;
    this.created = {LinkingManager: 0, Clipboard: 0, Vibration: 0};
    this.listeners = [];
    this.log = [];
    this.counters = {
      modules: this.created,
      linking: {initialUrlReads: 0, canOpen: 0, opened: 0, invalidUrls: 0, refused: 0, settingsRefused: 0, urlsAccepted: 0, urlsRejected: 0,
        urlsObserved: 0, urlsUnobserved: 0},
      clipboard: {reads: 0, writes: 0, unavailable: 0},
      vibration: {vibrations: 0, refused: 0, patternsRefused: 0, cancels: 0},
    };
  }
  // The backend of a recording application keeps every call; the real one's open_url stand-in keeps only URLs.
  backend(entry) {
    if (this.recording || entry[0] === "open") {
      this.log.push(entry);
    }
  }
}

// What one command makes happen, and what it expects of JS: the calls it makes in order and the link rows.
function replay(device, command, outcome) {
  const args = (command.args ?? []).map(decode);
  const expect = (label, api, expected) => outcome.calls.push({label, api, ...expected});
  switch (command.do) {
    case "read":
      device.created[moduleOf[command.api]] = 1;
      assert.deepEqual(command.result, {available: true, sameAsOriginal: true, error: null}, "reading " + command.api);
      break;
    case "retain":
      for (const name of Object.keys(device.created)) {
        device.created[name] = 1;
      }
      assert.deepEqual(command.result, {LinkingManager: true, Clipboard: true, Vibration: true}, "retaining the modules");
      break;
    case "external":
      device.pasteboard = command.value;
      break;
    case "available":
      device.available = command.value;
      break;
    case "open_code":
      device.openCode = command.code;
      break;
    case "subscribe":
      device.listeners.push(command.root);
      break;
    case "unsubscribe":
      device.listeners = device.listeners.filter(name => name !== command.root);
      break;
    case "unmount": {
      // An unmounted root's effect cleanup removes its subscription and records itself.
      const unmounted = command.surface.slice(1);
      device.mounted.delete(unmounted);
      device.listeners = device.listeners.filter(name => name !== unmounted);
      outcome.cleanups.push(unmounted);
      break;
    }
    case "stop":
      // Stop runs the cleanup of every root still mounted, and only the never-removed library listener is left.
      outcome.cleanups.push(...device.mounted);
      device.mounted.clear();
      device.listeners = device.listeners.filter(name => name === "library");
      device.stopped = true;
      break;
    case "deliver":
      deliver(device, command, outcome);
      break;
    case "same_tick":
      callApi(device, expect, command.label + "/set", "Clipboard.setString", [command.value]);
      callApi(device, expect, command.label + "/get", "Clipboard.getString", []);
      break;
    case "call":
      callApi(device, expect, command.label, command.api, args);
      break;
    case "direct":
      callModule(device, expect, command.label, command.module, command.method);
      break;
    case "settle":
    case "wait_vibrations":
      break;
    default:
      throw new Error("device services oracle: unknown command " + command.do);
  }
}

function deliver(device, command, outcome) {
  const counters = device.counters.linking;
  if (device.stopped || !hasScheme(command.url)) {
    counters.urlsRejected += 1;
    assert.equal(command.result, false, "deliver_url " + JSON.stringify(command.url));
    return;
  }
  counters.urlsAccepted += 1;
  assert.equal(command.result, true, "deliver_url " + JSON.stringify(command.url));
  // Only the LinkingManager module carries the event to JS; without it the link has no listener to reach.
  if (device.created.LinkingManager === 1) {
    counters.urlsObserved += 1;
    outcome.rows.push(...device.listeners.map(listener => [listener, command.url]));
  } else {
    counters.urlsUnobserved += 1;
  }
}

// The checks Linking.js makes in JavaScript before any native call.
function invalidURL(url) {
  if (typeof url !== "string") {
    return new RegExp("Invalid URL: should be a string. Was: " + String(url));
  }
  return url === "" ? /Invalid URL: cannot be empty/ : null;
}

function callApi(device, expect, label, api, args) {
  device.created[moduleOf[api.split(".")[0]]] = 1;
  const counters = device.counters;
  const threw = error => expect(label, api, {state: "threw", error});
  switch (api) {
    case "Linking.canOpenURL":
    case "Linking.openURL": {
      const problem = invalidURL(args[0]);
      if (problem) {
        threw(problem);
      } else if (device.stopped) {
        threw(disposed);
      } else if (api === "Linking.canOpenURL") {
        counters.linking.canOpen += 1;
        expect(label, api, {state: "resolved", value: hasScheme(args[0])});
      } else if (!hasScheme(args[0])) {
        counters.linking.invalidUrls += 1;
        expect(label, api, {state: "rejected", error: "Unable to open URL: " + args[0]});
      } else {
        device.backend(["open", args[0]]);
        if (device.openCode === 0) {
          counters.linking.opened += 1;
          expect(label, api, {state: "resolved", value: true});
        } else {
          counters.linking.refused += 1;
          expect(label, api, {state: "rejected", error: "Unable to open URL: " + args[0]});
        }
      }
      return;
    }
    case "Linking.openSettings":
      if (device.stopped) {
        threw(disposed);
      } else {
        counters.linking.settingsRefused += 1;
        expect(label, api, {state: "rejected", error: "Unable to open app settings: unavailable on Godot"});
      }
      return;
    case "Linking.sendIntent":
      expect(label, api, {state: "rejected", error: "Unsupported"});
      return;
    case "Linking.getInitialURL":
      if (device.stopped) {
        threw(disposed);
      } else {
        counters.linking.initialUrlReads += 1;
        expect(label, api, {state: "resolved", value: device.launch});
      }
      return;
    case "Clipboard.setString":
      if (args.length !== 1 || typeof args[0] !== "string") {
        // The generated bridge converts the argument before the module runs.
        threw(/./);
      } else if (device.stopped) {
        threw(disposed);
      } else if (!device.available) {
        counters.clipboard.unavailable += 1;
        threw(unavailable);
      } else {
        counters.clipboard.writes += 1;
        device.pasteboard = args[0];
        device.backend(["set", args[0]]);
        expect(label, api, {state: "returned", undefinedValue: true});
      }
      return;
    case "Clipboard.getString":
      if (device.stopped) {
        threw(disposed);
      } else if (!device.available) {
        counters.clipboard.unavailable += 1;
        expect(label, api, {state: "rejected", error: unavailable});
      } else {
        counters.clipboard.reads += 1;
        device.backend(["get"]);
        expect(label, api, {state: "resolved", value: device.pasteboard});
      }
      return;
    case "Vibration.cancel":
      if (device.stopped) {
        threw(disposed);
      } else {
        counters.vibration.cancels += 1;
        device.backend(["cancel"]);
        expect(label, api, {state: "returned", undefinedValue: true});
      }
      return;
    case "Vibration.vibrate":
      vibrate(device, expect, label, args);
      return;
    default:
      throw new Error("device services oracle: unknown api " + api);
  }
}

// Vibration.js, for Platform.OS "godot": a pattern is scheduled in JavaScript.
function vibrate(device, expect, label, args) {
  const api = "Vibration.vibrate";
  const counters = device.counters.vibration;
  const returned = () => expect(label, api, {state: "returned", undefinedValue: true});
  const pattern = args.length === 0 || args[0] === undefined ? 400 : args[0];
  if (device.vibrating) {
    // RN ignores a vibrate() while a pattern runs, before anything native.
    returned();
  } else if (typeof pattern === "number") {
    if (device.stopped) {
      expect(label, api, {state: "threw", error: disposed});
    } else if (!Number.isFinite(pattern) || pattern < 0) {
      counters.refused += 1;
      expect(label, api, {state: "threw", error: /E_ARGUMENT/});
    } else {
      counters.vibrations += 1;
      device.backend(["vibrate", pattern]);
      returned();
    }
  } else if (!Array.isArray(pattern)) {
    expect(label, api, {state: "threw", error: "Vibration pattern should be a number or array"});
  } else {
    // A leading 0 vibrates at once; each remaining entry is one scheduled vibrate(400).
    const rest = pattern[0] === 0 ? pattern.slice(1) : pattern;
    const count = (pattern[0] === 0 ? 1 : 0) + rest.length;
    if (args[1] === true && rest.length > 0) {
      // A repeating pattern never ends. The probe checks it on its own, and the vibrations it makes are added to
      // the model from the backend log afterwards.
      device.vibrating = true;
    } else {
      counters.vibrations += count;
      for (let index = 0; index < count; index += 1) {
        device.backend(["vibrate", 400]);
      }
    }
    returned();
  }
}

// A method on the native module itself, as a retained reference or a direct call makes it.
function callModule(device, expect, label, module, method) {
  const api = module + "." + method;
  if (device.stopped) {
    expect(label, api, {state: "threw", error: disposed});
  } else if (method === "getConstants") {
    expect(label, api, {state: "returned", value: {}});
  } else if (api === "Vibration.vibrateByPattern") {
    // Godot has no pattern vibration; nothing may play it as something else.
    device.counters.vibration.patternsRefused += 1;
    expect(label, api, {state: "threw", error: /E_UNSUPPORTED/});
  } else {
    throw new Error("device services oracle: unknown direct call " + api);
  }
}

function matches(actual, expected) {
  return expected instanceof RegExp ? expected.test(String(actual)) : String(actual).includes(expected);
}

// One step of a report against the model.
function verifyStep(report, device, app, name) {
  const step = report.stages[app][name];
  const outcome = {calls: [], rows: [], cleanups: []};
  device.log = [];
  for (const command of step.commands) {
    replay(device, command, outcome);
  }
  // Every call JS made in the step, in order, with the outcome RN's rules give.
  assert.deepEqual(step.calls.map(entry => entry.label), outcome.calls.map(entry => entry.label), name + ": calls");
  step.calls.forEach((entry, index) => {
    const expected = outcome.calls[index];
    const where = `${name}/${expected.label}`;
    assert.equal(entry.api, expected.api, where);
    assert.equal(entry.state, expected.state, `${where}: ${entry.state} ${entry.error ?? ""}`);
    if ("value" in expected) {
      assert.deepEqual(entry.value, expected.value, where);
    }
    if (expected.undefinedValue) {
      assert.equal(entry.valueUndefined, true, where);
    }
    if ("error" in expected) {
      assert.ok(matches(entry.error, expected.error), `${where}: error ${entry.error}`);
    }
  });
  // The backend saw exactly these calls in this order; a repeating pattern is checked on its own.
  if (!isHazard(name)) {
    assert.deepEqual(step.backendLog, device.log, name + ": backend log");
  }
  const rows = step.events.filter(event => !event.cleanup).map(event => [event.listener, event.url]);
  assert.deepEqual(rows, outcome.rows, name + ": link events");
  assert.ok(step.events.filter(event => !event.cleanup).every(event => event.fields.length === 1 && event.fields[0] === "url"), name + ": {url} alone");
  assert.deepEqual(step.events.filter(event => event.cleanup).map(event => event.listener).sort(), outcome.cleanups.sort(), name + ": cleanups");
  return step;
}

function verifyCounters(step, device, name) {
  const services = step.services;
  assert.equal(services.stopped, device.stopped, name + ": stopped");
  assert.deepEqual(services.modules, device.created, name + ": created modules");
  const {launchUrl, ...linking} = services.linking;
  assert.equal(launchUrl, device.launch, name + ": launch URL");
  assert.deepEqual(linking, device.counters.linking, name + ": linking counters");
  assert.deepEqual(services.clipboard, device.counters.clipboard, name + ": clipboard counters");
  assert.deepEqual(services.vibration, device.counters.vibration, name + ": vibration counters");
}

const vibrate400 = entry => entry.length === 2 && entry[0] === "vibrate" && entry[1] === 400;

// A repeating pattern is checked by what RN guarantees: it vibrates 400 at a time, cancel() reaches the native
// module and does not stop it, and a later vibrate() is ignored. Returns how many vibrations it made.
function verifyHazard(report, device) {
  const [repeat, cancel, ignored] = ["hazard-repeat", "hazard-cancel", "hazard-ignored"].map(name => report.stages.A[name]);
  assert.ok(repeat.backendLog.length >= 6 && repeat.backendLog.every(vibrate400), "the repeating pattern vibrates 400 over and over");
  assert.equal(repeat.commands[1].reached, true);
  assert.deepEqual(cancel.backendLog[0], ["cancel"], "cancel() reaches the native module first");
  assert.ok(cancel.backendLog.length >= 5 && cancel.backendLog.slice(1).every(vibrate400), "the pattern keeps vibrating after cancel()");
  assert.equal(cancel.commands[1].reached, true);
  assert.ok(ignored.backendLog.every(vibrate400), "a vibrate(100) during the pattern is ignored by RN: nothing but the pattern's 400 arrives");
  assert.equal(ignored.calls[0].state, "returned");
  const vibrations = repeat.backendLog.length + cancel.backendLog.length - 1 + ignored.backendLog.length;
  device.counters.vibration.vibrations += vibrations;
  return vibrations;
}

function coverage(report) {
  const all = Object.values(report.stages.A).flatMap(step => step.commands);
  const texts = all.filter(command => command.api === "Clipboard.setString").flatMap(command => command.args).filter(value => typeof value === "string");
  // The samples that make the round trip discriminating.
  assert.ok(texts.some(text => /[\u{10000}-\u{10FFFF}]/u.test(text)), "an astral character is written");
  assert.ok(texts.some(text => /[\u0080-￿]/u.test(text)), "multibyte text is written");
  assert.ok(texts.some(text => text.includes("\r\n")) && texts.includes(""), "CRLF and the empty string are written");
  const delivered = all.filter(command => command.do === "deliver").map(command => command.url);
  assert.ok(delivered.some(hasScheme) && delivered.some(url => !hasScheme(url)), "valid and invalid links are delivered");
  const opened = all.filter(command => command.api === "Linking.openURL").flatMap(command => command.args);
  assert.ok(opened.some(url => typeof url === "string" && hasScheme(url)) && opened.some(url => typeof url === "string" && url !== "" && !hasScheme(url))
    && opened.includes("") && opened.some(url => typeof url !== "string"), "openURL gets valid, scheme-less, empty and non-string input");
  const canOpen = all.filter(command => command.api === "Linking.canOpenURL").flatMap(command => command.args);
  assert.ok(canOpen.filter(url => typeof url === "string" && hasScheme(url)).length >= 6
    && canOpen.filter(url => typeof url === "string" && url !== "" && !hasScheme(url)).length >= 6, "canOpenURL gets valid and invalid URLs");
  const vibrations = all.filter(command => command.api === "Vibration.vibrate");
  assert.ok(vibrations.some(command => command.args.length === 0) && vibrations.some(command => command.args[0] === 250)
    && vibrations.some(command => Array.isArray(command.args[0]) && command.args[1] === undefined)
    && vibrations.some(command => Array.isArray(command.args[0]) && command.args[1] === true), "default, number, pattern and repeating vibrations");
  // Two roots hear every link, and the removed root stops hearing them.
  const receivers = new Set(Object.values(report.stages.A).flatMap(step => step.events).filter(event => !event.cleanup).map(event => event.listener));
  assert.deepEqual([...receivers].sort(), ["A", "B", "library"]);
}

function verifyApplication(report, app, names, device) {
  assert.deepEqual(Object.keys(report.stages[app]).sort(), [...names].sort(), app + ": the whole script ran");
  for (const name of names) {
    if (name === "stop" && app === "A") {
      // The pattern that never ended made vibrations the steps around it did not see one by one.
      verifyHazard(report, device);
    }
    const step = verifyStep(report, device, app, name);
    if (isHazard(name)) {
      continue;
    }
    verifyCounters(step, device, name);
    if (app === "A") {
      assert.equal(step.pasteboard, device.pasteboard, name + ": pasteboard");
    }
  }
}

// Re-derives every step of a current-host report; throws on any difference.
export function verifyDeviceServicesReport(report) {
  assert.equal(report.launchOnly, false);
  const launch = report.expectedLaunch;
  assert.match(launch, /^godotfabric:\/\//);
  const a = new Device({recording: true, launch, pasteboard: "pasteboard before the application", mounted: ["A", "B"]});
  verifyApplication(report, "A", stepsA, a);
  const stopped = report.stages.A.stop;
  assert.equal(stopped.backendLog.length, 0, "no backend call after stop");
  assert.deepEqual(stopped.events.filter(event => !event.cleanup), [], "no link event after stop");
  assert.deepEqual(stopped.events.filter(event => event.cleanup).map(event => event.listener), ["B"], "stop runs root B's cleanup only");
  assert.equal(stopped.js.library.length, 1, "the library listener was never removed");
  // The never-removed library listener heard exactly the links delivered while the application ran.
  assert.deepEqual(stopped.js.events.filter(event => !event.cleanup && event.listener === "library").map(event => event.url),
    ["godotfabric://deep/1", "https://example.com/second?x=1&y=é", "godotfabric://deep/third", "godotfabric://deep/after-remove",
      "godotfabric://deep/after-unmount"]);
  coverage(report);
  const r = new Device({recording: false, launch, openCode: 2, mounted: ["R"]});
  verifyApplication(report, "R", stepsR, r);
  assert.deepEqual(report.stages.R["real-clipboard"].services.clipboard, {reads: 0, writes: 0, unavailable: 2},
    "R: the real headless clipboard was never read or written");
  assert.deepEqual(report.stages.R.stop.services.vibration, {vibrations: 1, refused: 0, patternsRefused: 0, cancels: 1}, "R: real vibration is a no-op");
  return {steps: {A: stepsA.length, R: stepsR.length}, linksAccepted: a.counters.linking.urlsAccepted, vibrations: a.counters.vibration.vibrations,
    checks: report.checks.length};
}

// The second launch: no --uri= argument, so there is no initial URL.
export function verifyLaunchReport(report) {
  assert.equal(report.launchOnly, true);
  assert.equal(report.expectedLaunch, null);
  assert.deepEqual(Object.keys(report.stages.R).sort(), ["launch", "stop"]);
  const launch = report.stages.R.launch;
  assert.deepEqual(launch.calls.map(entry => [entry.api, entry.state, entry.value]), [["Linking.getInitialURL", "resolved", null]]);
  assert.equal(launch.services.linking.launchUrl, null);
  assert.equal(launch.services.linking.initialUrlReads, 1);
  assert.deepEqual(launch.services.modules, {LinkingManager: 1, Clipboard: 0, Vibration: 0});
  assert.equal(report.stages.R.stop.services.stopped, true);
  return {checks: report.checks.length};
}
