# Frontier: the rules and the scenario of the 0.5 reference game, in GDScript

Status: model published for the services slice (V05-03 `servicos`) and the HUD slice (V05-05). The [evidence](../evidence/frontier-game/README.md)
records the local macOS arm64 runs; the hosted CI run is pending.

This is the first package of the 0.5 milestone (V05-03, criterion `replay`). The 0.5 asks whether a real app is usable
on this platform. Its reference app is **Frontier**, a small turn-based strategy game in the interaction style of
Civilization 2: Godot owns the map, the rules, the scripted faction and the turn, and the whole HUD is React Native over
Godot in one Hermes. The rules, names and art are original; only the pattern of a map you select things on, with a
panel that depends on what you selected, is borrowed.

This slice is the part that does not need React: the rules and the scenario in pure GDScript with a headless test.
`consumers/civ-lite/game/` holds them; nothing in `native/`, `src/` or `sdk/` changed. The next packages build on the
state and the DTOs below:

- V05-03 `servicos` wraps the game in a persistent `GameServices` node that publishes the snapshot and takes the
  intents, with an `epoch`.
- V05-05 mounts the six HUD panels from the snapshot.
- V05-10's arm B writes the same HUD natively in GDScript against the same snapshot.

Rules never live in JS. React projects a snapshot and sends intents; it decides neither what is allowed nor which
panel exists.

## What is in the game

The ceiling is fixed; a cut enters only if it removes a distinct context.

| Thing | Frontier |
| --- | --- |
| Map | 24x16, generated from a fixed seed (4242): water, plain, forest, hill |
| Units | Settler (2 movement points) and Warrior (3), moving by points |
| City | one, founded by the Settler, with 4 production items and a queue of 3 |
| Research | a linear list of 3 technologies |
| Event | one blocking dialog, raised on turn 5 |
| AI | one faction with one Warrior walking a fixed route, in explicit phases |
| Resources | food, production and science, all integers |

Out: a technology graph, boats, diplomacy, fog of war, probabilistic combat and a full save/load. A scripted faction
has no combat because nothing in the 0.5 depends on it.

## Determinism

The criterion is a replay of 12 turns with an identical golden hash in 3 of 3 executions. What makes that true:

- **Integers only.** The state, the rules and the snapshot hold `int` and `String`, arrays and dictionaries of them.
  No float, no bool, no null. The serializer refuses anything else.
- **Its own PRNG.** `prng.gd` is PCG32 (XSH-RR on a 64-bit state), not `randi()`, `randf()` or
  `RandomNumberGenerator`. GDScript ints are 64-bit and wrap on `+` and `*`; each right shift of the unsigned state is
  followed by the mask that turns the arithmetic shift into a logical one. The generator lives in the state as four
  unsigned 32-bit halves (`state_hi`, `state_lo`, `inc_hi`, `inc_lo`) and a draw counter, so it is part of the hash and
  stays exact in JSON. Draws are bounded without bias by rejection, as PCG's own bounded generator does.
  `Prng.reference_vector()` seeds PCG's published demo generator (state 42, sequence 54) and returns its first six
  outputs: `0xa15c02b7 0x7b47f409 0xba1d3330 0x83d2f293 0xbfa4784b 0xcbed606e`. The test compares them with the
  constants of the reference implementation, so the generator is checked against a source that is not this code.
- **Canonical serialization.** `canon.gd` writes JSON restricted so one state has one spelling: object keys sorted by
  code point, no whitespace, integers in decimal with only a leading `-` for negatives, strings of printable ASCII with
  only `"` and `\` escaped. A float, bool, null, non-string key or non-ASCII character makes `encode()` answer `""`.
- **Hash.** SHA-256 (`HashingContext`) of the UTF-8 bytes of that text, 64 lowercase hex digits. SHA-256 is the function
  every test environment already has, so the golden hash can be re-derived from the serialization with
  `crypto.createHash("sha256")`. The state's `epoch` (the session's) is outside the state and outside the hash.
- **Same result sliced or not.** `end_turn()` runs all phases of the turn; `begin_end_turn()` plus one
  `advance_phase()` at a time runs the same phases. The probe replays the 12 turns both ways and requires the same hash.

## The state

One Dictionary, every value an `int`, a `String`, an Array or a Dictionary. This is the hashed model. Keys are
lower-case ASCII.

| Key | Type | Meaning |
| --- | --- | --- |
| `v` | int | Schema version, `1`. |
| `seed` | int | The scenario seed, `4242`. |
| `turn` | int, from 1 | The current turn. |
| `phase` | string | `"idle"`, or the name of the next end-of-turn phase to run (see Turn phases). |
| `rng` | object | `state_hi`, `state_lo`, `inc_hi`, `inc_lo` (uint32 ints) and `draws` (int): the PCG32 generator. |
| `map` | object | `w` (24), `h` (16), `terrain` (int[384], row-major: index `y * 24 + x`; 0 water, 1 plain, 2 forest, 3 hill). |
| `units` | object[], ascending `id` | `id`, `owner` (1 player, 2 faction), `kind` (`"settler"` or `"warrior"`), `x`, `y`, `moves` (points left, 0 to the kind's allowance), `fortified` (0 or 1). |
| `next_unit` | int | The id the next unit gets. |
| `irrigated` | int[], ascending | The irrigated tiles as indexes into `map.terrain` (`y * 24 + x`): a set, kept sorted, so the order they were irrigated in is not part of the state. Each is a Plain with Water on one of its four sides. Empty in every state of the replay. |
| `cities` | object[], 0 or 1 | `name`, `x`, `y`, `size` (1 to 3), `queue` (item ids, at most 3), `buildings` (item ids in completion order). |
| `res` | object | `food`, `production`, `science`: the stocks, never negative. |
| `research` | object | `done` (technologies learned, a prefix of the list) and `current` (a technology id, or `""`). |
| `events` | object | The queue of events: `queue` (event ids, the head first: the ones raised and not yet answered, in the order of the table) and `resolved` (`{id, choice}[]`, the answers in the order they were given). Empty before turn 5; all three are in one or the other from then on. |
| `ai` | object | `unit` (the faction Warrior's id, 0 if none), `step` (index into the route), `tx`, `ty` (the tile it is walking to). |
| `sel` | object | The selection: `x`, `y` (`-1` when nothing is selected) and `unit` (a unit id, or 0). |
| `log` | object[], at most 32 | `seq`, `turn`, `code`, `a`, `b`: the game's events, oldest first. |
| `log_seq` | int | How many events have been emitted. |

The selection is part of the state because the context is derived from it and the replay covers the contexts.

### Rules in numbers

| Terrain | id | food | production | science | movement cost |
| --- | --- | --- | --- | --- | --- |
| Water | 0 | 1 | 0 | 2 | cannot be entered |
| Plain | 1 | 2 | 1 | 0 | 1 |
| Forest | 2 | 1 | 2 | 0 | 2 |
| Hill | 3 | 0 | 2 | 1 | 2 |

- **Map.** Each tile draws a terrain (water 22%, forest 18%, hill 12%, plain 48%), one majority pass over the 3x3
  neighbourhood smooths the draw, the frame of the map becomes water, and the scenario forces 22 tiles last: the
  surroundings of the start tile (6, 8), the city site (7, 8) and the faction's route. The scripted replay therefore
  does not depend on what the generator drew there, while the rest of the map still depends on the PRNG.
- **Movement.** A unit moves to an adjacent tile (8 directions) if it can pay the terrain's cost from its points. Moving
  ends a fortification. Points refresh to the allowance at the end of every turn.
- **Irrigation.** A Settler can irrigate the Plain it stands on when Water is one of the tile's four neighbours (north, east, south,
  west: not the diagonals; a side outside the map is not water) and the tile is not irrigated yet. It spends all of the Settler's remaining
  moves, and the tile yields one more food (`Rules.IRRIGATION_FOOD`) for the rest of the game, wherever it is read: the tile card's `food`, the
  ranking of the city's neighbours and the city's rates. So an irrigated Plain next to the city (2 + 1 food, 1 production) outranks every other
  neighbour and the city works it. The state gained `irrigated` for this, which moved the golden and trace hashes below once and for no other
  reason (taking the field out of every serialization of the replay brings the previous hashes back).
- **City.** It works its own tile plus as many neighbours as its size, best first (total yield, then production, then
  food, then row, then column: a total order). The centre adds 1 food, 1 production and 2 science. A building adds its
  own yields.
- **Growth.** The city grows when the food stock reaches `size * 10`, paying that amount, up to size 3. At size 3 food
  is no longer stored.
- **Production.** While the queue is not empty the production rate is added to the stock; when the stock pays the first
  item, it is built (a Warrior appears on the city tile, a building is added) and leaves the queue. One item a turn. With
  an empty queue the production is lost, not banked.
- **Research.** The list is linear (Alphabet 6, Bronze Working 9, Writing 12); only the next technology can be
  researched. While one is being researched the science rate is added to the stock; it is learned when the stock pays
  its cost. With no technology chosen the science is lost.
- **Items.** Warrior (unit, 8, no technology); Granary (building, 10, Alphabet, +2 food); Workshop (14, Bronze Working,
  +2 production); Library (16, Writing, +2 science).
- **Events.** A queue of three, written in the table `Rules.EVENTS`. All three are raised together, in the order of the table, when turn 5
  begins, once, and the player answers them one at a time: `resolve_event` answers the head with one of **its** choices (a choice of another
  event is `unknown_choice`), and the next event becomes the head. Each choice adds an amount to one stock. `wanderers` (first): welcoming
  them adds `6 + draw(4)` food, a draw from the game's PRNG, and turning them away adds 4 production. `traders` (second): `buy_grain` adds 3
  food and `buy_tools` adds 3 production. `scholar` (third): `host` adds 3 science and `send_on` adds 2 food. Only welcoming the wanderers draws
  from the PRNG, so the draws are what they were with the one event. The queue is a decision of 2026-10-09 (the user's: the queue of three events
  is real in the game, not a HUD-side list), which moved the golden and trace hashes below; the ceiling of the game is now "a queue of three
  blocking events", where it was "one blocking event".
- **The faction.** Its Warrior walks the closed route
  `(17,8) (18,8) (19,8) (19,9) (19,10) (18,10) (17,10) (17,9)` one step a turn. It **waits where it is** when a unit of the
  player or the player's city is on the next tile of the route, and keeps waiting for as long as that holds (the step does not
  advance, and the phase reports one task and one `ai_blocked` event, as when it walks). It never attacks and never captures:
  capturing a city is outside the ceiling. So units of two sides never share a tile and the faction never stands on the city
  (the oracle checks both in every state). The rule is in one place, `turn.gd`'s `_blocked`, and it also keeps the Warrior a city
  finishes from being born on top of a hostile unit, which is why `production` does not check for one: no intent reaches that
  state, because `move_unit` refuses a tile with a unit of the other side (`tile_occupied`), the faction refuses to enter a tile
  with a unit of the player or the city, and a Settler founds a city only on the tile it stands on, which no unit of the faction
  can share. A check there would be dead code.

## The seven contexts

Derived from the state by one pure function (`context.gd`), in this precedence. Nothing else decides which panel exists.

| # | Context | When | Panels the HUD mounts |
| --- | --- | --- | --- |
| 1 | `dialog` | an event waits in the queue; it outranks everything and blocks every intent but `resolve_event` | event dialog |
| 2 | `settler` | the selected unit is a Settler | unit actions, tile card |
| 3 | `warrior` | the selected unit is a Warrior | unit actions, tile card |
| 4 | `none` | nothing is selected | turn and resources bar |
| 5 | `city` | the selected tile is the city and no unit is selected | city screen, research |
| 6 | `stack` | the selected tile holds two or more of the player's units and none is selected | unit actions (one per unit), tile card |
| 7 | `tile` | any other selected tile | tile card |

The turn and resources bar is always there. The panels column above is the mapping the HUD slice (V05-05, `matriz`) confirmed
and implemented without change: `consumers/civ-lite/ui/hud/hud.tsx` mounts exactly these panels for each context and decides
nothing else, and the matrix of testIDs over the replay's covering steps judges it (see [frontier-hud.md](frontier-hud.md)); the
actions panel lists `snapshot.actions` but `end_turn`, which lives on the bar. Selecting a tile with the city selects the city even when units stand in it (the city screen lists
its garrison); selecting a tile with exactly one of the player's units selects that unit; a stack or an empty tile
selects the tile alone, and `select_unit` picks a unit out of a stack or out of the city. `clear_selection` closes whatever is
selected (the tile card, the city screen, a unit's actions) and returns to `none` at any moment of the turn; a turn also ends
with the selection cleared, so a new turn starts in `none`.

## The intents

`FrontierGame` (`game.gd`) takes intents as methods. Each is validated; a refused intent returns
`{"ok": 0, "code": <reason>, "text": <text for the HUD>}` and **changes nothing**, not even the selection. An accepted one
returns `{"ok": 1, "code": "ok", "text": ""}` plus the fields noted. All arguments are ints or strings.

| Intent | Arguments | Effect |
| --- | --- | --- |
| `select_tile` | `x`, `y` | Selects the tile (and the city, or the lone unit, as above). |
| `select_unit` | `unit_id` | Selects a unit of the player and its tile. |
| `clear_selection` | none | Clears the selection, whatever it was: the context becomes `none`. Refused with `nothing_selected` when there is no selection, and with `event_pending` while the dialog is open. |
| `move_unit` | `unit_id`, `x`, `y` | Moves one step to an adjacent tile, paying its cost. |
| `found_city` | `unit_id` | The Settler becomes the city on its tile; the city is selected. |
| `fortify` | `unit_id` | Fortifies a Warrior and ends its movement for the turn. |
| `irrigate` | `unit_id` | A Settler irrigates the Plain it stands on (Water on one of its four sides, not irrigated yet): all its moves are spent and the tile yields one more food. The checks run in this order: the guard, the unit (`unknown_unit`, `not_your_unit`), `not_a_settler`, `not_a_plain`, `no_water_nearby`, `already_irrigated`, `no_moves_left`. So a Settler that has just irrigated is told the tile is already irrigated. |
| `set_production` | `item_id`, `slot` | Puts an item in a slot of the queue: slot 0 is what is being built, a slot equal to the queue's length appends. The stock already made is kept. |
| `set_research` | `tech_id` | Starts the next technology of the list. |
| `resolve_event` | `choice_id` | Answers the head of the event queue with one of its own choices; the next event becomes the head. |
| `end_turn` | none | Runs every phase; the result adds `turn` and `phases` (`name`, `tasks`, `events` for each). |

Two methods slice the turn for a frame budget: `begin_end_turn()` makes the state's `phase` the first phase, and
`advance_phase()` runs the phase the state is at and moves on; its result adds `name`, `tasks`, `events` and `done` (1 on the
last). While a turn is being processed every intent is refused with `turn_in_progress`.

### Refusal codes

An intent is checked in this order: the turn (`turn_in_progress`), an event waiting in the queue (`event_pending`; `resolve_event` skips
it), then its own checks as listed.

| Code | Text | Refused when |
| --- | --- | --- |
| `turn_in_progress` | The turn is being processed. | any intent while `phase` is not `idle` |
| `event_pending` | A decision is waiting. Resolve the event first. | any intent but `resolve_event` while an event waits in the queue |
| `no_turn_job` | No turn is being processed. | `advance_phase` with `phase` idle |
| `out_of_bounds` | That tile is outside the map. | `select_tile`, `move_unit` outside 24x16 |
| `nothing_selected` | Nothing is selected. | `clear_selection` with no tile selected |
| `unknown_unit` | No such unit. | the id is not a unit |
| `not_your_unit` | That unit belongs to another faction. | the unit is not the player's |
| `not_adjacent` | The destination is not an adjacent tile. | `move_unit` not exactly one tile away |
| `impassable_terrain` | Land units cannot enter water. | `move_unit` into water |
| `tile_occupied` | A foreign unit blocks that tile. | `move_unit` onto the faction's unit |
| `no_moves_left` | The unit has no movement points left. | `move_unit`, `found_city` or `irrigate` with 0 points |
| `not_enough_moves` | Not enough movement points for that terrain. | `move_unit` with fewer points than the cost |
| `cannot_fortify` | Settlers cannot fortify. | `fortify` on a Settler |
| `already_fortified` | The unit is already fortified. | `fortify` on a fortified unit |
| `not_a_settler` | Only a Settler can do that. | `found_city` or `irrigate` with another kind |
| `not_a_plain` | Only a Plain can be irrigated. | `irrigate` on a Forest or a Hill (Water is never stood on) |
| `no_water_nearby` | Irrigation needs Water on one of the tile's four sides. | `irrigate` on a Plain with no Water to its north, east, south or west |
| `already_irrigated` | This tile is already irrigated. | `irrigate` on an irrigated tile |
| `city_exists` | This scenario allows a single city. | `found_city` with a city already founded |
| `too_close_to_edge` | A city needs open ground on every side. | `found_city` on the outer ring of tiles |
| `no_city` | There is no city to manage yet. | `set_production` before a city exists |
| `unknown_item` | Unknown production item. | the id is not an item |
| `tech_required` | Research the required technology first. | the item needs a technology not yet learned |
| `already_built` | The city already has that building. | the building is in `buildings` |
| `already_queued` | That building is already in the queue. | the building is in another slot |
| `queue_full` | The production queue is full. | appending to a queue of 3 |
| `bad_slot` | Pick an existing queue slot or the next free one. | the slot is negative or beyond the queue's length |
| `unknown_tech` | Unknown technology. | the id is not a technology |
| `tech_known` | That technology is already known. | it is already learned |
| `research_out_of_order` | Technologies are researched in list order. | it is not the next one |
| `already_researching` | That technology is already being researched. | it is the current one |
| `no_event` | There is no event to resolve. | `resolve_event` with the queue empty |
| `unknown_choice` | That is not one of the choices. | the id is not one of the head event's choices (a choice of another event included) |

## Turn phases

`end_turn` runs these six phases in order. A phase reports the `tasks` it ran and the `events` it emitted; the authority
criterion of the services slice measures end-of-turn bursts against a ceiling of **64 tasks and 128 events a phase**. This
slice only guarantees the phases exist, are deterministic and stay below the ceiling (at most 5 tasks and 4 events in the
roteiro: the events are the `refresh` of turn 4, which emits the turn start and the three events it raises, and the tasks are the units it refills, the tiles a phase works
and the faction's one; before the queue of three events the most was 2). `FrontierGame.advance_phase()` exposes the slicing for the frame-budget measurement; this slice does not measure
time.

| Phase | What it does | Tasks |
| --- | --- | --- |
| `ai_plan` | the faction picks the next tile of its route | 1 |
| `ai_move` | its Warrior walks there, or waits when a unit of the player or the player's city is on that tile | 1 |
| `production` | adds production, builds the first queued item if paid | tiles worked + 1, or 0 with no city or an empty queue |
| `growth` | adds food, grows the city if paid | tiles worked + 1, or 0 with no city or at size 3 |
| `research` | adds science, learns the technology if paid | tiles worked + 1, or 0 with none chosen |
| `refresh` | refills movement, advances the turn, clears the selection, raises the events (all three, on turn 5) | the number of units |

## The snapshot (DTO)

`FrontierGame.snapshot()` builds it from the state, the session's `epoch` and the session's `last_job`. It is **immutable** (every Dictionary and
Array is read-only, recursively) and a function of its inputs: React can keep it. It holds integers and strings only; a
flag is `0` or `1`. **Every section is always present**: an absent thing has `present` or `open` at `0`, zeros, and empty
lists, so the TypeScript mirror needs no optional fields. Types below are `int`, `string`, `T[]`, or the named object.

**Snapshot**

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | int | DTO version, `1`. |
| `epoch` | int | The session's epoch, set by whoever owns the session and not part of the state or the hash. |
| `last_job` | int | The id of the last end-of-turn job the session's owner finished, `0` for none; like the epoch, set by the owner and not part of the state or the hash (the services' node drives the turn as a job: [frontier-services.md](frontier-services.md)). |
| `turn` | int | The turn number. |
| `phase` | string | `"idle"`, or the phase a turn being processed is at. |
| `context` | string | One of the seven contexts. |
| `selection` | Selection | The selection. |
| `resources` | Resources | The stocks and their per-turn rates. |
| `actions` | Action[] | What the HUD can offer in this context. |
| `tile` | TileCard | The selected tile's card. |
| `city` | CityScreen | The city screen. |
| `research` | Research | The research list. |
| `dialog` | Dialog | The dialog of the event at the head of the queue. |

**Selection**: `x`, `y` (int, `-1` when nothing is selected), `unit` (int, 0 when no unit is selected).

**Resources**: `food`, `production`, `science`, each `{stock: int, rate: int}`. The rate is 0 until the city exists.

**Action**: `id` (string, the intent's name), `label` (string), `args` (`int[]`, the intent's positional arguments in the
order it takes them: `[unit_id]` for `select_unit`, `found_city`, `irrigate` and `fortify`, `[]` for `clear_selection` and `end_turn`; a
caller turns an action into a call as it is, the intent named `id` with `args`, and needs no knowledge of which intent takes
what), `enabled` (0 or 1), `reason` (string, the refusal code, `""` when enabled) and `reason_text` (string, what the HUD
shows next to a disabled action). `enabled` is exactly "the intent would be accepted now": it comes from the same check the
intent runs, and the probe sends every enabled action back to a copy of the game with its own `args` to prove it. Actions by
context:

| Context | Actions |
| --- | --- |
| `none` | `end_turn` |
| `tile`, `city` | `clear_selection`, `end_turn` |
| `settler` | `found_city`, `irrigate`, `fortify`, `clear_selection`, `end_turn` |
| `warrior` | `fortify`, `clear_selection`, `end_turn` |
| `stack` | one `select_unit` per unit of the player on the tile, `clear_selection`, `end_turn` |
| `dialog` | `end_turn`, disabled with `event_pending` (the choices are in `dialog`) |

`none` has nothing to close, so it offers no `clear_selection`; every other context but `dialog` does, and it is always
enabled there (the dialog blocks it).

**TileCard**: `present` (0 or 1), `x`, `y`, `terrain` (int id, `-1` if absent), `terrain_name`, `food`, `production`,
`science`, `move_cost` (0: cannot be entered), `city` (0 or 1), `irrigated` (0 or 1: `food` already includes the one more food an
irrigated tile yields; the snapshot's `tile` and `frontier.hover` carry it alike) and `units` (UnitCard[], every faction, in id order).
**UnitCard**: `id`, `owner`, `kind`, `name`, `moves`, `max_moves`, `fortified`.

**CityScreen**: `present`, `name`, `x`, `y`, `size`, `max_size`, `food_needed` (0 without a city), `food_rate`,
`production_rate`, `science_rate`, `queue` (QueueEntry[]), `queue_max`, `items` (Item[]), `buildings` (string[], item ids)
and `garrison` (`{id, kind}[]`, the player's units on the city tile). **QueueEntry**: `slot`, `item`, `label`, `cost`,
`stock` (the production stock for slot 0, else 0). **Item**: `id`, `label`, `kind` (`"unit"` or `"building"`), `cost`,
`tech` (the technology it needs, `""` for none), and `enabled`/`reason`/`reason_text` as for an action, evaluated for the
slot a HUD would use: the first free one, or the last when the queue is full.

**Research**: `current` (a technology id or `""`), `known` (how many are learned), `needed` (the current one's cost, 0 with
none), `rate` and `techs` (Tech[]). **Tech**: `id`, `label`, `cost`, `state` (`"known"`, `"current"`, `"available"` for the
next one, or `"locked"`), and `enabled`/`reason`/`reason_text`. The stock being spent is `resources.science.stock`.

**Dialog**: `open` (0 or 1), `id`, `title`, `text` and `choices` (`{id, label, detail}[]`) of the event at the head of the queue, read through
the table of events and not from constants, and `index` (1-based) and `count`, where the head is in the queue ("1 of 3": the events answered plus
this one, and those plus the ones waiting). All empty and 0 when closed.

## The replay

`replay.gd` is the roteiro: 12 turns and 77 intents (45 accepted, 32 refused on purpose), each with the code and the context
it must produce. A refused step also proves it changed nothing. The state after the twelfth `end_turn` (turn 13 begins) has
the **golden hash**, fixed in `tests/civ-lite-game-native.test.mjs`:

```
0949b36d7438ce57c86f3952c9cfa47bb8ef6874edc762b5caf8d8ba4fbddbf1
```

It changes only when a rule, the map or the roteiro changes the state the replay ends in; the new value is then reviewed, not
accepted. The generator draws 384 times for the map and once for the wanderers' gift (385 draws in all). The queue of three events (2026-10-09)
changed the shape of the state (`event` became `events`) and the roteiro's turn 5, so it moved this hash and the trace hash below; the previous
values were `275b7c6182605a784d8be3565d4df38a5bb130aaa6c0ea7640abe4c521427d29` and `fba99004fa12e253b9a6fe7f8bbee0cbd6e468a67308d25d0c40236f48c68cb8`, and the
records under `docs/evidence/frontier-{game,services,authority}/` keep describing runs that had them. The new values come from the independent oracle,
which recomputes the state after each of the 77 steps from the table of events and PCG32 written again in Node, and agreed with the game at every step
before the hashes were re-pinned.

The Irrigate rule (the base of the cost-of-change experiment, on a branch that never reaches `main`) moved both hashes once more by adding the
state's `irrigated` list, empty in every state of the roteiro and nowhere else different: with `"irrigated":[],` taken out of each of the 77
serializations, the hashes come back to `cb7ab974f47f18c37ae96bda57ffd1b87f8c3733e251a386040dc17ccb540e8d` (golden) and `ed43495ec48d896c0eb0c4f9a7b97471be86f37082218d16a8411d0f3766275e` (trace).

Adding `clear_selection` and four steps that use it (two accepted, `nothing_selected`, and `event_pending` while the dialog is
open) **did not change the golden hash**: the intent only changes the selection and emits no event, and every `end_turn`
clears the selection, so the state the twelfth turn ends in is the same. What did change is the state after each of those
steps. The test therefore fixes a second hash, the **trace hash**, the SHA-256 of the state hashes after every step, one per
line, which pins how the replay got there:

```
a36c0f32707e9a8439bf276548d907d6bcc0821351a6014ab46ab617bf6b31ba
```

The oracle judges every one of those states regardless.

| Turn | Script |
| --- | --- |
| 1 | a selection is cleared with nothing selected (refused); the stack on the start tile; the Settler walks into the forest and cannot found a city with no points left; refusals for water, adjacency, Settlers fortifying, a Warrior founding, foreign or missing units and a city that does not exist yet; the Warrior fortifies |
| 2 | the Settler founds the city; production and research are set; refusals for the technology, the item, the slot and the order of the list; the Warrior walks into the city |
| 3 | an empty tile is selected, then cleared |
| 4 | the second Warrior walks out; one runs out of points before a hill; two units stack up; turn 5 raises the three events |
| 5 | the events block every intent, `clear_selection` included; a wrong choice, and a choice of the next event, are refused; the queue is answered in order (welcoming the wanderers, buying tools from the traders, sending the scholar on: the context stays `dialog` until the third); a known technology is refused; research and the queue resume; the city screen is opened and closed |
| 6 to 12 | the city builds a Granary, a Warrior and a Workshop, grows to size 3, learns the whole list, and the Library is queued once Writing is known |

The roteiro refuses with 24 of the codes above. The other four (`city_exists`, `too_close_to_edge`, `tile_occupied`,
`queue_full`) cannot happen in this scenario, because it has one Settler, a faction that never walks next to the player and
a queue that never fills; the probe builds a state for each and requires the same untouched-state guarantee. `turn_in_progress`
and `no_turn_job` are exercised by slicing a turn by hand.

| Context | Step of the roteiro that covers it |
| --- | --- |
| `none` | 33: `clear_selection()`, accepted, after the empty tile of turn 3 was selected |
| `stack` | 2: `select_tile(6, 8)`, the Settler and the Warrior on the start tile |
| `settler` | 3: `select_unit(1)` |
| `warrior` | 9: `select_unit(2)` |
| `city` | 18: `found_city(1)`, which selects the new city |
| `tile` | 32: `select_tile(9, 8)`, an empty plain |
| `dialog` | 45: `select_tile(7, 8)`, refused with `event_pending` while the first event of the queue is the head |

## Tests

`npm run test:civ-lite-game` runs `tests/civ-lite-game-native.test.mjs`. There is **no C++ and no host**: the runner is the
headless official Godot 4.7.2 with the root project (`--path . --headless --script res://tests/civ-lite-game-probe.gd`),
which loads `res://consumers/civ-lite/game/*.gd`. The probe plays the roteiro, checks each step's code and context, and
writes a report with the canonical serialization after every step. Besides the roteiro it checks the PRNG against PCG's
published outputs, the serializer (sorted keys, the refusal of floats, bools, nulls and non-ASCII text, SHA-256 against the
FIPS vector), that a second play in the same process and a play with every `end_turn` sliced into phases reach the same state
at every step, that every enabled action, item and technology of every snapshot is an accepted intent on a copy of the game
and every disabled one is refused with its `reason`, that a snapshot is immutable and reads without changing the state, and
that the session's epoch reaches the snapshot and not the hash. The Node test then:

- runs the probe **three times in three processes** and requires byte-identical reports, the **same golden hash** and the
  trace hash of every step;
- requires the 12 turns, the coverage of the seven contexts (a step labelled for each), every refusal code the roteiro
  lists and the four the probe builds a state for, each refusal leaving the state as it found it;
- requires the faction's wait on three turns built for it, because the roteiro never puts the player on its route: a city
  on the route that finishes a Warrior that turn (`city-on-route`), the same city a turn later (`city-on-route-next-turn`)
  and a unit of the player on the route (`unit-on-route`). The faction stays on the first tile, the Warrior is born alone on the
  city and nothing overlaps; the oracle judges each of the three turns as it judges a step of the roteiro;
- requires every snapshot of the labelled steps to have exactly the fields and types of the tables above, and the actions
  each context documents;
- scans the game's scripts for the engine's generators (`randi`, `randf`, `RandomNumberGenerator`, `shuffle` and the like)
  outside comments;
- hands the raw observations to the independent oracle.

The **oracle** (`tests/civ-lite-game-oracle.mjs`) judges the raw report and trusts none of the probe's verdicts. It
re-parses each serialization and proves it canonical (sorted keys, integers only), recomputes SHA-256 from it, and
recomputes in Node what the game computed: map bounds and frame; the counts of cities, units and ids; non-negative
resources; the monotonic turn; every move against its own cost table; the whole end of a turn (yields, production,
growth, research, the faction's route, the refresh) from the serialization before it; the research order; the three events
raised together, once, on turn 5, in the order of the table, and each answered once, in the order of the queue, with a choice of its own event (the answered ones and the waiting ones
are always all three, in the table's order, or none); the context derived again from the serialization. It also re-derives the PRNG in
`BigInt`: PCG's reference outputs, the generator's state after the number of draws the game says it made, and the map the
generator must have drawn from the seed. Every refusal is justified by the state before it, and every accepted intent must
leave exactly the state the oracle computes. In every state, the roteiro's and the three built turns', it also requires that
no tile holds units of two sides and that no unit of the faction stands on the player's city. It judges the log too: the entries
a turn appended are the last `log_seq` difference entries of the log, each carries the turn its phase ran in (the turn the
`end_turn` began on, except the `refresh` phase, which emits after the turn advances), their number is the number of events the
phases reported, and the first two are the events the rules give the faction's phases (`ai_planned`, then `ai_moved` when it
walks or `ai_blocked` when it waits, each with the target tile), compared apart from the phases the probe reports. In the three
built turns it also requires exactly one `ai_blocked`, at the tile the faction could not enter, and no `ai_moved`, so a wait that
is reported as a move, or not reported, cannot pass: the state alone does not show it.

### Retained sabotages

`node scripts/civ-lite-game-sabotage.mjs` edits one GDScript source at a time through `scripts/sabotage-sources.mjs`
(restored byte for byte, whatever ends the run) and runs the test against it; the test and the oracle must both reject it.

- **prng**: the PRNG's output is replaced by `randi()`. The map differs in every process, so the three executions disagree,
  the generator no longer gives PCG32's published outputs and the golden hash is lost.
- **canon**: the serializer stops sorting keys. The hash no longer matches the golden one and the oracle finds the keys
  out of order.
- **rule**: a forest costs 1 movement point instead of 2, an error of one unit. The Settler keeps a point the roteiro says it
  spent, so a refusal it expects does not happen, the golden hash is lost and the oracle finds a move that did not pay the
  terrain's cost.
- **economy**: the city centre yields 2 production instead of 1. The oracle, which recomputes the end of every turn from the
  serialization before it, finds the first turn in which the city produced.
- **ai-ignores-block**: the faction no longer waits for a unit of the player or the city. The roteiro never reaches the wait, so
  the roteiro's states and the golden and trace hashes are unchanged; the three built turns fail five probe checks and the oracle finds the
  faction on the player's tile.
- **ai-city**: only a unit of the player blocks the faction, not the city: the defect found in the review of PR #70, where the
  faction walked into the city and the Warrior the city finished that turn was born on top of it. Four probe checks fail and the
  oracle rejects `city-on-route`.
- **ai-wrong-event**: the faction waits as it should but emits `ai_moved` in place of `ai_blocked`. The wait's game fields other
  than the log are unchanged, and so are the replay's golden and trace hashes, because the roteiro never reaches a wait; the
  wait case's log is not, and the log is part of the serialized state. One probe check fails (the wait is an `ai_blocked`
  event) and the oracle rejects `city-on-route` through its judgment of the log entries the turn appended.

The control with a previous host **does not apply**: this slice has no native code and no host to compare with. The restored
sources are proven by hash and must pass the plain test.

## Compatibility and examples

There is no React Native API in this slice: no export, TurboModule or prop changed, so `docs/API.md`,
`docs/NATIVE_MODULES.md`, `docs/PARITY.md` (an audit of React Native's API) and `docs/compatibility/` do not apply. There is
no visual example either: the playable game with its HUD is V05-05 and V05-08, so there is no `examples/` entry and no
capture. Hosted CI for `npm run test:civ-lite-game` is pending.

## Limits and open questions

- **The snapshot is a service since the services slice.** `consumers/civ-lite/services/` holds the `GameServices` node, its
  schemas and, in `ui/frontier-types.ts`, the TypeScript mirror ([research](frontier-services.md)). The tables above are the
  contract they mirror; any change here is a change of contract, and the parity test fails on a field that differs.
- **Intent arguments are typed, and a wrong type is the caller's error.** The methods declare `int` and `String` parameters,
  so GDScript raises its own error for another type instead of a refusal. Through the services, the schema of each method
  refuses a wrong type, a wrong count or an extra field with `E_SERVICE_SCHEMA` before any GDScript runs.
- **A `project.godot` in `consumers/civ-lite/` would hide the game from the root project.** Godot treats a folder with its
  own `project.godot` as a separate project, as `consumers/minimal` is. The test loads `res://consumers/civ-lite/game/`
  from the root project; the scripts use relative `preload` paths, so they also work as `res://game/` in a consumer
  project of their own. When the consumer is created, the test must move with it or point `--path` at it.
- **Release builds.** The scripts use no `assert` and no debug-only call, so they behave the same in an export.
- **The numbers are not balanced.** Costs, yields and thresholds are chosen to make a 12-turn replay exercise every rule,
  not to be a good game.
- **Arm B of the final comparison** will re-implement the HUD against this snapshot; its parity rests on the context
  matrix above and on `enabled`/`reason` being the intent's own check.
