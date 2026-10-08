extends SceneTree

var checks: Array = []
func check(condition: bool, id: String) -> void:
  checks.append({"id": id, "passed": condition})
  if not condition: push_error("FABRIC_CHECK_FAILED: " + id)
func settle(frames: int = 12) -> void:
  for frame in range(frames): await process_frame
func native(target: Object) -> Dictionary:
  if target == null or not is_instance_valid(target): return {}
  var value: Variant = JSON.parse_string(target.call("snapshot"))
  return value if value is Dictionary else {}
func react(owner: Object) -> Dictionary:
  var value: Variant = JSON.parse_string(owner.call("evaluate", "JSON.stringify(ModalHostProbe.snapshot())"))
  return value if value is Dictionary else {}
func node_for(snapshot: Dictionary, test_id: String) -> Dictionary:
  for node: Dictionary in snapshot.get("nodes", []):
    if node.get("testID") == test_id: return node
  return {}
func belongs_to(node: Node, ancestor: Node) -> bool:
  var current := node
  while current != null:
    if current == ancestor: return true
    current = current.get_parent()
  return false
func run_probe() -> void:
  root.size = Vector2i(420, 320)
  var application: Node = ClassDB.instantiate("FabricApplication")
  application.name = "HiddenSurfaceApplication"
  application.set("bundle_path", "res://build/modal-discriminators-probe.js")
  root.add_child(application)
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = "HiddenSurface"
  surface.position = Vector2(32, 48)
  surface.size = Vector2(90, 70)
  surface.set("application_path", NodePath("../HiddenSurfaceApplication"))
  surface.set("component_name", "ModalHostProbe")
  root.add_child(surface)
  await settle(20)

  application.call("evaluate", "ModalHostProbe.measureZeroNow()")
  var visible_measurement: Array = react(application).get("liveMeasurements", [])
  application.call("evaluate", "ModalHostProbe.setVisible(false)")
  await settle(8)
  surface.visible = false
  application.call("evaluate", "ModalHostProbe.measureZeroNow()")
  var hidden_measurement: Array = react(application).get("liveMeasurements", [])
  var hidden_button := root.find_child("background-action", true, false) as Control
  var background_before := react(application)
  if hidden_button != null:
    var down := InputEventMouseButton.new()
    down.button_index = MOUSE_BUTTON_LEFT
    down.device = 4242
    down.position = hidden_button.get_global_rect().get_center()
    down.pressed = true
    root.push_input(down, true)
    down = down.duplicate() as InputEventMouseButton
    down.pressed = false
    root.push_input(down, true)
  await settle(8)
  var hidden_state := react(application)
  var before_point: Dictionary = visible_measurement[0] if not visible_measurement.is_empty() else {}
  var after_point: Dictionary = hidden_measurement[0] if not hidden_measurement.is_empty() else {}
  check(not visible_measurement.is_empty() and not hidden_measurement.is_empty() and before_point == after_point,
    "hidden/connected Surface keeps DOM measurement coordinates when its native visibility is false")
  check(not surface.is_visible_in_tree() and int(hidden_state.backgroundPointerDowns) == int(background_before.backgroundPointerDowns) and
    int(hidden_state.backgroundClicks) == int(background_before.backgroundClicks),
    "hidden/a hidden Surface does not receive newly injected pointer input")
  application.call("stop")
  await settle(8)

  var retiring_application: Node = ClassDB.instantiate("FabricApplication")
  retiring_application.name = "FreedSurfaceApplication"
  retiring_application.set("bundle_path", "res://build/modal-discriminators-probe.js")
  root.add_child(retiring_application)
  var retiring_surface: Control = ClassDB.instantiate("FabricSurface")
  retiring_surface.name = "SurfaceFreedFromModalSignal"
  retiring_surface.size = Vector2(150, 100)
  retiring_surface.set("application_path", NodePath("../FreedSurfaceApplication"))
  retiring_surface.set("component_name", "ModalHostProbe")
  root.add_child(retiring_surface)
  await settle(20)
  var surface_id := retiring_surface.get_instance_id()
  var before_free := native(retiring_surface)
  var modal_node := node_for(before_free, "first-modal")
  var ordinary_node := node_for(before_free, "small-root")
  var ordinary_control_id := int(ordinary_node.get("id", 0))
  var modal_info: Dictionary = modal_node.get("modalWindow", {})
  var modal_window := instance_from_id(int(modal_info.get("id", 0))) as Window
  var ordinary_control := instance_from_id(ordinary_control_id) as Control
  var ordinary_root: Control
  for child in retiring_surface.get_children():
    if child is Control:
      ordinary_root = child
      break
  var ordinary_root_id := ordinary_root.get_instance_id() if ordinary_root != null else 0
  var ordinary_parent_id := ordinary_control.get_parent().get_instance_id() if ordinary_control != null and ordinary_control.get_parent() != null else 0
  var freed := {"called": false, "releaseQueued": false, "ordinaryRootAlive": false,
    "ordinaryRootDetached": false, "surfaceWasAlive": false}
  check(modal_window != null and modal_window.visible and ordinary_control_id != 0 and
    ordinary_control != null and ordinary_root != null and ordinary_root.get_parent() == retiring_surface and
    belongs_to(ordinary_control, ordinary_root),
    "teardown/test Surface owns ordinary RN content and a live Modal Window")
  if modal_window != null:
    modal_window.visibility_changed.connect(func() -> void:
      if not modal_window.visible and not freed.called:
        freed.called = true
        var owner := instance_from_id(surface_id)
        var root_control := instance_from_id(ordinary_root_id)
        freed.surfaceWasAlive = owner != null
        freed.ordinaryRootAlive = root_control != null
        freed.ordinaryRootDetached = root_control != null and root_control.get_parent() == null
        if owner != null:
          owner.queue_free()
          freed.releaseQueued = true
    )
  retiring_surface.call("unmount")
  await settle(24)
  var retired_application := native(retiring_application)
  check(bool(freed.called) and bool(freed.surfaceWasAlive) and bool(freed.ordinaryRootAlive) and
    bool(freed.ordinaryRootDetached) and bool(freed.releaseQueued),
    "teardown/unmount detaches the ordinary RN root before visibility_changed queues Surface release")
  check(not is_instance_valid(instance_from_id(surface_id)),
    "teardown/queued Surface release completes after unmount returns")
  check(int(retired_application.get("rootCount", -1)) == 0 and retired_application.errors.is_empty(),
    "teardown/freeing the Surface retires its Fabric root without stale Control access or runtime errors")
  retiring_application.call("stop")
  await settle(8)

  var callback_application: Node = ClassDB.instantiate("FabricApplication")
  callback_application.name = "FreedSurfaceFromVisibilityApplication"
  callback_application.set("bundle_path", "res://build/modal-discriminators-probe.js")
  root.add_child(callback_application)
  var callback_surface: Control = ClassDB.instantiate("FabricSurface")
  callback_surface.name = "SurfaceFreedFromJsVisibilitySignal"
  callback_surface.size = Vector2(150, 100)
  callback_surface.set("application_path", NodePath("../FreedSurfaceFromVisibilityApplication"))
  callback_surface.set("component_name", "ModalHostProbe")
  root.add_child(callback_surface)
  await settle(20)
  var callback_surface_id := callback_surface.get_instance_id()
  var callback_snapshot := native(callback_surface)
  var callback_modal := node_for(callback_snapshot, "first-modal")
  var callback_modal_window := instance_from_id(int(callback_modal.get("modalWindow", {}).get("id", 0))) as Window
  var callback_ordinary := node_for(callback_snapshot, "small-root")
  var callback_ordinary_control := instance_from_id(int(callback_ordinary.get("id", 0))) as Control
  var js_hide := {"called": false, "ordinaryWasAlive": false, "surfaceWasAlive": false}
  check(callback_modal_window != null and callback_modal_window.visible and callback_ordinary_control != null and
    belongs_to(callback_ordinary_control, callback_surface),
    "teardown/JS hide control starts with ordinary RN content and a visible Modal")
  if callback_modal_window != null:
    callback_modal_window.visibility_changed.connect(func() -> void:
      if not callback_modal_window.visible and not js_hide.called:
        js_hide.called = true
        var owner := instance_from_id(callback_surface_id)
        var ordinary := instance_from_id(int(callback_ordinary.get("id", 0)))
        js_hide.surfaceWasAlive = owner != null
        js_hide.ordinaryWasAlive = owner != null and ordinary != null and belongs_to(ordinary, owner)
        if owner != null: owner.free()
    )
  callback_application.call("evaluate", "ModalHostProbe.setVisible(false)")
  await settle(24)
  var callback_retired_application := native(callback_application)
  check(bool(js_hide.called) and bool(js_hide.surfaceWasAlive) and bool(js_hide.ordinaryWasAlive) and
    not is_instance_valid(instance_from_id(callback_surface_id)),
    "teardown/JS visibility callback synchronously frees its Surface while ordinary content remains alive")
  check(int(callback_retired_application.get("rootCount", -1)) == 0 and callback_retired_application.errors.is_empty(),
    "teardown/JS callback Surface.free retires the Fabric root without runtime errors")
  callback_application.call("stop")
  await settle(8)

  var report := {"scenario": "modal-surface-unmount-and-reentrant-free", "displayServer": DisplayServer.get_name(),
    "visibleMeasurement": visible_measurement, "hiddenMeasurement": hidden_measurement,
    "hiddenSurface": hidden_state, "freedSurfaceId": surface_id, "freeCallback": freed,
    "beforeFreeSurface": before_free, "ordinaryControlId": ordinary_control_id,
    "ordinaryControlParentId": ordinary_parent_id,
    "retiredApplication": retired_application, "jsHide": js_hide,
    "callbackRetiredApplication": callback_retired_application, "checks": checks}
  var output := FileAccess.open("res://build/modal-surface-lifetime-report.json", FileAccess.WRITE)
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("MODAL_SURFACE_LIFETIME_PASSED=" + str(checks.size()) if checks.all(
    func(row: Dictionary) -> bool: return row.passed) else "MODAL_SURFACE_LIFETIME_FAILED")
  quit(0 if checks.all(func(row: Dictionary) -> bool: return row.passed) else 1)
func _initialize() -> void: call_deferred("run_probe")
