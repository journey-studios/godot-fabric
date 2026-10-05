# Original touchables

`TouchableWithoutFeedback` and `TouchableHighlight` now come from the public
`react-native` import and run React Native's original modules: Pressability,
the Highlight's underlay state and timers, child cloning and the single-child
rule are RN's code. This validation drives them with actual Godot mouse and
touch input on two roots of one Hermes application. Its fixture and command are
outside the interactive launcher catalog.

`TouchableOpacity` remains unavailable: RN 0.87.1 mounts it as an
`Animated.View`, which requires a native animated module that Godot does not
provide yet (GF-19). Rendering it throws an error that says so.

The [evidence](../../docs/evidence/touchables/README.md) records the headless
checks, the preceding-SDK control, the retained sabotage and the regressions.

## Run

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

Concurrent presses in two roots, TouchableOpacity, TouchableNativeFeedback,
focus and keyboard activation, accessibility, click synthesis, typed
declarations, hardware and mobile exports require separate acceptance. See the
[research](../../docs/research/touchables.md).
