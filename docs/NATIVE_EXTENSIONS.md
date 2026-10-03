# Experimental native extension foundation

GF-26 now has a shared native SDK, a package preflight and a per-application
registration SPI. An external C++ client compiles original generated Fabric
descriptors against the packaged host and exercises registration without
building another copy of Godot/RN bindings. These are foundation contracts;
the next executed slice now selects/loads an adapter before bundle evaluation
and mounts its Control through the original Fabric mutation stream. The
[independent consumer evidence](evidence/native-adapters/README.md) proves
35 headless checks and 37 graphical checks on macOS arm64 Release.

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
The native loader repeats compatibility/collision checks and hashes before
opening any selected library. It also rechecks selected files after loading,
after binding-witness getters and after initializers. The build pairs a hashed
bundle with original package/Codegen manifest references. Godot automatic
GDExtension discovery does not load these selected adapter libraries.

The first SPI requires canonical descriptor names: declarations changed by RN's
normalizer, such as `RCTCodegenBadge`, are explicitly rejected. Lookup of
`RCTCodegenBadge` can resolve an accepted `CodegenBadge` provider using the
original RN normalizer. Broader spec/name/profile support remains required for
full GF-26 acceptance; this restriction does not redefine 1.0 compatibility.

## Registration and ownership

After complete package selection, the loader calls:

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
`Control`; the host owns that Control and calls `dispose()` once
before deleting it. `children_host`, typed ShadowView updates, commands and
snapshot hooks avoid casting an external generated Props object to the core's
`ControlProps`. The host applies common ViewProps/Yoga geometry and calls the adapter hooks
for committed Create/Insert/Update/Remove/Delete mutations. Native allocation
never happens in speculative ShadowNode callbacks.

`AdapterViewContext::dispatch_event` is a host-provided function, not a global
tag lookup. The host validates runtime/root/mount generation, the current committed
emitter and the execution thread at delivery. Removal or shutdown retires its
authority even if an adapter retains the function. Ref commands also require
the current component handle and emitter identity.

Module providers install lazily into the application's existing
`TurboModuleRegistry`. Accepted cleanup is called once after rollback, explicit
stop or destruction of unclaimed registration state; cleanup errors do not skip
other modules. Disposed factories refuse new construction. An adapter must
invalidate its already extracted methods and pending work before VM destruction.
Library handles, descriptor pointers and module objects must stay alive through
that teardown; this SPI does not support hot unloading.

## Select and activate an adapter from a project

The project declares and explicitly installs its dependencies with its own
package manager. Selection is opt-in:

```json
"godotFabric": {
  "adapters": [{"package": "my-adapter", "manifest": "adapter.json"}]
}
```

Provision the addon with an explicitly verified native SDK:

```sh
node scripts/pack-addon.mjs OUTPUT --native-sdk build/native-sdk
```

The private builder verifies selected specs using the original Codegen tools,
then runs the original RN Babel transform on each original spec filename before
esbuild erases types. Named exports/Commands are preserved. Original native
component registry, ViewConfig composition and renderer remain upstream; Godot
supplies the base ViewConfig. Direct/bubbling wire collisions fail before a new
bundle is published. Source changes during a build are rejected.

The build emits `app.js.adapters.json` next to the bundle. The addon application
node passes this packet to `FabricApplication` before the first mount. The host
requires the configured bundle to match the packet and allows one initialization
attempt. Failed initialization stops the application; paths/selection cannot be
changed after activation. Missing dependencies never trigger an implicit install.

The adapter also supplies this experimental export from its own translation unit:

```cpp
extern "C" const fabric_godot::AdapterBindingWitness *
godot_fabric_adapter_bindings_v1() {
  static const auto witness = fabric_godot::adapter_binding_witness();
  return &witness;
}
```

The loader compares the supplied Godot/RN/JSI/Hermes anchor addresses with the
shared host before any entry initializer. A test with actual hidden duplicate
Godot binding variables is rejected. UUIDs identify loaded Mach-O images; file
hashes identify SDK receipts. These observations do not hash all loaded memory,
certify absence of arbitrary duplicated code or establish a stable ABI.

Libraries stay pinned for the process, including failed loads. Changed builds at
an already loaded path and stale host UUID/file combinations require a restart.
There is no hot unloading. All selected exports are resolved before the first
entry initializer, but native static constructors necessarily execute at dlopen
and cannot be rolled back. Registry cleanup remains per application.

## Remaining acceptance

GF-26, GF-28 and GF-31 remain In progress. This fixture does not prove arbitrary
React Native package compatibility, unrestricted Codegen schema/name support,
Paper/requireNativeComponent reflection, cross-version ABI, exported debug/release
adapters on every target, dev refresh, asynchronous cancellation/long-running work
or full differential behavior against iOS/Android RN. The additional loader
witness is an experimental contract of this slice; pending architecture decisions
are not silently approved by these checks.

The current host owns native geometry and accepts a contained `children_host`.
The executed fixture is a leaf Button: external child containers, rejected
factories, complex native state/measurement and their failure transactions still
need dedicated acceptance. Keep these gaps separate from the already executed
props/events/commands/module and stale-authority checks.

### Shutdown from a native callback

An application stop requested inside a Fabric/Hermes call retires event and command authority immediately. The host preserves mounted Controls until the outer execution scope returns, then performs original RN teardown. Remaining RAF/timer callbacks cannot resume work during that shutdown. [Executed resize/focus fixtures](evidence/adapter-shutdown/README.md) cover external and internal Button signals. Independent root destruction during update and arbitrary asynchronous cancellation remain separate open contracts.
