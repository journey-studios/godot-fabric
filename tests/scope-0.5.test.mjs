import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {build} from "esbuild";
import {parseSync, transformFromAstSync} from "@babel/core";
import platformBaseViewConfig, {controlViewConfig} from "../src/base-view-config.js";
import {validateImageProps} from "../src/image-contract.mjs";
import {checkProps, declaredProps, legacyProps, probeValue, propTable, refusalMessage, refusalTable, refuses, scope, scopedComponents}
  from "../src/prop-scope.mjs";
import {describeComponents, renderManifest} from "../scripts/scope-manifest.mjs";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";
import {renderTypeFixture, writeTypeFixture} from "./scope-0.5-types.mjs";

// The JS lane of the 0.5 scope (milestone 0.5, item V05-04): the manifest of the thirteen names, the prop policy of src/prop-scope.mjs
// against the inventory, the view configs and RN's iOS sources, the generated type fixture, and the runtime members of the
// utilities. The native lane (tests/scope-0.5-native.test.mjs) drives the same tables through the real host.
const root = fileURLToPath(new URL("../", import.meta.url));
const requireSdk = createRequire(path.join(root, "package.json"));
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const json = file => JSON.parse(read(file));
const manifest = json("docs/compatibility/scope-0.5.json");
const inventory = json("docs/compatibility/contracts-0.87.1.json");
const audit = json("docs/compatibility/react-native-0.87.1.json");
const rnRoot = path.join(root, "node_modules");
const thirteen = ["View", "Text", "Pressable", "ScrollView", "Image", "Modal", "ActivityIndicator", "SafeAreaView", "StyleSheet", "Platform",
  "Dimensions", "useWindowDimensions", "AppState"];
// SafeAreaView's props are ViewProps: it takes no table of its own and is judged by the View's.
const sharedTable = {SafeAreaView: "View"};
const decisions = ["supported", "ignored", "refused"];
const declaredNames = owner => new Set(inventory.contracts.filter(row => row.owner === owner && (row.kind === "prop" || row.kind === "event"))
  .map(row => row.name));
const sourceFile = source => path.join(/^@?react-native\//.test(source) ? rnRoot : root, source);
// A name as a word of a source: letters, digits, underscore and hyphen, so that `aria-live` is one word.
const wordsOf = source => new Set(fs.readFileSync(sourceFile(source), "utf8").match(/[\w-]+/g));
const effective = (entry, name) => entry.via?.[name] ?? name;

test("the manifest decides exactly thirteen names, each with its audit row as recorded and its evidence", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual([manifest.milestone, manifest.item, manifest.reactNative], ["0.5", "V05-04", "0.87.1"]);
  assert.deepEqual(manifest.names.map(row => row.name), thirteen);
  assert.deepEqual(Object.keys(manifest.decisions).sort(), ["documented-ignore", "explicit-error", "supported"]);
  for (const row of manifest.names) {
    assert.ok(Object.hasOwn(manifest.decisions, row.decision), `${row.name} has a valid decision`);
    // The audit's row, exactly as the dated snapshot records it, and never edited by this manifest.
    const recorded = audit.exports.find(entry => entry.name === row.name);
    const {file, auditDate, sourceCommit, ...rest} = row.audit;
    assert.deepEqual([file, auditDate, sourceCommit], ["docs/compatibility/react-native-0.87.1.json", audit.auditDate, audit.sourceCommit], row.name);
    assert.deepEqual(rest, recorded, row.name);
    assert.equal(typeof row.auditStale.stale, "boolean", row.name);
    assert.ok(!row.auditStale.stale || row.auditStale.current.length > 0, `${row.name} says what is current when its audit row is stale`);
    for (const file of [...row.facade, ...row.evidence]) {
      assert.ok(fs.existsSync(path.join(root, file)), `${row.name}: ${file} exists`);
    }
    assert.ok(row.runtime.length > 0, row.name);
  }
  // The audit's rows that are stale in the way the brief records.
  assert.deepEqual(manifest.names.filter(row => row.auditStale.stale).map(row => row.name).sort(), ["ActivityIndicator", "AppState", "Image", "Modal", "SafeAreaView"]);
  // PR #58 landed: the ScrollView is classified like the other six, and nothing in the manifest waits on another change.
  assert.deepEqual(manifest.names.filter(row => row.pendingOn !== undefined).map(row => row.name), []);
  assert.deepEqual(Object.keys(manifest.notInTheManifest).sort(), ["FlatList", "PixelRatio"]);
  assert.ok(manifest.outOfScope.some(text => /TextInput/.test(text)) && manifest.outOfScope.some(text => /hover/.test(text)));
  assert.match(manifest.rule, /neither/);
  // The seven components of the prop policy point at their tables, and the SafeAreaView at the View's.
  for (const row of manifest.names.filter(entry => entry.props !== null)) {
    const table = sharedTable[row.name] ?? row.name;
    assert.ok(scopedComponents.includes(table) && row.props === `components.${table}`, row.name);
  }
  assert.deepEqual(manifest.names.filter(entry => entry.props !== null && sharedTable[entry.name] === undefined).map(entry => entry.name).sort(),
    [...scopedComponents].sort());
  assert.deepEqual(manifest.names.filter(entry => sharedTable[entry.name] !== undefined).map(entry => entry.name), ["SafeAreaView"]);
  assert.equal(scopedComponents.length, 7);
});

test("every prop that RN declares for the seven components is classified exactly once", () => {
  assert.deepEqual(scopedComponents, ["View", "Text", "Pressable", "Image", "Modal", "ActivityIndicator", "ScrollView"]);
  for (const component of scopedComponents) {
    const declared = declaredNames(scope[component].owner);
    assert.ok(declared.size > 50, `${component}: the inventory has the owner rows of ${scope[component].owner}`);
    const classified = scope[component].rules.flatMap(rule => rule.names);
    // exactly once: no name twice (the module also throws when it loads), no declared name missing, none invented
    assert.equal(new Set(classified).size, classified.length, `${component}: a name is classified twice`);
    assert.deepEqual([...classified].sort(), [...declared].sort(), component);
    assert.deepEqual([...propTable(component).keys()].sort(), [...declared].sort(), component);
    for (const rule of scope[component].rules) {
      assert.ok(decisions.includes(rule.decision), `${component}: ${rule.names[0]}`);
      assert.ok(rule.names.length > 0);
    }
    const counts = Object.fromEntries(decisions.map(decision => [decision,
      [...propTable(component).values()].filter(entry => entry.decision === decision).length]));
    assert.equal(counts.supported + counts.ignored + counts.refused, declared.size, component);
  }
  // The props a list hands to the ScrollView and RN does not declare for it are not part of that classification: the lists declare
  // them, the ScrollView does not, and the table of the component does not hold them.
  const listed = scope.ScrollView.listRules.flatMap(rule => rule.names);
  assert.deepEqual(listed.sort(), ["onRefresh", "refreshing"]);
  for (const name of listed) {
    assert.ok(!declaredNames("ScrollViewProps").has(name) && !propTable("ScrollView").has(name), `ScrollView does not declare ${name}`);
    assert.ok(declaredNames("FlatListProps").has(name) && refusalTable("ScrollView").has(name), `FlatList declares ${name} and the ScrollView refuses it`);
  }
});

test("every ignored and refused prop has a reason, a basis and sources that exist and say what they are cited for", () => {
  const iosBase = wordsOf("react-native/Libraries/NativeComponent/BaseViewConfig.ios.js");
  const androidFacts = wordsOf("react-native/ReactCommon/react/renderer/components/view/platform/android/react/renderer/components/view/HostPlatformViewProps.cpp");
  const iosView = wordsOf("react-native/React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm");
  const ignoredBases = ["ios-drops", "ios-noop", "android-native", "not-forwarded", "overwritten", "dependent", "decision"];
  for (const component of scopedComponents) {
    for (const rule of [...scope[component].rules, ...(scope[component].listRules ?? [])]) {
      if (rule.decision === "supported") {
        assert.ok(rule.how === "host" || rule.how === "js", `${component}.${rule.names[0]} says how it has behavior`);
        continue;
      }
      assert.ok(rule.reason?.length > 10, `${component}.${rule.names[0]} has a reason`);
      assert.ok(Array.isArray(rule.source) && rule.source.length > 0, `${component}.${rule.names[0]} cites a source`);
      for (const source of rule.source) {
        assert.ok(fs.existsSync(sourceFile(source)), `${component}.${rule.names[0]}: ${source} exists`);
      }
      assert.ok((rule.decision === "ignored" ? ignoredBases : ["ios", "decision"]).includes(rule.basis), `${component}.${rule.names[0]}: ${rule.basis}`);
      const citedWords = rule.source.filter(source => /^@?react-native\//.test(source)).map(wordsOf);
      for (const name of rule.names) {
        const final = effective(rule, name);
        if (rule.decision === "refused" && rule.basis === "ios") {
          // iOS has behavior for it: the name the host would finally get is in a source the rule cites.
          assert.ok(citedWords.some(words => words.has(final)), `${component}.${name}: ${final} is in a cited iOS source`);
        }
        if (rule.decision === "ignored" && rule.basis === "ios-drops" && rule.source.includes("react-native/Libraries/NativeComponent/BaseViewConfig.ios.js")) {
          assert.ok(!iosBase.has(final), `${component}.${name}: iOS's view config does not list ${final}`);
        }
        if (rule.decision === "ignored" && rule.basis === "android-native") {
          assert.ok(androidFacts.has(final) && !iosView.has(final), `${component}.${name}: only the Android host props read ${final}`);
        }
        if (rule.decision === "ignored" && rule.basis === "overwritten") {
          assert.ok(rule.source.some(source => wordsOf(source).has(final)), `${component}.${name}: ${rule.source} replaces ${final}`);
        }
        if (rule.decision === "ignored" && rule.basis === "not-forwarded") {
          // The RN component never reads it from its props (it may use the same word for a prop of its own host component).
          const read = new RegExp(`props\\.${final.replace(/[-]/g, "\\-")}\\b|props\\[["']${final}["']\\]`);
          assert.ok(rule.source.every(source => !read.test(fs.readFileSync(sourceFile(source), "utf8"))), `${component}.${name}: ${rule.source} never reads ${final} from its props`);
        }
      }
    }
  }
});

// The generated view configs of RN's host components, built over the base view config of the platform: what the host is
// told about. The registration names of the events count as names of the config, as they do for RN's dispatch.
const hostHandle = {RN$Bridgeless: true, RN$registerCallableModule() {}, nativeModuleProxy: {
  SourceCode: {getConstants: () => ({scriptURL: "file:///unit-fixture.js"})},
  DeviceInfo: {getConstants: () => ({Dimensions: {
    window: {width: 800, height: 600, scale: 2, fontScale: 1}, screen: {width: 900, height: 700, scale: 2, fontScale: 1}}})},
}};
hostHandle.global = hostHandle;
const plugins = () => [platformPlugin(path.join(root, "src"), id => requireSdk.resolve(id))];
async function bundleEntry(t, source, options = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "godot-scope-")));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  fs.writeFileSync(path.join(directory, "App.js"), source);
  return build({absWorkingDir: directory, entryPoints: ["App.js"], bundle: true, write: false, format: "cjs", platform: "neutral",
    mainFields: ["main"], define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"}, metafile: true,
    plugins: [{name: "scope-boundaries", setup(builder) {
      // The legacy UIManager is never read by the static view config path.
      builder.onLoad({filter: /\/src\/ui-manager\.js$/}, () => ({loader: "js", contents:
        'export default new Proxy({}, {get(_, name) { throw new Error("legacy UIManager." + String(name)); }});'}));
    }}, ...plugins()], ...options});
}
const run = (result, globals = {}) => {
  const module = {exports: {}};
  vm.runInNewContext(result.outputFiles[0].text, {module, exports: module.exports, ...globals});
  return module.exports;
};
function hostNames(config) {
  const names = new Set(Object.keys(config.validAttributes));
  for (const type of Object.values(config.bubblingEventTypes ?? {})) {
    for (const registration of Object.values(type.phasedRegistrationNames ?? {})) {
      if (typeof registration === "string") {
        names.add(registration);
      }
    }
  }
  for (const type of Object.values(config.directEventTypes ?? {})) {
    if (type.registrationName !== undefined) {
      names.add(type.registrationName);
    }
  }
  return names;
}
const baseNames = hostNames(platformBaseViewConfig);
const controlNames = hostNames(controlViewConfig);

test("the supported props agree with the view configs the host is given, in both directions", async t => {
  const result = await bundleEntry(t, [
    'import "react-native/Libraries/Components/View/ViewNativeComponent";',
    'import "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent";',
    'import "react-native/Libraries/Text/TextNativeComponent";',
    'import "react-native/Libraries/Image/ImageViewNativeComponent";',
    'import "react-native/Libraries/Components/ActivityIndicator/ActivityIndicatorViewNativeComponent";',
    'import "react-native/Libraries/Modal/RCTModalHostViewNativeComponent";',
    // the platform's own addition to the registered config (horizontal), which the ScrollView's host depends on
    `import ${JSON.stringify(path.join(root, "src/scroll-view-native-config.js"))};`,
    'export {get as viewConfig} from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";'].join("\n"));
  const {viewConfig} = run(result, {global: hostHandle, ...hostHandle});
  const classes = {View: "RCTView", Text: "RCTText", Image: "RCTImageView", ActivityIndicator: "RCTActivityIndicatorView", Modal: "RCTModalHostView",
    ScrollView: "RCTScrollView"};
  const configs = {Pressable: controlViewConfig, ...Object.fromEntries(Object.entries(classes).map(([component, name]) => [component, viewConfig(name)]))};
  // The RN configs are built over the platform's base config: its names are in every one of them.
  for (const [component, config] of Object.entries(configs)) {
    if (component !== "Pressable") {
      assert.ok([...baseNames].filter(name => name !== "style").every(name => hostNames(config).has(name)), `${component}'s config has the base names`);
    }
  }
  // Direction one: a prop the table says reaches the host is in the config of the component, under the name RN's JS finally sends.
  for (const component of scopedComponents) {
    for (const [name, entry] of propTable(component)) {
      if (entry.decision === "supported" && entry.how === "host") {
        const final = effective(entry, name);
        assert.ok(hostNames(configs[component]).has(final), `${component}.${name}: ${final} is in the view config`);
      }
    }
  }
  // Direction two: a declared name that the platform's own configs list, under the name RN's JS finally sends, is supported.
  // The Pressable renders the host's Control, whose config also lists the events of the Control's inputs: onFocus and onBlur
  // are ignored for a Pressable (nothing emits them, because no View of this host takes focus), not supported.
  const allowed = {Pressable: ["onFocus", "onBlur"]};
  for (const component of ["View", "Text", "Pressable", "Image", "ActivityIndicator", "ScrollView"]) {
    const names = component === "Pressable" ? controlNames : baseNames;
    for (const [name, entry] of propTable(component)) {
      if (names.has(effective(entry, name)) && !allowed[component]?.includes(name)) {
        assert.equal(entry.decision, "supported", `${component}.${name} reaches the host through ${effective(entry, name)}, so it is supported`);
      }
    }
  }
  // The names of RN's own host configs that the host would receive and the tables keep out of the supported set: the Image
  // config lists defaultSource and internal_analyticTag (decisions), the Text config lists the props the paragraph refuses or
  // ignores, and the Modal config lists what Modal.js sends (orientation, dismissal and the Android flags are refused).
  const imageOnly = [...hostNames(configs.Image)].filter(name => propTable("Image").has(name) && propTable("Image").get(name).decision !== "supported");
  assert.deepEqual(imageOnly.filter(name => !baseNames.has(name)).sort(), ["defaultSource", "internal_analyticTag"]);
});

test("the Text and Image decisions in the tables are the decisions their documents publish", () => {
  // The decision table of the Text note: a row whose every backticked name is a prop RN declares for Text is a decision about
  // props (the rows about nested spans, the wrapper's text= and fontSize= and the styles name other things).
  const rows = read("docs/research/text-original.md").split("\n").filter(line => line.startsWith("| ")).map(line => line.split(" | "));
  const names = cell => [...cell.matchAll(/`([A-Za-z_]+)`/g)].map(match => match[1]);
  const table = propTable("Text");
  let refused = 0, inert = 0;
  for (const [item, , decision = ""] of rows) {
    const propNames = names(item);
    if (propNames.length === 0 || !propNames.every(name => table.has(name))) {
      continue;
    }
    for (const name of propNames) {
      if (decision.startsWith("rejected")) {
        assert.equal(table.get(name).decision, "refused", `text-original.md rejects ${name}`);
        refused += 1;
      } else if (decision.startsWith("accepted and inert")) {
        assert.deepEqual([table.get(name).decision, table.get(name).basis], ["ignored", "decision"], `text-original.md accepts ${name} as inert`);
        inert += 1;
      }
    }
  }
  // selectable, adjustsFontSizeToFit, ellipsizeMode and the five platform options; the four inert props.
  assert.equal(refused, 8);
  assert.equal(inert, 4);
  // The wrapper-only props of the earlier Text are the one exception to the rule for undeclared keys.
  assert.deepEqual(Object.keys(legacyProps.Text), ["text", "fontSize"]);
  assert.ok(!propTable("Text").has("text") && !propTable("Text").has("fontSize"));
  // The Image contract takes the props its table ignores, and says why in its own words.
  const contract = read("src/image-contract.mjs");
  const ignoredImage = scope.Image.rules.filter(rule => rule.decision === "ignored" && rule.source.includes("src/image-contract.mjs")).flatMap(rule => rule.names);
  assert.equal(ignoredImage.length, 6);
  for (const name of ignoredImage) {
    assert.match(contract, new RegExp(`\\b${name}\\b`), `${name} is explained in the Image contract`);
    assert.doesNotThrow(() => validateImageProps({source: {uri: "res://x.png"}, [name]: 1}, {}, {}, () => true), name);
  }
  assert.throws(() => validateImageProps({children: 1}, {}, {}, () => true), /^Error: The <Image> component cannot contain children/);
});

test("the manifest carries the tables of the module and nothing else of them", () => {
  assert.deepEqual(manifest.components, JSON.parse(JSON.stringify(describeComponents())));
  assert.deepEqual(manifest.propPolicy.legacyProps, JSON.parse(JSON.stringify(legacyProps)));
  assert.equal(read("docs/compatibility/scope-0.5.json"), renderManifest(manifest), "run node scripts/scope-manifest.mjs --write");
  for (const component of scopedComponents) {
    assert.equal(manifest.components[component].counts.declared, declaredNames(scope[component].owner).size, component);
    assert.deepEqual(manifest.components[component].owner, scope[component].owner);
  }
  // A hand edit of a classification, a reason or a count is a drift: it differs from the module.
  const edited = structuredClone(manifest);
  edited.components.View.rules[0].decision = "ignored";
  assert.notDeepEqual(edited.components, JSON.parse(JSON.stringify(describeComponents())));
});

test("the checker refuses by the table, on any value that is not null, and lets everything else through", () => {
  for (const component of scopedComponents) {
    // the declared props, then the refused ones that only the lists declare
    const entries = [...propTable(component), ...[...refusalTable(component)].filter(([name]) => !propTable(component).has(name))];
    for (const [name, entry] of entries) {
      const props = {[name]: probeValue(component, name)};
      if (entry.decision === "refused") {
        assert.throws(() => checkProps(component, props), new Error(refusalMessage(component, name)), `${component}.${name}`);
        assert.equal(refusalMessage(component, name), entry.message ?? `Godot ${component} does not implement ${name}`);
        // null and undefined are not a value
        for (const absent of [undefined, null]) {
          assert.doesNotThrow(() => checkProps(component, {[name]: absent}), `${component}.${name}=${absent}`);
        }
        // every value it accepts passes, whatever the other values are; the others, falsy ones included, fail
        for (const value of entry.accepts ?? []) {
          assert.doesNotThrow(() => checkProps(component, {[name]: value}), `${component}.${name}=${JSON.stringify(value)}`);
        }
        if (entry.accepts?.[0] === false) {
          assert.throws(() => checkProps(component, {[name]: 0}), `${component}.${name}=0 is not false`);
        }
        assert.equal(refuses(entry, props[name]), true);
      } else {
        assert.doesNotThrow(() => checkProps(component, props), `${component}.${name} is ${entry.decision}`);
      }
    }
    // RN does not declare these for any of the six: they are never checked (the view config drops them).
    assert.doesNotThrow(() => checkProps(component, {kind: "input", onActivate() {}, svg: true, unknownProp: 1, "data-test": 1, className: "p-4"}), component);
  }
  // The earlier Text wrapper's props are the one exception: they fail with the hint, only when they are set.
  assert.throws(() => checkProps("Text", {text: "x"}), /^Error: Godot Text does not implement text: it is not a prop of RN's Text, pass the text as children$/);
  assert.throws(() => checkProps("Text", {fontSize: 12}), /^Error: Godot Text does not implement fontSize: it is not a prop of RN's Text, set it in style$/);
  assert.doesNotThrow(() => checkProps("Text", {text: undefined, fontSize: undefined}));
  assert.doesNotThrow(() => checkProps("View", {text: "x", fontSize: 12}));
  // Two examples written out, so that a change of the generic message is seen by eye.
  assert.throws(() => checkProps("View", {removeClippedSubviews: true}), /^Error: Godot View does not implement removeClippedSubviews$/);
  // RN's own touchables set these on every View they clone, so they are ignored by a decision and never refused.
  assert.doesNotThrow(() => checkProps("View", {focusable: true, accessibilityValue: {now: 1}, onFocusCapture() {}, tabIndex: 0}));
  assert.throws(() => checkProps("Modal", {animationType: "slide"}), /^Error: Godot Modal does not implement animationType$/);
  assert.doesNotThrow(() => checkProps("Modal", {animationType: "none", presentationStyle: "overFullScreen", hardwareAccelerated: false}));
  assert.throws(() => checkProps("Text", {ellipsizeMode: "middle"}), /^Error: Godot Text supports tail or clip ellipsizeMode$/);
  assert.throws(() => checkProps("Text", {selectable: true}), /^Error: Godot Text does not implement selectable$/);
  assert.throws(() => checkProps("Pressable", {onHoverIn() {}}), /^Error: Godot Pressable does not implement onHoverIn$/);
  assert.throws(() => checkProps("Image", {children: "x"}), /^Error: The <Image> component cannot contain children\./);
  // The ScrollView: the request that asks for nothing passes, every other fails, and the message is the uniform one.
  assert.doesNotThrow(() => checkProps("ScrollView", {bounces: false, pagingEnabled: false, keyboardDismissMode: "none", overScrollMode: "never",
    snapToOffsets: [], stickyHeaderIndices: [], canCancelContentTouches: true, persistentScrollbar: true, refreshing: false, onRefresh: null}));
  assert.throws(() => checkProps("ScrollView", {bounces: true}), /^Error: Godot ScrollView does not implement bounces$/);
  assert.throws(() => checkProps("ScrollView", {snapToOffsets: [20]}), /^Error: Godot ScrollView does not implement snapToOffsets$/);
  assert.throws(() => checkProps("ScrollView", {decelerationRate: "normal"}), /^Error: Godot ScrollView does not implement decelerationRate$/);
  assert.throws(() => checkProps("ScrollView", {onRefresh() {}}), /^Error: Godot ScrollView does not implement onRefresh$/);
  assert.throws(() => checkProps("ScrollView", {refreshing: true}), /^Error: Godot ScrollView does not implement refreshing$/);
  assert.doesNotThrow(() => checkProps("ScrollView", {horizontal: true, scrollEnabled: false, contentOffset: {x: 1, y: 2}, onScroll() {}}));
});

test("the value RN gives every refused prop by default passes, with the source of the default cited and read", () => {
  for (const component of scopedComponents) {
    for (const [name, entry] of refusalTable(component)) {
      if (entry.accepts === undefined) {
        // A handler has no default; a prop that is not a handler and accepts nothing says in its reason that it has none, or that
        // its default is refused too.
        assert.ok(/^on[A-Z]/.test(name) || /no default|default included/.test(entry.reason), `${component}.${name} has no default and says so`);
        assert.throws(() => checkProps(component, {[name]: probeValue(component, name)}), `${component}.${name}`);
        continue;
      }
      // the default is the first value it accepts, and every value it accepts passes
      assert.ok(entry.accepts.length > 0 && entry.defaultSource?.length > 0, `${component}.${name} cites where its default is`);
      for (const value of entry.accepts) {
        assert.doesNotThrow(() => checkProps(component, {[name]: value}), `${component}.${name} accepts ${JSON.stringify(value)}`);
      }
      assert.throws(() => checkProps(component, {[name]: probeValue(component, name)}), `${component}.${name} refuses ${JSON.stringify(probeValue(component, name))}`);
      // the source says the prop (under the name its C++ field has, where that differs) and exists
      const inSource = entry.defaultName?.[name] ?? name;
      for (const source of entry.defaultSource) {
        assert.ok(fs.existsSync(sourceFile(source)), `${component}.${name}: ${source} exists`);
      }
      assert.ok(entry.defaultSource.some(source => wordsOf(source).has(inSource)), `${component}.${name}: a default source names ${inSource}`);
    }
  }
  // The defaults, read from the sources that give them.
  const fact = (source, pattern) => assert.match(fs.readFileSync(sourceFile(source), "utf8"), pattern, `${source} ${pattern}`);
  const accessibility = "react-native/ReactCommon/react/renderer/components/view/AccessibilityProps.h";
  const baseView = "react-native/ReactCommon/react/renderer/components/view/BaseViewProps.h";
  const textProps = "react-native/Libraries/Text/TextProps.js";
  fact(accessibility, /bool accessibilityRespondsToUserInteraction\{true\}/);
  fact(accessibility, /bool accessibilityIgnoresInvertColors\{false\}/);
  fact(accessibility, /bool accessibilityShowsLargeContentViewer\{false\}/);
  fact(accessibility, /std::string accessibilityLargeContentTitle;/);
  fact(accessibility, /std::vector<std::string> accessibilityOrder\{\}/);
  fact(baseView, /bool removeClippedSubviews\{false\}/);
  fact(baseView, /bool shouldRasterize\{\}/);
  fact("react-native/ReactCommon/react/renderer/attributedstring/ParagraphAttributes.h", /textBreakStrategy\{TextBreakStrategy::HighQuality\}/);
  for (const [prop, value] of [["lineBreakStrategyIOS", "none"], ["dataDetectorType", "none"], ["textBreakStrategy", "highQuality"],
    ["android_hyphenationFrequency", "none"], ["ellipsizeMode", "tail"]]) {
    // the @default of the doc comment right above the prop: at most its platform line between them
    fact(textProps, new RegExp(`@default \`'${value}'\`\\n(?:\\s*\\* @platform [a-z]+\\n)?\\s*\\*/\\n\\s*${prop}\\?:`));
  }
  fact(textProps, /@default `false`\n\s*\*\/\n\s*selectable\?:/);
  fact("react-native/Libraries/Modal/Modal.js", /@default `\['portrait'\]`/);
  fact("react-native/Libraries/Modal/Modal.js", /let animationType = this\.props\.animationType \|\| 'none';/);
  fact("react-native/src/private/components/modal/specs/RCTModalHostViewNativeComponent.js", /statusBarTranslucent\?: WithDefault<boolean, false>/);
  fact("react-native/Libraries/Components/Pressable/Pressable.js", /usePressState\(testOnly_pressed === true\)/);
  // The values that leave the default are refused, and the booleans' own `false` is the only value of a flag that passes.
  assert.throws(() => checkProps("View", {accessibilityRespondsToUserInteraction: false}), /accessibilityRespondsToUserInteraction/);
  assert.throws(() => checkProps("View", {accessibilityLargeContentTitle: "Title"}), /accessibilityLargeContentTitle/);
  assert.throws(() => checkProps("View", {experimental_accessibilityOrder: ["a"]}), /experimental_accessibilityOrder/);
  assert.throws(() => checkProps("Modal", {supportedOrientations: ["portrait", "landscape"]}), /supportedOrientations/);
  assert.doesNotThrow(() => checkProps("Modal", {supportedOrientations: ["portrait"]}));
  assert.doesNotThrow(() => checkProps("Pressable", {testOnly_pressed: false, removeClippedSubviews: false, shouldRasterizeIOS: false}));
  assert.throws(() => checkProps("Pressable", {testOnly_pressed: true}), /testOnly_pressed/);
  assert.doesNotThrow(() => checkProps("Text", {dataDetectorType: "none", textBreakStrategy: "highQuality", lineBreakStrategyIOS: "none",
    android_hyphenationFrequency: "none", selectable: false, adjustsFontSizeToFit: false}));
  assert.throws(() => checkProps("Text", {lineBreakStrategyIOS: "standard"}), /lineBreakStrategyIOS/);
});

test("the Pressable drops the keys RN does not declare before the host's Control, and keeps ref", () => {
  const ref = {current: null};
  const kept = declaredProps("Pressable", {ref, onPress() {}, style: {}, children: null, kind: "input", text: "x", onActivate() {}, svg: true,
    className: "p-4", android_ripple: {color: "red"}, id: "a"});
  assert.deepEqual(Object.keys(kept).sort(), ["android_ripple", "children", "id", "onPress", "ref", "style"]);
  assert.equal(kept.ref, ref);
  // an ignored prop is declared, so it is kept (the Control's config lists neither name, so the host never sees them)
  assert.ok(!(controlViewConfig.validAttributes.android_ripple) && !(controlViewConfig.validAttributes.delayHoverIn));
});

test("every component facade runs the check, and only the one module owns the tables", () => {
  const callers = {View: "src/react-native-platform.jsx", ActivityIndicator: "src/react-native-platform.jsx", Modal: "src/react-native-platform.jsx",
    Pressable: "src/components.jsx", Text: "src/text.jsx", Image: "src/image-contract.mjs", ScrollView: "src/scroll-view-contract.mjs"};
  assert.match(read("src/components.jsx"), /declaredProps\("Pressable"/, "the Pressable drops the undeclared keys");
  for (const [component, file] of Object.entries(callers)) {
    assert.match(read(file), new RegExp(`checkProps\\("${component}"`), `${file} checks the ${component}`);
  }
  // No second copy of a list: the lists Text kept (flags, platform options, wrapper-only props) are gone from text.jsx.
  const text = read("src/text.jsx");
  for (const gone of ["unsupportedFlags", "unsupportedProps", "wrapperOnlyProps", "dataDetectorType"]) {
    assert.ok(!text.includes(gone), `text.jsx no longer lists ${gone}`);
  }
  // ... and the table of the ScrollView's contract is gone from it: what stays are the checks of values and the removal of list props.
  const contract = read("src/scroll-view-contract.mjs");
  for (const gone of ["unsupportedProps", "rejectAny", "emptyArray", "isRequested", "is not implemented"]) {
    assert.ok(!contract.includes(gone), `scroll-view-contract.mjs no longer holds ${gone}`);
  }
  assert.ok(!read("src/components.jsx").includes("onHoverIn || onHoverOut"));
  const facade = read("src/react-native-platform.jsx");
  // RN's SafeAreaView takes the View's table: it renders through the same function as the View, with RN's iOS native component.
  assert.match(facade, /export function SafeAreaView\(props\) \{\s*return renderHostView\(RCTSafeAreaViewNativeComponent, props\);/);
  assert.match(facade, /export function View\(props\) \{\s*return renderHostView\(OriginalView, props\);/);
  assert.match(facade, /function renderHostView\([^)]*\) \{[\s\S]*?checkProps\("View", props\);/);
  assert.match(facade, /export function Modal\(props\)/);
  assert.doesNotMatch(facade, /export const Modal = OriginalModal/);
});

test("the Modal wrapper keeps what RN's Modal exposes", async t => {
  const result = await bundleEntry(t, 'import Original from "react-native/Libraries/Modal/Modal"; export {Original};');
  const {Original} = run(result, {global: hostHandle, ...hostHandle});
  const source = read("src/react-native-platform.jsx");
  const ast = parseSync(source, {filename: "react-native-platform.jsx", configFile: false, babelrc: false, parserOpts: {plugins: ["jsx"]}});
  const modal = ast.program.body.find(node => node.type === "ExportNamedDeclaration" && node.declaration?.id?.name === "Modal");
  assert.ok(modal, "the facade exports a Modal function");
  // The statics RN's Modal has are copied by name, so a new static of RN's would be noticed here.
  assert.deepEqual(Object.keys(Original).sort(), ["Context", "displayName"]);
  assert.equal(Original.displayName, "Modal");
  assert.match(source, /Modal\.displayName = OriginalModal\.displayName/);
  assert.match(source, /Modal\.Context = OriginalModal\.Context/);
  assert.match(source, /<OriginalModal \{\.\.\.props\} \/>/);
  void transformFromAstSync;
});

test("the types and the tables agree: a supported prop type-checks and a refused one does not", () => {
  const {directory, counts} = writeTypeFixture();
  assert.ok(counts.positive > 300 && counts.negative > 50 && counts.valueNegative === 3 && counts.valuePositive === 5, JSON.stringify(counts));
  const supported = scopedComponents.reduce((sum, component) =>
    sum + [...propTable(component).values()].filter(entry => entry.decision === "supported").length, 0);
  assert.equal(counts.positive, supported);
  const refused = scopedComponents.reduce((sum, component) =>
    sum + [...refusalTable(component).values()].filter(entry => entry.typed !== true).length, 0);
  assert.equal(counts.negative, refused);
  const result = spawnSync(path.join(root, "node_modules/.bin/tsc-rs"), ["-p", path.join(directory, "tsconfig.json")], {encoding: "utf8", cwd: root});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  // The fixture can fail: a refused prop without its directive, and a directive over a supported prop, are both errors.
  const source = renderTypeFixture().source + "const broken: ViewProps = { removeClippedSubviews: placeholder };\n// @ts-expect-error\nconst fine: ViewProps = { testID: placeholder };\n";
  fs.writeFileSync(path.join(directory, "fixture.tsx"), source);
  const failing = spawnSync(path.join(root, "node_modules/.bin/tsc-rs"), ["-p", path.join(directory, "tsconfig.json")], {encoding: "utf8", cwd: root});
  assert.notEqual(failing.status, 0);
  assert.match(failing.stdout + failing.stderr, /removeClippedSubviews[\s\S]*Unused '@ts-expect-error'|Unused '@ts-expect-error'[\s\S]*removeClippedSubviews/);
  writeTypeFixture();
});

test("Platform, Dimensions, useWindowDimensions and StyleSheet have the members the manifest says", async t => {
  const result = await bundleEntry(t, [
    'import Platform from "../../src/platform.js";',
    'export {Platform};',
    'export {Dimensions} from "../../src/platform-environment.js";',
    'export {windowSnapshot, useWindowDimensions} from "../../src/window-dimensions.js";',
    'import Exports from "react-native/Libraries/StyleSheet/StyleSheetExports";',
    'export {Exports as StyleSheetExports};'].join("\n").replaceAll("../../src/", path.join(root, "src/")));
  const {Platform, Dimensions, windowSnapshot, useWindowDimensions, StyleSheetExports} = run(result, {global: hostHandle, ...hostHandle});
  const row = name => manifest.names.find(entry => entry.name === name).subset;
  // Platform
  const platform = row("Platform");
  assert.deepEqual(Object.keys(Platform).sort(), [...platform.members].sort());
  assert.equal(Platform.OS, platform.OS);
  assert.deepEqual(JSON.parse(JSON.stringify(Platform.constants)), platform.constants);
  assert.equal(Platform.select({godot: "godot", native: "native", default: "default"}), "godot");
  assert.equal(Platform.select({native: "native", default: "default"}), "native");
  assert.equal(Platform.select({default: "default"}), "default");
  assert.equal(Platform.select({ios: "ios", android: "android", default: "default"}), "default", "the ios and android keys are not selected");
  assert.equal(Platform.select({ios: "ios", android: "android"}), undefined);
  for (const name of platform.absent) {
    assert.ok(!(name in Platform), `Platform.${name} is absent`);
  }
  // Dimensions: RN's state, fed with the host's metrics
  const dimensions = row("Dimensions");
  assert.ok(dimensions.members.every(name => typeof Dimensions[name] === "function"));
  assert.deepEqual(Object.keys(Dimensions).filter(name => !dimensions.members.includes(name)), ["set"]);
  assert.match(dimensions.limits.join(" "), /\bset\b/);
  for (const [name, size] of [["window", 800], ["screen", 900]]) {
    const metrics = JSON.parse(JSON.stringify(Dimensions.get(name)));
    assert.deepEqual(Object.keys(metrics).sort(), ["fontScale", "height", "scale", "width"], name);
    assert.equal(metrics.width, size);
    assert.equal(metrics.fontScale, 1);
  }
  const heard = [];
  const subscription = Dimensions.addEventListener("change", change => heard.push(Object.keys(change).sort()));
  assert.equal(typeof subscription.remove, "function");
  subscription.remove();
  // useWindowDimensions: the four fields of the window
  assert.equal(typeof useWindowDimensions, "function");
  assert.deepEqual(Object.keys(windowSnapshot()).sort(), ["fontScale", "height", "scale", "width"]);
  assert.match(row("useWindowDimensions").returns, /width, height, scale and fontScale/);
  // StyleSheet: the object the facade declares, read from its source as tests/platform-seams.test.mjs reads nativeStyle
  const filename = path.join(root, "src/react-native-platform.jsx");
  const ast = parseSync(read("src/react-native-platform.jsx"), {filename, configFile: false, babelrc: false, parserOpts: {plugins: ["jsx"]}});
  const declaration = ast.program.body.find(node => node.type === "ExportNamedDeclaration"
    && node.declaration?.declarations?.some(entry => entry.id.name === "StyleSheet"));
  const {code} = transformFromAstSync({...ast, program: {...ast.program, body: [declaration.declaration]}}, undefined, {configFile: false, babelrc: false});
  const StyleSheet = vm.runInNewContext(code + "\nStyleSheet;", {OriginalStyleSheet: {compose: (first, second) => [first, second]}});
  const sheet = row("StyleSheet");
  assert.deepEqual(Object.keys(StyleSheet).sort(), [...sheet.members].sort());
  assert.equal(StyleSheet.hairlineWidth, sheet.hairlineWidth);
  assert.deepEqual(JSON.parse(JSON.stringify(StyleSheet.absoluteFill)), sheet.absoluteFill);
  assert.deepEqual(JSON.parse(JSON.stringify(StyleSheet.absoluteFill)), JSON.parse(JSON.stringify(StyleSheetExports.absoluteFill)),
    "absoluteFill is RN 0.87.1's value");
  assert.ok(Object.isFrozen(StyleSheet.absoluteFill));
  assert.deepEqual(JSON.parse(JSON.stringify(StyleSheet.flatten([{width: 1}, [{height: 2}, null]]))), {width: 1, height: 2});
  const created = {a: {width: 1}};
  assert.equal(StyleSheet.create(created), created);
  // AppState: the manifest names RN's events, and the suite that certifies them exists
  const appState = row("AppState");
  assert.deepEqual(appState.events, ["change", "focus", "blur", "memoryWarning"]);
  assert.ok(fs.existsSync(path.join(root, "tests/app-state-native.test.mjs")));
});
