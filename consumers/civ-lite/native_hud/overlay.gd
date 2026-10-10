extends ColorRect

# An overlay is a blocking layer: the city screen with the research list, and the event dialog. It is a Control that fills the HUD, stops the
# pointer and dims the game behind it, above the map in the tree, so under it nothing hears the pointer, the map included: the GUI hands a
# mouse event to the Control under it, a STOP Control marks it handled, and the World, which listens in `_unhandled_input`, never gets it.
# `close_requested` is what Escape means for the overlay, and the owner says what that is: on the city screen it is the game's
# `clear_selection`, on the dialog nothing is connected, because the event has to be answered. Either way the overlay takes the key.

signal close_requested

# Where the panels sit: in the right-hand column, or centred.
@export var centered := false

var content: VBoxContainer


func _ready() -> void:
  color = Color(0.0078, 0.0235, 0.0902, 0.62)
  mouse_filter = Control.MOUSE_FILTER_STOP
  set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
  content = VBoxContainer.new()
  content.name = "Content"
  content.mouse_filter = Control.MOUSE_FILTER_IGNORE
  content.add_theme_constant_override("separation", 8)
  if centered:
    var centre := CenterContainer.new()
    centre.name = "Centre"
    centre.mouse_filter = Control.MOUSE_FILTER_IGNORE
    centre.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    add_child(centre)
    centre.add_child(content)
  else:
    content.position = Vector2(616, 24)
    content.custom_minimum_size = Vector2(440, 0)
    add_child(content)


func _unhandled_key_input(event: InputEvent) -> void:
  if event.is_action_pressed(&"ui_cancel"):
    get_viewport().set_input_as_handled()
    close_requested.emit()
