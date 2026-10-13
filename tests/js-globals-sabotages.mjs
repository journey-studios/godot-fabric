// The retained sabotages of the JS globals slice (GF-05 slice B), written once: scripts/js-globals-bundle.mjs hands each to esbuild as an in-memory
// override of one source file (no file is edited), scripts/js-globals-sabotage.mjs runs the native test on each, and tests/sabotage-anchors.test.mjs checks
// that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
//
//   stub-console    RN's console polyfill installs a console of three functions over the host hook that joins its arguments with a space and ignores
//                   RN's levels: the console the host used to define, put where the polyfill is. A polyfill that does not run RN's code is rejected.
//   no-globals      src/initialize.js does not import setUpGlobals: no window, self or process.
//   no-dom          src/initialize.js imports setUpDOM and never calls it: none of the lazy DOM globals and no dispatch function.
//   no-performance  src/initialize.js does not import setUpPerformance: with the host's stub gone, there is no performance at all.
//   no-navigator    src/initialize.js does not import setUpNavigator: no navigator.
export const SABOTAGES = [
  {name: "stub-console", file: "node_modules/@react-native/js-polyfills/console.js", find: "if (global.nativeLoggingHook) {",
    replace: "if (global.nativeLoggingHook) {\n  global.console = {log: (...a) => global.nativeLoggingHook(a.join(' '), 0),\n    warn: (...a) => global.nativeLoggingHook(a.join(' '), 1),\n    error: (...a) => global.nativeLoggingHook(a.join(' '), 2)};\n} else if (false) {"},
  {name: "no-globals", file: "src/initialize.js", find: 'import "react-native/Libraries/Core/setUpGlobals";\n', replace: ""},
  {name: "no-dom", file: "src/initialize.js", find: "\nsetUpDOM();\n", replace: "\n"},
  {name: "no-performance", file: "src/initialize.js", find: 'import "react-native/Libraries/Core/setUpPerformance";\n', replace: ""},
  {name: "no-navigator", file: "src/initialize.js", find: 'import "react-native/Libraries/Core/setUpNavigator";\n', replace: ""},
];
