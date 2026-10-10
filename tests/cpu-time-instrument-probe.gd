extends SceneTree

# The self-check of the CPU-time instrument (tests/cpu-time-instrument.gd) for the final comparison V05-10, in a lab scene of its own: an
# empty tree, the instrument, a node that burns a known time in each frame and, in a window, a canvas item that costs the renderer something.
# It needs neither React Native nor the Fabric host, as the arms of the comparison do not.
#
# The run is a schedule of blocks of process frames. The first frames of every block are settle frames, recorded and left out of the
# judgement; the rest are the measured frames.
#   warmup        WARMUP_FRAMES of nothing
#   idle          nothing injected; the first one is FIRST_IDLE_FRAMES long (the idle window the pacing is judged on), the others BETWEEN_IDLE_FRAMES
#   load-<ms>     a busy loop of that many milliseconds in every frame, measured with Time.get_ticks_usec: 2, 5, 10 and 20 ms for LOAD_FRAMES
#                 frames each, with an idle block before the next one
#   render-pulse  (a window only) a canvas item of PULSE_RECTS rectangles shown for one frame in every PULSE_PERIOD, at known draws
#   drain         DRAIN_FRAMES of nothing, so that the render readings of the last measured frames have arrived
#
# What it judges, from the instrument's own samples (the independent oracle, tests/cpu-time-instrument-oracle.mjs, recomputes all of it
# from the raw report):
#   accuracy   for each target T: |median(total in the load-T frames) - base - T| <= TOLERANCE * T, with base the median of the total over
#              the measured frames of every idle block. The busy loop's length as Time.get_ticks_usec measured it is recorded in every frame
#              (the field truth) and its median must be T to within 1%.
#   CPU        the instrument reads CPU time and not the interval between frames: the idle total is at most IDLE_SHARE of the idle interval
#              reference (the median of the half-sums of consecutive pairs of the idle window's intervals, as the baseline's idleReference
#              computes it) at the median and IDLE_P95_SHARE at the 95th percentile, and the process term of a load block takes at least DISTINCT_MINIMUM
#              values and never repeats more than RUN_MAXIMUM frames in a row (a monitor refreshed once a second would).
#   render     (a window only) the render term answers the render pulse and lands on the frame that caused it.
# A window that no display presented (it did not draw nine in ten of the idle frames, or its idle reference is under half of the refresh
# period) is not a measurement: the checks that need the display are recorded as not judged, with the reason, and the report says so.
#
# --report=<name> names the report under res://build; --report=<absolute path> writes it there (a pack's res:// is read-only, as in an export).
# --sabotage expects failures, as the other probes do: scripts/cpu-time-instrument-sabotage.mjs
# breaks a source on purpose and runs the suite on it.
const Instrument := preload("res://tests/cpu-time-instrument.gd")

const TARGETS_MS: Array[int] = [2, 5, 10, 20]
const TOLERANCE := 0.1
const WARMUP_FRAMES := 120
const SETTLE_FRAMES := 10
const FIRST_IDLE_FRAMES := 600
const BETWEEN_IDLE_FRAMES := 200
const LOAD_FRAMES := 200
const PULSE_FRAMES := 264
const PULSE_PERIOD := 11
const PULSE_RECTS := 30000
# The pulses whose draws are the renderer's first of that canvas item cost more than the rest and are left out of the judgement.
const PULSE_WARM := 2
const DRAIN_FRAMES := 12
const IDLE_SHARE := 0.25
const IDLE_P95_SHARE := 0.5
const BURN_TOLERANCE := 0.01
# A clock gives a load block many values and never the same one for long; the engine's monitor, refreshed once a second, gives a handful.
const DISTINCT_MINIMUM := 8
const RUN_MAXIMUM := 10
const PULSE_MINIMUM_GAIN_MS := 0.3
const SIZE := Vector2i(640, 360)
const VSYNC_NAMES := ["disabled", "enabled", "adaptive", "mailbox"]
# Where the busy loop runs in a frame. "in-frame" is a node's _process, between the stamps of the instrument; the sabotage that moves it
# to "before-frame" runs it from a process_frame handler connected before the instrument's, so that it ends before the instrument's
# clock starts and the load is outside the measured frame.
const LOAD_PLACEMENT := "in-frame"

class Burner extends Node:
  var step: Callable
  func _process(_delta: float) -> void:
    if step.is_valid():
      step.call()

class Heavy extends Node2D:
  var rects := 0
  func _draw() -> void:
    for index in range(rects):
      draw_rect(Rect2((index % 200) * 4, int(index / 200.0) * 4, 3, 3), Color(0.2, 0.4, 0.8, 0.5))

var sabotage := false
var report_name := "cpu-time-instrument-report.json"
var windowed := false
var instrument: Node
var heavy: Heavy
var blocks: Array = []
var total_steps := 0
var block_cursor := 0
var finished := false
var started_usec := 0
var checks: Array = []
# One entry per scheduled step, in the order of the frames.
var step_frame: Array = []
var step_block: Array = []
var step_burn_usec: Array = []
var step_pulse: Array = []

# A check that needs the display is not judged when no display presented the window: it is recorded as passed, with the reason it was not judged.
func check(condition: bool, name: String, skipped: String = "") -> bool:
  var passed := condition or skipped != ""
  var row := {"name": name, "passed": passed}
  if skipped != "":
    row["skipped"] = skipped
  checks.append(row)
  if not passed:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return passed

# --- statistics, the same as the oracle's -------------------------------------------------------------------------------------------------

# The median: the middle value, or the mean of the two middle ones when there is an even number of values.
static func median(values: Array) -> float:
  if values.is_empty():
    return 0.0
  var sorted: Array = values.duplicate()
  sorted.sort()
  var middle := int(sorted.size() / 2.0)
  if sorted.size() % 2 == 1:
    return float(sorted[middle])
  return (float(sorted[middle - 1]) + float(sorted[middle])) / 2.0

# The value of rank ceil(p n / 100) of the n sorted values.
static func nearest_rank(values: Array, percentile: int) -> float:
  if values.is_empty():
    return 0.0
  var sorted: Array = values.duplicate()
  sorted.sort()
  var rank := int(ceil(float(percentile * sorted.size()) / 100.0))
  return float(sorted[clampi(rank - 1, 0, sorted.size() - 1)])

# The idle reference of tests/frontier-baseline-oracle.mjs: the nearest-rank median of the half-sums of consecutive pairs.
static func idle_reference(values: Array) -> float:
  var half_sums: Array = []
  for index in range(1, values.size()):
    half_sums.append((float(values[index - 1]) + float(values[index])) / 2.0)
  return nearest_rank(half_sums, 50)

# --- the schedule -------------------------------------------------------------------------------------------------------------------------

func add_block(name: String, kind: String, target_ms: int, measured: int, settle: int) -> void:
  var first := 0 if blocks.is_empty() else int(blocks.back().end)
  blocks.append({"name": name, "kind": kind, "targetMs": target_ms, "first": first, "settle": settle, "measured": measured,
    "end": first + settle + measured})

func build_blocks() -> void:
  add_block("warmup", "warmup", 0, 0, WARMUP_FRAMES)
  add_block("idle-0", "idle", 0, FIRST_IDLE_FRAMES, SETTLE_FRAMES)
  for index in range(TARGETS_MS.size()):
    add_block("load-%d" % TARGETS_MS[index], "load", TARGETS_MS[index], LOAD_FRAMES, SETTLE_FRAMES)
    add_block("idle-%d" % (index + 1), "idle", 0, BETWEEN_IDLE_FRAMES, SETTLE_FRAMES)
  if windowed:
    add_block("render-pulse", "render-pulse", 0, PULSE_FRAMES, SETTLE_FRAMES)
  add_block("drain", "drain", 0, 0, DRAIN_FRAMES)
  total_steps = int(blocks.back().end)

# A busy loop of the given microseconds, measured with the engine's own clock; the microseconds it really took.
func burn_for(microseconds: int) -> int:
  var begin := Time.get_ticks_usec()
  var end := begin + microseconds
  while Time.get_ticks_usec() < end:
    pass
  return Time.get_ticks_usec() - begin

# The frame's work for the schedule: the busy loop of a load block, the canvas item of a render pulse. It is the lab's only per-frame
# code and runs once for every process frame, from wherever LOAD_PLACEMENT puts it.
func run_step() -> void:
  if finished:
    return
  if step_frame.size() >= total_steps:
    finished = true
    call_deferred("finish_run")
    return
  var step := step_frame.size()
  while step >= int(blocks[block_cursor].end):
    block_cursor += 1
  var block: Dictionary = blocks[block_cursor]
  var burned := 0
  var pulse := 0
  if block.kind == "load":
    burned = burn_for(int(block.targetMs) * 1000)
  elif block.kind == "render-pulse":
    var offset: int = step - int(block.first) - int(block.settle)
    pulse = 1 if offset >= 0 and offset % PULSE_PERIOD == 0 else 0
  if heavy != null:
    heavy.visible = pulse == 1
  step_frame.append(Engine.get_process_frames())
  step_block.append(block_cursor)
  step_burn_usec.append(burned)
  step_pulse.append(pulse)

# --- the run ------------------------------------------------------------------------------------------------------------------------------

func _initialize() -> void:
  for argument: String in OS.get_cmdline_user_args():
    if argument == "--sabotage":
      sabotage = true
    elif argument.begins_with("--report="):
      report_name = argument.trim_prefix("--report=")
  windowed = DisplayServer.get_name() != "headless"
  if windowed:
    DisplayServer.window_set_size(SIZE)
    root.size = SIZE
  build_blocks()
  started_usec = Time.get_ticks_usec()
  var burner := Burner.new()
  if LOAD_PLACEMENT == "before-frame":
    process_frame.connect(run_step)
  else:
    burner.step = run_step
  root.add_child(burner)
  if windowed:
    heavy = Heavy.new()
    heavy.rects = PULSE_RECTS
    heavy.visible = false
    root.add_child(heavy)
  instrument = Instrument.new()
  instrument.begin(self)

# The columns of one scheduled step for each sample of the instrument, joined by the frame number. A sample the schedule did not ask for
# (the frame in which the run ends) is dropped and counted.
func build_frames(samples: Dictionary) -> Dictionary:
  var position := {}
  var frames_of_samples: PackedInt64Array = samples.frame
  for index in range(frames_of_samples.size()):
    position[frames_of_samples[index]] = index
  var columns := {"frame": [], "block": [], "burnUsec": [], "renderLoad": []}
  for name: String in ["startUsec", "lastProcessUsec", "preDrawUsec", "physicsUsec", "drawIndex", "drawn", "setupMs", "monitorMs", "intervalMs",
      "processMs", "physicsMs", "renderMs", "renderKnown", "totalMs"]:
    columns[name] = []
  var missing := 0
  for step in range(step_frame.size()):
    var index: int = position.get(step_frame[step], -1)
    if index < 0:
      missing += 1
      continue
    columns["frame"].append(step_frame[step])
    columns["block"].append(step_block[step])
    columns["burnUsec"].append(step_burn_usec[step])
    columns["renderLoad"].append(step_pulse[step])
    for name: String in columns.keys():
      if name in ["frame", "block", "burnUsec", "renderLoad"]:
        continue
      columns[name].append(samples[name][index])
  return {"columns": columns, "missingSamples": missing, "droppedSamples": frames_of_samples.size() - (step_frame.size() - missing)}

func provenance() -> Dictionary:
  var mode := DisplayServer.window_get_vsync_mode()
  return {"godot": Engine.get_version_info().string, "godotHash": Engine.get_version_info().hash, "architecture": Engine.get_architecture_name(),
    "os": OS.get_name(), "displayServer": DisplayServer.get_name(), "renderingDriver": RenderingServer.get_current_rendering_driver_name(),
    "renderingMethod": RenderingServer.get_current_rendering_method(), "adapter": RenderingServer.get_video_adapter_name(),
    "processor": OS.get_processor_name(), "processorCount": OS.get_processor_count(),
    "vsyncMode": mode, "vsyncModeName": VSYNC_NAMES[mode] if mode >= 0 and mode < VSYNC_NAMES.size() else "unknown",
    "refreshRate": DisplayServer.screen_get_refresh_rate(), "maxFps": Engine.max_fps, "windowCanDraw": DisplayServer.window_can_draw(),
    "windowSize": [DisplayServer.window_get_size().x, DisplayServer.window_get_size().y],
    "threadModel": ProjectSettings.get_setting("rendering/driver/threads/thread_model"),
    "physicsTicksPerSecond": Engine.physics_ticks_per_second, "lowProcessorUsageMode": OS.low_processor_usage_mode,
    "lowProcessorUsageSleepUsec": OS.low_processor_usage_mode_sleep_usec}

func config() -> Dictionary:
  return {"targetsMs": TARGETS_MS, "tolerance": TOLERANCE, "warmupFrames": WARMUP_FRAMES, "settleFrames": SETTLE_FRAMES,
    "firstIdleFrames": FIRST_IDLE_FRAMES, "betweenIdleFrames": BETWEEN_IDLE_FRAMES, "loadFrames": LOAD_FRAMES, "drainFrames": DRAIN_FRAMES,
    "pulse": {"frames": PULSE_FRAMES, "period": PULSE_PERIOD, "rects": PULSE_RECTS, "warm": PULSE_WARM, "minimumGainMs": PULSE_MINIMUM_GAIN_MS},
    "renderReadingLagDraws": Instrument.RENDER_READING_LAG_DRAWS, "idleShare": IDLE_SHARE, "idleP95Share": IDLE_P95_SHARE,
    "burnTolerance": BURN_TOLERANCE, "loadPlacement": LOAD_PLACEMENT, "blocks": blocks}

# The measured frames of the blocks of a kind (and a target, for the load blocks): the positions in the columns.
func measured_of(columns: Dictionary, kind: String, target_ms: int = -1) -> Array:
  var positions: Array = []
  var block_of: Array = columns["block"]
  for index in range(block_of.size()):
    var block: Dictionary = blocks[block_of[index]]
    if block.kind == kind and (target_ms < 0 or int(block.targetMs) == target_ms) and index - int(block.first) >= int(block.settle):
      positions.append(index)
  return positions

func values_at(column: Array, positions: Array) -> Array:
  return positions.map(func(index: int) -> float: return float(column[index]))

func evaluate(frames: Dictionary) -> Dictionary:
  var columns: Dictionary = frames.columns
  var summary := {}
  check(frames.missingSamples == 0 and step_frame.size() == total_steps and columns["frame"].size() == total_steps,
    "schedule/Every scheduled frame of the run has a sample of the instrument")
  var contiguous := true
  for index in range(1, columns["frame"].size()):
    contiguous = contiguous and int(columns["frame"][index]) == int(columns["frame"][index - 1]) + 1
  check(contiguous, "instrument/The samples are of consecutive process frames, in order, none twice")
  var idle_positions := measured_of(columns, "idle")
  var known := true
  for kind: String in ["idle", "load", "render-pulse"]:
    for index: int in measured_of(columns, kind):
      known = known and int(columns["renderKnown"][index]) == 1
  check(known, "instrument/Every measured frame has all its terms: the render reading of each drawn frame had arrived")
  # Whether a display presented the window.
  var idle_intervals := values_at(columns["intervalMs"], idle_positions.slice(0, FIRST_IDLE_FRAMES))
  var interval_reference := idle_reference(idle_intervals)
  var presentation := {"windowed": windowed, "idleIntervalReferenceMs": interval_reference}
  var skipped := ""
  if windowed:
    var drawn := 0
    for index: int in idle_positions.slice(0, FIRST_IDLE_FRAMES):
      drawn += int(columns["drawn"][index])
    var period_ms := 1000.0 / DisplayServer.screen_get_refresh_rate() if DisplayServer.screen_get_refresh_rate() > 0.0 else -1.0
    var drew := drawn >= 0.9 * FIRST_IDLE_FRAMES
    var paced := period_ms > 0.0 and interval_reference >= period_ms / 2.0
    presentation.merge({"idleDraws": drawn, "refreshPeriodMs": period_ms, "drew": drew, "paced": paced, "presented": drew and paced})
    if not drew:
      skipped = "not presented: the window did not draw nine in ten of the idle frames"
    elif not paced:
      skipped = "not presented: the display did not pace the loop"
  summary["presentation"] = presentation
  # The busy loop, as the engine's clock measured it.
  var accuracy := {}
  var burn_good := true
  var base := median(values_at(columns["totalMs"], idle_positions))
  for target: int in TARGETS_MS:
    var positions := measured_of(columns, "load", target)
    var burned := median(values_at(columns["burnUsec"], positions)) / 1000.0
    var total := median(values_at(columns["totalMs"], positions))
    var read := total - base
    accuracy[str(target)] = {"frames": positions.size(), "burnedMs": burned, "totalMedianMs": total, "baseMs": base, "readMs": read,
      "error": (read - target) / target}
    burn_good = burn_good and positions.size() == LOAD_FRAMES and absf(burned - target) <= BURN_TOLERANCE * target
  summary["accuracy"] = accuracy
  check(burn_good, "load/The busy loop of every load block ran its target, as Time.get_ticks_usec measured it (the field truth)")
  for target: int in TARGETS_MS:
    var row: Dictionary = accuracy[str(target)]
    check(absf(float(row.readMs) - target) <= TOLERANCE * target,
      "accuracy/The median total minus the idle median is within 10%% of the %d ms load" % target, skipped)
  # CPU time and not the interval.
  var idle_totals := values_at(columns["totalMs"], idle_positions)
  var idle_total_median := median(idle_totals)
  var idle_total_p95 := nearest_rank(idle_totals, 95)
  summary["cpu"] = {"idleTotalMedianMs": idle_total_median, "idleTotalP95Ms": idle_total_p95, "idleIntervalReferenceMs": interval_reference}
  check(idle_total_median <= IDLE_SHARE * interval_reference and idle_total_p95 <= IDLE_P95_SHARE * interval_reference,
    "cpu/The idle total is a small part of the idle interval: the instrument reads CPU time and not the interval between frames", skipped)
  var varies := true
  var variation := {}
  for target: int in TARGETS_MS:
    var seen := {}
    var run := 0
    var longest := 0
    var previous: Variant = null
    for index: int in measured_of(columns, "load", target):
      var term: float = columns["processMs"][index]
      seen[term] = true
      run = run + 1 if previous != null and term == previous else 1
      longest = maxi(longest, run)
      previous = term
    variation[str(target)] = {"distinct": seen.size(), "longestRun": longest}
    varies = varies and seen.size() >= DISTINCT_MINIMUM and longest <= RUN_MAXIMUM
  summary["processTermVariation"] = variation
  check(varies, "cpu/The process term changes from frame to frame in the load blocks, as a clock does and a monitor refreshed once a second does not")
  if windowed:
    var render := evaluate_render(frames)
    summary["render"] = render
    check(bool(render.responds), "render/The render term answers a synthetic render load and lands on the draw that caused it", skipped)
  return summary

# The render pulse: for every lag in draws, how much more the reading is at the pulse frames' draws plus that lag than at the other frames'.
func evaluate_render(frames: Dictionary) -> Dictionary:
  var columns: Dictionary = frames.columns
  var readings: Dictionary = frames.readings
  var by_draw := {}
  for index in range(readings.draw.size()):
    by_draw[int(readings.draw[index])] = float(readings.ms[index])
  var measured := measured_of(columns, "render-pulse")
  var pulses: Array = []
  var others: Array = []
  var seen := 0
  for index: int in measured:
    if int(columns["renderLoad"][index]) == 1:
      seen += 1
      if seen > PULSE_WARM:
        pulses.append(index)
    elif seen > PULSE_WARM:
      others.append(index)
  var gains: Array = []
  for lag in range(PULSE_PERIOD):
    var on: Array = []
    var off: Array = []
    for index: int in pulses:
      var draw: int = int(columns["drawIndex"][index]) + lag
      if by_draw.has(draw):
        on.append(by_draw[draw])
    for index: int in others:
      var draw: int = int(columns["drawIndex"][index]) + lag
      if by_draw.has(draw):
        off.append(by_draw[draw])
    gains.append(median(on) - median(off))
  var best := 0
  for lag in range(gains.size()):
    if float(gains[lag]) > float(gains[best]):
      best = lag
  var lag_draws: int = Instrument.RENDER_READING_LAG_DRAWS
  var responds: bool = best == lag_draws and float(gains[lag_draws]) >= PULSE_MINIMUM_GAIN_MS and pulses.size() > 0
  for lag in range(gains.size()):
    responds = responds and (lag == lag_draws or float(gains[lag]) < 0.25 * float(gains[lag_draws]))
  return {"pulses": pulses.size(), "gainsMs": gains, "bestLag": best, "responds": responds}

func finish_run() -> void:
  instrument.finish()
  var samples: Dictionary = instrument.samples()
  var frames := build_frames(samples)
  frames["readings"] = samples.renderReadings
  var summary := evaluate(frames)
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var report := {"scenario": "cpu-time-instrument", "lane": "windowed" if windowed else "headless", "godot": Engine.get_version_info().string,
    "provenance": provenance(), "config": config(), "frames": frames.columns, "renderReadings": samples.renderReadings,
    "missingSamples": frames.missingSamples, "droppedSamples": frames.droppedSamples, "summary": summary, "checks": checks,
    "sabotage": sabotage, "allCurrentAssertionsPassed": failures.is_empty(), "seconds": float(Time.get_ticks_usec() - started_usec) / 1000000.0}
  var output := FileAccess.open(report_name if report_name.is_absolute_path() else "res://build/" + report_name, FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_ERROR: cannot write the report")
    quit(1)
    return
  output.store_string(JSON.stringify(report) + "\n")
  output.close()
  instrument.queue_free()
  var sabotage_rejected := sabotage and not failures.is_empty()
  if sabotage_rejected:
    print("CPU_TIME_INSTRUMENT_SABOTAGE_REJECTED: " + str(failures.size()))
  elif failures.is_empty():
    print("CPU_TIME_INSTRUMENT_PASSED: " + str(checks.size()))
  else:
    print("CPU_TIME_INSTRUMENT_FAILED")
  quit(0 if failures.is_empty() or sabotage_rejected else 1)
