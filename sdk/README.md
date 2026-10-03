# Provisioned Godot addon prototype

This is the bounded **2B independent-consumer** slice of Architecture 2.0.
The addon supplies the native runtime, compatible React/RN, narrowed types and
private build tools. The Godot project owns its TSX, application Resource,
scene, package declarations, lockfile and additional libraries.

The supported prototype is **macOS arm64 / official Godot 4.7.2**. It uses
React 19.2.3, React Native 0.87.1, Hermes 250829098.0.17 and private Node 22.23.3.
There is no published prebuilt SDK release yet. A platform developer provisions
the addon from this source checkout; a basic consumer then uses the Godot editor
without a global Node installation or package installation during Play.

## Provision a new consumer

From the SDK checkout, after `npm run setup`:

```sh
npm run consumer:create -- /tmp/godot-fabric-my-ui
```

Use a directory that does not exist. The command copies the
[consumer template](../consumers/minimal/README.md), supplies the addon and
prepares extension discovery before the first editor import. It preserves
existing directories by rejecting them. Open the resulting `project.godot`
with the official engine, edit `ui/index.tsx`, then press Play.
Its copied README links guides and captures to the provisioned source commit,
so they remain usable outside this checkout after that commit is published.

To provision only an addon into a **new** directory:

```sh
npm run sdk:pack -- build/sdk/my-godot-fabric
```

This lower-level command does not configure an existing project's scene,
Resource, types or extension startup list. Installation/update of existing
projects needs a separate acceptance case before it is supported.

Provisioning can download the pinned official Node archive. Its SHA-256 is
checked before extraction. It copies the already-built native addon/frameworks,
fonts and licenses, SDK host sources/types, the pinned dependency graph and
private Node. `manifest.json` records versions, source commit/dirty status,
source hashes, native binary hash, Node archive hash and dependency-lock hash.
Generated addons and vendor trees remain ignored; they are not committed.

The initial package is about **625 MiB** because it carries the complete
laboratory dependency graph and build tools. Size reduction, signed/released
artifacts, upgrades and target-specific distribution remain open in GF-28/GF-31.

## Editor build contract

The plugin adds **Project → Tools → Godot Fabric: Build UI** and implements
Godot's [`EditorPlugin._build()`](https://docs.godotengine.org/en/stable/classes/class_editorplugin.html#class-editorplugin-private-method-build)
hook. The editor runs a synchronous child builder before Play. Failure returns
`false`, with the diagnostic in the Output panel. The build runs strict
TypeScript, bundles the project entry with the shared Godot platform seams and
applies the original RN Babel transforms. It publishes the JS file after those
steps succeed. Syntax/type, Resource, missing-tool and dependency failures
preserve the previous bundle; Play is blocked instead of silently using it.

This build uses the provisioned executable directly. It never falls back to
global Node, installs packages or edits a project lockfile. Additional packages
must be explicitly declared and installed by the project's chosen package
manager before building. The tested library fixture uses a conventional local
`node_modules`; Yarn PnP, workspaces, alternate installation layouts and complete
Metro/package-conditions behavior are not certified.

React and all its subpaths resolve to the SDK identity, including imports from
project libraries. React Native resolves to the SDK's bounded facade/original
modules. Explicit React/RN declarations must match the SDK versions. This
protects hook/reconciler identity; it does not certify arbitrary RN libraries
or implement their native backends.

The consumer builder is production-only, with `.godot`/`.native` source
resolution, no watch/cache/Fast Refresh, no project Babel configuration and no
general asset/CSS output. The standalone laboratory retains its separate
NativeWind compiler; the consumer does not yet run that compiler. A project
Babel configuration is rejected explicitly. Startup Resource version 1 and
the scene wrapper are experimental, not the complete SDK activation contract.
The menu/Play build blocks the editor while it runs; asynchronous progress and
cancellation require D19/D26 design work.

## Validate

```sh
npm run test:consumer
npm run test:consumer -- --capture
```

The harness invokes `consumer:create` for a fresh project outside the SDK
checkout, strips global Node from its environment, exercises the actual plugin in the normal editor
MainLoop and runs native/graphical assertions. It also rebuilds with network
access denied and tests project library ownership/React identity and recovery.
Raw reports/logs go to `build/consumer`; the harness removes only its own
temporary projects. See [retained evidence and captures](../docs/evidence/consumer/README.md).

The later [services checkpoint](../docs/evidence/game-services/README.md)
adds typed GDScript operations/state/signals and inventory-only resize through
original refs to this consumer. The standalone [Codegen experiment](../docs/CODEGEN.md)
is platform tooling; spec processing/native extensions are not integrated into
the addon Play hook yet.

GF-28/GF-29 remain **In progress**. D19–D29 retain their pending status; this
prototype provides evidence for those decisions, without deciding exports,
reload/restart, artifact generations, complete types or dev tooling.
