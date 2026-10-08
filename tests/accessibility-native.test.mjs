import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {accessibilityNativeProducers, bundleAccessibilityProbe} from "../scripts/accessibility-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {accessibilityRoles, ariaRoles} from "../src/accessibility-view-config.js";
import {normativeOriginalFailures, oracleRejection, rejectedRoles, rnVocabularies, roleTable, supportedNames,
  verifyAccessibilityReport} from "./accessibility-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The preceding host has no accessible View: --allow-original-negative runs the same bundle on it and only
// the normative failures may fail. --sabotage[=name] runs it on a host whose accessible View was broken on
// purpose (scripts/accessibility-sabotage.mjs builds those hosts and restores the sources); the probe and the
// independent oracle both have to reject it.
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? "name");
assert.ok([null, "name", "click", "roles", "hidden"].includes(sabotage), "Unknown sabotage: " + sabotage);
const lane = allowOriginalNegative ? "original" : sabotage === null ? "current" : `sabotage-${sabotage}`;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();

async function optionalJson(file) {
  try {
    return JSON.parse(await readFile(path.join(root, file), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function runProbe(binary, bundle) {
  await rm(path.join(root, "build/accessibility-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/accessibility-probe.gd", "--",
    ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])],
  {encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/accessibility-${lane}.log`), log);
  const report = await optionalJson("build/accessibility-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/accessibility-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  return {result, log, report};
}

// The role table lives in four places that must say the same thing: the C++ core that decides, the oracle that
// judges, the JS that validates and types the props, and the research note. A change to one fails here.
function splitArguments(text) {
  const parts = [];
  let depth = 0, quoted = false, current = "";
  for (const character of text) {
    if (character === '"') {
      quoted = !quoted;
    }
    if (!quoted && character === "{") {
      depth++;
    }
    if (!quoted && character === "}") {
      depth--;
    }
    if (!quoted && depth === 0 && character === ",") {
      parts.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  parts.push(current.trim());
  return parts;
}
const unquote = value => (value === "{}" ? "" : value.replace(/^"|"$/g, ""));
async function coreTable() {
  const source = await readFile(path.join(root, "native/accessibility_core.h"), "utf8");
  const rules = [];
  for (const match of source.matchAll(/^\s*detail::(supported|rejected)\("([a-z]+)", (true|false), (true|false), (.*)\),$/gm)) {
    const [, kind, name, accessibilityRole, role, rest] = match;
    const rule = {name, kind, accessibilityRole: accessibilityRole === "true", role: role === "true"};
    if (kind === "supported") {
      const [godotRole = "{}", description = "{}", capabilities = ""] = splitArguments(rest);
      Object.assign(rule, {godotRole: unquote(godotRole), description: unquote(description),
        capabilities: [["Checkable", "c"], ["Selectable", "s"], ["Expandable", "e"], ["Activatable", "p"]]
          .filter(([word]) => capabilities.includes(word)).map(([, letter]) => letter).sort().join("")});
    }
    rules.push(rule);
  }
  return rules;
}
async function assertRoleTablesAgree() {
  const rules = await coreTable();
  assert.equal(new Set(rules.map(rule => rule.name)).size, rules.length, "A name appears once in the core table");
  for (const vocabulary of ["a", "r"]) {
    const flag = vocabulary === "a" ? "accessibilityRole" : "role";
    const mapped = rules.filter(rule => rule.kind === "supported" && rule[flag]);
    assert.deepEqual(sorted(mapped.map(rule => rule.name)), sorted(supportedNames(vocabulary)), `core and oracle map the same ${flag} names`);
    assert.deepEqual(sorted(rules.filter(rule => rule.kind === "rejected" && rule[flag]).map(rule => rule.name)),
      sorted(rejectedRoles[vocabulary]), `core and oracle reject the same ${flag} names`);
    assert.deepEqual(sorted([...mapped, ...rules.filter(rule => rule.kind === "rejected" && rule[flag])].map(rule => rule.name)),
      sorted(rnVocabularies[vocabulary]), `core covers exactly RN's ${flag} vocabulary`);
  }
  for (const [name, vocabularies, godotRole, description, capabilities] of roleTable) {
    const rule = rules.find(entry => entry.name === name);
    assert.ok(rule && rule.kind === "supported", name);
    assert.deepEqual([rule.accessibilityRole, rule.role], [vocabularies.includes("a"), vocabularies.includes("r")], name);
    assert.deepEqual([rule.godotRole, rule.description, rule.capabilities], [godotRole ?? "", description, [...capabilities].sort().join("")], name);
  }
  // The JS validates and types the vocabularies RN spells.
  assert.deepEqual(sorted(accessibilityRoles), sorted(rnVocabularies.a));
  assert.deepEqual(sorted(ariaRoles), sorted(rnVocabularies.r));
  const types = await readFile(path.join(root, "types/react-native.ts"), "utf8");
  for (const [type, vocabulary] of [["AccessibilityRole", "a"], ["AccessibilityAriaRole", "r"]]) {
    const declaration = types.match(new RegExp(`export type ${type} =([^;]*);`))[1];
    assert.deepEqual(sorted([...declaration.matchAll(/"([a-z]+)"/g)].map(match => match[1])), sorted(supportedNames(vocabulary)),
      `${type} lists exactly the roles the host maps`);
  }
  // The research note publishes the table.
  const note = await readFile(path.join(root, "docs/research/accessibility.md"), "utf8");
  const published = [...note.matchAll(/^\| `([a-z]+)` \| ([A-Za-z ,]+) \| (`ROLE_[A-Z_]+`|none) \| ([^|]*) \| ([^|]*) \|$/gm)];
  assert.equal(published.length, roleTable.length, "The note lists each mapped role once");
  for (const [, name, vocabularies, godotRole, description, capabilities] of published) {
    const row = roleTable.find(entry => entry[0] === name);
    assert.ok(row, name);
    assert.equal(vocabularies.trim(), [row[1].includes("a") ? "accessibilityRole" : null, row[1].includes("r") ? "role" : null].filter(Boolean).join(", "), name);
    assert.equal(godotRole, row[2] === null ? "none" : "`" + row[2] + "`", name);
    assert.equal(description.trim().replace(/^`|`$/g, "").replace(/^-$/, ""), row[3], name);
    assert.equal([...capabilities.trim() === "-" ? "" : capabilities.trim().split(", ").map(word => ({checked: "c", selected: "s", expanded: "e", pressed: "p"})[word]).join("")].sort().join(""),
      [...row[4]].sort().join(""), name);
  }
  for (const vocabulary of ["a", "r"]) {
    for (const name of rejectedRoles[vocabulary]) {
      assert.match(note, new RegExp("`" + name + "`"), `The note names the rejected role ${name}`);
    }
  }
}

test("RN's original View, Pressable and TouchableOpacity carry their accessibility props to the host's accessible View, and the OS's press reaches RN", async () => {
  // The pure core has its own unit test. A broken core is judged through the probe in a sabotage run.
  if (sabotage === null && !allowOriginalNegative) {
    const unit = spawnSync(path.join(root, ".deps/build/accessibility_core_test"), [], {encoding: "utf8", timeout: 20000});
    assert.equal(unit.error, undefined);
    assert.equal(unit.status, 0, unit.stdout + unit.stderr);
    assert.match(unit.stdout, /ACCESSIBILITY_CORE_PASSED \d+ assertions in 11 groups/);
    await assertRoleTablesAgree();
  }
  const bundle = await bundleAccessibilityProbe();
  const binary = await ensureGodotBinary();
  const {result, log, report} = await runProbe(binary, bundle);
  // Artifacts are saved before any assertion. The old-host flag accepts only the normative failures.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  // Every diagnostic is a failed check or a rejection the timeline expects: none hides.
  const fabricErrors = [...log.matchAll(/^ERROR: FABRIC_ERROR: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(fabricErrors, report.stages.beforeStop.application.errors, "Each host error is in the application's own list");
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length + fabricErrors.length, "No other diagnostic is hidden");
  for (const file of ["tests/accessibility-fixture.jsx", "tests/accessibility-probe.gd", "tests/accessibility-native.test.mjs",
    "tests/accessibility-oracle.mjs", "scripts/accessibility-bundle.mjs", "src/accessibility-view-config.js", "src/base-view-config.js",
    "src/react-native-platform.jsx", "sdk/toolchain/platform-plugin.mjs", ...accessibilityNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/Components/View/View.js", "Libraries/Components/Touchable/TouchableOpacity.js",
    "Libraries/Components/View/ViewAccessibility.js", "React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm",
    "ReactCommon/react/renderer/components/view/AccessibilityProps.cpp"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  assert.equal(report.scope.metadataOnly, true, "The report says what it proves: metadata, not the OS tree");
  if (allowOriginalNegative) {
    // The preceding host mounts every View as a plain Panel: nothing resolves a descriptor or sets a name.
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the descriptor checks qualify as the old-host control");
    assert.deepEqual(sorted(failures), sorted(normativeOriginalFailures));
    assert.match(log, new RegExp(`ACCESSIBILITY_ORIGINAL_NEGATIVE: ${failures.length}`));
    verifyAccessibilityReport(report, {original: true});
    return;
  }
  assert.equal(report.originalNegativeObserved, false);
  if (sabotage !== null) {
    assert.ok(failures.length > 0, "The probe's own checks reject the sabotaged host");
    assert.match(log, new RegExp(`ACCESSIBILITY_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the sabotaged report");
    return;
  }
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /ACCESSIBILITY_PASSED: \d+/);
  verifyAccessibilityReport(report);
  const original = await optionalJson("build/accessibility-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    // The preceding host stops after the static stage, which is where the descriptor it lacks is read: every check it
    // ran is a check of the current run, in the same order.
    assert.deepEqual(original.checks.map(row => row.name),
      report.checks.map(row => row.name).filter(name => original.checks.some(row => row.name === name)),
      "The checks of the preceding host are checks of the current run");
    // The normative checks of the later stages need the descriptor too; the preceding host never reaches them.
    assert.deepEqual(original.expectedOriginalFailures,
      report.expectedOriginalFailures.filter(name => original.checks.some(row => row.name === name)));
    assert.deepEqual(sorted(original.expectedOriginalFailures), sorted(normativeOriginalFailures));
    assert.deepEqual(original.provenance.bundle.originalReactNativeSources, bundle.originalReactNativeSources);
    // The same SDK bundle runs on both hosts; only the compiled native producers differ.
    assert.equal(original.provenance.bundle.bundle.sha256, bundle.bundle.sha256);
    for (const [file, sha] of Object.entries(bundle.sources)) {
      if (!accessibilityNativeProducers.includes(file) && file !== "native/accessibility_core_test.cpp") {
        assert.equal(original.provenance.bundle.sources[file], sha, "Old/new hosts share the reproducer and SDK producer: " + file);
      }
    }
    assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
  }
  await writeFile(path.join(root, "build/accessibility-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, sameSDKBundleRequired: true, intentionalNativeProducerDifferences: accessibilityNativeProducers,
    original, current: report}, null, 2) + "\n");
});
