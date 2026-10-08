extends SceneTree

var checks: Array = []
var application: Node
var surface: Control
func check(ok: bool, id: String) -> void:
  checks.append({"id": id, "passed": ok})
  if not ok: push_error("FABRIC_CHECK_FAILED: " + id)
func settle(frames: int = 10) -> void:
  for frame in range(frames): await process_frame
func native(target: Object) -> Dictionary:
  var value: Variant = JSON.parse_string(target.call("snapshot"))
  return value if value is Dictionary else {}
func react() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("evaluate", "JSON.stringify(ModalOrderProbe.snapshot())"))
  return value if value is Dictionary else {}
func modal(snapshot: Dictionary) -> Dictionary:
  for node: Dictionary in snapshot.get("nodes", []):
    if node.get("testID") == "order-modal": return node
  return {}
func physical_order(parent: Node) -> Array[String]:
  var result: Array[String] = []
  for child in parent.get_children():
    if String(child.name).begins_with("ordinary-"): result.append(String(child.name))
  return result
func run_probe() -> void:
  root.size = Vector2i(420, 320)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "ModalSiblingOrderApplication"
  application.set("bundle_path", "res://build/modal-discriminators-probe.js")
  root.add_child(application)
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "ModalSiblingOrderSurface"
  surface.set("application_path", NodePath("../ModalSiblingOrderApplication"))
  surface.set("component_name", "ModalOrderProbe")
  root.add_child(surface)
  await settle(18)
  var ordinary_a := root.find_child("ordinary-a", true, false) as Control
  var ordinary_b := root.find_child("ordinary-b", true, false) as Control
  var ordinary_c := root.find_child("ordinary-c", true, false) as Control
  var input := root.find_child("order-modal-input", true, false) as LineEdit
  var modal_content := root.find_child("order-modal-content", true, false) as Control
  check(ordinary_a != null and ordinary_b != null and ordinary_c != null and input != null and modal_content != null,
    "reorder/portal-and-native-siblings-mounted")
  if ordinary_a == null or ordinary_b == null or ordinary_c == null or input == null or modal_content == null:
    quit(1); return
  input.grab_focus()
  input.set_caret_column(input.get_text().length())
  var key := InputEventKey.new()
  key.keycode = KEY_Z
  key.unicode = 122
  key.pressed = true
  root.push_input(key, true)
  await settle(6)
  var initial := react()
  var ids := {"a": ordinary_a.get_instance_id(), "b": ordinary_b.get_instance_id(),
    "c": ordinary_c.get_instance_id(), "input": input.get_instance_id(),
    "content": modal_content.get_instance_id()}
  check(input.has_focus() and input.get_text() == "seedz" and initial.value == "seedz",
    "reorder/engine-key-input-establishes-modal-focus-and-text")
  var logical_orders: Array = [["a", "portal", "b", "c"],
    ["c", "portal", "a", "b"], ["a", "b", "portal", "c"]]
  var expected_orders: Array = [["ordinary-a", "ordinary-b", "ordinary-c"],
    ["ordinary-c", "ordinary-a", "ordinary-b"], ["ordinary-a", "ordinary-b", "ordinary-c"]]
  var observed: Array[Dictionary] = []
  for index in logical_orders.size():
    application.call("evaluate", "ModalOrderProbe.reorder(" + JSON.stringify(logical_orders[index]) + ")")
    await settle(8)
    var parent := root.find_child("logical-parent", true, false) as Control
    ordinary_a = root.find_child("ordinary-a", true, false) as Control
    ordinary_b = root.find_child("ordinary-b", true, false) as Control
    ordinary_c = root.find_child("ordinary-c", true, false) as Control
    input = root.find_child("order-modal-input", true, false) as LineEdit
    modal_content = root.find_child("order-modal-content", true, false) as Control
    var sibling_parent := ordinary_a.get_parent() if ordinary_a != null else null
    var order := physical_order(sibling_parent) if sibling_parent != null else []
    var state := react()
    var retained: bool = (ordinary_a != null and ordinary_a.get_instance_id() == ids.a and
      ordinary_b != null and ordinary_b.get_instance_id() == ids.b and
      ordinary_c != null and ordinary_c.get_instance_id() == ids.c and
      input != null and input.get_instance_id() == ids.input and
      modal_content != null and modal_content.get_instance_id() == ids.content)
    check(order == expected_orders[index], "reorder/step-%d-physical-order-excludes-modal" % index)
    check(retained and input.has_focus() and input.get_text() == "seedz" and state.value == "seedz" and
      int(state.shows) == int(initial.shows), "reorder/step-%d-retains-controls-focus-text-and-onShow" % index)
    observed.append({"logicalOrder": logical_orders[index], "physicalOrder": order, "retained": retained,
      "focused": input.has_focus() if input != null else false,
      "text": input.get_text() if input != null else "", "react": state,
      "parentId": parent.get_instance_id() if parent != null else 0})
  var app_state := native(application)
  check(app_state.errors.is_empty(), "reorder/no-runtime-errors")
  var report := {"scenario": "modal-logical-sibling-order", "initial": initial,
    "controlIds": ids, "observed": observed, "application": app_state, "checks": checks}
  var output := FileAccess.open("res://build/modal-sibling-order-report.json", FileAccess.WRITE)
  output.store_string(JSON.stringify(report, "  ") + "\n")
  print("MODAL_SIBLING_ORDER_PASSED=" + str(checks.size()) if checks.all(
    func(row: Dictionary) -> bool: return row.passed) else "MODAL_SIBLING_ORDER_FAILED")
  application.call("stop")
  await settle(6)
  quit(0 if checks.all(func(row: Dictionary) -> bool: return row.passed) and native(surface).nativeTags == 0 else 1)
func _initialize() -> void: call_deferred("run_probe")
