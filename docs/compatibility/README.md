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
[contract map](#contract-map-owner-scope-and-applicability) below does, and the
[fixture catalog](#fixture-catalog-polarity-tolerance-and-the-pending-ledger) after it says which executable check backs which row
and lists, by GF, the rows that have none yet.

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
for example `AppRegistry`'s headless tasks (an Android service feature), the three `Image` members that download over the network
(GF-16 leaves network images to GF-22) or the two globals of ReactInstance's error family that the host leaves out (V2-D26). The native command files are tied to their public component in `nativeComponents`, and the
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

The map does not assign fixtures, polarity or tolerances: the fixture catalog does.

## Fixture catalog: polarity, tolerance and the pending ledger

[fixture-catalog-0.87.1.json](fixture-catalog-0.87.1.json) points rows of the map at the executable checks that already exist, says
what each check shows (its polarity), where it runs and, for layout, with what tolerance. It does not claim that every row has a
fixture, because it cannot yet: a hand-written positive and negative fixture for each of the 6,312 `1_0` rows is the work of the whole
1.0, spread over the GFs that own the rows. What the catalog and its gate give GF-01 is the mechanism and an honest ledger: every
target row without a fixture is listed under the GF that owns it, with a count, and the gate fails if the ledger and the fixtures
disagree. `npm run parity:coverage` prints, per GF, how many positive and negative fixtures are required, covered and pending, and
`node scripts/parity-coverage.mjs --check`, part of `npm run test:parity`, is the gate. Running the fixtures against the original RN
iOS and Android apps and Godot, and diffing their reports, is the separate `parity` checkpoint.

| Key | What it holds |
| --- | --- |
| `fixtures` | the entries below: a selector over rows, the fixture it points at, its polarity, `runsOn`, and for layout a `tolerance` |
| `negativeContracts` | selectors of the rows that have a refusal, an invalid-input or an upstream-unavailability contract, each with the reason (`why`) |
| `decided` | contracts that RN does not declare, so the inventory has no row for them, but that a recorded decision makes part of the 1.0; each becomes a row `decided:<name>` owned by a GF |
| `pending` | for each GF, the target rows that have no fixture yet, grouped by selector and counted |

**An entry** has an `id`, a `select`, a `fixture`, a `polarity`, `runsOn`, optional `note`, and, for a layout fixture, `layout: true` with
a `tolerance`. A selector is an object of matchers, ANDed, or a list of them, ORed, over the *resolved* row: `owner` (the GF of the map),
`kind`, `subject` (the API a row is about, as in the map), `name`, `scope`, `godot`, `ios` and `android` (the applicability statuses),
`godotReason`, and `id`. A matcher is a string, a list of strings or `{"pattern": "<regular expression>"}`, as in the map. A selector
may cover a family (`{"subject": "SwitchProps", "kind": "prop", "name": [...]}`) only when the fixture exercises it; where it does not,
the entry lists the rows. Only rows of scope `1_0` count; every name or id a selector lists has to pick a row.

**The fixture** is one of three references to something that already runs. The gate checks that it exists, statically; it does not run it.

| Reference | Points at | Checked as |
| --- | --- | --- |
| `{"case": "native-layout"}` | a case of [`tests/parity/cases.json`](../../tests/parity/cases.json), the shared protocol that Godot and the original RN iOS and Android apps all run | the case id exists; the rows must be ones the case names in `contracts`, and every contract a case names must be claimed by an entry that points at it, so the two files cannot drift apart |
| `{"file": "tests/x-probe.gd", "check": "..."}` | a named check of a native suite's probe or oracle (`check(condition, "case/sentence")`); a name that the probe builds from a prefix is referenced by the part that is written out | the text is inside a string literal of the file |
| `{"file": "tests/x-native.test.mjs", "test": "..."}` | a test of a native suite runner or a Node contract test | the name is the first argument of a `test()` or `it()` call |

The catalog carries polarity, `runsOn` and tolerance for all three kinds, so `tests/parity/cases.json` stays as it is: it is read by
the three runtimes and its hash is pinned in their reports.

**Polarity** says what the fixture shows, and what rows it may cover.

| Polarity | The fixture shows | May cover |
| --- | --- | --- |
| `positive` | the behavior works as upstream does (a prop that blocks interaction, such as `disabled`, is positive: blocking is its behavior) | rows where Godot is `applies` or `host-provides`, and, for each platform in `runsOn`, rows that apply there |
| `negative` | the outcome RN defines where the behavior is not the target or the input is invalid: a refusal, a diagnostic for invalid input, a documented no-op, or the upstream unavailability that a `not-applicable` reason names | any row |
| `host-provides` | the host installs the name (presence only) | rows where Godot is `host-provides` |

**What each row requires** is what makes a fixture missing. A `1_0` row whose Godot applicability is `applies` or `host-provides`
requires a positive fixture (a `host-provides` fixture counts for a `host-provides` row). A row requires a negative fixture when it is
picked by `negativeContracts`: the map's reasons that say the upstream unavailability is the contract (the iOS-only and Android-only
components and APIs of GF-24 and `StatusBar`), and the rows with a refusal or an invalid-input contract (`AppRegistry`'s headless-task
members, which throw a typed error on Godot by decision, and the arguments that RN's own JavaScript or its generated commands refuse).
A `decided` contract requires what it lists (`TextDecoder`, which stays absent for Hermes parity, requires a negative fixture). Other
`not-applicable` rows, `post_1_0` rows and `out` rows require nothing.

**Tolerance.** A layout fixture, one that compares measured geometry, says how far Godot and the reference may differ:
`"tolerance": {"unit": "dp" | "px", "absolute": <number, 0 or more>}`, with `layout: true`. The value is the one the fixture's own
check uses today (exact for the shared `native-layout` and `native-measure` cases, 1e-3 for the text lines, 5e-4 for layout
animation). Comparing a Godot report with the references' under that tolerance is the work of `parity`.

**The ledger.** `pending` is keyed by the GF that owns the rows; each item is `{"polarity", "select", "count"}` and may carry a `note`.
The `select` is checked among that GF's target rows only, and `count` has to be exactly the number of those rows that still miss that
polarity. `--print-pending` prints the ledger that the current fixtures imply, in the format of the file and without the notes.

**How a delivery adds coverage and shrinks the ledger.**

1. Add the entries for the fixtures the delivery lands, pointing at checks that exist (a suite's native test, a probe check, a case).
   A suite that is on another branch or an open pull request is not referenced from here: its rows stay pending, and the delivery
   that lands the suite adds its entries in the same change (for example the `TextDecoder` negative fixture, which waits for GF-05's
   encoding slice).
2. Run `node scripts/parity-coverage.mjs --check`. For every pending item the new entries touch it names the new count
   (`E_PENDING_COUNT`) or tells you to remove the item (`E_STALE_PENDING`). Edit the counts, or take the ledger from `--print-pending`.
3. A ledger only shrinks within a delivery. A gap is not added to make the gate pass; a row that enters the map (an RN upgrade, a
   new rule) enters the ledger of its owner in the change that adds it, and a reviewer sees it in the diff.

**The gate** (`--check`) fails with `E_MAP` when the map itself has problems; `E_SHAPE` when the catalog, an entry, a selector, a
`decided` item or a ledger item is malformed (an id used twice, an unknown polarity or platform, a `count` that is not a positive
integer); `E_UNKNOWN_OWNER` when a `decided` item or a ledger key is not a dashboard task; `E_FIXTURE` when a fixture reference does
not resolve (the case, the file, the check name, the test name); `E_DEAD_ENTRY` when an entry, a requirement or a ledger item picks no
row, and `E_DEAD_TERM` when a name or id it lists picks none; `E_POLARITY` and `E_RUNS_ON` when an entry covers rows its polarity or
its platforms do not mean; `E_CASE_CLAIM` when a case and the catalog disagree; `E_TOLERANCE` when a layout fixture has no tolerance,
a tolerance has no layout fixture, or the tolerance is malformed; `E_UNLEDGERED` when a target row misses a fixture and is not in the
ledger (reported per GF and polarity); `E_STALE_PENDING` when a ledger item has no uncovered row left; `E_PENDING_COUNT` when its count
is not the number of uncovered rows; and `E_PENDING_OVERLAP` when two items list the same row.

The seeds are what already runs, referenced conservatively: the shared differential cases, the per-GF native suites (Switch,
ActivityIndicator, touchables, Text, AppState, Appearance, accessibility, device services, OS contracts, networking, WebSocket, Animated,
LayoutAnimation, ScrollView, lists, Modal, PanResponder, Image, click, focus) and the 0.5 prop policy. A suite counts only for the rows it
exercises and asserts. Most rows are still pending, and each belongs to a GF whose delivery has to cover it.

### History of the ledger

Each delivery that adds entries is listed here with what it did to the counts (required fixtures covered, of the required ones).

| Delivery | Entries added | Covered after |
| --- | --- | --- |
| S3 (#164) | the seed above | 369 of 5,732: positive 313 of 5,246, negative 56 of 486 |
| The suites merged after the seed | `test:js-globals` (GF-05 slice B, #161), `test:js-errors` (GF-05 slice C, #163) and `test:app-registry` (GF-07 slice 1, #160) | 448 of 5,730: positive 388 of 5,244, negative 60 of 486 |

The second delivery moved GF-05's positive pending from 114 to 80 and GF-07's from 35 to 12, and took GF-07's four headless-task
negatives from pending to covered. Rows that those suites assert but another GF owns left that GF's ledger too: the 14 DOM globals
that `setUpDOM` installs (12 rows of GF-08, 3 of GF-13), `RN$isNativeEventTargetEventDispatchingEnabled` (GF-13) and `__DEV__` (2 rows
of GF-29). The host leaves `RN$hasHandledFatalException` and `RN$notifyOfFatalException` out by V2-D26, so the runtime keeps running
after an uncaught error and GF-07's error-cleanup slice owns any change; the same delivery overrides both rows to `not-applicable` on
Godot in the map (which removes two required positives: GF-05's went from 130 to 128, and its pending from 80 to 78) and covers their
absence with a negative entry. What stays pending on purpose: the type rows; the Performance classes, which the suite does not certify;
and `RN$AppRegistry`, through which the roots mount but which no check names.
