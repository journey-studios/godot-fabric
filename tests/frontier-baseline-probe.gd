extends SceneTree

# The performance baseline on the Frontier HUD's scene (V05-06, criterion `baseline`): the pointer spike's world with one
# full-screen Surface over it (examples/frontier-baseline/scene.tscn), and a HUD whose panel the player changes by a
# real click. A round of the tour makes 12 swaps, one for every ordered pair of the four panels (50, 75, 100 and 0 native
# nodes), and ends at the base; the probe makes WARMUP_ROUNDS + ROUNDS of them, and after every swap it takes a reading,
# which is the engine's counts next to the host's performance section after a forced collection of Hermes' heap
# (tests/performance-sampler.gd, the one the GF-30 soak takes its readings with).
#
# This is the headless lane, and it judges only what holds at any pace of the machine, exactly: the SceneTree's nodes and
# the host's native views after a swap are the base's plus the new panel's, the swap creates the nodes of the new panel and
# deletes those of the old one, a click swaps once and never reaches the world, a round ends back at the base, and the live
# heap at rest (read after REST_FRAMES idle frames at the end of a round) does not grow past the GF-30 limit from the first
# steady rounds to the last. What depends on the pace of the machine is recorded and never judged: the frames a click takes to
# show its panel, the time of the injection and of the pump and its phases, the heap and the resident memory of a swap.
# Headless nothing paces the loop (about 6.9 ms a frame, docs/research/frame-clock.md) and nothing is drawn, so what it records
# of time describes the cost of the CPU work on an unpaced loop and is not a frame time: the frame time is the windowed lane's
# (frontier-baseline-graphics-probe.gd). A click whose panel does not show ends the run, and the report says so.
#
# The independent oracle (tests/frontier-baseline-oracle.mjs) recomputes the invariants and the percentiles from the raw
# report. --sabotage expects failures (scripts/frontier-baseline-sabotage.mjs breaks a source and runs the suite on it).
# --replay=<report.json> evaluates the checks on a report that was recorded before, without running the application.
const Sampler := preload("res://tests/performance-sampler.gd")
const Swap := preload("res://tests/frontier-baseline-swap.gd")
const SCENE := "res://examples/frontier-baseline/scene.tscn"
const SIZE := Vector2i(800, 600)
# The most the live heap at rest may rise from the first steady rounds to the last (the GF-30 limit, tests/performance-cases.mjs).
const HEAP_GROWTH_LIMIT_BYTES := 2048
# The idle frames before the reading at the end of a round, and the rounds a window of the heap at rest is made of.
const REST_FRAMES := 30
const HEAP_WINDOW_ROUNDS := 5

# The shape of a recorded report, as far as evaluate() indexes it (Sampler.matches).
const READING := {"godot": {"nodes": "number", "nodeMonitor": "number", "orphans": "number"}, "host": {"rootCount": "number"},
  "performance": "dictionary"}
const SURFACE := {"state": "string", "nativeTags": "number", "creates": "number", "deletes": "number", "commits": "number", "nodes": "number"}
const SWAP := {"from": "string", "to": "string", "round": "number", "step": "number", "latencyFrames": "number", "snapshotComplete": "bool",
  "shownRoots": ["each", "string"], "worldEvents": "number", "rn": {"presses": "dictionary", "changes": "number", "shown": "string"},
  "host": "dictionary", "surface": SURFACE, "treeNodes": "number", "after": READING}
const REPORT_SHAPE := {"config": "dictionary", "provenance": "dictionary", "scene": {"mounted": "bool", "mouseFilter": "number"},
  "base": {"reading": READING, "surface": SURFACE, "baseNodes": "number"}, "swaps": ["each", SWAP],
  "rests": ["each", {"round": "number", "reading": READING}], "aborted": "any", "final": READING}

var sabotage := false
var scene: Node
var application: Node
var sampler: Sampler
var session: Swap
var checks: Array = []
var stages: Dictionary = {}

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

func settle(count: int = 8) -> void:
  for index in range(count):
    await process_frame

func counter(reading: Dictionary, name: String) -> float:
  return Sampler.number(Sampler.dig(Sampler.perf_of(reading), ["counters", name]))

func series(reading: Dictionary, path: Array) -> Dictionary:
  var value: Variant = Sampler.dig(Sampler.perf_of(reading), path)
  return value if value is Dictionary else {}

# -------------------------------------------------------------------- the run
func run_probe() -> void:
  root.size = SIZE
  await settle(2)
  var packed: PackedScene = load(SCENE)
  scene = packed.instantiate()
  root.add_child(scene)
  application = scene.get_node("Application")
  sampler = Sampler.new(self, application, "FrontierBaselineProbe")
  session = Swap.new(self, scene, sampler)
  var mounted: bool = await session.mount()
  var surface: Control = scene.get_node("Hud/Surface")
  stages["config"] = {"panels": Swap.PANELS, "nativeNodes": Swap.NATIVE_NODES, "baseNativeNodes": Swap.BASE_NATIVE_NODES,
    "tab": {"left": Swap.TAB_LEFT, "top": Swap.TAB_TOP, "step": Swap.TAB_STEP, "width": Swap.TAB_WIDTH, "height": Swap.TAB_HEIGHT},
    "tour": Swap.TOUR, "warmupRounds": Swap.WARMUP_ROUNDS, "rounds": Swap.ROUNDS, "stableFrames": Swap.STABLE_FRAMES,
    "restFrames": REST_FRAMES, "heapWindowRounds": HEAP_WINDOW_ROUNDS, "heapGrowthLimitBytes": HEAP_GROWTH_LIMIT_BYTES}
  stages["scene"] = {"mounted": mounted, "mouseFilter": surface.mouse_filter, "viewport": [SIZE.x, SIZE.y]}
  stages["provenance"] = sampler.provenance()
  stages["provenance"].merge({"vsyncMode": DisplayServer.window_get_vsync_mode(), "refreshRate": DisplayServer.screen_get_refresh_rate()})
  stages["base"] = {"reading": sampler.sample(true), "surface": session.surface_row(), "baseNodes": session.base_nodes}
  var swaps: Array = []
  var rests: Array = []
  stages["swaps"] = swaps
  stages["rests"] = rests
  stages["aborted"] = null
  for round_index in range(Swap.WARMUP_ROUNDS + Swap.ROUNDS):
    for step in range(Swap.TOUR.size() - 1):
      var row: Dictionary = await session.swap(Swap.TOUR[step], Swap.TOUR[step + 1])
      await session.quiet()
      row.merge({"round": round_index, "step": step, "after": sampler.sample()})
      swaps.append(row)
      # A click whose panel does not show ends the run: what follows would start from a state nobody knows.
      if Sampler.number(row.latencyFrames) < 0.0:
        stages["aborted"] = {"round": round_index, "step": step, "from": row.from, "to": row.to}
        break
    if stages["aborted"] != null:
      break
    # A round ends at the base. React lets go of the fibers of an unmounted panel in work it does a few frames after the commit,
    # so the heap at rest is read after REST_FRAMES more frames in which nothing happens.
    await settle(REST_FRAMES)
    rests.append({"round": round_index, "reading": sampler.sample()})
  stages["final"] = sampler.sample(true)
  await finish_probe()

# -------------------------------------------------------------------- what the checks read
# The reading before a swap: the base for the first, the previous swap's for the rest.
func before_of(swaps: Array, index: int) -> Dictionary:
  return stages.base.reading if index == 0 else swaps[index - 1].after

func surface_before_of(swaps: Array, index: int) -> Dictionary:
  return stages.base.surface if index == 0 else swaps[index - 1].surface

func readings() -> Array:
  var out: Array = [stages.base.reading]
  var rests: Array = stages.rests
  for row: Dictionary in stages.swaps:
    out.append(row.after)
    # The reading at rest follows the last swap of its round.
    if int(Sampler.number(row.step)) == Swap.TOUR.size() - 2:
      for entry: Dictionary in rests:
        if Sampler.number(entry.round) == Sampler.number(row.round):
          out.append(entry.reading)
  out.append(stages.final)
  return out

func finite_and_not_negative(value: Variant) -> bool:
  if value is float or value is int:
    return is_finite(float(value)) and float(value) >= 0.0
  if value is Dictionary:
    for key: Variant in value.keys():
      if not finite_and_not_negative(value[key]):
        return false
  if value is Array:
    for item: Variant in value:
      if not finite_and_not_negative(item):
        return false
  return true

# --------------------------------------------------------------------------- the checks
func check_provenance() -> void:
  var p: Dictionary = stages.provenance
  check(str(p.get("godot", "")).begins_with("4.") and str(p.get("hermes", "")) != "" and str(p.get("architecture", "")) != ""
    and str(p.get("renderingDriver", "")) != "" and str(p.get("displayServer", "")) != "" and str(p.get("os", "")) != "",
    "provenance/The report names the versions of Godot and Hermes, the architecture, the operating system and the driver")

func check_scene() -> void:
  var base: Dictionary = stages.base
  check(stages.scene.mounted and Sampler.number(stages.scene.mouseFilter) == float(Control.MOUSE_FILTER_IGNORE),
    "scene/The HUD mounts over the world in a Surface that takes no pointer (IGNORE)")
  check(Sampler.number(base.surface.nativeTags) == float(Swap.BASE_NATIVE_NODES) and counter(base.reading, "nativeViews") == float(Swap.BASE_NATIVE_NODES)
    and base.surface.state == "mounted" and Sampler.number(base.reading.godot.nodes) == Sampler.number(base.baseNodes),
    "scene/The base, the HUD with no panel, holds %d native nodes in the Surface and in the host's count" % Swap.BASE_NATIVE_NODES)

func check_swaps() -> void:
  var swaps: Array = stages.swaps
  var base: Dictionary = stages.base
  var total := (Swap.WARMUP_ROUNDS + Swap.ROUNDS) * (Swap.TOUR.size() - 1)
  var nodes := swaps.size() == total
  var views := swaps.size() == total
  var counted := swaps.size() == total
  var once := swaps.size() == total
  var world := swaps.size() == total
  var shown := swaps.size() == total
  var arrived := swaps.size() == total and stages.aborted == null
  for index in range(swaps.size()):
    var row: Dictionary = swaps[index]
    var size := Sampler.number(Swap.NATIVE_NODES[row.to])
    var from_size := Sampler.number(Swap.NATIVE_NODES[row.from])
    var before := before_of(swaps, index)
    var surface_before := surface_before_of(swaps, index)
    var after: Dictionary = row.after
    arrived = arrived and Sampler.number(row.latencyFrames) >= 0.0
    nodes = nodes and Sampler.number(row.treeNodes) == Sampler.number(base.baseNodes) + size \
      and Sampler.number(after.godot.nodes) == Sampler.number(base.reading.godot.nodes) + size \
      and Sampler.number(after.godot.nodeMonitor) == Sampler.number(base.reading.godot.nodeMonitor) + size \
      and Sampler.number(after.godot.orphans) == Sampler.number(base.reading.godot.orphans)
    views = views and counter(after, "nativeViews") == counter(base.reading, "nativeViews") + size \
      and Sampler.number(row.surface.nativeTags) == Sampler.number(base.surface.nativeTags) + size
    counted = counted and counter(after, "creates") - counter(before, "creates") == size \
      and counter(after, "deletes") - counter(before, "deletes") == from_size \
      and Sampler.number(row.surface.creates) - Sampler.number(surface_before.creates) == size \
      and Sampler.number(row.surface.deletes) - Sampler.number(surface_before.deletes) == from_size \
      and counter(after, "commits") - counter(before, "commits") >= 1.0
    var presses: Dictionary = row.rn.presses
    var pressed := 0.0
    for panel: String in presses.keys():
      pressed += Sampler.number(presses[panel])
    once = once and pressed == 1.0 and Sampler.number(presses.get(row.to)) == 1.0 and Sampler.number(row.rn.changes) == 1.0 and row.rn.shown == row.to
    world = world and Sampler.number(row.worldEvents) == 0.0
    var roots: Array = row.shownRoots
    shown = shown and row.snapshotComplete and roots == ([] if row.to == "empty" else [row.to])
  check(arrived, "swap/Every click shows its panel: the tree holds the nodes of the new panel within a bound of frames after the flush")
  check(nodes, "swap/Every swap leaves the SceneTree with the base's nodes plus the new panel's, and Godot counts no orphan beyond the base's")
  check(views, "swap/Every swap leaves the host's native views, and the Surface's, at the base's plus the new panel's")
  check(counted, "swap/Every swap creates the nodes of the new panel and deletes those of the old one, in the host's counters and in the Surface's")
  check(once, "swap/Every click swaps exactly once: one press on the button, one change of state, the new panel shown")
  check(world, "swap/No click of a swap reaches the Godot world")
  check(shown, "swap/When the tree holds the new panel, the Surface's snapshot holds its last node and the root of no other panel")

# A round ends at the base: after the idle frames, the nodes, the orphans and the native views are the base's again.
func check_rounds() -> void:
  var rests: Array = stages.rests
  var base: Dictionary = stages.base
  var back := rests.size() == Swap.WARMUP_ROUNDS + Swap.ROUNDS
  for entry: Dictionary in rests:
    var reading: Dictionary = entry.reading
    back = back and Sampler.number(reading.godot.nodes) == Sampler.number(base.reading.godot.nodes) \
      and Sampler.number(reading.godot.nodeMonitor) == Sampler.number(base.reading.godot.nodeMonitor) \
      and Sampler.number(reading.godot.orphans) == Sampler.number(base.reading.godot.orphans) \
      and counter(reading, "nativeViews") == counter(base.reading, "nativeViews") \
      and counter(reading, "creates") - counter(reading, "deletes") == counter(base.reading, "nativeViews") \
      and Sampler.number(reading.host.rootCount) == Sampler.number(base.reading.host.rootCount)
  check(back, "round/Every round ends back at the base: the SceneTree's nodes, the orphans, the native views and the root count")
  # Bounded in the steady state: the live heap at rest, read after a forced collection with the base shown, does not rise more than the
  # limit from the first steady rounds to the last. A reading can carry a transient allocation that the next one does not (a step of
  # 2,056 bytes in one to three consecutive rounds, seen in about one run in three), which only adds: the heap at rest of a window of
  # rounds is the lowest reading in it, and a leak raises the lowest as it raises the rest.
  var rest: Array = rests.map(func(entry: Dictionary) -> float: return Sampler.heap_of(entry.reading))
  var steady: Array = rest.slice(Swap.WARMUP_ROUNDS)
  check(rest.size() == Swap.WARMUP_ROUNDS + Swap.ROUNDS and steady.size() >= 2 * HEAP_WINDOW_ROUNDS and float(steady.min()) > 0.0
    and float(steady.slice(steady.size() - HEAP_WINDOW_ROUNDS).min()) - float(steady.slice(0, HEAP_WINDOW_ROUNDS).min()) <= HEAP_GROWTH_LIMIT_BYTES,
    "heap/The live heap at rest of the last %d steady rounds is within %d bytes of the first %d's" % [HEAP_WINDOW_ROUNDS, HEAP_GROWTH_LIMIT_BYTES, HEAP_WINDOW_ROUNDS])

func check_section() -> void:
  var collected := true
  var comparable := true
  var all_numbers := true
  for reading: Dictionary in readings():
    var perf := Sampler.perf_of(reading)
    collected = collected and Sampler.dig(perf, ["hermes", "collectedBeforeReading"]) == true
    comparable = comparable and Sampler.dig(perf, ["hermes", "source"]) == "jsi::Instrumentation::getHeapInfo" and Sampler.heap_of(reading) > 0.0
    all_numbers = all_numbers and not perf.is_empty() and finite_and_not_negative(perf)
  check(collected and comparable, "section/Every reading of Hermes' heap follows a forced collection, so that two readings are comparable")
  check(all_numbers, "section/Every number of every reading is finite and not negative")

func check_invariants() -> void:
  var inside := true
  var tree := true
  var monotonic := true
  var previous: Dictionary = {}
  for reading: Dictionary in readings():
    var perf := Sampler.perf_of(reading)
    inside = inside and not perf.is_empty()
    tree = tree and not perf.is_empty()
    monotonic = monotonic and not perf.is_empty()
    var pump := series(reading, ["pump"])
    var phases := 0.0
    for name: String in ["js", "mount", "layout"]:
      var phase := series(reading, ["phases", name])
      phases += Sampler.number(phase.get("totalMs"))
      inside = inside and Sampler.number(phase.get("count")) <= Sampler.number(pump.get("count"))
    inside = inside and phases <= Sampler.number(pump.get("totalMs")) * (1.0 + 1e-12) + 1e-9
    var counters: Variant = perf.get("counters", {})
    tree = tree and counters is Dictionary and Sampler.number(counters.get("creates")) - Sampler.number(counters.get("deletes")) == Sampler.number(counters.get("nativeViews"))
    if not previous.is_empty():
      for name: String in ["commits", "creates", "deletes", "updates"]:
        monotonic = monotonic and counter(reading, name) >= counter(previous, name)
      for path: Array in Sampler.SERIES_PATHS:
        monotonic = monotonic and Sampler.number(series(reading, path).get("count")) >= Sampler.number(series(previous, path).get("count"))
    previous = reading
  check(inside, "invariants/At every reading the phases add up to no more than the pump, and none has more samples than the pump")
  check(tree, "invariants/At every reading the views created minus the views deleted are the native views alive")
  check(monotonic, "invariants/The counters and the sample counts never go down from one reading to the next")

func check_windows() -> void:
  var final: Dictionary = stages.final
  var windowed := true
  for path: Array in Sampler.SERIES_PATHS:
    windowed = windowed and series(final, path).has("windowMs")
  check(windowed, "windows/The final reading carries the samples that the host's percentiles come from")

# Every check, from what the run recorded: the same code judges a fresh run and, with --replay, a report that was recorded
# before. The order is the order of the report.
func evaluate() -> void:
  check_provenance()
  check_scene()
  check_swaps()
  check_rounds()
  check_section()
  check_invariants()
  check_windows()

func _initialize() -> void:
  sabotage = OS.get_cmdline_user_args().has("--sabotage")
  for argument: String in OS.get_cmdline_user_args():
    if argument.begins_with("--replay="):
      call_deferred("replay_probe", argument.trim_prefix("--replay="))
      return
  call_deferred("run_probe")

# Judges a report recorded before, without the application: the readings it holds are all the checks read.
func replay_probe(path: String) -> void:
  var file := FileAccess.open(path, FileAccess.READ)
  if file == null:
    push_error("FRONTIER_BASELINE_REPLAY_UNREADABLE: " + path)
    quit(2)
    return
  var parsed: Variant = JSON.parse_string(file.get_as_text())
  file.close()
  if not parsed is Dictionary:
    push_error("FRONTIER_BASELINE_REPLAY_UNPARSEABLE: " + path)
    quit(2)
    return
  var report: Dictionary = parsed
  var recorded: Variant = report.get("stages", {})
  if not Sampler.matches(recorded, REPORT_SHAPE):
    push_error("FRONTIER_BASELINE_REPLAY_INCOMPLETE: " + path)
    quit(2)
    return
  stages = recorded
  evaluate()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  print("FRONTIER_BASELINE_REPLAY: " + str(checks.size()) + " checks, " + str(failures.size()) + " failed")
  print("FRONTIER_BASELINE_REPLAY_CHECKS: " + JSON.stringify(checks))
  quit(0 if failures.is_empty() else 1)

# What the run left, as observations for the log: the heap at rest of the first and the last steady round, and the largest
# step between rounds.
func observe_heap() -> void:
  var rest: Array = stages.rests.map(func(entry: Dictionary) -> float: return Sampler.heap_of(entry.reading))
  var steady: Array = rest.slice(Swap.WARMUP_ROUNDS)
  var largest := 0.0
  for index in range(1, steady.size()):
    largest = maxf(largest, absf(float(steady[index]) - float(steady[index - 1])))
  print("FRONTIER_BASELINE_HEAP: " + JSON.stringify({"firstSteady": steady[0] if not steady.is_empty() else null,
    "last": steady.back() if not steady.is_empty() else null, "largestStep": largest}))

func finish_probe() -> void:
  application.call("stop")
  scene.queue_free()
  await settle(2)
  evaluate()
  observe_heap()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var sabotage_rejected := sabotage and not failures.is_empty()
  var report := {"scenario": "frontier-baseline", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "sabotage": sabotage,
    "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"publicReactNativeImport": true, "headlessOnly": true, "timingsAreRecordedNotJudged": true,
      "residentMemoryIsRecordedNotJudged": true, "frameTimeIsTheWindowedLane": true, "budgetFrozen": false,
      "turnSoakAndFreezeOpen": true, "mobileExportsCertified": false}}
  var output := FileAccess.open("res://build/frontier-baseline-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The baseline report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if sabotage_rejected:
    print("FRONTIER_BASELINE_SABOTAGE_REJECTED: " + str(failures.size()))
  else:
    print("FRONTIER_BASELINE_PASSED: " + str(checks.size()) if failures.is_empty() else "FRONTIER_BASELINE_FAILED")
  quit(0 if failures.is_empty() or sabotage_rejected else 1)
