extends Node

# The in-root portal pattern under real mouse input. A dropdown opens inside a ScrollView and is drawn by the Portal's host View, the last
# child of the root; each state is read from the actual Godot Controls the example mounted, and with --capture the renderer's frame is
# saved too. The world behind the surface is this scene: it counts the presses React Native does not take.
const DEVICE := 1001
# The Views of the dropdown. Fabric hoists the children of a View that forms no stacking context into the nearest one, so all of them are
# children of the host's Control: the host has a zIndex, which makes it one.
const PORTAL_IDS := ["dropdown", "dropdown-header", "dropdown-context", "dropdown-live", "dropdown-item-Small", "dropdown-item-Medium",
  "dropdown-item-Large"]
var checks: Array = []
var stages: Dictionary = {}
var images: Dictionary = {}
var capturing := false
var world_presses: Array = []
@onready var application: Node = $Application
@onready var surface: Control = $Surface
@onready var world_label: Label = $World/WorldLabel
@onready var marker: ColorRect = $World/Marker

# What no Control and no View of the surface took: a left press that reaches the scene's unhandled input.
func _unhandled_input(event: InputEvent) -> void:
  if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
    world_presses.append([event.position.x, event.position.y])
    marker.position = event.position - marker.size / 2.0
    marker.visible = true
    world_label.text = "Godot world · presses heard: %d" % world_presses.size()

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 1) -> void:
  for index in range(count):
    await get_tree().process_frame

func wait_for(condition: Callable, limit_ms: int = 8000) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms and not condition.call():
    await frames()
  return condition.call()

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func example() -> Dictionary:
  var value: Variant = js("globalThis.PortalPatternExample.state()")
  return value if value is Dictionary else {}

func record() -> Dictionary:
  return example().get("roots", {}).get("main", {})

# JSON numbers come back as floats: a list of tags or indexes is compared as integers.
func ints(values: Variant) -> Array:
  return (values as Array).map(func(value: Variant) -> int: return int(value)) if values is Array else []

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func nodes() -> Array:
  var value: Variant = JSON.parse_string(surface.call("snapshot"))
  return value.nodes if value is Dictionary else []

# The native node of a testID; the root View is the only View without one.
func node(id: String) -> Dictionary:
  for entry: Dictionary in nodes():
    if entry.testID == id and (id != "" or entry.kind == "view"):
      return entry
  return {}

func text_of(id: String) -> String:
  return str(node(id).get("nativeText", node(id).get("text", "")))

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

func count_of(id: String) -> int:
  return nodes().filter(func(entry: Dictionary) -> bool: return entry.testID == id).size()

func has_ancestor(child: Node, ancestor: Node) -> bool:
  return ancestor != null and child != null and ancestor.is_ancestor_of(child)

# The part of a Control that Godot draws: its global rectangle cut by every ancestor that clips its contents.
func visible_rect(target: Control) -> Rect2:
  var rect := target.get_global_rect()
  var parent: Node = target.get_parent()
  while parent is Control:
    if (parent as Control).clip_contents:
      rect = rect.intersection((parent as Control).get_global_rect())
    parent = parent.get_parent()
  return rect

func snap(stage: String) -> void:
  stages[stage] = {"nodes": nodes(), "example": example(), "worldPresses": world_presses.duplicate()}

func digest(image: Image, area: Rect2i) -> String:
  var context := HashingContext.new()
  context.start(HashingContext.HASH_SHA256)
  context.update(image.get_region(area).get_data())
  return context.finish().hex_encode()

# Each stage is hashed over the whole surface and over the world, which is what the dropdown and the press change.
func capture(stage: String) -> void:
  if not capturing:
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/portal-pattern-%s.png" % stage) == OK, "Renderer capture saved: " + stage)
  var area := Rect2i(Vector2i.ZERO, image.get_size())
  images[stage] = digest(image, area)

func at(id: String) -> Vector2:
  return control(id).get_global_rect().get_center()

func mouse(phase: String, point: Vector2) -> void:
  if phase == "down":
    var motion := InputEventMouseMotion.new()
    motion.device = DEVICE
    motion.position = point
    Input.parse_input_event(motion)
  var button := InputEventMouseButton.new()
  button.device = DEVICE
  button.position = point
  button.button_index = MOUSE_BUTTON_LEFT
  button.pressed = phase == "down"
  button.button_mask = MOUSE_BUTTON_MASK_LEFT if phase == "down" else 0
  Input.parse_input_event(button)
  await frames(2)

func click_at(point: Vector2) -> void:
  await mouse("down", point)
  await frames(4)
  await mouse("up", point)

func click(id: String) -> void:
  await click_at(at(id))

func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  surface.set_meta("validation_input_device", DEVICE)
  await run()

func run() -> void:
  var mounted := await wait_for(func() -> bool: return (control("portal-pick") != null and control("portal-host") != null
    and not node("portal-status").is_empty() and text_of("portal-status") != ""))
  verify(mounted, "The example mounts its card, the ScrollView, the Pick button and the portal host")
  await frames(10)
  var host := control("portal-host")
  var root_view: Control = host.get_parent() as Control if host != null else null
  var scroll := control("portal-scroll")
  snap("closed")
  verify(count_of("portal-host") == 1 and root_view != null and host.get_index() == root_view.get_child_count() - 1,
    "The wrapper provider put one host View in the root, as the last child of the root View")
  verify((root_view != null and host.get_global_rect() == root_view.get_global_rect() and host.mouse_filter == Control.MOUSE_FILTER_IGNORE
    and not host.clip_contents),
    "The host fills the root, does not clip, and its Control ignores the mouse (pointerEvents box-none)")
  verify(count_of("dropdown") == 0 and host.get_child_count() == 0 and world_presses.is_empty(),
    "Closed, the host holds no Controls and the world has heard nothing")
  await capture("closed")

  # Open the dropdown from the Pick button inside the ScrollView.
  await click("portal-pick")
  var opened := await wait_for(func() -> bool: return control("dropdown") != null and not node("dropdown-item-Large").is_empty())
  await frames(8)
  snap("open")
  var dropdown := control("dropdown")
  verify(opened and int(record().get("picks", 0)) == 1 and record().get("anchors", []).size() == 1,
    "Pick opens the dropdown through Portal, and the trigger and the host measured themselves with measureInWindow")
  verify((opened and PORTAL_IDS.all(func(id: String) -> bool: return control(id) != null and control(id).get_parent() == host)
    and host.get_child_count() == PORTAL_IDS.size() and not has_ancestor(dropdown, scroll) and not has_ancestor(dropdown, control("portal-card"))),
    "The dropdown's Controls are the children of the root's host View, not of the ScrollView or the card")
  verify((opened and dropdown.get_global_rect().end.y > scroll.get_global_rect().end.y and scroll.clip_contents
    and visible_rect(dropdown) == dropdown.get_global_rect()),
    "The dropdown reaches past the ScrollView's clip rectangle and is drawn whole: nothing clips it")
  var accent: Dictionary = record()
  verify(text_of("dropdown-context") == "context: none" and accent.get("triggerAccent") == "indigo" and accent.get("portalAccent") == "none",
    "The trigger's Context (indigo) does not reach the portal's content, which reads the default (none)")
  await capture("open")

  # A press outside the dropdown reaches what is under it, and the open dropdown stays.
  await click("portal-row-0")
  var row_pressed := await wait_for(func() -> bool: return ints(record().get("rowPresses")) == [0])
  var live_updated := await wait_for(func() -> bool: return text_of("dropdown-live").ends_with("rows: 1"))
  verify(row_pressed and control("dropdown") != null and live_updated,
    "A press outside the dropdown reaches the row under it, the dropdown stays open and its content updates with the state")
  var outside := surface.get_global_rect().position + Vector2(180, 390)
  await click_at(outside)
  await frames(6)
  verify(world_presses.size() == 1 and control("dropdown") != null and ints(record().get("rowPresses")) == [0],
    "A press on the surface's empty area falls through the box-none host to the Godot world, with the dropdown open")

  # An item press reaches the item, not the row below it.
  await click("dropdown-item-Large")
  var chosen := await wait_for(func() -> bool: return control("dropdown") == null and text_of("portal-row-label-2") == "Size: Large")
  await frames(6)
  snap("chosen")
  verify(chosen and record().get("choices") == ["Large"] and text_of("portal-status") == "chosen: Large · rows pressed: 1"
    and ints(record().get("rowPresses")) == [0] and world_presses.size() == 1,
    "Choosing an item closes the dropdown and updates the row; the press reached the item and neither the row below nor the world")
  verify(PORTAL_IDS.all(func(id: String) -> bool: return count_of(id) == 0) and host.get_child_count() == 0,
    "Closing the portal removes its Controls from the host")
  await capture("chosen")

  # The area the dropdown covered belongs to the rows again.
  await click_at(Vector2(scroll.get_global_rect().position.x + 200, scroll.get_global_rect().position.y + 150))
  var under := await wait_for(func() -> bool: return ints(record().get("rowPresses")) == [0, 3])
  verify(under and world_presses.size() == 1,
    "Once closed, a press where the dropdown was reaches the row under that area")
  if capturing:
    verify((images.get("closed") != "" and images.get("open") != "" and images.get("chosen") != ""
      and images.get("closed") != images.get("open") and images.get("open") != images.get("chosen") and images.get("closed") != images.get("chosen")),
      "The pixels of the frame differ across the three states: the renderer drew the dropdown, then the chosen row and the world's marker")
  await finish()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty(),
    "Stop releases the root and its host without a host error")
  var report := {"scenario": "portal-pattern", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "images": images, "applicationStopped": stopped}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the portal-pattern report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: portal-pattern" if failed else "FABRIC_VALIDATION_PASSED: portal-pattern " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
