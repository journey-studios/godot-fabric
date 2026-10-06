extends Node

# RN's uniform `scale` on actual Godot Controls. RN writes `scale: n` as
# scale3d(n, n, n); the host used to reject that matrix for its z entry
# (E_TRANSFORM_3D), so every static or animated `scale` failed. Five fresh
# applications mount the public styles: a scale, a scale with a rotation, a scale
# about a transformOrigin, an Animated.View scaled by the native driver, first by
# RN's own timing and then back by a real press on its Pop button, and a Pressable
# that carries the scale itself and takes real mouse presses where only the scale
# reaches. Each Control is compared with an analytical planar matrix derived from
# the JSX declaration, not from the Control, RN's measurements or anything else the
# host reports.
#
#   godot --path . res://examples/transforms/uniform-scale.tscn -- --validate
#     [--capture] [--allow-original-negative]
#
# --capture saves the frame and checks pixels (needs the native renderer).
# --allow-original-negative runs the same checks on the preceding host, which has
# no uniform scale: it must fail exactly the checks in expected_original_failures().
const MODES := ["uniform", "uniform-rotate", "uniform-origin", "uniform-animated", "uniform-press"]
# The cases whose box is a plain View with a static style.
const VIEW_MODES := ["uniform", "uniform-rotate", "uniform-origin"]
const ANIMATED := "uniform-animated"
const PRESS := "uniform-press"
# Three narrow cards over two wide ones, each a Godot Surface of its own.
const SURFACES := {
  "uniform": Rect2(5, 10, 290, 325), "uniform-rotate": Rect2(305, 10, 290, 325), "uniform-origin": Rect2(605, 10, 290, 325),
  "uniform-animated": Rect2(5, 345, 440, 325), "uniform-press": Rect2(455, 345, 440, 325),
}
const BOX_LEFT := {"uniform": 65.0, "uniform-rotate": 65.0, "uniform-origin": 65.0, "uniform-animated": 140.0, "uniform-press": 140.0}
const BOX_TOP := 140.0
const COLORS := {"uniform": "#0ea5e9", "uniform-rotate": "#f59e0b", "uniform-origin": "#a855f7", "uniform-animated": "#22c55e",
  "uniform-press": "#ec4899"}
const CARD := "#16233b"
const MARKER := "#f8fafc"
const BOX_SIZE := Vector2(160, 100)
const END_SCALE := 1.5
const PRESS_SCALE := 1.2
const DEVICE := 1001
const TOLERANCE := 1e-3
# RN's FrameAnimationDriver rounds the frame index and extends the segment
# linearly, so an ease curve strays from its ends by about 1e-4 in the first
# frames (FrameAnimationDriver.cpp, update). That is RN's own curve on every
# platform; the scale may stray from [1, 1.5] by this much.
const CURVE_SLACK := 1e-3
# The two presses, in the box's own coordinates (the unscaled layout box is
# (0, 0) to (160, 100); the scale 1.2 about its centre covers (-16, -10) to
# (176, 110)). The miss is left of both; the hit is left of and below the layout
# box and inside the scaled one, so only a host that hit-tests the scaled
# geometry delivers it.
const PRESS_MISS := Vector2(-24, 50)
const PRESS_HIT := Vector2(-8, 104)
const PRESS_HOLD := 0.2
const PRESS_SETTLE := 0.3
# The caption the Pressable's card shows before any press, and after the press: the
# point the scaled matrix maps the hit to, to one decimal, as the JSX formats it.
const PRESS_IDLE := "a Pressable under a uniform scale"

# Points in the Surface, relative to the unscaled layout box, and the color the
# analytical matrix paints there: the box, the card behind it or the origin marker.
# Each case has points outside the layout box that the transform covers or leaves,
# all inside the card.
const PIXELS := {
  "uniform": [[Vector2(-20, 50), "box"], [Vector2(180, 50), "box"], [Vector2(80, -10), "box"], [Vector2(80, 110), "box"],
    [Vector2(-55, 50), "card"], [Vector2(80, 135), "card"]],
  "uniform-rotate": [[Vector2(80, 50), "box"], [Vector2(106, 65), "box"], [Vector2(58, 37), "box"], [Vector2(10, 50), "card"],
    [Vector2(150, 50), "card"], [Vector2(118, 27), "card"], [Vector2(42, 73), "card"]],
  "uniform-origin": [[Vector2(-10, 10), "box"], [Vector2(190, 50), "box"], [Vector2(80, -20), "box"], [Vector2(80, 108), "box"],
    [Vector2(-40, 50), "card"], [Vector2(80, 120), "card"], [Vector2(80, -50), "card"], [Vector2(40, 75), "marker"]],
  "uniform-animated": [[Vector2(-20, 50), "box"], [Vector2(180, 50), "box"], [Vector2(80, -10), "box"], [Vector2(-60, 50), "card"],
    [Vector2(80, 135), "card"]],
  "uniform-press": [[Vector2(-8, 50), "box"], [Vector2(168, 50), "box"], [Vector2(80, -5), "box"], [Vector2(80, 105), "box"],
    [Vector2(-8, 104), "box"], [Vector2(-24, 50), "card"], [Vector2(184, 50), "card"], [Vector2(80, -16), "card"],
    [Vector2(80, 118), "card"]],
}

# Check sentences, named "<case>/<sentence>". The ones listed by
# expected_original_failures() need the host to accept m[10] != 1; the others hold
# on the preceding host as well.
const MOUNT := "Mounting the public style raises no host error"
const MATRIX := "The Control carries the analytical planar matrix: six affine coefficients and four corners"
const FACTORS := "The Control scale is uniform at the declared factor, its angle is the declared rotation and its position adds the origin translation"
const STABLE := "The matrix and the layout size stay put across later frames without a host error"
const REST := "The Animated.View mounts at rest: scale 1 on both axes with RN's native backend attached and idle"
const RUNS := "The native animation runs to its end without a host error and RN reports finished once"
const FRAMES := "Every frame of the Control is a uniform planar scale of its own analytical matrix and the Control changes only on frames the backend delivered"
const FINAL := "After the end commit the Control rests at scale 1.5 with the analytical matrix and React never committed per frame"
const BACK := "A real press on Pop animates the scale back to 1: every frame is planar and the Control returns to identity"
const MISSED := "A real mouse press outside the scaled bounds reaches no Pressable and leaves no contact"
const PRESSED := "A real mouse press outside the layout bounds but inside the scaled bounds fires pressIn, pressOut and press once at the point the scaled matrix maps it to"
const PAINTED := "Rendered pixels follow the analytical planar matrix: grown and shrunk boxes against the card"
const RELEASED := "Stopping the application releases the Control, its tag and every scheduling resource"

var checks: Array = []
var evidence: Dictionary = {}
var images: Array = []
var apps: Dictionary = {}
var surfaces: Dictionary = {}
var capturing := false
var negative := false
# The timestamp (RN's backend, in ms) of the first frame the animated application delivered:
# the origin of the timestamps its samples record, null before any.
var frame_origin: Variant = null

func verify(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func frames(count: int = 6) -> void:
  for index in range(count):
    await get_tree().process_frame

func snapshot(node: Node) -> Dictionary:
  var value: Variant = JSON.parse_string(node.call("snapshot"))
  return value if value is Dictionary else {}

func state(mode: String) -> Dictionary:
  var value: Variant = JSON.parse_string(str(apps[mode].call("evaluate", "JSON.stringify(UniformScale.state())")))
  return value if value is Dictionary else {}

func backend(mode: String) -> Dictionary:
  var value: Variant = snapshot(apps[mode]).get("nativeAnimated", {})
  return value if value is Dictionary else {}

func control(mode: String, id: String) -> Control:
  return surfaces[mode].find_child(id, true, false) as Control

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

func corners(value: Transform2D, size: Vector2) -> Array:
  var result: Array = []
  for local: Vector2 in [Vector2.ZERO, Vector2(size.x, 0), size, Vector2(0, size.y)]:
    var point := value * local
    result.append([point.x, point.y])
  return result

func translated(value: Vector2) -> Transform2D:
  return Transform2D(0.0, value)

func scaled(x: float, y: float) -> Transform2D:
  return Transform2D(Vector2(x, 0), Vector2(0, y), Vector2.ZERO)

func rotated(degrees: float) -> Transform2D:
  return Transform2D(deg_to_rad(degrees), Vector2.ZERO)

func around(value: Transform2D, origin: Vector2) -> Transform2D:
  return translated(origin) * value * translated(-origin)

# Where the JSX puts the unscaled layout box inside its Surface.
func box_position(mode: String) -> Vector2:
  return Vector2(BOX_LEFT[mode], BOX_TOP)

# What the JSX declares, in the box's own coordinates.
func declared(mode: String) -> Dictionary:
  match mode:
    "uniform-rotate":
      return {"factor": 0.5, "degrees": 30.0, "origin": BOX_SIZE / 2}
    "uniform-origin":
      return {"factor": 1.5, "degrees": 0.0, "origin": Vector2(BOX_SIZE.x * 0.25, BOX_SIZE.y * 0.75)}
    "uniform-press":
      return {"factor": PRESS_SCALE, "degrees": 0.0, "origin": BOX_SIZE / 2}
  return {"factor": END_SCALE, "degrees": 0.0, "origin": BOX_SIZE / 2}

# The planar matrix those declarations mean: the scale (and rotation) about the
# origin, placed at the box's Yoga position. The Control pivots about its center,
# so its own position carries the origin's translation: origin - M * origin
# measured from the center.
func placement(mode: String, factor: float) -> Dictionary:
  var style := declared(mode)
  var origin: Vector2 = style.origin
  var matrix := scaled(factor, factor) * rotated(float(style.degrees))
  var shift := origin - BOX_SIZE / 2
  var anchor := box_position(mode)
  var local := translated(anchor) * around(matrix, origin)
  var surface_origin: Vector2 = SURFACES[mode].position
  return {"matrix": matrix, "origin": origin, "local": local, "page": translated(surface_origin) * local,
    "position": anchor + shift - matrix.basis_xform(shift)}

func expected_original_failures() -> Array:
  var names: Array = []
  for mode in VIEW_MODES + [PRESS]:
    for sentence in [MOUNT, MATRIX, FACTORS, STABLE]:
      names.append(mode + "/" + sentence)
  for sentence in [MISSED, PRESSED]:
    names.append(PRESS + "/" + sentence)
  for sentence in [RUNS, FRAMES, FINAL, BACK]:
    names.append(ANIMATED + "/" + sentence)
  if capturing:
    for mode in MODES:
      names.append(mode + "/" + PAINTED)
  return names

func build() -> void:
  for mode in MODES:
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
    surface.set("component_name", "UniformScaleCase")
    surface.set("initial_props", {"mode": mode})
    surface.position = SURFACES[mode].position
    surface.size = SURFACES[mode].size
    # The cases that take real mouse input from this script, on the validation device.
    if mode in [ANIMATED, PRESS]:
      surface.set_meta("validation_input_device", DEVICE)
    holder.add_child(surface)
    apps[mode] = app
    surfaces[mode] = surface

func mounted(mode: String) -> void:
  var deadline := Time.get_ticks_msec() + 5000
  while Time.get_ticks_msec() < deadline and control(mode, "scale-box") == null and snapshot(apps[mode]).get("errors", []).is_empty():
    await frames(1)
  await frames(6)

func static_case(mode: String) -> void:
  var app: Node = apps[mode]
  var box := control(mode, "scale-box")
  var errors: Array = snapshot(app).get("errors", [])
  evidence[mode] = {"mode": mode, "errors": errors, "surfaceOrigin": [SURFACES[mode].position.x, SURFACES[mode].position.y]}
  verify(box != null and errors.is_empty(), mode + "/" + MOUNT)
  if box == null:
    for sentence in [MATRIX, FACTORS, STABLE]:
      verify(false, mode + "/" + sentence)
    return
  var style := declared(mode)
  var plan := placement(mode, float(style.factor))
  var global: Transform2D = box.get_global_transform_with_canvas()
  var native_corners := corners(global, BOX_SIZE)
  var expected_corners := corners(plan.page, BOX_SIZE)
  var corners_match := true
  for index in range(4):
    corners_match = corners_match and close_values(native_corners[index], expected_corners[index])
  verify(corners_match and close_values(affine_values(global), affine_values(plan.page)), mode + "/" + MATRIX)
  var turn := wrapf(angle(box) - deg_to_rad(float(style.degrees)), -PI, PI)
  verify((absf(box.scale.x - float(style.factor)) < 1e-6 and absf(box.scale.y - float(style.factor)) < 1e-6 and absf(turn) < 1e-5 and
    close_values([box.position.x, box.position.y], [plan.position.x, plan.position.y])), mode + "/" + FACTORS)
  evidence[mode]["native"] = {"global": affine_values(global), "corners": native_corners, "scale": [box.scale.x, box.scale.y],
    "angle": angle(box), "rotation": box.rotation, "position": [box.position.x, box.position.y], "size": [box.size.x, box.size.y],
    "offsetEnabled": box.get("offset_transform_enabled") == true}
  evidence[mode]["expected"] = {"global": affine_values(plan.page), "corners": expected_corners,
    "position": [plan.position.x, plan.position.y]}
  await frames(12)
  var later_errors: Array = snapshot(app).get("errors", [])
  verify((is_instance_valid(box) and close_values(affine_values(box.get_global_transform_with_canvas()), affine_values(global), 1e-9) and
    box.size.is_equal_approx(BOX_SIZE) and later_errors.is_empty()), mode + "/" + STABLE)

# One observation of the animated box, taken as a Godot frame starts: the previous frame's application
# tick has run, so the Control shows what RN's backend applied for the last timestamp the host delivered
# to it (lastFrameMs, relative to the first one it delivered, null before any).
func sample(box: Control, started: int) -> Dictionary:
  var animated := backend(ANIMATED)
  var delivered := int(animated.get("frames", 0))
  var stamp := float(animated.get("lastFrameMs", 0.0))
  if delivered > 0 and frame_origin == null:
    frame_origin = stamp
  return {"ms": Time.get_ticks_msec() - started, "frames": delivered, "ts": (stamp - float(frame_origin)) if delivered > 0 else null,
    "scale": [box.scale.x, box.scale.y], "angle": angle(box), "global": affine_values(box.get_global_transform_with_canvas())}

# A real mouse press or release at a window point, as the Animated example does. The caller
# waits for the frames that handle it, which is how a press can be sampled while it runs.
func send_mouse(phase: String, point: Vector2) -> void:
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

func mouse(phase: String, point: Vector2) -> void:
  send_mouse(phase, point)
  await frames(2)

# One animation, frame by frame, from a sample taken before `start` runs until RN has
# reported `ends` ends. A host that fails mid-animation may tear the tree down, so the
# Control is looked up every frame instead of held. The end callback commits once (the
# caption): twelve more frames show the Control survives it.
func run_leg(ends: int, start: Callable) -> Array:
  var samples: Array = []
  var started := Time.get_ticks_msec()
  var resting := control(ANIMATED, "scale-box")
  if resting != null:
    samples.append(sample(resting, started))
  start.call()
  while Time.get_ticks_msec() - started < 6000:
    await frames(1)
    var live := control(ANIMATED, "scale-box")
    if live == null:
      break
    samples.append(sample(live, started))
    if state(ANIMATED).get("ends", []).size() == ends:
      break
  await frames(12)
  var settled := control(ANIMATED, "scale-box")
  if settled != null:
    samples.append(sample(settled, started))
  return samples

# Whether every frame of a leg from one scale to another is a uniform planar scale of
# its own analytical matrix, stays between the ends (within the curve's slack) and goes
# from one end to the other.
# How the host paces its frames is not the probe's to assume: how many it delivers, how
# far apart, and whether the scale steps back where RN's driver rounds its table index
# are all the host's own. So the probe asks only for what holds at any pacing: the
# backend delivered more than one frame (the first and the one that ends the animation,
# which sets the end value itself), at most one per Godot frame, and the Control changed
# only on a sample that follows a frame it delivered. The oracle recomputes the scale of
# every frame from the delivered timestamps and owns the rest.
func judge(samples: Array, from: float, to: float) -> bool:
  if samples.size() < 2:
    return false
  var low := minf(from, to)
  var high := maxf(from, to)
  var uniform := true
  var in_range := true
  var planar := true
  var driven := true
  for index in range(samples.size()):
    var entry: Dictionary = samples[index]
    if index > 0:
      var before: Dictionary = samples[index - 1]
      var delivered := int(entry.frames) - int(before.frames)
      driven = driven and (delivered == 0 or delivered == 1)
      if delivered == 0:
        driven = driven and entry.scale == before.scale and entry.angle == before.angle and entry.global == before.global
    var factor := float(entry.scale[0])
    uniform = uniform and absf(factor - float(entry.scale[1])) <= 1e-6 and absf(float(entry.angle)) <= 1e-6
    in_range = in_range and factor >= low - CURVE_SLACK and factor <= high + CURVE_SLACK
    planar = planar and close_values(entry.global, affine_values(placement(ANIMATED, factor).page))
  var delivered_in_leg := int(samples.back().frames) - int(samples[0].frames)
  var from_start := absf(float(samples[0].scale[0]) - from) <= 1e-6
  var to_end := absf(float(samples.back().scale[0]) - to) <= 1e-6
  return delivered_in_leg >= 2 and driven and from_start and to_end and uniform and in_range and planar

func animated_case() -> void:
  var app: Node = apps[ANIMATED]
  var box := control(ANIMATED, "scale-box")
  var before_errors: Array = snapshot(app).get("errors", [])
  evidence[ANIMATED] = {"mode": ANIMATED, "surfaceOrigin": [SURFACES[ANIMATED].position.x, SURFACES[ANIMATED].position.y]}
  if box == null:
    for sentence in [REST, RUNS, FRAMES, FINAL, BACK]:
      verify(false, ANIMATED + "/" + sentence)
    return
  var rest := placement(ANIMATED, 1.0)
  var idle := backend(ANIMATED)
  verify((before_errors.is_empty() and box.scale.is_equal_approx(Vector2.ONE) and absf(angle(box)) < 1e-6 and
    close_values(affine_values(box.get_global_transform_with_canvas()), affine_values(rest.page)) and idle.get("enabled") == true and
    int(idle.get("frames", -1)) == 0 and idle.get("active") == false), ANIMATED + "/" + REST)
  var samples := await run_leg(1, func() -> void: apps[ANIMATED].call("evaluate", "UniformScale.run()"))
  var last: Dictionary = samples.back() if not samples.is_empty() else {}
  var after := state(ANIMATED)
  var running := backend(ANIMATED)
  var errors: Array = snapshot(app).get("errors", [])
  var ends: Array = after.get("ends", [])
  verify((errors.is_empty() and ends.size() == 1 and ends[0].get("finished") == true and float(ends[0].get("toValue", 0)) == END_SCALE and
    int(running.get("staleDirectUpdates", -1)) == 0), ANIMATED + "/" + RUNS)
  verify(judge(samples, 1.0, END_SCALE), ANIMATED + "/" + FRAMES)
  var final_plan := placement(ANIMATED, END_SCALE)
  verify((not last.is_empty() and absf(float(last.scale[0]) - END_SCALE) < 1e-6 and absf(float(last.scale[1]) - END_SCALE) < 1e-6 and
    close_values(last.global, affine_values(final_plan.page)) and int(after.get("renders", -1)) == 2 and
    int(running.get("directUpdates", 0)) > 0 and running.get("active") == false), ANIMATED + "/" + FINAL)
  evidence[ANIMATED]["errors"] = errors
  evidence[ANIMATED]["samples"] = samples
  evidence[ANIMATED]["react"] = after
  evidence[ANIMATED]["backend"] = running
  evidence[ANIMATED]["expected"] = {"restGlobal": affine_values(rest.page), "finalGlobal": affine_values(final_plan.page)}
  # The frame shows every case with the animated box at its end, before it goes back.
  if capturing:
    await capture()
  # The press-and-pop half: a real press on the example's own button runs the same
  # animation back to 1, where the matrix is the identity again. The release starts it, so
  # the leg is sampled from before the release and no frame of it goes unobserved.
  var pop := control(ANIMATED, "scale-pop")
  var pressed := pop != null
  var back_samples: Array = []
  if pop != null:
    var center := pop.get_global_rect().get_center()
    await mouse("down", center)
    await frames(4)
    back_samples = await run_leg(2, func() -> void: send_mouse("up", center))
  var home := control(ANIMATED, "scale-box")
  var back_state := state(ANIMATED)
  var back_ends: Array = back_state.get("ends", [])
  var back_errors: Array = snapshot(app).get("errors", [])
  verify((pressed and home != null and judge(back_samples, END_SCALE, 1.0) and back_errors.is_empty() and back_ends.size() == 2 and
    back_ends[1].get("finished") == true and float(back_ends[1].get("toValue", -1)) == 1.0 and int(back_state.get("runs", 0)) == 2 and
    int(back_state.get("renders", -1)) == 3 and home.scale.is_equal_approx(Vector2.ONE) and absf(angle(home)) < 1e-6 and
    home.get("offset_transform_enabled") != true and
    close_values(affine_values(home.get_global_transform_with_canvas()), affine_values(rest.page))), ANIMATED + "/" + BACK)
  evidence[ANIMATED]["back"] = {"samples": back_samples, "react": back_state, "errors": back_errors}

func settle(seconds: float) -> void:
  await get_tree().create_timer(seconds).timeout
  await frames(2)

func native_text(mode: String, id: String) -> String:
  for entry in snapshot(surfaces[mode]).get("nodes", []):
    if entry.get("testID", "") == id:
      return str(entry.get("nativeText", ""))
  return ""

func tag_of(mode: String, id: String) -> int:
  for entry in snapshot(surfaces[mode]).get("nodes", []):
    if entry.get("testID", "") == id:
      return int(entry.get("tag", -1))
  return -1

# A scaled Pressable under two real mouse presses on the validation device: one
# outside the scaled bounds, which reaches nothing, and one outside the layout box
# but inside the scaled one, which only a host that hit-tests the scaled geometry
# delivers. A press held for PRESS_HOLD outlasts Pressability's minimum press
# duration, so pressOut is not deferred past the release.
func press_case() -> void:
  await static_case(PRESS)
  var app: Node = apps[PRESS]
  var surface: Control = surfaces[PRESS]
  var box := control(PRESS, "scale-box")
  if box == null:
    verify(false, PRESS + "/" + MISSED)
    verify(false, PRESS + "/" + PRESSED)
    return
  var layout := box_position(PRESS)
  var origin: Vector2 = SURFACES[PRESS].position
  var miss := origin + layout + PRESS_MISS
  var hit := origin + layout + PRESS_HIT
  var local: Transform2D = placement(PRESS, PRESS_SCALE).local
  # Where the scaled matrix puts each press in the Pressable's own coordinates. The
  # table must mean what it says or it would prove nothing: the hit is outside the
  # layout box and inside the scaled one, the miss outside both.
  var expected_local: Vector2 = local.affine_inverse() * (layout + PRESS_HIT)
  var layout_box := Rect2(Vector2.ZERO, BOX_SIZE)
  var table_agrees := (not layout_box.has_point(PRESS_HIT) and layout_box.has_point(expected_local) and
    not layout_box.has_point(PRESS_MISS) and not layout_box.has_point(local.affine_inverse() * (layout + PRESS_MISS)))
  await mouse("down", miss)
  await settle(PRESS_HOLD)
  await mouse("up", miss)
  await settle(PRESS_SETTLE)
  var after_miss: Array = state(PRESS).get("presses", [])
  var miss_pointer: Dictionary = snapshot(surface).get("pointer", {})
  var miss_caption := native_text(PRESS, "scale-caption")
  verify((table_agrees and after_miss.is_empty() and miss_caption == PRESS_IDLE and miss_pointer.get("activeTouches", -1) == 0 and
    miss_pointer.get("responder", -1) == 0 and snapshot(app).get("errors", []).is_empty()), PRESS + "/" + MISSED)
  var tag := tag_of(PRESS, "scale-box")
  await mouse("down", hit)
  await settle(PRESS_HOLD)
  var held_pointer: Dictionary = snapshot(surface).get("pointer", {})
  await mouse("up", hit)
  await settle(PRESS_SETTLE)
  var presses: Array = state(PRESS).get("presses", [])
  var hit_pointer: Dictionary = snapshot(surface).get("pointer", {})
  var kinds: Array = []
  var located := true
  for entry: Dictionary in presses:
    kinds.append(entry.get("type", ""))
    located = (located and int(entry.get("target", -1)) == tag and
      close_values([entry.get("locationX", -999), entry.get("locationY", -999)], [expected_local.x, expected_local.y], 0.01) and
      close_values([entry.get("pageX", -999), entry.get("pageY", -999)], [layout.x + PRESS_HIT.x, layout.y + PRESS_HIT.y], 0.01))
  var sorted_kinds := kinds.duplicate()
  sorted_kinds.sort()
  var hit_caption := native_text(PRESS, "scale-caption")
  var shown := "pressed at (%.1f, %.1f) in its own coordinates" % [expected_local.x, expected_local.y]
  verify((tag > 0 and table_agrees and presses.size() == 3 and sorted_kinds == ["in", "out", "press"] and kinds[0] == "in" and located and
    hit_caption == shown and
    held_pointer.get("activeTouches", -1) == 1 and int(held_pointer.get("responder", -1)) == tag and
    hit_pointer.get("activeTouches", -1) == 0 and hit_pointer.get("responder", -1) == 0 and snapshot(app).get("errors", []).is_empty()),
    PRESS + "/" + PRESSED)
  evidence[PRESS]["press"] = {"missPoint": [miss.x, miss.y], "hitPoint": [hit.x, hit.y], "targetTag": tag,
    "afterMiss": {"presses": after_miss, "pointer": miss_pointer, "caption": miss_caption}, "held": held_pointer, "presses": presses,
    "afterHit": hit_pointer, "caption": hit_caption,
    "expectedLocal": [expected_local.x, expected_local.y], "expectedPage": [layout.x + PRESS_HIT.x, layout.y + PRESS_HIT.y]}

func capture() -> void:
  await frames(2)
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  verify(image.save_png("res://build/transform-uniform-scale.png") == OK, "Native uniform-scale capture saved")
  images.append({"file": "build/transform-uniform-scale.png", "width": image.get_width(), "height": image.get_height(), "samples": []})
  for mode in MODES:
    var passed := true
    var plan := placement(mode, END_SCALE if mode == ANIMATED else float(declared(mode).factor))
    var inverse: Transform2D = plan.local.affine_inverse()
    for entry: Array in PIXELS[mode]:
      var offset: Vector2 = entry[0]
      var kind: String = entry[1]
      var logical: Vector2 = SURFACES[mode].position + box_position(mode) + offset
      var physical: Vector2 = get_window().get_final_transform() * logical
      var point := Vector2i(floori(physical.x), floori(physical.y))
      var in_bounds := point.x >= 0 and point.y >= 0 and point.x < image.get_width() and point.y < image.get_height()
      var actual := image.get_pixelv(point) if in_bounds else Color.TRANSPARENT
      var expected := Color(COLORS[mode] if kind == "box" else MARKER if kind == "marker" else CARD)
      # The sample table must agree with the matrix, or it would prove nothing.
      var painted := Rect2(Vector2.ZERO, BOX_SIZE).has_point(inverse * (box_position(mode) + offset)) if kind != "marker" else true
      var agrees := painted == (kind != "card")
      var matched := in_bounds and maxf(absf(actual.r - expected.r), maxf(absf(actual.g - expected.g), absf(actual.b - expected.b))) <= 0.025 and actual.a > 0.99
      passed = passed and matched and agrees
      images[0].samples.append({"case": mode, "offset": [offset.x, offset.y], "kind": kind, "point": [point.x, point.y],
        "expected": expected.to_html(false), "actual": [actual.r, actual.g, actual.b, actual.a], "matrixAgrees": agrees, "passed": matched})
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
  evidence[mode]["runtimeId"] = running.get("runtimeId", 0)
  evidence[mode]["applicationInstanceId"] = app.get_instance_id()
  evidence[mode]["afterStop"] = {"stopped": stopped.get("stopped"), "rootCount": stopped.get("rootCount"), "nativeTags": native.get("nativeTags"),
    "creates": native.get("creates"), "deletes": native.get("deletes"), "errors": stopped.get("errors", [])}

func validate() -> void:
  await frames(8)
  for mode in MODES:
    await mounted(mode)
  var runtime_ids: Dictionary = {}
  for mode in MODES:
    runtime_ids[snapshot(apps[mode]).get("runtimeId", 0)] = true
  verify(runtime_ids.size() == MODES.size() and not runtime_ids.has(0), "The five cases run in independent Hermes applications")
  for mode in VIEW_MODES:
    await static_case(mode)
  await press_case()
  await animated_case()
  for mode in MODES:
    await release(mode)
  finish()

func finish() -> void:
  var failed_names: Array = []
  for entry: Dictionary in checks:
    if not entry.passed:
      failed_names.append(entry.name)
  var expected := expected_original_failures()
  failed_names.sort()
  expected.sort()
  var observed := negative and failed_names == expected
  var failed := (failed_names != expected) if negative else not failed_names.is_empty()
  var report := {"schemaVersion": 1, "scenario": "transforms-uniform-scale", "status": ("original-negative" if observed else "failed" if failed else "passed"),
    "failed": failed, "allowOriginalNegative": negative, "originalNegativeObserved": observed, "expectedOriginalFailures": expected,
    "engine": "hermes", "renderer": "fabric", "godot": Engine.get_version_info().string, "reactNative": "0.87.1",
    "displayServer": DisplayServer.get_name(), "capturing": capturing,
    "layout": {"boxLeft": BOX_LEFT, "boxTop": BOX_TOP, "boxSize": [BOX_SIZE.x, BOX_SIZE.y],
      "surfaces": SURFACES.keys().reduce(func(table: Dictionary, mode: String) -> Dictionary:
        var rect: Rect2 = SURFACES[mode]
        table[mode] = [rect.position.x, rect.position.y, rect.size.x, rect.size.y]
        return table, {})},
    "modes": MODES, "checks": checks, "cases": evidence, "images": images}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open("res://build/transforms-uniform-scale.json", FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: Cannot write the uniform-scale report")
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  if negative:
    print("TRANSFORM_UNIFORM_SCALE_ORIGINAL_NEGATIVE: " + str(failed_names.size()) if observed else "TRANSFORM_UNIFORM_SCALE_FAILED")
  else:
    print("TRANSFORM_UNIFORM_SCALE_FAILED" if failed else "TRANSFORM_UNIFORM_SCALE_PASSED: " + str(checks.size()))
  get_tree().quit(1 if failed else 0)

func _ready() -> void:
  if DisplayServer.get_name() == "headless":
    get_window().size = Vector2i(900, 680)
  build()
  if not OS.get_cmdline_user_args().has("--validate"):
    return
  capturing = OS.get_cmdline_user_args().has("--capture")
  negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  await validate()
