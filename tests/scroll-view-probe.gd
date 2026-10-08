extends SceneTree

var app: Node
var surface: Control
var secondary_surface: Control
var checks: Array[Dictionary] = []
var phases: Array[Dictionary] = []

func settle(frames: int = 8) -> void:
  for index in range(frames): await process_frame

func check(ok: bool, name: String, detail: Variant = null) -> void:
  checks.append({"name": name, "passed": ok, "detail": detail})
  if not ok: push_error("FABRIC_CHECK_FAILED: " + name)

func snapshot(target: Object) -> Dictionary:
  if target == null or not is_instance_valid(target): return {"missing": true}
  var parsed: Variant = JSON.parse_string(target.call("snapshot"))
  return parsed if parsed is Dictionary else {"unparsed": true}

func native_scroll(target_surface: Control = null, test_id: String = "scroll") -> Dictionary:
  var target := surface if target_surface == null else target_surface
  for row: Dictionary in snapshot(target).get("nodes", []):
    if row.get("testID") == test_id: return row.get("scroll", {})
  return {}

func native_node(test_id: String, target_surface: Control = null) -> Dictionary:
  var target := surface if target_surface == null else target_surface
  for row: Dictionary in snapshot(target).get("nodes", []):
    if row.get("testID") == test_id: return row
  return {}

func pointer_stats(target_surface: Control = null) -> Dictionary:
  var target := surface if target_surface == null else target_surface
  return snapshot(target).get("pointer", {})

func count_event_type(events: Array, event_type: String) -> int:
  return events.filter(func(row: Dictionary) -> bool: return row.get("type") == event_type).size()

func mounted_rect(target_surface: Control, test_id: String) -> Rect2:
  var found := target_surface.find_child(test_id, true, false)
  return found.get_global_rect().abs() if found is Control else Rect2(-1000, -1000, 0, 0)

func react() -> Dictionary:
  var parsed: Variant = JSON.parse_string(app.call("evaluate", "JSON.stringify(ScrollViewFixture.snapshot())"))
  return parsed if parsed is Dictionary else {"unparsed": true}

func command(method: String, args: Array) -> Variant:
  return app.call("evaluate", "ScrollViewFixture.command(" + JSON.stringify(method) + "," + JSON.stringify(args) + ")")

func capture(label: String) -> void:
  phases.append({"label": label, "native": native_scroll(), "react": react()})

func touch(at: Vector2, down: bool) -> void:
  var event := InputEventScreenTouch.new()
  event.device = 1
  event.index = 0
  event.position = at
  event.pressed = down
  Input.parse_input_event(event)

func move(at: Vector2) -> void:
  var event := InputEventScreenDrag.new()
  event.device = 1
  event.index = 0
  event.position = at
  Input.parse_input_event(event)

func mouse_button(at: Vector2, pressed: bool) -> void:
  var event := InputEventMouseButton.new()
  event.device = 1
  event.position = at
  event.button_index = MOUSE_BUTTON_LEFT
  event.pressed = pressed
  Input.parse_input_event(event)

func mouse_move(at: Vector2, left_pressed: bool) -> void:
  var event := InputEventMouseMotion.new()
  event.device = 1
  event.position = at
  event.button_mask = MOUSE_BUTTON_MASK_LEFT if left_pressed else 0
  Input.parse_input_event(event)

func wheel_down(at: Vector2) -> void:
  var event := InputEventMouseButton.new()
  event.device = 1
  event.position = at
  event.button_index = MOUSE_BUTTON_WHEEL_DOWN
  event.pressed = true
  event.factor = 1
  Input.parse_input_event(event)

func drag(from: Vector2, to: Vector2, target_surface: Control = null, test_id: String = "scroll") -> void:
  touch(from, true)
  await settle(2)
  for index in range(1, 5):
    move(from.lerp(to, float(index) / 4.0))
    await settle(2)
  touch(to, false)
  await wait_for_scroll_idle(target_surface, test_id)
  await settle(2)

func diagonal_drag(from: Vector2, last_move: Vector2, release: Vector2,
    target_surface: Control = null, test_id: String = "scroll") -> void:
  touch(from, true)
  await settle(2)
  for index in range(1, 5):
    move(from.lerp(last_move, float(index) / 4.0))
    await settle(2)
  touch(release, false)
  await wait_for_scroll_idle(target_surface, test_id)
  await settle(2)

func wait_for_scroll_idle(target_surface: Control = null, test_id: String = "scroll",
    timeout_ms: int = 3000, max_frames: int = 240) -> Dictionary:
  var started := Time.get_ticks_msec()
  for frame in range(max_frames):
    await process_frame
    var current := native_scroll(target_surface, test_id)
    if (not current.is_empty() and int(current.get("motion", -1)) == 0
        and absf(float(current.get("y", 0)) - float(current.get("fabricY", -999))) < 0.01
        and absf(float(current.get("x", 0)) - float(current.get("fabricX", -999))) < 0.01):
      current["idleWaitFrames"] = frame + 1
      current["idleWaitMs"] = Time.get_ticks_msec() - started
      return current
    if Time.get_ticks_msec() - started >= timeout_ms: break
  var final_snapshot := native_scroll(target_surface, test_id)
  final_snapshot["idleWaitFrames"] = max_frames
  final_snapshot["idleWaitMs"] = Time.get_ticks_msec() - started
  final_snapshot["reachedIdle"] = not final_snapshot.is_empty() and int(final_snapshot.get("motion", -1)) == 0
  return final_snapshot

func fling() -> void:
  var from := Vector2(100, 145)
  var to := Vector2(100, 75)
  touch(from, true)
  await settle(2)
  for index in range(1, 5):
    move(from.lerp(to, float(index) / 4.0))
    await settle(2)
  touch(to, false)
  await settle(2)

func run() -> void:
  root.size = Vector2i(840, 420)
  app = ClassDB.instantiate("FabricApplication")
  if app == null:
    check(false, "FabricApplication class is available")
    await finish()
    return
  app.name = "ScrollViewApplication"
  app.set("bundle_path", "res://build/scroll-view-gf14-probe.js")
  root.add_child(app)
  surface = ClassDB.instantiate("FabricSurface") as Control
  if surface == null:
    check(false, "FabricSurface class is available")
    app.call("stop")
    await settle(4)
    await finish()
    return
  surface.name = "ScrollViewSurface"
  surface.set("application_path", NodePath("../ScrollViewApplication"))
  surface.set("component_name", "ScrollViewFixture")
  surface.size = Vector2(420, 320)
  root.add_child(surface)
  secondary_surface = ClassDB.instantiate("FabricSurface") as Control
  secondary_surface.name = "SecondaryScrollViewSurface"
  secondary_surface.position = Vector2(420, 0)
  secondary_surface.size = Vector2(420, 320)
  secondary_surface.set("application_path", NodePath("../ScrollViewApplication"))
  secondary_surface.set("component_name", "SecondaryScrollViewFixture")
  root.add_child(secondary_surface)
  await settle(30)
  var start := native_scroll()
  var initial_react := react()
  check(not start.is_empty() and is_equal_approx(float(start.get("maxY", 0)), 590.0)
      and float(start.get("maxX", 0)) > 0.0
      and float(start.get("verticalThumbHeight", 0)) > 0
      and float(start.get("verticalThumbHeight", 999)) <= float(start.get("viewportHeight", 0))
      and initial_react.get("contextForwarded", false),
    "original ScrollView mounts with content extent, default indicator, and RN Context", {
      "scroll": start, "contextForwarded": initial_react.get("contextForwarded", false)})
  var scroll_config: Dictionary = JSON.parse_string(app.call("evaluate", "JSON.stringify(ScrollViewFixture.scrollConfig())"))
  check(scroll_config.get("component") == "RCTScrollView" and scroll_config.get("horizontalRegistered") == true
      and scroll_config.get("horizontalTrue") == {"horizontal": true}
      and scroll_config.get("horizontalFalse") == {"horizontal": false}
      and scroll_config.get("trueToFalse") == {"horizontal": false}
      and scroll_config.get("falseToTrue") == {"horizontal": true}
      and scroll_config.get("viewHasHorizontal") == false and scroll_config.get("godotControlHasHorizontal") == false,
    "Godot preserves horizontal through RCTScrollView create/diff only", scroll_config)
  capture("mounted")

  command("scrollTo", [{"x": 12, "y": 24, "animated": false}])
  await settle(3)
  var neutral_mount := native_scroll()
  var neutral_mount_react := react()
  check(is_equal_approx(float(neutral_mount.get("x", -1)), 12.0)
      and is_equal_approx(float(neutral_mount.get("y", -1)), 24.0)
      and is_equal_approx(float(neutral_mount.get("fabricX", -1)), 12.0)
      and is_equal_approx(float(neutral_mount.get("fabricY", -1)), 24.0)
      and neutral_mount_react.get("errors", []).is_empty(),
    "mounted original ScrollView accepts neutral RN options and still scrolls", {
      "scroll": neutral_mount, "errors": neutral_mount_react.get("errors", [])})
  command("scrollTo", [{"x": 0, "y": 0, "animated": false}])
  await settle(3)

  command("scrollTo", [{"x": 0, "y": 13.25, "animated": false}])
  await settle(3)
  var fractional := native_scroll()
  check(is_equal_approx(float(fractional.get("y", -1)), 13.25) and
      is_equal_approx(float(fractional.get("fabricY", -1)), 13.25) and
      is_equal_approx(float(fractional.get("contentY", 0)), -13.25),
    "fractional offset agrees across logical state, Fabric state, and content transform", fractional)
  app.call("evaluate", "ScrollViewFixture.measureFirstRow()")
  await settle(5)
  var measured: Dictionary = react().get("measure", {})
  check(not measured.is_empty() and absf(float(measured.get("y", 999)) - 10.75) < 0.2 and
      is_equal_approx(float(measured.get("height", -1)), 36.0),
    "RN DOM measurement follows the fractional painted offset", measured)
  capture("fractional-offset")

  command("scrollTo", [{"y": 220}])
  var animated_at_dispatch := native_scroll()
  check(int(animated_at_dispatch.get("motion", -1)) == 2, "omitted animated defaults to upstream animation", animated_at_dispatch)
  command("scrollToEnd", [])
  var end_animation := native_scroll()
  check(int(end_animation.get("motion", -1)) == 2, "scrollToEnd omitted options use upstream animated default", end_animation)
  command("scrollTo", [{"x": 0, "y": 30, "animated": false}])
  await settle(12)
  var replacement := native_scroll()
  check(is_equal_approx(float(replacement.get("y", -1)), 30.0) and int(replacement.get("motion", -1)) == 0,
    "immediate command replaces and cancels active animation", replacement)
  capture("replacement")

  await drag(Vector2(100, 145), Vector2(100, 75))
  var dragged := native_scroll()
  var events: Array = react().get("events", [])
  var begin_events := events.filter(func(row: Dictionary) -> bool: return row.get("type") == "begin")
  var end_events := events.filter(func(row: Dictionary) -> bool: return row.get("type") == "end")
  var momentum_begins := events.filter(func(row: Dictionary) -> bool: return row.get("type") == "momentumBegin")
  var momentum_ends := events.filter(func(row: Dictionary) -> bool: return row.get("type") == "momentumEnd")
  var end_event: Dictionary = end_events[0] if not end_events.is_empty() else {}
  check(float(dragged.get("y", 0)) > 30.0 and int(dragged.get("begins", 0)) == 1 and int(dragged.get("ends", 0)) == 1
      and int(dragged.get("momentumBegins", 0)) == 1 and int(dragged.get("momentumEnds", 0)) == 1
      and begin_events.size() == 1 and end_events.size() == 1 and momentum_begins.size() == 1 and momentum_ends.size() == 1
      and absf(float(end_event.get("velocity", 0))) > 12.0
      and absf(float(dragged.get("y", -1000)) - float(end_event.get("target", 1000))) < 1.0,
    "native routed pan changes offset and completes one drag", {"scroll": dragged, "events": events})
  var sequence := events.map(func(row: Dictionary) -> String: return str(row.get("type", "")))
  check(sequence.find("begin") >= 0 and sequence.find("end") > sequence.find("begin")
      and sequence.find("momentumBegin") > sequence.find("end")
      and sequence.find("momentumEnd") > sequence.find("momentumBegin"),
    "RN receives one measured BeginDrag, EndDrag, MomentumBegin and MomentumEnd in order", sequence)
  var pan_state := react()
  check(int(pan_state.get("cancelled", 0)) == 1 and int(pan_state.get("touchCancelled", 0)) == 1,
    "native takeover cancels the child pointer and touch stream once", pan_state)
  capture("native-pan")

  command("scrollTo", [{"x": 0, "y": 100, "animated": false}])
  app.call("evaluate", "ScrollViewFixture.reset()")
  await settle(3)
  var wheel_before := native_scroll()
  var wheel_origin := mounted_rect(surface, "scroll").get_center()
  touch(wheel_origin, true)
  await settle(2)
  move(wheel_origin + Vector2(0, -30))
  await settle(4)
  var wheel_claimed := native_scroll()
  wheel_down(wheel_origin)
  await settle(4)
  var wheel_after := native_scroll()
  var wheel_events_after: Array = react().get("events", [])
  var wheel_end_index := wheel_events_after.find_custom(func(row: Dictionary) -> bool: return row.get("type") == "end")
  var wheel_offset_index := wheel_events_after.find_custom(func(row: Dictionary) -> bool:
    return row.get("type") == "scroll" and is_equal_approx(float(row.get("y", -1)), float(wheel_after.get("y", -2))))
  move(wheel_origin + Vector2(0, -60))
  await settle(3)
  touch(wheel_origin + Vector2(0, -60), false)
  await settle(4)
  var wheel_after_up := native_scroll()
  var wheel_final_events: Array = react().get("events", [])
  var wheel_end_events := wheel_final_events.filter(func(row: Dictionary) -> bool: return row.get("type") == "end")
  var wheel_end: Dictionary = wheel_end_events[0] if not wheel_end_events.is_empty() else {}
  var wheel_lifecycle := wheel_final_events.filter(func(row: Dictionary) -> bool:
    return ["begin", "end", "momentumBegin", "momentumEnd"].has(row.get("type")))
  var wheel_lifecycle_types: Array = wheel_lifecycle.map(func(row: Dictionary) -> String: return String(row.get("type", "")))
  check(wheel_claimed.get("dragging") == true and int(wheel_claimed.get("motion", -1)) == 1
      and wheel_after.get("candidate") == false and wheel_after.get("dragging") == false
      and int(wheel_after.get("motion", -1)) == 0
      and is_equal_approx(float(wheel_after.get("y", -1)), float(wheel_claimed.get("y", -2)) + 48.0)
      and is_equal_approx(float(wheel_after.get("fabricY", -1)), float(wheel_after.get("y", -2)))
      and is_equal_approx(float(wheel_after.get("contentY", 1)), -float(wheel_after.get("y", -2)))
      and int(wheel_after.get("ends", 0)) == int(wheel_before.get("ends", -1)) + 1
      and wheel_end_events.size() == 1 and is_zero_approx(float(wheel_end.get("velocity", 1)))
      and is_equal_approx(float(wheel_end.get("y", -1)), float(wheel_claimed.get("y", -2)))
      and wheel_end_index >= 0 and wheel_offset_index > wheel_end_index
      and wheel_lifecycle_types == ["begin", "end"]
      and is_equal_approx(float(wheel_after_up.get("y", -1)), float(wheel_after.get("y", -2)))
      and is_equal_approx(float(wheel_after_up.get("fabricY", -1)), float(wheel_after.get("fabricY", -2)))
      and is_equal_approx(float(wheel_after_up.get("contentY", 1)), float(wheel_after.get("contentY", -2)))
      and int(wheel_after_up.get("ends", 0)) == int(wheel_after.get("ends", -1)),
    "wheel replacement retires a claimed pan once before later pointer movement and Up", {
      "before": wheel_before, "claimed": wheel_claimed, "afterWheel": wheel_after,
      "eventsAfterWheel": wheel_events_after, "eventIndices": {"end": wheel_end_index, "wheelOffset": wheel_offset_index},
      "afterUp": wheel_after_up,
      "end": wheel_end, "lifecycle": wheel_lifecycle_types})

  command("scrollTo", [{"x": 0, "y": 100, "animated": false}])
  app.call("evaluate", "ScrollViewFixture.reset()")
  await settle(3)
  var prop_before := native_scroll()
  var prop_origin := mounted_rect(surface, "scroll").get_center()
  touch(prop_origin, true)
  await settle(2)
  move(prop_origin + Vector2(0, -30))
  await settle(4)
  var prop_claimed := native_scroll()
  app.call("evaluate", "ScrollViewFixture.setContentOffset({x:0,y:260})")
  await settle(8)
  var prop_after := native_scroll()
  var prop_events_after: Array = react().get("events", [])
  var prop_end_index := prop_events_after.find_custom(func(row: Dictionary) -> bool: return row.get("type") == "end")
  var prop_offset_index := prop_events_after.find_custom(func(row: Dictionary) -> bool:
    return row.get("type") == "scroll" and is_equal_approx(float(row.get("y", -1)), 260.0))
  move(prop_origin + Vector2(0, -60))
  await settle(3)
  var prop_after_move := native_scroll()
  touch(prop_origin + Vector2(0, -60), false)
  await settle(4)
  var prop_after_up := native_scroll()
  var prop_final_events: Array = react().get("events", [])
  var prop_end_events := prop_final_events.filter(func(row: Dictionary) -> bool: return row.get("type") == "end")
  var prop_end: Dictionary = prop_end_events[0] if not prop_end_events.is_empty() else {}
  var prop_lifecycle := prop_final_events.filter(func(row: Dictionary) -> bool:
    return ["begin", "end", "momentumBegin", "momentumEnd"].has(row.get("type")))
  var prop_lifecycle_types: Array = prop_lifecycle.map(func(row: Dictionary) -> String: return String(row.get("type", "")))
  check(prop_claimed.get("dragging") == true and int(prop_claimed.get("motion", -1)) == 1
      and prop_after.get("candidate") == false and prop_after.get("dragging") == false
      and int(prop_after.get("motion", -1)) == 0 and is_equal_approx(float(prop_after.get("y", -1)), 260.0)
      and is_equal_approx(float(prop_after.get("fabricY", -1)), 260.0)
      and is_equal_approx(float(prop_after.get("contentY", 1)), -260.0)
      and int(prop_after.get("ends", 0)) == int(prop_before.get("ends", -1)) + 1
      and prop_end_events.size() == 1 and is_zero_approx(float(prop_end.get("velocity", 1)))
      and is_equal_approx(float(prop_end.get("y", -1)), float(prop_claimed.get("y", -2)))
      and prop_end_index >= 0 and prop_offset_index > prop_end_index
      and prop_lifecycle_types == ["begin", "end"]
      and is_equal_approx(float(prop_after_move.get("y", -1)), 260.0)
      and is_equal_approx(float(prop_after_move.get("fabricY", -1)), 260.0)
      and is_equal_approx(float(prop_after_move.get("contentY", 1)), -260.0)
      and is_equal_approx(float(prop_after_up.get("y", -1)), 260.0)
      and is_equal_approx(float(prop_after_up.get("fabricY", -1)), 260.0)
      and is_equal_approx(float(prop_after_up.get("contentY", 1)), -260.0)
      and int(prop_after_up.get("ends", 0)) == int(prop_after.get("ends", -1)),
    "contentOffset replacement retires a claimed pan once before later pointer movement and Up", {
      "before": prop_before, "claimed": prop_claimed, "afterOffset": prop_after,
      "eventsAfterOffset": prop_events_after, "eventIndices": {"end": prop_end_index, "offset": prop_offset_index},
      "afterMove": prop_after_move,
      "afterUp": prop_after_up, "end": prop_end, "lifecycle": prop_lifecycle_types})

  app.call("evaluate", "ScrollViewFixture.reset()")
  await fling()
  var before_hold := native_scroll()
  check(int(before_hold.get("momentumBegins", 0)) > 0 and int(before_hold.get("motion", -1)) == 3,
    "fast release enters momentum before the next accepted Down", before_hold)
  touch(Vector2(100, 90), true)
  await settle(5)
  var held_down := native_scroll()
  var down_offset := float(held_down.get("y", -1))
  await settle(5)
  held_down = native_scroll()
  check(int(held_down.get("motion", -1)) == 0 and int(held_down.get("momentumEnds", 0)) == int(before_hold.get("momentumEnds", 0)) + 1
      and is_equal_approx(float(held_down.get("y", -1)), down_offset),
    "stationary Down interrupts momentum once without an offset jump", {"before": before_hold, "after": held_down})
  touch(Vector2(100, 90), false)
  await settle(3)
  capture("down-interrupts-momentum")

  app.call("evaluate", "ScrollViewFixture.reset()")
  command("scrollTo", [{"x": 0, "y": 0, "animated": false}])
  await settle(3)
  var tap_begins_before := int(native_scroll().get("begins", 0))
  await drag(Vector2(100, 42), Vector2(100, 36))
  var tap_state := react()
  check(int(tap_state.get("taps", 0)) == 1 and int(tap_state.get("captured", 0)) == 0
      and int(native_scroll().get("begins", 0)) == tap_begins_before,
    "a row-zero tap below the pan threshold remains a tap", {"react": tap_state, "scroll": native_scroll()})
  capture("child-tap")

  app.call("evaluate", "ScrollViewFixture.reset()")
  command("scrollTo", [{"x": 0, "y": 0, "animated": false}])
  await settle(3)
  var capture_begins_before := int(native_scroll().get("begins", 0))
  await drag(Vector2(100, 78), Vector2(100, 35))
  var captured_state := react()
  check(int(captured_state.get("captured", 0)) == 1 and int(native_scroll().get("begins", 0)) == capture_begins_before,
    "captured child pointer prevents native pan takeover", {"react": captured_state, "scroll": native_scroll()})
  capture("capture-blocks-pan")

  app.call("evaluate", "ScrollViewFixture.reset()")
  command("scrollTo", [{"x": 0, "y": 0, "animated": false}])
  await settle(4)
  var sibling_scroll_before := native_scroll()
  var sibling_pointer_before := pointer_stats()
  app.call("evaluate", "ScrollViewFixture.setCaptureSibling(true)")
  touch(Vector2(100, 42), true)
  await settle(3)
  var sibling_down := react()
  move(Vector2(100, 6))
  await settle(3)
  var sibling_move := react()
  var sibling_scroll_after_move := native_scroll()
  var sibling_pointer_after_move := pointer_stats()
  check(int(sibling_down.get("siblingCaptureRequests", 0)) == 1 and sibling_down.get("siblingHasCapture") == true
      and int(sibling_move.get("siblingGotCapture", 0)) == 1 and sibling_move.get("siblingHasCapture") == true
      and float(sibling_scroll_after_move.get("y", -1)) == 0.0
      and int(sibling_scroll_after_move.get("begins", -1)) == int(sibling_scroll_before.get("begins", -2))
      and int(sibling_pointer_after_move.get("pointerTakeovers", -1)) == int(sibling_pointer_before.get("pointerTakeovers", -2)),
    "same-surface sibling pointer capture prevents native pan takeover", {"down": sibling_down,
      "before": {"scroll": sibling_scroll_before, "pointer": sibling_pointer_before},
      "afterMove": sibling_move, "scroll": sibling_scroll_after_move, "pointer": sibling_pointer_after_move})
  touch(Vector2(100, 6), false)
  await settle(4)
  var sibling_up := react()
  var sibling_pointer_after_up := pointer_stats()
  var sibling_routes_after_up: Dictionary = snapshot(app).get("pointerRouting", {})
  var lost_at_move := int(sibling_move.get("siblingLostCapture", 0))
  check(sibling_up.get("siblingHasCapture") == false
      and int(sibling_up.get("siblingLostCapture", 0)) == lost_at_move + 1
      and int(sibling_pointer_after_up.get("activePointers", -1)) == 0
      and int(sibling_routes_after_up.get("active", -1)) == 0,
    "sibling capture releases exactly once on Up", {"afterUp": sibling_up,
      "pointer": sibling_pointer_after_up, "routes": sibling_routes_after_up})
  app.call("evaluate", "ScrollViewFixture.setCaptureSibling(false)")
  touch(Vector2(100, 42), true)
  await settle(2)
  var fresh_contact := react()
  touch(Vector2(100, 42), false)
  await settle(2)
  check(fresh_contact.get("siblingHasCapture") == false
      and int(fresh_contact.get("siblingCaptureRequests", 0)) == 1,
    "fresh contact starts without the previous sibling capture", fresh_contact)

  app.call("evaluate", "ScrollViewFixture.reset()")
  command("scrollTo", [{"x": 0, "y": 0, "animated": false}])
  app.call("evaluate", "ScrollViewFixture.setFirstRowCollapsed(false)")
  await settle(4)
  var row_before_hide := native_node("row-0")
  var route_scroll_before_hide := native_scroll()
  var pointer_before_hide := pointer_stats()
  touch(Vector2(100, 42), true)
  await settle(2)
  var pressed_before_hide := native_scroll()
  var route_before_hide: Dictionary = snapshot(app).get("pointerRouting", {})
  app.call("evaluate", "ScrollViewFixture.setFirstRowCollapsed(true)")
  await settle(4)
  var row_hidden := native_node("row-0")
  var scroll_after_hide := native_scroll()
  var pointer_after_hide := pointer_stats()
  var route_after_hide: Dictionary = snapshot(app).get("pointerRouting", {})
  var events_after_hide: Array = react().get("events", [])
  var valid_hide: bool = (row_before_hide.get("visible") == true
      and int(row_before_hide.get("tag", -1)) == int(row_hidden.get("tag", -2))
      and row_hidden.get("visible") == false and int(pressed_before_hide.get("candidate", false)) == 1
      and int(route_before_hide.get("active", 0)) == 1 and int(route_before_hide.get("stored", 0)) == 1
      and int(pointer_after_hide.get("activePointers", -1)) == 0
      and int(pointer_after_hide.get("pointerCancels", -2)) == int(pointer_before_hide.get("pointerCancels", -3)) + 1
      and int(pointer_after_hide.get("cancels", -2)) == int(pointer_before_hide.get("cancels", -3)) + 1
      and int(route_after_hide.get("active", -1)) == 0 and int(route_after_hide.get("contacts", -1)) == 0
      and int(route_after_hide.get("stored", -1)) == 0
      and int(scroll_after_hide.get("candidate", true)) == 0 and int(scroll_after_hide.get("motion", -1)) == 0
      and float(scroll_after_hide.get("y", -1)) == float(route_scroll_before_hide.get("y", -2))
      and int(scroll_after_hide.get("begins", -1)) == int(route_scroll_before_hide.get("begins", -2)))
  move(Vector2(100, 6))
  await settle(3)
  touch(Vector2(100, 6), false)
  await settle(3)
  var scroll_after_hidden_move := native_scroll()
  var pointer_after_hidden_move := pointer_stats()
  var route_after_hidden_move: Dictionary = snapshot(app).get("pointerRouting", {})
  var events_after_hidden_move: Array = react().get("events", [])
  check(valid_hide and float(scroll_after_hidden_move.get("y", -1)) == float(scroll_after_hide.get("y", -2))
      and int(scroll_after_hidden_move.get("begins", -1)) == int(scroll_after_hide.get("begins", -2))
      and int(scroll_after_hidden_move.get("ends", -1)) == int(scroll_after_hide.get("ends", -2))
      and int(pointer_after_hidden_move.get("pointerCancels", -1)) == int(pointer_after_hide.get("pointerCancels", -2))
      and int(pointer_after_hidden_move.get("cancels", -1)) == int(pointer_after_hide.get("cancels", -2))
      and int(route_after_hidden_move.get("active", -1)) == 0
      and count_event_type(events_after_hidden_move, "begin") == count_event_type(events_after_hide, "begin")
      and count_event_type(events_after_hidden_move, "end") == count_event_type(events_after_hide, "end"),
    "hidden mounted child retires its route before later Move or Up", {"beforeHide": {"row": row_before_hide,
      "scroll": pressed_before_hide, "pointer": pointer_before_hide, "routes": route_before_hide},
      "afterHide": {"row": row_hidden, "scroll": scroll_after_hide, "pointer": pointer_after_hide,
        "routes": route_after_hide, "events": events_after_hide},
      "afterMoveAndUp": {"scroll": scroll_after_hidden_move, "pointer": pointer_after_hidden_move,
        "routes": route_after_hidden_move, "events": events_after_hidden_move}})
  app.call("evaluate", "ScrollViewFixture.setFirstRowCollapsed(false)")
  await settle(4)

  app.call("evaluate", "ScrollViewFixture.reset()")
  command("scrollTo", [{"x": 0, "y": 0, "animated": false}])
  await settle(4)
  var mouse_row_before := native_node("row-0")
  var mouse_scroll_before := native_scroll()
  var mouse_pointer_before := pointer_stats()
  mouse_button(Vector2(100, 42), true)
  await settle(2)
  var mouse_down_scroll := native_scroll()
  var mouse_route_down: Dictionary = snapshot(app).get("pointerRouting", {})
  app.call("evaluate", "ScrollViewFixture.setFirstRowCollapsed(true)")
  await settle(4)
  var mouse_row_hidden := native_node("row-0")
  var mouse_scroll_hidden := native_scroll()
  var mouse_pointer_hidden := pointer_stats()
  var mouse_route_hidden: Dictionary = snapshot(app).get("pointerRouting", {})
  mouse_move(Vector2(100, 6), true)
  await settle(2)
  mouse_button(Vector2(100, 6), false)
  await settle(3)
  var mouse_scroll_after_up := native_scroll()
  var mouse_pointer_after_up := pointer_stats()
  var mouse_route_after_up: Dictionary = snapshot(app).get("pointerRouting", {})
  var mouse_events_after_up: Array = react().get("events", [])
  var mouse_hidden_ok: bool = (mouse_row_before.get("visible") == true
      and int(mouse_row_before.get("tag", -1)) == int(mouse_row_hidden.get("tag", -2))
      and mouse_row_hidden.get("visible") == false and int(mouse_down_scroll.get("candidate", false)) == 1
      and int(mouse_route_down.get("active", 0)) == 1 and int(mouse_pointer_hidden.get("activePointers", -1)) == 0
      and int(mouse_pointer_hidden.get("pointerCancels", -2)) == int(mouse_pointer_before.get("pointerCancels", -3)) + 1
      and int(mouse_pointer_hidden.get("cancels", -2)) == int(mouse_pointer_before.get("cancels", -3)) + 1
      and int(mouse_route_hidden.get("suppressed", -1)) == 1
      and int(mouse_scroll_hidden.get("candidate", true)) == 0 and int(mouse_scroll_hidden.get("motion", -1)) == 0
      and float(mouse_scroll_hidden.get("y", -1)) == float(mouse_scroll_before.get("y", -2))
      and int(mouse_scroll_after_up.get("begins", -1)) == int(mouse_scroll_hidden.get("begins", -2))
      and int(mouse_scroll_after_up.get("ends", -1)) == int(mouse_scroll_hidden.get("ends", -2))
      and float(mouse_scroll_after_up.get("y", -1)) == float(mouse_scroll_hidden.get("y", -2))
      and int(mouse_pointer_after_up.get("pointerCancels", -1)) == int(mouse_pointer_hidden.get("pointerCancels", -2))
      and int(mouse_route_after_up.get("suppressed", -1)) == 1
      and count_event_type(mouse_events_after_up, "begin") == 0
      and count_event_type(mouse_events_after_up, "end") == 0)
  app.call("evaluate", "ScrollViewFixture.setFirstRowCollapsed(false)")
  await settle(4)
  mouse_button(Vector2(100, 42), true)
  await settle(2)
  var mouse_fresh_route_down: Dictionary = snapshot(app).get("pointerRouting", {})
  mouse_move(Vector2(100, 6), true)
  await settle(3)
  var mouse_fresh_scroll_move := native_scroll()
  var mouse_fresh_route_move: Dictionary = snapshot(app).get("pointerRouting", {})
  mouse_button(Vector2(100, 6), false)
  await wait_for_scroll_idle()
  await settle(3)
  var mouse_fresh_scroll_up := native_scroll()
  check(mouse_hidden_ok and int(mouse_fresh_route_down.get("suppressed", -1)) == 0
      and int(mouse_fresh_route_move.get("suppressed", -1)) == 0
      and float(mouse_fresh_scroll_move.get("y", 0)) > 0.0
      and int(mouse_fresh_scroll_move.get("begins", -1)) == int(mouse_scroll_before.get("begins", -2)) + 1
      and int(mouse_fresh_scroll_up.get("ends", -1)) == int(mouse_scroll_before.get("ends", -2)) + 1,
    "hidden mouse contact stays suppressed until a fresh Down, then scrolls normally", {"beforeHide": {
      "row": mouse_row_before, "scroll": mouse_down_scroll, "pointer": mouse_pointer_before,
      "routes": mouse_route_down}, "afterHide": {"row": mouse_row_hidden, "scroll": mouse_scroll_hidden,
      "pointer": mouse_pointer_hidden, "routes": mouse_route_hidden}, "afterHeldMoveAndUp": {
      "scroll": mouse_scroll_after_up, "pointer": mouse_pointer_after_up, "routes": mouse_route_after_up,
      "events": mouse_events_after_up}, "freshDown": mouse_fresh_route_down,
      "freshMove": {"scroll": mouse_fresh_scroll_move, "routes": mouse_fresh_route_move},
      "freshUp": mouse_fresh_scroll_up})
  app.call("evaluate", "ScrollViewFixture.setFirstRowCollapsed(false)")
  await settle(3)

  app.call("evaluate", "ScrollViewFixture.reset()")
  command("scrollTo", [{"x": 0, "y": 0, "animated": false}])
  await settle(3)
  touch(Vector2(100, 42), true)
  await settle(2)
  move(Vector2(100, 58))
  await settle(3)
  app.call("evaluate", "ScrollViewFixture.replaceContent()")
  await settle(12)
  var retired_during_pan := native_scroll()
  var retired_events: Array = react().get("events", [])
  touch(Vector2(100, 58), false)
  await settle(3)
  var released_after_removal := native_scroll()
  var released_events: Array = react().get("events", [])
  check(not retired_during_pan.is_empty() and int(retired_during_pan.get("motion", -1)) == 0
      and int(retired_during_pan.get("begins", 0)) == int(retired_during_pan.get("ends", -1))
      and int(released_after_removal.get("begins", 0)) == int(released_after_removal.get("ends", -1))
      and released_events.filter(func(row: Dictionary) -> bool: return row.get("type") == "end").size() == 1,
    "removing a pressed child retires its pan route while ScrollView stays mounted", {
      "scrollDuringRemoval": retired_during_pan, "scrollAfterUp": released_after_removal,
      "eventsAtRemoval": retired_events, "eventsAfterUp": released_events})
  app.call("evaluate", "ScrollViewFixture.replaceContent()")
  await settle(8)

  app.call("evaluate", "ScrollViewFixture.replaceContent()")
  await settle(12)
  var empty := native_scroll()
  check(not empty.is_empty() and float(empty.get("maxY", 999)) == 0.0 and float(empty.get("y", 999)) == 0.0,
    "mounted ScrollView survives content deletion and clamps its offset", empty)
  capture("content-deleted")

  app.call("evaluate", "ScrollViewFixture.replaceContent()")
  await settle(10)
  app.call("evaluate", "ScrollViewFixture.setTinyViewport(true)")
  await settle(8)
  var tiny := native_scroll()
  check(not tiny.is_empty() and float(tiny.get("viewportHeight", 999)) == 8.0 and
      float(tiny.get("verticalThumbHeight", 999)) <= 8.0 and float(tiny.get("maxY", 0)) == 752.0,
    "actual tiny ScrollView viewport keeps indicator bounds finite", tiny)
  app.call("evaluate", "ScrollViewFixture.setTinyViewport(false)")
  await settle(8)
  capture("resized-back")

  app.call("evaluate", "ScrollViewFixture.setBlockNative(true)")
  app.call("evaluate", "ScrollViewFixture.reset()")
  var blocked_before := native_scroll()
  await drag(Vector2(100, 130), Vector2(100, 80))
  var blocked_after := native_scroll()
  check(is_equal_approx(float(blocked_after.get("y", -1)), float(blocked_before.get("y", -2))) and
      int(blocked_after.get("begins", 0)) == int(blocked_before.get("begins", 0)),
    "active RN responder block prevents native scroll takeover", {"before": blocked_before, "after": blocked_after, "events": react().get("events", [])})
  app.call("evaluate", "ScrollViewFixture.setBlockNative(false)")

  var primary_offset_before_secondary := float(native_scroll().get("y", -1))
  app.call("evaluate", "SecondaryScrollViewFixture.command('scrollTo',[{x:40,y:35,animated:false}])")
  await settle(3)
  app.call("evaluate", "SecondaryScrollViewFixture.command('scrollToEnd',[{animated:false}])")
  await settle(3)
  var horizontal_end := native_scroll(secondary_surface, "secondary-scroll")
  check(is_equal_approx(float(horizontal_end.get("x", -1)), float(horizontal_end.get("maxX", -2)))
      and is_equal_approx(float(horizontal_end.get("y", -1)), 35.0),
    "horizontal scrollToEnd reaches right edge and preserves vertical offset", horizontal_end)
  app.call("evaluate", "SecondaryScrollViewFixture.command('scrollTo',[{x:0,y:0,animated:false}])")
  await settle(3)
  var horizontal_start := native_scroll(secondary_surface, "secondary-scroll")
  var horizontal_rect := mounted_rect(secondary_surface, "secondary-scroll")
  app.call("evaluate", "SecondaryScrollViewFixture.reset()")
  var horizontal_origin := horizontal_rect.get_center()
  await drag(horizontal_origin, horizontal_origin + Vector2(-70, 0), secondary_surface, "secondary-scroll")
  var horizontal_after := native_scroll(secondary_surface, "secondary-scroll")
  var secondary_events: Dictionary = JSON.parse_string(app.call("evaluate", "JSON.stringify(SecondaryScrollViewFixture.snapshot())"))
  var secondary_sequence: Array = secondary_events.get("events", [])
  check(int(snapshot(app).get("rootCount", 0)) == 2 and not horizontal_start.is_empty()
      and horizontal_after.get("horizontal") == true and float(horizontal_after.get("x", 0)) >= 70.0
      and int(horizontal_after.get("begins", 0)) == 1 and int(horizontal_after.get("ends", 0)) == 1
      and int(horizontal_after.get("momentumBegins", 0)) == 1 and int(horizontal_after.get("momentumEnds", 0)) == 1
      and secondary_sequence == ["begin", "end", "momentumBegin", "momentumEnd"]
      and float(horizontal_after.get("horizontalThumbWidth", 999)) > 0
      and float(horizontal_after.get("horizontalThumbWidth", 999)) <= float(horizontal_after.get("viewportWidth", 0))
      and is_equal_approx(float(native_scroll().get("y", -2)), primary_offset_before_secondary)
      and horizontal_rect.position.x >= 420.0,
    "second Fabric root pans horizontally and leaves the vertical root unchanged", {
      "primary": native_scroll(), "secondaryBefore": horizontal_start, "secondaryAfter": horizontal_after,
      "viewport": horizontal_rect, "origin": horizontal_origin, "events": secondary_events})

  app.call("evaluate", "ScrollViewFixture.reset()")
  command("scrollTo", [{"x": 55, "y": 35, "animated": false}])
  await settle(3)
  command("scrollToEnd", [{"animated": false}])
  await settle(3)
  var vertical_end := native_scroll()
  check(is_equal_approx(float(vertical_end.get("x", -1)), 55.0)
      and is_equal_approx(float(vertical_end.get("y", -1)), float(vertical_end.get("maxY", -2))),
    "vertical scrollToEnd reaches bottom and preserves horizontal offset", vertical_end)
  command("scrollTo", [{"x": 0, "y": 0, "animated": false}])
  await settle(3)

  command("scrollTo", [{"x": 80, "y": 100, "animated": false}])
  app.call("evaluate", "ScrollViewFixture.reset()")
  var vertical_before_diagonal := native_scroll()
  await diagonal_drag(Vector2(150, 145), Vector2(135, 115), Vector2(120, 95))
  var vertical_diagonal := native_scroll()
  var vertical_diagonal_events: Array = react().get("events", [])
  var vertical_end_events := vertical_diagonal_events.filter(func(row: Dictionary) -> bool: return row.get("type") == "end")
  var vertical_diagonal_end: Dictionary = vertical_end_events[0] if not vertical_end_events.is_empty() else {}
  var vertical_lifecycle := vertical_diagonal_events.filter(func(row: Dictionary) -> bool:
    return ["begin", "end", "momentumBegin", "momentumEnd"].has(row.get("type")))
  var vertical_lifecycle_types: Array = vertical_lifecycle.map(func(row: Dictionary) -> String: return String(row.get("type", "")))
  check(is_equal_approx(float(vertical_diagonal.get("x", -1)), 80.0)
      and is_equal_approx(float(vertical_diagonal.get("y", -1)), float(vertical_diagonal_end.get("target", -2)))
      and is_equal_approx(float(vertical_diagonal_end.get("x", -1)), 80.0)
      and is_equal_approx(float(vertical_diagonal_end.get("y", -1)), 150.0)
      and is_equal_approx(float(vertical_diagonal.get("fabricX", -1)), 80.0)
      and is_equal_approx(float(vertical_diagonal.get("fabricY", -1)), float(vertical_diagonal.get("y", -2)))
      and is_equal_approx(float(vertical_diagonal.get("contentX", 1)), -80.0)
      and is_equal_approx(float(vertical_diagonal.get("contentY", 1)), -float(vertical_diagonal.get("y", -2)))
      and absf(float(vertical_diagonal_end.get("velocity", 0))) > 12.0
      and is_zero_approx(float(vertical_diagonal_end.get("velocityX", 1)))
      and vertical_lifecycle_types == ["begin", "end", "momentumBegin", "momentumEnd"]
      and int(vertical_diagonal.get("begins", 0)) == int(vertical_before_diagonal.get("begins", -1)) + 1
      and int(vertical_diagonal.get("ends", 0)) == int(vertical_before_diagonal.get("ends", -1)) + 1
      and int(vertical_diagonal.get("momentumBegins", 0)) == int(vertical_before_diagonal.get("momentumBegins", -1)) + 1
      and int(vertical_diagonal.get("momentumEnds", 0)) == int(vertical_before_diagonal.get("momentumEnds", -1)) + 1,
    "vertical diagonal pan and new release coordinate preserve x and have zero cross-axis momentum",
    {"before": vertical_before_diagonal, "after": vertical_diagonal, "end": vertical_diagonal_end,
      "events": vertical_diagonal_events})

  app.call("evaluate", "SecondaryScrollViewFixture.command('scrollTo',[{x:100,y:70,animated:false}])")
  app.call("evaluate", "SecondaryScrollViewFixture.reset()")
  await settle(3)
  var horizontal_diagonal_rect := mounted_rect(secondary_surface, "secondary-scroll")
  var horizontal_diagonal_origin := horizontal_diagonal_rect.get_center()
  var horizontal_before_diagonal := native_scroll(secondary_surface, "secondary-scroll")
  await diagonal_drag(horizontal_diagonal_origin, horizontal_diagonal_origin + Vector2(-25, -15),
      horizontal_diagonal_origin + Vector2(-50, -30), secondary_surface, "secondary-scroll")
  var horizontal_diagonal := native_scroll(secondary_surface, "secondary-scroll")
  var horizontal_diagonal_events: Dictionary = JSON.parse_string(app.call("evaluate", "JSON.stringify(SecondaryScrollViewFixture.snapshot())"))
  var horizontal_diagonal_end: Dictionary = horizontal_diagonal_events.get("end", {})
  var horizontal_lifecycle: Array = horizontal_diagonal_events.get("events", [])
  check(is_equal_approx(float(horizontal_diagonal.get("x", -1)), float(horizontal_diagonal_end.get("targetX", -2)))
      and is_equal_approx(float(horizontal_diagonal.get("y", -1)), 70.0)
      and is_equal_approx(float(horizontal_diagonal_end.get("x", -1)), 150.0)
      and is_equal_approx(float(horizontal_diagonal_end.get("y", -1)), 70.0)
      and is_equal_approx(float(horizontal_diagonal.get("fabricX", -1)), float(horizontal_diagonal.get("x", -2)))
      and is_equal_approx(float(horizontal_diagonal.get("fabricY", -1)), 70.0)
      and is_equal_approx(float(horizontal_diagonal.get("contentX", 1)), -float(horizontal_diagonal.get("x", -2)))
      and is_equal_approx(float(horizontal_diagonal.get("contentY", 1)), -70.0)
      and float(horizontal_diagonal_end.get("velocityX", 0)) > 12.0
      and is_zero_approx(float(horizontal_diagonal_end.get("velocityY", 1)))
      and horizontal_lifecycle == ["begin", "end", "momentumBegin", "momentumEnd"]
      and int(horizontal_diagonal.get("begins", 0)) == int(horizontal_before_diagonal.get("begins", -1)) + 1
      and int(horizontal_diagonal.get("ends", 0)) == int(horizontal_before_diagonal.get("ends", -1)) + 1
      and int(horizontal_diagonal.get("momentumBegins", 0)) == int(horizontal_before_diagonal.get("momentumBegins", -1)) + 1
      and int(horizontal_diagonal.get("momentumEnds", 0)) == int(horizontal_before_diagonal.get("momentumEnds", -1)) + 1,
    "horizontal diagonal pan and new release coordinate preserve y and have zero cross-axis momentum",
    {"before": horizontal_before_diagonal, "after": horizontal_diagonal,
      "end": horizontal_diagonal_end, "events": horizontal_diagonal_events})

  app.call("evaluate", "SecondaryScrollViewFixture.command('scrollTo',[{x:200,y:90,animated:false}])")
  app.call("evaluate", "SecondaryScrollViewFixture.reset()")
  await settle(3)
  var orientation_rect := mounted_rect(secondary_surface, "secondary-scroll")
  var orientation_origin := orientation_rect.get_center()
  var orientation_before := native_scroll(secondary_surface, "secondary-scroll")
  touch(orientation_origin, true)
  await settle(2)
  move(orientation_origin + Vector2(-18, -2))
  await settle(3)
  var orientation_during_drag := native_scroll(secondary_surface, "secondary-scroll")
  app.call("evaluate", "SecondaryScrollViewFixture.setHorizontal(false)")
  await settle(8)
  var orientation_after_change := native_scroll(secondary_surface, "secondary-scroll")
  var orientation_events_at_change: Dictionary = JSON.parse_string(app.call("evaluate", "JSON.stringify(SecondaryScrollViewFixture.snapshot())"))
  touch(orientation_origin + Vector2(-18, -2), false)
  await settle(3)
  var orientation_events_after_up: Dictionary = JSON.parse_string(app.call("evaluate", "JSON.stringify(SecondaryScrollViewFixture.snapshot())"))
  check(int(orientation_during_drag.get("begins", 0)) == int(orientation_before.get("begins", -1)) + 1
      and orientation_after_change.get("horizontal") == false and not orientation_after_change.get("dragging", true)
      and int(orientation_after_change.get("motion", -1)) == 0
      and int(orientation_after_change.get("ends", 0)) == int(orientation_before.get("ends", -1)) + 1
      and orientation_events_at_change.get("events", []) == ["begin", "end"]
      and orientation_events_after_up.get("events", []) == ["begin", "end"],
    "orientation replacement cancels the claimed pan once before the axis changes",
    {"before": orientation_before, "during": orientation_during_drag, "afterChange": orientation_after_change,
      "eventsAtChange": orientation_events_at_change, "eventsAfterUp": orientation_events_after_up})
  app.call("evaluate", "SecondaryScrollViewFixture.setHorizontal(true)")
  await settle(8)

  command("scrollTo", [{"x": 0, "y": 120, "animated": true}])
  await settle(2)
  var before_content_delete := native_scroll()
  var animation_was_running := (int(before_content_delete.get("motion", -1)) == 2
      and float(before_content_delete.get("maxY", 0)) > 0 and float(before_content_delete.get("y", 0)) > 0)
  app.call("evaluate", "ScrollViewFixture.replaceContent()")
  await settle(12)
  var removed_during_animation := native_scroll()
  check(animation_was_running and float(removed_during_animation.get("maxY", 999)) == 0.0
      and float(removed_during_animation.get("y", 999)) == 0.0 and int(removed_during_animation.get("motion", -1)) == 0,
    "active animated scroll is canceled when content is removed and clamps to zero", {
      "beforeRemoval": before_content_delete, "afterRemoval": removed_during_animation})
  capture("content-replaced-during-animation")
  await finish()

func finish() -> void:
  var before_stop := {"app": snapshot(app), "surface": snapshot(surface), "secondarySurface": snapshot(secondary_surface)}
  if app != null and is_instance_valid(app): app.call("stop")
  await settle(8)
  var after_stop := {"app": snapshot(app), "surface": snapshot(surface), "secondarySurface": snapshot(secondary_surface)}
  var app_after: Dictionary = after_stop.app
  var routing: Dictionary = app_after.get("pointerRouting", {})
  var processor: Dictionary = app_after.get("pointerProcessor", {})
  var clean: bool = (app_after.get("stopped") == true and int(app_after.get("rootCount", -1)) == 0
      and int(app_after.get("pendingRootRetirements", -1)) == 0 and int(app_after.get("pendingWork", -1)) == 0
      and int(app_after.get("pendingTimers", -1)) == 0 and int(app_after.get("pendingAnimationFrames", -1)) == 0
      and int(app_after.get("modalRuntimeMembers", -1)) == 0 and app_after.get("windowListener") == false
      and int(routing.get("active", -1)) == 0 and int(routing.get("contacts", -1)) == 0
      and int(routing.get("stored", -1)) == 0 and int(routing.get("suppressed", -1)) == 0
      and int(processor.get("active", -1)) == 0 and int(processor.get("activeCapture", -1)) == 0
      and int(processor.get("pendingCapture", -1)) == 0)
  for root_snapshot: Dictionary in [after_stop.surface, after_stop.secondarySurface]:
    var pointer: Dictionary = root_snapshot.get("pointer", {})
    clean = (clean and int(root_snapshot.get("nativeTags", -1)) == 0 and int(root_snapshot.get("retiringTags", -1)) == 0
        and int(pointer.get("activePointers", -1)) == 0 and int(pointer.get("activeTouches", -1)) == 0
        and int(pointer.get("takenPointers", -1)) == 0)
  var report := {"scenario": "gf14-scroll-view-original-mounted", "reactNative": "0.87.1",
    "displayServer": DisplayServer.get_name(), "checks": checks, "phases": phases,
    "beforeStop": before_stop, "afterStop": after_stop,
    "cleanup": clean}
  var file := FileAccess.open("res://build/scroll-view-gf14-report.json", FileAccess.WRITE)
  if file != null: file.store_string(JSON.stringify(report, "  ") + "\n")
  print("SCROLL_VIEW_GF14_REPORT=" + JSON.stringify(report))
  quit(0 if checks.all(func(row: Dictionary) -> bool: return row.passed) else 1)

func _initialize() -> void:
  call_deferred("run")
