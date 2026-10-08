# ScrollView desktop probe

This is a local, headless execution record for the GF-14 desktop slice. It is
under review; it is not an accepted checkpoint or hosted CI result. The probe
mounts the original React Native 0.87.1 `ScrollView` in two Fabric roots and
checks command behavior, fractional offsets and DOM measurement, native pan and
momentum, cancellation, horizontal config delivery, content removal and final
runtime cleanup.

| Run | Result | Scope |
| --- | ---: | --- |
| Mounted GF-14 probe | 28/28 | Godot 4.7.2, headless, original RN component |
| VirtualizedList consumer regression | 44/44 | Existing names and offsets retained, including shelf x=180 |
| ScrollView contract/native node tests | 4/4 | Neutral values, public rejection and component-specific Fabric config |
| Type check | passed | `tsc-rs` Godot configuration |
| Native ScrollMotion tests | 44 checks | Release coordinate, frame-partitioned decay, stale velocity, throttle and bounds |

The integrated mounted probe observes a fractional offset of 13.25 consistently in native
state, Fabric state, painted content position and RN DOM measurement. Its
horizontal second root receives `horizontal=true`, pans to a measured x offset,
and completes BeginDrag, EndDrag, MomentumBegin and MomentumEnd in order. The
list regression preserves the historical 180 px shelf offset with matching
logical/Fabric offset and painted content translation. The report also checks
that stopping the app retires roots, tags, contacts, captures, routes and pending
work.

An accepted wheel step or changed `contentOffset` during a claimed pan ends the
drag once at its current offset before applying the external replacement. The
later Move and Up cannot resume that drag or emit another EndDrag. The wheel
case applies y=178 after EndDrag at y=130; the prop case applies y=260 after
EndDrag at y=130. Logical offset, Fabric state and painted content stay aligned.

Host-equivalent RN options mount the original component without a Fabric error
and still scroll to `(12,24)`, with painted translation `(-12,-24)`. The explicit
option policy accepts neutral flags, `keyboardDismissMode="none"`, cancellation
enabled and persistent indicators enabled. Cancellation disabled and fading
indicators requested with `persistentScrollbar=false` remain unsupported.

The vertical diagonal drag releases at `(80, 150)` and the horizontal diagonal
drag releases at `(150, 70)`. EndDrag records those exact points, the transverse
velocity is zero, Fabric state and painted content preserve the transverse
offset, and each lifecycle is `BeginDrag`, `EndDrag`, `MomentumBegin`,
`MomentumEnd`. The settled active-axis offset agrees with the measured momentum
target. Changing orientation during a claimed gesture cancels that gesture
before the new axis is installed.

Both mounted ScrollViews overflow in both axes. Horizontal `scrollToEnd(false)`
reaches x=540 while retaining y=35; vertical `scrollToEnd(false)` reaches y=590
while retaining x=55. This follows the pinned Android command policy and does
not assert iOS parity.

The following identities bind the result to its inputs:

| Artifact | SHA-256 |
| --- | --- |
| Loaded `addons/fabric_godot.dylib` | `bbb683e2e7f3d0b9855ded93d547d50ffc4bf7bb3166f36d11ae2e430d3935fe` |
| `.deps/build/native-sdk-build.json` | `a3bd2e88322cc60e748096f6740c9e017671a9b733836e82b83c1545f4c12af5` |
| Mounted probe bundle | `29f2c9282fd7f59c137afe225447f5a26b901979d4c115e7498961eda6b6005b` |
| GDScript probe source | `3c42b5ef82ac59a1d9cdea759f5110e40c69edf21e84c2f627ee6ef9fcb47915` |
| Mounted report | `a7a104a84243e573738ebec66e124660d3e5f1a43c1bd47ce4a100343e098adc` |
| Mounted log | `70bbf5fbe24d1edf4bd76f5be39eda6f5f285fb87b65eab2c2451165cf110865` |

The build record's host digest matches the loaded library and remained stable
during the probe. All eight compiled native source pins in the receipt match
the current native scroll, pointer and runtime source files. This verifies the
recorded build inputs and loaded bytes; the receipt does not certify the
experimental external SDK adapter ABI. The bundle pins the mounted fixture,
probe and wrapper sources, plus RN's original ScrollView, command codegen,
native component, registry and view-config sources. `receipt.json` gives the
compact machine-readable identities and results.

The root-owned [independent receipt](root-independent.json) is preserved as
pre-integration evidence for the earlier 22-check bundle and hosts built before
Device Services integration. It is not a repeat of this 28-check integrated
host. Its original artifacts remain under ignored
`build/scroll-view-pre-integration-60fa18/`; this receipt records the integrated
host and current sources.

The root-owned [integrated independent receipt](root-integrated.json) preserves
the earlier 25-check comparison: host `4f28ed0f` passes; host `60fa18ed` fails
exactly the two diagonal controls and orientation cancellation.

The [interruption receipt](root-interruption.json) binds an independent isolated
28-check repeat to the current host. The frozen `4f28ed0f` host executes the same
bundle and probe and fails exactly the wheel and `contentOffset` interruption
controls, without unrelated errors or cleanup failures. Report derivation checks
the EndDrag ordering, logical/Fabric/paint offsets and retirement before later
Move and Up, rather than trusting check flags alone. Original pre-fix artifacts
remain under ignored `build/scroll-view-pre-wheel-cancel-4f28/`.

The [committed producer proof](committed-source.json) compares every one of the
112 native build input files and 18 bundle producer files against committed
Git blobs. It separately verifies six installed pinned RN inputs. Receipt-only
commits after the recorded producer commit do not change the tested sources.

Affected integrated regressions also pass: Accessibility metadata 80/80 and
594 core assertions in 11 groups, Text layout 76/76, native modules 76/76 and
Device Services 65/65. These are local desktop checks; the headless accessibility
lane does not certify an OS tree or assistive technology hardware.

## Windowed graphical capture

A separate Godot macOS windowed probe executed the same host and unchanged
GF-14 bundle. It saved the initial two-root view, the 13.25 px fractional
offset, a horizontal pan, and the empty post-cleanup frame. The probe measured
the inner pixel as RN blue `(0.1137, 0.3059, 0.8471)` and a point 16 px outside
the horizontal viewport as the capture's light clear color
`(0.9608, 0.9725, 0.9804)`, showing that the wide blue child is clipped at the
viewport. Native x, Fabric x and painted content translation agree at the
settled horizontal offset. The light clear color exists only in this capture
probe; the frozen public bundle is unchanged.

![Initial two-root ScrollView view](captures/initial.png)

![13.25 px fractional scroll position](captures/fractional-13_25.png)

![Horizontal pan with content clipped to the viewport](captures/horizontal-pan-clipped.png)

![Window after both roots are stopped and freed](captures/cleanup.png)

The [graphical receipt](graphics-receipt.json) pins the probe, host, bundle,
checks, log and screenshot bytes. This is a macOS Godot render using the
Compatibility renderer; it is not physical touch hardware, a refresh-rate
matrix, or a mobile export. The logs contain only the runtime's UIManager
destructor warnings after orderly stop; the checks and runner reject script,
engine and Fabric errors.

## Retained negative control

The dedicated list sabotage removes only `onLayout` forwarding in a temporary
copy of the current wrapper. All 44 checks still run; exactly the initial feed
window and its derived viewability checks fail. The independent RN oracle also
rejects the report even if its check flags are forced to “passed”. The positive
44-check report remains intact. Reproduce with
`node --test scripts/scroll-view-list-sabotage.mjs`; the
[negative receipt](sabotage-receipt.json) records hashes and failed checks.

The reproducible gates are `npm run test:scroll-view`, `npm run test:lists`,
`node --test scripts/scroll-view-list-sabotage.mjs`, `npm run type-check`,
`npm run test:text-layout`, `npm run test:modules`, `npm run test:device-services`,
and `.deps/build/scroll_motion_test`. The mounted report
and its raw log/bundle are retained under the ignored `build/` tree. Pixel
clipping is checked in the separate graphical lane above; hardware touch, a
refresh-rate matrix, mobile exports and full RN parity remain future work.
