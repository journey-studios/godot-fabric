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
`--template libraries` creates the [libraries consumer](../consumers/libraries/README.md)
instead (NativeWind and Chart Kit, with its own lockfile to install; see
[below](#libraries-nativewind-and-chart-kit)).

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

Provisioning requires a native build matching the current host sources, headers,
build/dependency definitions and pointer-overlay generator. The default path
uses the receipt produced by setup/CMake in `.deps/build/native-sdk-build.json`;
`--native-sdk` verifies both package integrity and this source combination.
An older valid SDK is rejected with `SDK_HOST_SOURCE_MISMATCH` before copying,
and copied host/framework bytes are checked again before the addon manifest is
published. Rebuild the native addon or supply a matching SDK when that diagnostic
appears. JS/docs/package edits alone do not require matching native source hashes.
See the [executed composition guards](../docs/evidence/event-dispatch/README.md).

The initial package is about **625 MiB** because it carries the complete
laboratory dependency graph and build tools. Size reduction, signed/released
artifacts, upgrades and target-specific distribution remain open in GF-28/GF-31.

## Editor build contract

The plugin adds **Project → Tools → Godot Fabric: Build UI** and implements
Godot's [`EditorPlugin._build()`](https://docs.godotengine.org/en/stable/classes/class_editorplugin.html#class-editorplugin-private-method-build)
hook. The editor runs a synchronous child builder before Play. Failure returns
`false`, with the diagnostic in the Output panel. The build checks the project's
TypeScript settings, bundles the project entry with the shared Godot platform seams and
applies the original RN Babel transforms. It publishes the JS file after those
steps succeed. Syntax/type, Resource, missing-tool and dependency failures
preserve the previous bundle; Play is blocked instead of silently using it.

The checker and esbuild both receive the project's `tsconfig.json` explicitly.
Semantic and syntax checking uses the pinned `tsc-rs` 0.1.0 native compiler
(upstream compiler version `7.1.0-dev`) through its unstable synchronous API.
Its checker binaries support Linux x64 and macOS arm64. The provisioned Godot SDK remains supported on
macOS arm64. The builder uses the project's supported JSX/strict settings and
inheritance, rather than letting the first import of an SDK facade determine
them. TypeScript 6.0.3 remains installed for configuration parsing, scoped
module lookup and the existing parity AST inventory; it is not the semantic or
syntax checker for consumer builds.

A facade reached through both an ESM import and a CommonJS native-module alias
previously acquired different strict directives depending on resolution order.
Recovery keeps the exact-byte bundle assertion; see the
[executed determinism regression](../docs/evidence/bundle-determinism/README.md).
The npm lockfile pins the checker and its platform package. There is no silent
fallback to another checker, and Play does not install or download compiler
packages. The compiler ships in the installed dependency graph used by setup
and SDK provisioning. The existing esbuild bundle and RN Babel transform
pipeline continues after checking; this migration changes the checker only.
The addon manifest binds the package/compiler versions and native executable
SHA-256. A missing or mismatched checker record blocks the build; reprovision
older addons to adopt the new toolchain. See the
[measured comparison and consumer checks](../docs/evidence/ts-rust/README.md).
This proof covers unchanged inputs in one project, not byte-identical bundles
across different installation paths or every TypeScript compiler option.

This build uses the provisioned executable directly. It never falls back to
global Node, installs packages or edits a project lockfile. Additional packages
must be explicitly declared and installed by the project's chosen package
manager before building. The tested library fixture uses a conventional local
`node_modules`, including a dependency installed only inside its importing
library. Direct app imports require project declarations; a library's imports
use its own dependency/optionalDependency/peerDependency declarations and
resolution directory. The build never requires every transitive package to be
hoisted into the project root. Yarn PnP, workspaces, alternate installation layouts and complete
Metro/package-conditions behavior are not certified.

Local `compilerOptions.paths` aliases work through the effective project
TSConfig, including `extends` and its inherited path base. For example, add
`"@ui/*": ["./ui/*"]` alongside the template's SDK type mappings, then import
`@ui/store` or `@ui/platform`. TypeScript and the bundle both select
`ui/platform.godot.ts`. Aliases must address local implementation files within
the project; SDK implementations, declaration-only files, installed packages
and paths escaping through symlinks are rejected. Keep aliases specific to the
app: an alias matching an installed library's or private SDK's import is
explicitly rejected instead of replacing that library's dependency.

This prototype requires effective `moduleSuffixes` of exactly
`[".godot", ".native", ""]`. Other orders fail with `E_PROJECT_SUFFIXES`
before publishing, preventing types and runtime from selecting different
platform implementations. React/RN/runtime type mappings must retain the
template's physical SDK surface (`E_PROJECT_SDK_IDENTITY`). Configuration and
dependency-manifest changes during a build reject publication with
`E_PROJECT_CONFIG_CHANGED`. See the
[executed module-resolution cases](../docs/evidence/project-resolution/README.md).

React and all its subpaths resolve to the SDK identity, including imports from
project libraries. React Native resolves to the SDK's bounded facade/original
modules. Explicit React/RN declarations must match the SDK versions. This
protects hook/reconciler identity; it does not certify arbitrary RN libraries
or implement their native backends.

The consumer builder is production-only, with `.godot`/`.native` source
resolution, no watch/cache/Fast Refresh, no project Babel configuration and no
general asset/CSS output: the one CSS it compiles is a project's Tailwind entry
([below](#libraries-nativewind-and-chart-kit)). A project Babel configuration is
rejected explicitly. Startup Resource version 1 and
the scene wrapper are experimental, not the complete SDK activation contract.
The menu/Play build blocks the editor while it runs; asynchronous progress and
cancellation require D19/D26 design work.

## Libraries: NativeWind and Chart Kit

An independent project can use the original NativeWind and Chart Kit v2 through
this builder alone. The [libraries consumer](../consumers/libraries/README.md) is
the executed template: its own `package.json`, its own committed lockfile
(installed with the provisioned private Node and `npm ci --ignore-scripts`) and TSX
that imports only packages. The builder never runs project JavaScript for this.

| Release | Version |
| --- | --- |
| `nativewind` | 4.2.7 |
| `react-native-css-interop` | 0.2.7 |
| `tailwindcss` | 3.4.17 |
| `react-native-chart-kit` | 7.0.4 (`react-native-chart-kit/v2`) |
| `react-native-svg` | 15.15.5, declared and installed; replaced by the SDK's SVG facade in the bundle |

**Declarative Tailwind.** The project declares its Tailwind configuration as JSON in
`package.json`:

```json
"godotFabric": {
  "tailwind": {
    "content": ["./ui/**/*.{ts,tsx}"],
    "darkMode": "media",
    "theme": {"extend": {"colors": {"brand": {"600": "#059669"}}}}
  }
}
```

`content` globs are relative to the project and cannot leave it; `darkMode` is
`"media"`, which NativeWind follows through `Appearance`; `theme` is a JSON object.
Any other field fails with `E_PROJECT_TAILWIND`. The builder builds Tailwind's
configuration in process with `nativewind/preset`, with NativeWind's native pipeline
(`NATIVEWIND_OS=godot`) and rem of 14, and never executes a `tailwind.config.*`: one in
the project fails with `E_PROJECT_TAILWIND_CONFIG`, naming this field. `godotFabric`
keeps `adapters` beside it.

**The CSS entry.** A project CSS import that holds the three `@tailwind` directives
(`import "../global.css"`) is compiled by the SDK's own Tailwind and
`react-native-css-interop`'s compiler into a module that registers the styles with the
one interop runtime of the bundle, the project's. Any other CSS (an `@import`, plain
CSS, or CSS from a package) fails with `E_PROJECT_CSS`, and esbuild still refuses every
other asset or CSS output. The project must declare `nativewind`, and the installed
`nativewind` and `react-native-css-interop` must be exactly the releases the SDK
compiles with (`E_PROJECT_NATIVEWIND_VERSION`). The build report records the entry,
the declaration and the releases under `styles`.

**JSX.** Set `"jsxImportSource": "nativewind"` in the project's `tsconfig.json`: the
`className` transform then needs no Babel. `react-native-css-interop` ships one file
with JSX in a `.js` file, `dist/doctor.native.js`; the builder compiles exactly that
file with esbuild's JSX loader and the package's own `jsx-runtime`. JSX in any other
`.js` file is still refused.

**Optional peers.** A peer that a package names only in `peerDependenciesMeta` with
`optional: true` counts as declared. If the project does not install it, the import
resolves to the SDK's facade where one exists (`react-native-svg`, and facades that
throw where used for `react-native-reanimated` and `react-native-safe-area-context`),
so `animate-spin` fails explicitly at the Reanimated facade. Without a facade, an
absent optional peer is a build-time resolution error.

**`className` types.** `className` is a type error until the project opts in by
listing `addons/godot_fabric/types/nativewind.ts` in its tsconfig `include`. It then
exists on `View`, `Text`, `Image` and `Pressable` only (`TextInput`, `Switch`, lists and
every other component stay without it). The SDK declares `ViewProps`, `TextProps` and
`ImageProps` as interfaces so that this file can merge into them, and declares
`Pressable` and `useWindowDimensions`. `nativewind/types` is not the opt-in: it names
many interfaces the SDK narrows or does not declare.

**Exercised, with executed evidence:** `className` on `View`, `Text`, `Image` and
`Pressable` (colours, spacing, borders, radius, typography, `active:`), manual dark
mode through `Appearance.setColorScheme` with `dark:` variants, retained state across a
`className` swap, a theme switch and a styled-subtree unmount and remount, and Chart
Kit v2's `LineChart` over the SVG adapter. **Not supported, and failing explicitly or
out of scope:** `TextInput` `className`, following the operating system's theme,
`fontScale`, `rem` and `PixelRatio` scaling, `darkMode` other than `"media"`,
Reanimated animations, safe-area and screens ports, Chart Kit's v1 root API, the other
Chart Kit charts and the SVG features the adapter lacks. GF-27 stays in progress.

## Validate

```sh
npm run test:consumer
npm run test:consumer -- --capture
npm run test:consumer:libraries
npm run test:consumer:libraries -- --capture
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
uses original pinned generators. The later
[external-adapter checkpoint](../docs/NATIVE_EXTENSIONS.md) integrates explicitly
selected package specs into the addon builder and mounts their generated
components/modules through a verified shared native SDK. Its runtime proof is
bounded to macOS arm64 Release; arbitrary packages and complete exports remain
open.

GF-28/GF-29 remain **In progress**. D19–D29 retain their pending status; this
prototype provides evidence for those decisions, without deciding exports,
reload/restart, artifact generations, complete types or dev tooling.
