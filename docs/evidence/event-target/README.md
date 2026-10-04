# Original EventTarget baseline

The isolated macOS arm64/headless probe executes **119/119 checks**, including
33 manual checks in each enabled root. These 66 checks are included in 119.
This is an executed baseline for GF-05/GF-08/GF-13; it does not enable production
EventTarget or complete these items. [Curated receipt](report.json) retains
every check, source/bundle/host hashes, flag matrix, gap controls and cleanup.
All five executed probe source hashes and four unchanged production sources
match implementation [`2db8e39`](https://github.com/journey-studios/godot-fabric/commit/2db8e391eff4de26caab0231be878f4ee807e799).
Execution preceded that commit; native artifact identity remains separate.

```sh
npm run test:events:original
```

The runner bundles four separate Hermes configurations with original RN
0.87.1 modules, then mounts five real Fabric surfaces. It never rewrites the
public `build/app.js`. Production bootstrap, resolver, private interface and
runtime source hashes are checked before/after. The native host is the preceding
captured-geometry build; no native compilation is needed for this baseline.

| Original flags | Element extends EventTarget | Public element methods | Document methods |
| --- | --- | --- | --- |
| Original defaults: both off | No | Absent | Absent |
| Imperative only | No | Absent | Absent |
| Native dispatch only | Yes | Absent | Present |
| Both on | Yes | Present | Present |

The base class is selected when ReadOnlyNode evaluates. Original defaults reject
a late override; every opt-in runtime rejects repeated override. Globals use
original Event/EventTarget/CustomEvent/AbortController/AbortSignal constructors.
This flag matrix is experimental upstream behavior, not a public SDK promise.

Enabled refs exercise nested/flattened ancestry, two documents in one runtime,
capture/bubble phases, currentTarget/target/this, listener identity and removal,
handleEvent objects, once before nested dispatch, listener mutation, AbortSignal
abort/remove/re-add, passive and cancelable behavior, stop propagation,
same-event reentrancy and transient-field cleanup. Pinned null-option rejection
is recorded as an original quirk, not browser parity.

Three independent missing contracts are reproduced:

| Gap | Executed positive control | Observed missing behavior |
| --- | --- | --- |
| Native interest | A real mounted ref's imperative-only pointer listener works under manual Event dispatch; genuine touch enters the native route | Without JSX interest, no pointerdown reaches RawEventEmitter or the imperative listener |
| Native dispatch | A functional JSX handler and RawEventEmitter each receive exactly one pointerdown with the same tag/id | The same Control's imperative listener receives zero |
| Retained ancestry | Warm and never-dispatched cold refs start connected; after React removal both report null native parent/disconnected and their old parent stays mounted | Warm ref bubbles to its cached former parent; cold ref dispatches only on itself |

The public listener fault is deliberate and remains visible: original dispatch
continues its peer, returns, restores event/global fields and schedules exactly
one error through real TimerManager. Two passive preventDefault warnings are
also expected and visible. This does not certify native listener exceptions;
the original native dispatcher has a different synchronous error contract.

All four applications stop with zero roots/work/timers/animation frames; all
five surfaces balance native creates/deletes and retain zero native tags. Only
the enabled application's deliberate error remains in its diagnostic history.

The full contract command passed (last Node suite: 199 tests; Python: 13),
with static/publication checks and all three dashboard gates passing.
The CI workflow now runs the probe and uploads its raw report, bundle receipt
and log. Hosted execution is pending for this new slice. Previous green CI does
not certify the new probe. No graphical capture, physical input, responder/
PanResponder, TextInput/IME, coalescing, multi-window or mobile differential was
executed here. Native delivery, public types and current-ancestry correction
remain open. [Next integration acceptance](../../research/event-target-boundary.md).
