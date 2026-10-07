extends SceneTree

var checks: Array = []
var interlopers: Array = []
func check(ok: bool, id: String) -> void:
  checks.append({"id": id, "passed": ok})
  if not ok: push_error("FABRIC_CHECK_FAILED: " + id)
func settle(frames: int = 12) -> void:
  for frame in range(frames): await process_frame
func retire_applications(first: Node, second: Node) -> void:
  first.call("stop")
  second.call("stop")
  await settle(24)
func native(target: Object) -> Dictionary:
  var value: Variant = JSON.parse_string(target.call("snapshot"))
  return value if value is Dictionary else {}
func react(owner: Object) -> Dictionary:
  var value: Variant = JSON.parse_string(owner.call("evaluate", "JSON.stringify(ModalLifecycleProbe.snapshot())"))
  return value if value is Dictionary else {}
func modal(snapshot: Dictionary) -> Dictionary:
  for node: Dictionary in snapshot.get("nodes", []):
    if node.get("testID") == "lifecycle-modal": return node
  return {}
func control(snapshot: Dictionary, test_id: String) -> Control:
  for node: Dictionary in snapshot.get("nodes", []):
    if node.get("testID") == test_id:
      return instance_from_id(int(node.get("id", 0))) as Control
  return null
func click(owner: Window, target: Control) -> void:
  var down := InputEventMouseButton.new()
  down.button_index = MOUSE_BUTTON_LEFT
  down.device = 4242
  down.position = target.get_global_rect().get_center()
  down.pressed = true
  owner.push_input(down, true)
  await settle(3)
  var interloper_position := Vector2(owner.size) - Vector2(4, 4)
  var interloper := InputEventMouseMotion.new()
  interloper.device = 4243
  interloper.position = interloper_position
  interloper.relative = Vector2(1, 0)
  interlopers.append({"ownerWindowId": owner.get_instance_id(), "device": interloper.device,
    "position": [interloper_position.x, interloper_position.y],
    "insideOwner": Rect2(Vector2.ZERO, Vector2(owner.size)).has_point(interloper_position),
    "outsideTarget": not target.get_global_rect().has_point(interloper_position)})
  owner.push_input(interloper, true)
  var up := down.duplicate() as InputEventMouseButton
  up.pressed = false
  owner.push_input(up, true)
  await settle(8)
func run_probe() -> void:
  root.size = Vector2i(420, 320)
  var app_a: Node = ClassDB.instantiate("FabricApplication")
  app_a.name = "WindowAApplication"
  app_a.set("bundle_path", "res://build/modal-discriminators-probe.js")
  root.add_child(app_a)
  var surface_a: Control = ClassDB.instantiate("FabricSurface")
  surface_a.name = "WindowASurface"
  surface_a.size = Vector2(110, 90)
  surface_a.set_meta("validation_input_device", 4242)
  surface_a.set("application_path", NodePath("../WindowAApplication"))
  surface_a.set("component_name", "ModalLifecycleProbe")
  root.add_child(surface_a)

  var owner_b := Window.new()
  owner_b.name = "IndependentNativeOwnerWindow"
  owner_b.visible = false
  owner_b.force_native = true
  owner_b.content_scale_mode = root.get_content_scale_mode()
  owner_b.position = Vector2i(520, 80)
  owner_b.size = Vector2i(360, 280)
  root.add_child(owner_b)
  owner_b.visible = true
  await settle(2)
  var app_b: Node = ClassDB.instantiate("FabricApplication")
  app_b.name = "WindowBApplication"
  app_b.set("bundle_path", "res://build/modal-discriminators-probe.js")
  owner_b.add_child(app_b)
  var surface_b: Control = ClassDB.instantiate("FabricSurface")
  surface_b.name = "WindowBSurface"
  surface_b.size = Vector2(130, 100)
  surface_b.set_meta("validation_input_device", 4242)
  surface_b.set("application_path", NodePath("../WindowBApplication"))
  surface_b.set("component_name", "ModalLifecycleProbe")
  owner_b.add_child(surface_b)
  await settle(24)

  var owner_a := root as Window
  var modal_a := modal(native(surface_a))
  var modal_b := modal(native(surface_b))
  var window_a := instance_from_id(int(modal_a.get("modalWindow", {}).get("id", 0))) as Window
  var window_b := instance_from_id(int(modal_b.get("modalWindow", {}).get("id", 0))) as Window
  if window_a == null or window_b == null:
    var missing_window_errors := [native(app_a).errors, native(app_b).errors]
    var missing_window_ids := [0 if window_a == null else window_a.get_instance_id(),
      0 if window_b == null else window_b.get_instance_id()]
    await retire_applications(app_a, app_b)
    var failed := {"scenario": "modal-two-native-owner-windows", "displayServer": DisplayServer.get_name(),
      "checks": checks, "errors": missing_window_errors,
      "cleanup": [native(app_a), native(app_b)],
      "modalWindowIds": missing_window_ids}
    var failed_output := FileAccess.open("res://build/modal-owner-windows-report.json", FileAccess.WRITE)
    failed_output.store_string(JSON.stringify(failed, "  ") + "\n")
    quit(1)
    return
  var target_a := control(native(surface_a), "lifecycle-target")
  var target_b := control(native(surface_b), "lifecycle-target")
  var targets_mounted := target_a != null and target_b != null
  check(targets_mounted, "owners/targets-are-present-before-native-input")
  if not targets_mounted:
    var missing_target_errors := [native(app_a).errors, native(app_b).errors]
    var missing_target_ids := [0 if target_a == null else target_a.get_instance_id(),
      0 if target_b == null else target_b.get_instance_id()]
    var failed_modal_window_ids := [window_a.get_instance_id(), window_b.get_instance_id()]
    await retire_applications(app_a, app_b)
    var failed := {"scenario": "modal-two-native-owner-windows", "displayServer": DisplayServer.get_name(),
      "checks": checks, "errors": missing_target_errors,
      "cleanup": [native(app_a), native(app_b)],
      "targetIds": missing_target_ids,
      "modalWindowIds": failed_modal_window_ids}
    var failed_output := FileAccess.open("res://build/modal-owner-windows-report.json", FileAccess.WRITE)
    failed_output.store_string(JSON.stringify(failed, "  ") + "\n")
    quit(1)
    return
  check(owner_b.force_native and not owner_b.is_embedded() and owner_b.get_viewport() == owner_b and
    owner_b.get_window() == owner_b, "owners/second-owner-is-a-distinct-native-window")
  check(window_a != null and window_b != null and window_a != window_b and
    window_a.get_parent() == owner_a and window_b.get_parent() == owner_b and
    window_a.is_embedded() and window_b.is_embedded(),
    "owners/each-runtime-modal-window-is-embedded-under-its-own-owner")
  var top_state := [{"visible": window_a.visible, "exclusive": window_a.is_exclusive(),
      "parent": window_a.get_parent().get_instance_id(), "embedded": window_a.is_embedded(),
      "targetWindow": target_a.get_window().get_instance_id(), "targetViewport": target_a.get_viewport().get_instance_id()},
    {"visible": window_b.visible, "exclusive": window_b.is_exclusive(),
      "parent": window_b.get_parent().get_instance_id(), "embedded": window_b.is_embedded(),
      "targetWindow": target_b.get_window().get_instance_id(), "targetViewport": target_b.get_viewport().get_instance_id()}]
  check(top_state[0].visible and top_state[0].exclusive and top_state[1].visible and top_state[1].exclusive and
    target_a != null and target_b != null and target_a.get_window() == window_a and target_b.get_window() == window_b,
    "owners/both-independent-modal-stacks-hold-their-own-exclusive-top")
  var id_a := window_a.get_instance_id() if window_a != null else 0
  var id_b := window_b.get_instance_id() if window_b != null else 0
  var target_a_id := target_a.get_instance_id() if target_a != null else 0
  var target_b_id := target_b.get_instance_id() if target_b != null else 0

  if target_a != null: await click(owner_a, target_a)
  var state_a_after_click := react(app_a)
  var state_b_after_a_click := react(app_b)
  check(int(state_a_after_click.downs) == 1 and int(state_a_after_click.presses) == 1 and
    int(state_b_after_a_click.downs) == 0 and int(state_b_after_a_click.presses) == 0,
    "owners/input-in-owner-A-is-confined-to-runtime-A")
  if target_b != null: await click(owner_b, target_b)
  var state_a_after_b_click := react(app_a)
  var state_b_after_click := react(app_b)
  check(int(state_b_after_click.downs) == 1 and int(state_b_after_click.presses) == 1 and
    int(state_a_after_b_click.downs) == 1 and int(state_a_after_b_click.presses) == 1,
    "owners/input-in-owner-B-is-confined-to-runtime-B")

  app_a.call("evaluate", "ModalLifecycleProbe.setMounted(false)")
  await settle(12)
  var owner_b_after_a_remove := native(surface_b)
  var retained_b_window := instance_from_id(id_b) as Window
  var retained_b_target := control(owner_b_after_a_remove, "lifecycle-target")
  check((window_a == null or not is_instance_valid(window_a)) and retained_b_window != null and
    retained_b_window.visible and retained_b_window.is_exclusive() and retained_b_target != null and
    retained_b_target.get_instance_id() == target_b_id and
    int(modal(owner_b_after_a_remove).modalWindow.id) == id_b,
    "owners/removing-A-presentation-preserves-B-window-stack-and-control-identity")
  if retained_b_target != null: await click(owner_b, retained_b_target)
  var state_b_after_a_remove := react(app_b)
  var native_a_after_interlopers := native(surface_a)
  var native_b_after_interlopers := native(surface_b)
  check(int(state_b_after_a_remove.downs) == 2 and int(state_b_after_a_remove.presses) == 2 and
    native(app_a).pointerRouting.stored == 0 and native(app_a).pointerRouting.suppressed == 0,
    "owners/B-remains-interactive-after-A-presentation-is-destroyed")
  check(interlopers.size() == 3 and interlopers.all(func(row: Dictionary) -> bool:
      return row.device == 4243 and row.insideOwner and row.outsideTarget) and
    native_a_after_interlopers.pointer.pointerMoves == 0 and
    native_b_after_interlopers.pointer.pointerMoves == 0 and
    state_a_after_b_click.moves == 0 and state_b_after_a_remove.moves == 0,
    "owners/foreign-device-interlopers-never-reach-native-or-responder-moves")
  app_a.call("stop")
  await settle(8)
  var b_after_stop_a := native(surface_b)
  retained_b_window = instance_from_id(id_b) as Window
  check(native(app_a).stopped and retained_b_window != null and retained_b_window.visible and
    retained_b_window.is_exclusive() and int(modal(b_after_stop_a).modalWindow.id) == id_b,
    "owners/stopping-runtime-A-does-not-retire-owner-B-stack")
  app_b.call("stop")
  await settle(8)
  var final_a := native(surface_a)
  var final_b := native(surface_b)
  check(native(app_b).stopped and final_a.nativeTags == 0 and final_b.nativeTags == 0,
    "owners/both-native-owner-runtimes-clean-up-independently")
  var report := {"scenario": "modal-two-native-owner-windows", "displayServer": DisplayServer.get_name(), "owners": {
      "A": {"windowId": owner_a.get_instance_id(), "surface": native(surface_a), "state": state_a_after_b_click},
      "B": {"windowId": owner_b.get_instance_id(), "surface": native(surface_b), "state": state_b_after_a_remove}},
    "modalWindowIds": [id_a, id_b], "targetIds": [target_a_id, target_b_id],
    "interlopers": interlopers,
    "windowStateBeforeClicks": top_state,
    "checks": checks,
    "errors": [native(app_a).errors, native(app_b).errors]}
  var output := FileAccess.open("res://build/modal-owner-windows-report.json", FileAccess.WRITE)
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("MODAL_OWNER_WINDOWS_PASSED=" + str(checks.size()) if checks.all(
    func(row: Dictionary) -> bool: return row.passed) else "MODAL_OWNER_WINDOWS_FAILED")
  quit(0 if checks.all(func(row: Dictionary) -> bool: return row.passed) else 1)
func _initialize() -> void: call_deferred("run_probe")
