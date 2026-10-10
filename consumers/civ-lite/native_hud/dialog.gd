extends PanelContainer

# The event dialog: the game raised its events and refuses every intent but the answer to the head of the queue. It shows that one event,
# "n of m" as the game counts them, and its choices; answering sends `resolve_event` and the game's next snapshot has the next event as
# the head. The HUD makes a dialog for each event (`event_id` is the head it was made for) and frees it when the head changes, so each
# event is a subtree of its own and nothing of one leaks into the next. It is shown in an overlay.

signal intent(method: StringName, args: Array)

const Kit := preload("kit.gd")

@onready var _position: Label = get_node("%hud-dialog-position")
@onready var _title: Label = get_node("%hud-dialog-title")
@onready var _text: Label = get_node("%hud-dialog-text")
@onready var _choices: VBoxContainer = get_node("%Choices")

var event_id := ""


func render(snapshot: Dictionary, _hover: Dictionary) -> void:
  var dialog: Dictionary = snapshot.dialog
  Kit.set_text(_position, "%d of %d" % [dialog.index, dialog.count])
  Kit.set_text(_title, dialog.title)
  Kit.set_text(_text, dialog.text)
  if event_id == dialog.id:
    return
  event_id = dialog.id
  Kit.clear(_choices)
  for choice: Dictionary in dialog.choices:
    var box := VBoxContainer.new()
    box.name = "Choice-" + choice.id
    box.mouse_filter = Control.MOUSE_FILTER_IGNORE
    box.add_theme_constant_override("separation", 2)
    var button := Kit.choice("hud-dialog-choice-" + choice.id, choice.label, true)
    button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
    button.pressed.connect(intent.emit.bind(&"resolve_event", [choice.id]))
    box.add_child(button)
    box.add_child(Kit.line("hud-dialog-choice-%s-detail" % choice.id, choice.detail, &"SmallMutedLabel"))
    _choices.add_child(box)
