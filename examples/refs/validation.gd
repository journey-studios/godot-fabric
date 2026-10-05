extends Node

var checks: Array = []
@onready var application: Node = $Application

func verify(condition: bool, name: String) -> void:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)

func frames() -> void:
  for index in range(8):
    await get_tree().process_frame

func js(source: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + source + ")"))

func close(a: Array, b: Array) -> bool:
  if a.size() != b.size():
    return false
  for index in range(a.size()):
    if not is_equal_approx(float(a[index]), float(b[index])):
      return false
  return true

func native_rect(control: Control) -> Array:
  var transform := control.get_global_transform_with_canvas()
  var size := control.size
  var points: Array[Vector2] = [Vector2.ZERO, Vector2(size.x, 0), Vector2(0, size.y), size]
  var bounds := Rect2(transform * points[0], Vector2.ZERO)
  for index in range(1, points.size()):
    bounds = bounds.expand(transform * points[index])
  return [bounds.position.x, bounds.position.y, bounds.size.x, bounds.size.y]

func capture(stage: String) -> void:
  if not OS.get_cmdline_user_args().has("--capture"):
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/refs-" + stage + ".png") == OK, "Capture saved: " + stage)

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(1000, 680)
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  await frames()
  var a: Dictionary = js("GodotRefs.read('A')")
  var b: Dictionary = js("GodotRefs.read('B')")
  verify(a.originalInstance and b.originalInstance, "Both roots expose the original RN public element class")
  var initial := {"A": a.duplicate(true), "B": b.duplicate(true)}
  verify(a.connected and a.parentMatches and a.contained and a.sameDocument and a.rootMatches and a.documentConnected, "Parent, containment, owner document and root APIs follow the original shadow tree")
  verify(a.parentChildren == 4, "Original children traverses native View and Text including zero/hidden elements")
  verify(close(a.measure, [16, 16, 100, 40, 16, 16]), "measure stays in RN root coordinates despite scaled Godot embedding")
  verify(close(a.relative, [16, 16, 100, 40]) and close(a.legacyRelative, a.relative), "Ref and numeric UIManager measureLayout agree")
  verify(close(a.offset, [16, 16, 100, 40]), "offset sizes and positions exclude embedding transforms")
  var child_a: Control = $A.find_child("A-child", true, false)
  var child_b: Control = $B.find_child("B-child", true, false)
  verify(close(a.window, native_rect(child_a)) and close(a.legacyWindow, a.window), "Scaled measureInWindow agrees with actual native corners and legacy API")
  verify(close(b.window, native_rect(child_b)), "Rotated measureInWindow includes all four native corners")
  verify(close([a.rect.x, a.rect.y, a.rect.width, a.rect.height], a.window), "Original DOMRect and window measurement agree")
  var zero: Control = $A.find_child("A-zero", true, false)
  verify(close([a.zero.x, a.zero.y, a.zero.width, a.zero.height], native_rect(zero)), "A valid zero-size element retains its transformed window position")
  verify(close([a.hidden.x, a.hidden.y, a.hidden.width, a.hidden.height], [0, 0, 0, 0]), "display:none retains empty DOM geometry without the surface offset")
  var invalid: Dictionary = js("GodotRefs.invalidTags()")
  verify(invalid.failures == 9 and invalid.successes == 0, "Invalid numeric and nonnumeric handles fail safely before native tag conversion")
  var cross: Dictionary = js("GodotRefs.cross()")
  verify(cross.get("failed", false) and not cross.get("succeeded", false), "Cross-root measureLayout uses upstream failure callback")
  await capture("initial")
  $A.position += Vector2(25, 30)
  await frames()
  a = js("GodotRefs.read('A')")
  verify(close(a.window, native_rect(child_a)) and close(a.measure, [16, 16, 100, 40, 16, 16]), "Moving an embedded surface changes only window coordinates")
  application.call("evaluate", "GodotRefs.run('A', 'nativeProps')")
  await frames()
  a = js("GodotRefs.read('A')")
  verify(a.offset[2] == 95 and child_a.size.x == 95 and is_equal_approx(child_a.modulate.a, 0.5), "Original setNativeProps commits Yoga layout and native appearance")
  application.call("evaluate", "GodotRefs.run('A', 'rerender')")
  await frames()
  verify(child_a.size.x == 95, "Unrelated React rerender preserves the imperative width")
  application.call("evaluate", "GodotRefs.run('A', 'overwrite')")
  await frames()
  verify(child_a.size.x == 130, "A changed declarative prop supersedes the imperative width")
  var old_tag: int = a.tag
  application.call("evaluate", "GodotRefs.run('A', 'replace')")
  await frames()
  var stale: Dictionary = js("GodotRefs.stale('A')")
  a = js("GodotRefs.read('A')")
  verify(not stale.connected and stale.callbacks == 0 and stale.rect.width == 0, "Retained deleted refs neither measure nor access a new native node")
  verify(a.tag != old_tag and a.offset[2] == 130, "A replacement has a fresh native tag and ignores stale commands")
  application.call("evaluate", "GodotRefs.run('B', 'retain')")
  $B.unmount()
  await frames()
  stale = js("GodotRefs.stale('B')")
  verify(not stale.connected and stale.callbacks == 0, "Root unmount invalidates retained refs while the application stays alive")
  var document: Dictionary = js("GodotRefs.staleDocument()")
  verify(not document.connected and int(document.position) & 1, "Comparing an active element with another root's retired document stays disconnected and safe")
  verify(js("GodotRefs.read('A')").connected, "Unmounting the second root preserves the first root's document")
  await capture("updated")
  application.call("stop")
  var status: Dictionary = JSON.parse_string(application.call("snapshot"))
  verify(status.errors.is_empty() and status.rootCount == 0 and status.nativeModules.stopped, "Shutdown removes roots and native module authority without errors")
  var report := {"scenario": "refs", "displayServer": DisplayServer.get_name(), "engine": "hermes", "renderer": "fabric", "checks": checks, "initial": initial, "final": a, "afterStop": status}
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(check: Dictionary) -> bool: return not check.passed)
  print("FABRIC_VALIDATION_FAILED: refs" if failed else "FABRIC_VALIDATION_PASSED: refs")
  get_tree().quit(1 if failed else 0)
