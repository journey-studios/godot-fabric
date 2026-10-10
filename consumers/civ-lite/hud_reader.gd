extends RefCounted

# The seam between the HUD probes (hud_probe.gd and the three that extend it) and the HUD they look at. A probe asks a reader for rows, never
# a HUD: the React Native HUD's reader (hud_reader_host.gd) takes them from the host's snapshot, the native HUD's (hud_reader_native.gd) from
# its Controls, and both answer in the same shape, so the probes' logic and the independent oracle are the same for both arms.
#
#   observe()      {nodes, stoppers}: a row for each Control with a testID that is on screen (testID, kind, visible, text, rect, stops,
#                  disabled, animating, modal, instance), and, apart, every Control that stops the pointer, testID or not (testID, rect,
#                  modal). `modal` is "inside the blocking overlay": the Modal's Window for the host, the overlay Control for the native HUD.
#   control_of(id) the Control behind a testID, or null when it is not on screen.
#   stats()        what the HUD counted of itself (`calls`: the intents it sent).
#   prepare(device) readies the HUD for pointer events pushed by device `device`.
#   unmount()/mount()  take the HUD out of the tree and put it back.
#   errors()       what the HUD's runtime reports as errors.
#   not_applicable()   what this arm cannot say, listed in the report so that the oracle can tell a skipped check from a forgotten one.

var hud: Control


func _init(surface: Control) -> void:
  hud = surface


func arm() -> String:
  return ""


func observe() -> Dictionary:
  return {"nodes": [], "stoppers": []}


func control_of(_id: String) -> Control:
  return null


func stats() -> Dictionary:
  return {}


func prepare(_device: int) -> void:
  pass


func unmount() -> void:
  pass


func mount() -> void:
  pass


func errors() -> Array:
  return []


func not_applicable() -> Array:
  return []
