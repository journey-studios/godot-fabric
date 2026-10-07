extends SceneTree

var checks: Array = []
var application: Node
var surface: Control
var reentrant_stop := {"enabled": false, "triggered": false}

func check(ok: bool, id: String) -> void:
  checks.append({"id": id, "passed": ok})
  if not ok: push_error("FABRIC_CHECK_FAILED: " + id)
func settle(frames: int = 10) -> void:
  for frame in range(frames): await process_frame
func native(target: Object) -> Dictionary:
  var value: Variant = JSON.parse_string(target.call("snapshot"))
  return value if value is Dictionary else {}
func react() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("evaluate",
    "JSON.stringify(ModalLifecycleProbe.snapshot())"))
  return value if value is Dictionary else {}
func modal(snapshot: Dictionary) -> Dictionary:
  for node: Dictionary in snapshot.get("nodes", []):
    if node.get("testID") == "lifecycle-modal": return node
  return {}
func push_capture(target: Control) -> void:
  var down := InputEventMouseButton.new()
  down.button_index = MOUSE_BUTTON_LEFT
  down.position = target.get_global_rect().get_center()
  down.pressed = true
  root.push_input(down, true)
  await settle(2)
  var move := InputEventMouseMotion.new()
  move.position = target.get_global_rect().position + Vector2(240, 24)
  move.button_mask = MOUSE_BUTTON_MASK_LEFT
  root.push_input(move, true)
  await settle(4)
func run_probe() -> void:
  root.size = Vector2i(420, 320)
  root.child_entered_tree.connect(func(child: Node) -> void:
    if child is Window and child != root:
      var modal_window := child as Window
      modal_window.visibility_changed.connect(func() -> void:
        if reentrant_stop.enabled and not modal_window.visible and not reentrant_stop.triggered:
          reentrant_stop.triggered = true
          application.call("stop")
      )
  )
  application = ClassDB.instantiate("FabricApplication")
  application.name = "ModalCaptureLifetimeApplication"
  application.set("bundle_path", "res://build/modal-discriminators-probe.js")
  root.add_child(application)
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "ModalCaptureLifetimeSurface"
  surface.set("application_path", NodePath("../ModalCaptureLifetimeApplication"))
  surface.set("component_name", "ModalLifecycleProbe")
  root.add_child(surface)
  await settle(18)

  var destroyed_ids: Array[int] = []
  var cycle_snapshots: Array[Dictionary] = []
  for cycle in range(10):
    var before_surface := native(surface)
    var before_modal := modal(before_surface)
    var window := instance_from_id(int(before_modal.get("modalWindow", {}).get("id", 0))) as Window
    var target := root.find_child("lifecycle-target", true, false) as Control
    var before := react()
    check(window != null and window.visible and target != null,
      "capture/cycle-%02d-window-and-target-mounted" % cycle)
    if window == null or target == null: break
    destroyed_ids.append(window.get_instance_id())
    await push_capture(target)
    var captured := react()
    check(int(captured.downs) == int(before.downs) + 1 and int(captured.gots) == int(before.gots) + 1 and
      bool(captured.capturePresentOnGot), "capture/cycle-%02d-pointer-capture-active" % cycle)
    application.call("evaluate", "ModalLifecycleProbe.setMounted(false)")
    await settle(10)
    var after_surface := native(surface)
    var after_app := native(application)
    var window_destroyed := not is_instance_valid(window)
    var target_disconnected := not is_instance_valid(target) or not target.is_inside_tree()
    var route: Dictionary = after_app.get("pointerRouting", {})
    var processor: Dictionary = after_app.get("pointerProcessor", {})
    var state_after := react()
    check(window_destroyed and target_disconnected,
      "capture/cycle-%02d-physical-endpoint-and-capture-owner-destroyed" % cycle)
    check(int(route.get("stored", -1)) == 0 and int(route.get("suppressed", -1)) == 0 and
      int(processor.get("active", -1)) == 0 and int(processor.get("activeCapture", -1)) == 0,
      "capture/cycle-%02d-dead-window-route-and-processor-state-retired" % cycle)
    check(state_after.presses == captured.presses and state_after.cancels == captured.cancels and
      state_after.losts == captured.losts,
      "capture/cycle-%02d-removed-target-receives-no-fabricated-terminal-callback" % cycle)
    cycle_snapshots.append({"cycle": cycle, "windowId": destroyed_ids.back(), "windowDestroyed": window_destroyed,
      "targetDisconnected": target_disconnected, "pointerRouting": route, "pointerProcessor": processor,
      "reactBefore": captured, "reactAfter": state_after, "surface": after_surface})
    if cycle < 9:
      application.call("evaluate", "ModalLifecycleProbe.setMounted(true)")
      await settle(12)
      var next_modal := modal(native(surface))
      var next_window := instance_from_id(int(next_modal.get("modalWindow", {}).get("id", 0))) as Window
      check(next_window != null and next_window.visible and
        not destroyed_ids.has(next_window.get_instance_id()), "capture/cycle-%02d-new-presentation-window" % cycle)

  application.call("evaluate", "ModalLifecycleProbe.setMounted(true)")
  await settle(12)
  var before_reentrant := react()
  var reentrant_surface := native(surface)
  var reentrant_modal := modal(reentrant_surface)
  var reentrant_window := instance_from_id(int(reentrant_modal.get("modalWindow", {}).get("id", 0))) as Window
  var reentrant_target := root.find_child("lifecycle-target", true, false) as Control
  check(reentrant_window != null and reentrant_target != null and reentrant_window.visible,
    "lifecycle/reentrant-target-mounted-before-stop")
  if reentrant_window != null and reentrant_target != null:
    await push_capture(reentrant_target)
    var active_reentrant := react()
    check(int(active_reentrant.gots) == int(before_reentrant.gots) + 1 and
      bool(active_reentrant.capturePresentOnGot), "lifecycle/capture-active-before-window-callback-stop")
    reentrant_stop.enabled = true
    application.call("evaluate", "ModalLifecycleProbe.setMounted(false)")
    await settle(12)
  var stopped := native(application)
  var final_surface := native(surface)
  var final_react := react()
  check(reentrant_stop.triggered and stopped.stopped and stopped.rootCount == 0 and final_surface.nativeTags == 0,
    "lifecycle/window-visibility-callback-stops-owner-after-modal-revocation")
  check(reentrant_window == null or not is_instance_valid(reentrant_window),
    "lifecycle/reentrant-window-is-freed-after-callback-unwinds")
  check(int(stopped.get("pointerRouting", {}).get("stored", -1)) == 0 and
    int(stopped.get("pointerRouting", {}).get("suppressed", -1)) == 0 and
    int(stopped.get("pointerProcessor", {}).get("activeCapture", -1)) == 0 and
    final_react.presses == before_reentrant.presses,
    "lifecycle/reentrant-stop-leaves-no-dead-endpoint-or-phantom-press")
  check(stopped.errors.is_empty() and final_surface.errors.is_empty(), "lifecycle/no-runtime-errors")
  var report := {"scenario": "modal-capture-endpoint-lifetime", "cycles": cycle_snapshots,
    "destroyedWindowIds": destroyed_ids, "reentrant": {"triggered": reentrant_stop.triggered,
      "application": stopped, "surface": final_surface, "react": final_react}, "checks": checks}
  var output := FileAccess.open("res://build/modal-capture-lifetime-report.json", FileAccess.WRITE)
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("MODAL_CAPTURE_LIFETIME_PASSED=" + str(checks.size()) if checks.all(
    func(row: Dictionary) -> bool: return row.passed) else "MODAL_CAPTURE_LIFETIME_FAILED")
  quit(0 if checks.all(func(row: Dictionary) -> bool: return row.passed) else 1)
func _initialize() -> void: call_deferred("run_probe")
