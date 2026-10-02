# Original-native parity fixture

[Shared JSX](../../tests/parity/fixture.jsx) · [Godot scene](scene.tscn) ·
[Examples index](../README.md)

This automated fixture runs identical public React Native JSX on Godot and
original RN iOS/Android. It reports thirteen cases, including four runtime
contracts shared with the [runtime example](../runtime/README.md): consult the
[case inventory](../../tests/parity/cases.json) and
[current baseline](../../docs/compatibility/BASELINE.md) for exact contracts.
It is a differential oracle, not a manual UI gallery or full parity percentage.

```sh
npm run example -- parity --headless
npm run example -- parity --check
npm run parity:ios
npm run parity:android
npm run parity:compare
```

The example commands run Godot and exit after completion. They rebuild the
shared bundle and write `build/parity-godot.json`. Capture is unavailable.
Reference commands require their separate native toolchains/emulator setup;
see the [oracle instructions](../../docs/compatibility/BASELINE.md).

The source remains in `tests/parity/` to prevent the three runners diverging.
The scene can open in the root Godot editor after setup, but its behavior is
still automated. Original mobile reference success does not certify the Godot
extension on mobile; only the macOS arm64 Godot build is supported today.
