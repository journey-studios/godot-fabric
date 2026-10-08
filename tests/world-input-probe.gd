extends SceneTree

# Pointer spike (go/no-go no. 1): a React Native HUD over a Godot world. A click on the
# HUD's empty area must reach the world exactly once; a click on a Pressable must press
# it once and never reach the world; with an overlay open, no click reaches the world.
#
# The world (examples/world-input/world.tscn) listens in _unhandled_input, the HUD is
# a CanvasLayer with FabricSurfaces whose root is pointerEvents="box-none"
# (tests/world-input-fixture.jsx). Two topologies, measured by the same independent
# oracle (tests/world-input-oracle.mjs):
#
#   a  one full-screen Surface (examples/world-input/scene.tscn), N = 100 per burst
#   b  one Surface per panel, two side by side (examples/world-input/panels.tscn), N = 20
#
# Every count is exact and taken on a burst of events that Input.parse_input_event queues
# and Input.flush_buffered_events delivers on the spot: nothing is read after waiting a
# number of frames, so the result does not depend on the pace of the runner. Frames are
# waited only until a condition holds, for a scene to mount and for an overlay or a Modal
# to open or close.
#
# The events carry no validation_input_device: that meta marks every other device as
# blocked. The pointer adapter ignores device -1, the mouse Godot emulates from a touch.
#
# A normative check needs the policy (the Surface does not take the pointer of the empty
# area): the host that predates it must fail exactly these. The others hold on both hosts.
# The informative rows (the gaps of the minimal policy) record what was measured and never
# pass or fail.
#
# --allow-original-negative runs on the preceding host. --sabotage=surface-stop forces the
# Surfaces back to MOUSE_FILTER_STOP; --sabotage=views-ignore gives every Control of the
# Views MOUSE_FILTER_IGNORE: the probe and the oracle must both reject them.
const SCENES := {"a": "res://examples/world-input/scene.tscn", "b": "res://examples/world-input/panels.tscn"}
const SIZE := Vector2i(800, 600)
const FULL := 100
const SMALL := 20
const TILE := 32
const FILTER_IGNORE := 2

# Points of the 800x600 root in topology (a). The fixture paints: a bar (0,0)-(300,100) with
# a handler and a Pressable (20,20)-(120,60), a plain panel (320,0)-(480,100), a ScrollView
# panel (0,120)-(300,270), a Pressable with a hit slop of 20 at (500,100)-(560,140), a Text
# with onPress at (500,200), a box-none wrapper with a short ScrollView at (400,300)-(700,450).
const VOID := Vector2(700, 550)
const VOID_B := Vector2(650, 250)
const VOID_C := Vector2(400, 520)
const BUTTON := Vector2(70, 40)
const BAR := Vector2(250, 80)
const PLAIN := Vector2(400, 50)
const SCROLL_BUTTON := Vector2(100, 200)
const SLOP := Vector2(490, 120)
const TEXT := Vector2(520, 212)
const SCROLL_GAP := Vector2(550, 400)
const OVERLAY_BUTTON := Vector2(350, 320)
# Topology (b): the left Surface is (0,0)-(400,600), the right one (400,0)-(800,600).
const PANEL_BUTTON := {"left": Vector2(70, 40), "right": Vector2(470, 40)}
const PANEL_BAR := {"left": Vector2(300, 70), "right": Vector2(700, 70)}
const PANEL_VOID := {"left": Vector2(200, 400), "right": Vector2(600, 400)}

var checks: Array = []
var expected_original_failures: Array = []
var allow_original_negative := false
var sabotage := ""
var topologies := {}
var topology := ""
var section: Dictionary = {}
var scene: Node
var world: Node2D
var app: Node
var surfaces: Array = []
var world_info := {}

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check needs the policy: the preceding host fails exactly these.
func normative(condition: bool, name: String) -> bool:
  expected_original_failures.append(name)
  return check(condition, name)

# A check on what an input does with the empty area. The GUI stops a click, a touch and a drag at a Control with
# MOUSE_FILTER_STOP, but passes a wheel tick (Control.force_pass_scroll_events is true by default; Viewport::_gui_call_input), so the
# wheel reaches the world on the preceding host too: its checks hold on both hosts and are not normative.
func pointer_check(input: String, condition: bool, name: String) -> bool:
  if input == "wheel":
    return check(condition, name)
  return normative(condition, name)

func settle(count := 3) -> void:
  for index in range(count):
    await process_frame

# Waits until the condition holds, at most `limit` frames: the frames are a bound on a hang, not a measure.
func wait_for(condition: Callable, limit := 600) -> bool:
  for index in range(limit):
    if condition.call():
      return true
    await process_frame
  return condition.call()

func js(expression: String) -> Variant:
  return JSON.parse_string(app.call("evaluate", "JSON.stringify(" + expression + ")"))

func rn_counts() -> Dictionary:
  var counts := {}
  var parsed: Variant = js("WorldInputProbe.snapshot()")
  if parsed is Dictionary:
    for key: String in parsed:
      counts[key] = int(parsed[key])
  return counts

func node_by(test_id: String) -> Dictionary:
  for surface: Control in surfaces:
    var parsed: Variant = JSON.parse_string(surface.call("snapshot"))
    if parsed is Dictionary:
      for node: Dictionary in parsed.get("nodes", []):
        if node.get("testID") == test_id:
          return node
  return {}

# ---- the sabotages ----
func apply_sabotage() -> void:
  if sabotage == "surface-stop":
    for surface: Control in surfaces:
      surface.mouse_filter = Control.MOUSE_FILTER_STOP
  elif sabotage == "views-ignore":
    for control: Control in root.find_children("*", "Control", true, false):
      control.mouse_filter = Control.MOUSE_FILTER_IGNORE

# ---- the scene ----
func mounted() -> bool:
  for surface: Control in surfaces:
    if int(surface.call("get_surface_id")) == 0:
      return false
  return not node_by("bar-button").is_empty()

func mount(which: String) -> void:
  topology = which
  var packed: PackedScene = load(SCENES[which])
  scene = packed.instantiate()
  root.add_child(scene)
  world = scene.get_node("World")
  app = scene.get_node("Application")
  surfaces = scene.get_node("Hud").get_children()
  var reached := await wait_for(mounted)
  # The report records the Surfaces as the run uses them, a sabotage included.
  apply_sabotage()
  var camera: Camera2D = world.get_node("Camera")
  world_info = {"tile": TILE, "columns": 24, "rows": 16, "camera": {"position": [camera.position.x, camera.position.y], "zoom": [camera.zoom.x, camera.zoom.y]}}
  section = {"scene": SCENES[which], "surfaces": [], "rows": [], "hovers": [], "gaps": [], "transitions": []}
  for surface: Control in surfaces:
    var rect := surface.get_global_rect()
    section.surfaces.append({"name": String(surface.name), "rect": [rect.position.x, rect.position.y, rect.size.x, rect.size.y],
      "mouseFilter": surface.mouse_filter})
  topologies[which] = section
  check(reached and camera.is_current(), which + "/setup: the scene mounts and its Camera2D is current")

func teardown() -> void:
  app.call("stop")
  scene.queue_free()
  await settle(2)

func filters_are_ignore() -> bool:
  return surfaces.all(func(surface: Control) -> bool: return surface.mouse_filter == FILTER_IGNORE)

# ---- injection ----
func motion(at: Vector2) -> void:
  var event := InputEventMouseMotion.new()
  event.position = at
  event.global_position = at
  Input.parse_input_event(event)

func button_event(at: Vector2, button: int, pressed: bool) -> void:
  var event := InputEventMouseButton.new()
  event.position = at
  event.global_position = at
  event.button_index = button
  event.pressed = pressed
  event.button_mask = (1 << (button - 1)) if pressed else 0
  Input.parse_input_event(event)

func touch_event(at: Vector2, pressed: bool) -> void:
  var event := InputEventScreenTouch.new()
  event.index = 0
  event.position = at
  event.pressed = pressed
  Input.parse_input_event(event)

# A part is one interaction at a point: a click, a right click, a wheel tick (press and release of
# the wheel button) or a tap, on a region of the HUD or of the world.
func part(region: String, input: String, at: Vector2, panel := "hud") -> Dictionary:
  return {"region": region, "input": input, "at": [at.x, at.y], "panel": panel}

func inject(item: Dictionary) -> void:
  var at := Vector2(item.at[0], item.at[1])
  if item.input == "touch":
    touch_event(at, true)
    touch_event(at, false)
    return
  var button := MOUSE_BUTTON_LEFT
  if item.input == "right":
    button = MOUSE_BUTTON_RIGHT
  elif item.input == "wheel":
    button = MOUSE_BUTTON_WHEEL_UP
  motion(at)
  button_event(at, button, true)
  button_event(at, button, false)

# What the world heard, by stream: mouse and emulated-mouse presses and releases by button, touches.
func observe() -> Dictionary:
  var counts := {}
  for received: Array in world.received:
    var key := ""
    if received[0] == "InputEventMouseButton":
      key = ("emulated" if received[1] == -1 else "mouse") + "/" + ("press" if received[3] else "release") + "/" + str(received[2])
    elif received[0] == "InputEventScreenTouch":
      key = "touch/" + ("press" if received[3] else "release")
    if key != "":
      counts[key] = int(counts.get(key, 0)) + 1
  return counts

func tiles() -> Dictionary:
  var counts := {}
  for tile: Vector2i in world.selected:
    counts["%d,%d" % [tile.x, tile.y]] = int(world.selected[tile])
  return counts

# n repetitions of the parts, queued and delivered at once; the row records what each side heard.
func burst(id: String, parts: Array, n: int, extra := {}, into := "rows") -> Dictionary:
  world.reset()
  app.call("evaluate", "WorldInputProbe.reset()")
  for index in range(n):
    for item: Dictionary in parts:
      inject(item)
  Input.flush_buffered_events()
  var row := {"id": topology + "/" + id, "parts": parts, "n": n, "world": observe(), "rn": rn_counts(), "tiles": tiles(),
    "motion": world.count("InputEventMouseMotion")}
  row.merge(extra)
  section[into].append(row)
  return row

func hover(id: String, region: String, at: Vector2) -> Dictionary:
  motion(at)
  Input.flush_buffered_events()
  var control := root.gui_get_hovered_control()
  var row := {"id": topology + "/" + id, "region": region, "at": [at.x, at.y],
    "hovered": null if control == null else {"class": control.get_class(), "name": String(control.name)}}
  section.hovers.append(row)
  return row

# What each stream of an input is, delivered to the world n times.
func stream_of(input: String, n: int) -> Dictionary:
  if input == "left":
    return {"mouse/press/1": n, "mouse/release/1": n}
  if input == "right":
    return {"mouse/press/2": n, "mouse/release/2": n}
  if input == "wheel":
    return {"mouse/press/4": n, "mouse/release/4": n}
  return {"touch/press": n, "touch/release": n, "emulated/press/1": n, "emulated/release/1": n}

# The tile under a screen point, from the camera alone: the viewport's center shows the camera's position at its zoom.
func camera_tile(at: Vector2) -> String:
  var camera: Camera2D = world.get_node("Camera")
  var ground := (at - Vector2(SIZE) / 2.0) / camera.zoom + camera.position
  return "%d,%d" % [floori(ground.x / TILE), floori(ground.y / TILE)]

func taps(row: Dictionary, input: String, n: int) -> bool:
  return row.world == stream_of(input, n) and row.rn.is_empty()

func hud_none(row: Dictionary) -> bool:
  return row.world.is_empty() and row.rn.is_empty()

# ---- topology (a) ----
func overlay_open(kind: String) -> bool:
  if kind == "tree":
    return not node_by("tree-overlay").is_empty()
  var modal := node_by("modal")
  return not modal.is_empty() and modal.get("modalWindow", {}).get("visible", false) == true and not node_by("modal-button").is_empty()

func set_overlay(kind: String, visible: bool) -> bool:
  app.call("evaluate", "WorldInputProbe.show('%s', %s)" % [kind, "true" if visible else "false"])
  var reached := await wait_for(func() -> bool: return overlay_open(kind) == visible)
  section.transitions.append({"overlay": kind, "to": "open" if visible else "closed", "reached": reached})
  apply_sabotage()
  return reached

func overlay_cycle(kind: String) -> void:
  # The tree overlay is also measured with the wheel, below, among the gaps: its wheel presses still reach the world.
  var inputs := ["left", "right", "touch"] if kind == "tree" else ["left", "right", "wheel", "touch"]
  for phase in ["closed", "open", "closed-again"]:
    if phase != "closed":
      var changed := await set_overlay(kind, phase == "open")
      check(changed, "a/%s overlay: it %s" % [kind, "opens" if phase == "open" else "closes again"])
    for input: String in inputs:
      var region := "covered" if phase == "open" else "void"
      var row := burst("%s/%s/%s" % [kind, phase, input], [part(region, input, VOID)], FULL, {"overlay": kind, "phase": phase})
      if phase == "open":
        check(hud_none(row), "a/%s overlay open: %d %s inputs reach neither the world nor the HUD's handlers" % [kind, FULL, input])
      else:
        pointer_check(input, taps(row, input, FULL), "a/%s overlay %s: %d of %d %s inputs reach the world and none reaches the HUD (positive control)" % [kind, phase, FULL, FULL, input])
    if phase == "open":
      var button := burst(kind + "/open/button", [part(kind + "-button", "left", OVERLAY_BUTTON)], FULL, {"overlay": kind, "phase": phase})
      check(button.world.is_empty() and button.rn == {"hud/" + kind + "Press": FULL},
        "a/%s overlay open: its Pressable is pressed %d times and none reaches the world" % [kind, FULL])
      if kind == "tree":
        burst("tree/open/wheel", [part("covered", "wheel", VOID)], SMALL, {"overlay": kind, "phase": phase}, "gaps")

func gaps_a() -> void:
  # What the minimal policy leaves open: the control is a hit slop or a Text (the View's Control is IGNORE or too small)
  # or a gap of a ScrollView, and the world hears a press that React Native also takes. Measured, never judged.
  burst("gap/hit-slop", [part("slop", "left", SLOP)], SMALL, {}, "gaps")
  burst("gap/text-onpress", [part("text", "left", TEXT)], SMALL, {}, "gaps")
  burst("gap/scroll-gap", [part("scroll-gap", "left", SCROLL_GAP)], SMALL, {}, "gaps")
  burst("gap/wheel-over-hud", [part("hud", "wheel", BAR)], SMALL, {}, "gaps")

func topology_a() -> void:
  await mount("a")
  normative(filters_are_ignore(), "a/surface: the default mouse_filter of the Surface is IGNORE")
  var left := burst("void/left", [part("void", "left", VOID)], FULL)
  normative(taps(left, "left", FULL), "a/void: 100 of 100 left presses and releases reach the world, and none reaches the HUD")
  normative(taps(burst("void/right", [part("void", "right", VOID)], FULL), "right", FULL),
    "a/void: 100 of 100 right presses and releases reach the world, and none reaches the HUD")
  var wheel := burst("void/wheel", [part("void", "wheel", VOID)], FULL)
  pointer_check("wheel", taps(wheel, "wheel", FULL) and int(wheel.world.get("mouse/press/4", 0)) == FULL, "a/void: 100 wheel presses reach the world, and none reaches the HUD")
  var touch := burst("void/touch", [part("void", "touch", VOID)], FULL)
  normative(taps(touch, "touch", FULL), "a/void: 100 taps reach the world as ScreenTouch and as the emulated mouse, and none reaches the HUD")
  var tile_b := burst("void/tile-b", [part("void", "left", VOID_B)], 1)
  var tile_c := burst("void/tile-c", [part("void", "left", VOID_C)], 1)
  normative(left.tiles == {camera_tile(VOID): FULL} and tile_b.tiles == {camera_tile(VOID_B): 1} and tile_c.tiles == {camera_tile(VOID_C): 1},
    "a/camera: the tile clicked is the one the Camera2D's position and zoom 2 give, at three points")
  var button := burst("button/left", [part("button", "left", BUTTON)], FULL)
  check(button.world.is_empty() and button.rn == {"hud/press": FULL, "hud/barDown": FULL},
    "a/button: 100 clicks press the Pressable 100 times and none reaches the world")
  var bar := burst("bar/left", [part("bar", "left", BAR)], FULL)
  check(bar.world.is_empty() and bar.rn == {"hud/barDown": FULL}, "a/bar: 100 clicks on a bar with a handler reach its handler and not the world")
  var plain := burst("plain/left", [part("plain", "left", PLAIN)], FULL)
  check(hud_none(plain), "a/plain panel: 100 clicks on a panel with no handler reach neither the world nor a handler")
  var scroll := burst("scroll-button/left", [part("scroll-button", "left", SCROLL_BUTTON)], FULL)
  check(scroll.world.is_empty() and scroll.rn == {"hud/scrollPress": FULL}, "a/ScrollView: 100 clicks on its Pressable press it 100 times and none reaches the world")
  var alternating := burst("alternating", [part("button", "left", BUTTON), part("void", "left", VOID)], FULL)
  normative(alternating.world == stream_of("left", FULL) and alternating.rn == {"hud/press": FULL, "hud/barDown": FULL},
    "a/alternating: 100 Pressable presses and 100 empty-area clicks, each reaching only its owner")
  var tap_button := burst("button/touch", [part("button", "touch", BUTTON)], FULL)
  check(Input.is_emulating_mouse_from_touch() and tap_button.world.is_empty() and tap_button.rn == {"hud/press": FULL, "hud/barDown": FULL},
    "a/touch: 100 taps on the Pressable press it 100 times, with no emulated mouse and no ScreenTouch in the world")
  var tap_plain := burst("plain/touch", [part("plain", "touch", PLAIN)], FULL)
  check(hud_none(tap_plain), "a/touch: 100 taps on a plain panel reach neither the world (no emulated mouse, no ScreenTouch) nor a handler")
  normative(hover("void", "void", VOID).hovered == null, "a/hover: gui_get_hovered_control() is null over the map")
  var over_hud: Variant = hover("button", "button", BUTTON).hovered
  check(over_hud != null and over_hud["class"] != "FabricSurface", "a/hover: a control of the HUD is the hovered one over the HUD, not the Surface")
  await overlay_cycle("tree")
  await overlay_cycle("modal")
  gaps_a()
  await teardown()

# ---- topology (b) ----
func topology_b() -> void:
  await mount("b")
  normative(filters_are_ignore(), "b/surfaces: the default mouse_filter of both Surfaces is IGNORE")
  for side: String in ["left", "right"]:
    var empty: Vector2 = PANEL_VOID[side]
    for input: String in ["left", "right", "wheel", "touch"]:
      pointer_check(input, taps(burst("void/%s/%s" % [side, input], [part("void", input, empty, side)], SMALL), input, SMALL),
        "b/%s panel void: %d of %d %s inputs reach the world, and none reaches the HUD" % [side, SMALL, SMALL, input])
    var tile := burst("void/%s/tile" % side, [part("void", "left", empty, side)], 1)
    normative(tile.tiles == {camera_tile(empty): 1}, "b/%s panel: the tile clicked is the one the Camera2D gives" % side)
    for input: String in ["left", "touch"]:
      var button := burst("button/%s/%s" % [side, input], [part("button", input, PANEL_BUTTON[side], side)], SMALL)
      check(button.world.is_empty() and button.rn == {side + "/press": SMALL, side + "/barDown": SMALL},
        "b/%s panel: %d %s inputs press the Pressable %d times and none reaches the world" % [side, SMALL, input, SMALL])
    var bar := burst("bar/%s/left" % side, [part("bar", "left", PANEL_BAR[side], side)], SMALL)
    check(bar.world.is_empty() and bar.rn == {side + "/barDown": SMALL}, "b/%s panel: %d clicks on the bar reach its handler and not the world" % [side, SMALL])
    normative(hover("void/" + side, "void", empty).hovered == null, "b/%s panel: gui_get_hovered_control() is null over the map" % side)
    var over_hud: Variant = hover("button/" + side, "button", PANEL_BUTTON[side]).hovered
    check(over_hud != null and over_hud["class"] != "FabricSurface", "b/%s panel: a control of the HUD is the hovered one over the HUD" % side)
  var alternating := burst("alternating", [part("button", "left", PANEL_BUTTON.left, "left"), part("void", "left", PANEL_VOID.right, "right")], SMALL)
  normative(alternating.world == stream_of("left", SMALL) and alternating.rn == {"left/press": SMALL, "left/barDown": SMALL},
    "b/alternating: %d presses of the left panel's Pressable and %d clicks on the right panel's void, each reaching only its owner" % [SMALL, SMALL])
  await teardown()

func _initialize() -> void:
  call_deferred("run")

func run() -> void:
  for argument in OS.get_cmdline_user_args():
    if argument == "--allow-original-negative":
      allow_original_negative = true
    elif argument.begins_with("--sabotage="):
      sabotage = argument.get_slice("=", 1)
  root.size = SIZE
  await settle(2)
  await topology_a()
  await topology_b()
  await finish()

func finish() -> void:
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var sabotage_observed := sabotage != "" and not failures.is_empty()
  var report := {"scenario": "native-world-input", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "viewport": [SIZE.x, SIZE.y],
    "world": world_info,
    "emulatingMouseFromTouch": Input.is_emulating_mouse_from_touch(), "full": FULL, "small": SMALL,
    "topologies": topologies, "checks": checks, "expectedOriginalFailures": expected_original_failures,
    "allowOriginalNegative": allow_original_negative, "originalNegativeObserved": original_negative_observed,
    "sabotage": sabotage, "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"actualGodotInputPipeline": true, "syntheticEventsThroughInputParse": true, "hardwareInputCertified": false,
      "realTouchscreenCertified": false, "mobileExportsCertified": false}}
  var output := FileAccess.open("res://build/world-input-report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: cannot write the world input report")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  for topology_name: String in topologies:
    for gap: Dictionary in topologies[topology_name].gaps:
      print("WORLD_INPUT_GAP: %s world=%s rn=%s" % [gap.id, JSON.stringify(gap.world), JSON.stringify(gap.rn)])
  if original_negative_observed:
    print("WORLD_INPUT_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif sabotage_observed:
    print("WORLD_INPUT_SABOTAGE_REJECTED: " + str(failures.size()))
  elif failures.is_empty():
    print("WORLD_INPUT_PASSED: " + str(checks.size()))
  else:
    print("WORLD_INPUT_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed or sabotage_observed else 1)
