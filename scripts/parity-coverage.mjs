import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultInputs, predicate, resolveMap, subjectOf, validMatcher } from "./parity-map.mjs";

// The fixture catalog (docs/compatibility/fixture-catalog-0.87.1.json) says which executable check backs which contract row of
// the map, with what polarity, where it runs and, for layout, with what tolerance. This module is the gate that makes the rest
// explicit: every target row that has no fixture is in a ledger that is owned by a GF, counted, and checked against the
// catalog, so a gap cannot be added or left behind unseen. The README of docs/compatibility explains the format; the comments
// here explain why the checks are what they are.

const root = fileURLToPath(new URL("..", import.meta.url));
const CATALOG_FILE = "docs/compatibility/fixture-catalog-0.87.1.json";
const CASES_FILE = "tests/parity/cases.json";

const POLARITIES = ["positive", "negative", "host-provides"];
// What the ledger counts: the two things a target row can be missing.
const REQUIREMENTS = ["positive", "negative"];
// Where a fixture runs, and the platform of the map whose applicability says whether a behavior fixture means anything there.
const RUNS_ON = { godot: "godot", "rn-ios": "ios", "rn-android": "android" };
// The fields of a resolved row that a selector can test.
const SELECT_KEYS = ["id", "kind", "subject", "name", "owner", "scope", "godot", "ios", "android", "godotReason"];
const BEHAVIOR_STATUSES = ["applies", "host-provides"];
const TOLERANCE_UNITS = ["dp", "px"];
const TASK_ID = /^GF-\d{2}$/;
const DECIDED_ID = /^decided:\S+$/;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim() !== "";
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sample = (ids) => ids.slice(0, 3).join(", ");
// By code unit, not by locale: the ledger is a file that the tests compare, and its order must be the same on every machine.
const byCode = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function loadJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// Reads a file of the repository once; undefined where it does not exist. `files` is an input so that a caller can judge the catalog
// against other files.
function repositoryFiles() {
  const cache = new Map();
  return {
    read(file) {
      if (!cache.has(file)) {
        try {
          cache.set(file, readFileSync(path.join(root, file), "utf8"));
        } catch (error) {
          if (error.code !== "ENOENT") {
            throw error;
          }
          cache.set(file, undefined);
        }
      }
      return cache.get(file);
    },
  };
}

export function defaultCoverageInputs() {
  return {
    ...defaultInputs(),
    catalog: loadJson(path.join(root, CATALOG_FILE)),
    cases: loadJson(path.join(root, CASES_FILE)),
    files: repositoryFiles(),
  };
}

// The rows the gate judges: the inventory resolved by the map, with the fields a selector tests. `godotReason` is the reason of a
// Godot status other than `applies`.
function resolvedRows(inventory, resolved) {
  return inventory.contracts.map((contract) => {
    const row = resolved.get(contract.id);
    return {
      id: contract.id,
      kind: contract.kind,
      subject: subjectOf(contract),
      name: contract.name,
      owner: row.owner,
      scope: row.scope,
      ios: row.applicability.ios.status,
      android: row.applicability.android.status,
      godot: row.applicability.godot.status,
      godotReason: row.applicability.godot.reason,
    };
  });
}

// A selector is an object of matchers, ANDed (the matchers of the map: a string, a list of strings, {"pattern"} or {"absent"}),
// or a list of such objects, ORed. Returns the problems of its shape.
function selectorProblems(select) {
  const list = Array.isArray(select) ? select : [select];
  if (list.length === 0) {
    return ["select is an empty list"];
  }
  const problems = [];
  for (const selector of list) {
    if (!isObject(selector) || Object.keys(selector).length === 0) {
      problems.push("a selector is a non-empty object");
    } else if (Object.keys(selector).some((key) => !SELECT_KEYS.includes(key))) {
      problems.push(`a selector tests ${SELECT_KEYS.join(", ")}`);
    } else if (Object.values(selector).some((spec) => !validMatcher(spec))) {
      problems.push('a matcher is a string, a list of strings, {"pattern": ...} or {"absent": true}');
    }
  }
  return problems;
}

function compileSelector(selector) {
  const tests = Object.entries(selector).map(([key, spec]) => {
    const test = predicate(spec);
    return (row) => test(row[key]);
  });
  return (row) => tests.every((test) => test(row));
}

// Rows that a (valid) selector picks among `rows`.
function pickRows(selector, rows) {
  const tests = (Array.isArray(selector) ? selector : [selector]).map(compileSelector);
  return rows.filter((row) => tests.some((test) => test(row)));
}

// Every selector has to pick a row, and every plain value it lists (a name, an id) has to pick one with the rest of its selector: a
// misspelled name, or a row the inventory dropped, would otherwise just match less. Returns how many selectors pick nothing.
function deadSelections(label, selectorOrList, rows, add) {
  const list = Array.isArray(selectorOrList) ? selectorOrList : [selectorOrList];
  let dead = 0;
  for (const [index, selector] of list.entries()) {
    if (!rows.some(compileSelector(selector))) {
      dead++;
      const unknown = Object.entries(selector).flatMap(([key, spec]) => (Array.isArray(spec) ? spec : [spec])
        .filter((value) => typeof value === "string" && !rows.some(compileSelector({ [key]: value }))).map((value) => `${key} ${value}`));
      add("E_DEAD_ENTRY", `${label}: ${list.length > 1 ? `selector #${index + 1}` : "its selector"} picks no row${unknown.length > 0 ? ` (no row has ${unknown.join(", ")})` : ""}`);
      continue;
    }
    for (const [key, spec] of Object.entries(selector)) {
      for (const term of (Array.isArray(spec) ? spec : [spec]).filter((value) => typeof value === "string")) {
        if (!rows.some(compileSelector({ ...selector, [key]: term }))) {
          add("E_DEAD_TERM", `${label}: ${key} ${term} picks no row`);
        }
      }
    }
  }
  return dead;
}

function checkHeader(catalog, inventory, add) {
  if (catalog.schemaVersion !== 1) {
    add("E_SHAPE", `schemaVersion must be 1, found ${catalog.schemaVersion}`);
  }
  if (catalog.reactNative !== inventory.reactNative) {
    add("E_SHAPE", `the catalog is for React Native ${catalog.reactNative} but the inventory is ${inventory.reactNative}`);
  }
  const lists = ["negativeContracts", "decided", "fixtures"].filter((key) => !Array.isArray(catalog[key]));
  for (const key of lists) {
    add("E_SHAPE", `${key} must be an array`);
  }
  if (!isObject(catalog.pending)) {
    add("E_SHAPE", "pending must be an object keyed by task id");
  }
  return lists.length === 0 && isObject(catalog.pending);
}

// Contracts that the inventory cannot carry because RN does not declare them but a decision makes them part of the 1.0 (for
// example a global that Hermes does not install and that must stay absent). Each becomes a row of its own, `decided:<name>`,
// that asks for the polarities it lists, owned by the GF that must test it.
function decidedRows(catalog, inventory, taskIds, add) {
  const known = new Set(inventory.contracts.map((contract) => contract.id));
  const seen = new Set();
  const rows = [];
  for (const [index, item] of catalog.decided.entries()) {
    const label = `decided ${item?.id ?? `#${index}`}`;
    if (!isObject(item) || !DECIDED_ID.test(item.id ?? "")) {
      add("E_SHAPE", `${label}: the id is "decided:<name>"`);
      continue;
    }
    if (known.has(item.id)) {
      add("E_SHAPE", `${label}: the id is already a row`);
      continue;
    }
    if (seen.has(item.id)) {
      add("E_SHAPE", `${label}: the id is used twice`);
      continue;
    }
    seen.add(item.id);
    if (!isText(item.name) || !isText(item.why)) {
      add("E_SHAPE", `${label}: a name and the decision that makes it a contract (why) are required`);
    }
    if (!TASK_ID.test(item.owner ?? "") || !taskIds.has(item.owner)) {
      add("E_UNKNOWN_OWNER", `${label}: ${item.owner} is not a task of the dashboard`);
    }
    if (!Array.isArray(item.requires) || item.requires.length === 0 || item.requires.some((value) => !REQUIREMENTS.includes(value))) {
      add("E_SHAPE", `${label}: requires lists ${REQUIREMENTS.join(" and/or ")}`);
      continue;
    }
    rows.push({
      id: item.id, kind: "decided", subject: item.name, name: item.name, owner: item.owner, scope: "1_0",
      ios: "not-applicable", android: "not-applicable", godot: "not-applicable", godotReason: item.why, requires: item.requires,
    });
  }
  return rows;
}

// Rows whose contract includes a refusal, a diagnostic for invalid input or the unavailability RN itself defines. A not-applicable
// row is in the contract only through here: its reason says the upstream outcome is the contract, and then it needs the negative
// fixture; an applies row is here when it refuses.
function negativeRequirements(catalog, rows, add) {
  const required = new Set();
  const seen = new Set();
  for (const [index, contract] of catalog.negativeContracts.entries()) {
    const label = `negativeContracts ${contract?.id ?? `#${index}`}`;
    if (!isObject(contract) || !isText(contract.id) || seen.has(contract.id)) {
      add("E_SHAPE", `${label}: an id, used once, is required`);
      continue;
    }
    seen.add(contract.id);
    if (!isText(contract.why)) {
      add("E_SHAPE", `${label}: why is required`);
    }
    const problems = selectorProblems(contract.select);
    for (const problem of problems) {
      add("E_SHAPE", `${label}: ${problem}`);
    }
    if (problems.length > 0) {
      continue;
    }
    const dead = deadSelections(label, contract.select, rows, add);
    const picked = pickRows(contract.select, rows).filter((row) => row.scope === "1_0");
    if (picked.length === 0 && dead === 0) {
      add("E_DEAD_ENTRY", `${label} picks no target row`);
    }
    for (const row of picked) {
      required.add(row.id);
    }
  }
  return required;
}

function checkTolerance(label, entry, add) {
  const { tolerance } = entry;
  if (entry.layout !== undefined && typeof entry.layout !== "boolean") {
    add("E_TOLERANCE", `${label}: layout is true or false`);
  }
  if (tolerance === undefined) {
    if (entry.layout === true) {
      add("E_TOLERANCE", `${label}: a layout fixture states its tolerance`);
    }
    return;
  }
  if (entry.layout !== true) {
    add("E_TOLERANCE", `${label}: a tolerance belongs to a layout fixture (layout: true)`);
  }
  const extra = isObject(tolerance) ? Object.keys(tolerance).filter((key) => !["unit", "absolute"].includes(key)) : [];
  if (!isObject(tolerance) || extra.length > 0 || !TOLERANCE_UNITS.includes(tolerance.unit) || !Number.isFinite(tolerance.absolute) || tolerance.absolute < 0) {
    add("E_TOLERANCE", `${label}: a tolerance is {"unit": ${TOLERANCE_UNITS.join(" or ")}, "absolute": a finite number, 0 or more}`);
  }
}

// Whether the fixture an entry names exists, statically: the case in the cases file, the check name inside a double-quoted string
// literal of the probe or oracle (a name that is built from a prefix is found by the part that is written out), the test name as the
// first argument of a test() or it() call. It does not run anything; a check text is a sentence, so it is not matched by code that
// sits between two literals. Returns the case id when the fixture is a case.
function checkFixture(label, fixture, context, add) {
  const kinds = isObject(fixture) ? ["case", "check", "test"].filter((key) => fixture[key] !== undefined) : [];
  const allowed = kinds[0] === "case" ? ["case"] : [kinds[0], "file"];
  if (kinds.length !== 1 || Object.keys(fixture).some((key) => !allowed.includes(key)) || !isText(fixture[kinds[0]])) {
    add("E_SHAPE", `${label}: fixture is {"case"}, {"file", "check"} or {"file", "test"}`);
    return undefined;
  }
  const [kind] = kinds;
  if (kind === "case") {
    if (!context.cases.some((item) => item.id === fixture.case)) {
      add("E_FIXTURE", `${label}: ${CASES_FILE} has no case ${fixture.case}`);
      return undefined;
    }
    return fixture.case;
  }
  if (!isText(fixture.file) || path.isAbsolute(fixture.file) || fixture.file.split("/").includes("..")) {
    add("E_SHAPE", `${label}: file is a path inside the repository`);
    return undefined;
  }
  const text = context.files.read(fixture.file);
  if (text === undefined) {
    add("E_FIXTURE", `${label}: ${fixture.file} does not exist`);
    return undefined;
  }
  const name = escapeRegExp(fixture[kind]);
  const found = kind === "check" ? new RegExp(`"[^"\\n]*${name}[^"\\n]*"`).test(text) : new RegExp(`\\b(?:test|it)\\(\\s*(["'\`])${name}\\1`).test(text);
  if (!found) {
    add("E_FIXTURE", `${label}: ${fixture.file} has no ${kind === "check" ? "string literal with the check" : "test named"} "${fixture[kind]}"`);
  }
  return undefined;
}

// What an entry may cover. A positive fixture shows a behavior, so it needs rows where the behavior is part of the target (and, for
// every platform it runs on, where it applies there); a host-provides fixture shows that the host installs a name, so it needs
// host-provides rows; a negative fixture can cover any row, because it is the outcome RN gives where the behavior is not the target.
function polarityProblems(label, entry, runsOn, picked, add) {
  if (entry.polarity === "negative") {
    return;
  }
  const wrong = picked.filter((row) => (entry.polarity === "host-provides" ? row.godot !== "host-provides" : !BEHAVIOR_STATUSES.includes(row.godot)));
  if (wrong.length > 0) {
    const needs = entry.polarity === "host-provides" ? "host-provides on Godot" : "applies or host-provides on Godot";
    add("E_POLARITY", `${label}: a ${entry.polarity} fixture covers rows that are ${needs}; ${wrong.length} are not, first: ${sample(wrong.map((row) => row.id))}`);
  }
  // Godot is judged above, with the polarity.
  for (const place of runsOn.filter((candidate) => candidate !== "godot")) {
    const outside = picked.filter((row) => !BEHAVIOR_STATUSES.includes(row[RUNS_ON[place]]));
    if (outside.length > 0) {
      add("E_RUNS_ON", `${label}: it runs on ${place}, where ${outside.length} of its rows are not applicable (${RUNS_ON[place]}), first: ${sample(outside.map((row) => row.id))}`);
    }
  }
}

// A problem with the fixture or the tolerance is reported where it is, and the entry still counts for coverage, so that one broken
// reference does not also show up as a gap on every row it covers.
function checkEntry(label, entry, rows, context, add) {
  if (!isObject(entry) || !isText(entry.id)) {
    add("E_SHAPE", `${label}: an entry is an object with an id`);
    return undefined;
  }
  const polarityKnown = POLARITIES.includes(entry.polarity);
  if (!polarityKnown) {
    add("E_SHAPE", `${label}: polarity is ${POLARITIES.join(", ")}`);
  }
  const runsOnKnown = Array.isArray(entry.runsOn) && entry.runsOn.length > 0 && new Set(entry.runsOn).size === entry.runsOn.length && entry.runsOn.every((place) => place in RUNS_ON);
  if (!runsOnKnown) {
    add("E_SHAPE", `${label}: runsOn lists each of ${Object.keys(RUNS_ON).join(", ")} at most once`);
  }
  if (entry.note !== undefined && !isText(entry.note)) {
    add("E_SHAPE", `${label}: note is a non-empty string`);
  }
  const caseId = checkFixture(label, entry.fixture, context, add);
  checkTolerance(label, entry, add);
  const problems = selectorProblems(entry.select);
  for (const problem of problems) {
    add("E_SHAPE", `${label}: ${problem}`);
  }
  if (!polarityKnown || problems.length > 0) {
    return undefined;
  }
  const dead = deadSelections(label, entry.select, rows, add);
  const all = pickRows(entry.select, rows);
  const picked = all.filter((row) => row.scope === "1_0");
  if (picked.length === 0) {
    if (dead === 0) {
      add("E_DEAD_ENTRY", `${label} picks no target row`);
    }
    return undefined;
  }
  polarityProblems(label, entry, runsOnKnown ? entry.runsOn : [], picked, add);
  return { entry, picked, all, caseId };
}

// A case of the shared differential protocol names the contracts it asserts. The catalog may not claim a row for a case that does
// not name it, and a contract that a case names has to be claimed by an entry that points at that case, so the two files cannot
// drift apart. A case that names none (the React features) needs no entry.
function checkCaseClaims(cases, checked, add) {
  const claimed = new Map();
  for (const { entry, all, caseId } of checked.filter((item) => item.caseId !== undefined)) {
    const named = new Set(cases.find((item) => item.id === caseId).contracts ?? []);
    const stray = all.filter((row) => !named.has(row.id));
    if (stray.length > 0) {
      add("E_CASE_CLAIM", `fixture ${entry.id}: the case ${caseId} does not name ${sample(stray.map((row) => row.id))}`);
    }
    claimed.set(caseId, new Set([...(claimed.get(caseId) ?? []), ...all.map((row) => row.id)]));
  }
  for (const item of cases) {
    const missing = (item.contracts ?? []).filter((id) => !claimed.get(item.id)?.has(id));
    if (missing.length > 0) {
      add("E_CASE_CLAIM", `the case ${item.id} names ${sample(missing)}, which no catalog entry that points at it covers`);
    }
  }
}

// The rows each requirement leaves uncovered, by requirement. A host-provides fixture counts as the positive one: the contract of
// such a row is that the host installs the name.
function coverageOf(rows, checked, negativeRequired) {
  const covered = { positive: new Map(), negative: new Map() };
  const byPolarity = Object.fromEntries(POLARITIES.map((polarity) => [polarity, new Set()]));
  for (const { entry, picked } of checked) {
    const requirement = entry.polarity === "negative" ? "negative" : "positive";
    for (const row of picked) {
      covered[requirement].set(row.id, [...(covered[requirement].get(row.id) ?? []), entry.id]);
      byPolarity[entry.polarity].add(row.id);
    }
  }
  const targets = rows.filter((row) => row.scope === "1_0");
  const required = {
    positive: targets.filter((row) => (row.requires ? row.requires.includes("positive") : BEHAVIOR_STATUSES.includes(row.godot))),
    negative: targets.filter((row) => negativeRequired.has(row.id) || row.requires?.includes("negative")),
  };
  const gaps = Object.fromEntries(REQUIREMENTS.map((requirement) => [requirement, required[requirement].filter((row) => !covered[requirement].has(row.id))]));
  return { covered, byPolarity, required, gaps };
}

// The ledger: for each GF, the target rows that have no fixture yet, grouped by what the selector says and counted. The count has to
// be exactly the number of rows the selector still finds uncovered, so a delivery that covers rows must lower it, and one that
// forgets fails.
function checkPending(catalog, rows, taskIds, gaps, add) {
  const rowsByOwner = new Map();
  for (const row of rows.filter((candidate) => candidate.scope === "1_0")) {
    rowsByOwner.set(row.owner, [...(rowsByOwner.get(row.owner) ?? []), row]);
  }
  const ledgered = { positive: new Map(), negative: new Map() };
  const gapIds = Object.fromEntries(REQUIREMENTS.map((requirement) => [requirement, new Set(gaps[requirement].map((row) => row.id))]));
  for (const [owner, list] of Object.entries(catalog.pending)) {
    if (!TASK_ID.test(owner) || !taskIds.has(owner)) {
      add("E_UNKNOWN_OWNER", `pending ${owner} is not a task of the dashboard`);
      continue;
    }
    if (!Array.isArray(list)) {
      add("E_SHAPE", `pending ${owner} is a list`);
      continue;
    }
    for (const [index, item] of list.entries()) {
      const label = `pending ${owner} #${index}`;
      const problems = isObject(item) ? selectorProblems(item.select) : ["an entry is an object"];
      if (isObject(item) && !REQUIREMENTS.includes(item.polarity)) {
        problems.push(`polarity is ${REQUIREMENTS.join(" or ")}`);
      }
      if (isObject(item) && (!Number.isInteger(item.count) || item.count < 1)) {
        problems.push("count is a positive integer");
      }
      if (isObject(item) && item.note !== undefined && !isText(item.note)) {
        problems.push("note is a non-empty string");
      }
      for (const problem of problems) {
        add("E_SHAPE", `${label}: ${problem}`);
      }
      if (problems.length > 0) {
        continue;
      }
      const owned = rowsByOwner.get(owner) ?? [];
      const dead = deadSelections(label, item.select, owned, add);
      const open = pickRows(item.select, owned).filter((row) => gapIds[item.polarity].has(row.id));
      const described = `${owner} ${item.polarity} ${JSON.stringify(item.select)}`;
      if (open.length === 0) {
        if (dead === 0) {
          add("E_STALE_PENDING", `${label}: ${described} has no uncovered row left; remove it`);
        }
        continue;
      }
      if (open.length !== item.count) {
        add("E_PENDING_COUNT", `${label}: ${described} says ${item.count} but ${open.length} rows are uncovered; set the count to ${open.length}`);
      }
      for (const row of open) {
        if (ledgered[item.polarity].has(row.id)) {
          add("E_PENDING_OVERLAP", `${label}: ${row.id} is already in ${ledgered[item.polarity].get(row.id)}`);
        } else {
          ledgered[item.polarity].set(row.id, label);
        }
      }
    }
  }
  for (const requirement of REQUIREMENTS) {
    const missing = new Map();
    for (const row of gaps[requirement].filter((candidate) => !ledgered[requirement].has(candidate.id))) {
      missing.set(row.owner, [...(missing.get(row.owner) ?? []), row.id]);
    }
    for (const [owner, ids] of [...missing.entries()].sort(([left], [right]) => byCode(left, right))) {
      add("E_UNLEDGERED", `${owner} ${requirement}: ${ids.length} target rows have no fixture and are not in the pending ledger, first: ${sample(ids)}`);
    }
  }
}

// Judges the catalog against the map (resolved here), the shared cases and the files its fixtures name. Returns the problems and,
// when the catalog could be read, everything the report needs.
export function checkCatalog(inputs) {
  const { catalog, cases, inventory, dashboard } = inputs;
  const problems = [];
  const add = (code, message) => problems.push({ code, message });
  const mapped = resolveMap({ map: inputs.map, inventory, dashboard });
  if (mapped.problems.length > 0) {
    add("E_MAP", `the contract map has ${mapped.problems.length} problems (run node scripts/parity-map.mjs --check); the catalog is not judged against a broken map`);
    return { problems };
  }
  if (!checkHeader(catalog, inventory, add)) {
    return { problems };
  }
  const context = { cases, files: inputs.files };
  const rows = [...resolvedRows(inventory, mapped.resolved), ...decidedRows(catalog, inventory, mapped.taskIds, add)];
  const negativeRequired = negativeRequirements(catalog, rows, add);
  const ids = new Set();
  const checked = [];
  for (const [index, entry] of catalog.fixtures.entries()) {
    const label = `fixture ${entry?.id ?? `#${index}`}`;
    if (isObject(entry) && ids.has(entry.id)) {
      add("E_SHAPE", `${label}: the id is used twice`);
      continue;
    }
    ids.add(entry?.id);
    const result = checkEntry(label, entry, rows, context, add);
    if (result !== undefined) {
      checked.push(result);
    }
  }
  checkCaseClaims(cases, checked, add);
  const coverage = coverageOf(rows, checked, negativeRequired);
  checkPending(catalog, rows, mapped.taskIds, coverage.gaps, add);
  const targets = rows.filter((row) => row.scope === "1_0");
  const stats = { rows: targets.filter((row) => row.kind !== "decided").length, decided: targets.filter((row) => row.kind === "decided").length, fixtures: catalog.fixtures.length };
  return { problems, rows, checked, coverage, negativeRequired, stats };
}

// Per GF: the target rows each requirement asks for, how many have a fixture and how many are still pending.
export function coverageByOwner(outcome, dashboard) {
  const titles = new Map(dashboard.tasks.map((task) => [task.id, task.title]));
  const byOwner = new Map();
  const entryOf = (owner) => {
    if (!byOwner.has(owner)) {
      byOwner.set(owner, { owner, title: titles.get(owner), rows: 0, decided: 0, positive: { required: 0, covered: 0 }, negative: { required: 0, covered: 0 } });
    }
    return byOwner.get(owner);
  };
  for (const row of outcome.rows.filter((candidate) => candidate.scope === "1_0")) {
    entryOf(row.owner)[row.kind === "decided" ? "decided" : "rows"]++;
  }
  for (const requirement of REQUIREMENTS) {
    for (const row of outcome.coverage.required[requirement]) {
      const entry = entryOf(row.owner);
      entry[requirement].required++;
      entry[requirement].covered += outcome.coverage.covered[requirement].has(row.id) ? 1 : 0;
    }
  }
  return [...byOwner.values()].sort((left, right) => byCode(left.owner, right.owner));
}

const requirementLine = (name, counts) => `  ${name.padEnd(9)}required ${counts.required}, covered ${counts.covered}, pending ${counts.required - counts.covered}`;

function formatCoverage(outcome, dashboard) {
  const lines = [];
  const totals = { positive: { required: 0, covered: 0 }, negative: { required: 0, covered: 0 } };
  for (const entry of coverageByOwner(outcome, dashboard)) {
    lines.push(`${entry.owner} ${entry.title}: ${entry.rows} target rows${entry.decided > 0 ? ` and ${entry.decided} decided` : ""}`);
    for (const requirement of REQUIREMENTS) {
      lines.push(requirementLine(requirement, entry[requirement]));
      totals[requirement].required += entry[requirement].required;
      totals[requirement].covered += entry[requirement].covered;
    }
  }
  const rowsBy = outcome.coverage.byPolarity;
  lines.push(`total ${outcome.stats.rows} target rows (+${outcome.stats.decided} decided), ${outcome.stats.fixtures} fixture entries`);
  for (const requirement of REQUIREMENTS) {
    lines.push(requirementLine(requirement, totals[requirement]));
  }
  lines.push(`  rows with a fixture by polarity: ${POLARITIES.map((polarity) => `${polarity} ${rowsBy[polarity].size}`).join(", ")}`);
  return lines.join("\n");
}

// The ledger that the current catalog implies, in the format of the file: what a delivery that covers rows would paste after
// lowering its counts, and what the first ledger was generated from. It is printed, never written.
export function pendingLedger(outcome) {
  const groups = new Map();
  for (const requirement of REQUIREMENTS) {
    for (const row of outcome.coverage.gaps[requirement]) {
      const key = JSON.stringify([row.owner, requirement, row.subject]);
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
  }
  const ledger = {};
  for (const [key, count] of [...groups.entries()].sort(([left], [right]) => byCode(left, right))) {
    const [owner, polarity, subject] = JSON.parse(key);
    ledger[owner] = [...(ledger[owner] ?? []), { polarity, select: { subject }, count }];
  }
  return ledger;
}

const formatFields = (object) => `{ ${Object.entries(object).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(", ")} }`;

// One ledger entry per line: the polarity, the selector, the count and, where there is one, the note.
const formatItem = (item) => {
  const fields = [`"polarity": ${JSON.stringify(item.polarity)}`, `"select": ${formatFields(item.select)}`, `"count": ${item.count}`];
  return `{ ${[...fields, ...(item.note === undefined ? [] : [`"note": ${JSON.stringify(item.note)}`])].join(", ")} }`;
};

export function formatPending(ledger) {
  const owners = Object.keys(ledger).sort(byCode);
  const body = owners.map((owner) => `    ${JSON.stringify(owner)}: [\n${ledger[owner].map((item) => `      ${formatItem(item)}`).join(",\n")}\n    ]`);
  return `{\n${body.join(",\n")}\n  }`;
}

function main(argv) {
  const option = (name) => {
    const index = argv.indexOf(name);
    if (index >= 0 && !argv[index + 1]) {
      throw new Error(`${name} requires a path`);
    }
    return index >= 0 ? loadJson(path.resolve(argv[index + 1])) : undefined;
  };
  const defaults = defaultCoverageInputs();
  const inputs = {
    ...defaults,
    map: option("--map") ?? defaults.map,
    inventory: option("--inventory") ?? defaults.inventory,
    dashboard: option("--dashboard") ?? defaults.dashboard,
    catalog: option("--catalog") ?? defaults.catalog,
    cases: option("--cases") ?? defaults.cases,
  };
  const outcome = checkCatalog(inputs);
  if (argv.includes("--check")) {
    if (outcome.problems.length > 0) {
      for (const problem of outcome.problems) {
        console.error(`${problem.code}: ${problem.message}`);
      }
      console.error(`PARITY_COVERAGE_FAILED: ${outcome.problems.length} problems`);
      return 1;
    }
    const totals = coverageByOwner(outcome, inputs.dashboard).reduce((sum, entry) => ({
      required: sum.required + entry.positive.required + entry.negative.required,
      covered: sum.covered + entry.positive.covered + entry.negative.covered,
    }), { required: 0, covered: 0 });
    console.log(`PARITY_COVERAGE_PASSED: ${outcome.stats.rows} target rows (+${outcome.stats.decided} decided), ${outcome.stats.fixtures} fixture entries, ${totals.covered} of ${totals.required} required fixtures covered, ${totals.required - totals.covered} pending`);
    return 0;
  }
  if (outcome.coverage === undefined) {
    for (const problem of outcome.problems) {
      console.error(`${problem.code}: ${problem.message}`);
    }
    return 1;
  }
  console.log(argv.includes("--print-pending") ? formatPending(pendingLedger(outcome)) : formatCoverage(outcome, inputs.dashboard));
  if (outcome.problems.length > 0 && !argv.includes("--print-pending")) {
    console.error(`${outcome.problems.length} problems; run with --check to list them`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
