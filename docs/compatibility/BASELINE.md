# Measurable React Native parity

The baseline is React Native **0.87.1**, React **19.2.3**, Hermes
**250829098.0.17** and official Godot **4.7.2**. Native Godot delivery remains
macOS arm64. The original iOS/Android apps below are reference renderers for
comparison; they do not certify Godot Fabric builds on those operating systems.

## Contract inventory

`npm run parity:inventory` resolves the upstream strict generated declarations
with TypeScript 6.0.3, ESNext and React types, without browser DOM or Node global
merging. The [generated inventory](contracts-0.87.1.json) contains
stable IDs, signatures, owning types and hashes of the resolved RN source files.
`npm run parity:inventory -- --check` rejects drift without rewriting that file.
This check runs in the normal contract gate.

| Declaration category | Rows |
| --- | ---: |
| Public runtime values | 97 |
| Public type exports | 236 |
| Props | 1,934 |
| Events | 1,165 |
| Styles | 405 |
| Public instance/ref members | 1,027 |
| API members | 342 |
| Other type members | 2,556 |
| Explicit RN global values / types / members | 32 / 54 / 265 |
| Total | 8,113 |

Rows count declarations in their owning contexts. An inherited property can
occur in several components; these are not 8,113 independent behaviors.
Signatures retain nested types and overloads, but member expansion is immediate,
not recursive. Private deep imports, undocumented globals, every possible
value/combination and RN's entire transitive dependency API are outside this
inventory. Its presence is not a compatibility score.

`npm run parity:status` generates `build/parity-status.json`. The current facade
has **17 exported names awaiting differential certification, 11 explicit
placeholders, and 69 missing public names** after adding Button/public TextInput.
This describes source presence. The [public form evidence](../evidence/public-controls/README.md)
is a Godot acceptance fixture; it does not add mobile differential coverage. The board separately identifies native
reports as `not_run`, `invalid_or_stale`, or `passed_subset`.

## Original native oracle

The same [core-ui-v2 fixture](../../tests/parity/fixture.jsx) is bundled into
Godot and copied verbatim into a checksum-pinned official RN community template.
The reference app uses the original RN Fabric renderer, Hermes, native UIKit or
Android views, and Metro in Release configuration. It never imports the Godot
facade, platform aliases or a mocked native renderer.

The original nine UI cases exercise actual native layout and asynchronous measurement,
automatic batching, keyed reorder with changed native positions and retained
refs, memo, Context, external-store snapshots, transition commits, and effect /
subscription cleanup. Their [catalog](../../tests/parity/cases.json) names the
specific RN declarations exercised. A passing width example certifies that
example, not every width value or the whole View API.
Four new runtime cases cover timer arguments/coercion/cancellation, interval
arguments and self-cancellation, microtask/immediate ordering, and monotonic
cancellable frames. The identical [runtime module](../../tests/parity/runtime.js)
is copied alongside the JSX into both original native reference apps. Version
`core-ui-v2` and its extra source hash reject historical nine-case reports.
The 13-case fixture passed locally in Godot and in the hosted three-way
comparison with original RN iOS/Android. See the versioned run, source hashes
and bounded scope in [runtime evidence](../evidence/runtime/README.md).

The fixture uses an eight-unit layout grid and reports the observed geometry,
commit values, row renders and cleanup order. The protocol requires exact
agreement for those controlled observations; arbitrary densities and fractional
layout rounding require additional fixtures.

```sh
npm run setup
npm run parity:godot                 # native headless layout/event path
npm run parity:godot -- --headed     # native window
npm run parity:ios                   # Xcode, iPhone simulator and pod required
RN_ANDROID_SERIAL=emulator-5554 npm run parity:android
npm run parity:compare               # requires BOTH iOS and Android reports
npm run parity:compare -- --reference ios  # explicitly narrower comparison
npm run parity:status
```

iOS needs Xcode, an installed iPhone simulator, and CocoaPods 1.16.2; Ruby 3.4.11
was used locally. Set `RN_SIMULATOR_UDID` to select a simulator. Otherwise the
runner chooses a shutdown simulator and shuts it down after the test.
Cold simulator boot/data migration has a five-minute deadline; after launching
the app, a valid native completion report is still required within one minute.
Shutdown of a simulator booted by the runner has a two-minute deadline. Cleanup
failure still invalidates/removes the report and fails the job.
Android needs JDK 17, SDK platform 37.0 / build-tools 37, NDK 27.1.12297006 and a running
emulator. The default ABI is x86_64; set `RN_ANDROID_ABI` for another ABI.
`--prepare-only` prepares/builds the reference without certifying a runtime run.
Downloaded projects, libraries, derived build data and raw logs stay in ignored
`.deps/` and `build/`. The disposable app uses `org.godotfabric.parity` and a
localhost report collector. Other installed applications are not removed.

The comparison rejects missing/duplicated cases, failed assertions, a non-native
renderer, different versions and stale fixture/catalog/upstream and runtime-module hashes. Failed
runs remove prior report output. Unit fixtures verify these rejection paths;
they are separate from native evidence. Retained local and CI proof is listed
in the [evidence record](../evidence/parity/README.md).

CI has distinct Linux source contracts, uncached macOS Godot startup, original
iOS reference, original Android reference, and a final comparison that requires
all three native reports. A failed reference prevents the comparison from
passing. No job converts missing native coverage into a mock or skipped success.

## Checkpoint and remaining work

This is the first GF-01/GF-02 delivery from the
[parity roadmap proposal](https://github.com/journey-studios/godot-fabric/pull/3).

- **GF-02:** startup preparation and two fresh import/runtime regressions are
  implemented and passed in the uncached native CI lane alongside the original
  mobile reference comparison. Direct import after deleting `.godot` still
  bypasses the
  [documented engine containment](../evidence/cold-start.md).
- **GF-01:** the inventory, drift gate, status board and original-native oracle
  are implemented. Behavioral certification remains in progress: core-ui-v2
  covers thirteen cases, not the whole inventory.

Next differential fixtures should cover public facade/types first, then runtime
globals and metrics, followed by editing/selection, pointer/responder ordering,
scroll commands and list virtualization. Existing Suspense/error-boundary and
other Godot acceptance tests still need original-native comparisons. System
IME, accessibility, dev StrictMode, native modules, portals, scheduler ordering,
animations and platform-specific APIs also remain open. Add explicit cases and
evidence for each contract instead of promoting source presence to full parity.
