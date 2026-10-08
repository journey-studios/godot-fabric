extends SceneTree

# RN's original FlatList, VirtualizedList and SectionList on the SDK ScrollView,
# on two real roots, driven by actual Godot mouse wheel and touch drag input.
# JS records what the lists report; native snapshots show which cells exist and
# where they sit. --allow-original-negative runs the same bundle on the
# preceding host; --lane preceding-sdk and --lane sabotage run other SDK bundles.
const DEVICE := 1001
const SIZE := Vector2(400, 520)
const ORIGINS := {"A": Vector2.ZERO, "B": Vector2(420, 0)}
const CASES := {"A": ["feed", "shelf", "empty"], "B": ["agenda", "chat", "ticker"]}
const LIST_ROOTS := {"feed": "A", "shelf": "A", "agenda": "B", "chat": "B", "ticker": "B"}
const LANES := ["current", "preceding-sdk", "sabotage"]
const FEED_VISIBLE := 240.0
const FEED_ROW := 40.0
const FEED_HEADER := 40.0
const FEED_FOOTER := 40.0
const WHEEL := 48.0
# RN's ScrollEvent payload (ScrollEvent.cpp) with the target and timeStamp that
# UIManagerBinding.cpp adds to every event; ScrollEndDragEvent adds two keys.
const SCROLL_KEYS := ["contentInset", "contentOffset", "contentSize", "layoutMeasurement", "target", "timeStamp",
  "timestamp", "zoomScale"]
const END_DRAG_KEYS := ["contentInset", "contentOffset", "contentSize", "layoutMeasurement", "target",
  "targetContentOffset", "timeStamp", "timestamp", "velocity", "zoomScale"]
var lane := "current"
var allow_original_negative := false
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var events: Array = []
var normative: Array = []
var preceding_sdk: Array = []

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# Fails on the preceding host, which drags in page coordinates and sends every
# scroll event whatever scrollEventThrottle says.
func host_check(condition: bool, name: String) -> bool:
  normative.append(name)
  return check(condition, name)

# Fails on the preceding SDK, whose public facade has no lists.
func sdk_check(condition: bool, name: String) -> bool:
  preceding_sdk.append(name)
  return check(condition, name)

func number(value: Variant, fallback: float = -1.0) -> float:
  return float(value) if value is float or value is int else fallback

func settle(count: int = 8) -> void:
  for index in range(count):
    await process_frame

func native(owner: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(owner.call("snapshot"))
  return value if value is Dictionary else {}

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(VirtualizedListProbe." + expression + ")"))

# Records since the previous take; the report keeps all of them in order.
func take() -> Array:
  var value: Variant = js("take()")
  var taken: Array = value if value is Array else []
  events.append_array(taken)
  return taken

func nodes(root_name: String) -> Array:
  var value: Variant = native(surfaces[root_name]).get("nodes")
  return value if value is Array else []

func node_of(root_name: String, id: String) -> Dictionary:
  for entry: Dictionary in nodes(root_name):
    if str(entry.get("testID", "")) == root_name + "-" + id:
      return entry
  return {}

func scroll(root_name: String, list: String) -> Dictionary:
  var value: Variant = node_of(root_name, list).get("scroll")
  return value if value is Dictionary else {}

func offset(root_name: String, list: String) -> float:
  return number(scroll(root_name, list).get("x" if list == "shelf" else "y"))

# abs(): a flipped Control (an inverted list) has a negative global scale.
func rect(root_name: String, id: String) -> Rect2:
  var found: Node = surfaces[root_name].find_child(root_name + "-" + id, true, false)
  return found.get_global_rect().abs() if found is Control else Rect2(-1000, -1000, 0, 0)

# The ids of a list's committed cells: testIDs root-list-<id>.
func ids_in(entries: Array, root_name: String, list: String) -> Array:
  var prefix := root_name + "-" + list + "-"
  var out: Array = []
  for entry: Dictionary in entries:
    var id := str(entry.get("testID", ""))
    if id.begins_with(prefix) and id.substr(prefix.length()) != "content":
      out.append(id.substr(prefix.length()))
  out.sort()
  return out

func ids(root_name: String, list: String) -> Array:
  return ids_in(nodes(root_name), root_name, list)

func rendered(root_name: String, list: String) -> Array:
  var out: Array = []
  for id: String in ids(root_name, list):
    if id.is_valid_int():
      out.append(int(id))
  out.sort()
  return out

# Content-space [start, length] of each committed cell along the list's axis.
func spans(root_name: String, list: String) -> Dictionary:
  var horizontal := list == "shelf"
  var viewport_node: Node = surfaces[root_name].find_child(root_name + "-" + list, true, false)
  if not viewport_node is Control:
    return {}
  var viewport := viewport_node as Control
  var inverse := viewport.get_global_transform_with_canvas().affine_inverse()
  var scroll_offset := offset(root_name, list)
  var out := {}
  for id: String in ids(root_name, list):
    var node: Node = surfaces[root_name].find_child(root_name + "-" + list + "-" + id, true, false)
    if not node is Control:
      continue
    var cell := node as Control
    # The ScrollContent node has no public testID in RN's original component.
    # Convert mounted cell origins to the actual ScrollView viewport and add
    # the logical offset; this fixture's Yoga content origin is zero.
    var viewport_position := inverse * cell.get_global_transform_with_canvas().origin
    out[id] = ([viewport_position.x + scroll_offset, cell.size.x] if horizontal
      else [viewport_position.y + scroll_offset, cell.size.y])
  return out

# Waits until a list's committed cells and offset have not changed for 250 ms:
# RN renders its window in batches 50 ms apart after each scroll or layout.
func quiet(root_name: String, list: String) -> void:
  var last := ""
  var start := Time.get_ticks_msec()
  var changed := start
  var frames := 0
  while Time.get_ticks_msec() - start < 6000:
    await process_frame
    frames += 1
    var entries := nodes(root_name)
    var state: Variant = {}
    for entry: Dictionary in entries:
      if str(entry.get("testID", "")) == root_name + "-" + list:
        state = entry.get("scroll", {})
    var current := str(ids_in(entries, root_name, list)) + "@" + str(state)
    if current != last:
      last = current
      changed = Time.get_ticks_msec()
      frames = 0
    elif frames >= 10 and Time.get_ticks_msec() - changed >= 250:
      return

func wheel_step(at: Vector2) -> void:
  var event := InputEventMouseButton.new()
  event.device = DEVICE
  event.position = at
  event.button_index = MOUSE_BUTTON_WHEEL_DOWN
  event.pressed = true
  event.factor = 1
  Input.parse_input_event(event)

# One wheel step per frame, as a turning wheel sends them.
func wheel(at: Vector2, count: int) -> void:
  for index in range(count):
    wheel_step(at)
    await process_frame

# Wheel steps inside one frame: the host handles them microseconds apart.
func burst(at: Vector2, count: int) -> void:
  for index in range(count):
    wheel_step(at)
  await process_frame

func touch(at: Vector2, pressed: bool) -> void:
  var contact := InputEventScreenTouch.new()
  contact.device = DEVICE
  contact.index = 0
  contact.position = at
  contact.pressed = pressed
  Input.parse_input_event(contact)

func move(at: Vector2) -> void:
  var motion := InputEventScreenDrag.new()
  motion.device = DEVICE
  motion.index = 0
  motion.position = at
  Input.parse_input_event(motion)

# A finger drag in steps: down, moves two frames apart, up at the end point.
func drag(from: Vector2, delta: Vector2, steps: int = 6) -> void:
  touch(from, true)
  await settle(3)
  for step in range(1, steps + 1):
    move(from + delta * step / steps)
    await settle(2)
  # Keep the historical list offsets deterministic. The dedicated ScrollView
  # probe covers flings; these consumer gestures intentionally release after
  # the measured-velocity window has expired.
  var terminal := from + delta
  var stationary_since := Time.get_ticks_usec()
  while Time.get_ticks_usec() - stationary_since < 350_000:
    move(terminal)
    await process_frame
  touch(terminal, false)
  await settle(4)

# RN's elementsThatOverlapOffsets on the feed's getItemLayout frames: the first
# frame containing the offset, start-inclusive only for the first frame.
func feed_overlap(point: float, count: int) -> int:
  for index in range(count):
    var start := FEED_HEADER + FEED_ROW * index
    if (point >= start if index == 0 else point > start) and point <= start + FEED_ROW:
      return index
  return -1

# The settled cells of RN's computeWindowedRenderLimits for windowSize 5, plus
# the initialNumToRender cells VirtualizedList keeps mounted.
func feed_window(at: float, count: int) -> Array:
  var overscan := 4.0 * FEED_VISIBLE
  var first := feed_overlap(maxf(0.0, at - 0.5 * overscan), count)
  var last := feed_overlap(maxf(0.0, at + FEED_VISIBLE + 0.5 * overscan), count)
  first = 0 if first < 0 else first
  last = count - 1 if last < 0 else last
  var cells: Array = range(10)
  for index in range(first, last + 1):
    if not index in cells:
      cells.append(index)
  cells.sort()
  return cells

# Items RN's ViewabilityHelper calls viewable with itemVisiblePercentThreshold 50.
func feed_viewable(at: float, count: int) -> Array:
  var out: Array = []
  for index in range(count):
    var top := FEED_HEADER + FEED_ROW * index - at
    var bottom := top + FEED_ROW
    var visible := minf(bottom, FEED_VISIBLE) - maxf(top, 0.0)
    if (top >= 0.0 and bottom <= FEED_VISIBLE) or visible >= FEED_ROW * 0.5:
      out.append(index)
  return out

func of(taken: Array, list: String, type: String) -> Array:
  return taken.filter(func(entry: Dictionary) -> bool: return entry.get("list") == list and entry.get("type") == type)

func last_of(taken: Array, list: String, type: String) -> Dictionary:
  var found := of(taken, list, type)
  return found[-1] if not found.is_empty() else {}

func ints(values: Variant) -> Array:
  var out: Array = []
  if values is Array:
    for value: Variant in values:
      out.append(int(number(value)))
  return out

# Every viewable event's changes are exactly the difference to the previous set.
func consistent_changes(taken: Array, previous: Array) -> bool:
  var before := previous.duplicate()
  for entry: Dictionary in taken:
    var now := ints(entry.get("viewable"))
    var expected: Array = []
    for index: int in before:
      if not index in now:
        expected.append([index, false])
    for index: int in now:
      if not index in before:
        expected.append([index, true])
    var changed: Array = []
    for pair: Variant in entry.get("changed", []):
      changed.append([int(number(pair[0])), pair[1]])
    expected.sort_custom(func(left: Array, right: Array) -> bool: return left[0] < right[0])
    changed.sort_custom(func(left: Array, right: Array) -> bool: return left[0] < right[0])
    if changed != expected:
      return false
    before = now
  return true

# Historic list gestures release after a stationary hold, so they retain the
# exact terminal offsets and do not exercise the dedicated fling contract.
func dragged(taken: Array, list: String, from: float, to: float) -> bool:
  var begins := of(taken, list, "beginDrag")
  var ends := of(taken, list, "endDrag")
  if begins.size() != 1 or ends.size() != 1:
    return false
  var axis := "x" if list == "shelf" else "y"
  var end: Dictionary = ends[0]
  var target: Variant = end.get("targetContentOffset")
  var velocity: Variant = end.get("velocity")
  return (begins[0].get("keys") == SCROLL_KEYS and end.get("keys") == END_DRAG_KEYS
    and is_equal_approx(number(begins[0].get(axis)), from) and is_equal_approx(number(end.get(axis)), to)
    and target is Dictionary and is_equal_approx(number(target.get(axis)), to)
    and velocity is Dictionary and number(velocity.get("x")) == 0.0 and number(velocity.get("y")) == 0.0
    and of(taken, list, "momentumBegin").is_empty() and of(taken, list, "momentumEnd").is_empty())

# The committed cells cover [at, at + length] with no gap wider than a 2 px
# separator, which has no testID.
func covers(cell_spans: Dictionary, at: float, length: float) -> bool:
  var sorted: Array = cell_spans.values()
  sorted.sort_custom(func(left: Array, right: Array) -> bool: return left[0] < right[0])
  var reached := at
  for span: Array in sorted:
    if span[0] > reached + 2.5:
      break
    reached = maxf(reached, span[0] + span[1])
  return reached >= at + length - 0.5

func stage(name: String, detailed: Array, extra: Dictionary = {}) -> Dictionary:
  var value := {"offsets": {}, "lists": {}}
  for list: String in LIST_ROOTS:
    value.offsets[list] = scroll(LIST_ROOTS[list], list)
  for list: String in detailed:
    var root_name: String = LIST_ROOTS[list]
    value.lists[list] = {"ids": ids(root_name, list), "rendered": rendered(root_name, list), "spans": spans(root_name, list)}
  value.merge(extra)
  stages[name] = value
  return value

func mount_surface(root_name: String) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = root_name
  surface.position = ORIGINS[root_name]
  surface.size = SIZE
  surface.set("application_path", NodePath("../VirtualizedListApplication"))
  surface.set("component_name", "VirtualizedListProbe")
  surface.set("initial_props", {"name": root_name})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[root_name] = surface
  root.add_child(surface)

func mount_case() -> Array:
  var app := native(application)
  check((int(number(app.get("rootCount"), 0)) == 2 and native(surfaces.A).get("runtimeId") == native(surfaces.B).get("runtimeId")
    and native(surfaces.A).get("surfaceId") != native(surfaces.B).get("surfaceId") and js("mounts()") == {"A": 1.0, "B": 1.0}),
    "mount/Two roots share one Hermes runtime and mount the fixture once each")
  var value: Variant = js("renderErrors()")
  var errors: Array = value if value is Array else []
  for root_name: String in CASES:
    for name: String in CASES[root_name]:
      var failed := errors.filter(func(entry: Dictionary) -> bool: return entry.get("root") == root_name and entry.get("case") == name)
      var subject := ("The public ScrollView mounts with scrollEventThrottle" if name == "ticker"
        else "The original list mounts its ScrollView without a render error")
      sdk_check(failed.is_empty() and not node_of(root_name, name).is_empty(), "mount/" + name + "/" + subject)
  var reference: Variant = js("scrollRef('A-feed')")
  var mounted := take()
  var feed := rendered("A", "feed")
  var cells := ids("A", "feed")
  var first := rect("B", "chat-0")
  var second := rect("B", "chat-1")
  var chat := rect("B", "chat")
  var tag := int(number(node_of("A", "feed").get("tag"), -2))
  var content_tag := int(number(node_of("A", "feed-content").get("tag"), -2))
  stage("mount", ["feed", "shelf", "agenda"], {"renderErrors": errors, "events": mounted, "ref": reference,
    "tags": {"feed": tag, "content": content_tag}, "empty": {"ids": ids("A", "empty")},
    "scrollRects": {"feed": rect("A", "feed"), "shelf": rect("A", "shelf"), "agenda": rect("B", "agenda")},
    "chat": {"rendered": rendered("B", "chat"), "list": [chat.position.y, chat.end.y],
      "first": [first.position.y, first.end.y], "second": [second.position.y, second.end.y]}})
  sdk_check(feed == feed_window(0.0, 120) and cells.has("header") and cells.has("footer"),
    "mount/feed/The first window renders initialNumToRender items, RN's overscan, the header and the footer")
  var viewable := of(mounted, "feed", "viewable")
  sdk_check((not viewable.is_empty() and ints(viewable[-1].get("viewable")) == feed_viewable(0.0, 120)
    and consistent_changes(viewable, [])), "mount/feed/The first viewable items are those at least half visible")
  sdk_check(ids("A", "empty") == ["header", "view"], "mount/empty/ListEmptyComponent renders after the header when data is empty")
  sdk_check((first.size.y > 0.0 and is_equal_approx(first.end.y, chat.end.y) and second.size.y > 0.0
    and is_equal_approx(second.end.y, first.position.y)), "mount/chat/An inverted list puts its first item at the bottom of the viewport")
  sdk_check((reference is Dictionary and int(number(reference.get("node"))) == tag and int(number(reference.get("ref"))) == tag
    and reference.get("responder") == true and int(number(reference.get("inner"))) > 0
    and int(number(reference.get("inner"))) != tag
    and reference.get("methods", []).size() == 6), "mount/ref/FlatList exposes RN's ScrollView methods on its native scroll instance")
  return errors

func feed_case() -> void:
  var root_b := [offset("B", "agenda"), offset("B", "chat"), offset("B", "ticker")]
  await wheel(rect("A", "feed").get_center(), 6)
  await quiet("A", "feed")
  var taken := take()
  var value := stage("feed/wheel", ["feed"], {"events": taken})
  var at := offset("A", "feed")
  var scrolls := of(taken, "feed", "scroll")
  var last: Dictionary = scrolls[-1] if not scrolls.is_empty() else {}
  var steps: Array = scrolls.map(func(entry: Dictionary) -> float: return number(entry.get("y")))
  check((is_equal_approx(at, 6 * WHEEL) and steps == [48.0, 96.0, 144.0, 192.0, 240.0, 288.0] and last.get("keys") == SCROLL_KEYS
    and is_equal_approx(number(last.get("layoutHeight")), FEED_VISIBLE) and number(last.get("zoomScale")) == 1.0
    and is_equal_approx(number(last.get("contentHeight")), FEED_HEADER + 120 * FEED_ROW + FEED_FOOTER)),
    "feed/wheel/Six wheel steps scroll 288 px and report RN's ScrollEvent payload each time")
  check(value.lists.feed.rendered == feed_window(at, 120), "feed/wheel/The window settles to the initial cells plus RN's overscan around the offset")
  check((ints(last_of(taken, "feed", "viewable").get("viewable")) == feed_viewable(at, 120)
    and consistent_changes(of(taken, "feed", "viewable"), feed_viewable(0.0, 120))),
    "feed/wheel/onViewableItemsChanged reports the items at least half visible, with exact changes")
  check(root_b == [offset("B", "agenda"), offset("B", "chat"), offset("B", "ticker")], "roots/Wheel input on root A never moves root B's lists")
  js("scrollToIndex('A-feed', 60)")
  await quiet("A", "feed")
  taken = take()
  value = stage("feed/index", ["feed"], {"events": taken})
  at = offset("A", "feed")
  var cells: Array = value.lists.feed.rendered
  check((is_equal_approx(at, FEED_HEADER + 60 * FEED_ROW) and cells == feed_window(at, 120) and not 30 in cells and 5 in cells),
    "feed/index/scrollToIndex(60) jumps to getItemLayout's offset; cells outside the window unmount, initial cells stay")
  var placed := not cells.is_empty()
  for index: int in cells:
    var span: Array = value.lists.feed.spans.get(str(index), [-1.0, 0.0])
    placed = placed and is_equal_approx(span[0], FEED_HEADER + FEED_ROW * index) and is_equal_approx(span[1], FEED_ROW)
  check(placed, "feed/index/Spacers keep every committed cell at its getItemLayout offset")
  check((ints(last_of(taken, "feed", "viewable").get("viewable")) == feed_viewable(at, 120) and of(taken, "feed", "end").is_empty()),
    "feed/index/The viewable items follow the jump and onEndReached stays silent")
  js("scrollToEnd('A-feed')")
  await quiet("A", "feed")
  taken = take()
  value = stage("feed/end", ["feed"], {"events": taken})
  at = offset("A", "feed")
  var ends := of(taken, "feed", "end")
  check((ends.size() == 1 and is_equal_approx(at, FEED_HEADER + 120 * FEED_ROW + FEED_FOOTER - FEED_VISIBLE)
    and number(ends[0].get("distanceFromEnd")) >= 0.0 and number(ends[0].get("distanceFromEnd")) <= 0.5 * FEED_VISIBLE
    and int(number(ends[0].get("count"))) == 120), "feed/end/scrollToEnd reaches the end and onEndReached fires once within its threshold")
  check(value.lists.feed.rendered == feed_window(at, 150), "feed/end/The page appended by onEndReached renders inside the window at the end")
  js("scrollToEnd('A-feed')")
  await quiet("A", "feed")
  taken = take()
  value = stage("feed/end-again", ["feed"], {"events": taken})
  at = offset("A", "feed")
  ends = of(taken, "feed", "end")
  check((ends.size() == 1 and int(number(ends[0].get("count"))) == 150 and value.lists.feed.rendered == feed_window(at, 150)
    and is_equal_approx(at, FEED_HEADER + 150 * FEED_ROW + FEED_FOOTER - FEED_VISIBLE)),
    "feed/end/Reaching the grown end fires onEndReached again, once")
  js("scrollToOffset('A-feed', 0)")
  await quiet("A", "feed")
  taken = take()
  value = stage("feed/top", ["feed"], {"events": taken})
  check((is_equal_approx(offset("A", "feed"), 0.0) and value.lists.feed.rendered == feed_window(0.0, 150)
    and ints(last_of(taken, "feed", "viewable").get("viewable")) == feed_viewable(0.0, 150) and of(taken, "feed", "end").is_empty()),
    "feed/top/scrollToOffset(0) brings the first window back and unmounts the end")
  var animated: Variant = js("scrollToEndAnimated('A-feed')")
  var immediate := offset("A", "feed")
  var immediate_motion := int(number(scroll("A", "feed").get("motion")))
  var observed_offsets: Array[float] = []
  var observation_started := Time.get_ticks_usec()
  var animated_target := FEED_HEADER + 150.0 * FEED_ROW + FEED_FOOTER - FEED_VISIBLE
  while Time.get_ticks_usec() - observation_started < 2_000_000 and offset("A", "feed") < animated_target:
    await process_frame
    observed_offsets.append(offset("A", "feed"))
  await quiet("A", "feed")
  var animated_events := take()
  var animated_end := offset("A", "feed")
  value["animated"] = {"result": animated, "immediate": immediate, "motion": immediate_motion,
    "observedOffsets": observed_offsets, "final": animated_end, "events": animated_events}
  check((animated == null and is_equal_approx(immediate, 0.0) and immediate_motion == 2
    and observed_offsets.any(func(at: float) -> bool: return at > immediate and at < animated_target)
    and is_equal_approx(animated_end, animated_target)
    and not of(animated_events, "feed", "scroll").is_empty()),
    "feed/animated/scrollToEnd() honors RN's animated default, advances across frames, and reaches the end")

func shelf_case() -> void:
  var before := rendered("A", "shelf")
  var shelf_rect := rect("A", "shelf")
  var drag_origin := shelf_rect.get_center()
  var scroll_trace: Array = []
  touch(drag_origin, true)
  await settle(3)
  scroll_trace.append(scroll("A", "shelf"))
  for step in range(1, 7):
    move(drag_origin + Vector2(-180.0 * step / 6.0, 0))
    await settle(2)
    scroll_trace.append(scroll("A", "shelf"))
  var drag_terminal := drag_origin + Vector2(-180, 0)
  var stationary_since := Time.get_ticks_usec()
  while Time.get_ticks_usec() - stationary_since < 350_000:
    move(drag_terminal)
    await process_frame
  touch(drag_terminal, false)
  await settle(4)
  await quiet("A", "shelf")
  var taken := take()
  var value := stage("shelf/drag", ["shelf"], {"events": taken, "before": before,
    "viewport": shelf_rect, "dragOrigin": drag_origin, "dragEnd": drag_origin + Vector2(-180, 0),
    "scrollTrace": scroll_trace})
  var at := offset("A", "shelf")
  var state: Dictionary = value.offsets.shelf
  check((is_equal_approx(at, 180.0) and int(number(state.get("begins"))) == 1 and int(number(state.get("ends"))) == 1
    and dragged(taken, "shelf", 0.0, 180.0)), "shelf/drag/A horizontal touch drag scrolls the VirtualizedList by the finger's travel")
  var cells: Array = value.lists.shelf.rendered
  check((covers(value.lists.shelf.spans, at, 400.0) and not before.is_empty() and not cells.is_empty() and int(cells.max()) > int(before.max())),
    "shelf/drag/Measured cells cover the viewport and the window grows in the scroll direction")
  var target: float = value.lists.shelf.spans.get("4", [-1.0, 0.0])[0]
  js("scrollToIndex('A-shelf', 4)")
  await quiet("A", "shelf")
  stage("shelf/index", ["shelf"], {"target": target, "events": take()})
  check(target > 0.0 and is_equal_approx(offset("A", "shelf"), target), "shelf/index/scrollToIndex of a measured cell scrolls to its measured offset")
  js("scrollToIndex('A-shelf', 50)")
  await quiet("A", "shelf")
  taken = take()
  var failed := of(taken, "shelf", "failed")
  stage("shelf/unmeasured", ["shelf"], {"events": taken})
  check((failed.size() == 1 and int(number(failed[0].get("index"))) == 50 and int(number(failed[0].get("highestMeasuredFrameIndex"))) < 50
    and number(failed[0].get("averageItemLength")) >= 60.0 and number(failed[0].get("averageItemLength")) <= 120.0
    and is_equal_approx(offset("A", "shelf"), target)), "shelf/index/scrollToIndex beyond the measured cells calls onScrollToIndexFailed and stays put")

func agenda_case() -> void:
  var start := offset("B", "agenda")
  await drag(rect("B", "agenda").get_center() + Vector2(0, 90), Vector2(0, -150))
  await quiet("B", "agenda")
  var taken := take()
  var value := stage("agenda/drag", ["agenda"], {"events": taken})
  var state: Dictionary = value.offsets.agenda
  check((is_equal_approx(start, 0.0) and is_equal_approx(offset("B", "agenda"), 150.0) and int(number(state.get("begins"))) == 1
    and int(number(state.get("ends"))) == 1 and dragged(taken, "agenda", 0.0, 150.0)),
    "agenda/drag/A vertical touch drag scrolls the SectionList with the finger")
  var tokens := last_of(taken, "agenda", "viewable")
  var indices: Array = tokens.get("viewable", [])
  var sections: Array = tokens.get("sections", [])
  check((not indices.is_empty() and indices.has(null) and sections.size() == indices.size()
    and sections.all(func(key: Variant) -> bool: return key is String and str(key).begins_with("s"))),
    "agenda/drag/Viewable tokens carry their section, including section header cells")
  # RN flattens each section as header, items and footer, so itemIndex 2 of
  # section 1 is flat index 10: the cell of that section's item 1.
  var target: float = value.lists.agenda.spans.get("s1-1", [-1.0, 0.0])[0]
  js("scrollToLocation('B-agenda', 1, 2)")
  await quiet("B", "agenda")
  stage("agenda/location", ["agenda"], {"target": target, "events": take()})
  check(target > 0.0 and is_equal_approx(offset("B", "agenda"), target), "agenda/location/scrollToLocation scrolls to RN's flattened cell offset")
  js("scrollToLocation('B-agenda', 10, 2)")
  await quiet("B", "agenda")
  taken = take()
  var failed := of(taken, "agenda", "failed")
  stage("agenda/unmeasured", ["agenda"], {"events": taken})
  check((failed.size() == 1 and int(number(failed[0].get("index"))) == 82 and int(number(failed[0].get("highestMeasuredFrameIndex"))) < 82
    and is_equal_approx(offset("B", "agenda"), target)), "agenda/location/An unmeasured location calls onScrollToIndexFailed with RN's flat index")
  # Without getItemLayout the content ends at the last measured cell, so the
  # wheel advances as the window measures more of the list.
  var center := rect("B", "agenda").get_center()
  for attempt in range(8):
    if offset("B", "agenda") >= 760.0:
      break
    await wheel(center, 4)
    await quiet("B", "agenda")
  value = stage("agenda/far", ["agenda"], {"events": take()})
  var at := offset("B", "agenda")
  var cells: Array = value.lists.agenda.ids
  check((at >= 760.0 and not cells.has("s1-3") and not cells.has("head-s2") and cells.has("s0-0") and cells.has("s1-2")
    and covers(value.lists.agenda.spans, at, 240.0)), "agenda/far/Wheel steps move the measured window: cells above it unmount, initial cells stay")
  js("scrollToLocation('B-agenda', 0, 0)")
  await quiet("B", "agenda")
  value = stage("agenda/back", ["agenda"], {"events": take()})
  cells = value.lists.agenda.ids
  check((is_equal_approx(offset("B", "agenda"), 0.0) and cells.has("s1-3") and cells.has("head-s2") and not cells.has("head-s3")),
    "agenda/back/scrollToLocation(0, 0) returns to the top and remounts the cells that left the window")

func chat_case() -> void:
  var before := rect("B", "chat-0").position.y
  var root_a := [offset("A", "feed"), offset("A", "shelf")]
  var center := rect("B", "chat").get_center()
  await drag(center, Vector2(0, 60))
  await quiet("B", "chat")
  var after := rect("B", "chat-0").position.y
  var taken := take()
  stage("chat/drag", [], {"before": before, "after": after, "events": taken})
  host_check((is_equal_approx(offset("B", "chat"), 60.0) and is_equal_approx(after - before, 60.0) and dragged(taken, "chat", 0.0, 60.0)),
    "chat/drag/Dragging down 60 px moves the inverted content down with the finger")
  check(root_a == [offset("A", "feed"), offset("A", "shelf")], "roots/Touch input on root B never moves root A's lists")
  var dragged_to := offset("B", "chat")
  await wheel(center, 1)
  await quiet("B", "chat")
  var moved := rect("B", "chat-0").position.y
  stage("chat/wheel", [], {"before": after, "after": moved, "events": take()})
  check((is_equal_approx(offset("B", "chat"), dragged_to + WHEEL) and is_equal_approx(moved - after, WHEEL)),
    "chat/wheel/A wheel step scrolls in the list's own coordinates, as RN's native views do")

func ticker_case() -> void:
  take()
  var center := rect("B", "ticker").get_center()
  await burst(center, 5)
  await settle(10)
  var first := of(take(), "ticker", "scroll")
  var value := stage("ticker/burst", [], {"events": first})
  var state: Dictionary = value.offsets.ticker
  host_check((first.size() == 1 and is_equal_approx(number(first[0].get("y")), WHEEL) and int(number(state.get("scrolls"))) == 1),
    "ticker/throttle/scrollEventThrottle 150 sends one scroll event for five wheel steps in one frame")
  host_check((is_equal_approx(number(state.get("y")), 5 * WHEEL) and int(number(state.get("throttled"))) == 4
    and is_equal_approx(number(state.get("throttle")), 150.0)), "ticker/throttle/The native offset still moves 240 px and counts the four dropped events")
  var waited := Time.get_ticks_msec()
  while Time.get_ticks_msec() - waited < 200:
    await process_frame
  await burst(center, 1)
  await settle(10)
  var next := of(take(), "ticker", "scroll")
  stage("ticker/after", [], {"events": next})
  check((next.size() == 1 and is_equal_approx(number(next[0].get("y")), 6 * WHEEL) and not first.is_empty()
    and number(next[0].get("timestamp")) - number(first[0].get("timestamp")) > 150.0),
    "ticker/throttle/A step after the throttle window delivers the current offset")

func stop_case() -> void:
  stages["beforeStop"] = {"application": native(application)}
  application.call("stop")
  await settle()
  var stopped := native(application)
  stopped["surfaces"] = {"A": native(surfaces.A), "B": native(surfaces.B)}
  stages["afterStop"] = stopped
  var errors: Variant = stopped.get("errors", [])
  var routing: Dictionary = stopped.get("pointerRouting", {})
  var processor: Dictionary = stopped.get("pointerProcessor", {})
  check((stopped.get("stopped") == true and int(number(stopped.get("rootCount"))) == 0 and int(number(stopped.get("pendingTimers"))) == 0
    and int(number(stopped.get("pendingAnimationFrames"))) == 0 and int(number(stopped.get("pendingRootRetirements"))) == 0
    and int(number(stopped.get("pendingWork"))) == 0 and int(number(stopped.get("modalRuntimeMembers"))) == 0
    and stopped.get("windowListener") == false and int(number(routing.get("active"))) == 0
    and int(number(routing.get("contacts"))) == 0 and int(number(routing.get("stored"))) == 0
    and int(number(routing.get("suppressed"))) == 0 and int(number(processor.get("active"))) == 0
    and int(number(processor.get("activeCapture"))) == 0 and int(number(processor.get("pendingCapture"))) == 0
    and errors is Array and errors.is_empty()),
    "stop/Stop retires both roots without timers or runtime errors")
  for root_name: String in surfaces:
    var final_root := native(surfaces[root_name])
    var pointer: Dictionary = final_root.get("pointer", {})
    check((int(number(final_root.get("nativeTags"))) == 0 and int(number(final_root.get("retiringTags"))) == 0
      and int(number(pointer.get("activePointers"))) == 0 and int(number(pointer.get("activeTouches"))) == 0
      and int(number(pointer.get("takenPointers"))) == 0
      and int(number(final_root.get("creates"))) == int(number(final_root.get("deletes"), -2))),
      "stop/Root " + root_name + " balances its native Controls")

func _initialize() -> void:
  var args := OS.get_cmdline_user_args()
  allow_original_negative = args.has("--allow-original-negative")
  var index := args.find("--lane")
  if index >= 0 and index + 1 < args.size():
    lane = args[index + 1]
  call_deferred("run")

func run() -> void:
  if not lane in LANES or (allow_original_negative and lane != "current"):
    push_error("FABRIC_ERROR: unknown virtualized-list lane " + lane)
    quit(1)
    return
  root.size = Vector2i(840, 520)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "VirtualizedListApplication"
  application.set("bundle_path", "res://build/virtualized-list-" + lane + ".js")
  root.add_child(application)
  mount_surface("A")
  mount_surface("B")
  await settle(12)
  for list: String in ["feed", "shelf", "agenda", "chat"]:
    await quiet(LIST_ROOTS[list], list)
  var errors := mount_case()
  if lane != "preceding-sdk":
    await feed_case()
    await shelf_case()
    await agenda_case()
    await chat_case()
    await ticker_case()
  await stop_case()
  for surface: Node in surfaces.values():
    surface.queue_free()
  application.queue_free()
  await settle()
  var failed: Array = checks.filter(func(entry: Dictionary) -> bool: return not entry.passed).map(func(entry: Dictionary) -> String: return entry.name)
  var expected: Array = preceding_sdk.duplicate() if lane == "preceding-sdk" else normative.duplicate()
  var observed := failed.duplicate()
  expected.sort()
  observed.sort()
  var negative := (allow_original_negative or lane == "preceding-sdk") and not failed.is_empty() and observed == expected
  var report := {"scenario": "native-virtualized-list", "lane": lane, "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "events": events, "renderErrors": errors,
    "expectedOriginalFailures": normative, "expectedPrecedingSdkFailures": preceding_sdk,
    "allowOriginalNegative": allow_original_negative, "negativeObserved": negative, "allCurrentAssertionsPassed": failed.is_empty(),
    "scope": {"actualNativeInput": true, "publicFacadeImports": true, "productionBundle": true, "twoRoots": true,
      "animatedScrolling": true, "momentumEvents": false, "stickyHeaders": false, "refreshControl": false,
      "nestedLists": false, "hardwareCertified": false}}
  var file := FileAccess.open("res://build/virtualized-list-report.json", FileAccess.WRITE)
  if not check(file != null, "report/The virtualized-list report can be saved"):
    quit(1)
    return
  file.store_string(JSON.stringify(report, "  ") + "\n")
  file.close()
  var rejected := lane == "sabotage" and not failed.is_empty()
  if negative:
    print(("VIRTUALIZED_LIST_ORIGINAL_NEGATIVE: " if allow_original_negative else "VIRTUALIZED_LIST_PRECEDING_SDK_NEGATIVE: ") + str(failed.size()))
  elif rejected:
    print("VIRTUALIZED_LIST_SABOTAGE_REJECTED: " + str(failed.size()))
  elif failed.is_empty() and lane == "current" and not allow_original_negative:
    print("VIRTUALIZED_LIST_PASSED: " + str(checks.size()))
  else:
    print("VIRTUALIZED_LIST_FAILED")
  quit(0 if negative or rejected or (failed.is_empty() and lane == "current" and not allow_original_negative) else 1)
