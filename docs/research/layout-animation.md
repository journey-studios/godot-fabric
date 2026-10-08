# LayoutAnimation over RN's LayoutAnimationDriver

Status: executed isolated macOS validation against pinned RN 0.87.1 and official Godot 4.7.2,
headless, for the layout animation slice of GF-19 (animated and layout animation). The probe's 121 checks run
RN's original `LayoutAnimation` (and the legacy `UIManager.configureNextLayoutAnimation`) through
the public `react-native` import on one real root: the host installs RN's own C++
`LayoutAnimationDriver`, the host's frame clock is its display link, and an independent oracle
recomputes every frame of every animation from RN's formulas. The host that main built before
this slice fails exactly the checks that need the driver, and four retained host sabotages are
rejected by the probe and by the oracle. The [evidence record](../evidence/layout-animation/README.md)
pins the executions to the implementation commit `ee8f5bd`. Reduced motion,
several roots animating at once, the interpolation of Text and Image state, background and resume,
behavior under JS load, the mobile exports and a performance budget are not certified; see
"Remaining scope".

## What RN does

**From JS to the native engine.** `Libraries/LayoutAnimation/LayoutAnimation.js` is the whole
JS side. `configureNext(config, onAnimationDidEnd, onAnimationDidFail)` (lines 60-118) returns at
once when `Platform.isDisableAnimations` is set (65) or the JS flag `isLayoutAnimationEnabled` is off
(69; `ReactNativeFeatureFlags.js:187` defaults it to `true`). Otherwise it wraps `onAnimationDidEnd`
in an idempotent `onAnimationComplete`, arms `setTimeout(onAnimationComplete, config.duration + 17)`
against the native end (87-90: the "race", which the file's own comment calls a temporary state while
iOS Fabric layout animations ship) and calls `nativeFabricUIManager.configureNextLayoutAnimation(config,
onAnimationComplete, onAnimationDidFail ?? function () {})` (95-102). The native end clears the race,
so the callback runs once whichever side finishes first. The legacy path (108-115) is
`UIManager.configureNextLayoutAnimation`, which the file reaches only when Fabric is absent.
`create(duration, type, property)` (120-131) and `Presets` (133-160: `easeInEaseOut` 300 ms,
`linear` 500 ms and `spring` 700 ms with `springDamping: 0.4`) are plain config objects.

**The binding and the delegate.** `UIManagerBinding.cpp:742-763` is the compiled
`configureNextLayoutAnimation`: it forwards the config as a `RawValue` and the two callbacks to
`UIManager::configureNextLayoutAnimation` (`UIManager.cpp:516-526`), which does something only when
`animationDelegate_` is set. The Scheduler sets it (`Scheduler.cpp:157-161`: first
`setComponentDescriptorRegistry(registry)`, then `uiManager->setAnimationDelegate(driver)`;
the destructor, 206, sets `nullptr`). The mounting side is per surface: iOS
`RCTScheduler.mm:256-258` and Android `FabricUIManagerBinding.cpp:158-161` call
`surfaceHandler.getMountingCoordinator()->setMountingOverrideDelegate(driver)` for every surface they
start, so that `MountingCoordinator::pullTransaction` (`MountingCoordinator.cpp:100-130`) hands the
driver the mutations of every transaction it pulls while the driver says it has work
(`shouldOverridePullTransaction()` is `shouldAnimateFrame()`: an armed animation or one in flight).

**The tick.** `UIManager::animationTick()` (`UIManager.cpp:731-742`) calls
`notifyDelegatesOfUpdates()` on every shadow tree when the driver has work, which re-enters
`shadowTreeDidFinishTransaction` and so the host's `uiManagerDidFinishTransaction`, which pulls
again: that pull is the next frame. iOS drives it from a run loop observer that
`LayoutAnimationStatusDelegate::onAnimationStarted` enables and `onAllAnimationsComplete` disables
(`RCTScheduler.mm:110-136`, `200-210`, `222-225`, `261-272`); Android from its choreographer. The
status delegate is called from inside `pullTransaction` on the 0 to N and N to 0 edges of the animations in
flight (`LayoutAnimationKeyFrameManager.cpp:1031-1043`).

**The engine.** `LayoutAnimationDriver` and its base `LayoutAnimationKeyFrameManager`
(`ReactCommon/react/renderer/animations`) are portable C++. `configureNext` parses the config
(`conversions.h:177-203`; `LayoutAnimationKeyFrameManager.cpp:101-141`: a config it cannot parse
logs through glog and queues the failure callback instead) and arms `currentAnimation_`, a field of
the driver, not of a surface. The next transaction with any mutation consumes it
(`:243-252`) and stamps its start with `now_()` (`:170`), a `std::function<uint64_t()>` that reads the
system clock in whole milliseconds by default (`:82-95`) and that `setClockNow` replaces (`:1061`).
From the mutations it makes key frames: creates and inserts run at once, an insert is then animated
from opacity 0 (or scale 0) to its final view, updates are animated from the old view to the new one,
and deletes (with their removes) stay mounted and animate to opacity 0 (or scale 0) before they run
(`:356-646`). A node that already has a key frame in flight is a conflict: the old key frame is dropped
and the new one starts from the view the old one last put on screen, `viewPrev` (`:647-672`,
`:1483-1578`). Every transaction after that carries one `Update` per live key frame, with the layout
interpolated in `Float` (`:1080-1152`, `interpolateFloats` at 76) and opacity and transform by
`ViewPropsInterpolation.h:24-48`, at the factor of the curve (`utils.cpp:13-67`: linear, easeIn,
easeOut, `cos((t + 1) * pi) / 2 + 0.5` for easeInEaseOut and `1 + 2^(-10 t) sin((t - d / 4) 2 pi / d)` for
spring, all returning exactly `{1, 1}` from the end time on). When no key frame is left the animation
completes: its success callback is queued on the `RuntimeExecutor` the driver was built with
(`LayoutAnimationDriver.cpp:84-97`, `callCallback` at `:1154-1158`), and the final mutations (the
removes and deletes of delete key frames, the final update of the others, a synthetic one for a create,
`:1160-1250`) are appended. `Text` and `Image` are animated by layout only: the interpolated view
keeps the final state (`:1100-1104`).

**Semantics worth knowing.** `currentAnimation_` is global: the next commit of any surface consumes
it, and a commit that changes nothing never does. An animation without a native `type: keyboard` curve
falls back to linear; easeIn and easeOut parse and run but are not certified here. A second
`configureNext` with its commit while one runs conflicts only on the nodes it touches; the first
animation completes (and calls back) at the transaction that erases its last key frame.

## What this host did

`UIManagerBinding.cpp` was compiled with the host and `configureNextLayoutAnimation` was bound, but
the host never called `setAnimationDelegate`, so `UIManager::configureNextLayoutAnimation` was a
silent no-op: the only thing that ever ended a `LayoutAnimation.configureNext` call was the JS race
timer, and the commit that followed was mounted at once. The CMake module list did not include
`react/renderer/animations`, so the driver was not even linked. The facade did not export
`LayoutAnimation`, and `UIManager.setLayoutAnimationEnabledExperimental` threw `Legacy UIManager.X is
not supported`.

## Decisions

- **RN's own driver, not a copy and not a subclass.** `react/renderer/animations` joins the core's
  CMake modules (`LayoutAnimationDriver.cpp`, `LayoutAnimationKeyFrameManager.cpp`, `utils.cpp`; the
  directory's tests are not compiled), and the host uses `facebook::react::LayoutAnimationDriver`
  directly. No animation logic lives in the host.
- **One module, `native/layout_animation.{h,cpp}`**, in the shape of `native/native_animated.{h,cpp}`.
  It builds the driver with the application's `RuntimeExecutor` wrapped to count what the driver queues
  (`callbacksQueued`), a `LayoutAnimationStatusDelegate` that keeps the in-flight flag and the
  `started` and `completed` counters, and a clock (below); it hands the driver the component
  descriptor registry and installs it on the `UIManager`, in Scheduler.cpp's order. The runtime adds
  one-line calls: `attach` after the registry is created, `register_surface(tree)` where
  `start_root` creates the `ShadowTree` (so `startSurface` and `startEmptySurface` are both covered),
  `clock(frame_time)` and `active()` in the pump where the frame clock's consumer is decided,
  `tick(frame_time)` next to the Native Animated frame, `surface_stopped(id)` after
  `ui->stopSurface(id)`, `stop()` next to Native Animated's, and `snapshot()` in `status()`, after the
  `performance` section ([performance](performance.md)) that follows `frameClock`.
- **What the surfaces point to.** The `UIManager`'s animation delegate is the driver, but a surface's
  mounting coordinator is given a delegate of the module's own (`RecordingDriver`, in the `.cpp`) that
  forwards `shouldOverridePullTransaction` and `pullTransaction` to the driver and reports the transaction
  the driver returns. A transaction is then recorded exactly when the driver served it, because the
  coordinator calls `pullTransaction` only for a delegate that asked to override; nothing is inferred
  from how often the driver reads the clock, and the runtime has no hook for it. Coordinators hold the
  delegate weakly, so `stop()` releasing it (and the driver) detaches every surface.
- **The frame clock is the display link.** `LayoutAnimation::active()` is a consumer of the host's
  [frame clock](frame-clock.md) exactly as a Native Animated backend with work is, so a frame is a
  tick only while an animation is in flight; the tick runs `UIManager::animationTick()` at the tick's
  timestamp. Idle, neither the frame clock nor the driver ticks. The in-flight flag is the status
  delegate's, as iOS switches its run loop observer: not the driver's `shouldAnimateFrame()`, which
  is also true between `configureNext` and the commit and would tick a frame that has nothing to
  pull.
- **The clock RN reads is the frame time, once per pump.** The driver reads `now_()` once per
  transaction it serves. The runtime hands the module `frame_time` (the host's monotonic clock in
  milliseconds, the timestamp the frame callbacks and Native Animated receive) at the top of every
  pump, not only on ticks: a commit that animates, or one that interrupts an animation, pulls between
  ticks, and a clock that moved only on ticks would stamp its start at the last tick, possibly seconds
  old, and the first frame after it would jump. RN reads whole milliseconds, so the clock is
  `floor(frame_time)`; it never goes backwards. No offset seam exists: the oracle recomputes
  from the clocks RN actually read, which every served transaction records.
- **Teardown.** `stop()` detaches the driver from the `UIManager` (`setAnimationDelegate(nullptr)`) and
  destroys it while the Hermes runtime is alive, because its callbacks hold `jsi::Function`s; the
  module is declared after the runtime so a destroyed application destroys it first. An unmounted
  surface ends the host's interest in ticks when none is left, because
  `deleteAnimationsForStoppedSurfaces` (`:1580`) drops animations without a status signal (the unmount's
  own empty commit has already completed the animation of every node it deletes).
- **JS surface.** `src/react-native-platform.jsx` exports RN's `Libraries/LayoutAnimation/LayoutAnimation.js`
  unchanged; `src/private-interface.js` gives `UIManager` the two methods RN's
  `BridgelessUIManager.js` has (184-190, 385-396): `setLayoutAnimationEnabledExperimental` is a no-op
  (RN warns only when `__DEV__`, which the production bundle is not) and `configureNextLayoutAnimation`
  delegates to `nativeFabricUIManager.configureNextLayoutAnimation`. Every other legacy method still
  throws.

### The status contract

`status().layoutAnimation` (also in every surface snapshot) is `{enabled, active, stopped, started,
completed, callbacksQueued, ticks, clockReads, frameMs, lastReadMs, pullsTotal, pullsDropped, pulls}`:
`started` and `completed` are the status delegate's edges; `callbacksQueued` counts what the driver put
on the `RuntimeExecutor` (the success callback of each completed animation, and the failure callback of a
config it rejected); `ticks` counts `animationTick()` calls; `clockReads` how often RN read the clock;
`frameMs` is the frame time last handed over to the driver (monotonic, in milliseconds with a fraction) and
`lastReadMs` what RN last read, which is `floor(frameMs)` as of that reading. `pulls` is a ring of the last 64
transactions the driver served: `{sequence, godotFrame, readMs, frameMs, callbacks, active, creates,
inserts, updates, removes, deletes}`, where `readMs` is what RN read for the transaction, `frameMs` the frame
time it came from, `callbacks` the cumulative callbacks queued when the transaction returned and `active` the
in-flight flag then; `pullsTotal` counts them all and `pullsDropped` those the ring has dropped. A
transaction the driver did not serve (no animation armed or in flight) is not recorded. A host
without the module has no `layoutAnimation` key.

## What the checks establish

[`tests/layout-animation-fixture.jsx`](../../tests/layout-animation-fixture.jsx) renders a stage of
three absolutely positioned views, the `box` that moves between three poses, a `child` that is added
and a `doomed` view that is removed, and runs the cases of
[`tests/layout-animation-cases.mjs`](../../tests/layout-animation-cases.mjs) through the public import,
recording every callback in order and how RN's JS timer ended each call (armed, cleared or fired).
The [probe](../../tests/layout-animation-probe.gd) reads, once per Godot frame and before the
application's next frame, the driver's counters, the transactions it served and the position, size,
opacity and scale of the Controls: what the last transaction applied. Nothing in it asserts a number
of frames, half of an animation or a wall-clock span: it waits for the driver's completion or a
callback with a limit that only turns a hang into a failed check. The
[oracle](../../tests/layout-animation-oracle.mjs) is written from the RN sources above and never reads
a probe verdict: from each served transaction's clock it recomputes the factor of the curve, the layout,
opacity and scale of every node, the mutation counts of every transaction, the counters and the state of
RN's JS timer, and compares them with the report.

| # | Spec check | Where |
| --- | --- | --- |
| 1 | `configureNext` plus one commit queues exactly one success callback through the driver's executor; JS gets one `onAnimationDidEnd` with the final layout mounted and the driver idle | `native-end` (top-level `duration` 5000, `update.duration` 300: RN's timer cannot fire first, and the callback must find the timer cleared), `mixed`, `interrupt`, and the counters of every animated case |
| 2 | Update: x, y, width and height match the oracle at every transaction for linear, easeInEaseOut and spring (the spring overshoots); the end equals `fabric*`, `onLayout`, `measure` and `getBoundingClientRect` | `update-linear`, `update-ease`, `update-spring`, `legacy` |
| 3 | Create: opacity starts at 0, follows the factor and ends at 1; with `scaleXY` the Control is collapsed (hidden) at progress 0, the scale follows the factor and ends at 1 | `create-opacity`, `create-scale` |
| 4 | Delete: the view stays mounted with decreasing opacity (or shrinking scale) and the last transaction removes it | `delete-opacity`, `delete-scale`, `mixed` |
| 5 | `onAnimationDidFail` for a config the driver rejects: one failure callback, no animation, the Controls take the layout in one step; RN's timer still ends the call | `fail` |
| 6 | The frame clock ticks only with an animation in flight; idle it does not move; the driver's clock never goes back | `idle-start`, `idle-end` and every row of every run |
| 7 | A second `configureNext` with its commit mid-animation continues from the view on screen and ends exactly at its own final layout | `interrupt` |
| 8 | `UIManager.setLayoutAnimationEnabledExperimental(true)` does not throw and changes nothing; `UIManager.configureNextLayoutAnimation` animates like `LayoutAnimation` | `flag`, `legacy` |

Because the clock is the frame time of the pump, the oracle's expected values do not depend on the
pace of the host: the report of a run under CPU load is checked against the same formulas. The largest
distance from the oracle in the run that wrote this note (359 transactions) is 1.8e-5 in position, 4.2e-8 in opacity and 4.5e-8 in scale,
against tolerances of 5e-4 in position and 1e-5 in opacity and scale (the Controls and RN's interpolation both hold single-precision floats).

**Facts the runs showed.** The first transaction of an animation is the commit's: it applies the
creates and inserts at once and the first frame of every key frame at progress 0, so the box is still
at its old layout, a created view is at opacity 0 (or collapsed) and a deleted one is untouched, while
`onLayout`, `measure` and the shadow tree already report the final layout. Every later transaction is
one tick, exactly: `ticks == transactions - 1` in a single-commit run, and the frame clock ticks
for the driver alone. The success callback runs in the pump of the tick that completes the animation,
after it (the driver queues it, the pump's work drain runs it). With a preset or `create(...)` the
animation and RN's timer end within a frame of each other, so either may call `onAnimationDidEnd`;
only a config whose top-level `duration` is far longer than the animations in it (the `separated` cases)
proves the driver ended the call. A rejected config is logged by glog (`conversions.h:38`, `:86` and
`LayoutAnimationKeyFrameManager.cpp:135` are the only native diagnostics of a run, and the test
holds the log to them).

## The preceding host and the retained sabotages

`tests/layout-animation-native.test.mjs --previous-host` runs the same bundle on the host that main built
before this slice, preserved in `build/layout-animation-previous-host/`. It fails exactly the 83
checks that need the driver (its counters, its transactions, an animation applied to a Control) and passes
the ones about RN's JavaScript: every call is ended by RN's timer, once (`race: "fired"`), and the Controls take
the committed layout in one step. The oracle rejects its report. `node scripts/layout-animation-sabotage.mjs`
rebuilds the host four more ways and runs the suite on each, restoring the sources byte for byte
afterwards:

| Sabotage | What it breaks | Checks it fails |
| --- | --- | --- |
| `seconds-clock` | the driver reads the frame time in seconds | 75 checks; the progress never moves, and the oracle rejects the clocks RN read |
| `no-register-surface` | no surface hands its mounting coordinator to the driver | 87 checks; the driver never overrides a transaction, so there is no intermediate frame |
| `no-consumer` | the driver is not a consumer of the frame clock | 86 checks; the animation stalls at its first frame and the probe waits for the completion with its limit |
| `drop-callback` | the executor counts the success callback and drops it | 6 checks; only RN's timer ends the call, which the `separated` cases show |

## Cost per tick

A tick is `UIManager::animationTick()`, which runs the whole `uiManagerDidFinishTransaction` (the pull
through the driver, then the mutations and `apply` of every live key frame) once per frame-clock tick.
Timing it around the call in a temporary instrumented host (a stopwatch on `animationTick()` and nothing
else, not retained and not a gate; the GF-30 `performance` section was not in this tree's base then, and is described
below) over 1, 10, 100 and 400
absolutely positioned 6-point views that all move for 1 s under one `LayoutAnimation`, three runs each of 53
to 68 ticks, on an Apple M3 Pro, headless, release host, on the pinned commit, gives the figures below. A 60 Hz
tick period is 16.7 ms. The machine carried other heavy processes (load average about 8): an earlier run on a quieter
machine gave about half the figures for one view, so they depend on the environment.

| Views moving | Median per tick | p95 per tick | Worst tick |
| ---: | ---: | ---: | ---: |
| 1 | 121 to 135 us | 203 to 389 us | 0.32 to 0.48 ms |
| 10 | 288 to 313 us | 0.50 to 0.78 ms | 0.65 to 1.00 ms |
| 100 | 1.37 to 1.97 ms | 2.5 to 3.0 ms | 3.1 to 3.5 ms |
| 400 | 3.71 to 3.80 ms | 4.3 to 5.4 ms | 6.2 to 6.7 ms |

It grows with the number of live key frames: the host applies every view of every transaction, and does
not skip one whose interpolated props did not change. Budgets belong to GF-30.

**Where a tick lands in the `performance` phases.** The pump times JS, mount and layout as exclusive
phases ([performance](performance.md)): the JS phase is bracketed around the microtasks, frame callbacks,
timers and the queued work, and the mounting callback opens the Mount phase itself. The driver's tick sits
between two of those brackets, next to the Native Animated frame, so it is in no JS turn, and the
transaction it pulls reaches `uiManagerDidFinishTransaction`, which is the Mount phase: an animation
frame is mount time and none of it is JS time. The performance note lists native animation among the work
that is in the pump and in no phase; a layout animation differs, because its frames are mounting
transactions. The callbacks the driver queues (the
success callback of a finished animation) run in the work drain, in the JS phase of a later part of the
pump. A tick has no real layout: when no revision is committed, `MountingCoordinator::pullTransaction`
stamps the driver's transaction with a telemetry whose `willLayout` and `didLayout` are back to back
(`MountingCoordinator.cpp:108-122`), so the Layout phase takes a sample of microseconds out of unattributed
pump time for it, never more than that time has. A commit that animates or interrupts carries its own
telemetry and is charged its real layout. Observed once, with a temporary line in the probe that was not
kept: a run of the suite that served 329 ticks ended with 358 mount samples, 215 layout samples of 0.55 ms
in all and 1196 pumps, and the phases stayed within the pumps. This does not change what the host does, and
the suite does not assert it.

## Remaining scope

- Reduced motion: `Platform.isDisableAnimations` is `undefined` under Godot's platform
  (`src/platform.js`), so `configureNext` never skips; the setting `AccessibilityInfo` reads is not wired
  to it.
- Several roots: `currentAnimation_` is global, so the next commit of any surface consumes the armed
  animation. One root at a time is certified. Stopping a root with an animation in flight is covered only
  through its empty commit and the application stop.
- Background and resume, behavior under JS load, the mobile exports and the hosted macOS and iOS runs.
- `Text` and `Image` interpolate layout only (RN's own limit). `type: keyboard` falls back to linear;
  easeIn and easeOut run RN's curves but have no certificate; a `delay` and `initialVelocity` are parsed
  and not exercised.
- A deleted view stays mounted, and so hit-testable, for the whole animation, as on RN's platforms;
  its pointer behavior in Godot is not certified.
- The cost of a tick has no budget (GF-30).
