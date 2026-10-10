extends SceneTree

# The scenario of one execution of the final comparison (V05-10, criterion `execucao`): the script of docs/research/frontier-comparison-protocol.json (`runs.script`) played once,
# in one Godot process, in any of the three arms, with the one CPU-time instrument (tests/cpu-time-instrument.gd) running through all of it.
#
#   godot --path <project> [--headless|--windowed] -- --arm=A|B|C --lane=presented|unlimited --out=<absolute file>
#
# No `-s`: this script is the project's main loop (`application/run/main_loop_type` = FrontierComparisonEntry, set by the runner in override.cfg), the way a Release export runs it, where
# `-s` is discarded (docs/research/frontier-comparison-execution.md, "The entry").
#
# The script, step by step (docs/research/frontier-comparison-execution.md has the rule of the protocol for each):
#   boot              instantiates the arm's scene; in the unlimited lane asks for the vsync DISABLED and reads it back; in B and C measures the time to the interactive HUD
#   idle              600 frames with nothing injected
#   replay            the 77 steps of the 12-turn replay, through GameServices; the frames belong to no window
#   soak              100 turns of the scripted player after a new game; the windows `ai-phase` and `event-burst`
#   context-switches  24 + 50 intents that change the game's context, through the seven contexts (frontier-comparison-cycle.gd)
#   latency           (B and C) 2 + 30 real clicks on HUD controls found by testID
#   stress            2 + 30 rounds of the stress hooks; the window `stress`
#   end               the 12 drain frames of the instrument, then the readings at rest
#
# What the scenario never does inside a measured frame: evaluate JavaScript, read the Surface's snapshot or take a reading at rest. A frame belongs to a window only through the frame
# numbers the trace records; everything else (the settle frames between intents, the readings, the setup of a round) belongs to none. The little the script does inside a window's
# frames is what a consumer does in any case: the call of the intent, the handler of `turn_ended`, a trace entry, and in the event burst the two counters it compares.
#
# The output is the raw execution (the orchestrator, scripts/frontier-comparison-run.mjs, adds the provenance of the files, the load, the exit code and the log, and builds the
# campaign's execution object). Nothing here judges the validity of the execution: that is the analysis' (scripts/frontier-comparison-validity.mjs).
const Instrument := preload("cpu-time-instrument.gd")
const Hud := preload("frontier-comparison-hud.gd")
const Player := preload("frontier-comparison-player.gd")
const Readings := preload("frontier-comparison-readings.gd")
const Cycle := preload("frontier-comparison-cycle.gd")
const Presence := preload("window-presence.gd")
const Replay := preload("res://game/replay.gd")
const Rules := preload("res://game/rules.gd")

const FORMAT := "godot-fabric.frontier-comparison-scenario/v1"
const EMPTY_SCENE := "res://comparison/frontier-comparison-empty.tscn"
const LANES := ["presented", "unlimited"]
const IDLE_FRAMES := 600
const DRAIN_FRAMES := 12
const TURNS := 100
const LATENCY_WARMUP := 2
const LATENCY_MEASURED := 30
const STRESS_WARMUP := 2
const STRESS_MEASURED := 30
# What the scenario waits for in the windows, as the protocol states it in words (`windows[].ends`): a burst of at least 5 frames from the delivery of `turn_ended`, a switch of 3 frames, a stress
# round of 20 per-frame steps and the 2 frames after the last. The scenario derives no window from them: it waits, and records the trace. scripts/frontier-comparison-run-windows.mjs derives the
# windows from the trace, with the numbers it reads from the protocol, and refuses a report whose numbers (`config.waits`) are not those.
const BURST_MINIMUM_FRAMES := 5
const SWITCH_FRAMES := 3
const STRESS_STEPS := 20
const STRESS_TAIL := 2
# Frames of rest after every intent that is not a window's own, so that the HUD has caught up before the next one (the scenario counts them and nothing in them is measured).
const SETTLE_FRAMES := 6
# Bounds on a wait for a state, never a measure.
const QUIET_LIMIT := 600
const JOB_FRAME_LIMIT := 60
const BURST_FRAME_LIMIT := 120
const CLICK_FRAME_LIMIT := 30
const TURN_STEP_LIMIT := 40
const BOOT_FRAME_LIMIT := 1200
const BENCH_CALLS := 200
# The controls the latency pass clicks, found by testID in the live tree: a stack of two units is selected, and the click picks one of its units or clears the selection.
const LATENCY_PAIRS := [
  {"target": "hud-actions-select_unit-2", "to": "warrior"},
  {"target": "hud-actions-select_unit-1", "to": "settler"},
]
const LATENCY_CLEAR := {"target": "hud-actions-clear_selection", "to": "none"}

var arm := "A"
var lane := "presented"
var out_path := ""
var windowed := false
var hud: Hud
var services: Node
var instrument: Node
var presence: Presence
var aborted := ""

# The trace of the events that open and close windows (kinds and meanings in scripts/frontier-comparison-run-windows.mjs), recorded only while a window's script is running.
var trace: Array = []
var recording_turns := false
var ended_count := 0
var last_ended_frame := -1
# Why a window cannot be measured in this arm, read once at the boot ("" when it can): the hooks of the game and of the HUD are detected by name, never invented.
var event_burst_reason := ""
var stress_reason := ""
var marks: Array = []
var anomalies: Array = []

var boot_report := {}
var game_report := {"replayStepMismatches": [], "soakRefusals": 0, "soakDecisions": 0, "soakTurns": 0}
var idle_range := {"first": -1, "last": -1}
var switch_log: Array = []
var parity_checks: Array = []
var latency_report := {"available": false, "reason": "", "warmupFrames": [], "frames": [], "failed": []}
var stress_report := {"rounds": 0}
var rss_series: Array = []
var reading_costs := {}
var final_counters := {}
var vsync_requested := "default"


func _initialize() -> void:
  for argument: String in OS.get_cmdline_user_args():
    if argument.begins_with("--arm="):
      arm = argument.get_slice("=", 1)
    elif argument.begins_with("--lane="):
      lane = argument.get_slice("=", 1)
    elif argument.begins_with("--out="):
      out_path = argument.get_slice("=", 1)
  windowed = DisplayServer.get_name() != "headless"
  drop_empty_scene()
  if not Hud.is_arm(arm) or not LANES.has(lane) or out_path == "":
    push_error("FABRIC_ERROR: use -- --arm=A|B|C --lane=presented|unlimited --out=<file>")
    quit(2)
    return
  if lane == "unlimited":
    vsync_requested = "DISABLED"
    Readings.disable_vsync()
  instrument = Instrument.new()
  var viewports: Array[RID] = [root.get_viewport_rid()]
  instrument.begin(self, viewports)
  hud = Hud.new(self, arm)
  hud.instantiate()
  services = hud.services
  services.turn_ended.connect(_on_turn_ended)
  call_deferred("run")


# As the main loop the engine adds the project's main scene (an empty node) before `_initialize`; it is freed here, so that `scene-nodes` counts the tree that the `-s` entry had.
func drop_empty_scene() -> void:
  var scene := current_scene
  if scene != null and scene.scene_file_path == EMPTY_SCENE:
    root.remove_child(scene)
    scene.free()


# The handler of `turn_ended`: the count of the notification and the record of the frame that delivered it, in every arm.
func _on_turn_ended(_summary: Dictionary) -> void:
  ended_count += 1
  last_ended_frame = Engine.get_process_frames()
  if recording_turns:
    trace.append({"frame": last_ended_frame, "kind": "turn-ended"})


func run() -> void:
  await boot()
  if aborted == "":
    await idle()
  if aborted == "":
    await replay()
  if aborted == "":
    await soak()
  if aborted == "":
    await switches()
  if aborted == "":
    await latency()
  if aborted == "":
    await stress()
  await finish_run()


# --- Waiting ---------------------------------------------------------------------------------------------------------------------------

func frames(count: int) -> void:
  for index in range(count):
    await process_frame


func mark(name: String) -> void:
  marks.append({"name": name, "frame": Engine.get_process_frames()})


# The HUD has caught up with the game: the set of live Controls has not changed and no job is running for SETTLE_FRAMES frames in a row. Arm A has no HUD, so it only rests.
func quiet() -> void:
  var last := ""
  var stable := 0
  for frame in range(QUIET_LIMIT):
    await process_frame
    var key := JSON.stringify(hud.live_views().keys()) if hud.has_hud() else ""
    stable = stable + 1 if key == last and int(services.job) == 0 else 0
    last = key
    if stable >= SETTLE_FRAMES:
      return
  anomalies.append("quiet: the game and the HUD did not rest within %d frames" % QUIET_LIMIT)


# Waits for the end-of-turn job to finish.
func wait_job() -> bool:
  for frame in range(JOB_FRAME_LIMIT):
    if int(services.job) == 0:
      return true
    await process_frame
  return int(services.job) == 0


func rest_reading(stage: String) -> void:
  var timed := Readings.timed(Readings.rss_mb)
  rss_series.append(float(timed.value))
  reading_costs["rssMb"] = int(timed.usec)
  mark("rest-after-" + stage)


# --- boot --------------------------------------------------------------------------------------------------------------------------------

func boot() -> void:
  mark("boot")
  await frames(2)
  hud.fit_window()
  await frames(2)
  if hud.has_hud():
    await boot_hud()
  if windowed:
    presence = Presence.new(self)
    boot_report["presence"] = await presence.open()
    presence.close()
  await quiet()
  event_burst_reason = hud.event_burst_reason()
  stress_reason = hud.stress_reason()
  boot_report["hooks"] = {"statsMethod": hud.stats_available(), "notificationsEmitted": services.has_method("notifications_emitted"),
    "stress": stress_reason == "", "eventBurstReason": event_burst_reason, "stressReason": stress_reason}
  rest_reading("boot")
  # The reading spawned a process: the idle window does not begin in the frame that did.
  await frames(SETTLE_FRAMES)


# The time to the interactive HUD: from the start of the process, on the engine's clock, to the first frame in which the initial context's testIDs are present and a script's click on a
# control is accepted. The click is New game, which the game takes (the epoch rises) and changes nothing the replay or the soak read: both begin with a new game of their own.
func boot_hud() -> void:
  var epoch := int(services.epoch)
  var attempts := 0
  var shown_at := -1
  for frame in range(BOOT_FRAME_LIMIT):
    await process_frame
    var live := hud.live_views()
    if hud.parity_matches("none", live) and live.has("hud-bar-end-turn") and live.has("hud-bar-new-game"):
      if shown_at < 0:
        shown_at = Engine.get_process_frames()
      hud.click(live["hud-bar-new-game"])
      attempts += 1
    if int(services.epoch) != epoch:
      boot_report["timeToInteractiveHudMs"] = float(Time.get_ticks_usec()) / 1000.0
      boot_report["frames"] = frame + 1
      boot_report["shownAtFrame"] = shown_at
      boot_report["clicks"] = attempts
      return
  aborted = "boot: the initial HUD never accepted a click within %d frames" % BOOT_FRAME_LIMIT


# --- idle ----------------------------------------------------------------------------------------------------------------------------------

func idle() -> void:
  mark("idle")
  await process_frame
  idle_range.first = Engine.get_process_frames()
  await frames(IDLE_FRAMES - 1)
  idle_range.last = Engine.get_process_frames()
  rest_reading("idle")


# --- replay ------------------------------------------------------------------------------------------------------------------------------

# The 12-turn replay through GameServices, waiting for the job of every End Turn as consumers/civ-lite/hud_validation.gd does. Its frames belong to no window.
func replay() -> void:
  mark("replay")
  services.new_game()
  await quiet()
  for index in range(Replay.STEPS.size()):
    var step: Dictionary = Replay.STEPS[index]
    var result: Dictionary = services.callv(step.intent, step.args)
    if result.code != step.code:
      game_report.replayStepMismatches.append(index)
    if step.intent == "end_turn" and int(result.ok) == 1 and not await wait_job():
      aborted = "replay: the job of step %d did not finish" % index
      return
    await process_frame
  game_report["replaySteps"] = Replay.STEPS.size()
  game_report["replayGoldenHash"] = services.game.state_hash()
  await quiet()
  rest_reading("replay")


# --- soak ----------------------------------------------------------------------------------------------------------------------------------

func soak() -> void:
  mark("soak")
  services.new_game()
  await quiet()
  var player := Player.new()
  var hashes: Array = []
  recording_turns = true
  for turn in range(TURNS):
    var steps := 0
    var ended_turn := false
    while not ended_turn:
      steps += 1
      if steps > TURN_STEP_LIMIT:
        aborted = "soak: turn %d took more than %d steps" % [turn + 1, TURN_STEP_LIMIT]
        return
      # The decision is taken in a frame of rest, never in the frame that accepts the End Turn: the snapshot it reads is the game's, and costs what the game costs.
      await frames(SETTLE_FRAMES)
      var decision := player.decide(services.get_snapshot())
      if decision.is_empty():
        aborted = "soak: the player had nothing to decide at turn %d" % (turn + 1)
        return
      game_report.soakDecisions += 1
      if decision.id == "end_turn":
        await end_turn()
        if aborted != "":
          return
        ended_turn = true
      else:
        var result: Dictionary = services.callv(decision.id, decision.args)
        if int(result.ok) != 1:
          game_report.soakRefusals += 1
    hashes.append(services.game.state_hash())
  recording_turns = false
  game_report["soakFinalHash"] = hashes[-1]
  game_report["soakTurns"] = hashes.size()
  game_report["soakTurnHashes"] = hashes
  game_report["soakGameTurn"] = int(services.game.state.turn)
  var trail := ""
  for hash: String in hashes:
    trail += hash + "\n"
  game_report["soakTrailHash"] = trail.sha256_text()
  await quiet()
  rest_reading("soak")


# The End Turn of a turn of the soak, from the frame that accepts it to the frame at whose start the turn's notifications have been consumed. The call is made in the first thing
# the frame does; `turn_ended` is recorded by its handler, in the frame that delivers it. The reads of the counters begin at the frame after the burst's minimum, so that nothing but
# the waiting for a frame happens in the frames that are certainly part of it; arm A, whose agreement needs two readings of the emitter's counter, begins one frame earlier.
func end_turn() -> void:
  await process_frame
  var accepted_frame := Engine.get_process_frames()
  var before := ended_count
  var result: Dictionary = services.end_turn()
  if int(result.ok) != 1:
    aborted = "soak: End Turn was refused (%s) at frame %d" % [str(result.code), accepted_frame]
    return
  trace.append({"frame": accepted_frame, "kind": "end-turn-accepted"})
  var waited := 0
  while ended_count == before:
    await process_frame
    waited += 1
    if waited > JOB_FRAME_LIMIT:
      aborted = "soak: the job of the End Turn of frame %d did not deliver turn_ended" % accepted_frame
      return
  if event_burst_reason != "":
    return
  while Engine.get_process_frames() < last_ended_frame + BURST_MINIMUM_FRAMES - (0 if hud.has_hud() else 1):
    await process_frame
  var previous_emitted := -1
  for spent in range(BURST_FRAME_LIMIT):
    var counters := hud.notification_counters()
    var settled := hud.notifications_settled(counters, previous_emitted)
    previous_emitted = int(counters.emitted)
    if settled:
      trace.append({"frame": Engine.get_process_frames(), "kind": "events-settled"})
      return
    await process_frame
  anomalies.append("soak: the notifications of the turn delivered at frame %d were not consumed within %d frames" % [last_ended_frame, BURST_FRAME_LIMIT])


# --- context-switches --------------------------------------------------------------------------------------------------------------

func check_parity(context: String) -> void:
  if hud.has_hud():
    var live := hud.live_views()
    parity_checks.append({"context": context, "matches": hud.parity_matches(context, live), "panels": hud.panels_shown(live)})


# The switches of the cycle in order, 24 + 50 of them. A round is a new game (frontier-comparison-cycle.gd): the switches in the order of the round, each preceded by the setup it carries.
func switches() -> void:
  mark("context-switches")
  var round_open := -1
  for occurrence: Dictionary in Cycle.occurrences():
    if int(occurrence.round) != round_open:
      round_open = int(occurrence.round)
      services.new_game()
      await quiet()
      check_parity("none")
    var switch: Dictionary = occurrence.switch
    if switch.has("setup"):
      await setup(switch.setup, switch.from)
      if aborted != "":
        return
    await switch_once(switch)
  rest_reading("context-switches")


# The steps that make the game ready for a switch (the founding of the city, the End Turns and the answers that raise and open the dialog), outside every window. It ends at rest, in the
# context the switch leaves.
func setup(steps: Array, from: String) -> void:
  for step: Dictionary in steps:
    await frames(SETTLE_FRAMES)
    for turn in range(int(step.get("end_turns", 0))):
      var ended: Dictionary = services.end_turn()
      if int(ended.ok) != 1 or not await wait_job():
        aborted = "context-switches: an End Turn of the setup of a round did not run (%s)" % str(ended.code)
        return
      await frames(SETTLE_FRAMES)
    if step.has("intent"):
      var result: Dictionary = services.callv(step.intent, step.args)
      if int(result.ok) != 1:
        aborted = "context-switches: the setup %s was refused (%s)" % [str(step.intent), str(result.code)]
        return
  await quiet()
  var reached := str(services.get_snapshot().context)
  if reached != from:
    anomalies.append("context-switches: the setup left the game in %s, not in %s" % [reached, from])
  check_parity(reached)


# One switch: the intent in a frame of its own, the two frames after it, then rest. The frame that receives the intent is the first of the occurrence.
func switch_once(switch: Dictionary) -> void:
  await frames(SETTLE_FRAMES)
  await process_frame
  var frame := Engine.get_process_frames()
  trace.append({"frame": frame, "kind": "context-switch"})
  var result: Dictionary = services.callv(switch.intent, switch.args)
  await frames(SWITCH_FRAMES - 1)
  await frames(SETTLE_FRAMES)
  var reached := str(services.get_snapshot().context)
  switch_log.append({"id": switch.id, "frame": frame, "ok": int(result.ok), "code": str(result.code), "to": switch.to, "reached": reached})
  if int(result.ok) != 1 or reached != switch.to:
    anomalies.append("context-switches: %s answered %s and left the game in %s, not %s" % [switch.id, str(result.code), reached, switch.to])
  check_parity(reached)


# --- latency -------------------------------------------------------------------------------------------------------------------------------

# The frames from a real click on a control to the moment the HUD shows the panels of the context the click leads to: 0 when the HUD answers inside the click's own call, -1 when it never does.
func click_to_panel(target: String, to: String) -> int:
  var control: Control = hud.live_views().get(target)
  if control == null:
    anomalies.append("latency: the control %s is not in the live tree" % target)
    return -1
  var first := Engine.get_process_frames()
  hud.click(control)
  var waited := 0
  while not hud.shows_context(to, hud.live_views()):
    if waited >= CLICK_FRAME_LIMIT:
      return -1
    await process_frame
    waited = Engine.get_process_frames() - first
  return Engine.get_process_frames() - first


func latency() -> void:
  mark("latency")
  if not hud.has_hud():
    latency_report["reason"] = "arm A has no HUD: the latency pass is for B and C"
    return
  latency_report["available"] = true
  services.new_game()
  await quiet()
  var clicks := 0
  while clicks < LATENCY_WARMUP + LATENCY_MEASURED:
    var pair: Dictionary = LATENCY_PAIRS[floori(clicks / 2.0) % LATENCY_PAIRS.size()]
    services.select_tile(Cycle.STACK_TILE.x, Cycle.STACK_TILE.y)
    await quiet()
    for click: Dictionary in [pair, LATENCY_CLEAR]:
      await frames(SETTLE_FRAMES)
      var result: int = await click_to_panel(click.target, click.to)
      if result < 0:
        latency_report.failed.append(clicks)
      elif clicks < LATENCY_WARMUP:
        latency_report.warmupFrames.append(result)
      else:
        latency_report.frames.append(result)
      clicks += 1
      await quiet()
  rest_reading("latency")


# --- stress -------------------------------------------------------------------------------------------------------------------------------

# A round of the stress window: the frame that receives stress_begin() fills the log with 200 lines and the production list with 100 items, then one line and one item change in each of
# 20 consecutive frames, and the window ends two frames after the last; stress_end() takes the snapshot back and is outside it.
func stress() -> void:
  mark("stress")
  stress_report["available"] = stress_reason == ""
  stress_report["reason"] = stress_reason
  if stress_reason != "":
    return
  services.new_game()
  await quiet()
  for round_index in range(STRESS_WARMUP + STRESS_MEASURED):
    await frames(SETTLE_FRAMES)
    await process_frame
    trace.append({"frame": Engine.get_process_frames(), "kind": "stress-begin"})
    # The answers are kept and read after the window: a refusal (`turn_in_progress`, `stress_on`, `stress_off`) would make the window something else, and is reported.
    var answers: Array = [services.call("stress_begin")]
    for step in range(STRESS_STEPS):
      await process_frame
      trace.append({"frame": Engine.get_process_frames(), "kind": "stress-step"})
      answers.append(services.call("stress_step"))
    await frames(STRESS_TAIL)
    await frames(SETTLE_FRAMES)
    answers.append(services.call("stress_end"))
    for answer: Variant in answers:
      if not answer is Dictionary or int(answer.get("ok", 0)) != 1:
        anomalies.append("stress: a call of round %d was refused (%s)" % [round_index + 1, str(answer.get("code", "")) if answer is Dictionary else "no answer"])
    await quiet()
    stress_report.rounds += 1
  rest_reading("stress")


# --- the end -------------------------------------------------------------------------------------------------------------------------------

# The mean microseconds a call takes, for the costs the research note reports.
func bench(call: Callable) -> float:
  var started := Time.get_ticks_usec()
  for index in range(BENCH_CALLS):
    call.call()
  return float(Time.get_ticks_usec() - started) / BENCH_CALLS


func finish_run() -> void:
  mark("end")
  await frames(DRAIN_FRAMES)
  var readings := {}
  var scene_nodes: Dictionary = Readings.timed(func() -> int: return Readings.scene_nodes(self))
  reading_costs["sceneNodes"] = int(scene_nodes.usec)
  readings["sceneNodes"] = int(scene_nodes.value)
  rest_reading("end")
  var application_errors := 0
  if arm == "C" and application_ready():
    var hermes: Dictionary = Readings.timed(func() -> Dictionary: return Readings.hermes(self, hud.application()))
    reading_costs["hermes"] = int(hermes.usec)
    readings["hermes"] = {"heapBytes": int(hermes.value.heapBytes), "nativeViews": int(hermes.value.nativeViews)}
    application_errors = int(hermes.value.errors)
  elif arm == "C":
    anomalies.append("end: the React Native host's runtime was not there to read the Hermes heap")
  readings["rssMb"] = {"end": float(rss_series[-1]), "max": float(rss_series.max())}
  if hud.has_hud():
    readings["timeToInteractiveHudMs"] = boot_report.get("timeToInteractiveHudMs", -1.0)
    readings["clickToPanelFrames"] = latency_report.frames
  reading_costs["getSnapshotUsec"] = bench(services.get_snapshot)
  if services.has_method("notifications_emitted"):
    reading_costs["notificationsEmittedUsec"] = bench(func() -> Variant: return services.call("notifications_emitted"))
  if hud.stats_available():
    reading_costs["statsUsec"] = bench(hud.stats)
  if hud.has_hud():
    reading_costs["liveViewsUsec"] = bench(hud.live_views)
  var scratch: Array = []
  reading_costs["traceEntryUsec"] = bench(func() -> void: scratch.append({"frame": Engine.get_process_frames(), "kind": "context-switch"}))
  # The counters at the end of the run, at rest: the HUD must have consumed every notification the game emitted (in A there is no consumer, and `consumed` is -1).
  final_counters = hud.notification_counters() if event_burst_reason == "" else {}
  instrument.finish()
  var samples: Dictionary = instrument.samples()
  write_report(samples, readings, application_errors)


func application_ready() -> bool:
  return hud.application() != null


# The windows the scenario could not measure in this arm, by id, with the reason: the hooks they wait for are detected by name and never invented.
func unavailable_windows() -> Dictionary:
  var out := {}
  if event_burst_reason != "":
    out["event-burst"] = event_burst_reason
  if stress_reason != "":
    out["stress"] = stress_reason
  return out


# The instrument's samples, one entry per process frame, as columns: the raw data of the execution. The orchestrator derives the windows from the trace, joins them to these columns by frame
# number and converts the CPU time to microseconds (scripts/frontier-comparison-run-windows.mjs); nothing of that is done here.
func frame_columns(samples: Dictionary) -> Dictionary:
  return {"frame": Array(samples.frame), "startUsec": Array(samples.startUsec), "totalMs": Array(samples.totalMs), "intervalMs": Array(samples.intervalMs),
    "drawn": Array(samples.drawn), "renderKnown": Array(samples.renderKnown)}


func write_report(samples: Dictionary, readings: Dictionary, application_errors: int) -> void:
  var provenance := Readings.provenance(windowed)
  var entry: Script = get_script()
  provenance["mainLoop"] = String(entry.get_global_name())
  var report := {"format": FORMAT, "arm": arm, "lane": lane, "scene": Hud.SCENES[arm], "seed": int(Rules.SEED), "windowed": windowed,
    "provenance": provenance, "vsync": {"requested": vsync_requested, "mode": Readings.vsync_name(), "refreshHz": DisplayServer.screen_get_refresh_rate()},
    "config": {"idleFrames": IDLE_FRAMES, "drainFrames": DRAIN_FRAMES, "turns": TURNS, "settleFrames": SETTLE_FRAMES, "switches": [Cycle.WARMUP_SWITCHES, Cycle.MEASURED_SWITCHES],
      "switchesPerRound": Cycle.SWITCHES_PER_ROUND, "latency": [LATENCY_WARMUP, LATENCY_MEASURED], "stress": [STRESS_WARMUP, STRESS_MEASURED],
      "renderReadingLagDraws": Instrument.RENDER_READING_LAG_DRAWS, "waits": {"burstMinimumFrames": BURST_MINIMUM_FRAMES, "switchFrames": SWITCH_FRAMES,
        "stressSteps": STRESS_STEPS, "stressTail": STRESS_TAIL}},
    "boot": boot_report, "stages": marks, "game": game_report, "idle": idle_range, "unavailable": unavailable_windows(), "trace": trace, "switches": switch_log,
    "latency": latency_report, "stress": stress_report, "parity": Hud.parity_summary(parity_checks), "readings": readings, "rssSeriesMb": rss_series, "costsUsec": reading_costs, "counters": final_counters,
    "applicationErrors": application_errors, "anomalies": anomalies, "aborted": aborted, "frames": frame_columns(samples)}
  var file := FileAccess.open(out_path, FileAccess.WRITE)
  if file == null:
    push_error("FABRIC_ERROR: cannot write " + out_path)
    quit(1)
    return
  file.store_string(JSON.stringify(report))
  file.close()
  print("FRONTIER_COMPARISON_SCENARIO_%s: arm %s, lane %s, %d frames" % ["ABORTED" if aborted != "" else "DONE", arm, lane, samples.frame.size()])
  quit(1 if aborted != "" else 0)
