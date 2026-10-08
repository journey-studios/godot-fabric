extends RefCounted

# The context the HUD shows, derived from the state and the selection by this one pure function. React never
# decides it. In precedence order:
#   dialog   an event is pending; it outranks everything and blocks every intent but resolve_event
#   settler  the selected unit is a Settler
#   warrior  the selected unit is a Warrior
#   none     nothing is selected
#   city     the selected tile holds the city and no unit is selected
#   stack    the selected tile holds two or more of the player's units and none is selected
#   tile     any other selected tile

const Rules := preload("rules.gd")
const World := preload("world.gd")


static func derive(state: Dictionary) -> String:
  if int(state.event.pending) == 1:
    return "dialog"
  var sel: Dictionary = state.sel
  if int(sel.unit) != 0:
    var unit := World.unit_by_id(state, int(sel.unit))
    if not unit.is_empty():
      return unit.kind
  if int(sel.x) < 0:
    return "none"
  if not World.city_at(state, int(sel.x), int(sel.y)).is_empty():
    return "city"
  if World.units_at(state, int(sel.x), int(sel.y), Rules.OWNER_PLAYER).size() >= 2:
    return "stack"
  return "tile"
