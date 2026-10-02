# Godot Fabric

**Build native Godot UIs with React.** An experimental renderer powered by
React Native Fabric, Hermes and Yoga, delivered as a Godot GDExtension.

React runs inside Godot. JSX, hooks and reconciliation produce real Godot
Controls through the original Fabric mounting pipeline. The official Godot
engine does not need rebuilding.

![Public TSX form rendered by Godot](docs/evidence/public-controls/form-initial.png)

## Status

This is an experimental platform implementation. Native setup and rendering
are validated on **macOS arm64 with official Godot 4.7.2**. Linux, Windows,
iOS, Android and Web do not yet have supported build paths.

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

This does not promise compatibility with every React Native library.
[API and limitations](docs/API.md) define the supported contracts.
The [parity baseline](docs/compatibility/BASELINE.md) inventories the remaining
public contracts and compares a shared fixture against original native RN.

The [1.0 roadmap](ROADMAP.md) maps priorities, dependencies and acceptance
criteria for RN parity across macOS, Linux, Windows, Android and iOS. The
[dated parity audit](docs/PARITY.md) separates implemented behavior, incomplete
contracts and missing APIs against React Native 0.87.1.

## Run

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
npm start -- --nativewind   # reactive utility classes and manual theme
npm start -- --chart        # original React Native Chart Kit
npm start -- --scroll       # generic scroll, filtering and editing demo
npm start                  # React state, keys, Suspense and error boundaries
npm run bundle             # rebuild after JSX/style changes
npm run setup              # rebuild after native C++ changes
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

## Write React

### Runtime example

`npm run example -- runtime` opens a public React Native UI driven by intervals
and animation frames. Start runs four shared runtime probes; Pause cancels the
clock; six ticks complete the progress bar. See the
[initial, paused and completed captures](docs/evidence/runtime/README.md) for
the assertions behind each image and the remaining GF-05 gaps.

![Timers commit the completed React state to real Godot Controls](docs/evidence/runtime/complete.png)

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
This repository is a runnable platform prototype; it is not yet a published
npm package or a drop-in addon with prebuilt binaries.

## Verify

```sh
npm run test:examples                    # all interactive demos, headless and sequential
npm run test:runtime                     # native deadline budget and callback error recovery
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

Only this renderer, generic demonstration fixtures and public documentation
are included. The repository starts with a new history; generated dependencies,
builds and environment-specific logs are excluded.

## License

The project's own code is [MIT licensed](LICENSE). Dependencies and bundled
fonts retain the licenses listed in [third-party notices](THIRD_PARTY_NOTICES.md).
