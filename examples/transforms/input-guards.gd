extends Node

# Exercise actual Godot input, original RN Pressability and the mounted gallery.
# Invalid transforms are external embedding changes, not unsupported JSX props.
const DEVICE := 1001
const CONTACT := 2
const LARGE_SCALE := Vector2(1.0e10, 1.0e10)
const COORDINATES := ["pageX", "pageY", "screenX", "screenY", "locationX", "locationY"]
var checks: Array = []
var stages: Dictionary = {}
var original_surface_scale := Vector2.ONE
var original_parent_scale := Vector2.ONE
var original_surface_offset: Dictionary = {}
@onready var application: Node = $Application
@onready var surface: Control = $Surface

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 6) -> void:
  for index in range(count):
    await get_tree().process_frame

func settle() -> void:
  await get_tree().create_timer(0.15).timeout
  await frames(2)

func snapshot(node: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(node.call("snapshot"))
  return value if value is Dictionary else {}

func stats() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("evaluate", "JSON.stringify(GodotTransforms.stats())"))
  return value if value is Dictionary else {}

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

func target_tag() -> int:
  for entry in snapshot(surface).get("nodes", []):
    if entry.get("testID", "") == "gesture":
      return int(entry.get("tag", -1))
  return -1

func events() -> Array:
  return stats().get("events", [])

func pointer() -> Dictionary:
  return snapshot(surface).get("pointer", {})

func finite(value: Variant) -> bool:
  return typeof(value) in [TYPE_INT, TYPE_FLOAT] and not is_nan(float(value)) and not is_inf(float(value))

func finite_transform(value: Transform2D) -> bool:
  return value.x.is_finite() and value.y.is_finite() and value.origin.is_finite()

func transform_evidence(node: Control) -> Dictionary:
  var local := node.get_transform()
  var global := node.get_global_transform_with_canvas()
  var local_det := local.determinant()
  var global_det := global.determinant()
  # Preserve overflow as an explicit fact rather than putting inf/NaN in JSON.
  return {"control": str(node.name), "localCoefficients": [local.x.x, local.x.y, local.y.x, local.y.y, local.origin.x, local.origin.y],
    "localCoefficientsFinite": finite_transform(local), "localDeterminantFinite": finite(local_det),
    "localDeterminant": local_det if finite(local_det) else str(local_det),
    "globalCoefficients": [global.x.x, global.x.y, global.y.x, global.y.y, global.origin.x, global.origin.y],
    "globalCoefficientsFinite": finite_transform(global), "globalDeterminantFinite": finite(global_det),
    "globalDeterminant": global_det if finite(global_det) else str(global_det)}

func sample() -> Dictionary:
  return {"application": snapshot(application), "surface": snapshot(surface), "react": stats(),
    "embedding": transform_evidence(surface), "ancestor": transform_evidence(control("gesture-parent")),
    "target": transform_evidence(control("gesture"))}

# Independent JSX golden: frame (594,496), parent (75,20), 30 degree
# rotation around (50,45), target Yoga origin (20,20). No target inverse or
# native measurement supplies the input point or the expected local point.
func valid_point(local: Vector2) -> Vector2:
  var delta := Vector2(20, 20) + local - Vector2(50, 45)
  var cosine := sqrt(3.0) / 2.0
  return Vector2(719, 561) + Vector2(cosine * delta.x - 0.5 * delta.y, 0.5 * delta.x + cosine * delta.y)

func inject(phase: String, point: Vector2) -> void:
  if phase == "move":
    var drag := InputEventScreenDrag.new()
    drag.device = DEVICE
    drag.index = CONTACT
    drag.position = point
    Input.parse_input_event(drag)
  else:
    var touch := InputEventScreenTouch.new()
    touch.device = DEVICE
    touch.index = CONTACT
    touch.position = point
    touch.pressed = phase == "start"
    Input.parse_input_event(touch)
  await frames(4)
  await settle()

func clear_events() -> void:
  application.call("evaluate", "GodotTransforms.action('clear')")
  await frames(2)

func coordinates_finite(contact: Dictionary) -> bool:
  for key in COORDINATES + ["timestamp", "target", "identifier"]:
    if not finite(contact.get(key)):
      return false
  return true

func events_finite(observed: Array) -> bool:
  for entry: Dictionary in observed:
    if not coordinates_finite(entry):
      return false
    for key in ["touches", "changedTouches"]:
      for contact: Dictionary in entry.get(key, []):
        if not coordinates_finite(contact):
          return false
  return true

func near(actual: Variant, expected: float) -> bool:
  return finite(actual) and absf(float(actual) - expected) < 0.025

func contact_matches(contact: Dictionary, point: Vector2, local: Vector2) -> bool:
  return int(contact.get("target", -1)) == target_tag() and int(contact.get("identifier", -1)) == CONTACT + 1 and \
    near(contact.get("pageX"), point.x) and near(contact.get("pageY"), point.y) and \
    near(contact.get("locationX"), local.x) and near(contact.get("locationY"), local.y) and coordinates_finite(contact)

func same_last_coordinates(actual: Dictionary, previous: Dictionary) -> bool:
  for key in COORDINATES + ["target", "identifier"]:
    if not actual.has(key) or not previous.has(key) or actual[key] != previous[key]:
      return false
  return coordinates_finite(actual) and float(actual.get("timestamp", 0)) >= float(previous.get("timestamp", 0))

func events_of_type(type: String) -> Array:
  return events().filter(func(entry: Dictionary) -> bool: return entry.get("type", "") == type)

func restore_embedding() -> void:
  surface.scale = original_surface_scale
  var parent := control("gesture-parent")
  if parent != null:
    parent.scale = original_parent_scale
  for property in original_surface_offset:
    surface.call("set_offset_transform_" + property, original_surface_offset[property])

func overflow_embedding() -> void:
  surface.scale = LARGE_SCALE
  control("gesture-parent").scale = LARGE_SCALE

func singular_embedding() -> void:
  surface.call("set_offset_transform_enabled", true)
  surface.call("set_offset_transform_visual_only", false)
  # Control.scale clamps zero; this public offset API preserves a genuine zero.
  surface.call("set_offset_transform_scale", Vector2(0, 1))

func verify_overflow(name: String) -> void:
  var surface_local := surface.get_transform()
  var ancestor_local := control("gesture-parent").get_transform()
  var target_global := control("gesture").get_global_transform_with_canvas()
  verify(finite_transform(surface_local) and finite(surface_local.determinant()) and surface_local.determinant() != 0 and
    finite_transform(ancestor_local) and finite(ancestor_local.determinant()) and ancestor_local.determinant() != 0,
    "Both external local transforms have finite nonzero determinants: " + name)
  verify(finite_transform(target_global) and is_inf(target_global.determinant()),
    "Finite composed coefficients actually overflow the global determinant: " + name)

func invalid_start() -> void:
  await clear_events()
  var before := pointer()
  var presses: int = stats().get("state", {}).get("gesture", {}).get("presses", -1)
  overflow_embedding()
  verify_overflow("ignored-start")
  var invalid := sample()
  # Deliberately outside the JSX target. An overflowing affine_inverse used to
  # yield zero coefficients and incorrectly turn this into target-local (0,0).
  await inject("start", Vector2(40, 40))
  var after := sample()
  verify(events().is_empty() and pointer().get("activeTouches", -1) == 0 and pointer().get("responder", -1) == 0 and
    pointer().get("starts", -1) == before.get("starts", -2) and pointer().get("cancels", -1) == before.get("cancels", -2),
    "Overflowing global inverse ignores START without any contact, event or responder")
  verify(not stats().get("state", {}).get("gesture", {}).get("held", true) and
    stats().get("state", {}).get("gesture", {}).get("presses", -1) == presses,
    "An invalid START cannot activate original RN Pressability")
  restore_embedding()
  await inject("end", Vector2(40, 40))
  verify(events().is_empty() and pointer().get("ends", -1) == before.get("ends", -2),
    "Physical END after the ignored START remains ignored")
  stages["ignored-start"] = {"pointerBefore": before, "invalidEmbedding": invalid, "afterStart": after, "afterPhysicalEnd": sample()}

func valid_control() -> void:
  await clear_events()
  var before := pointer()
  var presses: int = stats().get("state", {}).get("gesture", {}).get("presses", -1)
  await inject("start", valid_point(Vector2(40, 35)))
  var starts := events_of_type("TouchStart")
  verify(starts.size() == 1 and contact_matches(starts[0], valid_point(Vector2(40, 35)), Vector2(40, 35)) and
    pointer().get("activeTouches", -1) == 1 and pointer().get("responder", -1) == target_tag() and
    stats().get("state", {}).get("gesture", {}).get("held", false),
    "Restored embedding accepts a genuine START with independent target-local and page coordinates")
  var active := sample()
  await inject("end", valid_point(Vector2(40, 35)))
  verify(events_of_type("Press").size() == 1 and stats().get("state", {}).get("gesture", {}).get("presses", -1) == presses + 1 and
    pointer().get("activeTouches", -1) == 0 and pointer().get("responder", -1) == 0 and
    pointer().get("starts", -1) == before.get("starts", -2) + 1 and pointer().get("ends", -1) == before.get("ends", -2) + 1,
    "Restoration completes exactly one original RN press and releases its responder")
  verify(events_finite(events()), "The positive input control contains only finite contact coordinates")
  stages["restored-control"] = {"pointerBefore": before, "active": active, "afterPhysicalEnd": sample()}

func canceled_hold(mode: String) -> void:
  restore_embedding()
  await clear_events()
  var presses: int = stats().get("state", {}).get("gesture", {}).get("presses", -1)
  await inject("start", valid_point(Vector2(40, 35)))
  await inject("move", valid_point(Vector2(44, 35)))
  var moves := events_of_type("TouchMove")
  var previous: Dictionary = moves.back() if not moves.is_empty() else {}
  verify(moves.size() == 1 and contact_matches(previous, valid_point(Vector2(44, 35)), Vector2(44, 35)) and
    pointer().get("activeTouches", -1) == 1 and pointer().get("responder", -1) == target_tag() and
    stats().get("state", {}).get("gesture", {}).get("held", false),
    "A genuine START and valid MOVE establish a live responder and last valid sample: " + mode)
  var before := pointer()
  var before_event_count := events().size()
  if mode == "overflow":
    overflow_embedding()
    verify_overflow("active-contact")
  else:
    singular_embedding()
    verify(surface.call("get_offset_transform_scale") == Vector2(0, 1) and surface.get_transform().determinant() == 0 and
      control("gesture").get_global_transform_with_canvas().determinant() == 0,
      "Public Surface offset transform produces a genuine singular embedding without zero-scale clamping")
  var invalid := sample()
  await inject("move", valid_point(Vector2(46, 35)))
  var cancel_events := events().slice(before_event_count)
  var outs := events_of_type("PressOut")
  verify(pointer().get("activeTouches", -1) == 0 and pointer().get("responder", -1) == 0 and
    not pointer().get("blockNative", true) and pointer().get("cancels", -1) == before.get("cancels", -2) + 1 and
    pointer().get("moves", -1) == before.get("moves", -2) and pointer().get("ends", -1) == before.get("ends", -2),
    "Invalid MOVE cancels once, releases authority and adds no move or end sample: " + mode)
  verify(outs.size() == 1 and same_last_coordinates(outs[0], previous) and cancel_events.size() == 1 and
    cancel_events[0].get("type", "") == "PressOut" and events_finite(events()),
    "Original Pressability cancellation preserves every coordinate from the last valid MOVE without NaN: " + mode)
  verify(not stats().get("state", {}).get("gesture", {}).get("held", true) and events_of_type("Press").is_empty() and
    stats().get("state", {}).get("gesture", {}).get("presses", -1) == presses,
    "Cancellation clears original pressed state without completing a press: " + mode)
  var canceled := sample()
  var count_after_cancel := events().size()
  restore_embedding()
  await inject("end", valid_point(Vector2(46, 35)))
  verify(events().size() == count_after_cancel and events_of_type("Press").is_empty() and
    pointer().get("activeTouches", -1) == 0 and pointer().get("responder", -1) == 0 and
    pointer().get("ends", -1) == before.get("ends", -2) and
    stats().get("state", {}).get("gesture", {}).get("presses", -1) == presses,
    "Restoration and physical END cannot resurrect or press the canceled contact: " + mode)
  stages[mode + "-active-contact"] = {"lastValidSample": previous, "pointerBeforeInvalidMove": before,
    "invalidEmbedding": invalid, "cancellationEvents": cancel_events, "afterCancellation": canceled, "afterPhysicalEnd": sample()}

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  surface.set_meta("validation_input_device", DEVICE)
  await frames(8)
  var deadline := Time.get_ticks_msec() + 5000
  while application.call("evaluate", "Boolean(globalThis.GodotTransforms && GodotTransforms.stats().mounts.gallery === 1)") != "true" and \
    Time.get_ticks_msec() < deadline and snapshot(application).get("errors", []).is_empty():
    await frames(1)
  if not verify(application.call("evaluate", "Boolean(globalThis.GodotTransforms && GodotTransforms.stats().mounts.gallery === 1)") == "true",
    "A fresh application mounts the real original RN TransformGallery"):
    await finish()
    return
  if not verify(control("gesture") != null and control("gesture-parent") != null and target_tag() > 0,
    "The responder target and transformed ancestor are mounted native Controls"):
    await finish()
    return
  original_surface_scale = surface.scale
  original_parent_scale = control("gesture-parent").scale
  for property in ["enabled", "position", "position_ratio", "scale", "rotation", "pivot", "pivot_ratio", "visual_only"]:
    original_surface_offset[property] = surface.get("offset_transform_" + property)
  stages["initial"] = sample()
  await invalid_start()
  await valid_control()
  await canceled_hold("overflow")
  await canceled_hold("singular-surface")
  await finish()

func finish() -> void:
  if control("gesture-parent") != null:
    restore_embedding()
  var before_stop := snapshot(surface)
  application.call("stop")
  await frames(8)
  var stopped := snapshot(application)
  var retired := snapshot(surface)
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty() and
    stopped.get("pendingTimers", -1) == 0 and stopped.get("pendingAnimationFrames", -1) == 0 and
    stopped.get("pendingWork", -1) == 0 and stopped.get("pendingRootRetirements", -1) == 0,
    "Input guard lifetime shuts down without errors, roots or scheduling resources")
  verify(retired.get("nativeTags", -1) == 0 and retired.get("creates", -1) == retired.get("deletes", -2) and
    retired.get("pointer", {}).get("activeTouches", -1) == 0 and retired.get("pointer", {}).get("responder", -1) == 0,
    "Input guard shutdown balances native Controls and retains no contact or responder")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  var report := {"schemaVersion": 1, "scenario": "transforms-input-guards", "status": "failed" if failed else "passed", "failed": failed,
    "godot": Engine.get_version_info().string, "reactNative": "0.87.1", "engine": "hermes", "renderer": "fabric",
    "displayServer": DisplayServer.get_name(), "validationInputDevice": DEVICE, "inputTransport": "Input.parse_input_event",
    "oracle": "Independent JSX input points; actual local/global determinant classification; exact last-valid event coordinate preservation",
    "checks": checks, "stages": stages, "beforeStop": before_stop, "applicationStopped": stopped, "surfaceStopped": retired}
  var report_path := "res://build/transforms-input-guards.json"
  for argument in OS.get_cmdline_user_args():
    if argument.begins_with("--report="):
      report_path = argument.trim_prefix("--report=")
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(report_path.get_base_dir()))
  var output := FileAccess.open(report_path, FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_CHECK_FAILED: Cannot write transform input guard report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("TRANSFORM_INPUT_GUARDS_FAILED" if failed else "TRANSFORM_INPUT_GUARDS_PASSED: " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
