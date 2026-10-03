# Standalone Codegen fixtures

These TypeScript specs exercise the original React Native Codegen 0.87.1.
`NativeCodegenProbe.ts` derives methods, a Promise result, structs and a typed
TurboModule event emitter. `BadgeNativeComponent.ts` derives primitive defaults,
a typed direct event, a command, Fabric descriptors/props/state/shadow nodes and
the original React Native ViewConfig. There is no implemented Badge renderer or
native module behind these fixtures.

`NativeFlowProbe.js` separately exercises the original Flow parser with
`echo`/`count`; it also generates alongside the TypeScript specs without
colliding. The C++ compilation witness targets the TypeScript Badge/Probe pair,
not a running Flow module.

Run with an existing Node 22.13+ toolchain and installed project dependencies:

```sh
node scripts/codegen.mjs generate --root tests/codegen --library CodegenFixture \
  --native-combination tests/codegen/native-combination.json --out /tmp/codegen-fixture \
  --spec NativeCodegenProbe.ts --spec BadgeNativeComponent.ts
node scripts/codegen.mjs verify --root tests/codegen --library CodegenFixture \
  --native-combination tests/codegen/native-combination.json --out /tmp/codegen-fixture \
  --spec NativeCodegenProbe.ts --spec BadgeNativeComponent.ts
node --test tests/codegen.test.mjs
```

Generation reserves a new output directory exclusively and publishes its
manifest last. Verification reads and compares all
derived bytes without rewriting output. The manifest records sources, schema,
original Codegen source tree, project lockfile, wrapper sources, Node version
and each artifact hash. The combination declaration must be supplied again at
verification; changing SDK/headers/RN/runtime/dependencies/toolchain/target
requires a corresponding generation. The declaration is experimental and does
not validate actual binaries or certify an ABI. This fixture uses obviously
synthetic hashes, is marked `test-fixture` and claims no native build/runtime.

Parser identities additionally record the resolved Babel/Hermes/ESTree package
trees, including nested installation. The tests detect changed installed bytes
without modifying shared dependencies.

The initial strict schema profile covers core ViewProps with primitive defaults,
direct/bubbling events named `onEvent` with required object fields, primitive command parameters
with void returns, and C++
TurboModule methods/events with primitives, objects, aliases, arrays, nullable
values and Promise returns. It rejects enums, reserved native props such as
ColorValue, platform exclusions, interface-only/Paper options and unknown
schema fields/types, reserved identifiers, collisions with known imported RN
core types and generated symbol/wire/path collisions. This is not a complete
registry of symbols exported by third-party adapters. `UnsupportedBadgeNativeComponent.ts` demonstrates an
explicit diagnostic for a valid RN spec outside this experimental profile.
String defaults containing quotes, backslashes, controls or unpaired surrogates
are rejected because the pinned original C++ generator interpolates them without
escaping; float defaults must fit their declared finite range.

Outputs use original generators without editing them. No iOS/Java implementation,
provider loading, Godot mount behavior, Metro/Babel integration or native binary
certification is provided by this tool. Those remain separate acceptance work.
