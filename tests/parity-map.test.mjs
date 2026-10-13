import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { coverage, defaultInputs, derive, resolveMap, subjectOf } from "../scripts/parity-map.mjs";
import { propTable, scope as propScope, scopedComponents } from "../src/prop-scope.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const inputs = defaultInputs();
const { map, inventory, dashboard } = inputs;
const seed = JSON.parse(readFileSync(path.join(root, "docs/compatibility/react-native-0.87.1.json"), "utf8"));
const outcome = resolveMap(inputs);
const rowOf = (id) => outcome.resolved.get(id);
const mutated = (change) => {
  const copy = { map: structuredClone(map), inventory: structuredClone(inventory), dashboard: structuredClone(dashboard) };
  change(copy);
  return resolveMap(copy);
};
const codes = (result) => [...new Set(result.problems.map((problem) => problem.code))].sort();
const messages = (result, code) => result.problems.filter((problem) => problem.code === code).map((problem) => problem.message).join("\n");

test("the gate passes on the committed map and every row has an owner, a scope and an applicability", () => {
  assert.deepEqual(outcome.problems, []);
  assert.equal(outcome.resolved.size, inventory.contracts.length);
  const tasks = new Set(dashboard.tasks.map((task) => task.id));
  for (const [id, row] of outcome.resolved) {
    assert.ok(tasks.has(row.owner), `${id}: ${row.owner}`);
    assert.ok(["1_0", "post_1_0", "out"].includes(row.scope), id);
    if (row.scope !== "1_0") {
      assert.ok(row.scopeReason, `${id}: scope ${row.scope} needs its reason`);
    }
    for (const platform of ["ios", "android", "godot"]) {
      const { status, reason } = row.applicability[platform];
      assert.ok(["applies", "not-applicable", "host-provides"].includes(status), `${id} ${platform}`);
      assert.ok(status === "applies" || reason, `${id}: ${platform} ${status} needs its reason`);
    }
  }
});

test("the command line prints the coverage per GF and --check passes on the committed map", () => {
  const checked = spawnSync(process.execPath, ["scripts/parity-map.mjs", "--check"], { cwd: root, encoding: "utf8", timeout: 60000 });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, new RegExp(`^PARITY_MAP_PASSED: ${inventory.contracts.length} rows, \\d+ rules, \\d+ overrides$`, "m"));
  const report = spawnSync(process.execPath, ["scripts/parity-map.mjs"], { cwd: root, encoding: "utf8", timeout: 60000 });
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /^GF-05 RN bootstrap and JS globals: \d+ rows$/m);
  assert.match(report.stdout, /^ {2}godot +applies \d+, host-provides \d+/m);
  assert.match(report.stdout, new RegExp(`^total ${inventory.contracts.length} rows`, "m"));
  const entries = coverage(outcome, dashboard);
  assert.equal(entries.reduce((sum, entry) => sum + entry.rows, 0), inventory.contracts.length);
});

test("an unmapped row, such as one a new RN version adds, fails the gate", () => {
  const result = mutated(({ inventory: copy }) => {
    copy.contracts.push({ id: "prop:BrandNewProps.example", kind: "prop", owner: "BrandNewProps", name: "example", type: "string" });
  });
  assert.ok(codes(result).includes("E_UNMAPPED"));
  assert.match(messages(result, "E_UNMAPPED"), /prop:BrandNewProps\.example/);
  const lost = mutated(({ map: copy }) => {
    copy.rules = copy.rules.filter((rule) => rule.id !== "api-gf03-root-names");
  });
  assert.match(messages(lost, "E_UNMAPPED"), /ReactNativeVersion/);
});

test("an owner that is not a dashboard task fails the gate", () => {
  const unknown = mutated(({ map: copy }) => {
    copy.rules.find((rule) => rule.id === "api-gf03-root-names").owner = "GF-99";
  });
  assert.ok(codes(unknown).includes("E_UNKNOWN_OWNER"));
  assert.match(messages(unknown, "E_UNKNOWN_OWNER"), /GF-99/);
  const removedTask = mutated(({ dashboard: copy }) => {
    copy.tasks = copy.tasks.filter((task) => task.id !== "GF-17");
  });
  assert.match(messages(removedTask, "E_UNKNOWN_OWNER"), /GF-17/);
  const malformed = mutated(({ map: copy }) => {
    copy.overrides[0].owner = "gf-17";
  });
  assert.ok(codes(malformed).includes("E_UNKNOWN_OWNER"));
});

test("two rules of equal precedence on one row are an ambiguity, even when they agree", () => {
  const result = mutated(({ map: copy }) => {
    const twin = structuredClone(copy.rules.find((rule) => rule.id === "api-gf03-root-names"));
    twin.id = "twin";
    copy.rules.push(twin);
  });
  assert.ok(codes(result).includes("E_AMBIGUOUS"));
  assert.match(messages(result, "E_AMBIGUOUS"), /ReactNativeVersion\.\w+: owner is assigned by api-gf03-root-names and twin at the same precedence/);
  const higher = mutated(({ map: copy }) => {
    const winner = structuredClone(copy.rules.find((rule) => rule.id === "api-gf03-root-names"));
    winner.id = "winner";
    winner.precedence = 11;
    winner.owner = "GF-09";
    copy.rules.push(winner);
  });
  assert.deepEqual(higher.problems.map((problem) => problem.code), ["E_DEAD_RULE"], "a higher precedence resolves the tie and shadows the family rule");
  assert.equal(higher.resolved.get("value:react-native.ReactNativeVersion").owner, "GF-09");
});

test("a rule that matches nothing, or whose rows a stronger rule covers, is dead", () => {
  const nothing = mutated(({ map: copy }) => {
    copy.rules.push({ id: "dead", precedence: 10, match: { kind: "prop", owner: "NoSuchProps" }, owner: "GF-10", why: "nothing" });
  });
  assert.match(messages(nothing, "E_DEAD_RULE"), /rule dead matches no row/);
  const shadowed = mutated(({ map: copy }) => {
    copy.rules.push({ id: "shadowed", precedence: 9, match: { kind: "value", name: "ReactNativeVersion" }, owner: "GF-10", why: "weaker" });
  });
  assert.match(messages(shadowed, "E_DEAD_RULE"), /rule shadowed matches 1 rows but wins none/);
  const unused = mutated(({ map: copy }) => {
    copy.applicabilityProfiles.unused = structuredClone(copy.applicabilityProfiles.all);
  });
  assert.match(messages(unused, "E_STALE_PROFILE"), /profile unused/);
});

test("an override naming a row that no longer exists, or changing nothing, fails the gate", () => {
  const stale = mutated(({ map: copy }) => {
    copy.overrides.push({ id: "api-member:AppRegistry.removedInTheNextRelease", owner: "GF-07", reason: "gone" });
  });
  assert.match(messages(stale, "E_STALE_OVERRIDE"), /removedInTheNextRelease/);
  const noop = mutated(({ map: copy }) => {
    copy.overrides.push({ id: "api-member:Image.getSize", owner: "GF-16", reason: "already GF-16" });
  });
  assert.match(messages(noop, "E_NOOP_OVERRIDE"), /Image\.getSize/);
  const twice = mutated(({ map: copy }) => {
    copy.overrides.push(structuredClone(copy.overrides[0]));
  });
  assert.ok(codes(twice).includes("E_SHAPE"));
  assert.match(twice.problems.map((problem) => problem.message).join("\n"), /overridden twice/);
});

test("a reason is required wherever the map departs from the default", () => {
  const rule = (change) => mutated(({ map: copy }) => change(copy.rules));
  assert.ok(codes(rule((rules) => delete rules.find((candidate) => candidate.id === "api-gf03-root-names").why)).includes("E_REASON"));
  const noScopeReason = rule((rules) => delete rules.find((candidate) => candidate.id === "api-gf40-experimental").scopeReason);
  assert.match(messages(noScopeReason, "E_REASON"), /api-gf40-experimental: scope post_1_0 needs a scopeReason/);
  const noPlatformReason = rule((rules) => {
    rules.find((candidate) => candidate.id === "os-settings").applicability = { android: { status: "not-applicable" } };
  });
  assert.match(messages(noPlatformReason, "E_REASON"), /os-settings: android not-applicable needs a reason/);
  const noOverrideReason = mutated(({ map: copy }) => delete copy.overrides[0].reason);
  assert.match(messages(noOverrideReason, "E_REASON"), /override .*: a reason is required/);
  const noProfileReason = mutated(({ map: copy }) => delete copy.applicabilityProfiles["ios-only-tagged"].android.reason);
  assert.match(messages(noProfileReason, "E_REASON"), /profile ios-only-tagged: android not-applicable needs a reason/);
  const noGateReason = mutated(({ map: copy }) => delete copy.gateModel.gates.__DEV__.reason);
  assert.match(messages(noGateReason, "E_REASON"), /gate __DEV__: a reason is required/);
  const noLinkReason = mutated(({ map: copy }) => delete copy.nativeComponents.ViewNativeComponent.reason);
  assert.match(messages(noLinkReason, "E_REASON"), /nativeComponents\.ViewNativeComponent: a reason is required/);
});

test("a malformed map is rejected before it is resolved", () => {
  const bad = (change) => mutated(({ map: copy }) => change(copy));
  assert.ok(codes(bad((copy) => { copy.rules[0].precedence = "high"; })).includes("E_SHAPE"));
  assert.ok(codes(bad((copy) => { copy.rules[0].match = { colour: "red" }; })).includes("E_SHAPE"));
  assert.ok(codes(bad((copy) => { copy.rules[0].match = { name: { pattern: "(" } }; })).includes("E_SHAPE"));
  assert.ok(codes(bad((copy) => { copy.rules[0].scope = "someday"; })).includes("E_SHAPE"));
  assert.ok(codes(bad((copy) => { copy.rules[0].applicability = "no-such-profile"; })).includes("E_SHAPE"));
  assert.ok(codes(bad((copy) => { copy.rules[0].applicability = { godot: "maybe" }; })).includes("E_SHAPE"));
  assert.ok(codes(bad((copy) => { copy.rules[1].id = copy.rules[0].id; })).includes("E_SHAPE"));
  assert.ok(codes(bad((copy) => { copy.reactNative = "0.88.0"; })).includes("E_SHAPE"));
  assert.ok(codes(bad((copy) => { delete copy.gateModel; })).includes("E_SHAPE"));
});

test("the gates of runtime-global sites are classified, and a new or unused gate fails the gate", () => {
  const result = mutated(({ inventory: copy }) => {
    copy.contracts.find((row) => row.id === "runtime-global:global.setImmediate").sites.push({
      installer: "x.js", source: "x.js", form: "assignment", gates: ["global.RN$SomethingNew === true"],
    });
  });
  assert.match(messages(result, "E_UNKNOWN_GATE"), /RN\$SomethingNew/);
  const stale = mutated(({ map: copy }) => {
    copy.gateModel.gates["global.noSiteHasThis"] = { state: "live", reason: "unused" };
  });
  assert.match(messages(stale, "E_STALE_GATE"), /noSiteHasThis/);
  assert.ok(codes(mutated(({ map: copy }) => { copy.gateModel.gates.__DEV__.state = "maybe"; })).includes("E_SHAPE"));
});

test("a native command file that is not linked to a public component fails the gate", () => {
  const unlinked = mutated(({ map: copy }) => {
    delete copy.nativeComponents.ScrollViewCommands;
  });
  assert.match(messages(unlinked, "E_UNLINKED_COMMAND"), /ScrollViewCommands/);
  const stale = mutated(({ map: copy }) => {
    copy.nativeComponents.GoneNativeComponent = { component: "View", reason: "removed upstream" };
  });
  assert.match(messages(stale, "E_UNLINKED_COMMAND"), /GoneNativeComponent, which declares no native command/);
  const missing = mutated(({ map: copy }) => {
    copy.nativeComponents.ViewNativeComponent.component = "NoSuchComponent";
  });
  assert.match(messages(missing, "E_UNLINKED_COMMAND"), /NoSuchComponent is not a public value/);
});

test("the command line fails on a mutated map and names the problem", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "fabric-map-"));
  try {
    const broken = structuredClone(map);
    broken.rules = broken.rules.filter((rule) => rule.id !== "api-gf08-refs");
    const file = path.join(directory, "map.json");
    writeFileSync(file, JSON.stringify(broken));
    const result = spawnSync(process.execPath, ["scripts/parity-map.mjs", "--check", "--map", file], { cwd: root, encoding: "utf8", timeout: 60000 });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /E_UNMAPPED: \d+ rows have no owner, first: api-member:UIManager\.blur/);
    assert.match(result.stderr, /PARITY_MAP_FAILED: \d+ problems/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("every one of the 97 root values resolves to the audit's GF and scope", () => {
  assert.equal(seed.exports.length, 97);
  const values = inventory.contracts.filter((row) => row.kind === "value");
  assert.deepEqual(values.map((row) => row.name).sort(), seed.exports.map((entry) => entry.name).sort());
  // The audit is a dated snapshot that nothing validates. Its owners and targets agree with the acceptance texts the map follows,
  // so no value needs an override; a future disagreement belongs in the map (an override with its reason), not in this test.
  for (const entry of seed.exports) {
    const row = rowOf(`value:react-native.${entry.name}`);
    assert.equal(row.owner, entry.roadmap, `${entry.name}: the audit says ${entry.roadmap}`);
    assert.equal(row.scope, entry.target, `${entry.name}: the audit says ${entry.target}`);
  }
  assert.deepEqual(map.overrides.filter((override) => override.id.startsWith("value:")), []);
  assert.equal(seed.exports.filter((entry) => entry.target === "1_0").length, 84);
  assert.equal(values.filter((row) => rowOf(row.id).scope === "post_1_0").length, 13);
});

test("the map agrees with the 0.5 prop classification the repository already executes", () => {
  // aria-modal: the declarations annotate it @platform ios and View.js maps it to accessibilityViewIsModal, which iOS reads;
  // the 0.5 table says "ios-drops" because RN's iOS view config does not list the raw name.
  const knownDisagreements = new Set(["View.aria-modal"]);
  const checked = { supported: 0, iosDrops: 0, androidNative: 0, refused: 0 };
  for (const component of scopedComponents) {
    const owner = propScope[component].owner;
    for (const [name, entry] of propTable(component)) {
      const row = rowOf(`prop:${owner}.${name}`) ?? rowOf(`event:${owner}.${name}`);
      assert.ok(row, `${component}.${name} is a row of the inventory`);
      if (entry.decision === "supported") {
        checked.supported++;
        assert.notEqual(row.applicability.godot.status, "not-applicable", `${component}.${name} is supported on this host today`);
      }
      if (entry.decision === "refused" && entry.basis === "ios") {
        checked.refused++;
        assert.equal(row.applicability.ios.status, "applies", `${component}.${name}: iOS reads it`);
      }
      if (entry.decision === "ignored" && ["ios-drops", "android-native"].includes(entry.basis) && !knownDisagreements.has(`${component}.${name}`)) {
        checked[entry.basis === "ios-drops" ? "iosDrops" : "androidNative"]++;
        assert.equal(row.applicability.ios.status, "not-applicable", `${component}.${name}: RN's iOS does not read it (${entry.basis})`);
      }
    }
  }
  assert.ok(checked.supported > 300 && checked.refused > 10 && checked.iosDrops > 50 && checked.androidNative > 5, JSON.stringify(checked));
});

test("the platform marker of the inventory is evidence that the map answers, row by row", () => {
  const marked = inventory.contracts.filter((row) => row.platformImplementation);
  assert.equal(marked.length, 74);
  for (const row of marked) {
    const { applicability } = rowOf(row.id);
    assert.ok(["applies", "not-applicable", "host-provides"].includes(applicability.godot.status), row.id);
    if (!row.platformImplementation.includes("android")) {
      assert.notEqual(applicability.android.status, "applies", `${row.id}: only iOS implements it`);
    }
    if (!row.platformImplementation.includes("ios")) {
      assert.notEqual(applicability.ios.status, "applies", `${row.id}: only Android implements it`);
    }
  }
  // The map, not the marker, decides Godot: Settings is marked iOS-only and GF-23 delivers it; Platform has two implementations
  // and is Godot's own (GF-09); ActionSheetIOS is iOS-only and its Godot contract is the upstream unavailability (GF-24).
  assert.equal(rowOf("value:react-native.Settings").applicability.godot.status, "applies");
  assert.equal(rowOf("api-member:Settings.get").applicability.android.status, "not-applicable");
  assert.equal(rowOf("value:react-native.Platform").applicability.godot.status, "applies");
  assert.equal(rowOf("value:react-native.ActionSheetIOS").applicability.godot.status, "not-applicable");
  assert.equal(rowOf("value:react-native.ToastAndroid").applicability.ios.status, "not-applicable");
  assert.equal(rowOf("value:react-native.PermissionsAndroid").applicability.android.status, "applies");
});

function platformTags() {
  const base = path.join(root, "node_modules/react-native/types_generated");
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const file = path.join(directory, entry);
      if (statSync(file).isDirectory()) {
        walk(file);
      } else if (file.endsWith(".d.ts")) {
        files.push(file);
      }
    }
  };
  walk(base);
  const members = new Set(["PropertySignature", "MethodSignature", "PropertyDeclaration", "MethodDeclaration", "GetAccessor"]);
  const tags = new Map();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("@platform")) {
      continue;
    }
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true);
    const visit = (node) => {
      for (const tag of ts.getJSDocTags(node)) {
        if (tag.tagName.text === "platform" && members.has(ts.SyntaxKind[node.kind])) {
          const name = node.name.getText(source).replace(/^"|"$/g, "");
          const platforms = ts.getTextOfJSDocComment(tag.comment)?.split("\n")[0].trim() ?? "";
          const key = `types_generated/${path.relative(base, file)}#${name}`;
          tags.set(key, new Set([...(tags.get(key) ?? []), platforms]));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return tags;
}

test("the @platform annotations of the pinned declarations decide iOS and Android for the members they tag", () => {
  const tags = platformTags();
  assert.ok(tags.size > 150, `${tags.size} annotated members`);
  // Tags that name no single platform (size is Android for one of its types, Version and constants are per platform getters)
  // or that two declarations tag differently.
  const skipped = new Set(["Version", "constants", "hasTVPreferredFocus", "size"]);
  const kinds = new Set(["prop", "event", "style", "api-member", "ref-member", "type-member"]);
  let checked = 0;
  for (const [key, platformSets] of tags) {
    const [source, name] = key.split("#");
    const platforms = [...platformSets];
    if (skipped.has(name) || platforms.length !== 1) {
      continue;
    }
    const expectation = { ios: "ios", android: "android", "android, tv": "android", "macos windows": "desktop" }[platforms[0]];
    if (expectation === undefined) {
      continue;
    }
    for (const row of inventory.contracts.filter((candidate) => candidate.source === source && candidate.name === name && kinds.has(candidate.kind))) {
      const { applicability, via } = rowOf(row.id);
      // A component-level decision (an OS-only component, an inventory artefact, a per-row override) outranks a member tag.
      const decided = (platform) => !/^(os-|out-|override)/.test(via[platform]);
      if (decided("ios")) {
        assert.equal(applicability.ios.status, expectation === "ios" ? "applies" : "not-applicable", `${row.id} ios: ${platforms[0]}`);
      }
      if (decided("android")) {
        assert.equal(applicability.android.status, expectation === "android" ? "applies" : "not-applicable", `${row.id} android: ${platforms[0]}`);
      }
      if (expectation === "desktop") {
        assert.equal(applicability.godot.status, "applies", row.id);
      }
      checked++;
    }
  }
  assert.ok(checked > 700, `${checked} rows checked against their annotations`);
});

test("a runtime-global is the host's when every RN site that would install it is dead in bridgeless mode", () => {
  // An independent oracle: RN's own setUpTimers.js. The names the bridgeless block installs, and the names the else block installs.
  const text = readFileSync(path.join(root, "node_modules/react-native/Libraries/Core/setUpTimers.js"), "utf8");
  const split = text.indexOf("} else {");
  const bridgeless = text.slice(text.indexOf("if (global.RN$Bridgeless === true)"), split);
  const legacy = text.slice(split);
  const installed = (block) => new Set([...block.matchAll(/polyfillGlobal\(\s*'([^']+)'|defineLazyTimer\('([^']+)'\)/g)].map((match) => match[1] ?? match[2]));
  const fromBridgeless = installed(bridgeless);
  const fromLegacy = installed(legacy);
  const hostOnly = [...fromLegacy].filter((name) => !fromBridgeless.has(name)).sort();
  assert.deepEqual(hostOnly, ["cancelAnimationFrame", "clearInterval", "clearTimeout", "requestAnimationFrame", "setInterval", "setTimeout"]);
  for (const name of hostOnly) {
    for (const id of [`runtime-global:global.${name}`, `global-value:global.${name}`]) {
      const row = rowOf(id);
      assert.deepEqual(["ios", "android", "godot"].map((platform) => row.applicability[platform].status), ["host-provides", "host-provides", "host-provides"], id);
      assert.equal(row.owner, "GF-05", id);
    }
  }
  for (const name of fromBridgeless) {
    assert.equal(rowOf(`runtime-global:global.${name}`).applicability.godot.status, "applies", `${name} is installed by RN's JS in bridgeless mode`);
  }
  // The rest of the host-provides set: Web Performance classes (module gate) on Godot, and the host globals RN only reads.
  const hostProvides = [...outcome.resolved.values()].filter((row) => row.applicability.godot.status === "host-provides");
  assert.equal(hostProvides.filter((row) => row.kind === "runtime-global" && !hostOnly.some((name) => row.id.endsWith(`.${name}`))).length, 11);
  assert.equal(rowOf("runtime-global:global.performance").applicability.godot.status, "applies");
  assert.equal(rowOf("runtime-global:global.PerformanceObserver").applicability.godot.status, "host-provides");
  assert.equal(rowOf("runtime-global:global.PerformanceObserver").applicability.ios.status, "applies");
  assert.equal(hostProvides.filter((row) => row.kind === "host-global").length, inventory.counts["host-global"] - 4, "all but the four legacy-bridge globals");
  // Gate-derived rows: dev-only and default-off flags are decided by the gates, not by name.
  assert.equal(rowOf("runtime-global:global.__ReactRefresh").owner, "GF-29");
  assert.equal(rowOf("runtime-global:global.IntersectionObserver").scope, "post_1_0");
  assert.equal(rowOf("runtime-global:global.MutationRecord").owner, "GF-40");
  const { attributes } = derive(inventory.contracts, map.gateModel.gates);
  assert.equal(attributes.get("runtime-global:global.setImmediate").installedBy, "rn");
  assert.equal(attributes.get("runtime-global:global.setTimeout").installedBy, "host");
  assert.equal(attributes.get("global-value:global.setTimeout").installedBy, "host");
});

test("host globals RN reads only on the legacy bridge are out of the target", () => {
  for (const name of ["__fbBatchedBridgeConfig", "nativeRequireModuleConfig", "nativeFlushQueueImmediate", "nativeCallSyncHook"]) {
    const row = rowOf(`host-global:global.${name}`);
    assert.equal(row.scope, "out", name);
    assert.deepEqual(["ios", "android", "godot"].map((platform) => row.applicability[platform].status), ["not-applicable", "not-applicable", "not-applicable"], name);
  }
  for (const name of ["nativeModuleProxy", "__turboModuleProxy", "nativeFabricUIManager", "RN$Bridgeless", "RN$registerCallableModule"]) {
    assert.equal(rowOf(`host-global:global.${name}`).applicability.godot.status, "host-provides", name);
  }
});

test("each native command file is linked to its public component, and its owner follows the component's task", () => {
  const files = [...new Set(inventory.contracts.filter((row) => row.kind === "native-command").map((row) => row.owner))].sort();
  assert.equal(files.length, 12);
  assert.deepEqual(Object.keys(map.nativeComponents).sort(), files);
  assert.deepEqual(Object.fromEntries(Object.entries(map.nativeComponents).map(([file, link]) => [file, link.component])), {
    AndroidDrawerLayoutNativeComponent: "DrawerLayoutAndroid", AndroidSwipeRefreshLayoutNativeComponent: "RefreshControl",
    AndroidSwitchNativeComponent: "Switch", AndroidTextInputNativeComponent: "TextInput", DebuggingOverlayNativeComponent: null,
    ImageViewNativeComponent: "Image", PullToRefreshViewNativeComponent: "RefreshControl", RCTMultilineTextInputNativeComponent: "TextInput",
    RCTSingelineTextInputNativeComponent: "TextInput", ScrollViewCommands: "ScrollView", SwitchNativeComponent: "Switch", ViewNativeComponent: "View",
  });
  // The seed names the public component's task; View's commands are the exception: focus and blur are the ref API (GF-08) and
  // the ripple commands belong to TouchableNativeFeedback (GF-24), while GF-10 owns View's props and styles.
  const exceptions = new Set(["ViewNativeComponent", "DebuggingOverlayNativeComponent"]);
  for (const row of inventory.contracts.filter((candidate) => candidate.kind === "native-command" && !exceptions.has(candidate.owner))) {
    const component = map.nativeComponents[row.owner].component;
    assert.equal(rowOf(row.id).owner, rowOf(`value:react-native.${component}`).owner, `${row.id} follows ${component}`);
  }
  assert.equal(rowOf("native-command:ViewNativeComponent.focus").owner, "GF-08");
  assert.equal(rowOf("native-command:ViewNativeComponent.setPressed").owner, "GF-24");
  assert.equal(rowOf("native-command:DebuggingOverlayNativeComponent.highlightElements").owner, "GF-29");
  // Godot takes the branch RN's JS takes for a Platform.OS that is neither ios nor android.
  const godot = (id) => rowOf(id).applicability.godot.status;
  assert.equal(godot("native-command:SwitchNativeComponent.setValue"), "applies");
  assert.equal(godot("native-command:AndroidSwitchNativeComponent.setNativeValue"), "not-applicable");
  assert.equal(godot("native-command:AndroidSwipeRefreshLayoutNativeComponent.setNativeRefreshing"), "applies");
  assert.equal(godot("native-command:PullToRefreshViewNativeComponent.setNativeRefreshing"), "not-applicable");
  assert.equal(godot("native-command:AndroidDrawerLayoutNativeComponent.openDrawer"), "not-applicable");
});

test("the rows the inventory read through built-in types are out of the target, with their reason", () => {
  const outRows = [...outcome.resolved.values()].filter((row) => row.scope === "out");
  const byRule = {};
  for (const row of outRows) {
    byRule[row.via.scope] = (byRule[row.via.scope] ?? 0) + 1;
    assert.ok(row.scopeReason, row.id);
  }
  assert.deepEqual(Object.keys(byRule).sort(), ["host-legacy-bridge", "out-class-instance-members", "out-ecmascript-members", "out-react-class-statics"]);
  // 29 string-literal union types list the 52 String.prototype members each.
  const stringMembers = inventory.contracts.filter((row) => row.kind === "type-member" && row.name === "charAt");
  assert.equal(stringMembers.length, 29);
  assert.ok(stringMembers.every((row) => rowOf(row.id).scope === "out"));
  // A real member that happens to share a name with a built-in keeps its place: those rows have a declaring source.
  for (const row of inventory.contracts.filter((candidate) => ["type-member", "ref-member", "api-member"].includes(candidate.kind) && candidate.source)) {
    assert.ok(!/^out-/.test(rowOf(row.id).via.scope), `${row.id} has a source and is a contract`);
  }
});

test("the accessibility and input families are owned across components, and the DOM node API by the refs task", () => {
  assert.equal(rowOf("prop:ViewProps.accessibilityLabel").owner, "GF-20");
  assert.equal(rowOf("prop:SwitchProps.accessibilityLabel").owner, "GF-20");
  assert.equal(rowOf("event:ViewProps.onAccessibilityAction").owner, "GF-20");
  assert.equal(rowOf("event:ScrollViewProps.onPointerDown").owner, "GF-13");
  assert.equal(rowOf("prop:ViewProps.hitSlop").owner, "GF-13");
  assert.equal(rowOf("event:ViewProps.onLayout").owner, "GF-10");
  assert.equal(rowOf("prop:SwitchProps.value").owner, "GF-17");
  assert.equal(rowOf("ref-member:ViewInstance.measure").owner, "GF-08");
  assert.equal(rowOf("ref-member:ScrollViewInstance.scrollTo").owner, "GF-14");
  assert.equal(rowOf("ref-member:TextInputInstance.isFocused").owner, "GF-12");
  assert.equal(rowOf("style:TextStyle.fontSize").owner, "GF-11");
  assert.equal(subjectOf({ owner: "react-native", name: "Text" }), "Text");
  assert.equal(subjectOf({ owner: "TextProps", name: "style" }), "TextProps");
  assert.equal(rowOf("value:react-native.Text").owner, "GF-11");
  assert.equal(rowOf("runtime-global:global.Text").owner, "GF-08", "the DOM Text class is not the Text component");
});

test("rows the audit leaves to a later task or an OS keep their reasons visible", () => {
  assert.equal(rowOf("value:react-native.unstable_VirtualView").scope, "post_1_0");
  assert.equal(rowOf("prop:LayoutConformanceProps.mode").scope, "post_1_0");
  assert.equal(rowOf("api-member:AppRegistry.startHeadlessTask").applicability.ios.status, "not-applicable");
  assert.equal(rowOf("api-member:AppRegistry.registerComponent").applicability.ios.status, "applies");
  assert.equal(rowOf("api-member:Image.prefetch").owner, "GF-22");
  assert.equal(rowOf("api-member:Image.getSize").owner, "GF-16");
  assert.equal(rowOf("prop:PressableProps.android_ripple").applicability.godot.status, "not-applicable");
  assert.equal(rowOf("prop:PressableProps.delayHoverIn").applicability.godot.status, "applies");
  assert.equal(rowOf("style:ViewStyle.elevation").applicability.ios.status, "not-applicable");
  assert.equal(rowOf("event:ViewProps.onKeyDown").applicability.ios.status, "not-applicable");
  assert.equal(rowOf("event:ViewProps.onKeyDown").applicability.android.status, "applies");
  assert.equal(rowOf("event:ViewProps.onMouseEnter").applicability.android.status, "not-applicable");
});
