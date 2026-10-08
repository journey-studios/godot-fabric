extends SceneTree

var checks: Array = []
var observer: Node
var observer_surface: Control

func check(ok: bool, id: String) -> void:
  checks.append({"id": id, "passed": ok})
  if not ok: push_error("FABRIC_CHECK_FAILED: " + id)

func settle(frames: int = 10) -> void:
  for frame in range(frames): await process_frame

func native(target: Object) -> Dictionary:
  var value: Variant = JSON.parse_string(target.call("snapshot"))
  return value if value is Dictionary else {}

func react(owner: Object, expression: String) -> Dictionary:
  var value: Variant = JSON.parse_string(owner.call("evaluate", expression))
  return value if value is Dictionary else {}

func make_application(node_name: String) -> Node:
  var app := ClassDB.instantiate("FabricApplication") as Node
  if app == null: return null
  app.name = node_name
  app.set("bundle_path", "res://build/modal-stack-membership-probe.js")
  root.add_child(app)
  return app

func make_surface(node_name: String, app_name: String, component: String) -> Control:
  var surface := ClassDB.instantiate("FabricSurface") as Control
  if surface == null: return null
  surface.name = node_name
  surface.set("application_path", NodePath("../" + app_name))
  surface.set("component_name", component)
  surface.size = Vector2(240, 180)
  root.add_child(surface)
  return surface

func member_count() -> int:
  return int(native(observer).get("modalRuntimeMembers", -1))

func target(surface: Control, test_id: String) -> Control:
  for node: Dictionary in native(surface).get("nodes", []):
    if node.get("testID") == test_id:
      return instance_from_id(int(node.get("id", 0))) as Control
  return null

func push_capture(control: Control) -> void:
  var down := InputEventMouseButton.new()
  down.button_index = MOUSE_BUTTON_LEFT
  down.position = control.get_global_rect().get_center()
  down.pressed = true
  root.push_input(down, true)
  await settle(2)
  var move := InputEventMouseMotion.new()
  move.position = control.get_global_rect().position + Vector2(240, 24)
  move.button_mask = MOUSE_BUTTON_MASK_LEFT
  root.push_input(move, true)
  await settle(4)

func run_probe() -> void:
  root.size = Vector2i(420, 320)
  observer = make_application("MembershipObserver")
  observer_surface = make_surface("MembershipObserverSurface", "MembershipObserver", "ModalMembershipProbe")
  await settle(16)
  check(member_count() == 1 and native(observer).rootCount == 1 and
    native(observer_surface).errors.is_empty(), "observer/persistent-runtime-owns-one-stack-membership")

  var churn: Array = []
  for index in range(10):
    var app_name := "ChurnApplication%02d" % index
    var app := make_application(app_name)
    var surface := make_surface("ChurnSurface%02d" % index, app_name, "ModalMembershipProbe")
    await settle(12)
    var mounted_count := member_count()
    check(mounted_count == 2 and native(app).rootCount == 1 and native(surface).errors.is_empty(),
      "churn/%02d-adds-one-live-runtime-membership" % index)
    app.call("stop")
    await settle(8)
    var stopped := native(app)
    var remaining_count := member_count()
    check(remaining_count == 1 and stopped.stopped and stopped.rootCount == 0 and stopped.errors.is_empty(),
      "churn/%02d-stop-removes-membership-from-persistent-window" % index)
    churn.append({"index": index, "mountedCount": mounted_count, "afterStopCount": remaining_count,
      "stopped": stopped, "surface": native(surface)})
    surface.queue_free()
    app.queue_free()
    await settle(2)

  var multi := make_application("MultiSurfaceApplication")
  var first := make_surface("MultiSurfaceA", "MultiSurfaceApplication", "ModalMembershipProbe")
  var second := make_surface("MultiSurfaceB", "MultiSurfaceApplication", "ModalMembershipProbe")
  await settle(18)
  var both_mounted := {"members": member_count(), "roots": native(multi).rootCount,
    "first": native(first), "second": native(second)}
  check(both_mounted.members == 2 and both_mounted.roots == 2,
    "surfaces/two-surfaces-share-one-runtime-membership")
  first.call("unmount")
  await settle(8)
  var one_remaining := {"members": member_count(), "roots": native(multi).rootCount}
  check(one_remaining.members == 2 and one_remaining.roots == 1,
    "surfaces/first-unmount-retains-membership-while-second-surface-lives")
  second.call("unmount")
  await settle(8)
  var none_remaining := {"members": member_count(), "roots": native(multi).rootCount}
  check(none_remaining.members == 1 and none_remaining.roots == 0,
    "surfaces/last-unmount-removes-runtime-membership")

  second.set("component_name", "ModalLifecycleProbe")
  var remounted: bool = second.call("mount")
  await settle(18)
  var after_remount := {"mounted": bool(remounted), "members": member_count(),
    "roots": native(multi).rootCount, "surface": native(second),
    "state": react(multi, "JSON.stringify(ModalLifecycleProbe.snapshot())")}
  check(after_remount.mounted and after_remount.members == 2 and after_remount.roots == 1 and
    not after_remount.surface.nodes.is_empty() and after_remount.surface.errors.is_empty(),
    "remount/first-surface-after-zero-roots-registers-runtime-again")

  var lower_target := target(second, "lifecycle-target")
  var before_capture: Dictionary = after_remount.state
  check(lower_target != null, "takeover/remounted-modal-target-is-live")
  if lower_target != null: await push_capture(lower_target)
  var captured := react(multi, "JSON.stringify(ModalLifecycleProbe.snapshot())")
  check(int(captured.downs) == int(before_capture.downs) + 1 and
    int(captured.gots) == int(before_capture.gots) + 1 and bool(captured.capturePresentOnGot),
    "takeover/remounted-runtime-holds-an-active-captured-contact")

  var foreign := make_application("ForeignMembershipApplication")
  var foreign_surface := make_surface("ForeignMembershipSurface", "ForeignMembershipApplication", "ModalLifecycleProbe")
  await settle(18)
  var after_takeover := {"members": member_count(), "lower": react(multi,
      "JSON.stringify(ModalLifecycleProbe.snapshot())"), "foreign": native(foreign_surface)}
  check(after_takeover.members == 3 and after_takeover.foreign.errors.is_empty() and
    int(after_takeover.lower.cancels) == int(captured.cancels) + 1 and
    int(after_takeover.lower.losts) == int(captured.losts) + 1 and
    int(after_takeover.lower.presses) == int(captured.presses),
    "takeover/remounted-runtime-is-cancelled-once-when-foreign-modal-takes-top")
  foreign.call("stop")
  await settle(8)
  var after_foreign_stop := {"members": member_count(), "roots": native(multi).rootCount,
    "lower": native(second)}
  check(after_foreign_stop.members == 2 and after_foreign_stop.roots == 1 and
    not after_foreign_stop.lower.nodes.is_empty(), "takeover/stopping-foreign-top-retains-remounted-runtime")

  foreign_surface.queue_free()
  foreign.queue_free()
  multi.call("stop")
  await settle(8)
  var after_multi_stop := member_count()
  observer.call("stop")
  await settle(8)
  var observer_stopped := native(observer)
  check(after_multi_stop == 1 and observer_stopped.stopped and observer_stopped.rootCount == 0,
    "cleanup/all-runtime-memberships-retire-with-last-surface")
  check(native(observer_surface).errors.is_empty() and native(multi).errors.is_empty(),
    "cleanup/no-runtime-errors")

  var report := {"scenario": "modal-window-stack-runtime-membership", "checks": checks,
    "observer": {"initialMembers": 1, "churn": churn},
    "multiSurface": {"bothMounted": both_mounted, "oneRemaining": one_remaining,
      "noneRemaining": none_remaining, "afterRemount": after_remount,
      "afterForeignTakeover": after_takeover, "afterForeignStop": after_foreign_stop,
      "afterMultiStop": after_multi_stop, "afterObserverStop": observer_stopped}}
  var output := FileAccess.open("res://build/modal-stack-membership-report.json", FileAccess.WRITE)
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("MODAL_STACK_MEMBERSHIP_PASSED=" + str(checks.size()) if checks.all(
    func(row: Dictionary) -> bool: return row.passed) else "MODAL_STACK_MEMBERSHIP_FAILED")
  quit(0 if checks.all(func(row: Dictionary) -> bool: return row.passed) else 1)

func _initialize() -> void: call_deferred("run_probe")
