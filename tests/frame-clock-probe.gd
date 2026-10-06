extends SceneTree

# The host's frame clock on real Godot pacing. RN runs requestAnimationFrame
# callbacks and its Native Animated from a display link, which never fires twice
# within a refresh period and, after a stall, ticks once and late. Godot's own loop
# does neither: headless it runs a frame every 6.9 ms, capped it follows
# Engine.max_fps, uncapped it runs hundreds of frames a second, and after a long
# frame it delivers a catch-up frame right behind it. Those are loops that nothing
# paces, which the clock times (Time pacing). A window presented with V-Sync is paced
# by its display, its pipelined frames come in two clusters, and every frame with a
# consumer is a tick (Presentation pacing): headless has no display, so the probe
# states through a validation seam how its simulated window is presented. This probe
# drives the application through those paces, reads the host's frame clock and what
# JS and the Controls saw once per Godot frame, and checks only what holds at any
# pacing; the independent oracle (tests/frame-clock-oracle.mjs) recomputes every
# decision of the clock from the frame times the host reports.
#
# No check relies on what the machine delivers. A hosted runner stalls the process and
# a slow one cannot produce a 3 ms frame at all, so a check never assumes a pattern of
# Godot frame times: the rule is stated over the frames that were delivered (a frame
# closer than half a period to the one before, and within a period of the last tick,
# waits; vacuously true where no such frame came) and what each lane really delivered
# is an observation (observedPace in the report, FRAME_CLOCK_PACE lines in the log).
# What a lane counts exists by construction: it runs until it has followed MIN_FRAMES
# frames and MIN_TICKS ticks, and the stalls of the bursts lane are delays the Pacer
# inserts. native/frame_clock_test.cpp proves the rule on the exact patterns instead (the
# 13 and 3 ms pipelined frames, a catch-up frame 0.4 ms behind a stall, a loop of 1000
# frames a second) and on random ones.
#
# --allow-original-negative runs the same checks on the preceding host, which has no
# frame clock and ticks on every Godot frame: the cadence checks are normative and
# must fail there, the rest must pass on both hosts (on a machine that delivers the
# patterns the lanes name). --sabotage runs them on a deliberately broken host and
# expects failures. --replay=<report.json> evaluates the checks on a report that was
# recorded before, a hosted run's artifact say, without running the application.
const SIZE := Vector2(400, 340)
const LIMIT_MS := 8000
# Every lane runs at least this long, whatever the host does to its decay: the
# preceding host ends it within tens of milliseconds at a fast pace, and a lane that
# short would say nothing of the pace it is named for.
const MIN_RUN_MS := 700
# However slow the machine, a lane follows at least this many Godot frames and, on a host with a
# clock, this many ticks before it stops: what the checks count (callbacks, interval firings,
# stalls) exists by construction, not by the speed of the machine.
const MIN_FRAMES := 40
const MIN_TICKS := 8
const PERIOD_MS := 1000.0 / 60.0
const DISPLAY_RATE := 144.0
# RN's decay (velocity 0.5, deceleration 0.99) rests asymptotically at 50 px and
# ends at its first step under 0.1, so a pacing decides how near the 50 it lands:
# frames 1 ms apart end it at 40 px, 6.9 ms apart at 48.5 and a whole 60 Hz period
# apart at 49.4. Under Time pacing, which the four lanes below have, ticks are never
# closer than half a period (8.33 ms), which lands it at 48.75 or beyond whatever the
# steps in between; the oracle derives that window from the driver's own rule, and the
# probe takes it with a margin.
const LANDING_LOWEST := 48.7
const LANDING_HIGHEST := 50.0
const PACINGS := ["paced-60", "headless", "fast", "bursts"]
# What the validation seam says of how the window is presented, per lane.
const SEAMS := {"presentation-bimodal": "presentation", "time-bimodal": "time"}

# Delays the application's frame, before the application's own _process. Either a
# stall on a schedule, the way a hosted runner's busy neighbour does (Godot then
# delivers one catch-up frame right behind it), or the uneven timing a V-Sync window
# pipelines: its frames come in two clusters, about 13 ms and 3 ms apart.
class Pacer extends Node:
  var stall_every := 0
  var stall_usec := 0
  var alternate_usec: Array = []
  var frames := 0
  func _process(_delta: float) -> void:
    frames += 1
    if stall_every > 0 and frames % stall_every == 0:
      OS.delay_usec(stall_usec)
    if not alternate_usec.is_empty():
      OS.delay_usec(int(alternate_usec[frames % alternate_usec.size()]))

var allow_original_negative := false
var sabotage := false
var application: Node
var surface: Control
var pacer: Pacer
var checks: Array = []
var stages: Dictionary = {}
var observed_pace: Dictionary = {}
var expected_original_failures: Array = []
# The host's time when the probe started: every timestamp in the report is relative
# to it, which the report's decimal digits then keep exactly.
var origin_ms := 0.0
var origin_usec := 0

func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition

# A cadence check needs the frame clock: the snapshot of its counters, ticks no
# closer than half a period (under Time pacing, which is where the clock promises
# that), or a decay that lands where those ticks land it. The preceding host has no
# clock and ticks on every Godot frame, so it must fail exactly these checks.
func cadence_check(condition: bool, name: String) -> bool:
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

func js(expression: String) -> Variant:
  return JSON.parse_string(application.call("evaluate", "JSON.stringify(FrameClockProbe." + expression + ")"))

func act(expression: String) -> void:
  application.call("evaluate", "FrameClockProbe." + expression + ";")

func relative(value: float) -> float:
  return value - origin_ms

# Everything JS recorded since the previous call, in order, with its times relative
# to the probe's origin.
func take() -> Array:
  var value: Variant = js("take()")
  var entries: Array = value if value is Array else []
  for entry: Dictionary in entries:
    entry["now"] = relative(number(entry.get("now")))
    if entry.has("timestamp"):
      entry["timestamp"] = relative(number(entry.get("timestamp")))
  return entries

func control(box: String) -> Control:
  if box.is_empty() or not is_instance_valid(surface):
    return null
  var found: Node = surface.find_child("frame-clock-" + box, true, false)
  return found if found is Control else null

# The host's frame clock, as the application reports it; empty on a host without one.
func clock_row(snapshot: Dictionary) -> Dictionary:
  var clock: Dictionary = snapshot.get("frameClock", {})
  if clock.is_empty():
    return {}
  var ticks := int(number(clock.get("ticks")))
  return {"frames": int(number(clock.get("frames"))), "ticks": ticks, "skipped": int(number(clock.get("skippedFrames"))),
    "lastFrameMs": relative(number(clock.get("lastFrameMs"), 0.0)),
    "lastTickMs": relative(number(clock.get("lastTickMs"), 0.0)) if ticks > 0 else null,
    "periodMs": number(clock.get("periodMs")), "refreshRate": number(clock.get("refreshRate")),
    "source": str(clock.get("rateSource", "")), "pacing": str(clock.get("pacing", "")), "pacingSource": str(clock.get("pacingSource", ""))}

# One observation, taken as a Godot frame starts: the previous frame's application
# pump has run, so the clock, the backend and the Control show that pump's outcome.
func sample(box: String) -> Dictionary:
  var snapshot := app_state()
  var animated: Dictionary = snapshot.get("nativeAnimated", {})
  var node := control(box)
  var frames := int(number(animated.get("frames")))
  return {"n": Engine.get_process_frames(), "ms": (Time.get_ticks_usec() - origin_usec) / 1000.0, "clock": clock_row(snapshot),
    "animated": {"frames": frames, "active": animated.get("active", false),
      "lastFrameMs": relative(number(animated.get("lastFrameMs"), 0.0)) if frames > 0 else null},
    "x": node.position.x if node != null else null}

# A run follows the application frame by frame. samples[] hold one sample per Godot
# frame, events[] what JS recorded in the pump between a sample and the one before
# it (at is the sample's index), and marks[] the sample index at which the probe
# acted: the first sample after it is the first pump that saw the action.
func begin(box: String, pattern: String) -> Dictionary:
  return {"box": box, "pattern": pattern, "rest": sample(box), "samples": [], "events": [], "marks": {}}

func mark(run: Dictionary, name: String) -> void:
  run.marks[name] = run.samples.size()

func advance(run: Dictionary, count: int = 1) -> void:
  for index in range(count):
    await process_frame
    run.samples.append(sample(run.box))
    for entry: Dictionary in take():
      entry["at"] = run.samples.size() - 1
      run.events.append(entry)

func ended(run: Dictionary, label: String) -> bool:
  return run.events.any(func(entry: Dictionary) -> bool: return entry.get("kind") == "end" and entry.get("label") == label)

func apply_pacing(name: String) -> void:
  Engine.max_fps = 0
  OS.low_processor_usage_mode_sleep_usec = 6900
  pacer.stall_every = 0
  pacer.alternate_usec = []
  match name:
    "paced-60":
      Engine.max_fps = 60
    "fast":
      OS.low_processor_usage_mode_sleep_usec = 0
    "bursts":
      pacer.stall_every = 5
      pacer.stall_usec = 57000
    "display-144", "fallback-144":
      Engine.max_fps = 144
    "presentation-bimodal", "time-bimodal":
      OS.low_processor_usage_mode_sleep_usec = 0
      pacer.alternate_usec = [13000, 3000]

# The Godot frame times of a run, from the probe's own clock: how the loop was paced.
func gaps(run: Dictionary) -> Array:
  var out: Array = []
  var previous := number(run.rest.ms)
  for row: Dictionary in run.samples:
    out.append(number(row.ms) - previous)
    previous = number(row.ms)
  return out

func median(values: Array) -> float:
  var sorted := values.duplicate()
  sorted.sort()
  return float(sorted[sorted.size() >> 1]) if not sorted.is_empty() else -1.0

# A stall frame is one that follows its predecessor by three periods or more and a
# catch-up frame the one closer than half a period behind it.
func stalls_and_catch_ups(values: Array, period_ms: float) -> Array:
  var stalls := 0
  var catch_ups := 0
  for index in range(values.size()):
    if values[index] >= 3.0 * period_ms:
      stalls += 1
      if index + 1 < values.size() and values[index + 1] < period_ms / 2.0:
        catch_ups += 1
  return [stalls, catch_ups]

# What the machine delivered in a run, as an observation: the frames, their median gap, those
# closer than half a period to the one before, and the stalls with the catch-up frames behind
# them. Nothing here is asserted, since no machine is promised to deliver a pattern. It tells
# which patterns a lane really exercised, and so whether a check that quantifies over them held
# vacuously.
func pace_of(run: Dictionary, period_ms: float) -> Dictionary:
  var values := gaps(run)
  var found := stalls_and_catch_ups(values, period_ms)
  return {"frames": values.size(), "medianGapMs": snappedf(median(values), 0.001),
    "gapsUnderHalfPeriod": values.filter(func(value: float) -> bool: return value < period_ms / 2.0).size(),
    "stalls": found[0], "catchUps": found[1]}

# Every lane's observation, from the runs recorded, on the log and for the report.
func observe_pace() -> void:
  var runs: Dictionary = stages["runs"]
  for name: String in runs.keys():
    var period := 1000.0 / DISPLAY_RATE if name == "display-144" else PERIOD_MS
    observed_pace[name] = pace_of(runs[name], period)
    print("FRAME_CLOCK_PACE " + name + ": " + JSON.stringify(observed_pace[name]))

# One pacing: a loop of frame callbacks, a zero-delay interval and a native decay
# run side by side, a sample per Godot frame, until the decay ends.
func decay_run(pattern: String) -> Dictionary:
  apply_pacing(pattern)
  if SEAMS.has(pattern):
    application.set_meta("validation_frame_pacing", SEAMS[pattern])
  await settle(6)
  var run := begin(pattern, pattern)
  var rest_x := number(run.rest.x)
  act("startInterval('timer')")
  act("startLoop('raf')")
  mark(run, "loop")
  await advance(run, 3)
  act("startDecay(%s)" % JSON.stringify(pattern))
  mark(run, "decay")
  var started := Time.get_ticks_msec()
  while Time.get_ticks_msec() - started < LIMIT_MS and not ended(run, pattern):
    await advance(run)
  await advance(run, 12)
  while Time.get_ticks_msec() - started < LIMIT_MS and (Time.get_ticks_msec() - started < MIN_RUN_MS or not long_enough(run)):
    await advance(run)
  act("stopLoop('raf')")
  mark(run, "stop-loop")
  await advance(run, 6)
  act("stopInterval('timer')")
  mark(run, "stop-interval")
  await advance(run, 3)
  run["restX"] = rest_x
  apply_pacing("headless")
  if SEAMS.has(pattern):
    application.remove_meta("validation_frame_pacing")
  return run

# The lane has followed enough for what its checks count to exist, whatever the machine's speed:
# Godot frames and, on a host with a clock, the ticks that served the loop and the animation.
func long_enough(run: Dictionary) -> bool:
  if run.samples.size() < MIN_FRAMES:
    return false
  var last: Dictionary = run.samples.back()
  return last.clock.is_empty() or counter(last, "ticks") - counter(run.rest, "ticks") >= MIN_TICKS

func pump_pairs(run: Dictionary, from: int, to: int) -> Array:
  var pairs: Array = []
  for index in range(from, to):
    var before: Dictionary = run.rest if index == 0 else run.samples[index - 1]
    pairs.append([before, run.samples[index], index])
  return pairs

func entries_at(run: Dictionary, index: int, kind: String, label: String = "") -> Array:
  return run.events.filter(func(entry: Dictionary) -> bool: return (entry.get("at") == index and entry.get("kind") == kind
    and (label.is_empty() or entry.get("label") == label)))

func counter(row: Dictionary, key: String) -> int:
  return int(number(row.clock.get(key)))

# The timestamp a recorded callback received: the one field of an event that the host decides. A host that
# calls back with none leaves the key out of the entry, so it reads -1 here and the checks that need a real
# timestamp fail on it, where reading the key directly would abort the probe, or a replay of its report, with
# the checks after it never recorded.
func stamp(entry: Dictionary) -> float:
  return number(entry.get("timestamp"))

# No two timestamps of a series are closer than half a period; a period of 0 asks for no
# spacing, which is what a presented window (Presentation pacing) promises.
func apart(values: Array, period_ms: float) -> bool:
  for index in range(1, values.size()):
    if number(values[index]) - number(values[index - 1]) < period_ms / 2.0 - 1e-6:
      return false
  return true

# Over the loop window, the frame callbacks of the loop ran in exactly the pumps the
# clock ticked, each with that tick's timestamp, and the timestamps JS received are
# never closer than half a period (period 0 under Presentation pacing, which asks for none).
func callbacks_on_ticks(run: Dictionary, period_ms: float = PERIOD_MS) -> bool:
  var received: Array = []
  for pair: Array in pump_pairs(run, run.marks["loop"], run.marks["stop-loop"]):
    var before: Dictionary = pair[0]
    var after: Dictionary = pair[1]
    if after.clock.is_empty():
      return false
    var ticked := counter(after, "ticks") - counter(before, "ticks")
    var calls := entries_at(run, pair[2], "frame", "raf")
    if ticked == 0 and not calls.is_empty():
      return false
    if ticked == 1 and (calls.size() != 1 or absf(stamp(calls[0]) - number(after.clock.lastTickMs)) > 1e-4):
      return false
    if ticked not in [0, 1]:
      return false
    for call: Dictionary in calls:
      received.append(stamp(call))
  return received.size() >= 5 and apart(received, period_ms)

# The ticks of a run, whenever they happened, are never closer than half a period (a Time
# pacing property: it is not asked of a presented window, where every frame with a
# consumer ticks).
func ticks_apart(run: Dictionary, period_ms: float) -> bool:
  var previous := -INF
  var seen := 0
  for row: Dictionary in run.samples:
    if row.clock.is_empty():
      return false
    if row.clock.lastTickMs != null and number(row.clock.lastTickMs) != previous:
      if number(row.clock.lastTickMs) - previous < period_ms / 2.0 - 1e-6:
        return false
      previous = number(row.clock.lastTickMs)
      seen += 1
  return seen >= 5

# With a consumer in every frame of the loop window, each Godot frame is a tick or a
# frame the consumer waited through, none is skipped unaccounted.
func frames_accounted(run: Dictionary) -> bool:
  for pair: Array in pump_pairs(run, run.marks["loop"], run.marks["stop-loop"]):
    var before: Dictionary = pair[0]
    var after: Dictionary = pair[1]
    if after.clock.is_empty():
      return false
    if counter(after, "frames") - counter(before, "frames") != 1:
      return false
    if (counter(after, "ticks") - counter(before, "ticks")) + (counter(after, "skipped") - counter(before, "skipped")) != 1:
      return false
  return true

# Over the loop window every Godot frame is a tick and none waited, whatever the time between frames.
func every_frame_ticks(run: Dictionary) -> bool:
  for pair: Array in pump_pairs(run, run.marks["loop"], run.marks["stop-loop"]):
    var before: Dictionary = pair[0]
    var after: Dictionary = pair[1]
    if after.clock.is_empty() or counter(after, "ticks") - counter(before, "ticks") != 1 or counter(after, "skipped") != counter(before, "skipped"):
      return false
  return true

# Over the loop window a consumer waits in every frame, and the rule gives each frame its
# decision from the times the host reported: it ticks unless a tick has served a consumer
# before, it started less than half a period after the previous frame and it started less
# than a period after the last tick. Where the machine delivers frames that close, such as
# the 3 ms ones of a pipelined loop, they must wait; where it delivers none the condition
# holds vacuously, which is the point: it never asks the machine for a pattern. A frame
# exactly on a boundary, to the precision the report keeps, is not judged.
func decisions_follow_the_rule(run: Dictionary, period_ms: float) -> bool:
  for pair: Array in pump_pairs(run, run.marks["loop"], run.marks["stop-loop"]):
    var before: Dictionary = pair[0]
    var after: Dictionary = pair[1]
    if after.clock.is_empty():
      return false
    var ticked := counter(after, "ticks") > counter(before, "ticks")
    var served := counter(before, "ticks") > 0
    var gap := number(after.clock.lastFrameMs) - number(before.clock.lastFrameMs)
    var since := number(after.clock.lastFrameMs) - number(before.clock.lastTickMs) if served else INF
    if absf(gap - period_ms / 2.0) <= 1e-6 or (served and absf(since - period_ms) <= 1e-6):
      continue
    var must := not served or gap >= period_ms / 2.0 or since >= period_ms
    if ticked != must:
      return false
  return true

# The backend delivers a frame only on a tick, at most one, with the tick's timestamp,
# and the timestamps it received are never closer than half a period (period 0 under
# Presentation pacing, which asks for none).
func backend_on_ticks(run: Dictionary, period_ms: float = PERIOD_MS) -> bool:
  var delivered := 0
  var received: Array = []
  for pair: Array in pump_pairs(run, 0, run.samples.size()):
    var before: Dictionary = pair[0]
    var after: Dictionary = pair[1]
    if after.clock.is_empty():
      return false
    var frames: int = int(after.animated.frames) - int(before.animated.frames)
    var ticked := counter(after, "ticks") - counter(before, "ticks")
    if frames not in [0, 1] or frames > ticked:
      return false
    if frames == 1:
      delivered += 1
      received.append(after.animated.lastFrameMs)
      if absf(number(after.animated.lastFrameMs) - number(after.clock.lastTickMs)) > 1e-4:
        return false
  return delivered >= 2 and apart(received, period_ms)

# A stall gives one late tick: the frame that follows a stall of three periods or more ticks,
# and the catch-up frame closer than half a period behind it waits for its period.
func stalls_give_one_late_tick(run: Dictionary) -> bool:
  var stalls := 0
  for pair: Array in pump_pairs(run, run.marks["loop"] + 1, run.marks["stop-loop"] - 1):
    var before: Dictionary = pair[0]
    var after: Dictionary = pair[1]
    if after.clock.is_empty():
      return false
    if number(after.clock.lastFrameMs) - number(before.clock.lastFrameMs) < 3.0 * PERIOD_MS:
      continue
    stalls += 1
    if counter(after, "ticks") - counter(before, "ticks") != 1:
      return false
    var behind: Dictionary = run.samples[pair[2] + 1]
    if number(behind.clock.lastFrameMs) - number(after.clock.lastFrameMs) < PERIOD_MS / 2.0 and counter(behind, "ticks") != counter(after, "ticks"):
      return false
  return stalls >= 3

func timer_every_frame(run: Dictionary) -> bool:
  var fired := 0
  for pair: Array in pump_pairs(run, run.marks["loop"], run.marks["stop-interval"]):
    if entries_at(run, pair[2], "timer", "timer").size() != 1:
      return false
    fired += 1
  return fired >= 20

func landing(run: Dictionary) -> float:
  return number(run.samples.back().x) - number(run.restX)

func decay_checks(pattern: String) -> void:
  var run: Dictionary = stages["runs"][pattern]
  var label := pattern + "/"
  cadence_check(frames_accounted(run) and callbacks_on_ticks(run),
    label + "A frame callback runs in exactly the Godot frames the clock ticks, each with that tick's timestamp, never closer than half a refresh period")
  cadence_check(ticks_apart(run, PERIOD_MS), label + "Ticks are never closer than half a refresh period")
  cadence_check(backend_on_ticks(run),
    label + "RN's Native Animated backend delivers at most one frame per tick, never between ticks, with the tick's timestamp, never closer than half a refresh period")
  check(timer_every_frame(run), label + "A zero-delay interval fires once on every Godot frame, tick or not")
  if pattern == "bursts":
    cadence_check(stalls_give_one_late_tick(run), label + "Each stall gives one late tick: the frame after it ticks and the catch-up frame behind it waits")
  var rests := landing(run)
  var finished := ended(run, pattern)
  # A loop paced like a display lands the decay where RN's 60 Hz clock does on any host; the
  # others are what the clock exists to make it do.
  var landed := finished and rests >= LANDING_LOWEST and rests < LANDING_HIGHEST
  if pattern == "paced-60":
    check(landed, label + "The native decay ends and lands inside the window half-period ticks allow")
  else:
    cadence_check(landed, label + "The native decay ends and lands inside the window half-period ticks allow")

# Frame callbacks and the clock, at Godot's own headless pacing: what JS observes of a
# request, a cancellation, an order and a nesting.
func micro(expression: String, frames: int) -> Dictionary:
  var run := begin("", "headless")
  if not expression.is_empty():
    act(expression)
  mark(run, "act")
  await advance(run, frames)
  return run

# Each request follows 40 idle Godot frames, which the headless loop's sleep (6.9 ms a frame)
# spreads over some 0.28 s, far over one period; the first request is also the first consumer of
# the run, which no tick has served yet. So a request is due in the very next frame whatever the
# machine does between frames.
func run_callbacks() -> void:
  apply_pacing("headless")
  await settle(40)
  var idle := await micro("", 40)
  await settle(40)
  var once := await micro("request('once')", 8)
  await settle(40)
  var cancelled := await micro("cancelled('cancelled')", 8)
  await settle(40)
  var ordered := await micro("ordered('ordered')", 8)
  await settle(40)
  var nested := await micro("nested('nested')", 40)
  stages["callbacks"] = {"idle": idle, "once": once, "cancelled": cancelled, "ordered": ordered, "nested": nested}

func check_callbacks() -> void:
  var stage: Dictionary = stages["callbacks"]
  var idle: Dictionary = stage["idle"]
  var once: Dictionary = stage["once"]
  var cancelled: Dictionary = stage["cancelled"]
  var ordered: Dictionary = stage["ordered"]
  var nested: Dictionary = stage["nested"]
  var first: Dictionary = idle.samples.back()
  cadence_check((not first.clock.is_empty() and counter(first, "frames") - counter(idle.rest, "frames") == 40
    and counter(first, "ticks") == counter(idle.rest, "ticks") and counter(first, "skipped") == counter(idle.rest, "skipped")),
    "callbacks/A Godot frame nothing waits for is neither a tick nor a waited frame")
  # The callback may be missing (a host, or a recorded report, where the request got none): both checks below
  # then fail, and hit[0] is read only once there is exactly one, so a replay judges such a report instead of
  # aborting in check_callbacks with the checks after it never recorded.
  var hit := entries_at(once, 0, "frame", "once")
  check((hit.size() == 1 and entries_at(once, 1, "frame", "once").is_empty() and once.events.size() == 1
    and stamp(hit[0]) > 0.0),
    "callbacks/A request after idling reaches its callback in the very next Godot frame, with a frame timestamp")
  var after: Dictionary = once.samples[0]
  cadence_check((hit.size() == 1 and not after.clock.is_empty() and counter(after, "ticks") == counter(once.rest, "ticks") + 1
    and counter(after, "skipped") == counter(once.rest, "skipped")
    and absf(stamp(hit[0]) - number(after.clock.lastTickMs)) < 1e-4),
    "callbacks/That frame is a tick the clock counts, and its timestamp is the clock's")
  var last: Dictionary = cancelled.samples.back()
  cadence_check((cancelled.events.is_empty() and not last.clock.is_empty()
    and counter(last, "ticks") == counter(cancelled.rest, "ticks") and counter(last, "skipped") == counter(cancelled.rest, "skipped")),
    "callbacks/A request cancelled before its frame never runs and leaves no tick or waited frame behind")
  var parts: Array = ordered.events.filter(func(entry: Dictionary) -> bool: return entry.get("kind") == "frame")
  check((parts.size() == 3 and parts.all(func(entry: Dictionary) -> bool: return entry.at == parts[0].at)
    and parts.map(func(entry: Dictionary) -> String: return str(entry.label)) == ["ordered:a", "ordered:b", "ordered:c"]
    and parts.all(func(entry: Dictionary) -> bool: return stamp(entry) == stamp(parts[0])) and stamp(parts[0]) > 0.0
    and parts[0].sequence < parts[1].sequence and parts[1].sequence < parts[2].sequence),
    "callbacks/Callbacks registered before one frame run in that frame, in order, with one timestamp")
  var outer: Array = nested.events.filter(func(entry: Dictionary) -> bool: return entry.get("label") == "nested:outer")
  var inner: Array = nested.events.filter(func(entry: Dictionary) -> bool: return entry.get("label") == "nested:inner")
  cadence_check((outer.size() == 1 and inner.size() == 1 and inner[0].at > outer[0].at
    and stamp(outer[0]) > 0.0 and stamp(inner[0]) - stamp(outer[0]) >= PERIOD_MS / 2.0 - 1e-6),
    "callbacks/A callback requested from inside a callback runs on a later tick, at least half a refresh period after it")

# The clock's own report on a host whose display reports no rate, which the headless
# DisplayServer never does.
func run_clock() -> void:
  await settle(4)
  var run := begin("", "headless")
  stages["clock"] = {"sample": run.rest}

func check_clock() -> void:
  var clock: Dictionary = stages["clock"]["sample"]["clock"]
  cadence_check((not clock.is_empty() and clock.source == "fallback" and clock.refreshRate == 60.0
    and absf(number(clock.periodMs) - PERIOD_MS) < 1e-9 and int(clock.frames) > 0 and int(clock.ticks) == 0 and int(clock.skipped) == 0),
    "clock/A display that reports no refresh rate gives the 60 Hz fallback period, and the counters start at zero ticks")
  cadence_check(not clock.is_empty() and clock.pacing == "time" and clock.pacingSource == "headless",
    "clock/A headless display server gives Time pacing, since it presents nothing")

func run_display() -> void:
  application.set_meta("validation_refresh_rate", DISPLAY_RATE)
  await settle(2)
  stages["runs"]["display-144"] = await decay_run("display-144")
  application.remove_meta("validation_refresh_rate")
  stages["runs"]["fallback-144"] = await decay_run("fallback-144")

func check_display() -> void:
  var display: Dictionary = stages["runs"]["display-144"]
  var fallback: Dictionary = stages["runs"]["fallback-144"]
  var clock: Dictionary = display.samples.back().clock
  cadence_check((not clock.is_empty() and clock.source == "display" and clock.refreshRate == DISPLAY_RATE
    and absf(number(clock.periodMs) - 1000.0 / DISPLAY_RATE) < 1e-9),
    "display-144/The display's own refresh rate sets the clock's period")
  cadence_check(frames_accounted(display) and callbacks_on_ticks(display, 1000.0 / DISPLAY_RATE) and backend_on_ticks(display, 1000.0 / DISPLAY_RATE)
    and ticks_apart(display, 1000.0 / DISPLAY_RATE),
    "display-144/At 144 Hz callbacks and animation frames run on ticks never closer than half of that period")
  # The loop is the same but the screen reports nothing, so the period is the fallback's: the frames the
  # machine delivers closer than half of it to the one before wait, as many as that loop has.
  var thinned: Dictionary = fallback.samples.back().clock
  cadence_check((not thinned.is_empty() and thinned.source == "fallback" and ticks_apart(fallback, PERIOD_MS)
    and decisions_follow_the_rule(fallback, PERIOD_MS)),
    "fallback-144/The same loop on a screen that reports nothing falls back to 60 Hz: ticks stay half a period apart and the frames closer than that to the one before, within a period of the last tick, wait")

# V-Sync presents every Godot frame as one image, yet the engine pipelines its frames, which come in
# two clusters. The lanes ask the application for a loop with that timing (the Pacer alternates 13 and
# 3 ms of delay, which a fast machine delivers and a slow one does not) and state, through the
# validation seam, how its window is presented: as a V-Sync window (Presentation) and, for contrast,
# as one nothing paces (Time). native/frame_clock_test.cpp runs the same rule on the exact pattern.
func run_pipelined() -> void:
  stages["runs"]["presentation-bimodal"] = await decay_run("presentation-bimodal")
  stages["runs"]["time-bimodal"] = await decay_run("time-bimodal")

func check_pipelined() -> void:
  var presented: Dictionary = stages["runs"]["presentation-bimodal"]
  var timed: Dictionary = stages["runs"]["time-bimodal"]
  var shown: Dictionary = presented.samples.back().clock
  cadence_check((not shown.is_empty() and shown.pacing == "presentation" and shown.pacingSource == "validation"
    and every_frame_ticks(presented) and frames_accounted(presented) and callbacks_on_ticks(presented, 0.0) and backend_on_ticks(presented, 0.0)),
    "presentation-bimodal/Under Presentation pacing every Godot frame is a tick, however close to the one before, and runs a callback and an animation frame")
  var thinned: Dictionary = timed.samples.back().clock
  cadence_check((not thinned.is_empty() and thinned.pacing == "time" and thinned.pacingSource == "validation"
    and ticks_apart(timed, PERIOD_MS) and decisions_follow_the_rule(timed, PERIOD_MS)),
    "time-bimodal/Under Time pacing the same frames are judged by time: those closer than half a period to the one before, within a period of the last tick, wait, and ticks stay half a period apart")

func run_pacings() -> void:
  stages["runs"] = {}
  for pattern: String in PACINGS:
    stages["runs"][pattern] = await decay_run(pattern)

func check_pacings() -> void:
  for pattern: String in PACINGS:
    decay_checks(pattern)
  var landings: Array = PACINGS.map(func(pattern: String) -> float: return landing(stages["runs"][pattern]))
  var spread: float = landings.max() - landings.min()
  cadence_check(spread <= LANDING_HIGHEST - LANDING_LOWEST,
    "decay/The native decay lands within the same window under every Godot pacing, the hosted runner's bursts included")

# Stopping the application with a loop pending: no later tick, and a clock that
# reports one state however often it is asked.
func run_stop() -> void:
  var run := begin("", "headless")
  act("startLoop('raf')")
  await advance(run, 8)
  var before: Dictionary = app_state().get("frameClock", {})
  application.call("stop")
  await settle(12)
  var after: Dictionary = app_state().get("frameClock", {})
  var again: Dictionary = app_state().get("frameClock", {})
  stages["stop"] = {"before": before, "after": after, "again": again}

func check_stop() -> void:
  var before: Dictionary = stages["stop"]["before"]
  var after: Dictionary = stages["stop"]["after"]
  var again: Dictionary = stages["stop"]["again"]
  cadence_check(not before.is_empty() and after == before and again == before and number(before.get("ticks")) > 0.0,
    "stop/Stopping the application with a loop pending ends its ticks and leaves one clock state")

# Every check, from what the lanes recorded: the same code judges a fresh run and, with --replay, a
# report that was recorded before. The order is the order of the report.
func evaluate() -> void:
  observe_pace()
  check_clock()
  check_callbacks()
  check_pacings()
  check_display()
  check_pipelined()
  check_stop()

func _initialize() -> void:
  allow_original_negative = OS.get_cmdline_user_args().has("--allow-original-negative")
  sabotage = OS.get_cmdline_user_args().has("--sabotage")
  for argument: String in OS.get_cmdline_user_args():
    if argument.begins_with("--replay="):
      call_deferred("replay_probe", argument.trim_prefix("--replay="))
      return
  call_deferred("run_probe")

# Judges a report recorded before, without the application: its lanes' frames, events and clock
# snapshots are all the checks read.
func replay_probe(path: String) -> void:
  var file := FileAccess.open(path, FileAccess.READ)
  if file == null:
    push_error("FRAME_CLOCK_REPLAY_UNREADABLE: " + path)
    quit(2)
    return
  var parsed: Variant = JSON.parse_string(file.get_as_text())
  file.close()
  if not parsed is Dictionary:
    push_error("FRAME_CLOCK_REPLAY_UNPARSEABLE: " + path)
    quit(2)
    return
  var report: Dictionary = parsed
  var recorded: Dictionary = report.get("stages", {})
  if not recorded.has("runs") or not recorded.has("callbacks") or not recorded.has("clock") or not recorded.has("stop"):
    push_error("FRAME_CLOCK_REPLAY_INCOMPLETE: " + path)
    quit(2)
    return
  stages = recorded
  evaluate()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  print("FRAME_CLOCK_REPLAY: " + str(checks.size()) + " checks, " + str(failures.size()) + " failed")
  print("FRAME_CLOCK_REPLAY_CHECKS: " + JSON.stringify(checks))
  quit(0 if failures.is_empty() else 1)

func mount_surface() -> void:
  surface = ClassDB.instantiate("FabricSurface")
  surface.name = "A"
  surface.size = SIZE
  surface.set("application_path", NodePath("../FrameClockApplication"))
  surface.set("component_name", "FrameClockProbe")
  root.add_child(surface)

func run_probe() -> void:
  root.size = Vector2i(440, 360)
  pacer = Pacer.new()
  pacer.name = "FrameClockPacer"
  pacer.process_priority = -1000
  root.add_child(pacer)
  application = ClassDB.instantiate("FabricApplication")
  application.name = "FrameClockApplication"
  application.set("bundle_path", "res://build/frame-clock-probe.js")
  root.add_child(application)
  mount_surface()
  await settle(12)
  origin_usec = Time.get_ticks_usec()
  origin_ms = number(js("now()"), 0.0)
  stages["boxes"] = js("boxes()")
  await run_clock()
  await run_callbacks()
  await run_pacings()
  await run_display()
  await run_pipelined()
  await run_stop()
  await finish_probe()

func finish_probe() -> void:
  apply_pacing("headless")
  Engine.max_fps = 0
  surface.queue_free()
  application.queue_free()
  pacer.queue_free()
  await settle(2)
  evaluate()
  var failures: Array = checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var observed := failures.duplicate()
  var expected := expected_original_failures.duplicate()
  observed.sort()
  expected.sort()
  var negative_observed := allow_original_negative and observed == expected and not failures.is_empty()
  var sabotage_rejected := sabotage and not failures.is_empty()
  var report := {"scenario": "frame-clock", "reactNative": "0.87.1", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "checks": checks, "stages": stages, "periodMs": PERIOD_MS,
    "displayRate": DISPLAY_RATE, "expectedOriginalFailures": expected_original_failures,
    "allowOriginalNegative": allow_original_negative, "originalNegativeObserved": negative_observed, "sabotage": sabotage,
    "allCurrentAssertionsPassed": failures.is_empty(), "observedPace": observed_pace,
    "scope": {"publicReactNativeImport": true, "requestAnimationFrameCallbacks": true, "rnCxxNativeAnimatedDecay": true,
      "headlessPacingsOnly": true, "displayRateFromAValidationMetaOnly": true, "realDisplaysCertified": false,
      "vsyncConfigurationCertified": false, "timersQuantizedToTicks": false, "mobileExportsCertified": false}}
  var output := FileAccess.open("res://build/frame-clock-report.json", FileAccess.WRITE)
  if not check(output != null, "report/The frame-clock report is saved with any normative failure visible"):
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  if negative_observed:
    print("FRAME_CLOCK_ORIGINAL_NEGATIVE: " + str(failures.size()))
  elif sabotage_rejected:
    print("FRAME_CLOCK_SABOTAGE_REJECTED: " + str(failures.size()))
  else:
    print("FRAME_CLOCK_PASSED: " + str(checks.size()) if failures.is_empty() else "FRAME_CLOCK_FAILED")
  quit(0 if failures.is_empty() or negative_observed or sabotage_rejected else 1)
