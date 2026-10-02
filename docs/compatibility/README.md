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
