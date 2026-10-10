extends Node

# The replay gate, run with `-- --validate-replay` (scripts/macos-export.mjs does, in the provisioned project and in the exported Release
# .app). It plays the 77 intents of game/replay.gd on a new game through this scene's GameServices node, as a HUD would: every intent is a
# call of the node, and an accepted end_turn is a job that the node advances one phase per frame, so the gate waits for the job to finish
# before the next intent. After every intent it hashes the game's canonical serialization with game/canon.gd, the code the headless lane
# (tests/civ-lite-game-probe.gd) hashes it with. The hash after the last intent is the golden hash and the SHA-256 of the 77 hashes, one per
# line, is the trace hash; both are pinned outside the game (tests/civ-lite-game-native.test.mjs), so this gate only reports them.
#
# An exported game cannot write to res://, so the report goes to the user's data directory. The gate prints the two hashes and exits 0 when
# every step answered the code and left the context the replay says, and 1 otherwise.
#
#   user://civ-lite-replay-report.json   the steps (intent, code, context, hash), the two hashes and the final canonical serialization
#
# Inert unless the game runs with `-- --validate-replay`.

const Replay := preload("game/replay.gd")
const Canon := preload("game/canon.gd")
const Rules := preload("game/rules.gd")

const REPORT := "user://civ-lite-replay-report.json"
# The limit of a wait for state, in frames. A wait that reaches it is a failed check, not a pause.
const WAIT_FRAMES := 600

var checks: Array = []
var services: Node


func check(condition: bool, message: String) -> bool:
  checks.append({"name": message, "passed": condition})
  if not condition:
    push_error("CONSUMER_CHECK_FAILED: " + message)
  return condition


func _ready() -> void:
  if not OS.get_cmdline_user_args().has("--validate-replay"):
    return
  services = get_parent()
  run()


# The user's data directory as the run found it: a clean profile holds nothing of an earlier run, the report included.
func user_entries() -> Array:
  var names: Array = []
  for entry: String in DirAccess.get_directories_at("user://"):
    names.append(entry)
  for entry: String in DirAccess.get_files_at("user://"):
    names.append(entry)
  names.sort()
  return names


func wait_until(condition: Callable) -> bool:
  for index in range(WAIT_FRAMES):
    if condition.call():
      return true
    await get_tree().process_frame
  return condition.call()


func run() -> void:
  var entries_at_start := user_entries()
  # The tree is entered and every sibling is ready: the first frame is where a HUD would be.
  await get_tree().process_frame
  services.new_game()
  var steps: Array = []
  var hashes: Array = []
  var contexts := {}
  var accepted_turns := 0
  var serialization := ""
  for index in Replay.STEPS.size():
    var step: Dictionary = Replay.STEPS[index]
    var label := "step %02d %s%s" % [index, step.intent, JSON.stringify(step.args)]
    var result: Dictionary = services.callv(step.intent, step.args)
    if step.intent == "end_turn" and int(result.ok) == 1:
      accepted_turns += 1
      check(await wait_until(func() -> bool: return int(services.job) == 0), label + " finished its job")
    serialization = services.game.serialize()
    var context: String = services.game.context()
    var step_hash := Canon.hash_text(serialization)
    contexts[context] = true
    hashes.append(step_hash)
    check(result.code == step.code, label + " answers " + step.code)
    check(context == step.context, label + " leaves the context " + step.context)
    check(serialization != "", label + " serializes")
    steps.append({"index": index, "label": step.label, "intent": step.intent, "args": step.args, "ok": int(result.ok), "code": result.code,
      "context": context, "turn": int(services.game.state.turn), "hash": step_hash})
  check(accepted_turns == 12 and int(services.game.state.turn) == 13, "twelve turns were played and turn 13 begins")
  check(contexts.size() == Rules.CONTEXTS.size() and Rules.CONTEXTS.all(func(context: String) -> bool: return contexts.has(context)),
    "all seven contexts were observed")
  check(services.game.state.phase == "idle" and int(services.job) == 0, "the replay ends at rest, with no job")
  var failures := checks.filter(func(row: Dictionary) -> bool: return not row.passed)
  var golden: String = hashes[hashes.size() - 1] if not hashes.is_empty() else ""
  var trace := Canon.hash_text("\n".join(hashes))
  var report := {"schemaVersion": 1, "scenario": "civ-lite-replay", "godot": Engine.get_version_info().string,
    "displayServer": DisplayServer.get_name(), "project": str(ProjectSettings.get_setting("application/config/name")),
    "features": {"template": OS.has_feature("template"), "release": OS.has_feature("release"), "debug": OS.has_feature("debug"),
      "editor": OS.has_feature("editor")},
    "executable": OS.get_executable_path(), "userDataDir": OS.get_user_data_dir(), "userEntriesAtStart": entries_at_start,
    "seed": Rules.SEED, "stepCount": steps.size(), "acceptedTurns": accepted_turns, "steps": steps, "goldenHash": golden, "traceHash": trace,
    "finalSerialization": serialization, "checks": checks, "allPassed": failures.is_empty()}
  var output := FileAccess.open(REPORT, FileAccess.WRITE)
  if output == null:
    push_error("CONSUMER_CHECK_FAILED: cannot write " + REPORT)
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  print("CIVLITE_REPLAY_HASHES: golden=%s trace=%s" % [golden, trace])
  print("CIVLITE_REPLAY_PASSED: %d" % checks.size() if failures.is_empty() else "CIVLITE_REPLAY_FAILED: %d" % failures.size())
  get_tree().quit(0 if failures.is_empty() else 1)
