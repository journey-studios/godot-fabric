import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {transformAsync} from "@babel/core";
import {build} from "esbuild";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";
import {godotExtensions} from "../sdk/toolchain/platform-resolution.mjs";
import {renderEventTargetParentOverlay} from "../sdk/toolchain/rn-event-target-overlay.mjs";
import {renderRendererTagOverlay} from "../sdk/toolchain/rn-renderer-tag-overlay.mjs";
import {renderPointerInterestOverlay} from "../sdk/toolchain/rn-pointer-interest-overlay.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireSdk = createRequire(import.meta.url);
const digest = content => createHash("sha256").update(content).digest("hex");
export const eventTargetProbeModes = ["disabled", "imperative-only", "internal-only", "enabled"];
const eventTargetProbeSources = [
  "tests/event-target-bootstrap.js", "tests/event-target-fixture.jsx",
  "tests/event-target-probe.gd", "tests/event-target-native.test.mjs", "scripts/event-target-bundle.mjs",
];
const upstreamFiles = [
  "src/private/featureflags/ReactNativeFeatureFlags.js",
  "src/private/featureflags/ReactNativeFeatureFlagsBase.js",
  "src/private/webapis/dom/events/Event.js",
  "src/private/webapis/dom/events/CustomEvent.js",
  "src/private/webapis/dom/events/EventTarget.js",
  "src/private/webapis/dom/events/internals/EventTargetInternals.js",
  "src/private/webapis/dom/nodes/ReadOnlyNode.js",
  "src/private/webapis/dom/nodes/ReactNativeElement.js",
  "src/private/webapis/dom/nodes/specs/NativeDOM.js",
  "Libraries/Renderer/implementations/ReactFabric-prod.js",
];

// Each output is a separate Hermes runtime's immutable flag configuration.
// This helper never writes build/app.js and performs no native build or run.
async function bundleProbe({entryPoint, modes, prefix, parentMode, rendererTagMode = "original", nativeDispatchMode = "original", pointerInterestMode = "original", defines = {}, sources, extraUpstreamFiles = []}) {
  const output = path.join(root, "build");
  await mkdir(output, {recursive: true});
  const bundles = {};
  for (const mode of modes) {
    const bundlePath = path.join(output, prefix + "-" + mode + ".js");
    const bundled = await build({absWorkingDir: root, entryPoints: [entryPoint],
      outfile: bundlePath, bundle: true, platform: "neutral", format: "iife", metafile: true,
      define: {"process.env.NODE_ENV": '"production"', __DEV__: "false", __EVENT_TARGET_PROBE_MODE__: JSON.stringify(mode), ...defines},
      mainFields: ["main"], resolveExtensions: godotExtensions,
      plugins: [platformPlugin(path.join(root, "src"), id => requireSdk.resolve(id), {eventTargetParentMode: parentMode, rendererTagMode, nativeDispatchMode, pointerInterestMode})]});
    const inputs = Object.keys(bundled.metafile.inputs);
    for (const file of ["Libraries/Renderer/implementations/ReactFabric-prod.js", "src/private/webapis/dom/events/EventTarget.js",
      "src/private/webapis/dom/nodes/ReactNativeElement.js"])
      assert.ok(inputs.includes("node_modules/react-native/" + file), "Probe must bundle the original RN module: " + file);
    const transformed = await transformAsync(await readFile(bundlePath, "utf8"), {
      filename: bundlePath, configFile: false, babelrc: false,
      presets: [["@react-native/babel-preset", {disableImportExportTransform: true, enableBabelRuntime: false}]],
    });
    await writeFile(bundlePath, transformed.code + "\n");
    bundles[mode] = {sha256: digest(await readFile(bundlePath)), inputs};
  }
  const rnRoot = path.dirname(requireSdk.resolve("react-native/package.json"));
  const parentModule = "src/private/webapis/dom/events/internals/EventTargetInternals.js";
  const parentSource = await readFile(path.join(rnRoot, parentModule), "utf8");
  const rendererModule = "Libraries/Renderer/implementations/ReactFabric-prod.js";
  const rendererSource = await readFile(path.join(rnRoot, rendererModule), "utf8");
  const interestModule = "src/private/webapis/dom/events/EventTarget.js";
  const interestSource = await readFile(path.join(rnRoot, interestModule), "utf8");
  const receipt = {format: "godot-fabric.event-target-probe-bundles/v1", parentMode, rendererTagMode, nativeDispatchMode, pointerInterestMode, bundles,
    pointerInterestOverlay: {module: interestModule, originalSha256: digest(interestSource),
      generatedSourceSha256: digest(renderPointerInterestOverlay(interestSource, pointerInterestMode))},
    parentOverlay: {module: parentModule, originalSha256: digest(parentSource),
      generatedSourceSha256: digest(renderEventTargetParentOverlay(parentSource, parentMode))},
    rendererTagOverlay: {module: rendererModule, originalSha256: digest(rendererSource),
      generatedSourceSha256: digest(renderRendererTagOverlay(rendererSource, rendererTagMode, {nativeDispatchMode}))},
    sources: Object.fromEntries(await Promise.all(sources.map(async file => [file, digest(await readFile(path.join(root, file)))]))),
    originalReactNativeSources: Object.fromEntries(await Promise.all([...upstreamFiles, ...extraUpstreamFiles]
      .map(async file => [file, digest(await readFile(path.join(rnRoot, file)))])))};
  await writeFile(path.join(output, prefix + "-bundles.json"), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}

export async function bundleEventTargetProbe() {
  return bundleProbe({entryPoint: "tests/event-target-fixture.jsx", modes: eventTargetProbeModes,
    prefix: "event-target", parentMode: "original", sources: eventTargetProbeSources});
}

export async function bundleEventTargetAncestryProbe({parentMode = "current"} = {}) {
  return bundleProbe({entryPoint: "tests/event-target-ancestry-fixture.jsx", modes: ["enabled"],
    prefix: "event-target-ancestry", parentMode, sources: ["tests/event-target-bootstrap.js",
      "tests/event-target-ancestry-fixture.jsx", "tests/event-target-ancestry-probe.gd",
      "tests/event-target-ancestry-native.test.mjs", "scripts/event-target-bundle.mjs",
      "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/rn-event-target-overlay.mjs"]});
}

export async function bundleNativeEventDispatchProbe({rendererTagMode = "current"} = {}) {
  return bundleProbe({entryPoint: "tests/event-dispatch-fixture.jsx", modes: ["enabled", "disabled"],
    prefix: "event-dispatch", parentMode: "current", rendererTagMode, sources: ["tests/event-target-bootstrap.js",
      "tests/event-dispatch-fixture.jsx", "tests/event-dispatch-probe.gd",
      "tests/event-dispatch-native.test.mjs", "scripts/event-target-bundle.mjs",
      "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/rn-event-target-overlay.mjs",
      "sdk/toolchain/rn-renderer-tag-overlay.mjs", "src/private-interface.js", "native/application_runtime.cpp"],
    extraUpstreamFiles: ["src/private/renderer/events/dispatchNativeEvent.js",
      "src/private/renderer/events/ReactNativeResponder.js", "src/private/renderer/events/ResponderEvent.js",
      "src/private/renderer/events/LegacySyntheticEvent.js", "src/private/renderer/events/ReactNativeEventTypeMapping.js",
      "src/private/renderer/events/ResponderTouchHistoryStore.js"]});
}


export async function bundleIntegratedEventDispatchProbe({integrationMode = "integrated"} = {}) {
  assert.ok(["original", "integrated"].includes(integrationMode));
  return bundleProbe({entryPoint: "tests/event-dispatch-integrated-fixture.jsx", modes: ["enabled"],
    prefix: "event-dispatch-integrated", parentMode: "current", rendererTagMode: "current",
    nativeDispatchMode: integrationMode === "integrated" ? "experimental" : "original",
    defines: {__NATIVE_EVENT_INTEGRATION_PROBE_MODE__: JSON.stringify(integrationMode)},
    sources: ["tests/event-target-bootstrap.js", "tests/event-dispatch-integrated-fixture.jsx",
      "tests/event-dispatch-integrated-probe.gd", "tests/event-dispatch-integrated-native.test.mjs",
      "scripts/event-target-bundle.mjs", "sdk/toolchain/platform-plugin.mjs",
      "sdk/toolchain/rn-event-target-overlay.mjs", "sdk/toolchain/rn-renderer-tag-overlay.mjs",
      "src/private-interface.js", "native/application_runtime.cpp"],
    extraUpstreamFiles: ["src/private/renderer/events/dispatchNativeEvent.js",
      "src/private/renderer/events/ReactNativeResponder.js", "src/private/renderer/events/LegacySyntheticEvent.js"]});
}

export async function bundlePointerInterestProbe({interestMode = "current"} = {}) {
  assert.ok(["original", "current"].includes(interestMode));
  return bundleProbe({entryPoint: "tests/pointer-interest-fixture.jsx", modes: ["enabled"],
    prefix: "pointer-interest", parentMode: "current", rendererTagMode: "current",
    nativeDispatchMode: "experimental", pointerInterestMode: interestMode,
    defines: {__POINTER_INTEREST_PROBE_MODE__: JSON.stringify(interestMode)},
    sources: ["tests/event-target-bootstrap.js", "tests/pointer-interest-fixture.jsx",
      "tests/pointer-interest-probe.gd", "tests/pointer-interest-native.test.mjs",
      "scripts/event-target-bundle.mjs", "sdk/toolchain/platform-plugin.mjs",
      "sdk/toolchain/rn-event-target-overlay.mjs", "sdk/toolchain/rn-renderer-tag-overlay.mjs",
      "sdk/toolchain/rn-pointer-interest-overlay.mjs", "src/private-interface.js",
      "src/pointer-listener-query.js", "native/application_runtime.cpp", "scripts/rn-pointer-overlay.mjs"],
    extraUpstreamFiles: ["src/private/renderer/events/dispatchNativeEvent.js",
      "src/private/renderer/events/ReactNativeResponder.js", "src/private/renderer/events/LegacySyntheticEvent.js"]});
}

export async function bundlePointerQueryFaultProbe() {
  return bundleProbe({entryPoint: "tests/pointer-query-fault-fixture.jsx", modes: ["enabled"],
    prefix: "pointer-query-fault", parentMode: "current", rendererTagMode: "current",
    nativeDispatchMode: "experimental", pointerInterestMode: "current",
    sources: ["tests/event-target-bootstrap.js", "tests/pointer-query-fault-bootstrap.js",
      "tests/pointer-query-fault-fixture.jsx", "tests/pointer-query-fault-probe.gd",
      "tests/pointer-query-fault-native.test.mjs", "tests/pointer-terminal-query-assertions.mjs", "scripts/event-target-bundle.mjs",
      "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/rn-event-target-overlay.mjs",
      "sdk/toolchain/rn-renderer-tag-overlay.mjs", "sdk/toolchain/rn-pointer-interest-overlay.mjs",
      "src/private-interface.js", "src/pointer-listener-query.js", "native/application_runtime.cpp",
      "scripts/rn-pointer-overlay.mjs"],
    extraUpstreamFiles: ["src/private/renderer/events/dispatchNativeEvent.js",
      "src/private/renderer/events/ReactNativeResponder.js", "src/private/renderer/events/LegacySyntheticEvent.js",
      "ReactCommon/react/renderer/core/EventQueue.cpp", "ReactCommon/react/renderer/core/EventQueueProcessor.cpp"]});
}

export async function bundlePointerResolverFaultProbe() {
  return bundleProbe({entryPoint: "tests/pointer-resolver-fault-fixture.jsx", modes: ["enabled"],
    prefix: "pointer-resolver-fault", parentMode: "current", rendererTagMode: "current",
    nativeDispatchMode: "experimental", pointerInterestMode: "current",
    sources: ["tests/event-target-bootstrap.js", "tests/pointer-query-fault-bootstrap.js",
      "tests/pointer-query-fault-fixture.jsx", "tests/pointer-query-fault-probe.gd",
      "tests/pointer-resolver-fault-bootstrap.js", "tests/pointer-resolver-fault-fixture.jsx",
      "tests/pointer-resolver-fault-probe.gd", "tests/pointer-resolver-fault-native.test.mjs",
      "tests/pointer-terminal-query-assertions.mjs", "scripts/event-target-bundle.mjs", "sdk/toolchain/platform-plugin.mjs",
      "sdk/toolchain/rn-event-target-overlay.mjs", "sdk/toolchain/rn-renderer-tag-overlay.mjs",
      "sdk/toolchain/rn-pointer-interest-overlay.mjs", "src/private-interface.js",
      "src/pointer-listener-query.js", "native/application_runtime.cpp", "scripts/rn-pointer-overlay.mjs"],
    extraUpstreamFiles: ["src/private/renderer/events/dispatchNativeEvent.js",
      "src/private/renderer/events/ReactNativeResponder.js", "src/private/renderer/events/LegacySyntheticEvent.js",
      "src/private/webapis/dom/nodes/ReactNativeDocument.js",
      "src/private/webapis/dom/nodes/internals/NodeInternals.js",
      "src/private/webapis/dom/nodes/internals/ReactNativeDocumentElementInstanceHandle.js",
      "ReactCommon/react/renderer/core/EventQueue.cpp", "ReactCommon/react/renderer/core/EventQueueProcessor.cpp"]});
}

export async function bundlePointerUpProbe() {
  return bundleProbe({entryPoint: "tests/pointer-up-fixture.jsx", modes: ["enabled"],
    prefix: "pointer-up", parentMode: "current", rendererTagMode: "current",
    nativeDispatchMode: "experimental", pointerInterestMode: "current",
    sources: ["tests/event-target-bootstrap.js", "tests/pointer-query-fault-bootstrap.js",
      "tests/pointer-query-fault-fixture.jsx", "tests/pointer-query-fault-probe.gd",
      "tests/pointer-up-fixture.jsx", "tests/pointer-up-probe.gd", "tests/pointer-up-native.test.mjs", "tests/native-png.mjs",
      "scripts/event-target-bundle.mjs", "sdk/toolchain/platform-plugin.mjs",
      "sdk/toolchain/rn-event-target-overlay.mjs", "sdk/toolchain/rn-renderer-tag-overlay.mjs",
      "sdk/toolchain/rn-pointer-interest-overlay.mjs", "src/private-interface.js",
      "src/pointer-listener-query.js", "native/application_runtime.cpp", "scripts/rn-pointer-overlay.mjs"],
    extraUpstreamFiles: ["src/private/renderer/events/dispatchNativeEvent.js",
      "src/private/renderer/events/ReactNativeResponder.js", "src/private/renderer/events/LegacySyntheticEvent.js",
      "ReactCommon/react/renderer/components/view/primitives.h", "ReactCommon/react/renderer/core/EventQueue.cpp",
      "ReactCommon/react/renderer/core/EventQueueProcessor.cpp",
      "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp", "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.h"]});
}

export async function bundlePointerMoveProbe() {
  return bundleProbe({entryPoint: "tests/pointer-move-fixture.jsx", modes: ["enabled"],
    prefix: "pointer-move", parentMode: "current", rendererTagMode: "current",
    nativeDispatchMode: "experimental", pointerInterestMode: "current",
    sources: ["tests/event-target-bootstrap.js", "tests/pointer-query-fault-bootstrap.js",
      "tests/pointer-query-fault-fixture.jsx", "tests/pointer-query-fault-probe.gd",
      "tests/pointer-move-fixture.jsx", "tests/pointer-move-probe.gd", "tests/pointer-move-native.test.mjs", "tests/native-png.mjs",
      "scripts/event-target-bundle.mjs", "sdk/toolchain/platform-plugin.mjs",
      "sdk/toolchain/rn-event-target-overlay.mjs", "sdk/toolchain/rn-renderer-tag-overlay.mjs",
      "sdk/toolchain/rn-pointer-interest-overlay.mjs", "src/private-interface.js",
      "src/pointer-listener-query.js", "native/application_runtime.cpp", "scripts/rn-pointer-overlay.mjs"],
    extraUpstreamFiles: ["src/private/renderer/events/dispatchNativeEvent.js",
      "src/private/renderer/events/ReactNativeResponder.js", "src/private/renderer/events/LegacySyntheticEvent.js",
      "ReactCommon/react/renderer/components/view/primitives.h", "ReactCommon/react/renderer/core/EventQueue.cpp",
      "ReactCommon/react/renderer/core/EventQueueProcessor.cpp", "ReactCommon/react/renderer/core/EventEmitter.cpp",
      "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp", "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.h"]});
}

export async function bundlePointerHoverProbe() {
  return bundleProbe({entryPoint: "tests/pointer-hover-fixture.jsx", modes: ["enabled"],
    prefix: "pointer-hover", parentMode: "current", rendererTagMode: "current",
    nativeDispatchMode: "experimental", pointerInterestMode: "current",
    sources: ["tests/event-target-bootstrap.js", "tests/pointer-query-fault-bootstrap.js",
      "tests/pointer-query-fault-fixture.jsx", "tests/pointer-query-fault-probe.gd", "tests/pointer-move-probe.gd",
      "tests/pointer-hover-fixture.jsx", "tests/pointer-hover-probe.gd", "tests/pointer-hover-native.test.mjs", "tests/native-png.mjs",
      "scripts/event-target-bundle.mjs", "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/rn-event-target-overlay.mjs",
      "sdk/toolchain/rn-renderer-tag-overlay.mjs", "sdk/toolchain/rn-pointer-interest-overlay.mjs",
      "src/private-interface.js", "src/pointer-listener-query.js", "native/application_runtime.cpp", "scripts/rn-pointer-overlay.mjs"],
    extraUpstreamFiles: ["src/private/renderer/events/dispatchNativeEvent.js",
      "src/private/renderer/events/ReactNativeResponder.js", "src/private/renderer/events/LegacySyntheticEvent.js",
      "ReactCommon/react/renderer/components/view/primitives.h", "ReactCommon/react/renderer/core/EventQueue.cpp",
      "ReactCommon/react/renderer/core/EventQueueProcessor.cpp", "ReactCommon/react/renderer/core/EventEmitter.cpp",
      "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp", "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.h",
      "ReactCommon/react/renderer/uimanager/PointerHoverTracker.cpp"]});
}

export async function bundlePointerRootPathProbe() {
  return bundleProbe({entryPoint: "tests/pointer-root-path-fixture.jsx", modes: ["enabled"],
    prefix: "pointer-root-path", parentMode: "current", rendererTagMode: "current",
    nativeDispatchMode: "experimental", pointerInterestMode: "current",
    sources: ["tests/event-target-bootstrap.js", "tests/pointer-query-fault-bootstrap.js",
      "tests/pointer-query-fault-fixture.jsx", "tests/pointer-query-fault-probe.gd", "tests/pointer-move-probe.gd",
      "tests/pointer-hover-probe.gd", "tests/pointer-root-path-fixture.jsx", "tests/pointer-root-path-probe.gd",
      "tests/pointer-root-path-native.test.mjs", "scripts/event-target-bundle.mjs", "sdk/toolchain/platform-plugin.mjs",
      "sdk/toolchain/rn-event-target-overlay.mjs", "sdk/toolchain/rn-renderer-tag-overlay.mjs",
      "sdk/toolchain/rn-pointer-interest-overlay.mjs", "src/private-interface.js", "src/pointer-listener-query.js",
      "native/application_runtime.cpp", "native/pointer_adapter.cpp", "native/pointer_adapter.h", "native/pointer_event.h",
      "scripts/rn-pointer-overlay.mjs"],
    extraUpstreamFiles: ["src/private/renderer/events/dispatchNativeEvent.js",
      "src/private/renderer/events/ReactNativeResponder.js", "src/private/renderer/events/LegacySyntheticEvent.js",
      "src/private/webapis/dom/nodes/ReactNativeDocument.js",
      "ReactCommon/react/renderer/components/view/primitives.h", "ReactCommon/react/renderer/core/EventQueue.cpp",
      "ReactCommon/react/renderer/core/EventQueueProcessor.cpp", "ReactCommon/react/renderer/core/EventEmitter.cpp",
      "ReactCommon/react/renderer/core/EventTarget.cpp", "ReactCommon/react/renderer/mounting/ShadowTree.cpp",
      "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp", "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.h",
      "ReactCommon/react/renderer/uimanager/PointerHoverTracker.cpp", "ReactCommon/react/renderer/uimanager/UIManagerBinding.cpp"]});
}

export async function bundlePointerDocumentProbe({interestMode = "current"} = {}) {
  assert.ok(["original", "current"].includes(interestMode));
  return bundleProbe({entryPoint: "tests/pointer-document-fixture.jsx", modes: eventTargetProbeModes,
    prefix: "pointer-document", parentMode: "current", rendererTagMode: "current",
    nativeDispatchMode: "experimental", pointerInterestMode: interestMode,
    defines: {__POINTER_DOCUMENT_INTEREST_MODE__: JSON.stringify(interestMode)},
    sources: ["tests/event-target-bootstrap.js", "tests/pointer-document-bootstrap.js",
      "tests/pointer-document-fixture.jsx", "tests/pointer-document-probe.gd",
      "tests/pointer-document-native.test.mjs", "tests/pointer-terminal-query-assertions.mjs", "scripts/event-target-bundle.mjs",
      "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/rn-event-target-overlay.mjs",
      "sdk/toolchain/rn-renderer-tag-overlay.mjs", "sdk/toolchain/rn-pointer-interest-overlay.mjs",
      "src/private-interface.js", "src/pointer-listener-query.js", "native/application_runtime.cpp",
      "scripts/rn-pointer-overlay.mjs"],
    extraUpstreamFiles: ["src/private/renderer/events/dispatchNativeEvent.js",
      "src/private/renderer/events/ReactNativeResponder.js", "src/private/renderer/events/LegacySyntheticEvent.js",
      "src/private/webapis/dom/nodes/ReactNativeDocument.js",
      "src/private/webapis/dom/nodes/internals/NodeInternals.js",
      "src/private/webapis/dom/nodes/internals/ReactNativeDocumentElementInstanceHandle.js",
      "ReactCommon/react/renderer/core/EventQueue.cpp",
      "ReactCommon/react/renderer/core/EventQueueProcessor.cpp"]});
}

export async function bundlePointerDocumentUpProbe({interestMode = "current"} = {}) {
  assert.ok(["original", "current"].includes(interestMode));
  return bundleProbe({entryPoint: "tests/pointer-document-up-fixture.jsx", modes: eventTargetProbeModes,
    prefix: "pointer-document-up", parentMode: "current", rendererTagMode: "current",
    nativeDispatchMode: "experimental", pointerInterestMode: interestMode,
    defines: {__POINTER_DOCUMENT_INTEREST_MODE__: JSON.stringify(interestMode)},
    sources: ["tests/event-target-bootstrap.js", "tests/pointer-document-bootstrap.js",
      "tests/pointer-document-fixture.jsx", "tests/pointer-document-up-fixture.jsx",
      "tests/pointer-document-up-probe.gd", "tests/pointer-document-up-native.test.mjs", "tests/native-png.mjs", "scripts/event-target-bundle.mjs",
      "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/rn-event-target-overlay.mjs",
      "sdk/toolchain/rn-renderer-tag-overlay.mjs", "sdk/toolchain/rn-pointer-interest-overlay.mjs",
      "src/private-interface.js", "src/pointer-listener-query.js", "native/application_runtime.cpp", "scripts/rn-pointer-overlay.mjs"],
    extraUpstreamFiles: ["src/private/renderer/events/dispatchNativeEvent.js",
      "src/private/renderer/events/ReactNativeResponder.js", "src/private/renderer/events/LegacySyntheticEvent.js",
      "src/private/webapis/dom/abort-api/AbortController.js", "src/private/webapis/dom/abort-api/AbortSignal.js",
      "src/private/webapis/dom/nodes/ReactNativeDocument.js", "src/private/webapis/dom/nodes/internals/NodeInternals.js",
      "src/private/webapis/dom/nodes/internals/ReactNativeDocumentElementInstanceHandle.js",
      "ReactCommon/react/renderer/components/view/primitives.h",
      "ReactCommon/react/renderer/components/view/TouchEventEmitter.cpp",
      "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp",
      "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.h",
      "ReactCommon/react/renderer/core/EventQueue.cpp", "ReactCommon/react/renderer/core/EventQueueProcessor.cpp"]});
}

export async function bundlePointerDocumentHoverProbe({interestMode = "current"} = {}) {
  assert.ok(["original", "current"].includes(interestMode));
  return bundleProbe({entryPoint: "tests/pointer-document-hover-fixture.jsx", modes: eventTargetProbeModes,
    prefix: "pointer-document-hover", parentMode: "current", rendererTagMode: "current",
    nativeDispatchMode: "experimental", pointerInterestMode: interestMode,
    defines: {__POINTER_DOCUMENT_INTEREST_MODE__: JSON.stringify(interestMode)},
    sources: ["tests/event-target-bootstrap.js", "tests/pointer-document-bootstrap.js",
      "tests/pointer-document-fixture.jsx", "tests/pointer-document-hover-fixture.jsx",
      "tests/pointer-document-up-probe.gd", "tests/pointer-document-hover-probe.gd", "tests/pointer-document-hover-native.test.mjs",
      "scripts/event-target-bundle.mjs", "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/rn-event-target-overlay.mjs",
      "sdk/toolchain/rn-renderer-tag-overlay.mjs", "sdk/toolchain/rn-pointer-interest-overlay.mjs",
      "src/private-interface.js", "src/pointer-listener-query.js", "native/application_runtime.cpp", "native/pointer_adapter.cpp",
      "native/pointer_adapter.h", "native/pointer_event.h", "scripts/rn-pointer-overlay.mjs"],
    extraUpstreamFiles: ["src/private/renderer/events/dispatchNativeEvent.js",
      "src/private/renderer/events/ReactNativeResponder.js", "src/private/renderer/events/LegacySyntheticEvent.js",
      "src/private/webapis/dom/nodes/ReactNativeDocument.js", "src/private/webapis/dom/nodes/internals/NodeInternals.js",
      "src/private/webapis/dom/nodes/internals/ReactNativeDocumentElementInstanceHandle.js",
      "ReactCommon/react/renderer/components/view/primitives.h",
      "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp",
      "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.h",
      "ReactCommon/react/renderer/uimanager/PointerHoverTracker.cpp",
      "ReactCommon/react/renderer/core/EventEmitter.cpp",
      "ReactCommon/react/renderer/core/EventQueue.cpp", "ReactCommon/react/renderer/core/EventQueueProcessor.cpp"]});
}

export async function bundlePointerDocumentMoveProbe({interestMode = "current"} = {}) {
  assert.ok(["original", "current"].includes(interestMode));
  return bundleProbe({entryPoint: "tests/pointer-document-move-fixture.jsx", modes: eventTargetProbeModes,
    prefix: "pointer-document-move", parentMode: "current", rendererTagMode: "current",
    nativeDispatchMode: "experimental", pointerInterestMode: interestMode,
    defines: {__POINTER_DOCUMENT_INTEREST_MODE__: JSON.stringify(interestMode)},
    sources: ["tests/event-target-bootstrap.js", "tests/pointer-document-bootstrap.js",
      "tests/pointer-document-fixture.jsx", "tests/pointer-document-move-fixture.jsx",
      "tests/pointer-document-up-probe.gd", "tests/pointer-document-move-probe.gd", "tests/pointer-document-move-native.test.mjs",
      "tests/native-png.mjs", "scripts/event-target-bundle.mjs",
      "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/rn-event-target-overlay.mjs",
      "sdk/toolchain/rn-renderer-tag-overlay.mjs", "sdk/toolchain/rn-pointer-interest-overlay.mjs",
      "src/private-interface.js", "src/pointer-listener-query.js", "native/application_runtime.cpp", "scripts/rn-pointer-overlay.mjs"],
    extraUpstreamFiles: ["src/private/renderer/events/dispatchNativeEvent.js",
      "src/private/renderer/events/ReactNativeResponder.js", "src/private/renderer/events/LegacySyntheticEvent.js",
      "src/private/webapis/dom/nodes/ReactNativeDocument.js", "src/private/webapis/dom/nodes/internals/NodeInternals.js",
      "src/private/webapis/dom/nodes/internals/ReactNativeDocumentElementInstanceHandle.js",
      "ReactCommon/react/renderer/components/view/primitives.h",
      "ReactCommon/react/renderer/components/view/TouchEventEmitter.cpp",
      "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp",
      "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.h",
      "ReactCommon/react/renderer/core/EventEmitter.cpp",
      "ReactCommon/react/renderer/core/EventQueue.cpp", "ReactCommon/react/renderer/core/EventQueueProcessor.cpp"]});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await bundleEventTargetProbe();
  console.log("Bundled isolated original EventTarget flag probes; public build/app.js untouched.");
}
