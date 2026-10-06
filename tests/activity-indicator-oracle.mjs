import assert from "node:assert/strict";

// Independent oracle for build/activity-indicator-report.json, written apart
// from tests/activity-indicator-probe.gd. It re-derives every stage from the
// raw native snapshots and its own tables before it reads the probe verdict.
const cases = ["default", "large", "numeric", "controlled", "removable"];
// ActivityIndicator.js (non-Android path): small 20x20 and large 36x36 styles,
// a numeric size as the frame, and color null outside iOS. The native default
// draws RN's iOS gray.
const sizes = {default: [20, "small", null], large: [36, "large", "ff3b30ff"], numeric: [48, "small", "ffcc00ff"],
  controlled: [20, "small", "0a84ffff"], removable: [20, "small", "30b0c7ff"]};
const defaultColor = "999999ff";
const expectedCheckCount = 33;
export const normativeOriginalFailures = [
  "mount/Each root mounts one native spinner for each of its five RCTActivityIndicatorView elements",
  "mount/The application reports no host or runtime error",
];

function advanced([before, after], frames, label) {
  assert.equal(after.frames - before.frames, frames, label);
  assert.ok(after.turns > before.turns && after.processing && after.animating, label);
  assert.ok(after.drawn.visible && after.drawn.turns > before.turns && after.drawn.turns <= after.turns, label);
}
function frozen([before, after], label) {
  assert.equal(after.frames, before.frames, label);
  assert.equal(after.turns, before.turns, label);
  assert.ok(!after.processing && !after.animating, label);
}

function verifyOriginal(report) {
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual([...failures].sort(), [...normativeOriginalFailures].sort());
  assert.deepEqual(report.stages.mount.counts, {A: 0, B: 0});
  const errors = report.stages.mount.application.errors;
  assert.ok(errors.some(error => error.includes("Unsupported GodotControl kind: ActivityIndicatorView")), JSON.stringify(errors));
  assert.ok(errors.every(error => /Unsupported GodotControl kind: ActivityIndicatorView|map::at/.test(error)), JSON.stringify(errors));
}

export function verifyActivityIndicatorReport(report, {original = false} = {}) {
  assert.equal(report.scenario, "native-activity-indicator");
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
  const {stages, frames} = report;
  assert.equal(frames, 10);
  assert.deepEqual(stages.mount.counts, {A: cases.length, B: cases.length});
  assert.deepEqual(stages.mount.application.errors, []);
  // Every public ref resolves to the inner native component, as in RN.
  for (const name of ["A", "B"]) {
    for (const caseId of cases) {
      const node = stages.mount.roots[name].nodes.find(row => row.testID === `${name}-${caseId}`);
      assert.ok(node && node.kind === "activity" && node.tag === stages.refs.react.roots[name].tags[caseId], `${name}-${caseId}`);
      const [side, size, color] = sizes[caseId];
      assert.deepEqual([node.fabricWidth, node.fabricHeight, node.width, node.height], [side, side, side, side], `${name}-${caseId}`);
      assert.deepEqual([node.activity.size, node.activity.color, node.activity.drawColor], [size, color, color ?? defaultColor], `${name}-${caseId}`);
      assert.ok(node.activity.animating && node.activity.hidesWhenStopped && node.activity.spinnerVisible, `${name}-${caseId}`);
      assert.equal(node.activity.drawn.radius, side / 2, `${name}-${caseId}`);
    }
  }
  const defaults = stages.defaults.node.activity;
  assert.deepEqual([defaults.color, defaults.drawColor, defaults.drawn.color, defaults.drawn.spokes], [null, defaultColor, defaultColor, 8]);
  assert.deepEqual([stages.sizes.large.activity.drawn.radius, stages.sizes.numeric.activity.drawn.radius], [18, 24]);
  advanced(stages.spin.pair, frames, "spin");
  const {stopped} = stages.stop;
  assert.ok(!stopped.animating && !stopped.processing && !stopped.spinnerVisible && !stopped.drawn.visible);
  assert.deepEqual([stopped.starts, stopped.stops], [1, 1]);
  frozen(stages.stop.controlled, "stop");
  assert.equal(stages.stop.running[1].frames - stages.stop.running[0].frames, frames);
  // UIActivityIndicatorView keeps a stopped spinner when hidesWhenStopped is false.
  const shown = stages.static.shown;
  assert.ok(shown.spinnerVisible && shown.drawn.visible && !shown.processing);
  assert.equal(shown.drawn.turns, stages.static.frozenTurns);
  frozen(stages.static.pair, "static");
  assert.ok(stages.static.pair[1].drawn.visible);
  const restarted = stages.restart.restarted;
  assert.ok(restarted.animating && restarted.processing && restarted.starts === 2 && restarted.turns > stages.restart.frozenTurns);
  advanced(stages.restart.pair, frames, "restart");
  assert.deepEqual([stages.color.green.color, stages.color.green.drawn.color], ["34c759ff", "34c759ff"]);
  assert.deepEqual([stages.color.reset.color, stages.color.reset.drawColor, stages.color.reset.drawn.color],
    [null, defaultColor, defaultColor]);
  const remount = stages.remount;
  assert.ok(!remount.removed.nodes.some(row => row.testID === "A-removable"));
  assert.equal(remount.removed.deletes, remount.deletesBefore + 1);
  assert.ok(remount.newTag !== remount.oldTag && remount.fresh.starts === 1 && remount.fresh.turns < remount.old.turns);
  advanced(remount.pair, frames, "remount");
  const b = stages.twoRoots.controlled;
  assert.ok(b.animating && b.processing && b.color === "0a84ffff" && b.starts === 1 && b.stops === 0);
  assert.deepEqual(stages.twoRoots.react.roots.B.tags, stages.refs.react.roots.B.tags);
  advanced(stages.twoRoots.pair, frames, "two-roots");
  assert.deepEqual(stages.beforeStop.application.errors, []);
  // Only after its own derivations does the oracle compare the probe verdict.
  assert.equal(report.checks.length, expectedCheckCount);
  assert.ok(report.allCurrentAssertionsPassed && report.checks.every(row => row.passed));
}
