extends SceneTree

var application: Node
var surface: Control
var checks: Array = []
var stages: Dictionary = {}
var reentrant_show := {"enabled": false, "triggered": false}

func check(condition: bool, name: String) -> void:
  checks.append({"id": name, "name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)

func settle(frames: int = 12) -> void:
  for index in range(frames):
    await process_frame

func native(target: Object) -> Dictionary:
  var parsed: Variant = JSON.parse_string(target.call("snapshot"))
  return parsed if parsed is Dictionary else {}

func react_state() -> Dictionary:
  return state_from(application, "ModalHostProbe")

func state_from(owner: Object, component: String) -> Dictionary:
  var parsed: Variant = JSON.parse_string(owner.call("evaluate", "JSON.stringify(" + component + ".snapshot())"))
  return parsed if parsed is Dictionary else {}

func by_test_id(snapshot: Dictionary, test_id: String) -> Dictionary:
  for node: Dictionary in snapshot.get("nodes", []):
    if node.get("testID") == test_id:
      return node
  return {}

func _initialize() -> void:
  call_deferred("run_probe")

func run_probe() -> void:
  root.size = Vector2i(420, 320)
  root.position = Vector2i(73, 41)
  root.content_scale_factor = 1.5
  var host_size := root.get_visible_rect().size
  root.child_entered_tree.connect(func(child: Node) -> void:
    if child is Window and child != root:
      var modal_window := child as Window
      modal_window.visibility_changed.connect(func() -> void:
        if reentrant_show.enabled and modal_window.visible and not reentrant_show.triggered:
          reentrant_show.triggered = true
          application.call("evaluate", "ModalHostProbe.setSecondVisible(true)")
      )
  )
  application = ClassDB.instantiate("FabricApplication")
  application.name = "ModalApplication"
  application.set("bundle_path", "res://build/modal-host-probe.js")
  root.add_child(application)

  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "SmallModalRoot"
  surface.position = Vector2(32, 48)
  surface.size = Vector2(90, 70)
  surface.set("application_path", NodePath("../ModalApplication"))
  surface.set("component_name", "ModalHostProbe")
  root.add_child(surface)
  await settle()

  var app_state := native(application)
  var surface_state := native(surface)
  var modal := by_test_id(surface_state, "first-modal")
  var safe_area := by_test_id(surface_state, "modal-safe-area")
  var title := by_test_id(surface_state, "modal-title")
  var input := by_test_id(surface_state, "modal-input")
  var modal_pressable := by_test_id(surface_state, "modal-pressable")
  var action := by_test_id(surface_state, "modal-action")
  var state := react_state()
  check(not modal.is_empty() and modal.kind == "modal", "mount/RN's original ModalHostView was committed")
  check(modal.modalWindow.visible and modal.modalWindow.embedded and modal.modalWindow.exclusive,
    "mount/The Modal is shown as the exclusive embedded host Window")
  check(modal.modalWindow.parentId == root.get_instance_id(),
    "mount/The Modal Window is a sibling under the native host Window")
  check(Vector2i(modal.modalWindow.width, modal.modalWindow.height) == Vector2i(host_size),
    "layout/The original Modal fills the host Window despite its smaller FabricSurface")
  check(Vector2(modal.fabricWidth, modal.fabricHeight) == host_size,
    "layout/RN's original ModalHostView state sizes its Yoga node to the host Window")
  check(not safe_area.is_empty() and safe_area.kind == "view" and safe_area.component == "SafeAreaView" and not title.is_empty()
      and title.nativeText == "Modal contents",
    "children/RN's SafeAreaView mounts as Godot's View control and its RN content")
  check(not input.is_empty() and input.nativeText == "first" and input.editable,
    "children/The public TextInput adapter is a live editable native LineEdit inside the Modal")
  check(not action.is_empty() and action.kind == "button" and action.nativeText == "Modal action",
    "children/The Modal can contain a live Godot Button")
  check(int(state.shows) == 1 and int(state.mounts) == 1,
    "events/onShow fires once after the original Modal content is mounted")
  var initial_layouts: Array = state.get("layouts", [])
  var initial_layout: Dictionary = initial_layouts[0] if not initial_layouts.is_empty() else {}
  check(not initial_layout.is_empty() and is_equal_approx(float(initial_layout.width), host_size.x) and
      is_equal_approx(float(initial_layout.height), host_size.y),
    "layout/The first RN onLayout reports host dimensions instead of an initial zero-sized Modal")
  var measurements: Array = state.get("measurements", [])
  var initial_measurement: Dictionary = measurements[0] if not measurements.is_empty() else {}
  check(not initial_measurement.is_empty() and float(initial_measurement.x) == 0.0 and
      float(initial_measurement.y) == 0.0 and is_equal_approx(float(initial_measurement.width), host_size.x) and
      is_equal_approx(float(initial_measurement.height), host_size.y),
    "geometry/measureInWindow uses the Modal physical root, excluding its offset Surface")
  var zero_node := root.find_child("background-zero", true, false) as Control
  var modal_zero_node := root.find_child("modal-zero", true, false) as Control
  var zero_measurements: Array = state.get("zeroMeasurements", [])
  var zero_measurement: Dictionary = zero_measurements[0] if not zero_measurements.is_empty() else {}
  var modal_zero_measurements: Array = state.get("modalZeroMeasurements", [])
  var modal_zero_measurement: Dictionary = modal_zero_measurements[0] if not modal_zero_measurements.is_empty() else {}
  check(zero_node != null and not zero_measurement.is_empty() and
      float(zero_measurement.width) == 0.0 and float(zero_measurement.height) == 0.0 and
      is_equal_approx(float(zero_measurement.x), zero_node.get_global_rect().position.x) and
      is_equal_approx(float(zero_measurement.y), zero_node.get_global_rect().position.y),
    "geometry/An offset 0×0 View outside the Modal still projects through the FabricSurface")
  check(modal_zero_node != null and not modal_zero_measurement.is_empty() and
      float(modal_zero_measurement.width) == 0.0 and float(modal_zero_measurement.height) == 0.0 and
      is_equal_approx(float(modal_zero_measurement.x), modal_zero_node.get_global_rect().position.x) and
      is_equal_approx(float(modal_zero_measurement.y), modal_zero_node.get_global_rect().position.y),
    "geometry/An offset 0×0 View inside the Modal still projects through its physical Window")
  var hidden_measurements: Array = state.get("hiddenMeasurements", [])
  var hidden_measurement: Dictionary = hidden_measurements[0] if not hidden_measurements.is_empty() else {}
  check(not hidden_measurement.is_empty() and float(hidden_measurement.x) == 0.0 and
      float(hidden_measurement.y) == 0.0 and float(hidden_measurement.width) == 0.0 and
      float(hidden_measurement.height) == 0.0,
    "geometry/display:none remains distinct from a connected zero-sized layout")
  application.call("evaluate", "ModalHostProbe.setShowZero(false)")
  await settle(4)
  var zero_removed := root.find_child("background-zero", true, false) == null
  var zero_hidden_state := react_state()
  application.call("evaluate", "ModalHostProbe.measureRetainedZero()")
  await settle(2)
  var stale_state := react_state()
  var stale_measurements: Array = stale_state.get("staleMeasurements", [])
  var stale_measurement: Dictionary = stale_measurements.back() if not stale_measurements.is_empty() else {}
  check(zero_removed and bool(stale_state.get("retainedZeroRef", false)) and
      stale_state.get("retainedZeroConnected", true) == false and stale_measurements.is_empty(),
    "geometry/a retained public ref is disconnected after unmount and skips native measurement")
  stages.zeroGeometry = {"removed": zero_removed, "state": zero_hidden_state,
    "staleMeasurements": stale_measurements}
  application.call("evaluate", "ModalHostProbe.setShowZero(true)")
  await settle(4)
  check(surface_state.viewport.width == 90 and surface_state.viewport.height == 70,
    "layout/The React root keeps its independently constrained size")
  check(app_state.errors.is_empty(), "runtime/The first Modal presentation reports no native or RN errors")
  stages.mount = {"application": app_state, "surface": surface_state, "react": state,
    "hostWindow": {"id": root.get_instance_id(), "size": host_size}}

  var line_edit := root.find_child("modal-input", true, false) as LineEdit
  var modal_button := root.find_child("modal-action", true, false) as Button
  var modal_pressable_control := root.find_child("modal-pressable", true, false) as Control
  check(line_edit != null and modal_button != null,
    "input/The committed public TextInput adapter and Modal Button are reachable native controls")
  if line_edit != null:
    line_edit.grab_focus()
    line_edit.set_caret_column(line_edit.get_text().length())
    var character := InputEventKey.new()
    character.keycode = KEY_X
    character.unicode = 120
    character.pressed = true
    root.push_input(character, true)
    await settle(8)
  var typed := react_state()
  check(typed.value == "firstx" and typed.changes == ["firstx"],
    "input/A native key event edits the controlled public TextInput adapter")
  if modal_button != null:
    var click := InputEventMouseButton.new()
    click.button_index = MOUSE_BUTTON_LEFT
    click.position = modal_button.get_global_rect().get_center()
    click.pressed = true
    root.push_input(click, true)
    click.pressed = false
    root.push_input(click, true)
    await settle(8)
  var clicked := react_state()
  check(int(clicked.buttonClicks) == 1,
    "input/A pointer click activates the public Button adapter inside the Modal")
  if modal_pressable_control != null:
    var pressable_down := InputEventMouseButton.new()
    pressable_down.button_index = MOUSE_BUTTON_LEFT
    pressable_down.position = modal_pressable_control.get_global_rect().get_center()
    pressable_down.pressed = true
    root.push_input(pressable_down, true)
    await settle(4)
    var captured_move := InputEventMouseMotion.new()
    captured_move.position = modal_pressable_control.get_global_rect().position + Vector2(205, 20)
    captured_move.button_mask = MOUSE_BUTTON_MASK_LEFT
    root.push_input(captured_move, true)
    await settle(3)
    var captured_return := InputEventMouseMotion.new()
    captured_return.position = pressable_down.position
    captured_return.button_mask = MOUSE_BUTTON_MASK_LEFT
    root.push_input(captured_return, true)
    await settle(2)
    var pressable_up := pressable_down.duplicate() as InputEventMouseButton
    pressable_up.pressed = false
    pressable_up.position = captured_return.position
    root.push_input(pressable_up, true)
    await create_timer(0.2).timeout
    await settle(2)
  var modal_pointer_state := react_state()
  check(int(modal_pointer_state.modalPointerDowns) == 1,
    "input/RN Pressable inside the Modal receives pointer input in its physical Window")
  var content_transform := root.get_final_transform() * root.get_global_canvas_transform().affine_inverse()
  var density := content_transform.get_scale().x
  var modal_window: Window
  for child: Node in root.get_children():
    if child is Window and child != root and child.visible:
      modal_window = child as Window
  var expected_screen := Vector2.ZERO
  if modal_pressable_control != null and modal_window != null and density > 0:
    var viewport_point := modal_pressable_control.get_global_rect().get_center()
    expected_screen = (Vector2(root.position) + modal_window.get_screen_transform() * viewport_point) / density
  var modal_screen: Array = modal_pointer_state.get("modalPointerScreen", [])
  check(int(modal_pointer_state.modalPressIns) == 2 and int(modal_pointer_state.modalPressOuts) == 2 and
      int(modal_pointer_state.modalPresses) == 1,
    "input/RN Pressability exits and re-enters during capture before one successful Press")
  check(int(modal_pointer_state.modalPointerCaptureGots) == 1 and
      int(modal_pointer_state.modalPointerCaptureLosts) == 1 and
      bool(modal_pointer_state.modalCaptureRequested) and
      bool(modal_pointer_state.modalCapturePresentOnGot) and
      not bool(modal_pointer_state.modalCapturePresentOnLost) and
      int(modal_pointer_state.modalCapturedMoves) >= 1 and int(modal_pointer_state.modalCapturedUps) == 1,
    "capture/The public Pressable captures its pointer, receives an outside move, and releases on Up")
  check(root.position != Vector2i.ZERO and density > 1.0 and modal_window != null and
      modal_screen.size() == 2 and is_equal_approx(float(modal_screen[0]), expected_screen.x) and
      is_equal_approx(float(modal_screen[1]), expected_screen.y),
    "geometry/Modal screen coordinates include the nonzero host origin and owner content scale")
  check(int(modal_pointer_state.modalAncestorMoves) > int(clicked.modalAncestorMoves) and
      int(modal_pointer_state.modalAncestorUps) == int(clicked.modalAncestorUps) + 1,
    "routing/Pointer events from a Modal child still bubble to its logical parent outside the physical Window")
  check(int(modal_pointer_state.modalAncestorCaptureGots) == int(clicked.modalAncestorCaptureGots) + 1 and
      int(modal_pointer_state.modalAncestorCaptureLosts) == int(clicked.modalAncestorCaptureLosts) + 1,
    "routing/Capture notifications from a Modal child still bubble to its logical parent")
  print("MODAL_LOGICAL_ANCESTOR_TRACE=" + JSON.stringify({"moves": modal_pointer_state.modalAncestorMoves,
    "ups": modal_pointer_state.modalAncestorUps}))
  var background_button := root.find_child("background-action", true, false) as Button
  if background_button != null:
    var background_click := InputEventMouseButton.new()
    background_click.button_index = MOUSE_BUTTON_LEFT
    background_click.position = background_button.get_global_rect().get_center()
    background_click.pressed = true
    root.push_input(background_click, true)
    background_click.pressed = false
    root.push_input(background_click, true)
    await settle(4)
  var blocked := react_state()
  check(int(blocked.backgroundClicks) == 0,
    "input/The exclusive Modal blocks a click on the background Button")
  stages.controls = {"typed": typed, "clicked": clicked, "blocked": blocked,
    "modalPointer": modal_pointer_state}

  var escape := InputEventKey.new()
  escape.keycode = KEY_ESCAPE
  escape.pressed = true
  root.push_input(escape, true)
  await settle(4)
  var close_state := react_state()
  var close_surface := native(surface)
  check(int(close_state.closes) == 1 and bool(close_state.visible),
    "input/Escape invokes the original onRequestClose without changing JS visible state")
  check(by_test_id(close_surface, "first-modal").modalWindow.visible,
    "input/onRequestClose leaves dismissal under the original JS component's control")
  stages.escape = {"react": close_state, "surface": close_surface}

  root.size = Vector2i(500, 350)
  host_size = root.get_visible_rect().size
  await settle(16)
  var resized := native(surface)
  var resized_modal := by_test_id(resized, "first-modal")
  var resized_react := react_state()
  var resize_layouts: Array = resized_react.get("layouts", [])
  var final_layout: Dictionary = resize_layouts.back() if not resize_layouts.is_empty() else {}
  check(Vector2i(resized_modal.modalWindow.width, resized_modal.modalWindow.height) == Vector2i(host_size),
    "resize/The mounted presentation Window follows the host Window")
  check(Vector2(resized_modal.fabricWidth, resized_modal.fabricHeight) == host_size,
    "resize/RN's ModalHostView StateUpdate relayouts the original Yoga node")
  check(not final_layout.is_empty() and is_equal_approx(float(final_layout.width), host_size.x) and
      is_equal_approx(float(final_layout.height), host_size.y),
    "resize/RN onLayout reports the new host dimensions")
  var resized_measurements: Array = resized_react.get("measurements", [])
  var resized_measurement: Dictionary = resized_measurements.back() if not resized_measurements.is_empty() else {}
  check(not resized_measurement.is_empty() and float(resized_measurement.x) == 0.0 and
      float(resized_measurement.y) == 0.0 and is_equal_approx(float(resized_measurement.width), host_size.x) and
      is_equal_approx(float(resized_measurement.height), host_size.y),
    "resize/measureInWindow keeps the Modal physical coordinate origin")
  check(resized.viewport.width == 90 and resized.viewport.height == 70,
    "resize/The independently constrained FabricSurface stays smaller than its host Window")
  stages.resize = {"surface": resized, "hostWindow": host_size}

  application.call("evaluate", "ModalHostProbe.setVisible(false)")
  await settle(12)
  var hidden := native(surface)
  var hidden_state := react_state()
  check(by_test_id(hidden, "first-modal").is_empty() and hidden_state.visible == false,
    "props/visible=false removes the original Modal presentation")
  var background_pressable_control := root.find_child("background-pressable", true, false) as Control
  if background_pressable_control != null:
    var background_down := InputEventMouseButton.new()
    background_down.button_index = MOUSE_BUTTON_LEFT
    background_down.position = background_pressable_control.get_global_rect().get_center()
    background_down.pressed = true
    root.push_input(background_down, true)
    background_down.pressed = false
    root.push_input(background_down, true)
    await settle(4)
  var background_pointer_state := react_state()
  check(int(background_pointer_state.backgroundPointerDowns) == 1,
    "input/Hiding the Modal restores pointer input to the background RN Pressable")
  check(int(background_pointer_state.backgroundPresses) == 1,
    "input/Background RN Pressability receives its restored click")
  application.call("evaluate", "ModalHostProbe.setVisible(true)")
  await settle(16)
  var shown := native(surface)
  var shown_modal := by_test_id(shown, "first-modal")
  var shown_state := react_state()
  check(shown_modal.modalWindow.visible and
      Vector2i(shown_modal.modalWindow.width, shown_modal.modalWindow.height) == Vector2i(host_size),
    "props/visible=true creates a fresh host-sized Modal after resize")
  check(int(shown_state.shows) == 2 and shown_modal.modalWindow.id != modal.modalWindow.id,
    "events/each actual presentation fires onShow once with a new native Window")
  stages.visibility = {"hidden": hidden, "shown": shown, "react": shown_state}

  reentrant_show.enabled = true
  application.call("evaluate", "ModalHostProbe.setVisible(false)")
  await settle(12)
  application.call("evaluate", "ModalHostProbe.setVisible(true)")
  await settle(16)
  var reentrant_state := react_state()
  var reentrant_surface := native(surface)
  var reentrant_first := by_test_id(reentrant_surface, "first-modal")
  var reentrant_second := by_test_id(reentrant_surface, "second-modal")
  var show_order: Array = reentrant_state.get("showOrder", [])
  check(reentrant_show.triggered and int(reentrant_state.shows) == 3 and
      int(reentrant_state.secondShows) == 1 and show_order.size() >= 2 and
      show_order[show_order.size() - 2] == "first" and show_order.back() == "second",
    "events/A visibility callback can schedule a second RN Modal presentation in order")
  check(reentrant_first.modalWindow.visible and not reentrant_first.modalWindow.exclusive and
      reentrant_second.modalWindow.visible and reentrant_second.modalWindow.exclusive,
    "stack/A remains presented while the reentrant second Modal becomes the exclusive top")
  check(int(reentrant_second.modalWindow.parentId) == root.get_instance_id() and
      int(reentrant_second.modalWindow.id) != int(reentrant_first.modalWindow.id),
    "embedding/Logically nested Modals use sibling Windows under their common owner")
  var nested_measurements: Array = reentrant_state.get("nestedMeasurements", [])
  var nested_measurement: Dictionary = nested_measurements.back() if not nested_measurements.is_empty() else {}
  check(not nested_measurement.is_empty() and float(nested_measurement.x) == 0.0 and
      float(nested_measurement.y) == 0.0 and is_equal_approx(float(nested_measurement.width), host_size.x) and
      is_equal_approx(float(nested_measurement.height), host_size.y),
    "geometry/A nested Modal measures against its own physical Window, not the offset FabricSurface")
  var nested_pressable := root.find_child("second-modal-pressable", true, false) as Control
  if nested_pressable != null:
    var nested_down := InputEventMouseButton.new()
    nested_down.button_index = MOUSE_BUTTON_LEFT
    nested_down.position = nested_pressable.get_global_rect().get_center()
    nested_down.pressed = true
    root.push_input(nested_down, true)
    var nested_up := nested_down.duplicate() as InputEventMouseButton
    nested_up.pressed = false
    root.push_input(nested_up, true)
    await create_timer(0.2).timeout
  var nested_interaction := react_state()
  check(int(nested_interaction.nestedPointerDowns) == 1 and int(nested_interaction.nestedPresses) == 1,
    "input/Pressability receives a click in the logically nested top Modal's physical Window")
  stages.reentrantShow = {"react": reentrant_state, "first": reentrant_first, "second": reentrant_second,
    "nestedInteraction": nested_interaction, "signalTriggered": reentrant_show.triggered,
    "observation": "RN commits the second visible prop after the first onShow callback"}
  application.call("evaluate", "ModalHostProbe.setSecondVisible(false)")
  await settle(12)
  shown = native(surface)
  shown_modal = by_test_id(shown, "first-modal")
  shown_state = react_state()
  check(shown_modal.modalWindow.visible and shown_modal.modalWindow.exclusive,
    "stack/Hiding the reentrant top restores exclusivity to the still-visible first Modal")

  var presses_before_takeover := int(shown_state.modalPresses)
  var press_outs_before_takeover := int(shown_state.modalPressOuts)
  var pointer_cancels_before_takeover := int(shown_state.modalPointerCancels)
  var touch_cancels_before_takeover := int(shown_state.modalTouchCancels)
  var lost_captures_before_takeover := int(shown_state.modalPointerCaptureLosts)
  var lower_pressable := root.find_child("modal-pressable", true, false) as Control
  var lower_window := instance_from_id(int(shown_modal.modalWindow.id)) as Window
  var held_down := InputEventMouseButton.new()
  held_down.button_index = MOUSE_BUTTON_LEFT
  if lower_pressable != null:
    held_down.position = lower_pressable.get_global_rect().get_center()
    held_down.pressed = true
    root.push_input(held_down, true)
  await settle(2)
  application.call("evaluate", "ModalHostProbe.setSecondVisible(true)")
  await create_timer(0.2).timeout
  var takeover_state := react_state()
  var takeover_surface := native(surface)
  var takeover_first := by_test_id(takeover_surface, "first-modal")
  var takeover_second := by_test_id(takeover_surface, "second-modal")
  check(int(takeover_state.modalPointerDowns) == int(shown_state.modalPointerDowns) + 1 and
      int(takeover_state.modalPointerCancels) == pointer_cancels_before_takeover + 1 and
      int(takeover_state.modalTouchCancels) == touch_cancels_before_takeover + 1 and
      int(takeover_state.modalPointerCaptureLosts) == lost_captures_before_takeover + 1 and
      not bool(takeover_state.modalCapturePresentOnLost) and
      int(takeover_state.modalPressOuts) == press_outs_before_takeover + 1 and
      int(takeover_state.modalPresses) == presses_before_takeover,
    "input/Presenting a new top Modal delivers one cancel and PressOut to the captured lower contact")
  var held_up := held_down.duplicate() as InputEventMouseButton
  held_up.pressed = false
  if lower_window != null: lower_window.push_input(held_up, true)
  await create_timer(0.2).timeout
  var released_takeover := react_state()
  var after_takeover := native(surface)
  var takeover_first_window: Dictionary = takeover_first.get("modalWindow", {})
  var takeover_second_window: Dictionary = takeover_second.get("modalWindow", {})
  check(int(released_takeover.modalPresses) == presses_before_takeover and
      bool(takeover_first_window.get("visible", false)) and not bool(takeover_first_window.get("exclusive", true)) and
      bool(takeover_second_window.get("visible", false)) and bool(takeover_second_window.get("exclusive", false)),
    "capture/A stale lower-Window Up cannot press after the top switch, while both RN Modals remain correctly stacked")
  application.call("evaluate", "ModalHostProbe.setSecondVisible(false)")
  await settle(12)
  var restored_after_takeover := by_test_id(native(surface), "first-modal")
  check(restored_after_takeover.modalWindow.visible and restored_after_takeover.modalWindow.exclusive and
      int(native(application).pointerRouting.active) == 0,
    "capture/Hiding the top restores the lower authority with no active pointer route")
  stages.captureTakeover = {"before": shown_state, "cancelled": takeover_state,
    "released": released_takeover, "surface": after_takeover, "restored": restored_after_takeover}

  var retiring_window_id := int(shown_modal.modalWindow.id)
  var retiring_window := instance_from_id(retiring_window_id) as Window
  var input_observation := {"escapes": 0}
  check(retiring_window != null and retiring_window.visible,
    "lifecycle/The presented Modal is addressable before callback checks")
  if retiring_window != null:
    retiring_window.window_input.connect(func(event: InputEvent) -> void:
      if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE:
        input_observation.escapes += 1
    )
  var input_escape := InputEventKey.new()
  input_escape.keycode = KEY_ESCAPE
  input_escape.pressed = true
  root.push_input(input_escape, true)
  await settle(2)
  var input_state := react_state()
  check(int(input_observation.escapes) == 1 and int(input_state.closes) == 2,
    "lifecycle/The embedded Window input callback and RN onRequestClose observe Escape")

  var retirement := {"called": false}
  if retiring_window != null:
    retiring_window.visibility_changed.connect(func() -> void:
      if not retiring_window.visible and not retirement.called:
        retirement.called = true
        application.call("stop")
    )
    retiring_window.set_visible(false)
  await settle(2)
  check(bool(retirement.called),
    "lifecycle/Stopping the Fabric owner from visibility_changed retires presentation reentrantly")
  if not retirement.called:
    application.call("stop")
    await settle(2)
  var stopped := native(application)
  var final_surface := native(surface)
  check(not is_instance_valid(instance_from_id(retiring_window_id)),
    "lifecycle/The retired Window is freed after the Godot visibility callback unwinds")
  check(stopped.stopped and stopped.rootCount == 0 and final_surface.nativeTags == 0,
    "cleanup/Stopping the application retires the modal root and its native Controls")
  stages.cleanup = {"application": stopped, "surface": final_surface,
    "inputEscapes": input_observation.escapes, "ownerRetiredFromVisibilitySignal": retirement.called}

  var lower_application: Node = ClassDB.instantiate("FabricApplication")
  lower_application.name = "LowerModalApplication"
  lower_application.set("bundle_path", "res://build/modal-host-probe.js")
  root.add_child(lower_application)
  var lower_surface: Control = ClassDB.instantiate("FabricSurface")
  lower_surface.name = "LowerModalSurface"
  lower_surface.position = Vector2(20, 24)
  lower_surface.size = Vector2(120, 90)
  lower_surface.set("application_path", NodePath("../LowerModalApplication"))
  lower_surface.set("component_name", "ModalHostProbe")
  root.add_child(lower_surface)
  await settle(16)
  var lower_initial := native(lower_surface)
  var lower_modal := by_test_id(lower_initial, "first-modal")
  var lower_owner_pressable := root.find_child("modal-pressable", true, false) as Control
  check(not lower_modal.is_empty() and lower_modal.modalWindow.visible and lower_modal.modalWindow.exclusive and
      lower_owner_pressable != null,
    "owner/two Fabric runtimes present independent Modal entries under the same native Window")
  if lower_owner_pressable != null:
    var lower_down := InputEventMouseButton.new()
    lower_down.button_index = MOUSE_BUTTON_LEFT
    lower_down.position = lower_owner_pressable.get_global_rect().get_center()
    lower_down.pressed = true
    root.push_input(lower_down, true)
  await settle(4)
  var lower_contact := state_from(lower_application, "ModalHostProbe")

  var foreign_application: Node = ClassDB.instantiate("FabricApplication")
  foreign_application.name = "ForeignModalApplication"
  foreign_application.set("bundle_path", "res://build/modal-host-probe.js")
  root.add_child(foreign_application)
  var foreign_surface: Control = ClassDB.instantiate("FabricSurface")
  foreign_surface.name = "ForeignModalSurface"
  foreign_surface.position = Vector2(180, 24)
  foreign_surface.size = Vector2(120, 90)
  foreign_surface.set("application_path", NodePath("../ForeignModalApplication"))
  foreign_surface.set("component_name", "ForeignModalProbe")
  root.add_child(foreign_surface)
  await settle(16)
  var lower_canceled := state_from(lower_application, "ModalHostProbe")
  var foreign_initial := native(foreign_surface)
  var foreign_modal := by_test_id(foreign_initial, "foreign-modal")
  check(int(lower_canceled.modalPointerCancels) == int(lower_contact.modalPointerCancels) + 1 and
      int(lower_canceled.modalTouchCancels) == int(lower_contact.modalTouchCancels) + 1 and
      int(lower_canceled.modalPointerCaptureLosts) == int(lower_contact.modalPointerCaptureLosts) + 1 and
      int(lower_canceled.modalPressOuts) == int(lower_contact.modalPressOuts) + 1 and
      int(lower_canceled.modalPresses) == int(lower_contact.modalPresses),
    "owner/a foreign runtime taking the top cancels the lower captured pointer and Pressability contact")
  check(not foreign_modal.is_empty() and foreign_modal.modalWindow.visible and foreign_modal.modalWindow.exclusive and
      int(foreign_modal.modalWindow.parentId) == root.get_instance_id(),
    "owner/the foreign runtime owns a live exclusive embedded Modal Window")
  var stale_lower_up := InputEventMouseButton.new()
  stale_lower_up.button_index = MOUSE_BUTTON_LEFT
  stale_lower_up.position = lower_owner_pressable.get_global_rect().get_center() if lower_owner_pressable != null else Vector2.ZERO
  stale_lower_up.pressed = false
  root.push_input(stale_lower_up, true)
  await settle(3)
  var lower_after_stale_up := state_from(lower_application, "ModalHostProbe")

  var foreign_input := root.find_child("foreign-input", true, false) as LineEdit
  var foreign_pressable := root.find_child("foreign-pressable", true, false) as Control
  check(foreign_input != null and foreign_pressable != null,
    "owner/the foreign Modal's native input and Pressable controls are mounted")
  if foreign_input != null:
    foreign_input.grab_focus()
    foreign_input.set_caret_column(foreign_input.get_text().length())
    var foreign_character := InputEventKey.new()
    foreign_character.keycode = KEY_Y
    foreign_character.unicode = 121
    foreign_character.pressed = true
    root.push_input(foreign_character, true)
    await settle(6)
  var foreign_typed := state_from(foreign_application, "ForeignModalProbe")
  var foreign_before_stop := native(foreign_surface)
  var foreign_window := by_test_id(foreign_before_stop, "foreign-modal")
  var foreign_pressable_id := foreign_pressable.get_instance_id() if foreign_pressable != null else 0
  var foreign_input_id := foreign_input.get_instance_id() if foreign_input != null else 0
  var foreign_viewport_id := foreign_input.get_viewport().get_instance_id() if foreign_input != null else 0
  if foreign_pressable != null:
    var foreign_down := InputEventMouseButton.new()
    foreign_down.button_index = MOUSE_BUTTON_LEFT
    foreign_down.position = foreign_pressable.get_global_rect().get_center()
    foreign_down.pressed = true
    root.push_input(foreign_down, true)
    var foreign_move := InputEventMouseMotion.new()
    foreign_move.position = foreign_pressable.get_global_rect().position + Vector2(250, 20)
    foreign_move.button_mask = MOUSE_BUTTON_MASK_LEFT
    root.push_input(foreign_move, true)
  await settle(4)
  var foreign_captured := state_from(foreign_application, "ForeignModalProbe")
  check(int(foreign_captured.pointerDowns) == 1 and int(foreign_captured.gotCaptures) == 1 and
      bool(foreign_captured.captureActiveOnGot) and int(foreign_captured.lostCaptures) == 0,
    "owner/the foreign Pressable holds explicit pointer capture before the lower runtime stops")
  var foreign_focus_before_stop := foreign_input != null and foreign_input.has_focus()
  lower_application.call("stop")
  await settle(6)
  var foreign_after_lower_stop := state_from(foreign_application, "ForeignModalProbe")
  var foreign_native_after_stop := native(foreign_surface)
  var retained_foreign_window := instance_from_id(int(foreign_window.modalWindow.id)) as Window
  check(bool(foreign_typed.value == "foreigny") and foreign_input != null and foreign_input.has_focus() and
      foreign_focus_before_stop and foreign_pressable != null and is_instance_valid(foreign_pressable) and
      foreign_pressable.get_instance_id() == foreign_pressable_id and foreign_input.get_instance_id() == foreign_input_id and
      foreign_input.get_viewport().get_instance_id() == foreign_viewport_id and retained_foreign_window != null and
      retained_foreign_window.visible and retained_foreign_window.is_exclusive() and
      by_test_id(foreign_native_after_stop, "foreign-modal").modalWindow.id == foreign_window.modalWindow.id and
      int(foreign_after_lower_stop.pointerCancels) == int(foreign_captured.pointerCancels) and
      int(foreign_after_lower_stop.touchCancels) == int(foreign_captured.touchCancels) and
      int(foreign_after_lower_stop.lostCaptures) == int(foreign_captured.lostCaptures),
    "owner/stopping a lower runtime preserves the foreign top Window, Controls, focus, text and capture")
  if foreign_pressable != null:
    var foreign_return := InputEventMouseMotion.new()
    foreign_return.position = foreign_pressable.get_global_rect().get_center()
    foreign_return.button_mask = MOUSE_BUTTON_MASK_LEFT
    root.push_input(foreign_return, true)
    var foreign_up := InputEventMouseButton.new()
    foreign_up.button_index = MOUSE_BUTTON_LEFT
    foreign_up.position = foreign_pressable.get_global_rect().get_center()
    foreign_up.pressed = false
    root.push_input(foreign_up, true)
    await create_timer(0.2).timeout
  var foreign_released := state_from(foreign_application, "ForeignModalProbe")
  check(int(lower_after_stale_up.modalPresses) == int(lower_canceled.modalPresses) and
      int(foreign_released.pointerUps) == 1 and int(foreign_released.presses) == 1 and
      int(foreign_released.lostCaptures) == 1 and not bool(foreign_released.captureActiveOnLost) and
      int(foreign_released.pointerCancels) == int(foreign_captured.pointerCancels) and
      int(foreign_released.touchCancels) == int(foreign_captured.touchCancels) and
      foreign_input != null and foreign_input.has_focus() and foreign_input.get_text() == "foreigny",
    "owner/the foreign captured pointer still receives Up and Press after the lower runtime stops")
  foreign_application.call("stop")
  await settle(4)
  check(native(foreign_application).stopped and native(foreign_surface).nativeTags == 0,
    "owner/stopping the foreign runtime releases its remaining presentation and native controls")

  var cross_root_application: Node = ClassDB.instantiate("FabricApplication")
  cross_root_application.name = "CrossRootCaptureApplication"
  cross_root_application.set("bundle_path", "res://build/modal-host-probe.js")
  root.add_child(cross_root_application)
  var cross_root_a: Control = ClassDB.instantiate("FabricSurface")
  cross_root_a.name = "CrossRootSurfaceA"
  cross_root_a.position = Vector2(30, 30)
  cross_root_a.size = Vector2(90, 70)
  cross_root_a.set("application_path", NodePath("../CrossRootCaptureApplication"))
  cross_root_a.set("component_name", "CrossRootCaptureProbe")
  cross_root_a.set("initial_props", {"name": "A"})
  root.add_child(cross_root_a)
  var cross_root_b: Control = ClassDB.instantiate("FabricSurface")
  cross_root_b.name = "CrossRootSurfaceB"
  cross_root_b.position = Vector2(180, 30)
  cross_root_b.size = Vector2(90, 70)
  cross_root_b.set("application_path", NodePath("../CrossRootCaptureApplication"))
  cross_root_b.set("component_name", "CrossRootCaptureProbe")
  cross_root_b.set("initial_props", {"name": "B"})
  root.add_child(cross_root_b)
  await settle(16)
  var cross_root_control_a := root.find_child("cross-root-A", true, false) as Control
  var cross_root_control_b := root.find_child("cross-root-B", true, false) as Control
  var cross_root_before := JSON.parse_string(cross_root_application.call("evaluate",
    "JSON.stringify(CrossRootCaptureProbe.snapshot())")) as Dictionary
  check(cross_root_control_a != null and cross_root_control_b != null and
      bool(cross_root_before.connected.get("A", false)) and bool(cross_root_before.connected.get("B", false)),
    "routing/two Fabric roots in one application expose connected capture targets")
  if cross_root_control_a != null and cross_root_control_b != null:
    var cross_down := InputEventMouseButton.new()
    cross_down.button_index = MOUSE_BUTTON_LEFT
    cross_down.position = cross_root_control_a.get_global_rect().get_center()
    cross_down.pressed = true
    root.push_input(cross_down, true)
    var cross_move := InputEventMouseMotion.new()
    cross_move.position = cross_root_control_b.get_global_rect().get_center()
    cross_move.button_mask = MOUSE_BUTTON_MASK_LEFT
    root.push_input(cross_move, true)
    await settle(4)
    var cross_captured := JSON.parse_string(cross_root_application.call("evaluate",
      "JSON.stringify(CrossRootCaptureProbe.snapshot())")) as Dictionary
    check(bool(cross_captured.pendingCapture) and bool(cross_captured.captured) and
        cross_captured.events.any(func(event: Dictionary) -> bool:
          return event.get("name") == "B" and event.get("phase") == "got"),
      "routing/The target root acquires capture before the cross-root contact ends")
    var cross_up := InputEventMouseButton.new()
    cross_up.button_index = MOUSE_BUTTON_LEFT
    cross_up.position = cross_move.position
    cross_up.pressed = false
    root.push_input(cross_up, true)
    await create_timer(0.2).timeout
  var cross_root_report := JSON.parse_string(cross_root_application.call("evaluate",
    "JSON.stringify(CrossRootCaptureProbe.snapshot())")) as Dictionary
  var cross_events: Array = cross_root_report.get("events", [])
  print("CROSS_ROOT_CAPTURE_TRACE=" + JSON.stringify(cross_events))
  var cross_counts: Dictionary = {}
  for cross_event: Dictionary in cross_events:
    var event_key := str(cross_event.get("name", "")) + "/" + str(cross_event.get("phase", ""))
    cross_counts[event_key] = int(cross_counts.get(event_key, 0)) + 1
  var cross_move_events: Array = cross_events.filter(func(event: Dictionary) -> bool:
    return event.get("name") == "B" and event.get("phase") == "move")
  check(int(cross_counts.get("A/down", 0)) == 1 and int(cross_counts.get("A/up", 0)) == 0 and
      int(cross_counts.get("B/got", 0)) == 1 and int(cross_counts.get("B/move", 0)) >= 1 and
      int(cross_counts.get("B/up", 0)) == 1 and int(cross_counts.get("B/press", 0)) == 0 and
      int(cross_counts.get("B/lost", 0)) == 1 and int(cross_counts.get("B/ancestor-move", 0)) >= 1 and
      int(cross_counts.get("B/ancestor-up", 0)) == 1 and not bool(cross_root_report.captured),
    "routing/Capture from root A delivers move, Up and bubbling to root B in the same runtime")
  check(int(cross_counts.get("A/leave", 0)) == 1 and int(cross_counts.get("B/enter", 0)) == 1 and
      int(cross_counts.get("B/leave", 0)) == 1 and int(cross_counts.get("B/ancestor-enter", 0)) == 1 and
      int(cross_counts.get("B/ancestor-leave", 0)) == 1 and int(cross_counts.get("B/ancestor-got", 0)) == 1 and
      int(cross_counts.get("B/ancestor-lost", 0)) == 1,
    "routing/Enter, Leave and capture notifications reach their RN ancestors across Fabric roots")
  var cross_projected_move: Dictionary = cross_move_events[0] if not cross_move_events.is_empty() else {}
  check(not cross_projected_move.is_empty() and
      is_equal_approx(float(cross_projected_move.get("x", -1.0)), 45.0) and
      is_equal_approx(float(cross_projected_move.get("y", -1.0)), 35.0),
    "routing/Captured coordinates are projected through the target root's viewport")
  check(native(cross_root_application).errors.is_empty(),
    "routing/Cross-root capture completes without a runtime error")
  cross_root_application.call("stop")
  await settle(4)
  check(native(cross_root_application).stopped and native(cross_root_a).nativeTags == 0 and
      native(cross_root_b).nativeTags == 0,
    "cleanup/Cross-root capture roots release their controls")
  stages.crossRootCapture = {"report": cross_root_report, "application": native(cross_root_application),
    "surfaceA": native(cross_root_a), "surfaceB": native(cross_root_b)}
  stages.ownerIsolation = {"lowerContact": lower_contact, "lowerCanceled": lower_canceled,
    "lowerAfterStaleUp": lower_after_stale_up, "foreignInitial": foreign_initial,
    "foreignTyped": foreign_typed, "foreignBeforeStop": foreign_window,
    "foreignCaptured": foreign_captured, "foreignAfterLowerStop": foreign_after_lower_stop,
    "foreignNativeAfterStop": foreign_native_after_stop,
    "foreignReleased": foreign_released, "lowerStopped": native(lower_application),
    "foreignStopped": native(foreign_application), "focusBeforeStop": foreign_focus_before_stop}

  var failures := checks.filter(func(row: Dictionary) -> bool: return not row.passed)
  var report := {"scenario": "native-original-modal-host", "reactNative": "0.87.1",
    "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(),
    "checks": checks, "stages": stages, "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"originalModal": true, "originalSafeAreaView": true,
      "publicTextInputAdapter": true, "publicButtonAdapter": true,
      "engineInjectedInput": true, "explicitPointerCapture": true,
      "foreignRuntimeOwnership": true, "crossRootCapture": true, "logicalModalBubbling": true,
      "pixelCapture": false, "mobile": false}}
  var output := FileAccess.open("res://build/modal-host-report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_CHECK_FAILED: report/The Modal report is writable")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("MODAL_HOST_PASSED: " + str(checks.size()) if failures.is_empty() else "MODAL_HOST_FAILED")
  quit(0 if failures.is_empty() else 1)
