extends SceneTree

# Frontier's headless probe. It loads the game's scripts from the root project (res://consumers/civ-lite/game/), plays
# the 12-turn roteiro three ways (the first one examined step by step, a second one in the same process, a third one with
# every end_turn sliced into phases), and writes a report with the canonical serialization after every step. The probe
# only reports: the golden hash is fixed in tests/civ-lite-game-native.test.mjs, and tests/civ-lite-game-oracle.mjs
# judges the raw observations without trusting any verdict here. There is no extension, no Control and no frame: the
# rules are plain GDScript.
#
#   --out=<path>   where the report goes, relative to the project (default build/civ-lite-game-report.json)

const Rules := preload("res://consumers/civ-lite/game/rules.gd")
const Prng := preload("res://consumers/civ-lite/game/prng.gd")
const Canon := preload("res://consumers/civ-lite/game/canon.gd")
const Game := preload("res://consumers/civ-lite/game/game.gd")
const Replay := preload("res://consumers/civ-lite/game/replay.gd")
const World := preload("res://consumers/civ-lite/game/world.gd")
const Snapshot := preload("res://consumers/civ-lite/game/snapshot.gd")

# The first outputs of the PCG32 generator seeded with state 42 and sequence 54, from PCG's published reference demo.
const REFERENCE_VECTOR := [0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e]
# The SHA-256 of "abc", from FIPS 180-2.
const SHA256_ABC := "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
# An epoch that is not the default, to show it reaches the snapshot and not the hash.
const SESSION_EPOCH := 7

var checks: Array = []


func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition


func output_path() -> String:
  for argument: String in OS.get_cmdline_user_args():
    if argument.begins_with("--out="):
      return "res://" + argument.substr("--out=".length())
  return "res://build/civ-lite-game-report.json"


func step_name(index: int, step: Dictionary) -> String:
  return "step %02d %s%s" % [index, step.intent, JSON.stringify(step.args)]


# Whether every action and every item and technology of the snapshot is enabled exactly when its intent is accepted:
# each one is tried on a copy of the game.
func intents_agree_with_snapshot(game: RefCounted, snapshot: Dictionary) -> bool:
  var agree := true
  for action: Dictionary in snapshot.actions:
    var result: Dictionary = game.duplicate_game().callv(action.id, action.args.values())
    agree = agree and result.ok == action.enabled and (result.ok == 1 or result.code == action.reason)
  var slot := mini(snapshot.city.queue.size(), snapshot.city.queue_max - 1)
  for item: Dictionary in snapshot.city.items:
    var result: Dictionary = game.duplicate_game().set_production(item.id, slot)
    agree = agree and result.ok == item.enabled and (result.ok == 1 or result.code == item.reason)
  for tech: Dictionary in snapshot.research.techs:
    var result: Dictionary = game.duplicate_game().set_research(tech.id)
    agree = agree and result.ok == tech.enabled and (result.ok == 1 or result.code == tech.reason)
  return agree


# Plays the roteiro on a fresh game. `examine` adds the per-step checks; the observations are the same either way.
func play(sliced: bool, epoch: int, examine: bool) -> Dictionary:
  var game = Game.new(Rules.SEED, epoch)
  var initial := game.serialize()
  var steps := []
  var snapshots := {}
  var contexts := {}
  var accepted_turns := 0
  for index in Replay.STEPS.size():
    var step: Dictionary = Replay.STEPS[index]
    var name := step_name(index, step)
    var before := game.serialize()
    var result: Dictionary = Replay.run_step(game, step, sliced)
    var after := game.serialize()
    var context := game.context()
    var record := {"index": index, "label": step.label, "intent": step.intent, "args": step.args, "ok": result.ok, "code": result.code,
      "text": result.text, "context": context, "turn": game.state.turn, "serialization": after, "hash": Canon.hash_text(after)}
    if result.has("phases"):
      record["phases"] = result.phases
    steps.append(record)
    contexts[context] = true
    if step.intent == "end_turn" and result.ok == 1:
      accepted_turns += 1
    if not examine:
      continue
    check(result.code == step.code, name + " answers " + step.code)
    check(context == step.context, name + " leaves the context " + step.context)
    if result.ok == 0:
      check(after == before, name + " refused: the state is untouched")
      check(result.text == Rules.reason_text(result.code) and result.text != "", name + " refused: the text is the code's")
    check(after != "" and before != "", name + " serializes")
    var snapshot := game.snapshot()
    check(snapshot.context == context and snapshot.turn == game.state.turn and snapshot.epoch == epoch, name + " snapshot agrees with the game")
    check(Snapshot.is_frozen(snapshot) and Canon.encode(snapshot) != "", name + " snapshot is immutable and integers and strings only")
    check(game.serialize() == after, name + " snapshot reads without changing the state")
    check(intents_agree_with_snapshot(game, snapshot), name + " every enabled action is an accepted intent and the reverse")
    if step.label.begins_with("cover-"):
      snapshots[step.label] = snapshot
      check(context == step.label.substr("cover-".length()), name + " covers " + step.label)
    if result.has("phases"):
      var names := []
      var within := true
      for phase: Dictionary in result.phases:
        names.append(phase.name)
        within = within and phase.tasks <= Rules.PHASE_TASK_LIMIT and phase.events <= Rules.PHASE_EVENT_LIMIT
      check(names == Rules.PHASES, name + " runs the phases in order")
      check(within, name + " keeps every phase within 64 tasks and 128 events")
  snapshots["final"] = game.snapshot()
  return {"game": game, "initial": initial, "steps": steps, "snapshots": snapshots, "contexts": contexts, "accepted_turns": accepted_turns}


func hashes_of(steps: Array) -> Array:
  return steps.map(func(record: Dictionary) -> String: return record.hash)


func check_serializer() -> void:
  check(Canon.encode({"b": [1, -2, "x"], "a": {}}) == '{"a":{},"b":[1,-2,"x"]}', "canon: keys are sorted and nothing else is spaced")
  check(Canon.encode("a\"b\\c") == '"a\\"b\\\\c"', "canon: only the quote and the backslash are escaped")
  check(Canon.encode({"a": 1.5}) == "" and Canon.encode([2.0]) == "", "canon: a float is refused")
  check(Canon.encode([true]) == "" and Canon.encode({"a": null}) == "", "canon: a bool and a null are refused")
  check(Canon.encode({1: 2}) == "" and Canon.encode({"é": 1}) == "" and Canon.encode("é") == "", "canon: a non-string key and a non-ASCII text are refused")
  check(Canon.state_hash({"a": 1.5}) == "", "canon: the hash of unserializable data is empty")
  check(Canon.hash_text("abc") == SHA256_ABC, "canon: the hash is SHA-256 (FIPS 180-2 vector)")


func check_prng() -> void:
  check(Prng.reference_vector() == REFERENCE_VECTOR, "prng: PCG32 matches its published reference outputs")
  var first := Prng.create(Rules.SEED, Rules.PRNG_SEQUENCE)
  var second := Prng.create(Rules.SEED, Rules.PRNG_SEQUENCE)
  var other := Prng.create(Rules.SEED + 1, Rules.PRNG_SEQUENCE)
  var same := true
  var differs := false
  var bounded := true
  for _index in 200:
    var value := Prng.next_u32(first)
    same = same and value == Prng.next_u32(second)
    differs = differs or value != Prng.next_u32(other)
    bounded = bounded and Prng.next_below(first, 7) < 7 and Prng.next_below(second, 7) < 7
  check(same, "prng: the same seed gives the same stream")
  check(differs, "prng: another seed gives another stream")
  check(bounded, "prng: a bounded draw stays below its bound")
  check(int(first.draws) == int(second.draws) and int(first.draws) >= 400, "prng: every output is counted")


func check_turn_slicing() -> void:
  var game = Game.new()
  check(game.advance_phase().code == "no_turn_job", "turn: no phase to advance outside a turn")
  var before: String = game.serialize()
  check(game.begin_end_turn().ok == 1 and game.state.phase == Rules.PHASES[0], "turn: begin_end_turn stops at the first phase")
  var refused := true
  var calls := [["select_tile", [6, 8]], ["select_unit", [1]], ["move_unit", [1, 7, 8]], ["found_city", [1]], ["fortify", [2]],
    ["set_production", ["warrior", 0]], ["set_research", ["alphabet"]], ["resolve_event", ["welcome"]], ["end_turn", []], ["begin_end_turn", []]]
  var mid: String = game.serialize()
  for call: Array in calls:
    var result: Dictionary = game.callv(call[0], call[1])
    refused = refused and result.ok == 0 and result.code == "turn_in_progress"
  check(refused and game.serialize() == mid, "turn: every intent is refused with turn_in_progress and changes nothing")
  var ran := []
  while game.state.phase != "idle":
    ran.append(game.advance_phase().name)
  check(ran == Rules.PHASES and game.state.turn == 2 and game.serialize() != before, "turn: advancing runs every phase once and ends the turn")
  check(game.begin_end_turn().ok == 1, "turn: a new turn can be started after the last phase")


# The refusals the roteiro cannot reach by playing, each on a state built to need it: the scenario has one Settler (so no
# second city), a faction that never walks next to the player, and a queue that never fills. Answers the code each got.
func check_unreachable_refusals() -> Array:
  var cases := [
    {"name": "a second city", "code": "city_exists", "intent": "found_city", "args": [9], "mutate": func(game: RefCounted) -> void:
      game.state.units.append(World.make_unit(9, Rules.OWNER_PLAYER, "settler", 12, 8))
      game.state.cities.append({"name": "Aurora", "x": 7, "y": 8, "size": 1, "queue": [], "buildings": []})},
    {"name": "a city on the outer ring", "code": "too_close_to_edge", "intent": "found_city", "args": [9], "mutate": func(game: RefCounted) -> void:
      game.state.units.append(World.make_unit(9, Rules.OWNER_PLAYER, "settler", 23, 5))},
    {"name": "a move onto the faction's Warrior", "code": "tile_occupied", "intent": "move_unit", "args": [9, 17, 8], "mutate": func(game: RefCounted) -> void:
      game.state.units.append(World.make_unit(9, Rules.OWNER_PLAYER, "warrior", 16, 8))},
    {"name": "a fourth queue entry", "code": "queue_full", "intent": "set_production", "args": ["warrior", 3], "mutate": func(game: RefCounted) -> void:
      game.state.cities.append({"name": "Aurora", "x": 7, "y": 8, "size": 1, "queue": ["warrior", "warrior", "warrior"], "buildings": []})},
  ]
  var codes := []
  for entry: Dictionary in cases:
    var game = Game.new()
    entry.mutate.call(game)
    var before: String = game.serialize()
    var result: Dictionary = game.callv(entry.intent, entry.args)
    codes.append({"name": entry.name, "code": result.code})
    check(result.code == entry.code and result.ok == 0 and game.serialize() == before, "refusal: " + entry.name + " is refused with " + entry.code + " and changes nothing")
  return codes


func check_epoch(primary: Dictionary) -> void:
  var other = Game.new(Rules.SEED, SESSION_EPOCH + 1)
  check(other.snapshot().epoch == SESSION_EPOCH + 1 and primary.snapshots.final.epoch == SESSION_EPOCH, "epoch: the snapshot carries the session's epoch")
  check(other.state_hash() == Game.new(Rules.SEED, 1).state_hash(), "epoch: it is not part of the state's hash")


func _init() -> void:
  check_serializer()
  check_prng()
  check_turn_slicing()
  var unreachable := check_unreachable_refusals()
  var primary := play(false, SESSION_EPOCH, true)
  var repeated := play(false, SESSION_EPOCH, false)
  var sliced := play(true, SESSION_EPOCH, false)
  check_epoch(primary)
  var hashes := hashes_of(primary.steps)
  check(hashes == hashes_of(repeated.steps), "replay: a second play in the same process reaches the same state at every step")
  check(hashes == hashes_of(sliced.steps), "replay: slicing every end_turn into phases reaches the same state at every step")
  check(primary.accepted_turns == 12 and primary.game.state.turn == 13, "replay: twelve turns were played and turn 13 begins")
  check(primary.contexts.size() == Rules.CONTEXTS.size() and Rules.CONTEXTS.all(func(context: String) -> bool: return primary.contexts.has(context)),
    "replay: all seven contexts were observed")
  var failures := checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var final_hash: String = hashes[hashes.size() - 1]
  var report := {"scenario": "civ-lite-game", "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(),
    "seed": Rules.SEED, "epoch": SESSION_EPOCH, "prng": {"vector": Prng.reference_vector()}, "initial": primary.initial,
    "steps": primary.steps, "snapshots": primary.snapshots, "unreachableRefusals": unreachable, "finalHash": final_hash, "checks": checks,
    "allPassed": failures.is_empty()}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open(output_path(), FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_CHECK_FAILED: report: the report cannot be written")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  print("CIV_LITE_GAME_HASH: " + final_hash)
  print("CIV_LITE_GAME_PASSED: " + str(checks.size()) if failures.is_empty() else "CIV_LITE_GAME_FAILED: " + str(failures.size()))
  quit(0 if failures.is_empty() else 1)
