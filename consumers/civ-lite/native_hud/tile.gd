extends PanelContainer

# The tile card: the tile under the pointer while the pointer is over the map (Godot hears it and the node publishes `hover_changed`),
# otherwise the selected tile of the snapshot. Both are the same card. The units on the tile show their icon beside the text, and a
# tile with the city shows the city's. Each Control is set only when what it shows has changed.

const Kit := preload("kit.gd")
const Icons := preload("icons.gd")

@onready var _title: Label = get_node("%hud-tile-title")
@onready var _yields: Label = get_node("%hud-tile-yields")
@onready var _units_row: HBoxContainer = get_node("%Units")
@onready var _icons: HBoxContainer = get_node("%Icons")
@onready var _units: Label = get_node("%hud-tile-units")

var _icon_names: Array = []


func render(snapshot: Dictionary, hover: Dictionary) -> void:
  var hovered := not hover.is_empty() and int(hover.present) == 1
  var card: Dictionary = hover if hovered else snapshot.tile
  var present := int(card.present) == 1
  Kit.set_shown(_yields, present)
  Kit.set_shown(_units_row, present)
  if not present:
    Kit.set_text(_title, "No tile")
    return
  Kit.set_text(_title, "%s · (%d, %d) %s" % ["Pointer" if hovered else "Selected", card.x, card.y, card.terrain_name])
  Kit.set_text(_yields, "Food %d · Production %d · Science %d · Move %d%s" % [card.food, card.production, card.science, card.move_cost,
    " · City" if int(card.city) == 1 else ""])
  _set_icons(card)
  Kit.set_text(_units, "No units" if card.units.is_empty() else " · ".join(card.units.map(_unit_text)))


func _unit_text(unit: Dictionary) -> String:
  return "%s (%s) %d/%d%s" % [unit.name, "yours" if int(unit.owner) == 1 else "foreign", unit.moves, unit.max_moves,
    " fortified" if int(unit.fortified) == 1 else ""]


# The icons of the city and of the units on the tile, built again only when the list of them changes.
func _set_icons(card: Dictionary) -> void:
  var names: Array = []
  if int(card.city) == 1:
    names.append(["hud-tile-city-icon", "city"])
  for unit: Dictionary in card.units:
    var icon := Icons.unit_icon(unit.kind)
    if icon != "":
      names.append(["hud-tile-unit-%d-icon" % unit.id, icon])
  if names == _icon_names:
    return
  _icon_names = names
  Kit.clear(_icons)
  for entry: Array in names:
    _icons.add_child(Kit.icon(entry[0], entry[1]))
