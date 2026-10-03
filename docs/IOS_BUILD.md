# Native iOS build validation

The iOS build path compiles the Godot Fabric extension and the original
Fabric/Yoga core for **arm64 iOS devices and arm64 iOS simulators**. It uses
the iOS slices already present in the pinned Hermes and React Native dependency
archives. It compiles `godot-cpp` bindings; it does not rebuild Godot.

This is a build and link checkpoint. Running the extension inside an exported
Godot iOS application, simulator acceptance, physical-device acceptance and the
SDK's mobile export integration still need validation. The original RN iOS
reference app used by the parity suite is a separate runtime.

## Requirements and pins

Use a macOS arm64 host with full Xcode selected by `xcode-select`, Python 3.12+,
Node 22.13+ and npm. Initial setup also checks the official Godot version; set
`GODOT_BIN` if its executable is outside the usual paths. Build dependencies and
checksums come from [dependencies.json](../dependencies.json): RN 0.87.1,
React 19.2.3, Hermes 250829098.0.17, CMake 3.31.6 and the pinned `godot-cpp`
commit for Godot 4.7.2. No dependency version changes are part of this path.

The minimum deployment target is **iOS 15.1**, matching the selected upstream
Hermes device binary. Local Release builds used Xcode 26.2 (`17C52`), the iOS
and simulator 26.2 SDKs and CMake 3.31.6. Other toolchains, Debug builds and
Intel simulator slices have not been validated by this checkpoint.

Both Release builds and XCFramework packaging completed locally on
**2026-10-03**. Their manifests had identical native source hashes, matching the
working tree at packaging time. The packaged `Info.plist` identifies separate
`ios-arm64` and `ios-arm64-simulator` libraries.

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

## Consumer integration still required

The pinned `hermesvm.framework` and `ReactNativeDependencies.framework` slices
are **dynamic**. They are linked dependencies of the witness and are excluded
from the combined static archive. An exported app must link the matching
framework slices, embed and sign them, and retain the static GDExtension entry
symbol. Creating the XCFramework does not perform those app integration steps.

The remaining iOS proof needs an exported Godot consumer built with the
official templates, successful simulator execution, matching UI/runtime
contracts and physical-device execution. No attached physical device was
available for this build checkpoint.
