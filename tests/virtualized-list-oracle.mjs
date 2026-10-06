import assert from "node:assert/strict";

// Independent oracle, written from RN 0.87.1's list algorithms and from the
// layout the fixture declares rather than from the probe: VirtualizeUtils'
// elementsThatOverlapOffsets and computeWindowedRenderLimits, the render mask
// and edge rules of VirtualizedList, ViewabilityHelper's percent rule, the
// flattening of VirtualizedSectionList, RN's ScrollEvent payload and
// ReactScrollViewHelper's throttle. verifyVirtualizedListReport throws on any
// difference.

// RN's ScrollEvent (ScrollEvent.cpp) plus the target and timeStamp that
// UIManagerBinding.cpp adds; ScrollEndDragEvent adds its target and velocity.
const scrollKeys = ["contentInset", "contentOffset", "contentSize", "layoutMeasurement", "target", "timeStamp",
  "timestamp", "zoomScale"];
const endDragKeys = ["contentInset", "contentOffset", "contentSize", "layoutMeasurement", "target",
  "targetContentOffset", "timeStamp", "timestamp", "velocity", "zoomScale"];
const wheel = 48;
// The fixture's lists. Unset props take VirtualizedList's defaults.
const feed = {visible: 240, width: 400, header: 40, row: 40, footer: 40, initial: 10, windowSize: 5, batch: 10,
  threshold: 50, endThreshold: 0.5, count: 120, page: 30};
const shelf = {visible: 400, height: 50, initial: 6, windowSize: 3, batch: 10, count: 60};
const agenda = {visible: 240, initial: 12, windowSize: 3, batch: 10, sections: 12, items: 6, header: 28, row: 30,
  separator: 2, threshold: 50};
const chat = {count: 40, row: 30};
const throttle = 150;

const range = (first, last) => Array.from({length: Math.max(0, last - first + 1)}, (_, index) => first + index);
const byNumber = (left, right) => left - right;
function near(actual, expected, message) {
  assert.ok(typeof actual === "number" && Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);
}

// getItemLayout frames of the feed: its offsets include the 40 px header.
const feedFrames = count => range(0, count - 1).map(index => ({id: String(index), offset: feed.header + feed.row * index,
  length: feed.row, view: feed.row}));
// The shelf measures its cells; these are the widths the fixture renders.
function shelfFrames() {
  let offset = 0;
  return range(0, shelf.count - 1).map(index => {
    const length = 60 + (index % 4) * 20;
    const frame = {id: String(index), offset, length, view: length};
    offset += length;
    return frame;
  });
}
// VirtualizedSectionList flattens each section into a header cell, item cells
// and a footer cell. ItemSeparatorComponent renders after every item but a
// section's last, inside its cell; without renderSectionFooter the footer cell
// is empty and has no testID.
function agendaFrames() {
  const frames = [];
  let offset = 0;
  const push = (id, section, index, length, view) => {
    frames.push({id, section, index, offset, length, view});
    offset += length;
  };
  for (let section = 0; section < agenda.sections; section++) {
    push("head-s" + section, "s" + section, null, agenda.header, agenda.header);
    for (let item = 0; item < agenda.items; item++) {
      const separator = item < agenda.items - 1 ? agenda.separator : 0;
      push(`s${section}-${item}`, "s" + section, item, agenda.row + separator, agenda.row);
    }
    push(null, "s" + section, null, 0, 0);
  }
  return frames;
}
// A SectionList token is section-relative; a header token has a null index.
function flatIndex(index, section) {
  if (section == null) {
    return index;
  }
  return Number(section.slice(1)) * (agenda.items + 2) + (index == null ? 0 : index + 1);
}

// VirtualizeUtils.elementsThatOverlapOffsets for one offset: the first frame
// containing it, start-inclusive only for frame 0. An empty frame never matches.
function overlap(frames, offset) {
  let left = 0;
  let right = frames.length - 1;
  while (left <= right) {
    const middle = left + Math.floor((right - left) / 2);
    const frame = frames[middle];
    if ((middle === 0 && offset < frame.offset) || (middle !== 0 && offset <= frame.offset)) {
      right = middle - 1;
    } else if (offset > frame.offset + frame.length) {
      left = middle + 1;
    } else {
      return middle;
    }
  }
  return undefined;
}

// computeWindowedRenderLimits once its batches have filled the overscan range
// ((windowSize - 1) viewports, lead factor 0.5), with the initialNumToRender
// cells that VirtualizedList._createRenderMask keeps without initialScrollIndex.
function overscan(offset, spec) {
  const length = (spec.windowSize - 1) * spec.visible;
  const begin = Math.max(0, offset);
  return {begin: Math.max(0, begin - 0.5 * length), end: Math.max(0, begin + spec.visible + 0.5 * length)};
}
function settledWindow(frames, offset, spec) {
  const count = frames.length;
  const {begin, end} = overscan(offset, spec);
  let first = overlap(frames, begin) ?? 0;
  let last = overlap(frames, end) ?? count - 1;
  if (frames[count - 1].offset < begin) {
    first = Math.max(0, count - 1 - spec.batch);
    last = count - 1;
  }
  return [...new Set([...range(0, Math.min(count, spec.initial) - 1), ...range(first, last)])].sort(byNumber);
}

// ViewabilityHelper.computeViewableItems with itemVisiblePercentThreshold: an
// item is viewable when entirely visible or when that percent of it is.
function viewableAt(frames, offset, viewport, threshold) {
  const viewable = [];
  let firstVisible = -1;
  for (let index = 0; index < frames.length; index++) {
    const top = Math.floor(frames[index].offset - offset);
    const bottom = Math.floor(top + frames[index].length);
    if (top < viewport && bottom > 0) {
      firstVisible = index;
      const entirely = top >= 0 && bottom <= viewport && bottom > top;
      const pixels = Math.max(0, Math.min(bottom, viewport) - Math.max(top, 0));
      if (entirely || (100 * pixels) / frames[index].length >= threshold) {
        viewable.push(index);
      }
    } else if (firstVisible >= 0) {
      break;
    }
  }
  return viewable;
}

const recordsOf = (records, list, type) => records.filter(row => row.list === list && row.type === type);
const axisOf = list => (list === "shelf" ? "x" : "y");

// Replays one list's records in order: every onViewableItemsChanged reports
// items viewable at the latest offset JS received (RN only scans the rendered
// range, so a report may hold fewer), and its changes are exactly the
// difference to the previous report.
function replayViewability(records, list, frames, viewport, threshold, state) {
  for (const record of records.filter(row => row.list === list)) {
    if (record.type === "scroll") {
      state.offset = record[axisOf(list)];
    }
    if (record.type !== "viewable") {
      continue;
    }
    const now = record.viewable.map((index, position) => flatIndex(index, record.sections[position]));
    const expected = viewableAt(frames, state.offset, viewport, threshold);
    assert.ok(now.every(index => expected.includes(index)), `${list} viewable ${now} at ${state.offset}`);
    const changed = record.changed.map(([index, isViewable, section]) => [flatIndex(index, section), isViewable]);
    const difference = [...state.viewable.filter(index => !now.includes(index)).map(index => [index, false]),
      ...now.filter(index => !state.viewable.includes(index)).map(index => [index, true])];
    assert.deepEqual(changed.sort((left, right) => left[0] - right[0]), difference.sort((left, right) => left[0] - right[0]));
    state.viewable = now;
  }
}

// Committed cells sit where their frames say: the spacers VirtualizedList
// renders for unmounted ranges keep every cell at its offset.
function verifyPlacement(stage, list, frames) {
  const byId = new Map(frames.filter(frame => frame.id != null).map(frame => [frame.id, frame]));
  for (const [id, span] of Object.entries(stage.lists[list].spans)) {
    if (!byId.has(id)) {
      continue;
    }
    near(span[0], byId.get(id).offset, `${list} ${id} start`);
    near(span[1], byId.get(id).view, `${list} ${id} length`);
  }
}
// Flat indices of the committed cells that carry a testID.
function committed(stage, list, frames) {
  const ids = new Set(stage.lists[list].ids);
  return frames.flatMap((frame, index) => (frame.id != null && ids.has(frame.id) ? [index] : []));
}
// RN's guarantees for a measured window: the visible range is filled, and no
// committed cell outside the initial region lies beyond the overscan range;
// cells after the viewport may use estimated lengths, so allow one cell there.
function verifyMeasuredWindow(stage, list, frames, spec, offset) {
  const cells = committed(stage, list, frames);
  let reached = offset;
  for (const index of cells) {
    if (frames[index].offset <= reached + agenda.separator + 0.5) {
      reached = Math.max(reached, frames[index].offset + frames[index].length);
    }
  }
  assert.ok(reached >= Math.min(offset + spec.visible, frames.at(-1).offset + frames.at(-1).length) - 0.5,
    `${list} fills its viewport at ${offset}`);
  const {begin, end} = overscan(offset, spec);
  const slack = Math.max(...frames.map(frame => frame.length));
  for (const index of cells.filter(cell => cell >= spec.initial)) {
    assert.ok(frames[index].offset + frames[index].length >= begin && frames[index].offset <= end + slack,
      `${list} cell ${index} lies outside the window at ${offset}`);
  }
  return cells;
}

// Every scroll record carries RN's payload; offsets, when given, are exact.
function verifyScrollRecords(records, list, offsets, size) {
  const scrolls = recordsOf(records, list, "scroll");
  if (offsets != null) {
    assert.deepEqual(scrolls.map(row => row[axisOf(list)]), offsets, `${list} scroll offsets`);
  }
  for (const row of scrolls) {
    assert.deepEqual(row.keys, scrollKeys);
    assert.deepEqual(row.inset, {top: 0, left: 0, bottom: 0, right: 0});
    assert.equal(row.zoomScale, 1);
    assert.equal(row[axisOf(list) === "x" ? "y" : "x"], 0);
    if (size != null) {
      assert.deepEqual([row.layoutWidth, row.layoutHeight, row.contentWidth, row.contentHeight], size);
    }
  }
}

// One onScrollBeginDrag before the drag's scroll events and one onScrollEndDrag
// after them, with ScrollEndDragEvent's target offset and no fling velocity.
function verifyDrag(records, list, from, to) {
  const axis = axisOf(list);
  const [begin, ...extraBegins] = recordsOf(records, list, "beginDrag");
  const [end, ...extraEnds] = recordsOf(records, list, "endDrag");
  assert.ok(begin != null && end != null && extraBegins.length === 0 && extraEnds.length === 0, `${list} drag events`);
  assert.deepEqual(begin.keys, scrollKeys);
  assert.deepEqual(end.keys, endDragKeys);
  assert.equal(begin[axis], from);
  assert.equal(end[axis], to);
  assert.equal(end.targetContentOffset[axis], to);
  assert.deepEqual(end.velocity, {x: 0, y: 0});
  for (const row of recordsOf(records, list, "scroll")) {
    assert.ok(begin.sequence < row.sequence && row.sequence < end.sequence, `${list} scroll inside its drag`);
  }
}

function verifyFeed(stages, state) {
  const frames = feedFrames(feed.count + feed.page);
  const size = (count, contentWidth = feed.width) => [feed.width, feed.visible, contentWidth,
    feed.header + count * feed.row + feed.footer];
  const end = count => feed.header + count * feed.row + feed.footer - feed.visible;
  const plan = [
    ["mount", 0, feed.count, []],
    ["feed/wheel", 6 * wheel, feed.count, range(1, 6).map(step => step * wheel)],
    ["feed/index", feed.header + 60 * feed.row, feed.count, [feed.header + 60 * feed.row]],
    ["feed/end", end(feed.count), feed.count + feed.page, [end(feed.count)]],
    ["feed/end-again", end(feed.count + feed.page), feed.count + feed.page, [end(feed.count + feed.page)]],
    ["feed/top", 0, feed.count + feed.page, [0]],
  ];
  for (const [name, offset, count, scrolls] of plan) {
    const stage = stages[name];
    assert.equal(stage.offsets.feed.y, offset, `${name}: feed offset`);
    verifyScrollRecords(stage.events, "feed", scrolls, name === "feed/wheel" ? size(feed.count) : null);
    // RN's scrollToIndex/scrollToEnd offsets come from getItemLayout and the
    // measured footer; the window is computeWindowedRenderLimits' fixed point.
    assert.deepEqual(stage.lists.feed.rendered, settledWindow(feedFrames(count), offset, feed), `${name}: feed window`);
    verifyPlacement(stage, "feed", frames);
    const ids = stage.lists.feed.ids;
    assert.ok(ids.includes("header") && ids.includes("footer"), name);
    near(stage.lists.feed.spans.header[0], 0, name);
    near(stage.lists.feed.spans.footer[0], feed.header + count * feed.row, name);
    replayViewability(stage.events, "feed", frames, feed.visible, feed.threshold, state);
    assert.deepEqual(state.viewable, viewableAt(feedFrames(count), offset, feed.visible, feed.threshold), `${name}: feed viewable`);
    // onEndReached: only when the window reaches the last item and the
    // distance to the end is within the threshold, once per content length.
    const ends = recordsOf(stage.events, "feed", "end");
    if (name === "feed/end" || name === "feed/end-again") {
      const before = name === "feed/end" ? feed.count : feed.count + feed.page;
      assert.equal(ends.length, 1, name);
      const distance = feed.header + before * feed.row + feed.footer - feed.visible - offset;
      assert.ok(distance <= feed.endThreshold * feed.visible, name);
      assert.deepEqual([ends[0].distanceFromEnd, ends[0].count], [Math.max(0, distance), before], name);
    } else {
      assert.equal(ends.length, 0, name);
    }
  }
  // scrollToEnd() without arguments asks the ScrollView for RN's animated
  // scroll, which the host does not implement: it fails instead of jumping.
  assert.match(stages["feed/top"].animated, /requires finite coordinates and animated: false/);
  // Cells outside the window unmount and come back.
  assert.ok(!stages["feed/index"].lists.feed.rendered.includes(30) && stages["feed/top"].lists.feed.rendered.includes(16));
  assert.ok(stages["feed/end"].lists.feed.rendered.includes(120) && !stages["feed/top"].lists.feed.rendered.includes(120));
}

function verifyShelf(stages) {
  const frames = shelfFrames();
  const mount = stages.mount;
  verifyPlacement(mount, "shelf", frames);
  const before = verifyMeasuredWindow(mount, "shelf", frames, shelf, 0);
  const drag = stages["shelf/drag"];
  verifyDrag(drag.events, "shelf", 0, 180);
  verifyScrollRecords(drag.events, "shelf", null, null);
  const steps = recordsOf(drag.events, "shelf", "scroll").map(row => row.x);
  assert.ok(steps.length > 0 && steps.at(-1) === 180 && steps.every((x, index) => index === 0 || x > steps[index - 1]));
  for (const row of recordsOf(drag.events, "shelf", "scroll")) {
    assert.deepEqual([row.layoutWidth, row.layoutHeight, row.contentHeight], [shelf.visible, shelf.height, shelf.height]);
  }
  assert.equal(drag.offsets.shelf.x, 180);
  verifyPlacement(drag, "shelf", frames);
  const after = verifyMeasuredWindow(drag, "shelf", frames, shelf, 180);
  assert.ok(Math.max(...after) > Math.max(...before), "The measured window grows in the scroll direction");
  // scrollToIndex of a measured cell: its measured offset.
  assert.equal(stages["shelf/index"].offsets.shelf.x, frames[4].offset);
  verifyPlacement(stages["shelf/index"], "shelf", frames);
  // Beyond the measured cells, without getItemLayout: onScrollToIndexFailed
  // with the measured average, and no scroll.
  const unmeasured = stages["shelf/unmeasured"];
  const [failure, ...extra] = recordsOf(unmeasured.events, "shelf", "failed");
  assert.ok(failure != null && extra.length === 0);
  const highest = failure.highestMeasuredFrameIndex;
  const seen = Math.max(...["mount", "shelf/drag", "shelf/index", "shelf/unmeasured"].flatMap(name => stages[name].lists.shelf.rendered));
  assert.ok(failure.index === 50 && highest >= seen && highest < 50);
  near(failure.averageItemLength, frames.slice(0, highest + 1).reduce((sum, frame) => sum + frame.length, 0) / (highest + 1),
    "averageItemLength");
  assert.equal(recordsOf(unmeasured.events, "shelf", "scroll").length, 0);
  assert.equal(unmeasured.offsets.shelf.x, frames[4].offset);
}

function verifyAgenda(stages, state) {
  const frames = agendaFrames();
  const scan = (stage, offset) => {
    verifyPlacement(stage, "agenda", frames);
    verifyScrollRecords(stage.events, "agenda", null, null);
    replayViewability(stage.events, "agenda", frames, agenda.visible, agenda.threshold, state);
    return verifyMeasuredWindow(stage, "agenda", frames, agenda, offset);
  };
  const final = (name, offset) => assert.deepEqual(state.viewable, viewableAt(frames, offset, agenda.visible, agenda.threshold),
    `${name}: agenda viewable`);
  scan(stages.mount, 0);
  final("mount", 0);
  const drag = stages["agenda/drag"];
  verifyDrag(drag.events, "agenda", 0, 150);
  assert.equal(drag.offsets.agenda.y, 150);
  scan(drag, 150);
  final("agenda/drag", 150);
  // scrollToLocation(1, 2) is scrollToIndex of flat index 2 + 1 * (6 + 2).
  const location = stages["agenda/location"];
  assert.equal(location.offsets.agenda.y, frames[10].offset);
  assert.equal(frames[10].id, "s1-1");
  scan(location, frames[10].offset);
  final("agenda/location", frames[10].offset);
  const unmeasured = stages["agenda/unmeasured"];
  const [failure, ...extra] = recordsOf(unmeasured.events, "agenda", "failed");
  assert.ok(failure != null && extra.length === 0);
  const highest = failure.highestMeasuredFrameIndex;
  const seen = Math.max(...["mount", "agenda/drag", "agenda/location"].flatMap(name => committed(stages[name], "agenda", frames)));
  assert.ok(failure.index === 2 + 10 * (agenda.items + 2) && highest >= seen && highest < failure.index);
  near(failure.averageItemLength, frames.slice(0, highest + 1).reduce((sum, frame) => sum + frame.length, 0) / (highest + 1),
    "averageItemLength");
  assert.equal(unmeasured.offsets.agenda.y, frames[10].offset);
  // Wheel steps: the cells above the overscan range unmount; RN measured them,
  // so the first one in the window is exact.
  const far = stages["agenda/far"];
  const offset = far.offsets.agenda.y;
  assert.ok(offset >= 760);
  const steps = recordsOf(far.events, "agenda", "scroll").map(row => row.y);
  assert.ok(steps.at(-1) === offset && steps.every((y, index) => index === 0 || y > steps[index - 1]));
  const cells = scan(far, offset);
  final("agenda/far", offset);
  const windowed = cells.filter(cell => cell >= agenda.initial);
  assert.equal(windowed[0], overlap(frames, overscan(offset, agenda).begin));
  assert.deepEqual(cells.filter(cell => cell < agenda.initial), range(0, agenda.initial - 1).filter(cell => frames[cell].id != null));
  assert.ok(!far.lists.agenda.ids.includes("s1-3"));
  // Back at the top every cell around the window is measured: exact window.
  const back = stages["agenda/back"];
  assert.equal(back.offsets.agenda.y, 0);
  scan(back, 0);
  final("agenda/back", 0);
  assert.deepEqual(committed(back, "agenda", frames),
    settledWindow(frames, 0, agenda).filter(cell => frames[cell].id != null));
  assert.ok(back.lists.agenda.ids.includes("s1-3"));
}

function verifyChat(stages) {
  const mount = stages.mount.chat;
  assert.deepEqual(mount.rendered, range(0, chat.count - 1), "An inverted list renders its whole short window");
  near(mount.first[1], mount.list[1], "The first item sits at the bottom");
  near(mount.second[1], mount.first[0], "The second item sits above the first");
  const drag = stages["chat/drag"];
  verifyDrag(drag.events, "chat", 0, 60);
  verifyScrollRecords(drag.events, "chat", null, [400, 150, 400, chat.count * chat.row]);
  assert.equal(drag.offsets.chat.y, 60);
  near(drag.after - drag.before, 60, "The inverted content follows the finger");
  const scrolled = stages["chat/wheel"];
  assert.equal(scrolled.offsets.chat.y, 60 + wheel);
  near(scrolled.after - scrolled.before, wheel, "A wheel step scrolls in the list's own coordinates");
}

// ReactScrollViewHelper (Android): drop a scroll event while
// scrollEventThrottle >= max(17 ms, time since the last sent one).
function verifyTicker(stages) {
  const burst = stages["ticker/burst"];
  assert.deepEqual(burst.events.map(row => row.y), [wheel]);
  assert.deepEqual([burst.offsets.ticker.y, burst.offsets.ticker.scrolls, burst.offsets.ticker.throttled,
    burst.offsets.ticker.throttle], [5 * wheel, 1, 4, throttle]);
  const after = stages["ticker/after"];
  assert.deepEqual(after.events.map(row => row.y), [6 * wheel]);
  assert.ok(after.events[0].timestamp - burst.events[0].timestamp > throttle);
  assert.deepEqual([after.offsets.ticker.y, after.offsets.ticker.scrolls, after.offsets.ticker.throttled],
    [6 * wheel, 2, 4]);
}

export function verifyVirtualizedListReport(report) {
  assert.equal(report.scenario, "native-virtualized-list");
  assert.equal(report.reactNative, "0.87.1");
  assert.deepEqual(report.renderErrors, []);
  assert.ok(report.checks.length > 0 && report.checks.every(row => row.passed));
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  const stages = report.stages;
  const sequences = report.events.map(row => row.sequence);
  assert.ok(sequences.every((sequence, index) => index === 0 || sequence > sequences[index - 1]));
  // Two roots in one runtime; input on one never moves the other's lists.
  for (const list of ["agenda", "chat", "ticker"]) {
    assert.equal(stages["feed/wheel"].offsets[list].y, stages.mount.offsets[list].y);
  }
  assert.equal(stages["chat/drag"].offsets.feed.y, stages["agenda/back"].offsets.feed.y);
  assert.equal(stages["chat/drag"].offsets.shelf.x, stages["agenda/back"].offsets.shelf.x);
  // FlatList's ScrollView ref is RN's ScrollView instance contract.
  const reference = stages.mount.ref;
  assert.deepEqual([reference.node, reference.ref, reference.inner, reference.responder],
    [stages.mount.tags.feed, stages.mount.tags.feed, stages.mount.tags.content, true]);
  assert.deepEqual(reference.methods, ["scrollTo", "scrollToEnd", "getScrollResponder", "getScrollableNode",
    "getNativeScrollRef", "getInnerViewRef"]);
  assert.deepEqual(stages.mount.empty.ids, ["header", "view"], "ListEmptyComponent after the header");
  verifyFeed(stages, {offset: 0, viewable: []});
  verifyShelf(stages);
  verifyAgenda(stages, {offset: 0, viewable: []});
  verifyChat(stages);
  verifyTicker(stages);
  // The host has no fling: no momentum event ever reaches a list.
  assert.equal(report.events.filter(row => row.type.startsWith("momentum")).length, 0);
  const stopped = stages.afterStop;
  assert.ok(stopped.stopped && stopped.rootCount === 0 && stopped.pendingTimers === 0);
  assert.deepEqual(stopped.errors, []);
}
