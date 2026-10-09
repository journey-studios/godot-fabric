extends SceneTree

# The runner of the turn lane (V05-06, criterion `turno`). scripts/frontier-turn-lane.mjs provisions the Frontier template as a consumer project,
# builds its HUD with the addon's editor plugin, and only then copies this file, frontier-turn-probe.gd, performance-sampler.gd and window-presence.gd into the
# provisioned copy, under res://turn_probe/. It runs
#
#   godot --path <project> --headless -s res://turn_probe/frontier-turn-runner.gd -- --lane=headless
#
# so that the SceneTree is this script and not the project's main scene: it puts the template's own main scene (res://main.tscn) in the root,
# exactly as the project's `run/main_scene` would, adds the probe beside it and hands the probe the scene. Nothing of the template or of its HUD
# is changed, and the template's own validations (validation.gd, hud_validation.gd) stay inert: they run only with `-- --validate`.
# The viewport is the game's, which a headless window (64x64) is not: the size is the template's own validation's (hud_validation.gd), as the probe's is.
const Probe := preload("frontier-turn-probe.gd")
const HudValidation := preload("res://hud_validation.gd")
const SCENE := "res://main.tscn"
const SIZE := HudValidation.SIZE

func _initialize() -> void:
  root.size = SIZE
  var packed: PackedScene = load(SCENE)
  var scene: Node = packed.instantiate()
  root.add_child(scene)
  var probe: Node = Probe.new()
  probe.name = "FrontierTurnProbe"
  root.add_child(probe)
  probe.start(scene)
