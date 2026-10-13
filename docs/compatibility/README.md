# Versioned public API inventory

[react-native-0.87.1.json](react-native-0.87.1.json) is a manual, dated audit of
the 97 runtime value names exported by the installed package's
`types_generated/index.d.ts`, including aliases and namespace/function exports.
Type-only exports, globals, prop/event/style definitions and private imports
are excluded. The source URL and SHA-256 are recorded together with the pinned
npm archive hash and audited public source commit.

To reproduce the upstream name set, install the exact lockfile with
`npm ci --ignore-scripts`, read
`node_modules/react-native/types_generated/index.d.ts`, collect names from
`export { ... }`, `export * as ...` and `export declare function ...` statements,
and ignore `export type ...`. Compare the sorted distinct set and source hash
with the snapshot. Review actual facade implementations rather than counting
export declarations as supported behavior.

Each entry has a current status, a 1.0 or post-1.0 scope assignment, source
references and a stable work ID in [ROADMAP.md](../../ROADMAP.md). Status is a
snapshot of current source, not the live status of a future implementation.
A missing public export can exist internally upstream without being usable
through this platform. An unavailable placeholder throws when invoked.

There are 84 target names for 1.0 and 13 explicitly deferred experimental or
unstable names. `unstable_batchedUpdates` is kept in the 1.0 compatibility
contract. Deprecated stable exports still need the pinned upstream behavior;
deprecation does not mean they can silently disappear.

This is **not an automated behavioral coverage gate** and does not describe
all 84 target contracts. GF-01 expands it into props, styles, events, methods,
commands, globals and types with executable differential fixtures. It must not
be used to calculate a compatibility percentage. On an RN upgrade, generate a
new versioned snapshot, review additions/removals and link each contract to
updated native evidence; do not overwrite the previous baseline silently.

## Generated contract inventory

[contracts-0.87.1.json](contracts-0.87.1.json) is the machine-generated expansion of
that audit (`npm run parity:inventory`; counts and the reading of each kind are in
[BASELINE.md](BASELINE.md)). Its rows are `{id, kind, owner, name, type, source}` with
the kind-specific fields below, sorted by id; regenerating gives identical bytes.

| Kind | Derived from | Notes |
| --- | --- | --- |
| `value`, `type`, `prop`, `event`, `style`, `ref-member`, `api-member`, `type-member` | `types_generated/index.d.ts`, resolved by the TypeScript checker | `value` and `api-member` rows also carry `platformImplementation` and `platformEvidence` |
| `global-value`, `global-type`, `global-member` | `src/types/globals.d.ts` | the globals RN declares |
| `runtime-global` | the syntax trees of the modules `InitializeCore` runs (`setUp*`, `polyfill*`, `AppRegistry`) | `owner` is the object the property sits on, `installer` the module the entry function requires, `sites` the installs with their conditions |
| `host-global` | reads of `global.<name>` (and four free identifiers) in `Libraries/` and `src/` that no RN file installs | host naming rule plus a checked-in allow-list; every other read is excluded with a reason |
| `native-command` | every `codegenNativeCommands<...>({supportedCommands})` call in `Libraries/` and `src/` | `type` is the command's signature in its `Commands` interface |

`platformImplementation` (`["ios"]`, `["android"]`, `["android","ios"]`) is mechanical:
the value's module has a `.ios.js` or `.android.js` file next to it, or its name ends
in `IOS`/`Android`; an API member inherits its value's marker and is also marked when its
own name ends in `IOS`/`Android`. It marks where an OS-specific implementation exists and decides
nothing about Godot. The `derivation` block of the file records the scan rules, the
setup chain with the conditions on each module, the globals RN installs outside that
chain, and the reads left out of `host-global` with their reasons.

The inventory still has no per-row owner, applicability decision or positive/negative
fixture: the GF-01 `contract` checkpoint stays open until those exist and a gate
enforces them.
