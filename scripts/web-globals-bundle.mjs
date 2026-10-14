import assert from "node:assert/strict";
import {SABOTAGES} from "../tests/web-globals-sabotages.mjs";
import {bundleNativeProbe, sabotageOverride} from "./native-probe-bundle.mjs";

// This slice changes no native code, so it has no native producers of its own to pin: the lanes run on the host in addons/, whose SHA-256 the runner records beside the
// report. The networking half runs against the server of the networking suite, a child process of the runner, and that server's files are pinned as sources.

// The original RN modules the current bundle runs: setUpXHR and the files it requires for the four globals, the Event and EventTarget the abort signal dispatches
// with, and fetch with the XMLHttpRequest it drives.
const bundled = ["Libraries/Core/setUpXHR.js", "Libraries/Blob/URL.js", "Libraries/Blob/URLSearchParams.js", "Libraries/Blob/NativeBlobModule.js",
  "Libraries/Network/fetch.js", "Libraries/Network/XMLHttpRequest.js", "src/private/webapis/dom/abort-api/AbortController.js",
  "src/private/webapis/dom/abort-api/AbortSignal.js", "src/private/webapis/errors/DOMException.js", "src/private/webapis/dom/events/EventTarget.js",
  "src/private/webapis/dom/events/Event.js", "src/private/webapis/dom/events/EventHandlerAttributes.js", "Libraries/Utilities/PolyfillFunctions.js",
  "Libraries/Utilities/defineLazyObjectProperty.js"];
// What the oracle reads of RN: the files it runs in V8 beside the bundle's, the text of the throws it compares, fetch's own polyfill for the shape of the AbortError, and
// the setup chain's order.
const references = ["src/private/setup/setUpDefaultReactNativeEnvironment.js", "Libraries/Core/InitializeCore.js", "Libraries/Blob/Blob.js",
  "src/private/webapis/dom/events/internals/EventTargetInternals.js", "../whatwg-fetch/dist/fetch.umd.js", "../whatwg-fetch/package.json"];
const sources = ["tests/web-globals-fixture.jsx", "tests/web-globals-cases.mjs", "tests/web-globals-early.js", "tests/web-globals-host.js", "tests/web-globals-probe.gd",
  "tests/web-globals-native.test.mjs", "tests/web-globals-oracle.mjs", "tests/web-globals-sabotages.mjs", "tests/networking-server.mjs", "tests/networking-certificates.mjs",
  "scripts/web-globals-bundle.mjs", "scripts/web-globals-sabotage.mjs", "scripts/native-probe-bundle.mjs", "src/initialize.js", "src/runtime.js",
  "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/metro-polyfills.mjs"];

export const sabotageNames = SABOTAGES.map(entry => entry.name);
const sabotageNamed = name => SABOTAGES.find(entry => entry.name === name);

// The bundle of a lane: the current SDK, or the SDK with one sabotage, an override in memory of one file. The host-state module runs before everything, the
// polyfills included.
export function bundleWebGlobalsProbe(sabotage = null) {
  const probe = {entryPoint: "tests/web-globals-fixture.jsx", inject: ["tests/web-globals-host.js"], references, sources};
  if (sabotage === null) {
    return bundleNativeProbe({...probe, name: "web-globals", seams: ["src/initialize.js"], bundled});
  }
  const variant = sabotageNamed(sabotage);
  assert.ok(variant, "Unknown sabotage: " + sabotage);
  // A sabotaged bundle lacks what it broke, so it is not asked to contain the modules the current one must.
  return bundleNativeProbe({...probe, name: `web-globals-sabotage-${sabotage}`, seams: [], bundled: [], plugins: [sabotageOverride(`web-globals-sabotage-${sabotage}`, variant)]});
}
