# Original touchables on the Godot facade

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/touchables/README.md) owns the headless
checks, the preceding-SDK control, the retained sabotage and the regressions.
`TouchableWithoutFeedback` and `TouchableHighlight` are public, and so is
`TouchableOpacity` since the Animated slice
([research](native-animated.md)): it was an explicit placeholder because RN's
Animated needs a native module this host did not provide, and the host now runs
RN's C++ one. Hosted run 37394073082 repeated the 93 checks and the animated lane's
6, which then showed that failure and now has 7 checks that press it
([receipt](../evidence/touchables/hosted-ci.json)).

## What RN's touchables are

All three live in `Libraries/Components/Touchable/` and delegate gestures to
`Pressability` with `minPressDuration: 0`
(`TouchableWithoutFeedback.js:198`, `TouchableHighlight.js:116`,
`TouchableOpacity.js:125`).

- **TouchableWithoutFeedback** renders no host. It requires one child
  (`React.Children.only`, line 230) and clones it with Pressability's responder
  handlers, accessibility state and the `PASSTHROUGH_PROPS` list (line 132:
  `hitSlop`, `testID`, `nativeID`, `onLayout`, `onFocus`, `onBlur` and
  accessibility props). It never forwards `style`.
- **TouchableHighlight** renders RN's `View` with its own Pressability and clones
  its single child with `{opacity: activeOpacity ?? 0.85}`. The underlay is React
  state: shown before `onPressIn`; hidden in `onPressOut` unless a hide timer is
  pending; shown again in `onPress`, which hides it from a
  `setTimeout(..., delayPressOut ?? 0)`; `onShowUnderlay`/`onHideUnderlay` report
  each change. `componentWillUnmount` clears that timer and resets Pressability.
- **TouchableOpacity** renders `Animated.View` and animates `opacity` with
  `Animated.timing(..., {useNativeDriver: true})`.

Pressability's release path (`_performTransitionSideEffects`, lines 705-763)
deactivates before it presses, so with `minPressDuration: 0` a quick tap reports
`onPressIn`, then `onPressOut` and `onPress` with the same release event.
`_deactivate` (line 775) defers `onPressOut` by `delayPressOut`. The long-press
timer starts at the grant and is cancelled by a move beyond 10 px from the
activation point; a long press suppresses `onPress`. `reset()` (line 405) freezes
an empty config, so no callback runs after unmount. `disabled` is read only when
the responder is requested (`onStartShouldSetResponder`, line 449) and in
`onClick`.

## What the facade now does

[`src/react-native-platform.jsx`](../../src/react-native-platform.jsx) exports
`TouchableWithoutFeedback`, `TouchableHighlight` and `TouchableOpacity` as thin
wrappers over the original modules, resolved through the platform plugin like the
original `View`. The wrappers keep only the facade's host contract: no Controls
inside Godot Text (the same rule as View and Pressable) and validated styles on the
View that `TouchableHighlight` and `TouchableOpacity` render themselves
(`nativeStyle`, the same validation as View).
Pressability, the Highlight state machine, the timers, child cloning and
`Children.only` are RN's code. A `ref` on `TouchableHighlight` reaches its native
host through RN's own `hostRef`.

Accessibility and focus props flow through RN's modules to the original View and
are dropped by the view config, as for View today. `onFocus`/`onBlur`, which
`TouchableWithoutFeedback` passes to its child, never fire because a Godot View
emits no focus events. Pressability's `onClick` handler stays attached; this
host emits no click yet, and Pressability ignores clicks that carry
`pointerType`, so a synthesized pointer click cannot press twice.

`src/components.jsx` and `src/base-view-config.js` are unchanged.

## Why TouchableOpacity was unavailable, and what changed

This section records why the slice left it as a placeholder. The Animated slice
([research](native-animated.md)) removed the reason: the host now runs RN's C++
`NativeAnimatedModule`, the facade exports the original `Animated` and the original
`TouchableOpacity`, and the animated lane presses it instead of observing the failure.

At that point RN 0.87.1 could not mount `Animated.View` without a native animated
module. The props hook's passive effect calls `NativeAnimatedHelper.API.flushQueue()`
whenever `cxxNativeAnimatedEnabled` is off
(`src/private/animated/createAnimatedPropsHook.js`, lines 78-85), and both
`flushQueue` variants start with
`invariant(NativeAnimatedModule, 'Native animated module is not available')`
(`NativeAnimatedHelper.js`, lines 222-227 and 244-248). `shouldUseNativeDriver`'s
JS fallback (lines 427-457) was therefore unreachable: the component threw in its
first effect, before any timing started.

The public bundle could not include Animated either. `AnimatedExports` lazily
requires `AnimatedFlatList`/`AnimatedSectionList`, which import
`@react-native/virtualized-lists` (Flow source outside the transformed RN root,
with deep imports outside RN's package exports), and `AnimatedColor` imports
`processColorObject` from `PlatformColorValueTypes`, whose generic file only
re-exports itself; the implementations are the `.ios.js`/`.android.js` variants.
The Animated slice supplies Godot variants of both files
(`src/animated-exports.js`, `src/platform-color-value-types.js`).

The probe's animated lane made this executable. It deep-imported RN's original
`TouchableOpacity` and replaced only those two lazy/color imports with test-only
modules. The `Animated.View` host committed, the props hook's effect threw
`Invariant Violation: Native animated module is not available`, and the error
boundary removed the host: there was never a JS-driven opacity to observe.
`TouchableOpacity` therefore depended on GF-19 (a native animated backend), and
the facade's placeholder message said why until then.

## Why the probe is discriminating

The [driver](../../tests/touchables-probe.gd) sends actual Godot mouse and touch
input to two roots of one application; the
[fixture](../../tests/touchables-fixture.jsx) imports only from `react-native`
and records each callback's registration name, target, responder, page and
location coordinates, timestamps, contact counts and payload identity. Native
snapshots supply what the Controls display (background and child opacity). The
[runner](../../tests/touchables-native.test.mjs) bundles with the public build's
defaults and re-derives every section from the rules above, independently of the
probe's verdicts: callback order and payloads, underlay frames, View and Text
children, `delayPressOut`,
long press, the hitSlop and retention region (measured rect plus hitSlop plus
`pressRetentionOffset`, strict bounds), disabled grants, nesting, removal and two
roots.

Two controls show that it detects the wiring rather than any press:

- **Preceding SDK.** The fixture bundled against the facade of `15e1dda`, where
  the touchables were placeholders, fails exactly its render checks, each with
  that placeholder's own message; its SDK Pressable sentinel still presses.
- **Retained sabotage.** A facade that imitates both touchables over the SDK
  Pressable (underlay and opacity from Pressable's `pressed` state) fails probe
  checks in every gesture group except the disabled Highlight, and the oracle
  rejects it section by section: Pressable's minimum press duration reorders
  `onPressOut` after `onPress`, there are no underlay callbacks, and the responder
  is an extra View.

## Behaviors worth knowing

- **A Highlight styling a TouchableWithoutFeedback child shows no opacity
  change**, since the child never forwards `style`; RN behaves the same.
- **Disabling a granted press does not cancel it.** The press completes on
  release, as Pressability decides. The SDK `Pressable` wrapper differs: it also
  passes `disabled` to its GodotControl, whose host cancels the subtree.
- **A disabled touchable lets the responder bubble**, so an enabled ancestor
  touchable claims the press.

## Remaining scope

During exploration, a touch that started and ended in root B while root A held
the single JS responder released A's responder, because B's touch arrays held no
touch inside A, and A's `onPress` received B's payload. That was a host
transport defect shared by every responder consumer; the
[shared touches](../evidence/shared-touches/README.md) slice (#34) fixes it by
listing every root's touches in each event and certifies it with `Pressable`.
The touchables go through the same responder and this suite reran on the fixed
host, but concurrent presses with the touchables themselves are not asserted
separately. Also open:
TouchableNativeFeedback and TouchableBounce; focus,
keyboard activation and accessibility (GF-13, GF-20); click synthesis; typed
declarations for the touchables; dev-mode `PressabilityDebugView` (the bundle is
production); hardware and mobile exports.
