import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GIT_LOCATION_VARIABLES, withoutGitLocation } from "../scripts/git-environment.mjs";
import {
  AUDIT_FILE,
  KNOWN,
  START,
  TAIL_PATTERN,
  classifyChange,
  compareToKnown,
  inspectChange,
  inspectOnePointZero,
  inspectTail,
  isAllowedTail,
  judge,
  parseArguments,
  summarizeCommits,
  verifyAudit,
} from "../scripts/milestone-guards.mjs";

// The guards of the 0.5 exit criteria X9 (the 1.0 does not move) and X10 (frozen tail), scripts/milestone-guards.mjs.
//
// The checkout of the CI is shallow (depth 1), so nothing here reads the history of this repository. The pure comparisons
// run on synthetic documents, --check runs on this tree against HEAD and on throwaway repositories, --audit runs on a
// throwaway history, and the committed receipt (docs/evidence/milestone-exit-guards/audit.json) is judged again with no git.
// That summarize() of the dashboard is the same with and without `milestones` is proved by
// tests/migration-dashboard.test.mjs ("milestones never change the release numbers and are optional").

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "milestone-guards.mjs");

// ---------------------------------------------------------------------------------------------
// Synthetic documents.

const baseDocument = () => ({
  tasks: [
    {
      id: "GF-01",
      status: "in_progress",
      weight: 1,
      note: "first note",
      checkpoints: [{ id: "slice", label: "First slice", done: false, evidence: [] }],
    },
    {
      id: "GF-13",
      status: "in_progress",
      weight: 1,
      note: "input",
      checkpoints: [{ id: "slice", label: "Input slice", done: true, evidence: [{ label: "evidence", url: "https://example.invalid/e" }] }],
    },
  ],
  phases: [{ id: "M0", title: "Contract" }],
  sequences: [{ id: "1", title: "Startup", taskIds: ["GF-01"] }],
  releaseChecklist: [{ id: "RC-01", label: "Inventory", done: false, evidence: [] }],
  integrationChecklist: [{ id: "HUD-1", label: "Consumer", done: false, evidence: [] }],
  decisions: [{ id: "D01", title: "Configuration", status: "approved" }],
  milestones: [{ id: "0.5", exit: [{ id: "X9", done: false, evidence: [] }] }],
  source: { commit: "a" },
  updatedAt: "2026-10-01T00:00:00.000Z",
  activity: [{ id: "earlier", taskIds: ["GF-01"], message: "before the 0.5" }],
});

const clone = (value) => structuredClone(value);
const withEntry = (document, id = "milestone-0-5-test", taskIds = []) => {
  const copy = clone(document);
  copy.activity.unshift({ id, taskIds, message: "a 0.5 entry" });
  return copy;
};
const task = (document, id) => document.tasks.find((item) => item.id === id);

// What the guards say about head against base, with the files the change adds.
function verdictsOf(base, head, addedFiles = [], baseEvidenceEntries = new Set(["scroll-view"])) {
  const record = inspectChange({ base, head, addedFiles, baseEvidenceEntries });
  return { record, ...judge(record) };
}

// ---------------------------------------------------------------------------------------------
// X9 on synthetic documents.

test("X9: a change that adds a 0.5 entry and leaves the 1.0 alone is clean", () => {
  const base = baseDocument();
  const head = withEntry(base);
  head.milestones[0].exit[0].done = true;
  head.source = { commit: "b" };
  head.updatedAt = "2026-10-02T00:00:00.000Z";
  const outcome = verdictsOf(base, head);
  assert.deepEqual(outcome.record.addedMilestoneActivity, ["milestone-0-5-test"]);
  assert.deepEqual(outcome.x9, { verdict: "clean", items: [] });
  assert.equal(outcome.record.onePointZero.changes.length, 0);
  assert.deepEqual(outcome.x10, { verdict: "clean", items: [] });
});

test("X9: without a 0.5 entry it does not apply, even when a GF delivery changes the 1.0", () => {
  const base = baseDocument();
  const head = clone(base);
  task(head, "GF-01").note = "a delivery";
  task(head, "GF-01").checkpoints[0].done = true;
  head.activity.unshift({ id: "gf-01-delivery", taskIds: ["GF-01"], message: "delivery" });
  const outcome = verdictsOf(base, head);
  assert.deepEqual(outcome.record.addedMilestoneActivity, []);
  assert.equal(outcome.x9.verdict, "not-applicable");
  assert.equal(outcome.record.onePointZero.changes.length, 2, "the audit still reports what changed");
});

test("X9: an entry whose id is not milestone-0-5-* does not make a change a 0.5 change", () => {
  const base = baseDocument();
  const head = withEntry(base, "milestone-0-6-other");
  task(head, "GF-01").note = "x";
  assert.equal(verdictsOf(base, head).x9.verdict, "not-applicable");
});

test("X9: a changed note violates, as text", () => {
  const base = baseDocument();
  const head = withEntry(base);
  task(head, "GF-01").note = "a longer note than before";
  const { x9, record } = verdictsOf(base, head);
  assert.equal(x9.verdict, "violation");
  assert.deepEqual(x9.items, ["tasks[GF-01].note"]);
  assert.deepEqual(record.onePointZero.sections, ["tasks"]);
  assert.equal(record.onePointZero.text, 1);
  assert.equal(record.onePointZero.moves, 0);
  const [change] = record.onePointZero.changes;
  assert.equal(change.id, "GF-01");
  assert.equal(change.class, "text-or-evidence");
  assert.equal(change.change, "changed");
});

test("X9: evidence and labels are text, and a changed checkpoint reports the checkpoint's path", () => {
  const base = baseDocument();
  const head = withEntry(base);
  task(head, "GF-01").checkpoints[0].evidence.push({ label: "receipt", url: "https://example.invalid/r" });
  task(head, "GF-01").checkpoints[0].label = "renamed";
  head.releaseChecklist[0].label = "renamed too";
  const { x9, record } = verdictsOf(base, head);
  assert.deepEqual(x9.items, ["releaseChecklist[RC-01].label", "tasks[GF-01].checkpoints[slice].evidence", "tasks[GF-01].checkpoints[slice].label"]);
  assert.deepEqual(record.onePointZero.sections, ["tasks", "releaseChecklist"]);
  assert.ok(record.onePointZero.changes.every((change) => change.class === "text-or-evidence"));
});

test("X9: done, status and weight move the 1.0", () => {
  const base = baseDocument();
  const head = withEntry(base);
  task(head, "GF-01").checkpoints[0].done = true;
  task(head, "GF-01").status = "complete";
  task(head, "GF-13").weight = 2;
  head.integrationChecklist[0].done = true;
  const { x9, record } = verdictsOf(base, head);
  assert.equal(x9.verdict, "violation");
  assert.deepEqual(x9.items, ["integrationChecklist[HUD-1].done", "tasks[GF-01].checkpoints[slice].done", "tasks[GF-01].status", "tasks[GF-13].weight"]);
  assert.equal(record.onePointZero.moves, 4);
  assert.equal(record.onePointZero.text, 0);
  const done = record.onePointZero.changes.find((change) => change.path === "tasks[GF-01].checkpoints[slice].done");
  assert.deepEqual([done.before, done.after], [false, true]);
});

test("X9: a new GF, checkpoint, checklist item or decision moves the 1.0, and so does removing one", () => {
  const base = baseDocument();
  const head = withEntry(base);
  head.tasks.push({ id: "GF-99", status: "planned", weight: 1, note: "new", checkpoints: [] });
  task(head, "GF-01").checkpoints.push({ id: "second", label: "Second", done: false, evidence: [] });
  head.releaseChecklist.push({ id: "RC-02", label: "New item", done: false, evidence: [] });
  head.decisions.push({ id: "D02", title: "New", status: "proposed" });
  head.sequences = [];
  const { x9, record } = verdictsOf(base, head);
  assert.deepEqual(x9.items, ["decisions[D02]", "releaseChecklist[RC-02]", "sequences[1]", "tasks[GF-01].checkpoints[second]", "tasks[GF-99]"]);
  assert.ok(record.onePointZero.changes.every((change) => change.class === "moves-1.0" && change.field === "(item)"));
  assert.deepEqual(record.onePointZero.changes.map((change) => change.change).sort(), ["added", "added", "added", "added", "removed"]);
});

test("X9: any field that is not note, label or evidence counts as a move, and so does a reordering", () => {
  const base = baseDocument();
  const head = withEntry(base);
  head.phases[0].title = "Another title";
  task(head, "GF-01").priority = "P0";
  head.tasks.reverse();
  const { x9, record } = verdictsOf(base, head);
  assert.deepEqual(x9.items, ["phases[M0].title", "tasks", "tasks[GF-01].priority"]);
  assert.deepEqual(record.onePointZero.changes.map((change) => change.class), ["moves-1.0", "moves-1.0", "moves-1.0"]);
  assert.equal(classifyChange("note", "changed"), "text-or-evidence");
  assert.equal(classifyChange("evidence", "added"), "text-or-evidence");
  assert.equal(classifyChange("label", "removed"), "text-or-evidence");
  assert.equal(classifyChange("done", "changed"), "moves-1.0");
  assert.equal(classifyChange("(item)", "added"), "moves-1.0");
});

test("X9: milestones, source, updatedAt and activity are not part of the 1.0", () => {
  const base = baseDocument();
  const head = withEntry(base);
  head.milestones[0].title = "changed";
  head.milestones.push({ id: "0.6", exit: [] });
  head.source = { commit: "z" };
  head.activity.push({ id: "another", taskIds: ["GF-01"], message: "an entry for a GF" });
  assert.equal(verdictsOf(base, head).x9.verdict, "clean");
  assert.equal(inspectOnePointZero(base, head).changes.length, 0);
});

test("X9: a list with a repeated id is compared whole, so a change in it cannot pass as no change", () => {
  const base = baseDocument();

  // A copy of an existing checkpoint added to the list that has it: by id it would collapse to the last one.
  const copied = withEntry(base);
  const checkpoints = task(copied, "GF-01").checkpoints;
  checkpoints.push(clone(checkpoints[0]));
  const added = verdictsOf(base, copied);
  assert.equal(added.x9.verdict, "violation");
  assert.deepEqual(added.x9.items, ["tasks[GF-01].checkpoints"]);
  assert.deepEqual(
    added.record.onePointZero.changes.map((change) => [change.field, change.change, change.class, change.before, change.after]),
    [["checkpoints", "changed", "moves-1.0", "array(1)", "array(2)"]],
  );

  // The id repeated on both sides, and the item that changed is not the last one.
  const repeated = clone(base);
  task(repeated, "GF-01").checkpoints = [
    { id: "slice", label: "First", done: false, evidence: [] },
    { id: "slice", label: "Second", done: false, evidence: [] },
  ];
  repeated.releaseChecklist.push({ id: "RC-01", label: "Again", done: false, evidence: [] });
  assert.equal(verdictsOf(repeated, withEntry(repeated)).x9.verdict, "clean", "the same lists, unchanged, are no change");
  const changed = withEntry(repeated);
  task(changed, "GF-01").checkpoints[0].done = true;
  changed.releaseChecklist[0].done = true;
  const outcome = verdictsOf(repeated, changed);
  assert.deepEqual(outcome.x9.items, ["releaseChecklist", "tasks[GF-01].checkpoints"]);
  assert.ok(outcome.record.onePointZero.changes.every((change) => change.change === "changed" && change.class === "moves-1.0"));

  // A repeated id on one side only is compared whole too.
  const oneSided = withEntry(base);
  oneSided.decisions.push({ id: "D01", title: "Again", status: "approved" });
  assert.deepEqual(verdictsOf(base, oneSided).x9.items, ["decisions"]);

  // Lists whose ids are distinct still report the item.
  const distinct = withEntry(base);
  task(distinct, "GF-01").checkpoints[0].done = true;
  assert.deepEqual(verdictsOf(base, distinct).x9.items, ["tasks[GF-01].checkpoints[slice].done"]);
});

// ---------------------------------------------------------------------------------------------
// KNOWN and the comparison with it.

const judged = (sha, outcome) => ({ sha, short: sha.slice(0, 7), ...outcome.record, x9: outcome.x9, x10: outcome.x10 });

test("KNOWN holds the one violation the history has, with the reason", () => {
  assert.equal(KNOWN.length, 1);
  assert.equal(KNOWN[0].sha, "b0e40aa");
  assert.equal(KNOWN[0].pr, 74);
  assert.equal(KNOWN[0].rule, "X9");
  assert.deepEqual(KNOWN[0].items, ["tasks[GF-27].checkpoints[slice].evidence", "tasks[GF-27].note"]);
  assert.deepEqual(KNOWN[0].classes, ["text-or-evidence"]);
  assert.match(KNOWN[0].what, /#69/);
  assert.match(KNOWN[0].why, /#74/);
});

test("the audit accepts exactly the violations in KNOWN, no more, no fewer", () => {
  const base = baseDocument();
  const baseWithGf27 = clone(base);
  baseWithGf27.tasks.push({ id: "GF-27", status: "in_progress", weight: 1, note: "n", checkpoints: [{ id: "slice", label: "L", done: true, evidence: [] }] });
  const knownHead = withEntry(baseWithGf27);
  task(knownHead, "GF-27").note = "n plus the receipts";
  task(knownHead, "GF-27").checkpoints[0].evidence = [{ label: "receipt", url: "https://example.invalid/r" }];
  const knownCommit = judged("b0e40aa21fcab67cfa01b77e27117c895a30c886", verdictsOf(baseWithGf27, knownHead));
  const cleanCommit = judged("1111111111111111111111111111111111111111", verdictsOf(base, withEntry(base)));
  assert.deepEqual(compareToKnown([cleanCommit, knownCommit]), { accepted: [{ sha: "b0e40aa", rule: "X9", pr: 74 }], unexpected: [], missing: [] });

  // The same commit with one more change is not the one that was accepted.
  const wider = clone(knownHead);
  task(wider, "GF-27").checkpoints[0].done = false;
  const widerCommit = judged("b0e40aa21fcab67cfa01b77e27117c895a30c886", verdictsOf(baseWithGf27, wider));
  const widerOutcome = compareToKnown([widerCommit]);
  assert.equal(widerOutcome.unexpected.length, 1);
  assert.match(widerOutcome.unexpected[0].reason, /items or classes differ/);

  // Another commit with a violation has no entry.
  const stranger = clone(base);
  const strangerHead = withEntry(stranger);
  task(strangerHead, "GF-01").note = "moved";
  const strangerCommit = judged("2222222222222222222222222222222222222222", verdictsOf(stranger, strangerHead));
  const strangerOutcome = compareToKnown([cleanCommit, strangerCommit]);
  assert.deepEqual(strangerOutcome.unexpected.map((item) => [item.sha.slice(0, 7), item.rule, item.reason]), [["2222222", "X9", "not in KNOWN"]]);

  // KNOWN's commit in the range but clean (a loosened rule or a rewritten history) is missing; out of the range it is not.
  const hiddenCommit = judged("b0e40aa21fcab67cfa01b77e27117c895a30c886", verdictsOf(base, withEntry(base)));
  assert.deepEqual(compareToKnown([hiddenCommit]).missing.map((item) => item.sha), ["b0e40aa"]);
  assert.deepEqual(compareToKnown([cleanCommit]), { accepted: [], unexpected: [], missing: [] });
});

// ---------------------------------------------------------------------------------------------
// X10 on synthetic names and documents.

test("X10: the tail pattern matches the names of the frozen slices and nothing else", () => {
  for (const name of ["pointer-up", "rn-pointer-overlay", "pointer", "Pointer-Foo", "pointer-document-up", "event-target", "eventtarget", "event_target", "event_target-x", "rn-event_target-overlay", "rn-event-target-overlay", "document", "hover", "scroll_hover", "tests/hover", "pointerClick-disabled.json"]) {
    assert.ok(TAIL_PATTERN.test(name), `${name} should match`);
  }
  for (const name of ["frontier-game", "world-input", "world-input-a2", "scroll-view", "milestone-exit-guards", "unpointer", "subdocument", "README.md", "frontier-hud.md"]) {
    assert.equal(TAIL_PATTERN.test(name), false, `${name} should not match`);
  }
  assert.ok(TAIL_PATTERN.ignoreCase);
  assert.ok(isAllowedTail("world-input-pointer-x"));
  assert.ok(isAllowedTail("World-Input-A2"));
  assert.equal(isAllowedTail("pointer-world-input-x"), false, "world-input must start a segment");
  assert.equal(isAllowedTail("pointer-foo"), false);
});

const tailOf = (addedFiles, baseEvidenceEntries = new Set(["scroll-view", "README.md"])) => inspectTail(addedFiles, baseEvidenceEntries);

test("X10: a new evidence folder whose name matches the tail is a slice that violates", () => {
  const { slices } = tailOf(["docs/evidence/pointer-foo/README.md", "docs/evidence/pointer-foo/report.json"]);
  assert.deepEqual(slices, [{ path: "docs/evidence/pointer-foo/", kind: "evidence-folder", allowed: false }]);
  const outcome = verdictsOf(baseDocument(), baseDocument(), ["docs/evidence/pointer-foo/README.md"]);
  assert.deepEqual(outcome.x10, { verdict: "violation", items: ["slice:docs/evidence/pointer-foo/"] });
});

test("X10: world-input* is allowed, and a name that does not match is no slice at all", () => {
  assert.deepEqual(tailOf(["docs/evidence/world-input-x/README.md"]).slices, [], "world-input-x does not match the pattern");
  const allowed = tailOf(["docs/evidence/world-input-pointer-x/README.md", "docs/research/world-input-hover.md", "tests/world-input-pointer-x.test.mjs", "scripts/world-input-hover-x.mjs"]);
  assert.ok(allowed.slices.length === 4 && allowed.slices.every((slice) => slice.allowed), JSON.stringify(allowed.slices));
  const outcome = verdictsOf(baseDocument(), baseDocument(), ["docs/evidence/world-input-pointer-x/README.md", "tests/world-input-pointer-x.test.mjs"]);
  assert.deepEqual(outcome.x10, { verdict: "clean", items: [] });
});

test("X10: a file added inside an evidence folder that is not a slice is not one, and is listed", () => {
  const inside = tailOf(["docs/evidence/scroll-view/pointer-route-capture-retirement.json", "docs/evidence/scroll-view/README.md", "docs/evidence/scroll-view-2/pointer-x.json", "docs/evidence/scroll-view-2/README.md"]);
  assert.deepEqual(inside.slices, []);
  assert.deepEqual(inside.insideFolders, [
    { path: "docs/evidence/scroll-view-2/pointer-x.json", folder: "new" },
    { path: "docs/evidence/scroll-view/pointer-route-capture-retirement.json", folder: "existing" },
  ]);
  assert.equal(verdictsOf(baseDocument(), baseDocument(), ["docs/evidence/scroll-view/pointer-route-capture-retirement.json"]).x10.verdict, "clean");
});

test("X10: a new research note, test or script whose name matches the tail violates", () => {
  const { slices } = tailOf(["docs/research/event-target-two.md", "tests/hover-probe.gd", "tests/event_target-x.test.mjs", "tests/fixtures/pointer-case.json", "scripts/document-up.mjs", "docs/research/frontier-hud.md", "tests/frontier-hud.test.mjs", "docs/research/nested/pointer.md"]);
  assert.deepEqual(
    slices.map((slice) => [slice.path, slice.kind, slice.allowed]),
    [
      ["docs/research/event-target-two.md", "research-note", false],
      ["scripts/document-up.mjs", "script", false],
      ["tests/event_target-x.test.mjs", "test", false],
      ["tests/fixtures/pointer-case.json", "test", false],
      ["tests/hover-probe.gd", "test", false],
    ],
  );
  assert.deepEqual(tailOf(["docs/evidence/event_target-x/README.md"]).slices, [{ path: "docs/evidence/event_target-x/", kind: "evidence-folder", allowed: false }]);
});

test("X10: a new loose file under docs/evidence is judged by its name; a name already in the base is not new", () => {
  assert.deepEqual(tailOf(["docs/evidence/pointer-map.json"]).slices, [{ path: "docs/evidence/pointer-map.json", kind: "evidence-file", allowed: false }]);
  assert.deepEqual(tailOf(["docs/evidence/pointer-map.json"], new Set(["pointer-map.json"])).slices, []);
});

test("X10: no activity entry for GF-13, and no change to GF-13 unless the change delivers V05-02", () => {
  const base = baseDocument();
  const withActivity = withEntry(base);
  withActivity.activity.unshift({ id: "gf-13-more", taskIds: ["GF-13", "GF-01"], message: "pointer" });
  assert.deepEqual(verdictsOf(base, withActivity).x10, { verdict: "violation", items: ["gf13-activity:gf-13-more"] });

  const changed = clone(base);
  task(changed, "GF-13").note = "more input work";
  assert.deepEqual(verdictsOf(base, changed).x10, { verdict: "violation", items: ["task:GF-13"] });

  const delivered = withEntry(changed, "milestone-0-5-v05-02-slice");
  const outcome = verdictsOf(base, delivered);
  assert.deepEqual(outcome.x10, { verdict: "clean", items: [] }, "a change of the V05-02 delivery may touch GF-13");
  assert.equal(outcome.x9.verdict, "violation", "but it still changes the 1.0, which X9 judges");

  const other = withEntry(changed, "milestone-0-5-v05-04-scope");
  assert.equal(verdictsOf(base, other).x10.verdict, "violation");
});

// ---------------------------------------------------------------------------------------------
// The command line and git, on throwaway repositories.

function git(directory, ...args) {
  const result = spawnSync("git", ["-c", "user.name=guards-test", "-c", "user.email=guards-test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: directory, encoding: "utf8", env: withoutGitLocation() });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function guards(args, directory = root) {
  return spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: "utf8", env: withoutGitLocation() });
}

const writeJson = (directory, file, value) => {
  mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
  writeFileSync(path.join(directory, file), `${JSON.stringify(value, null, 2)}\n`);
};
const writeText = (directory, file, text = "text\n") => {
  mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
  writeFileSync(path.join(directory, file), text);
};
const commitAll = (directory, message) => {
  git(directory, "add", "-A");
  git(directory, "commit", "-q", "-m", message);
  return git(directory, "rev-parse", "HEAD");
};

// A repository whose first commit holds the base document and an existing evidence folder; the body adds to it.
function withRepository(body, document = baseDocument()) {
  const directory = mkdtempSync(path.join(tmpdir(), "milestone-guards-test-"));
  try {
    git(directory, "init", "-q");
    writeJson(directory, "dashboard/migration.json", document);
    writeText(directory, "docs/evidence/scroll-view/README.md");
    writeText(directory, "docs/research/frontier-hud.md");
    writeText(directory, "tests/frontier-hud.test.mjs");
    writeText(directory, "scripts/frontier-hud.mjs");
    const first = commitAll(directory, "base");
    return body(directory, first);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("--check passes on this tree against HEAD", () => {
  const result = guards(["--check", "--base", "HEAD"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^MILESTONE_GUARDS_CHECK_PASSED: against [0-9a-f]{12} \(--base HEAD\); X9 [a-z-]+, X10 clean$/m);
});

test("--check passes on a tree that only adds a 0.5 entry, and says X9 is clean", () => {
  withRepository((directory) => {
    const head = withEntry(baseDocument());
    head.milestones[0].exit[0].done = true;
    writeJson(directory, "dashboard/migration.json", head);
    writeText(directory, "docs/evidence/frontier-new/README.md");
    writeText(directory, "docs/evidence/world-input-pointer-x/README.md");
    writeText(directory, "docs/evidence/scroll-view/pointer-route.json");
    const result = guards(["--check", "--root", directory, "--base", "HEAD"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /X9 clean, X10 clean/);
  });
});

test("--check fails on a base whose 1.0 differs, for the right reason", () => {
  withRepository((directory) => {
    const head = withEntry(baseDocument(), "milestone-0-5-slice-a");
    task(head, "GF-01").note = "a longer note";
    task(head, "GF-01").checkpoints[0].done = true;
    writeJson(directory, "dashboard/migration.json", head);
    const result = guards(["--check", "--root", directory, "--base", "HEAD"]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^MILESTONE_GUARDS_CHECK_FAILED: against [0-9a-f]{12} \(--base HEAD\)$/m);
    assert.match(result.stderr, /^X9: this change adds milestone-0-5-slice-a and also changes the 1\.0/m);
    assert.match(result.stderr, /^ {2}- tasks\[GF-01\]\.checkpoints\[slice\]\.done \(moves-1\.0: changed done\)$/m);
    assert.match(result.stderr, /^ {2}- tasks\[GF-01\]\.note \(text-or-evidence: changed note\)$/m);
    assert.doesNotMatch(result.stderr, /X10/);
  });
});

test("--check fails on a new frozen-tail slice, whether it is untracked or committed, and names it", () => {
  withRepository((directory, first) => {
    writeText(directory, "docs/evidence/pointer-foo/README.md");
    writeText(directory, "tests/hover-case.test.mjs");
    writeText(directory, "scripts/event-target-x.mjs");
    writeText(directory, "docs/research/document-up.md");
    const untracked = guards(["--check", "--root", directory, "--base", first]);
    assert.equal(untracked.status, 1);
    assert.match(untracked.stderr, /^X10: the tail of GF-13 is frozen during the 0\.5:$/m);
    for (const item of ["docs/evidence/pointer-foo/", "docs/research/document-up.md", "scripts/event-target-x.mjs", "tests/hover-case.test.mjs"]) {
      assert.match(untracked.stderr, new RegExp(`^ {2}- slice:${item.replaceAll(".", "\\.")}$`, "m"));
    }
    assert.doesNotMatch(untracked.stderr, /X9/);
    commitAll(directory, "slice");
    assert.equal(guards(["--check", "--root", directory, "--base", first]).status, 1, "a committed slice fails too");
    assert.equal(guards(["--check", "--root", directory, "--base", "HEAD"]).status, 0, "against itself there is nothing new");
  });
});

test("--check judges GF-13 as the audit does", () => {
  withRepository((directory, first) => {
    const head = baseDocument();
    head.activity.unshift({ id: "gf-13-delivery", taskIds: ["GF-13"], message: "input" });
    task(head, "GF-13").note = "changed";
    writeJson(directory, "dashboard/migration.json", head);
    const result = guards(["--check", "--root", directory, "--base", first]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^ {2}- gf13-activity:gf-13-delivery$/m);
    assert.match(result.stderr, /^ {2}- task:GF-13$/m);
  });
});

test("--check without a resolvable base fails with a message and never passes", () => {
  withRepository((directory) => {
    const missing = guards(["--check", "--root", directory, "--base", "0123456789abcdef0123456789abcdef01234567"]);
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /^MILESTONE_GUARDS_ERROR: --base 0123456789abcdef0123456789abcdef01234567 does not resolve to a commit in this checkout\. In a shallow clone fetch it first/m);
    const noDefault = guards(["--check", "--root", directory]);
    assert.equal(noDefault.status, 1);
    assert.equal(noDefault.stdout, "");
    assert.match(noDefault.stderr, /there is no base to compare with: --base was not given and origin\/main does not exist/);
  });
});

test("--check with no --base compares with the merge-base of HEAD and origin/main", () => {
  withRepository((directory, first) => {
    // main moved on: it changed a note of the 1.0 after this branch started.
    const main = baseDocument();
    task(main, "GF-01").note = "main moved this note";
    writeJson(directory, "dashboard/migration.json", main);
    const mainTip = commitAll(directory, "main moves");
    git(directory, "update-ref", "refs/remotes/origin/main", mainTip);
    git(directory, "checkout", "-q", "-b", "branch", first);
    writeJson(directory, "dashboard/migration.json", withEntry(baseDocument()));
    commitAll(directory, "the branch adds a 0.5 entry");
    const result = guards(["--check", "--root", directory]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`against ${first.slice(0, 12)} \\(the merge-base of HEAD and origin/main\\)`));
    // Against the tip of origin/main the same branch would be blamed for what main did.
    const tip = guards(["--check", "--root", directory, "--base", "origin/main"]);
    assert.equal(tip.status, 1);
    assert.match(tip.stderr, /tasks\[GF-01\]\.note/);
  });
});

test("--check against the real dashboard with a base that has older 1.0 text fails on exactly that text", () => {
  const real = JSON.parse(readFileSync(path.join(root, "dashboard", "migration.json"), "utf8"));
  const entry = real.activity.find((item) => /^milestone-0-5-/.test(item.id));
  assert.ok(entry, "the dashboard has no 0.5 entry");
  const older = clone(real);
  older.tasks[0].note = `${older.tasks[0].note} (older)`;
  older.activity = older.activity.filter((item) => item.id !== entry.id);
  withRepository(
    (directory) => {
      writeText(directory, "dashboard/migration.json", readFileSync(path.join(root, "dashboard", "migration.json"), "utf8"));
      const result = guards(["--check", "--root", directory, "--base", "HEAD"]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`^X9: this change adds ${entry.id}`, "m"));
      assert.match(result.stderr, new RegExp(`^ {2}- tasks\\[${older.tasks[0].id}\\]\\.note \\(text-or-evidence: changed note\\)$`, "m"));
      assert.equal(result.stderr.split("\n").filter((line) => line.startsWith("  - ")).length, 1, "nothing else is blamed");
    },
    older,
  );
});

test("--audit walks a throwaway history, compares each commit with its parent and fails on what KNOWN does not list", () => {
  withRepository((directory, first) => {
    // start: a clean 0.5 entry
    const start = withEntry(baseDocument(), "milestone-0-5-start");
    writeJson(directory, "dashboard/migration.json", start);
    const startSha = commitAll(directory, "feat: start the milestone (#1)");
    // a GF delivery without a 0.5 entry: the 1.0 changes and X9 does not apply
    const delivery = clone(start);
    task(delivery, "GF-01").checkpoints[0].done = true;
    delivery.activity.unshift({ id: "gf-01-delivery", taskIds: ["GF-01"], message: "delivery" });
    writeJson(directory, "dashboard/migration.json", delivery);
    commitAll(directory, "feat: deliver GF-01 (#2)");
    // a 0.5 entry that also changes a note of the 1.0: X9
    const violation = withEntry(delivery, "milestone-0-5-two");
    task(violation, "GF-01").note = "receipts of another slice";
    writeJson(directory, "dashboard/migration.json", violation);
    const violationSha = commitAll(directory, "feat: second slice (#3)");
    // a new frozen slice: X10; and an allowed one with a file in the existing folder
    writeText(directory, "docs/evidence/pointer-foo/README.md");
    writeText(directory, "docs/evidence/world-input-pointer-b/README.md");
    writeText(directory, "docs/evidence/scroll-view/pointer-route.json");
    const sliceSha = commitAll(directory, "feat: a pointer slice");

    const out = path.join(directory, "out", "audit.json");
    const result = guards(["--audit", "--root", directory, "--from", startSha, "--to", "HEAD", "--out", out]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`^ {2}- X9 in ${violationSha.slice(0, 7)} \\(not in KNOWN\\): tasks\\[GF-01\\]\\.note$`, "m"));
    assert.match(result.stderr, new RegExp(`^ {2}- X10 in ${sliceSha.slice(0, 7)} \\(not in KNOWN\\): slice:docs/evidence/pointer-foo/$`, "m"));
    assert.match(result.stderr, /^MILESTONE_GUARDS_AUDIT_FAILED: the violations are not exactly the ones in KNOWN/m);
    assert.match(result.stdout, new RegExp(`^${startSha.slice(0, 7)}  #1 .*clean +clean`, "m"));

    const audit = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(audit.range.from.sha, startSha);
    assert.equal(audit.range.to.sha, sliceSha);
    assert.deepEqual(
      audit.commits.map((commit) => [commit.sha === startSha ? "start" : commit.short === violationSha.slice(0, 7) ? "violation" : commit.short === sliceSha.slice(0, 7) ? "slice" : "delivery", commit.pr, commit.x9.verdict, commit.x10.verdict]),
      [
        ["start", 1, "clean", "clean"],
        ["delivery", 2, "not-applicable", "clean"],
        ["violation", 3, "violation", "clean"],
        ["slice", null, "not-applicable", "violation"],
      ],
    );
    assert.deepEqual(audit.commits[0].parent, first);
    assert.deepEqual(audit.commits[1].onePointZero.changes.map((change) => change.path), ["tasks[GF-01].checkpoints[slice].done"]);
    assert.deepEqual(audit.commits[3].tail.slices, [
      { path: "docs/evidence/pointer-foo/", kind: "evidence-folder", allowed: false },
      { path: "docs/evidence/world-input-pointer-b/", kind: "evidence-folder", allowed: true },
    ]);
    assert.deepEqual(audit.commits[3].tail.insideFolders, [{ path: "docs/evidence/scroll-view/pointer-route.json", folder: "existing" }]);
    assert.deepEqual(audit.summary.x9.violations, [violationSha.slice(0, 7)]);
    assert.deepEqual(audit.summary.x10.violations, [sliceSha.slice(0, 7)]);
    assert.equal(audit.result.passed, false);
    assert.deepEqual(summarizeCommits(audit.commits), audit.summary);

    // A range without those commits is clean and passes. A receipt that does not start at the 0.5 is refused by --verify.
    const clean = path.join(directory, "out", "clean.json");
    const passing = guards(["--audit", "--root", directory, "--from", startSha, "--to", `${startSha}`, "--out", clean]);
    assert.equal(passing.status, 0, passing.stderr);
    assert.match(passing.stdout, /^MILESTONE_GUARDS_AUDIT_PASSED: 1 first-parent commits \(1 add a 0\.5 entry\), X9 violations: none, X10 violations: none, known: none$/m);
    const verified = guards(["--audit", "--verify", "--root", directory, "--file", clean]);
    assert.equal(verified.status, 1);
    assert.match(verified.stderr, new RegExp(`the audit does not start at ${START}`));
  });
});

test("--audit refuses a start with no parent and a start that is not on the first-parent line of the end", () => {
  withRepository((directory, first) => {
    const noParent = guards(["--audit", "--root", directory, "--from", first, "--to", "HEAD", "--out", path.join(directory, "x.json")]);
    assert.equal(noParent.status, 1);
    assert.match(noParent.stderr, /has no parent to compare it with/);
    const missing = guards(["--audit", "--root", directory, "--from", "feedface", "--out", path.join(directory, "x.json")]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /--from feedface does not resolve to a commit/);

    git(directory, "checkout", "-q", "-b", "side");
    writeText(directory, "docs/research/side.md");
    const side = commitAll(directory, "side");
    git(directory, "checkout", "-q", "-");
    writeText(directory, "docs/research/trunk.md");
    commitAll(directory, "trunk");
    git(directory, "merge", "-q", "--no-ff", "-m", "merge side", side);
    // `side` is reachable only through the second parent of the merge.
    const offLine = guards(["--audit", "--root", directory, "--from", side, "--to", "HEAD", "--out", path.join(directory, "x.json")]);
    assert.equal(offLine.status, 1);
    assert.match(offLine.stderr, /is not on the first-parent line that ends at --to HEAD/);
  });
});

// ---------------------------------------------------------------------------------------------
// The committed receipt, judged again with no git.

const receiptText = readFileSync(path.join(root, AUDIT_FILE), "utf8");
const receipt = () => JSON.parse(receiptText);

test("the committed audit receipt verifies offline: its violations are exactly the ones in KNOWN", () => {
  const result = guards(["--audit", "--verify"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^MILESTONE_GUARDS_AUDIT_VERIFIED: \d+ first-parent commits \(\d+ add a 0\.5 entry\), X9 violations: b0e40aa, X10 violations: none, known: b0e40aa \(X9, #74\)$/m);
  const audit = receipt();
  assert.deepEqual(verifyAudit(audit), []);
  assert.ok(audit.range.from.sha.startsWith(START));
  assert.equal(audit.result.passed, true);
  assert.deepEqual(audit.result.accepted, [{ sha: "b0e40aa", rule: "X9", pr: 74 }]);
  assert.deepEqual(audit.summary.x9.violations, KNOWN.filter((item) => item.rule === "X9").map((item) => item.sha));
  assert.deepEqual(audit.summary.x10.violations, []);
  assert.deepEqual(audit.summary.gf13ChangedIn, [], "GF-13 is equal in depth since the start");
  assert.deepEqual(audit.known, KNOWN);
  assert.ok(audit.summary.withMilestoneEntries >= 15);
  const b0e40aa = audit.commits.find((commit) => commit.short === "b0e40aa");
  assert.deepEqual(b0e40aa.onePointZero.changes.map((change) => [change.path, change.class]), [
    ["tasks[GF-27].checkpoints[slice].evidence", "text-or-evidence"],
    ["tasks[GF-27].note", "text-or-evidence"],
  ]);
  assert.equal(b0e40aa.onePointZero.moves, 0, "no done, weight or status moved");
  assert.equal(audit.commits[0].short, START);
});

test("the committed receipt holds only data derived from git, with no local path", () => {
  assert.doesNotMatch(receiptText, /\/Users\/|\/private\/|\/var\/folders|\/home\/|[A-Za-z]:\\\\/);
  assert.doesNotMatch(receiptText, /generatedAt|"at":|hostname/);
  for (const commit of receipt().commits) {
    assert.match(commit.sha, /^[0-9a-f]{40}$/);
    assert.match(commit.parent, /^[0-9a-f]{40}$/);
  }
});

test("a receipt that no longer follows from its own data is refused", () => {
  const reject = (change, expected) => {
    const audit = receipt();
    change(audit);
    const problems = verifyAudit(audit);
    assert.ok(problems.some((problem) => expected.test(problem)), `${expected} not in ${JSON.stringify(problems)}`);
  };
  const commitOf = (audit, short) => audit.commits.find((commit) => commit.short === short);

  // A violation that was edited out of the data.
  reject((audit) => {
    const commit = commitOf(audit, "b0e40aa");
    commit.onePointZero.changes.pop();
  }, /b0e40aa: its verdicts do not follow from the data it records/);

  // A violation hidden consistently (verdict, data and summary rewritten): KNOWN still says it must be there.
  reject((audit) => {
    const commit = commitOf(audit, "b0e40aa");
    commit.onePointZero = { sections: [], moves: 0, text: 0, changes: [] };
    commit.x9 = { verdict: "clean", items: [] };
    audit.summary = summarizeCommits(audit.commits);
    audit.result.passed = true;
  }, /KNOWN X9 violation of b0e40aa was not found/);

  // A new violation written consistently: it is not in KNOWN.
  reject((audit) => {
    const commit = audit.commits.find((item) => item.addedMilestoneActivity.length > 0 && item.short !== "b0e40aa");
    commit.onePointZero.changes.push({ section: "tasks", id: "GF-01", path: "tasks[GF-01].note", field: "note", change: "changed", class: "text-or-evidence", before: "a", after: "b" });
    commit.onePointZero.text = 1;
    commit.x9 = { verdict: "violation", items: ["tasks[GF-01].note"] };
    audit.summary = summarizeCommits(audit.commits);
  }, /X9 violation in [0-9a-f]{7} \(not in KNOWN\): tasks\[GF-01\]\.note/);

  // A new tail slice written consistently.
  reject((audit) => {
    const commit = audit.commits[audit.commits.length - 1];
    commit.tail.slices.push({ path: "docs/evidence/pointer-x/", kind: "evidence-folder", allowed: false });
    commit.x10 = { verdict: "violation", items: ["slice:docs/evidence/pointer-x/"] };
    audit.summary = summarizeCommits(audit.commits);
  }, /X10 violation in [0-9a-f]{7} \(not in KNOWN\)/);

  // A tail slice that is only marked allowed to pass.
  reject((audit) => {
    const commit = audit.commits[audit.commits.length - 1];
    commit.tail.slices.push({ path: "docs/evidence/pointer-x/", kind: "evidence-folder", allowed: true });
  }, /its verdicts do not follow|the summary does not follow/);

  // A change classified as text when it moves the 1.0.
  reject((audit) => {
    const commit = audit.commits.find((item) => item.onePointZero.changes.some((change) => change.field === "status"));
    commit.onePointZero.changes.find((change) => change.field === "status").class = "text-or-evidence";
  }, /is classified text-or-evidence, not moves-1\.0/);

  // A chain with a commit missing, a wrong start, a stale KNOWN and a wrong PR number.
  reject((audit) => {
    audit.commits.splice(3, 1);
  }, /its parent is not the previous commit of the line/);
  reject((audit) => {
    audit.range.from.sha = audit.range.to.sha;
  }, /does not start at c0f3702|do not run from range\.from to range\.to/);
  reject((audit) => {
    audit.known = [];
  }, /KNOWN list the receipt carries is not the one in the script/);
  reject((audit) => {
    audit.commits[1].pr = 999;
  }, /the PR number does not follow from the subject/);
  reject((audit) => {
    audit.result.passed = false;
  }, /result\.passed does not follow/);
  assert.deepEqual(verifyAudit({}), ["the receipt is not a schema 1 audit with commits"]);
});

test("--audit --verify refuses a receipt file that was edited", () => {
  withRepository((directory) => {
    const audit = receipt();
    audit.commits.find((commit) => commit.short === "b0e40aa").x9 = { verdict: "clean", items: [] };
    writeJson(directory, "edited.json", audit);
    const result = guards(["--audit", "--verify", "--root", directory, "--file", path.join(directory, "edited.json")]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^MILESTONE_GUARDS_AUDIT_FAILED: the receipt is not coherent$/m);
    assert.match(result.stderr, /b0e40aa: its verdicts do not follow from the data it records/);
  });
});

test("git runs without the variables that locate a repository", () => {
  const leaked = { PATH: "/bin", HOME: "/home", ...Object.fromEntries(GIT_LOCATION_VARIABLES.map((name) => [name, "elsewhere"])) };
  assert.deepEqual(withoutGitLocation(leaked), { PATH: "/bin", HOME: "/home" });
  assert.deepEqual(GIT_LOCATION_VARIABLES, ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_PREFIX"]);
  assert.equal(Object.keys(withoutGitLocation()).some((name) => GIT_LOCATION_VARIABLES.includes(name)), false);
  // The guards also run from a hook: variables that point elsewhere must not move the comparison.
  const poisoned = spawnSync(process.execPath, [script, "--check", "--base", "HEAD"], { cwd: root, encoding: "utf8", env: { ...process.env, GIT_DIR: path.join(tmpdir(), "nowhere.git"), GIT_INDEX_FILE: path.join(tmpdir(), "nowhere-index") } });
  assert.equal(poisoned.status, 0, poisoned.stderr);
});

// ---------------------------------------------------------------------------------------------
// The arguments and the CI step.

test("the arguments are strict", () => {
  assert.deepEqual(parseArguments(["--check", "--base", "origin/main"]), { check: true, base: "origin/main" });
  assert.deepEqual(parseArguments(["--audit", "--from", "c0f3702", "--to", "HEAD"]), { audit: true, from: "c0f3702", to: "HEAD" });
  assert.deepEqual(parseArguments(["--audit", "--verify", "--file", "a.json"]), { audit: true, verify: true, file: "a.json" });
  for (const [argv, expected] of [
    [[], /pass exactly one of --check and --audit/],
    [["--check", "--audit"], /pass exactly one of --check and --audit/],
    [["--check", "--from", "x"], /--from does not go with this mode/],
    [["--check", "--verify"], /--verify does not go with this mode/],
    [["--audit", "--base", "x"], /--base does not go with this mode/],
    [["--audit", "--verify", "--to", "x"], /--to does not go with this mode/],
    [["--audit", "--file", "x"], /--file does not go with this mode/],
    [["--check", "--base"], /--base needs a value/],
    [["--check", "--base", "--root"], /--base needs a value/],
    [["--check", "--base", ""], /--base needs a value/],
    [["--check", "--rebase", "x"], /unknown argument --rebase/],
  ]) {
    assert.throws(() => parseArguments(argv), expected);
  }
  const result = guards(["--check", "--bogus"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^MILESTONE_GUARDS_ERROR: unknown argument --bogus$/m);
});

test("the contracts workflow runs the guard on every event it has, fetching the base, and never skips it", () => {
  const workflow = readFileSync(path.join(root, ".github", "workflows", "contracts.yml"), "utf8");
  const job = workflow.slice(workflow.indexOf("\n  contracts:\n"), workflow.indexOf("\n  native-cold-start:\n"));
  const start = job.indexOf("      - name: Milestone exit guards (X9 and X10)\n");
  assert.ok(start > 0, "the contracts job has no milestone guards step");
  const step = job.slice(start, job.indexOf("\n      - ", start + 10));
  // The base is the first parent of HEAD in both events: the base branch of GitHub's synthetic merge commit on a pull
  // request (the payload's base.sha can differ from it when the base branch moved), the parent of the pushed commit on a push.
  assert.match(step, /^ {12}pull_request\|push\)$/m, "one branch for both events");
  assert.match(step, /^ {14}git fetch --no-tags --depth=2 origin "\$GITHUB_SHA"$/m);
  assert.match(step, /^ {14}base="\$\(git rev-parse HEAD\^\)"$/m);
  assert.doesNotMatch(step, /base\.sha|PULL_REQUEST_BASE_SHA|--depth=1/, "the payload's base is not the base");
  assert.equal(step.split("git rev-parse HEAD^").length - 1, 1, "the base is taken in one place");
  assert.match(step, /^ {14}echo ".*" >&2\n {14}exit 1$/m, "an event with no base fails");
  assert.match(step, /^ {10}node scripts\/milestone-guards\.mjs --check --base "\$base"$/m);
  assert.doesNotMatch(step, /^ {8}(if|continue-on-error):/m, "the step is not conditional");
  assert.doesNotMatch(step, /\|\| true|\|\| echo/, "its failure is not swallowed");
  assert.ok(job.indexOf("npm run test:contracts") > start, "the guard runs before the suites");
  assert.doesNotMatch(workflow.slice(0, workflow.indexOf("\njobs:\n")), /paths(-ignore)?:/, "no paths filter can keep the workflow from running");
});
