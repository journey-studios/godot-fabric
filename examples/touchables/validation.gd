extends Node

# The public touchables example under real mouse input. A press is held on each
# touchable in turn, so each pressed state is read from the native Controls the
# touchable changed (the Opacity's own opacity, the Highlight's underlay and its
# child's opacity) and from what React observed; then the press is released.
# With --capture the renderer's frame is saved for every state too.
const DEVICE := 1001
const IDS := ["touch-opacity", "touch-highlight", "touch-feedback"]
const REST := {"touch-opacity": "2563ebff", "touch-highlight": "0f766eff", "touch-feedback": "7c3aedff"}
const UNDERLAY := "f59e0bff"
const OPACITY_ACTIVE := 0.35
const HIGHLIGHT_ACTIVE := 0.55
var checks: Array = []
var stages: Dictionary = {}
var images: Dictionary = {}
var capturing := false
@onready var application: Node = $Application
@onready var surface: Control = $Surface

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 1) -> void:
  for index in range(count):
    await get_tree().process_frame

func wait_for(condition: Callable, limit_ms: int = 6000) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms and not condition.call():
    await frames()
  return condition.call()

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func example() -> Dictionary:
  var value: Variant = js("globalThis.TouchablesExample.state()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func node_of(id: String) -> Dictionary:
  var value: Variant = JSON.parse_string(surface.call("snapshot"))
  var nodes: Variant = value.get("nodes", []) if value is Dictionary else []
  for entry: Dictionary in nodes:
    if entry.get("testID") == id:
      return entry
  return {}

func background(id: String) -> String:
  var appearance: Variant = node_of(id).get("appearance")
  return str(appearance.get("background")) if appearance is Dictionary else ""

func opacity_of(id: String) -> float:
  return float(node_of(id).get("opacity", -1.0))

func caption(id: String) -> String:
  return str(node_of(id).get("nativeText", ""))

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

func at(id: String) -> Vector2:
  return control(id).get_global_rect().get_center()

# The readback rectangle of a Control, in the physical pixels of the saved frame.
func region(node: Control) -> Rect2i:
  var physical := get_window().get_final_transform() * node.get_global_rect()
  return Rect2i(Vector2i(physical.position.round()), Vector2i(physical.size.round()))

func digest(image: Image, area: Rect2i) -> String:
  var context := HashingContext.new()
  context.start(HashingContext.HASH_SHA256)
  context.update(image.get_region(area).get_data())
  return context.finish().hex_encode()

# The captions also change with every press, so each stage hashes the pixels of
# the three touchables alone; the full frame is still saved as the capture.
func capture(stage: String) -> void:
  if not capturing:
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/touchables-%s.png" % stage) == OK, "Renderer capture saved: " + stage)
  var frame := Rect2i(Vector2i.ZERO, image.get_size())
  var pixels := {}
  var inside := true
  for id: String in IDS:
    var area := region(control(id))
    inside = inside and area.has_area() and frame.encloses(area)
    pixels[id] = digest(image, area) if area.has_area() and frame.encloses(area) else ""
  verify(inside, "The three touchables lie inside the captured frame: " + stage)
  images[stage] = pixels

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

func resting() -> bool:
  return (is_equal_approx(opacity_of("touch-opacity"), 1.0) and background("touch-highlight") == REST["touch-highlight"]
    and is_equal_approx(opacity_of("touch-highlight-child"), 1.0) and background("touch-feedback") == REST["touch-feedback"]
    and background("touch-opacity") == REST["touch-opacity"])

# Positions of an event in the list React logged, or -1.
func index_of(events: Array, name: String, from: int = 0) -> int:
  for index in range(from, events.size()):
    if events[index] == name:
      return index
  return -1

func pointer_clear() -> bool:
  var pointer: Dictionary = JSON.parse_string(surface.call("snapshot")).get("pointer", {})
  return int(pointer.get("responder", -1)) == 0 and int(pointer.get("activeTouches", -1)) == 0

func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  surface.set_meta("validation_input_device", DEVICE)
  await run()

func run() -> void:
  var mounted := await wait_for(func() -> bool: return (IDS.all(func(id: String) -> bool: return control(id) != null)
    and control("touch-highlight-child") != null and control("touch-opacity-state") != null))
  verify(mounted, "The public example mounts its three touchables and their captions")
  await frames(10)
  var start := example()
  stages.rest = {"example": start, "opacity": node_of("touch-opacity"), "highlight": node_of("touch-highlight"), "feedback": node_of("touch-feedback")}
  verify(resting(), "At rest the Opacity is fully opaque, the Highlight shows its own background and the feedback-free box its own")
  verify((start.get("events", []).is_empty() and caption("touch-opacity-state") == "idle · 0 presses"
    and caption("touch-highlight-state") == "idle · 0 presses" and caption("touch-feedback-state") == "idle · 0 presses"),
    "React has heard nothing and every caption reads idle")
  await capture("rest")

  # TouchableOpacity: the press dims it to activeOpacity through RN's native driver.
  await mouse("down", at("touch-opacity"))
  var dimmed := await wait_for(func() -> bool: return is_equal_approx(opacity_of("touch-opacity"), OPACITY_ACTIVE))
  var held := example()
  stages["opacity-pressed"] = {"example": held, "opacity": node_of("touch-opacity")}
  verify((dimmed and held.get("events", []) == ["opacity:in"] and held.get("opacity", {}).get("state") == "pressed"
    and caption("touch-opacity-state") == "pressed · 0 presses" and int(native_state().get("nativeAnimated", {}).get("directUpdates", 0)) > 0),
    "Holding the mouse dims the TouchableOpacity to its activeOpacity through the native driver and reports onPressIn once")
  verify((background("touch-highlight") == REST["touch-highlight"] and is_equal_approx(opacity_of("touch-highlight-child"), 1.0)
    and background("touch-feedback") == REST["touch-feedback"] and caption("touch-highlight-state") == "idle · 0 presses"),
    "Only the pressed touchable changes: the other two keep their look and their captions")
  await capture("opacity-pressed")
  await mouse("up", at("touch-opacity"))
  var restored := await wait_for(func() -> bool: return is_equal_approx(opacity_of("touch-opacity"), 1.0) and example().get("opacity", {}).get("count") == 1)
  var opacity_events: Array = example().get("events", [])
  verify((restored and opacity_events == ["opacity:in", "opacity:out", "opacity:press"] and caption("touch-opacity-state") == "released · 1 press"),
    "Release brings the opacity back and RN reports onPressOut and then onPress")

  # TouchableHighlight: the underlay replaces the background and the child dims to activeOpacity.
  await mouse("down", at("touch-highlight"))
  var shown := await wait_for(func() -> bool: return (background("touch-highlight") == UNDERLAY
    and is_equal_approx(opacity_of("touch-highlight-child"), HIGHLIGHT_ACTIVE)))
  var shown_events: Array = example().get("events", []).slice(opacity_events.size())
  stages["highlight-pressed"] = {"example": example(), "highlight": node_of("touch-highlight"), "child": node_of("touch-highlight-child")}
  verify((shown and shown_events == ["highlight:show", "highlight:in"] and caption("touch-highlight-state") == "pressed · 0 presses"),
    "Holding the mouse shows the underlay, dims the child to activeOpacity and reports onShowUnderlay and onPressIn")
  verify((is_equal_approx(opacity_of("touch-opacity"), 1.0) and background("touch-feedback") == REST["touch-feedback"]),
    "The other touchables are untouched while the Highlight is held")
  await capture("highlight-pressed")
  await mouse("up", at("touch-highlight"))
  var hidden := await wait_for(func() -> bool: return (background("touch-highlight") == REST["touch-highlight"]
    and is_equal_approx(opacity_of("touch-highlight-child"), 1.0) and example().get("highlight", {}).get("count") == 1))
  var highlight_events: Array = example().get("events", []).slice(opacity_events.size())
  var out_at := index_of(highlight_events, "highlight:out")
  var press_at := index_of(highlight_events, "highlight:press")
  verify((hidden and index_of(highlight_events, "highlight:in") == 1 and out_at > 1 and press_at > out_at
    and highlight_events.back() == "highlight:hide" and caption("touch-highlight-state") == "released · 1 press"),
    "Release hides the underlay and restores the child, with onPressOut before onPress and onHideUnderlay last")

  # TouchableWithoutFeedback: RN gives it no visual feedback, so only React's own state shows the press.
  var before_feedback: int = example().get("events", []).size()
  await mouse("down", at("touch-feedback"))
  var pressed := await wait_for(func() -> bool: return example().get("feedback", {}).get("state") == "pressed")
  stages["feedback-pressed"] = {"example": example(), "feedback": node_of("touch-feedback")}
  verify((pressed and example().get("events", []).slice(before_feedback) == ["feedback:in"] and background("touch-feedback") == REST["touch-feedback"]
    and is_equal_approx(opacity_of("touch-feedback"), 1.0) and caption("touch-feedback-state") == "pressed · 0 presses"),
    "Holding the mouse reports onPressIn and changes nothing on the touchable itself; only the caption shows it")
  await capture("feedback-pressed")
  await mouse("up", at("touch-feedback"))
  var released := await wait_for(func() -> bool: return example().get("feedback", {}).get("count") == 1)
  await frames(4)
  verify((released and example().get("events", []).slice(before_feedback) == ["feedback:in", "feedback:out", "feedback:press"]
    and caption("touch-feedback-state") == "released · 1 press"),
    "Release reports onPressOut and then onPress once")
  var done := await wait_for(func() -> bool: return resting())
  var final_state := example()
  stages.released = {"example": final_state, "opacity": node_of("touch-opacity"), "highlight": node_of("touch-highlight"), "feedback": node_of("touch-feedback")}
  verify((done and pointer_clear() and native_state().get("errors", []).is_empty()),
    "After the three releases every touchable looks as it did at rest, no contact or responder is left and the run raised no host error")
  await capture("released")
  if capturing:
    var rest_pixels: Dictionary = images.rest
    var opacity_pixels: Dictionary = images["opacity-pressed"]
    var highlight_pixels: Dictionary = images["highlight-pressed"]
    var feedback_pixels: Dictionary = images["feedback-pressed"]
    var released_pixels: Dictionary = images.released
    verify((opacity_pixels["touch-opacity"] != rest_pixels["touch-opacity"] and opacity_pixels["touch-highlight"] == rest_pixels["touch-highlight"]
      and opacity_pixels["touch-feedback"] == rest_pixels["touch-feedback"]),
      "The renderer drew only the pressed TouchableOpacity differently")
    verify((highlight_pixels["touch-highlight"] != rest_pixels["touch-highlight"] and highlight_pixels["touch-opacity"] == rest_pixels["touch-opacity"]
      and highlight_pixels["touch-feedback"] == rest_pixels["touch-feedback"]),
      "The renderer drew only the pressed TouchableHighlight differently")
    verify((feedback_pixels["touch-feedback"] == rest_pixels["touch-feedback"] and feedback_pixels["touch-opacity"] == rest_pixels["touch-opacity"]
      and feedback_pixels["touch-highlight"] == rest_pixels["touch-highlight"]),
      "The renderer drew the three touchables as at rest while only the feedback-free one was held")
    verify((released_pixels["touch-opacity"] == rest_pixels["touch-opacity"] and released_pixels["touch-highlight"] == rest_pixels["touch-highlight"]
      and released_pixels["touch-feedback"] == rest_pixels["touch-feedback"]),
      "After release the renderer draws every touchable as at rest")
  await finish()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty()
    and stopped.get("nativeAnimated", {}).get("active") == false, "Stop releases the root and the animation backend without a host error")
  var report := {"scenario": "touchables", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "images": images, "applicationStopped": stopped}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the touchables report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: touchables" if failed else "FABRIC_VALIDATION_PASSED: touchables " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
