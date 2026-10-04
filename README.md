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
npm run example -- shared   # two registered roots in one Hermes application
npm run example -- refs     # original RN refs and transformed window geometry
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
