extends SceneTree

# What the host counts and times of its own work, on four workloads mounted and unmounted in
# a soak. RN ships a Hermes heap reading and a revision telemetry but no budget, and a
# budget for a device is decided after measuring (docs/research/performance.md), so this
# probe measures and checks only what holds at any pace of the machine: the nodes the
# SceneTree holds, the native views the host holds, the orphans Godot counts, the exact
# counters of the host, the invariants of its phase accounting and the heap Hermes reports
# after a collection. Durations, resident memory and Godot's static memory are recorded with
# their provenance and never judged: a hosted runner is slower and noisier than a laptop
# and the headless loop paces its own frames (docs/research/frame-clock.md), so no check
# relies on how long anything took. The independent oracle (tests/performance-oracle.mjs)
# recomputes the percentiles from the samples the host reports and the invariants from the
# report alone.
#
# --allow-original-negative runs the same checks on the preceding host, which has no
# performance section: the checks that need the section are normative and must fail there,
# the rest (the nodes and orphans Godot holds, the views a surface reports) must pass on both
# hosts. --sabotage runs them on a deliberately broken host and expects failures.
# --replay=<report.json> evaluates the checks on a report that was recorded before, without
# running the application.
#
# The readings (the engine's counts next to the host's performance section after a forced collection of Hermes' heap)
# are the shared sampler's (tests/performance-sampler.gd), which the baseline on the pointer spike's scene also takes
# (tests/frontier-baseline-probe.gd).
const Sampler := preload("res://tests/performance-sampler.gd")
const SIZE := Vector2(400, 340)
const WORKLOADS := ["idle", "forms", "chart", "list"]
const COMPONENTS := {"idle": "PerformanceIdle", "forms": "PerformanceForms", "chart": "PerformanceChart", "list": "PerformanceList"}
const CYCLES := 20
const WARMUP_CYCLES := 3
const LIST_ROWS := 120
# The most the live heap at rest may rise above its value after the first steady cycle (tests/performance-cases.mjs).
const HEAP_GROWTH_LIMIT_BYTES := 2048
const RETAIN_OBJECTS := 100000
const RETAIN_MIN_BYTES_PER_OBJECT := 32
const BURN_MS := 30
const BURNS := 3
# A surface is mounted when its state says so and its counters and the application's queues have
# not moved for this many frames. The wait is on state and ends at the limit only if the host
# never settles; no check depends on how many frames it took.
const STABLE_FRAMES := 6
const FRAME_LIMIT := 3000
const APPLICATION_NAME := "PerformanceApplication"

# The shape of a recorded report, as far as evaluate() indexes it: every field some check, or readings(), reads by its name or
# takes as a Dictionary or an Array. A replay refuses a report that does not match it (PERFORMANCE_REPLAY_INCOMPLETE, status 2),
# where indexing what the report lacks would abort the script. A shape is a type name ("number", "string", "bool", "dictionary"
# for a Dictionary of any content, "any" for any value that is there), a Dictionary of the keys that must be present, each with its
# shape, ["each", shape] for an Array whose items all have the shape, or ["pair", shape] for an Array of exactly two. What the checks
# read inside the host's performance section they read through Sampler.dig() and get(), which tolerate its absence (a host with no section
# is the point of the old-host control), so the section is only a Dictionary here.
const READING := {"godot": {"nodes": "number", "nodeMonitor": "number", "orphans": "number"},
  "host": {"rootCount": "number", "pendingRootRetirements": "number"}, "performance": "dictionary"}
const SURFACE := {"state": "string", "nativeTags": "number", "creates": "number", "deletes": "number", "rootCount": "number",
  "liveRoots": "number", "retiredRoots": "number"}
const CYCLE := {"before": READING, "mounted": READING, "after": READING, "mountedSurface": SURFACE, "retiredSurface": SURFACE,
  "mountFrames": "number", "unmountFrames": "number"}
const SOAK := {"cycles": ["each", CYCLE], "final": READING}
const WINDOW := {"aggregates": "bool", "samples": "bool", "performanceBytes": "number"}
const REPORT_SHAPE := {
  "provenance": "dictionary",
  "baseline": READING,
  "heapSource": {"retainedObjects": "number", "releasedObjects": "number", "rest": READING, "retained": READING, "released": READING},
  "burn": ["each", {"ranMs": "number", "before": READING, "after": READING}],
  "windows": {"withoutMeta": WINDOW, "withMeta": WINDOW},
  "stopped": {"stopped": "bool", "rootCount": "number", "plain": ["pair", "string"], "withMetas": ["pair", "string"]},
  "workloads": {"idle": SOAK, "forms": SOAK, "chart": SOAK, "list": SOAK}}

var allow_original_negative := false
var sabotage := false
var application: Node
var sampler: Sampler
var checks: Array = []
var stages: Dictionary = {}
var expected_original_failures: Array = []

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A section check needs the performance section the host reports: the counters, Hermes' heap or
# the phase accounting. The preceding host has none, so it must fail exactly these checks.
func section_check(condition: bool, name: String) -> bool:
  expected_original_failures.append(name)
  return check(condition, name)

func settle(count: int = 8) -> void:
  for index in range(count):
    await process_frame

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(PerformanceProbe." + expression + ")"))

func act(expression: String) -> void:
  application.call("evaluate", "PerformanceProbe." + expression + ";")

func surface_row(node: Control) -> Dictionary:
  var state := Sampler.surface_state(node)
  return {"state": str(state.get("state", "")), "commits": Sampler.number(state.get("commits")), "creates": Sampler.number(state.get("creates")),
    "deletes": Sampler.number(state.get("deletes")), "updates": Sampler.number(state.get("updates")), "mountReports": Sampler.number(state.get("mountReports")),
    "nativeTags": Sampler.number(state.get("nativeTags")), "retiringTags": Sampler.number(state.get("retiringTags")),
    "rootCount": Sampler.number(state.get("rootCount")), "liveRoots": Sampler.number(Sampler.dig(state, ["performance", "counters", "liveRoots"])),
    "retiredRoots": Sampler.number(Sampler.dig(state, ["performance", "counters", "retiredRoots"]))}

# Frames until the surface has mounted and nothing more happens for it. Returns the frames waited,
# or -1 if it never settled.
func wait_mounted(node: Control) -> int:
  var last := ""
  var stable := 0
  for frame in range(FRAME_LIMIT):
    await process_frame
    var state := Sampler.surface_state(node)
    var key := JSON.stringify([state.get("state"), state.get("commits"), state.get("creates"), state.get("deletes"),
      state.get("updates"), state.get("mountReports"), state.get("pendingWork"), state.get("pendingTimers"),
      state.get("pendingAnimationFrames")])
    stable = stable + 1 if key == last else 0
    last = key
    if state.get("state") == "mounted" and stable >= STABLE_FRAMES:
      return frame + 1
  return -1

# Frames until the application holds no root and no retirement is pending. Returns the frames waited,
# or -1.
func wait_retired() -> int:
  for frame in range(FRAME_LIMIT):
    await process_frame
    var state := sampler.app_state()
    if int(Sampler.number(state.get("rootCount"))) == 0 and int(Sampler.number(state.get("pendingRootRetirements"))) == 0:
      return frame + 1
  return -1

var surfaces := 0

func add_surface(workload: String) -> Control:
  var node: Control = ClassDB.instantiate("FabricSurface")
  surfaces += 1
  node.name = "Surface" + str(surfaces)
  node.size = SIZE
  node.set("application_path", NodePath("../" + APPLICATION_NAME))
  node.set("component_name", COMPONENTS[workload])
  root.add_child(node)
  return node

# One cycle of a workload: mount its root, wait until it settles, read, unmount it, wait until the host
# has retired it, read what the surface reports of its own end and read again with nothing mounted.
func run_cycle(workload: String, index: int) -> Dictionary:
  var before := sampler.sample()
  var started := Time.get_ticks_usec()
  var node := add_surface(workload)
  var mount_frames: int = await wait_mounted(node)
  var mount_ms := (Time.get_ticks_usec() - started) / 1000.0
  var mounted := sampler.sample()
  var mounted_surface := surface_row(node)
  started = Time.get_ticks_usec()
  root.remove_child(node)
  var unmount_frames: int = await wait_retired()
  var unmount_ms := (Time.get_ticks_usec() - started) / 1000.0
  var retired_surface := surface_row(node)
  node.free()
  await settle(2)
  var after := sampler.sample()
  return {"index": index, "before": before, "mounted": mounted, "after": after, "mountedSurface": mounted_surface,
    "retiredSurface": retired_surface, "mountFrames": mount_frames, "unmountFrames": unmount_frames,
    "mountWallMs": mount_ms, "unmountWallMs": unmount_ms}

func run_soak(workload: String) -> void:
  var cycles: Array = []
  for index in range(CYCLES):
    cycles.append(await run_cycle(workload, index))
  stages["workloads"][workload] = {"component": COMPONENTS[workload], "cycles": cycles, "final": sampler.sample(true)}
  print("PERFORMANCE_SOAK " + workload + ": " + str(cycles.size()) + " cycles, Hermes heap after the last " + str(int(Sampler.heap_of(cycles.back().after))) + " bytes")

# The probe keeps every reading it takes, and what they hold grows Godot's static memory cycle by cycle
# (about 60 KB per cycle here, with no surface mounted at all). A control that takes the same readings
# and mounts nothing tells that growth from the soak's own.
func run_control() -> void:
  var rows: Array = []
  for index in range(CYCLES):
    rows.append({"index": index, "before": sampler.sample(), "mounted": sampler.sample(), "after": sampler.sample()})
  stages["control"] = {"cycles": rows}

# A game ends its application and may read its snapshot any number of times: a stopped runtime has one state. Stops it (twice,
# as examples/services does) and reads the snapshot again and again, without the validation metas and with them. Hermes' heap
# reading is not idempotent (each getHeapInfo call adds 40 bytes to the live heap), so a host that read it afresh after the
# stop would give a different snapshot every time.
func run_stopped() -> void:
  application.call("stop")
  await settle(4)
  var first := sampler.snapshot_text()
  application.call("stop")
  var second := sampler.snapshot_text()
  var third := sampler.snapshot_text(true, true)
  var fourth := sampler.snapshot_text(true, true)
  var state := Sampler.parsed(first)
  stages["stopped"] = {"stopped": state.get("stopped", false) == true, "rootCount": Sampler.number(state.get("rootCount")), "bytes": first.length(),
    "plain": [first.sha256_text(), second.sha256_text()], "withMetas": [third.sha256_text(), fourth.sha256_text()]}

func run_load() -> void:
  var node := add_surface("idle")
  var frames: int = await wait_mounted(node)
  root.remove_child(node)
  await wait_retired()
  node.free()
  await settle(4)
  stages["load"] = {"mountFrames": frames}

# The heap source answers to what JS holds: a reading after a collection with nothing retained, one
# with RETAIN_OBJECTS objects retained and one after they are released.
func run_heap_source() -> void:
  var rest := sampler.sample()
  var retained_count: Variant = js("retain()")
  var retained := sampler.sample()
  var released_count: Variant = js("release()")
  var released := sampler.sample()
  stages["heapSource"] = {"retainedObjects": Sampler.number(retained_count), "releasedObjects": Sampler.number(released_count),
    "rest": rest, "retained": retained, "released": released}

# JS busy for a while inside a timer, as the host runs it in the JS phase of a pump.
func run_burns() -> void:
  stages["burn"] = []
  js("take()")
  for index in range(BURNS):
    var label := "burn-" + str(index)
    var before := sampler.sample()
    act("burn('" + label + "', " + str(BURN_MS) + ")")
    var ran := -1.0
    for frame in range(FRAME_LIMIT):
      await process_frame
      var notes: Variant = js("take()")
      if notes is Array:
        for note: Dictionary in notes:
          if note.get("kind") == "burn" and note.get("label") == label:
            ran = Sampler.number(note.get("ranMs"))
      if ran >= 0.0:
        break
    await settle(2)
    stages["burn"].append({"label": label, "requestedMs": BURN_MS, "ranMs": ran, "before": before, "after": sampler.sample()})

# Whether every duration series of the section has all of these keys.
func every_series_has(perf: Dictionary, keys: Array) -> bool:
  if perf.is_empty():
    return false
  for path: Array in Sampler.SERIES_PATHS:
    var series: Variant = Sampler.dig(perf, path)
    if not series is Dictionary:
      return false
    for key: String in keys:
      if not series.has(key):
        return false
  return true

# Whether any duration series of the section has this key.
func some_series_has(perf: Dictionary, key: String) -> bool:
  for path: Array in Sampler.SERIES_PATHS:
    var series: Variant = Sampler.dig(perf, path)
    if series is Dictionary and series.has(key):
      return true
  return false

# What the snapshot weighs, and what it holds, without the validation_performance_samples meta (what every other reader of
# the snapshot gets) and with it (what this probe asks for to recompute the percentiles).
func run_windows() -> void:
  var plain_text := sampler.snapshot_text()
  var sampled_text := sampler.snapshot_text(false, true)
  var plain: Dictionary = Sampler.parsed(plain_text).get("performance", {})
  var sampled: Dictionary = Sampler.parsed(sampled_text).get("performance", {})
  var aggregates := ["count", "rejected", "totalMs", "maxMs", "p50Ms", "p95Ms", "p99Ms"]
  stages["windows"] = {
    "withoutMeta": {"aggregates": every_series_has(plain, aggregates), "samples": some_series_has(plain, "windowMs"),
      "performanceBytes": JSON.stringify(plain).length(), "snapshotBytes": plain_text.length()},
    "withMeta": {"aggregates": every_series_has(sampled, aggregates), "samples": every_series_has(sampled, ["windowMs"]),
      "performanceBytes": JSON.stringify(sampled).length(), "snapshotBytes": sampled_text.length()}}
  print("PERFORMANCE_SNAPSHOT: " + JSON.stringify(stages["windows"]))

# -------------------------------------------------------------------- what the checks read
func collections_of(reading: Dictionary) -> float:
  return Sampler.number(Sampler.dig(Sampler.perf_of(reading), ["hermes", "heap", "hermes_numCollections"]))

func counter(reading: Dictionary, name: String) -> float:
  return Sampler.number(Sampler.dig(Sampler.perf_of(reading), ["counters", name]))

func series(reading: Dictionary, path: Array) -> Dictionary:
  var value: Variant = Sampler.dig(Sampler.perf_of(reading), path)
  return value if value is Dictionary else {}

# Every reading of the run, in the order they were taken.
func readings() -> Array:
  var out: Array = [stages.baseline]
  var source: Dictionary = stages.heapSource
  out.append_array([source.rest, source.retained, source.released])
  for entry: Dictionary in stages.burn:
    out.append_array([entry.before, entry.after])
  for workload: String in WORKLOADS:
    var soak: Dictionary = stages.workloads[workload]
    for cycle: Dictionary in soak.cycles:
      out.append_array([cycle.before, cycle.mounted, cycle.after])
    out.append(soak.final)
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

func check_section() -> void:
  var base := Sampler.perf_of(stages.baseline)
  var heap: Variant = Sampler.dig(base, ["hermes", "heap"])
  section_check(not base.is_empty() and base.has("counters") and base.has("hermes") and base.has("pump") and base.has("phases")
    and base.has("surfaces") and base.get("windowSize") is float,
    "section/The application reports a performance section with counters, Hermes' heap, the pump, its phases and the surfaces")
  section_check(heap is Dictionary and Sampler.number(heap.get("hermes_allocatedBytes")) > 0.0
    and Sampler.dig(base, ["hermes", "collectedBeforeReading"]) == true and Sampler.dig(base, ["hermes", "source"]) == "jsi::Instrumentation::getHeapInfo",
    "section/Hermes' heap is read through the instrumentation after a collection and counts live bytes")
  var all_numbers := true
  for reading: Dictionary in readings():
    all_numbers = all_numbers and not Sampler.perf_of(reading).is_empty() and finite_and_not_negative(Sampler.perf_of(reading))
  section_check(all_numbers, "section/Every number of every reading is finite and not negative")

func check_windows() -> void:
  var windows: Dictionary = stages.windows
  var plain: Dictionary = windows.withoutMeta
  var sampled: Dictionary = windows.withMeta
  section_check(plain.aggregates and not plain.samples and sampled.aggregates and sampled.samples
    and Sampler.number(plain.performanceBytes) > 0.0 and Sampler.number(plain.performanceBytes) < Sampler.number(sampled.performanceBytes),
    "section/Without the validation_performance_samples meta the section reports aggregates and no samples, and with it the samples too")

func check_heap_source() -> void:
  var source: Dictionary = stages.heapSource
  var floor_bytes := RETAIN_OBJECTS * RETAIN_MIN_BYTES_PER_OBJECT
  var rest := Sampler.heap_of(source.rest)
  var retained := Sampler.heap_of(source.retained)
  var released := Sampler.heap_of(source.released)
  section_check(Sampler.number(source.retainedObjects) == RETAIN_OBJECTS and retained - rest >= floor_bytes,
    "heap/Retaining JS objects raises the collected heap by at least what they hold")
  section_check(Sampler.number(source.releasedObjects) == RETAIN_OBJECTS and retained - released >= floor_bytes,
    "heap/Releasing them lowers it again by at least that much")
  section_check(collections_of(source.rest) > 0.0 and collections_of(source.retained) > collections_of(source.rest)
    and collections_of(source.released) > collections_of(source.retained),
    "heap/Every reading ran a collection: Hermes' collection count rises from one reading to the next")

func check_burn() -> void:
  var ok: bool = stages.burn.size() == BURNS
  var accounted := true
  for entry: Dictionary in stages.burn:
    var ran := Sampler.number(entry.ranMs)
    var js_delta := Sampler.number(series(entry.after, ["phases", "js"]).get("totalMs")) - Sampler.number(series(entry.before, ["phases", "js"]).get("totalMs"))
    var pump_delta := Sampler.number(series(entry.after, ["pump"]).get("totalMs")) - Sampler.number(series(entry.before, ["pump"]).get("totalMs"))
    var phases := 0.0
    for name: String in ["js", "mount", "layout"]:
      phases += Sampler.number(series(entry.after, ["phases", name]).get("totalMs")) - Sampler.number(series(entry.before, ["phases", name]).get("totalMs"))
    accounted = accounted and ran >= BURN_MS and js_delta >= ran - 1e-6 and js_delta <= pump_delta + 1e-6 and phases <= pump_delta + 1e-6
  section_check(ok and accounted, "pump/A JS turn busy for a while is accounted to the JS phase, inside the pump that ran it, and the phases add up to no more than the pumps")

func check_invariants() -> void:
  var inside := true
  var tree := true
  var monotonic := true
  var previous: Dictionary = {}
  for reading: Dictionary in readings():
    var perf := Sampler.perf_of(reading)
    # A host with no section has nothing to hold these of: no reading passes them by being empty.
    inside = inside and not perf.is_empty()
    tree = tree and not perf.is_empty()
    monotonic = monotonic and not perf.is_empty()
    var pump := series(reading, ["pump"])
    var phases := 0.0
    for name: String in ["js", "mount", "layout"]:
      var phase := series(reading, ["phases", name])
      phases += Sampler.number(phase.get("totalMs"))
      inside = inside and Sampler.number(phase.get("count")) <= Sampler.number(pump.get("count")) and Sampler.number(phase.get("totalMs")) <= Sampler.number(phase.get("maxMs")) * Sampler.number(phase.get("count")) + 1e-9
    inside = inside and phases <= Sampler.number(pump.get("totalMs")) * (1.0 + 1e-12) + 1e-9
    var counters: Variant = perf.get("counters", {})
    tree = tree and counters is Dictionary and Sampler.number(counters.get("creates")) - Sampler.number(counters.get("deletes")) == Sampler.number(counters.get("nativeViews")) and Sampler.number(counters.get("nativeViews")) >= 0.0
    if not previous.is_empty():
      for name: String in ["commits", "creates", "deletes", "updates"]:
        monotonic = monotonic and counter(reading, name) >= counter(previous, name)
      for path: Array in Sampler.SERIES_PATHS:
        var now := series(reading, path)
        var then := series(previous, path)
        monotonic = monotonic and Sampler.number(now.get("count")) >= Sampler.number(then.get("count")) and Sampler.number(now.get("totalMs")) >= Sampler.number(then.get("totalMs"))
        monotonic = monotonic and Sampler.number(now.get("maxMs")) >= Sampler.number(then.get("maxMs"))
      monotonic = monotonic and collections_of(reading) >= collections_of(previous)
    previous = reading
  section_check(inside, "invariants/At every reading the phases add up to no more than the pump, and none has more samples than the pump")
  section_check(tree, "invariants/At every reading the views created minus the views deleted are the native views alive")
  section_check(monotonic, "invariants/The counters, the sample counts and the totals never go down from one reading to the next")

# What a surface reports of its own end is the snapshot the host took as the root was retired, with the application's root
# count and the performance section's live and retired roots brought up to the retirement: they have to agree with each
# other and with the application's own reading taken afterwards. While the root is mounted they agree on the one root alive.
func check_unmount_notification() -> void:
  var agree := true
  var seen := 0
  for workload: String in WORKLOADS:
    var cycles: Array = stages.workloads[workload].cycles
    for cycle: Dictionary in cycles:
      var mounted: Dictionary = cycle.mountedSurface
      var retired: Dictionary = cycle.retiredSurface
      seen += 1
      agree = agree and Sampler.number(mounted.liveRoots) >= 1.0 and mounted.liveRoots == mounted.rootCount \
        and mounted.retiredRoots == counter(cycle.before, "retiredRoots") \
        and Sampler.number(retired.liveRoots) >= 0.0 and retired.liveRoots == retired.rootCount \
        and retired.retiredRoots == counter(cycle.after, "retiredRoots")
  section_check(agree and seen == WORKLOADS.size() * CYCLES, "unmount/The notification of a root's unmount agrees with the application on its live and retired roots")

func check_stopped() -> void:
  var stopped: Dictionary = stages.stopped
  var plain: Array = stopped.plain
  var with_metas: Array = stopped.withMetas
  check(stopped.stopped and Sampler.number(stopped.rootCount) == 0.0 and plain[0] == plain[1] and with_metas[0] == with_metas[1],
    "stop/Two readings of the stopped application's snapshot are identical, with and without the validation metas")

func check_soak(workload: String) -> void:
  var soak: Dictionary = stages.workloads[workload]
  var cycles: Array = soak.cycles
  var baseline: Dictionary = stages.baseline
  var nodes_back := cycles.size() == CYCLES
  var orphans_back := cycles.size() == CYCLES
  var surfaces_clean := cycles.size() == CYCLES
  var host_clean := cycles.size() == CYCLES
  var same_views := cycles.size() == CYCLES
  var mounted_views := -1.0
  for cycle: Dictionary in cycles:
    var after: Dictionary = cycle.after
    nodes_back = nodes_back and after.godot.nodes == baseline.godot.nodes and after.godot.nodeMonitor == baseline.godot.nodeMonitor
    orphans_back = orphans_back and after.godot.orphans == baseline.godot.orphans
    var mounted: Dictionary = cycle.mountedSurface
    var retired: Dictionary = cycle.retiredSurface
    surfaces_clean = surfaces_clean and mounted.state == "mounted" and mounted.nativeTags > 0.0 and mounted.creates - mounted.deletes == mounted.nativeTags \
      and retired.state == "unmounted" and retired.nativeTags == 0.0 and retired.creates == retired.deletes and retired.creates == mounted.creates \
      and Sampler.number(cycle.mountFrames) > 0.0 and Sampler.number(cycle.unmountFrames) > 0.0
    host_clean = host_clean and counter(after, "nativeViews") == 0.0 and counter(after, "liveRoots") == 0.0 \
      and counter(after, "creates") - counter(after, "deletes") == 0.0 and after.host.rootCount == 0.0 and after.host.pendingRootRetirements == 0.0
    var created := counter(cycle.after, "creates") - counter(cycle.before, "creates")
    var deleted := counter(cycle.after, "deletes") - counter(cycle.before, "deletes")
    if mounted_views < 0.0:
      mounted_views = created
    same_views = same_views and created == mounted_views and deleted == created and created == mounted.creates \
      and counter(cycle.after, "commits") - counter(cycle.before, "commits") >= 1.0
  check(nodes_back, workload + "/Every cycle ends with the SceneTree's nodes back to the baseline of this run")
  check(orphans_back, workload + "/Every cycle ends with Godot counting no orphan node beyond the baseline's")
  check(surfaces_clean, workload + "/Every cycle's surface mounts native views and retires with none left: created minus deleted is what it holds")
  section_check(host_clean, workload + "/Every cycle ends with the host holding no native view and no root, and created and deleted views equal")
  section_check(same_views, workload + "/Every cycle creates, and then deletes, the same number of native views, with at least one commit")
  # Bounded in the steady state: from the first steady cycle on, the live heap at rest never rises more than the limit above
  # the first steady cycle's. Judged on the readings, whatever the pace.
  var rest: Array = cycles.map(func(cycle: Dictionary) -> float: return Sampler.heap_of(cycle.after))
  var steady: Array = rest.slice(WARMUP_CYCLES)
  section_check(cycles.size() == CYCLES and not steady.is_empty() and float(steady[0]) > 0.0
    and float(steady.max()) - float(steady[0]) <= HEAP_GROWTH_LIMIT_BYTES,
    workload + "/The live heap after each steady cycle stays within " + str(HEAP_GROWTH_LIMIT_BYTES) + " bytes of the first steady cycle's")
  var final: Dictionary = soak.final
  section_check(Sampler.number(series(final, ["phases", "mount"]).get("count")) > 0.0 and Sampler.number(series(final, ["phases", "layout"]).get("count")) > 0.0
    and Sampler.number(series(final, ["phases", "layout"]).get("totalMs")) > 0.0 and Sampler.number(series(final, ["surfaces", "retire"]).get("count")) >= CYCLES,
    workload + "/The mount and layout phases saw its commits, and the host timed each surface's retirement")

# What the soak left of Hermes' heap, as an observation: the bytes live after each cycle's
# collection, from the first steady cycle on. The limit it is judged by, once chosen, is the oracle's
# (docs/research/performance.md).
func observe_heap() -> void:
  var observed := {}
  for workload: String in WORKLOADS:
    var cycles: Array = stages.workloads[workload].cycles
    var rest: Array = cycles.map(func(cycle: Dictionary) -> float: return Sampler.heap_of(cycle.after))
    var steady: Array = rest.slice(WARMUP_CYCLES)
    var steps := 0.0
    for index in range(1, steady.size()):
      steps = maxf(steps, absf(float(steady[index]) - float(steady[index - 1])))
    observed[workload] = {"firstSteady": steady[0] if not steady.is_empty() else null, "last": steady.back() if not steady.is_empty() else null,
      "growth": float(steady.back()) - float(steady[0]) if not steady.is_empty() else null, "largestStep": steps,
      "min": steady.min() if not steady.is_empty() else null, "max": steady.max() if not steady.is_empty() else null}
    print("PERFORMANCE_HEAP " + workload + ": " + JSON.stringify(observed[workload]))
  stages["observedHeap"] = observed

# Godot's static memory and the resident memory after each steady cycle, as observations: the growth
# per cycle of each soak next to the control's, which takes the same readings and mounts nothing.
func observe_memory() -> void:
  var observed := {}
  var names: Array = WORKLOADS.duplicate()
  names.append("control")
  for name: String in names:
    var cycles: Array = stages["control"].cycles if name == "control" else stages.workloads[name].cycles
    var steady: Array = cycles.slice(WARMUP_CYCLES)
    var first: Dictionary = steady[0].after.godot
    var last: Dictionary = steady.back().after.godot
    var steps := maxi(steady.size() - 1, 1)
    observed[name] = {"staticBytesPerCycle": (Sampler.number(last.staticMemory) - Sampler.number(first.staticMemory)) / steps,
      "rssKbFirst": first.rssKb, "rssKbLast": last.rssKb}
    print("PERFORMANCE_MEMORY " + name + ": " + JSON.stringify(observed[name]))
  stages["observedMemory"] = observed

# Every check, from what the run recorded: the same code judges a fresh run and, with --replay, a
# report that was recorded before. The order is the order of the report.
func evaluate() -> void:
  check_provenance()
  check_section()
  check_windows()
  check_heap_source()
  check_burn()
  check_invariants()
  check_unmount_notification()
  check_stopped()
  for workload: String in WORKLOADS:
    check_soak(workload)

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
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
    push_error("PERFORMANCE_REPLAY_UNREADABLE: " + path)
    quit(2)
    return
  var parsed: Variant = JSON.parse_string(file.get_as_text())
  file.close()
  if not parsed is Dictionary:
    push_error("PERFORMANCE_REPLAY_UNPARSEABLE: " + path)
    quit(2)
    return
  var report: Dictionary = parsed
  var recorded: Variant = report.get("stages", {})
  if not Sampler.matches(recorded, REPORT_SHAPE):
    push_error("PERFORMANCE_REPLAY_INCOMPLETE: " + path)
    quit(2)
    return
  stages = recorded
  evaluate()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  print("PERFORMANCE_REPLAY: " + str(checks.size()) + " checks, " + str(failures.size()) + " failed")
  print("PERFORMANCE_REPLAY_CHECKS: " + JSON.stringify(checks))
  quit(0 if failures.is_empty() else 1)

func run_probe() -> void:
  root.size = Vector2i(440, 360)
  application = ClassDB.instantiate("FabricApplication")
  sampler = Sampler.new(self, application, "PerformanceProbe")
  application.name = APPLICATION_NAME
  application.set("bundle_path", "res://build/performance-probe.js")
  root.add_child(application)
  await settle(10)
  stages["config"] = {"workloads": WORKLOADS, "components": COMPONENTS, "cycles": CYCLES, "warmupCycles": WARMUP_CYCLES, "listRows": LIST_ROWS,
    "heapGrowthLimitBytes": HEAP_GROWTH_LIMIT_BYTES, "retainObjects": RETAIN_OBJECTS, "retainMinBytesPerObject": RETAIN_MIN_BYTES_PER_OBJECT, "burnMs": BURN_MS, "burns": BURNS}
  stages["workloads"] = {}
  # The first mount loads the bundle. The baseline is taken after it, with nothing mounted: the nodes,
  # orphans and native views every cycle has to come back to.
  await run_load()
  stages["provenance"] = sampler.provenance()
  stages["baseline"] = sampler.sample(true)
  await run_heap_source()
  await run_burns()
  for workload: String in WORKLOADS:
    await run_soak(workload)
  # After the soaks, so that the windows are full: the weight of the section is what a long-running application pays.
  run_windows()
  await run_control()
  await run_stopped()
  await finish_probe()

func finish_probe() -> void:
  application.queue_free()
  await settle(2)
  evaluate()
  observe_heap()
  observe_memory()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var sabotage_rejected := sabotage and not failures.is_empty()
  var report := {"scenario": "performance", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages,
    "expectedOriginalFailures": expected_original_failures, "allowOriginalNegative": allow_original_negative,
    "originalNegativeObserved": negative_observed, "sabotage": sabotage, "allCurrentAssertionsPassed": failures.is_empty(),
    "scope": {"publicReactNativeImport": true, "headlessOnly": true, "timingsAreRecordedNotJudged": true,
      "residentMemoryIsRecordedNotJudged": true, "deviceBudgetsDecided": false, "textShapingMeasured": false,
      "mobileExportsCertified": false}}
  var output := FileAccess.open("res://build/performance-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The performance report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if negative_observed:
    print("PERFORMANCE_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif sabotage_rejected:
    print("PERFORMANCE_SABOTAGE_REJECTED: " + str(failures.size()))
  else:
    print("PERFORMANCE_PASSED: " + str(checks.size()) if failures.is_empty() else "PERFORMANCE_FAILED")
  quit(0 if failures.is_empty() or negative_observed or sabotage_rejected else 1)
