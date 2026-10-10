extends ColorRect

# The menu screen, shown after the scene dropped its World. It reads nothing from the game: New game asks the owner to start a session.

signal new_game_requested


func _ready() -> void:
  get_node("%menu-new-game").pressed.connect(new_game_requested.emit)
