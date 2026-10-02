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

A temporary debugger copy located a null receiver during `DocTools::generate`,
which is consistent with the editor extension documentation path. The exact
underlying engine defect has not been fixed here. Startup discovery is a tested
containment of the late-loading boundary. The upstream paths are
[extension discovery](https://github.com/godotengine/godot/blob/4.7.2-stable/core/extension/gdextension_manager.cpp)
and [extension documentation generation](https://github.com/godotengine/godot/blob/4.7.2-stable/editor/doc/editor_help.cpp).
Acceptance uses the original official executable, never the debugger copy.

Deleting `.godot` and invoking Godot directly with `--editor --import` bypasses
this preparation and can still reproduce the engine boundary. Run setup or
`npm run check` after deleting that directory. This is not cross-platform build
certification or proof that every editor loading path is safe.
