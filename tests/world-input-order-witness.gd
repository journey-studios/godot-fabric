extends Node

# Stands where a FabricSurface stands in the pointer spike's scenes: in the HUD's CanvasLayer, after the world in the
# tree. Godot calls _unhandled_input on the nodes of a viewport in REVERSE tree order, the last one first
# (SceneTree::_call_input_pause, scene_tree.cpp:1461, over a group sorted by tree order with Node::Comparator), and
# stops at the first that calls set_input_as_handled (1462-1464). A node placed after the world therefore hears an event
# before the world does, and may keep it from the world: that is how the Surface's claim (variant a2) reaches the pointer
# first. The probe asserts it on the live scene instead of trusting the source.
#
# For every mouse button event it hears, the witness records how many events the world had already heard. It never marks
# an event as handled.
var world: Node2D
var heard: Array = []

func _unhandled_input(event: InputEvent) -> void:
  if event is InputEventMouseButton:
    heard.append(world.received.size())
