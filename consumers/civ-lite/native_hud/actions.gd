extends PanelContainer

# The actions of the selection: exactly the `actions` of the snapshot, in the order the game gave them, each with its `enabled` and,
# for a disabled one, the game's `reason_text`. End turn is one of them in the snapshot and lives on the bar, so it is not here. An action
# about a unit shows the unit's icon, founding a city the city's and irrigating the irrigation's. The list is touched only when what it lists changes, and then row by row.

signal intent(method: StringName, args: Array)

const Kit := preload("kit.gd")
const Icons := preload("icons.gd")

@onready var _list: VBoxContainer = get_node("%List")

var _rows: Array = []


func render(snapshot: Dictionary, _hover: Dictionary) -> void:
  var rows := _describe(snapshot)
  if rows == _rows:
    return
  _rows = rows
  Kit.sync_choices(_list, "hud-actions-", rows, _on_pressed)


# The row's key names its action and its arguments, so a row that stays is the same intent.
func _on_pressed(key: String) -> void:
  for row: Dictionary in _rows:
    if row.key == key:
      intent.emit(StringName(row.id), row.args)
      return


func _describe(snapshot: Dictionary) -> Array:
  var rows: Array = []
  for action: Dictionary in snapshot.actions:
    if action.id == "end_turn":
      continue
    var key: String = action.id
    for argument in action.args:
      key += "-" + str(int(argument))
    var enabled := int(action.enabled) == 1
    rows.append({"key": key, "id": action.id, "args": action.args.duplicate(), "label": action.label, "enabled": enabled,
      "reason": "" if enabled else action.reason_text, "icon": _icon_of(action, snapshot.tile.units)})
  return rows


func _icon_of(action: Dictionary, units: Array) -> String:
  if action.id == "found_city":
    return "city"
  if action.id == "irrigate":
    return "irrigation"
  if action.id == "select_unit" or action.id == "fortify":
    for unit: Dictionary in units:
      if unit.id == action.args[0]:
        return Icons.unit_icon(unit.kind)
  return ""
