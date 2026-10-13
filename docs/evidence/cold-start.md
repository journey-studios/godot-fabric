# Cold extension startup

GF-02 acceptance uses the unmodified official Godot 4.7.2 executable on macOS
arm64. `npm run setup` and `npm run check` generate `.godot/extension_list.cfg`
with `res://fabric.gdextension` before launching the editor. Other registered
extensions are preserved; the update is atomic and idempotent.

The native regression command is `npm run test:cold`. It creates two disposable
projects, copies the source assets and built libraries/bundle, and asserts that
no `.godot` directory was copied. After startup preparation, that directory must
contain exactly one file: the extension list. Each project imports resources,
runs the React and typography acceptance scenarios, and imports again. Crashes,
script/native errors, timeouts, failed assertions and missing completion markers
all fail the command. Reports and diagnostic logs go to ignored `build/`.

For the negative control, run `node scripts/cold-start.mjs --without-startup`.
It must fail on the affected official 4.7.2 executable. This option does not
turn a crash into a passing test. No retry or cache recovered from a failed run
is used by the positive lane.
The `native-cold-start` job also runs the engine boundary control described in
[Executable engine boundary](#executable-engine-boundary).

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
checkpoints (comparison cases and applicable targets) are accepted.

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
`boundary-holds`; `parity` and `targets` stay open.
