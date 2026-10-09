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
# and Input.flush_buffered_events delivers on the spot (tests/world-input-driver.gd, shared
# with the windowed probe): nothing is read after waiting a number of frames, so the result
# does not depend on the pace of the runner. Frames are waited only until a condition holds,
# for a scene to mount and for an overlay or a Modal to open or close.
#
# The pointer reaches exactly one side, by the rule of React Native on a phone: what the hit test of React Native finds
# (a View of the Surface with a tag, hitSlop and pointerEvents honored) is the HUD's, and the rest is the world's. A
# check is normative in one of two ways, and a host that lacks the rule fails exactly the checks that need it:
#  - a1: the Surface does not take the pointer of the empty area (MOUSE_FILTER_IGNORE). The host before it fails these.
#  - a2: a hit slop, a Text with onPress, the gaps of a ScrollView, and the wheel over the HUD, over a ScrollView and over
#    an overlay in the tree belong to React Native alone: the Surface claims them in _unhandled_input. The host with only
#    a1 fails these, and so does the host before a1 where the GUI does not hide them.
# The others hold on every host. The informative rows (the pointer motion and the drag, which the rule leaves alone)
# record what was measured and never pass or fail.
#
# --allow-original-negative runs on the host before a1 and --allow-a1-negative on the host with a1 only. --sabotage=<name>
# breaks the current host on purpose from the scene (surface-stop forces the Surfaces back to MOUSE_FILTER_STOP;
# views-ignore gives every Control of the Views MOUSE_FILTER_IGNORE; unhandled-off keeps the Surfaces from receiving
# _unhandled_input): the probe and the oracle must both reject them.
const Driver := preload("res://tests/world-input-driver.gd")
const Witness := preload("res://tests/world-input-order-witness.gd")
const SCENES := {"a": "res://examples/world-input/scene.tscn", "b": "res://examples/world-input/panels.tscn"}
const SIZE := Vector2i(800, 600)
const FULL := 100
const SMALL := 20
const TILE := 32

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
# A Switch at (620,20)-(671,51): a native Control of the Godot GUI, which takes its clicks and taps in _gui_input.
const SWITCH := Vector2(645, 35)
# The places where the HUD owns a pointer that the GUI would let through (a Surface at IGNORE and no Control that stops it): a
# hit slop (L1), a Text with onPress (L2), the gap of a ScrollView in a box-none wrapper (L3). Each is where the hit test of React
# Native finds a View, and the handler is the one that hears it. The wheel is aimed at them too.
const GAP_PLACES := [
  {"id": "hit-slop", "label": "L1 hit slop", "region": "slop", "at": SLOP, "handler": "slopPress"},
  {"id": "text-onpress", "label": "L2 Text onPress", "region": "text", "at": TEXT, "handler": "textPress"},
  {"id": "scroll-gap", "label": "L3 ScrollView gap", "region": "scroll-gap", "at": SCROLL_GAP, "handler": "wrapDown"},
]
# The wheel over the HUD: a bar, a plain panel and a Pressable (L4), a ScrollView (L5), and the gap places (L4).
const WHEEL_PLACES := [
  {"id": "bar", "label": "L4 bar", "region": "bar", "at": BAR},
  {"id": "plain", "label": "L4 plain panel", "region": "plain", "at": PLAIN},
  {"id": "button", "label": "L4 Pressable", "region": "button", "at": BUTTON},
  {"id": "scroll", "label": "L5 ScrollView", "region": "scroll-button", "at": SCROLL_BUTTON},
  {"id": "hit-slop", "label": "L4 hit slop", "region": "slop", "at": SLOP},
  {"id": "text-onpress", "label": "L4 Text", "region": "text", "at": TEXT},
  {"id": "scroll-gap", "label": "L4 ScrollView gap", "region": "scroll-gap", "at": SCROLL_GAP},
]
# Topology (b): the left Surface is (0,0)-(400,600), the right one (400,0)-(800,600).
const PANEL_BUTTON := {"left": Vector2(70, 40), "right": Vector2(470, 40)}
const PANEL_BAR := {"left": Vector2(300, 70), "right": Vector2(700, 70)}
const PANEL_VOID := {"left": Vector2(200, 400), "right": Vector2(600, 400)}

var checks: Array = []
var expected_original_failures: Array = []
var expected_a1_failures: Array = []
var allow_original_negative := false
var allow_a1_negative := false
var sabotage := ""
var topologies := {}
var topology := ""
var section: Dictionary = {}
var scene: Node
var world: Node2D
var app: Node
var driver: Driver
var surfaces: Array = []
var world_info := {}

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check of a1 needs the policy of the Surface: the host before a1 fails exactly these, and the host with a1 passes.
func normative(condition: bool, name: String) -> bool:
  expected_original_failures.append(name)
  return check(condition, name)

# A normative check of a2 needs the Surface's claim: the host with only a1 fails exactly these. The host before a1 fails them too,
# unless its Surface (STOP) hides the case from the world anyway (a click, a tap and the emulated mouse in a gap place).
func normative_a2(condition: bool, name: String, holds_before_a1 := false) -> bool:
  expected_a1_failures.append(name)
  if not holds_before_a1:
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

# ---- the sabotages ----
func apply_sabotage() -> void:
  if sabotage == "surface-stop":
    for surface: Control in surfaces:
      surface.mouse_filter = Control.MOUSE_FILTER_STOP
  elif sabotage == "views-ignore":
    for control: Control in root.find_children("*", "Control", true, false):
      control.mouse_filter = Control.MOUSE_FILTER_IGNORE
  elif sabotage == "unhandled-off":
    # The Surface keeps its _input but no longer hears the unhandled stage, so it cannot claim anything there.
    for surface: Control in surfaces:
      surface.set_process_unhandled_input(false)

# ---- the scene ----
func mount(which: String) -> void:
  topology = which
  var packed: PackedScene = load(SCENES[which])
  scene = packed.instantiate()
  root.add_child(scene)
  world = scene.get_node("World")
  app = scene.get_node("Application")
  surfaces = scene.get_node("Hud").get_children()
  driver = Driver.new(world, app, surfaces)
  var reached := await driver.wait_for(driver.mounted)
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
  await order_check(PANEL_VOID.left if which == "b" else VOID)

# The Surface's claim only works if a node of the HUD's layer hears _unhandled_input before the world does. A witness stands
# where the Surface stands (the HUD's CanvasLayer, after the world) and records, for each mouse button event it hears, how
# many events the world had heard: the oracle derives that the world had not heard this one yet. The wheel is aimed at the
# empty area because every host lets it through to the unhandled stage.
func order_check(at: Vector2) -> void:
  var witness: Witness = Witness.new()
  witness.world = world
  scene.get_node("Hud").add_child(witness)
  var row := driver.run([Driver.part("void", "wheel", at, "left" if topology == "b" else "hud")], 1)
  var indices: Array = []
  for index in range(world.received.size()):
    if world.received[index][0] == "InputEventMouseButton":
      indices.append(index)
  section["order"] = {"at": [at.x, at.y], "heard": witness.heard.duplicate(), "worldIndices": indices, "world": row.world}
  check(not indices.is_empty() and witness.heard == indices,
    topology + "/order: a node of the HUD's layer hears _unhandled_input before the world does, so the Surface can claim first")
  witness.queue_free()
  await settle(2)

func teardown() -> void:
  app.call("stop")
  scene.queue_free()
  await settle(2)

func filters_are_ignore() -> bool:
  return surfaces.all(func(surface: Control) -> bool: return surface.mouse_filter == Control.MOUSE_FILTER_IGNORE)

# ---- bursts ----
# n repetitions of the parts, delivered at once; the row records what each side heard.
func burst(id: String, parts: Array, n: int, extra := {}, into := "rows") -> Dictionary:
  var row := driver.run(parts, n)
  row.id = topology + "/" + id
  row.merge(extra)
  section[into].append(row)
  return row

# A burst whose handler hears the GUI's own events (a Switch toggles in _gui_input and the runtime emits its change from
# there, not from the pointer route): the last of them can reach JavaScript after the flush returns. The burst waits, for a
# bounded number of frames, until the handler has counted n, and reads the HUD's counters then.
func burst_gui(id: String, parts: Array, n: int, handler: String) -> Dictionary:
  var row := driver.run(parts, n)
  await driver.wait_for(func() -> bool: return int(driver.rn_counts().get(handler, 0)) >= n)
  row.rn = driver.rn_counts()
  row.id = topology + "/" + id
  section.rows.append(row)
  return row

func hover(id: String, region: String, at: Vector2) -> Dictionary:
  var control := driver.hovered(at)
  var row := {"id": topology + "/" + id, "region": region, "at": [at.x, at.y],
    "hovered": null if control == null else {"class": control.get_class(), "name": String(control.name)}}
  section.hovers.append(row)
  return row

# The tile under a screen point, from the camera alone: the viewport's center shows the camera's position at its zoom.
func camera_tile(at: Vector2) -> String:
  var camera: Camera2D = world.get_node("Camera")
  var ground := (at - Vector2(SIZE) / 2.0) / camera.zoom + camera.position
  return "%d,%d" % [floori(ground.x / TILE), floori(ground.y / TILE)]

func taps(row: Dictionary, input: String, n: int) -> bool:
  return row.world == Driver.stream_of(input, n) and row.rn.is_empty()

func hud_none(row: Dictionary) -> bool:
  return row.world.is_empty() and row.rn.is_empty()

# ---- topology (a) ----
func set_overlay(kind: String, visible: bool) -> bool:
  var reached := await driver.set_overlay(kind, visible)
  section.transitions.append({"overlay": kind, "to": "open" if visible else "closed", "reached": reached})
  apply_sabotage()
  return reached

func overlay_cycle(kind: String) -> void:
  var inputs := ["left", "right", "wheel", "touch"]
  for phase in ["closed", "open", "closed-again"]:
    if phase != "closed":
      var changed := await set_overlay(kind, phase == "open")
      check(changed, "a/%s overlay: it %s" % [kind, "opens" if phase == "open" else "closes again"])
    for input: String in inputs:
      var region := "covered" if phase == "open" else "void"
      var row := burst("%s/%s/%s" % [kind, phase, input], [Driver.part(region, input, VOID)], FULL, {"overlay": kind, "phase": phase})
      if phase == "open":
        var name := "a/%s overlay open: %d %s inputs reach neither the world nor the HUD's handlers" % [kind, FULL, input]
        if kind == "tree" and input == "wheel":
          # L6: the GUI passes a wheel tick through the overlay's STOP Control (force_pass_scroll_events), so on the host with a1 only
          # the world hears it. The Modal is a window of its own and keeps the wheel from the world on every host.
          normative_a2(hud_none(row), name)
        else:
          check(hud_none(row), name)
      else:
        pointer_check(input, taps(row, input, FULL), "a/%s overlay %s: %d of %d %s inputs reach the world and none reaches the HUD (positive control)" % [kind, phase, FULL, FULL, input])
    if phase == "open":
      var button := burst(kind + "/open/button", [Driver.part(kind + "-button", "left", OVERLAY_BUTTON)], FULL, {"overlay": kind, "phase": phase})
      check(button.world.is_empty() and button.rn == {"hud/" + kind + "Press": FULL},
        "a/%s overlay open: its Pressable is pressed %d times and none reaches the world" % [kind, FULL])

# The gaps of a1, closed by a2: a click, a tap and the mouse Godot emulates from it on a hit slop, a Text with onPress and the
# gap of a ScrollView (L1-L3) belong to React Native, which hears the click and the tap once (the emulated mouse never, it ignores
# device -1) and leaves the world none of the three; the wheel over the HUD, a ScrollView and the same places (L4, L5) is nobody's
# to the world either. The host with only a1 lets all of these through to the world as well. The Surface of the host before a1
# (STOP) hides the click, the tap and the emulated mouse in these places, but not the wheel.
func closed_gaps_a() -> void:
  for place: Dictionary in GAP_PLACES:
    var handled: Dictionary = {"hud/" + place.handler: FULL}
    for input: String in ["left", "touch"]:
      var row := burst("gap/%s/%s" % [place.id, input], [Driver.part(place.region, input, place.at)], FULL)
      normative_a2(row.world.is_empty() and row.rn == handled,
        "a/%s: %d %s inputs reach the handler %d times and none reaches the world" % [place.label, FULL, input, FULL], true)
    var emulated := burst("gap/%s/emulated" % place.id, [Driver.part(place.region, "emulated", place.at)], FULL)
    normative_a2(hud_none(emulated), "a/%s: %d emulated mouse clicks reach neither the world nor a handler" % [place.label, FULL], true)
  for place: Dictionary in WHEEL_PLACES:
    var row := burst("wheel/%s" % place.id, [Driver.part(place.region, "wheel", place.at)], FULL)
    normative_a2(hud_none(row), "a/%s: %d wheel ticks reach neither the world nor the HUD's handlers" % [place.label, FULL])

# What the rule of a2 leaves alone: the pointer motion and a drag. Over a View with a Control that stops the pointer (the bar) the
# GUI keeps both from the world; over a place the GUI lets through (a hit slop) the world still hears the motion, and the drag that
# starts there (its touch is claimed, the drag is not). Measured, never judged.
func open_cases_a() -> void:
  for place: Dictionary in [{"id": "bar", "region": "bar", "at": BAR}, {"id": "hit-slop", "region": "slop", "at": SLOP}]:
    for input: String in ["motion", "drag"]:
      burst("open/%s-over-%s" % [input, place.id], [Driver.part(place.region, input, place.at)], SMALL, {}, "gaps")

func topology_a() -> void:
  await mount("a")
  normative(filters_are_ignore(), "a/surface: the default mouse_filter of the Surface is IGNORE")
  var left := burst("void/left", [Driver.part("void", "left", VOID)], FULL)
  normative(taps(left, "left", FULL), "a/void: 100 of 100 left presses and releases reach the world, and none reaches the HUD")
  normative(taps(burst("void/right", [Driver.part("void", "right", VOID)], FULL), "right", FULL),
    "a/void: 100 of 100 right presses and releases reach the world, and none reaches the HUD")
  var wheel := burst("void/wheel", [Driver.part("void", "wheel", VOID)], FULL)
  pointer_check("wheel", taps(wheel, "wheel", FULL) and int(wheel.world.get("mouse/press/4", 0)) == FULL, "a/void: 100 wheel presses reach the world, and none reaches the HUD")
  var touch := burst("void/touch", [Driver.part("void", "touch", VOID)], FULL)
  normative(taps(touch, "touch", FULL), "a/void: 100 taps reach the world as ScreenTouch and as the emulated mouse, and none reaches the HUD")
  var tile_b := burst("void/tile-b", [Driver.part("void", "left", VOID_B)], 1)
  var tile_c := burst("void/tile-c", [Driver.part("void", "left", VOID_C)], 1)
  normative(left.tiles == {camera_tile(VOID): FULL} and tile_b.tiles == {camera_tile(VOID_B): 1} and tile_c.tiles == {camera_tile(VOID_C): 1},
    "a/camera: the tile clicked is the one the Camera2D's position and zoom 2 give, at three points")
  var button := burst("button/left", [Driver.part("button", "left", BUTTON)], FULL)
  check(button.world.is_empty() and button.rn == {"hud/press": FULL, "hud/barDown": FULL},
    "a/button: 100 clicks press the Pressable 100 times and none reaches the world")
  var bar := burst("bar/left", [Driver.part("bar", "left", BAR)], FULL)
  check(bar.world.is_empty() and bar.rn == {"hud/barDown": FULL}, "a/bar: 100 clicks on a bar with a handler reach its handler and not the world")
  var plain := burst("plain/left", [Driver.part("plain", "left", PLAIN)], FULL)
  check(hud_none(plain), "a/plain panel: 100 clicks on a panel with no handler reach neither the world nor a handler")
  var scroll := burst("scroll-button/left", [Driver.part("scroll-button", "left", SCROLL_BUTTON)], FULL)
  check(scroll.world.is_empty() and scroll.rn == {"hud/scrollPress": FULL}, "a/ScrollView: 100 clicks on its Pressable press it 100 times and none reaches the world")
  # A Switch lives on the GUI's own events: the Surface's claim comes after the GUI, so a click and a tap toggle it once each.
  for input: String in ["left", "touch"]:
    var toggled := await burst_gui("switch/" + input, [Driver.part("switch", input, SWITCH)], FULL, "hud/switchChange")
    check(toggled.world.is_empty() and toggled.rn == {"hud/switchChange": FULL},
      "a/native Switch: %d %s inputs toggle the Godot GUI's Switch %d times and none reaches the world" % [FULL, input, FULL])
  var alternating := burst("alternating", [Driver.part("button", "left", BUTTON), Driver.part("void", "left", VOID)], FULL)
  normative(alternating.world == Driver.stream_of("left", FULL) and alternating.rn == {"hud/press": FULL, "hud/barDown": FULL},
    "a/alternating: 100 Pressable presses and 100 empty-area clicks, each reaching only its owner")
  var tap_button := burst("button/touch", [Driver.part("button", "touch", BUTTON)], FULL)
  check(Input.is_emulating_mouse_from_touch() and tap_button.world.is_empty() and tap_button.rn == {"hud/press": FULL, "hud/barDown": FULL},
    "a/touch: 100 taps on the Pressable press it 100 times, with no emulated mouse and no ScreenTouch in the world")
  var tap_plain := burst("plain/touch", [Driver.part("plain", "touch", PLAIN)], FULL)
  check(hud_none(tap_plain), "a/touch: 100 taps on a plain panel reach neither the world (no emulated mouse, no ScreenTouch) nor a handler")
  normative(hover("void", "void", VOID).hovered == null, "a/hover: gui_get_hovered_control() is null over the map")
  var over_hud: Variant = hover("button", "button", BUTTON).hovered
  check(over_hud != null and over_hud["class"] != "FabricSurface", "a/hover: a control of the HUD is the hovered one over the HUD, not the Surface")
  await overlay_cycle("tree")
  await overlay_cycle("modal")
  closed_gaps_a()
  open_cases_a()
  await teardown()

# ---- topology (b) ----
func topology_b() -> void:
  await mount("b")
  normative(filters_are_ignore(), "b/surfaces: the default mouse_filter of both Surfaces is IGNORE")
  for side: String in ["left", "right"]:
    var empty: Vector2 = PANEL_VOID[side]
    for input: String in ["left", "right", "wheel", "touch"]:
      pointer_check(input, taps(burst("void/%s/%s" % [side, input], [Driver.part("void", input, empty, side)], SMALL), input, SMALL),
        "b/%s panel void: %d of %d %s inputs reach the world, and none reaches the HUD" % [side, SMALL, SMALL, input])
    var tile := burst("void/%s/tile" % side, [Driver.part("void", "left", empty, side)], 1)
    normative(tile.tiles == {camera_tile(empty): 1}, "b/%s panel: the tile clicked is the one the Camera2D gives" % side)
    for input: String in ["left", "touch"]:
      var button := burst("button/%s/%s" % [side, input], [Driver.part("button", input, PANEL_BUTTON[side], side)], SMALL)
      check(button.world.is_empty() and button.rn == {side + "/press": SMALL, side + "/barDown": SMALL},
        "b/%s panel: %d %s inputs press the Pressable %d times and none reaches the world" % [side, SMALL, input, SMALL])
    var bar := burst("bar/%s/left" % side, [Driver.part("bar", "left", PANEL_BAR[side], side)], SMALL)
    check(bar.world.is_empty() and bar.rn == {side + "/barDown": SMALL}, "b/%s panel: %d clicks on the bar reach its handler and not the world" % [side, SMALL])
    var bar_wheel := burst("bar/%s/wheel" % side, [Driver.part("bar", "wheel", PANEL_BAR[side], side)], SMALL)
    normative_a2(hud_none(bar_wheel), "b/%s panel: %d wheel ticks on the bar reach neither the world nor the HUD" % [side, SMALL])
    normative(hover("void/" + side, "void", empty).hovered == null, "b/%s panel: gui_get_hovered_control() is null over the map" % side)
    var over_hud: Variant = hover("button/" + side, "button", PANEL_BUTTON[side]).hovered
    check(over_hud != null and over_hud["class"] != "FabricSurface", "b/%s panel: a control of the HUD is the hovered one over the HUD" % side)
  var alternating := burst("alternating", [Driver.part("button", "left", PANEL_BUTTON.left, "left"), Driver.part("void", "left", PANEL_VOID.right, "right")], SMALL)
  normative(alternating.world == Driver.stream_of("left", SMALL) and alternating.rn == {"left/press": SMALL, "left/barDown": SMALL},
    "b/alternating: %d presses of the left panel's Pressable and %d clicks on the right panel's void, each reaching only its owner" % [SMALL, SMALL])
  await teardown()

func _initialize() -> void:
  call_deferred("run")

func run() -> void:
  for argument in OS.get_cmdline_user_args():
    if argument == "--allow-original-negative":
      allow_original_negative = true
    elif argument == "--allow-a1-negative":
      allow_a1_negative = true
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
  var expected_a1 := expected_a1_failures.duplicate()
  observed.sort()
  expected.sort()
  expected_a1.sort()
  var original_negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var a1_negative_observed := allow_a1_negative and observed == expected_a1 and not failures.is_empty()
  var sabotage_observed := sabotage != "" and not failures.is_empty()
  var report := {"scenario": "native-world-input", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "viewport": [SIZE.x, SIZE.y],
    "world": world_info,
    "emulatingMouseFromTouch": Input.is_emulating_mouse_from_touch(), "full": FULL, "small": SMALL,
    "topologies": topologies, "checks": checks, "expectedOriginalFailures": expected_original_failures,
    "allowOriginalNegative": allow_original_negative, "originalNegativeObserved": original_negative_observed,
    "expectedA1Failures": expected_a1_failures, "allowA1Negative": allow_a1_negative, "a1NegativeObserved": a1_negative_observed,
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
      print("WORLD_INPUT_GAP: %s world=%s rn=%s motion=%d drag=%d" % [gap.id, JSON.stringify(gap.world), JSON.stringify(gap.rn), gap.motion, gap.drag])
  if original_negative_observed:
    print("WORLD_INPUT_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif a1_negative_observed:
    print("WORLD_INPUT_A1_NEGATIVE: " + str(failures.size()))
  elif sabotage_observed:
    print("WORLD_INPUT_SABOTAGE_REJECTED: " + str(failures.size()))
  elif failures.is_empty():
    print("WORLD_INPUT_PASSED: " + str(checks.size()))
  else:
    print("WORLD_INPUT_FAILED")
  quit(0 if failures.is_empty() or original_negative_observed or a1_negative_observed or sabotage_observed else 1)
