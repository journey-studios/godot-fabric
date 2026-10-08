import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";

// An independent statement of what RN's pinned sources do with their iOS- and
// Android-specific APIs when Platform.OS is neither. Every text, key, count and
// ordering below is read from the pinned react-native package (the original
// modules, never the SDK's), and the probe's report is compared with it: each
// recorded call, warning, host answer and native view. Nothing here reads
// src/, so an SDK that copies, silences or replaces a module cannot agree with
// it by accident.
const rnRoot = path.dirname(createRequire(import.meta.url).resolve("react-native/package.json"));
const read = file => readFileSync(path.join(rnRoot, file), "utf8");

// ---------------------------------------------------------------- reading RN's JavaScript
const LITERAL = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"`;
const literals = new RegExp(LITERAL, "g");
const unquote = text => text.slice(1, -1).replace(/\\(.)/g, "$1");
// A string written as literals joined by +.
function concatenation(expression) {
  assert.equal(expression.replace(literals, "").replace(/[\s+]/g, ""), "", "A concatenation of string literals: " + expression);
  return [...expression.matchAll(literals)].map(match => unquote(match[0])).join("");
}
// The lines of the body of the first declaration that matches: from the line
// that ends the signature with "{" to the "  }" that closes it.
function body(text, declaration) {
  const lines = text.split("\n");
  const start = lines.findIndex(line => declaration.test(line));
  assert.ok(start >= 0, "RN's source still declares " + declaration);
  let open = start;
  while (!/\{\s*$/.test(lines[open])) {
    open += 1;
  }
  let close = open + 1;
  while (!/^ {2}\},?$/.test(lines[close])) {
    close += 1;
  }
  return lines.slice(open + 1, close).join("\n");
}
// console.warn(...) messages, in order, up to an optional limit in the text.
function warnings(text, until = text.length) {
  return [...text.slice(0, until).matchAll(/console\.warn\(\s*((?:(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*\+?\s*)+)\s*,?\s*\)/g)]
    .map(match => concatenation(match[1]));
}
// invariant(condition, message) calls in order.
function invariants(text) {
  return [...text.matchAll(/invariant\(([\s\S]*?)\);/g)].map(match => {
    const tail = match[1].match(new RegExp(String.raw`,\s*((?:(?:${LITERAL})\s*\+?\s*)+),?\s*$`));
    assert.ok(tail, "invariant with a literal message: " + match[1]);
    return {condition: match[1].slice(0, tail.index).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim(), message: concatenation(tail[1])};
  });
}
const thrown = text => [...text.matchAll(/throw new Error\(\s*((?:(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*\+?\s*)+)\s*\)/g)].map(match => concatenation(match[1]));
function pairs(text, pattern = /(\w+):\s*'([^']*)'/g) {
  return Object.fromEntries([...text.matchAll(pattern)].map(match => [match[1], match[2]]));
}

// ---------------------------------------------------------------- the contract RN's sources state
function extractContract() {
  const indexSource = read("index.js");
  // index.js: the one-time notice a getter prints before it returns the module.
  const notice = name => {
    const start = indexSource.indexOf(`get ${name}() {`);
    assert.ok(start >= 0, "index.js exposes " + name);
    const call = indexSource.slice(start).match(/warnOnce\(\s*('(?:[^'\\]|\\.)*'),\s*([\s\S]*?)\s*,?\s*\);/);
    assert.ok(call, name + " warns once");
    return {key: unquote(call[1]), message: concatenation(call[2])};
  };

  const toast = read("Libraries/Components/ToastAndroid/ToastAndroidFallback.js");
  const toastMethods = [...toast.matchAll(/^ {2}(\w+): function/gm)].map(match => match[1]);
  const toastWarnings = new Set(toastMethods.map(method => warnings(body(toast, new RegExp(`^  ${method}: function`))).join("|")));
  assert.equal(toastWarnings.size, 1, "Every ToastAndroid fallback method prints the same single warning");
  const toastMessage = [...toastWarnings][0];
  assert.ok(toastMessage.length > 0 && !toastMessage.includes("|"));

  const permissions = read("Libraries/PermissionsAndroid/PermissionsAndroid.js");
  const permissionTable = permissions.slice(permissions.indexOf("const PERMISSIONS = Object.freeze({"));
  // RN declares the same names twice, as a type and as the frozen value: two parses must agree.
  const permissionType = permissions.slice(permissions.indexOf("type PermissionsType = Readonly<{"));
  assert.deepEqual(pairs(permissionType.slice(0, permissionType.indexOf("}>;"))), pairs(permissionTable.slice(0, permissionTable.indexOf("}) as PermissionsType;"))),
    "RN's permission type and table list the same names");
  const results = pairs(permissions.slice(permissions.indexOf("const PERMISSION_REQUEST_RESULT"), permissions.indexOf("});", permissions.indexOf("const PERMISSION_REQUEST_RESULT"))),
    /(\w+):\s*'([^']*)'/g);
  const permissionBehavior = {};
  for (const [name, pattern] of [["check", /^ {2}check\(/], ["checkPermission", /^ {2}checkPermission\(/], ["request", /^ {2}async request\(/],
    ["requestPermission", /^ {2}async requestPermission\(/], ["requestMultiple", /^ {2}requestMultiple\(/]]) {
    const text = body(permissions, pattern);
    const resolved = text.indexOf("Promise.resolve(");
    assert.ok(resolved > 0, name + " resolves a value on a platform that is not Android");
    const value = text.slice(resolved).match(/Promise\.resolve\(([^;]*)\);/)[1];
    const evaluated = value === "false" ? false : value === "{}" ? {} : value.startsWith("this.RESULTS.") ? results[value.slice("this.RESULTS.".length)] : undefined;
    assert.notEqual(evaluated, undefined, "A resolved value RN states: " + value);
    permissionBehavior[name] = {warnings: warnings(text, resolved), resolved: evaluated};
  }

  const dynamicColor = thrown(read("Libraries/StyleSheet/PlatformColorValueTypesIOS.js"));
  assert.equal(dynamicColor.length, 1);

  // ActionSheetIOS: the invariants of each method, in order. The manager is the
  // one whose condition is the module itself.
  const sheetSource = read("Libraries/ActionSheetIOS/ActionSheetIOS.js");
  const sheet = {};
  for (const method of ["showActionSheetWithOptions", "showShareActionSheetWithOptions", "dismissActionSheet"]) {
    sheet[method] = invariants(body(sheetSource, new RegExp(`^  (?:${method}\\(|${method}: )`)));
    assert.ok(sheet[method].some(row => row.condition === "RCTActionSheetManager"), method + " needs the action sheet manager");
  }

  const push = read("Libraries/PushNotificationIOS/PushNotificationIOS.js");
  const pushStatics = [...push.matchAll(/^ {2}static (\w+)\(/gm)].map(match => match[1]);
  const pushBehavior = Object.fromEntries(pushStatics.map(name => [name, {invariants: invariants(body(push, new RegExp(`^  static ${name}\\(`)))}]));
  const listenerEvents = pushBehavior.addEventListener.invariants[0].message;
  assert.equal(pushBehavior.removeEventListener.invariants[0].message, listenerEvents, "Both listener methods reject the same events");
  const fetchResult = pairs(push.slice(push.indexOf("static FetchResult"), push.indexOf("};", push.indexOf("static FetchResult"))));

  const drawer = read("Libraries/Components/DrawerAndroid/DrawerLayoutAndroidFallback.js");
  const drawerMethods = [...drawer.matchAll(/^ {2}(\w+)\(/gm)].map(match => match[1]).filter(name => name !== "render");
  const drawerErrors = new Set(drawerMethods.flatMap(method => thrown(body(drawer, new RegExp(`^  ${method}\\(`)))));
  assert.equal(drawerErrors.size, 1, "Every DrawerLayoutAndroid fallback method throws the same error");

  const accessory = warnings(read("Libraries/Components/TextInput/InputAccessoryView.js"));
  assert.equal(accessory.length, 1);

  const unimplemented = read("Libraries/Components/UnimplementedViews/UnimplementedView.js");
  // Outside development the view has no style of its own, so it only wraps its children.
  assert.match(unimplemented, /__DEV__\s*\?\s*\{[^}]*\}\s*:\s*\{\}/);
  assert.match(unimplemented, /\{this\.props\.children\}/);
  assert.match(read("Libraries/Components/ProgressBarAndroid/ProgressBarAndroid.js"), /require\('\.\.\/UnimplementedViews\/UnimplementedView'\)/);

  const touchable = read("Libraries/Components/Touchable/TouchableNativeFeedback.js");
  const pressability = read("Libraries/Pressability/Pressability.js");
  const effects = body(pressability, /^ {2}_performTransitionSideEffects\(/);
  assert.match(touchable, /minPressDuration: 0,/);
  assert.match(touchable, /:\s*\/\*[\s\S]*?\*\/\s*\(background, useForeground: boolean\) => null;/);
  assert.match(touchable, /static canUseNativeForeground: \(\) => boolean = \(\) =>\s*Platform\.OS === 'android';/);
  // With no delay and a minimum press duration of 0, onPressIn runs on contact,
  // and a release deactivates (onPressOut) before it calls onPress, or after.
  const release = effects.indexOf("this._deactivate(event);", effects.indexOf("isPrevActive && !isNextActive")) < effects.indexOf("onPress(event);")
    ? ["out", "press"] : ["press", "out"];
  // The object literals the statics return; the type annotations repeat the same words.
  const themed = [...touchable.matchAll(/\(\{\s*type: '(\w+)',\s*attribute: '(\w+)',\s*rippleRadius,\s*\}\)/g)];
  const rippled = touchable.match(/return \{\s*type: '(\w+)',\s*color: processedColor,\s*borderless,\s*rippleRadius,/);
  assert.ok(themed.length === 2 && rippled, "TouchableNativeFeedback's three descriptors");
  const descriptors = {selectable: {type: themed[0][1], attribute: themed[0][2]}, borderless: {type: themed[1][1], attribute: themed[1][2]},
    ripple: {type: rippled[1]}};

  // The host modules RN's specs look up, and what the registry says when one is missing.
  const modules = {};
  for (const file of ["src/private/specs_DEPRECATED/modules/NativeToastAndroid.js", "src/private/specs_DEPRECATED/modules/NativePermissionsAndroid.js",
    "src/private/specs_DEPRECATED/modules/NativeActionSheetManager.js", "src/private/specs_DEPRECATED/modules/NativeDialogManagerAndroid.js",
    "src/private/specs_DEPRECATED/modules/NativePushNotificationManagerIOS.js", "src/private/specs_DEPRECATED/modules/NativeStatusBarManagerIOS.js",
    "src/private/specs_DEPRECATED/modules/NativeStatusBarManagerAndroid.js"]) {
    const match = read(file).match(/TurboModuleRegistry\.(get|getEnforcing)<Spec>\(\s*'(\w+)'/);
    assert.ok(match, file);
    modules[match[2]] = match[1];
  }
  const registry = read("Libraries/TurboModule/TurboModuleRegistry.js");
  const enforcing = registry.slice(registry.indexOf("export function getEnforcing"));
  const template = enforcing.match(/`([^`]*)`\s*\+\s*('(?:[^'\\]|\\.)*')/);
  assert.ok(template && template[1].includes("${name}"));
  const missing = name => template[1].replace("${name}", name) + unquote(template[2]);

  return {
    notices: {ProgressBarAndroid: notice("ProgressBarAndroid"), DrawerLayoutAndroid: notice("DrawerLayoutAndroid"), PushNotificationIOS: notice("PushNotificationIOS")},
    toast: {constants: Object.fromEntries([...toast.matchAll(/^ {2}(SHORT|LONG|TOP|BOTTOM|CENTER): (\d+)/gm)].map(match => [match[1], Number(match[2])])),
      methods: toastMethods, message: toastMessage},
    permissions: {table: pairs(permissionTable.slice(0, permissionTable.indexOf("}) as PermissionsType;"))), results, behavior: permissionBehavior},
    dynamicColor: dynamicColor[0], sheet,
    push: {statics: pushStatics, behavior: pushBehavior, fetchResult, listenerEvents},
    drawer: {methods: drawerMethods, message: [...drawerErrors][0]},
    accessory: accessory[0], touchable: {release, descriptors}, modules, missing,
  };
}

// ---------------------------------------------------------------- the report the probe wrote
const sortBy = rows => [...rows].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);

function node(nodes, id) {
  return nodes.find(entry => entry.testID === id);
}
// A child inside its parent: both sizes and where the child sits in the parent.
function shape(nodes, parent, child) {
  const outer = node(nodes, parent);
  const inner = node(nodes, child);
  assert.ok(outer && inner, `Both ${parent} and ${child} are committed`);
  return [outer.fabricWidth, outer.fabricHeight, inner.fabricWidth, inner.fabricHeight, inner.fabricX - outer.fabricX, inner.fabricY - outer.fabricY];
}

// The outcome RN's source gives one recorded operation, or null for a read-only one.
function expectedCall(contract, op) {
  const [api, rest = ""] = op.split(".");
  const method = rest.split("/")[0];
  const variant = rest.split("/")[1];
  if (op === "DynamicColorIOS") {
    return {state: "threw", error: contract.dynamicColor, warnings: []};
  }
  if (api === "ToastAndroid") {
    return {state: "returned", undefined: true, warnings: [contract.toast.message]};
  }
  if (api === "PermissionsAndroid") {
    const behavior = contract.permissions.behavior[method];
    return {state: "resolved", value: behavior.resolved, warnings: behavior.warnings};
  }
  if (api === "ActionSheetIOS") {
    const rows = contract.sheet[method];
    const argument = {"no-options": "options", "no-callback": "callback", "no-failure-callback": "failureCallback", "no-success-callback": "successCallback"}[variant];
    const failing = argument === undefined ? rows.find(row => row.condition === "RCTActionSheetManager") : rows.find(row => row.condition.includes(argument));
    assert.ok(failing, `RN's invariant for ${op}`);
    return {state: "threw", error: failing.message, warnings: []};
  }
  if (api === "DrawerLayoutAndroid") {
    return {state: "threw", error: contract.drawer.message, warnings: []};
  }
  if (api === "PushNotificationIOS") {
    const behavior = contract.push.behavior[method];
    if (method.endsWith("EventListener")) {
      return variant === "unsupported" ? {state: "threw", error: contract.push.listenerEvents, warnings: []} : {state: "returned", undefined: true, warnings: []};
    }
    const row = variant === "no-callback" ? behavior.invariants.find(entry => entry.condition.includes("callback")) : behavior.invariants.find(entry => entry.condition === "NativePushNotificationManagerIOS");
    assert.ok(row, `RN's invariant for ${op}`);
    return {state: "threw", error: row.message, warnings: []};
  }
  throw new Error("Unknown operation: " + op);
}

function verifyCall(contract, entry) {
  const expected = expectedCall(contract, entry.op);
  assert.equal(entry.state, expected.state, `${entry.op} ends ${expected.state}`);
  assert.deepEqual(entry.warnings, expected.warnings, `${entry.op} prints RN's warnings`);
  if (expected.state === "threw") {
    assert.equal(entry.error, expected.error, `${entry.op} throws RN's error`);
  } else {
    assert.equal(entry.error, null, entry.op);
    if (expected.undefined) {
      assert.equal(entry.valueUndefined, true, `${entry.op} returns undefined`);
    } else {
      assert.deepEqual(entry.value, expected.value, `${entry.op} resolves RN's value`);
    }
  }
}

// The operations the fixture runs on the mounted application, and the set RN's sources imply.
function expectedOperations(contract) {
  return sortBy([
    ...contract.toast.methods.map(method => "ToastAndroid." + method),
    ...Object.keys(contract.permissions.behavior).map(method => "PermissionsAndroid." + method), "PermissionsAndroid.request/rationale",
    "DynamicColorIOS",
    "ActionSheetIOS.showActionSheetWithOptions/no-options", "ActionSheetIOS.showActionSheetWithOptions/no-callback", "ActionSheetIOS.showActionSheetWithOptions",
    "ActionSheetIOS.showShareActionSheetWithOptions/no-options", "ActionSheetIOS.showShareActionSheetWithOptions/no-failure-callback",
    "ActionSheetIOS.showShareActionSheetWithOptions/no-success-callback", "ActionSheetIOS.showShareActionSheetWithOptions", "ActionSheetIOS.dismissActionSheet",
    "PushNotificationIOS.checkPermissions/no-callback", "PushNotificationIOS.addEventListener/unsupported", "PushNotificationIOS.addEventListener",
    "PushNotificationIOS.removeEventListener", "PushNotificationIOS.removeEventListener/unsupported",
    ...contract.push.statics.filter(name => !name.endsWith("EventListener")).map(name => "PushNotificationIOS." + name),
    ...contract.drawer.methods.map(method => "DrawerLayoutAndroid." + method),
  ]);
}

// The exports that are RN's own modules, returned as they are.
const ORIGINALS = ["ToastAndroid", "PermissionsAndroid", "DynamicColorIOS", "ActionSheetIOS", "ProgressBarAndroid", "DrawerLayoutAndroid", "InputAccessoryView",
  "PushNotificationIOS"];
const VIEWS = ["root", "progress", "progress-child", "control", "control-child", "drawer", "drawer-main", "accessory", "native-feedback",
  "native-feedback-foreground", "native-feedback-default"];
const STATUS_BAR = "Godot platform does not implement StatusBar";
const INLINE = "Inline Controls are not implemented in Godot Text";

function verifyMount(contract, name, mount) {
  const {js, native} = mount;
  assert.equal(js.importWarnings, 0, `${name}: importing react-native prints nothing`);
  assert.deepEqual(sortBy(js.renderErrors), sortBy([{root: name, case: "status-bar", message: STATUS_BAR}, {root: name, case: "inline", message: INLINE}]),
    `${name}: only StatusBar and an inline TouchableNativeFeedback fail at render`);
  assert.deepEqual(native.errors, [], `${name}: the host reports no error`);
  // The notices of ProgressBarAndroid and DrawerLayoutAndroid come first, as
  // their cases render first; InputAccessoryView warns once per render.
  const renders = js.renders[name + "-accessory"];
  assert.ok(renders >= 1);
  assert.deepEqual(js.warnings, [contract.notices.ProgressBarAndroid.message, contract.notices.DrawerLayoutAndroid.message,
    ...Array(renders).fill(contract.accessory)], `${name}: what mounting prints`);
  const nodes = native.nodes;
  for (const id of VIEWS) {
    assert.ok(node(nodes, name + "-" + id), `${name}-${id} is committed`);
  }
  assert.equal(node(nodes, name + "-drawer-navigation"), undefined, "renderNavigationView is never called");
  assert.equal(node(nodes, name + "-accessory-child"), undefined, "InputAccessoryView renders null");
  assert.equal(nodes.length, VIEWS.length + 1, `${name}: the host holds the views of the cases and the app wrapper, and no view for UnimplementedView`);
  const progress = shape(nodes, name + "-progress", name + "-progress-child");
  assert.deepEqual(progress, [100, 40, 60, 20, 0, 0]);
  assert.deepEqual(shape(nodes, name + "-control", name + "-control-child"), progress,
    "UnimplementedView adds a View with no style, which commits what a plain nested View commits");
  assert.deepEqual(shape(nodes, name + "-drawer", name + "-drawer-main"), [120, 60, 50, 30, 0, 0]);
  for (const id of ["native-feedback", "native-feedback-foreground", "native-feedback-default"]) {
    assert.deepEqual([node(nodes, name + "-" + id).fabricWidth, node(nodes, name + "-" + id).fabricHeight], [150, 48]);
  }
}

// Every warning is attributed: the mount's, then each read's and call's in the
// order they ran. Nothing prints that no operation owns.
function verifyAccounting(js, mountWarnings) {
  const owned = [...js.reads, ...js.calls].filter(entry => entry.at !== undefined).sort((a, b) => a.at - b.at);
  let cursor = mountWarnings;
  for (const entry of owned) {
    assert.equal(entry.at, cursor, `${entry.op ?? entry.name} starts where the previous owner ended`);
    assert.deepEqual(js.warnings.slice(entry.at, entry.at + entry.warnings.length), entry.warnings);
    cursor += entry.warnings.length;
  }
  assert.equal(cursor, js.warnings.length, "No warning is printed outside a recorded read or call");
}

function verifyReads(contract, js, mountWarnings, names) {
  const printedBefore = entry => js.warnings.slice(0, entry.at);
  for (const entry of js.reads) {
    assert.equal(entry.available, true, `${entry.name} is exported`);
    assert.equal(entry.error, null);
    assert.equal(entry.sameAsOriginal, ORIGINALS.includes(entry.name), `${entry.name} ${ORIGINALS.includes(entry.name) ? "is RN's module" : "is not RN's module itself"}`);
    const notice = contract.notices[entry.name];
    const first = notice !== undefined && !printedBefore(entry).includes(notice.message);
    assert.deepEqual(entry.warnings, first ? [notice.message] : [], `${entry.name} prints its notice only on its first read in the runtime`);
  }
  for (const name of ["ProgressBarAndroid", "DrawerLayoutAndroid"]) {
    assert.ok(js.warnings.slice(0, mountWarnings).includes(contract.notices[name].message), `${name}'s notice was printed while mounting`);
  }
  for (const [name, notice] of Object.entries(contract.notices)) {
    assert.equal(js.warnings.filter(text => text === notice.message).length, 1, `${name}'s notice is printed once in a runtime`);
  }
  assert.deepEqual(js.reads.map(entry => entry.name).filter((name, index, all) => all.indexOf(name) === index).sort(), [...names].sort());
  for (const name of [...ORIGINALS, "StatusBar", "TouchableNativeFeedback"]) {
    assert.ok(js.exports.includes(name), `react-native exports ${name}`);
  }
}

function verifyStatics(contract, statics) {
  assert.deepEqual(statics.toast.constants, contract.toast.constants, "ToastAndroid's constants are the fallback's");
  assert.deepEqual(statics.toast.methods, [...contract.toast.methods].sort());
  assert.ok(Object.keys(contract.permissions.table).length > 0);
  assert.deepEqual(statics.permissions.permissions, contract.permissions.table, "The permission table RN pins");
  assert.deepEqual(statics.permissions.results, contract.permissions.results);
  assert.deepEqual(statics.permissions.frozen, [true, true]);
  assert.deepEqual(statics.push.fetchResult, contract.push.fetchResult);
  assert.equal(statics.genericToastAndroid, "undefined", "RN's generic ToastAndroid path imports itself");
  const touchable = statics.touchable;
  assert.ok(touchable.sameStatics.length === 4 && touchable.sameStatics.every(([, same]) => same === true), "The wrapper keeps RN's four statics");
  const {selectable, borderless, ripple} = contract.touchable.descriptors;
  assert.deepEqual(touchable.selectable, {...selectable, rippleRadius: 4});
  assert.deepEqual(touchable.borderless, borderless, "JSON leaves out the undefined radius");
  assert.equal(touchable.ripple.type, ripple.type);
  assert.deepEqual([touchable.ripple.borderless, touchable.ripple.rippleRadius, touchable.ripple.color], [true, 5, 4294901760]);
  assert.equal(touchable.canUseNativeForeground, false);
}

function verifyHostModules(contract, hostModules) {
  assert.deepEqual(Object.keys(hostModules).sort(), Object.keys(contract.modules).sort(), "The modules RN's specs look up");
  for (const [name, answer] of Object.entries(hostModules)) {
    assert.equal(answer.get, null, `${name} is not registered by the host`);
    assert.equal(answer.getEnforcing.error, contract.missing(name), `${name}: getEnforcing throws RN's error`);
  }
}

function verifyPress(contract, press) {
  const events = device => [...press.presses[device].down, ...press.presses[device].up];
  for (const device of ["mouse", "touch"]) {
    const {down, up} = press.presses[device];
    assert.deepEqual(down.map(row => row.type), ["in"], `${device}: contact activates the press`);
    assert.deepEqual(up.map(row => row.type), contract.touchable.release, `${device}: release follows Pressability's order`);
    assert.ok(events(device).every(row => row.id === "A-native-feedback"));
    assert.equal(press.presses[device].held.responder !== 0, true, `${device}: the touchable holds the responder while pressed`);
    assert.deepEqual([press.presses[device].after.responder, press.presses[device].after.activeTouches], [0, 0]);
  }
  assert.equal(press.after.grants - press.before.grants, 2);
  assert.equal(press.after.releases - press.before.releases, 2);
}

// Verifies one probe report; throws the first disagreement. Returns the counts it verified.
export function verifyOsContractsReport(report, contract = extractContract()) {
  assert.equal(report.scenario, "native-os-contracts");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  const {A, B} = report.apps;
  verifyMount(contract, "A", A.mount);
  verifyMount(contract, "B", B.mount);

  const js = A.final.js;
  verifyAccounting(js, A.mount.js.warnings.length);
  verifyReads(contract, js, A.mount.js.warnings.length, [...ORIGINALS, "StatusBar", "TouchableNativeFeedback"]);
  const operations = js.calls.filter(entry => entry.label !== "after-stop");
  assert.deepEqual(sortBy(operations.map(entry => entry.op)), expectedOperations(contract), "Every operation RN's sources imply was run, once");
  for (const entry of operations) {
    verifyCall(contract, entry);
  }
  // The fixture finds PushNotificationIOS's and DrawerLayoutAndroid's methods on the classes themselves.
  assert.deepEqual([...A.drawer.names].sort(), [...contract.drawer.methods].sort());
  assert.equal(A.drawer.mounted, true);
  verifyStatics(contract, A.statics);
  verifyHostModules(contract, A.hostModules);
  verifyPress(contract, A.press);
  // A press reaches the host with Pressability's handlers and no Android drawable.
  for (const id of ["A-native-feedback", "A-native-feedback-foreground", "A-native-feedback-default"]) {
    const seen = js.seen[id];
    assert.ok(seen.keys.includes("onResponderGrant") && seen.keys.includes("onStartShouldSetResponder"), id);
    assert.ok(!seen.keys.includes("nativeBackgroundAndroid") && !seen.keys.includes("nativeForegroundAndroid"), id + " gets no native drawable");
    assert.deepEqual([seen.nativeBackgroundAndroid, seen.nativeForegroundAndroid], [null, null]);
  }
  assert.deepEqual(A.final.application.errors, [], "No host or runtime diagnostic");

  // The second application: its own runtime prints each notice again, once.
  const second = B.final.js;
  verifyAccounting(second, B.mount.js.warnings.length);
  verifyReads(contract, second, B.mount.js.warnings.length, ["ToastAndroid", "ProgressBarAndroid", "PushNotificationIOS"]);
  for (const entry of second.calls) {
    verifyCall(contract, entry);
  }
  assert.equal(second.calls.length, 2);

  // After stop only what needs no host module still answers, with the same outcomes.
  const late = A.afterStop.js.calls.filter(entry => entry.label === "after-stop");
  assert.deepEqual(late.map(entry => entry.op), ["ToastAndroid.show", "PermissionsAndroid.check", "DynamicColorIOS"]);
  verifyCall(contract, late[0]);
  verifyCall(contract, late[2]);
  assert.deepEqual(late[1].warnings, expectedCall(contract, "PermissionsAndroid.check").warnings);
  assert.equal(A.afterStop.application.stopped, true);
  return {operations: operations.length, warnings: js.warnings.length, permissions: Object.keys(contract.permissions.table).length,
    notices: Object.keys(contract.notices).length, hostModules: Object.keys(contract.modules).length,
    pushStatics: contract.push.statics.length, drawerMethods: contract.drawer.methods.length};
}
