# Native iOS build validation

The iOS build path compiles the Godot Fabric extension and the original
Fabric/Yoga core for **arm64 iOS devices and arm64 iOS simulators**. It uses
the iOS slices already present in the pinned Hermes and React Native dependency
archives. It compiles `godot-cpp` bindings; it does not rebuild Godot.

The arm64 native archives are build/link checkpoints. An isolated consumer has
also been exported through the official Godot templates and linked into an
unsigned arm64 device app with Hermes/RN frameworks embedded and the static
extension entry retained. That app has not run on a physical device. The
[final unsigned device record](evidence/ios-consumer/device-arm64-final.json)
verifies the current native source hashes, app architecture and bundle/PCK
identity. The
original RN iOS reference app used by the parity suite is a separate runtime.

A separate **x86_64/Rosetta iOS 18.4 simulator** consumer completed 22/22 runtime
checks, including original Hermes/React startup, native Controls, rerenders,
effect cleanup, remount and explicit application-runtime shutdown. Its
[fingerprinted final report](evidence/ios-consumer/simulator-x86_64-final.json)
and [rendered capture](evidence/ios-consumer/simulator-x86_64-final.png)
identify the exact native package tested. Final replay verified
`nativeSourcesMatchWorkingTree=true` against the native inputs at validation
time. The earlier [checkpoint report](evidence/ios-consumer/simulator-x86_64-checkpoint.json)
and its separate native fingerprint remain preserved. This result does not
establish arm64 simulator or physical-device runtime acceptance.

## Requirements and pins

Use a macOS arm64 host with full Xcode selected by `xcode-select`, Python 3.12+,
Node 22.13+ and npm. Initial setup also checks the official Godot version; set
`GODOT_BIN` if its executable is outside the usual paths. Build dependencies and
checksums come from [dependencies.json](../dependencies.json): RN 0.87.1,
React 19.2.3, Hermes 250829098.0.17, CMake 3.31.6 and the pinned `godot-cpp`
commit for Godot 4.7.2. No dependency version changes are part of this path.

The minimum deployment target is **iOS 15.1**, matching the selected upstream
Hermes device binary. Local Release builds used Xcode 26.2 (`17C52`), the iOS
and simulator 26.2 SDKs and CMake 3.31.6. Other toolchains and Debug builds are
outside this proof. The x86_64 simulator experiment is separate from arm64
acceptance.

Both Release builds and XCFramework packaging completed locally on
**2026-10-03**. Their manifests had identical native source hashes, matching the
working tree at packaging time. The packaged `Info.plist` identifies separate
`ios-arm64` and `ios-arm64-simulator` libraries.
The [final build record](evidence/ios-consumer/native-builds-final.json) includes
all three archives and both XCFramework combinations, their source and library
hashes, retained entry symbols and parsed Mach-O platform metadata. These
archive records remain build/link proofs with `runtimeExecuted=false`; the
executed consumer report above is separate.

Exporting a Godot app later requires the official 4.7.2 iOS export templates.
They are separate from building the extension. The
[official iOS export guide](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_ios.html)
describes the macOS/Xcode requirements and specifies the **Compatibility**
renderer for the simulator. The local validation host has those official
templates installed; no custom engine or export template was built.

## Build commands

From the repository root, initial setup downloads/verifies the pinned archives,
prepares CMake and builds the JS bundle before invoking the iOS builder:

```sh
npm run setup -- --target ios-simulator
npm run setup -- --target ios-device
```

With setup's dependencies already cached, invoke only the native build:

```sh
python3 scripts/ios-build.py --target ios-simulator
python3 scripts/ios-build.py --target ios-device
python3 scripts/ios-build.py --xcframework
```

`--architecture x86_64` selects a separate simulator build and package. Device
builds reject x86_64. The default arm64 directories and package are preserved:

```sh
python3 scripts/ios-build.py --target ios-simulator --architecture x86_64
python3 scripts/ios-build.py --xcframework --architecture x86_64
```

The simulator cache is `.deps/build-ios-simulator-x86_64/Release/`, its archive
and manifest are under `addons/ios/ios-simulator-x86_64/Release/`, and its package
is `addons/ios/godot_fabric.release.x86_64-simulator.xcframework`. Packaging still
requires a matching current arm64 device build. An x86_64 simulator result
cannot establish arm64 simulator acceptance.

Release is the default. `--configuration Debug` selects separate output and
binding configurations; that path exists but is not included in the local
Release proof. `--jobs` controls build parallelism and must be positive. Native
build directories are isolated by target and configuration, so these commands
reuse their own incremental caches without replacing the macOS build directory.

| Output | Path |
| --- | --- |
| Simulator build log and link witness | `.deps/build-ios-simulator/Release/` |
| Device build log and link witness | `.deps/build-ios-device/Release/` |
| Simulator combined archive and manifest | `addons/ios/ios-simulator/Release/` |
| Device combined archive and manifest | `addons/ios/ios-device/Release/` |
| Packaged static XCFramework | `addons/ios/godot_fabric.release.xcframework` |

The combined `libfabric_godot.a` contains the extension, the compiled original
Fabric/Yoga core and Godot bindings. `--xcframework` combines the two platform
archives. It rejects differing or stale source inputs, modified archives and
an existing destination. Preserve or move an earlier generated XCFramework
before packaging another result. These generated binaries/logs remain ignored
by Git.

## What the proof checks

Before building, [ios-build.py](../scripts/ios-build.py) checks the pinned source
archive checksums and required dependency slices. It snapshots native source
hashes and rejects a build if those inputs change while compilation runs.

The `fabric_ios_link_smoke` executable links the extension itself with
`-Wl,-u,_fabric_library_init`. This forces its GDExtension entry point and
referenced objects through the linker. The builder verifies the global entry
symbol with `nm` and the actual Mach-O platform with `vtool`: `IOS` for devices
and `IOSSIMULATOR` for simulators. The executable is a link witness; it is not
launched by this script.

Each `build-manifest.json` records the source commit and dirty state, native
source hashes, dependency archive/framework hashes, versions, Xcode/SDK,
archive/witness hashes, Mach-O build metadata and linked dependencies. Its
`godotRebuilt`, `runtimeExecuted` and `consumerExported` fields are all `false`
for this checkpoint. A successful compile cannot substitute for the pending
Godot runtime and exported-consumer evidence.

## Isolated consumer export

The pinned `hermesvm.framework` and `ReactNativeDependencies.framework` slices
are **dynamic**. They are linked dependencies of the witness and are excluded
from the combined static archive. An exported app must link the matching
framework slices, embed and sign them, and retain the static GDExtension entry
symbol. Creating the XCFramework does not perform those app integration steps.

The addon registers [ios_export.gd](../sdk/addon/ios_export.gd) through its
EditorPlugin. It explicitly includes the generated hidden JS bundle in the
PCK, links and embeds both upstream dynamic XCFrameworks, retains
`fabric_library_init`, and excludes its editor/toolchain files. Godot's original
GDExtension exporter generates the static initializer; no engine patch is
required. The integration uses the
[official Apple export plugin APIs](https://docs.godotengine.org/en/stable/classes/class_editorexportplugin.html).

[ios-consumer-export.py](../scripts/ios-consumer-export.py) creates a fresh
project and addon under `build/ios-consumer/`, stages the already-built native
packages, invokes the private SDK builder, imports and exports with the
official editor, then builds the app with Xcode. It checks actual template
architectures rather than trusting XCFramework metadata. It also checks the
PCK's bundle bytes and rejects leaked build tools/editor scripts. It never
rewrites an existing user project or installed Godot template.

For an unsigned device app export/link checkpoint:

```sh
python3 scripts/ios-consumer-export.py --target ios-device --build-only
```

The project-only export uses a fixture Team ID to satisfy Godot's project
generation precondition; Xcode signing is disabled. A physical-device build
and install requires the developer's real Apple team, signing and device.
No physical device was attached for this checkpoint.

For the separate Rosetta/iOS 18 simulator experiment, after building the
matching x86_64 package:

```sh
python3 scripts/ios-consumer-export.py --architecture x86_64
```

The runner selects an available shutdown iPhone simulator supporting that
architecture, boots it through `simctl`, installs a uniquely identified app,
runs the fixture, captures reports under `user://`, and cleans up its app and
simulator. `--simulator <UDID>` chooses a specific available shutdown iPhone.
Both normal and `.mobile` renderer settings explicitly select Compatibility.
The fixture covers Hermes/React startup, actual Godot Controls, native button
signal dispatch, prop/state rerenders, effect cleanup, unmount/remount and
shutdown. It does not exercise physical touch, IME, accessibility or device
hardware. Only an executed, passing report establishes that runtime proof.

Release diagnostics are explicitly written and flushed under
`user://logs/ios-smoke.log`; the runner requires the success marker and checks
the actual engine log. A native-only Control/Label/Button app reproduced one
startup error in the same official x86_64 template: `Mouse is not supported by
this display server`, from `mouse_get_position` at `display_server.cpp:536`.
The original [root Window startup](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/main/window.cpp#L1588-L1590)
queries the mouse position without checking mouse support. Its
[executed baseline](evidence/ios-consumer/engine-baseline.json) records the
template and fixture hashes, the absence of Fabric classes and the exact
diagnostic. The runner retains this single matched occurrence in its evidence;
another occurrence, any other error, a different template, or a missing success
marker fails validation. This is a disclosed official engine defect, not a
claim of an error-free engine log.

The report checks `FabricApplication.stop()` before teardown, including zero
roots, native tags and timers and stopped Hermes/native modules. Natural app
process exit after `SceneTree.quit()` is recorded separately. If UIKit retains
the process, the runner terminates only its isolated app before uninstalling it
and shutting down the simulator it booted. Explicit runner termination does not
establish natural process exit or physical-device lifecycle behavior.

`--use-built-checkpoint` is an explicit development escape for proving a
previously fingerprinted native package while C++ work continues. Evidence
retains that package's source hashes and records whether they match the
working tree. The default rejects stale native inputs.

## Official arm64 simulator template blocker

The locally installed official 4.7.2 `ios.zip` has SHA-256
`fd3280d10dc75356dded006f6f8813f40a5aebd32d128592b781256d8ffbdff4`.
Its Release simulator XCFramework declares `arm64` and `x86_64`, but `lipo`
finds only x86_64 code in `libgodot.a`. The actual arm64 consumer link failed
with missing `_main` and engine registration symbols. Its device slice contains
arm64 code and links successfully. This matches the upstream packaging defect
reported in [Godot issue #122379](https://github.com/godotengine/godot/issues/122379).

The default arm64 simulator runner now fails before export/build/install when
that required engine slice is absent. It preserves the installed templates and
writes bounded `template-preflight.json`/`blocked-evidence.json` under its new
output directory. The installed iOS 18.3/18.4 runtimes advertise both x86_64
and arm64, while iOS 26.3 advertises only arm64. Any separate x86_64/Rosetta
experiment leaves this arm64 blocker open. No Godot engine was recompiled or
third-party engine template substituted.
