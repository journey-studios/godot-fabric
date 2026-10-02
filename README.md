# Godot Fabric

**Build native Godot UIs with React.** An experimental renderer powered by
React Native Fabric, Hermes and Yoga, delivered as a Godot GDExtension.

React runs inside Godot. JSX, hooks and reconciliation produce real Godot
Controls through the original Fabric mounting pipeline. The official Godot
engine does not need rebuilding.

![Native typography example](docs/evidence/typography-initial.png)

## Status

This is an experimental platform implementation. Native setup and rendering
are validated on **macOS arm64 with official Godot 4.7.2**. Linux, Windows,
iOS, Android and Web do not yet have supported build paths.

Setup and the check runner prepare Godot's extension startup list before the
first import. This avoids a Godot 4.7.2 editor crash when an import-only scan
discovers extension classes late. Resources are still imported from scratch;
failures are reported without retries. See the [cold-start evidence](docs/evidence/cold-start.md).

Supported, within the documented subset: React 19 hooks and concurrent roots,
View, Text, TextInput, Pressable, ScrollView, NativeWind styles, nested rich
text and a limited SVG adapter exercised by React Native Chart Kit.

This does not promise compatibility with every React Native library.
[API and limitations](docs/API.md) define the supported contracts.
The [parity baseline](docs/compatibility/BASELINE.md) inventories the remaining
public contracts and compares a shared fixture against original native RN.

## Run

Requirements: macOS arm64, Node 22.13+, npm, Python 3.12+, Xcode Command Line Tools,
and [official Godot 4.7.2](https://github.com/godotengine/godot-builds/releases/tag/4.7.2-stable).

```sh
git clone https://github.com/journey-studios/godot-fabric.git
cd godot-fabric
npm run setup
npm start -- --typography
```

Set `GODOT_BIN` to the official engine executable if it is outside
`/Applications/Godot.app`. Setup downloads checksum-pinned native dependencies,
installs the npm lockfile, bundles JSX and compiles the GDExtension.
CMake lives in a local virtual environment; Godot itself is not recompiled.

```sh
npm start -- --nativewind   # reactive utility classes and manual theme
npm start -- --chart        # original React Native Chart Kit
npm start -- --scroll       # generic scroll, filtering and editing demo
npm start                  # React state, keys, Suspense and error boundaries
npm run bundle             # rebuild after JSX/style changes
npm run setup              # rebuild after native C++ changes
```

## Write React

The build aliases `react-native` to the Godot platform facade and applies
the original NativeWind compiler. The native application entry is
[src/app.jsx](src/app.jsx); the typography example is
[src/typography-app.jsx](src/typography-app.jsx).

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
npm run test:contracts                   # JS compiler/SVG/font contracts + Python fixtures
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

[Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) ·
[Findings](docs/research/README.md) · [Validation evidence](docs/evidence/README.md) ·
[Third-party licenses](THIRD_PARTY_NOTICES.md)

Only this renderer, generic demonstration fixtures and public documentation
are included. The repository starts with a new history; generated dependencies,
builds and environment-specific logs are excluded.

## License

The project's own code is [MIT licensed](LICENSE). Dependencies and bundled
fonts retain the licenses listed in [third-party notices](THIRD_PARTY_NOTICES.md).
