extends Node

# The public Text's onTextLayout example. Each state is read from the paragraphs and the
# overlay Controls the host drew and from what React received; with --capture the renderer's
# frame is read too, to compare the painted ink with the lines the event reported.
const DEVICE := 1001
const MEASURED := ["wrap", "center", "limited", "leading", "heh", "xxx"]
const FACES := ["face-small", "face-large", "face-mono"]
var checks: Array = []
var stages: Dictionary = {}
var images: Dictionary = {}
var capturing := false
@onready var application: Node = $Application
@onready var surface: Control = $Surface

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 1) -> void:
  for index in range(count):
    await get_tree().process_frame

func wait_for(condition: Callable, limit_ms: int = 6000) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms and not condition.call():
    await frames()
  return condition.call()

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(" + expression + ")"))

func example() -> Dictionary:
  var value: Variant = js("globalThis.TextLayoutExample.state()")
  return value if value is Dictionary else {}

func native_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func surface_state() -> Dictionary:
  var value: Variant = JSON.parse_string(surface.call("snapshot"))
  return value if value is Dictionary else {}

func node_of(id: String) -> Dictionary:
  var nodes: Variant = surface_state().get("nodes", [])
  for entry: Dictionary in nodes:
    if entry.get("testID") == id:
      return entry
  return {}

func control(id: String) -> Control:
  return surface.find_child(id, true, false) as Control

func lines_of(id: String) -> Array:
  return example().get("lines", {}).get(id, [])

# Every line of a paragraph has its box and its baseline rule, drawn by the host at the event's numbers
# relative to the paragraph's box, and no overlay is left over from a line that no longer exists.
func overlays_follow(id: String) -> bool:
  var lines := lines_of(id)
  var box := node_of(id + "-box")
  if lines.is_empty() or box.is_empty():
    return false
  for index in range(lines.size()):
    var line: Dictionary = lines[index]
    var frame := node_of("%s-line-%d" % [id, index])
    var rule := node_of("%s-base-%d" % [id, index])
    if frame.is_empty() or rule.is_empty():
      return false
    var left := float(frame.fabricX) - float(box.fabricX)
    var top := float(frame.fabricY) - float(box.fabricY)
    var baseline := float(rule.fabricY) - float(box.fabricY)
    if absf(left - float(line.x)) > 1.0 or absf(top - float(line.y)) > 1.0 \
        or absf(float(frame.fabricWidth) - float(line.width)) > 1.0 or absf(float(frame.fabricHeight) - float(line.height)) > 1.0 \
        or absf(baseline - float(line.y) - float(line.ascender)) > 1.0:
      return false
  return node_of("%s-line-%d" % [id, lines.size()]).is_empty()

func height_of(lines: Array) -> float:
  var sum := 0.0
  for line: Dictionary in lines:
    sum += float(line.height)
  return sum

# The physical-pixel rectangle of a Control in the saved frame.
func region(node: Control) -> Rect2i:
  var physical := get_window().get_final_transform() * node.get_global_rect()
  return Rect2i(Vector2i(physical.position.round()), Vector2i(physical.size.round()))

func is_ink(color: Color) -> bool:
  return color.r > 0.8 and color.g > 0.8 and color.b > 0.8

# The bounds of the ink (the text's near-white pixels; the overlays are blue and orange) in an area.
func ink_bounds(image: Image, area: Rect2i) -> Dictionary:
  var bounds := {"left": -1, "right": -1, "top": -1, "bottom": -1, "count": 0}
  var frame := Rect2i(Vector2i.ZERO, image.get_size())
  var clipped := area.intersection(frame)
  for y in range(clipped.position.y, clipped.end.y):
    for x in range(clipped.position.x, clipped.end.x):
      if not is_ink(image.get_pixel(x, y)):
        continue
      bounds.count += 1
      bounds.left = x if bounds.left < 0 else mini(bounds.left, x)
      bounds.right = maxi(bounds.right, x)
      bounds.top = y if bounds.top < 0 else mini(bounds.top, y)
      bounds.bottom = maxi(bounds.bottom, y)
  return bounds

func capture(stage: String) -> void:
  if not capturing:
    return
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/text-layout-%s.png" % stage) == OK, "Renderer capture saved: " + stage)
  await ink_checks(image, stage)

# What the renderer painted against what the event reported. A Control's rectangle is in logical pixels, the
# frame in physical ones; one logical pixel is the tolerance of every comparison.
func ink_checks(image: Image, stage: String) -> void:
  var scale := get_window().get_final_transform().get_scale().y
  var slack := int(ceil(scale))
  var contained := true
  var painted := true
  var measured := {}
  for id: String in ["wrap", "center", "limited", "leading"]:
    var lines := lines_of(id)
    for index in range(lines.size()):
      var box := region(control("%s-line-%d" % [id, index]))
      var ink := ink_bounds(image, Rect2i(Vector2i(region(control(id + "-box")).position.x, box.position.y),
        Vector2i(region(control(id + "-box")).size.x, box.size.y)))
      painted = painted and ink.count > 0
      contained = contained and ink.count > 0 and ink.left >= box.position.x - slack and ink.right < box.end.x + slack \
        and ink.top >= box.position.y - slack and ink.bottom < box.end.y + slack
      measured["%s-%d" % [id, index]] = ink
  verify(painted, "Every reported line has painted ink (" + stage + ")")
  verify(contained, "The box drawn at each line's event frame contains the ink of that line (" + stage + ")")
  for entry: Array in [["heh", "capHeight"], ["xxx", "xHeight"]]:
    var id: String = entry[0]
    var line: Dictionary = lines_of(id)[0]
    var box := region(control(id + "-box"))
    var ink := ink_bounds(image, Rect2i(box.position, Vector2i(box.size.x, int(round(float(line.height) * scale)))))
    var baseline := float(box.position.y) + (float(line.y) + float(line.ascender)) * scale
    # The ink of flat-bottomed letters ends where the baseline is: its last row is the one above it.
    verify(ink.count > 0 and absf(float(ink.bottom + 1) - baseline) <= scale + 0.5,
      "The ink of %s ends on the baseline y + ascender (%s)" % [id.to_upper(), stage])
    verify(ink.count > 0 and absf(float(ink.bottom + 1 - ink.top) - float(line[entry[1]]) * scale) <= scale + 0.5,
      "The ink of %s is as tall as the reported %s (%s)" % [id.to_upper(), entry[1], stage])
    measured[id] = ink
  images[stage] = measured

func mouse(phase: String, point: Vector2) -> void:
  if phase == "down":
    var motion := InputEventMouseMotion.new()
    motion.device = DEVICE
    motion.position = point
    Input.parse_input_event(motion)
  var button := InputEventMouseButton.new()
  button.device = DEVICE
  button.position = point
  button.button_index = MOUSE_BUTTON_LEFT
  button.pressed = phase == "down"
  button.button_mask = MOUSE_BUTTON_MASK_LEFT if phase == "down" else 0
  Input.parse_input_event(button)
  await frames(2)

func click(id: String) -> void:
  var point := control(id).get_global_rect().get_center()
  await mouse("down", point)
  await frames(3)
  await mouse("up", point)
  await frames(6)

func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  surface.set_meta("validation_input_device", DEVICE)
  await run()

# Every measured paragraph has its lines and every text of the baseline row its frame and ascender.
func all_reported() -> bool:
  var state := example()
  var lines: Dictionary = state.get("lines", {})
  var reported: Dictionary = state.get("frames", {})
  for id: String in MEASURED:
    if not lines.has(id):
      return false
  for id: String in FACES:
    if not reported.has(id) or not reported[id].has("ascender") or not reported[id].has("y"):
      return false
  return true

func run() -> void:
  var mounted := await wait_for(all_reported)
  verify(mounted, "Every measured paragraph and every text of the baseline row receives its onTextLayout")
  await frames(10)
  var initial := example()
  stages.initial = {"example": initial, "nodes": surface_state().get("nodes", [])}
  var kinds := MEASURED.all(func(id: String) -> bool: return node_of(id).get("kind") == "paragraph") \
    and FACES.all(func(id: String) -> bool: return node_of(id).get("kind") == "paragraph")
  verify(kinds, "Each Text is a native paragraph, drawn by the host that measured it")
  verify(MEASURED.all(func(id: String) -> bool: return int(initial.events.get(id, 0)) == 1),
    "Each paragraph received exactly one event for its first layout")
  verify(lines_of("wrap").size() == 3 and lines_of("limited").size() == 2 and lines_of("heh").size() == 1,
    "The wrapped paragraph reports three lines, the limited one the two it shows and HEH one")
  verify(MEASURED.all(func(id: String) -> bool: return absf(height_of(lines_of(id)) - float(node_of(id).fabricHeight)) <= 1.0),
    "The reported heights add up to the height Yoga gave each paragraph")
  verify(MEASURED.all(func(id: String) -> bool: return overlays_follow(id)),
    "The host drew a box and a baseline rule at every reported line, and none more")
  verify(float(lines_of("center")[0].x) > 0.0 and float(lines_of("wrap")[0].x) == 0.0,
    "A centred paragraph reports the x its lines start at, a left aligned one starts at zero")
  var leading: Dictionary = lines_of("leading")[0]
  verify(float(leading.height) == 28.0 and float(leading.ascender) > float(lines_of("wrap")[0].ascender) - 6.0 and float(leading.ascender) + float(leading.descender) == 28.0,
    "An explicit lineHeight of 28 gives each line 28 pixels and a baseline inside its box")
  var baselines := FACES.map(func(id: String) -> float: return float(node_of(id).fabricY) + float(initial.frames[id].ascender))
  var tops := FACES.map(func(id: String) -> float: return float(node_of(id).fabricY))
  verify(absf(baselines.max() - baselines.min()) <= 1.0 and tops.max() - tops.min() > 5.0,
    "The three texts of the baseline row sit at different heights and share one baseline")
  var rule := node_of("baseline-rule")
  verify(not rule.is_empty() and absf(float(rule.fabricY) - baselines[0]) <= 1.0,
    "The rule drawn from the first text's frame and ascender runs along that shared baseline")
  verify(node_of("summary").get("nativeText", "").begins_with("wrap: 3 lines"),
    "React rendered the summary from the event's lines")
  await capture("initial")

  # A real click narrows the column: the paragraphs wrap again, RN delivers new lines and the boxes follow.
  await click("resize")
  var narrowed := await wait_for(func() -> bool: return example().get("narrow", false) and lines_of("wrap").size() > 3)
  await frames(8)
  var after := example()
  stages.narrow = {"example": after, "nodes": surface_state().get("nodes", [])}
  verify(narrowed and after.narrow, "A click on the button narrows the column and the wrapped paragraph reports more lines")
  verify(int(after.events.wrap) > int(initial.events.wrap) and int(after.events.heh) == int(initial.events.heh),
    "The wrapped paragraph received a new event and HEH, whose lines did not change, received none")
  verify(MEASURED.all(func(id: String) -> bool: return overlays_follow(id)),
    "The boxes and rules follow the new lines")
  verify(MEASURED.all(func(id: String) -> bool: return absf(height_of(lines_of(id)) - float(node_of(id).fabricHeight)) <= 1.0),
    "The reported heights still add up to the height of each paragraph")
  verify(node_of("summary").get("nativeText", "") != "" and not node_of("summary").nativeText.begins_with("wrap: 3 lines"),
    "The summary shows the new lines")
  verify(native_state().get("errors", []).is_empty(), "The run raised no host error")
  await capture("narrow")
  await finish()

func finish() -> void:
  application.call("stop")
  await frames(8)
  var stopped := native_state()
  verify(stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("errors", []).is_empty(),
    "Stop releases the root without a host error")
  var report := {"scenario": "text-layout", "godot": Engine.get_version_info().string, "react": "19.2.3", "reactNative": "0.87.1",
    "engine": "hermes", "renderer": "fabric", "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "images": images, "applicationStopped": stopped}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/report.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the text layout report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  var failed := checks.any(func(entry: Dictionary) -> bool: return not entry.passed)
  print("FABRIC_VALIDATION_FAILED: text-layout" if failed else "FABRIC_VALIDATION_PASSED: text-layout " + str(checks.size()))
  get_tree().quit(1 if failed else 0)
