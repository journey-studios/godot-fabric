# Experimental native extension foundation

GF-26 now has a shared native SDK, a package preflight and a per-application
registration SPI. An external C++ client compiles original generated Fabric
descriptors against the packaged host and exercises registration without
building another copy of Godot/RN bindings. These are foundation contracts;
the application does not yet discover/load an adapter or mount its Control.

The [original Codegen experiment](CODEGEN.md) remains the source of spec/schema
derivation. Original React Native generators and descriptors are unchanged.
The [executed evidence](evidence/native-sdk/README.md) distinguishes packaging,
client linking and registry execution from engine/VM/UI behavior.

## Build and verify the shared SDK

Prepare the existing macOS arm64 Release native build with `npm run setup`.
On Unix Makefiles, CMake captures the actual consumed source/header trees,
target flags, compiler, Node and dependency binaries before compilation. Its
post-link receipt refuses changes during that build. Existing receipts also
refuse a package when sources, headers, flags or the host binary change.

```sh
npm run sdk:native:pack -- --build-dir .deps/build --out build/native-sdk
npm run sdk:native:verify -- --sdk build/native-sdk
npm run test:adapters:native -- --sdk build/native-sdk --out build/adapter-registry
```

Use fresh output directories. The pack command uses the same Node executable
selected by CMake's `FABRIC_SDK_NODE`; supply that executable explicitly when
the shell uses another Node. Nothing in these commands installs dependencies,
recompiles the Godot engine or chooses packages from a project's dependency
manager. The existing addon remains the intended authoring/activation entry.

The package contains public SPI headers, original RN/JSI and Godot headers,
one shared `fabric_godot.dylib`, Hermes/RN dependency frameworks, licenses,
an imported CMake target, file hashes and a native-combination declaration.
Adapters import these shared libraries. They must not link their own
`godot-cpp`, RN core or JSI archive or initialize another GDExtension instance.
The host retains the bindings for the pinned Godot class profile.

An identified client uses:

```cmake
find_package(GodotFabricNativeSDK CONFIG REQUIRED)
add_library(my_adapter SHARED adapter.cpp ${generated_component_sources})
target_include_directories(my_adapter PRIVATE "${generated_cpp_directory}")
godot_fabric_configure_adapter(my_adapter
  HOST_RUNTIME_DIR "../../godot_fabric/native")
```

`HOST_RUNTIME_DIR` is relative to the deployed client library. Imported targets
use C++20, arm64, Release, macOS minimum 13.0 and the identified AppleClang
binary. Linking is strict, with relative deployment RPATHs. This first package
is an experimental C++ SPI tied to those bytes; it does not certify a stable C
ABI or the complete SDK/toolchain/OS ABI. Other targets/configurations and
export integration remain open in GF-26/GF-28/GF-31.

## Package selection before native initialization

`scripts/adapter-manifest.mjs` exports the read-only `preflightAdapters` API.
It receives package roots and the host's expected native combination. An
adapter manifest has this exact envelope:

```json
{
  "format": "godot-fabric.experimental-adapter/v1",
  "id": "BadgeAdapter",
  "entryPoint": "godot_fabric_adapter_init_v1",
  "library": {"path": "native/badge.dylib", "sha256": "<library SHA-256>"},
  "nativeCombination": "<complete combination object>",
  "codegenManifest": {"path": "generated/manifest.json", "sha256": "<manifest SHA-256>"},
  "components": ["CodegenBadge"],
  "modules": ["CodegenProbe"],
  "dependsOn": []
}
```

The abbreviated hash/combination fields above are explanatory placeholders,
not an accepted manifest. The Codegen manifest's sources are relative to the
package root; its schema/artifacts are relative to its generated directory.
Preflight verifies source/schema/derived bytes with the original locked tools,
combination identity, file hashes and paths resolved inside the package. It
rejects core/normalized/public-name collisions, missing dependencies and cycles,
and returns a dependency-first order before native loading or project JS import.

This build preflight does not freeze files or confer native execution authority.
The future native loader must repeat compatibility/collision checks and hashes
immediately before opening any selected library. Godot's automatic extension
initialization would execute too early for this contract. Neither addon discovery
nor that runtime loader is delivered by this slice.

The first SPI requires canonical descriptor names: declarations changed by RN's
normalizer, such as `RCTCodegenBadge`, are explicitly rejected. Lookup of
`RCTCodegenBadge` can resolve an accepted `CodegenBadge` provider using the
original RN normalizer. Broader spec/name/profile support remains required for
full GF-26 acceptance; this restriction does not redefine 1.0 compatibility.

## Registration and ownership

After complete package selection, the intended loader calls:

```cpp
extern "C" void godot_fabric_adapter_init_v1(
    fabric_godot::AdapterRegistry &registry) {
  registry.add_component(original_generated_provider, view_factory);
  registry.add_module("CodegenProbe", module_factory, dispose_module_state);
}
```

The host supplies an ID and exact declared exports to `register_adapter` before
invoking this synchronous initializer. Factories remain lazy. Undeclared,
missing, duplicate or invalid providers fail registration. An incomplete or
throwing initializer rolls back only its own accepted state; earlier adapters
survive. Cleanup during rollback has no registration, nested-initializer, seal
or stop authority. After selection, `seal()` closes registration.

Each `AdapterView` owns its callbacks/state and returns an off-tree Godot
`Control`; the future host owns that Control and must call `dispose()` once
before deleting it. `children_host`, typed ShadowView updates, commands and
snapshot hooks avoid casting an external generated Props object to the core's
`ControlProps`. This interface alone does not implement those mount paths.

`AdapterViewContext::dispatch_event` is a host-provided function, not a global
tag lookup. The host must validate runtime/root/mount generation, committed
emitter and execution thread when called. Removal or shutdown must retire its
authority even if an adapter retains the function. This enforcement remains
part of the next native integration.

Module providers install lazily into the application's existing
`TurboModuleRegistry`. Accepted cleanup is called once after rollback, explicit
stop or destruction of unclaimed registration state; cleanup errors do not skip
other modules. Disposed factories refuse new construction. An adapter must
invalidate its already extracted methods and pending work before VM destruction.
Library handles, descriptor pointers and module objects must stay alive through
that teardown; this SPI does not support hot unloading.

## Remaining native integration

1. Add runtime package selection/loader and retain library generations safely.
2. Install providers and lazy modules into ApplicationRuntime before bundle
   evaluation, using original RN registry requests.
3. Add external mount/update/children/commands/snapshot/disposal paths and event
   authority; stop assuming every native component has core ControlProps.
4. Process original specs/ViewConfigs before bundling removes their types; wire
   public codegenNativeComponent/Commands and addon diagnostics/activation.
5. Build/run an independent Badge/Probe consumer: defaults and removed props,
   typed events, public ref commands, keyed/reordered/two-root mounts, stale
   callbacks, Promise/emitter behavior and extracted-method shutdown.
6. Verify single initialized binding identity in the Godot process, mismatched
   binary failures and per-target debug/release export/package behavior.

GF-26, GF-28 and GF-31 retain their complete roadmap acceptance. No UI screenshot
is attached to this foundation because no external Control has rendered yet.
