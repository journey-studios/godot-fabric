import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveMap, subjectOf } from "../scripts/parity-map.mjs";
import { checkCatalog, coverageByOwner, defaultCoverageInputs, formatPending, pendingLedger } from "../scripts/parity-coverage.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const inputs = defaultCoverageInputs();
const { catalog, cases, inventory, dashboard } = inputs;
const baseline = checkCatalog(inputs);
const mapped = resolveMap(inputs);

// A copy of the inputs with a change applied, judged again. `files` is shared: the gate only reads them.
const mutated = (change) => {
  const copy = { ...inputs, catalog: structuredClone(catalog), cases: structuredClone(cases), map: structuredClone(inputs.map), inventory: structuredClone(inventory) };
  change(copy);
  return checkCatalog(copy);
};
const codes = (result) => [...new Set(result.problems.map((problem) => problem.code))].sort();
const messages = (result, code) => result.problems.filter((problem) => problem.code === code).map((problem) => problem.message).join("\n");
const entryOf = (copy, id) => copy.catalog.fixtures.find((entry) => entry.id === id);
const pendingOf = (copy, owner, polarity, subject) => copy.catalog.pending[owner].find((item) => item.polarity === polarity && item.select.subject === subject);
const withoutNotes = (ledger) => Object.fromEntries(Object.entries(ledger).map(([owner, list]) => [owner, list.map(({ note: _note, ...item }) => item)]));
// An existing test of this repository, to point a new entry at.
const SOME_TEST = { file: "tests/parity-map.test.mjs", test: "an unmapped row, such as one a new RN version adds, fails the gate" };

test("the committed catalog passes: every target row has its fixtures or is in the ledger, and every reference resolves", () => {
  assert.deepEqual(baseline.problems, []);
  const targets = [...mapped.resolved.values()].filter((row) => row.scope === "1_0");
  assert.equal(baseline.stats.rows, targets.length);
  assert.equal(baseline.stats.decided, catalog.decided.length);
  // The positive requirement is exactly the rows where Godot applies or the host provides; nothing else asks for a behavior fixture.
  const behavior = targets.filter((row) => ["applies", "host-provides"].includes(row.applicability.godot.status));
  assert.equal(baseline.coverage.required.positive.length, behavior.length);
  assert.ok(baseline.coverage.required.positive.every((row) => row.scope === "1_0"));
  const entries = coverageByOwner(baseline, dashboard);
  assert.equal(entries.reduce((sum, entry) => sum + entry.rows, 0), targets.length);
  for (const entry of entries) {
    for (const requirement of ["positive", "negative"]) {
      assert.ok(entry[requirement].covered <= entry[requirement].required, `${entry.owner} ${requirement}`);
    }
  }
  // The ledger is the gap, row for row: nothing is pending that a fixture covers, nothing uncovered is missing from it.
  const pending = Object.values(catalog.pending).flat().reduce((sum, item) => sum + item.count, 0);
  const gaps = baseline.coverage.gaps.positive.length + baseline.coverage.gaps.negative.length;
  assert.equal(pending, gaps);
  assert.ok(gaps > 0, "the catalog is a seed: most rows are still pending");
});

test("the committed ledger is what the fixtures imply, so a delivery can regenerate it after covering rows", () => {
  assert.deepEqual(withoutNotes(catalog.pending), pendingLedger(baseline));
  // Replacing the ledger by the implied one passes, whatever the fixtures are.
  const fewer = mutated((copy) => {
    copy.catalog.fixtures = copy.catalog.fixtures.filter((entry) => entry.id !== "switch");
    const outcome = checkCatalog(copy);
    copy.catalog.pending = pendingLedger(outcome);
  });
  assert.deepEqual(fewer.problems, []);
});

test("the command line prints the coverage per GF, --check passes, and --print-pending prints the implied ledger", () => {
  const checked = spawnSync(process.execPath, ["scripts/parity-coverage.mjs", "--check"], { cwd: root, encoding: "utf8", timeout: 60000 });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /^PARITY_COVERAGE_PASSED: 6312 target rows \(\+1 decided\), \d+ fixture entries, \d+ of \d+ required fixtures covered, \d+ pending$/m);
  const report = spawnSync(process.execPath, ["scripts/parity-coverage.mjs"], { cwd: root, encoding: "utf8", timeout: 60000 });
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /^GF-17 Shared widgets: \d+ target rows$/m);
  assert.match(report.stdout, /^ {2}positive +required \d+, covered \d+, pending \d+$/m);
  assert.match(report.stdout, /^ {2}rows with a fixture by polarity: positive \d+, negative \d+, host-provides \d+$/m);
  const printed = spawnSync(process.execPath, ["scripts/parity-coverage.mjs", "--print-pending"], { cwd: root, encoding: "utf8", timeout: 60000 });
  assert.equal(printed.status, 0, printed.stderr);
  assert.deepEqual(JSON.parse(printed.stdout), pendingLedger(baseline));
  assert.equal(printed.stdout.trimEnd(), formatPending(pendingLedger(baseline)));
});

test("--check exits 1 and names every problem when the catalog is wrong", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "fabric-coverage-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const broken = structuredClone(catalog);
  delete broken.pending["GF-26"];
  broken.fixtures.find((entry) => entry.id === "switch").fixture = { file: "tests/switch-native.test.mjs", test: "a renamed test" };
  const file = path.join(directory, "catalog.json");
  writeFileSync(file, JSON.stringify(broken));
  const failed = spawnSync(process.execPath, ["scripts/parity-coverage.mjs", "--check", "--catalog", file], { cwd: root, encoding: "utf8", timeout: 60000 });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /^E_FIXTURE: fixture switch: tests\/switch-native\.test\.mjs has no test named "a renamed test"$/m);
  assert.match(failed.stderr, /^E_UNLEDGERED: GF-26 positive: 11 target rows/m);
  assert.match(failed.stderr, /^PARITY_COVERAGE_FAILED: 2 problems$/m);
  assert.equal(failed.stdout, "");
});

test("the catalog and the map agree on the polarity rules: unavailability, decisions and refusals ask for a negative fixture", () => {
  const required = new Set(baseline.coverage.required.negative.map((row) => row.id));
  const unavailable = [...mapped.resolved.values()].filter((row) => row.scope === "1_0" && /\(unavailability, GF-24\)|reproduces what upstream does/.test(row.applicability.godot.reason ?? ""));
  assert.ok(unavailable.length > 400);
  assert.ok(unavailable.every((row) => required.has(row.id)));
  // The user decided that AppRegistry's headless-task members throw a typed error and that TextDecoder stays absent.
  for (const id of ["api-member:AppRegistry.registerHeadlessTask", "api-member:AppRegistry.startHeadlessTask", "decided:TextDecoder"]) {
    assert.ok(required.has(id), id);
  }
  // A not-applicable row that is not an upstream unavailability asks for none, and neither does an out-of-scope row.
  assert.ok(!required.has("prop:SwitchProps.ios_backgroundColor"));
  assert.ok(baseline.rows.filter((row) => row.scope !== "1_0").every((row) => !required.has(row.id)));
  // Both are pending: no fixture exists yet, and the ledger says why.
  assert.match(pendingOf({ catalog }, "GF-05", "negative", "TextDecoder").note, /slice E/);
  assert.match(pendingOf({ catalog }, "GF-07", "negative", "AppRegistry").note, /#160/);
  // A row with no fixture of the polarity it requires is a gap, however many other fixtures cover it.
  const positiveOnly = mutated((copy) => {
    copy.catalog.fixtures = copy.catalog.fixtures.filter((entry) => entry.id !== "device-services-invalid-url");
  });
  assert.deepEqual(codes(positiveOnly), ["E_UNLEDGERED"]);
  assert.match(messages(positiveOnly, "E_UNLEDGERED"), /GF-23 negative: 2 target rows have no fixture/);
  assert.match(messages(positiveOnly, "E_UNLEDGERED"), /api-member:Linking\.openURL/);
});

test("a gap that is not in the pending ledger fails, per owner and polarity", () => {
  const lost = mutated((copy) => {
    copy.catalog.pending["GF-03"] = copy.catalog.pending["GF-03"].filter((item) => item.select.subject !== "ReactNativeVersion");
  });
  assert.deepEqual(codes(lost), ["E_UNLEDGERED"]);
  assert.match(messages(lost, "E_UNLEDGERED"), /^GF-03 positive: 6 target rows have no fixture and are not in the pending ledger, first: .*ReactNativeVersion/);
  // Dropping a covering entry opens a gap on every row it covered.
  const uncovered = mutated((copy) => {
    copy.catalog.fixtures = copy.catalog.fixtures.filter((entry) => entry.id !== "activity-indicator");
  });
  // The value row was covered outright and had no ledger entry; the props are in the ledger, whose count is now short.
  assert.match(messages(uncovered, "E_UNLEDGERED"), /^GF-17 positive: 1 target rows have no fixture and are not in the pending ledger, first: value:react-native\.ActivityIndicator$/);
  assert.match(messages(uncovered, "E_PENDING_COUNT"), /ActivityIndicatorProps.* says 11 but 15 rows are uncovered; set the count to 15/);
  // A whole owner missing from the ledger is reported owner by owner.
  const owner = mutated((copy) => {
    delete copy.catalog.pending["GF-26"];
  });
  assert.match(messages(owner, "E_UNLEDGERED"), /^GF-26 positive: 11 target rows/);
  // The decided contract is a gap too, and the TextDecoder shows by its id.
  const decided = mutated((copy) => {
    copy.catalog.pending["GF-05"] = copy.catalog.pending["GF-05"].filter((item) => item.select.subject !== "TextDecoder");
  });
  assert.match(messages(decided, "E_UNLEDGERED"), /GF-05 negative: 1 target rows have no fixture.*decided:TextDecoder/);
});

test("a pending entry whose rows a fixture now covers is stale, and a count that is too high or too low says what it should be", () => {
  const covered = mutated((copy) => {
    copy.catalog.fixtures.push({ id: "covers-batched-updates", fixture: SOME_TEST, polarity: "positive", runsOn: ["godot"], select: { id: "value:react-native.unstable_batchedUpdates" } });
  });
  assert.deepEqual(codes(covered), ["E_STALE_PENDING"]);
  assert.match(messages(covered, "E_STALE_PENDING"), /GF-06 positive .*unstable_batchedUpdates.* has no uncovered row left; remove it/);
  const partial = mutated((copy) => {
    copy.catalog.fixtures.push({ id: "covers-two", fixture: SOME_TEST, polarity: "positive", runsOn: ["godot"], select: { id: ["api-member:ReactNativeVersion.major", "api-member:ReactNativeVersion.minor"] } });
  });
  assert.deepEqual(codes(partial), ["E_PENDING_COUNT"]);
  assert.match(messages(partial, "E_PENDING_COUNT"), /says 6 but 4 rows are uncovered; set the count to 4/);
  // Lowering the count as the message says is the whole change a delivery makes to the ledger.
  const lowered = mutated((copy) => {
    copy.catalog.fixtures.push({ id: "covers-two", fixture: SOME_TEST, polarity: "positive", runsOn: ["godot"], select: { id: ["api-member:ReactNativeVersion.major", "api-member:ReactNativeVersion.minor"] } });
    pendingOf(copy, "GF-03", "positive", "ReactNativeVersion").count = 4;
  });
  assert.deepEqual(lowered.problems, []);
  const high = mutated((copy) => {
    pendingOf(copy, "GF-03", "positive", "ReactNativeVersion").count = 7;
  });
  assert.match(messages(high, "E_PENDING_COUNT"), /says 7 but 6 rows are uncovered; set the count to 6/);
  // An RN upgrade that adds a row of a pending subject also fails: the count no longer matches.
  const grown = mutated((copy) => {
    copy.catalog.pending["GF-03"].find((item) => item.select.subject === "ReactNativeVersion").count = 5;
  });
  assert.match(messages(grown, "E_PENDING_COUNT"), /says 5 but 6 rows are uncovered/);
});

test("two pending entries may not list the same row, and an entry for another owner's row finds nothing", () => {
  const overlap = mutated((copy) => {
    copy.catalog.pending["GF-03"].push({ polarity: "positive", select: { id: "api-member:ReactNativeVersion.major" }, count: 1 });
  });
  assert.ok(codes(overlap).includes("E_PENDING_OVERLAP"));
  assert.match(messages(overlap, "E_PENDING_OVERLAP"), /api-member:ReactNativeVersion\.major is already in pending GF-03/);
  const foreign = mutated((copy) => {
    copy.catalog.pending["GF-05"].push({ polarity: "positive", select: { subject: "ReactNativeVersion" }, count: 6 });
  });
  assert.deepEqual(codes(foreign), ["E_DEAD_ENTRY"], "ReactNativeVersion is GF-03's: the entry picks no row of GF-05");
  assert.match(messages(foreign, "E_DEAD_ENTRY"), /pending GF-05 #\d+: its selector picks no row/);
  const unknown = mutated((copy) => {
    copy.catalog.pending["GF-99"] = [{ polarity: "positive", select: { subject: "View" }, count: 1 }];
  });
  assert.match(messages(unknown, "E_UNKNOWN_OWNER"), /GF-99/);
});

test("a fixture reference that does not exist fails: the case, the file, the check name and the test name", () => {
  const missingCase = mutated((copy) => {
    entryOf(copy, "parity-native-layout").fixture = { case: "no-such-case" };
  });
  // The entry still counts for the rows it covers, so the broken reference is reported once and not as a gap; the case it no longer
  // points at is left unclaimed.
  assert.deepEqual(codes(missingCase), ["E_CASE_CLAIM", "E_FIXTURE"]);
  assert.match(messages(missingCase, "E_FIXTURE"), /tests\/parity\/cases\.json has no case no-such-case/);
  const missingFile = mutated((copy) => {
    entryOf(copy, "switch").fixture = { file: "tests/no-such-suite-native.test.mjs", test: "x" };
  });
  assert.deepEqual(codes(missingFile), ["E_FIXTURE"]);
  assert.match(messages(missingFile, "E_FIXTURE"), /tests\/no-such-suite-native\.test\.mjs does not exist/);
  const missingCheck = mutated((copy) => {
    entryOf(copy, "switch-malformed-command").fixture = { file: "tests/switch-probe.gd", check: "A sentence the probe never states" };
  });
  assert.deepEqual(codes(missingCheck), ["E_FIXTURE"]);
  assert.match(messages(missingCheck, "E_FIXTURE"), /tests\/switch-probe\.gd has no string literal with the check "A sentence the probe never states"/);
  const missingTest = mutated((copy) => {
    entryOf(copy, "switch").fixture = { file: "tests/switch-native.test.mjs", test: "a renamed test" };
  });
  assert.deepEqual(codes(missingTest), ["E_FIXTURE"]);
  assert.match(messages(missingTest, "E_FIXTURE"), /tests\/switch-native\.test\.mjs has no test named "a renamed test"/);
  // The kind of reference matters: a check name of a probe is not a test() call.
  const comment = mutated((copy) => {
    entryOf(copy, "switch").fixture = { file: "tests/switch-probe.gd", test: "RN's original Switch over the native Switch descriptor, driven by actual Godot mouse and touch input" };
  });
  assert.deepEqual(codes(comment), ["E_FIXTURE"]);
  // Only one kind of reference at a time, and a file for a check or a test.
  const both = mutated((copy) => {
    entryOf(copy, "switch").fixture = { case: "native-layout", test: "x", file: "tests/switch-native.test.mjs" };
  });
  assert.ok(codes(both).includes("E_SHAPE"));
  const traversal = mutated((copy) => {
    entryOf(copy, "switch").fixture = { file: "../outside.mjs", test: "x" };
  });
  assert.ok(codes(traversal).includes("E_SHAPE"));
});

test("a catalog entry that matches no target row is dead, and so is a name that picks nothing", () => {
  const nothing = mutated((copy) => {
    copy.catalog.fixtures.push({ id: "empty", fixture: SOME_TEST, polarity: "positive", runsOn: ["godot"], select: { kind: "prop", godot: "host-provides" } });
  });
  assert.deepEqual(codes(nothing), ["E_DEAD_ENTRY"]);
  assert.match(messages(nothing, "E_DEAD_ENTRY"), /fixture empty: its selector picks no row/);
  // Rows of later scope are not targets: an entry that covers only them is dead.
  const later = mutated((copy) => {
    copy.catalog.fixtures.push({ id: "later", fixture: SOME_TEST, polarity: "positive", runsOn: ["godot"], select: { owner: "GF-40" } });
  });
  assert.deepEqual(codes(later), ["E_DEAD_ENTRY"]);
  assert.match(messages(later, "E_DEAD_ENTRY"), /fixture later picks no target row/);
  // One empty selector of a union is reported even when the others pick rows.
  const half = mutated((copy) => {
    entryOf(copy, "switch").select.push({ subject: "SwitchProps", godot: "host-provides" });
  });
  assert.deepEqual(codes(half), ["E_DEAD_ENTRY"]);
  assert.match(messages(half, "E_DEAD_ENTRY"), /fixture switch: selector #4 picks no row/);
  const misspelled = mutated((copy) => {
    entryOf(copy, "switch").select[0].name.push("valeu");
  });
  assert.match(messages(misspelled, "E_DEAD_TERM"), /fixture switch: name valeu picks no row/);
  const gone = mutated((copy) => {
    entryOf(copy, "parity-native-measure").select.id = ["ref-member:ViewInstance.measureGone"];
  });
  assert.match(messages(gone, "E_DEAD_ENTRY"), /fixture parity-native-measure: its selector picks no row \(no row has id ref-member:ViewInstance\.measureGone\)/);
  const requirement = mutated((copy) => {
    copy.catalog.negativeContracts.push({ id: "empty-contract", select: { subject: "Switch", godot: "host-provides" }, why: "x" });
  });
  assert.match(messages(requirement, "E_DEAD_ENTRY"), /negativeContracts empty-contract: its selector picks no row/);
});

test("a fixture may only cover what its polarity and its platforms mean", () => {
  const applicable = [...mapped.resolved.values()].find((row) => row.scope === "1_0" && row.applicability.godot.status === "applies" && row.applicability.ios.status === "not-applicable");
  assert.ok(applicable);
  const notApplicable = [...mapped.resolved.values()].find((row) => row.scope === "1_0" && row.applicability.godot.status === "not-applicable");
  const onIos = mutated((copy) => {
    copy.catalog.fixtures.push({ id: "ios", fixture: SOME_TEST, polarity: "positive", runsOn: ["godot", "rn-ios"], select: { id: applicable.id } });
  });
  assert.ok(codes(onIos).includes("E_RUNS_ON"));
  assert.match(messages(onIos, "E_RUNS_ON"), /it runs on rn-ios, where 1 of its rows are not applicable \(ios\)/);
  const positiveOnUnavailable = mutated((copy) => {
    copy.catalog.fixtures.push({ id: "wrong", fixture: SOME_TEST, polarity: "positive", runsOn: ["godot"], select: { id: notApplicable.id } });
  });
  assert.match(messages(positiveOnUnavailable, "E_POLARITY"), /a positive fixture covers rows that are applies or host-provides on Godot; 1 are not/);
  const presenceOnBehavior = mutated((copy) => {
    copy.catalog.fixtures.push({ id: "presence", fixture: SOME_TEST, polarity: "host-provides", runsOn: ["godot"], select: { id: "prop:SwitchProps.value" } });
  });
  assert.match(messages(presenceOnBehavior, "E_POLARITY"), /a host-provides fixture covers rows that are host-provides on Godot; 1 are not/);
  // A negative fixture may cover any row, on any platform, and a host-provides one covers a host-provides row.
  const allowed = mutated((copy) => {
    copy.catalog.fixtures.push({ id: "negative", fixture: SOME_TEST, polarity: "negative", runsOn: ["godot", "rn-ios", "rn-android"], select: { id: notApplicable.id } });
    copy.catalog.fixtures.push({ id: "presence", fixture: SOME_TEST, polarity: "host-provides", runsOn: ["godot", "rn-ios", "rn-android"], select: { id: "global-value:global.__BUNDLE_START_TIME__" } });
    copy.catalog.pending["GF-03"] = copy.catalog.pending["GF-03"].filter((item) => item.select.subject !== "__BUNDLE_START_TIME__");
  });
  // A host-provides fixture satisfies the positive requirement of a host-provides row: no ledger entry is left for it.
  assert.deepEqual(allowed.problems, []);
});

test("a layout fixture states a tolerance, and a malformed tolerance fails", () => {
  const set = (change) => mutated((copy) => change(entryOf(copy, "parity-native-layout")));
  assert.deepEqual(set(() => {}).problems, []);
  assert.match(messages(set((entry) => { delete entry.tolerance; }), "E_TOLERANCE"), /a layout fixture states its tolerance/);
  assert.match(messages(set((entry) => { delete entry.layout; }), "E_TOLERANCE"), /a tolerance belongs to a layout fixture/);
  for (const tolerance of [
    { unit: "furlong", absolute: 0 }, { unit: "dp", absolute: -1 }, { unit: "dp", absolute: "0" }, { unit: "dp", absolute: Number.NaN },
    { unit: "dp", absolute: Number.POSITIVE_INFINITY }, { unit: "dp" }, { absolute: 0 }, { unit: "dp", absolute: 0, relative: 0.1 }, 0, "dp", [], null,
  ]) {
    const result = set((entry) => { entry.tolerance = tolerance; });
    assert.ok(codes(result).includes("E_TOLERANCE"), JSON.stringify(tolerance));
    assert.match(messages(result, "E_TOLERANCE"), /\{"unit": dp or px, "absolute": a finite number, 0 or more\}/);
  }
  assert.match(messages(set((entry) => { entry.layout = "yes"; }), "E_TOLERANCE"), /layout is true or false/);
  // A fixture that is not about layout carries none.
  const extra = mutated((copy) => {
    entryOf(copy, "switch").tolerance = { unit: "dp", absolute: 0 };
  });
  assert.match(messages(extra, "E_TOLERANCE"), /fixture switch: a tolerance belongs to a layout fixture/);
  // The tolerances of the committed layout fixtures are the ones their oracles use.
  const layout = catalog.fixtures.filter((entry) => entry.layout);
  assert.deepEqual(layout.map((entry) => [entry.id, entry.tolerance.absolute]), [["parity-native-layout", 0], ["parity-native-measure", 0], ["text-layout", 0.001], ["layout-animation", 0.0005]]);
});

test("the shape of the catalog is checked: entries, polarity, platforms, selectors, notes and the ledger", () => {
  const shaped = (change) => mutated(change);
  assert.match(messages(shaped((copy) => { entryOf(copy, "switch").polarity = "maybe"; }), "E_SHAPE"), /polarity is positive, negative, host-provides/);
  assert.match(messages(shaped((copy) => { entryOf(copy, "switch").runsOn = []; }), "E_SHAPE"), /runsOn lists each of godot, rn-ios, rn-android at most once/);
  assert.match(messages(shaped((copy) => { entryOf(copy, "switch").runsOn = ["godot", "godot"]; }), "E_SHAPE"), /runsOn/);
  assert.match(messages(shaped((copy) => { entryOf(copy, "switch").runsOn = ["web"]; }), "E_SHAPE"), /runsOn/);
  assert.match(messages(shaped((copy) => { entryOf(copy, "switch").note = ""; }), "E_SHAPE"), /note is a non-empty string/);
  assert.match(messages(shaped((copy) => { entryOf(copy, "switch").select = []; }), "E_SHAPE"), /select is an empty list/);
  assert.match(messages(shaped((copy) => { entryOf(copy, "switch").select = [{ family: "Switch" }]; }), "E_SHAPE"), /a selector tests id, kind, subject/);
  assert.match(messages(shaped((copy) => { entryOf(copy, "switch").select = [{ name: { pattern: "(" } }]; }), "E_SHAPE"), /a matcher is a string/);
  assert.match(messages(shaped((copy) => { copy.catalog.fixtures.push(structuredClone(entryOf(copy, "switch"))); }), "E_SHAPE"), /fixture switch: the id is used twice/);
  assert.match(messages(shaped((copy) => { copy.catalog.fixtures.push("switch"); }), "E_SHAPE"), /an entry is an object with an id/);
  assert.match(messages(shaped((copy) => { copy.catalog.schemaVersion = 2; }), "E_SHAPE"), /schemaVersion must be 1/);
  assert.match(messages(shaped((copy) => { copy.catalog.reactNative = "0.88.0"; }), "E_SHAPE"), /the catalog is for React Native 0\.88\.0/);
  assert.match(messages(shaped((copy) => { copy.catalog.fixtures = {}; }), "E_SHAPE"), /fixtures must be an array/);
  assert.match(messages(shaped((copy) => { copy.catalog.pending = []; }), "E_SHAPE"), /pending must be an object keyed by task id/);
  const ledger = (change) => shaped((copy) => change(pendingOf(copy, "GF-03", "positive", "ReactNativeVersion")));
  assert.match(messages(ledger((item) => { item.polarity = "host-provides"; }), "E_SHAPE"), /polarity is positive or negative/);
  assert.match(messages(ledger((item) => { item.count = 0; }), "E_SHAPE"), /count is a positive integer/);
  assert.match(messages(ledger((item) => { item.count = 1.5; }), "E_SHAPE"), /count is a positive integer/);
  assert.match(messages(ledger((item) => { item.select = {}; }), "E_SHAPE"), /a selector is a non-empty object/);
  assert.match(messages(ledger((item) => { item.note = 7; }), "E_SHAPE"), /note is a non-empty string/);
});

test("a case and the catalog cannot drift apart", () => {
  const claimed = mutated((copy) => {
    entryOf(copy, "parity-timers").select = { id: ["global-value:global.setTimeout", "global-value:global.clearTimeout", "global-value:global.clearInterval", "global-value:global.setInterval"] };
    pendingOf(copy, "GF-05", "positive", "setInterval");
  });
  assert.match(messages(claimed, "E_CASE_CLAIM"), /fixture parity-timers: the case timer-arguments-cancellation does not name global-value:global\.setInterval/);
  const unclaimed = mutated((copy) => {
    copy.catalog.fixtures = copy.catalog.fixtures.filter((entry) => entry.id !== "parity-microtask-immediate-order");
  });
  assert.match(messages(unclaimed, "E_CASE_CLAIM"), /the case microtask-immediate-order names global-value:global\.setImmediate, global-value:global\.clearImmediate, which no catalog entry that points at it covers/);
  const widened = mutated((copy) => {
    copy.cases.find((item) => item.id === "native-measure").contracts.push("ref-member:ViewInstance.measureInWindow");
  });
  assert.match(messages(widened, "E_CASE_CLAIM"), /the case native-measure names ref-member:ViewInstance\.measureInWindow/);
  // The React features name no contract and need no entry; every case that names one has its entry.
  assert.ok(cases.filter((item) => item.contracts.length === 0).length > 0);
  for (const item of cases.filter((candidate) => candidate.contracts.length > 0)) {
    assert.ok(catalog.fixtures.some((entry) => entry.fixture.case === item.id), item.id);
  }
});

test("a requirement or a decided contract that is malformed, unowned or dead fails", () => {
  const decided = (change) => mutated((copy) => change(copy.catalog.decided[0]));
  assert.match(messages(decided((item) => { item.owner = "GF-99"; }), "E_UNKNOWN_OWNER"), /decided:TextDecoder: GF-99 is not a task of the dashboard/);
  assert.match(messages(decided((item) => { item.id = "TextDecoder"; }), "E_SHAPE"), /the id is "decided:<name>"/);
  assert.match(messages(decided((item) => { item.id = "value:react-native.View"; }), "E_SHAPE"), /the id is "decided:<name>"/);
  assert.match(messages(decided((item) => { item.requires = ["maybe"]; }), "E_SHAPE"), /requires lists positive and\/or negative/);
  assert.match(messages(decided((item) => { item.why = ""; }), "E_SHAPE"), /why/);
  const collides = mutated((copy) => {
    copy.inventory.contracts.push({ id: "decided:TextDecoder", kind: "value", owner: "react-native", name: "TextDecoder", type: "any", source: "x" });
  });
  assert.ok(codes(collides).includes("E_MAP") || codes(collides).includes("E_SHAPE"));
  const contract = (change) => mutated((copy) => change(copy.catalog.negativeContracts.find((item) => item.id === "headless-tasks-typed-error")));
  assert.match(messages(contract((item) => { item.why = " "; }), "E_SHAPE"), /why is required/);
  assert.match(messages(contract((item) => { item.select = { id: ["api-member:AppRegistry.noLongerThere"] }; }), "E_DEAD_ENTRY"), /no row has id api-member:AppRegistry\.noLongerThere/);
  assert.match(messages(contract((item) => { item.id = "upstream-unavailability"; }), "E_SHAPE"), /an id, used once, is required/);
  // A requirement that drops out of the catalog drops its rows out of the negative set: the fixtures stay and the ledger is stale.
  const dropped = mutated((copy) => {
    copy.catalog.negativeContracts = copy.catalog.negativeContracts.filter((item) => item.id !== "headless-tasks-typed-error");
  });
  assert.match(messages(dropped, "E_STALE_PENDING"), /GF-07 negative .*AppRegistry.* has no uncovered row left/);
});

test("a broken map stops the gate instead of being judged around", () => {
  const broken = mutated((copy) => {
    copy.map.rules = copy.map.rules.filter((rule) => rule.id !== "api-gf03-root-names");
  });
  assert.deepEqual(codes(broken), ["E_MAP"]);
  assert.match(messages(broken, "E_MAP"), /the contract map has \d+ problems/);
  assert.equal(broken.coverage, undefined);
});

test("a selector tests the fields of the resolved row: owner, kind, subject, name, scope, applicability and ids", () => {
  const row = baseline.rows.find((candidate) => candidate.id === "prop:SwitchProps.value");
  assert.deepEqual([row.owner, row.kind, row.subject, row.name, row.scope, row.godot, row.ios, row.android], ["GF-17", "prop", "SwitchProps", "value", "1_0", "applies", "applies", "applies"]);
  const inventoryRow = inventory.contracts.find((candidate) => candidate.id === "value:react-native.Switch");
  assert.equal(subjectOf(inventoryRow), "Switch");
  assert.equal(baseline.rows.find((candidate) => candidate.id === "value:react-native.Switch").subject, "Switch");
  const result = mutated((copy) => {
    copy.catalog.fixtures.push({ id: "by-fields", fixture: SOME_TEST, polarity: "positive", runsOn: ["godot"], select: [{ owner: "GF-17", kind: "prop", subject: "SwitchProps", name: { pattern: "^(value|disabled)$" }, scope: "1_0", godot: "applies", ios: ["applies"], android: "applies" }] });
  });
  assert.deepEqual(result.problems, []);
  assert.equal(result.checked.find(({ entry }) => entry.id === "by-fields").picked.length, 2);
});

test("the entries of the 0.5 prop policy list exactly the refused and ignored props that its manifest decides", () => {
  const manifest = JSON.parse(readFileSync(new URL("../docs/compatibility/scope-0.5.json", import.meta.url), "utf8"));
  const declared = new Set(inventory.contracts.filter((row) => ["prop", "event"].includes(row.kind)).map((row) => `${row.owner}.${row.name}`));
  for (const [component, table] of Object.entries(manifest.components)) {
    const entry = entryOf({ catalog }, `scope-0.5-${component.toLowerCase()}-refused-and-ignored`);
    assert.ok(entry, component);
    const decided = [...new Set(table.rules.filter((rule) => rule.decision !== "supported").flatMap((rule) => rule.names))].filter((name) => declared.has(`${table.owner}.${name}`));
    assert.equal(entry.select.subject, table.owner);
    assert.deepEqual([...entry.select.name].sort(), decided.sort(), component);
    assert.equal(entry.polarity, "negative", "the policy records refusals and no-ops; the behavior of a supported prop is not asserted by it");
  }
});
