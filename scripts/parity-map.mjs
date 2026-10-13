import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The contract map (docs/compatibility/contract-map-0.87.1.json) gives every row of the contract inventory an owner (a GF task
// of dashboard/migration.json), a scope and an applicability on iOS, Android and Godot. It is a set of rules plus per-row
// overrides, not one entry per row, and this module is the gate that keeps it honest. The README of docs/compatibility explains
// the format; the comments here explain why the checks are what they are.

const root = fileURLToPath(new URL("..", import.meta.url));
const PLATFORMS = ["ios", "android", "godot"];
const SCOPES = ["1_0", "post_1_0", "out"];
const STATUSES = ["applies", "not-applicable", "host-provides"];
const GATE_STATES = ["live", "dead", "dev", "module", "no-module", "flag", "engine", "environment"];
const MATCH_KEYS = ["kind", "subject", "owner", "name", "id", "source", "installedBy", "conditions"];
const FIELDS = ["owner", "scope", ...PLATFORMS];
// The owner of a row that is about the named thing itself, not about a member of something else.
const NAMESPACES = new Set(["react-native", "global"]);
const TASK_ID = /^GF-\d{2}$/;

// What a row is about: the API a prop, a member or a command belongs to, or the thing itself for a value or a type.
export function subjectOf(row) {
  return NAMESPACES.has(row.owner) ? row.name : row.owner;
}

// A runtime-global site runs, or not, depending on its gates. The map classifies every gate the inventory records
// (gateModel.gates), and a site is dead when one of its gates is dead under the host's mode (bridgeless). Returns, for a row's
// sites, whether each is dead and the non-trivial gate states of the ones that can run.
function classifySites(sites, gates, unknown) {
  const dead = [];
  const conditions = [];
  for (const site of sites) {
    const states = site.gates.map((gate) => {
      if (gates[gate] === undefined) {
        unknown.add(gate);
      }
      return gates[gate]?.state;
    });
    dead.push(states.includes("dead"));
    if (!states.includes("dead")) {
      conditions.push(...states.filter((state) => state !== "live"));
    }
  }
  return { dead, conditions };
}

// `installedBy` is "host" when every site of a runtime-global row is dead: RN's JS never installs it in this mode, so the host
// must. Otherwise it is "rn", and `conditions` holds the non-trivial gate states of the sites that can run. A global value (the
// declaration in RN's globals.d.ts) takes the `installedBy` of the runtime-global row of the same name, or "host" when a
// host-global row of that name says RN's JS only reads it.
export function derive(rows, gates) {
  const unknown = new Set();
  const attributes = new Map();
  const installers = new Map();
  for (const row of rows.filter((candidate) => candidate.kind === "runtime-global")) {
    const { dead, conditions } = classifySites(row.sites, gates, unknown);
    const installedBy = dead.every(Boolean) ? "host" : "rn";
    attributes.set(row.id, { installedBy, conditions: new Set(conditions) });
    if (row.owner === "global") {
      installers.set(row.name, installedBy);
    }
  }
  for (const row of rows.filter((candidate) => candidate.kind === "host-global" && candidate.owner === "global")) {
    installers.set(row.name, "host");
  }
  for (const row of rows.filter((candidate) => candidate.kind === "global-value" && installers.has(candidate.name))) {
    attributes.set(row.id, { installedBy: installers.get(row.name), conditions: new Set() });
  }
  return { attributes, unknown };
}

// A matcher is a string (exact), a list of strings (any of), {"pattern": "<regular expression>"} or {"absent": true}.
function predicate(spec) {
  if (typeof spec === "string") {
    return (value) => value === spec;
  }
  if (Array.isArray(spec)) {
    const accepted = new Set(spec);
    return (value) => accepted.has(value);
  }
  if (spec.absent) {
    return (value) => value === undefined;
  }
  const expression = new RegExp(spec.pattern);
  return (value) => typeof value === "string" && expression.test(value);
}

function validMatcher(spec) {
  if (typeof spec === "string") {
    return true;
  }
  if (Array.isArray(spec)) {
    return spec.length > 0 && spec.every((item) => typeof item === "string");
  }
  if (spec === null || typeof spec !== "object") {
    return false;
  }
  const keys = Object.keys(spec);
  if (keys.length !== 1) {
    return false;
  }
  if (keys[0] === "absent") {
    return spec.absent === true;
  }
  try {
    return keys[0] === "pattern" && typeof new RegExp(spec.pattern) === "object";
  } catch {
    return false;
  }
}

// In `kind`, an entry such as "@api" stands for the kinds that map.kindGroups.api lists.
function expandKinds(map, spec) {
  return [spec].flat().flatMap((entry) => (entry.startsWith("@") ? map.kindGroups?.[entry.slice(1)] ?? [entry] : [entry]));
}

function compile(map, rule) {
  const tests = Object.entries(rule.match).map(([key, spec]) => {
    if (key === "kind") {
      const test = predicate(expandKinds(map, spec));
      return (context) => test(context.kind);
    }
    if (key === "conditions") {
      const wanted = new Set([spec].flat());
      return (context) => [...context.conditions].some((condition) => wanted.has(condition));
    }
    const test = predicate(spec);
    return (context) => test(context[key]);
  });
  return (context) => tests.every((test) => test(context));
}

// `applicability` is a profile name (map.applicabilityProfiles) or {platform: status | {status, reason}}.
function applicabilityOf(map, item) {
  return typeof item.applicability === "string" ? map.applicabilityProfiles?.[item.applicability] : item.applicability;
}

// What a rule or override assigns to one field, in the normalized form {value, reason}.
function assignment(map, item, field) {
  if (field === "owner") {
    return item.owner === undefined ? undefined : { value: item.owner };
  }
  if (field === "scope") {
    return item.scope === undefined ? undefined : { value: item.scope, reason: item.scopeReason };
  }
  const entry = applicabilityOf(map, item)?.[field];
  if (entry === undefined) {
    return undefined;
  }
  return typeof entry === "string" ? { value: entry } : { value: entry.status, reason: entry.reason };
}

function loadJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function defaultInputs() {
  return {
    map: loadJson(path.join(root, "docs/compatibility/contract-map-0.87.1.json")),
    inventory: loadJson(path.join(root, "docs/compatibility/contracts-0.87.1.json")),
    dashboard: loadJson(path.join(root, "dashboard/migration.json")),
  };
}

// Structural checks. Everything else assumes a map that passed them, so a malformed map stops here. There is one validator per
// section of the map, run in the order of the file; the ones that guard what the next sections read return false to stop.

function checkHeader(map, inventory, add) {
  if (map.schemaVersion !== 1) {
    add("E_SHAPE", `schemaVersion must be 1, found ${map.schemaVersion}`);
  }
  if (map.reactNative !== inventory.reactNative) {
    add("E_SHAPE", `the map is for React Native ${map.reactNative} but the inventory is ${inventory.reactNative}`);
  }
  if (!Array.isArray(map.rules) || !Array.isArray(map.overrides)) {
    add("E_SHAPE", "rules and overrides must be arrays");
    return false;
  }
  return true;
}

function checkGateModel(map, add) {
  const gates = map.gateModel?.gates;
  if (gates === null || typeof gates !== "object" || typeof map.gateModel?.bridgeless !== "boolean") {
    add("E_SHAPE", "gateModel needs a boolean bridgeless and a gates table");
    return false;
  }
  for (const [gate, entry] of Object.entries(gates)) {
    if (!GATE_STATES.includes(entry?.state)) {
      add("E_SHAPE", `gate ${gate}: state must be one of ${GATE_STATES.join(", ")}`);
    }
    if (!entry?.reason) {
      add("E_REASON", `gate ${gate}: a reason is required`);
    }
  }
  return true;
}

function checkKindGroups(map, add) {
  const groups = map.kindGroups;
  if (groups === null || typeof groups !== "object") {
    add("E_SHAPE", "kindGroups must name the groups of kinds that rules reference as @name");
    return false;
  }
  return true;
}

function checkNativeComponents(map, add) {
  const links = map.nativeComponents;
  if (links === null || typeof links !== "object") {
    add("E_SHAPE", "nativeComponents must link each native command file to its public component");
    return false;
  }
  for (const [file, link] of Object.entries(links)) {
    if (link?.component !== null && typeof link?.component !== "string") {
      add("E_SHAPE", `nativeComponents.${file}: component is a public value name, or null`);
    }
    if (typeof link?.reason !== "string" || !link.reason.trim()) {
      add("E_REASON", `nativeComponents.${file}: a reason is required`);
    }
  }
  return true;
}

// The platform entries of an applicability object: each a status or {status, reason}. A status other than "applies" needs a
// reason, unless the caller (an override) supplies its own.
function checkPlatformEntries(label, spec, fallbackReason, add) {
  for (const platform of Object.keys(spec)) {
    const entry = spec[platform];
    const status = typeof entry === "string" ? entry : entry?.status;
    const reason = typeof entry === "string" ? undefined : entry?.reason;
    if (!PLATFORMS.includes(platform)) {
      add("E_SHAPE", `${label}: unknown platform ${platform}`);
    } else if (!STATUSES.includes(status)) {
      add("E_SHAPE", `${label}: ${platform} must be one of ${STATUSES.join(", ")}`);
    } else if (status !== "applies" && !reason && !fallbackReason) {
      add("E_REASON", `${label}: ${platform} ${status} needs a reason`);
    }
  }
}

function checkProfiles(map, add) {
  for (const [name, spec] of Object.entries(map.applicabilityProfiles ?? {})) {
    if (!PLATFORMS.every((platform) => platform in spec)) {
      add("E_SHAPE", `profile ${name} must decide ${PLATFORMS.join(", ")}`);
    }
    checkPlatformEntries(`profile ${name}`, spec, undefined, add);
  }
}

// A rule or an override assigns owner, scope and per-platform applicability, each optional. An override's own reason covers
// whatever it sets, so it needs no sub-reasons; a rule states them, because a rule decides many rows.
function checkAssignments({ map, taskIds, add }, label, item, fallbackReason) {
  if (item.owner !== undefined && (typeof item.owner !== "string" || !TASK_ID.test(item.owner) || !taskIds.has(item.owner))) {
    add("E_UNKNOWN_OWNER", `${label}: ${item.owner} is not a task of the dashboard`);
  }
  if (item.scope !== undefined) {
    if (!SCOPES.includes(item.scope)) {
      add("E_SHAPE", `${label}: scope must be one of ${SCOPES.join(", ")}`);
    } else if (item.scope !== "1_0" && !item.scopeReason && !fallbackReason) {
      add("E_REASON", `${label}: scope ${item.scope} needs a scopeReason`);
    }
  }
  if (typeof item.applicability === "string") {
    if ((map.applicabilityProfiles ?? {})[item.applicability] === undefined) {
      add("E_SHAPE", `${label}: unknown applicability profile ${item.applicability}`);
    }
  } else if (item.applicability !== undefined) {
    if (item.applicability === null || typeof item.applicability !== "object") {
      add("E_SHAPE", `${label}: applicability is a profile name or an object`);
    } else {
      checkPlatformEntries(label, item.applicability, fallbackReason, add);
    }
  }
  if (!FIELDS.some((field) => assignment(map, item, field) !== undefined)) {
    add("E_SHAPE", `${label}: it assigns nothing`);
  }
}

// The `match` of a rule: known keys, well-formed matchers, groups that exist, derived attributes with valid values.
function checkMatch({ map, add }, label, match) {
  if (match === null || typeof match !== "object" || Object.keys(match).length === 0 || Object.keys(match).some((key) => !MATCH_KEYS.includes(key))) {
    add("E_SHAPE", `${label}: match needs at least one of ${MATCH_KEYS.join(", ")}`);
  } else if (Object.values(match).some((spec) => !validMatcher(spec))) {
    add("E_SHAPE", `${label}: a matcher is a string, a list of strings, {"pattern": ...} or {"absent": true}`);
  } else if (match.kind !== undefined && [match.kind].flat().some((entry) => entry.startsWith("@") && !Array.isArray(map.kindGroups[entry.slice(1)]))) {
    add("E_SHAPE", `${label}: kind names a group that kindGroups does not define`);
  } else if (match.installedBy !== undefined && !["host", "rn"].includes(match.installedBy)) {
    add("E_SHAPE", `${label}: installedBy is host or rn`);
  } else if (match.conditions !== undefined && [match.conditions].flat().some((state) => !GATE_STATES.includes(state))) {
    add("E_SHAPE", `${label}: conditions are gate states (${GATE_STATES.join(", ")})`);
  }
}

function checkRules(context) {
  const { map, add } = context;
  const ruleIds = new Set();
  for (const [index, rule] of map.rules.entries()) {
    const label = `rule ${rule?.id ?? `#${index}`}`;
    if (typeof rule?.id !== "string" || !rule.id) {
      add("E_SHAPE", `rule #${index} has no id`);
      continue;
    }
    if (ruleIds.has(rule.id)) {
      add("E_SHAPE", `${label}: the id is used twice`);
    }
    ruleIds.add(rule.id);
    if (!Number.isInteger(rule.precedence) || rule.precedence < 1) {
      add("E_SHAPE", `${label}: precedence must be a positive integer`);
    }
    if (typeof rule.why !== "string" || !rule.why.trim()) {
      add("E_REASON", `${label}: why is required`);
    }
    checkMatch(context, label, rule.match);
    checkAssignments(context, label, rule, undefined);
  }
}

function checkOverrides(context) {
  const { map, add } = context;
  const overridden = new Set();
  for (const [index, override] of map.overrides.entries()) {
    const label = `override ${override?.id ?? `#${index}`}`;
    if (typeof override?.id !== "string") {
      add("E_SHAPE", `override #${index} has no id`);
      continue;
    }
    if (overridden.has(override.id)) {
      add("E_SHAPE", `${label}: the row is overridden twice`);
    }
    overridden.add(override.id);
    if (typeof override.reason !== "string" || !override.reason.trim()) {
      add("E_REASON", `${label}: a reason is required`);
    }
    checkAssignments(context, label, override, override.reason);
  }
}

function checkShape(map, inventory, taskIds) {
  const problems = [];
  const add = (code, message) => problems.push({ code, message });
  const context = { map, taskIds, add };
  const readable = checkHeader(map, inventory, add) && checkGateModel(map, add) && checkKindGroups(map, add) && checkNativeComponents(map, add);
  if (readable) {
    checkProfiles(map, add);
    checkRules(context);
    checkOverrides(context);
  }
  return problems;
}

// The gates of the runtime-global sites: derives what each row's installer is, and reports the gates the gateModel does not
// classify and the ones it classifies that no site has.
function reportGateModel(map, rows, problems) {
  const { attributes, unknown } = derive(rows, map.gateModel.gates);
  for (const gate of [...unknown].sort()) {
    problems.push({ code: "E_UNKNOWN_GATE", message: `a runtime-global site has a gate the gateModel does not classify: ${gate}` });
  }
  const usedGates = new Set(rows.filter((row) => row.kind === "runtime-global").flatMap((row) => row.sites.flatMap((site) => site.gates)));
  for (const gate of Object.keys(map.gateModel.gates).filter((candidate) => !usedGates.has(candidate))) {
    problems.push({ code: "E_STALE_GATE", message: `gateModel classifies a gate no site has: ${gate}` });
  }
  return attributes;
}

function reportStaleProfiles(map, problems) {
  const usedProfiles = new Set([...map.rules, ...map.overrides].map((item) => item.applicability).filter((spec) => typeof spec === "string"));
  for (const name of Object.keys(map.applicabilityProfiles ?? {}).filter((candidate) => !usedProfiles.has(candidate))) {
    problems.push({ code: "E_STALE_PROFILE", message: `applicability profile ${name} is used by no rule or override` });
  }
}

function reportCommandLinks(map, rows, problems) {
  const commandFiles = new Set(rows.filter((row) => row.kind === "native-command").map((row) => row.owner));
  const values = new Set(rows.filter((row) => row.kind === "value").map((row) => row.name));
  for (const file of [...commandFiles].sort().filter((candidate) => map.nativeComponents[candidate] === undefined)) {
    problems.push({ code: "E_UNLINKED_COMMAND", message: `the native commands of ${file} are not linked to a public component in nativeComponents` });
  }
  for (const [file, link] of Object.entries(map.nativeComponents)) {
    if (!commandFiles.has(file)) {
      problems.push({ code: "E_UNLINKED_COMMAND", message: `nativeComponents names ${file}, which declares no native command` });
    } else if (link.component !== null && !values.has(link.component)) {
      problems.push({ code: "E_UNLINKED_COMMAND", message: `nativeComponents.${file}: ${link.component} is not a public value of the inventory` });
    }
  }
}

// Resolves one field of one row among the rules that match it: the highest precedence wins, and two rules at the top are tied.
function resolveField(map, candidates, field) {
  const defining = candidates.filter((entry) => assignment(map, entry.rule, field) !== undefined);
  if (defining.length === 0) {
    return { outcome: "unmapped" };
  }
  const top = Math.max(...defining.map((entry) => entry.rule.precedence));
  const winners = defining.filter((entry) => entry.rule.precedence === top);
  if (winners.length > 1) {
    return { outcome: "tied", winners };
  }
  return { outcome: "won", entry: winners[0], ...assignment(map, winners[0].rule, field) };
}

function resolveRow(map, row, derived, entries, unmapped, ambiguous) {
  const context = {
    kind: row.kind, subject: subjectOf(row), owner: row.owner, name: row.name, id: row.id, source: row.source,
    installedBy: derived?.installedBy, conditions: derived?.conditions ?? new Set(),
  };
  const candidates = entries.filter((entry) => entry.matches(context));
  candidates.forEach((entry) => entry.matched++);
  const result = { id: row.id, kind: row.kind, via: {}, applicability: {} };
  for (const field of FIELDS) {
    const resolution = resolveField(map, candidates, field);
    if (resolution.outcome === "unmapped") {
      unmapped[field].push(row.id);
      continue;
    }
    if (resolution.outcome === "tied") {
      resolution.winners.forEach((entry) => {
        entry.tied = true;
      });
      ambiguous.push({ id: row.id, field, rules: resolution.winners.map((entry) => entry.rule.id) });
      continue;
    }
    const { entry, value, reason } = resolution;
    entry.won++;
    result.via[field] = entry.rule.id;
    if (PLATFORMS.includes(field)) {
      result.applicability[field] = { status: value, ...(reason ? { reason } : {}) };
    } else {
      result[field] = value;
      if (field === "scope" && reason) {
        result.scopeReason = reason;
      }
    }
  }
  return result;
}

function reportResolution(unmapped, ambiguous, entries, problems) {
  for (const field of FIELDS) {
    if (unmapped[field].length > 0) {
      problems.push({ code: "E_UNMAPPED", message: `${unmapped[field].length} rows have no ${field}, first: ${unmapped[field].slice(0, 5).join(", ")}` });
    }
  }
  for (const item of ambiguous.slice(0, 20)) {
    problems.push({ code: "E_AMBIGUOUS", message: `${item.id}: ${item.field} is assigned by ${item.rules.join(" and ")} at the same precedence` });
  }
  if (ambiguous.length > 20) {
    problems.push({ code: "E_AMBIGUOUS", message: `${ambiguous.length - 20} more ambiguous (row, field) pairs` });
  }
  for (const entry of entries) {
    if (entry.matched === 0) {
      problems.push({ code: "E_DEAD_RULE", message: `rule ${entry.rule.id} matches no row` });
    } else if (entry.won === 0 && !entry.tied) {
      problems.push({ code: "E_DEAD_RULE", message: `rule ${entry.rule.id} matches ${entry.matched} rows but wins none of its fields: higher-precedence rules cover all of them` });
    }
  }
}

// An override replaces the fields it assigns on an already resolved row; one that changes nothing is reported.
function applyOverride(map, override, row, problems) {
  let changed = false;
  for (const field of FIELDS) {
    const next = assignment(map, override, field);
    if (next === undefined) {
      continue;
    }
    const reason = next.reason ?? override.reason;
    if (PLATFORMS.includes(field)) {
      changed ||= row.applicability[field]?.status !== next.value;
      row.applicability[field] = { status: next.value, ...(next.value === "applies" ? {} : { reason }) };
    } else {
      changed ||= row[field] !== next.value;
      row[field] = next.value;
      if (field === "scope") {
        row.scopeReason = next.value === "1_0" ? undefined : reason;
      }
    }
    row.via[field] = "override";
  }
  if (!changed) {
    problems.push({ code: "E_NOOP_OVERRIDE", message: `override ${override.id} assigns what the rules already resolve` });
  }
}

// Resolves every row. For each (row, field) the matching rules that assign the field compete by precedence: the highest wins,
// and two rules at the highest precedence are an ambiguity, even if they assign the same value. A rule that wins nothing is
// dead. Overrides apply last, by row id.
export function resolveMap({ map, inventory, dashboard }) {
  const taskIds = new Set(dashboard.tasks.map((task) => task.id));
  const resolved = new Map();
  const problems = checkShape(map, inventory, taskIds);
  if (problems.length > 0) {
    return { problems, resolved, taskIds, stats: undefined };
  }
  const rows = inventory.contracts;
  const attributes = reportGateModel(map, rows, problems);
  reportStaleProfiles(map, problems);
  reportCommandLinks(map, rows, problems);
  const entries = map.rules.map((rule) => ({ rule, matches: compile(map, rule), matched: 0, won: 0, tied: false }));
  const unmapped = Object.fromEntries(FIELDS.map((field) => [field, []]));
  const ambiguous = [];
  for (const row of rows) {
    resolved.set(row.id, resolveRow(map, row, attributes.get(row.id), entries, unmapped, ambiguous));
  }
  reportResolution(unmapped, ambiguous, entries, problems);
  const known = new Set(rows.map((row) => row.id));
  for (const override of map.overrides) {
    if (!known.has(override.id)) {
      problems.push({ code: "E_STALE_OVERRIDE", message: `override ${override.id}: the inventory has no such row` });
      continue;
    }
    applyOverride(map, override, resolved.get(override.id), problems);
  }
  return { problems, resolved, taskIds, stats: { rules: map.rules.length, overrides: map.overrides.length, rows: rows.length } };
}

// Coverage per GF: how many rows each task owns, by kind, scope and applicability.
export function coverage({ resolved, taskIds }, dashboard) {
  const titles = new Map(dashboard.tasks.map((task) => [task.id, task.title]));
  const byOwner = new Map();
  for (const row of resolved.values()) {
    if (row.owner === undefined || !taskIds.has(row.owner)) {
      continue;
    }
    const entry = byOwner.get(row.owner) ?? { rows: 0, kind: {}, scope: {}, ios: {}, android: {}, godot: {} };
    entry.rows++;
    entry.kind[row.kind] = (entry.kind[row.kind] ?? 0) + 1;
    entry.scope[row.scope] = (entry.scope[row.scope] ?? 0) + 1;
    for (const platform of PLATFORMS) {
      const status = row.applicability[platform]?.status;
      entry[platform][status] = (entry[platform][status] ?? 0) + 1;
    }
    byOwner.set(row.owner, entry);
  }
  return [...byOwner.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([owner, entry]) => ({ owner, title: titles.get(owner), ...entry }));
}

const counts = (record) => Object.entries(record).sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => `${key} ${count}`).join(", ");

function formatCoverage(entries, stats) {
  const lines = [];
  const totals = { rows: 0 };
  for (const entry of entries) {
    lines.push(`${entry.owner} ${entry.title}: ${entry.rows} rows`);
    lines.push(`  kind     ${counts(entry.kind)}`);
    lines.push(`  scope    ${counts(entry.scope)}`);
    for (const platform of PLATFORMS) {
      lines.push(`  ${platform.padEnd(8)} ${counts(entry[platform])}`);
      totals[platform] = Object.fromEntries(STATUSES.map((status) => [status, (totals[platform]?.[status] ?? 0) + (entry[platform][status] ?? 0)]));
    }
    totals.rows += entry.rows;
  }
  lines.push(`total ${totals.rows} rows (${stats.rules} rules, ${stats.overrides} overrides)`);
  for (const platform of PLATFORMS) {
    lines.push(`  ${platform.padEnd(8)} ${counts(totals[platform])}`);
  }
  return lines.join("\n");
}

function main(argv) {
  const option = (name) => {
    const index = argv.indexOf(name);
    if (index >= 0 && !argv[index + 1]) {
      throw new Error(`${name} requires a path`);
    }
    return index >= 0 ? loadJson(path.resolve(argv[index + 1])) : undefined;
  };
  const defaults = defaultInputs();
  const inputs = {
    map: option("--map") ?? defaults.map,
    inventory: option("--inventory") ?? defaults.inventory,
    dashboard: option("--dashboard") ?? defaults.dashboard,
  };
  const outcome = resolveMap(inputs);
  if (argv.includes("--check")) {
    if (outcome.problems.length > 0) {
      for (const problem of outcome.problems) {
        console.error(`${problem.code}: ${problem.message}`);
      }
      console.error(`PARITY_MAP_FAILED: ${outcome.problems.length} problems`);
      return 1;
    }
    console.log(`PARITY_MAP_PASSED: ${outcome.stats.rows} rows, ${outcome.stats.rules} rules, ${outcome.stats.overrides} overrides`);
    return 0;
  }
  if (outcome.stats === undefined) {
    for (const problem of outcome.problems) {
      console.error(`${problem.code}: ${problem.message}`);
    }
    return 1;
  }
  console.log(formatCoverage(coverage(outcome, inputs.dashboard), outcome.stats));
  if (outcome.problems.length > 0) {
    console.error(`${outcome.problems.length} problems; run with --check to list them`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
