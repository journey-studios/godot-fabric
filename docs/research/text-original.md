# Text original: RN's `Text.js` over the paragraph, with press

Status: second slice of GF-11, executed locally on macOS arm64 against pinned RN
0.87.1 and official Godot 4.7.2, headless. The probe ran **119 checks**, every
press gesture with a real mouse and a real touch; the SDK and the host of main
before this slice ran the same fixture and failed exactly its **68 normative
checks**; the same bundle on that host alone (the guard missing) failed exactly
**3**; six retained sabotages each fail the probe and the independent oracle
rejects every one of them. The example ran 22 checks headless and 36 with the
renderer. The [evidence record](../evidence/text-original/README.md) pins the
implementation commit `ba5ff00`, the host and bundle hashes of every lane, the
receipts and four captures of the pressable line; the record ran 114 checks (63 failures on the previous
SDK and host) because the review of PR #62 added five nested-span responder cases afterwards. The hosted CI run of the new
step and the Pages publication are **pending**.

## What RN does

`Libraries/Text/Text.js` is one component for the paragraph and its spans:

- **Which host component.** With no `TextAncestorContext` above it, `Text` renders
  `NativeText` (`Text.js:289-313`); with one it renders `NativeVirtualText`
  (`Text.js:273-287`). The context is provided only when `children` holds an
  element (`Text.js:315-340`) and is the same one `View.js` reads
  (`View.js:14`, `32`, `125-128`: a `View` inside a `Text` puts `false` back for
  its own children).
- **The two native components** are in `TextNativeComponent.js`. `NativeText` is
  the registration of `RCTText` (`:79-82`) with a view config that declares
  `numberOfLines`, `ellipsizeMode`, `allowFontScaling`, `dynamicTypeRamp`,
  `maxFontSizeMultiplier`, `disabled`, `selectable`, `selectionColor`,
  `adjustsFontSizeToFit`, `minimumFontScale`, `textBreakStrategy`, `onTextLayout`,
  `dataDetectorType`, `android_hyphenationFrequency` and `lineBreakStrategyIOS`,
  plus the direct event `topTextLayout` (`:32-58`). `NativeVirtualText` is the
  registration of `RCTVirtualText` (`:84-89`) with `isHighlighted`, `isPressable`
  and `maxFontSizeMultiplier` only (`:60-67`): it has neither `onTextLayout` nor
  `topTextLayout`, so a nested `Text` never emits it. Both configs go through
  `createViewConfig`, which spreads `PlatformBaseViewConfig` under them
  (`ViewConfig.js:19-47`). Under Bridgeless (`global.RN$Bridgeless`, which this
  host sets, `native/turbo_module_registry.cpp:570`) the virtual text is always
  registered.
- **One registration per name.** `register` refuses a name that is already
  registered (`ReactNativeViewConfigRegistry.js:75-80`): `Tried to register two
  views with the same name RCTText`.
- **Press.** A paragraph with `onPress`, `onLongPress` or
  `onStartShouldSetResponder`, and not `disabled`, is pressable
  (`Text.js:155-159`) and renders `PressableText` (`:511-533`), which wraps
  `Pressability` (`useTextPressability`, `:365-477`) and hands the host the
  responder handlers and `onClick` (`:422-470`). `Pressability` is not
  configured with a minimum press duration, so its default of 130 ms applies
  (`Pressability.js:264`, `_deactivate` `:775-796`): a press out is deferred
  until 130 ms after the press in, and a release that comes later presses out
  first. The long press is 500 ms (`:257`) and cancels the press when
  `onLongPress` is set (`_performTransitionSideEffects`, `:705-763`). The press
  region is the measured rectangle plus `pressRetentionOffset`, or 20, 20, 20
  and 30 by default, with strict bounds (`:258-263`, `:831-875`). On iOS only
  (`Platform.OS === 'ios'`, `:389-399`) a press highlights the paragraph
  through `isHighlighted`; `suppressHighlighting` turns it off.
- **Accessibility.** A pressable paragraph without `accessibilityRole` or `role`
  gets `accessibilityRole: 'link'` (`Text.js:161-167`); `accessible` follows
  `Platform.select` (`:148-153`).
- **Style.** The style is flattened; a numeric `fontWeight` becomes a string,
  `userSelect` becomes `selectable`, `verticalAlign` becomes
  `textAlignVertical` (`:192-219`). With `defaultTextToOverflowHidden` (true by
  default, `ReactNativeFeatureFlags.js:223`) every paragraph gets
  `overflow: 'hidden'` (`:221-223`, `:550-557`). `enablePreparedTextLayout` is
  false (`:371`), so `NativeSelectableText` is `NativeText`.

## What this host did before

`src/text.jsx` was a wrapper of its own. It registered `RCTText` and
`RCTVirtualText` itself (`src/text.jsx:33` and `:42` at `6d02746`), kept its own
style map and its own ancestor context, and rendered the host components
directly: the RN `Text.js` was never loaded, and could not have been, because its
`NativeText` registers the same names. `onPress`, `onPressIn`, `onPressOut` and
`onLongPress` were rejected before the host saw them; `text=` and `fontSize=` were
wrapper-only props that RN's `Text` does not have.

## Premises, confirmed before the rest was built

Both were checked first, in Hermes inside Godot, with a throwaway fixture:

1. RN's `Text.js` mounts without a registry collision once the wrapper stops
   registering: `registry.register("RCTText", ...)` afterwards throws the
   collision message (so exactly one registration exists), `RCTText` declares
   `onTextLayout`, `topTextLayout`, `isPressable` and the text styles, and
   `RCTVirtualText` has no `onTextLayout`.
2. A real mouse click on a paragraph presses it: the hit test already returns the
   paragraph's tag (`native/application_runtime.cpp:1638-1666`), and RN's
   responder system and `Pressability` do the rest (`in`, `press` at the release,
   `out` 130 ms after the press in).

## The implementation

- **`src/text.jsx`** is the facade's Text module: its validations and a render of
  the original `Text`. The registrations are gone; `NativeText` and
  `NativeVirtualText` register the two names, once. `useTextAncestor()` reads
  `react-native/Libraries/Text/TextAncestorContext`, the context `Text.js` and
  `View.js` share, so the guards that fail an inline Control inside a Text
  (`Inline Controls are not implemented in Godot Text`) keep working.
  `src/react-native-platform.jsx` did not change: its `Text` still validates the
  style (`nativeStyle`) and renders this module.
- **`src/base-view-config.js`** gained the text styles `fontFamily`, `fontWeight`,
  `lineHeight`, `letterSpacing` and `textAlign` in the style map of its **default
  export**, the `PlatformBaseViewConfig` that `createViewConfig` spreads under RN's
  view configs. Without them the attribute payload drops them without a word. The
  style map of the Controls (`controlViewConfig`) is unchanged.
- **Default size.** An outer paragraph without a size gets `fontSize: 18` from
  the facade; spans inherit it. RN's is 14. The host already treats a missing size
  as 18 (`native/paragraph_layout.cpp:18-20`), so the constant pins the decision
  rather than changing a rendering. Changing it to 14 would change about 37
  examples and every evidence capture; it stays 18 and is a documented
  divergence (below).
- **Validations kept.** `onTextLayout` must be a function; `numberOfLines` must be
  a non-negative integer and belongs to the outer paragraph.
- **Native guard.** `ParagraphLayout::prepare` (`native/paragraph_layout.cpp:130-133`)
  throws for `ellipsizeMode` head and middle (which used to be drawn as a plain
  character trim) and for `adjustsFontSizeToFit` (which used to be ignored). Its
  three callers (`measure`, `measureLines`, `GodotParagraph::apply`) already
  report a throw. A `NativeText` imported directly, around the facade, no longer
  gets a silent substitute.

## Item, upstream behavior, decision

| Item | Upstream | Decision |
| --- | --- | --- |
| `Text` | `Text.js`, one component for paragraph and spans | the facade renders it |
| `RCTText`, `RCTVirtualText` | registered by `TextNativeComponent.js:79-89`, refused twice (`ReactNativeViewConfigRegistry.js:75-80`) | the wrapper stops registering |
| Text styles in the view config | the base config declares them for every platform | added to the default export of `src/base-view-config.js` only |
| Ancestor context | `TextAncestorContext`, shared with `View.js` | `useTextAncestor()` reads it |
| Default size | 14 | **18 kept**, documented, open |
| `onPress`, `onLongPress`, `onPressIn`, `onPressOut` (outer) | `Pressability`, 130 ms minimum press, 500 ms long press | accepted, behave as upstream |
| `pressRetentionOffset`, `disabled` | the region and the grant | accepted, behave as upstream |
| press props on a nested `Text` | `PressableVirtualText`, needs a hit test per fragment | rejected with an error: `Godot Text does not implement <prop> on a nested Text: only the outer paragraph is pressable` (the four press props and every prop that starts with `onResponder`, `onStartShouldSetResponder` or `onMoveShouldSetResponder` (the `Capture`, `Reject`, `Start`, `End` and `Termination` variants included)) |
| `allowFontScaling`, `maxFontSizeMultiplier`, `dynamicTypeRamp`, `suppressHighlighting` | scale and highlight on iOS | accepted and inert: the host's font scale is 1 and nothing highlights outside iOS |
| `selectable`, `adjustsFontSizeToFit` | selection, fit to the box | rejected when on: `Godot Text does not implement <prop>`; the host refuses `adjustsFontSizeToFit` too |
| `ellipsizeMode` head, middle, invalid | ellipsis at the head or in the middle | rejected: `Godot Text supports tail or clip ellipsizeMode`; the host refuses head and middle too |
| `selectionColor`, `dataDetectorType`, `textBreakStrategy`, `lineBreakStrategyIOS`, `android_hyphenationFrequency` | platform text options | rejected when set: `Godot Text does not implement <prop>` |
| `text=`, `fontSize=` | not props of RN's `Text` (wrapper extensions) | rejected, naming the prop and the RN way |
| `fontStyle`, `textDecoration*` | italics, decoration | rejected by this slice's facade; the third slice of GF-11 ([text-style](text-style.md)) accepts `fontStyle` `normal`/`italic`, `textDecorationLine`, `textDecorationColor` and a solid `textDecorationStyle`, and this slice's negative cases now try `oblique` and a dotted `textDecorationStyle`, which stay rejected |
| `accessibilityRole: 'link'` on a pressable paragraph | set by `Text.js` | reaches the paragraph's props; the host applies none yet (open, with GF-20) |

## Observed behavior of a press on a paragraph

The oracle replays every gesture against `Pressability`'s rules from the raw samples
and timestamps; none of the numbers below is fixed by the probe:

- A **tap** (press and release in the same frame, so the press lasts a few
  milliseconds whatever the frame pace) reports `onPressIn`, `onPress`, and
  `onPressOut` once 130 ms have passed since the press in, with the release
  event persisted. This is not the order a `TouchableWithoutFeedback` shows
  (`in`, `out`, `press`): those pass `minPressDuration: 0`, which `Text.js` does
  not.
- A press **held** for 250 ms reports `in`, `out`, `press`: the press out is no
  longer deferred.
- A **long press** on a paragraph with `onLongPress` reports `in`, then `long`
  500 ms later (the probe waits for the event, never a fixed sleep), then `out`
  at the release, and no `onPress`. A short tap on the same paragraph still
  presses.
- **Leaving the region** deactivates (`out`), **returning** reactivates (`in`),
  and a release presses only inside it; with the default offsets (right 20,
  bottom 30) and with a `pressRetentionOffset` of 14 and 10, at 3 px beyond and
  3 px inside each edge. A release outside never presses. Every activation is
  held past 130 ms before the next sample because `Pressability` does not cancel a
  deferred press out when a press comes back (a stale press out would otherwise
  arrive after the new press in).
- A press **outside** the box, on a **`disabled`** paragraph or on a paragraph with
  no handler reports nothing and claims no responder.
- A press over the **text of a nested span** is the outer paragraph's press: the
  hit test returns the paragraph, and the event's target is its tag.
- `onStartShouldSetResponder` alone makes the paragraph the responder.

Each of these runs with a real mouse and a real touch.

## Tests and controls

- `npm run test:text-original` runs [`tests/text-original-native.test.mjs`](../../tests/text-original-native.test.mjs):
  the bundle of [`tests/text-original-fixture.jsx`](../../tests/text-original-fixture.jsx)
  (the public `react-native` import) in three roots and a root per bypass case of one
  Hermes application, driven by [`tests/text-original-probe.gd`](../../tests/text-original-probe.gd)
  with actual Godot input. The bundle must contain `Text.js`, `TextNativeComponent.js`,
  `TextAncestorContext.js`, `Pressability.js`, `usePressability.js`, `View.js`, the
  renderer and the registry, or the test fails.
- The independent oracle ([`tests/text-original-oracle.mjs`](../../tests/text-original-oracle.mjs))
  judges the raw report without its verdicts, by section: the mount, the
  registry, every press gesture, the style of the 19 static paragraphs
  (run by run), every rejected prop word for word, the bypass refusals and the stop.
- [`scripts/text-original-sabotage.mjs`](../../scripts/text-original-sabotage.mjs) retains the controls
  and restores every source byte for byte:
  - **previous SDK and host** (main before the slice, installed in `addons/`): fails exactly the
    68 normative checks (the original `Text.js` is not in its bundle either, and
    the fixture's import of `TextNativeComponent` throws the registry's collision
    message, so the bypass cases fail at render);
  - **previous host with this SDK**: fails exactly the 3 bypass checks and is silent on all three;
    the oracle rejects only `bypass`;
  - sabotages: `register` (the wrapper registers `RCTText` again: the application does
    not even start; 107 checks fail), `style` (no text styles in the base config: 5),
    `ancestor` (a private context: 18), `span-press` (a nested press allowed: 12),
    `guard` (no native guard, which rebuilds the host: 3 — and the dylib it
    produces is byte-identical to the previous host's), `default` (RN's 14 instead
    of 18: 2). The oracle rejects each by sections the table of the comparison
    receipt names.
- The regressions: `test:text-layout` keeps its 76 checks (`press` moved from a
  rejected prop to a positive check, and the nested press is covered here);
  the typography laboratory, `line-height`, `test:touchables`, `test:examples`, the
  type check and the contracts pass.

## Limitations and open

- **A press handler on a span itself** needs hit testing by text fragment and its own dispatch in
  the pointer adapter (GF-14's area): out. A nested `Text` that declares any press or responder prop
  fails; a touch over a span's text is the outer paragraph's press, and works.
- **Accessibility of Text** (GF-20): `Text.js` gives a pressable paragraph
  `accessibilityRole: 'link'`; `GodotParagraph` applies no accessibility props.
- **Default size** 18 against RN's 14, a divergence on purpose, open.
- `fontStyle` and `textDecoration*` were the next slice and are done there
  ([text-style](text-style.md)); head and middle ellipsizing are the one after;
  `adjustsFontSizeToFit`, selection and the platform text options stay rejected.
- The font scale is 1 and nothing highlights outside iOS: `allowFontScaling`,
  `maxFontSizeMultiplier`, `dynamicTypeRamp` and `suppressHighlighting` are
  accepted and change nothing.
- `src/animated-exports.js:18` (the Image slice's area) still says that Text is
  not RN's: a stale sentence to correct there.
- The hosted run of the new CI step and the Pages publication are pending.
