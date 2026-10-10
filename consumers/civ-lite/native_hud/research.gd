extends PanelContainer

# The research panel: the technologies in the game's order, each with its state, its cost and, when the game refuses it, why. The list
# is built again only when what it lists changes.

signal intent(method: StringName, args: Array)

const Kit := preload("kit.gd")

@onready var _title: Label = get_node("%hud-research-title")
@onready var _progress: Label = get_node("%hud-research-progress")
@onready var _techs: VBoxContainer = get_node("%Techs")

var _rows: Array = []


func render(snapshot: Dictionary, _hover: Dictionary) -> void:
  var research: Dictionary = snapshot.research
  var current := "none"
  for tech: Dictionary in research.techs:
    if tech.id == research.current:
      current = tech.label
  Kit.set_text(_title, "Research: " + current)
  if int(research.needed) == 0:
    Kit.set_text(_progress, "%d learned (+%d)" % [research.known, research.rate])
  else:
    Kit.set_text(_progress, "%d/%d (+%d) · %d learned" % [snapshot.resources.science.stock, research.needed, research.rate, research.known])
  var rows: Array = research.techs.map(func(tech: Dictionary) -> Dictionary: return {"id": tech.id, "label": "%s (%d) · %s" % [tech.label, tech.cost, tech.state],
    "enabled": int(tech.enabled) == 1, "reason": "" if int(tech.enabled) == 1 else tech.reason_text})
  if rows == _rows:
    return
  _rows = rows
  Kit.clear(_techs)
  for row: Dictionary in rows:
    var button := Kit.choice("hud-research-tech-" + row.id, row.label, row.enabled)
    button.pressed.connect(intent.emit.bind(&"set_research", [row.id]))
    _techs.add_child(Kit.row(button, "hud-research-tech-%s-reason" % row.id, row.reason))
