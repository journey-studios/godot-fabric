extends SceneTree

# V05-08, density and insets, on the desktop headless host. The window of the process stands in for a phone's:
#  - density_policy "screen" makes the application stretch its window as canvas_items at the screen's scale. The headless
#    DisplayServer has one scale (1), so validation_screen_scale stands in for the screen's, and the probe moves it as a
#    window dragged between displays would move it.
#  - The headless DisplayServer has no safe area (and neither does a desktop), so validation_safe_area states the unsafe bands,
#    in Fabric points, that an iPhone's DisplayServer.get_display_safe_area would give RN's SafeAreaView.
# The fixture (tests/mobile-density-fixture.jsx) is a HUD of SafeAreaViews, a 44-point Pressable and the Dimensions listener.
# Every stage waits for the state it expects (never a number of frames), then records what JS measures and what the host holds;
# tests/mobile-density-oracle.mjs recomputes the padding of every SafeAreaView from those frames and the seams.
#
# The world group puts the same HUD over a minimal Godot world (an inner class below: it counts the left presses that reach its
# _unhandled_input) and clicks the empty area, the padding band and the centre of a Pressable, with a full-screen SafeAreaView and, as
# the control, a View for a root, each with pointerEvents box-none and auto, at scale 1 and at scale 2 under density_policy "screen".
# The counts are invariants of the events, not of the pace: N clicks give N to the world and none to the HUD, or N presses and none to
# the world. Only the pump that follows the burst is waited for, by the host's own frame counter.
#
# The seam faults put one band of validation_safe_area that is not a finite non-negative number (a negative, a String, a NaN) in front of
# the host: it refuses the seam with a diagnostic that names the band, keeps the bands and so the padding of the last valid seam, never lets
# a NaN or a negative reach RN's State, and follows the next valid seam. Each fault is on its own side, so the host's one diagnostic per
# message reports every one of them; every wait is for a state, and the pumps after the refusal are counted by the host's frame counter.
#
# A check is normative when it needs this slice's host (the policy, the seams, RN's SafeAreaView); the control on the previous
# host (--allow-original-negative) must fail exactly those. --sabotage runs on a host that was broken on purpose and must fail.
const WINDOW := Vector2i(1200, 720)
const SIDES := ["left", "top", "right", "bottom"]
const VIEWS := ["hud", "bleed", "nested", "floating", "edge-top", "edge-corner"]
const HUD_CHILDREN := ["hud-top", "hud-left", "nested", "hud-right", "hud-bottom", "touch-target"]
const INSETS := {"left": 47.0, "top": 20.0, "right": 47.5, "bottom": 21.0}
# 0.3 pt past INSETS on one side: under the update threshold of a pixel plus 0.01 at scale 3 (0.343 pt).
const SUB_THRESHOLD := {"left": 47.3, "top": 20.0, "right": 47.5, "bottom": 21.0}
const MOVED := {"left": 50.0, "top": 24.0, "right": 44.0, "bottom": 30.0}
const CANVAS_ITEMS := 1
# The faults of the seam: the kind, and the side whose band is the invalid one. The value comes from fault_value.
const SEAM_FAULTS := [
  {"kind": "negative", "side": "left"},
  {"kind": "string", "side": "top"},
  {"kind": "not-a-number", "side": "right"},
]
# The valid seams between the faults: the one before fault i is SEAM_VALID[i], the one that follows it SEAM_VALID[i + 1].
const SEAM_VALID := [INSETS, MOVED, INSETS, MOVED]
# The world group: clicks per point, the pointerEvents of the root, and the scales it runs at.
const CLICKS := 20
const WORLD_EVENTS := ["box-none", "auto"]
const WORLD_ROOTS := ["safe", "view"]
const WORLD_SCALES := [1.0, 2.0]

# The world under the HUD. It listens in _unhandled_input, the last stop of an input event: it hears only what neither the Surface nor a
# Control of the HUD took. The HUD's Surface has to come after it in the tree, so that Godot calls the Surface first.
class World extends Node2D:
  var presses := 0
  func _unhandled_input(event: InputEvent) -> void:
    if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
      presses += 1

var application: Node
var surface: Control
var checks: Array = []
var expected_original_failures: Array = []
var stages: Array = []
var content: Dictionary = {}
var allow_original_negative := false
var sabotage := false
# A host without the policy cannot reach a stage's state: its waits are short (the same bundle runs, only the patience differs).
var patient := true
var original_window: Dictionary = {}
# The padding every SafeAreaView holds, as the probe expects it: the previous stage's, or zero.
var held: Dictionary = {}
var expected_errors: Array = []
var platform_scale := 1.0
var world_cases: Array = []
var seam_faults: Array = []

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# Needs this slice's host: the control on the previous host must fail it.
func normative(condition: bool, name: String) -> bool:
  expected_original_failures.append(name)
  return check(condition, name)

# Normative only when the previous host cannot satisfy it by accident (its scale is always 1, it pads nothing).
func conditional(is_normative: bool, condition: bool, name: String) -> bool:
  return normative(condition, name) if is_normative else check(condition, name)

func zero() -> Dictionary:
  return {"left": 0.0, "top": 0.0, "right": 0.0, "bottom": 0.0}

func is_zero(padding: Dictionary) -> bool:
  for side: String in SIDES:
    if absf(float(padding[side])) > 1e-6:
      return false
  return true

func same(first: Dictionary, second: Dictionary, tolerance := 1e-3) -> bool:
  for side: String in SIDES:
    if absf(float(first.get(side, -1.0)) - float(second.get(side, -2.0))) > tolerance:
      return false
  return true

# Waits for a state, not for a number of frames; the limit only ends a wait that can no longer succeed.
# A state the previous host can reach too (the mount) is waited for as long on both.
func wait_for(condition: Callable, seconds := 5.0, always := false) -> bool:
  var limit := Time.get_ticks_msec() + int((seconds if patient or always else 0.6) * 1000.0)
  while Time.get_ticks_msec() < limit:
    if condition.call():
      return true
    await process_frame
  return condition.call()

func js_snapshot() -> Dictionary:
  var text: String = application.call("evaluate", "JSON.stringify(MobileDensityProbe.snapshot())")
  var value: Variant = JSON.parse_string(text)
  return value if value is Dictionary else {}

func native_snapshot() -> Dictionary:
  var value: Variant = JSON.parse_string(surface.call("snapshot"))
  return value if value is Dictionary else {}

func nodes_by_id(native: Dictionary) -> Dictionary:
  var result := {}
  for node: Dictionary in native.get("nodes", []):
    if str(node.get("testID", "")) != "":
      result[node.testID] = node
  return result

func counters(native: Dictionary) -> Dictionary:
  var section: Variant = native.get("displayInsets", {})
  if not section is Dictionary:
    return {"requested": -1, "committed": -1, "views": -1}
  return {"requested": int(section.get("requested", -1)), "committed": int(section.get("committed", -1)),
    "views": int(section.get("views", -1))}

func window_facts() -> Dictionary:
  return {"mode": int(root.content_scale_mode), "contentSize": [root.content_scale_size.x, root.content_scale_size.y],
    "factor": root.content_scale_factor, "pixels": [root.size.x, root.size.y],
    "visible": [root.get_visible_rect().size.x, root.get_visible_rect().size.y]}

func record_window() -> void:
  original_window = window_facts()

func restore_window() -> void:
  root.content_scale_mode = Window.CONTENT_SCALE_MODE_DISABLED
  root.content_scale_size = Vector2i.ZERO
  root.content_scale_factor = 1.0

# UIKit's safeAreaInsets of a frame, rounded to a pixel; written here from the rules, not from the host.
func target_padding(frame: Dictionary, size: Vector2, unsafe: Dictionary, scale: float) -> Dictionary:
  var raw := {
    "left": maxf(0.0, float(unsafe.left) - float(frame.x)),
    "top": maxf(0.0, float(unsafe.top) - float(frame.y)),
    "right": maxf(0.0, float(unsafe.right) - (size.x - (float(frame.x) + float(frame.width)))),
    "bottom": maxf(0.0, float(unsafe.bottom) - (size.y - (float(frame.y) + float(frame.height))))}
  for side: String in SIDES:
    raw[side] = roundf(float(raw[side]) * scale) / scale
  return raw

# The State changes only when a side moved by a pixel and 0.01 (RCTSafeAreaViewComponentView).
func held_after(previous: Dictionary, target: Dictionary, scale: float) -> Dictionary:
  var threshold := 1.0 / scale + 0.01
  for side: String in SIDES:
    if absf(float(target[side]) - float(previous[side])) >= threshold:
      return target
  return previous

func window_size(js: Dictionary) -> Vector2:
  var window: Variant = js.get("dimensions", {}).get("window", {})
  return Vector2(float(window.get("width", 0)), float(window.get("height", 0))) if window is Dictionary else Vector2.ZERO

# What every SafeAreaView should hold, from the frames JS measured and the padding it held before.
func expected_held(js: Dictionary, unsafe: Dictionary, scale: float) -> Dictionary:
  var result := {}
  var frames: Dictionary = js.get("frames", {})
  for id: String in VIEWS:
    if not frames.has(id):
      return {}
    result[id] = held_after(held.get(id, zero()), target_padding(frames[id], window_size(js), unsafe, scale), scale)
  return result

func held_matches(js: Dictionary, native: Dictionary, unsafe: Dictionary, scale: float) -> bool:
  var expected := expected_held(js, unsafe, scale)
  if expected.is_empty():
    return false
  var nodes := nodes_by_id(native)
  for id: String in VIEWS:
    var padding: Variant = nodes.get(id, {}).get("safeArea", null)
    if not padding is Dictionary or not same(padding, expected[id]):
      return false
  return true

# The padding the layout shows: how far the child that fills a SafeAreaView sits inside it.
func layout_padding(frames: Dictionary, id: String) -> Dictionary:
  var view: Dictionary = frames[id]
  var fill: Dictionary = frames[id + "-fill" if id != "hud" else "hud-fill"]
  return {"left": float(fill.x) - float(view.x), "top": float(fill.y) - float(view.y),
    "right": (float(view.x) + float(view.width)) - (float(fill.x) + float(fill.width)),
    "bottom": (float(view.y) + float(view.height)) - (float(fill.y) + float(fill.height))}

func inside(frame: Dictionary, size: Vector2, unsafe: Dictionary, slack: float) -> bool:
  return (float(frame.x) >= float(unsafe.left) - slack and float(frame.y) >= float(unsafe.top) - slack
    and float(frame.x) + float(frame.width) <= size.x - float(unsafe.right) + slack
    and float(frame.y) + float(frame.height) <= size.y - float(unsafe.bottom) + slack)

func add_application(name: String, policy: Variant) -> void:
  application = ClassDB.instantiate("FabricApplication")
  application.name = name
  application.set("bundle_path", "res://build/mobile-density-probe.js")
  if policy != null:
    application.set("density_policy", policy)
  root.add_child(application)

func add_surface(name: String, application_name: String, component := "MobileDensityProbe", props := {}) -> void:
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.size = Vector2(root.get_visible_rect().size)
  surface.set("application_path", NodePath("../" + application_name))
  surface.set("component_name", component)
  if not props.is_empty():
    surface.set("initial_props", props)
  root.add_child(surface)
  # Anchored to the window, so that it follows the visible size when the scale changes.
  surface.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

func mounted() -> bool:
  var js := js_snapshot()
  var frames: Dictionary = js.get("frames", {})
  for id: String in VIEWS + HUD_CHILDREN + ["hud-fill", "bleed-fill", "nested-fill", "floating-fill", "edge-top-fill", "edge-corner-fill"]:
    if not frames.has(id):
      return false
  return true

func remove_application() -> void:
  surface.queue_free()
  application.queue_free()
  await process_frame
  await process_frame

func frames_run() -> int:
  var clock: Variant = native_snapshot().get("frameClock", {})
  return int(clock.get("frames", 0)) if clock is Dictionary else 0

# The content policy: today's behavior. The seam for the screen's scale means nothing, the project's stretch is left alone, and the
# insets seam is the only thing the SafeAreaViews follow.
func content_case() -> void:
  record_window()
  add_application("ContentApplication", null)
  application.set_meta("validation_screen_scale", 2.0)
  application.set_meta("validation_safe_area", INSETS)
  normative(application.get("density_policy") == "content", "content/density_policy is content unless the project says otherwise")
  add_surface("ContentSurface", "ContentApplication")
  var ready: bool = await wait_for(mounted, 30.0, true)
  check(ready, "content/The HUD mounts through the original AppRegistry")
  var js := js_snapshot()
  var native := native_snapshot()
  var facts := window_facts()
  check(facts == original_window, "content/The project's stretch settings are left alone")
  check((is_equal_approx(float(js.dimensions.window.scale), 1.0) and Vector2(float(js.dimensions.window.width),
      float(js.dimensions.window.height)) == Vector2(WINDOW)),
    "content/Dimensions.window.scale stays 1 and the window is its pixels, whatever the screen's scale")
  var content_touch: Dictionary = js.frames.get("touch-target", {"width": -1, "height": -1})
  check(absf(float(content_touch.width) - 44.0) <= 0.5 and absf(float(content_touch.height) - 44.0) <= 0.5,
    "content/A 44-point Pressable measures 44 ± 0.5 via measureInWindow")
  var converged: bool = await wait_for(func() -> bool: return held_matches(js_snapshot(), native_snapshot(), INSETS, 1.0))
  js = js_snapshot()
  native = native_snapshot()
  normative(converged, "content/The SafeAreaViews follow the unsafe bands at the density of the window")
  content = {"scale": 1.0, "seam": INSETS, "godot": facts, "originalWindow": original_window, "js": js,
    "native": {"nodes": nodes_by_id(native), "displayInsets": native.get("displayInsets", {}), "dimensions": native.get("dimensions", {})}}
  await remove_application()
  check(window_facts() == original_window, "content/Removing the application leaves the stretch settings as they were")

func stage(name: String, scale: Variant, seam: Variant, expect_scale: float, scale_changes: bool) -> void:
  var before_js := js_snapshot()
  # A new application has counted nothing: the first stage starts from zero, whatever the mount already did.
  var before := counters(native_snapshot()) if not held.is_empty() else {"requested": 0, "committed": 0, "views": 0}
  var events_before := (before_js.events as Array).size()
  if scale == null:
    application.remove_meta("validation_screen_scale")
  else:
    application.set_meta("validation_screen_scale", scale)
  var unsafe: Dictionary = zero() if seam == null else seam
  if seam == null:
    application.remove_meta("validation_safe_area")
  else:
    application.set_meta("validation_safe_area", seam)
  var read: bool = await wait_for(func() -> bool:
    var native := native_snapshot()
    var dimensions: Variant = native.get("dimensions", {}).get("window", {})
    var insets: Variant = native.get("displayInsets", {}).get("unsafe", {})
    return (dimensions is Dictionary and is_equal_approx(float(dimensions.get("scale", 0)), expect_scale)
      and insets is Dictionary and same(insets, unsafe)))
  normative(read, name + "/Dimensions.window.scale equals the screen's scale")
  var wanted := expected_held(js_snapshot(), unsafe, expect_scale)
  var any_change := false
  for id: String in wanted:
    if not same(wanted[id], held.get(id, zero())):
      any_change = true
  if read and any_change:
    await wait_for(func() -> bool: return held_matches(js_snapshot(), native_snapshot(), unsafe, expect_scale))
  elif read:
    # Nothing is to change: the pumps that ran after the host read the window are the evidence, so wait for two more.
    var pumps := frames_run()
    await wait_for(func() -> bool: return frames_run() >= pumps + 2)
  var js := js_snapshot()
  var native := native_snapshot()
  var nodes := nodes_by_id(native)
  var facts := window_facts()
  var size := window_size(js)
  var after := counters(native)
  var expected := expected_held(js, unsafe, expect_scale)
  var padded := false
  for id: String in expected:
    if not is_zero(expected[id]):
      padded = true
  var window: Dictionary = js.dimensions.window
  var scaled := not is_equal_approx(expect_scale, 1.0)
  conditional(scaled, is_equal_approx(float(window.scale), expect_scale) and js.hook == window,
    name + "/Dimensions.get and useWindowDimensions report the screen's scale")
  normative((facts.mode == CANVAS_ITEMS and facts.contentSize == [0, 0] and is_equal_approx(float(facts.factor), expect_scale)),
    name + "/The window stretches as canvas_items with no content size, at the screen's scale")
  conditional(scaled, (Vector2(float(window.width), float(window.height)) * expect_scale).is_equal_approx(Vector2(WINDOW))
      and Vector2(float(facts.visible[0]), float(facts.visible[1])) == size,
    name + "/The window's size in points is its pixels over the scale")
  var touch: Dictionary = js.frames.get("touch-target", {"width": -1, "height": -1})
  check(absf(float(touch.width) - 44.0) <= 0.5 and absf(float(touch.height) - 44.0) <= 0.5,
    name + "/A 44-point Pressable measures 44 ± 0.5 via measureInWindow")
  var event_delta := (js.events as Array).size() - events_before
  if scale_changes:
    normative(event_delta == 1 and is_equal_approx(float(js.events[events_before].window.scale), expect_scale),
      name + "/didUpdateDimensions fires once for the change of scale")
  else:
    check(event_delta == 0, name + "/didUpdateDimensions does not fire when only the insets change")
  var holds := held_matches(js, native, unsafe, expect_scale)
  var padding_expected := padded or not is_zero(held.get("hud", zero()))
  conditional(padding_expected, holds, name + "/Every SafeAreaView holds the padding that UIKit's rules give its frame")
  var shown := true
  for id: String in VIEWS:
    var layout := layout_padding(js.frames, id)
    # Yoga lays every edge out on the pixel grid of the scale, so the padding shows to within a pixel.
    shown = shown and nodes.has(id) and nodes[id].has("safeArea") and same(layout, nodes[id].safeArea, 1.0 / expect_scale + 1e-3)
  conditional(padding_expected, shown, name + "/The layout shows the padding of the State")
  var slack := 1.0 / expect_scale + 0.01
  var hud_inside := true
  for id: String in HUD_CHILDREN:
    hud_inside = hud_inside and inside(js.frames[id], size, unsafe, slack)
  conditional(seam != null, hud_inside, name + "/The HUD's children all lie inside the safe rect")
  # A State changes when a side moved by the threshold and nothing is asked of RN otherwise.
  var counted: bool = int(after.requested) >= 0 and int(before.requested) >= 0
  var updated: bool = (after.committed > before.committed) if any_change else (after.requested == before.requested and after.committed == before.committed)
  normative(counted and updated, name + "/A State changes when a side moved by the threshold and nothing is requested otherwise")
  var accepted: Dictionary = {}
  for id: String in VIEWS:
    accepted[id] = nodes[id].safeArea if nodes.has(id) and nodes[id].has("safeArea") else zero()
  held = accepted
  stages.append({"name": name, "scale": expect_scale, "seam": seam, "scaleChanges": scale_changes, "godot": facts, "js": js,
    "native": {"nodes": nodes, "displayInsets": native.get("displayInsets", {}), "dimensions": native.get("dimensions", {}),
      "viewportUpdates": native.get("viewportUpdates", -1)},
    "before": before, "after": after, "expectedHeld": expected, "eventsBefore": events_before})

func world_js(expression: String) -> Variant:
  var text: String = application.call("evaluate", "JSON.stringify(MobileDensityWorld." + expression + ")")
  return JSON.parse_string(text)

func world_mounted() -> bool:
  var value: Variant = world_js("frames()")
  return value is Dictionary and value.has("frames") and value.frames.has("button") and value.frames.has("bar") and value.frames.has("root")

# N left clicks at a point, queued and delivered at once with Input.flush_buffered_events (the way the pointer spike of the world does it),
# so that no count depends on how many frames went by. The point is in the HUD's points and the event in window pixels.
func click(at: Vector2, n: int, factor: float) -> void:
  for index in range(n):
    for pressed in [true, false]:
      var event := InputEventMouseButton.new()
      event.position = at * factor
      event.global_position = at * factor
      event.button_index = MOUSE_BUTTON_LEFT
      event.pressed = pressed
      event.button_mask = 1 if pressed else 0
      Input.parse_input_event(event)
  Input.flush_buffered_events()

# The points of the HUD, in points, by the scale the case asks for: the empty area, the padding band (inside the insets' left band and clear
# of the bar), and the centre of the Pressable from its measured frame.
func world_points(requested: float, frames: Dictionary) -> Dictionary:
  var button: Dictionary = frames.button
  return {
    "void": Vector2(350, 250) if requested > 1.0 else Vector2(700, 550),
    "band": Vector2(10, 150) if requested > 1.0 else Vector2(10, 300),
    "button": Vector2(float(button.x) + float(button.width) / 2.0, float(button.y) + float(button.height) / 2.0),
  }

func world_case(requested: float, root_kind: String, events: String) -> void:
  restore_window()
  var tree_world := World.new()
  tree_world.name = "World"
  root.add_child(tree_world)
  add_application("WorldApplication", "screen" if requested > 1.0 else null)
  application.set_meta("validation_safe_area", INSETS)
  if requested > 1.0:
    application.set_meta("validation_screen_scale", requested)
  add_surface("WorldSurface", "WorldApplication", "MobileDensityWorld", {"root": root_kind, "pointerEvents": events})
  var ready: bool = await wait_for(world_mounted, 30.0, true)
  var label := "world/scale %d/%s/%s" % [int(requested), root_kind, events]
  check(ready, label + "/The HUD over the world mounts")
  var entry := {"requested": requested, "root": root_kind, "events": events, "clicks": CLICKS, "mounted": ready, "points": {}}
  if ready:
    # Wait for the scale the case asks for, as Dimensions reports it; the previous host never reaches it and runs at its own.
    await wait_for(func() -> bool: return is_equal_approx(float(world_js("frames()").window.scale), requested), 5.0)
    # The SafeAreaView root's State takes the insets on the pumps after the mount: wait for it to hold the seam's left and top band.
    if root_kind == "safe":
      await wait_for(func() -> bool:
        var node: Dictionary = nodes_by_id(native_snapshot()).get("world-root", {})
        return (node.has("safeArea") and absf(float(node.safeArea.left) - float(INSETS.left)) < 0.01
          and absf(float(node.safeArea.top) - float(INSETS.top)) < 0.01))
    var measured: Dictionary = world_js("frames()")
    var factor := float(measured.window.scale)
    entry["scale"] = factor
    entry["window"] = measured.window
    entry["frames"] = measured.frames
    var points := world_points(requested, measured.frames)
    for name: String in points:
      tree_world.presses = 0
      world_js("reset()")
      var pumps := frames_run()
      click(points[name], CLICKS, factor)
      # The burst reaches JS on the pumps that follow; two of them are enough for every handler to have run.
      await wait_for(func() -> bool: return frames_run() >= pumps + 2)
      entry.points[name] = {"at": [points[name].x, points[name].y], "world": tree_world.presses, "hud": world_js("snapshot()")}
  world_cases.append(entry)
  tree_world.queue_free()
  await remove_application()

func world_group() -> void:
  for requested: float in WORLD_SCALES:
    for events: String in WORLD_EVENTS:
      for root_kind: String in WORLD_ROOTS:
        await world_case(requested, root_kind, events)
  for requested: float in WORLD_SCALES:
    for events: String in WORLD_EVENTS:
      var safe := world_entry(requested, "safe", events)
      var plain := world_entry(requested, "view", events)
      var label := "world/scale %d/%s" % [int(requested), events]
      if safe.get("points", {}).is_empty() or plain.get("points", {}).is_empty():
        continue
      for name: String in ["void", "band", "button"]:
        var mine: Dictionary = safe.points[name]
        var control: Dictionary = plain.points[name]
        check(mine.world == control.world and mine.hud == control.hud, "%s/%s/The SafeAreaView and the View leave the same to the world and to the HUD" % [label, name])
      # The seam's bands pad the SafeAreaView root and the bar inside it; the View root pads nothing.
      var offset := Vector2(float(safe.frames.bar.x) - float(plain.frames.bar.x), float(safe.frames.bar.y) - float(plain.frames.bar.y))
      normative(offset.is_equal_approx(Vector2(float(INSETS.left), float(INSETS.top))) and is_equal_approx(float(plain.frames.bar.x), 0.0),
        "%s/The SafeAreaView root pads the HUD by the insets of the seam and the View root does not" % label)
      for root_kind: String in WORLD_ROOTS:
        var entry := world_entry(requested, root_kind, events)
        var kind := "%s/%s" % [label, root_kind]
        var points: Dictionary = entry.points
        if events == "box-none":
          normative(points.void.world == CLICKS and points.void.hud.is_empty(), kind + "/void/A click on the empty HUD reaches the world %d times and the HUD none" % CLICKS)
          normative(points.band.world == CLICKS and points.band.hud.is_empty(), kind + "/band/A click in the padding band reaches the world %d times and the HUD none" % CLICKS)
          check(points.button.world == 0 and int(points.button.hud.get("press", 0)) == CLICKS,
            kind + "/button/A click on the Pressable presses it %d times and never reaches the world" % CLICKS)
        else:
          # React Native's rule on a phone: the box of a view includes its padding, so a root that takes pointers takes the band too.
          check(points.void.world == 0 and int(points.void.hud.get("rootDown", 0)) == CLICKS, kind + "/void/The root takes the empty area, so the world hears none")
          check(points.band.world == 0 and int(points.band.hud.get("rootDown", 0)) == CLICKS, kind + "/band/The box of the root includes its padding band, so the world hears none")
          check(points.button.world == 0 and int(points.button.hud.get("press", 0)) == CLICKS, kind + "/button/A click on the Pressable presses it %d times and never reaches the world" % CLICKS)

func world_entry(requested: float, root_kind: String, events: String) -> Dictionary:
  for entry: Dictionary in world_cases:
    if entry.requested == requested and entry.root == root_kind and entry.events == events:
      return entry
  return {}

func screen_case() -> void:
  add_application("ScreenApplication", "bogus")
  # The invalid value is refused with a diagnostic and the policy stays what it was.
  normative(application.get("density_policy") == "content", "policy/An unknown density policy is refused and the policy stays")
  expected_errors.append("Density policy must be content or screen: bogus")
  application.set("density_policy", "screen")
  normative(application.get("density_policy") == "screen", "policy/density_policy takes screen before the application initializes")
  application.set_meta("validation_screen_scale", 2.0)
  application.set_meta("validation_safe_area", INSETS)
  add_surface("ScreenSurface", "ScreenApplication")
  var ready: bool = await wait_for(mounted, 30.0, true)
  check(ready, "mount/The HUD mounts through the original AppRegistry")
  held = {}
  # The first read of the window already follows the policy: mounting at scale 2 is not a change of scale.
  await stage("mount", 2.0, INSETS, 2.0, false)
  await stage("scale-3", 3.0, INSETS, 3.0, true)
  await stage("sub-threshold", 3.0, SUB_THRESHOLD, 3.0, false)
  await stage("moved", 3.0, MOVED, 3.0, false)
  await stage("cleared", 3.0, null, 3.0, false)
  await stage("scale-2", 2.0, INSETS, 2.0, true)
  await stage("platform-scale", null, INSETS, platform_scale, not is_equal_approx(platform_scale, 2.0))
  # The policy cannot change once the application runs.
  application.set("density_policy", "content")
  expected_errors.append("Density policy cannot change after application initialization")
  normative(application.get("density_policy") == "screen", "policy/density_policy cannot change after the application initializes")
  await wait_for(func() -> bool: return (native_snapshot().get("errors", []) as Array).size() >= 1)
  var native := native_snapshot()
  stages.append({"name": "diagnostics", "errors": native.get("errors", [])})
  surface.call("unmount")
  var released: bool = await wait_for(func() -> bool: return int(native_snapshot().get("nativeTags", -1)) == 0)
  var after_unmount := native_snapshot()
  check(released and int(after_unmount.get("nativeTags", -1)) == 0 and int(after_unmount.get("creates", -1)) == int(after_unmount.get("deletes", -2)),
    "cleanup/Unmounting releases every native Control, SafeAreaViews included")
  var forgotten: bool = await wait_for(func() -> bool: return int(counters(native_snapshot()).views) == 0)
  normative(forgotten, "cleanup/The host forgets its SafeAreaViews once they unmount")
  stages.append({"name": "cleanup", "native": native_snapshot()})
  await remove_application()

# The invalid band of a fault: not a finite number of points, or below zero.
func fault_value(kind: String) -> Variant:
  match kind:
    "negative":
      return -5.0
    "string":
      return "20"
  return NAN

# The padding of every SafeAreaView as the host holds it: {} for a view the host gave no padding to (a host that has none).
func paddings(native: Dictionary) -> Dictionary:
  var nodes := nodes_by_id(native)
  var result := {}
  for id: String in VIEWS:
    var padding: Variant = nodes.get(id, {}).get("safeArea", null)
    result[id] = padding if padding is Dictionary else {}
  return result

# What the next stage starts from: the padding held, zero where there is none.
func held_of(raw: Dictionary) -> Dictionary:
  var result := {}
  for id: String in VIEWS:
    result[id] = raw[id] if not (raw[id] as Dictionary).is_empty() else zero()
  return result

func sound_edges(edges: Variant) -> bool:
  if not edges is Dictionary:
    return false
  for side: String in SIDES:
    var value: Variant = edges.get(side, null)
    if not (value is float or value is int) or is_nan(float(value)) or is_inf(float(value)) or float(value) < 0.0:
      return false
  return true

func sound_paddings(raw: Dictionary) -> bool:
  for id: String in VIEWS:
    if not sound_edges(raw[id]):
      return false
  return true

func seam_case() -> void:
  restore_window()
  add_application("SeamApplication", "screen")
  application.set_meta("validation_screen_scale", 2.0)
  application.set_meta("validation_safe_area", INSETS)
  add_surface("SeamSurface", "SeamApplication")
  var ready: bool = await wait_for(mounted, 30.0, true)
  check(ready, "seam/The HUD mounts through the original AppRegistry")
  held = {}
  var settled: bool = await wait_for(func() -> bool: return held_matches(js_snapshot(), native_snapshot(), INSETS, 2.0))
  normative(settled, "seam/The valid bands are followed before any is refused")
  held = held_of(paddings(native_snapshot()))
  var diagnostics: Array = []
  for index in range(SEAM_FAULTS.size()):
    var fault: Dictionary = SEAM_FAULTS[index]
    var kind: String = fault.kind
    var side: String = fault.side
    var message := "validation_safe_area.%s must be a finite non-negative number" % side
    var good: Dictionary = SEAM_VALID[index]
    var next: Dictionary = SEAM_VALID[index + 1]
    var broken := good.duplicate()
    broken[side] = fault_value(kind)
    var before := paddings(native_snapshot())
    diagnostics.append(message)
    expected_errors.append(message)
    application.set_meta("validation_safe_area", broken)
    var refused: bool = await wait_for(func() -> bool: return (native_snapshot().get("errors", []) as Array) == diagnostics)
    # The pumps that ran after the refusal are the evidence that nothing was applied: wait for two more of the host's own.
    var pumps := frames_run()
    await wait_for(func() -> bool: return frames_run() >= pumps + 2)
    var js := js_snapshot()
    var native := native_snapshot()
    var kept := paddings(native)
    var unsafe: Variant = native.get("displayInsets", {}).get("unsafe", {})
    var unchanged: bool = not is_zero(held.hud)
    for id: String in VIEWS:
      unchanged = unchanged and same(kept[id], before[id], 1e-9)
    normative(refused and (native.get("errors", []) as Array) == diagnostics,
      "seam/%s/The band is refused with a diagnostic that names it, once" % kind)
    normative(unsafe is Dictionary and same(unsafe, good), "seam/%s/The host keeps the bands of the last valid seam" % kind)
    normative(unchanged, "seam/%s/Every SafeAreaView keeps the padding the last valid bands gave it" % kind)
    normative(sound_paddings(kept) and sound_edges(unsafe), "seam/%s/No SafeAreaView holds a NaN or a negative padding" % kind)
    # As soon as the seam is valid again it is followed again.
    application.set_meta("validation_safe_area", next)
    var recovered: bool = await wait_for(func() -> bool: return held_matches(js_snapshot(), native_snapshot(), next, 2.0))
    normative(recovered, "seam/%s/A valid seam after the refused one is followed again" % kind)
    var after_js := js_snapshot()
    var after := paddings(native_snapshot())
    seam_faults.append({"kind": kind, "side": side, "scale": 2.0, "validSeam": good, "recoverySeam": next,
      "window": js.get("dimensions", {}).get("window", {}), "frames": js.get("frames", {}), "before": before, "kept": kept,
      "unsafe": unsafe if unsafe is Dictionary else {}, "errors": native.get("errors", []),
      "recovered": {"frames": after_js.get("frames", {}), "padding": after}})
    held = held_of(after)
  await remove_application()
  restore_window()

func _initialize() -> void:
  var arguments := OS.get_cmdline_user_args()
  allow_original_negative = arguments.has("--allow-original-negative")
  sabotage = arguments.has("--sabotage")
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = WINDOW
  patient = ClassDB.class_has_method("FabricApplication", "set_density_policy")
  platform_scale = DisplayServer.screen_get_scale(DisplayServer.window_get_current_screen())
  await content_case()
  restore_window()
  await screen_case()
  await seam_case()
  await world_group()
  await finish()

func finish() -> void:
  restore_window()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var report := {"scenario": "native-mobile-density", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "window": [WINDOW.x, WINDOW.y], "platformScale": platform_scale,
    "checks": checks, "content": content, "stages": stages, "world": world_cases, "seamFaults": seam_faults, "expectedErrors": expected_errors,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": original_negative_observed, "sabotage": sabotage, "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"densityPolicy": "screen", "safeAreaSeam": "validation_safe_area", "screenScaleSeam": "validation_screen_scale",
      "simulatorCertified": false, "physicalDeviceCertified": false}}
  var output := FileAccess.open("res://build/mobile-density-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The density report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if sabotage:
    print("MOBILE_DENSITY_SABOTAGE_REJECTED: " + str(failures.size()))
    quit(0 if not failures.is_empty() else 1)
    return
  print("MOBILE_DENSITY_ORIGINAL_NEGATIVE: " + str(failures.size()) if original_negative_observed else "MOBILE_DENSITY_PASSED: " + str(checks.size()) if failures.is_empty() else "MOBILE_DENSITY_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed else 1)
