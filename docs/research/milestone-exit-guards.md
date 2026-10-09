# The guards of X9 and X10: the 1.0 does not move, and the tail stays frozen

Status: implemented and run locally (Node and git only; no native code). Neither criterion is
closed by this work: X9 and X10 say "during the 0.5", so they close when the milestone does, by running the
audit again over the whole history. Until then this is a guard on every pull request, and a receipt of
the history so far.

The criteria, verbatim from `dashboard/migration.json`, `milestones[0].exit`:

- **X9:** "A 1.0 não se move: diff de tasks, phases, sequences, checklists e decisions vazio; summarize() idêntico com e sem milestones".
- **X10:** "Cauda congelada: 0 fatias novas de pointer-*, EventTarget, Document ou hover durante o 0.5".

The second half of X9, `summarize()` identical with and without `milestones`, is already proved by
`tests/migration-dashboard.test.mjs` ("milestones never change the release numbers and are optional") in
`test:dashboard`. The guard does not repeat it. It covers the first half: no diff in the 1.0 data.

## What runs

`scripts/milestone-guards.mjs` has three forms. All of them are Node and git, with no network. Its git calls run
without the variables that locate a repository (`GIT_DIR`, `GIT_INDEX_FILE`...), so they also work from a hook; the list
lives in `scripts/git-environment.mjs`, shared with the agents board.

```sh
# The guard of a pull request: the current tree against a base.
node scripts/milestone-guards.mjs --check [--base <ref>] [--root <dir>]

# The audit: every first-parent commit of the 0.5 against its parent. Writes the receipt.
node scripts/milestone-guards.mjs --audit [--from c0f3702] [--to origin/main] [--out <file>] [--root <dir>]

# The receipt judged again, with no git (this is what the CI runs on the committed file).
node scripts/milestone-guards.mjs --audit --verify [--file <audit.json>] [--root <dir>]
```

`--check` resolves the base as `--base`; without it, as the merge-base of `HEAD` and `origin/main` (a branch
that is behind main is not blamed for what main added); and, when there is no merge-base, `origin/main`
itself. If none of them resolves it **fails with a message**. It never passes by default and never skips.

`--audit` starts at `--from` **inclusive** (`c0f3702`, #60, the commit that opens the 0.5 and adds its first
`milestone-0-5-*` entry, so it is judged too), compares each commit with its first parent, and ends at
`--to`. It refuses a `--from` that is not on the first-parent line that ends at `--to`. The receipt is
`docs/evidence/milestone-exit-guards/audit.json`; it records the resolved SHAs, so it is reproducible with
`--to <sha>` and byte-identical on a second run. It holds only data derived from git: SHAs, subjects, PR
numbers taken from `(#NN)`, field paths, counts. No time, no host, no local path.

## X9, the exact rule

The target is a change (a commit against its parent, or a tree against its base) that **adds an `activity`
entry whose id starts with `milestone-0-5-`** and changes anything in `tasks`, `phases`, `sequences`,
`releaseChecklist`, `integrationChecklist` or `decisions`. A change that adds no such entry is not judged by X9
(the report still lists what it changed in the 1.0, because those are GF deliveries and not the 0.5's business).

The comparison is in depth. The lists are matched by `id` (tasks, checkpoints, checklist items, decisions,
phases, sequences), so a change is reported by the path of what changed, like `tasks[GF-27].note` or
`tasks[GF-01].checkpoints[slice].done`. Each change is classified:

| Class | Which changes |
|---|---|
| `moves-1.0` | `done`, `status`, `weight`; a task, checkpoint or item added or removed; the order of a list; **any other field** (an unknown field counts as a move, the safe side) |
| `text-or-evidence` | `note`, `label`, `evidence` |

**Both classes are violations**, because the criterion says "diff vazio". The class goes to the report so that
the user can judge how serious each one is; it does not change the verdict. `milestones`, `activity`, `source`,
`updatedAt` and the other top-level keys are not part of the 1.0.

`KNOWN`, in the script, lists the historical violations the audit found and the lead accepted: one entry per
commit and rule, with the exact items and classes, the PR, what changed and why. The audit passes only if the
violations it finds are **exactly** those: a violation without an entry fails, an entry whose items or classes
differ fails, and an entry whose commit is in the audited range but is no longer a violation fails (a loosened
rule or a rewritten history must not hide it). Nothing is added to `KNOWN` without the lead's decision. `--check`
never reads `KNOWN`: a pull request has no exception.

## X10, the exact rule

The tail pattern, case-insensitive: `/(^|[-_/])(pointer|event[-_]?target|document|hover)/i`. It is applied to:

- the name of a **new entry directly under `docs/evidence/`** (a folder, or a loose file);
- the name of a **new file directly under `docs/research/`**;
- the path, relative to the directory, of a **new file anywhere under `tests/` and `scripts/`**.

A match is a slice unless it is allowed. **Allowed** is what V05-02 owns: any path segment that starts with
`world-input` (`docs/evidence/world-input*`, `docs/research/world-input*`, `tests/world-input-*`,
`scripts/world-input-*`). A new file is a file added in the change (renames count as an addition under the new
name).

A file added **inside** an evidence folder that is not itself a slice is not a slice: that is how
`docs/evidence/scroll-view/pointer-route-capture-retirement.json` (GF-14, it retires pointer routes) stays out.
When such a file's name matches the pattern the report lists it under `insideFolders`, with whether the folder was
already in the base, so that a person can look.

Two more conditions, both about GF-13 (Input, Pressability and touchables): **no `activity` entry with `GF-13` in
`taskIds`** may be added, and the **GF-13 task must stay equal in depth**, unless the change delivers V05-02 (it adds a
`milestone-0-5-v05-02-*` entry). The 0.5's own entries already use `taskIds: []`. Today no change touches GF-13.

## The audit of the history

As of `8b7a5e6` (#85), `c0f3702` (#60) to `8b7a5e6`: 27 first-parent commits, 15 of which add a `milestone-0-5-*` entry. The 12 that
do not are deliveries of GF-xx or records of them (they change `tasks`, which is their job) and X9 does not apply to them.
The committed receipt ends at the commit it names in `range.to`, which may be later than this table.

| Commit | PR | `milestone-0-5-*` entry added | X9 | X10 |
|---|---|---|---|---|
| `c0f3702` | #60 | `milestone-0-5-frontier-20261008` | clean | clean |
| `e1c7a39` | #70 | `milestone-0-5-v05-03-replay-c2e4501` | clean | clean |
| `75a85ad` | #73 | `milestone-0-5-v05-03-servicos-f199dd0` | clean | clean |
| `b0e40aa` | #74 | `milestone-0-5-v05-04-scope-1b9f120` | **violation (text)** | clean |
| `7ef63ed` | #71 | `milestone-0-5-v05-02-pointer-03f039a` | clean | clean |
| `c8de44b` | #76 | `milestone-0-5-v05-03-consumidor-b9a40cb` | clean | clean |
| `2a3f4b0` | #78 | `milestone-0-5-v05-02-pointer-a2-af941dd` | clean | clean |
| `5e1f6a1` | #79 | `milestone-0-5-v05-03-autoridade-5ee0127` | clean | clean |
| `3bb51d6` | #77 | `milestone-0-5-v05-06-baseline-headless-ebfe8a0` | clean | clean |
| `3d531a6` | #80 | `milestone-0-5-v05-02-decision-09ec1e0` | clean | clean |
| `622102e` | #82 | `milestone-0-5-v05-05-matriz-mapa-096a018` | clean | clean |
| `818d2f1` | #81 | `milestone-0-5-exit-x3-x4-x5` | clean | clean |
| `a49f851` | #83 | `milestone-0-5-v05-06-soak-b77178a` | clean | clean |
| `82f5f43` | #84 | `milestone-0-5-v05-10-protocol-draft` | clean | clean |
| `8b7a5e6` | #85 | `milestone-0-5-hosted-receipts-70cf43b` | clean | clean |

X10 is clean in all 27 commits: no new slice (allowed or not) opened under `docs/evidence`, `docs/research`,
`tests` or `scripts`; no `activity` entry for GF-13; GF-13 equal in depth from the parent of `c0f3702` to the end.
`native/pointer_adapter.*` and `tests/pointer-click-*` were modified, not added, and the guard looks at additions.

The only files that match the tail pattern and were added are six under `docs/evidence/scroll-view/`
(`pointer-route-capture-retirement.json`, `source-pins-18d3478-pointer-click-group.json` and four
`metafiles-3bf129c/pointerClick-*.json`). That folder was created by #58 (`66c948b`), inside the 0.5 and not before
it, with a name the pattern does not match; the files are in `insideFolders` of that commit and are not slices.

### The exception: `b0e40aa` (#74, P5 V05-04, from another agent)

#74 added `milestone-0-5-v05-04-scope-1b9f120` and, in the same pull request, changed two fields of GF-27:

- `tasks[GF-27].note`: the closing "hosted CI pending" became the result of the hosted CI run of #69;
- `tasks[GF-27].checkpoints[slice].evidence`: two entries (the hosted CI and Pages receipts of #69), 7 to 9.

Both are `text-or-evidence`. No `done`, no weight, no status and no checkpoint changed, so the 1.0's numbers did not
move. They are the receipts of #69 (GF-27, a 1.0 delivery) that #74 merged along. It is still a violation by the letter
of X9 ("diff vazio"), and it is the only one. It is recorded in `KNOWN` for the user to judge, not waved through
by the rule: a 0.5 pull request that carries the receipts of a GF delivery would fail `--check` today. The way
to avoid it is the one every other commit above followed: the GF's receipts go in a pull request that does not add
a 0.5 entry.

## Why X9 and X10 close only at the end

Both criteria quantify over "the 0.5", which has no end until the milestone closes. A clean audit today says
nothing about the next pull request; that is what `--check` is for. When the milestone is closing, run
`--audit --to <closing commit>` again, expect exactly the violations in `KNOWN`, commit the receipt, and only
then mark X9 and X10 `done: true` with it as evidence. A violation the audit finds then is the user's to judge;
it is never added to `KNOWN` by the agent that found it. Registration is by `activity`, as for the other criteria.

## The CI step

`.github/workflows/contracts.yml`, job `contracts`, runs `node scripts/milestone-guards.mjs --check --base "$base"`
after `npm ci`, with a base that depends on the event:

- `pull_request`: `base` is `github.event.pull_request.base.sha`, fetched with `git fetch --no-tags --depth=1 origin "$base"`;
- `push` (to main): `git fetch --no-tags --depth=2 origin "$GITHUB_SHA"` brings one commit more and `base` is `HEAD^`;
- any other event: the step fails with a message.

It does not depend on history. `actions/checkout` is shallow (depth 1), so the step fetches only the one commit it
compares with, by SHA, and `--check` reads that commit's `dashboard/migration.json` and file list with
`git show` and `git ls-tree`, never `git log`. The base is never a merge-base in CI (a shallow checkout has none);
on a `pull_request` the checked-out tree is GitHub's merge commit, so its difference from the base SHA is exactly
the pull request. The step has no `if:` and no `continue-on-error`, and `tests/milestone-guards.test.mjs` pins
that. The test itself needs no history either: the pure comparisons run on synthetic documents, `--check` and
`--audit` run on throwaway git repositories it creates, and the committed receipt is verified with `--audit
--verify`, with no git. Only the full `--audit` over the real history is local.

## Limits, so that nobody reads more into the guard than it does

- **A neutral folder name hides a slice.** The rule names the new folder, so
  `docs/evidence/scroll-view-2/pointer-slice.json` is not a violation; it is listed in `insideFolders` and a person
  has to look. This follows the decision (files inside a folder are not new slices), and it is the price of letting
  `scroll-view/` retire pointer routes.
- **The pattern is blunt.** Any new name with `document` or `hover` at the start of a word matches, even for a purpose
  unrelated to the tail. A false positive is settled by naming the file otherwise, or by the lead; the pattern is not
  weakened to fit. The word `event target` is matched with a hyphen, an underscore or nothing between the two words
  (`event-target`, `event_target`, `eventtarget`), so a GDScript file in snake case does not slip through.
- **Only additions count for names.** A modified `native/pointer_adapter.cpp` is not a new slice. What V05-02 needs is
  allowed by the lead; the guard has no opinion on how much of an existing file may change.
- **X9 needs the entry.** A pull request that changes the 1.0 and adds no `milestone-0-5-*` entry is a GF delivery and is
  not judged. A 0.5 change recorded only in `milestones` (with no entry in `activity`) is not either; the registration
  rule is by `activity`.
- **`--check` reads the working tree.** It lists the files with git's own index and untracked list (ignored files do not
  count), so run it before the commit or after; the result is the same.
- **Merge commits.** The audit follows the first parent, as the history does with squash merges. A merge commit
  on main would be compared with its first parent, as a whole.

## Run it

```sh
node scripts/milestone-guards.mjs --check --base origin/main        # a branch against main
node scripts/milestone-guards.mjs --audit --to <sha>                # rewrites the receipt; git diff must be empty
node scripts/milestone-guards.mjs --audit --verify                  # the committed receipt, no git
node --test tests/milestone-guards.test.mjs                         # in test:contracts
```
