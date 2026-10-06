# Virtualized lists on the Godot ScrollView

This validation runs React Native's original `FlatList`, `SectionList`,
`VirtualizedList` and `VirtualizedSectionList` from the public `react-native`
import. They render on the SDK ScrollView and window their cells as real Godot
wheel and touch input scrolls them, in two roots of one Hermes application. Its
fixture and commands are outside the interactive launcher catalog.

The [evidence](../../docs/evidence/virtualized-list/README.md) records **44/44
headless checks**. The preceding host, with the same SDK bundle, fails exactly
**3 normative checks**; the preceding SDK fails 11, and an SDK ScrollView that
drops `onLayout` fails 3 and is rejected by the oracle.

## Run

```sh
npm run test:lists
```

The same runner checks the controls. With the preceding native host installed:

```sh
node tests/virtualized-list-native.test.mjs --allow-original-negative
```

The preceding SDK and the retained sabotage need no host change:

```sh
node tests/virtualized-list-native.test.mjs --lane preceding-sdk
node tests/virtualized-list-native.test.mjs --lane sabotage
```

## Original syntax

```jsx
import {useRef} from 'react';
import {FlatList, SectionList, Text, View} from 'react-native';

const rows = Array.from({length: 120}, (_, index) => ({id: String(index)}));

function Feed({onMore}) {
  const list = useRef(null);
  return (
    <FlatList
      ref={list}
      data={rows}
      keyExtractor={row => row.id}
      getItemLayout={(_, index) => ({length: 40, offset: 40 * index, index})}
      initialNumToRender={10}
      windowSize={5}
      onEndReachedThreshold={0.5}
      onEndReached={onMore}
      viewabilityConfig={{itemVisiblePercentThreshold: 50}}
      onViewableItemsChanged={({viewableItems}) => console.log(viewableItems.length)}
      renderItem={({item}) => <Text style={{height: 40}}>{item.id}</Text>}
    />
  );
}

function Agenda({sections}) {
  return (
    <SectionList
      sections={sections}
      keyExtractor={item => item}
      renderSectionHeader={({section}) => <Text>{section.key}</Text>}
      renderItem={({item}) => <View style={{height: 30}} />}
    />
  );
}
```

Scroll a list with `list.current.scrollToIndex({index: 60, animated: false})`,
`scrollToOffset` or `scrollToEnd({animated: false})`; `SectionList` adds
`scrollToLocation`. Without `getItemLayout`, an index beyond the measured cells
calls `onScrollToIndexFailed`, as in RN.

| Input | What the list does |
| --- | --- |
| Wheel step | Scrolls 48 px in the list's own coordinates, then renders the new window |
| Touch drag | The content follows the finger, inverted lists included |
| `scrollEventThrottle` | Android's rule: an event is dropped while the throttle is at least max(17 ms, time since the last) |

## Limits

Animated scrolling is not implemented: a scroll command without `animated`
jumps where RN animates, `animated: true` throws, and so does `scrollToEnd()`
without arguments. Momentum events are never sent. Sticky section headers,
`RefreshControl`/`onRefresh`, `maintainVisibleContentPosition` and scroll
indicators throw when requested. A wheel step on an inverted list moves the
content the opposite way from an ordinary list, as Android's native scroll
views do. Nested lists of the same orientation, `initialScrollIndex`,
`numColumns`, horizontal RTL, the 10,000-row performance acceptance, real touch
hardware and mobile exports require separate acceptance. See the
[research](../../docs/research/virtualized-list.md).
