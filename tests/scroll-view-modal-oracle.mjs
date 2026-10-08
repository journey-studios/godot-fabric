import assert from "node:assert/strict";

const scrollViewModalChecks = [
  "setup/two original RN Modals have independent owner Windows",
  "setup/all root and Modal ScrollViews have real overflow",
  "control/Surface root wheel scrolls vertical and horizontal axes by 48 times factor",
  "control/Modal Window still routes a non-wheel click to the original RN Pressable",
  "control/owner Window routes a non-wheel native pan into the original RN ScrollView",
  "setup/public original RN scrollTo instantaneously resets both Modal controls before wheel measurements",
  "modal/down wheel applies 48 times its factor through Window.window_input",
  "modal/up wheel reverses direction and retains fractional factor",
  "modal/right wheel scrolls the horizontal ScrollView with factor",
  "modal/left wheel reverses horizontal direction",
  "modal wheel leaves its background root and independent otherWindow unchanged",
  "observation/four modal wheels reach the current Modal Window.window_input with exact direction and factor",
  "cleanup/both owner runtimes, Modal windows, surfaces, pointers, timers, and tags are released",
];

const near = (actual, expected, label) => assert.ok(
  Number.isFinite(actual) && Math.abs(actual - expected) <= 0.01,
  `${label}: expected ${expected}, received ${actual}`,
);
const node = (stage, testID) => {
  const match = stage?.nodes?.find(row => row.testID === testID);
  assert.ok(match, `mounted native node exists: ${testID}`);
  return match;
};
const scroll = (stage, testID) => {
  const value = node(stage, testID).scroll;
  assert.ok(value && typeof value === "object", `scroll snapshot exists: ${testID}`);
  return value;
};
const cleanCounters = (owner, label) => {
  assert.equal(owner.stopped, true, `${label} stopped`);
  assert.equal(owner.rootCount, 0, `${label} has no roots`);
  assert.deepEqual(owner.errors, [], `${label} errors`);
  for (const key of ["pendingTimers", "pendingAnimationFrames", "pendingRootRetirements", "pendingWork", "modalRuntimeMembers"])
    assert.equal(owner[key], 0, `${label}.${key}`);
  assert.equal(owner.hostPhasePending, false, `${label} host phase`);
  assert.equal(owner.windowListener, false, `${label} window listener`);
  assert.equal(owner.pointerListenerQueryInstalled, false, `${label} pointer listener query`);
  assert.equal(owner.pointerListenerQuerySuppressed, 0, `${label} pointer listener suppression`);
  const route = owner.pointerRouting;
  for (const key of ["active", "contacts", "hoverPointers", "stored", "suppressed"])
    assert.equal(route?.[key], 0, `${label}.pointerRouting.${key}`);
  const processor = owner.pointerProcessor;
  for (const key of ["active", "activeCapture", "pendingCapture", "hover"])
    assert.equal(processor?.[key], 0, `${label}.pointerProcessor.${key}`);
};
const cleanSurface = (surface, label) => {
  cleanCounters(surface, label);
  assert.equal(surface.applicationStopped, true, `${label} application stopped`);
  assert.equal(surface.nativeTags, 0, `${label} native tags`);
  assert.equal(surface.retiringTags, 0, `${label} retiring tags`);
  for (const key of ["activePointers", "activeTouches", "takenPointers", "responder", "hoverPointers"])
    assert.equal(surface.pointer?.[key], 0, `${label}.pointer.${key}`);
  assert.equal(surface.pointer?.blockNative, false, `${label} native blocking`);
};

export function assertScrollViewModalReport(report) {
  assert.equal(report.scenario, "scroll-view-modal-wheel-routing");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(typeof report.displayServer, "string");
  assert.notEqual(report.displayServer.trim(), "");
  assert.notEqual(report.displayServer, "headless");
  assert.deepEqual(report.checks.map(row => row.name), scrollViewModalChecks, "fixed 13-check inventory");
  assert.equal(new Set(report.checks.map(row => row.name)).size, 13, "check names are unique");
  assert.ok(report.checks.every(row => row.passed === true), JSON.stringify(report.checks.filter(row => row.passed !== true)));
  assert.equal(report.allAssertionsPassed, true);
  assert.deepEqual(report.scope, {originalRNModal: true, originalRNScrollView: true,
    actualWindowInputSignal: true, mobile: false}, "scope is explicit and bounded");

  assert.equal(report.ownerWindowIds.length, 2);
  assert.ok(report.ownerWindowIds.every(id => Number.isSafeInteger(id) && id > 0));
  assert.equal(new Set(report.ownerWindowIds).size, 2, "owner Windows are distinct");
  assert.equal(report.modalWindowIds.length, 2);
  assert.ok(report.modalWindowIds.every(id => Number.isSafeInteger(id) && id > 0));
  assert.equal(new Set(report.modalWindowIds).size, 2, "Modal Windows are distinct");
  const modalA = node(report.stages.afterPan, "probe-modal").modalWindow;
  const modalB = node(report.stages.initialB, "probe-modal").modalWindow;
  assert.equal(modalA.id, report.modalWindowIds[0], "wheel observer is attached to Modal A's current Window");
  assert.equal(modalB.id, report.modalWindowIds[1], "owner B has its own Modal Window");
  assert.equal(modalA.parentId, report.ownerWindowIds[0]);
  assert.equal(modalB.parentId, report.ownerWindowIds[1]);
  assert.equal(modalA.visible, true);
  assert.equal(modalB.visible, true);
  assert.equal(modalA.exclusive, true);
  assert.equal(modalB.exclusive, true);
  for (const stageName of ["rootBeforeModalWheel", "rootAfterModalWheel"]) {
    assert.equal(node(report.stages[stageName], "probe-modal").modalWindow.id, report.modalWindowIds[0],
      `Modal A Window identity remains current at ${stageName}`);
    assert.equal(node(report.stages[stageName], "probe-modal").modalWindow.parentId, report.ownerWindowIds[0],
      `Modal A owner remains stable at ${stageName}`);
  }

  const rootVertical = scroll(report.stages.afterRootControls, "probe-root-vertical");
  const rootHorizontal = scroll(report.stages.afterRootControls, "probe-root-horizontal");
  near(rootVertical.y, 60, "root wheel vertical control");
  near(rootHorizontal.x, 24, "root wheel horizontal control");
  assert.equal(report.stages.afterClick.clicks, 1, "Modal Pressable click control");
  const pan = scroll(report.stages.afterPan, "probe-modal-vertical");
  assert.ok(pan.y > 20, "Modal native pan control moved");
  assert.equal(pan.begins, 1);
  assert.equal(pan.ends, 1);
  assert.equal(pan.dragging, false);
  const resetV = scroll(report.stages.afterPublicReset, "probe-modal-vertical");
  const resetH = scroll(report.stages.afterPublicReset, "probe-modal-horizontal");
  near(resetV.y, 0, "RN scrollTo reset vertical offset");
  near(resetH.x, 0, "RN scrollTo reset horizontal offset");
  near(resetV.motion, 0, "RN scrollTo reset vertical motion");
  near(resetH.motion, 0, "RN scrollTo reset horizontal motion");

  const baselineV = scroll(report.stages.rootBeforeModalWheel, "probe-modal-vertical");
  const baselineH = scroll(report.stages.rootBeforeModalWheel, "probe-modal-horizontal");
  near(baselineV.y, 0, "Modal vertical wheel baseline");
  near(baselineH.x, 0, "Modal horizontal wheel baseline");
  const modalWheelCases = [
    {stage: "afterModalDown", testID: "probe-modal-vertical", axis: "y", cross: "x", expected: 72, max: 510},
    {stage: "afterModalUp", testID: "probe-modal-vertical", axis: "y", cross: "x", expected: 48, max: 510},
    {stage: "afterModalRight", testID: "probe-modal-horizontal", axis: "x", cross: "y", expected: 72, max: 450},
    {stage: "afterModalLeft", testID: "probe-modal-horizontal", axis: "x", cross: "y", expected: 48, max: 450},
  ];
  for (const {stage, testID, axis, cross, expected, max} of modalWheelCases) {
    const value = scroll(report.stages[stage], testID);
    near(value[axis], expected, `${stage} logical active offset`);
    near(value[`fabric${axis.toUpperCase()}`], expected, `${stage} Fabric active offset`);
    near(value[`content${axis.toUpperCase()}`], -expected, `${stage} painted active offset`);
    near(value[cross], 0, `${stage} logical cross-axis`);
    near(value[`fabric${cross.toUpperCase()}`], 0, `${stage} Fabric cross-axis`);
    near(value[`content${cross.toUpperCase()}`], 0, `${stage} painted cross-axis`);
    near(value.motion, 0, `${stage} motion`);
    near(value[`max${axis.toUpperCase()}`], max, `${stage} measured content bound`);
    assert.ok(value[axis] >= 0 && value[axis] <= value[`max${axis.toUpperCase()}`], `${stage} offset remains within bounds`);
  }

  const rootBeforeV = scroll(report.stages.rootBeforeModalWheel, "probe-root-vertical");
  const rootBeforeH = scroll(report.stages.rootBeforeModalWheel, "probe-root-horizontal");
  const rootAfterV = scroll(report.stages.rootAfterModalWheel, "probe-root-vertical");
  const rootAfterH = scroll(report.stages.rootAfterModalWheel, "probe-root-horizontal");
  near(rootBeforeV.y, 60, "root vertical before Modal wheel");
  near(rootBeforeH.x, 24, "root horizontal before Modal wheel");
  near(rootAfterV.y, rootBeforeV.y, "root vertical remains unchanged");
  near(rootAfterH.x, rootBeforeH.x, "root horizontal remains unchanged");
  near(scroll(report.stages.initialB, "probe-modal-vertical").y, 0, "owner B baseline");
  near(scroll(report.stages.otherWindowAfterModalWheel, "probe-modal-vertical").y, 0, "owner B remains unchanged");

  const expectedButtons = [5, 4, 7, 6]; // Godot wheel down, up, right, left.
  const expectedFactors = [1.5, 0.5, 1.5, 0.5];
  const expectedPositions = [[115, 85], [115, 85], [325, 85], [325, 85]];
  assert.equal(report.windowInputEvents.length, 4, "all four wheel events reached current Modal Window.window_input");
  for (let index = 0; index < expectedButtons.length; index++) {
    const event = report.windowInputEvents[index];
    assert.equal(event.windowId, report.modalWindowIds[0], `wheel signal came from Modal A Window ${index}`);
    assert.equal(event.button, expectedButtons[index], `Modal window wheel direction ${index}`);
    near(event.factor, expectedFactors[index], `Modal window wheel factor ${index}`);
    assert.equal(event.pressed, true);
    near(event.position[0], expectedPositions[index][0], `Modal window wheel x ${index}`);
    near(event.position[1], expectedPositions[index][1], `Modal window wheel y ${index}`);
  }
  const modalInputs = report.inputs.filter(row => row.label.startsWith("modal-"));
  assert.equal(modalInputs.length, 4);
  assert.ok(modalInputs.every(row => row.ownerWindowId === report.ownerWindowIds[0] &&
    row.targetWindowId === report.modalWindowIds[0]), "input is routed by owner to Modal A's actual Window");

  cleanCounters(report.stages.appAAfterStop, "owner A runtime");
  cleanCounters(report.stages.appBAfterStop, "owner B runtime");
  cleanSurface(report.stages.surfaceAAfterStop, "surface A");
  cleanSurface(report.stages.surfaceBAfterStop, "surface B");
  assert.equal(report.stages.modalWindowsReleased, true);
}
