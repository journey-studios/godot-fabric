# NativeWind and Chart Kit in an independent consumer

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2, at implementation
[`fc0f428`](https://github.com/journey-studios/godot-fabric/commit/fc0f4280c43e01d26d6fc9374e922fa449b88c5e).
The [evidence](../evidence/library-consumer/README.md) owns the lanes, the exact
releases, the control on main's SDK and the captures. This is GF-27's first verified
slice: it certifies NativeWind (`className` on View, Text, Image and Pressable, manual
dark mode, retained state) and Chart Kit v2's `LineChart` in a project that owns its
lockfile and is built by the public SDK alone. TextInput `className`, following the
system theme, font scaling, the rest of the SVG contract, the other charts and the
P2 ports stay open.

## What the libraries need from a host

NativeWind and Chart Kit already ran here, but only through the laboratory's own
bundler (`scripts/bundle.mjs`, `examples/entry.jsx`); nothing in `sdk/`, `consumers/`
or a consumer test exercised them.

- **NativeWind 4.2.7 and react-native-css-interop 0.2.7** are three things: a JSX
  runtime that routes `className` to the interop (`nativewind/jsx-runtime`, which the
  consumer's `jsxImportSource` selects; `wrap-jsx.js:5-18` swaps a component for its
  interop wrapper), a Tailwind preset and a CSS compiler that turn utility classes
  into runtime styles (`cssToReactNativeRuntime`), and a runtime that resolves those
  styles per render. The compiled styles reach the runtime through
  `StyleSheet.registerCompiled`, which Metro's plugin emits for the CSS import.
- **Chart Kit 7.0.4** v2 draws every chart through `react-native-svg`
  (`dist/v2/svg-renderer/primitives.js:3`, `defs.js:3`; peer `>=15.12.1 <16`). The
  SDK answers that import with its own facade (`src/svg.jsx`, resolved at
  `sdk/toolchain/platform-plugin.mjs:128` and `project-resolution.mjs:13`), so no
  upstream react-native-svg file enters a bundle.

## Where the first consumer failed on main (`9c5d0eb`)

A consumer that imported NativeWind was rejected at four points, and a fifth already
worked. Each failure has a fix at `fc0f428`, and the executed control reproduces the first.

1. **An optional peer.** `react-native-css-interop`'s manifest names
   `react-native-safe-area-context` and `react-native-svg` only in
   `peerDependenciesMeta` (`package.json:84-91`), so `requireOwned`
   (`project-resolution.mjs:178-184` on main) found it in none of dependencies,
   optionalDependencies and peerDependencies and failed with `E_PROJECT_DEPENDENCY:
   react-native-safe-area-context: undeclared import in react-native-css-interop
   dependencies`. The rule now counts a `peerDependenciesMeta` entry with
   `optional: true` as declared (`project-resolution.mjs:180-183`). The import then
   resolves to the SDK's facade, which throws where the peer is used
   (`src/unsupported-safe-area.js:1`, `src/unsupported-reanimated.js:7`);
   css-interop itself requires it lazily inside a `try`
   (`dist/runtime/third-party-libs/react-native-safe-area-context.native.js:19`).
   A peer with no facade that is not installed still fails, at esbuild's resolution.
2. **The CSS import.** `import "./global.css"` ended at `build.mjs:98`, "Asset/CSS
   output is not supported": the builder had no Tailwind and no
   `cssToReactNativeRuntime` step, which only the laboratory ran
   (`scripts/bundle.mjs:18`). `sdk/toolchain/tailwind-plugin.mjs:121-148` now compiles
   a project's Tailwind entry into a module that registers the styles; the guard
   stays at `build.mjs:102` for every other output.
3. **`doctor.native.js`.** Importing `nativewind` or css-interop loads
   `dist/doctor.native.js`, whose line 8 is JSX in a `.js` file; the laboratory runs
   Babel over it (`scripts/bundle.mjs:36-41`) and the SDK rejects project Babel
   (`build.mjs:58-60`). `tailwind-plugin.mjs:149-` compiles exactly that file, in a
   package named `react-native-css-interop` at the SDK's release, with esbuild's JSX
   loader and the package's own `jsx-runtime`; JSX in any other `.js` file is still
   refused. The function that needs the pragma, `verifyJSX`, is not called.
4. **`className` types.** `types/react-native.ts:162` and `179` on main declared
   `ViewProps` and `TextProps` as type aliases, which cannot merge with the
   `interface ViewProps` that NativeWind's types add (`css-interop/types.d.ts:36`):
   "Duplicate identifier". Pressable and `useWindowDimensions` had no declaration.
5. **JSX.** With `"jsxImportSource": "nativewind"` in the consumer's tsconfig the
   transform works without Babel (`project-config.mjs:6` passes the field to esbuild),
   so nothing was needed there.

## What was decided, and the alternative

- **Tailwind configuration is data.** `godotFabric.tailwind` in `package.json`
  (`content` globs inside the project, `darkMode`, `theme`), parsed at
  `tailwind-plugin.mjs:34-54`; the SDK builds the Tailwind object in process with
  `nativewind/preset` (`nativewind-compile.mjs:24-27`) and refuses a
  `tailwind.config.*` (`tailwind-plugin.mjs:57-63`), so `project-typecheck.mjs`'s
  promise that no project script or config JavaScript runs holds. `adapter-plugin.mjs:31-36`
  had to accept the key beside `adapters`. The alternative, executing the project's
  config, was refused for that promise.
- **One compile implementation.** `sdk/toolchain/nativewind-compile.mjs` runs Tailwind
  and Autoprefixer (the CLI's default chain) and the css-interop compiler;
  `scripts/nativewind-compile.mjs` calls it with the laboratory's own
  `tailwind.config.cjs`. The laboratory's `build/app.js`,
  `nativewind-compiled.json` and `nativewind-compiled.js` have the same SHA-256 as before;
  only the intermediate `build/nativewind.css` differs in whitespace (the CLI formats it).
- **The SDK compiles the native pipeline; the laboratory keeps the web preset.**
  `nativewind/preset` returns the web variant when `NATIVEWIND_OS` is unset or `web`
  (`dist/tailwind/index.js:6-7`, `common.js:22-23`) and `theme.js:5` reads the same
  variable. The laboratory's CLI ran with no `NATIVEWIND_OS`, so its styles come from
  the web variant (`:root` variables for the flags). Metro compiles native apps with
  the native one, which declares `@cssInterop set nativewind true`
  (`verify.js:19`), `@cssInterop set darkMode media` (`dark-mode.js:42`) and
  `platformSelect()` calls the runtime evaluates (`css-to-rn/functions.js:15`). The SDK
  sets `NATIVEWIND_OS=godot` (`tailwind-plugin.mjs:16`) and the shared function refuses
  to load the other pipeline in the same process, since the preset reads the variable
  once. Switching the laboratory would change its evidence, so the split stays open.
- **`darkMode` is `"media"`.** NativeWind follows `Appearance` through that strategy,
  which the executed run drives with `Appearance.setColorScheme`. `"class"` was not
  exercised and is refused.
- **The installed packages must be the SDK's.** The styles are compiled by the SDK's
  Tailwind and css-interop and read by the project's runtime, so the project's
  `nativewind` and `react-native-css-interop` must have the SDK's version
  (`tailwind-plugin.mjs:93-101`, `E_PROJECT_NATIVEWIND_VERSION`).
- **One interop runtime.** The registration module imports css-interop through a
  private specifier that resolves the way NativeWind's own `require` of it does
  (`tailwind-plugin.mjs:108-118`), so the registry that `className` reads is the
  registry the styles went into, even if css-interop is nested under nativewind.
- **`className` opt-in is the SDK's own file.** A project lists
  `addons/godot_fabric/types/nativewind.ts` in its tsconfig `include`
  (`types/nativewind.ts:7-12`: View, Text, Image and Pressable). `nativewind/types` was
  not used: it names `SwitchProps`, `ImageBackgroundProps`, `ImagePropsBase` and
  others that the SDK narrows as aliases or does not declare, which would force
  unrelated conversions and give `className` to components the host does not certify.
  Only `ViewProps`, `TextProps` and `ImageProps` became interfaces
  (`types/react-native.ts:163, 180, 217`), plus the new `PressableProps` (278) and
  `useWindowDimensions` (283).
- **The consumer's `.npmrc` sets `legacy-peer-deps`.** The SDK owns `react` and
  `react-native` and fronts the optional peers; without the flag npm 10 installs
  `react-native` and Reanimated into the consumer.
- **A host that follows the OS.** The first headed run started in the dark theme: the
  Godot host feeds `Appearance` with the operating system's scheme. The validation pins
  `light` before it asserts, so the manual override is what is certified.

## What the executed run observed

These are observations of the recorded run, not assertions: the compiled styles hold
55 rules; the bundle holds the SDK's `svg.jsx` in place of react-native-svg and both
optional-peer facades (`unsupported-reanimated.js`, `unsupported-safe-area.js`), which
throw only where the peer is used (the `animate-spin` case reaches the Reanimated one and
React catches it); the `Image`'s clip radii are the 7 of `rounded-lg` (0.5 rem of 14);
and `text-2xl font-semibold` reaches the paragraph as font size 21, weight 600 and line
height 28. The consumer uses no font-family class: the host accepts only `NotoSans` and
`JetBrainsMono` (`src/react-native-platform.jsx:106-110`), and the preset's default
stacks were not exercised.

## Open

TextInput `className` (GF-12), following the system theme, `fontScale`, `rem` and
`PixelRatio` scaling, `darkMode: "class"`, the SVG adapter's missing transform, group
opacity, font weights 700 and 800, Polygon, Polyline and the v1 root API, the other
Chart Kit charts and the written chart contract, Reanimated, Gesture Handler,
safe-area and screens ports (P2), other platforms, the laboratory's web preset against
the SDK's native one, and the duplicated version strings across the manifests and
docs.
