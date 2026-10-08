extends SceneTree

# RN's original LayoutAnimation (and the legacy UIManager.configureNextLayoutAnimation) through the public react-native
# import, over one stage of absolute boxes on one real root (tests/layout-animation-fixture.jsx). JS records what it
# observes: the config RN's helpers built, the order of RN's callbacks and how RN's own JS timer, the race it arms
# against the native end, ended. For the host this probe reads, once per Godot frame and before the application's next
# frame, the driver's counters and the transactions it served since the previous frame (the clock RN read for each, the
# mutations in it), and the position, size, opacity and scale of the Godot Controls, which is what the last such
# transaction applied. The independent oracle (tests/layout-animation-oracle.mjs) recomputes every Control value from
# those clocks with RN's own curves and never reads this probe's verdicts. So nothing here asks for a number of frames,
# for half of an animation or for a wall-clock duration: the host's pacing and the machine's load decide those. A run
# waits for a condition (the driver's completion, a callback) with a limit that only turns a hang into a failure.
# --previous-host runs the same checks on the host that has no layout animation: the checks that need the driver are
# normative and must fail there, the ones about RN's JS (and the commit's final layout) must pass on both hosts.
# --sabotage runs them on a deliberately broken host and expects failures.
const SIZE := Vector2(400, 570)
const LIMIT_MS := 9000
const SETTLE := 6
const IDS := ["box", "child", "doomed"]
const NODES := {"box": "la-box", "child": "la-child", "doomed": "la-doomed"}
const POSES := {
  "a": {"x": 20.0, "y": 30.0, "width": 60.0, "height": 40.0},
  "b": {"x": 220.0, "y": 120.0, "width": 100.0, "height": 90.0},
  "c": {"x": 60.0, "y": 260.0, "width": 140.0, "height": 30.0},
}
const CHILD := {"x": 40.0, "y": 380.0, "width": 80.0, "height": 50.0}
const DOOMED := {"x": 240.0, "y": 380.0, "width": 80.0, "height": 50.0}
var previous_host := false
var sabotage := false
var application: Node
var surface: Control
var checks: Array = []
var stages: Dictionary = {}
var expected_original_failures: Array = []
var cases: Dictionary = {}
# Every transaction the driver served, by sequence, merged from the status ring of each sample.
var pulls_seen: Dictionary = {}

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A normative check needs the driver: its counters, its transactions or an animation applied to a Control. The host that
# predates this slice has none of them, so it must fail exactly these checks.
func driver_check(condition: bool, name: String) -> bool:
  expected_original_failures.append(name)
  return check(condition, name)

func number(value: Variant, fallback: float = -1.0) -> float:
  return float(value) if value is float or value is int else fallback

func near(value: float, expected: float, tolerance: float = 1e-3) -> bool:
  return absf(value - expected) <= tolerance

func settle(count: int = 8) -> void:
  for index in range(count):
    await process_frame

func app_state() -> Dictionary:
  var value: Variant = JSON.parse_string(application.call("snapshot"))
  return value if value is Dictionary else {}

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(LayoutAnimationProbe." + expression + ")"))

func act(expression: String) -> void:
  application.call("evaluate", "LayoutAnimationProbe." + expression + ";")

func quote(value: String) -> String:
  return JSON.stringify(value)

# Everything JS recorded since the previous call, in order.
func take() -> Array:
  var value: Variant = js("take()")
  return value if value is Array else []

func control(id: String) -> Control:
  if surface == null or not is_instance_valid(surface):
    return null
  var found: Node = surface.find_child(NODES[id], true, false)
  return found if found is Control else null

func props_of(node: Control) -> Dictionary:
  if node == null:
    return {"present": false}
  return {"present": true, "x": node.position.x, "y": node.position.y, "width": node.size.x, "height": node.size.y,
    "opacity": node.modulate.a, "scale_x": node.scale.x, "scale_y": node.scale.y, "visible": node.visible}

# One observation, taken as a Godot frame starts: the previous frame's pump has run, so the Controls show what the last
# transaction the driver served in it applied. Counters read -1 on a host without the driver.
func sample() -> Dictionary:
  var snapshot := app_state()
  var state: Dictionary = snapshot.get("layoutAnimation", {})
  var clock: Dictionary = snapshot.get("frameClock", {})
  for pull: Dictionary in state.get("pulls", []):
    pulls_seen[int(pull.sequence)] = pull
  var row := {"n": Engine.get_process_frames(), "enabled": state.get("enabled", false) == true, "active": state.get("active", false) == true,
    "stopped": state.get("stopped", false) == true, "started": int(number(state.get("started"))), "completed": int(number(state.get("completed"))),
    "callbacks": int(number(state.get("callbacksQueued"))), "ticks": int(number(state.get("ticks"))),
    "clockReads": int(number(state.get("clockReads"))), "frameMs": number(state.get("frameMs")),
    "lastReadMs": number(state.get("lastReadMs")),
    "pullsTotal": int(number(state.get("pullsTotal"))), "pullsDropped": int(number(state.get("pullsDropped"))),
    "frameTicks": int(number(clock.get("ticks"))), "frameLastTickMs": number(clock.get("lastTickMs")), "controls": {}}
  for id: String in IDS:
    row.controls[id] = props_of(control(id))
  return row

func begin() -> Dictionary:
  take()
  return {"rows": [], "events": [], "request": sample()}

func advance(run: Dictionary, count: int = 1) -> void:
  for index in range(count):
    await process_frame
    var row := sample()
    run.rows.append(row)
    for entry: Dictionary in take():
      entry["n"] = row.n
      run.events.append(entry)

func events_of(run: Dictionary, kind: String, label: String = "") -> Array:
  return run.events.filter(func(entry: Dictionary) -> bool: return entry.get("kind") == kind and (label == "" or entry.get("label") == label))

# Until the condition holds, or the limit: the limit only turns a hang into a failed check.
func advance_until(run: Dictionary, condition: Callable, limit_ms: int = LIMIT_MS) -> bool:
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < limit_ms:
    await advance(run)
    if condition.call():
      return true
  return false

# The transactions the driver served in a run, in order: those after its request.
func run_pulls(run: Dictionary) -> Array:
  var out: Array = []
  var last: int = int(run.rows.back().pullsTotal) if not run.rows.is_empty() else int(run.request.pullsTotal)
  for sequence in range(int(run.request.pullsTotal) + 1, last + 1):
    if pulls_seen.has(sequence):
      out.append(pulls_seen[sequence])
  return out

# The rows in which a transaction was applied: the counter grew since the row before.
func pull_rows(run: Dictionary) -> Array:
  var out: Array = []
  var previous: int = run.request.pullsTotal
  for row: Dictionary in run.rows:
    if int(row.pullsTotal) > previous:
      out.append(row)
    previous = int(row.pullsTotal)
  return out

func series(rows: Array, id: String, key: String) -> Array:
  return rows.map(func(row: Dictionary) -> float: return number(row.controls[id].get(key), NAN))

# The Controls of a row, or none when there is no row: a host that serves no transaction fails its checks, not the script.
func controls_of(rows: Array, index: int, id: String) -> Dictionary:
  if rows.is_empty():
    return {}
  return rows[index].controls[id]

# How many times a Control took a new value in a frame in which no transaction was applied. The Controls change only when
# the driver's transaction is applied, which a tick or a commit pulls.
func changes_between_pulls(run: Dictionary) -> int:
  var count := 0
  var previous: Dictionary = run.request
  for row: Dictionary in run.rows:
    if int(row.pullsTotal) == int(previous.pullsTotal) and JSON.stringify(row.controls) != JSON.stringify(previous.controls):
      count += 1
    previous = row
  return count

# How many times a series took a new value, each entry compared with the one before.
func changes(values: Array) -> int:
  var count := 0
  for index in range(1, values.size()):
    if values[index] != values[index - 1]:
      count += 1
  return count

func non_decreasing(values: Array, tolerance: float = 1e-3) -> bool:
  for index in range(1, values.size()):
    if values[index] < values[index - 1] - tolerance:
      return false
  return true

func non_increasing(values: Array, tolerance: float = 1e-3) -> bool:
  for index in range(1, values.size()):
    if values[index] > values[index - 1] + tolerance:
      return false
  return true

func delta(run: Dictionary, key: String) -> int:
  var last: Dictionary = run.rows.back() if not run.rows.is_empty() else run.request
  return int(last[key]) - int(run.request[key])

func pose_matches(props: Dictionary, pose: Dictionary, tolerance: float = 1e-3) -> bool:
  return (props.get("present") == true and near(number(props.get("x")), pose.x, tolerance) and near(number(props.get("y")), pose.y, tolerance)
    and near(number(props.get("width")), pose.width, tolerance) and near(number(props.get("height")), pose.height, tolerance))

func at_rest(row: Dictionary) -> bool:
  return (pose_matches(row.controls.box, POSES.a) and pose_matches(row.controls.doomed, DOOMED) and row.controls.child.get("present") == false
    and row.controls.box.get("opacity") == 1.0 and row.controls.doomed.get("opacity") == 1.0)

# The stage back at its base scene with no animation armed, and the driver idle.
func reset_stage(label: String) -> void:
  var run := begin()
  act("reset()")
  var back := await advance_until(run, func() -> bool: return not run.rows.is_empty() and at_rest(run.rows.back()) and not run.rows.back().active, 4000)
  await advance(run, SETTLE)
  check(back and at_rest(run.rows.back()), "rest/Before " + label + ", the stage is back at its base layout with no animation armed")

# The expectation of a case, from the fixture's own table of cases.
func expectation(name: String) -> Dictionary:
  var spec: Dictionary = cases[name]
  var animated: bool = not spec.entities.is_empty()
  var config: Variant = spec.config
  var limit := (int(config.duration) + 4000) if config != null else 3000
  # A legacy call has no JS timer: only the driver calls its callback, so a host without one never does, and nothing is waited for.
  return {"animated": animated, "ends": spec.via != "flag", "driver_ends": spec.via == "legacy", "fails": name == "fail", "limit": limit}

# Runs one case to its end: until the condition the case waits for, with the limit, and then a few frames more so that a
# callback that should not come, or a second one, shows.
func run_case(name: String) -> Dictionary:
  var wanted := expectation(name)
  var run := begin()
  var enabled: bool = run.request.enabled
  var request: Dictionary = run.request
  act("run(%s)" % quote(name))
  var finished := func() -> bool:
    var row: Dictionary = run.rows.back()
    var committed := not events_of(run, "commit").is_empty()
    var ended: bool = events_of(run, "end", name).size() >= 1 or not wanted.ends or (wanted.driver_ends and not enabled)
    var failed: bool = events_of(run, "fail", name).size() >= 1 or not wanted.fails or not enabled
    var native: bool = not (enabled and wanted.animated) or (int(row.completed) > int(request.completed) and not row.active)
    return committed and ended and failed and native
  var reached := await advance_until(run, finished, int(wanted.limit))
  run["timedOut"] = not reached
  await advance(run, SETTLE)
  run["final"] = run.rows.back()
  run["races"] = js("races()")
  run["measure"] = js("measureBox()")
  run["nodes"] = fabric_nodes()
  stages[name] = run
  return run

func fabric_nodes() -> Dictionary:
  var out := {}
  var snapshot: Variant = JSON.parse_string(surface.call("snapshot"))
  if snapshot is Dictionary:
    for node: Dictionary in snapshot.get("nodes", []):
      if str(node.get("testID", "")).begins_with("la-"):
        out[str(node.testID)] = {"x": node.x, "y": node.y, "width": node.width, "height": node.height, "fabricX": node.fabricX,
          "fabricY": node.fabricY, "fabricWidth": node.fabricWidth, "fabricHeight": node.fabricHeight, "opacity": node.opacity, "visible": node.visible}
  return out

func _initialize() -> void:
  previous_host = OS.get_cmdline_user_args().has("--previous-host")
  sabotage = OS.get_cmdline_user_args().has("--sabotage")
  call_deferred("run_probe")

# A root of the stage in the scene, named after its first prop. It becomes the surface the probe reads.
func mount_root(name: String) -> void:
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = name
  surface.size = SIZE
  surface.set("application_path", NodePath("../LayoutAnimationApplication"))
  surface.set("component_name", "LayoutAnimationProbe")
  surface.set("initial_props", {"name": name})
  root.add_child(surface)

func run_probe() -> void:
  root.size = Vector2i(440, 580)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "LayoutAnimationApplication"
  application.set("bundle_path", "res://build/layout-animation-probe.js")
  root.add_child(application)
  mount_root("A")
  await settle(12)
  mount_case()
  api_case()
  await idle_case("idle-start")
  await frames_case()
  cases = js("cases()").cases
  for name: String in ["native-end", "update-linear", "update-ease", "update-spring"]:
    await update_case(name)
  for name: String in ["create-opacity", "create-scale"]:
    await create_case(name)
  for name: String in ["delete-opacity", "delete-scale"]:
    await delete_case(name)
  await mixed_case()
  await fail_case()
  await interrupt_case()
  await update_case("legacy")
  await flag_case()
  await restart_case()
  await idle_case("idle-end")
  await stop_case()
  await finish_probe()

func mount_case() -> void:
  var cases_seen: Variant = js("cases()")
  var mounted: Dictionary = js("mounted()")
  var row := sample()
  var state: Dictionary = app_state().get("layoutAnimation", {})
  stages["mount"] = {"cases": cases_seen, "mounted": mounted, "row": row, "nodes": fabric_nodes(), "state": state}
  check(int(app_state().get("rootCount", 0)) == 1 and mounted == {"A": 1.0} and at_rest(row),
    "mount/The stage mounts once with the box, the doomed view and no child where the style puts them")
  driver_check((state.get("enabled") == true and state.get("active") == false and number(state.get("started")) == 0
    and number(state.get("completed")) == 0 and number(state.get("callbacksQueued")) == 0 and number(state.get("ticks")) == 0
    and number(state.get("pullsTotal")) == 0 and number(state.get("clockReads")) == 0),
    "module/RN's LayoutAnimationDriver is installed before any animation and idles with nothing started, queued, ticked or pulled")

func api_case() -> void:
  var api: Dictionary = js("publicApi()")
  stages["api"] = api
  var functions: Array = ["configureNext", "create", "checkConfig", "easeInEaseOut", "linear", "spring", "setEnabled"]
  check((functions.all(func(name: String) -> bool: return api.LayoutAnimation[name] == "function")
    and api.Presets == ["easeInEaseOut", "linear", "spring"] and api.Types == ["spring", "linear", "easeInEaseOut", "easeIn", "easeOut", "keyboard"]
    and api.Properties == ["opacity", "scaleX", "scaleY", "scaleXY"]
    and api.UIManager.setLayoutAnimationEnabledExperimental == "function" and api.UIManager.configureNextLayoutAnimation == "function"),
    "api/The public react-native import exports LayoutAnimation (configureNext, create, Presets, Types, Properties) and the UIManager legacy methods")
  var unknown: Dictionary = js("unknownLegacy()")
  stages["api"]["unknownLegacy"] = unknown
  check(str(unknown.get("threw")).contains("Legacy UIManager.createView is not supported"),
    "api/The UIManager methods this slice does not add still throw RN's legacy error")

# Ticks and the clock while nothing animates: the frame clock has no consumer, so it does not tick, and the driver's clock
# only moves forward.
func idle_case(name: String) -> void:
  var run := begin()
  await advance(run, 24)
  stages[name] = run
  var first: Dictionary = run.request
  var last: Dictionary = run.rows.back()
  var forward := true
  var previous := number(first.frameMs)
  for row: Dictionary in run.rows:
    forward = forward and number(row.frameMs) >= previous
    previous = number(row.frameMs)
  driver_check((last.ticks == first.ticks and last.frameTicks == first.frameTicks and last.pullsTotal == first.pullsTotal and not last.active
    and forward and number(last.frameMs) > number(first.frameMs)),
    name + "/Idle, neither the driver nor the frame clock ticks, no transaction is pulled and the driver's clock only moves forward")

# Another consumer of the frame clock, with no layout animation configured: a requestAnimationFrame loop makes the frame clock tick, and
# those ticks are not the driver's. It waits for the frame clock to tick (with the limit that only turns a hang into a failure), stops the
# loop, and lets the host settle so that the idle checks that follow see a frame clock nobody consumes.
func frames_case() -> void:
  var run := begin()
  act("startFrames()")
  var reached := await advance_until(run, func() -> bool: return delta(run, "frameTicks") >= 20)
  var frames: int = int(number(js("stopFrames()")))
  await advance(run, SETTLE)
  run["frames"] = frames
  run["timedOut"] = not reached
  stages["raf-idle"] = run
  var first: Dictionary = run.request
  var last: Dictionary = run.rows.back()
  check(reached and frames >= 20 and int(last.frameTicks) - int(first.frameTicks) >= 20,
    "raf-idle/A requestAnimationFrame loop alone ticks the frame clock and runs its callbacks")
  var still: bool = first.enabled == true
  for row: Dictionary in run.rows:
    still = (still and row.ticks == first.ticks and row.pullsTotal == first.pullsTotal and row.clockReads == first.clockReads
      and row.started == first.started and row.completed == first.completed and row.callbacks == first.callbacks and not row.active)
  driver_check(still and int(first.ticks) == 0,
    "raf-idle/While another consumer ticks the frame clock and no animation is in flight, the driver is not ticked, reads no clock and pulls nothing")

# The checks every animated run shares. wanted_callbacks: how many of RN's success callbacks the driver queued.
func animated_run(name: String, run: Dictionary, wanted_callbacks: int = 1) -> void:
  var rows: Array = pull_rows(run)
  var pulls: Array = run_pulls(run)
  driver_check((delta(run, "started") == 1 and delta(run, "completed") == 1 and delta(run, "callbacks") == wanted_callbacks
    and not run.request.active and not run.final.active),
    name + "/The commit starts RN's driver once: one animation starts and completes, its success callback is queued, none is lost, and it idles after")
  # Several, whatever the pacing: the least an animation shows is its start, one frame between and its end. How many frames it
  # takes is the host's pacing, and the oracle recomputes the value of each.
  driver_check((pulls.size() == delta(run, "pullsTotal") and pulls.size() >= 3 and rows.size() >= 3 and changes_between_pulls(run) == 0),
    name + "/The driver serves several transactions and the Controls change only in the frames that applied one")
  var monotone := true
  var forward := true
  var previous_ms := 0.0
  var previous_clock := 0
  for pull: Dictionary in pulls:
    monotone = monotone and int(pull.readMs) >= previous_clock
    forward = forward and number(pull.frameMs) >= previous_ms and int(pull.readMs) == int(floor(number(pull.frameMs)))
    previous_clock = int(pull.readMs)
    previous_ms = number(pull.frameMs)
  driver_check(not pulls.is_empty() and monotone and forward,
    name + "/The clock RN reads for a transaction is the host's frame time in whole milliseconds, and never goes back")
  var ticks_ok := true
  var previous_row: Dictionary = run.request
  for row: Dictionary in run.rows:
    var ticked := int(row.ticks) - int(previous_row.ticks)
    var frame_ticked := int(row.frameTicks) - int(previous_row.frameTicks)
    # A tick needs an animation in flight when the frame began, and each one is a tick of the frame clock, with its timestamp.
    ticks_ok = ticks_ok and (ticked == 0 or (ticked == 1 and previous_row.active and frame_ticked >= 1 and number(row.frameMs) == number(row.frameLastTickMs)))
    ticks_ok = ticks_ok and row.frameMs >= previous_row.frameMs
    previous_row = row
  driver_check(ticks_ok and delta(run, "ticks") >= 1,
    name + "/The driver ticks only on a tick of the frame clock that began with an animation in flight, at that tick's timestamp")

# What RN's onAnimationDidEnd did in a case: one call, and whether the driver or RN's timer ended it. A legacy call has no
# timer: the driver is the only one that can end it.
func callbacks_case(name: String, run: Dictionary) -> void:
  var spec: Dictionary = cases[name]
  var ends: Array = events_of(run, "end", name)
  var completed_at := -1
  for row: Dictionary in run.rows:
    if completed_at < 0 and int(row.completed) > int(run.request.completed):
      completed_at = int(row.n)
  var once: bool = ends.size() == 1 and not run.timedOut
  if spec.via == "legacy":
    driver_check(once, name + "/RN calls the legacy callback exactly once, when the driver ends the animation")
  else:
    check(once, name + "/RN calls onAnimationDidEnd exactly once, whichever side ends the animation")
  driver_check(delta(run, "callbacks") == 1 and completed_at >= 0 and not run.final.active,
    name + "/The driver completes the animation and queues RN's success callback once")
  # Where the config keeps RN's timer far behind the animation, only the driver can have ended the call: the callback comes after
  # the native completion, with the final layout mounted and the driver idle, and RN's timer is cleared before it fires.
  if spec.get("separated", false) == true:
    var scene: Dictionary = ends[0].scene if not ends.is_empty() else {}
    driver_check((ends.size() == 1 and ends[0].race == "cleared" and completed_at >= 0 and int(ends[0].n) >= completed_at
      and scene.get("box") == spec.to.get("box", "a")),
      name + "/The driver ends the call before RN's timer could: the callback follows the native completion, once, with the final layout mounted, and the timer is cleared")

# The final layout RN committed is where the animation ends: fabric*, the Controls, onLayout and measure.
func final_layout_case(name: String, run: Dictionary, pose: Dictionary) -> void:
  var box: Dictionary = run.nodes.get("la-box", {})
  var layouts: Array = events_of(run, "layout").filter(func(entry: Dictionary) -> bool: return entry.id == "box")
  var layout: Dictionary = layouts.back().layout if not layouts.is_empty() else {}
  var measured: Dictionary = run.measure.get("measure", {})
  var rect: Dictionary = run.measure.get("rect", {})
  check((pose_matches(run.final.controls.box, pose) and near(number(box.get("fabricX")), pose.x) and near(number(box.get("fabricY")), pose.y)
    and near(number(box.get("fabricWidth")), pose.width) and near(number(box.get("fabricHeight")), pose.height)
    and near(number(layout.get("x")), pose.x) and near(number(layout.get("y")), pose.y) and near(number(layout.get("width")), pose.width)
    and near(number(layout.get("height")), pose.height) and near(number(measured.get("width")), pose.width) and near(number(measured.get("height")), pose.height)
    and near(number(rect.get("x")), pose.x) and near(number(rect.get("y")), pose.y)),
    name + "/The animation ends at the layout RN committed: the Control, fabric*, onLayout, measure and getBoundingClientRect agree")

func update_case(name: String) -> void:
  await reset_stage(name)
  var run := await run_case(name)
  var spec: Dictionary = cases[name]
  var pose: Dictionary = POSES[spec.to.box]
  var start: Dictionary = POSES.a
  animated_run(name, run)
  callbacks_case(name, run)
  final_layout_case(name, run, pose)
  var rows := pull_rows(run)
  var xs := series(rows, "box", "x")
  var low: float = minf(start.x, pose.x)
  var high: float = maxf(start.x, pose.x)
  var forward: bool = start.x <= pose.x
  # The first transaction of the animation is its progress 0: the start layout, though the commit is the final one.
  driver_check((not rows.is_empty() and pose_matches(controls_of(rows, 0, "box"), start) and pose_matches(controls_of(rows, rows.size() - 1, "box"), pose, 1e-4)
    and changes(xs) >= 2),
    name + "/The first transaction shows the start layout, the last the final layout, and the Control takes more than one value between them")
  if name == "update-spring":
    # RN's curve (damping 0.4) is past its final value from a tenth of the duration to three tenths, by up to a quarter of the
    # distance: a frame between 70 and 210 ms of the 700 shows it.
    var peak: int = xs.find(xs.max()) if not xs.is_empty() else 0
    driver_check(xs.any(func(value: float) -> bool: return value > pose.x + 0.5) and non_decreasing(xs.slice(0, peak + 1), 0.0),
      name + "/The spring overshoots the final layout before it settles on it")
  elif name == "update-ease":
    driver_check(not xs.is_empty() and (non_decreasing(xs) if forward else non_increasing(xs))
      and xs.all(func(value: float) -> bool: return value >= low - 1e-3 and value <= high + 1e-3),
      name + "/easeInEaseOut moves the box one way and never past the final layout")
  else:
    driver_check(not xs.is_empty() and (non_decreasing(xs) if forward else non_increasing(xs))
      and xs.all(func(value: float) -> bool: return value >= low - 1e-3 and value <= high + 1e-3),
      name + "/linear moves the box one way and never past the final layout")

func create_case(name: String) -> void:
  await reset_stage(name)
  var run := await run_case(name)
  animated_run(name, run)
  callbacks_case(name, run)
  var rows := pull_rows(run)
  var first := controls_of(rows, 0, "child")
  var scaled: bool = cases[name].config.create.property == "scaleXY"
  if scaled:
    # A scale of 0 collapses the Control, as it does in RN: it is hidden, and shows as the scale grows to 1.
    var shown := rows.filter(func(row: Dictionary) -> bool: return row.controls.child.get("visible") == true)
    var scales := series(shown, "child", "scale_x")
    driver_check((first.get("present") == true and first.get("visible") == false and shown.size() >= 2 and non_decreasing(scales)
      and series(shown, "child", "scale_y") == scales and near(number(run.final.controls.child.get("scale_x")), 1.0)
      and run.final.controls.child.get("visible") == true and near(number(run.final.controls.child.get("opacity")), 1.0)),
      name + "/The new view is created collapsed (scale 0, hidden), grows to scale 1 on both axes and stays at full opacity")
    driver_check(rows.size() >= 3 and changes(scales) >= 2,
      name + "/The scale takes more than one value on its way")
  else:
    var opacities := series(rows, "child", "opacity")
    driver_check((first.get("present") == true and near(number(first.get("opacity")), 0.0) and non_decreasing(opacities)
      and near(number(run.final.controls.child.get("opacity")), 1.0) and near(number(run.final.controls.child.get("scale_x")), 1.0)),
      name + "/The new view is created at opacity 0 and fades in to 1 without a scale")
    driver_check(rows.size() >= 3 and changes(opacities) >= 2,
      name + "/The opacity takes more than one value on its way")
  check(pose_matches(run.final.controls.child, CHILD) and run.final.controls.child.get("visible") == true,
    name + "/The new view rests where the style puts it")

func delete_case(name: String) -> void:
  await reset_stage(name)
  var run := await run_case(name)
  animated_run(name, run)
  callbacks_case(name, run)
  var rows := pull_rows(run)
  var present := rows.filter(func(row: Dictionary) -> bool: return row.controls.doomed.get("present") == true)
  var scaled: bool = cases[name].config.delete.property == "scaleXY"
  # The view stays mounted while the animation runs, and only the last transaction removes it.
  driver_check((rows.size() >= 3 and present.size() == rows.size() - 1 and controls_of(rows, rows.size() - 1, "doomed").get("present") == false
    and run.final.controls.doomed.get("present") == false),
    name + "/The deleted view stays mounted through the animation and is removed by its last transaction")
  var first := controls_of(present, 0, "doomed")
  var last := controls_of(present, present.size() - 1, "doomed")
  if scaled:
    var scales := series(present, "doomed", "scale_x")
    driver_check((near(number(first.get("scale_x")), 1.0, 0.1) and non_increasing(scales) and changes(scales) >= 2
      and near(number(first.get("opacity")), 1.0) and near(number(last.get("opacity")), 1.0)),
      name + "/The deleted view shrinks toward scale 0 at full opacity")
  else:
    var opacities := series(present, "doomed", "opacity")
    driver_check((near(number(first.get("opacity")), 1.0, 0.1) and non_increasing(opacities) and changes(opacities) >= 2
      and near(number(last.get("scale_x")), 1.0)),
      name + "/The deleted view fades out with its opacity decreasing and no scale")

# One commit with an update, a create and a delete: one animation, each with its own curve and duration.
func mixed_case() -> void:
  await reset_stage("mixed")
  var run := await run_case("mixed")
  animated_run("mixed", run)
  callbacks_case("mixed", run)
  final_layout_case("mixed", run, POSES.c)
  var rows := pull_rows(run)
  var pulls := run_pulls(run)
  var first: Dictionary = pulls[0] if not pulls.is_empty() else {}
  driver_check((not first.is_empty() and first.creates == 1 and first.inserts == 1 and controls_of(rows, rows.size() - 1, "doomed").get("present") == false
    and run.final.controls.child.get("present") == true and near(number(run.final.controls.child.get("opacity")), 1.0)),
    "mixed/The commit's creates and inserts reach the Controls at once and its removes and deletes wait for the animation's end")

# A config RN's driver cannot parse: the failure callback and no animation. RN's JS timer still ends the call.
func fail_case() -> void:
  await reset_stage("fail")
  var run := await run_case("fail")
  var fails: Array = events_of(run, "fail", "fail")
  var ends: Array = events_of(run, "end", "fail")
  var xs := series(run.rows, "box", "x")
  check(ends.size() == 1 and ends[0].race == "fired" and not run.timedOut and pose_matches(run.final.controls.box, POSES.b),
    "fail/RN's JS timer still calls onAnimationDidEnd once for a config the driver rejects, and the box takes the committed layout")
  driver_check((fails.size() == 1 and delta(run, "callbacks") == 1 and delta(run, "started") == 0 and delta(run, "completed") == 0
    and delta(run, "pullsTotal") == 0 and delta(run, "ticks") == 0),
    "fail/An invalid config calls onAnimationDidFail once, starts no animation, and the driver serves no transaction")
  driver_check(changes(xs) <= 1 and not run.final.active and run.final.enabled,
    "fail/The Controls take the committed layout in one step with no intermediate frame")

func flag_case() -> void:
  await reset_stage("flag")
  var run := await run_case("flag")
  var flags: Array = events_of(run, "flag", "flag")
  check(flags.size() == 1 and flags[0].threw == false and pose_matches(run.final.controls.box, POSES.b) and changes(series(run.rows, "box", "x")) <= 1,
    "flag/UIManager.setLayoutAnimationEnabledExperimental(true) does not throw, and the commit after it is not animated")
  driver_check(delta(run, "started") == 0 and delta(run, "callbacks") == 0 and delta(run, "pullsTotal") == 0 and delta(run, "ticks") == 0
    and delta(run, "clockReads") == 0 and run.final.enabled,
    "flag/The legacy flag changes nothing in the driver: no animation, callback, transaction or tick")

# A second configureNext with its commit in the middle of the first animation: the box moves on from where it was and ends
# exactly at the final layout of the second.
func interrupt_case() -> void:
  await reset_stage("interrupt")
  var run := begin()
  var first_request: Dictionary = run.request
  act("run('interrupt-first')")
  var midway := await advance_until(run, func() -> bool: return int(run.rows.back().pullsTotal) >= int(first_request.pullsTotal) + 4 and run.rows.back().active, 3000)
  var second_request := sample()
  run["second"] = second_request
  act("run('interrupt-second')")
  var finished := func() -> bool:
    var row: Dictionary = run.rows.back()
    return (events_of(run, "end", "interrupt-first").size() >= 1 and events_of(run, "end", "interrupt-second").size() >= 1
      and (not run.request.enabled or (int(row.completed) > int(first_request.completed) and not row.active)))
  var reached := await advance_until(run, finished, 8000)
  run["timedOut"] = not reached
  await advance(run, SETTLE)
  run["final"] = run.rows.back()
  run["races"] = js("races()")
  run["measure"] = js("measureBox()")
  run["nodes"] = fabric_nodes()
  run["midway"] = midway
  stages["interrupt"] = run
  var firsts := events_of(run, "end", "interrupt-first")
  var seconds := events_of(run, "end", "interrupt-second")
  driver_check((midway and delta(run, "started") == 1 and delta(run, "completed") == 1 and delta(run, "callbacks") == 2 and not run.final.active
    and changes_between_pulls(run) == 0),
    "interrupt/A second animation armed mid-animation joins the one in flight: the driver starts once, completes once, queues both callbacks and idles")
  driver_check(midway and delta(run, "started") == 1 and pose_matches(run.final.controls.box, POSES.c, 1e-4) and not run.timedOut,
    "interrupt/The box, moving under the first animation, ends exactly at the layout of the second")
  check(firsts.size() == 1 and seconds.size() == 1 and not run.timedOut,
    "interrupt/Each configureNext gets its onAnimationDidEnd exactly once")
  driver_check(firsts.size() == 1 and seconds.size() == 1 and firsts[0].race == "cleared" and seconds[0].race == "cleared"
    and int(firsts[0].n) <= int(seconds[0].n),
    "interrupt/The driver ends both: the first animation's callback arrives no later than the second's, and RN's timers never fire")
  # The box never jumps: the first row after the second commit continues from where the first animation had put it.
  var before: Dictionary = second_request.controls.box
  var after_rows: Array = run.rows.filter(func(row: Dictionary) -> bool: return int(row.pullsTotal) > int(second_request.pullsTotal))
  var step := absf(number(controls_of(after_rows, 0, "box").get("x"), 1e9) - number(before.get("x")))
  driver_check(not after_rows.is_empty() and step < 0.25 * absf(POSES.b.x - POSES.a.x),
    "interrupt/The box continues from where the first animation had put it, with no jump to either end")

# The last root stops with an animation of its own removal in flight, and the root that replaces it has its first commit animated.
# RN drops a stopped surface's animations at the next pull (LayoutAnimationKeyFrameManager.cpp:173), after it has read whether any is
# in flight (:172), and tells the status delegate that animations started only for a pull that found none (:1038-1043). The new root's
# first pull is that pull: it removes the old animation and creates its own, so RN signals nothing, and a host that took "no signal"
# for "no animation" would wait for a tick that never comes. The new animation has to run to its end with its native callback and its
# final layout, with no commit but the first.
func restart_case() -> void:
  await reset_stage("restart-first")
  var first := begin()
  var first_request: Dictionary = first.request
  # The unmount of the root is the commit that RN animates: its views fade out, and the host does not tick while it retires the root.
  act("arm('restart-first')")
  surface.queue_free()
  var gone := await advance_until(first, func() -> bool: return int(app_state().get("rootCount", 1)) == 0, 4000)
  await advance(first, SETTLE)
  first["gone"] = gone
  first["final"] = first.rows.back()
  stages["restart-first"] = first
  # The next root: its configureNext is armed before it mounts, so that its first commit (the creates of the stage) is the animated one.
  var second := begin()
  var request: Dictionary = second.request
  act("arm('restart')")
  mount_root("B")
  var config: Dictionary = cases["restart"].config
  var finished := func() -> bool:
    var row: Dictionary = second.rows.back()
    var committed := not events_of(second, "commit").is_empty()
    var ended: bool = events_of(second, "end", "restart").size() >= 1
    var native: bool = not request.enabled or (int(row.completed) > int(request.completed) and not row.active and int(row.callbacks) > int(request.callbacks))
    return committed and ended and native
  var reached := await advance_until(second, finished, int(config.duration) + 4000)
  second["timedOut"] = not reached
  await advance(second, SETTLE)
  second["final"] = second.rows.back()
  second["races"] = js("races()")
  second["nodes"] = fabric_nodes()
  stages["restart"] = second
  var ends: Array = events_of(second, "end", "restart")
  var pulls: Array = run_pulls(second)
  driver_check(gone and delta(first, "started") == 1 and delta(first, "completed") == 0 and not first.final.active,
    "restart/The last root stops with the animation of its own removal in flight: the driver started it, it did not complete, and no root is left")
  driver_check(reached and not second.final.active and delta(second, "completed") >= 1 and delta(second, "callbacks") == 1 and pulls.size() >= 3,
    "restart/The next root's first commit, animated, runs to its end without another commit: several transactions, a completion, one callback and the driver idle")
  driver_check(ends.size() == 1 and ends[0].race == "cleared" and not second.timedOut,
    "restart/The driver ends the next root's call before RN's timer could, and RN calls onAnimationDidEnd once")
  check(pose_matches(second.final.controls.box, POSES.a) and pose_matches(second.final.controls.doomed, DOOMED) and second.final.controls.box.get("opacity") == 1.0
    and second.final.controls.doomed.get("opacity") == 1.0 and second.final.controls.child.get("present") == false,
    "restart/The next root rests where its style puts it, at full opacity")

# Stopping the application with an animation in flight: no further tick, transaction or error.
func stop_case() -> void:
  await reset_stage("stop")
  var run := begin()
  var request: Dictionary = run.request
  act("run('update-linear')")
  await advance_until(run, func() -> bool: return int(run.rows.back().pullsTotal) >= int(request.pullsTotal) + 3 and run.rows.back().active, 4000)
  var before: Dictionary = app_state().get("layoutAnimation", {})
  application.call("stop")
  await settle(12)
  var state := app_state()
  var after: Dictionary = state.get("layoutAnimation", {})
  stages["stop"] = {"before": before, "after": after, "stopped": state.get("stopped"), "errors": state.get("errors"), "rootCount": state.get("rootCount")}
  driver_check((state.get("stopped") == true and after.get("stopped") == true and after.get("active") == false
    and number(after.get("ticks")) == number(before.get("ticks")) and number(after.get("pullsTotal")) == number(before.get("pullsTotal"))
    and number(after.get("started")) == number(before.get("started")) and number(before.get("ticks")) >= 1 and state.get("errors", []).is_empty()),
    "stop/Stopping the application mid-animation ends the driver: no further tick or transaction, and no error")

func finish_probe() -> void:
  if is_instance_valid(surface):
    surface.queue_free()
  application.queue_free()
  await settle(2)
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var negative_observed := previous_host and observed == expected and not failures.is_empty()
  var sabotage_rejected := sabotage and not failures.is_empty()
  var report := {"scenario": "layout-animation", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "pulls": pulls_seen.values(),
    "expectedOriginalFailures": expected_original_failures, "previousHost": previous_host, "originalNegativeObserved": negative_observed,
    "sabotage": sabotage, "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"publicReactNativeImport": true, "originalLayoutAnimationModule": true, "rnCxxLayoutAnimationDriver": true,
      "presetsAndTypesLinearEaseInEaseOutSpring": true, "updateCreateDelete": true, "invalidConfigFailureCallback": true, "legacyUIManagerMethods": true,
      "oneRootAtATime": true, "frameClockIsGodotsTick": true, "reducedMotionCertified": false, "multipleRootsCertified": false,
      "textAndImageStateInterpolationCertified": false, "keyboardEaseInEaseOutCertified": false, "mobileExportsCertified": false,
      "hitTestingOfDelayedDeletesCertified": false, "costPerTickCertified": false}}
  var output := FileAccess.open("res://build/layout-animation-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The layout-animation report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if negative_observed:
    print("LAYOUT_ANIMATION_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif sabotage_rejected:
    print("LAYOUT_ANIMATION_SABOTAGE_REJECTED: " + str(failures.size()))
  else:
    print("LAYOUT_ANIMATION_PASSED: " + str(checks.size()) if failures.is_empty() else "LAYOUT_ANIMATION_FAILED")
  quit(0 if failures.is_empty() or negative_observed or sabotage_rejected else 1)
