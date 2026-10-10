extends PanelContainer

# The turn and resources bar, present in every context: the turn, the phase, the three resources, End turn and the way to the menu.
# End turn is the `end_turn` action of the snapshot, so it is enabled exactly when the game says so, and a disabled one shows the
# game's reason; while the game processes the turn (`phase` is not `idle`) the spinner shows. The bar decides none of it.

signal intent(method: StringName, args: Array)
signal menu_requested
signal new_game_requested

const Kit := preload("kit.gd")

@onready var _turn: Label = get_node("%hud-bar-turn")
@onready var _phase: Label = get_node("%hud-bar-phase")
@onready var _food: Label = get_node("%hud-bar-food")
@onready var _production: Label = get_node("%hud-bar-production")
@onready var _science: Label = get_node("%hud-bar-science")
@onready var _answer: Label = get_node("%hud-bar-answer")
@onready var _end_turn: Button = get_node("%hud-bar-end-turn")
@onready var _spinner: Control = get_node("%hud-turn-spinner")
@onready var _reason: Label = get_node("%hud-bar-end-turn-reason")


func _ready() -> void:
  _end_turn.pressed.connect(func() -> void: intent.emit(&"end_turn", []))
  get_node("%hud-bar-menu").pressed.connect(menu_requested.emit)
  get_node("%hud-bar-new-game").pressed.connect(new_game_requested.emit)


func render(snapshot: Dictionary, _hover: Dictionary) -> void:
  Kit.set_text(_turn, "Turn %d · epoch %d" % [snapshot.turn, snapshot.epoch])
  Kit.set_text(_phase, snapshot.phase)
  Kit.set_text(_food, _resource("Food", snapshot.resources.food))
  Kit.set_text(_production, _resource("Production", snapshot.resources.production))
  Kit.set_text(_science, _resource("Science", snapshot.resources.science))
  var end_turn := _action(snapshot.actions, "end_turn")
  var enabled: bool = not end_turn.is_empty() and int(end_turn.enabled) == 1
  Kit.set_disabled(_end_turn, not enabled)
  Kit.set_shown(_spinner, snapshot.phase != "idle")
  var refused := not end_turn.is_empty() and not enabled
  Kit.set_text(_reason, end_turn.reason_text if refused else "")
  Kit.set_shown(_reason, refused)


# The text of the game's last refusal, or "" once an intent is accepted.
func show_answer(text: String) -> void:
  Kit.set_text(_answer, text)
  Kit.set_shown(_answer, text != "")


func _resource(label: String, stock: Dictionary) -> String:
  var rate := int(stock.rate)
  return "%s %d (%s%d)" % [label, stock.stock, "+" if rate >= 0 else "", rate]


func _action(actions: Array, id: String) -> Dictionary:
  for action: Dictionary in actions:
    if action.id == id:
      return action
  return {}
