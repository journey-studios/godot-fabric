extends SceneTree

var checks: Array[Dictionary] = []
var input_trace: Array[Dictionary] = []

func check(ok: bool, name: String, detail: Variant = null) -> void:
  checks.append({"name": name, "passed": ok, "detail": detail})
  if not ok: push_error("FABRIC_CHECK_FAILED: " + name)

func settle(frames: int = 8) -> void:
  for index in range(frames): await process_frame

func snapshot(target: Object) -> Dictionary:
  if target == null or not is_instance_valid(target): return {"missing": true}
  var parsed: Variant = JSON.parse_string(target.call("snapshot"))
  return parsed if parsed is Dictionary else {"unparsed": true}

func react_state(app: Object) -> Dictionary:
  var parsed: Variant = JSON.parse_string(app.call("evaluate", "JSON.stringify(ModalWheelProbe.snapshot())"))
  return parsed if parsed is Dictionary else {"unparsed": true}

func node_in(surface_state: Dictionary, test_id: String) -> Dictionary:
  for node: Dictionary in surface_state.get("nodes", []):
    if node.get("testID") == test_id: return node
  return {}

func counters_clean(state: Dictionary) -> bool:
  if not state.get("stopped", false) or int(state.get("rootCount", -1)) != 0 or not state.get("errors", []).is_empty():
    return false
  for field in ["pendingTimers", "pendingAnimationFrames", "pendingRootRetirements", "pendingWork", "modalRuntimeMembers"]:
    if int(state.get(field, -1)) != 0: return false
  for field in ["hostPhasePending", "windowListener", "pointerListenerQueryInstalled"]:
    if state.get(field, true): return false
  if int(state.get("pointerListenerQuerySuppressed", -1)) != 0: return false
  var routing: Dictionary = state.get("pointerRouting", {})
  for field in ["active", "contacts", "hoverPointers", "stored", "suppressed"]:
    if int(routing.get(field, -1)) != 0: return false
  var processor: Dictionary = state.get("pointerProcessor", {})
  for field in ["active", "activeCapture", "pendingCapture", "hover"]:
    if int(processor.get(field, -1)) != 0: return false
  return true

func surface_clean(state: Dictionary) -> bool:
  if not state.get("applicationStopped", false) or not counters_clean(state): return false
  if int(state.get("nativeTags", -1)) != 0 or int(state.get("retiringTags", -1)) != 0: return false
  var pointer: Dictionary = state.get("pointer", {})
  for field in ["activePointers", "activeTouches", "takenPointers", "responder", "hoverPointers"]:
    if int(pointer.get(field, -1)) != 0: return false
  return not pointer.get("blockNative", true)

func native_control(surface_state: Dictionary, test_id: String) -> Control:
  var node := node_in(surface_state, test_id)
  return instance_from_id(int(node.get("id", 0))) as Control if not node.is_empty() else null

func modal_window(surface_state: Dictionary, test_id: String) -> Window:
  var node := node_in(surface_state, test_id)
  if node.is_empty(): return null
  return instance_from_id(int(node.get("modalWindow", {}).get("id", 0))) as Window

func make_app(owner: Window, prefix: String, position: Vector2, size: Vector2) -> Array:
  var app: Node = ClassDB.instantiate("FabricApplication")
  app.name = prefix + "Application"
  app.set("bundle_path", "res://build/scroll-view-modal-probe.js")
  owner.add_child(app)
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = prefix + "Surface"
  surface.position = position
  surface.size = size
  surface.set("application_path", NodePath("../" + app.name))
  surface.set("component_name", "ModalWheelProbe")
  owner.add_child(surface)
  return [app, surface]

func wheel(owner: Window, target_window_id: int, point: Vector2, button: MouseButton, factor: float, label: String) -> void:
  var event := InputEventMouseButton.new()
  event.device = 4242
  event.button_index = button
  event.factor = factor
  event.position = point
  event.pressed = true
  input_trace.append({"label": label, "ownerWindowId": owner.get_instance_id(), "targetWindowId": target_window_id, "button": button,
    "factor": factor, "position": [point.x, point.y], "path": "Window.push_input"})
  owner.push_input(event, true)

func click(owner: Window, target: Control) -> void:
  var down := InputEventMouseButton.new()
  down.device = 4242
  down.button_index = MOUSE_BUTTON_LEFT
  down.position = target.get_global_rect().get_center()
  down.pressed = true
  owner.push_input(down, true)
  await settle(3)
  var up := down.duplicate() as InputEventMouseButton
  up.pressed = false
  owner.push_input(up, true)
  await settle(8)

func pan(owner: Window, target: Control) -> void:
  var origin := target.get_global_rect().get_center()
  var down := InputEventMouseButton.new()
  down.device = 4242
  down.button_index = MOUSE_BUTTON_LEFT
  down.position = origin
  down.pressed = true
  owner.push_input(down, true)
  await settle(2)
  for index in range(1, 5):
    var move := InputEventMouseMotion.new()
    move.device = 4242
    move.position = origin + Vector2(0, -60.0 * float(index) / 4.0)
    move.relative = Vector2(0, -15)
    move.button_mask = MOUSE_BUTTON_MASK_LEFT
    owner.push_input(move, true)
    await settle(2)
  var up := down.duplicate() as InputEventMouseButton
  up.position = origin + Vector2(0, -60)
  up.pressed = false
  owner.push_input(up, true)
  await settle(24)

func run_probe() -> void:
  root.size = Vector2i(640, 480)
  root.position = Vector2i(37, 29)
  var pair_a := make_app(root, "OwnerA", Vector2(35, 42), Vector2(250, 180))
  var app_a: Node = pair_a[0]
  var surface_a: Control = pair_a[1]

  var owner_b := Window.new()
  owner_b.name = "IndependentNativeOwnerB"
  owner_b.visible = false
  owner_b.force_native = true
  owner_b.content_scale_mode = root.content_scale_mode
  owner_b.position = Vector2i(520, 80)
  owner_b.size = Vector2i(360, 280)
  root.add_child(owner_b)
  owner_b.visible = true
  await settle(4)
  var pair_b := make_app(owner_b, "OwnerB", Vector2(46, 38), Vector2(210, 150))
  var app_b: Node = pair_b[0]
  var surface_b: Control = pair_b[1]
  await settle(48)

  var initial_a := snapshot(surface_a)
  var initial_b := snapshot(surface_b)
  var window_a := modal_window(initial_a, "probe-modal")
  var window_b := modal_window(initial_b, "probe-modal")
  var root_v := native_control(initial_a, "probe-root-vertical")
  var root_h := native_control(initial_a, "probe-root-horizontal")
  var modal_v := native_control(initial_a, "probe-modal-vertical")
  var modal_h := native_control(initial_a, "probe-modal-horizontal")
  var modal_b_v := native_control(initial_b, "probe-modal-vertical")
  var initial_root_v: Dictionary = node_in(initial_a, "probe-root-vertical").get("scroll", {})
  var initial_root_h: Dictionary = node_in(initial_a, "probe-root-horizontal").get("scroll", {})
  var initial_modal_v: Dictionary = node_in(initial_a, "probe-modal-vertical").get("scroll", {})
  var initial_modal_h: Dictionary = node_in(initial_a, "probe-modal-horizontal").get("scroll", {})
  var initial_b_modal: Dictionary = node_in(initial_b, "probe-modal-vertical").get("scroll", {})
  check(window_a != null and window_b != null and window_a != window_b and window_a.is_embedded() and window_a.is_exclusive() and
      window_b.is_embedded() and window_b.is_exclusive() and window_a.get_parent() == root and window_b.get_parent() == owner_b and
      Vector2(window_a.size) == root.get_visible_rect().size and Vector2(window_b.size) == owner_b.get_visible_rect().size,
    "setup/two original RN Modals have independent owner Windows", {"host": root.size, "surfaceA": surface_a.size,
      "modalA": window_a.size if window_a != null else Vector2i.ZERO, "ownerB": owner_b.size,
      "modalB": window_b.size if window_b != null else Vector2i.ZERO})
  check(root_v != null and root_h != null and modal_v != null and modal_h != null and modal_b_v != null and
      float(initial_root_v.get("maxY", 0)) > 100 and float(initial_root_h.get("maxX", 0)) > 100 and
      float(initial_modal_v.get("maxY", 0)) > 100 and float(initial_modal_h.get("maxX", 0)) > 100 and
      float(initial_b_modal.get("maxY", 0)) > 100,
    "setup/all root and Modal ScrollViews have real overflow", {"rootV": initial_root_v, "rootH": initial_root_h,
      "modalV": initial_modal_v, "modalH": initial_modal_h, "otherWindowModalV": initial_b_modal})

  var signal_events: Array[Dictionary] = []

  app_a.call("evaluate", "ModalWheelProbe.setVisible(false)")
  await settle(12)
  if root_v != null: wheel(root, 0, root_v.get_global_rect().get_center(), MOUSE_BUTTON_WHEEL_DOWN, 1.25, "root-down-control")
  await settle()
  if root_h != null: wheel(root, 0, root_h.get_global_rect().get_center(), MOUSE_BUTTON_WHEEL_RIGHT, 0.5, "root-right-control")
  await settle()
  var after_root_controls := snapshot(surface_a)
  var root_v_control: Dictionary = node_in(after_root_controls, "probe-root-vertical").get("scroll", {})
  var root_h_control: Dictionary = node_in(after_root_controls, "probe-root-horizontal").get("scroll", {})
  check(is_equal_approx(float(root_v_control.get("y", -1)), 60.0) and
      is_equal_approx(float(root_h_control.get("x", -1)), 24.0),
    "control/Surface root wheel scrolls vertical and horizontal axes by 48 times factor",
    {"rootVertical": root_v_control, "rootHorizontal": root_h_control})
  app_a.call("evaluate", "ModalWheelProbe.setVisible(true)")
  await settle(24)
  initial_a = snapshot(surface_a)
  window_a = modal_window(initial_a, "probe-modal")
  modal_v = native_control(initial_a, "probe-modal-vertical")
  modal_h = native_control(initial_a, "probe-modal-horizontal")

  var action := native_control(snapshot(surface_a), "probe-modal-vertical-action")
  if window_a != null and action != null: await click(root, action)
  var after_click := react_state(app_a)
  check(int(after_click.get("clicks", -1)) == 1,
    "control/Modal Window still routes a non-wheel click to the original RN Pressable", after_click)
  if window_a != null and modal_v != null: await pan(root, modal_v)
  var after_pan_snapshot := snapshot(surface_a)
  var after_pan: Dictionary = node_in(after_pan_snapshot, "probe-modal-vertical").get("scroll", {})
  check(float(after_pan.get("y", 0)) > 20 and int(after_pan.get("begins", 0)) >= int(initial_modal_v.get("begins", 0)) + 1 and
      int(after_pan.get("ends", 0)) >= int(initial_modal_v.get("ends", 0)) + 1,
    "control/owner Window routes a non-wheel native pan into the original RN ScrollView", after_pan)
  app_a.call("evaluate", "ModalWheelProbe.resetModalOffsets()")
  await settle(4)
  var reset_modal := snapshot(surface_a)
  var reset_modal_v: Dictionary = node_in(reset_modal, "probe-modal-vertical").get("scroll", {})
  var reset_modal_h: Dictionary = node_in(reset_modal, "probe-modal-horizontal").get("scroll", {})
  window_a = modal_window(reset_modal, "probe-modal")
  if window_a != null:
    var observed_modal_window_id := window_a.get_instance_id()
    window_a.window_input.connect(func(event: InputEvent) -> void:
      if event is InputEventMouseButton and event.button_index >= MOUSE_BUTTON_WHEEL_UP and event.button_index <= MOUSE_BUTTON_WHEEL_RIGHT:
        signal_events.append({"windowId": observed_modal_window_id, "button": event.button_index, "factor": event.factor, "pressed": event.pressed,
          "position": [event.position.x, event.position.y]})
    )
  check(is_zero_approx(float(reset_modal_v.get("y", -1))) and is_zero_approx(float(reset_modal_h.get("x", -1))) and
      is_zero_approx(float(reset_modal_v.get("motion", -1))) and is_zero_approx(float(reset_modal_h.get("motion", -1))),
    "setup/public original RN scrollTo instantaneously resets both Modal controls before wheel measurements",
    {"vertical": reset_modal_v, "horizontal": reset_modal_h})
  var root_before_modal_wheel := snapshot(surface_a)
  var b_before_modal_wheel := snapshot(surface_b)
  var initial_a_v: Dictionary = node_in(root_before_modal_wheel, "probe-modal-vertical").get("scroll", {})
  var initial_a_h: Dictionary = node_in(root_before_modal_wheel, "probe-modal-horizontal").get("scroll", {})
  var root_before_v: Dictionary = node_in(root_before_modal_wheel, "probe-root-vertical").get("scroll", {})
  var root_before_h: Dictionary = node_in(root_before_modal_wheel, "probe-root-horizontal").get("scroll", {})
  var b_before_v: Dictionary = node_in(b_before_modal_wheel, "probe-modal-vertical").get("scroll", {})
  var modal_a_window_id := window_a.get_instance_id() if window_a != null else 0
  var modal_b_window_id := window_b.get_instance_id() if window_b != null else 0
  if window_a != null and modal_v != null:
    wheel(root, modal_a_window_id, modal_v.get_global_rect().get_center(), MOUSE_BUTTON_WHEEL_DOWN, 1.5, "modal-down-factor-1.5")
    await settle()
  var after_down := snapshot(surface_a)
  var after_down_v: Dictionary = node_in(after_down, "probe-modal-vertical").get("scroll", {})
  check(is_equal_approx(float(after_down_v.get("y", -1)), float(initial_a_v.get("y", 0)) + 72.0),
    "modal/down wheel applies 48 times its factor through Window.window_input", {"before": initial_a_v,
      "after": after_down_v, "signalEvents": signal_events.duplicate()})
  if window_a != null and modal_v != null:
    wheel(root, modal_a_window_id, modal_v.get_global_rect().get_center(), MOUSE_BUTTON_WHEEL_UP, 0.5, "modal-up-factor-0.5")
    await settle()
  var after_up := snapshot(surface_a)
  var after_up_v: Dictionary = node_in(after_up, "probe-modal-vertical").get("scroll", {})
  check(is_equal_approx(float(after_up_v.get("y", -1)), float(initial_a_v.get("y", 0)) + 48.0),
    "modal/up wheel reverses direction and retains fractional factor", {"before": initial_a_v, "after": after_up_v})
  if window_a != null and modal_h != null:
    wheel(root, modal_a_window_id, modal_h.get_global_rect().get_center(), MOUSE_BUTTON_WHEEL_RIGHT, 1.5, "modal-right-factor-1.5")
    await settle()
  var after_right := snapshot(surface_a)
  var after_right_h: Dictionary = node_in(after_right, "probe-modal-horizontal").get("scroll", {})
  check(is_equal_approx(float(after_right_h.get("x", -1)), float(initial_a_h.get("x", 0)) + 72.0),
    "modal/right wheel scrolls the horizontal ScrollView with factor", {"before": initial_a_h, "after": after_right_h})
  if window_a != null and modal_h != null:
    wheel(root, modal_a_window_id, modal_h.get_global_rect().get_center(), MOUSE_BUTTON_WHEEL_LEFT, 0.5, "modal-left-factor-0.5")
    await settle()
  var after_left := snapshot(surface_a)
  var after_left_h: Dictionary = node_in(after_left, "probe-modal-horizontal").get("scroll", {})
  check(is_equal_approx(float(after_left_h.get("x", -1)), float(initial_a_h.get("x", 0)) + 48.0),
    "modal/left wheel reverses horizontal direction", {"before": initial_a_h, "after": after_left_h})

  var root_after_modal_wheel := snapshot(surface_a)
  var b_after_modal_wheel := snapshot(surface_b)
  var root_after_v: Dictionary = node_in(root_after_modal_wheel, "probe-root-vertical").get("scroll", {})
  var root_after_h: Dictionary = node_in(root_after_modal_wheel, "probe-root-horizontal").get("scroll", {})
  var b_after_v: Dictionary = node_in(b_after_modal_wheel, "probe-modal-vertical").get("scroll", {})
  check(is_equal_approx(float(root_after_v.get("y", -1)), float(root_before_v.get("y", -2))) and
      is_equal_approx(float(root_after_h.get("x", -1)), float(root_before_h.get("x", -2))) and
      is_equal_approx(float(b_after_v.get("y", -1)), float(b_before_v.get("y", -2))),
    "modal wheel leaves its background root and independent otherWindow unchanged",
    {"rootBefore": [root_before_v, root_before_h], "rootAfter": [root_after_v, root_after_h],
      "otherWindowBefore": b_before_v, "otherWindowAfter": b_after_v})
  check(signal_events.size() == 4 and signal_events.map(func(row: Dictionary) -> int: return row.button) ==
      [MOUSE_BUTTON_WHEEL_DOWN, MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_RIGHT, MOUSE_BUTTON_WHEEL_LEFT] and
      is_equal_approx(float(signal_events[0].factor), 1.5) and is_equal_approx(float(signal_events[1].factor), 0.5) and
      is_equal_approx(float(signal_events[2].factor), 1.5) and is_equal_approx(float(signal_events[3].factor), 0.5) and
      signal_events.all(func(row: Dictionary) -> bool: return row.pressed),
    "observation/four modal wheels reach the current Modal Window.window_input with exact direction and factor", signal_events)

  var app_a_stop_before := snapshot(app_a)
  var app_b_stop_before := snapshot(app_b)
  app_a.call("stop")
  app_b.call("stop")
  await settle(24)
  var app_a_after_stop := snapshot(app_a)
  var app_b_after_stop := snapshot(app_b)
  var surface_a_after_stop := snapshot(surface_a)
  var surface_b_after_stop := snapshot(surface_b)
  var modal_windows_released := instance_from_id(modal_a_window_id) == null and instance_from_id(modal_b_window_id) == null
  check(counters_clean(app_a_after_stop) and counters_clean(app_b_after_stop) and
      surface_clean(surface_a_after_stop) and surface_clean(surface_b_after_stop) and modal_windows_released,
    "cleanup/both owner runtimes, Modal windows, surfaces, pointers, timers, and tags are released",
    {"A": app_a_after_stop, "B": app_b_after_stop, "surfaceA": surface_a_after_stop,
      "surfaceB": surface_b_after_stop, "modalWindowsReleased": modal_windows_released})

  var failures := checks.filter(func(row: Dictionary) -> bool: return not row.passed)
  var report := {"scenario": "scroll-view-modal-wheel-routing",
    "reactNative": "0.87.1", "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(),
    "hostSize": root.size, "surfaceA": {"position": surface_a.position, "size": surface_a.size},
    "independentOwnerB": {"position": owner_b.position, "size": owner_b.size},
    "checks": checks, "inputs": input_trace, "windowInputEvents": signal_events,
    "modalWindowIds": [modal_a_window_id, modal_b_window_id], "ownerWindowIds": [root.get_instance_id(), owner_b.get_instance_id()],
    "stages": {"initialA": initial_a, "initialB": initial_b, "afterRootControls": after_root_controls,
      "afterClick": after_click, "afterPan": after_pan_snapshot, "rootBeforeModalWheel": root_before_modal_wheel,
      "afterPublicReset": reset_modal,
      "afterModalDown": after_down, "afterModalUp": after_up, "afterModalRight": after_right,
      "afterModalLeft": after_left, "rootAfterModalWheel": root_after_modal_wheel,
      "otherWindowAfterModalWheel": b_after_modal_wheel, "appAStopBefore": app_a_stop_before,
      "appBStopBefore": app_b_stop_before, "appAAfterStop": app_a_after_stop, "appBAfterStop": app_b_after_stop,
      "surfaceAAfterStop": surface_a_after_stop, "surfaceBAfterStop": surface_b_after_stop,
      "modalWindowsReleased": modal_windows_released},
    "allAssertionsPassed": failures.is_empty(), "scope": {"originalRNModal": true, "originalRNScrollView": true,
      "actualWindowInputSignal": true, "mobile": false}}
  var output := FileAccess.open("res://build/scroll-view-modal-report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_CHECK_FAILED: report is writable")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("SCROLL_VIEW_MODAL_REPORT=" + ("PASS" if failures.is_empty() else "FAIL") + " checks=" + str(checks.size()))
  quit(0 if failures.is_empty() else 1)

func _initialize() -> void:
  call_deferred("run_probe")
