import assert from "node:assert/strict";

// Independent oracle for build/switch-report.json. It re-derives every stage
// from the raw observations (JS log, native snapshots) and its own tables,
// written apart from tests/switch-probe.gd. It never trusts a probe verdict.
const switches = ["controlled", "fixed", "disabled", "colors", "plain", "sized", "removable"];
const touchTypes = ["topTouchStart", "topTouchMove", "topTouchEnd", "topTouchCancel", "topChange"];
// RN Switch.js (non-Android path) over RCTSwitchComponentView semantics: a tap
// toggles natively; a value prop that does not follow is restored by setValue.
const toggles = {
  "controlled/mouse": {root: "A", caseId: "controlled", device: "mouse", value: true, valueHandler: true, reverted: false, midPress: true},
  "controlled/touch": {root: "A", caseId: "controlled", device: "touch", value: false, valueHandler: true, reverted: false, midPress: true},
  "fixed/mouse": {root: "A", caseId: "fixed", device: "mouse", value: true, valueHandler: true, reverted: true},
  "fixed/touch": {root: "A", caseId: "fixed", device: "touch", value: true, valueHandler: true, reverted: true},
  "plain/mouse": {root: "A", caseId: "plain", device: "mouse", value: true, valueHandler: false, reverted: true},
  "colors/toggle": {root: "A", caseId: "colors", device: "mouse", value: true, valueHandler: true, reverted: false},
  "two-roots/B": {root: "B", caseId: "controlled", device: "mouse", value: true, valueHandler: true, reverted: false},
};
const palettes = {
  first: {off: "ff3b30ff", on: "5856d6ff", thumb: "ffcc00ff", background: "1c1c1eff"},
  second: {off: "8e8e93ff", on: "30b0c7ff", thumb: "007affff", background: "3a3a3cff"},
};
const defaults = {off: "e9e9eaff", on: "34c759ff", thumb: "ffffffff"};
const expectedCheckCount = 108;
export const normativeOriginalFailures = [
  "mount/Each root mounts one native Switch for each of its seven RCTSwitch elements",
  "mount/The application reports no host or runtime error",
];
export const expectedErrors = ["setValue requires [boolean]", "setValue requires [boolean]"];

const rawOf = log => log.filter(row => row.label === "raw" && touchTypes.includes(row.type));
const handlersOf = log => log.filter(row => row.label !== "raw");
const essence = value => ({value: value.value, toggles: value.toggles, commands: value.commands, transitions: value.transitions});
const transitionsAfter = (before, after) => after.transitions.slice(before.transitions.length);

function verifyToggle(name, stage, spec) {
  const other = spec.root === "A" ? "B" : "A";
  assert.deepEqual([stage.root, stage.caseId, stage.device, stage.expected, stage.valueHandler, stage.reverted],
    [spec.root, spec.caseId, spec.device, spec.value, spec.valueHandler, spec.reverted], name);
  const log = stage.react.log, raw = rawOf(log), handlers = handlersOf(log);
  assert.deepEqual(raw.map(row => [row.type, row.nativeTarget]),
    [["topTouchStart", stage.tag], ["topTouchEnd", stage.tag], ["topChange", stage.tag]], name);
  assert.equal(raw[2].value, spec.value, name);
  const labels = ["parent-capture", "switch-change", ...(spec.valueHandler ? ["value-change"] : []), "parent-bubble"];
  assert.deepEqual(handlers.map(row => row.label), labels, name);
  assert.ok(handlers.every(row => row.root === spec.root && row.caseId === spec.caseId && row.value === spec.value), name);
  // RN emits the Change after the touch ends; every handler follows the Raw event.
  assert.ok(raw[1].sequence < raw[2].sequence && handlers.every(row => row.sequence > raw[2].sequence), name);
  const change = handlers.find(row => row.label === "switch-change");
  assert.deepEqual(change.keys, ["target", "timeStamp", "value"], name);
  assert.ok(change.nativeTarget === stage.tag && change.targetIsSwitch && change.currentIsSwitch, name);
  for (const row of handlers.filter(entry => entry.label.startsWith("parent-"))) {
    assert.ok(row.currentTag === stage.cellTag && row.nativeTarget === stage.tag, name);
  }
  const expected = [{value: spec.value, cause: "input"}, ...(spec.reverted ? [{value: !spec.value, cause: "command"}] : [])];
  assert.deepEqual(transitionsAfter(stage.before, stage.after), expected, name);
  assert.equal(stage.after.toggles, stage.before.toggles + 1, name);
  assert.equal(stage.after.commands, stage.before.commands + (spec.reverted ? 1 : 0), name);
  assert.equal(stage.after.value, spec.reverted ? !spec.value : spec.value, name);
  assert.equal(stage.after.pressing, "none", name);
  assert.equal(stage.after.ignoredEmulated - stage.before.ignoredEmulated, spec.device === "touch" ? 2 : 0, name);
  if (spec.midPress) {
    assert.equal(stage.pressed.pressing, spec.device, name);
    assert.equal(stage.pressedPointer.responder, stage.tag, name);
    assert.equal(stage.pressedPointer.blockNative, false, name);
  }
  assert.ok(stage.pointer.responder === 0 && stage.pointer.activeTouches === 0, name);
  assert.deepEqual(essence(stage.otherAfter), essence(stage.otherBefore), name);
  assert.ok(log.every(row => row.root === undefined || row.root === spec.root), name);
  assert.notEqual(other, spec.root);
}

function verifyDisabled(name, stage, device) {
  const raw = rawOf(stage.react.log);
  assert.equal(stage.device, device, name);
  assert.deepEqual(raw.map(row => [row.type, row.nativeTarget]), [["topTouchStart", stage.tag], ["topTouchEnd", stage.tag]], name);
  assert.deepEqual(handlersOf(stage.react.log), [], name);
  assert.ok(stage.after.disabled && stage.after.value === false && stage.after.pressing === "none", name);
  assert.deepEqual(essence(stage.after), essence(stage.before), name);
}

function verifyColors(colors) {
  const first = palettes.first, second = palettes.second;
  const off = colors.initial.switch;
  assert.deepEqual([off.tintColor, off.onTintColor, off.thumbTintColor], [first.off, first.on, first.thumb]);
  assert.deepEqual([off.drawn.track, off.drawn.thumb, off.drawn.value], [first.off, first.thumb, false]);
  assert.equal(colors.initial.appearance.background, first.background);
  // Switch.js sets borderRadius 16; RN's border resolution caps it at half the height.
  assert.deepEqual(colors.initial.appearance.cornerRadii, [14, 14, 14, 14]);
  // The on thumb sits one radius (half the 28-point height) from the end.
  assert.deepEqual([colors.on.drawn.track, colors.on.drawn.thumb, colors.on.drawn.thumbX], [first.on, first.thumb, 63 - 14]);
  const changed = colors.second.switch;
  assert.deepEqual([changed.tintColor, changed.onTintColor, changed.thumbTintColor, changed.drawn.track, changed.drawn.thumb],
    [second.off, second.on, second.thumb, second.on, second.thumb]);
  assert.equal(colors.second.appearance.background, second.background);
  const reset = colors.defaults.switch;
  assert.deepEqual([reset.tintColor, reset.onTintColor, reset.thumbTintColor, reset.drawn.track, reset.drawn.thumb],
    [null, null, null, defaults.on, defaults.thumb]);
  assert.equal(colors.defaults.appearance.background, "00000000");
  assert.deepEqual(colors.defaults.appearance.cornerRadii, [0, 0, 0, 0]);
  assert.deepEqual([colors.plain.drawn.track, colors.plain.drawn.thumb], [defaults.off, defaults.thumb]);
}

function verifyOriginal(report) {
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual([...failures].sort(), [...normativeOriginalFailures].sort());
  assert.deepEqual(report.stages.mount.counts, {A: 0, B: 0});
  const errors = report.stages.mount.application.errors;
  assert.ok(errors.length > 0 && errors.every(error => /Unsupported GodotControl kind: Switch|map::at/.test(error)), JSON.stringify(errors));
  assert.ok(errors.some(error => error.includes("Unsupported GodotControl kind: Switch")));
}

export function verifySwitchReport(report, {original = false} = {}) {
  assert.equal(report.scenario, "native-switch");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, original);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.deepEqual(report.expectedOriginalFailures, normativeOriginalFailures);
  const after = report.afterStop;
  assert.ok(after.stopped && after.rootCount === 0 && after.pendingWork === 0 && after.pointerRouting.stored === 0);
  for (const name of ["A", "B"]) {
    const final = report.stages["stoppedRoot" + name];
    assert.ok(final.nativeTags === 0 && final.creates === final.deletes, name);
  }
  if (original) {
    verifyOriginal(report);
    return;
  }
  assert.equal(report.emulateMouseFromTouch, true);
  const {stages} = report;
  assert.deepEqual(stages.mount.counts, {A: switches.length, B: switches.length});
  assert.deepEqual(stages.mount.application.errors, []);
  // The generated SwitchNativeComponent ViewConfig, merged into RN's global
  // registry, makes topChange bubble; the GodotControl direct entry remains.
  assert.deepEqual(stages.registry.react.registry, {bubbling: {bubbled: "onChange", captured: "onChangeCapture"},
    direct: {registrationName: "onChange"}});
  for (const name of ["A", "B"]) {
    const nodes = stages.mount.roots[name].nodes;
    for (const caseId of switches) {
      const node = nodes.find(row => row.testID === `${name}-${caseId}`);
      assert.ok(node && node.kind === "switch" && node.tag === stages.registry.react.roots[name].tags[caseId], `${name}-${caseId}`);
    }
  }
  // RN iOS measures UISwitch plus two points: 61x28 + 2 on iOS 26.3, the
  // repo's iOS reference runtime. An explicit size wins.
  const {plain, cell, sized} = stages.layout;
  assert.deepEqual([plain.fabricWidth, plain.fabricHeight, plain.width, plain.height], [63, 28, 63, 28]);
  assert.deepEqual([cell.fabricWidth, plain.fabricX - cell.fabricX], [166, 6]);
  assert.deepEqual([sized.fabricWidth, sized.fabricHeight, sized.width, sized.height], [80, 40, 80, 40]);
  for (const [name, spec] of Object.entries(toggles)) {
    verifyToggle(name, stages[name], spec);
  }
  verifyDisabled("disabled/mouse", stages["disabled/mouse"], "mouse");
  verifyDisabled("disabled/touch", stages["disabled/touch"], "touch");
  verifyColors(stages.colors);
  const commands = stages.commands;
  assert.deepEqual(transitionsAfter(commands.before, commands.on), [{value: false, cause: "command"}, {value: true, cause: "command"}]);
  assert.equal(commands.on.commands, commands.before.commands + 2);
  assert.deepEqual(essence(commands.after), essence(commands.on));
  assert.deepEqual(commands.errors, expectedErrors);
  assert.deepEqual(rawOf(commands.react.log), []);
  const removal = stages.removal;
  assert.ok(removal.pressed.pressing === "mouse" && removal.pressedPointer.responder === removal.tag);
  assert.ok(!removal.removed.nodes.some(row => row.testID === "A-removable") && removal.removed.pointer.responder === 0);
  assert.ok(!removal.react.log.some(row => row.type === "topChange") && handlersOf(removal.react.log).length === 0);
  assert.deepEqual(removal.stale, {connected: false, tag: removal.tag});
  assert.ok(removal.restored.tag !== removal.tag);
  assert.deepEqual(removal.restored.switch.transitions, [{value: false, cause: "props"}]);
  // Both roots keep separate state in one Hermes application.
  const roots = stages.beforeStop.react.roots;
  assert.ok(roots.A.on === false && roots.B.on === true && roots.A.tags.controlled !== roots.B.tags.controlled);
  const input = handlersOf(stages.input.react.log);
  assert.deepEqual(input.map(row => [row.label, row.text]), [["parent-capture", "x"], ["input-change", "x"], ["parent-bubble", "x"]]);
  assert.equal(input[1].currentTag, stages.input.inputTag);
  assert.deepEqual(stages.beforeStop.application.errors, expectedErrors);
  assert.deepEqual(after.errors, expectedErrors);
  // Only after its own derivations does the oracle compare the probe verdict.
  assert.equal(report.checks.length, expectedCheckCount);
  assert.ok(report.allCurrentAssertionsPassed && report.checks.every(row => row.passed));
}
