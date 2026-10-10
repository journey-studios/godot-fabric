extends PanelContainer

# The research panel: the technologies in the game's order, each with its state, its cost and, when the game refuses it, why. The list
# is touched only when what it lists changes, and then row by row.

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
  var rows: Array = research.techs.map(func(tech: Dictionary) -> Dictionary: return {"key": tech.id, "label": "%s (%d) · %s" % [tech.label, tech.cost, tech.state],
    "enabled": int(tech.enabled) == 1, "reason": "" if int(tech.enabled) == 1 else tech.reason_text, "icon": ""})
  if rows == _rows:
    return
  _rows = rows
  Kit.sync_choices(_techs, "hud-research-tech-", rows, _on_tech_pressed)


func _on_tech_pressed(tech_id: String) -> void:
  intent.emit(&"set_research", [tech_id])
