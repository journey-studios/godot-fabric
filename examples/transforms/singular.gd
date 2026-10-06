extends Node

# RN's singular transforms on actual Godot Controls. A transform with no inverse
# (scale: 0, scaleX: 0, a rank-one matrix, an animation through 0) leaves nothing of
# its View or subtree drawn or hit in RN and raises no error. The host used to throw
# E_TRANSFORM_SINGULAR for it, so every such style failed, and a press-in animation
# that starts at zero is common. Eight fresh applications mount the public styles:
# scale: 0, scaleX: 0 and a rank-one matrix; a matrix that is not singular but loses
# rank at the float precision the Control stores its scale in; an Animated.View scaled
# by the native driver from 0 to 1 and another from 1 to 0; a scale that React state
# moves through 0, 1.25, 0 and 1; and a pointer captured by a View that collapses
# mid-gesture.
# The box is a Pressable above a Pressable plate: a real mouse press where the box
# was reaches the plate while the box is collapsed and the box once it is shown, and
# the marker child of the box is hidden with it. What RN computes for a degenerate
# matrix (onLayout, getBoundingClientRect, measure) is derived below from the JSX
# declaration with plain arithmetic, not from the Control or from anything else the
# host reports.
#
#   godot --path . res://examples/transforms/singular.tscn -- --validate
#     [--capture] [--allow-original-negative] [--sabotage]
#
# --capture saves the frame and checks pixels (needs the native renderer).
# --allow-original-negative runs the same checks on the preceding host, which throws
# E_TRANSFORM_SINGULAR: it must fail exactly the checks in expected_original_failures().
# --sabotage runs them on a host whose pointer projection has lost its collapsed
# branch (scripts/transform-singular-sabotage.mjs builds it): it must fail exactly the
# checks in expected_sabotage_failures(), which the preceding host cannot isolate.
const MODES := ["scale-zero", "scale-x-zero", "rank-one", "rank-lost", "entrance", "exit", "toggle", "capture"]
# The cases whose box is a plain Pressable with a static style.
const STATIC_MODES := ["scale-zero", "scale-x-zero", "rank-one", "rank-lost"]
const ENTRANCE := "entrance"
const EXIT := "exit"
const TOGGLE := "toggle"
const CAPTURE := "capture"
# Two rows of four cards, each a Godot Surface of its own, with the box at the same place in each.
const SURFACES := {
  "scale-zero": Rect2(5, 10, 215, 325), "scale-x-zero": Rect2(230, 10, 215, 325), "rank-one": Rect2(455, 10, 215, 325),
  "rank-lost": Rect2(680, 10, 215, 325), "entrance": Rect2(5, 345, 215, 325), "exit": Rect2(230, 345, 215, 325),
  "toggle": Rect2(455, 345, 215, 325), "capture": Rect2(680, 345, 215, 325),
}
const BOX_LEFT := 28.0
const BOX_TOP := 140.0
const BOX_SIZE := Vector2(160, 100)
# The marker child of the box, in the box's own coordinates.
const MARKER_RECT := Rect2(14, 14, 28, 28)
# The plate behind the box, in the card's coordinates: the margin on each side, the top and the height.
const PLATE_MARGIN := 6.0
const PLATE_TOP := 110.0
const PLATE_HEIGHT := 160.0
# The capture case's source strip, in the card's coordinates.
const SOURCE_RECT := Rect2(28, 52, 160, 52)
const COLORS := {"scale-zero": "#0ea5e9", "scale-x-zero": "#f59e0b", "rank-one": "#a855f7", "rank-lost": "#6366f1", "entrance": "#22c55e",
  "exit": "#ec4899", "toggle": "#14b8a6", "capture": "#f43f5e"}
const CARD := "#16233b"
const PLATE := "#2d4166"
const SOURCE := "#475569"
const MARKER := "#f8fafc"
# The planar part [a, b, c, d] of the matrix each static case declares: x' = a x + c y, y' = b x + d y.
# The rank-lost one is [2u u; u u] for the smallest float subnormal u = 2^-149 (declared_matrix()).
const MATRICES := {"scale-zero": [0.0, 0.0, 0.0, 0.0], "scale-x-zero": [0.0, 0.0, 0.0, 1.0], "rank-one": [1.0, 5.0, 5.0, 25.0]}
# The scale each step of the toggle case declares.
const TOGGLE_STEPS := [0.0, 1.25, 0.0, 1.0]
const DEVICE := 1001
const TOLERANCE := 1e-3
# RN's FrameAnimationDriver rounds the frame index and extends the segment
# linearly, so an ease curve strays from [0, 1] by about 1e-4 in its first frames
# (FrameAnimationDriver.cpp, update). That is RN's own curve on every platform.
const CURVE_SLACK := 1e-3
# RN's Transform::Scale flattens a factor below this to exactly 0 (isZero), which is
# what collapses a View: a Control is never shown at a smaller scale.
const RN_ZERO := 1e-5
const PRESS_HOLD := 0.2
const PRESS_SETTLE := 0.3
# The capture case's gesture, in the card's coordinates: pressed on the source strip,
# moved over the plate below the visible box (the owner), then over the plate again
# once the owner has collapsed, and released there. The pointer's physical target is
# the plate throughout, so the collapse cancels no contact: only the capture owner
# is inside the collapsed subtree.
const GESTURE_DOWN := Vector2(108, 78)
const GESTURE_FIRST := Vector2(150, 256)
const GESTURE_SECOND := Vector2(160, 260)

# Points in the card, relative to the box's layout position, and the kind of pixel
# the analytical state of the case paints there when the frame is captured: the
# case is hidden (collapsed) or shown at that moment, as declared in captured_scale().
const PIXELS := {
  "scale-zero": [[Vector2(80, 50), "plate"], [Vector2(28, 28), "plate"], [Vector2(130, 75), "plate"], [Vector2(80, -40), "card"]],
  "scale-x-zero": [[Vector2(80, 50), "plate"], [Vector2(28, 28), "plate"], [Vector2(120, 80), "plate"], [Vector2(80, -40), "card"]],
  "rank-one": [[Vector2(80, 50), "plate"], [Vector2(28, 28), "plate"], [Vector2(130, 75), "plate"], [Vector2(80, -40), "card"]],
  "rank-lost": [[Vector2(80, 50), "plate"], [Vector2(28, 28), "plate"], [Vector2(130, 75), "plate"], [Vector2(80, -40), "card"]],
  "entrance": [[Vector2(80, 50), "box"], [Vector2(28, 28), "marker"], [Vector2(130, 80), "box"], [Vector2(80, 120), "plate"]],
  "exit": [[Vector2(80, 50), "plate"], [Vector2(28, 28), "plate"], [Vector2(130, 75), "plate"], [Vector2(80, -40), "card"]],
  "toggle": [[Vector2(80, 50), "box"], [Vector2(15, 22), "marker"], [Vector2(-15, 50), "box"], [Vector2(80, 108), "box"],
    [Vector2(80, 120), "plate"]],
  "capture": [[Vector2(80, 50), "plate"], [Vector2(28, 28), "plate"], [Vector2(80, -60), "source"], [Vector2(80, -33), "card"]],
}

# Check sentences, named "<case>/<sentence>". The ones listed by
# expected_original_failures() need the host to collapse a singular transform; the
# others hold on the preceding host as well.
const MOUNT := "Mounting the public style raises no host error and mounts the View's Control"
const HIDDEN := "The collapsed Control and its marker child are hidden, and the Control keeps a finite invertible transform"
const MEASURED := "onLayout keeps the layout box, and RN's getBoundingClientRect, measure and measureInWindow report the boxes RN computes for the declared matrix"
const BEHIND := "A real mouse press where the box would be reaches the plate behind it once and never the collapsed box"
const STABLE := "The Control stays hidden with its layout size and no host error across later frames"
const REST_HIDDEN := "The Animated.View mounts collapsed at scale 0 with RN's native backend attached and idle: hidden, no host error"
const REST_SHOWN := "The Animated.View mounts at scale 1 with RN's native backend attached and idle: shown at the identity matrix, no host error"
const UNHIT := "A real mouse press on the collapsed Animated.View reaches the plate behind it once and never the box"
const HIT := "A real mouse press on the shown Animated.View reaches the box once and never the plate"
const RUNS := "The native animation runs to its end without a host error, RN reports finished once and React never rendered per frame"
const FRAMES_UP := "The Control is hidden at the start, never shown below RN's zero and never hidden once the scale is away from it, every shown frame is the analytical matrix of its own scale, and intermediate frames were drawn"
const FRAMES_DOWN := "The Control is shown at the start, never shown below RN's zero and never hidden until the scale is back near it, every shown frame is the analytical matrix of its own scale, and intermediate frames were drawn"
const SHOWN_END := "At the end the Control rests at scale 1 with the identity matrix, and a real mouse press reaches the box once and never the plate"
const COLLAPSED_END := "At the end the Control is hidden with a finite invertible transform, and a real mouse press reaches the plate once and never the box"
const FOCUS_RELEASED := "The keyboard focus of a field inside the box is released when the native driver collapses it: Godot has no focus owner and JS saw focus and then blur"
const TOGGLE_HIDDEN := "Mounted at scale 0 the box is hidden, and a real mouse press reaches the plate behind it"
const TOGGLE_SHOWN := "State 1.25 shows the Control with the analytical matrix, and a real mouse press reaches the box"
const TOGGLE_CANCELED := "A contact held on the shown box when React collapses it is canceled: pressOut fires, press never does, and the contact and responder are released"
const TOGGLE_HIDDEN_AGAIN := "State 0 hides the Control again with a finite invertible transform, and a real mouse press reaches the plate"
const TOGGLE_IDENTITY := "State 1 shows the Control at the identity matrix after the collapse, and a real mouse press reaches the box"
const TOGGLE_LAYOUT := "onLayout reported the layout box once and never again, and no host error appeared in any of the four states"
const CAPTURE_VISIBLE := "A pointer pressed on the source and captured by the box delivers its moves to the owner in the owner's own coordinates"
const CAPTURE_COLLAPSED := "After the owner collapses, the same captured pointer keeps reaching it with RN's own offsets for its degenerate box, as for display none, and raises no host error"
const CAPTURE_END := "The release reaches the collapsed owner, which then loses the capture, both with the same offsets, the contact released and no host error"
const PAINTED := "Rendered pixels follow the analytical state: the plate, the card, the source and the shown box and marker where each is drawn"
const RELEASED := "Stopping the application releases the Control, its tag and every scheduling resource"

var checks: Array = []
var evidence: Dictionary = {}
var images: Array = []
var apps: Dictionary = {}
var surfaces: Dictionary = {}
var capturing := false
var negative := false
var sabotaged := false

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 6) -> void:
  for index in range(count):
    await get_tree().process_frame

func settle(seconds: float) -> void:
  await get_tree().create_timer(seconds).timeout
  await frames(2)

func snapshot(node: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(node.call("snapshot"))
  return value if value is Dictionary else {}

func evaluate(mode: String, source: String) -> Variant:
  return JSON.parse_string(str(apps[mode].call("evaluate", "JSON.stringify(" + source + ")")))

# A command into the case's JS (SingularTransform.run() and the like): it returns nothing.
func command(mode: String, source: String) -> void:
  apps[mode].call("evaluate", source)

func state(mode: String) -> Dictionary:
  var value: Variant = evaluate(mode, "SingularTransform.state()")
  return value if value is Dictionary else {}

func backend(mode: String) -> Dictionary:
  var value: Variant = snapshot(apps[mode]).get("nativeAnimated", {})
  return value if value is Dictionary else {}

func control(mode: String, id: String) -> Control:
  return surfaces[mode].find_child(id, true, false) as Control

func host_errors(mode: String) -> Array:
  return snapshot(apps[mode]).get("errors", [])

func tag_of(mode: String, id: String) -> int:
  for entry in snapshot(surfaces[mode]).get("nodes", []):
    if entry.get("testID", "") == id:
      return int(entry.get("tag", -1))
  return -1

func native_text(mode: String, id: String) -> String:
  for entry in snapshot(surfaces[mode]).get("nodes", []):
    if entry.get("testID", "") == id:
      return str(entry.get("nativeText", ""))
  return ""

# The angle a Control draws at: a rotation is split between its own transform and
# its offset transform, whose sum is RN's angle.
func angle(node: Control) -> float:
  var offset: float = float(node.get("offset_transform_rotation")) if node.get("offset_transform_enabled") == true else 0.0
  return node.rotation + offset

func close_values(actual: Array, expected: Array, tolerance: float = TOLERANCE) -> bool:
  if actual.size() != expected.size():
    return false
  for index in range(actual.size()):
    if absf(float(actual[index]) - float(expected[index])) > tolerance:
      return false
  return true

func affine_values(value: Transform2D) -> Array:
  return [value.x.x, value.x.y, value.y.x, value.y.y, value.origin.x, value.origin.y]

func translated(value: Vector2) -> Transform2D:
  return Transform2D(0.0, value)

func scaled(x: float, y: float) -> Transform2D:
  return Transform2D(Vector2(x, 0), Vector2(0, y), Vector2.ZERO)

func around(value: Transform2D, origin: Vector2) -> Transform2D:
  return translated(origin) * value * translated(-origin)

# Where the JSX puts the unscaled layout box inside its Surface.
func box_position(_mode: String) -> Vector2:
  return Vector2(BOX_LEFT, BOX_TOP)

func card_origin(mode: String) -> Vector2:
  return SURFACES[mode].position

func box_center(mode: String) -> Vector2:
  return card_origin(mode) + box_position(mode) + BOX_SIZE / 2

# The planar matrix of a uniform scale about the box's center, placed at the box's
# Yoga position inside its Surface and in the window, as the shown states declare it.
func placement(mode: String, factor: float) -> Dictionary:
  var local := translated(box_position(mode)) * around(scaled(factor, factor), BOX_SIZE / 2)
  return {"local": local, "page": translated(card_origin(mode)) * local}

func plate_rect(mode: String) -> Rect2:
  return Rect2(PLATE_MARGIN, PLATE_TOP, SURFACES[mode].size.x - 2 * PLATE_MARGIN, PLATE_HEIGHT)

# The plate's own coordinates of a window point: what a press that reaches it reports.
func plate_local(mode: String, point: Vector2) -> Vector2:
  return point - card_origin(mode) - plate_rect(mode).position

func declared_matrix(mode: String) -> Array:
  if mode == "rank-lost":
    var unit := pow(2.0, -149)
    return [2.0 * unit, unit, unit, unit]
  return MATRICES[mode]

# The box RN computes for a static case: the bounding box of the four corners of the
# layout box mapped by the declared matrix about its center, in the card's coordinates.
func declared_box(mode: String) -> Rect2:
  var matrix := declared_matrix(mode)
  var center := box_position(mode) + BOX_SIZE / 2
  var low := Vector2(INF, INF)
  var high := Vector2(-INF, -INF)
  for corner: Vector2 in [Vector2(-BOX_SIZE.x / 2, -BOX_SIZE.y / 2), Vector2(BOX_SIZE.x / 2, -BOX_SIZE.y / 2),
      BOX_SIZE / 2, Vector2(-BOX_SIZE.x / 2, BOX_SIZE.y / 2)]:
    var mapped := Vector2(matrix[0] * corner.x + matrix[2] * corner.y, matrix[1] * corner.x + matrix[3] * corner.y) + center
    low = Vector2(minf(low.x, mapped.x), minf(low.y, mapped.y))
    high = Vector2(maxf(high.x, mapped.x), maxf(high.y, mapped.y))
  return Rect2(low, high - low)

func expected_original_failures() -> Array:
  var names: Array = []
  for mode: String in STATIC_MODES:
    for sentence in [MOUNT, HIDDEN, MEASURED, BEHIND, STABLE]:
      names.append(mode + "/" + sentence)
  for sentence in [REST_HIDDEN, UNHIT, RUNS, FRAMES_UP, SHOWN_END]:
    names.append(ENTRANCE + "/" + sentence)
  for sentence in [RUNS, FRAMES_DOWN, COLLAPSED_END, FOCUS_RELEASED]:
    names.append(EXIT + "/" + sentence)
  for sentence in [TOGGLE_HIDDEN, TOGGLE_SHOWN, TOGGLE_CANCELED, TOGGLE_HIDDEN_AGAIN, TOGGLE_IDENTITY, TOGGLE_LAYOUT]:
    names.append(TOGGLE + "/" + sentence)
  for sentence in [CAPTURE_COLLAPSED, CAPTURE_END]:
    names.append(CAPTURE + "/" + sentence)
  if capturing:
    for mode: String in MODES:
      names.append(mode + "/" + PAINTED)
  return names

# What a host without the pointer projection's collapsed branch gets wrong, and only
# that: a captured pointer whose owner has collapsed is projected through the owner's
# last invertible transform, so its events report the owner's layout coordinates where
# RN's own payload is expected. Everything the transform step does holds.
func expected_sabotage_failures() -> Array:
  return [CAPTURE + "/" + CAPTURE_COLLAPSED, CAPTURE + "/" + CAPTURE_END]

func build() -> void:
  for mode: String in MODES:
    var holder := Node.new()
    holder.name = "Case_" + mode
    add_child(holder)
    var app: Node = ClassDB.instantiate("FabricApplication")
    app.name = "Application"
    app.set_meta("scenario", "transforms")
    holder.add_child(app)
    var surface: Control = ClassDB.instantiate("FabricSurface")
    surface.name = "Surface"
    surface.set("application_path", NodePath("../Application"))
    surface.set("component_name", "SingularTransformCase")
    surface.set("initial_props", {"mode": mode})
    surface.position = SURFACES[mode].position
    surface.size = SURFACES[mode].size
    # Every case takes real mouse input from this script, on the validation device.
    surface.set_meta("validation_input_device", DEVICE)
    holder.add_child(surface)
    apps[mode] = app
    surfaces[mode] = surface

func mounted(mode: String) -> void:
  var deadline := Time.get_ticks_msec() + 5000
  while Time.get_ticks_msec() < deadline and control(mode, "singular-box") == null and host_errors(mode).is_empty():
    await frames(1)
  await frames(6)

# A real mouse event at a window point, as the Animated example does. A move keeps
# the left button down.
func mouse(phase: String, point: Vector2) -> void:
  if phase == "move":
    var drag := InputEventMouseMotion.new()
    drag.device = DEVICE
    drag.position = point
    drag.button_mask = MOUSE_BUTTON_MASK_LEFT
    Input.parse_input_event(drag)
    await frames(2)
    return
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

# One real press and release at a window point, held longer than Pressability's
# minimum press duration so pressOut is not deferred past the release, with what
# JS logged for it and the host's pointer state while it was held and after.
func press(mode: String, point: Vector2) -> Dictionary:
  var before: int = state(mode).get("presses", []).size()
  await mouse("down", point)
  await settle(PRESS_HOLD)
  var held: Dictionary = snapshot(surfaces[mode]).get("pointer", {})
  await mouse("up", point)
  await settle(PRESS_SETTLE)
  var presses: Array = state(mode).get("presses", []).slice(before)
  return {"point": [point.x, point.y], "presses": presses, "held": held, "after": snapshot(surfaces[mode]).get("pointer", {}),
    "caption": native_text(mode, "singular-caption")}

# Whether a press at the box's center reached `who` once, and nobody else: pressIn
# first, then pressOut and press, every one targeting the tag of `who` and reporting
# the point in its own coordinates (the plate's, or the box's for a scale about its
# center) and in the root's. The contact and the responder are released afterwards.
func reached(mode: String, result: Dictionary, who: String) -> bool:
  var presses: Array = result.get("presses", [])
  var page := box_center(mode) - card_origin(mode)
  var local := plate_local(mode, box_center(mode)) if who == "behind" else BOX_SIZE / 2
  var kinds: Array = []
  var located := true
  for entry: Dictionary in presses:
    kinds.append(entry.get("type", ""))
    located = (located and entry.get("who") == who and int(entry.get("target", -1)) == tag_of(mode, "singular-" + who) and
      close_values([entry.get("locationX", INF), entry.get("locationY", INF), entry.get("pageX", INF), entry.get("pageY", INF)],
        [local.x, local.y, page.x, page.y], 0.01))
  var sorted_kinds := kinds.duplicate()
  sorted_kinds.sort()
  var after: Dictionary = result.get("after", {})
  return (presses.size() == 3 and sorted_kinds == ["in", "out", "press"] and kinds[0] == "in" and located and
    after.get("activeTouches", -1) == 0 and after.get("responder", -1) == 0)

func hidden(mode: String) -> bool:
  var box := control(mode, "singular-box")
  var child := control(mode, "singular-child")
  if box == null or child == null:
    return false
  var global := box.get_global_transform_with_canvas()
  var values := affine_values(global)
  var finite := true
  for value: float in values:
    finite = finite and is_finite(value)
  return (not box.visible and not box.is_visible_in_tree() and not child.is_visible_in_tree() and finite and
    absf(global.determinant()) > 0.0)

func shown(mode: String, factor: float) -> bool:
  var box := control(mode, "singular-box")
  var child := control(mode, "singular-child")
  if box == null or child == null:
    return false
  var want := affine_values(placement(mode, factor).page)
  return (box.visible and box.is_visible_in_tree() and child.is_visible_in_tree() and
    close_values(affine_values(box.get_global_transform_with_canvas()), want) and
    absf(box.scale.x - factor) < 1e-6 and absf(box.scale.y - factor) < 1e-6 and absf(angle(box)) < 1e-6)

func mark(mode: String, key: String, value: Variant) -> void:
  if not evidence.has(mode):
    evidence[mode] = {"mode": mode, "surfaceOrigin": [card_origin(mode).x, card_origin(mode).y]}
  evidence[mode][key] = value

# What the Control and RN's measurements say about the box, for the report.
func record_box(mode: String) -> Dictionary:
  var box := control(mode, "singular-box")
  var result := {"present": box != null}
  if box == null:
    return result
  var global := box.get_global_transform_with_canvas()
  result["visible"] = box.visible
  result["visibleInTree"] = box.is_visible_in_tree()
  var child := control(mode, "singular-child")
  result["childVisibleInTree"] = child != null and child.is_visible_in_tree()
  result["global"] = affine_values(global)
  result["determinant"] = global.determinant()
  result["scale"] = [box.scale.x, box.scale.y]
  result["angle"] = angle(box)
  result["position"] = [box.position.x, box.position.y]
  result["size"] = [box.size.x, box.size.y]
  return result

func rn_read(mode: String) -> Dictionary:
  var value: Variant = evaluate(mode, "GodotTransforms.read('singular-box')")
  return value if value is Dictionary else {}

func rn_layouts(mode: String) -> Array:
  # A box that never mounted has no frames; JSON.stringify(undefined) is not JSON.
  var value: Variant = evaluate(mode, "(GodotTransforms.stats().layouts['singular-box'] ?? [])")
  return value if value is Array else []

func layout_frame(mode: String) -> Dictionary:
  var position := box_position(mode)
  return {"x": position.x, "y": position.y, "width": BOX_SIZE.x, "height": BOX_SIZE.y}

func layouts_unchanged(mode: String) -> bool:
  var frames_seen := rn_layouts(mode)
  var want := layout_frame(mode)
  return frames_seen.size() == 1 and close_values([frames_seen[0].get("x"), frames_seen[0].get("y"), frames_seen[0].get("width"),
    frames_seen[0].get("height")], [want.x, want.y, want.width, want.height], 1e-6)

# RN's own reading of a degenerate box: the declared bounding box in every API. The
# page coordinates of measure() are the root's own; getBoundingClientRect and
# measureInWindow add the root's viewport offset, the Surface's position in the window.
func measured(mode: String, read: Dictionary) -> bool:
  var want := declared_box(mode)
  var position := box_position(mode)
  var origin := card_origin(mode)
  var rect: Dictionary = read.get("rect", {})
  return (layouts_unchanged(mode) and
    close_values([rect.get("x", INF), rect.get("y", INF), rect.get("width", INF), rect.get("height", INF)],
      [origin.x + want.position.x, origin.y + want.position.y, want.size.x, want.size.y]) and
    close_values(read.get("measure", []), [position.x, position.y, want.size.x, want.size.y, want.position.x, want.position.y]) and
    close_values(read.get("window", []), [origin.x + want.position.x, origin.y + want.position.y, want.size.x, want.size.y]))

func static_case(mode: String) -> void:
  var box := control(mode, "singular-box")
  var errors: Array = host_errors(mode)
  mark(mode, "errors", errors)
  verify(box != null and errors.is_empty(), mode + "/" + MOUNT)
  var native := record_box(mode)
  var read := rn_read(mode)
  mark(mode, "native", native)
  mark(mode, "rn", {"layouts": rn_layouts(mode), "read": read})
  verify(box != null and hidden(mode) and errors.is_empty(), mode + "/" + HIDDEN)
  verify(box != null and measured(mode, read), mode + "/" + MEASURED)
  var result := await press(mode, box_center(mode))
  verify(box != null and reached(mode, result, "behind") and result.caption == "box 0 · behind 1", mode + "/" + BEHIND)
  result["tags"] = {"box": tag_of(mode, "singular-box"), "behind": tag_of(mode, "singular-behind")}
  mark(mode, "press", result)
  await frames(12)
  var later := record_box(mode)
  var kept: bool = (box != null and is_instance_valid(box) and hidden(mode) and host_errors(mode).is_empty() and
    close_values(later.get("global", []), native.get("global", []), 1e-9) and close_values(later.get("size", []), [BOX_SIZE.x, BOX_SIZE.y], 1e-6))
  verify(kept, mode + "/" + STABLE)
  mark(mode, "later", later)

func sample(mode: String, started: int) -> Dictionary:
  var box := control(mode, "singular-box")
  return {"ms": Time.get_ticks_msec() - started, "visible": box.visible, "visibleInTree": box.is_visible_in_tree(),
    "scale": [box.scale.x, box.scale.y], "angle": angle(box), "global": affine_values(box.get_global_transform_with_canvas())}

# One animation, frame by frame, from a sample taken before it runs until RN has
# reported its end. A host that fails mid-animation may tear the tree down, so the
# Control is looked up every frame instead of held.
func run_leg(mode: String) -> Array:
  var samples: Array = []
  var started := Time.get_ticks_msec()
  if control(mode, "singular-box") != null:
    samples.append(sample(mode, started))
  command(mode, "SingularTransform.run()")
  while Time.get_ticks_msec() - started < 6000:
    await frames(1)
    if control(mode, "singular-box") == null:
      break
    samples.append(sample(mode, started))
    if state(mode).get("ends", []).size() == 1:
      break
  await frames(12)
  if control(mode, "singular-box") != null:
    samples.append(sample(mode, started))
  return samples

# Whether every frame of a leg is what RN draws at its own scale: hidden (the Control
# keeping a finite invertible transform) while RN's scale is zero, and otherwise shown
# at the analytical matrix of the signed scale its own scale and angle carry. An ease
# curve strays from its start by a hair, so a shown frame can be a tiny mirrored scale
# (a half turn at that scale) and the first frames can fall back through RN's zero:
# the Control collapses and returns within them. It is never shown below RN's own
# zero, and never hidden once the scale is clearly away from it: hidden frames come
# before the first clearly shown one when rising and after the last when falling. The
# scales stay between the ends and move one way, and how many frames were drawn
# strictly between the ends is counted.
func judge(mode: String, samples: Array, rising: bool) -> Dictionary:
  var extreme := 0.0 if rising else 1.0
  var uniform := true
  var monotone := true
  var in_range := true
  var planar := true
  var kept := true
  var drawn := 0
  var away: Array = []
  var hidden_at: Array = []
  for index in range(samples.size()):
    var entry: Dictionary = samples[index]
    var values: Array = entry.global
    # The signed scale comes from the Control's own scale and angle, apart from the global matrix it is compared with.
    var factor := float(entry.scale[0]) * cos(float(entry.angle))
    var finite := true
    for value: float in values:
      finite = finite and is_finite(value)
    kept = kept and finite and absf(float(values[0]) * float(values[3]) - float(values[1]) * float(values[2])) > 0.0
    if not entry.visible:
      hidden_at.append(index)
      continue
    uniform = uniform and absf(float(entry.scale[0]) - float(entry.scale[1])) <= 1e-6 and absf(sin(float(entry.angle))) <= 1e-6
    monotone = monotone and (factor >= extreme - CURVE_SLACK if rising else factor <= extreme + CURVE_SLACK)
    in_range = in_range and absf(factor) >= RN_ZERO - 1e-9 and factor >= -CURVE_SLACK and factor <= 1.0 + CURVE_SLACK
    planar = planar and close_values(values, affine_values(placement(mode, factor).page))
    if factor > 0.001 and factor < 0.999:
      drawn += 1
    if absf(factor) > CURVE_SLACK:
      away.append(index)
    extreme = maxf(extreme, factor) if rising else minf(extreme, factor)
  var boundary: int = -1
  if not away.is_empty():
    boundary = away[0] if rising else away.back()
  var order := boundary >= 0
  for index: int in hidden_at:
    order = order and (index < boundary if rising else index > boundary)
  var first_hidden: bool = not samples.is_empty() and (not samples[0].visible if rising else samples[0].visible)
  var last_shown: bool = not samples.is_empty() and (samples.back().visible if rising else not samples.back().visible)
  return {"ok": (samples.size() >= 8 and first_hidden and last_shown and order and uniform and monotone and in_range and planar and
    kept and drawn >= 3), "drawn": drawn}

func animated_case(mode: String) -> void:
  var rising := mode == ENTRANCE
  var box := control(mode, "singular-box")
  var errors: Array = host_errors(mode)
  mark(mode, "errors", errors)
  var idle := backend(mode)
  var attached: bool = idle.get("enabled") == true and int(idle.get("frames", -1)) == 0 and idle.get("active") == false
  mark(mode, "rest", {"native": record_box(mode), "backend": idle})
  if rising:
    verify(box != null and hidden(mode) and attached and errors.is_empty(), mode + "/" + REST_HIDDEN)
  else:
    verify(box != null and shown(mode, 1.0) and attached and errors.is_empty(), mode + "/" + REST_SHOWN)
  # A real press before the animation: on the collapsed box it reaches the plate, on
  # the shown one it reaches the box.
  var first := await press(mode, box_center(mode))
  var first_who := "behind" if rising else "box"
  var first_ok := box != null and reached(mode, first, first_who)
  first["tags"] = {"box": tag_of(mode, "singular-box"), "behind": tag_of(mode, "singular-behind")}
  mark(mode, "pressBefore", first)
  verify(first_ok, mode + "/" + (UNHIT if rising else HIT))
  var renders_before := int(state(mode).get("renders", -1))
  # The exit box holds a field; the keyboard focus is on it when the animation starts.
  var field := control(mode, "singular-input") as LineEdit
  var focus := {}
  if field != null:
    field.grab_focus()
    await frames(2)
    focus["before"] = {"focused": field.has_focus(), "js": state(mode).get("focus", [])}
  var samples := await run_leg(mode)
  # Godot releases the focus of a Control that stops being visible, subtree included;
  # RN keeps a focused field focused through a collapse, so this one is a departure.
  if field != null:
    var owner := get_viewport().gui_get_focus_owner()
    focus["after"] = {"focused": field.has_focus(), "owner": owner.name if owner != null else "", "js": state(mode).get("focus", [])}
    mark(mode, "focus", focus)
  var after := state(mode)
  var running := backend(mode)
  var run_errors: Array = host_errors(mode)
  var ends: Array = after.get("ends", [])
  var toward := 1.0 if rising else 0.0
  verify((box != null and run_errors.is_empty() and ends.size() == 1 and ends[0].get("finished") == true and
    float(ends[0].get("toValue", -1)) == toward and int(running.get("staleDirectUpdates", -1)) == 0 and
    int(running.get("directUpdates", 0)) > 0 and running.get("active") == false and int(after.get("renders", -2)) == renders_before),
    mode + "/" + RUNS)
  var leg := judge(mode, samples, rising)
  verify(leg.ok, mode + "/" + (FRAMES_UP if rising else FRAMES_DOWN))
  mark(mode, "samples", samples)
  mark(mode, "drawn", leg.drawn)
  mark(mode, "react", after)
  mark(mode, "backend", running)
  mark(mode, "rendersBefore", renders_before)
  mark(mode, "errorsAfterRun", run_errors)
  mark(mode, "end", record_box(mode))
  # At the end the entrance rests shown and the exit hidden: a press tells them apart.
  var last := await press(mode, box_center(mode))
  last["tags"] = {"box": tag_of(mode, "singular-box"), "behind": tag_of(mode, "singular-behind")}
  mark(mode, "pressAfter", last)
  if rising:
    verify(box != null and shown(mode, 1.0) and reached(mode, last, "box") and host_errors(mode).is_empty(), mode + "/" + SHOWN_END)
  else:
    verify(box != null and hidden(mode) and reached(mode, last, "behind") and host_errors(mode).is_empty(), mode + "/" + COLLAPSED_END)
    verify(field != null and focus.before.focused and focus.before.js == ["focus"] and not focus.after.focused and focus.after.owner == "" and
      focus.after.js == ["focus", "blur"], mode + "/" + FOCUS_RELEASED)

# A contact held on the shown box while React collapses it. RN keeps the touch; the
# host cancels it, as it does for every hidden subtree (a Godot Control that is not
# visible takes no input), so pressOut fires and press never does.
func hold_across_collapse(mode: String) -> Dictionary:
  var point := box_center(mode)
  var before: int = state(mode).get("presses", []).size()
  var counters: Dictionary = snapshot(surfaces[mode]).get("pointer", {})
  await mouse("down", point)
  await settle(PRESS_HOLD)
  var held: Dictionary = snapshot(surfaces[mode]).get("pointer", {})
  command(mode, "SingularTransform.advance()")
  await settle(0.1)
  var canceled: Dictionary = snapshot(surfaces[mode]).get("pointer", {})
  await mouse("up", point)
  await settle(PRESS_SETTLE)
  var presses: Array = state(mode).get("presses", []).slice(before)
  return {"point": [point.x, point.y], "presses": presses, "counters": counters, "held": held, "canceled": canceled,
    "after": snapshot(surfaces[mode]).get("pointer", {})}

func canceled(mode: String, result: Dictionary) -> bool:
  var presses: Array = result.get("presses", [])
  var kinds: Array = []
  var from_box := true
  for entry: Dictionary in presses:
    kinds.append(entry.get("type", ""))
    from_box = from_box and entry.get("who") == "box" and int(entry.get("target", -1)) == tag_of(mode, "singular-box")
  var counters: Dictionary = result.get("counters", {})
  var held: Dictionary = result.get("held", {})
  var after_cancel: Dictionary = result.get("canceled", {})
  var after: Dictionary = result.get("after", {})
  return (kinds == ["in", "out"] and from_box and held.get("activeTouches", -1) == 1 and int(held.get("responder", -1)) == tag_of(mode, "singular-box") and
    after_cancel.get("activeTouches", -1) == 0 and after_cancel.get("responder", -1) == 0 and
    int(after_cancel.get("cancels", -1)) == int(counters.get("cancels", -2)) + 1 and
    int(after_cancel.get("pointerCancels", -1)) == int(counters.get("pointerCancels", -2)) + 1 and
    after.get("activeTouches", -1) == 0 and after.get("responder", -1) == 0 and
    int(after.get("cancels", -1)) == int(after_cancel.get("cancels", -2)))

func toggle_case() -> void:
  var mode := TOGGLE
  var errors: Array = host_errors(mode)
  mark(mode, "errors", errors)
  var steps: Array = []
  for index in range(TOGGLE_STEPS.size()):
    var factor: float = TOGGLE_STEPS[index]
    var collapsed := factor == 0.0
    var interrupted := {}
    if index == 2:
      # The step to 0 happens under a held contact on the box shown by step 1.
      interrupted = await hold_across_collapse(mode)
      verify(canceled(mode, interrupted) and hidden(mode) and host_errors(mode).is_empty(), mode + "/" + TOGGLE_CANCELED)
    elif index > 0:
      command(mode, "SingularTransform.advance()")
      await settle(0.1)
    var result := await press(mode, box_center(mode))
    result["tags"] = {"box": tag_of(mode, "singular-box"), "behind": tag_of(mode, "singular-behind")}
    var native := record_box(mode)
    var landed: bool = (hidden(mode) if collapsed else shown(mode, factor)) and reached(mode, result, "behind" if collapsed else "box")
    var step := {"step": index, "declared": factor, "native": native, "press": result}
    if index == 2:
      step["heldAcrossCollapse"] = interrupted
    steps.append(step)
    verify(landed and host_errors(mode).is_empty(), mode + "/" + [TOGGLE_HIDDEN, TOGGLE_SHOWN, TOGGLE_HIDDEN_AGAIN, TOGGLE_IDENTITY][index])
    # The frame is captured with the box shown at the second step.
    if index == 1 and capturing:
      await capture()
  mark(mode, "steps", steps)
  mark(mode, "rn", {"layouts": rn_layouts(mode), "read": rn_read(mode)})
  verify(layouts_unchanged(mode) and host_errors(mode).is_empty(), mode + "/" + TOGGLE_LAYOUT)

# The pointer pressed on the source strip is captured by the box. It moves over the
# plate below the visible box, the box collapses with the pointer still down, and the
# pointer moves on over the plate and is released there.
func capture_case() -> void:
  var mode := CAPTURE
  var origin := card_origin(mode)
  var box := control(mode, "singular-box")
  mark(mode, "errors", host_errors(mode))
  if box == null:
    for sentence in [CAPTURE_VISIBLE, CAPTURE_COLLAPSED, CAPTURE_END]:
      verify(false, mode + "/" + sentence)
    return
  # The tags are read while the tree is whole: a host that fails at the collapse loses its nodes.
  var tags := {"box": tag_of(mode, "singular-box"), "source": tag_of(mode, "singular-source"), "behind": tag_of(mode, "singular-behind")}
  await mouse("down", origin + GESTURE_DOWN)
  await frames(4)
  await mouse("move", origin + GESTURE_FIRST)
  await frames(4)
  var before: Array = state(mode).get("pointer", [])
  var before_errors: Array = host_errors(mode)
  command(mode, "SingularTransform.collapseOwner()")
  await frames(8)
  var collapsed_owner := hidden(mode)
  await mouse("move", origin + GESTURE_SECOND)
  await frames(4)
  var moved: Array = state(mode).get("pointer", [])
  var moved_errors: Array = host_errors(mode)
  await mouse("up", origin + GESTURE_SECOND)
  await frames(8)
  var finished: Array = state(mode).get("pointer", [])
  var end_errors: Array = host_errors(mode)
  var contact: Dictionary = snapshot(surfaces[mode]).get("pointer", {})
  mark(mode, "gesture", {"down": [GESTURE_DOWN.x, GESTURE_DOWN.y], "first": [GESTURE_FIRST.x, GESTURE_FIRST.y],
    "second": [GESTURE_SECOND.x, GESTURE_SECOND.y], "beforeCollapse": before, "afterMove": moved, "events": finished,
    "tags": tags, "ownerHiddenAfterCollapse": collapsed_owner, "errorsBeforeCollapse": before_errors, "errorsAfterMove": moved_errors,
    "errorsAtEnd": end_errors, "pointerAtEnd": contact})
  var owner_tag: int = tags.box
  var source_tag: int = tags.source
  # Before the collapse: the source's down, the capture, and one move to the owner in its own coordinates.
  var first_local := GESTURE_FIRST - Vector2(BOX_LEFT, BOX_TOP)
  var down_local := GESTURE_DOWN - SOURCE_RECT.position
  var visible_ok: bool = (before.size() == 3 and before[0].get("type") == "down" and before[0].get("who") == "source" and
    int(before[0].get("target", -1)) == source_tag and close_values([before[0].get("offsetX", INF), before[0].get("offsetY", INF)],
      [down_local.x, down_local.y]) and before[1].get("type") == "gotcapture" and before[1].get("who") == "owner" and
    before[2].get("type") == "move" and before[2].get("who") == "owner" and int(before[2].get("target", -1)) == owner_tag and
    close_values([before[2].get("offsetX", INF), before[2].get("offsetY", INF), before[2].get("clientX", INF), before[2].get("clientY", INF)],
      [first_local.x, first_local.y, GESTURE_FIRST.x, GESTURE_FIRST.y]))
  verify(visible_ok and before_errors.is_empty(), mode + "/" + CAPTURE_VISIBLE)
  # After the collapse the move still reaches the owner. The host projects no offset
  # through a collapsed View (it has no painted affine, like display none), so the
  # offsets stay RN's own: its retargeter subtracts the origin of the owner's
  # transformed box from the client point, and that box is the point scale: 0 leaves
  # at the owner's center. A projection through the Control's last invertible
  # transform would give the owner's layout coordinates instead.
  var upstream := GESTURE_SECOND - (box_position(mode) + BOX_SIZE / 2)
  var after_move: Dictionary = moved[3] if moved.size() == 4 else {}
  var collapsed_ok: bool = (collapsed_owner and moved.size() == 4 and after_move.get("type") == "move" and after_move.get("who") == "owner" and
    int(after_move.get("target", -1)) == owner_tag and close_values([after_move.get("offsetX", INF), after_move.get("offsetY", INF),
      after_move.get("clientX", INF), after_move.get("clientY", INF)], [upstream.x, upstream.y, GESTURE_SECOND.x, GESTURE_SECOND.y]))
  verify(collapsed_ok and moved_errors.is_empty(), mode + "/" + CAPTURE_COLLAPSED)
  var types: Array = []
  var same_offsets := finished.size() == 6
  for entry: Dictionary in finished:
    types.append(str(entry.get("type")))
  if finished.size() == 6:
    for index in [4, 5]:
      same_offsets = same_offsets and close_values([finished[index].get("offsetX", INF), finished[index].get("offsetY", INF),
        finished[index].get("clientX", INF), finished[index].get("clientY", INF)], [upstream.x, upstream.y, GESTURE_SECOND.x, GESTURE_SECOND.y])
  var released: bool = (finished.size() == 6 and types == ["down", "gotcapture", "move", "move", "up", "lostcapture"] and same_offsets and
    contact.get("activePointers", -1) == 0 and contact.get("activeTouches", -1) == 0 and contact.get("responder", -1) == 0)
  verify(released and end_errors.is_empty(), mode + "/" + CAPTURE_END)

func captured_scale(mode: String) -> float:
  # The scale each case declares at the moment the frame is captured (0 is collapsed).
  if mode == ENTRANCE:
    return 1.0
  if mode == TOGGLE:
    return float(TOGGLE_STEPS[1])
  return 0.0

func capture() -> void:
  await frames(2)
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/transform-singular.png") == OK, "Native singular-transform capture saved")
  images.append({"file": "build/transform-singular.png", "width": image.get_width(), "height": image.get_height(), "samples": []})
  for mode: String in MODES:
    var passed := true
    var factor := captured_scale(mode)
    var inverse: Transform2D = placement(mode, factor).local.affine_inverse() if factor != 0.0 else Transform2D.IDENTITY
    for entry: Array in PIXELS[mode]:
      var offset: Vector2 = entry[0]
      var kind: String = entry[1]
      var logical: Vector2 = card_origin(mode) + box_position(mode) + offset
      var physical: Vector2 = get_window().get_final_transform() * logical
      var point := Vector2i(floori(physical.x), floori(physical.y))
      var in_bounds := point.x >= 0 and point.y >= 0 and point.x < image.get_width() and point.y < image.get_height()
      var actual := image.get_pixelv(point) if in_bounds else Color.TRANSPARENT
      var expected := Color(COLORS[mode] if kind == "box" else MARKER if kind == "marker" else SOURCE if kind == "source" else PLATE if kind == "plate" else CARD)
      # The sample table must agree with the analytical state, or it would prove nothing.
      var card_point: Vector2 = box_position(mode) + offset
      var layout_point: Vector2 = inverse * card_point
      var in_box := factor != 0.0 and Rect2(Vector2.ZERO, BOX_SIZE).has_point(layout_point)
      var in_marker := in_box and MARKER_RECT.has_point(layout_point)
      var in_plate := plate_rect(mode).has_point(card_point)
      var in_source := mode == CAPTURE and SOURCE_RECT.has_point(card_point)
      var painted := "marker" if in_marker else "box" if in_box else "source" if in_source else "plate" if in_plate else "card"
      var agrees := painted == kind
      var matched := in_bounds and maxf(absf(actual.r - expected.r), maxf(absf(actual.g - expected.g), absf(actual.b - expected.b))) <= 0.025 and actual.a > 0.99
      passed = passed and matched and agrees
      images[0].samples.append({"case": mode, "offset": [offset.x, offset.y], "kind": kind, "point": [point.x, point.y],
        "expected": expected.to_html(false), "actual": [actual.r, actual.g, actual.b, actual.a], "tableAgrees": agrees, "passed": matched})
    verify(passed, mode + "/" + PAINTED)

func release(mode: String) -> void:
  var app: Node = apps[mode]
  var surface: Control = surfaces[mode]
  var running := snapshot(app)
  app.call("stop")
  await frames(8)
  var stopped := snapshot(app)
  var native := snapshot(surface)
  var animated := stopped.get("nativeAnimated", {}) as Dictionary
  var drained: bool = (stopped.get("stopped", false) and stopped.get("rootCount", -1) == 0 and stopped.get("pendingRootRetirements", -1) == 0 and
    stopped.get("pendingTimers", -1) == 0 and stopped.get("pendingAnimationFrames", -1) == 0 and stopped.get("pendingWork", -1) == 0 and
    not stopped.get("hostPhasePending", true) and native.get("nativeTags", -1) == 0 and
    native.get("creates", -1) == native.get("deletes", -2) and animated.get("active") == false and animated.get("stopped") == true)
  verify(drained, mode + "/" + RELEASED)
  mark(mode, "runtimeId", running.get("runtimeId", 0))
  mark(mode, "applicationInstanceId", app.get_instance_id())
  mark(mode, "afterStop", {"stopped": stopped.get("stopped"), "rootCount": stopped.get("rootCount"), "nativeTags": native.get("nativeTags"),
    "creates": native.get("creates"), "deletes": native.get("deletes"), "errors": stopped.get("errors", [])})

func validate() -> void:
  await frames(8)
  for mode: String in MODES:
    await mounted(mode)
  var runtime_ids: Dictionary = {}
  for mode: String in MODES:
    runtime_ids[snapshot(apps[mode]).get("runtimeId", 0)] = true
  verify(runtime_ids.size() == MODES.size() and not runtime_ids.has(0), "The eight cases run in independent Hermes applications")
  for mode: String in STATIC_MODES:
    await static_case(mode)
  await animated_case(ENTRANCE)
  await animated_case(EXIT)
  await capture_case()
  await toggle_case()
  for mode: String in MODES:
    await release(mode)
  finish()

func finish() -> void:
  var failed_names: Array = []
  for entry: Dictionary in checks:
    if not entry.passed:
      failed_names.append(entry.name)
  var original := expected_original_failures()
  var broken := expected_sabotage_failures()
  var expected: Array = original if negative else broken if sabotaged else []
  failed_names.sort()
  original.sort()
  broken.sort()
  expected.sort()
  var control := negative or sabotaged
  var observed := control and failed_names == expected
  var failed := (failed_names != expected) if control else not failed_names.is_empty()
  var layout_table := {}
  for mode: String in MODES:
    var rect: Rect2 = SURFACES[mode]
    layout_table[mode] = [rect.position.x, rect.position.y, rect.size.x, rect.size.y]
  var report := {"schemaVersion": 1, "scenario": "transforms-singular",
    "status": ("original-negative" if negative and observed else "sabotage-rejected" if sabotaged and observed else "failed" if failed else "passed"),
    "failed": failed, "allowOriginalNegative": negative, "originalNegativeObserved": negative and observed, "expectedOriginalFailures": original,
    "sabotage": sabotaged, "sabotageObserved": sabotaged and observed, "expectedSabotageFailures": broken,
    "engine": "hermes", "renderer": "fabric", "godot": Engine.get_version_info().string, "reactNative": "0.87.1",
    "displayServer": DisplayServer.get_name(), "capturing": capturing,
    "layout": {"boxLeft": BOX_LEFT, "boxTop": BOX_TOP, "boxSize": [BOX_SIZE.x, BOX_SIZE.y], "surfaces": layout_table},
    "modes": MODES, "checks": checks, "cases": evidence, "images": images}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/transforms-singular.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the singular-transform report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  if negative:
    print("TRANSFORM_SINGULAR_ORIGINAL_NEGATIVE: " + str(failed_names.size()) if observed else "TRANSFORM_SINGULAR_FAILED")
  elif sabotaged:
    print("TRANSFORM_SINGULAR_SABOTAGE_REJECTED: " + str(failed_names.size()) if observed else "TRANSFORM_SINGULAR_FAILED")
  else:
    print("TRANSFORM_SINGULAR_FAILED" if failed else "TRANSFORM_SINGULAR_PASSED: " + str(checks.size()))
  get_tree().quit(1 if failed else 0)

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  build()
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  sabotaged = OS.get_cmdline_user_args().has("--sabotage")
  await validate()
