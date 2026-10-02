# Public Button and TextInput validation

Checkpoint: **2026-10-02**. The [TSX form](../../../examples/form/README.md)
uses public RN imports and the original React/Fabric runtime with real Godot
Button and single-line LineEdit Controls. These are local macOS arm64 results
with official Godot 4.7.2, React 19.2.3, RN 0.87.1 and Hermes 250829098.0.17.
Godot itself was not rebuilt.

## Native form

**39 headless and 43 graphical assertions passed.** Complete reports are
regenerated in `build/examples/headless/form.json` and
`build/examples/native/form.json`; raw run reports are not versioned.

Logical Viewport keyboard events edit the native field and activate native
buttons. Assertions cover controlled/uncontrolled values, acknowledged clear,
UTF-16 selection, focus/blur/end/submit/key/change events, initial autoFocus,
asynchronous native measurement, disabled behavior, title/color/geometry
updates, style removal/Theme restoration, stable native/ref identity and
balanced unmount. Retained ref commands release their host after unmount.
Five intentional unsupported-prop probes fail inside React error boundaries;
invalid ref selection fails before issuing a native command. Capture adds
actual native glyph-pixel checks and two Viewport readbacks.

![Public TSX form at mount](form-initial.png)

![React update changes native input styling and Button title/color](form-changed.png)

These images contain only generic example content, not desktop applications,
other games or private configuration. The source contract suite checks strict
positive/negative TSX consumers, prop guards, the original renderer in the
bundle, and real Godot/native/generic resolution through both esbuild and
TypeScript. The mixed-extension test exposed different resolution order; the
bundler now matches TypeScript's .ts-before-.tsx preference and platform suffixes
within each extension.

## Scope

This form is Godot acceptance evidence, not new iOS/Android differential
certification. The existing original-mobile oracle still covers its nine shared
core cases. Physical hardware input, IME/virtual keyboard, multiline,
accessibility, complete types/props, NativeWind TextInput interop and other
platform builds remain open. The [API](../../API.md) defines the implemented
subset and [roadmap](../../../ROADMAP.md) retains those larger milestones as
In progress. Earlier release/example provenance remains historical.
