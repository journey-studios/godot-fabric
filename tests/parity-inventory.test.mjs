import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const inventory = JSON.parse(readFileSync(new URL("../docs/compatibility/contracts-0.87.1.json", import.meta.url)));
const row = (id) => inventory.contracts.find((contract) => contract.id === id);
const upstream = fileURLToPath(new URL("../node_modules/react-native/", import.meta.url));
const upstreamText = (file) => readFileSync(path.join(upstream, file), "utf8");
const rowsOf = (kind) => inventory.contracts.filter((contract) => contract.kind === kind);
const scanned = inventory.upstreamFiles.map((entry) => entry.file).filter((file) => /^(Libraries|src)\/.*\.js$/.test(file));
const sorted = (values) => [...values].sort();
const escaped = (name) => name.replaceAll("$", "\\$");

test("inventory resolves inherited contracts and retains overloads, without claiming coverage", () => {
  assert.equal(inventory.counts.value, 97);
  assert.equal(new Set(inventory.contracts.map((contract) => contract.id)).size, inventory.contracts.length);
  for (const id of ["event:ViewProps.onLayout", "prop:TextInputProps.value", "style:TextStyle.fontSize", "style:ViewStyle.flexDirection", "ref-member:ViewInstance.measure", "api-member:AccessibilityInfo.announceForAccessibility", "global-value:global.setTimeout"]) {
    assert.ok(row(id), id);
    assert.notEqual(row(id).type, "any", id);
    assert.equal(row(id).status, undefined, "Declaration presence must not imply behavioral success");
  }
  assert.match(row("global-value:global.setTimeout").type, /\{.*;.*\}/);
  assert.ok(inventory.upstreamFiles.length > 100);
  assert.equal(row("global-member:Request.cache"), undefined, "Browser members must not become RN contracts");
  assert.ok(row("global-member:FormData.append"));
  assert.ok(row("global-member:AbortController.abort"));
  assert.ok(row("global-type:global.FormData"));
});

test("the check rejects drift and preserves the reviewed inventory", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "fabric-inventory-"));
  try {
    const file = path.join(directory, "inventory.json");
    writeFileSync(file, JSON.stringify({ ...inventory, contracts: inventory.contracts.slice(1) }));
    const before = readFileSync(file, "utf8");
    const result = spawnSync(process.execPath, ["scripts/parity-inventory.mjs", "--check", "--output", file], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /Parity inventory drift/);
    assert.equal(readFileSync(file, "utf8"), before);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the format is versioned, ordered and keeps the old row shape except for the platform marker", () => {
  assert.equal(inventory.schemaVersion, 2);
  const ids = inventory.contracts.map((contract) => contract.id);
  assert.deepEqual(ids, sorted(ids), "rows are sorted by id");
  assert.equal(new Set(ids).size, ids.length);
  const counts = {};
  for (const contract of inventory.contracts) {
    counts[contract.kind] = (counts[contract.kind] || 0) + 1;
  }
  assert.deepEqual(inventory.counts, Object.fromEntries(Object.entries(counts)));
  for (const kind of ["runtime-global", "host-global", "native-command"]) {
    assert.ok(inventory.counts[kind] > 0, kind);
  }
  const oldKeys = new Set(["id", "kind", "owner", "name", "type", "source"]);
  for (const contract of inventory.contracts) {
    const extra = Object.keys(contract).filter((key) => !oldKeys.has(key));
    if (["runtime-global", "host-global", "native-command"].includes(contract.kind)) {
      continue;
    }
    for (const key of extra) {
      assert.ok(["platformImplementation", "platformEvidence"].includes(key) && ["value", "api-member"].includes(contract.kind), `${contract.id} has ${key}`);
    }
  }
});

test("runtime globals are what the setUp chain installs, under the conditions RN writes", () => {
  const rows = rowsOf("runtime-global");
  const chain = inventory.derivation.runtimeGlobals.chain;
  const installers = chain.filter((entry) => entry.role === "installer");
  // The chain: every setUp or polyfill module the entry function requires is an installer, read here without the parser.
  const entry = upstreamText("src/private/setup/setUpDefaultReactNativeEnvironment.js");
  for (const [, specifier] of entry.matchAll(/require\('([^']*(?:setUp|polyfill)[^']*)'\)/g)) {
    const base = path.posix.basename(specifier);
    assert.ok(installers.some((installer) => path.posix.basename(installer.file, ".js") === base), `${specifier} is an installer`);
  }
  assert.ok(chain.some((item) => item.file === "Libraries/ReactNative/AppRegistry.js"), "AppRegistry installs RN$AppRegistry when the entry requires it");
  for (const item of chain) {
    const sites = rows.flatMap((contract) => contract.sites).filter((site) => site.source === item.file);
    assert.equal(sites.length, item.installs, item.file);
    for (const site of sites) {
      assert.equal(site.installer, item.installer ?? item.file);
      assert.deepEqual(site.gates.slice(0, item.gates.length), item.gates, `${item.file}: the installer's own gates come first`);
    }
  }
  // An independent oracle: the names each file writes, found by text, equal the rows whose sites sit in that file.
  const written = (text) => new Set([
    ...[...text.matchAll(/polyfillGlobal\(\s*'([^']+)'/g)].map((match) => match[1]),
    ...[...text.matchAll(/defineLazyTimer\('([^']+)'\)/g)].map((match) => match[1]),
    ...[...text.matchAll(/\bglobal(?:This)?\.([A-Za-z_$][\w$]*)\s*=[^=]/g)].map((match) => match[1]),
    ...[...text.matchAll(/Object\.defineProperty\(\s*(?:global|globalThis),\s*'([^']+)'/g)].map((match) => match[1]),
  ]);
  for (const item of chain.filter((candidate) => candidate.installs > 0)) {
    const own = rows.filter((contract) => contract.owner === "global" && contract.sites.some((site) => site.source === item.file && !site.prefixedBy));
    assert.deepEqual(sorted(own.map((contract) => contract.name)), sorted(written(upstreamText(item.file))), item.file);
  }
  for (const contract of rows) {
    assert.match(contract.id, /^runtime-global:/);
    assert.equal(contract.id, `runtime-global:${contract.owner}.${contract.name}`);
    assert.equal(contract.source, contract.sites[0].source);
    assert.equal(contract.installer, contract.sites[0].installer);
    assert.ok(contract.sites.length > 0 && contract.sites.every((site) => ["polyfillGlobal", "polyfillObjectProperty", "defineProperty", "assignment"].includes(site.form)), contract.id);
    assert.ok(installers.some((installer) => installer.file === contract.installer), `${contract.id}: installer is in the chain`);
  }
  // Names, forms and conditions pinned by the files themselves (the Metro-prefixed ones carry their prefix).
  const names = (owner) => rows.filter((contract) => contract.owner === owner).map((contract) => contract.name);
  for (const name of ["performance", "navigator", "process", "alert", "fetch", "URL", "Blob", "WebSocket", "regeneratorRuntime", "__fetchSegment", "setTimeout", "queueMicrotask", "RN$AppRegistry"]) {
    assert.ok(names("global").includes(name), name);
  }
  assert.deepEqual(names("navigator"), ["product"]);
  assert.deepEqual(sorted(names("process")), ["env"]);
  assert.deepEqual(names("process.env"), ["NODE_ENV"]);
  assert.deepEqual(row("runtime-global:global.setTimeout").sites.map((site) => site.gates), [["!(global.RN$Bridgeless === true)"]]);
  assert.deepEqual(row("runtime-global:global.queueMicrotask").sites.map((site) => site.gates),
    [["global.RN$Bridgeless === true"], ["!(global.RN$Bridgeless === true)"]]);
  assert.deepEqual(row("runtime-global:global.performance").sites.map((site) => site.source),
    ["Libraries/Core/setUpPerformance.js", "src/private/setup/setUpPerformanceModern.js"]);
  assert.deepEqual(row("runtime-global:global.performance").sites[1].gates, ["NativePerformance"]);
  assert.deepEqual(row("runtime-global:global.alert").sites[0].gates, ["!global.alert"]);
  assert.equal(row("runtime-global:global.RN$AppRegistry").installer, "Libraries/ReactNative/AppRegistry.js");
  assert.match(row("runtime-global:global.IntersectionObserver").sites[0].gates[0], /enableIntersectionObserverByDefault/);
  assert.equal(row("runtime-global:global.__FUSEBOX_REACT_DEVTOOLS_DISPATCHER__").sites[0].gates[0], "__DEV__ && enableDeveloperTools");
  for (const name of ["__loadBundleAsync", "__ReactRefresh"]) {
    const prefixed = row(`runtime-global:global.${name}`);
    assert.equal(prefixed.sites[0].prefixedBy, "__METRO_GLOBAL_PREFIX__");
    assert.ok(upstreamText(prefixed.source).includes(name));
  }
  // Installs the chain does not run are recorded, not rows.
  const outside = inventory.derivation.runtimeGlobals.outsideChain.map((item) => item.id);
  assert.ok(outside.includes("runtime-global:global.__fbBatchedBridge") && outside.includes("runtime-global:global.RN$stopSurface"));
  assert.ok(outside.every((id) => row(id) === undefined));
});

test("host globals are the names RN's JS reads, does not install, and the host naming rule or the allow-list admits", () => {
  const rows = rowsOf("host-global");
  const { allowList, freeIdentifierReads, excluded } = inventory.derivation.hostGlobals;
  const allowed = new Set(allowList.map((item) => item.name));
  const readPattern = (name) => new RegExp(`\\b(?:global|globalThis)(?:\\.${escaped(name)}\\b|\\[['"]${escaped(name)}['"]\\])`);
  const installPattern = (name) => new RegExp(`\\b(?:global|globalThis)\\.${escaped(name)}\\s*=[^=]|defineProperty\\(\\s*(?:global|globalThis),\\s*'${escaped(name)}'|polyfillGlobal\\(\\s*'${escaped(name)}'|defineLazyTimer\\('${escaped(name)}'\\)`);
  const runtimeNames = new Set(rowsOf("runtime-global").filter((contract) => contract.owner === "global").map((contract) => contract.name));
  assert.ok(rows.length > 30);
  for (const contract of rows) {
    assert.equal(contract.id, `host-global:global.${contract.name}`);
    assert.equal(contract.owner, "global");
    assert.ok(/^(native[A-Z]|RN\$|__)/.test(contract.name) || allowed.has(contract.name), `${contract.name} follows the rule or is listed`);
    assert.ok(!runtimeNames.has(contract.name), `${contract.name} is installed by RN`);
    assert.ok(Number.isInteger(contract.readers) && contract.readers >= 1, contract.name);
    const free = freeIdentifierReads.includes(contract.name);
    const reading = scanned.filter((file) => (free ? new RegExp(`\\b${escaped(contract.name)}\\b`) : readPattern(contract.name)).test(upstreamText(file)));
    assert.ok(reading.includes(contract.source), `${contract.name} is read in ${contract.source}`);
    assert.ok(reading.length >= contract.readers, `${contract.name}: the readers the parser found are files that mention it`);
    assert.ok(scanned.every((file) => !installPattern(contract.name).test(upstreamText(file))), `${contract.name} is installed by some RN file`);
  }
  for (const item of allowList) {
    assert.ok(item.reason.length > 20, item.name);
    assert.ok(row(`host-global:global.${item.name}`), `${item.name} is read by RN's JS`);
  }
  for (const name of ["nativeFabricUIManager", "nativeModuleProxy", "__turboModuleProxy", "RN$Bridgeless", "RN$registerCallableModule", "HermesInternal", "__DEV__", "nativePerformanceNow"]) {
    assert.ok(row(`host-global:global.${name}`), name);
  }
  assert.match(row("host-global:global.nativeFabricUIManager").type, /free identifier read, global member read/);
  assert.equal(row("host-global:global.performance"), undefined);
  assert.equal(row("host-global:global.__fbGenNativeModule"), undefined, "RN installs it outside the setup chain");
  for (const item of excluded) {
    assert.ok(item.reason.length > 10 && !row(`host-global:global.${item.name}`), item.name);
  }
  assert.ok(excluded.some((item) => item.name === "ArrayBuffer") && excluded.some((item) => item.name === "navigator"));
});

test("native commands are the supportedCommands of every codegenNativeCommands call, typed from the Commands interface", () => {
  const rows = rowsOf("native-command");
  const callers = scanned.filter((file) => file !== "Libraries/Utilities/codegenNativeCommands.js" && upstreamText(file).includes("codegenNativeCommands<"));
  assert.deepEqual(sorted(inventory.derivation.nativeCommands.callSites.map((site) => site.source)), sorted(callers));
  assert.ok(callers.length >= 12);
  for (const file of callers) {
    const text = upstreamText(file);
    const list = /supportedCommands:\s*\[([^\]]*)\]/.exec(text)[1];
    const commands = [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    const owner = path.posix.basename(file, ".js");
    assert.deepEqual(sorted(rows.filter((contract) => contract.source === file).map((contract) => contract.name)), sorted(commands), file);
    for (const contract of rows.filter((candidate) => candidate.source === file)) {
      assert.equal(contract.owner, owner);
      assert.equal(contract.id, `native-command:${owner}.${contract.name}`);
      assert.match(contract.type, /^\(viewRef: .+\) => void$/, contract.id);
    }
  }
  assert.equal(row("native-command:ViewNativeComponent.focus").type, "(viewRef: HostInstance) => void");
  assert.equal(row("native-command:ViewNativeComponent.hotspotUpdate").type, "(viewRef: HostInstance, x: number, y: number) => void");
  assert.equal(row("native-command:ScrollViewCommands.scrollTo").type,
    "(viewRef: React.ElementRef<ScrollViewNativeComponentType>, x: Double, y: Double, animated: boolean) => void");
  // The three TextInput components share one generic interface; each substitutes its own native type.
  assert.equal(row("native-command:RCTSingelineTextInputNativeComponent.setTextAndSelection").type,
    "(viewRef: React.ElementRef<NativeType>, mostRecentEventCount: Int32, value: ?string, start: Int32, end: Int32) => void");
  assert.equal(row("native-command:SwitchNativeComponent.setValue").source, "src/private/components/switch/specs/SwitchNativeComponent.js");
  for (const owner of ["ImageViewNativeComponent", "AndroidTextInputNativeComponent", "RCTMultilineTextInputNativeComponent"]) {
    assert.ok(rows.some((contract) => contract.owner === owner), owner);
  }
});

test("the platform marker is mechanical: implementation files next to the module, or a name that says so", () => {
  const values = new Map(rowsOf("value").map((contract) => [contract.name, contract]));
  const expected = (declaration, names) => {
    const module = declaration.slice("types_generated/".length, -".d.ts".length);
    const platforms = new Set();
    const evidence = [];
    for (const platform of ["android", "ios"]) {
      if (existsSync(path.join(upstream, `${module}.${platform}.js`))) {
        platforms.add(platform);
        evidence.push(`${module}.${platform}.js`);
      }
    }
    for (const name of names) {
      if (name.endsWith("IOS")) {
        platforms.add("ios");
        evidence.push(`${name} ends with IOS`);
      } else if (name.endsWith("Android")) {
        platforms.add("android");
        evidence.push(`${name} ends with Android`);
      }
    }
    return platforms.size ? { platformImplementation: sorted(platforms), platformEvidence: evidence } : {};
  };
  const markers = (contract) => ({
    ...(contract.platformImplementation ? { platformImplementation: contract.platformImplementation } : {}),
    ...(contract.platformEvidence ? { platformEvidence: contract.platformEvidence } : {}),
  });
  const marked = { value: 0, "api-member": 0 };
  for (const contract of inventory.contracts) {
    const owner = contract.kind === "value" ? contract : contract.kind === "api-member" ? values.get(contract.owner) : undefined;
    if (!owner) {
      assert.deepEqual(markers(contract), {}, `${contract.id} is not an OS API row`);
      continue;
    }
    const names = owner === contract ? [contract.name] : [owner.name, contract.name];
    assert.deepEqual(markers(contract), expected(owner.source, names), contract.id);
    if (contract.platformImplementation) {
      marked[contract.kind]++;
      assert.ok(contract.platformEvidence.length > 0 && contract.platformImplementation.every((platform) => ["android", "ios"].includes(platform)));
    }
  }
  assert.deepEqual(marked, inventory.derivation.platformImplementation.marked);
  assert.ok(marked.value >= 10 && marked["api-member"] > marked.value);
  assert.deepEqual(row("value:react-native.Platform").platformImplementation, ["android", "ios"]);
  assert.deepEqual(row("value:react-native.ActionSheetIOS").platformImplementation, ["ios"]);
  assert.deepEqual(row("value:react-native.ActionSheetIOS").platformEvidence, ["ActionSheetIOS ends with IOS"]);
  assert.deepEqual(row("value:react-native.ProgressBarAndroid").platformImplementation, ["android"]);
  assert.deepEqual(row("api-member:Platform.OS").platformImplementation, ["android", "ios"]);
  // Not an applicability decision: a module with neither file and no suffix stays unmarked even when RN documents it as OS-bound.
  assert.equal(row("value:react-native.Alert").platformImplementation, undefined);
  assert.equal(row("value:react-native.TouchableNativeFeedback").platformImplementation, undefined);
});

test("regenerating twice gives the same bytes as the checked-in inventory", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "fabric-inventory-"));
  try {
    const outputs = ["first.json", "second.json"].map((name) => path.join(directory, name));
    for (const output of outputs) {
      const result = spawnSync(process.execPath, ["scripts/parity-inventory.mjs", "--output", output], { encoding: "utf8", timeout: 60000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    const [first, second] = outputs.map((output) => readFileSync(output));
    assert.ok(first.equals(second), "two runs differ");
    assert.ok(first.equals(readFileSync(new URL("../docs/compatibility/contracts-0.87.1.json", import.meta.url))), "the checked-in inventory is stale");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the status board counts every export form the facade can use", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "fabric-status-"));
  try {
    mkdirSync(path.join(directory, "docs/compatibility"), { recursive: true });
    mkdirSync(path.join(directory, "src"));
    writeFileSync(path.join(directory, "docs/compatibility/contracts-0.87.1.json"), readFileSync(new URL("../docs/compatibility/contracts-0.87.1.json", import.meta.url)));
    writeFileSync(path.join(directory, "src/react-native-platform.jsx"), [
      'export { default as Animated } from "./animated";',
      'export { AppState, Appearance } from "./environment";',
      'export * as TurboModuleRegistry from "./registry";',
      "export function View() { return null; }",
      "export class Pressable {}",
      "export const Text = () => null;",
      'export const Image = unavailable("Image");',
    ].join("\n"));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/parity-status.mjs", import.meta.url))], { cwd: directory, encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(readFileSync(path.join(directory, "build/parity-status.json"), "utf8"));
    const status = Object.fromEntries(report.exports.map((entry) => [entry.name, entry.status]));
    for (const name of ["Animated", "AppState", "Appearance", "TurboModuleRegistry", "View", "Pressable", "Text"]) assert.equal(status[name], "exported_unverified", name);
    assert.equal(status.Image, "explicit_placeholder");
    assert.equal(status.Switch, "missing");
    assert.deepEqual(report.facadeNames, { exported_unverified: 7, explicit_placeholder: 1, missing: 89 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
