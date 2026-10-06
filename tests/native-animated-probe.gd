extends SceneTree

# RN's original Animated, Easing, useAnimatedValue(XY) and TouchableOpacity,
# through the public react-native import, on two real roots of one application.
# JS records what it observes (tests/native-animated-fixture.jsx). For the
# native driver this probe reads, once per Godot frame and before the
# application's next frame, the timestamp of the frame-clock tick the host
# delivered to RN's AnimationBackend and the opacity and transform of the Godot
# Controls, which is what that tick applied; the independent oracle recomputes
# every sample from those timestamps. --allow-original-negative runs the same
# checks on a host without RN's native module: the checks that need it are
# normative and must fail there, the JS-driver ones must pass on both hosts.
# --sabotage runs them on a deliberately broken host and expects failures.
const DEVICE := 1001
const SIZE := Vector2(400, 570)
const ORIGINS := {"A": Vector2.ZERO, "B": Vector2(420, 0)}
const LIMIT_MS := 3000
# RN's reasons, as src/animated-exports.js words them.
const UNCERTIFIED := {
  "Text": "Godot platform has not certified Animated.Text: it wraps RN's own Text, not the Godot Text",
  "Image": "Godot platform has not certified Animated.Image: Image is not implemented",
  "ScrollView": "Godot platform has not certified Animated.ScrollView: it wraps RN's own ScrollView, not the Godot ScrollView, and Animated.event on that one is not verified",
  "FlatList": "Godot platform has not certified Animated.FlatList: its animated wrapper over the Godot ScrollView is not verified",
  "SectionList": "Godot platform has not certified Animated.SectionList: its animated wrapper over the Godot ScrollView is not verified",
}
var allow_original_negative := false
var sabotage := false
var application: Node
var surfaces: Dictionary = {}
var checks: Array = []
var stages: Dictionary = {}
var expected_original_failures: Array = []
# The first frame timestamp the host reported; samples carry timestamps
# relative to it, which the report's decimal digits then keep exactly.
var origin_ms := 0.0

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check needs RN's native module: a mounted Animated.View, the
# backend's frames or an animation applied to a Control. The preceding host has
# none of them, so it must fail exactly these checks.
func module_check(condition: bool, name: String) -> bool:
  expected_original_failures.append(name)
  return check(condition, name)

func number(value: Variant, fallback: float = -1.0) -> float:
  return float(value) if value is float or value is int else fallback

func settle(count: int = 8) -> void:
  for index in range(count):
    await process_frame

func app_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func animated_state() -> Dictionary:
  var value: Variant = app_state().get("nativeAnimated", {})
  return value if value is Dictionary else {}

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(NativeAnimatedProbe." + expression + ")"))

func act(expression: String) -> void:
  application.call("evaluate", "NativeAnimatedProbe." + expression + ";")

func quote(value: String) -> String:
  return JSON.stringify(value)

# Everything JS recorded since the previous call, in order.
func take() -> Array:
  var value: Variant = js("take()")
  return value if value is Array else []

func control(root_name: String, id: String) -> Control:
  if not surfaces.has(root_name) or not is_instance_valid(surfaces[root_name]):
    return null
  var found: Node = surfaces[root_name].find_child(root_name + "-" + id, true, false)
  return found if found is Control else null

# rotation is the angle the Control draws at: apply_transform splits a rotation
# between the Control's own and its offset transform, whose sum is RN's angle.
func props_of(node: Control) -> Dictionary:
  if node == null:
    return {"present": false}
  var offset: float = float(node.get("offset_transform_rotation")) if node.get("offset_transform_enabled") == true else 0.0
  return {"present": true, "opacity": node.modulate.a, "x": node.position.x, "y": node.position.y,
    "rotation": node.rotation + offset, "scale_x": node.scale.x, "scale_y": node.scale.y}

# One observation, taken as a Godot frame starts: the previous frame's application
# frame has run, so the Controls show what the backend applied for the timestamp
# the host delivered (lastFrameMs). ticks counts the frame clock's ticks: the
# backend only runs on one. Counters read -1 on a host without the backend or
# the clock.
func sample(targets: Array) -> Dictionary:
  var snapshot := app_state()
  var state: Dictionary = snapshot.get("nativeAnimated", {})
  var clock: Dictionary = snapshot.get("frameClock", {})
  var frames := int(number(state.get("frames")))
  var stamp := number(state.get("lastFrameMs"), 0.0)
  if frames > 0 and origin_ms == 0.0:
    origin_ms = stamp
  var row := {"n": Engine.get_process_frames(), "frames": frames, "ts": (stamp - origin_ms) if frames > 0 else null,
    "ticks": int(number(clock.get("ticks"))),
    "now": number(state.get("nowMs"), 0.0) - origin_ms, "active": state.get("active", false),
    "resumes": int(number(state.get("resumes"))), "pauses": int(number(state.get("pauses"))),
    "direct": int(number(state.get("directUpdates"))), "stale": int(number(state.get("staleDirectUpdates"))), "controls": {}}
  for target: Array in targets:
    row.controls[target[0] + "/" + target[1]] = props_of(control(target[0], target[1]))
  return row

# A run follows animations of rendered boxes frame by frame. starts[] hold each
# request (the sample taken just before it) and samples[] one sample per frame.
func begin(targets: Array) -> Dictionary:
  return {"targets": targets, "rest": sample(targets), "starts": [], "samples": [], "events": [], "marks": [],
    "counts": {"before": js("counts()")}}

func start_in(run: Dictionary, root_name: String, name: String, listen: bool = false) -> void:
  var request := sample([])
  var started: Variant = js("start(%s, %s, %s)" % [quote(root_name), quote(name), str(listen)])
  run.starts.append({"root": root_name, "name": name, "at": run.samples.size(), "request": request, "started": started})

func mark(run: Dictionary, kind: String, extra: Dictionary = {}) -> void:
  var entry := {"kind": kind, "at": run.samples.size(), "n": Engine.get_process_frames()}
  entry.merge(extra)
  run.marks.append(entry)

func advance(run: Dictionary, count: int = 1) -> void:
  for index in range(count):
    await process_frame
    var row := sample(run.targets)
    run.samples.append(row)
    for entry: Dictionary in take():
      entry["n"] = row.n
      run.events.append(entry)

# For a wall-clock span, so that "mid-animation" holds at any frame rate.
func advance_for(run: Dictionary, milliseconds: int) -> void:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < milliseconds:
    await advance(run)

func ended(events: Array, name: String) -> bool:
  return events.any(func(entry: Dictionary) -> bool: return entry.get("kind") == "end" and entry.get("label") == name)

# Until the named animation's end callback reached JS, or the limit.
func advance_to_end(run: Dictionary, name: String, limit_ms: int = LIMIT_MS) -> void:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms and not ended(run.events, name):
    await advance(run)

func finish(run: Dictionary, frames: int = 8) -> void:
  await advance(run, frames)
  run.counts["after"] = js("counts()")
  run["final"] = sample(run.targets)

# The samples in which the backend delivered a frame: its counter grew.
func delivered(run: Dictionary) -> Array:
  var out: Array = []
  var previous: int = run.rest.frames
  for row: Dictionary in run.samples:
    if int(row.frames) > previous:
      out.append(row)
    previous = int(row.frames)
  return out

# Every Godot frame delivers at most one animation frame, and each by one.
func one_per_frame(run: Dictionary) -> bool:
  var previous: Dictionary = run.rest
  for row: Dictionary in run.samples:
    if int(row.frames) - int(previous.frames) not in [0, 1] or int(row.n) != int(previous.n) + 1:
      return false
    previous = row
  return true

func end_of(run: Dictionary, name: String) -> Dictionary:
  for entry: Dictionary in run.events:
    if entry.get("kind") == "end" and entry.get("label") == name:
      var result: Variant = entry.get("result", {})
      return result if result is Dictionary else {}
  return {}

func series(run: Dictionary, target: String, key: String) -> Array:
  return run.samples.map(func(row: Dictionary) -> float: return number(row.controls.get(target, {}).get(key)))

func distinct(values: Array) -> int:
  var seen := {}
  for value: float in values:
    seen[value] = true
  return seen.size()

# How many frames an animation takes is the host's frame pacing (a host may stall
# and then deliver Godot frames back to back, and the frame clock turns those into
# ticks no closer than half a refresh period) and, for a decay, its own stop rule: it
# ends at the first step under 0.1. So the probe never asks for the number of frames
# or values a regular 60 Hz clock would give. It asks for what holds at any pacing: a
# driver needs more than one frame, an animation that runs for a duration or to rest
# changes its target on more than one of them, and the Control changes only on frames
# the backend delivered. The oracle recomputes every value from the delivered
# timestamps and owns the rest.
const FEWEST_CHANGES := 2

# How many times a series took a new value, each entry compared with the one before.
func changes(values: Array) -> int:
  var count := 0
  for index in range(1, values.size()):
    if values[index] != values[index - 1]:
      count += 1
  return count

# How many times a Control property took a new value over a run, from its value at
# rest: on a sample in which the backend delivered a frame, and on one in which it did not.
func control_changes(run: Dictionary, target: String, key: String) -> Dictionary:
  var on_frames := 0
  var between_frames := 0
  var previous: Dictionary = run.rest
  for row: Dictionary in run.samples:
    if number(row.controls.get(target, {}).get(key)) != number(previous.controls.get(target, {}).get(key)):
      if int(row.frames) > int(previous.frames):
        on_frames += 1
      else:
        between_frames += 1
    previous = row
  return {"on_frames": on_frames, "between_frames": between_frames}

func counter(run: Dictionary, key: String) -> int:
  return int(number(run.final.get(key))) - int(number(run.rest.get(key)))

func value_events(run: Dictionary) -> int:
  return int(number(run.counts.after.get("valueEvents"))) - int(number(run.counts.before.get("valueEvents")))

# Never backwards by more than the frame driver's own extrapolation between two
# frames (RN rounds to the nearest of its 16.7 ms table frames, so a step may
# overshoot a little): a snap back to the start would be far larger.
func monotone(values: Array, decreasing: bool, tolerance: float = 0.01) -> bool:
  for index in range(1, values.size()):
    if values[index] > values[index - 1] + tolerance if decreasing else values[index] < values[index - 1] - tolerance:
      return false
  return true

func near(value: float, expected: float, tolerance: float = 1e-5) -> bool:
  return absf(value - expected) <= tolerance

func near_angle(value: float, expected: float, tolerance: float = 1e-4) -> bool:
  return absf(wrapf(value - expected, -PI, PI)) <= tolerance

func same_sequence(left: Array, right: Array, tolerance: float) -> bool:
  if left.size() != right.size():
    return false
  for index in range(left.size()):
    if absf(float(left[index]) - float(right[index])) > tolerance:
      return false
  return true

# The checks every native-driver run shares; key is the Control property the
# animation moves, final its expected value at rest (null when the oracle owns it).
func native_run(run: Dictionary, name: String, key: String, final: Variant = null, rich: bool = true) -> void:
  var steps := delivered(run)
  var first: Dictionary = steps[0] if not steps.is_empty() else {}
  var request: Dictionary = run.starts[0].request
  var target: String = run.targets[0][0] + "/" + run.targets[0][1]
  # The backend wants frames from the call on, so the first tick after it serves the
  # request: no tick comes between the call and the backend's first frame.
  module_check((not first.is_empty() and int(first.frames) == int(request.frames) + 1
    and int(first.ticks) == int(request.ticks) + 1 and first.ts != null),
    name + "/The request reaches the backend's next frame-clock tick: the first tick after the call delivers its first frame")
  # The native driver ends with RN's {finished, value, offset}; a composite of
  # animations (an XY value) reports only finished. A host without the module
  # silently runs the JS driver instead, which never has frames to count.
  var result := end_of(run, name)
  module_check((result.get("finished") == true and counter(run, "frames") > 0
    and (not rich or (result.has("value") and result.has("offset")))),
    name + "/The end callback reports finished: true with RN's own result once the backend ran the animation")
  # Over the frames the backend delivered, whatever their pacing: the animation took
  # more than one frame, the Control changed on frames and never between them, and
  # JS heard no per-frame value. How far a decay moves the Control is its own stop
  # rule's and the pacing's (see FEWEST_CHANGES), so only the others must change it on
  # more than one frame; the oracle recomputes every value for every driver.
  var kind: String = js("cases()").animations[name].kind
  var motion := control_changes(run, target, key)
  module_check((value_events(run) == 0 and steps.size() > 1 and motion.between_frames == 0
    and (kind == "decay" or motion.on_frames >= FEWEST_CHANGES)),
    name + "/The Control changes on many frames while JS receives no per-frame value event")
  module_check((counter(run, "resumes") == 1 and counter(run, "pauses") == 1 and run.final.active == false
    and one_per_frame(run) and steps.size() == counter(run, "frames")),
    name + "/The choreographer resumes once and pauses once after the animation, with at most one frame per Godot frame")
  module_check(counter(run, "direct") > 0 and counter(run, "direct") <= counter(run, "frames") and counter(run, "stale") == 0,
    name + "/Each delivered frame applies at most one direct update to the Control and none is dropped")
  var last: float = number(steps.back().ts) if not steps.is_empty() else -1.0
  module_check(number(run.final.get("now")) >= last and number(run.final.get("now")) - last < 5000.0 and last >= 0.0,
    name + "/The backend's own clock reads the host's frame clock")
  if final != null:
    module_check(near(number(run.final.controls[target].get(key)), float(final)),
      name + "/The Control rests at the animation's final output")

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  sabotage = OS.get_cmdline_user_args().has("--sabotage")
  call_deferred("run_probe")

func mount_surface(root_name: String) -> void:
  var surface: Control = ClassDB.instantiate("FabricSurface")
  surface.name = root_name
  surface.position = ORIGINS[root_name]
  surface.size = SIZE
  surface.set("application_path", NodePath("../NativeAnimatedApplication"))
  surface.set("component_name", "NativeAnimatedProbe")
  surface.set("initial_props", {"name": root_name})
  surface.set_meta("validation_input_device", DEVICE)
  surfaces[root_name] = surface
  root.add_child(surface)

func run_probe() -> void:
  root.size = Vector2i(840, 580)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "NativeAnimatedApplication"
  application.set("bundle_path", "res://build/native-animated-probe.js")
  root.add_child(application)
  mount_surface("A")
  mount_surface("B")
  await settle(12)
  mount_case()
  api_case()
  await js_value_case("js-timing")
  await js_value_case("js-spring")
  await js_value_case("js-decay")
  await composition_case()
  await interrupt_case()
  await js_view_case()
  await native_value_case("native-timing", "opacity", 0.2)
  await native_value_case("native-spring", "opacity", 0.2)
  await native_value_case("native-decay", "opacity", null)
  await native_value_case("native-created", "opacity", 0.2)
  await xy_case()
  await stop_case()
  await listener_case()
  await rerender_case()
  await unmount_case()
  await two_roots_case()
  persistence_case()
  await touchable_case()
  await stop_application_case()
  await finish_probe()

func mount_case() -> void:
  var cases: Dictionary = js("cases()")
  var errors: Array = js("renderErrors()")
  var mounted: Dictionary = js("mounted()")
  var state := animated_state()
  var present := true
  var rest := {}
  for root_name: String in ["A", "B"]:
    for id: String in cases.boxes.keys() + ["touchable"]:
      var node := control(root_name, id)
      present = present and node != null
      rest[root_name + "/" + id] = props_of(node)
  stages["mount"] = {"cases": cases, "errors": errors, "mounted": mounted, "rest": rest, "animated": state}
  check(int(app_state().get("rootCount", 0)) == 2 and mounted == {"A": 1.0, "B": 1.0},
    "mount/Two roots of one application mount the fixture once each")
  module_check(present and errors.filter(func(entry: Dictionary) -> bool: return not str(entry.case).begins_with("animated-")).is_empty(),
    "mount/Every Animated.View box and the TouchableOpacity commit a Control in both roots without a render error")
  var messages := {}
  for entry: Dictionary in errors:
    if str(entry.case).begins_with("animated-"):
      messages[entry.root + ":" + str(entry.case).substr(9)] = entry.message
  var expected := {}
  for root_name: String in ["A", "B"]:
    for kind: String in UNCERTIFIED:
      expected[root_name + ":" + kind] = UNCERTIFIED[kind]
  check(messages == expected,
    "mount/Animated.Text, Image, ScrollView, FlatList and SectionList fail where they render, each with its reason")
  module_check((state.get("enabled") == true and int(number(state.get("frames"))) == 0 and state.get("active") == false
    and int(number(state.get("resumes"))) == 0 and int(number(state.get("directUpdates"))) == 0),
    "module/RN's backend is attached to the application before any animation and idles with no frame delivered")

func api_case() -> void:
  var api: Dictionary = js("publicApi()")
  stages["api"] = api
  var missing := []
  for group: String in ["Animated", "Easing"]:
    for name: String in api[group]:
      if api[group][name] == "undefined":
        missing.append(group + "." + name)
  check(missing.is_empty() and api.hooks.useAnimatedValue == "function" and api.hooks.useAnimatedValueXY == "function"
    and api.hooks.TouchableOpacity != "undefined",
    "api/The public react-native import exports Animated, Easing, useAnimatedValue(XY) and TouchableOpacity")

# Until every named label ended in the recorded entries, or the limit.
func record_until(labels: Array, limit_ms: int, events: Array) -> void:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms:
    await process_frame
    events.append_array(take())
    if labels.all(func(label: String) -> bool: return ended(events, label)):
      break
  await settle(4)
  events.append_array(take())

func entries(events: Array, kind: String, label: String) -> Array:
  return events.filter(func(entry: Dictionary) -> bool: return entry.get("kind") == kind and entry.get("label") == label)

func finished_flag(events: Array, label: String) -> Variant:
  var ends := entries(events, "end", label)
  return ends[0].result.get("finished") if ends.size() == 1 else null

# A JS-driver animation of a bare Animated.Value: no view, so any host runs it.
func js_value_case(name: String) -> void:
  var events: Array = take()
  act("startBare(%s)" % quote(name))
  await record_until([name], LIMIT_MS, events)
  stages[name] = {"events": events}
  var values := entries(events, "value", name)
  var last: Dictionary = values.back() if not values.is_empty() else {}
  # RN's decay ends at the first step below 0.1, and two frames that read the
  # same millisecond make a step of 0: it may end after a few values on a loaded
  # machine, so for it the frames' work, not a count, is what must show.
  var minimum := 1 if name == "js-decay" else FEWEST_CHANGES
  check(finished_flag(events, name) == true and values.size() >= minimum,
    name + "/The JS driver reports its values on frames and ends with finished: true")
  if name == "js-decay":
    var previous := 0.0
    var steps: Array = []
    for entry: Dictionary in values:
      steps.append(absf(number(entry.get("value")) - previous))
      previous = number(entry.get("value"))
    check((not steps.is_empty() and steps.back() < 0.1
      and steps.slice(0, steps.size() - 1).all(func(step: float) -> bool: return step >= 0.1)),
      name + "/The last value is where decay's per-frame step fell below 0.1")
  else:
    check((near(number(last.get("value")), 1.0, 0.0) and near(number(last.get("opacity")), 0.2, 1e-12)
      and near(number(last.get("translateX")), 80.0, 1e-12) and str(last.get("rotate")) == "180deg"),
      name + "/The final value and its interpolated opacity, translateX and rotate are exact")

func composition_case() -> void:
  var events: Array = take()
  var started: Variant = js("startComposition()")
  await record_until(["sequence", "parallel", "stagger", "loop"], 3000, events)
  stages["js-composition"] = {"started": started, "events": events}
  var order := func(group: String) -> Array:
    return events.filter(func(entry: Dictionary) -> bool: return (entry.get("kind") == "end"
      and str(entry.label).begins_with(group))).map(func(entry: Dictionary) -> String: return str(entry.label) + ":" + str(entry.result.get("finished")))
  check(order.call("sequence") == ["sequence-0:true", "sequence-1:true", "sequence:true"],
    "js-composition/sequence ends its animations in order and then itself, all finished: true")
  check(order.call("parallel") == ["parallel-0:true", "parallel-1:true", "parallel:true"],
    "js-composition/parallel ends the shorter animation first and itself last, all finished: true")
  check(order.call("stagger") == ["stagger-0:true", "stagger-1:true", "stagger:true"],
    "js-composition/stagger ends its animations in order and then itself, all finished: true")
  check(order.call("loop") == ["loop-iteration:true", "loop-iteration:true", "loop:true"],
    "js-composition/loop runs its animation twice and reports finished: true once at the end")

func interrupt_case() -> void:
  var events: Array = take()
  var started: Variant = js("startInterrupt()")
  await record_until(["stopped", "first", "second"], 3000, events)
  stages["js-interrupt"] = {"started": started, "events": events}
  var stops: Array = entries(events, "stopAnimation", "stopped")
  var stopped_values := entries(events, "value", "stopped")
  check((finished_flag(events, "stopped") == false and stops.size() == 1 and not stopped_values.is_empty()
    and number(stops[0].get("value")) == number(stopped_values.back().get("value"))),
    "js-interrupt/stop() ends the animation with finished: false and stopAnimation reads the last value")
  var replaced := entries(events, "value", "replaced")
  check((finished_flag(events, "first") == false and finished_flag(events, "second") == true and not replaced.is_empty()
    and near(number(replaced.back().get("value")), 0.5, 1e-12)),
    "js-interrupt/A new animation on the same value ends the old one with finished: false and ends at its own target")

# The JS driver on a mounted Animated.View: RN updates the host through
# setNativeProps, never through the native backend.
func js_view_case() -> void:
  var run := begin([["A", "js-view"]])
  start_in(run, "A", "js-view")
  await advance_to_end(run, "js-view")
  await finish(run, 12)
  stages["js-view"] = run
  var opacities := series(run, "A/js-view", "opacity")
  module_check(near(opacities.back(), 0.2) and monotone(opacities, true) and changes(opacities) >= FEWEST_CHANGES,
    "js-view/The JS driver moves an Animated.View's Control from 1 to its final opacity")
  var rest: Dictionary = run.rest.controls["A/js-view"]
  var final: Dictionary = run.final.controls["A/js-view"]
  module_check(near(number(final.get("x")), number(rest.get("x")) + 80.0) and near_angle(number(final.get("rotation")), PI),
    "js-view/The Control rests at the final translateX and rotate")
  module_check((run.rest.frames == 0 and counter(run, "frames") == 0 and counter(run, "resumes") == 0
    and counter(run, "direct") == 0),
    "js-view/The backend is attached and idle, and the JS driver never starts it")

# timing, spring and decay on the native driver, one Animated.View each.
func native_value_case(name: String, key: String, final: Variant) -> void:
  var box: String = js("cases()").animations[name].box
  var run := begin([["A", box]])
  start_in(run, "A", name)
  await advance_to_end(run, name)
  await finish(run, 10)
  stages[name] = run
  native_run(run, name, key, final)

func xy_case() -> void:
  var run := begin([["A", "native-xy"]])
  start_in(run, "A", "native-xy")
  await advance_to_end(run, "native-xy")
  await finish(run, 10)
  stages["native-xy"] = run
  native_run(run, "native-xy", "x", null, false)
  var rest: Dictionary = run.rest.controls["A/native-xy"]
  var final: Dictionary = run.final.controls["A/native-xy"]
  module_check(near(number(final.get("x")), number(rest.get("x")) + 60.0) and near(number(final.get("y")), number(rest.get("y")) + 30.0),
    "native-xy/useAnimatedValueXY moves the Control to its final translateX and translateY")

# stopAnimation reads the value the backend last applied; the animation then stays put.
func stop_case() -> void:
  var run := begin([["A", "native-stop"]])
  start_in(run, "A", "native-stop")
  # Two delivered frames, whatever the pacing: the first anchors the animation and the second
  # moves it, which is all a stop needs to follow. How long that takes is the host's pacing, and
  # a stall can swallow any fixed span of time before the second one.
  var started := Time.get_ticks_msec()
  while delivered(run).size() < 2 and Time.get_ticks_msec() - started < LIMIT_MS:
    await advance(run)
  mark(run, "stopAnimation")
  act("stopAnimation(%s, %s)" % [quote("A"), quote("native-stop")])
  await advance_for(run, 150)
  await finish(run, 4)
  stages["native-stop"] = run
  var at: int = run.marks[0].at
  var opacities: Array = series(run, "A/native-stop", "opacity")
  var stops: Array = run.events.filter(func(entry: Dictionary) -> bool: return entry.get("kind") == "stopAnimation")
  module_check((stops.size() == 1 and at > 0 and absf(number(stops[0].get("value")) - opacities[at - 1]) <= 1.2e-7
    and opacities[at - 1] > 0.0 and opacities[at - 1] < 1.0),
    "native-stop/stopAnimation reads exactly the value last applied to the Control")
  # It moved before the stop: the second delivered frame changes it, as the first only anchors the animation.
  module_check((at > 0 and changes(opacities.slice(0, at)) >= 1
    and opacities.slice(at).all(func(value: float) -> bool: return value == opacities[at - 1])),
    "native-stop/The Control keeps the stopped value on every later frame")
  module_check((end_of(run, "native-stop").get("finished") == false and counter(run, "resumes") == 1
    and counter(run, "pauses") == 1 and run.final.active == false),
    "native-stop/The animation ends with finished: false and the backend resumes once and goes idle")

# Values that reach JS only because a listener asked, equal to what was applied.
func listener_case() -> void:
  var run := begin([["A", "native-listener"]])
  start_in(run, "A", "native-listener", true)
  await advance_to_end(run, "native-listener")
  await advance(run, 8)
  act("unlisten(%s, %s)" % [quote("A"), quote("native-listener")])
  await advance(run, 6)
  var between: Dictionary = js("counts()")
  mark(run, "unlistened", {"valueEvents": between.valueEvents})
  await finish(run, 4)
  stages["native-listener"] = run
  var heard: Array = run.events.filter(func(entry: Dictionary) -> bool: return entry.get("kind") == "listener").map(
    func(entry: Dictionary) -> float: return number(entry.get("value")))
  # The box starts at opacity 0: the first distinct value is the rest, not an update.
  var applied: Array = []
  for value: float in series(run, "A/native-listener", "opacity"):
    if applied.is_empty() or value != applied.back():
      applied.append(value)
  applied = applied.slice(1)
  # RN's end callback also reports the final value to JS listeners, which is why
  # JS hears one value more than the backend sent.
  module_check((heard.size() > FEWEST_CHANGES and value_events(run) == heard.size() - 1 and heard.back() == 1.0
    and same_sequence(heard.slice(0, -1), applied, 1.2e-7)),
    "native-listener/addListener hears exactly the distinct values the backend applied, in order, and the final value once more")
  module_check(int(run.marks[0].valueEvents) > 0 and int(run.marks[0].valueEvents) == value_events(run),
    "native-listener/After removeListener the backend sends no more value events")

# A re-render creates new interpolation nodes; the animation and its final
# value must survive it, in the middle and after the end.
func rerender_case() -> void:
  var run := begin([["A", "native-rerender"]])
  start_in(run, "A", "native-rerender")
  await advance_for(run, 100)
  mark(run, "rerender")
  act("rerender(%s, %s)" % [quote("A"), quote("native-rerender")])
  await advance_to_end(run, "native-rerender")
  await advance(run, 6)
  mark(run, "rerender")
  act("rerender(%s, %s)" % [quote("A"), quote("native-rerender")])
  await finish(run, 12)
  stages["native-rerender"] = run
  var opacities := series(run, "A/native-rerender", "opacity")
  module_check(monotone(opacities, true) and near(opacities.back(), 0.2) and changes(opacities) >= FEWEST_CHANGES,
    "native-rerender/A re-render in the middle and one after the end never snap the Control back")
  var rest: Dictionary = run.rest.controls["A/native-rerender"]
  module_check((end_of(run, "native-rerender").get("finished") == true and counter(run, "stale") == 0
    and near(number(run.final.controls["A/native-rerender"].get("x")), number(rest.get("x")) + 80.0)),
    "native-rerender/The animation ends once with finished: true and the Control keeps its final transform")

# Unmounting an Animated.View mid-animation, and the same removal racing the
# native side: the update the backend still has for a view that is gone is dropped.
func unmount_case() -> void:
  var run := begin([["A", "native-unmount"]])
  start_in(run, "A", "native-unmount")
  await advance_for(run, 100)
  mark(run, "hide")
  act("setShown(%s, %s, false)" % [quote("A"), quote("native-unmount")])
  await advance_for(run, 150)
  await finish(run, 4)
  stages["native-unmount"] = run
  module_check((control("A", "native-unmount") == null and app_state().get("errors", []).is_empty() and counter(run, "stale") == 0
    and end_of(run, "native-unmount").get("finished") == false and run.final.active == false),
    "native-unmount/Unmounting mid-animation removes the Control, ends with finished: false, idles the backend and raises no error")
  var race := begin([["A", "native-race"]])
  start_in(race, "A", "native-race")
  await advance_for(race, 100)
  act("deferQueueFlush(3)")
  mark(race, "hide")
  act("setShown(%s, %s, false)" % [quote("A"), quote("native-race")])
  await advance_for(race, 250)
  act("restoreQueueFlush()")
  await finish(race, 6)
  stages["native-race"] = race
  var gone: Array = race.samples.filter(func(row: Dictionary) -> bool: return not row.controls["A/native-race"].present)
  module_check((control("A", "native-race") == null and app_state().get("errors", []).is_empty() and counter(race, "stale") > 0
    and counter(race, "stale") <= gone.size() and race.final.active == false),
    "native-unmount/An update for a view that is already gone is dropped and counted, without an error, until RN disconnects it")

# Two roots of one application animate at once with different configurations
# started on different frames; then one root goes away mid-animation.
func two_roots_case() -> void:
  var run := begin([["A", "native-two"], ["B", "native-two"]])
  start_in(run, "A", "native-two-a")
  await advance_for(run, 100)
  start_in(run, "B", "native-two-b")
  await advance_to_end(run, "native-two-a")
  await advance_to_end(run, "native-two-b")
  await finish(run, 10)
  stages["native-two-roots"] = run
  var overlap: Array = run.samples.filter(func(row: Dictionary) -> bool: return (row.active
    and row.controls["A/native-two"].opacity != 1.0 and row.controls["B/native-two"].opacity != 1.0))
  module_check((overlap.size() >= FEWEST_CHANGES and end_of(run, "native-two-a").get("finished") == true
    and end_of(run, "native-two-b").get("finished") == true),
    "native-two-roots/Both roots animate at the same time and each ends once with finished: true")
  var rest_a: Dictionary = run.rest.controls["A/native-two"]
  var rest_b: Dictionary = run.rest.controls["B/native-two"]
  module_check((near(number(run.final.controls["A/native-two"].get("x")), number(rest_a.get("x")) + 80.0)
    and near(number(run.final.controls["B/native-two"].get("x")), number(rest_b.get("x")) + 80.0)
    and counter(run, "stale") == 0 and counter(run, "resumes") == 1),
    "native-two-roots/Each root's Control rests at its own final transform from one shared backend")
  # B goes away while A animates back to 0: A neither stops nor jumps.
  var again := begin([["A", "native-timing"]])
  start_in(again, "A", "native-return")
  await advance_for(again, 100)
  mark(again, "unmountB")
  surfaces.B.call("unmount")
  await advance_to_end(again, "native-return")
  await finish(again, 8)
  stages["native-two-roots/unmount"] = again
  var back := series(again, "A/native-timing", "opacity")
  module_check((end_of(again, "native-return").get("finished") == true and app_state().get("errors", []).is_empty()
    and int(app_state().get("rootCount", 0)) == 1 and monotone(back, false) and near(back.back(), 1.0)),
    "native-two-roots/Unmounting one root mid-animation leaves the other's animation on its way to its end")

# The cases above commit many unrelated React updates. A box that finished or
# stopped an animation must still show its final props: the backend's commit
# hook carries them into those commits, and the runtime shadow node reference
# update RN's JS thread does (application_runtime.cpp sets it as RN's
# ReactInstance does) keeps React from cloning the nodes it created before the
# animation.
func persistence_case() -> void:
  var reverted: Array = []
  var held := 0
  var props := {}
  for name: String in ["native-spring", "native-decay", "native-created", "native-xy", "native-stop", "native-listener",
      "native-rerender"]:
    var run: Dictionary = stages[name]
    var box: String = run.targets[0][1]
    var now := props_of(control("A", box))
    props[box] = now
    held += 1 if now.present else 0
    if now != run.final.controls["A/" + box]:
      reverted.append(name)
  stages["persistence"] = {"reverted": reverted, "present": held, "props": props}
  module_check(reverted.is_empty() and held == 7,
    "persistence/Boxes that finished or stopped an animation keep their final props through later unrelated React commits")

func center(root_name: String, id: String) -> Vector2:
  var node := control(root_name, id)
  return node.get_global_rect().get_center() if node != null else Vector2(-1000, -1000)

# One actual Godot input sample, as the touchables probe sends it.
func send(device: String, phase: String, at: Vector2) -> void:
  if device == "mouse":
    if phase == "down":
      var motion := InputEventMouseMotion.new()
      motion.device = DEVICE
      motion.position = at
      Input.parse_input_event(motion)
    var button := InputEventMouseButton.new()
    button.device = DEVICE
    button.position = at
    button.button_index = MOUSE_BUTTON_LEFT
    button.pressed = phase == "down"
    button.button_mask = MOUSE_BUTTON_MASK_LEFT if phase == "down" else 0
    Input.parse_input_event(button)
  else:
    var contact := InputEventScreenTouch.new()
    contact.device = DEVICE
    contact.index = 0
    contact.position = at
    contact.pressed = phase == "down"
    Input.parse_input_event(contact)

# Press with real input, wait for the backend to idle, release and follow the
# way back to rest. The marks hold the sample index of each input.
func touchable_gesture(device: String) -> Dictionary:
  var at := center("A", "touchable")
  var run := begin([["A", "touchable"]])
  run.starts.append({"root": "A", "name": "touchable-press", "at": 0, "request": sample([]), "started": null})
  mark(run, "down")
  send(device, "down", at)
  await advance(run, 10)
  var waited := 0
  while run.samples.back().active and waited < 30:
    await advance(run)
    waited += 1
  mark(run, "up")
  run.starts.append({"root": "A", "name": "touchable-release", "at": run.samples.size(), "request": sample([]), "started": null})
  send(device, "up", at)
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < 1500:
    await advance(run)
    var tail: Array = series(run, "A/touchable", "opacity").slice(-6)
    if (int(run.samples.back().frames) > int(run.starts[1].request.frames) and run.samples.back().active == false
        and tail.all(func(value: float) -> bool: return value == tail[0])):
      break
  await finish(run, 4)
  return run

func touchable_case() -> void:
  for device: String in ["mouse", "touch"]:
    var run := await touchable_gesture(device)
    stages["touchable-opacity/" + device] = run
    var opacities := series(run, "A/touchable", "opacity")
    var down: int = run.marks[0].at
    var up: int = run.marks[1].at
    var pressed: Array = opacities.slice(down, up)
    var heard: Array = run.events.filter(func(entry: Dictionary) -> bool: return entry.get("kind") == "touchable").map(
      func(entry: Dictionary) -> String: return str(entry.type))
    var label := "touchable-opacity/" + device
    module_check((pressed.size() >= 6 and near(pressed.back(), 0.4) and distinct(pressed) <= 2 and not run.samples[up - 1].active
      and int(run.samples[up - 1].frames) > int(run.starts[0].request.frames)),
      label + "/A press moves the TouchableOpacity to activeOpacity through the native driver")
    var back := opacities.slice(up)
    module_check((monotone(back, false) and near(back.back(), 1.0) and changes(back) >= FEWEST_CHANGES and counter(run, "stale") == 0
      and counter(run, "resumes") == 2 and counter(run, "pauses") == 2 and value_events(run) == 0),
      label + "/Release returns it to rest over RN's 250 ms timing, one backend run per transition")
    module_check(heard == ["in", "out", "press"], label + "/onPress fires once, after onPressIn and onPressOut")

# Stopping the application with an animation in flight: no later frame, no error.
func stop_application_case() -> void:
  var run := begin([["A", "native-timing"]])
  start_in(run, "A", "native-timing")
  await advance_for(run, 60)
  var before := animated_state()
  application.call("stop")
  await settle(12)
  var after := animated_state()
  var state := app_state()
  stages["stop"] = {"before": before, "after": after, "stopped": state.get("stopped"), "rootCount": state.get("rootCount"),
    "errors": state.get("errors")}
  module_check((state.get("stopped") == true and after.get("stopped") == true and after.get("active") == false
    and number(after.get("frames")) == number(before.get("frames")) and number(after.get("directUpdates")) == number(before.get("directUpdates"))
    and state.get("errors", []).is_empty()),
    "stop/Stopping the application mid-animation delivers no further frame and raises no error")

func finish_probe() -> void:
  for surface: Control in surfaces.values():
    if is_instance_valid(surface):
      surface.queue_free()
  application.queue_free()
  await settle(2)
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var sabotage_rejected := sabotage and not failures.is_empty()
  var report := {"scenario": "native-animated", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "frameMs": 1000.0 / 60.0,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": negative_observed, "sabotage": sabotage, "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"publicReactNativeImport": true, "originalAnimatedModules": true, "rnCxxNativeAnimatedAndSharedBackend": true,
      "actualNativeInput": true, "twoRootsOneApplication": true, "frameClockIsGodotsTick": false, "frameClockIsDisplayPaced": true,
      "layoutAnimationCertified": false,
      "animatedEventOnScrollViewCertified": false, "mobileExportsCertified": false, "performanceBudgetsCertified": false}}
  var output := FileAccess.open("res://build/native-animated-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The native-animated report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if negative_observed:
    print("NATIVE_ANIMATED_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif sabotage_rejected:
    print("NATIVE_ANIMATED_SABOTAGE_REJECTED: " + str(failures.size()))
  else:
    print("NATIVE_ANIMATED_PASSED: " + str(checks.size()) if failures.is_empty() else "NATIVE_ANIMATED_FAILED")
  quit(0 if failures.is_empty() or negative_observed or sabotage_rejected else 1)
