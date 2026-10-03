# Independent consumer / provisioned addon — 2026-10-02

The bounded **2B** prototype runs project-owned TSX in a fresh Godot project
outside the SDK checkout. It uses the original production ReactFabric,
AppRegistry, Hermes/Fabric and the shared Godot platform seams. No Godot rebuild
or laboratory entrypoint is involved.

Tested combination: **macOS arm64, official Godot 4.7.2, React 19.2.3,
RN 0.87.1, Hermes 250829098.0.17, private Node 22.23.3**. The
[template](../../../consumers/minimal/README.md) explains scene/TSX authoring;
the [SDK guide](../../../sdk/README.md) separates developer provisioning from
the basic consumer's editor flow.

## Acceptance

`npm run test:consumer -- --capture` passed the following groups:

| Group | Passing checks | What it establishes |
| --- | ---: | --- |
| Build/dependency ownership | 18 | No global Node, unchanged project lockfile, no demo/outside-checkout bundle inputs, Godot source resolution, offline build, rejected requests, explicit project library and protected React identity, recovery |
| Native headless consumer | 18 | Project TSX/Resource mounts distinct native roots in one runtime; props/state/editing/remount/cleanup work |
| Graphical consumer | 20 | The native assertions plus two successful real Viewport readbacks; logical button input exercises the native GUI path |

The normal headless **editor MainLoop** loads the enabled EditorPlugin after
fresh import. `--godot-fabric-build-check` invokes the plugin's actual `_build`
implementation, checks its success/rejection and exits. This avoids overriding
the editor MainLoop with a SceneTree test script. The editor hook is exercised
automatically; the physical Play shortcut and an embedded editor game window
are not claimed as separately measured UI automation.

The consumer environment uses only `/usr/bin:/bin` in PATH and an empty
`NODE_PATH`; invoking global `node` fails with ENOENT. The plugin invokes the
addon's private executable. A separate build under macOS `sandbox-exec` denies
network access and produces the identical bundle. Provisioning downloads are
distinct from these offline build checks.

Rejected builds cover syntax errors, an unsupported typed Button prop,
incompatible React, an invalid Resource version, missing private Node, an
output-directory symlink outside the project, unsupported project Babel
configuration and a declared-but-absent library. Each leaves the previous
bundle bytes intact. Recovery rebuilds the original consumer without changing
its lockfile. Returning `false` implements Godot's build-hook Play rejection;
the runtime wrapper independently rejects a missing bundle.

The library test explicitly provides a small project dependency using a React
hook, plus a deliberately incompatible nested React which throws if selected.
The library executes and its marker reaches native text; the module graph
contains the project library and excludes its nested React. This is an identity
and dependency-boundary fixture, not certification of a named external library
or all dependency installation layouts.

The [matrix](matrix.json) retains check names/counts and report hashes.
[Provenance](provenance.json) identifies the validated source, SDK manifest,
bundle, native binary, dependency lock and captures. Raw reports/logs stay in
ignored `build/consumer` or hosted CI artifacts; no machine-specific paths or
unrelated game assets are published.

## Captures and native behavior

![Project-owned TSX mounts HUD and Inventory](initial.png)

Both roots start with local/shared counters at zero. Their distinct root tags
use one application and one bundle evaluation. The source-selection label
comes from the project's `.godot.ts` file. Addon fonts render the titles without
requiring a `res://assets` directory in the consumer.

![Native input and a Godot prop update produce React commits](updated.png)

HUD's native increment button changes only HUD's local state. Publishing through
the project module store updates both roots. A native LineEdit signal updates
the controlled TextInput. Godot's `update_props` replaces HUD's title while
preserving its local state and root identity. Inventory unmount/remount then
resets only its local state, retaining the shared store. Application shutdown
releases native tags, roots and timers.

Images are actual renderer readbacks of this generic consumer. Headless input
uses native Button signals; graphical button input uses logical Viewport mouse
events on validation device 1001. Editing uses LineEdit's native signal in both
lanes. These cases do not certify physical hardware, system IME, touch or Retina.

## Bugs found and regressions

Opening a scene in the editor previously called `FabricSurface._ready()` and
attempted to mount React before the Resource wrapper created the game runtime.
The editor reported two missing-application errors. Native surfaces now skip
automatic mounting in editor-hint mode; game execution still mounts them.

Paragraph font lookup previously assumed `res://assets/fonts`. The independent
consumer exposed that laboratory path dependency. The loader now prefers fonts
under the provisioned addon and retains the legacy fixture path as a fallback.

After these changes, the 12 existing examples passed **482 headless assertions**,
the shared-application suite passed its four cases, typography passed its four
tests, two fresh cold-start projects passed, and the Godot differential fixture
passed its 13 cases. Contract/type, static and publication checks also passed
locally. Hosted CI includes the independent headless consumer and its artifacts;
the checked-in local matrix does not claim a hosted result.

## Boundaries still open

This closes a prototype acceptance slice, not GF-28/GF-29 or SDK 1.0. Supported
provisioning remains macOS arm64; there are no signed/prebuilt public artifacts,
existing-project installer/update flow, exports or other Godot platform builds.
Startup discovery seeds only `.godot/extension_list.cfg`; no import cache is
shipped. The unresolved GF-02 late-extension-discovery root cause remains open.

The editor builder is synchronous/production-only. Watch/cache, project Babel
composition, complete Metro resolution/workspaces, source maps, dev renderer,
Fast Refresh, activation/reload generations, complete types and general asset
registries remain open. The consumer has not exercised the laboratory
NativeWind compiler or original mobile multi-root comparison. D19–D29 keep
their pending decision status. Typed game services/subscriptions, resize/ref
geometry and pause/operation lifetime cases are the next integration work,
tracked in the [roadmap](../../../ROADMAP.md).
