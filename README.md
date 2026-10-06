# Godot Fabric

**Build native Godot UIs with React.** An experimental renderer powered by
React Native Fabric, Hermes and Yoga, delivered as a Godot GDExtension.

React runs inside Godot. JSX, hooks and reconciliation produce real Godot
Controls through the original Fabric mounting pipeline. The official Godot
engine does not need rebuilding.

![Public TSX form rendered by Godot](docs/evidence/public-controls/form-initial.png)

## Status

This is an experimental platform implementation. Native setup and rendering
are validated on **macOS arm64 with official Godot 4.7.2**. An experimental
[iOS build/export path](docs/IOS_BUILD.md) has arm64 device export/link proof and
22 runtime checks in an x86_64/Rosetta simulator. Arm64 simulator and physical
device runtime acceptance remain pending. Linux, Windows, Android
and Web do not yet have supported build paths.

Setup and the check runner prepare Godot's extension startup list before the
first import. This avoids a Godot 4.7.2 editor crash when an import-only scan
discovers extension classes late. Resources are still imported from scratch;
failures are reported without retries. See the [cold-start evidence](docs/evidence/cold-start.md).

Supported, within the documented subset: React 19 hooks and concurrent roots,
public View, Text, Pressable, ScrollView, Button and single-line TextInput,
NativeWind styles, nested rich text and a limited SVG adapter exercised by
React Native Chart Kit. The [TSX form](examples/form/README.md) uses the narrowed
public types and native editing/activation. Mobile keyboard/IME contracts and
complete React Native props remain open.

The [View geometry example](examples/view/README.md) exercises original public
View/Fabric ordering, rectangular overflow and four solid border colors through
real input targets and renderer pixels. The later
[coordinate example](examples/coordinates/README.md) fixes the offset-root
input/measurement disagreement and exercises genuine move-out/return gestures,
Godot surface scaling and raw window input at content density two. Its
[evidence](docs/evidence/coordinates/README.md) keeps the failing prior-host and
first-event density controls separate from the verified implementation.

The [transform gallery](examples/transforms/README.md) adds original RN 2D
transform order, percentage translation/origins, reflection, shear and nested
bounds. Painting and input use the same Godot Control. Its
[evidence](docs/evidence/transforms/README.md) records 309 headless and 345 native
assertions, 33 pixel samples, stable refs/state across flattening and six
explicit rejection cases. A separate input guard cancels held contacts when an
external Godot embedding becomes non-invertible, preserving the last valid
coordinates. Singular, 3D and out-of-range JSX transforms remain unsupported.

The [read-only tree example](examples/tree/README.md) exercises original RN
documents, ID lookup, logical traversal and collection snapshots across two
roots. It preserves element refs during keyed reorder and records the pinned
RawText replacement and imperative-ID behavior. Its
[evidence](docs/evidence/tree/README.md) retains 89 headless / 99 native checks,
eight pixel samples and the failing previous-configuration control.

Public TextInput focus uses original RN TextInput.State and native Fabric
commands. The [focus example](examples/focus/README.md) compares that singleton
with real Godot Controls across callbacks, editability changes and root
retirement. Its [evidence](docs/evidence/focus/README.md) records 175 headless /
189 native checks, two captures and controls that fail with the preceding host
or missing eligibility guards. Keyboard/IME and multiline remain open.

![Original RN focus preserved after callback ref replacement](docs/evidence/focus/focus-updated.png)

The [pointer example](examples/pointers/README.md) brings real Godot input to
original RN pointer events and public View capture refs. Its
[evidence](docs/evidence/pointers/README.md) records 132 headless /146 native
checks, 12 pixels, selective multi-root lifetime, 144 native assertions and
43 original JSX exception/stop checks. Two original-source controls reproduce
crashes fixed by the generated native lifetime overlay. Hardware, EventTarget
and complete mobile acceptance remain open.

![Original React View capture roots after a key replacement](docs/evidence/pointers/pointers-updated.png)

The [captured geometry example](examples/pointer-geometry/README.md) keeps
client/page coordinates in the physical origin root and projects offsets into
each actual target, including transformed targets in another embedded root and
flattened logical refs. [Its evidence](docs/evidence/pointer-geometry/README.md)
records 631/648 headless/native checks, a failing previous-host control,
14 pixels and three captures. Singular cancellation and connected hidden
capture have explicit contracts. This fixes a documented limitation of the
pinned RN offset algorithm; complete differential parity remains open.

![Captured targets after React transform updates](docs/evidence/pointer-geometry/pointer-geometry-updated.png)

The isolated [native EventTarget example](examples/event-target/README.md)
connects the original dispatcher to the renderer's existing batch. A native
touch delivers to a listener with no JSX helper; JSX and imperative listeners
commit both React updates together. Its [evidence](docs/evidence/event-dispatch-integrated/README.md)
also records corrected native cancellation/teardown defects. Public flags remain
disabled; complete event parity remains open.

![One native gesture commits two React updates in the first root](docs/evidence/event-dispatch-integrated/updated.png)

The separate [pointer-interest example](examples/pointer-interest/README.md)
reads original RN listener maps so imperative-only View `pointerdown` listeners
qualify native emission in an internal opt-in. Capture/bubble, once, abort,
removal and flattened ancestry retain original listener behavior. Its
[evidence](docs/evidence/pointer-interest/README.md) records 193 original / 230
current headless checks and 260 current viewport checks with two real captures.
That pinned snapshot leaves Document-only interest open. The later root probe
below extends it; other pointer categories, hardware/mobile and public flag
enablement remain open. The default helper still installs no query.


The [query-fault example](examples/pointer-query-fault/README.md) exercises a
failed native interest lookup without losing the same batch's TouchStart or
React update. The identical previous-host fixture has 12 normative failures;
the corrected host passes 186 headless and 204 viewport checks while retaining
four deliberate diagnostics. [Evidence and boundaries](docs/evidence/pointer-query-faults/README.md)
separate lookup recovery, contact cleanup and remaining getter/reentrancy gaps.

The [Document/root example](examples/pointer-document/README.md) lets original
Document and documentElement listeners qualify descendant native `pointerdown`.
The SDK reads their existing RN listener Maps through the actual current root
handle, preserving original flags, callbacks and React batching. Each flag
combination has an independent Hermes runtime. [Its evidence](docs/evidence/pointer-documents/README.md)
separates the original SDK, the previous native host and the corrected host.
Public flags remain disabled; arbitrary getter/reentrant faults and complete
pointer/responder contracts remain open.

The [ref-getter example](examples/pointer-resolver-fault/README.md) isolates a
throwing `canonical.publicInstance` getter before the SDK interest query. The
previous host loses three same-batch TouchStart/Raw/React outcomes; the corrected
host passes 65 headless and 85 viewport checks, including actual counter updates.
[Its evidence](docs/evidence/pointer-resolver-faults/README.md) separates the
executed one-shot getter from broader resolver/reentrancy and mobile gaps.
Public flags remain off; [its hosted CI](docs/evidence/pointer-resolver-faults/hosted-ci.json)
passed five jobs, including the independently audited 65-check getter artifact.

![A's React TouchStart update survives a ref getter failure](docs/evidence/pointer-resolver-faults/updated.png)

The isolated [pointerup example](examples/pointer-up/README.md) extends native
interest to original View Up listener Maps. Bubble and capture-only listeners
receive one trusted event without a JSX pointer helper, while original
TouchEnd/Raw and terminal cleanup remain intact. Its
[evidence](docs/evidence/pointer-up/README.md) records 62 headless / 90 viewport
checks, 24 actual pixels and the preceding host's eight failures with the same
current SDK bundle. Public flags remain off; Document Up, other flag branches
and broader event/lifecycle acceptance are open. All 16 proportional regression
commands and fresh SDK pack/verify passed; its hosted CI is verified in
[run 37241023275](docs/evidence/pointer-up/hosted-ci.json).

A one-shot throw or non-boolean result in the native interest query for that View
ref, at the Up offsets, rejects only that lookup with one retained
`E_POINTER_LISTENER_QUERY`: a capture listener on the same View still qualifies
after a bubble fault, and an unqualified View hands the lookup to its ancestors and
root, while the original TouchEnd and contact cleanup survive. The faults run in a
second application, so the healthy probe stays diagnostic-free: 240 headless and
268 graphical checks, with the preceding-host controls refreshed.
[Evidence and limits](docs/evidence/pointer-up-faults/README.md). When the native
lookup cannot even resolve the View's public ref (a one-shot getter on
`canonical.publicInstance`), that lookup fails before the SDK with the same single
diagnostic, and the next lookup proceeds normally.
[Resolver evidence](docs/evidence/pointer-up-resolver-faults/README.md). Both fault
slices passed hosted CI with the same check IDs and bundles
([component](docs/evidence/pointer-up-faults/hosted-ci.json),
[resolver](docs/evidence/pointer-up-resolver-faults/hosted-ci.json)).

The isolated [pointermove example](examples/pointer-move/README.md) extends the
same native interest to original View Move Maps. Real drags and button-less mouse
motion reach listeners on the target and on its parent as trusted moves, one React
commit each, at the Default priority that RN's pinned mapping gives unique
Continuous moves; a View without Move listeners still gets its original TouchMove.
Its [evidence](docs/evidence/pointer-move/README.md) records 219 headless / 243
viewport checks, 20 actual pixels and the preceding host's 45 failures with the
same SDK bundle. A failing Move lookup is retained once per distinct cause and its
repeats are counted, so hover cannot flood diagnostics. Hover events and pointer
capture remain open. Hosted CI repeated the 219 headless checks with the same IDs
and bundle ([receipt](docs/evidence/pointer-move/hosted-ci.json)).

The [Document pointermove example](examples/pointer-document-move/README.md)
certifies original Document and documentElement Move listeners in eight
original/current × flag lanes: 1,932 headless checks and 330 viewport checks.
Only the installed current query delivers, at phase 1 for capture and 3 for
bubble, and a retained control that drops the owner Document fails. Hosted CI
repeated the 1,932 headless checks
([receipt](docs/evidence/pointer-document-move/hosted-ci.json)).
[Evidence](docs/evidence/pointer-document-move/README.md).

The [hover example](examples/pointer-hover/README.md) lets original View
`pointerover/out/enter/leave` listeners qualify real mouse and touch hover in RN's
order, phases and Discrete priority, with enter/leave's non-bubbling rule intact:
158 headless checks and 32 old-host failures. Hosted CI repeated the 158 checks
([receipt](docs/evidence/pointer-hover/hosted-ci.json)).
[Evidence](docs/evidence/pointer-hover/README.md).

The [root-path example](examples/pointer-root-path/README.md) resolves an empty
point inside a surface to the root view, as RN does, so the root stays in the
hover path between a view and the empty area, and never makes the root an event
target. That removes a crash of the preceding host with a Document capture
`pointerenter`/`pointerleave` listener: 82 headless checks, and the same bundle
fails 9 checks and crashes on the preceding host. Hosted CI repeated the 82
checks ([receipt](docs/evidence/pointer-root-path/hosted-ci.json)).
[Evidence](docs/evidence/pointer-root-path/README.md).

The [Document hover example](examples/pointer-document-hover/README.md)
certifies original Document and documentElement hover listeners in eight
original/current × flag lanes: 1,530 headless checks. Over/out reach them at
phases 1 and 3; enter/leave reach only capture listeners, when the pointer enters
or leaves the surface; a retained control that ignores the owner Document fails.
Hosted CI repeated the 1,530 checks ([receipt](docs/evidence/pointer-document-hover/hosted-ci.json)).
[Evidence](docs/evidence/pointer-document-hover/README.md).

The [click example](examples/pointer-click/README.md) certifies `click` on a
primary release, targeted at the deepest view the press and the release share,
and the ScrollView drag that cancels its contact, in eight lanes: 728 headless
checks. The preceding host fails exactly 31 of them. Hosted CI repeated the 728
checks ([receipt](docs/evidence/pointer-click/hosted-ci.json)).
[Evidence](docs/evidence/pointer-click/README.md).

The [PanResponder example](examples/pan-responder/README.md) runs RN's original
`PanResponder` on actual Godot touches and mouse drags, including two-finger
gestures, parent claims, refused termination and removal mid-gesture, in four
flag lanes: 128 headless checks, repeated by hosted CI
([receipt](docs/evidence/pan-responder/hosted-ci.json)). [Evidence](docs/evidence/pan-responder/README.md).

The [AppState example](examples/app-state/README.md) runs React Native's original
`AppState` from the public import, fed by the focus, pause and memory-warning
notifications Godot delivers to the `FabricApplication`, with two roots sharing
one state: 75 headless checks. The preceding host fails exactly its 62
lifecycle checks. Hosted CI repeated the 75 checks
([receipt](docs/evidence/app-state/hosted-ci.json)). [Evidence](docs/evidence/app-state/README.md).

The [shared touches example](examples/shared-touches/README.md) presses two
roots of one application at the same time: every TouchEvent lists the whole
application's touches, as RN's one JS responder expects, so a touch ending in
one root no longer releases a press held in another while that press's own
touch is down; a canceled touch still terminates the one responder, as on one RN
surface. 92 headless checks in four flag lanes; the preceding host fails exactly
9. [Evidence](docs/evidence/shared-touches/README.md).

The [Switch example](examples/switch/README.md) renders RN's original `Switch.js`
over RN's shared iOS/macOS Switch descriptor and a native Godot switch: actual
mouse clicks and touch taps toggle it, `onChange`/`onValueChange` follow RN's
order, and Switch.js's `setValue` restores a value prop that does not change.
108 headless checks in two roots; the preceding host fails the 2 mount checks.
[Evidence](docs/evidence/switch/README.md).

This does not promise compatibility with every React Native library.
[API and limitations](docs/API.md) define the supported contracts.
The [parity baseline](docs/compatibility/BASELINE.md) inventories the remaining
public contracts and compares a shared fixture against original native RN.

The [1.0 roadmap](ROADMAP.md) maps priorities, dependencies and acceptance
criteria for RN parity across macOS, Linux, Windows, Android and iOS. The
[dated parity audit](docs/PARITY.md) separates implemented behavior, incomplete
contracts and missing APIs against React Native 0.87.1.

The [native foundation checkpoint](docs/evidence/native-foundation/README.md)
exercises original RN refs, Fabric prop commits and JSI TurboModules. The
[refs example](examples/refs/README.md) measures scaled and rotated Godot
surfaces, then replaces a child and unmounts one root while retaining refs.
The [metrics example](examples/metrics/README.md) exercises original RN
Dimensions/PixelRatio, live resize and Yoga rounding with Godot content scale.

![Original RN refs in transformed Godot surfaces](docs/evidence/native-foundation/refs-initial.png)

![RN window metrics at Godot content scale 2](docs/evidence/native-foundation/metrics-scaled.png)

## Migration dashboard

Track the complete roadmap, Architecture 2.0 sequence, verified checkpoints,
dependencies and release acceptance in a local dashboard rendered from JSON:

```sh
npm run dashboard   # http://127.0.0.1:4317; no npm install or native setup needed
```

The panel refreshes when `dashboard/migration.json` changes. See the
[dashboard guide](dashboard/README.md) for progress rules and worktree support,
and the [implementation-thread prompt](dashboard/AGENT_PROMPT.md) to keep it updated.

## Independent Godot project

The [provisioned addon prototype](sdk/README.md) supplies the native runtime,
compatible React/RN, narrowed types and private build tools. After a platform
developer provisions it, the basic consumer opens `project.godot`, edits its
own TSX and presses Play; global Node is not required and Play never installs
dependencies. Additional libraries and the lockfile remain project-owned.

![Independent consumer: native input and Godot props update React](docs/evidence/consumer/updated.png)

The [consumer guide](consumers/minimal/README.md) shows the application Resource,
scene nodes and registered roots. The [evidence](docs/evidence/consumer/README.md)
records the original 2B checkpoint. The later
[game-services evidence](docs/evidence/game-services/README.md) extends it to
18 build/ownership checks, 40 headless and 43 graphical assertions, including
offline builds, typed Godot operations, inventory-only resize and explicit errors. Provisioning is
currently from source on macOS arm64; public prebuilt artifacts, complete
exports and development tools remain open.

## Run the SDK laboratory

Requirements: macOS arm64, Node 22.13+, npm, Python 3.12+, Xcode Command Line Tools,
and [official Godot 4.7.2](https://github.com/godotengine/godot-builds/releases/tag/4.7.2-stable).

```sh
git clone https://github.com/journey-studios/godot-fabric.git
cd godot-fabric
npm run setup
npm run examples:list
npm run example -- counter
```

Set `GODOT_BIN` to the official engine executable if it is outside
`/Applications/Godot.app`. Setup validates the pinned stable engine before any
downloads or build output. The engine version and CI download checksum live in
[`dependencies.json`](dependencies.json); the extension declares 4.7.2 as its
minimum supported runtime. Setup downloads checksum-pinned native dependencies,
installs the npm lockfile, bundles JSX and compiles the GDExtension.
CMake lives in a local virtual environment; Godot itself is not recompiled.

```sh
npm run example -- form     # public typed Button/TextInput form
npm run example -- view     # public View stacking, overflow and four border colors
npm run example -- coordinates # root/local/screen points and real movement gestures
npm run example -- transforms # original RN affine styles, refs and transformed input
npm run example -- shared   # two registered roots in one Hermes application
npm run example -- refs     # original RN refs and transformed window geometry
npm run example -- pointers # original pointer input and public View capture
npm run example -- pointer-geometry # transformed, cross-root and logical capture
npm run example -- tree     # native IDs, original documents and logical traversal
npm run example -- services # typed Godot calls, signals and shared Zustand data
npm start -- --nativewind   # reactive utility classes and manual theme
npm start -- --chart        # original React Native Chart Kit
npm start -- --scroll       # generic scroll, filtering and editing demo
npm start                  # React state, keys, Suspense and error boundaries
npm run bundle             # rebuild after JSX/style changes
npm run setup              # rebuild after native C++ changes
npm run test:modules       # original JSI modules, promises, events and disposal
```

The [examples catalog](examples/README.md) has runnable scenes, JSX/TSX and per-case
instructions. `npm run example -- <name>` rebuilds the bundle before opening it;
the existing `npm start` flags remain available.

## Example gallery

These are real Godot Viewport captures of the runnable examples. Launch a case
with `npm run example -- <name>`; the [public control evidence](docs/evidence/public-controls/README.md)
includes initial/updated form captures and its ten-example validation snapshot.
The [runtime evidence](docs/evidence/runtime/README.md) records the additional
clock example separately.

| Counter | NativeWind | Chart Kit |
| --- | --- | --- |
| [![Public counter](docs/evidence/public-controls/counter-initial.png)](examples/counter/README.md) | [![Utility styles](docs/evidence/public-controls/nativewind-initial.png)](examples/nativewind/README.md) | [![Chart Kit](docs/evidence/public-controls/chart-initial.png)](examples/chart/README.md) |

| Scrolling | Typography | Updated form |
| --- | --- | --- |
| [![Scrolling and editing](docs/evidence/public-controls/scroll-initial.png)](examples/scroll/README.md) | [![Rich text](docs/evidence/public-controls/typography-initial.png)](examples/typography/README.md) | [![Native form rerender](docs/evidence/public-controls/form-changed.png)](examples/form/README.md) |

| View layers | Updated View | Visible overflow |
| --- | --- | --- |
| [![Initial View geometry](docs/evidence/view/view-initial.png)](examples/view/README.md) | [![High z values preserve the sibling order](docs/evidence/view/view-updated.png)](examples/view/README.md) | [![Outside child remains visible and selectable](docs/evidence/view/view-visible.png)](examples/view/README.md) |

| Offset roots | Scaled root held | Content density two |
| --- | --- | --- |
| [![Two independent roots start at different window positions](docs/evidence/coordinates/coordinate-initial.png)](examples/coordinates/README.md) | [![Scaled root A stays held while root B remains ready](docs/evidence/coordinates/coordinate-scaled.png)](examples/coordinates/README.md) | [![Raw window pixels preserve logical root and local points](docs/evidence/coordinates/coordinate-density.png)](examples/coordinates/README.md) |

| RN affine styles | Resize and materialize | Remove transforms |
| --- | --- | --- |
| [![Original RN transform order, origins and mirrored/sheared Views](docs/evidence/transforms/transform-initial.png)](examples/transforms/README.md) | [![Percentage transforms follow size changes while the anonymous wrapper becomes concrete](docs/evidence/transforms/transform-updated.png)](examples/transforms/README.md) | [![Removing transforms restores Yoga placement and flattens the wrapper](docs/evidence/transforms/transform-reset.png)](examples/transforms/README.md) |

| Original RN tree | Keyed reorder and text update |
| --- | --- |
| [![Independent documents, repeated IDs and logical tree refs](docs/evidence/tree/tree-initial.png)](examples/tree/README.md) | [![Current order follows React while retained collections keep their snapshot](docs/evidence/tree/tree-updated.png)](examples/tree/README.md) |

| Pointerdown interest: initial | Pointerdown interest: after React updates |
| --- | --- |
| [![Original refs in the native pointerdown interest fixture](docs/evidence/pointer-interest/initial.png)](examples/pointer-interest/README.md) | [![Native pointerdown fixture after listener-driven React updates](docs/evidence/pointer-interest/updated.png)](examples/pointer-interest/README.md) |

This isolated probe uses its own test command outside the launcher catalog.
Its two 820×280 Viewport frames have 28 executed pixel assertions; the
[receipt](docs/evidence/pointer-interest/README.md) keeps injected ScreenTouch
input separate from hardware/mobile certification.

| Query faults: initial | TouchStart still commits after a failed lookup |
| --- | --- |
| [![Two native roots before query faults](docs/evidence/pointer-query-faults/initial.png)](examples/pointer-query-fault/README.md) | [![React counters after lookup recovery and an independent gesture](docs/evidence/pointer-query-faults/updated.png)](examples/pointer-query-fault/README.md) |

The 680×160 frames have 16 exact pixel assertions. Yellow counters change from
A=0/B=0 to A=3/B=1; the [receipt](docs/evidence/pointer-query-faults/README.md)
records the four faults and later retirement/stop separately.

| Document interest: initial | One descendant gesture updates its Document's state |
| --- | --- |
| [![Two native roots before Document listeners receive input](docs/evidence/pointer-documents/initial.png)](examples/pointer-document/README.md) | [![Document capture and bubble update A in one React commit while B remains unchanged](docs/evidence/pointer-documents/updated.png)](examples/pointer-document/README.md) |

The 760×220 frames have 20 exact pixel assertions. A changes from 0 to 2 after
its original Document capture/bubble callbacks, while B remains 0. The
[receipt](docs/evidence/pointer-documents/README.md) keeps later capture-only,
isolation, retirement and root-fault controls separate from that captured frame.

| Pointerup interest: initial | A receives Up after B's independent touch gesture |
| --- | --- |
| [![Two native roots with zero TouchStart and Up counters](docs/evidence/pointer-up/initial.png)](examples/pointer-up/README.md) | [![Both yellow TouchStart counters are one; only A's green Up counter is one](docs/evidence/pointer-up/updated.png)](examples/pointer-up/README.md) |

These 680×160 native frames have 24 fixed pixel assertions and independently
decoded PNG checks. Yellow follows TouchStart; green follows trusted Up. The
updated stage has starts A1/B1 and ups A1/B0, before capture-only and Cancel.
The [receipt](docs/evidence/pointer-up/README.md) separates manual installation
control from real native delivery and keeps wider acceptance open.

## Write React

### Shared application

`npm run example -- shared` mounts HUD and Inventory through the original
AppRegistry in one Hermes/Fabric application. Each root has local React state;
an explicit module store updates both. Updating props preserves state, while
unmounting one tree leaves the other running. The
[scene and root authoring guide](examples/shared/README.md) show how the
application owner and surfaces enter Godot's tree.

![Two real Godot roots share module state while preserving local state](docs/evidence/shared-roots/updated.png)

![Inventory unmounts while HUD keeps its state](docs/evidence/shared-roots/unmounted.png)

These are actual renderer readbacks. The [evidence](docs/evidence/shared-roots/README.md)
records checks and gaps; this is the bounded GF-07 prototype, not full RN/SDK parity.

### Runtime example

`npm run example -- runtime` opens a public React Native UI driven by intervals
and animation frames. Start runs four shared runtime probes; Pause cancels the
clock; six ticks complete the progress bar. See the
[initial, paused and completed captures](docs/evidence/runtime/README.md) for
the assertions behind each image and the remaining GF-05 gaps.

![Timers commit the completed React state to real Godot Controls](docs/evidence/runtime/complete.png)

### Game services

`npm run example -- services` registers game methods, state getters and signals
in GDScript, then consumes them through `GodotFabric.call`, `connect` and
`subscribe`. Zustand holds the UI representation shared by HUD and inventory.
The game owns health, equipment and accepted jobs: closing inventory while
equipping leaves the job running and the surviving HUD receives its result.

![Accepted game job completes after inventory unmounts](docs/evidence/game-services/services-completed.png)

The [example](examples/services/README.md) and
[API guide](docs/GAME_SERVICES.md) explain the initial snapshot race, revisions,
typed errors, pause, explicit cancellation and cleanup. This implementation
remains experimental; complete generated specs and RN parity remain open.

### Components

The build aliases `react-native` to the Godot platform facade and applies
the original NativeWind compiler. Start with the public
[counter](examples/counter/App.jsx). The shared Fabric application entry is
[examples/entry.jsx](examples/entry.jsx); the typography example is
[examples/typography/App.jsx](examples/typography/App.jsx).

```jsx
import { useState } from "react";
import { View, Text, Pressable } from "react-native";

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <View className="p-6 gap-4 bg-slate-950">
      <Text className="font-sans text-xl font-bold text-white">
        React in Godot
      </Text>
      <Pressable onPress={() => setCount(value => value + 1)}>
        <Text className="text-white">
          Count: <Text className="font-bold text-emerald-300">{count}</Text>
        </Text>
      </Pressable>
    </View>
  );
}
```

Complete class strings must appear in `tailwind.config.cjs` content paths.
This repository is a runnable platform prototype with an independently
provisioned consumer. It is not yet a published npm package or a drop-in addon
release with prebuilt binaries. The consumer builder does not yet run the
laboratory's NativeWind compilation path.

## Verify

```sh
npm run test:examples                    # all interactive demos, headless and sequential
npm run test:runtime                     # native deadline budget and callback error recovery
npm run test:application                 # shared roots and rejected activation/lifetime cases
npm run test:consumer -- --capture        # fresh external project, private tools, real readbacks
npm run test:services                    # real Hermes DTO, revocation and destruction boundaries
npm run test:codegen                     # original spec/schema/C++ generation and stale artifacts
npm run type-check                      # bounded strict public TSX consumer
npm run test:contracts                   # types/JS compiler/SVG/font contracts + Python fixtures
npm run test:pointers:geometry          # pinned RN counterexamples and real Hermes binding
npm run test:pointers:interest          # original Map query and native View pointerdown interest
npm run test:pointers:documents         # original Document/root interest across all four RN flag combinations
npm run test:transforms:guards           # rejected styles, invalid embedding input and cleanup
npm run check:static
npm run check:publication
npm run test:cold                        # two disposable projects, no resource cache
npm run parity:status                    # API gaps and current native evidence
npm run parity:godot                     # shared core UI fixture in Godot
npm run check -- --typography --headless
npm run check -- --typography --capture
npm run test:typography                  # includes real native negative cases
npm run test:charts
npm run test:recovery
```

Run native checks sequentially: they share generated report files. Each check
imports through the editor and rejects native errors, script errors, crashes,
timeouts and exit without the acceptance marker. Headless proves native
contracts; captures independently exercise rendering and logical Viewport input.

[Architecture](docs/ARCHITECTURE.md) · [Architecture 2.0 direction](docs/ARCHITECTURE_V2.md) ·
[V2 decisions and practical tradeoffs](docs/ARCHITECTURE_V2_DECISIONS.md) · [API](docs/API.md) ·
[1.0 roadmap](ROADMAP.md) · [Parity audit](docs/PARITY.md) ·
[Findings](docs/research/README.md) · [Validation evidence](docs/evidence/README.md) ·
[Third-party licenses](THIRD_PARTY_NOTICES.md)

The [Codegen experiment](docs/CODEGEN.md) uses original RN specs/generators.
The [native extension layer](docs/NATIVE_EXTENSIONS.md) now loads selected
external Codegen components and TurboModules through the shared SDK. An
[independent Badge/Probe consumer](examples/native-extension/README.md) passes
[35 headless / 37 graphical checks](docs/evidence/native-adapters/README.md),
with typed events, public Commands, re-renders, defaults and cleanup. Loader
rejection tests cover 21 cases / 89 checks. Full GF-26/export/parity acceptance
remains open.

![Original Codegen Badge components in two Godot Fabric roots](docs/evidence/native-adapters/initial.png)

The [root-retirement example](examples/native-extension/README.md) also unmounts
or replaces one root from a native callback while another keeps running. Its
[318 checks in 17 Godot runs](docs/evidence/root-retirement/README.md) cover
deferred cleanup, same-host remount, application replacement and rejected stale
signals. Captures include pixel checks of the surviving native UI.

![The second root keeps rendering after the first unmounts](docs/evidence/root-retirement/root-unmounted.png)


Only this renderer, generic demonstration fixtures and public documentation
are included. The repository starts with a new history; generated dependencies,
builds and environment-specific logs are excluded.

## License

The project's own code is [MIT licensed](LICENSE). Dependencies and bundled
fonts retain the licenses listed in [third-party notices](THIRD_PARTY_NOTICES.md).

The [Document pointerup example](examples/pointer-document-up/README.md) extends
the opt-in to original Document and documentElement Maps under all four flag
combinations. Eight lanes pass 1,371 headless checks; the actual macOS viewport
passes 243 checks and 20 native pixels. Document capture/bubble increment A
twice in one commit while B stays unchanged. Methods follow the original gates;
Event identity, own-root queries, removal, Cancel and stop are checked.
[Evidence and limits](docs/evidence/pointer-document-up/README.md) keep this
local proof separate from its [hosted CI receipt](docs/evidence/pointer-document-up/hosted-ci.json).

| Before Document Up | After Document capture and bubble |
| --- | --- |
| [![Native Document Up counters A0/B0](docs/evidence/pointer-document-up/initial.png)](examples/pointer-document-up/README.md) | [![Native callbacks update A2/B0 in one commit](docs/evidence/pointer-document-up/updated.png)](examples/pointer-document-up/README.md) |

### Document Up listener lifecycle

The [isolated example](examples/pointer-document-up/README.md) now validates
original RN `once` and `AbortSignal` with actual Godot input: 2,143 checks in eight
flag/SDK lanes, also passed in hosted CI, and 414 graphical checks, including 62
independently decoded pixels.
The first once Up extends A's yellow counter; the second preserves it while B
remains unchanged. [Evidence and remaining boundaries](docs/evidence/pointer-document-up-lifecycle/README.md).

| Before once | First native Up | Second native Up |
| --- | --- | --- |
| ![A12/B2](docs/evidence/pointer-document-up-lifecycle/once-before.png) | ![A13/B2](docs/evidence/pointer-document-up-lifecycle/once-first.png) | ![A13/B2 preserved](docs/evidence/pointer-document-up-lifecycle/once-second.png) |

### Document Up across root generations

The same example now checks Document Up listeners across a rerender, a root
retired while a finger is down and its replacement: 2,709 headless checks, also
passed in hosted CI, and 535 graphical checks with 90 pixels. Retirement cancels the held contact with
one TouchCancel and no Up, retained listeners never qualify the new root, and
only the fresh Document's listeners receive the next gesture.
[Evidence and limits](docs/evidence/pointer-document-up-refs/README.md).

| A retired, B holding | A remounted after a fresh gesture |
| --- | --- |
| ![A retired, B2](docs/evidence/pointer-document-up-refs/retired.png) | ![A2/B4](docs/evidence/pointer-document-up-refs/remounted.png) |

### Document Up listener mutation during dispatch

In the current lanes with native dispatch, listeners delivered by an actual native
Up remove, add and abort original Document listeners mid-dispatch. The eight-lane
matrix passes 4,401 headless checks, also passed in hosted CI, and the graphical
lane 835 checks with 118 pixels. A pending removal or abort is skipped in the same Up, an add to
the Map being iterated waits for the next gesture, and bubble listeners added by
a capture listener run in the same Up even though the root query saw only the
capture Map. [Evidence and limits](docs/evidence/pointer-document-up-mutation/README.md).

| Before an Up whose query saw only capture | After that Up |
| --- | --- |
| ![A9/B4](docs/evidence/pointer-document-up-mutation/before.png) | ![A12/B4](docs/evidence/pointer-document-up-mutation/added.png) |

### Reentrant dispatch from a native Document Up

A listener delivered by an actual native Up can dispatch a new `pointerup` on its
own or another root's Document before returning. The nested dispatch runs to
completion untrusted at target, at the Up's Discrete priority, without native
query or React update; the native Up then resumes trusted with its phase,
currentTarget, target, path and `globalThis.event` intact. Re-dispatching the
native Up itself throws `The event is already being dispatched.` The eight-lane
matrix passes 5,097 headless checks, also passed in hosted CI, and the graphical
lane 946 checks.
[Evidence and limits](docs/evidence/pointer-document-up-reentry/README.md).

### Document Up root query faults

A one-shot throw or non-boolean result in the native interest query for the
actual documentElement, at the Up offsets, rejects only that lookup with one
retained `E_POINTER_LISTENER_QUERY` diagnostic. A faulted bubble lookup still lets
a capture listener qualify the Up; with no other qualifying lookup the Up is not
delivered, while the original TouchEnd and contact cleanup survive. The faults run
in a second application, so the healthy matrix stays diagnostic-free: 6,451
headless checks, also passed in hosted CI, and 1,179 graphical checks with 132
pixels.
[Evidence and limits](docs/evidence/pointer-document-up-fault/README.md).

| After a faulted bubble lookup and its recovery |
| --- |
| ![A4/B0](docs/evidence/pointer-document-up-fault/throw36.png) |
