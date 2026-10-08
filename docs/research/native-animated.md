# Animated and TouchableOpacity on RN's C++ Native Animated

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/native-animated/README.md) owns the 75
headless checks, the preceding-host control (the same bundle fails exactly its 59
normative checks), two retained sabotages (a backend fed seconds fails 32 checks,
a JS thread that does not update the shadow node references it holds fails 2) and
the independent oracle that recomputes every sample. [LayoutAnimation](layout-animation.md)
runs on RN's own C++ driver on the same ticks; native
`Animated.event` on the SDK ScrollView, reduced motion, `PlatformColor`
interpolation, performance budgets and Godot mobile exports are not certified.
Hosted run 37439650201 repeated the 75 checks on its second attempt, after the
first failed one check of the native decay, and the independent oracle accepts
its report ([receipt](../evidence/native-animated/hosted-ci.json)).

## What RN does

**JavaScript** (`Libraries/Animated`, `src/private/animated`). `Animated.js`
loads `AnimatedExports`, which spreads `AnimatedImplementation` (values,
`timing`/`spring`/`decay`, `sequence`/`parallel`/`stagger`/`loop`/`delay`,
interpolation, `event`) and adds the `View`, `Text`, `Image`, `ScrollView`,
`FlatList` and `SectionList` wrappers. The hooks `useAnimatedValue` and
`useAnimatedValueXY` and `Easing` are small modules over the same classes.
Every animation takes one of two drivers:

- **JS driver** (`useNativeDriver: false`). `TimingAnimation`, `SpringAnimation`
  and `DecayAnimation` advance on `requestAnimationFrame` with `Date.now()`
  deltas: timing evaluates its easing at the elapsed time, spring evaluates the
  analytic damped-oscillator solution with at most 64 ms per step, decay ends on
  the first step below 0.1. An `Animated.View` applies each value through
  `setNativeProps` (`shouldUseSetNativePropsInFabric`, default true) and
  schedules a React commit 48 ms after the last one
  (`createAnimatedPropsHook.js`, lines 127-191).
- **Native driver** (`useNativeDriver: true`). `NativeAnimatedHelper.API`
  queues node operations (`createAnimatedNode`, `connectAnimatedNodes`,
  `startAnimatingNode`, `connectAnimatedNodeToView`, and with the shared backend
  `connectAnimatedNodeToShadowNodeFamily`) and flushes them to the
  `NativeAnimatedModule` TurboModule. With `cxxNativeAnimatedEnabled` the helper
  signals each batch (`startOperationBatch`/`finishOperationBatch`,
  `shouldSignalBatch`, `NativeAnimatedHelper.js` lines 71 and 255-265) and the
  props hook skips its own flush, because the flush is scheduled with
  `setImmediate` (lines 83-86). Without a module, `assertNativeAnimatedModule`
  throws `Native animated module is not available` (lines 203-227, 408), and the
  props hook's effect reaches it for any `Animated.View`, which is why the
  original `TouchableOpacity` could not mount before this slice.

**C++** (`ReactCommon/react/renderer/animated` and `animationbackend`).
`AnimatedModule` hands its operations to `NativeAnimatedNodesManager`, which owns
the node graph (value, interpolation, transform, style, props, color, tracking,
arithmetic) and the drivers: `FrameAnimationDriver` (the frame table JS samples from
the easing every 1000/60 ms, interpolated linearly in between),
`SpringAnimationDriver` (the same analytic solution in `float`, at most four
frames of time per step, rest and overshoot tests) and `DecayAnimationDriver`.
When the first animation starts, the manager registers a callback with the
`AnimationBackend`, whose `AnimationChoreographer` is told to `resume()`; when
the last one ends it `pause()`s. Each `onAnimationFrame(timestamp)` runs the
callbacks and gets `AnimationMutations`. The backend records them in the
`AnimatedPropsRegistry` and applies them in one of two ways
(`AnimationBackend::applySurfaceUpdates`): props without layout effects reach the
platform through `UIManager::synchronouslyUpdateViewOnUIThread` and never commit;
a mutation that reports layout updates takes `commitUpdates`, a real shadow tree
commit mounted synchronously. When an animation ends the backend asks for an
empty `AnimationEndSync` commit on the JS thread, and its
`AnimationBackendCommitHook` reapplies the registry's props to every React or
`AnimationEndSync` commit through `cloneMultiple` with
`runtimeShadowNodeReference = true`. `UIManager::completeSurface` clears the
registry after a successful React commit.

**Platforms.** `DefaultTurboModules.cpp` serves `AnimatedModule` when
`cxxNativeAnimatedEnabled` is on and, off Android, `useSharedAnimatedBackend` too
(on Android the module's render loop is internal either way). The shared backend and
its choreographer belong to the platform's scheduler: on iOS `RCTScheduler.mm`
gives it an `RCTAnimationChoreographer` driven by a `CADisplayLink`, and
`RCTMountingManager` implements `synchronouslyUpdateViewOnUIThread` by cloning the
mounted props with the animated ones through the component descriptor, updating the
view and logging a warning when the view no longer exists; on Android
`AndroidAnimationChoreographer` records `resume()`/`pause()` and its frame callback
only calls the backend while active, and `FabricUIManagerBinding.cpp` updates the
view the same way. Both platforms' `schedulerDidUpdateShadowTree` does nothing
(`uiManagerDidUpdateShadowTree` in this host), a path only RN's legacy Animated
used. The two flags default to false in 0.87.1; RN's OSS channels turn on
`cxxNativeAnimatedEnabled` in canary and `useSharedAnimatedBackend` in
experimental.

**The JS thread.** RN's `ReactInstance` runtime executor calls
`ShadowNode::setUseRuntimeShadowNodeReferenceUpdateOnThread(true)` before every
JS callback and never resets it (`ReactInstance.cpp`, line 101). On that thread
a shadow node cloned with `fragment.runtimeShadowNodeReference` becomes the node
the JS references hold (`ShadowNode.cpp`, lines 364-370). The animation backend's
commit hook and `setNativeProps` rely on it: React's next commit clones the node
JS holds, so JS must hold the clone that carries the animated props.

## What this host did

`Animated`, `Easing` and the hooks were not exported by the public
`react-native` import, and `TouchableOpacity` was a placeholder that threw
because its `Animated.View` needs the native module. The runtime's two UIManager
delegate methods failed loudly (`setNativeProps is not implemented`,
`Animated adapter is not implemented`), RN's feature flags kept their defaults,
no `NativeAnimatedModule` existed, and nothing set the runtime-reference
thread-local, since this host does not use `ReactInstance`.

## What Godot reports

Godot calls the application's `_process` once per rendered frame on the main
thread, which is also this host's JS thread (`FabricApplication::_process` pumps the
runtime); frame time comes from `std::chrono::steady_clock` in milliseconds. The
headless display server runs without vsync, a frame every 6.85 ms on average in the
receipt's runs (about 146 per second), so an animation of 300 ms spans about 45
frames, not 18. RN's drivers only need a timestamp per frame, and Godot has no frame
callback with a vsync timestamp, so the tick the host already reads for
`requestAnimationFrame` is the timestamp.

> Later note: the [frame clock slice](frame-clock.md) put a display link between those
> Godot frames and the backend. It runs the frame callbacks and the backend only on the
> ticks it decides, at a display's pace: where nothing paces the loop (headless, V-Sync
> off, a window that cannot draw) no two ticks come within half a refresh period, and
> where V-Sync presents every frame each frame with a consumer is a tick. So the 45 frames
> of the paragraph above are what this slice's runs saw of a loop nothing paced, and the
> timestamp is the tick's.

## The mapping

- **Flags.** `native/register.cpp` overrides RN's feature flags once, at extension
  initialization and before any runtime reads one, with RN's defaults plus
  `cxxNativeAnimatedEnabled` and `useSharedAnimatedBackend`, the configuration RN's
  OSS channels enable. If the override fails because a flag was already read, the
  extension pushes a `FABRIC_ERROR` instead of running with half the setup.
- **One backend per application.** `NativeAnimated::attach` creates RN's
  `AnimationBackend` over the application's `UIManager` before any JS runs,
  as RN's scheduler does with `useSharedAnimatedBackend`, and the runtime registers
  RN's `AnimatedModule` only when both flags are on and the backend is attached.
  Several roots of one application share it.
- **The choreographer is the frame tick.** `resume()` and `pause()` only record
  that the backend has animations; the runtime calls `frame(timestamp)` once per
  tick of the host's frame clock, after the frame callbacks (`requestAnimationFrame`)
  and the microtask drain, and never after the application stops. A batch that JS
  flushes in that tick therefore reaches the backend's next tick, which the probe
  measures. (When this slice ran, every Godot frame was that tick and the probe
  asserted the very next frame; the [frame clock slice](frame-clock.md) made ticks
  display-paced, and the probe asserts that the first tick after the call delivers
  the backend's first frame.) The choreographer's own `now()`,
  which stamps updates pushed between frames, reads the same clock as the frame
  timestamps, since RN's default `HighResTimeStamp` is another clock on some
  platforms.
- **Direct updates.** The delegate's `uiManagerShouldSynchronouslyUpdateViewOnUIThread`
  clones the mounted props with the animated ones through the component
  descriptor and applies them to the Control, as `RCTMountingManager` does on
  iOS: no commit, no JS. A view that is gone, retiring or in a stopping root is
  dropped and counted (`staleDirectUpdates`), as RN's mounting layers drop it.
  `uiManagerDidUpdateShadowTree` is a no-op, as on both platforms.
- **JS references.** The runtime sets the runtime-reference thread-local once per
  application, where it creates the runtime (the host's JS thread is Godot's
  main thread), as `ReactInstance` does for its own. Without it, the first React
  commit after an animation clones the nodes React created before the animation
  and undoes the animated props, which the `persistence` check and one of the
  two-root checks show. Two other ways were tried and dropped: toggling the
  thread-local only around the backend's commit hook failed, because clones made
  outside that window (layout clones, `setNativeProps`) lose the weak reference
  that links a node to the JS wrapper, so later hook clones cannot retarget it;
  and `updateRuntimeShadowNodeReferencesOnCommit`, an experimental flag that is
  off in 0.87.1's defaults and in RN's OSS channels, made persistence pass but
  is not what RN's shipped runtime does. The thread-local also makes JS hold the
  clone `setNativeProps` commits, which changed one existing contract: the tree
  example's children-only commit now keeps an imperative native ID, as
  bridgeless RN does.
- **The SDK.** `src/react-native-platform.jsx` exports RN's `Animated`, `Easing`,
  `useAnimatedValue` and `useAnimatedValueXY`, and `TouchableOpacity` wrapped like
  `TouchableHighlight` (no Controls inside Godot Text, styles validated on its
  View). `src/animated-exports.js` is Godot's variant of `AnimatedExports`: the
  `View` is RN's own `AnimatedView`, and the wrappers over components this
  platform renders differently or not yet (`Text`, `Image`, `ScrollView`,
  `FlatList`, `SectionList`) throw where they render with the reason, instead of
  animating another component. `src/platform-color-value-types.js` supplies the
  one platform file RN's `AnimatedColor` needs: `PlatformColor` throws and no
  value is a platform color; the bundler resolves it only for that importer, so
  no other module's behavior changes. `Animated.View` shares View's host
  contract but does not reject View styles Godot lacks.
- **Stop.** Stopping the application stops the choreographer, so no frame is
  delivered afterwards, and the snapshot then leaves `nowMs` out: a stopped
  application reports the same state however often it is asked.

## Why the probe is discriminating

The [fixture](../../tests/native-animated-fixture.jsx) runs the experiment in
[cases.mjs](../../tests/native-animated-cases.mjs) through the public import in two
roots of one application, with both drivers, and logs everything JS observes in
order, each entry stamped with `Date.now()`. The
[probe](../../tests/native-animated-probe.gd) reads, once per Godot frame and before
the application's next frame, the timestamp of the tick the host delivered to the backend, the
backend's counters and the opacity, position and angle of the real Controls: what
that frame applied. Mouse and touch presses on the `TouchableOpacity` are actual
Godot input events.

The [oracle](../../tests/native-animated-oracle.mjs) is written from RN's formulas and
C++ drivers, not from the probe's verdicts and without RN's animation code. For the
native driver it replays the frame, spring and decay drivers (the frame table,
`round(delta / 16.67)` indexing, `float` values, the spring's clamp and rest test, the
decay's stop rule) over the timestamps the host actually delivered, maps the result
through interpolation and transform onto the Control (a rotation is split between the
Control's own transform and its offset transform), and requires agreement to rounding:
in the receipt's runs at most 2.7e-15 in opacity, 1.9e-6 in position (one `float` step
at that magnitude) and 1.7e-7 rad in angle, against tolerances of 1e-6, 1e-4 and 1e-5.
For the JS driver it checks every listener entry against the curve RN computes for the
`Date.now()` it ran at, bounded only by facts the stamps give (a step ran after the
previous entry was stamped and no later than its own), so a pause between two reads
widens a window by exactly the pause. It also derives the persistence of each box's
final props from the raw samples.

On the preceding host the same bundle runs: the JS-driver checks pass, and every
`Animated.View` fails at mount with `Native animated module is not available`. It
fails exactly the 59 checks that need RN's module. A host that hands the backend
its timestamps in seconds animates a thousand times slower than its own clock: 32
checks fail and the oracle rejects the report at its first samples. A host whose JS
thread does not set the runtime-reference thread-local fails exactly the check that
final props survive later React commits and the one where a box animates back after
another root unmounts, and the oracle rejects it.

## Exploratory observations outside the receipt

These were run once on the committed tree with scratch fixtures and are not asserted
by the suite: `backgroundColor` interpolation (`rgba` red to blue) and `borderRadius`
with the native driver update the Controls frame by frame without errors, and the
native color tracks the JS driver's within a frame; `width` (80 to 160) and
`marginLeft` (0 to 60), props with layout effects that RN's allowlist admits with the
shared backend and its backend commits every frame, move the Control's size and
position frame by frame; `scaleX` and `scaleY` animate; `Animated.sequence` with
`Animated.delay`, `Animated.loop` and `Animated.parallel` over native timings end with
`finished: true` at the expected times. A uniform `transform: [{ scale }]`, animated
or static, failed with `E_TRANSFORM_3D` when this slice ran: RN builds it as
`scale3d(n, n, n)` and the transforms guard (`native/affine_transform.h`, a contract
of an earlier slice) rejected a matrix whose z scale is not 1, so the advice then was
to animate `scaleX` and `scaleY`. The later [uniform scale
slice](uniform-scale.md) accepts it, animated or not; `scale: 0` failed as singular
until the [singular transforms slice](singular-transforms.md), which collapses the View as
RN does.

## Remaining scope

Native `Animated.event` on the SDK
ScrollView and the `Animated.ScrollView`, `FlatList` and `SectionList` wrappers;
`Animated.Text` and `Animated.Image`; asserted animation of layout props with the
native driver (only the exploratory runs above cover it); `PlatformColor`
interpolation; `unstable_disableBatchingForNativeCreate`; reduced motion; behavior
under JS load and across background and resume; frame and heap budgets (GF-30);
hardware and Godot Android and iOS exports; and the contract, parity and targets of
GF-19. (A uniform `scale` was open here until the [uniform scale
slice](uniform-scale.md).)