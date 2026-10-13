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
| `value`, `type`, `prop`, `event`, `style`, `ref-member`, `api-member`, `type-member` | `types_generated/index.d.ts`, resolved by the TypeScript checker | `value` and `api-member` rows also carry `platformImplementation` and `platformEvidence`; a member is a row only when RN declares it (`react-native` or `@react-native/*`), not when the checker reaches it through `String`, `Object.prototype` or React's classes |
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

The inventory itself decides nothing about who owns a row, whether it is a target, or where it applies. The
[contract map](#contract-map-owner-scope-and-applicability) below does, and the GF-01 `contract` checkpoint stays open until the
last part, the positive/negative fixture catalog, exists and a gate enforces it.

## Contract map: owner, scope and applicability

[contract-map-0.87.1.json](contract-map-0.87.1.json) gives every row of the inventory an **owner**, a **scope** and an
**applicability**, by rules plus per-row overrides, not one entry per row. `npm run parity:map` prints the coverage per GF (row
counts by kind, scope and applicability), and `node scripts/parity-map.mjs --check`, part of `npm run test:parity`, is the gate.

- **owner**: an id of a task in `dashboard/migration.json` (GF-01 to GF-40), read from that task's acceptance text. The 97 root
  values keep the owner and the target of the dated audit above (a test checks all 97). A row belongs to the family of the type it
  sits in (every prop, event, style, instance member and type member of `SwitchProps` is GF-17's), with two exceptions that the
  acceptance texts make: accessibility metadata is GF-20's on every component, and View's pointer, touch, responder and focus events
  are GF-13's. Platform-specific props of a cross-platform component (ScrollView's iOS bounce props, TextInput's Android props) stay
  with that component's task, whose acceptance says "where applicable"; GF-24 owns the OS-only components and APIs it names.
- **scope**: `1_0` (a target of the 1.0), `post_1_0` (a target later; the 13 unstable exports of GF-40, the default-off
  observers, lazy bundles) or `out` (never a target, with a reason: the React.Component lifecycle and state members and the two
  statics that `VirtualizedList` re-declares, which React calls and an app does not, and the globals only the legacy bridge reads).
  The members of ECMAScript built-ins and of `Object.prototype` and `React.Component` that the inventory used to read through a
  string-literal type or a class instance are no longer rows, so no rule sweeps them.
- **applicability**, per platform. `ios` and `android` are the pinned original React Native apps the differential runs compare
  against; `godot` is this host (`Platform.OS` is `"godot"`). Each is one of:
  - `applies`: the contract exists on that platform and its owner must make it behave as upstream does.
  - `not-applicable`: the positive behavior is not part of the target there, with a reason. Where RN itself defines what
    happens (a warning, a rejection, a no-op), that outcome is the contract and the owner covers it with a negative fixture. For
    members that the pinned declarations annotate `@platform ios` or `@platform android`, Godot defaults to `not-applicable`; the
    GF that implements one flips that row, with a reason, in the same change.
  - `host-provides`: RN's JavaScript does not install it, so the host (or its engine or bundler) must. Every `runtime-global`
    site carries its `gates`; the map's `gateModel` classifies each gate under bridgeless mode (the Godot host reports
    `RN$Bridgeless` true, `native/turbo_module_registry.cpp`, as RN 0.87 does on iOS and Android). A site behind
    `!(global.RN$Bridgeless === true)` is dead, and a global whose every site is dead (`setTimeout`, `setInterval`, `clearTimeout`,
    `clearInterval`, `requestAnimationFrame`, `cancelAnimationFrame`) is `host-provides` on all three platforms. A global with a
    live bridgeless site (`queueMicrotask`, `setImmediate`, `requestIdleCallback`) is `applies`. The Web Performance classes are
    installed only when the host registers `NativePerformance`, so they are `host-provides` on Godot. The `host-global` rows
    (names RN reads and never installs) are `host-provides`, except the four that only the legacy bridge reads, which are `out`.
    A gate the model does not classify, or a classified gate no site has, fails the check.

**Rules.** A rule has an `id`, an integer `precedence` (higher wins), a `match`, any of `owner`, `scope` (with `scopeReason` unless
`1_0`) and `applicability`, and a `why`. `applicability` is a profile name from `applicabilityProfiles` or an object with
`ios`, `android` and `godot` entries, each a status or `{status, reason}`; a status other than `applies` needs a reason. A
`match` is an AND of these keys, each a string, a list of strings (any of), `{"pattern": "<regular expression>"}` or
`{"absent": true}`, except `kind`, `installedBy` and `conditions`, which are tested against a closed vocabulary and so take only a
string or a list of strings (a pattern or `{"absent": true}` there fails the check as `E_SHAPE`):

| Key | Matches |
| --- | --- |
| `kind` | the inventory kind, or a list of kinds; `@api`, `@members` and `@declared-globals` name groups of kinds (`kindGroups`) and may appear in the list |
| `subject` | the API a row is about: the `name` of a `value`, `type`, `global-value`, `global-type`, `runtime-global` or `host-global` row, the `owner` of any other row |
| `owner`, `name`, `id`, `source` | the field of the row; `source` is the declaring file, so a prop inherited from `ViewAccessibility.d.ts` can be told from one a component declares |
| `installedBy`, `conditions` | derived from the gates of a `runtime-global` row (and, for `installedBy`, its `global-value` namesake): `host` or `rn` (or a list of them), and the gate states of the sites that can run (one gate state, or a list of them) |

Each field (`owner`, `scope`, `ios`, `android`, `godot`) is resolved separately: among the rules that match a row and assign the
field, the highest precedence wins, and two rules at the highest precedence are an ambiguity (even if they agree). The bands in
use, so that a new rule has an obvious place:

| Precedence | What it decides |
| --- | --- |
| 10 | the family of an API: owner, scope and a default applicability, by `subject` (and by derived gates for globals) |
| 20 | owners that cut across components: accessibility (GF-20), View's pointer, touch, responder and focus events and `hitSlop` (GF-13), the DOM node API of every instance (GF-08) |
| 25-30 | applicability from evidence: `@platform` annotations of the declarations, names that say Android, the iOS and Android view configs, derived gates |
| 35 | Godot exceptions to the annotation default, where an acceptance text or the supported 0.5 subset needs the member |
| 40 | OS-only components and APIs (GF-24), which outrank the member annotations inside them |
| 50 | rows that are not RN contracts (`out`) |

An **override** names one row (`id`), sets any of the same fields, and needs a `reason`. Use one for a true exception to a family,
for example `AppRegistry`'s headless tasks (an Android service feature) or the three `Image` members that download over the network
(GF-16 leaves network images to GF-22). The native command files are tied to their public component in `nativeComponents`, and the
owner of a command follows that component's task.

**The evidence is not the decision.** The S1 marker `platformImplementation`, the `@platform` annotations and the 0.5 prop
classification (`src/prop-scope.mjs`, `scope-0.5.json`) are evidence, and `tests/parity-map.test.mjs` checks the map against all
three: for example `Settings` is marked iOS-only and GF-23 delivers it on Godot, so the map says `godot: applies`.

**Adding a row or a decision.** A row the inventory gains (an RN upgrade, a new kind) has no rule yet and fails with
`E_UNMAPPED`: add its API to the `subject` list of the family rule of its task, or add a rule. To change what one GF owns or
where something applies, edit the rule or add a higher-precedence rule or an override with the reason; do not leave the old
decision in place.

**The gate** (`--check`) fails when a row has no owner, scope or applicability (`E_UNMAPPED`); an owner is not a dashboard task
(`E_UNKNOWN_OWNER`); two rules of equal precedence match one row (`E_AMBIGUOUS`); an override names a row that no longer exists or
assigns what the rules already say (`E_STALE_OVERRIDE`, `E_NOOP_OVERRIDE`); a rule matches nothing or every field of every row it
matches is won by a stronger rule (`E_DEAD_RULE`); a reason, a `why` or a `scopeReason` is missing (`E_REASON`); a gate, profile or
native command link is unclassified, unused or unknown (`E_UNKNOWN_GATE`, `E_STALE_GATE`, `E_STALE_PROFILE`, `E_UNLINKED_COMMAND`);
or the file is malformed (`E_SHAPE`).

The map does not assign fixtures, polarity or tolerances: those are the last part of the `contract` checkpoint.
