extends "res://hud_reader.gd"

# The React Native HUD's reader (arm C). The HUD is read from the host's snapshot (`hud.call("snapshot")`), not from the scene tree: the
# Controls of a Modal are children of the Modal's own Window, which `hud.find_child` does not reach. Each entry of the snapshot carries
# the instance id of the Control the host mounted for it, from which the reader takes the rect, whether it stops the pointer, whether a
# Pressable is disabled (the accessibility `descriptor.disabled`) and whether it is in a Modal's Window (`control.get_window() != root`).

var application: Node


func _init(surface: Control, runtime: Node) -> void:
  super(surface)
  application = runtime


func arm() -> String:
  return "rn"


func observe() -> Dictionary:
  var tree: Dictionary = JSON.parse_string(hud.call("snapshot"))
  var nodes: Array = []
  var stoppers: Array = []
  # A surface that is not mounted reports no nodes.
  for entry: Dictionary in tree.get("nodes", []):
    var control := instance_from_id(int(entry.id)) as Control
    if control == null:
      continue
    var rect := control.get_global_rect()
    var stops := control.mouse_filter == Control.MOUSE_FILTER_STOP
    var in_modal := control.get_window() != hud.get_tree().root
    var access: Dictionary = entry.get("accessibility", {})
    var descriptor: Dictionary = access.get("descriptor", {})
    var activity: Dictionary = entry.get("activity", {})
    if stops:
      stoppers.append({"testID": entry.testID, "rect": [rect.position.x, rect.position.y, rect.size.x, rect.size.y], "modal": in_modal})
    if entry.testID != "":
      nodes.append({"testID": entry.testID, "kind": entry.kind, "visible": control.is_visible_in_tree(), "text": entry.get("nativeText", ""),
        "rect": [rect.position.x, rect.position.y, rect.size.x, rect.size.y], "stops": stops, "disabled": bool(descriptor.get("disabled", false)),
        "animating": bool(activity.get("animating", false)), "modal": in_modal, "instance": int(entry.id)})
  return {"nodes": nodes, "stoppers": stoppers}


# The Control the host mounted for a testID, wherever it is: in the root's Window or in a Modal's. Null when there is none.
func control_of(id: String) -> Control:
  var tree: Dictionary = JSON.parse_string(hud.call("snapshot"))
  for entry: Dictionary in tree.get("nodes", []):
    if entry.testID == id:
      return instance_from_id(int(entry.id)) as Control
  return null


func stats() -> Dictionary:
  var text: String = application.call("evaluate", "JSON.stringify(FrontierHud.stats())")
  var value: Variant = JSON.parse_string(text)
  return value if value is Dictionary else {}


# The execution runner's `stats()`: the node in the scene that reads the registry's counters (hud_stats.gd), with no JavaScript and no snapshot.
func runner_stats() -> Dictionary:
  return hud.get_node("../../HudStats").stats()


# The Surface claims, among the events it is pushed, the ones of the validation device.
func prepare(device: int) -> void:
  hud.set_meta("validation_input_device", device)


func unmount() -> void:
  hud.call("unmount")


func mount() -> void:
  hud.call("mount")


func errors() -> Array:
  var state: Variant = JSON.parse_string(application.call("snapshot"))
  return state.get("errors", []) if state is Dictionary else ["no snapshot"]
