# Cold extension startup

GF-02 acceptance uses the unmodified official Godot 4.7.2 executable on macOS
arm64. `npm run setup` and `npm run check` generate `.godot/extension_list.cfg`
with `res://fabric.gdextension` before launching the editor. Other registered
extensions are preserved; the update is atomic and idempotent.

The native regression command is `npm run test:cold`. It makes at least three
fresh installs (`--installs`, never fewer than three; the default is three), each
in a disposable sandbox: a new project with the source assets and built
libraries/bundle, no `.godot` directory copied, and a new `HOME` and `TMPDIR`
for the engine's own user data. After startup preparation the project cache
must contain exactly one file: the extension list. Each install imports
resources, runs the React and typography acceptance scenarios, and imports
again. Crashes, signals, script/native errors, timeouts, failed assertions and
missing completion markers all fail the command. Reports and diagnostic logs go
to ignored `build/`. See [Repeated first installs](#repeated-first-installs).

The lanes of GF-02 and where each one runs (all in the `native-cold-start` job,
none retried):

| Command | What it proves |
| --- | --- |
| `npm run test:cold` | Three fresh installs start, run and re-import cleanly, one attempt per step |
| `npm run test:cold:boundary` | The upstream editor bug still crashes an unprepared import and the startup list contains it ([Executable engine boundary](#executable-engine-boundary)) |
| `npm run test:cold:negative` | An extension that asks for a newer Godot is refused in the engine's own words, with no residue, and the next start is clean ([Failed start with an incompatible minimum](#failed-start-with-an-incompatible-minimum)) |
| `npm run parity:godot` | The shared parity fixture runs from a cold project and its report is the one compared with the RN references ([Parity from a cold project](#parity-from-a-cold-project)) |

The targets this evidence covers, and the ones it does not, are in
[Targets](#targets).

No retry or cache recovered from a failed run is used by any lane. An earlier
version of this document described `node scripts/cold-start.mjs --without-startup`
as a negative control that must fail on the affected executable. On 2026-10-14 it
exited 0 on the full project in every local run (11 of 11 unprepared first
imports, the previous version of the script included, none crashed), so it is not a control; the executable control of
the containment is the boundary lane, whose Fabric-only project does crash
unprepared (5 of 5). The option remains for diagnosis and reports `startup:
"skipped"` in its report.

## Investigation

Before this change, an empty-cache editor import terminated with signal 11.
Removing the JS app, scenes, fonts and evidence images did not remove the crash.
A minimal project containing only the extension reproduced it. Loading the
library without registering classes passed; registering a single empty `Node`
subclass reproduced it. Thus the reproduction does not depend on Fabric, React
execution or paragraph layout. Registering the classes as runtime-only did not
help.

A temporary debugger copy stopped on a null-derived address; the stripped
official executable did not provide a fully symbolicated backtrace. The result
is consistent with the editor extension documentation shutdown path described in
[upstream issue #111645](https://github.com/godotengine/godot/issues/111645), which
was still open when checked on 2026-10-02. That issue reports older engine
versions; the 4.7.2 reproduction is local evidence. The engine source queues
extension documentation generation, deletes the documentation object during
editor cleanup and later flushes deferred calls; the callback dereferences that
object without a null guard. This is the leading root-cause explanation, not
proof from a rebuilt/symbolicated engine. The underlying defect has not been
fixed here. Startup discovery is a tested containment of the late-loading
boundary. The upstream paths are
[extension discovery](https://github.com/godotengine/godot/blob/4.7.2-stable/core/extension/gdextension_manager.cpp)
and [extension documentation generation](https://github.com/godotengine/godot/blob/4.7.2-stable/editor/doc/editor_help.cpp).
Acceptance uses the original official executable, never the debugger copy.

## Engine contract and failure recovery — 2026-10-02

[`dependencies.json`](../../dependencies.json) pins the tested Godot runtime
and the checksum of the official macOS CI archive. Version preflight, cold-start
reports and the native parity runner use that pin. The extension now declares
`compatibility_minimum = "4.7.2"`; setup checks the executable before downloading
dependencies or creating build output. Older/newer versions and non-stable
labels are rejected by the validation runners. This is a conservative minimum
supported runtime, not a claim that the extension uses a 4.7.2-only API: the
pinned godot-cpp archive contains a 4.5 API inventory. Other engines still need
separate qualification.

The check and cold-start runners remove previous success reports before version
preflight. Recovery fixtures also verify that failed imports and runtime errors
leave no disposable projects or success reports, including a runtime process
that exits zero but logs a script error. An interrupted atomic startup-list
publish preserves other extensions, removes its staging file and permits a
subsequent explicit invocation. These process/filesystem fixtures use simulated
executables; they are failure-policy tests, separate from native engine proof.

Local native observations on the untouched official
`4.7.2.stable.official.ed1daf0bf`, macOS arm64:

| Case | Observed result |
| --- | --- |
| Minimal extension, no registered class | Fresh import exits zero |
| Minimal extension, one empty Node class | Fresh import logs signal 11 and aborts |
| Empty-class probe with minimum initialization changed to Servers | Same crash |
| Fabric-only project without React, scenes or assets | Same crash |
| Fabric-only import with 2, 4 or 10 iterations after `--import` | Same crash |
| Prepared full project, two fresh resource caches | Both imports and warm imports pass; each run passes 36 React and 50 typography checks |

`npm run setup` also passed locally, reusing verified pinned dependency sources
and existing compiler output. This is not a fresh dependency build; the uncached
native CI job performs that check for each head. It now retains cold-start logs
on failure as well as the report on success. Local checks do not establish the
current PR's hosted CI result.

Run `node --test tests/godot-binary.test.mjs` and
`python3 -m unittest discover -s tests -p '*_test.py'` for the engine admission
and recovery regressions. `npm run test:cold` remains the native acceptance
command. The remaining direct-editor boundary is now an executable control, set
out in the next section. GF-02 stays **In progress** until its other
checkpoints (comparison cases and applicable targets) are accepted; the lanes that
provide that evidence are [Repeated first installs](#repeated-first-installs),
[Failed start with an incompatible minimum](#failed-start-with-an-incompatible-minimum),
[Parity from a cold project](#parity-from-a-cold-project) and [Targets](#targets).

Deleting `.godot` and invoking Godot directly with `--editor --import` bypasses
this preparation and can still reproduce the engine boundary. Run setup or
`npm run check` after deleting that directory. This is not cross-platform build
certification or proof that every editor loading path is safe.

## Executable engine boundary

**Decision (2026-10-13).** The crash is a defect of the Godot editor, not of
Fabric: `EditorHelp::_gen_extensions_docs` runs a deferred callback after the
editor has cleaned up. It is tracked upstream in
[godotengine/godot#111645](https://github.com/godotengine/godot/issues/111645),
still open on 2026-10-13, whose fix,
[godotengine/godot#123658](https://github.com/godotengine/godot/pull/123658), was
not merged that day; 4.7.2 is the latest stable release. This project runs the unmodified official engine and does not patch or
rebuild it, so the GF-02 clause "fix the root cause" is revised to: **root cause
identified upstream and contained, with an executable control.** The control
makes the claim falsifiable in both directions, in native CI:

- the official 4.7.2 must crash on an empty-cache import **without** the
  startup preparation, and import cleanly **with** it;
- if a future Godot fixes the bug, the control flips and fails with a message
  that says the containment can be retired and the engine requalified.

**How it works.** `npm run test:cold:boundary` runs
[`scripts/cold-start-boundary.mjs`](../../scripts/cold-start-boundary.mjs) in the
`native-cold-start` job, right after `npm run test:cold`, and the job uploads its
report as the `native-cold-start-boundary` artifact. Every attempt builds a new
disposable project: the smallest reproduction recorded above, the Fabric
extension alone (a `project.godot` with no main scene, `fabric.gdextension` and
`addons/`), with no resource cache. The editor runs as
`--headless --editor --import`, and each lane makes five attempts
(`--attempts`, never fewer than five).

- **Unprepared:** the project is imported as it is, with no `.godot` directory
  and no startup list, so the engine discovers the extension during its first
  filesystem scan.
- **Prepared:** the same project after `scripts/extension_startup.py`, which must
  leave exactly one cache file, `extension_list.cfg`.

An attempt is classified from what the process did, never from how long it took.
A hang guard of 180 seconds only turns a stuck import into a failure.

| Outcome | Rule |
| --- | --- |
| `crashed` | The process died by SIGSEGV or SIGBUS, or its log has Godot's `Program crashed with signal 11` |
| `clean` | Exit status 0, no signal, no crash text and no `ERROR:` or `SCRIPT ERROR` line |
| `failed` | Anything else: another signal or crash, a non-zero exit, an error line, the hang guard |

Godot's crash handler prints its backtrace and then aborts, so the parent sees
`SIGABRT` together with the crash text; the crash text is what identifies the
bug. The stripped official executable prints no symbols, so a backtrace frame
that names `EditorHelp` or `_gen_extensions_docs` is recorded when present and
never required. A `failed` attempt is never read as the bug or as its absence.

| Verdict | Condition | Exit |
| --- | --- | --- |
| `boundary-holds` | Every unprepared attempt `crashed` and every prepared attempt `clean` | 0 |
| `engine-fixed` | Every prepared attempt `clean`, and every unprepared attempt `clean` too: none crashed | 1 |
| `prepared-failed` | A prepared attempt was not `clean`, whatever the unprepared lane did | 1 |
| `mixed` | Anything else: some but not all unprepared attempts crashed, or none crashed and some failed another way | 1 |

`engine-fixed` fails with `the upstream editor bug no longer reproduces on
<version>: requalify the engine and retire the startup containment (GF-02)`,
naming the detected engine version. A `mixed` result is reported as measured, with its rate, and stops for
a decision; no threshold is assumed. The report,
`build/cold-start-boundary.json`, holds the engine version and the SHA-256 of the
executable and of the Fabric library, every attempt's outcome, exit status,
signal, crash-text flag, recorded frames and the SHA-256 and size of its log
(`build/cold-start-boundary-<lane>-<n>.log`), the summary per lane and the
verdict. A report of an earlier run is removed before anything else, so none
stands for a run that was refused. The classification and the verdict are pure
functions covered by `tests/cold-start-boundary.test.mjs` in `test:contracts`,
with no Godot; the same file drives the runner against a simulated executable for
each verdict.

**Local result.** Official `4.7.2.stable.official.ed1daf0bf` on macOS arm64
(executable SHA-256 `c7cccbf8…18ccf`). The unprepared crash was measured first, to
see whether it is deterministic:

| Run | Unprepared | Prepared |
| --- | --- | --- |
| `npm run test:cold:boundary` (5 per lane) | 5 of 5 crashed | 5 of 5 clean |
| `npm run test:cold:boundary -- --attempts 20` | 20 of 20 crashed | 20 of 20 clean |
| Direct shell loop, same project, new cache each time | 12 of 12 crashed | not run |
| The same loop with an empty `HOME` (no editor settings) | 3 of 3 crashed | not run |

The crash is deterministic here, so the control requires it on every attempt.
In all 20 crashes of the larger run the log has `Program crashed with signal 11`,
the parent saw `SIGABRT`, and the ten backtrace frames are identical in module
offsets (only the load address changes); none names `EditorHelp`.

**Hosted result.** The Contracts run [38403991586](https://github.com/journey-studios/godot-fabric/actions/runs/38403991586), dispatched on the branch of
#154, ran the control in the `native-cold-start` job ([job 115318656893](https://github.com/journey-studios/godot-fabric/actions/runs/38403991586/job/115318656893))
on the hosted macOS 15 arm64 runner: verdict `boundary-holds`, 5 of 5 unprepared imports crashed and 5 of 5 prepared
imports were clean, on `4.7.2.stable.official.ed1daf0bf` with the same executable SHA-256 as the local runs
(`c7cccbf8…718ccf`). The artifact `native-cold-start-boundary` (id 11817282299, digest `sha256:53617478…5e5e`) holds the
report and the ten logs. The run's `native-suites-frontier` job failed once in `test:cpu-time-instrument` (its
frame-to-frame check of the process term, a known instability of that suite on a busy runner, unrelated to this
control) and passed on its rerun; the `native-cold-start` job passed on both attempts.

**When it flips.** If a hosted or local run reports `engine-fixed`, retire the
containment in one change: requalify the new engine (the pin and checksum in
`dependencies.json`, `compatibility_minimum`, the `native-cold-start` suites),
then remove the startup preparation (`scripts/extension_startup.py` and its
callers in setup, `check`, `cold-start` and `parity:godot`), the
`--without-startup` option of `scripts/cold-start.mjs` and this control, and
update this record and the GF-02 text. A `prepared-failed` or `mixed` verdict is
not that flip: it means the containment or the control is broken, or the bug
changed shape, and needs investigation.

**Limits.** This is macOS arm64 only and uses the official executable, never a
rebuilt one. It judges the import-only editor with the Fabric extension alone; it
does not prove that every editor loading path is safe, and the root cause is the
upstream explanation above, not a symbolicated trace. The `contract` checkpoint
of GF-02 closes on this control once a hosted run shows the verdict
`boundary-holds`; `parity` and `targets` rest on the lanes that follow.

## Repeated first installs

**Decision (2026-10-14).** GF-02's parity checkpoint is native startup cases, and
the first is repeated fresh installs: at least three, in native CI, none of them
retried.

`npm run test:cold` (`scripts/cold-start.mjs`) runs, for each install `n`:

1. A new sandbox under the system temporary directory: `project/` (the sources,
   scenes, assets, extension metadata, built libraries and bundle; symbolic links
   kept as they are), a new `home/` and `tmp/` for the engine's user data and a
   working directory that starts empty. Godot is started with that `HOME` and
   `TMPDIR`, so a start cannot lean on editor settings or the documentation cache
   of an earlier one.
2. `scripts/extension_startup.py`; the project cache must then hold exactly
   `extension_list.cfg`.
3. Four launches, each once: `n-import` (`--headless --editor --import`),
   `n-react` and `n-typography` (the acceptance scenarios, which must print
   `FABRIC_VALIDATION_PASSED` and report only passed checks) and `n-warm-import`.
4. The sandbox is removed whatever happens.

The rules that keep a crash from being retried away are code, not convention
(`scripts/cold-lanes.mjs`):

| Rule | Where it is enforced |
| --- | --- |
| At least three installs | `--installs` is refused below three before any engine starts, and the finished report is judged again (`verifyColdReport`): fewer than three runs, or a count that does not match the list, is not a pass, whatever the report says about its own minimum |
| One launch per step | Every start goes through one ledger; a second launch of a step is refused before it runs (`Retry refused: …`) |
| The plan is exact | The report must list, per install, exactly `n-import`, `n-react`, `n-typography`, `n-warm-import`, in that order, each with `attempts` 1: a repeated step, a retry under another name or a skipped step is not a pass |
| Nothing is forgiven | A signal, a non-zero exit, a hang, Godot's crash text, an `ERROR:`/`SCRIPT ERROR` line or a missing marker fails the run on the first occurrence |

`tests/cold-lanes.test.mjs` (in `test:contracts`) mutates each rule and requires
the lane to reject it: two installs, one, none or a non-numeric count (with no
engine launched and a stale report removed), a lowered minimum in the report, a
step run twice, a retry under another name, a skipped or reordered step, a step
attempted twice, a death by signal, a non-zero exit, a warm cache, inherited user
data, extra cache files, a scenario with no checks and a warm import that did not
pass. Driven against a simulated engine, a failed first start leaves the lane
failed with exactly one launch of the engine and no sandbox left behind.

**Causal control.** A sabotage of `scripts/cold-start.mjs` makes the step runner
start the engine again when the first start is not clean. Against an engine whose
first start fails once, the unmodified lane fails on that start; the retrying lane
is rejected with `Retry refused: 1-import already ran once` and the engine is not
started a second time. With the ledger's refusal removed as well, the report check
rejects it (`its launches are [1-import, 1-import, 1-react, …]`). With both rules
removed the retry turns the failed install into a pass, which is what they exist
to prevent.

**Local result (2026-10-14).** Official `4.7.2.stable.official.ed1daf0bf`, macOS
arm64: `npm run test:cold` made 3 fresh installs, 12 launches in all, each once
and clean, with 36 React and 55 typography checks per install, in about 23
seconds including the bundle. Report: `build/cold-start.json`
(`schemaVersion` 2; per install the steps with `attempts`, `status` and
`signal`), logs `build/cold-<n>-<step>.log`.

**Hosted result.** The Contracts run [38560887388](https://github.com/journey-studios/godot-fabric/actions/runs/38560887388), dispatched on the branch of
this change at head `974b46e8`, passed every job at attempt 1. Its `native-cold-start` job
([job 115841370148](https://github.com/journey-studios/godot-fabric/actions/runs/38560887388/job/115841370148)), on the hosted macOS 15 arm64 runner, ran `npm run test:cold`
right after the build: `COLD_START_PASSED: 3 fresh installs, runtime checks and warm
imports, one attempt each`, about 52 seconds with the bundle. The artifact
`native-cold-start` (id 11892261686, digest `sha256:71d0b919…89b5`) holds
`cold-start.json`: status `passed`, `startup` `prepared`, 3 installs against a minimum of 3,
12 steps, every one with `attempts` 1, status 0 and no signal, and the 12 logs. The
boundary control ran in the same job and reported, as it did in run 38403991586,
`COLD_START_BOUNDARY_HOLDS` on `4.7.2.stable.official.ed1daf0bf`: 5 of 5 unprepared
imports crashed and 5 of 5 prepared imports were clean (artifact
`native-cold-start-boundary`, id 11892176807, digest `sha256:78244e75…0729`). No crash was
retried away: the job has one attempt and every step one launch.

## Failed start with an incompatible minimum

`npm run test:cold:negative` (`scripts/cold-start-negative.mjs`) is the failed-start
case of GF-02, with the real engine. It does not simulate a failure: it hands the
engine an extension whose metadata asks for a Godot that does not exist yet.

Godot enforces `compatibility_minimum` itself and says so. With
`compatibility_minimum = "4.99.0"` in `fabric.gdextension`, the official 4.7.2
printed (read from a real start; the lane asserts these lines, it does not guess
them):

```
ERROR: GDExtension only compatible with Godot version 4.99.0 or later: res://fabric.gdextension, but your Godot version is 4.7.2
ERROR: Can't open GDExtension dynamic library: 'res://fabric.gdextension'.
ERROR: Error loading extension: 'res://fabric.gdextension'.
```

The first two lines repeat each time the editor scans extensions (three times in
an import, the third line once). The import-only editor then goes on and exits 0
without a crash: the refusal is an error in the log, not an exit status, which is
why the lane judges the log. The project's own scripts that name Fabric classes
(`FabricSurface` and the others the library registers) cannot be parsed once the
classes are never registered, and Godot says so after the refusal (five lines on
the full project: `Identifier "FabricSurface" not declared`, `Could not resolve
class "res://scripts/validation_base.gd"` and `Failed to load script … Parse
error`). The lane classifies them as consequences of the refusal and fails on any
other error line.

**The procedure.** One lane-wide ledger launches every step once.

1. The positive control: a new sandbox exactly as in `test:cold`, the unmodified
   metadata, `control-import` and `control-react` (36 checks). Both must be clean.
   It measures what a clean start leaves inside the fixture and outside it.
2. A second new sandbox. `compatibility_minimum` becomes `4.99.0` (which must be
   above the engine; the line must exist exactly as expected). The fixture is
   listed (path, kind and SHA-256 of every file), then `refused-import` runs.
3. The metadata is restored byte for byte and `recovered-import` and
   `recovered-react` run in the same fixture and the same `HOME`: the very next
   start.

**What the refused start must satisfy** (`refusalProblems`):

- it ends by itself, with no signal, no hang and no Godot crash text;
- the log has Godot's refusal, naming exactly the minimum `4.99.0`, this engine
  `4.7.2` and `res://fabric.gdextension`, and it is the first error of the log;
- Godot reports that it could not open the library, so the library was not loaded;
- every other error line is a consequence of the refusal (above); anything else,
  a Fabric error included, fails the lane.

**The residue checks.** Judged against the positive control, measured on the same
engine, rather than against a list written here:

- *Inside the fixture* (`fixtureProblems`): the refused start removes nothing it
  was handed; it adds or changes only paths that a clean start also adds or
  changes (so it does not rewrite `fabric.gdextension` or the startup list); it
  leaves no staging file (`.extension-list-*`, `*.tmp`, `*.part`, `*~`); after the
  recovery the fixture has exactly the paths of the control's, every file the lane
  handed over has the same SHA-256, and the cache files are compared by name.
- *Outside the fixture* (`outsideProblems`): the sandbox minus `project/` may hold
  only the engine's own user data (`home/Library/Application Support/Godot`,
  `home/Library/Caches/Godot`) and the empty working and temporary directories;
  and the refused start may not write a path that the clean start does not.
  Checked after the refused start and again after the recovery.
- *The next start*: `recovered-import` and `recovered-react` are judged exactly as
  the control's, and the metadata must be the original bytes.

**Local result (2026-10-14).** Official `4.7.2.stable.official.ed1daf0bf`, macOS
arm64, about 11 seconds: refused with 3 refusal messages, 3 "can't open" lines, 1
"error loading" line and 5 consequence lines; exit status 0, no signal, no crash
text, no other error. The refused import added the same 67 files and directories
to the fixture as the control's clean import (none removed, none changed), and
wrote 17 paths outside it against the control's 19 (a subset). The recovery
matched the control's file set and passed 36 React checks.
Report: `build/cold-start-negative.json` (the engine and library hashes, the
refusal with its counts, exit status and signal, the residue measurements, the
causal control, the five steps with their attempts, and the SHA-256 and size of
every log); logs `build/cold-start-negative-<step>.log`. A failed run writes the
same report with `status: "failed"` and its problems; a report of an earlier run is
removed first.

**Hosted result.** The same run and job ([38560887388](https://github.com/journey-studios/godot-fabric/actions/runs/38560887388), [job 115841370148](https://github.com/journey-studios/godot-fabric/actions/runs/38560887388/job/115841370148), head
`974b46e8`) ran `npm run test:cold:negative` after the boundary control:
`COLD_START_NEGATIVE_PASSED: refused (3 messages, exit 0), no residue, the next start clean`,
about 31 seconds with the bundle. The artifact `native-cold-start-negative` (id 11892881270,
digest `sha256:6c0c00b9…ba0f`) holds `cold-start-negative.json`: status `passed`, `problems`
empty, and the `causalControl` entry shows that the log of the start with unchanged
metadata fails the refusal assertions, with the five logs. Hosted, the engine refused the
extension in its own words and recovered on the next start exactly as it did locally.

**Causal control.** The refusal assertions are applied to the real log of the
positive control, whose metadata was not changed: they must fail
(`no line says that the extension is only compatible with Godot 4.99.0 or later`
and `Godot did not report that it could not open the library`), and the report
records it (`causalControl`). `node scripts/cold-start-negative.mjs --keep-metadata`
leaves the metadata unchanged in the failed-start fixture and the lane must fail
for the same reason; `tests/cold-lanes.test.mjs` runs it. If a Godot ever stops
enforcing the minimum, the lane fails and says the extension was not refused; it
is not worked around.

`tests/cold-lanes.test.mjs` also drives the lane against a simulated engine that
misbehaves one way at a time, and each must fail the lane: a crash on refusal, a
refusal naming another minimum, an unrelated error, a file left in the working
directory, in the temporary directory or in `HOME`, a staging file in the cache,
metadata rewritten by the engine, a source removed by the engine, a next start
that exits non-zero or logs a crash, state left by the recovery that the control
lacks, and a broken positive control (which stops the lane before it judges
anything).

**Limits.** The lane judges the import-only editor start, with startup
preparation as in every other lane. It does not claim that every launch path of an
incompatible extension is clean, nor that an older Godot would load the library: it
shows that the engine this repository qualifies refuses an extension that asks for
more, and recovers. Godot, not Fabric, enforces the minimum.

## Parity from a cold project

`npm run parity:godot` (`scripts/parity-godot.mjs`) used to run the shared parity
fixture in the repository checkout, with whatever `.godot` cache and editor
settings were there. It now runs it in a disposable cold project: the same sandbox
as `test:cold`, plus `tests/parity_guards.gd`, with an empty resource cache and a
new `HOME`. Three launches, each once and clean: `parity-import`, `parity-guards`
(`FABRIC_PARITY_GUARDS_PASSED`) and `parity-run` (`res://parity.tscn`,
`FABRIC_PARITY_PASSED`). The report is still `build/parity-godot.json`, the
artifact `parity-godot` of the `native-cold-start` job and the input of
`parity-comparison`.

**Provenance.** The report keeps what it always carried: the SHA-256 of
`tests/parity/fixture.jsx`, `runtime.js`, `cases.json` and the pinned RN types.
`fixtureTreeSha256` is added for the fixture directory itself: every file under
`tests/parity` (hidden files and `node_modules` left out) as path and SHA-256 in
path order. It sits in the shared provenance, so the Godot, iOS and Android
reports must all carry the same value and a file added to or removed from the
directory makes every report stale. The Godot report also names its project
(`coldProject`): `disposable`, `userData: "fresh"`, the cache before the import
(`["extension_list.cfg"]`), the number of files and the SHA-256 of the whole tree
handed to the engine, the SHA-256 of the bundle, and the three launches with their
attempts, statuses and signals.

**The comparison cannot be fed by anything else.** `assertReport` refuses a Godot
report that has no `coldProject`, is not disposable, did not start from fresh user
data or an empty cache, or whose launches are not exactly the three above, once
each, with status 0 and no signal. `compareReports` runs it on the Godot report
and on both references, and the comparison it writes
(`build/parity-comparison.json`) records `godotColdProject`. The `parity-comparison`
job downloads the Godot report from the `parity-godot` artifact of
`native-cold-start`, so it compares the cold-project report with the `parity-ios`
and `parity-android` references of the same commit. `tests/parity-protocol.test.mjs`
(in `test:parity`) mutates each of these conditions and the fixture directory hash.

**Local result (2026-10-14).** 13 cases passed from a cold project of 242 files, in
about 10 seconds. The references are not run locally (they need an iOS simulator
and an Android emulator); the comparison with both ran in the dispatched
Contracts run below.

**Hosted result.** In the Contracts run [38560887388](https://github.com/journey-studios/godot-fabric/actions/runs/38560887388) (head `974b46e8`, attempt 1),
`npm run parity:godot` in `native-cold-start` ([job 115841370148](https://github.com/journey-studios/godot-fabric/actions/runs/38560887388/job/115841370148)) printed
`PARITY_GODOT_PASSED: 13 native subset cases from a cold project` (about 19 seconds with
the bundle). The artifact `parity-godot` (id 11892736469, digest `sha256:7af68657…f0ca`)
holds the report: 13 cases, and `coldProject` disposable, with fresh user data, a cache of
`["extension_list.cfg"]` before the import and 242 files. The jobs `reference-ios`
([job 115841369771](https://github.com/journey-studios/godot-fabric/actions/runs/38560887388/job/115841369771)) and `reference-android`
([job 115841370285](https://github.com/journey-studios/godot-fabric/actions/runs/38560887388/job/115841370285)) produced the `parity-ios` (id 11893300678) and
`parity-android` (id 11892064969) references from the unmodified RN apps, and
`parity-comparison` ([job 115845393706](https://github.com/journey-studios/godot-fabric/actions/runs/38560887388/job/115845393706)) compared the three: its
artifact `parity-comparison` (id 11893371096, digest `sha256:8967bb3e…6963`) has
`completeMobileReferences` true, the references `android` and `ios`, 13 cases and the
`godotColdProject` of the Godot report.

## Targets

**Decision (2026-10-14).** The target of this evidence is **macOS arm64 only**.
`compatibility_minimum` stays `"4.7.2"`.

| Target | Status | Pinned or blocked by |
| --- | --- | --- |
| macOS arm64 | **Qualified** for the startup contract | Official Godot 4.7.2 stable, macOS archive pinned by SHA-256 in [`dependencies.json`](../../dependencies.json) (`godot.macos`, `c58a24e3…ba63e`; executable `4.7.2.stable.official.ed1daf0bf`); godot-cpp commit `da26c1732ee8656ef9ccad587cbdd55acf8637c8` (`godot-cpp`, archive SHA-256 `35d16951…343b7`); `compatibility_minimum = "4.7.2"` |
| Linux x86_64 | Not qualified here. Owner: GF-32 | [`scripts/setup.py`](../../scripts/setup.py) (lines 46-47) refuses any host that is not Darwin arm64; `dependencies.json` pins a Godot archive only for macOS (`godot.macos`, lines 4-7); `fabric.gdextension` has no Linux library entry and no Linux Hermes, RN dependencies or godot-cpp build exists in the pins |
| Windows x86_64 | Not qualified here. Owner: GF-33 | The same `setup.py` refusal and macOS-only Godot pin; no Windows library entry in the metadata; MSVC, CRT and DLL discovery are undefined |
| Android arm64 | Not qualified here. Owner: GF-34 | The same refusal and pin; no Android library entry; the Hermes pin is the iOS artifact (`hermes-ios`, `dependencies.json`); no Godot Android export template is qualified here; the portable dependency foundation (GF-31) is still in progress |
| iOS arm64 and simulator | Not qualified here. Owner: GF-35 | The metadata lists `ios.release.arm64` and `ios.release.x86_64`, but they are build and link checkpoints plus 22 runtime checks in an x86_64 simulator ([iOS build](../IOS_BUILD.md)); arm64 simulator and physical-device runtime acceptance are pending, and every lane in this document runs on a macOS host only |

**Why `compatibility_minimum` stays `4.7.2`.** It is the only engine this
repository qualifies: the pin in `dependencies.json`, the version preflight of
every runner (`tests/godot-binary.test.mjs` rejects any other version and any
non-stable label) and every native lane run on it. The pinned godot-cpp archive
holds a 4.5 API inventory, which bounds how low the minimum could go; it is not
a test that an older engine loads the library, and no lane runs one. Lowering the
minimum would therefore claim support for engines nothing exercises, and raising
it would refuse the qualified one. Because Godot enforces the minimum itself, the
value is an executable guarantee, shown by the [failed-start lane](#failed-start-with-an-incompatible-minimum):
an engine below it is refused with a clear message instead of loading an
unqualified extension. Qualifying another engine means a new pin, a new checksum
and these lanes run on it; until then the minimum follows the pin
(`tests/godot-binary.test.mjs` asserts they are equal).

**Hosted result.** The macOS arm64 row rests on the Contracts run
[38560887388](https://github.com/journey-studios/godot-fabric/actions/runs/38560887388) (head `974b46e8`, attempt 1): the `native-cold-start` job
([job 115841370148](https://github.com/journey-studios/godot-fabric/actions/runs/38560887388/job/115841370148)), on the hosted macOS 15 arm64 runner, installed the pinned official
Godot archive (checksum verified against `dependencies.json`), built the native host from
scratch against the pinned godot-cpp and ran every lane above on `4.7.2.stable.official.ed1daf0bf`
with `compatibility_minimum = "4.7.2"`. The other four rows are not run anywhere: no lane,
local or hosted, starts Godot on Linux, Windows, Android or an iOS runtime.

**What this does not say.** Nothing here qualifies a distribution, an export or a
device. GF-36 owns native hosted CI for the other ports and GF-37 their
differential parity.
