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
command. GF-02 stays **In progress** until the remaining direct-editor boundary
and the full clean-install acceptance are resolved without hiding failures.

Deleting `.godot` and invoking Godot directly with `--editor --import` bypasses
this preparation and can still reproduce the engine boundary. Run setup or
`npm run check` after deleting that directory. This is not cross-platform build
certification or proof that every editor loading path is safe.
