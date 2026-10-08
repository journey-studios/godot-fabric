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
