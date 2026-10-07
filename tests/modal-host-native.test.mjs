import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleModalHostProbe, modalHostNativeProducers} from "../scripts/modal-host-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const digest = value => createHash("sha256").update(value).digest("hex");

test("RN's original ModalHostView mounts in a host-sized embedded Window", async () => {
  const bundle = await bundleModalHostProbe();
  const binary = await ensureGodotBinary();
  const reportPath = path.join(root, "build/modal-host-report.json");
  await rm(reportPath, {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/modal-host-probe.gd"],
    {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, "build/modal-host-current.log"), log);
  let report = null;
  try {
    report = JSON.parse(await readFile(reportPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (report) {
    report.provenance = {node: process.version, bundle,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, "build/modal-host-current-report.json"), JSON.stringify(report, null, 2) + "\n");
  }

  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|^ERROR:|Program crashed|ObjectDB instances leaked|Resources still in use/m);
  assert.ok(report, log);
  assert.equal(report.scenario, "native-original-modal-host");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allCurrentAssertionsPassed, true, JSON.stringify(report.checks, null, 2));
  const checks = new Map(report.checks.map(row => [row.id, row]));
  assert.equal(checks.size, report.checks.length, "Every required Modal check has a unique ID");
  const required = [
    "mount/RN's original ModalHostView was committed",
    "mount/The Modal is shown as the exclusive embedded host Window",
    "mount/The Modal Window is a sibling under the native host Window",
    "layout/The original Modal fills the host Window despite its smaller FabricSurface",
    "layout/RN's original ModalHostView state sizes its Yoga node to the host Window",
    "layout/The first RN onLayout reports host dimensions instead of an initial zero-sized Modal",
    "geometry/measureInWindow uses the Modal physical root, excluding its offset Surface",
    "geometry/An offset 0×0 View outside the Modal still projects through the FabricSurface",
    "geometry/An offset 0×0 View inside the Modal still projects through its physical Window",
    "geometry/display:none remains distinct from a connected zero-sized layout",
    "geometry/a retained public ref is disconnected after unmount and skips native measurement",
    "children/The original SafeAreaView resolves to Godot's default View and mounts its RN content",
    "children/The public TextInput adapter is a live editable native LineEdit inside the Modal",
    "input/A native key event edits the controlled public TextInput adapter",
    "input/A pointer click activates the public Button adapter inside the Modal",
    "input/RN Pressability exits and re-enters during capture before one successful Press",
    "capture/The public Pressable captures its pointer, receives an outside move, and releases on Up",
    "geometry/Modal screen coordinates include the nonzero host origin and owner content scale",
    "input/The exclusive Modal blocks a click on the background Button",
    "input/Escape invokes the original onRequestClose without changing JS visible state",
    "resize/The mounted presentation Window follows the host Window",
    "resize/RN's ModalHostView StateUpdate relayouts the original Yoga node",
    "resize/RN onLayout reports the new host dimensions",
    "props/visible=false removes the original Modal presentation",
    "input/Hiding the Modal restores pointer input to the background RN Pressable",
    "input/Background RN Pressability receives its restored click",
    "events/each actual presentation fires onShow once with a new native Window",
    "stack/Hiding the reentrant top restores exclusivity to the still-visible first Modal",
    "embedding/Logically nested Modals use sibling Windows under their common owner",
    "geometry/A nested Modal measures against its own physical Window, not the offset FabricSurface",
    "input/Pressability receives a click in the logically nested top Modal's physical Window",
    "input/Presenting a new top Modal delivers one cancel and PressOut to the captured lower contact",
    "capture/A stale lower-Window Up cannot press after the top switch, while both RN Modals remain correctly stacked",
    "capture/Hiding the top restores the lower authority with no active pointer route",
    "lifecycle/Stopping the Fabric owner from visibility_changed retires presentation reentrantly",
    "lifecycle/The retired Window is freed after the Godot visibility callback unwinds",
    "cleanup/Stopping the application retires the modal root and its native Controls",
    "owner/two Fabric runtimes present independent Modal entries under the same native Window",
    "owner/a foreign runtime taking the top cancels the lower captured pointer and Pressability contact",
    "owner/the foreign runtime owns a live exclusive embedded Modal Window",
    "owner/the foreign Modal's native input and Pressable controls are mounted",
    "owner/the foreign Pressable holds explicit pointer capture before the lower runtime stops",
    "owner/stopping a lower runtime preserves the foreign top Window, Controls, focus, text and capture",
    "owner/the foreign captured pointer still receives Up and Press after the lower runtime stops",
    "owner/stopping the foreign runtime releases its remaining presentation and native controls",
    "routing/Pointer events from a Modal child still bubble to its logical parent outside the physical Window",
    "routing/Capture notifications from a Modal child still bubble to its logical parent",
    "routing/two Fabric roots in one application expose connected capture targets",
    "routing/The target root acquires capture before the cross-root contact ends",
    "routing/Capture from root A delivers move, Up and bubbling to root B in the same runtime",
    "routing/Enter, Leave and capture notifications reach their RN ancestors across Fabric roots",
    "routing/Captured coordinates are projected through the target root's viewport",
    "routing/Cross-root capture completes without a runtime error",
    "cleanup/Cross-root capture roots release their controls",
  ];
  for (const id of required) assert.equal(checks.get(id)?.passed, true, `Required Modal contract: ${id}`);
  assert.equal(report.scope.originalModal, true);
  assert.equal(report.scope.originalSafeAreaView, true);
  assert.equal(report.scope.engineInjectedInput, true);
  assert.equal(report.scope.explicitPointerCapture, true);
  assert.equal(report.scope.foreignRuntimeOwnership, true);
  assert.equal(report.scope.crossRootCapture, true);
  assert.equal(report.scope.logicalModalBubbling, true);
  assert.equal(report.scope.mobile, false);
  const initial = report.stages.mount;
  assert.ok(initial.application.errors.length === 0 && initial.surface.errors.length === 0);
  assert.equal(initial.surface.viewport.width, 90);
  assert.equal(initial.surface.viewport.height, 70);
  const modal = initial.surface.nodes.find(row => row.testID === "first-modal");
  assert.equal(modal?.modalWindow.visible, true);
  assert.equal(modal?.modalWindow.exclusive, true);
  assert.equal(modal?.modalWindow.embedded, true);
  assert.deepEqual(report.stages.controls.modalPointer.modalPressIns, 2);
  assert.deepEqual(report.stages.controls.modalPointer.modalPressOuts, 2);
  assert.deepEqual(report.stages.controls.modalPointer.modalPresses, 1);
  assert.equal(report.stages.controls.blocked.backgroundClicks, 0);
  assert.deepEqual(report.stages.reentrantShow.nestedInteraction.nestedPointerDowns, 1);
  assert.deepEqual(report.stages.reentrantShow.nestedInteraction.nestedPresses, 1);
  const takeover = report.stages.captureTakeover;
  assert.equal(takeover.cancelled.modalPointerCancels, takeover.before.modalPointerCancels + 1);
  assert.equal(takeover.cancelled.modalTouchCancels, takeover.before.modalTouchCancels + 1);
  assert.equal(takeover.cancelled.modalPresses, takeover.before.modalPresses);
  assert.equal(takeover.restored.modalWindow.exclusive, true);
  assert.equal(takeover.released.modalPresses, takeover.before.modalPresses);
  assert.equal(report.stages.resize.surface.errors.length, 0);
  assert.equal(report.stages.cleanup.application.rootCount, 0);
  assert.equal(report.stages.cleanup.surface.nativeTags, 0);
  const ownership = report.stages.ownerIsolation;
  assert.equal(ownership.foreignCaptured.gotCaptures, 1);
  assert.equal(ownership.foreignCaptured.captureActiveOnGot, true);
  assert.equal(ownership.foreignAfterLowerStop.lostCaptures, ownership.foreignCaptured.lostCaptures);
  assert.equal(ownership.foreignReleased.presses, 1);
  assert.equal(ownership.foreignReleased.pointerUps, 1);
  assert.equal(ownership.foreignReleased.lostCaptures, 1);
  assert.equal(ownership.lowerStopped.stopped, true);
  assert.equal(ownership.foreignStopped.stopped, true);
  assert.equal(ownership.foreignBeforeStop.modalWindow.id,
    ownership.foreignNativeAfterStop.nodes.find(row => row.testID === "foreign-modal")?.modalWindow.id);
  for (const file of ["tests/modal-host-fixture.jsx", "tests/modal-host-probe.gd", "tests/modal-host-native.test.mjs",
    "scripts/modal-host-bundle.mjs", "src/react-native-platform.jsx", ...modalHostNativeProducers])
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  for (const file of ["Libraries/Modal/Modal.js", "Libraries/Modal/RCTModalHostViewNativeComponent.js",
    "src/private/components/modal/specs/RCTModalHostViewNativeComponent.js",
    "Libraries/Components/SafeAreaView/SafeAreaView.js", "Libraries/Components/View/View.js"])
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
});
