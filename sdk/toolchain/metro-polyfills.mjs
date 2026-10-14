// The polyfills RN hands its bundler, in the order of @react-native/js-polyfills/index.js. Metro evaluates them before the module
// system starts, so before any module body can touch what they define. An esbuild bundle has no such phase; `inject` is its
// equivalent, because esbuild places an injected file ahead of the imports of the entry point, whatever the entry imports first.
// Every build that a Godot host runs passes `inject: metroPolyfills(resolveSdk)`: without it `console` would not exist.
// scripts/bootstrap-audit.mjs reads this list: a polyfill the audit marks `runs` is on it, in RN's order, and no other is.
export const METRO_POLYFILLS = ["@react-native/js-polyfills/console.js"];

// The files to hand esbuild's `inject`, resolved the way the build resolves the SDK's other packages. The package is installed beside
// react-native (the SDK copies the whole node_modules it was provisioned with), so a missing one is a broken installation.
export function metroPolyfills(resolveSdk) {
  return METRO_POLYFILLS.map(specifier => {
    try {
      return resolveSdk(specifier);
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") {
        throw error;
      }
      throw new Error(`E_METRO_POLYFILLS: ${specifier} is not installed beside react-native; provision the SDK again`);
    }
  });
}
