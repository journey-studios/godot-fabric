// The retained sabotages of the web globals slice (GF-05 slice E), written once: scripts/web-globals-bundle.mjs hands each to esbuild as an in-memory override of one source
// file (no file is edited), scripts/web-globals-sabotage.mjs runs the native test on each, and tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly
// once in its file. It has no side effects, so the test can import it. None of them touches the host: this slice changes no native code.
//
//   url-reimplemented     RN's setUpXHR installs a minimal URL of its own in place of RN's: a global that is not the export of Libraries/Blob/URL, and that has the members a quick
//                         polyfill has and none of the behaviour of RN's regexes.
//   text-decoder-polyfilled   src/initialize.js defines a TextDecoder: the negative fixture of the decision, which says Hermes has none and so does this host.
//   abort-controller-silent   RN's setUpXHR installs an AbortController whose abort() flips `aborted` and dispatches nothing: no listener, no onabort, and no fetch ever sees the signal.
//   search-params-delete-ignored   RN's URLSearchParams.delete does nothing: one member of the class changed, the way a regression in a library would.
export const SABOTAGES = [
  {name: "url-reimplemented", file: "node_modules/react-native/Libraries/Core/setUpXHR.js", find: "polyfillGlobal('URL', () => require('../Blob/URL').URL);",
    replace: "polyfillGlobal('URL', () => class URL {\n  constructor(url, base) {\n    this.href = base ? String(base).replace(/\\/$/, '') + '/' + String(url).replace(/^\\//, '') : String(url);\n  }\n  toString() {\n    return this.href;\n  }\n  toJSON() {\n    return this.href;\n  }\n});"},
  {name: "text-decoder-polyfilled", file: "src/initialize.js", find: "import \"react-native/Libraries/Core/setUpNavigator\";\n",
    replace: "import \"react-native/Libraries/Core/setUpNavigator\";\nglobalThis.TextDecoder = class TextDecoder {\n  decode(bytes) {\n    return String.fromCharCode(...bytes);\n  }\n};\n"},
  {name: "abort-controller-silent", file: "node_modules/react-native/Libraries/Core/setUpXHR.js", find: "      .AbortController, // flowlint-line untyped-import:off\n",
    replace: "      .AbortController && (class AbortController {\n        constructor() {\n          this.signal = {aborted: false, reason: undefined, addEventListener() {}, removeEventListener() {}};\n        }\n        abort(reason) {\n          this.signal.aborted = true;\n          this.signal.reason = reason;\n        }\n      }),\n"},
  {name: "search-params-delete-ignored", file: "node_modules/react-native/Libraries/Blob/URLSearchParams.js", find: "    this._searchParams.delete(name);\n", replace: "    void name;\n"},
];
