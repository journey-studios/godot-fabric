import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES} from "../tests/web-globals-sabotages.mjs";
import {derivedChecks, expectedFile, observedCases, oracleRejection, verifyExpectedFile, verifyWebGlobalsReport, webGlobalsExpectations} from "../tests/web-globals-oracle.mjs";

// Writes docs/evidence/runtime/web-globals.json, the committed record of the web globals slice's executed lanes, from the reports that the lanes left in build/ (which Git
// does not keep). It re-judges every report before it writes anything:
//
//   - the current lane's report passes the independent oracle, and every sabotage's report is rejected by it with the verdicts the probe gave;
//   - every lane bundled the sources that are on disk now, ran on the host that is in addons/ now and judged the cases against the expectation file that is on disk now, so
//     the record is of this tree and not of an earlier one.
//
// This slice changes no native code, so there is no run on a previous host and the record says so. The lanes run before it: `npm run test:web-globals` and
// `node scripts/web-globals-sabotage.mjs` (the sabotages, then the current lane). With --commit <sha> it also checks every pin of a repository file against
// `git show <sha>:<path>` and records the commit, which is how the pins are tied to the implementation commit once it exists. Run with:
//   node scripts/web-globals-evidence.mjs [--commit <sha>]
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const readJson = file => JSON.parse(readFileSync(path.join(root, file), "utf8"));
const sha = file => digest(readFileSync(path.join(root, file)));
const git = (...args) => execFileSync("git", args, {cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024}).trim();
const commitArgument = process.argv.indexOf("--commit");
const commit = commitArgument === -1 ? null : process.argv[commitArgument + 1];

const currentReport = readJson("build/web-globals-current-report.json");
const expectations = await webGlobalsExpectations(currentReport.stages.environment.blobConstants);
verifyExpectedFile(expectations);
const failures = report => report.checks.filter(row => !row.passed).map(row => row.name);
const lane = (name, {rejected}) => {
  const report = readJson(`build/web-globals-${name}-report.json`);
  assert.deepEqual(derivedChecks(report, expectations), report.checks, `${name}: the oracle derives the verdicts the probe gave`);
  const oracle = rejected ? oracleRejection(report, expectations) : null;
  if (rejected) {
    assert.ok(failures(report).length > 0 && oracle !== null, `${name}: the probe and the oracle reject it`);
  } else {
    verifyWebGlobalsReport(report, expectations, {serverLog: report.server});
  }
  return {report, oracle, logSha256: sha(`build/web-globals-${name}.log`)};
};

const current = lane("current", {rejected: false});
const sabotages = SABOTAGES.map(variant => ({variant, ...lane(`sabotage-${variant.name}`, {rejected: true})}));
const bundleOf = report => report.provenance.bundle;

// The record is of this tree: every lane bundled the files that are on disk now, the host and the Hermes that are in addons/ now ran them, and the probe read the
// expectation file that is on disk now.
const hostSha256 = sha("addons/fabric_godot.dylib");
const hermesSha256 = sha("addons/frameworks/hermesvm.framework/hermesvm");
for (const {report} of [current, ...sabotages]) {
  for (const [file, pin] of Object.entries(bundleOf(report).sources)) {
    assert.equal(sha(file), pin, `${report.provenance.lane}: ${file} changed after the lane ran; run the lanes again`);
  }
  assert.equal(report.provenance.nativeHostSha256, hostSha256, `${report.provenance.lane} ran on the host that is in addons/ now`);
  assert.equal(report.provenance.hermesSha256, hermesSha256, `${report.provenance.lane} ran on the Hermes that is in addons/ now`);
  assert.equal(report.provenance.expectedSha256, sha(expectedFile), `${report.provenance.lane} judged the cases against the expectation file that is on disk now`);
}
for (const {report, variant} of sabotages) {
  assert.notEqual(bundleOf(report).bundle.sha256, bundleOf(current.report).bundle.sha256, `${variant.name} bundles another SDK`);
}

const pins = bundleOf(current.report).sources;
if (commit !== null) {
  for (const [file, pin] of Object.entries(pins)) {
    assert.equal(digest(execFileSync("git", ["show", `${commit}:${file}`], {cwd: root, maxBuffer: 64 * 1024 * 1024})), pin, `${file} at ${commit}`);
  }
  assert.equal(digest(execFileSync("git", ["show", `${commit}:${expectedFile}`], {cwd: root, maxBuffer: 64 * 1024 * 1024})), sha(expectedFile), `${expectedFile} at ${commit}`);
}
const inputs = bundleOf(current.report).bundle.inputs;
const stages = current.report.stages;
const observed = observedCases(current.report);
const summary = ({report, oracle, logSha256}) => ({
  checks: report.checks.length, failedChecks: failures(report), oracleVerdict: oracle, bundleSha256: bundleOf(report).bundle.sha256,
  nativeHostSha256: report.provenance.nativeHostSha256, logSha256,
});
const messagesOf = value => {
  if (Array.isArray(value)) {
    return value.flatMap(messagesOf);
  }
  if (value !== null && typeof value === "object") {
    return value.$ === "error" ? [{name: value.name, message: value.message}] : Object.values(value).flatMap(messagesOf);
  }
  return [];
};
const net = stages.network;
const x = expectations;

const record = {
  schemaVersion: 1,
  scenario: "web-globals",
  status: "verified-local-headless-no-native-change-four-sabotages",
  at: new Date().toISOString(),
  executionBaseCommit: git("rev-parse", "HEAD"),
  sourceDirtyDuringExecution: commit === null,
  implementationCommit: commit,
  pinning: commit === null
    ? "The lanes ran on the working tree on top of executionBaseCommit, before the implementation commit existed. sourcePins are the SHA-256 of the files they executed; rerun scripts/web-globals-evidence.mjs --commit <sha> to check each against git show <sha>:<path> and record the commit."
    : "Every sourcePins entry equals git show <implementationCommit>:<path>.",
  environment: {
    godot: current.report.godot, reactNative: current.report.reactNative, node: current.report.provenance.node, platform: "macOS arm64", displayServer: current.report.displayServer,
    nativeHostSha256: hostSha256, hermesSha256, hermesVersion: x.hermes.version, hermesArchiveSha256: x.hermes.archiveSha256,
    whatwgFetch: x.facts.fetch.version,
  },
  commands: ["npm run test:web-globals", "node scripts/web-globals-sabotage.mjs", "node scripts/web-globals-evidence.mjs"],
  previousHostControl: {
    applicable: false,
    reason: "This slice changes no native code: the host in addons/ is the one the earlier GF-05 slices certified, rebuilt from the sources at executionBaseCommit, and nothing in it is new to this suite. A control on a previous host would run the same bundle on the same behaviour. The causal controls are the four retained sabotages.",
  },
  currentLane: {
    ...summary(current),
    result: `WEB_GLOBALS_PASSED: ${current.report.checks.length}`,
    checkVerdicts: current.report.checks,
    cases: {total: Object.keys(observed).length, url: Object.keys(stages.cases.url).length, searchParams: Object.keys(stages.cases.searchParams).length,
      abort: Object.keys(stages.cases.abort).length, abortTimers: Object.keys(stages.timers.results).length, encoding: Object.keys(stages.cases.encoding).length,
      decoder: Object.keys(stages.cases.decoder).length, groups: x.groups.length, expectedSha256: sha(expectedFile)},
    bundleInputs: {count: inputs.length, injectedFirst: inputs[0],
      positions: Object.fromEntries(["src/initialize.js", "node_modules/react-native/Libraries/Core/setUpXHR.js", "node_modules/react-native/Libraries/Blob/URL.js",
        "node_modules/react-native/Libraries/Blob/URLSearchParams.js", "node_modules/react-native/src/private/webapis/dom/abort-api/AbortController.js",
        "node_modules/react-native/src/private/webapis/dom/abort-api/AbortSignal.js", "node_modules/react-native/Libraries/Network/fetch.js"]
        .filter(file => inputs.includes(file)).map(file => [file, inputs.indexOf(file)]))},
    originalReactNativeSources: bundleOf(current.report).originalReactNativeSources,
    hostBeforeTheBundle: stages.host,
    atTheFirstModule: stages.first,
    globals: {lazyBeforeFirstRead: stages.environment.lazyBefore, afterFirstRead: stages.environment.lazyAfter, identity: stages.environment.identity,
      engineBefore: stages.environment.encodingBefore, engineAfter: stages.environment.encodingAfter, blobConstants: stages.environment.blobConstants,
      objectUrlOfARealBlob: stages.environment.objectUrl},
    network: {fetchAbort: net.fetchAbort, reasonAbort: net.reasonAbort, abortedBefore: net.abortedBefore, completed: net.completed, xhrAbort: net.xhrAbort,
      outcomes: Object.fromEntries(Object.entries(net.afterRelease.fetches).map(([name, entry]) => [name, entry.outcome])),
      signals: net.afterRelease.controllers, xhrEvents: net.afterRelease.xhrs, serverHolds: net.serverLog.holds, serverRequests: net.serverLog.records.map(record => record.url)},
    timers: {cases: Object.fromEntries(Object.entries(stages.timers.results).map(([id, result]) => [id, result.value.reason ?? result.value.after?.reason ?? null]))},
    hermesMessages: [...new Map(messagesOf(stages.cases.encoding).map(entry => [`${entry.name}: ${entry.message}`, entry])).values()],
    decoder: {results: Object.fromEntries(Object.entries(stages.cases.decoder).map(([id, result]) => [id, result.threw ? result.thrown : result.value]))},
  },
  members: {
    note: "Read out of RN's source with the TypeScript parser and set against what RN's code did in V8 and what Hermes did: the three agree for every member. 'Implemented' is the prototype members of the declaration; RN 0.87.1's URL has no member that throws 'not implemented', so there are none to certify as throwing.",
    URL: {file: x.facts.files.URL.file, prototype: x.facts.url.prototype, statics: x.facts.url.statics, setters: x.facts.url.setters, notImplementedThrows: x.facts.urlNotImplemented,
      absentFromTheStandard: ["canParse", "parse", "a setter for hash, host, hostname, href, pathname, port, protocol, username and password", "searchParams as a setter"]},
    URLSearchParams: {file: x.facts.files.URLSearchParams.file, prototype: x.facts.searchParams.prototype, symbols: x.facts.searchParams.symbols, statics: x.facts.searchParams.statics,
      absentFromTheStandard: ["toJSON", "construction from a Map, an iterator or another URLSearchParams (read as an object)", "the value argument of delete and has"]},
    AbortController: {file: x.facts.files.AbortController.file, prototype: x.facts.controller.prototype},
    AbortSignal: {file: x.facts.files.AbortSignal.file, export: x.facts.files.AbortSignal.export, prototype: x.facts.signal.prototype, statics: x.facts.signal.statics,
      note: "The global is AbortSignal_public, a wrapper that throws 'Illegal constructor' and copies the statics and the prototype of the class."},
  },
  encoding: {
    decision: "Parity with Hermes (2026-10-13): TextEncoder, atob and btoa present and tested; TextDecoder absent, with a negative fixture, as on RN iOS and Android.",
    bytes: Object.fromEntries(Object.keys(x.expected).filter(id => /^encode\/[a-zA-Z]+$/.test(id) && !["encode/shape"].includes(id) && Array.isArray(x.expected[id].value))
      .map(id => [id, observed[id].value])),
    deviations: Object.fromEntries(Object.entries(x.deviations).map(([id, {category, why}]) => [id, {category, why, hermes: observed[id], node: x.node[id]}])),
    identicalToNode: Object.keys(x.node).filter(id => !(id in x.deviations)).length,
    deviatingFromNode: Object.keys(x.deviations).length,
    binary: {host: x.hermes.host, version: x.hermes.version, archiveSha256: x.hermes.archiveSha256, pinnedMacosEqualsTheHost: x.hermes.pinnedMacosEqualsTheHost, slices: x.hermes.slices,
      citation: "The pinned hermes-ios archive ships binaries and headers, no Hermes source: the authority is the binary (its builtins textEncoderConstructor, textEncoderPrototypeEncode, textEncoderPrototypeEncodeInto, textEncoderPrototypeEncoding, atob and btoa, and the messages of every error the cases recorded), checked by the oracle, and the host's own execution of each call."},
    textDecoder: {rnFilesMentioning: x.facts.mentions.TextDecoder, binariesHoldingIt: x.hermes.slices.filter(slice => slice.TextDecoder).map(slice => slice.file),
      binariesScanned: x.hermes.slices.length},
    shadowScan: x.shadow,
  },
  retainedSabotage: {
    script: "scripts/web-globals-sabotage.mjs",
    table: "tests/web-globals-sabotages.mjs",
    mechanism: "in-memory esbuild overrides of one file each (scripts/web-globals-bundle.mjs); no file is edited and no native code is touched",
    variants: sabotages.map(({variant, report, oracle, logSha256}) => ({name: variant.name, file: variant.file, find: variant.find, replace: variant.replace,
      ...summary({report, oracle, logSha256})})),
  },
  oracle: {
    file: "tests/web-globals-oracle.mjs",
    independence: "Written from RN, Node and the pinned Hermes, not from the probe: RN's Libraries/Blob/URL.js, Libraries/Blob/URLSearchParams.js and the two files of src/private/webapis/dom/abort-api are bundled with nothing of the SDK's (no platform plugin, so none of its overlays) and run in a V8 context with the same cases the fixture runs in Hermes; the members of the four classes are read from RN's source with the TypeScript parser; Node's own TextEncoder, atob and btoa answer the encoding cases, Buffer checks the UTF-8 bytes, and a table of fourteen documented deviations says where Hermes answers otherwise and is required to differ from Node; the hermesvm binaries are scanned; every verdict of the probe is derived again from the report's raw observations.",
    expectationFile: {file: expectedFile, sha256: sha(expectedFile), cases: Object.keys(x.expected).length, groups: x.groups.length,
      note: "The file the probe judges against. The runner requires it to equal what the oracle derives, so a change in RN, Node or the Hermes pin that moves an answer fails there."},
    referenceBundleSha256: x.reference.bundleSha256,
    fromRn: {setUpXHR: x.facts.files, fetch: x.facts.fetch, xhr: x.facts.xhr, rendererReadsAbortController: x.facts.rendererReadsAbortController},
  },
  sourcePins: pins,
  scope: {actualHermesRuntime: true, actualFabricApplication: true, headless: true, realNetworking: "loopback, the networking suite's server", rnModules: ["setUpXHR", "URL", "URLSearchParams",
    "AbortController", "AbortSignal", "fetch", "XMLHttpRequest"], engineBuiltins: ["TextEncoder", "atob", "btoa"], textDecoderAbsent: true},
  limits: ["The fetch and XMLHttpRequest integration is the signal's: that an abort reaches the request and ends it as RN's code says. The transport, redirects, TLS and bodies are the networking suite's.",
    "RN's XMLHttpRequest takes no signal option; the XMLHttpRequest case wires the signal's abort event to xhr.abort(), the way an application does. fetch is the one RN API that reads a signal (whatwg-fetch, version in environment.whatwgFetch).",
    "URLSearchParams.sort orders keys with localeCompare, which is the engine's: the cases use ASCII keys, and the order is the one ICU gives V8 and the Apple Hermes gives, in the default locale. Another locale could order them otherwise.",
    "Android's libhermes is not part of this repository's pins; the claim that its Hermes has no TextDecoder rests on the decision and on the iOS, tvOS and visionOS slices of the same release, which the oracle scans.",
    "The headless desktop host only; no mobile export has run this bundle.",
    "Hosted CI is pending: the record is of the local run."],
};
writeFileSync(path.join(root, "docs/evidence/runtime/web-globals.json"), JSON.stringify(record, null, 2) + "\n");
console.log(`WEB_GLOBALS_EVIDENCE_WRITTEN: ${current.report.checks.length} checks, ${Object.keys(observed).length} cases, ${sabotages.length} sabotages`);
