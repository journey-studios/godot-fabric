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

`npm run parity:status` generates `build/parity-status.json`. On 2026-10-08 the
current facade has **56 exported names awaiting differential certification, 3
explicit placeholders and 38 missing public names** of the 97 root values, against
44, 5 and 48 on 2026-10-07 (the Image slice exported AssetRegistry and took Image and
ImageBackground out of the placeholders, and nine OS-specific names were added: ToastAndroid,
PermissionsAndroid, DynamicColorIOS, ActionSheetIOS, ProgressBarAndroid, DrawerLayoutAndroid,
InputAccessoryView, PushNotificationIOS and TouchableNativeFeedback), 39, 5 and 53 on 2026-10-06
(Linking, Clipboard and Vibration were added, and so were Modal and SafeAreaView) and 17, 11 and 69
after adding Button/public TextInput (2026-10-02). The three
placeholders are KeyboardAvoidingView, RefreshControl and
StatusBar. This describes source presence: the board counts the export forms the
facade uses (`export { x }`, `export { default as x }`, `export * as x` and exported
functions, classes and constants). The
[public form evidence](../evidence/public-controls/README.md) is a Godot acceptance
fixture; it does not add mobile differential coverage, and neither do the slices
listed below. The board separately identifies native reports as `not_run`,
`invalid_or_stale`, or `passed_subset`.

## Godot evidence since Button and TextInput

Each row is a facade area that gained Godot acceptance on macOS arm64 after the
public Button/TextInput checkpoint: the names it exercises, its retained record and
the hosted CI run that repeated the slice's headless checks (the receipt linked in
each record). Every slice has retained negative controls, most with an independent
oracle. None is an original-native iOS/Android differential (the thirteen
core-ui-v2 cases remain the only one), none changes the `exported_unverified` status
above, and none completes a GF item: the [dashboard](../../dashboard/README.md) keeps
the first-slice checkpoints they closed. The counts are the headless checks of each
slice's own suite, not a coverage percentage.

| Area | Facade names | Record | Headless checks and controls | Hosted CI |
| --- | --- | --- | --- | --- |
| Application state | `AppState` | [AppState](../evidence/app-state/README.md) | 75; the preceding host fails exactly 62, and a host whose focus outranks the pause fails 5 | run 37382633328 ([receipt](../evidence/app-state/hosted-ci.json)) |
| System theme | `Appearance`, `useColorScheme` | [Appearance](../evidence/appearance/README.md) | 79; the preceding host fails exactly 56, the host from before the shared callback 9 | run 37408741652 ([receipt](../evidence/appearance/hosted-ci.json)) |
| Gestures | `PanResponder` | [PanResponder](../evidence/pan-responder/README.md) | 128 in four flag lanes; a PanResponder without capture-phase handlers fails 6 | run 37385104730 ([receipt](../evidence/pan-responder/hosted-ci.json)) |
| Responder transport | none new; every touch component | [Shared touches](../evidence/shared-touches/README.md) | 92 in four flag lanes; the preceding host fails exactly 9 | run 37392899167 ([receipt](../evidence/shared-touches/hosted-ci.json)) |
| Pointer capture | View pointer props and ref methods; Document listeners | [Capture notifications](../evidence/pointer-capture-notifications/README.md) | 672 in eight lanes; two retained sabotages fail 12 or 13 and 33 | run 37396999119 ([receipt](../evidence/pointer-capture-notifications/hosted-ci.json)) |
| Pointer events, View (public flags off) | View pointer props and ref listeners | [Up](../evidence/pointer-up/README.md), [move](../evidence/pointer-move/README.md), [hover](../evidence/pointer-hover/README.md), [root path](../evidence/pointer-root-path/README.md) and [click](../evidence/pointer-click/README.md), after the interest and fault records of the [evidence index](../evidence/README.md) | 62, 219, 158, 82 and 728; the preceding host fails exactly 8, 45, 32, 9 (and crashes on the Document case) and 31 | runs 37241023275 ([receipt](../evidence/pointer-up/hosted-ci.json)), 37345287351 ([receipt](../evidence/pointer-move/hosted-ci.json)), 37352693788 ([receipt](../evidence/pointer-hover/hosted-ci.json)), 37359026197 ([receipt](../evidence/pointer-root-path/hosted-ci.json)) and 37375758262 ([receipt](../evidence/pointer-click/hosted-ci.json)) |
| Pointer events, Document (public flags off) | Document and documentElement listeners | [Up](../evidence/pointer-document-up/README.md), [move](../evidence/pointer-document-move/README.md) and [hover](../evidence/pointer-document-hover/README.md), and the Up follow-ups of the [evidence index](../evidence/README.md) | 1,371 (up to 6,451 in the Up follow-ups), 1,932 and 1,530 over eight original/current lanes | runs 37244296477 ([receipt](../evidence/pointer-document-up/hosted-ci.json)), 37351245158 ([receipt](../evidence/pointer-document-move/hosted-ci.json)) and 37364101069 ([receipt](../evidence/pointer-document-hover/hosted-ci.json)) |
| Switch | `Switch` | [Switch](../evidence/switch/README.md) | 108; the preceding host fails exactly 2, a sabotaged `setValue` 13 | run 37390584578 ([receipt](../evidence/switch/hosted-ci.json)) |
| Activity indicator | `ActivityIndicator` | [ActivityIndicator](../evidence/activity-indicator/README.md) | 33; the preceding host fails exactly 2, a sabotage of the per-frame work 9 | run 37395264445 ([receipt](../evidence/activity-indicator/hosted-ci.json)) |
| Accessibility | none new (`AccessibilityInfo` stays an environment subset); accessibility props of `View`, `Pressable` and `TouchableOpacity` | [Accessibility](../evidence/accessibility/README.md) | 80 headless checks that prove metadata only, and 22 against the real NSAccessibility tree on a graphical macOS run (local, not hosted); the preceding host fails exactly 10 and 5, four retained sabotages are rejected | pending |
| Touchables | `TouchableWithoutFeedback`, `TouchableHighlight` (`TouchableOpacity` is in the next area) | [Touchables](../evidence/touchables/README.md) | 93 and an animated lane; the preceding SDK fails exactly 19, an imitation over Pressable 42 | run 37394073082 ([receipt](../evidence/touchables/hosted-ci.json)) |
| Lists | `FlatList`, `SectionList`, `VirtualizedList`, `VirtualizedSectionList` | [Virtualized lists](../evidence/virtualized-list/README.md) | 44; the preceding host fails exactly 3, the preceding SDK 11, a ScrollView without `onLayout` 3 | run 37401008543 ([receipt](../evidence/virtualized-list/hosted-ci.json)) |
| Animation | `Animated`, `Easing`, `useAnimatedValue`, `useAnimatedValueXY`, `TouchableOpacity` | [Animated](../evidence/native-animated/README.md) | 75, recomputed by an independent oracle; the preceding host fails exactly 59 | run 37439650201, second attempt ([receipt](../evidence/native-animated/hosted-ci.json)) |
| Transforms | View `transform`: uniform `scale` | [Uniform scale](../evidence/uniform-scale/README.md) | 29, or 35 with the capture; the preceding host fails exactly 22 | run 37455258901 ([receipt](../evidence/uniform-scale/hosted-ci.json)) |
| Transforms | View `transform`: singular matrices and `scale: 0` | [Singular transforms](../evidence/singular-transforms/README.md) | 49, or 58 with the capture; the preceding host fails exactly 37, a sabotage of the pointer projection 2 | run 37499277022 ([receipt](../evidence/singular-transforms/hosted-ci.json)) |
| Frame pacing | `requestAnimationFrame` and RN's Native Animated frames | [Frame clock](../evidence/frame-clock/README.md) | 37 over eight loop paces; the preceding host fails exactly 29, three retained sabotages each fail at least one | run 37538167415 ([receipt](../evidence/frame-clock/hosted-ci.json)) |
| Text layout | `Text`: `onTextLayout` and the Yoga baseline of a Text (the facade name stays `implemented_subset`) | [Text layout](../evidence/text-layout/README.md) ([research](../research/text-layout.md)) | 76 against the font tables of the two bundled families, with an independent oracle; the preceding host fails exactly 5, three retained sabotages 4, 3 and 9 | pending (the new step has not run on a hosted runner) |
| Text original | `Text`: RN's original `Text.js` and press on the outer paragraph (the facade name stays `implemented_subset`) | [Research](../research/text-original.md); the evidence record comes with the commit | 113 with a real mouse and touch and an independent oracle; the SDK and host of main before the slice fail exactly 62, the same bundle on that host alone 3, six retained sabotages are rejected | pending (the new step has not run on a hosted runner) |
| Runtime globals | none: `fetch`, `XMLHttpRequest`, `FormData`, `Blob`, `File`, `FileReader`, `URL`, `URLSearchParams`, `AbortController` and `AbortSignal` are globals, not names of the root (`Networking` stays missing) | [Networking](../evidence/networking/README.md) | 100 against a local server over HTTP and HTTPS, with an independent oracle; the preceding host fails exactly 84, two retained sabotages 8 and 2 | pending |
| Runtime globals | none: `WebSocket` is a global, not a name of the root | [WebSocket](../evidence/websocket/README.md) | 93 against a local RFC 6455 server over ws and wss, with an independent oracle that checks the server's frame log; the preceding host fails exactly 81, two retained sabotages 4 and 2 | pending |
| Device services | `Linking`, `Clipboard`, `Vibration` | [Device services](../evidence/device-services/README.md) | 65 in two applications (the validation backend and Godot's real one) and 2 in a launch without `--uri=`, with an independent oracle; the preceding host fails exactly 52 and 1, two retained sabotages are rejected by the probe and the oracle | pending |
| OS-specific contracts | `ToastAndroid`, `PermissionsAndroid`, `DynamicColorIOS`, `ActionSheetIOS`, `ProgressBarAndroid`, `DrawerLayoutAndroid`, `InputAccessoryView`, `PushNotificationIOS`, `TouchableNativeFeedback` (`StatusBar` stays a placeholder) | [OS-specific contracts](../evidence/os-contracts/README.md) ([research](../research/os-contracts.md)) | 37 in two applications with the real host registry and an independent oracle that reads every text, key and count from the pinned RN sources; the previous SDK fails exactly 30 (this slice has no native code, so the SDK is its control), three retained sabotages fail 14, 8 and 5 | pending |

The two Runtime globals rows are not facade areas: RN installs those names as globals, so
they do not move the counts above, and the root's `Networking` export is still missing. The
Device services row is: it exported `Linking`, `Clipboard` and `Vibration`, which moved the
counts from 39 and 53 to 42 and 50 before the Modal slice added `Modal` and `SafeAreaView`
(44 and 48), the Image slice moved them to 47 and 47, and the OS-specific contracts row exported
nine names, which moved them to 56 and 38. That row reproduces RN's own unavailability on a platform that is neither iOS nor Android:
`'denied'` and `false` from `PermissionsAndroid` mean unavailable on Godot, and no
Android or iOS behavior is certified. Their hosted CI runs are pending.

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
  The 2026-10-02 follow-up aligns the extension minimum with the tested 4.7.2
  runtime, checks the engine before setup downloads and covers failure cleanup
  and stale-report rejection. The upstream editor crash remains open.
- **GF-01:** the inventory, drift gate, status board and original-native oracle
  are implemented. Behavioral certification remains in progress: core-ui-v2
  covers thirteen cases, not the whole inventory.

Next differential fixtures should cover public facade/types first, then runtime
globals and metrics, followed by editing/selection, pointer/responder ordering,
scroll commands and list virtualization. Existing Suspense/error-boundary and
other Godot acceptance tests still need original-native comparisons, and so do the
slices in the table above: pointer and responder ordering, lists and animation have
Godot acceptance now and no iOS/Android differential case yet. System
IME, accessibility, dev StrictMode, native modules, portals, scheduler ordering,
platform-specific APIs and animation beyond that acceptance also remain open. Add
explicit cases and evidence for each contract instead of promoting source presence
to full parity.
