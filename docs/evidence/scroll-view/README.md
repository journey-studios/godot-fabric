# ScrollView desktop probe

This is a local, headless execution record for the GF-14 desktop slice. It is
under review; it is not an accepted checkpoint or hosted CI result. The probe
mounts the original React Native 0.87.1 `ScrollView` in two Fabric roots and
checks command behavior, fractional offsets and DOM measurement, native pan and
momentum, cancellation, horizontal config delivery, content removal and final
runtime cleanup.

| Run | Result | Scope |
| --- | ---: | --- |
| Mounted GF-14 probe | 22/22 | Godot 4.7.2, headless, original RN component |
| VirtualizedList consumer regression | 44/44 | Existing names and offsets retained, including shelf x=180 |
| ScrollView contract/native node tests | 3/3 | Public rejection and component-specific Fabric config |
| Type check | passed | `tsc-rs` Godot configuration |
| Native ScrollMotion tests | 44 checks | Release coordinate, frame-partitioned decay, stale velocity, throttle and bounds |

The mounted probe observes a fractional offset of 13.25 consistently in native
state, Fabric state, painted content position and RN DOM measurement. Its
horizontal second root receives `horizontal=true`, pans to a measured x offset,
and completes BeginDrag, EndDrag, MomentumBegin and MomentumEnd in order. The
list regression preserves the historical 180 px shelf offset with matching
logical/Fabric offset and painted content translation. The report also checks
that stopping the app retires roots, tags, contacts, captures, routes and pending
work.

Both mounted ScrollViews overflow in both axes. Horizontal `scrollToEnd(false)`
reaches x=540 while retaining y=35; vertical `scrollToEnd(false)` reaches y=590
while retaining x=55. This follows the pinned Android command policy and does
not assert iOS parity.

The following identities bind the result to its inputs:

| Artifact | SHA-256 |
| --- | --- |
| Loaded `addons/fabric_godot.dylib` | `60fa18ed776235675efb9fe6ad145f65ab5f091055ac8cad1696f8b84734c7bb` |
| `.deps/build/native-sdk-build.json` | `ddfc16a3ec85196f2c5e93e80970cc4459eed449388c52d3c6505862ae47ff7f` |
| Mounted probe bundle | `899981449f04fba383d0fabf0c169cb81b1448aa7831a9911009baf6b1a6de6a` |
| GDScript probe source | `07c8fc292734ff5244f7a5e732f10fbffc42569e1170934457e7b6bc63f0a131` |
| Mounted report | `340c8c9fc1f546b3a09e3b643bb18f92ff8b9b82a060f3466b22aa62912cb6ef` |
| Mounted log | `e7e161fe10742ab55579e03c5c6373ea96d0f422e2f3647f1de2648e712ee004` |

The build record's host digest matches the loaded library and remained stable
during the probe. All eight compiled native source pins in the receipt match
the current native scroll, pointer and runtime source files. This verifies the
recorded build inputs and loaded bytes; the receipt does not certify the
experimental external SDK adapter ABI. The bundle pins the mounted fixture,
probe and wrapper sources, plus RN's original ScrollView, command codegen,
native component, registry and view-config sources. `receipt.json` gives the
compact machine-readable identities and results.

The root-owned [independent receipt](root-independent.json) records an isolated
repeat of the final 22-check bundle with identical inputs on the current host
and the preceding host built from merged commit `7e2df46`. The current host
passes 22/22 with no engine or Fabric errors. The preceding host fails 18 checks
with exactly 11 expected old command-protocol errors; those failures include
diagnostic differences and cascading command failures, not 18 independent bugs.
Both hosts retire roots, tags, contacts, captures, routes and pending work. The
earlier 94841/20-check comparison remains frozen under ignored `build/`.

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
`npm run type-check`, and `.deps/build/scroll_motion_test`. The mounted report
and its raw log/bundle are retained under the ignored `build/` tree. Pixel
clipping is checked in the separate graphical lane above; hardware touch, a
refresh-rate matrix, mobile exports and full RN parity remain future work.
