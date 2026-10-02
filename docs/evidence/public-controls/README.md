# Public Button and TextInput validation

Checkpoint: **2026-10-02**. The [TSX form](../../../examples/form/README.md)
uses public RN imports and the original React/Fabric runtime with real Godot
Button and single-line LineEdit Controls. These are local macOS arm64 results
with official Godot 4.7.2, React 19.2.3, RN 0.87.1 and Hermes 250829098.0.17.
Godot itself was not rebuilt. The counts, hashes and captures below retain this
checkpoint before integration with the runtime example and 13-case oracle.
See [runtime evidence](../runtime/README.md) for that separate implementation.

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

## Ten-example regression matrix

| Example | Headless | Native renderer with capture |
| --- | ---: | ---: |
| counter | 19 | 24 |
| form | 39 | 43 |
| react | 36 | 36 |
| layout | 47 | 47 |
| input | 45 | 45 |
| pressable | 43 | 47 |
| scroll | 62 | 68 |
| chart | 34 | 34 |
| nativewind | 49 | 58 |
| typography | 50 | 63 |
| **Total** | **424** | **465** |

**889 passing assertions in 20 sequential runs.** [matrix.json](matrix.json)
records each count, display/input mode, generated report path and SHA-256.
Reports are regenerated under `build/examples/`; the hosted native job uploads
its headless reports as `native-examples-headless`. Graphical checks and these
18 generic captures are local evidence. The root and ten per-example READMEs
link these images. Raw logs/full snapshots remain outside the Git payload.

The contract gate passed **26 Node tests and 8 Python fixtures**, including
strict positive/negative TSX checking and resolver collisions. Fallow and the
publication scan passed. Two disposable projects passed cold imports, React/
typography runtime checks and warm imports; the unchanged Godot oracle passed
nine core cases. The current PR's hosted result is separate from these local
results and from earlier mobile oracle evidence.

[provenance.json](provenance.json) pins the implementation and records current
source/capture/matrix hashes. Raw report hashes are in the matrix; earlier
provenance remains historical. The new form wrapper and native appearance paths
were regression-checked with the same ten cases after all runtime changes.

## Scope

This form is Godot acceptance evidence, not new iOS/Android differential
certification. At this checkpoint the original-mobile oracle covered nine shared
core cases; the later runtime snapshot extends it to 13. Physical hardware input, IME/virtual keyboard, multiline,
accessibility, complete types/props, NativeWind TextInput interop and other
platform builds remain open. The [API](../../API.md) defines the implemented
subset and [roadmap](../../../ROADMAP.md) retains those larger milestones as
In progress. Earlier release/example provenance remains historical.
