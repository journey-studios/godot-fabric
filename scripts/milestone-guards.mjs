import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { withoutGitLocation } from "./git-environment.mjs";

// The guards of two exit criteria of the 0.5 Frontier milestone (dashboard/migration.json, milestones[0].exit):
//
//   X9   "The 1.0 does not move": the diff of tasks, phases, sequences, checklists and decisions is empty.
//   X10  "Frozen tail": 0 new pointer-*, EventTarget, Document or hover slices during the 0.5.
//
//   node scripts/milestone-guards.mjs --check [--base <ref>] [--root <dir>]
//   node scripts/milestone-guards.mjs --audit [--from c0f3702] [--to origin/main] [--out <file>] [--root <dir>]
//   node scripts/milestone-guards.mjs --audit --verify [--file <audit.json>] [--root <dir>]
//
// --check is the guard of a pull request. It compares the current tree with a base and needs no network. A base that
// cannot be resolved is an error, never a pass.
// --audit walks the first-parent commits of the 0.5 and compares the dashboard/migration.json of each commit with its
// parent's. It writes docs/evidence/milestone-exit-guards/audit.json, which holds only data derived from git.
// --audit --verify judges that receipt again without git: its verdicts must follow from the data it records, and the
// violations it records must be exactly the ones listed in KNOWN.
//
// The rules are written out in docs/research/milestone-exit-guards.md. This file neither closes X9 nor X10: both say
// "during the 0.5" and close when the milestone does, by running --audit again.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION_FILE = "dashboard/migration.json";
export const AUDIT_FILE = "docs/evidence/milestone-exit-guards/audit.json";
export const START = "c0f3702";
const AUDIT_SCHEMA = 1;

const ONE_POINT_ZERO_SECTIONS = ["tasks", "phases", "sequences", "releaseChecklist", "integrationChecklist", "decisions"];
const MILESTONE_ENTRY = /^milestone-0-5-/;
const V05_02_ENTRY = /^milestone-0-5-v05-02-/;
const FROZEN_TASK = "GF-13";

// The name of a new evidence folder, research note, test or script that opens a slice of the frozen tail.
export const TAIL_PATTERN = /(^|[-_/])(pointer|event[-_]?target|document|hover)/i;
// What V05-02 (the pointer spike of the 0.5) may add: any path segment that starts with this.
const ALLOWED_SEGMENT = /^world-input/i;

const CLASS_MOVES = "moves-1.0";
const CLASS_TEXT = "text-or-evidence";
const TEXT_FIELDS = new Set(["note", "label", "evidence"]);
const ITEM = "(item)";
const ORDER = "(order)";

// The violations of the history that the audit found and the lead accepted, one per commit and rule. The audit passes
// only if the violations it finds are exactly these (same commit, same rule, same items). A new violation is never added
// here without the lead's decision.
export const KNOWN = [
  {
    sha: "b0e40aa",
    pr: 74,
    rule: "X9",
    items: ["tasks[GF-27].checkpoints[slice].evidence", "tasks[GF-27].note"],
    classes: [CLASS_TEXT],
    what: "The note of GF-27 and the evidence of its `slice` checkpoint gained the hosted CI and Pages receipts of #69. No done, weight or status changed.",
    why: "#74 (P5 V05-04, another agent) merged those receipts into the same pull request as its own 0.5 entry. Both classes of change count against X9 because the criterion says the diff is empty; the lead judges this one.",
  },
];

const PATH_SPECS = ["docs/evidence", "docs/research", "tests", "scripts"];

// ---------------------------------------------------------------------------------------------
// Pure comparison of two dashboard/migration.json documents and of the files a change adds.

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
// A list that can be compared item by item: objects that each carry a string id, and no id twice. With a repeated id the
// items by id would collapse to the last one, and a copy added to the list would pass as no change; a list like that is
// compared as one value instead, which fails closed.
const isKeyed = (list) => Array.isArray(list) && list.every((item) => isObject(item) && typeof item.id === "string") && new Set(list.map((item) => item.id)).size === list.length;
const byPath = (left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
const unique = (values) => [...new Set(values)];

function describe(value) {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value.length <= 40 ? value : `string(${value.length})`;
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  return isObject(value) ? "object" : value;
}

// A change "moves the 1.0" unless it is only the text of a note or a label, or the evidence behind a checkpoint.
// A field that is not listed as text counts as a move: the safe side of an unknown.
export function classifyChange(field, change) {
  if (change === "reordered" || field === ITEM) {
    return CLASS_MOVES;
  }
  return TEXT_FIELDS.has(field) ? CLASS_TEXT : CLASS_MOVES;
}

function entry(location, field, change, before, after) {
  return { section: location.section, id: location.owner, path: location.path, field, change, class: classifyChange(field, change), before: describe(before), after: describe(after) };
}

// Objects are compared field by field, lists of objects with a distinct `id` item by item (tasks, checkpoints, checklist
// items, decisions) and everything else as one value. The note, label and evidence fields are always one value.
function diffValue(before, after, location, field, out) {
  if (isDeepStrictEqual(before, after)) {
    return;
  }
  const textual = TEXT_FIELDS.has(field);
  if (!textual && isObject(before) && isObject(after)) {
    for (const key of unique([...Object.keys(before), ...Object.keys(after)]).sort()) {
      const child = { ...location, path: `${location.path}.${key}` };
      if (!(key in before)) {
        out.push(entry(child, key, "added", undefined, after[key]));
      } else if (!(key in after)) {
        out.push(entry(child, key, "removed", before[key], undefined));
      } else {
        diffValue(before[key], after[key], child, key, out);
      }
    }
    return;
  }
  if (!textual && isKeyed(before) && isKeyed(after)) {
    const beforeById = new Map(before.map((item) => [item.id, item]));
    const afterById = new Map(after.map((item) => [item.id, item]));
    for (const [id, item] of beforeById) {
      if (!afterById.has(id)) {
        out.push(entry({ ...location, owner: location.owner ?? id, path: `${location.path}[${id}]` }, ITEM, "removed", item, undefined));
      }
    }
    for (const [id, item] of afterById) {
      if (!beforeById.has(id)) {
        out.push(entry({ ...location, owner: location.owner ?? id, path: `${location.path}[${id}]` }, ITEM, "added", undefined, item));
      }
    }
    const keptBefore = [...beforeById.keys()].filter((id) => afterById.has(id));
    const keptAfter = [...afterById.keys()].filter((id) => beforeById.has(id));
    if (!isDeepStrictEqual(keptBefore, keptAfter)) {
      out.push(entry(location, ORDER, "reordered", keptBefore, keptAfter));
    }
    for (const id of keptBefore) {
      diffValue(beforeById.get(id), afterById.get(id), { ...location, owner: location.owner ?? id, path: `${location.path}[${id}]` }, null, out);
    }
    return;
  }
  out.push(entry(location, field, "changed", before, after));
}

// What changed in the 1.0 sections between two documents, classified one by one.
export function inspectOnePointZero(base, head) {
  const changes = [];
  for (const section of ONE_POINT_ZERO_SECTIONS) {
    diffValue(base?.[section], head?.[section], { section, owner: null, path: section }, section, changes);
  }
  changes.sort(byPath);
  return {
    sections: ONE_POINT_ZERO_SECTIONS.filter((section) => changes.some((item) => item.section === section)),
    moves: changes.filter((item) => item.class === CLASS_MOVES).length,
    text: changes.filter((item) => item.class === CLASS_TEXT).length,
    changes,
  };
}

const activityOf = (data) => (Array.isArray(data?.activity) ? data.activity : []);

// The activity entries that head has and base does not.
function addedActivity(base, head) {
  const known = new Set(activityOf(base).map((item) => item.id));
  return activityOf(head).filter((item) => !known.has(item.id));
}

const isTailName = (relative) => TAIL_PATTERN.test(relative);
export const isAllowedTail = (relative) => relative.split("/").some((segment) => ALLOWED_SEGMENT.test(segment));

// The tail slices that the added files open. `baseEvidenceEntries` are the names directly under docs/evidence in the base.
// A new top-level evidence entry, a new note directly under docs/research and a new file anywhere under tests or scripts
// are slices when their name matches the tail pattern; world-input* is allowed. A file added inside an evidence folder
// that is not itself a slice is not one (it can retire a route, not open a slice); when its name matches the pattern it
// is only listed in insideFolders, with whether the folder was already in the base.
export function inspectTail(addedFiles, baseEvidenceEntries) {
  const slices = new Map();
  const inside = new Map();
  const slice = (slicePath, kind, name) => {
    slices.set(slicePath, { path: slicePath, kind, allowed: isAllowedTail(name) });
  };
  for (const file of addedFiles) {
    if (file.startsWith("docs/evidence/")) {
      const relative = file.slice("docs/evidence/".length);
      const top = relative.split("/")[0];
      const within = relative.slice(top.length + 1);
      if (!baseEvidenceEntries.has(top) && isTailName(top)) {
        slice(within === "" ? file : `docs/evidence/${top}/`, within === "" ? "evidence-file" : "evidence-folder", top);
      } else if (within !== "" && isTailName(within)) {
        inside.set(file, { path: file, folder: baseEvidenceEntries.has(top) ? "existing" : "new" });
      }
    } else if (file.startsWith("docs/research/")) {
      const relative = file.slice("docs/research/".length);
      if (!relative.includes("/") && isTailName(relative)) {
        slice(file, "research-note", relative);
      }
    } else if (file.startsWith("tests/") || file.startsWith("scripts/")) {
      const relative = file.slice(file.indexOf("/") + 1);
      if (isTailName(relative)) {
        slice(file, file.startsWith("tests/") ? "test" : "script", relative);
      }
    }
  }
  return { slices: [...slices.values()].sort(byPath), insideFolders: [...inside.values()].sort(byPath) };
}

const taskOf = (data, id) => (Array.isArray(data?.tasks) ? data.tasks.find((task) => task.id === id) : undefined);

// Everything the two guards need to know about one change (a commit against its parent, or a tree against its base).
export function inspectChange({ base, head, addedFiles, baseEvidenceEntries }) {
  const added = addedActivity(base, head);
  return {
    addedMilestoneActivity: added.map((item) => item.id).filter((id) => MILESTONE_ENTRY.test(id)),
    onePointZero: inspectOnePointZero(base, head),
    tail: inspectTail(addedFiles, baseEvidenceEntries),
    gf13: {
      changed: !isDeepStrictEqual(taskOf(base, FROZEN_TASK), taskOf(head, FROZEN_TASK)),
      addedActivity: added.filter((item) => Array.isArray(item.taskIds) && item.taskIds.includes(FROZEN_TASK)).map((item) => item.id),
    },
  };
}

// The verdicts of a change. X9 applies to a change that adds a milestone-0-5-* entry, and any change to the 1.0 sections
// then violates it, whatever its class. X10 is violated by a slice of the tail that V05-02 does not own, by an activity
// entry for GF-13, and by a change to the GF-13 task unless the change delivers V05-02.
export function judge(record) {
  const changed = unique(record.onePointZero.changes.map((item) => item.path)).sort();
  let x9;
  if (record.addedMilestoneActivity.length === 0) {
    x9 = { verdict: "not-applicable", items: [] };
  } else if (changed.length === 0) {
    x9 = { verdict: "clean", items: [] };
  } else {
    x9 = { verdict: "violation", items: changed };
  }
  const deliversV0502 = record.addedMilestoneActivity.some((id) => V05_02_ENTRY.test(id));
  const x10Items = [
    ...record.tail.slices.filter((slice) => !slice.allowed).map((slice) => `slice:${slice.path}`),
    ...record.gf13.addedActivity.map((id) => `gf13-activity:${id}`),
    ...(record.gf13.changed && !deliversV0502 ? [`task:${FROZEN_TASK}`] : []),
  ].sort();
  return { x9, x10: { verdict: x10Items.length === 0 ? "clean" : "violation", items: x10Items } };
}

// Compares the violations of a list of judged commits with KNOWN. A KNOWN entry whose commit is in the list must have been
// found (a loosened rule or a rewritten history would hide it), and every violation must have its entry.
export function compareToKnown(commits) {
  const found = [];
  for (const commit of commits) {
    for (const rule of ["X9", "X10"]) {
      const verdict = commit[rule.toLowerCase()];
      if (verdict.verdict === "violation") {
        const classes = rule === "X9" ? unique(commit.onePointZero.changes.map((change) => change.class)).sort() : [];
        found.push({ sha: commit.sha, rule, items: verdict.items, classes });
      }
    }
  }
  const accepted = [];
  const unexpected = [];
  for (const violation of found) {
    const known = KNOWN.find((item) => item.rule === violation.rule && violation.sha.startsWith(item.sha));
    if (!known) {
      unexpected.push({ ...violation, reason: "not in KNOWN" });
    } else if (!isDeepStrictEqual([...known.items].sort(), violation.items) || !isDeepStrictEqual([...known.classes].sort(), violation.classes)) {
      unexpected.push({ ...violation, reason: `its items or classes differ from the ones KNOWN accepts for ${known.sha}` });
    } else {
      accepted.push({ sha: known.sha, rule: known.rule, pr: known.pr });
    }
  }
  const missing = KNOWN.filter((known) => commits.some((commit) => commit.sha.startsWith(known.sha)) && !accepted.some((item) => item.sha === known.sha && item.rule === known.rule))
    .map((known) => ({ sha: known.sha, rule: known.rule, reason: "in the audited range but no violation was found" }));
  return { accepted, unexpected, missing };
}

export function summarizeCommits(commits) {
  const shorts = (predicate) => commits.filter(predicate).map((commit) => commit.short);
  const slices = commits.flatMap((commit) => commit.tail.slices);
  return {
    commits: commits.length,
    withMilestoneEntries: commits.filter((commit) => commit.addedMilestoneActivity.length > 0).length,
    x9: {
      clean: commits.filter((commit) => commit.x9.verdict === "clean").length,
      notApplicable: commits.filter((commit) => commit.x9.verdict === "not-applicable").length,
      violations: shorts((commit) => commit.x9.verdict === "violation"),
    },
    x10: {
      clean: commits.filter((commit) => commit.x10.verdict === "clean").length,
      violations: shorts((commit) => commit.x10.verdict === "violation"),
    },
    tailSlices: { allowed: slices.filter((slice) => slice.allowed).length, disallowed: slices.filter((slice) => !slice.allowed).length },
    insideFolders: commits.reduce((total, commit) => total + commit.tail.insideFolders.length, 0),
    gf13ChangedIn: shorts((commit) => commit.gf13.changed),
  };
}

// ---------------------------------------------------------------------------------------------
// git.

function git(root, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: root, env: withoutGitLocation(), encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (allowFailure) {
      return null;
    }
    throw new Error(`git ${args.join(" ")} failed: ${String(error.stderr || error.message).trim()}`);
  }
}

const splitNul = (output) => output.split("\0").filter(Boolean);

function revParse(root, ref) {
  const output = git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { allowFailure: true });
  return output === null ? null : output.trim();
}

function parseDocument(text, where) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${where} is not valid JSON: ${error.message}`);
  }
}

const migrationAt = (root, sha) => parseDocument(git(root, ["show", `${sha}:${MIGRATION_FILE}`]), `${MIGRATION_FILE} at ${sha.slice(0, 12)}`);

// The names directly under docs/evidence in a tree.
const evidenceEntriesAt = (root, sha) => new Set(splitNul(git(root, ["ls-tree", "-z", "--name-only", sha, "docs/evidence/"])).map((name) => name.slice("docs/evidence/".length)));

// ---------------------------------------------------------------------------------------------
// The guard of a pull request.

// The base is --base; without it, the merge-base of HEAD and origin/main (so that a branch behind main is not blamed for
// what main added); when there is no merge-base, origin/main itself. With none of them, there is no base and no pass.
function resolveBase(root, requested) {
  if (requested !== undefined) {
    const sha = revParse(root, requested);
    if (sha === null) {
      throw new Error(`--base ${requested} does not resolve to a commit in this checkout. In a shallow clone fetch it first: git fetch --depth=1 origin <sha>`);
    }
    return { sha, how: `--base ${requested}` };
  }
  const tip = revParse(root, "origin/main");
  if (tip === null) {
    throw new Error("there is no base to compare with: --base was not given and origin/main does not exist in this checkout (fetch it, or pass --base <ref>)");
  }
  const mergeBase = git(root, ["merge-base", "HEAD", "origin/main"], { allowFailure: true })?.trim();
  if (mergeBase) {
    return { sha: mergeBase, how: "the merge-base of HEAD and origin/main" };
  }
  return { sha: tip, how: "origin/main (this checkout has no merge-base with it)" };
}

function runCheck({ root, base: requested }) {
  const base = resolveBase(root, requested);
  const baseData = migrationAt(root, base.sha);
  const headData = parseDocument(readFileSync(path.join(root, MIGRATION_FILE), "utf8"), MIGRATION_FILE);
  const baseFiles = new Set(splitNul(git(root, ["ls-tree", "-r", "-z", "--name-only", base.sha, "--", ...PATH_SPECS])));
  const headFiles = splitNul(git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...PATH_SPECS]));
  const addedFiles = unique(headFiles.filter((file) => !baseFiles.has(file))).sort();
  const baseEvidenceEntries = new Set([...baseFiles].filter((file) => file.startsWith("docs/evidence/")).map((file) => file.slice("docs/evidence/".length).split("/")[0]));
  const record = inspectChange({ base: baseData, head: headData, addedFiles, baseEvidenceEntries });
  return { base, record, verdicts: judge(record) };
}

function describeCheckFailures({ base, record, verdicts }) {
  const lines = [`MILESTONE_GUARDS_CHECK_FAILED: against ${base.sha.slice(0, 12)} (${base.how})`];
  if (verdicts.x9.verdict === "violation") {
    lines.push(`X9: this change adds ${record.addedMilestoneActivity.join(", ")} and also changes the 1.0 (the criterion says the diff is empty):`);
    for (const change of record.onePointZero.changes) {
      lines.push(`  - ${change.path} (${change.class}: ${change.change}${change.field === ITEM || change.field === ORDER ? "" : ` ${change.field}`})`);
    }
  }
  if (verdicts.x10.verdict === "violation") {
    lines.push("X10: the tail of GF-13 is frozen during the 0.5:");
    for (const item of verdicts.x10.items) {
      lines.push(`  - ${item}`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------
// The audit of the history.

const PR_FROM_SUBJECT = /\(#(\d+)\)\s*$/;

function runAudit({ root, from, to }) {
  const start = revParse(root, from);
  if (start === null) {
    throw new Error(`--from ${from} does not resolve to a commit`);
  }
  const startParent = revParse(root, `${start}^`);
  if (startParent === null) {
    throw new Error(`--from ${from} has no parent to compare it with`);
  }
  const end = revParse(root, to);
  if (end === null) {
    throw new Error(`--to ${to} does not resolve to a commit`);
  }
  const listing = splitNul(git(root, ["log", "--first-parent", "--reverse", "-z", "--format=%H%x1f%P%x1f%s", `${startParent}..${end}`]));
  const commits = [];
  const cache = new Map();
  const dataAt = (sha) => {
    if (!cache.has(sha)) {
      cache.set(sha, migrationAt(root, sha));
    }
    return cache.get(sha);
  };
  let previous = null;
  for (const line of listing) {
    const [sha, parents, subject] = line.split("\x1f");
    const parent = parents.split(" ")[0];
    if (previous === null ? sha !== start : parent !== previous) {
      throw new Error(`--from ${from} is not on the first-parent line that ends at --to ${to}`);
    }
    const added = splitNul(git(root, ["diff-tree", "-r", "-z", "--no-renames", "--name-status", "--no-commit-id", parent, sha]));
    const addedFiles = [];
    for (let index = 0; index + 1 < added.length; index += 2) {
      if (added[index] === "A") {
        addedFiles.push(added[index + 1]);
      }
    }
    const record = inspectChange({ base: dataAt(parent), head: dataAt(sha), addedFiles: addedFiles.sort(), baseEvidenceEntries: evidenceEntriesAt(root, parent) });
    const prMatch = PR_FROM_SUBJECT.exec(subject);
    commits.push({
      sha,
      short: sha.slice(0, 7),
      parent,
      subject,
      pr: prMatch ? parseInt(prMatch[1], 10) : null,
      ...record,
      ...judge(record),
    });
    cache.delete(parent);
    previous = sha;
  }
  if (commits.length === 0 || commits.at(-1).sha !== end) {
    throw new Error(`--to ${to} is not the end of a first-parent line that starts at --from ${from}`);
  }
  return buildAudit({ requestedFrom: from, requestedTo: to, from: start, to: end, commits });
}

function buildAudit({ requestedFrom, requestedTo, from, to, commits }) {
  const comparison = compareToKnown(commits);
  return {
    schema: AUDIT_SCHEMA,
    rules: {
      x9: "A change that adds a milestone-0-5-* activity entry leaves tasks, phases, sequences, releaseChecklist, integrationChecklist and decisions equal in depth to its parent's. Both classes of change count: moves-1.0 (done, status, weight, a checkpoint or item added or removed, any other field) and text-or-evidence (note, label, evidence).",
      x10: "No new evidence folder directly under docs/evidence, no new note directly under docs/research and no new file under tests or scripts whose name matches the tail pattern, unless it is world-input*; no activity entry with GF-13 in taskIds; no change to the GF-13 task unless the change delivers V05-02. A file added inside an evidence folder that is not itself a slice is not one: it is only listed.",
      tailPattern: `${TAIL_PATTERN.source} (flags ${TAIL_PATTERN.flags})`,
      allowed: `a path segment that matches ${ALLOWED_SEGMENT.source} (flags ${ALLOWED_SEGMENT.flags})`,
    },
    range: {
      from: { requested: requestedFrom, sha: from },
      to: { requested: requestedTo, sha: to },
      comparedWith: "the first parent of each commit",
    },
    summary: summarizeCommits(commits),
    known: KNOWN,
    result: { passed: comparison.unexpected.length === 0 && comparison.missing.length === 0, accepted: comparison.accepted, unexpected: comparison.unexpected, missing: comparison.missing },
    commits,
  };
}

// The receipt judged again, with no git: it must be internally coherent and its violations exactly the ones in KNOWN.
export function verifyAudit(audit) {
  const problems = [];
  const sha1 = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
  if (audit?.schema !== AUDIT_SCHEMA || !Array.isArray(audit.commits) || audit.commits.length === 0) {
    return [`the receipt is not a schema ${AUDIT_SCHEMA} audit with commits`];
  }
  if (!sha1(audit.range?.from?.sha) || !sha1(audit.range?.to?.sha)) {
    problems.push("range.from.sha or range.to.sha is not a full SHA-1");
  } else if (!audit.range.from.sha.startsWith(START)) {
    problems.push(`the audit does not start at ${START}`);
  }
  const commits = audit.commits;
  if (commits[0].sha !== audit.range?.from?.sha || commits.at(-1).sha !== audit.range?.to?.sha) {
    problems.push("the commits do not run from range.from to range.to");
  }
  commits.forEach((commit, index) => {
    const label = `commit ${String(commit.sha).slice(0, 7)}`;
    if (!sha1(commit.sha) || commit.short !== commit.sha.slice(0, 7)) {
      problems.push(`${label}: the SHA and its short form disagree`);
    }
    if (index > 0 && commit.parent !== commits[index - 1].sha) {
      problems.push(`${label}: its parent is not the previous commit of the line`);
    }
    const prMatch = PR_FROM_SUBJECT.exec(commit.subject ?? "");
    if (commit.pr !== (prMatch ? parseInt(prMatch[1], 10) : null)) {
      problems.push(`${label}: the PR number does not follow from the subject`);
    }
    for (const change of commit.onePointZero?.changes ?? []) {
      if (change.class !== classifyChange(change.field, change.change)) {
        problems.push(`${label}: ${change.path} is classified ${change.class}, not ${classifyChange(change.field, change.change)}`);
      }
    }
    try {
      const verdicts = judge(commit);
      if (!isDeepStrictEqual(verdicts.x9, commit.x9) || !isDeepStrictEqual(verdicts.x10, commit.x10)) {
        problems.push(`${label}: its verdicts do not follow from the data it records`);
      }
    } catch {
      problems.push(`${label}: it does not record the data its verdicts need`);
    }
  });
  if (!isDeepStrictEqual(audit.summary, summarizeCommits(commits))) {
    problems.push("the summary does not follow from the commits");
  }
  if (!isDeepStrictEqual(audit.known, KNOWN)) {
    problems.push("the KNOWN list the receipt carries is not the one in the script: run --audit again");
  }
  const comparison = compareToKnown(commits);
  for (const item of comparison.unexpected) {
    problems.push(`${item.rule} violation in ${item.sha.slice(0, 7)} (${item.reason}): ${item.items.join(", ")}`);
  }
  for (const item of comparison.missing) {
    problems.push(`KNOWN ${item.rule} violation of ${item.sha} was not found in the audited range`);
  }
  if (audit.result?.passed !== (comparison.unexpected.length === 0 && comparison.missing.length === 0)) {
    problems.push("result.passed does not follow from the violations");
  }
  return problems;
}

function renderAuditTable(audit) {
  const rows = [["commit", "PR", "0.5 entries", "X9", "X10", "subject"]];
  for (const commit of audit.commits) {
    rows.push([commit.short, commit.pr === null ? "-" : `#${commit.pr}`, String(commit.addedMilestoneActivity.length), commit.x9.verdict, commit.x10.verdict, commit.subject]);
  }
  const widths = rows[0].slice(0, 5).map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row) => `${row.slice(0, 5).map((cell, column) => cell.padEnd(widths[column])).join("  ")}  ${row[5]}`).join("\n");
}

function auditSentence(audit) {
  const { summary, result } = audit;
  const known = result.accepted.map((item) => `${item.sha} (${item.rule}, #${item.pr})`);
  return `${summary.commits} first-parent commits (${summary.withMilestoneEntries} add a 0.5 entry), X9 violations: ${summary.x9.violations.length === 0 ? "none" : summary.x9.violations.join(", ")}, X10 violations: ${summary.x10.violations.length === 0 ? "none" : summary.x10.violations.join(", ")}, known: ${known.length === 0 ? "none" : known.join(", ")}`;
}

// ---------------------------------------------------------------------------------------------
// Command line.

const USAGE = `usage:
  node scripts/milestone-guards.mjs --check [--base <ref>] [--root <dir>]
  node scripts/milestone-guards.mjs --audit [--from ${START}] [--to origin/main] [--out <file>] [--root <dir>]
  node scripts/milestone-guards.mjs --audit --verify [--file <audit.json>] [--root <dir>]`;

export function parseArguments(argv) {
  const options = {};
  const takesValue = new Set(["--base", "--root", "--from", "--to", "--out", "--file"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check" || argument === "--audit" || argument === "--verify") {
      options[argument.slice(2)] = true;
    } else if (takesValue.has(argument)) {
      const value = argv[index + 1];
      if (value === undefined || value === "" || value.startsWith("-")) {
        throw new Error(`${argument} needs a value\n${USAGE}`);
      }
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`unknown argument ${argument}\n${USAGE}`);
    }
  }
  if (options.check === options.audit) {
    throw new Error(`pass exactly one of --check and --audit\n${USAGE}`);
  }
  const misplaced = [];
  if (options.check) {
    misplaced.push(...["verify", "from", "to", "out", "file"].filter((name) => options[name] !== undefined));
  } else if (options.verify) {
    misplaced.push(...["base", "from", "to", "out"].filter((name) => options[name] !== undefined));
  } else {
    misplaced.push(...["base", "file"].filter((name) => options[name] !== undefined));
  }
  if (misplaced.length > 0) {
    throw new Error(`--${misplaced.join(", --")} does not go with this mode\n${USAGE}`);
  }
  return options;
}

function main(argv) {
  const options = parseArguments(argv);
  const root = options.root === undefined ? REPO_ROOT : path.resolve(options.root);
  if (options.check) {
    const outcome = runCheck({ root, base: options.base });
    if (outcome.verdicts.x9.verdict === "violation" || outcome.verdicts.x10.verdict === "violation") {
      console.error(describeCheckFailures(outcome).join("\n"));
      process.exitCode = 1;
      return;
    }
    console.log(`MILESTONE_GUARDS_CHECK_PASSED: against ${outcome.base.sha.slice(0, 12)} (${outcome.base.how}); X9 ${outcome.verdicts.x9.verdict}, X10 ${outcome.verdicts.x10.verdict}`);
    return;
  }
  if (options.verify) {
    const file = options.file === undefined ? path.join(root, AUDIT_FILE) : path.resolve(options.file);
    const audit = parseDocument(readFileSync(file, "utf8"), "the audit receipt");
    const problems = verifyAudit(audit);
    if (problems.length > 0) {
      console.error(`MILESTONE_GUARDS_AUDIT_FAILED: the receipt is not coherent\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
      process.exitCode = 1;
      return;
    }
    console.log(`MILESTONE_GUARDS_AUDIT_VERIFIED: ${auditSentence(audit)}`);
    return;
  }
  const audit = runAudit({ root, from: options.from ?? START, to: options.to ?? "origin/main" });
  const out = options.out === undefined ? path.join(root, AUDIT_FILE) : path.resolve(options.out);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(audit, null, 2)}\n`);
  console.log(renderAuditTable(audit));
  if (!audit.result.passed) {
    const lines = [...audit.result.unexpected.map((item) => `  - ${item.rule} in ${item.sha.slice(0, 7)} (${item.reason}): ${item.items.join(", ")}`), ...audit.result.missing.map((item) => `  - ${item.rule} of ${item.sha}: ${item.reason}`)];
    console.error(`MILESTONE_GUARDS_AUDIT_FAILED: the violations are not exactly the ones in KNOWN\n${lines.join("\n")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`MILESTONE_GUARDS_AUDIT_PASSED: ${auditSentence(audit)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`MILESTONE_GUARDS_ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
