# Original touchables

```sh
npm run example -- touchables
npm run example -- touchables --headless
npm run example -- touchables --capture
npm run test:touchables
```

`TouchableWithoutFeedback` and `TouchableHighlight` come from the public
`react-native` import and run React Native's original modules: Pressability,
the Highlight's underlay state and timers, child cloning and the single-child
rule are RN's code. `TouchableOpacity` joined them with the
[Animated example](../animated/README.md): RN 0.87.1 mounts it as an
`Animated.View`, which needs a native animated module, and Godot now runs RN's
C++ one. The launcher entry is the interactive demo of the three: hold the mouse
on each one and see what RN's own pressed state looks like, and what it does
not. `npm run test:touchables` is the
[evidence](../../docs/evidence/touchables/README.md) suite, outside the catalog:
it drives the touchables with actual Godot mouse and touch input on two roots of
one Hermes application, and its `animated` lane presses `TouchableOpacity` with a
real mouse and touch (7 checks). The evidence records the headless checks, the
preceding-SDK control, the retained sabotage and the regressions; the
[Animated evidence](../../docs/evidence/native-animated/README.md) animates
`TouchableOpacity` frame by frame.

## Use the example

![Three touchables at rest, each caption reading idle with 0 presses](../../docs/evidence/touchables/touchables-rest.png)

**Rest** is the screen as mounted: a blue `TouchableOpacity`, a teal
`TouchableHighlight` and a purple `TouchableWithoutFeedback`, each with a caption
that reads `idle · 0 presses`.

![The TouchableOpacity dimmed while the mouse is held on it](../../docs/evidence/touchables/touchables-opacity-pressed.png)

**TouchableOpacity pressed** holds the mouse on the first one. It dims to its
`activeOpacity` (0.35) through RN's native animated driver and its caption reads
`pressed · 0 presses`; the other two keep their look.

![The TouchableHighlight showing its amber underlay and a dimmed child while the mouse is held on it](../../docs/evidence/touchables/touchables-highlight-pressed.png)

**TouchableHighlight pressed** holds the mouse on the second one after the first
was released (`released · 1 press`, back at full opacity). The `underlayColor`
(amber) replaces the teal background and the child dims to its `activeOpacity`
(0.55).

![The TouchableWithoutFeedback unchanged while the mouse is held on it, only its caption saying pressed](../../docs/evidence/touchables/touchables-feedback-pressed.png)

**TouchableWithoutFeedback pressed** holds the mouse on the third one after the
second was released. RN gives it no visual feedback of its own, so nothing about
it changes: only its caption, from React's state, reads `pressed · 0 presses`.

![All three touchables at rest again, each caption reading released with 1 press](../../docs/evidence/touchables/touchables-released.png)

**Released** is the screen after the third release. Every touchable looks as it
did at rest and each caption reads `released · 1 press`: `onPressIn`, `onPressOut`
and then `onPress` ran once for each.

## What the validation establishes

[validation.gd](validation.gd) sends actual Godot mouse input, holds a press on
each touchable in turn and reads the native Controls that touchable changed. At
rest the Opacity is fully opaque and the Highlight and the feedback-free box show
their own backgrounds, React has heard nothing and every caption reads idle.
Holding the mouse on the TouchableOpacity dims it to its `activeOpacity` through
the native driver and reports `onPressIn` once, and release brings the opacity
back and reports `onPressOut` and then `onPress`. Holding it on the
TouchableHighlight shows the underlay, dims the child and reports
`onShowUnderlay` and `onPressIn`; release hides the underlay and restores the
child with `onPressOut` before `onPress` and `onHideUnderlay` last. Holding it
on the TouchableWithoutFeedback reports `onPressIn` and changes nothing on the
touchable itself, and release reports `onPressOut` and then `onPress`. While one
touchable is held the other two keep their look and captions; after the three
releases every touchable looks as it did at rest, no contact or responder is
left and the run raised no host error. With `--capture` the pixels of each
touchable are hashed per state: while the TouchableOpacity or the
TouchableHighlight is held only that one differs from rest, while the
TouchableWithoutFeedback is held all three draw as at rest, and after the
releases all three match rest again. The headless run passes 13 checks and the
capture run 27.

## Evidence suite

```sh
npm run test:touchables
```

The two SDK controls need the repository history and run locally:

```sh
node tests/touchables-native.test.mjs --preceding-sdk --sabotage
```

## Syntax

```jsx
import {useState} from 'react';
import {Text, TouchableHighlight, TouchableWithoutFeedback, View} from 'react-native';

export function Row({title, onOpen, onDismiss}) {
  const [pressed, setPressed] = useState(false);
  return (
    <View style={{gap: 12}}>
      <TouchableHighlight
        underlayColor="#1d4ed8"
        activeOpacity={0.6}
        delayLongPress={400}
        onPress={onOpen}
        onLongPress={() => setPressed(true)}
        style={{padding: 12, backgroundColor: '#2563eb', borderRadius: 8}}>
        <Text style={{color: '#ffffff'}}>{pressed ? 'Held' : title}</Text>
      </TouchableHighlight>
      <TouchableWithoutFeedback
        hitSlop={{top: 8, bottom: 8, left: 12, right: 12}}
        pressRetentionOffset={{top: 10, bottom: 10, left: 14, right: 14}}
        onPress={onDismiss}>
        <View style={{width: 80, height: 32, backgroundColor: '#334155'}} />
      </TouchableWithoutFeedback>
    </View>
  );
}
```

A quick tap reports `onPressIn`, then `onPressOut` and `onPress` with the same
release event. While pressed, `TouchableHighlight` shows `underlayColor` and dims
its child to `activeOpacity`; it hides them after release or after
`delayPressOut`. Only one child is accepted, and `TouchableHighlight`'s own style
follows View's supported styles.

## Limits

Concurrent presses with the touchables themselves (the shared touches fix covers
the responder they use), TouchableNativeFeedback,
focus and keyboard activation, accessibility, click synthesis, typed
declarations, hardware and mobile exports require separate acceptance. See the
[research](../../docs/research/touchables.md).
