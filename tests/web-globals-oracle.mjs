import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {existsSync, lstatSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {isDeepStrictEqual} from "node:util";
import vm from "node:vm";
import {transformAsync} from "@babel/core";
import {build} from "esbuild";
import ts from "typescript";
import {abortCases, abortTimerCases, checkGroups, decoderCases, encodingCases, encodingInputs, runCases, searchParamsCases, stringOf, urlCases} from "./web-globals-cases.mjs";

// The independent oracle of the web globals slice. It is written from RN, from Node and from the pinned Hermes, not from the probe:
//   - URL, URLSearchParams, AbortController and AbortSignal: RN's own files (Libraries/Blob/URL.js, Libraries/Blob/URLSearchParams.js and the two of
//     src/private/webapis/dom/abort-api, with the DOMException, Event and EventTarget they use) are bundled with nothing of the SDK's, the platform plugin's
//     resolution and its overlays included, and run in a V8 context with the same cases the fixture runs in Hermes. What Hermes did with each case must be what V8
//     does with RN's code, call by call. The members of the four classes are also read out of RN's source with the TypeScript parser, and the result must agree.
//   - TextEncoder, atob and btoa: the same cases run in Node, whose encoders are written against the spec, and the bytes are checked once more against Buffer. Where
//     Hermes behaves otherwise the table of deviations says how, and asserts that Node still behaves the other way, so that a deviation that closed is noticed.
//   - TextDecoder: RN's JavaScript does not mention it and no hermesvm binary of the pinned version (the host's, and the iOS, tvOS and visionOS slices of the same
//     release) holds the name, while all of them hold TextEncoder, atob and btoa. Hermes' own error messages are checked against the strings of the binary the host links.
//   - Nothing in src/, the toolchain or native/ defines any of the eight globals.
// The report's raw observations are judged against those, and every verdict the probe gave is derived again here and must agree.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireSdk = createRequire(path.join(root, "package.json"));
const same = isDeepStrictEqual;
const sorted = values => [...values].sort();
export const expectedFile = "tests/web-globals-expected.json";

const allCases = [...urlCases, ...searchParamsCases, ...abortCases, ...abortTimerCases, ...encodingCases, ...decoderCases];
const reactNativeCases = [...urlCases, ...searchParamsCases, ...abortCases, ...abortTimerCases];

// ------------------------------------------------------------------------------------------------------------------------------------------------
// How a result is compared
// ------------------------------------------------------------------------------------------------------------------------------------------------

// An error of the expectation without a message stands for an error of that name whose message the engine wrote.
function stripMessages(value) {
  if (Array.isArray(value)) {
    return value.map(stripMessages);
  }
  if (value !== null && typeof value === "object") {
    if (value.$ === "error") {
      return {$: "error", name: value.name};
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripMessages(item)]));
  }
  return value;
}

// Deep equality of two images of JSON, key order aside (Godot writes a report with its keys sorted), with the name-only rule for errors.
function matches(seen, wanted) {
  if (wanted !== null && typeof wanted === "object" && !Array.isArray(wanted)) {
    if (seen === null || typeof seen !== "object" || Array.isArray(seen)) {
      return false;
    }
    if (wanted.$ === "error" && !("message" in wanted)) {
      return seen.$ === "error" && seen.name === wanted.name;
    }
    const keys = Object.keys(wanted);
    return keys.length === Object.keys(seen).length && keys.every(key => key in seen && matches(seen[key], wanted[key]));
  }
  if (Array.isArray(wanted)) {
    return Array.isArray(seen) && seen.length === wanted.length && wanted.every((item, index) => matches(seen[index], item));
  }
  return seen === wanted;
}

const ok = value => ({threw: false, value});
const throwsError = (name, message) => ({threw: true, thrown: message === undefined ? {$: "error", name} : {$: "error", name, message}});

// ------------------------------------------------------------------------------------------------------------------------------------------------
// RN's own files, run in V8
// ------------------------------------------------------------------------------------------------------------------------------------------------

// RN's modules are Flow source: they go through the Babel preset the platform plugin gives them, and nothing else of the SDK is in this bundle.
const flowPlugin = {name: "rn-flow", setup(builder) {
  const rnRoot = path.join(root, "node_modules/react-native");
  builder.onLoad({filter: /\.js$/}, async args => {
    if (!args.path.startsWith(rnRoot + path.sep)) {
      return undefined;
    }
    const result = await transformAsync(readFileSync(args.path, "utf8"), {filename: args.path, configFile: false, babelrc: false,
      presets: [[requireSdk.resolve("@react-native/babel-preset"), {disableImportExportTransform: true}]]});
    return {contents: result.code, loader: "js", resolveDir: path.dirname(args.path)};
  });
}};

const referenceEntry = `
import {URL, URLSearchParams} from "./node_modules/react-native/Libraries/Blob/URL";
import {AbortController} from "./node_modules/react-native/src/private/webapis/dom/abort-api/AbortController";
import {AbortSignal_public as AbortSignal} from "./node_modules/react-native/src/private/webapis/dom/abort-api/AbortSignal";
import {abortCases, abortTimerCases, runCases, runTimerCases, searchParamsCases, urlCases} from "./tests/web-globals-cases.mjs";
// RN's URL reads URLSearchParams as a global; setUpXHR installs it from this same export.
globalThis.URLSearchParams = URLSearchParams;
const env = {URL, URLSearchParams, AbortController, AbortSignal, setTimeout};
globalThis.WebGlobalsReference = {
  run: () => JSON.stringify({...runCases(urlCases, env), ...runCases(searchParamsCases, env), ...runCases(abortCases, env)}),
  timers: () => runTimerCases(abortTimerCases, env).then(results => JSON.stringify(results)),
};
`;

const referenceRuns = new Map();
// The cases of RN's classes as RN's code answers them in V8, for a blob module with these constants (the host's, as its report says).
function referenceResults(blobConstants) {
  const key = JSON.stringify(blobConstants);
  if (!referenceRuns.has(key)) {
    referenceRuns.set(key, runReference(blobConstants));
  }
  return referenceRuns.get(key);
}

async function runReference(blobConstants) {
  const bundle = await build({absWorkingDir: root, stdin: {contents: referenceEntry, resolveDir: root, sourcefile: "web-globals-reference-entry.js"},
    bundle: true, write: false, platform: "neutral", format: "iife", define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"},
    mainFields: ["main"], plugins: [flowPlugin], logLevel: "error"});
  const context = vm.createContext({setTimeout, performance, console: {log() {}, warn() {}, error() {}}});
  context.global = context;
  context.__DEV__ = false;
  context.nativeModuleProxy = {};
  // The one native module RN's URL looks up when it loads: the BlobModule whose constants make the prefix of createObjectURL.
  context.__turboModuleProxy = name => name === "BlobModule" ? {getConstants: () => blobConstants} : null;
  vm.runInContext(bundle.outputFiles[0].text, context);
  const results = JSON.parse(vm.runInContext("WebGlobalsReference.run()", context));
  const timers = JSON.parse(await vm.runInContext("WebGlobalsReference.timers()", context));
  return {results: {...results, ...timers}, bundleSha256: createHash("sha256").update(bundle.outputFiles[0].contents).digest("hex")};
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// What RN's sources state
// ------------------------------------------------------------------------------------------------------------------------------------------------

const parse = (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

function visit(node, callback) {
  callback(node);
  node.forEachChild(child => visit(child, callback));
}

// The members of a class: what its prototype and its constructor have by name, from the declaration. Fields live on the instance, so they are left out.
function classShape(source, file, className) {
  const sf = parse(file, source);
  let declaration;
  visit(sf, node => {
    if (declaration === undefined && ts.isClassDeclaration(node) && node.name?.text === className) {
      declaration = node;
    }
  });
  assert.ok(declaration, `${file} no longer declares class ${className}`);
  // A class without a constructor of its own still has the one every prototype points back to.
  const prototype = new Set(["constructor"]);
  const symbols = new Set();
  const statics = new Set();
  const setters = new Set();
  for (const member of declaration.members) {
    if (ts.isConstructorDeclaration(member) || ts.isPropertyDeclaration(member) || ts.isSemicolonClassElement(member)) {
      continue;
    }
    const isStatic = member.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword) ?? false;
    let name;
    if (ts.isComputedPropertyName(member.name)) {
      name = `Symbol(${member.name.expression.getText(sf)})`;
    } else {
      name = member.name.text;
    }
    if (name.startsWith("Symbol(")) {
      symbols.add(name);
    } else if (isStatic) {
      statics.add(name);
    } else {
      prototype.add(name);
      if (ts.isSetAccessor(member)) {
        setters.add(name);
      }
    }
  }
  return {prototype: sorted(prototype), symbols: sorted(symbols), statics: sorted(statics), setters: sorted(setters)};
}

// The polyfillGlobal('Name', () => require('path').Export) calls of setUpXHR.js: which module and which export each global is.
function polyfilled(source) {
  const sf = parse("setUpXHR.js", source);
  const found = {};
  visit(sf, node => {
    if (ts.isCallExpression(node) && node.expression.getText(sf) === "polyfillGlobal" && ts.isStringLiteral(node.arguments[0]) && ts.isArrowFunction(node.arguments[1])) {
      const body = node.arguments[1].body;
      if (ts.isPropertyAccessExpression(body) && ts.isCallExpression(body.expression) && body.expression.expression.getText(sf) === "require" &&
        ts.isStringLiteral(body.expression.arguments[0])) {
        found[node.arguments[0].text] = {module: body.expression.arguments[0].text, export: body.name.text};
      }
    }
  });
  return found;
}

const textOf = file => readFileSync(path.join(root, file), "utf8");
const rnSource = file => textOf("node_modules/react-native/" + file);

let rnJavaScript;
// Every JavaScript file of RN's Libraries and src that mentions a name; the decision says RN installs no TextDecoder, and this is how that is read.
function rnFilesMentioning(names) {
  if (rnJavaScript === undefined) {
    rnJavaScript = [];
    const walk = directory => {
      for (const entry of readdirSync(path.join(root, directory), {withFileTypes: true})) {
        const relative = path.posix.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__" && entry.name !== "__mocks__") {
            walk(relative);
          }
        } else if (/\.(?:js|jsx|mjs|cjs)$/.test(entry.name) && !entry.name.endsWith(".flow.js")) {
          rnJavaScript.push({file: relative, text: textOf(relative)});
        }
      }
    };
    walk("node_modules/react-native/Libraries");
    walk("node_modules/react-native/src");
  }
  return Object.fromEntries(names.map(name => [name, rnJavaScript.filter(({text}) => new RegExp(`\\b${name}\\b`).test(text)).map(({file}) => file)]));
}

function rnFacts() {
  const globals = polyfilled(rnSource("Libraries/Core/setUpXHR.js"));
  const resolveModule = module => path.posix.normalize(path.posix.join("Libraries/Core", module)) + ".js";
  const files = Object.fromEntries(["URL", "URLSearchParams", "AbortController", "AbortSignal"].map(name => {
    assert.ok(globals[name], `RN's setUpXHR no longer installs ${name}`);
    return [name, {file: resolveModule(globals[name].module), export: globals[name].export}];
  }));
  const urlSource = rnSource("Libraries/Blob/URL.js");
  const searchParamsSource = rnSource("Libraries/Blob/URLSearchParams.js");
  const controllerSource = rnSource(files.AbortController.file);
  const signalSource = rnSource(files.AbortSignal.file);
  const fetchSource = textOf("node_modules/whatwg-fetch/dist/fetch.umd.js");
  const abortErrors = [...fetchSource.matchAll(/new exports\.DOMException\('([^']+)', '(AbortError)'\)/g)].map(match => ({message: match[1], name: match[2]}));
  assert.ok(abortErrors.length === 2 && same(abortErrors[0], abortErrors[1]), "whatwg-fetch rejects an aborted request with one AbortError in two places");
  const xhrSource = rnSource("Libraries/Network/XMLHttpRequest.js");
  const setReadyState = xhrSource.slice(xhrSource.indexOf("  setReadyState(newState"));
  const abortStart = xhrSource.indexOf("  abort(): void {");
  const abortMethod = xhrSource.slice(abortStart, xhrSource.indexOf("\n  }\n", abortStart));
  const rendererSource = rnSource("Libraries/Renderer/implementations/ReactFabric-prod.js");
  const url = classShape(urlSource, "Libraries/Blob/URL.js", "URL");
  const searchParams = classShape(searchParamsSource, "Libraries/Blob/URLSearchParams.js", "URLSearchParams");
  const controller = classShape(controllerSource, files.AbortController.file, "AbortController");
  const signal = classShape(signalSource, files.AbortSignal.file, "AbortSignal");
  return {
    files, url, searchParams, controller, signal,
    urlReexportsSearchParams: /export \{URLSearchParams\} from '\.\/URLSearchParams';/.test(urlSource),
    // RN's URL has no member that throws "not implemented": the cases would have to cover it if it did.
    urlNotImplemented: /not implemented/i.test(urlSource),
    searchParamsSort: /localeCompare/.test(searchParamsSource),
    signalPublicCopiesStatics: /Object\.getOwnPropertyNames\(AbortSignal\)\.forEach/.test(signalSource),
    fetch: {abortName: abortErrors[0].name, abortMessage: abortErrors[0].message, usesWhatwg: /require\('whatwg-fetch'\)/.test(rnSource("Libraries/Network/fetch.js")),
      listensToTheSignal: /request\.signal\.addEventListener\('abort', abortXhr\)/.test(fetchSource), abortsItsXhr: /function abortXhr\(\) \{\s*xhr\.abort\(\)/.test(fetchSource),
      polyfillsDomException: /exports\.DOMException\.prototype = Object\.create\(Error\.prototype\)/.test(fetchSource), version: JSON.parse(textOf("node_modules/whatwg-fetch/package.json")).version},
    xhr: {dispatchOrder: ["readystatechange", "abort", "loadend"], readyStateDispatchesAbort: /if \(this\._aborted\) \{\s*dispatchTrustedEvent\(this, new Event\('abort'\)\);/.test(setReadyState),
      abortCompletes: /this\.setReadyState\(this\.DONE\);/.test(abortMethod)},
    // The renderer reads the global AbortController when it evaluates, so RN's lazy accessor is resolved before the application's first module has run.
    rendererReadsAbortController: /"undefined" !== typeof AbortController\s*\?\s*AbortController/.test(rendererSource),
    mentions: rnFilesMentioning(["TextDecoder", "TextEncoder", "atob", "btoa"]),
  };
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// The Hermes this host links
// ------------------------------------------------------------------------------------------------------------------------------------------------

const hermesLocation = "addons/frameworks/hermesvm.framework/hermesvm";
const hermesUniversal = ".deps/hermes/destroot/Library/Frameworks/universal/hermesvm.xcframework";
const binaries = new Map();
const binaryOf = file => {
  if (!binaries.has(file)) {
    binaries.set(file, readFileSync(path.join(root, file)));
  }
  return binaries.get(file);
};
const binaryHas = (file, text) => binaryOf(file).includes(Buffer.from(text, "utf8"));

// The regular files named hermesvm below a directory: the slices of the xcframework (the macOS and Mac Catalyst ones are symlinked into their Versions directory).
function hermesSlices(directory) {
  const found = [];
  const walk = relative => {
    for (const entry of readdirSync(path.join(root, relative), {withFileTypes: true})) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.name === "hermesvm" && entry.isFile() && lstatSync(path.join(root, child)).size > 1_000_000) {
        found.push(child);
      }
    }
  };
  if (existsSync(path.join(root, directory))) {
    walk(directory);
  }
  return found.sort();
}

function hermesFacts() {
  const dependencies = JSON.parse(textOf("dependencies.json")).hermes;
  const files = [hermesLocation, ...hermesSlices(hermesUniversal)];
  const slices = files.map(file => ({file, sha256: createHash("sha256").update(binaryOf(file)).digest("hex"), bytes: binaryOf(file).length,
    TextEncoder: binaryHas(file, "TextEncoder"), encodeInto: binaryHas(file, "encodeInto"), atob: binaryHas(file, "atob"), btoa: binaryHas(file, "btoa"),
    TextDecoder: binaryHas(file, "TextDecoder")}));
  const pinned = ".deps/hermes/destroot/Library/Frameworks/macosx/hermesvm.framework/hermesvm";
  return {version: dependencies.version, archiveSha256: dependencies.sha256, host: hermesLocation, slices,
    pinnedMacosEqualsTheHost: existsSync(path.join(root, pinned)) ? slices[0].sha256 === createHash("sha256").update(binaryOf(pinned)).digest("hex") : null};
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// Nothing in the host or the SDK shadows a global of this slice
// ------------------------------------------------------------------------------------------------------------------------------------------------

const globalNames = ["TextDecoder", "TextEncoder", "atob", "btoa", "URL", "URLSearchParams", "AbortController", "AbortSignal"];

const names = globalNames.join("|");
const assigned = new RegExp(`\\b(?:globalThis|global|window|self)\\s*\\.\\s*(?:${names})\\s*=[^=]`);
const defined = new RegExp(`defineProperty\\(\\s*(?:globalThis|global|window|self)\\s*,\\s*["'](?:${names})["']`);
const polyfilledName = new RegExp(`polyfill(?:Global|ObjectProperty)\\(\\s*(?:global\\s*,\\s*)?["'](?:${names})["']`);
const installedName = new RegExp(`(?:setProperty|forAscii)\\([^;]*"(?:${names})"`);

// What one file does to the eight globals: JavaScript that assigns, defines or polyfills one, or C++ that installs one on the global object.
export function shadowHits(file, text) {
  const hits = [];
  if (/\.(?:cpp|h|mm)$/.test(file)) {
    if (installedName.test(text)) {
      hits.push({file, kind: "installs"});
    }
    return hits;
  }
  for (const [kind, pattern] of [["assigns", assigned], ["defines", defined], ["polyfills", polyfilledName]]) {
    if (pattern.test(text)) {
      hits.push({file, kind});
    }
  }
  return hits;
}

function shadowScan() {
  const hits = [];
  const walk = (directory, accept) => {
    for (const entry of readdirSync(path.join(root, directory), {withFileTypes: true})) {
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(relative, accept);
      } else if (accept.test(entry.name)) {
        hits.push(...shadowHits(relative, textOf(relative)));
      }
    }
  };
  for (const directory of ["src", "sdk/toolchain"]) {
    walk(directory, /\.(?:js|jsx|mjs|ts|tsx)$/);
  }
  walk("native", /\.(?:cpp|h|mm)$/);
  return hits;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// What the engine's encoders do, and where Hermes differs from V8
// ------------------------------------------------------------------------------------------------------------------------------------------------

const bytesOf = text => Array.from(Buffer.from(text, "utf8"));

// Where the pinned Hermes answers otherwise than Node's V8 for the same call. `hermes` is what the probe must see (an error without a message is judged by its name,
// the text being the engine's); the oracle runs the same call in Node and requires its answer to differ, so a deviation that no longer exists is noticed.
// The authority is the pinned hermesvm binary (its builtins textEncoderPrototypeEncode, textEncoderPrototypeEncodeInto, atob and btoa, and the messages quoted
// below, which are strings of the binary), and the host's own execution of each call, recorded in the evidence. The release ships no Hermes source, only the binary
// and its headers, so there is no source line to cite.
const HERMES_DEVIATIONS = {
  "encode/no-argument": {category: "missing argument", hermes: ok(bytesOf("undefined")),
    why: "encode() has no default for its argument: a missing one is converted to the text \"undefined\", where the encoding standard's default is the empty string."},
  "encode/undefined": {category: "missing argument", hermes: ok(bytesOf("undefined")),
    why: "encode(undefined) is converted to the text \"undefined\" for the same reason."},
  "btoa/no-argument": {category: "missing argument", hermes: ok(Buffer.from("undefined", "latin1").toString("base64")),
    why: "btoa() converts a missing argument to the text \"undefined\" and encodes it, where Node throws a TypeError (ERR_MISSING_ARGS)."},
  "atob/no-argument": {category: "missing argument", hermes: throwsError("Error"),
    why: "atob() converts a missing argument to the text \"undefined\", whose nine characters are not a valid base64 length: an Error, where Node throws a TypeError."},
  ...Object.fromEntries(["btoa/out-of-range-throws", "btoa/astral-throws", "atob/invalid-character-throws", "atob/url-alphabet-throws", "atob/unicode-throws",
    "atob/one-character-throws", "atob/five-characters-throw", "atob/padding-of-a-short-string-throws", "atob/too-much-padding-throws",
    "atob/padding-in-the-middle-throws"].map(id => [id, {category: "error class", hermes: throwsError("Error"),
    why: "Invalid base64 input throws a plain Error (\"Found invalid character when converting to base64\", \"Found invalid character when decoding base64 string\" or \"Not a valid base64 encoded string length\"), where the standard and Node throw a DOMException named InvalidCharacterError."}])),
};

// The negative fixture: not an engine's answer to compare with Node's (Node has a TextDecoder), but the absence the decision records.
const decoderMessage = "Property 'TextDecoder' doesn't exist";
const DECODER_EXPECTED = {
  "decoder/typeof": ok("undefined"),
  "decoder/in-global": ok(false),
  "decoder/own-property": ok(false),
  "decoder/descriptor": ok(true),
  "decoder/construct-throws": throwsError("ReferenceError", decoderMessage),
  "decoder/read-throws": throwsError("ReferenceError", decoderMessage),
  "decoder/typeof-the-others": ok({TextEncoder: "function", atob: "function", btoa: "function"}),
};

// What Node's encoders answer for the encoding cases (Node's V8 is the independent implementation of the standard).
function nodeResults() {
  return runCases(encodingCases, {TextEncoder, atob, btoa});
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// The expectation of every case
// ------------------------------------------------------------------------------------------------------------------------------------------------

// The shapes RN's source states, set against what RN's code did in V8: if the oracle's two readings of RN disagree, one of them is wrong.
function assertShapes(facts, results) {
  const urlShape = results["url/shape"].value;
  assert.deepEqual(urlShape.prototype, sorted(facts.url.prototype), "URL's prototype is what Libraries/Blob/URL.js declares");
  assert.deepEqual(urlShape.statics, sorted([...facts.url.statics, "length", "name", "prototype"]), "URL's statics are what Libraries/Blob/URL.js declares");
  const searchShape = results["sp/shape"].value;
  assert.deepEqual(searchShape.prototype, sorted(facts.searchParams.prototype), "URLSearchParams' prototype is what its source declares");
  assert.deepEqual(searchShape.symbols, facts.searchParams.symbols, "URLSearchParams' symbols are what its source declares");
  assert.deepEqual(searchShape.statics, sorted(["length", "name", "prototype"]), "URLSearchParams has no static member");
  const created = results["abort/new-controller"].value;
  assert.deepEqual(created.controllerPrototype, sorted(facts.controller.prototype), "AbortController's prototype is what its source declares");
  assert.deepEqual(created.signalPrototype, sorted(facts.signal.prototype), "AbortSignal's prototype is what its source declares");
  const wrapper = results["abort/signal-cannot-be-constructed"].value;
  assert.deepEqual(wrapper.statics, sorted([...facts.signal.statics, "length", "name", "prototype"]), "The public AbortSignal copies the statics of the class");
  assert.deepEqual(wrapper.prototypeMembers, sorted(facts.signal.prototype), "The public AbortSignal's prototype is the class's");
  const readOnly = results["url/read-only-members"].value;
  for (const [name, descriptor] of Object.entries(readOnly.descriptors)) {
    assert.deepEqual(descriptor, {get: "function", set: facts.url.setters.includes(name) ? "function" : "undefined"}, `The accessor ${name} of URL is as the source declares it`);
  }
  assert.deepEqual(sorted(Object.keys(readOnly.writes).filter(name => readOnly.writes[name])), facts.url.setters, "Only the setters of URL's source accept a write");
}

// The expectation of the cases in the order of the groups: what the probe must see for each. RN's classes: V8's answer to RN's own code. The encoders: Node's answer, or
// the documented Hermes deviation. The decoder: absent.
export async function webGlobalsExpectations(blobConstants) {
  const facts = rnFacts();
  const reference = await referenceResults(blobConstants);
  assertShapes(facts, reference.results);
  const node = nodeResults();
  const flagged = new Map(allCases.map(entry => [entry.id, entry.engineMessage]));
  const expected = {};
  for (const entry of reactNativeCases) {
    assert.ok(entry.id in reference.results, `RN's code was run for ${entry.id}`);
    expected[entry.id] = flagged.get(entry.id) ? stripMessages(reference.results[entry.id]) : reference.results[entry.id];
  }
  for (const entry of encodingCases) {
    const deviation = HERMES_DEVIATIONS[entry.id];
    if (deviation === undefined) {
      expected[entry.id] = entry.engineMessage ? stripMessages(node[entry.id]) : node[entry.id];
    } else {
      expected[entry.id] = deviation.hermes;
      assert.ok(!matches(node[entry.id], deviation.hermes), `${entry.id}: Node no longer answers otherwise than Hermes does, so the deviation is stale`);
    }
  }
  for (const entry of decoderCases) {
    assert.ok(entry.id in DECODER_EXPECTED, `The negative fixture expects ${entry.id}`);
    expected[entry.id] = DECODER_EXPECTED[entry.id];
  }
  // Every case is in exactly one group, and every group is made of cases.
  const grouped = checkGroups.flatMap(group => group.ids);
  assert.deepEqual(sorted(grouped), sorted(allCases.map(entry => entry.id)), "Every case is in exactly one group");
  // The UTF-8 bytes once more, from Buffer, which does not share an implementation with TextEncoder.
  for (const [name, units] of Object.entries(encodingInputs)) {
    assert.deepEqual(expected[`encode/${name}`], ok(bytesOf(stringOf(units))), `The bytes of ${name}: TextEncoder and Buffer agree`);
  }
  return {facts, reference, node, expected, blobConstants, groups: checkGroups.map(({check, ids}) => ({check, ids})), hermes: hermesFacts(), shadow: shadowScan(),
    deviations: Object.fromEntries(Object.entries(HERMES_DEVIATIONS).map(([id, {category, why}]) => [id, {category, why}]))};
}

// The file the probe reads: the expectations and the groups, no more.
function expectedFileContent(expectations) {
  return {format: "godot-fabric.web-globals-expected/v1", reactNative: "0.87.1", blobConstants: expectations.blobConstants, groups: expectations.groups,
    expected: expectations.expected};
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// The checks of the probe, derived again
// ------------------------------------------------------------------------------------------------------------------------------------------------

const lazyNames = ["URL", "URLSearchParams", "AbortSignal"];
const allFour = ["URL", "URLSearchParams", "AbortController", "AbortSignal"];
const descriptorIs = (descriptor, kind, writable, enumerable) => descriptor != null && descriptor.kind === kind && descriptor.writable === writable &&
  descriptor.enumerable === enumerable && descriptor.configurable === true;

export const observedCases = report => {
  const {cases, timers} = report.stages;
  return {...cases.url, ...cases.searchParams, ...cases.abort, ...cases.encoding, ...cases.decoder, ...(timers?.done === true ? timers.results : {})};
};

// Every verdict the probe gives, derived again from the raw observations of a report, from RN, from Node and from the pinned Hermes, in the probe's order.
export function derivedChecks(report, x) {
  const {mount, host, first, environment: env, network: net, stop} = report.stages;
  const observed = observedCases(report);
  const rows = [];
  const row = (name, passed) => rows.push({name, passed});
  const abortError = {resolved: false, error: {name: x.facts.fetch.abortName, message: x.facts.fetch.abortMessage, isError: true}};
  row("report/The expectation file the cases are judged against is there", true);
  row("mount/A root mounts through the original AppRegistry in the Hermes application the bundle ran in",
    mount.application.rootCount === 1 && mount.surfaceId > 0 && mount.application.errors.length === 0);
  row("host/The host defines none of URL, URLSearchParams, AbortController, AbortSignal and TextDecoder, and the engine defines TextEncoder, atob and btoa, before the first line of the bundle",
    host.URL === "undefined" && host.URLSearchParams === "undefined" && host.AbortController === "undefined" && host.AbortSignal === "undefined" &&
      host.TextDecoder === "undefined" && host.DOMException === "undefined" && host.TextEncoder === "function" && host.atob === "function" && host.btoa === "function");
  row("first/When the first module of the bundle runs, RN's polyfills have defined none of them, and the engine's encoders are still the engine's own functions",
    first.URL === "undefined" && first.URLSearchParams === "undefined" && first.AbortController === "undefined" && first.AbortSignal === "undefined" &&
      first.TextDecoder === "undefined" && first.TextEncoder === "function" && first.atob === "function" && first.btoa === "function" &&
      first.sameEncoder === true && first.sameAtob === true && first.sameBtoa === true);
  row("globals/URL, URLSearchParams and AbortSignal are lazy accessors that nothing had read, AbortController is the data property the accessor becomes once the renderer read it, and all four are data properties after",
    x.facts.rendererReadsAbortController && lazyNames.every(name => descriptorIs(env.lazyBefore[name], "accessor", null, true) && env.lazyBefore[name].setter === "function") &&
      descriptorIs(env.lazyBefore.AbortController, "data", true, true) && allFour.every(name => descriptorIs(env.lazyAfter[name], "data", true, true)));
  const identity = env.identity;
  row("globals/URL, URLSearchParams, AbortController and AbortSignal are the exports of the modules RN's setUpXHR names",
    x.facts.files.URL.export === "URL" && x.facts.files.URLSearchParams.export === "URLSearchParams" && x.facts.files.URL.file === x.facts.files.URLSearchParams.file &&
      x.facts.files.AbortController.export === "AbortController" && x.facts.files.AbortSignal.export === "AbortSignal_public" &&
      identity.urlIsModuleUrl === true && identity.searchParamsIsModuleSearchParams === true && identity.searchParamsModulesAgree === true &&
      identity.abortControllerIsModuleController === true && identity.abortSignalIsModulePublicSignal === true);
  row("globals/AbortSignal is RN's public wrapper over the class whose prototype every signal has, and URL's searchParams is a URLSearchParams",
    x.facts.signalPublicCopiesStatics && identity.publicSignalDiffersFromClass === true && identity.publicPrototypeIsClassPrototype === true &&
      identity.controllerSignalIsClassInstance === true && identity.controllerSignalIsPublicInstance === true && identity.urlSearchParamsIsUrlsOwn === true);
  row("globals/TextEncoder, atob and btoa are the engine's own functions, still non-enumerable data properties of the global object, and nothing in the bundle replaced them",
    ["TextEncoder", "atob", "btoa"].every(name => descriptorIs(env.encodingBefore[name], "data", true, false) && descriptorIs(env.encodingAfter[name], "data", true, false)) &&
      identity.engineEncoder === true && identity.engineAtob === true && identity.engineBtoa === true);
  row("globals/TextDecoder is not a property of the global object before or after the bundle", env.encodingBefore.TextDecoder === null && env.encodingAfter.TextDecoder === null);
  for (const group of x.groups) {
    row(group.check, group.ids.length > 0 && group.ids.every(id => id in observed && id in x.expected && matches(observed[id], x.expected[id])));
  }
  const holds = net.serverLog.holds ?? {};
  const recordsFor = prefix => (net.serverLog.records ?? []).filter(record => String(record.url).startsWith(prefix));
  const fetches = net.afterRelease.fetches;
  const controllers = net.afterRelease.controllers;
  row("network/fetch rejects with the AbortError whose message is Aborted when its signal aborts while the server holds the request, and the connection is closed",
    net.fetchAbort.held === true && net.fetchAbort.settled === true && net.fetchAbort.closed === true && same(fetches["wg-fetch"]?.outcome, abortError) &&
      controllers["wg-fetch"]?.signalEvents === 1 && controllers["wg-fetch"]?.abortedAtEvent === true && controllers["wg-fetch"]?.aborted === true &&
      holds["wg-fetch"] === "closed-by-client");
  row("network/fetch ignores the reason a caller gives abort(): it rejects with the same AbortError, and the signal keeps the caller's reason",
    net.reasonAbort.held === true && net.reasonAbort.settled === true && net.reasonAbort.closed === true && same(fetches["wg-reason"]?.outcome, abortError) &&
      controllers["wg-reason"]?.signalEvents === 1 && controllers["wg-reason"]?.reasonIsTheCallers === true && controllers["wg-reason"]?.reasonAtEvent === "Error" &&
      holds["wg-reason"] === "closed-by-client");
  row("network/A signal that is already aborted rejects fetch with the same AbortError, and no request reaches the server",
    net.abortedBefore.settled === true && same(fetches["wg-before"]?.outcome, abortError) && controllers["wg-before"]?.aborted === true &&
      recordsFor("/echo?case=wg-aborted-before").length === 0);
  row("network/A fetch that completed is not changed by aborting its signal afterwards",
    net.completed.settled === true && same(fetches["wg-done"]?.outcome, {resolved: true, status: 200}) && controllers["wg-done"]?.aborted === true &&
      controllers["wg-done"]?.signalEvents === 1 && recordsFor("/json?case=wg-completed").length === 1);
  const events = net.afterRelease.xhrs["wg-xhr"]?.events ?? [];
  const tail = events.slice(-3).map(event => [event.type, event.readyState, event.status]);
  row("network/An XMLHttpRequest aborted by its signal dispatches readystatechange, abort and loadend and never load or error, and the connection is closed",
    x.facts.xhr.readyStateDispatchesAbort && x.facts.xhr.abortCompletes && net.xhrAbort.held === true && net.xhrAbort.settled === true && net.xhrAbort.closed === true &&
      same(tail, [["readystatechange", 4, 0], ["abort", 4, 0], ["loadend", 4, 0]]) && same(tail.map(entry => entry[0]), x.facts.xhr.dispatchOrder) &&
      !events.some(event => ["load", "error", "timeout"].includes(event.type)) && controllers["wg-xhr"]?.signalEvents === 1 && holds["wg-xhr"] === "closed-by-client");
  row("network/After the server lets go, an aborted request delivers nothing more: each fetch settled once and the events of the XMLHttpRequest did not grow",
    same(net.beforeRelease.fetches, net.afterRelease.fetches) && same(net.beforeRelease.xhrs, net.afterRelease.xhrs) && same(net.beforeRelease.log, net.afterRelease.log) &&
      net.afterRelease.log.filter(entry => entry.event === "fetch").length === 4);
  row("lifecycle/Stop releases the root without a diagnostic", stop.application.stopped === true && stop.application.rootCount === 0 && stop.application.errors.length === 0);
  row("lifecycle/All native Controls of the root are balanced", stop.root.nativeTags === 0 && stop.root.creates === stop.root.deletes);
  row("report/The web globals report is saved with any normative failure visible", true);
  return rows;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------
// The report judged
// ------------------------------------------------------------------------------------------------------------------------------------------------

// The message of every error Hermes threw in the encoding and decoder cases, as the report recorded it: strings the pinned binary must hold.
function hermesMessages(report) {
  const messages = new Set();
  const collect = value => {
    if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (value !== null && typeof value === "object") {
      if (value.$ === "error") {
        messages.add(value.message);
      } else {
        Object.values(value).forEach(collect);
      }
    }
  };
  collect(report.stages.cases.encoding);
  return messages;
}

// The report judged against RN, Node and the pinned Hermes. It holds only for a report of the current SDK and the host in addons/: every derived verdict must be true and
// be the verdict the report gave, and every case must be what the expectation says.
export function verifyWebGlobalsReport(report, x, {serverLog} = {}) {
  const derived = derivedChecks(report, x);
  assert.deepEqual(derived.map(row => row.name), report.checks.map(row => row.name), "The oracle checks what the probe checks");
  const failing = derived.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual(failing, [], `The oracle fails ${failing.length} check(s), the first of them ${failing[0]}`);
  assert.deepEqual(derived, report.checks, "The oracle derives the verdicts the probe gave");
  const observed = observedCases(report);
  const missing = allCases.filter(entry => !(entry.id in observed)).map(entry => entry.id);
  assert.deepEqual(missing, [], "Every case ran in Hermes");
  const different = allCases.filter(entry => !matches(observed[entry.id], x.expected[entry.id])).map(entry => entry.id);
  assert.deepEqual(different, [], "Every case came out as the expectation says");
  // Hermes against V8, call by call, for the classes RN's JavaScript writes: the expectation is V8's answer, and the name-only rule is the only slack.
  for (const entry of reactNativeCases) {
    assert.ok(matches(observed[entry.id], entry.engineMessage ? stripMessages(x.reference.results[entry.id]) : x.reference.results[entry.id]), `${entry.id}: Hermes answers as V8 does`);
  }
  // The blob constants the reference ran with are the host's.
  assert.deepEqual(report.stages.environment.blobConstants, x.blobConstants, "The reference ran with the constants of the host's BlobModule");
  const blob = report.stages.environment.objectUrl;
  const prefix = `${x.blobConstants.BLOB_URI_SCHEME}:${typeof x.blobConstants.BLOB_URI_HOST === "string" ? `//${x.blobConstants.BLOB_URI_HOST}/` : ""}`;
  assert.equal(blob.url, `${prefix}${blob.blobId}?offset=${blob.offset}&size=${blob.size}`, "URL.createObjectURL of a real Blob follows RN's formula");
  // The decoder: RN's JavaScript does not mention it, and neither does any hermesvm binary of the pinned release.
  assert.deepEqual(x.facts.mentions.TextDecoder, [], "RN's Libraries and src do not mention TextDecoder");
  assert.deepEqual(x.facts.mentions.TextEncoder, [], "RN's Libraries and src do not mention TextEncoder");
  assert.deepEqual(x.facts.mentions.atob, [], "RN's Libraries and src do not mention atob");
  assert.deepEqual(x.facts.mentions.btoa, [], "RN's Libraries and src do not mention btoa");
  assert.ok(!x.facts.urlNotImplemented, "RN's URL has a member that throws \"not implemented\": the cases must cover it");
  assert.ok(x.facts.urlReexportsSearchParams && x.facts.searchParamsSort && x.facts.fetch.usesWhatwg && x.facts.fetch.listensToTheSignal && x.facts.fetch.abortsItsXhr &&
    x.facts.fetch.polyfillsDomException, "RN's sources say what the oracle reads of them");
  assert.ok(x.hermes.slices.length >= 1 && x.hermes.slices[0].file === x.hermes.host, "The host's hermesvm is scanned");
  for (const slice of x.hermes.slices) {
    assert.ok(slice.TextEncoder && slice.encodeInto && slice.atob && slice.btoa, `${slice.file} has TextEncoder, encodeInto, atob and btoa`);
    assert.ok(!slice.TextDecoder, `${slice.file} has no TextDecoder`);
  }
  assert.notEqual(x.hermes.pinnedMacosEqualsTheHost, false, "The hermesvm the host links is the pinned one");
  for (const message of hermesMessages(report)) {
    assert.ok(binaryHas(x.hermes.host, message), `Hermes' message "${message}" is a string of the pinned hermesvm`);
  }
  for (const piece of ["Property '", "' doesn't exist"]) {
    assert.ok(binaryHas(x.hermes.host, piece), `The ReferenceError for a missing global is built from the pinned hermesvm's own text: ${piece}`);
  }
  assert.deepEqual(x.shadow, [], "Nothing in src/, the toolchain or native/ defines a global of this slice");
  if (serverLog !== undefined) {
    assert.deepEqual(report.stages.network.serverLog.holds, serverLog.holds, "The server's final log agrees with the probe's");
  }
  return derived;
}

// The oracle's first complaint about a report whose checks all claim to pass, or null when it accepts it.
export function oracleRejection(report, x) {
  try {
    verifyWebGlobalsReport({...report, checks: report.checks.map(row => ({...row, passed: true}))}, x);
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

// The file of expectations, checked against what the oracle derives: the probe judges against it, so it must be RN's, Node's and Hermes' answers.
export function verifyExpectedFile(x) {
  assert.ok(existsSync(path.join(root, expectedFile)), `${expectedFile} is missing: node tests/web-globals-oracle.mjs --write-expected`);
  const written = JSON.parse(textOf(expectedFile));
  assert.ok(same(written, JSON.parse(JSON.stringify(expectedFileContent(x)))), `${expectedFile} is not what the oracle derives from RN, Node and the pinned Hermes: node tests/web-globals-oracle.mjs --write-expected`);
}

export const sha256Of = file => createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex");

// node tests/web-globals-oracle.mjs --write-expected [report.json]: writes the file of expectations from the oracle. The constants of the host's BlobModule come from a
// report of a run of the probe, or are the ones the host answers (blob:, no host) when there is none.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes("--write-expected")) {
  const reportFile = process.argv.find(argument => argument.endsWith(".json"));
  const constants = reportFile === undefined ? {BLOB_URI_HOST: null, BLOB_URI_SCHEME: "blob"} : JSON.parse(readFileSync(reportFile, "utf8")).stages.environment.blobConstants;
  const expectations = await webGlobalsExpectations(constants);
  writeFileSync(path.join(root, expectedFile), JSON.stringify(expectedFileContent(expectations), null, 1) + "\n");
  console.log(`WEB_GLOBALS_EXPECTED_WRITTEN: ${Object.keys(expectations.expected).length} cases, ${expectations.groups.length} groups`);
}
