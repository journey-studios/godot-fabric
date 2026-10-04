# Original View pointerup: native interest and terminal cleanup

Executed on official Godot 4.7.2, macOS arm64, React 19.2.3 and RN 0.87.1.
Two real roots share one Hermes application. The isolated bundle enables both
original EventTarget flags and the experimental original dispatcher; public
defaults remain disabled.

The original View ref's imperative `pointerup` listener now qualifies native
emission without a JSX pointer helper. The [final receipt](report.json) separates
the corrected host, its preceding-host causal control and actual captures.

| Executed lane | Checks | Observation |
| --- | ---: | --- |
| [Initial negative history](negative.json), preceding host and earlier SDK | 54/62 | Eight visible normative failures; no SDK Up entries |
| Preceding host replay with the final current SDK bundle | 54/62 | The same eight failures; TouchEnd/Raw/cleanup stay healthy |
| Corrected host, headless | 62/62 | Bubble and capture-only Up qualify and commit React state |
| Corrected host, macOS Viewport | 90/90 | The same 62 checks plus 24 actual pixels, two counter checks and two saves/dimension checks |

The final headless old/new pair consumes identical current SDK bundle bytes,
16 producer pins and 18 untouched original RN pins. Among the producers only
`native/application_runtime.cpp` and `scripts/rn-pointer-overlay.mjs` differ.
The initial `negative.json` remains historical: its earlier SDK/bundle hashes
are not the final paired comparison.

The receipt verifies 81 unique executed code/configuration inputs against
implementation `f7c2cf6bbae4d1ef167ceb94050ee3eb5bf4d01b` using `git show`. This
includes the 16 case producers, 55 native inputs and 12 verification inputs
(two native inputs overlap the case list). Execution base `3ca4174` and the
working-tree state during execution remain recorded separately.

## What was observed

- Independent original public dispatch invokes the installed listener once,
  untrusted and at phase 2, with no native Raw or React counter increment.
- Real ScreenTouch Down has no JSX or imperative Down listener. Original
  TouchStart, typed/star Raw and one React/native commit still happen, and the
  physical contact stays active until its terminal sample.
- Real Up invokes one trusted original callback at phase 2 before TouchEnd.
  Typed and star Raw each deliver once with the callback's actual payload,
  timestamp and pointer ID. Buttons and pressure are zero. The callback runs
  at Discrete priority for the tested flags; transient fields, global event and
  Default priority restore afterward.
- Bubble-only reads the actual original Up Map at offset `36`, returning true.
  Capture-only independently reads `36=false` then `37=true`. This is listener
  capture phase selection; the test never requests pointer-capture ownership.
- The functional Up counter advances once in one React/native commit, and the
  actual Godot counter Control has the corresponding width.
- B has no Up listener. Its Up actually consults eight false `36/37` entries
  through its own path while A remains held; no B Up callback/Raw/state update
  occurs. Its original TouchEnd/Raw and contact cleanup still run.
- A's Up, a later actual Cancel and final stop clean the observed adapter,
  processor, capture/hover and route state. Cancel does not borrow Up offsets.
  Both roots balance native Controls and stop leaves no recorded errors,
  work, timers, animation frames or pending retirement.

## Actual native frames

![Two native roots before any pointerup input](initial.png)

Blue is the native input target. Yellow width follows the React TouchStart
counter; green width follows the trusted Up counter. Initially both roots have
**starts=0, ups=0**.

![A receives its original Up while B only completes a touch gesture](updated.png)

This intermediate frame follows the first bubble case. Both roots have
**starts=1**; **A ups=1 / B ups=0**. B completed its own TouchStart/End while A
was held, then A completed Up. The frame precedes the capture-only and Cancel
controls. Each 680×160 image is an actual Godot Viewport readback, with 12 fixed
pixel assertions and matching React counters. The runner independently decodes
the saved PNG pixels and compares them with the readback and fixed expectations.

## Reproduce

After existing native setup, from the repository root:

```sh
npm run test:pointers:up
node tests/pointer-up-native.test.mjs --capture
```

For an already installed preceding native host:

```sh
node tests/pointer-up-native.test.mjs --allow-original-negative
```

That option selects no binary and permits only the exact eight visible failed
checks. Extra or missing failures fail the control. It cannot be combined with
capture. The runner preserves the public bundle, logs, native host SHA and
source receipts before asserting success. Capture artifacts are separate from
the headless controls.

## Limits

This is View Up interest with both original flags enabled. Document Up, the
other flag combinations, once/abort/removal matrices, retained/retired refs,
captured or null-target Up, got/lost capture, coalescing and complete responder
acceptance are pending. Down is deliberately filtered; the proof compares Up
callback/Raw identity and does not claim a public Down/Up pointer-ID pair.

Full event-priority mapping, development renderer, physical hardware, Godot
mobile exports and performance need independent acceptance. All 16 proportional
regression commands and fresh SDK pack/verify passed;
loader acceptance is 89 checks/21 cases and 13 actual adapter runs pass 213
checks. SDK ABI certification remains false. [Hosted CI](hosted-ci.json) at
`041688c` passed all five jobs. Its five native artifacts reproduce 62 Up checks
and 3,400 preceding checks in 13 reports; 16 sources match the actual native
checkout `5250225`. The CI binary hash is declared by the runner; the binary,
old control and captures are separate local proof. This evidence does not close
a full GF item or enable public flags. See the
[research](../../research/pointer-up.md) and
[example](../../../examples/pointer-up/README.md).

[Pages publication](publication.json) passed build/deploy in
[run 37241041419](https://github.com/journey-studios/godot-fabric/actions/runs/37241041419),
using the main renderer and branch data `041688c`. The complete public JSON,
excluding only generated publication metadata, and the local live API both
match that committed data. The implementation remains outside main.
