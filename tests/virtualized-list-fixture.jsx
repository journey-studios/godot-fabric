import React, {Component, useEffect, useRef, useState} from "react";
import * as ReactNative from "react-native";

const {AppRegistry, ScrollView, View} = ReactNative;
// RN's original lists through the public facade, on two real roots. Every case
// sits in its own error boundary, so an SDK without lists still mounts the
// rest and reports which case failed and why.
const events = [], renderErrors = [], refs = {}, mounts = {};
let sequence = 0;
function record(root, list, type, payload = {}) {
  events.push({sequence: ++sequence, root, list, type, at: Date.now(), ...payload});
}
class Case extends Component {
  state = {error: null};
  static getDerivedStateFromError(error) { return {error}; }
  componentDidCatch(error) {
    renderErrors.push({root: this.props.root, case: this.props.name, message: String(error?.message ?? error)});
  }
  render() { return this.state.error ? null : this.props.children; }
}
function scrolled(root, list) {
  return event => {
    const native = event.nativeEvent;
    record(root, list, "scroll", {x: native.contentOffset.x, y: native.contentOffset.y, timestamp: native.timestamp,
      contentWidth: native.contentSize.width, contentHeight: native.contentSize.height,
      layoutWidth: native.layoutMeasurement.width, layoutHeight: native.layoutMeasurement.height,
      zoomScale: native.zoomScale, inset: native.contentInset, keys: Object.keys(native).sort()});
  };
}
// SectionList tokens carry their section; a header token has a null index.
function viewable(root, list) {
  return ({viewableItems, changed}) => record(root, list, "viewable", {
    viewable: viewableItems.map(token => token.index),
    keys: viewableItems.map(token => (typeof token.key === "string" ? token.key : null)),
    sections: viewableItems.map(token => token.section?.key ?? null),
    changed: changed.map(token => [token.index, token.isViewable, token.section?.key ?? null])});
}
// Drag and momentum events reach the list's own props through VirtualizedList.
function gesture(root, list) {
  const handler = type => event => {
    const native = event.nativeEvent;
    record(root, list, type, {x: native.contentOffset.x, y: native.contentOffset.y, keys: Object.keys(native).sort(),
      velocity: native.velocity ?? null, targetContentOffset: native.targetContentOffset ?? null});
  };
  return {onScrollBeginDrag: handler("beginDrag"), onScrollEndDrag: handler("endDrag"),
    onMomentumScrollBegin: handler("momentumBegin"), onMomentumScrollEnd: handler("momentumEnd")};
}
const box = (left, top, width, height) => ({position: "absolute", left, top, width, height});
const feedRow = 40, feedHeader = 40;
const feedItems = count => Array.from({length: count}, (_, index) => ({id: "feed-" + index, index}));
const shelfWidth = index => 60 + (index % 4) * 20;

// Root A: a FlatList with getItemLayout, a measured horizontal VirtualizedList
// over a non-array data source and an empty FlatList.
function Feed({root}) {
  const list = useRef(null);
  const [count, setCount] = useState(120);
  const appended = useRef(false);
  refs[root + "-feed"] = list;
  return <ReactNative.FlatList ref={list} testID={root + "-feed"} style={box(0, 0, 400, 240)}
    data={feedItems(count)} keyExtractor={item => item.id} initialNumToRender={10} windowSize={5} maxToRenderPerBatch={10}
    getItemLayout={(_, index) => ({length: feedRow, offset: feedHeader + feedRow * index, index})}
    viewabilityConfig={{itemVisiblePercentThreshold: 50}} onViewableItemsChanged={viewable(root, "feed")}
    onEndReachedThreshold={0.5} onEndReached={info => {
      record(root, "feed", "end", {distanceFromEnd: info.distanceFromEnd, count});
      // Pagination: the first end appends a page, as an app loading more would.
      if (!appended.current) {
        appended.current = true;
        setCount(value => value + 30);
      }
    }}
    onScroll={scrolled(root, "feed")}
    ListHeaderComponent={<View testID={root + "-feed-header"} style={{height: feedHeader, backgroundColor: "#0f766e"}} />}
    ListFooterComponent={<View testID={root + "-feed-footer"} style={{height: 40, backgroundColor: "#7c2d12"}} />}
    renderItem={({item}) => <View testID={root + "-feed-" + item.index}
      style={{height: feedRow, backgroundColor: item.index % 2 ? "#334155" : "#1e293b"}} />} />;
}
function Shelf({root}) {
  const list = useRef(null);
  refs[root + "-shelf"] = list;
  return <ReactNative.VirtualizedList ref={list} testID={root + "-shelf"} horizontal style={box(0, 260, 400, 50)}
    data={60} getItemCount={count => count} getItem={(_, index) => ({id: "shelf-" + index, index})}
    keyExtractor={item => item.id} initialNumToRender={6} windowSize={3} onScroll={scrolled(root, "shelf")}
    {...gesture(root, "shelf")}
    onScrollToIndexFailed={info => record(root, "shelf", "failed", info)}
    renderItem={({item}) => <View testID={root + "-shelf-" + item.index}
      style={{width: shelfWidth(item.index), height: 50, backgroundColor: "#1d4ed8"}} />} />;
}
function Empty({root}) {
  return <ReactNative.FlatList testID={root + "-empty"} style={box(0, 330, 400, 100)} data={[]} renderItem={() => null}
    ListHeaderComponent={<View testID={root + "-empty-header"} style={{height: 30, backgroundColor: "#4338ca"}} />}
    ListEmptyComponent={<View testID={root + "-empty-view"} style={{height: 50, backgroundColor: "#a16207"}} />} />;
}

// Root B: a measured SectionList, a measured inverted FlatList and a throttled
// ScrollView.
const agendaSections = Array.from({length: 12}, (_, section) => ({key: "s" + section,
  data: Array.from({length: 6}, (_, item) => "s" + section + "-" + item)}));
function Agenda({root}) {
  const list = useRef(null);
  refs[root + "-agenda"] = list;
  return <ReactNative.SectionList ref={list} testID={root + "-agenda"} style={box(0, 0, 400, 240)} sections={agendaSections}
    keyExtractor={item => item} initialNumToRender={12} windowSize={3}
    viewabilityConfig={{itemVisiblePercentThreshold: 50}} onViewableItemsChanged={viewable(root, "agenda")}
    onScroll={scrolled(root, "agenda")} onScrollToIndexFailed={info => record(root, "agenda", "failed", info)}
    {...gesture(root, "agenda")}
    ItemSeparatorComponent={() => <View style={{height: 2, backgroundColor: "#0f172a"}} />}
    renderSectionHeader={({section}) => <View testID={root + "-agenda-head-" + section.key}
      style={{height: 28, backgroundColor: "#7c3aed"}} />}
    renderItem={({item}) => <View testID={root + "-agenda-" + item} style={{height: 30, backgroundColor: "#475569"}} />} />;
}
const chatRow = 30;
function Chat({root}) {
  return <ReactNative.FlatList testID={root + "-chat"} inverted style={box(0, 260, 400, 150)}
    data={feedItems(40)} keyExtractor={item => item.id} onScroll={scrolled(root, "chat")} {...gesture(root, "chat")}
    renderItem={({item}) => <View testID={root + "-chat-" + item.index}
      style={{height: chatRow, backgroundColor: item.index % 2 ? "#be185d" : "#9d174d"}} />} />;
}
function Ticker({root}) {
  return <ScrollView testID={root + "-ticker"} style={box(0, 430, 400, 80)} scrollEventThrottle={150}
    onScroll={scrolled(root, "ticker")}>
    <View style={{height: 2000, backgroundColor: "#065f46"}} />
  </ScrollView>;
}

function Fixture({name}) {
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
  }, [name]);
  return <View testID={name + "-root"} pointerEvents="box-none" style={{flex: 1, backgroundColor: "#0f172a"}}>
    {name === "A" ? <>
      <Case root={name} name="feed"><Feed root={name} /></Case>
      <Case root={name} name="shelf"><Shelf root={name} /></Case>
      <Case root={name} name="empty"><Empty root={name} /></Case>
    </> : <>
      <Case root={name} name="agenda"><Agenda root={name} /></Case>
      <Case root={name} name="chat"><Chat root={name} /></Case>
      <Case root={name} name="ticker"><Ticker root={name} /></Case>
    </>}
  </View>;
}
AppRegistry.registerComponent("VirtualizedListProbe", () => Fixture);

function command(name, run) {
  const list = refs[name]?.current;
  if (list == null) {
    throw Error("No mounted list " + name);
  }
  run(list);
  return true;
}
globalThis.VirtualizedListProbe = {
  take() { return events.splice(0); },
  renderErrors() { return [...renderErrors]; },
  mounts() { return {...mounts}; },
  scrollToIndex(name, index) { return command(name, list => list.scrollToIndex({index, animated: false})); },
  scrollToOffset(name, offset) { return command(name, list => list.scrollToOffset({offset, animated: false})); },
  scrollToEnd(name) { return command(name, list => list.scrollToEnd({animated: false})); },
  // Without arguments VirtualizedList.scrollToEnd asks for an animated scroll.
  scrollToEndAnimated(name) {
    try {
      command(name, list => list.scrollToEnd());
      return null;
    } catch (error) {
      return String(error?.message ?? error);
    }
  },
  scrollToLocation(name, sectionIndex, itemIndex) {
    return command(name, list => list.scrollToLocation({sectionIndex, itemIndex, animated: false}));
  },
  // The list's own ScrollView ref, as RN's FlatList exposes it.
  scrollRef(name) {
    const list = refs[name]?.current;
    const scroll = list?.getNativeScrollRef?.() ?? list?.getScrollRef?.();
    return {node: list?.getScrollableNode?.() ?? null, ref: scroll?.getScrollableNode?.() ?? null,
      responder: list?.getScrollResponder?.() === scroll, inner: scroll?.getInnerViewNode?.() ?? null,
      methods: ["scrollTo", "scrollToEnd", "getScrollResponder", "getScrollableNode", "getNativeScrollRef", "getInnerViewRef"]
        .filter(method => typeof scroll?.[method] === "function")};
  },
};
