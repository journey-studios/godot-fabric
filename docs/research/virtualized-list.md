# Virtualized lists on the SDK ScrollView

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/virtualized-list/README.md) owns the 44
headless checks, the preceding-host control (the same bundle fails exactly its 3
normative checks), the preceding-SDK control (11 normative checks) and a
retained sabotage of the ScrollView layout event. Hosted run 37401008543
repeated the 44 checks with identical IDs
([receipt](../evidence/virtualized-list/hosted-ci.json)). Hardware input, mobile
exports and the 10,000-row performance acceptance of GF-15 are not certified.

## What RN does

`index.js` exposes `FlatList`, `SectionList`, `VirtualizedList` and
`VirtualizedSectionList` through lazy getters. The `Libraries/Lists` modules
re-export `@react-native/virtualized-lists`, which ships Flow source. Its
`VirtualizedList` imports `I18nManager`, `Platform`, `RefreshControl`,
`ScrollView`, `StyleSheet`, `View` and `findNodeHandle` from `react-native`, and
`ReactNativeFeatureFlags` by a deep path that RN's package exports do not expose.

- **Windowing** (`Lists/VirtualizeUtils.js`). `computeWindowedRenderLimits`
  targets an overscan range of `(windowSize - 1)` viewports around the visible
  one, with a lead factor of 0.5, and grows the rendered range toward it in
  batches of `maxToRenderPerBatch` every `updateCellsBatchingPeriod`.
  `elementsThatOverlapOffsets` picks the first frame that contains an offset,
  start-inclusive only for the first frame. `VirtualizedList._createRenderMask`
  also keeps the `initialNumToRender` cells mounted ("scroll to top") unless
  `initialScrollIndex` is set; unmounted ranges become spacers sized from the
  frames.
- **Measurement** (`Lists/ListMetricsAggregator.js`). Each cell container reports
  its layout, which includes the separator rendered inside it. Unmeasured cells
  are estimated at the average measured length. Without `getItemLayout` the tail
  spacer stops at the highest measured cell, so the content grows as the window
  measures more of the list; `getItemLayout` replaces all of this.
- **Viewability** (`Lists/ViewabilityHelper.js`). Over the rendered range, a cell
  is viewable when it is entirely visible or when at least the threshold percent
  of it is, with floored edges. `onViewableItemsChanged` reports the new set and
  the changes.
- **Edges** (`VirtualizedList._maybeCallOnEdgeReached`). `onEndReached` fires
  when the rendered range reaches the last item and the distance to the end is
  within `onEndReachedThreshold` viewports, once per content length, and is
  re-armed when the list leaves that distance.
- **Commands.** `scrollToIndex`, `scrollToOffset` and `scrollToEnd` compute an
  offset and call the ScrollView ref's `scrollTo`. Without `getItemLayout`, an
  index beyond the highest measured cell calls `onScrollToIndexFailed` with the
  average length (or fails an invariant without that callback). `scrollToEnd()`
  without arguments asks for an animated scroll.
- **Sections** (`Lists/VirtualizedSectionList.js`). Each section flattens into a
  header cell, its item cells and a footer cell; `scrollToLocation` adds two
  cells per preceding section to `itemIndex`, so `itemIndex` 0 is the header.
  `SectionList` makes headers sticky by default only on iOS, and `FlatList`
  clips subviews by default only on Android.
- **Inversion.** `inverted` applies `scaleY: -1` (outside Android) to the
  ScrollView and again to every cell, and passes `isInvertedVirtualizedList`,
  which only moves Android's scroll bar (`ReactScrollViewManager.kt`).

## The ScrollView contract a list needs

A `VirtualizedList` spreads all of its props onto its ScrollView, adds its own
handlers and calls ScrollView ref methods. RN's `ScrollViewEventEmitter` sends
`ScrollEvent` (`ScrollEvent.cpp`): `contentOffset`, `contentInset`,
`contentSize`, `layoutMeasurement` (the container size), `zoomScale` and
`timestamp` in milliseconds; `UIManagerBinding.cpp` adds `target` and
`timeStamp`. `ScrollEndDragEvent` adds `targetContentOffset` and `velocity`.

| Need | RN | Godot before | Now |
| --- | --- | --- | --- |
| `onScroll` payload | `ScrollEvent` above | original emitter, same payload | unchanged; every key and value verified |
| `scrollEventThrottle` (lists pass 0.0001) | iOS sends when more than the throttle elapsed (at most one frame means every event); Android drops while the throttle is at least max(17 ms, elapsed) | rejected by the SDK ScrollView; never applied | accepted; the host applies Android's rule |
| `onLayout`, `onContentSizeChange` | viewport and content layout | present | unchanged |
| `onScrollBeginDrag`/`onScrollEndDrag` | drag start/end, target offset, velocity | present, velocity 0 | unchanged |
| `onMomentumScrollBegin`/`End` | after a fling | rejected | accepted; never sent: no fling |
| list-only props | ignored by the native view config | "Godot ScrollView data is not implemented" | the 43 props of the list owners that `ScrollViewProps` lacks in the pinned inventory are dropped |
| `stickyHeaderIndices`, `invertStickyHeaders` | sticky headers | rejected | an empty list is accepted; sticky headers throw |
| `maintainVisibleContentPosition`, `refreshControl` | content anchoring, pull to refresh | rejected | throw when requested |
| `removeClippedSubviews`, `isInvertedVirtualizedList` | clipping hint, Android scroll bar | rejected | accepted, ignored: the ScrollContainer clips and shows no bar |
| `showsHorizontal/VerticalScrollIndicator` | indicators, shown by default | rejected | `false` accepted; `true` throws |
| ref `scrollTo`/`scrollToEnd` | `animated` defaults to true | `animated` defaults to false; `true` throws | unchanged |
| ref `getScrollableNode`, `getNativeScrollRef`, `getScrollResponder`, `getInnerViewNode`/`Ref`, `flashScrollIndicators`, zoom and keyboard helpers | added to the native instance by `createRefForwarder` in `ScrollView.js` | missing | added the same way; indicators, zoom and keyboard scrolling throw |
| drag on a flipped ScrollView | native views follow the finger in their own coordinates | page-space deltas: an inverted list moved against the finger | drag points become ScrollContainer-local coordinates |
| `StyleSheet.compose` | `composeStyles` | missing | RN's original |
| `RefreshControl` export | component | missing (the lists import it) | exported as an unavailable placeholder |

## Choices

- **Throttle.** iOS and Android agree for positive throttles: an event is sent
  when more than the throttle elapsed since the last sent one, and a throttle up
  to one 60 Hz frame sends every event. The host implements Android's rule in
  `ScrollAdapter::sample` (`ReactScrollViewHelper.emitScrollEvent`), which also
  sends every event for a negative throttle, where iOS stops after the first. A
  dropped event is not replayed; the drag-end event carries the final offset, as
  on Android.
- **Drag coordinates.** UIKit reports a pan in the scroll view's own coordinate
  space, and Android's `dispatchTransformedTouchEvent` applies the child's
  inverse matrix before `ScrollView.onTouchEvent`. Both move flipped content with
  the finger. The SDK still negotiates the responder with page points; the host
  converts each `scrollDragStart`/`scrollDragTo` point into the ScrollContainer's
  local space before applying it. Untransformed ScrollViews see the same deltas
  as before. Pointer routing in `native/pointer_adapter.*` is unchanged.
- **Wheel.** A wheel step scrolls the ScrollContainer's own offset, as Android's
  `ACTION_SCROLL` does, so on an inverted list it moves the content the opposite
  way from an ordinary list.
- **Commands.** The SDK keeps its ScrollView policy: a scroll command without
  `animated` jumps (RN animates), and `animated: true` throws. Through a list,
  `scrollToIndex({index})` therefore jumps and `scrollToEnd()` throws.
- **Exports.** ESM exports cannot be getters, so `src/lists.js` is a CommonJS
  module with getters that keeps `index.js`'s laziness: the list modules are in
  every bundle but evaluate only when a list is read.
- **Bundling.** The platform plugin transforms the lists package like RN's own
  Flow sources. It resolves `@react-native/virtualized-lists` from RN's location,
  as RN's modules do, and only when first needed, so an SDK without the package
  still bundles. Only importers inside that package resolve the unexported
  feature-flag module; project code keeps RN's package exports.

## Why the probe is discriminating

The [probe](../../tests/virtualized-list-probe.gd) mounts two roots of one
application and drives them with Godot input: wheel steps one frame apart, a
burst of five steps in one frame and touch drags. Root A holds a 120-row
`FlatList` with `getItemLayout`, a header, a footer and pagination in
`onEndReached`; a horizontal `VirtualizedList` over a numeric data source that
measures cells of four widths; and an empty `FlatList`. Root B holds a measured
`SectionList` of 12 sections with separators, a measured inverted `FlatList` and
a public `ScrollView` with `scrollEventThrottle` 150. Native snapshots give the
committed cells and offsets; their Controls give each cell's content position.

The [oracle](../../tests/virtualized-list-oracle.mjs) recomputes from RN's
algorithms and the fixture's declared layout, not from the probe: the exact
settled window and viewable set of every `getItemLayout` stage, the position of
every committed cell (spacers included), the edge events and their distances,
the scroll payload of every event, the flattened offsets of `scrollToLocation`,
the average length in each failure, and, for measured lists, that the viewport
is filled and that no cell outside the overscan range stays mounted. Cells that
left the window come back after the list returns. The sectioned list's last
stage, where every cell around the window is measured, must match the exact
window.

The preceding host runs the same bundle and fails exactly the 3 normative
checks: the inverted list does not follow the finger and five wheel steps send
five scroll events. The preceding SDK (`8f80fed`) bundles the same fixture and
fails the 11 checks that need lists: `FlatList` and `VirtualizedList` throw as
placeholders, `SectionList` is not exported and the ScrollView rejects
`scrollEventThrottle`. A retained SDK whose ScrollView drops `onLayout` leaves
the lists at `initialNumToRender` with no viewable items until the first scroll;
it fails 3 checks, and the oracle rejects its report even with those checks
marked as passed.

## Remaining scope

GF-15's 10,000-row fixture with frame and memory measurements, item identity
and state across data changes beyond appended pages, sticky section headers,
`RefreshControl`/`onRefresh`, `maintainVisibleContentPosition`, animated
scrolling, momentum, `initialScrollIndex`, `numColumns`, nested lists of the
same orientation (`measureLayout`), horizontal RTL, `onStartReached`,
`viewAreaCoveragePercentThreshold` and `minimumViewTime`, keyboard interaction,
real touch hardware and mobile exports remain open. GF-14 owns the full
ScrollView contract.
