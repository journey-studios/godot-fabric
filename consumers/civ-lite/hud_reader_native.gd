extends "res://hud_reader.gd"

# The native HUD's reader (arm B). The HUD is read from its Controls: a Control is named by its testID (`hud-...`, `menu-...`), as the host
# names the ones it mounts, and it is on screen when it and everything above it is visible. A Godot Button holds its text and its icon as
# properties, where the React Native HUD's Pressable has them as children, so the reader reports the two as the rows the host's tree has,
# `<testID>-label` and `<testID>-icon`. `modal` is "inside an overlay": a Control named `...-overlay` is the layer that blocks the map.

const TESTID_PREFIXES := ["hud-", "menu-"]

# Where the HUD was before `unmount`, so that `mount` puts it back in the same place of the tree.
var _parent: Node
var _index := 0


func arm() -> String:
  return "native"


func observe() -> Dictionary:
  var nodes: Array = []
  var stoppers: Array = []
  # A HUD that is not in the tree reports no nodes, as a surface that is not mounted does.
  if hud.is_inside_tree():
    _read(hud, nodes, stoppers)
  return {"nodes": nodes, "stoppers": stoppers}


func control_of(id: String) -> Control:
  if not hud.is_inside_tree():
    return null
  var control := hud.find_child(id, true, false) as Control
  return control if control != null and control.is_visible_in_tree() else null


func stats() -> Dictionary:
  return hud.stats()


func unmount() -> void:
  _parent = hud.get_parent()
  _index = hud.get_index()
  _parent.remove_child(hud)


func mount() -> void:
  _parent.add_child(hud)
  _parent.move_child(hud, _index)


# The native HUD has no application: its runtime reports no errors because it has none to report.
func not_applicable() -> Array:
  return ["the application's error list after a remount (there is no Application node)"]


func _read(node: Node, nodes: Array, stoppers: Array) -> void:
  for child in node.get_children():
    var control := child as Control
    if control == null or not control.visible:
      continue
    var rect := control.get_global_rect()
    var area := [rect.position.x, rect.position.y, rect.size.x, rect.size.y]
    var modal := _in_overlay(control)
    var stops := control.mouse_filter == Control.MOUSE_FILTER_STOP
    var id := String(control.name)
    var tagged := TESTID_PREFIXES.any(func(prefix: String) -> bool: return id.begins_with(prefix))
    if stops:
      stoppers.append({"testID": id if tagged else "", "rect": area, "modal": modal})
    if tagged:
      nodes.append(_row(control, id, area, stops, modal))
      var button := control as Button
      if button != null:
        nodes.append(_part(button, id + "-label", "text", button.text, area, modal))
        if button.icon != null:
          nodes.append(_part(button, id + "-icon", "image", "", area, modal))
    _read(control, nodes, stoppers)


func _row(control: Control, id: String, area: Array, stops: bool, modal: bool) -> Dictionary:
  var label := control as Label
  var button := control as Button
  var animating: bool = control.has_method("is_animating") and control.is_animating()
  return {"testID": id, "kind": _kind_of(control), "visible": control.is_visible_in_tree(), "text": label.text if label != null else (button.text if button != null else ""),
    "rect": area, "stops": stops, "disabled": button != null and button.disabled, "animating": animating, "modal": modal, "instance": control.get_instance_id()}


# A part of a Button the host's tree has as a child of its own.
func _part(button: Button, id: String, kind: String, text: String, area: Array, modal: bool) -> Dictionary:
  return {"testID": id, "kind": kind, "visible": button.is_visible_in_tree(), "text": text, "rect": area, "stops": false, "disabled": false, "animating": false,
    "modal": modal, "instance": button.get_instance_id()}


func _kind_of(control: Control) -> String:
  if control is Label:
    return "text"
  if control is Button:
    return "button"
  if control is TextureRect:
    return "image"
  if control.has_method("is_animating"):
    return "activity"
  return "view"


func _in_overlay(control: Control) -> bool:
  var node: Node = control
  while node != null and node != hud:
    if String(node.name).ends_with("-overlay"):
      return true
    node = node.get_parent()
  return false
