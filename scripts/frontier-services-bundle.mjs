import {readdirSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// The probe's bundle for Frontier's services (build/frontier-services-probe.js and its receipt). The fixture is the
// stand-in for a HUD: it imports the public @godot-fabric/runtime and the hand-written types of the slice, so the
// bundle must contain both, and the receipt pins every file the run executes, the game's included.
const root = fileURLToPath(new URL("..", import.meta.url));
const listing = directory => readdirSync(path.join(root, directory)).filter(name => name.endsWith(".gd")).sort()
  .map(name => `${directory}/${name}`);

// The GDScript the probe executes: the game (P3), the services node and its schemas.
export const frontierServicesGameSources = [...listing("consumers/civ-lite/game"), ...listing("consumers/civ-lite/services")];

export function bundleFrontierServicesProbe() {
  return bundleNativeProbe({name: "frontier-services", entryPoint: "tests/frontier-services-fixture.jsx",
    sources: ["tests/frontier-services-fixture.jsx", "tests/frontier-services-probe.gd", "tests/frontier-services-native.test.mjs",
      "tests/frontier-services-oracle.mjs", "tests/frontier-services-parity.test.mjs", "scripts/frontier-services-bundle.mjs",
      "scripts/native-probe-bundle.mjs", "consumers/civ-lite/ui/frontier-types.ts", "src/godot-fabric.js", "src/react-native-platform.jsx", "sdk/addon/godot_fabric.gd",
      "sdk/toolchain/platform-plugin.mjs", ...frontierServicesGameSources],
    seams: ["src/godot-fabric.js", "src/react-native-platform.jsx", "consumers/civ-lite/ui/frontier-types.ts"],
    // The original module this bundle runs: the facade reads the services TurboModule through RN's own registry.
    bundled: ["Libraries/TurboModule/TurboModuleRegistry.js"],
    references: []});
}
