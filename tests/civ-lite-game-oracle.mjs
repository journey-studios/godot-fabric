import assert from "node:assert/strict";
import {createHash} from "node:crypto";

// The independent oracle of Frontier's replay. It judges the raw observations of the probe's report, the canonical
// serialization after every step of the roteiro, and none of the probe's verdicts (`checks`, `allPassed`). Everything
// it holds about the rules is written again here, from docs/research/frontier-game.md, in Node and in other terms
// than the game's GDScript: a rule that is wrong in one of the two shows as a disagreement.
//
// For each step it recomputes the state the intent must leave from the state before it, and compares the two. It also
// proves, for every serialization, that it is canonical (sorted keys, integers and printable-ASCII strings only), that
// the reported hash is SHA-256 of it, and that the PRNG state is what PCG32 reaches after the draws the game counted.

const WIDTH = 24;
const HEIGHT = 16;
const SEED = 4242;
const PRNG_SEQUENCE = 54;
const PLAYER = 1;
const FACTION = 2;

const WATER = 0;
const PLAIN = 1;
const FOREST = 2;
const HILL = 3;
const TERRAIN = [
  {food: 1, production: 0, science: 2, move: 0},
  {food: 2, production: 1, science: 0, move: 1},
  {food: 1, production: 2, science: 0, move: 2},
  {food: 0, production: 2, science: 1, move: 2},
];
const ALLOWANCE = {settler: 2, warrior: 3};
const CENTER = {food: 1, production: 1, science: 2};
const MAX_SIZE = 3;
const QUEUE_MAX = 3;
const ITEMS = {
  warrior: {kind: "unit", cost: 8, tech: "", food: 0, production: 0, science: 0},
  granary: {kind: "building", cost: 10, tech: "alphabet", food: 2, production: 0, science: 0},
  workshop: {kind: "building", cost: 14, tech: "bronze_working", food: 0, production: 2, science: 0},
  library: {kind: "building", cost: 16, tech: "writing", food: 0, production: 0, science: 2},
};
const TECHS = [{id: "alphabet", cost: 6}, {id: "bronze_working", cost: 9}, {id: "writing", cost: 12}];
const EVENT_TURN = 5;
const CHOICES = ["welcome", "turn_away"];
const ROUTE = [[17, 8], [18, 8], [19, 8], [19, 9], [19, 10], [18, 10], [17, 10], [17, 9]];
const PHASES = ["ai_plan", "ai_move", "production", "growth", "research", "refresh"];
const CONTEXTS = ["none", "tile", "settler", "warrior", "stack", "city", "dialog"];
const LOG_MAX = 32;
const TASK_LIMIT = 64;
const EVENT_LIMIT = 128;
const FORCED_TILES = [
  [5, 7, 0], [5, 8, 0], [5, 9, 0], [6, 7, 1], [6, 8, 1], [6, 9, 1], [7, 7, 3], [7, 8, 2], [7, 9, 1], [8, 7, 2], [8, 8, 1], [8, 9, 3],
  [9, 8, 1], [9, 9, 1], [17, 8, 1], [18, 8, 1], [19, 8, 1], [19, 9, 1], [19, 10, 1], [18, 10, 1], [17, 10, 1], [17, 9, 1],
];
// PCG's published reference outputs for the generator seeded with state 42 and sequence 54.
const PCG_REFERENCE = [0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e];
const STATE_KEYS = ["ai", "cities", "event", "log", "log_seq", "map", "next_unit", "phase", "res", "research", "rng", "sel", "seed", "turn", "units", "v"].sort();

const M64 = (1n << 64n) - 1n;
const MULTIPLIER = 6364136223846793005n;
const M32 = 0xffffffffn;

// PCG32 (XSH-RR) on BigInt, written from the algorithm and not from the game's script.
class Pcg32 {
  constructor(state, increment, draws) {
    this.state = state;
    this.increment = increment;
    this.draws = draws;
  }

  static seeded(seed, sequence) {
    const generator = new Pcg32(0n, ((BigInt(sequence) << 1n) | 1n) & M64, 0);
    generator.step();
    generator.state = (generator.state + BigInt(seed)) & M64;
    generator.step();
    return generator;
  }

  static fromRecord(rng) {
    const join = (high, low) => (BigInt(high) << 32n) | BigInt(low);
    return new Pcg32(join(rng.state_hi, rng.state_lo), join(rng.inc_hi, rng.inc_lo), rng.draws);
  }

  step() {
    const old = this.state;
    this.state = (old * MULTIPLIER + this.increment) & M64;
    return old;
  }

  next() {
    const old = this.step();
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & M32);
    const rotation = Number(old >> 59n);
    this.draws += 1;
    return ((xorshifted >>> rotation) | (xorshifted << ((32 - rotation) & 31))) >>> 0;
  }

  below(bound) {
    const threshold = (0x100000000 - bound) % bound;
    for (;;) {
      const value = this.next();
      if (value >= threshold) {
        return value % bound;
      }
    }
  }

  record() {
    return {state_hi: Number(this.state >> 32n), state_lo: Number(this.state & M32), inc_hi: Number(this.increment >> 32n),
      inc_lo: Number(this.increment & M32), draws: this.draws};
  }
}

const digest = text => createHash("sha256").update(text, "utf8").digest("hex");
const index = (x, y) => y * WIDTH + x;
const inBounds = (x, y) => x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT;

// The one spelling of a state: sorted keys, no whitespace, integers, printable ASCII strings. Anything else throws.
function canonical(value, where) {
  if (typeof value === "number") {
    assert.ok(Number.isSafeInteger(value), `${where} must be an integer`);
    return String(value);
  }
  if (typeof value === "string") {
    assert.match(value, /^[\x20-\x7e]*$/, `${where} must be printable ASCII`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, position) => canonical(item, `${where}[${position}]`)).join(",")}]`;
  }
  assert.ok(value !== null && typeof value === "object", `${where} must be an integer, a string, an array or an object`);
  return `{${Object.keys(value).sort().map(key => `${canonical(key, `${where} key`)}:${canonical(value[key], `${where}.${key}`)}`).join(",")}}`;
}

function parseState(text, where) {
  const state = JSON.parse(text);
  assert.equal(canonical(state, where), text, `${where} must be the canonical serialization (sorted keys, integers and ASCII only)`);
  return state;
}

const unitAt = (state, x, y, owner = 0) => state.units.filter(unit => unit.x === x && unit.y === y && (owner === 0 || unit.owner === owner));
const unitById = (state, id) => state.units.find(unit => unit.id === id);
const cityAt = (state, x, y) => state.cities.find(city => city.x === x && city.y === y);
const terrainAt = (state, x, y) => state.map.terrain[index(x, y)];
const techIndex = id => TECHS.findIndex(entry => entry.id === id);
const known = (state, id) => techIndex(id) >= 0 && techIndex(id) < state.research.done;

// The context the HUD shows, derived again from a serialized state.
function contextOf(state) {
  if (state.event.pending === 1) {
    return "dialog";
  }
  const unit = state.sel.unit === 0 ? undefined : unitById(state, state.sel.unit);
  if (unit !== undefined) {
    return unit.kind;
  }
  if (state.sel.x < 0) {
    return "none";
  }
  if (cityAt(state, state.sel.x, state.sel.y) !== undefined) {
    return "city";
  }
  return unitAt(state, state.sel.x, state.sel.y, PLAYER).length >= 2 ? "stack" : "tile";
}

// What the city yields in a turn, from the map, the city and its buildings.
function rates(state) {
  const city = state.cities[0];
  if (city === undefined) {
    return {food: 0, production: 0, science: 0, tiles: 0};
  }
  const tile = (x, y) => ({x, y, ...TERRAIN[terrainAt(state, x, y)]});
  const neighbors = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if ((dx !== 0 || dy !== 0) && inBounds(city.x + dx, city.y + dy)) {
        neighbors.push(tile(city.x + dx, city.y + dy));
      }
    }
  }
  const total = entry => entry.food + entry.production + entry.science;
  neighbors.sort((a, b) => (total(b) - total(a)) || (b.production - a.production) || (b.food - a.food) || (a.y - b.y) || (a.x - b.x));
  const worked = [tile(city.x, city.y), ...neighbors.slice(0, city.size)];
  const result = {food: CENTER.food, production: CENTER.production, science: CENTER.science, tiles: worked.length};
  for (const entry of worked) {
    result.food += entry.food;
    result.production += entry.production;
    result.science += entry.science;
  }
  for (const building of city.buildings) {
    result.food += ITEMS[building].food;
    result.production += ITEMS[building].production;
    result.science += ITEMS[building].science;
  }
  return result;
}

// Why the intent must be refused in this state, or "" when it must be accepted. The checks are in the order the
// documentation lists them.
function refusal(state, intent, args) {
  if (state.event.pending === 1 && intent !== "resolve_event") {
    return "event_pending";
  }
  const unitReason = id => {
    const unit = unitById(state, id);
    if (unit === undefined) {
      return "unknown_unit";
    }
    return unit.owner === PLAYER ? "" : "not_your_unit";
  };
  switch (intent) {
    case "select_tile":
      return inBounds(args[0], args[1]) ? "" : "out_of_bounds";
    case "select_unit":
      return unitReason(args[0]);
    case "clear_selection":
      return state.sel.x < 0 ? "nothing_selected" : "";
    case "move_unit": {
      const [id, x, y] = args;
      if (unitReason(id) !== "") {
        return unitReason(id);
      }
      if (!inBounds(x, y)) {
        return "out_of_bounds";
      }
      const unit = unitById(state, id);
      if (Math.max(Math.abs(x - unit.x), Math.abs(y - unit.y)) !== 1) {
        return "not_adjacent";
      }
      const cost = TERRAIN[terrainAt(state, x, y)].move;
      if (cost === 0) {
        return "impassable_terrain";
      }
      if (unitAt(state, x, y).some(other => other.owner !== unit.owner)) {
        return "tile_occupied";
      }
      if (unit.moves === 0) {
        return "no_moves_left";
      }
      return unit.moves < cost ? "not_enough_moves" : "";
    }
    case "found_city": {
      if (unitReason(args[0]) !== "") {
        return unitReason(args[0]);
      }
      const unit = unitById(state, args[0]);
      if (unit.kind !== "settler") {
        return "not_a_settler";
      }
      if (state.cities.length > 0) {
        return "city_exists";
      }
      if (unit.moves === 0) {
        return "no_moves_left";
      }
      return unit.x < 1 || unit.x > WIDTH - 2 || unit.y < 1 || unit.y > HEIGHT - 2 ? "too_close_to_edge" : "";
    }
    case "fortify": {
      if (unitReason(args[0]) !== "") {
        return unitReason(args[0]);
      }
      const unit = unitById(state, args[0]);
      if (unit.kind === "settler") {
        return "cannot_fortify";
      }
      return unit.fortified === 1 ? "already_fortified" : "";
    }
    case "set_production": {
      const [item, slot] = args;
      const city = state.cities[0];
      if (city === undefined) {
        return "no_city";
      }
      if (!Object.hasOwn(ITEMS, item)) {
        return "unknown_item";
      }
      if (ITEMS[item].tech !== "" && !known(state, ITEMS[item].tech)) {
        return "tech_required";
      }
      if (ITEMS[item].kind === "building" && city.buildings.includes(item)) {
        return "already_built";
      }
      if (slot < 0 || slot > city.queue.length) {
        return "bad_slot";
      }
      if (ITEMS[item].kind === "building" && city.queue.some((queued, position) => queued === item && position !== slot)) {
        return "already_queued";
      }
      return slot === city.queue.length && city.queue.length >= QUEUE_MAX ? "queue_full" : "";
    }
    case "set_research": {
      const position = techIndex(args[0]);
      if (position < 0) {
        return "unknown_tech";
      }
      if (position < state.research.done) {
        return "tech_known";
      }
      if (position > state.research.done) {
        return "research_out_of_order";
      }
      return state.research.current === args[0] ? "already_researching" : "";
    }
    case "resolve_event":
      if (state.event.pending !== 1) {
        return "no_event";
      }
      return CHOICES.includes(args[0]) ? "" : "unknown_choice";
    case "end_turn":
      return "";
    default:
      return assert.fail(`unknown intent ${intent}`);
  }
}

// The state an accepted intent must leave (the log aside), and for an end_turn what each phase must report.
function accept(state, intent, args) {
  const next = structuredClone(state);
  const phases = [];
  switch (intent) {
    case "select_tile": {
      const [x, y] = args;
      const own = cityAt(next, x, y) === undefined ? unitAt(next, x, y, PLAYER) : [];
      next.sel = {x, y, unit: own.length === 1 ? own[0].id : 0};
      break;
    }
    case "select_unit": {
      const unit = unitById(next, args[0]);
      next.sel = {x: unit.x, y: unit.y, unit: unit.id};
      break;
    }
    case "clear_selection":
      next.sel = {x: -1, y: -1, unit: 0};
      break;
    case "move_unit": {
      const [id, x, y] = args;
      const unit = unitById(next, id);
      unit.moves -=TERRAIN[terrainAt(next, x, y)].move;
      unit.fortified = 0;
      unit.x = x;
      unit.y = y;
      if (next.sel.unit === id) {
        next.sel.x = x;
        next.sel.y = y;
      }
      break;
    }
    case "found_city": {
      const unit = unitById(next, args[0]);
      next.units = next.units.filter(other => other.id !== unit.id);
      next.cities.push({name: "Aurora", x: unit.x, y: unit.y, size: 1, queue: [], buildings: []});
      next.sel = {x: unit.x, y: unit.y, unit: 0};
      break;
    }
    case "fortify": {
      const unit = unitById(next, args[0]);
      unit.fortified = 1;
      unit.moves = 0;
      break;
    }
    case "set_production": {
      const queue = next.cities[0].queue;
      if (args[1] === queue.length) {
        queue.push(args[0]);
      } else {
        queue[args[1]] = args[0];
      }
      break;
    }
    case "set_research":
      next.research.current = args[0];
      break;
    case "resolve_event": {
      const generator = Pcg32.fromRecord(next.rng);
      if (args[0] === "welcome") {
        next.res.food += 6 + generator.below(4);
      } else {
        next.res.production += 4;
      }
      next.rng = generator.record();
      next.event.pending = 0;
      next.event.resolved = 1;
      next.event.choice = args[0];
      break;
    }
    case "end_turn":
      endTurn(next, phases);
      break;
    default:
      assert.fail(`unknown intent ${intent}`);
  }
  return {next, phases};
}

// The six phases of a turn, on a copy of the state, with the tasks and events each must report.
function endTurn(state, phases) {
  const ai = state.ai;
  const faction = unitById(state, ai.unit);
  const phase = (name, tasks, events) => phases.push({name, tasks, events});
  if (faction === undefined) {
    phase("ai_plan", 0, 0);
    phase("ai_move", 0, 0);
  } else {
    [ai.tx, ai.ty] = ROUTE[(ai.step + 1) % ROUTE.length];
    phase("ai_plan", 1, 1);
    // The faction waits on a tile with a unit of the player or the player's city: it never captures and never overlaps.
    if (unitAt(state, ai.tx, ai.ty, PLAYER).length === 0 && cityAt(state, ai.tx, ai.ty) === undefined) {
      faction.x = ai.tx;
      faction.y = ai.ty;
      ai.step = (ai.step + 1) % ROUTE.length;
    }
    phase("ai_move", 1, 1);
  }
  const city = state.cities[0];
  if (city === undefined || city.queue.length === 0) {
    phase("production", 0, 0);
  } else {
    const yields = rates(state);
    state.res.production += yields.production;
    const item = ITEMS[city.queue[0]];
    let built = 0;
    if (state.res.production >= item.cost) {
      state.res.production -= item.cost;
      const name = city.queue.shift();
      if (item.kind === "unit") {
        state.units.push({id: state.next_unit, owner: PLAYER, kind: name, x: city.x, y: city.y, moves: ALLOWANCE[name], fortified: 0});
        state.next_unit += 1;
      } else {
        city.buildings.push(name);
      }
      built = 1;
    }
    phase("production", yields.tiles + 1, built);
  }
  if (city === undefined || city.size >= MAX_SIZE) {
    phase("growth", 0, 0);
  } else {
    const yields = rates(state);
    state.res.food += yields.food;
    const needed = city.size * 10;
    let grew = 0;
    if (state.res.food >= needed) {
      state.res.food -= needed;
      city.size += 1;
      grew = 1;
    }
    phase("growth", yields.tiles + 1, grew);
  }
  if (state.research.current === "") {
    phase("research", 0, 0);
  } else {
    const yields = rates(state);
    state.res.science += yields.science;
    let learned = 0;
    if (state.res.science >= TECHS[state.research.done].cost) {
      state.res.science -= TECHS[state.research.done].cost;
      state.research.done += 1;
      state.research.current = "";
      learned = 1;
    }
    phase("research", yields.tiles + 1, learned);
  }
  for (const unit of state.units) {
    unit.moves = ALLOWANCE[unit.kind];
  }
  state.turn += 1;
  state.sel = {x: -1, y: -1, unit: 0};
  let raised = 0;
  if (state.turn === EVENT_TURN && state.event.pending === 0 && state.event.resolved === 0) {
    state.event.pending = 1;
    raised = 1;
  }
  phase("refresh", state.units.length, 1 + raised);
}

// The terrain the generator must have drawn from the seed: a draw per tile, one majority pass, the water frame and the
// scenario's forced tiles. Answers the terrain and the number of draws it took.
function regenerateTerrain() {
  const generator = Pcg32.seeded(SEED, PRNG_SEQUENCE);
  const raw = [];
  for (let tile = 0; tile < WIDTH * HEIGHT; tile += 1) {
    const roll = generator.below(100);
    raw.push(roll < 22 ? WATER : roll < 40 ? FOREST : roll < 52 ? HILL : PLAIN);
  }
  const smooth = [...raw];
  for (let y = 1; y < HEIGHT - 1; y += 1) {
    for (let x = 1; x < WIDTH - 1; x += 1) {
      const counts = [0, 0, 0, 0];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          counts[raw[index(x + dx, y + dy)]] += 1;
        }
      }
      let best = raw[index(x, y)];
      for (let terrain = 0; terrain < 4; terrain += 1) {
        if (counts[terrain] > counts[best]) {
          best = terrain;
        }
      }
      smooth[index(x, y)] = best;
    }
  }
  for (let x = 0; x < WIDTH; x += 1) {
    smooth[index(x, 0)] = WATER;
    smooth[index(x, HEIGHT - 1)] = WATER;
  }
  for (let y = 0; y < HEIGHT; y += 1) {
    smooth[index(0, y)] = WATER;
    smooth[index(WIDTH - 1, y)] = WATER;
  }
  for (const [x, y, terrain] of FORCED_TILES) {
    smooth[index(x, y)] = terrain;
  }
  return {terrain: smooth, draws: generator.draws};
}

// The invariants every state must hold, whatever led to it.
function checkInvariants(state, where) {
  assert.deepEqual(Object.keys(state).sort(), STATE_KEYS, `${where} has exactly the documented keys`);
  assert.equal(state.v, 1, where);
  assert.equal(state.seed, SEED, where);
  assert.equal(state.phase, "idle", `${where} is at rest between intents`);
  assert.ok(Number.isInteger(state.turn) && state.turn >= 1, `${where} turn`);
  assert.deepEqual([state.map.w, state.map.h, state.map.terrain.length], [WIDTH, HEIGHT, WIDTH * HEIGHT], `${where} map size`);
  assert.ok(state.map.terrain.every(terrain => Number.isInteger(terrain) && terrain >= 0 && terrain <= 3), `${where} terrain ids`);
  for (let x = 0; x < WIDTH; x += 1) {
    assert.ok(terrainAt(state, x, 0) === WATER && terrainAt(state, x, HEIGHT - 1) === WATER, `${where} the frame of the map is water`);
  }
  for (let y = 0; y < HEIGHT; y += 1) {
    assert.ok(terrainAt(state, 0, y) === WATER && terrainAt(state, WIDTH - 1, y) === WATER, `${where} the frame of the map is water`);
  }
  let previous = 0;
  for (const unit of state.units) {
    assert.ok(unit.id > previous, `${where} unit ids ascend`);
    previous = unit.id;
    assert.ok([PLAYER, FACTION].includes(unit.owner) && Object.hasOwn(ALLOWANCE, unit.kind), `${where} unit ${unit.id} owner and kind`);
    assert.ok(inBounds(unit.x, unit.y) && terrainAt(state, unit.x, unit.y) !== WATER, `${where} unit ${unit.id} stands on land inside the map`);
    assert.ok(unit.moves >= 0 && unit.moves <= ALLOWANCE[unit.kind], `${where} unit ${unit.id} movement points are within its allowance`);
    assert.ok(unit.fortified === 0 || unit.fortified === 1, `${where} unit ${unit.id} fortified flag`);
  }
  assert.ok(state.next_unit > previous, `${where} next unit id`);
  assert.ok(state.cities.length <= 1, `${where} at most one city`);
  for (const city of state.cities) {
    assert.ok(inBounds(city.x, city.y) && terrainAt(state, city.x, city.y) !== WATER, `${where} the city stands on land`);
    assert.ok(city.size >= 1 && city.size <= MAX_SIZE, `${where} city size`);
    assert.ok(city.queue.length <= QUEUE_MAX && city.queue.every(item => Object.hasOwn(ITEMS, item)), `${where} city queue`);
    assert.ok(new Set(city.buildings).size === city.buildings.length && city.buildings.every(item => ITEMS[item]?.kind === "building"), `${where} city buildings`);
    assert.ok(city.queue.every(item => !city.buildings.includes(item)), `${where} nothing already built is queued`);
  }
  assert.ok(Object.values(state.res).every(stock => Number.isInteger(stock) && stock >= 0), `${where} resources are never negative`);
  assert.deepEqual(Object.keys(state.res).sort(), ["food", "production", "science"], where);
  assert.ok(state.research.done >= 0 && state.research.done <= TECHS.length, `${where} research is a prefix of the list`);
  assert.ok(state.research.current === "" || state.research.current === TECHS[state.research.done]?.id, `${where} only the next technology is researched`);
  const event = state.event;
  assert.ok((event.pending === 0 || event.pending === 1) && (event.resolved === 0 || event.resolved === 1) && event.pending + event.resolved <= 1, `${where} event flags`);
  assert.equal(event.choice === "", event.resolved === 0, `${where} the event's choice is set exactly when it is resolved`);
  assert.ok(event.resolved === 0 || CHOICES.includes(event.choice), `${where} event choice`);
  assert.ok(event.pending === 0 || state.turn >= EVENT_TURN, `${where} the event is not raised before its turn`);
  const faction = unitById(state, state.ai.unit);
  assert.ok(faction !== undefined && faction.owner === FACTION, `${where} the faction's Warrior`);
  assert.deepEqual([faction.x, faction.y], ROUTE[state.ai.step], `${where} the faction's Warrior stands on its route`);
  // Units of different sides never share a tile, and the faction never enters the player's city.
  for (const unit of state.units) {
    assert.ok(unitAt(state, unit.x, unit.y).every(other => other.owner === unit.owner), `${where} no tile holds units of two sides`);
  }
  for (const city of state.cities) {
    assert.ok(unitAt(state, city.x, city.y).every(unit => unit.owner === PLAYER), `${where} the faction never enters the player's city`);
  }
  assert.ok(state.sel.unit === 0 || (unitById(state, state.sel.unit)?.owner === PLAYER), `${where} selected unit`);
  if (state.sel.unit !== 0) {
    const unit = unitById(state, state.sel.unit);
    assert.deepEqual([state.sel.x, state.sel.y], [unit.x, unit.y], `${where} the selected unit's tile is selected`);
  }
  assert.ok((state.sel.x === -1 && state.sel.y === -1) || inBounds(state.sel.x, state.sel.y), `${where} selection inside the map`);
  assert.ok(state.log.length <= LOG_MAX, `${where} log size`);
  state.log.forEach((entry, position) => {
    assert.equal(entry.seq, state.log_seq - state.log.length + 1 + position, `${where} the log's sequence numbers are consecutive`);
    assert.ok(entry.turn >= 1 && entry.turn <= state.turn, `${where} log turns`);
  });
}

// Keeps the log aside, which is judged by its sequence numbers and the phases' event counts.
const withoutLog = state => ({...state, log: undefined, log_seq: undefined});

export function verifyFrontierReport(report) {
  assert.equal(report.scenario, "civ-lite-game");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.seed, SEED);

  // PCG32 against its published outputs, twice: the report's (the game's own generator) and the oracle's BigInt one.
  assert.deepEqual(report.prng.vector, PCG_REFERENCE, "the game's PRNG must produce PCG32's published reference outputs");
  const reference = Pcg32.seeded(42, 54);
  assert.deepEqual(PCG_REFERENCE.map(() => reference.next()), PCG_REFERENCE, "the oracle's PCG32 reproduces the published outputs");

  // Every state of the replay, parsed from its serialization and judged.
  const generator = Pcg32.seeded(SEED, PRNG_SEQUENCE);
  const rngFollowsDraws = (state, where) => {
    assert.ok(state.rng.draws >= generator.draws, `${where} the PRNG's draw count never goes back`);
    while (generator.draws < state.rng.draws) {
      generator.next();
    }
    assert.deepEqual(state.rng, generator.record(), `${where} the PRNG state is what PCG32 reaches after ${state.rng.draws} draws`);
  };
  const initial = parseState(report.initial, "the initial state");
  checkInvariants(initial, "the initial state");
  rngFollowsDraws(initial, "the initial state");
  const terrain = regenerateTerrain();
  assert.deepEqual(initial.map.terrain, terrain.terrain, "the map is what the generator draws from the seed");
  assert.equal(initial.rng.draws, terrain.draws, "only the map drew from the PRNG before the first turn");
  assert.equal(initial.turn, 1);
  assert.deepEqual(initial.units.map(unit => [unit.id, unit.owner, unit.kind, unit.x, unit.y, unit.moves, unit.fortified]),
    [[1, PLAYER, "settler", 6, 8, 2, 0], [2, PLAYER, "warrior", 6, 8, 3, 0], [3, FACTION, "warrior", 17, 8, 3, 0]]);
  assert.deepEqual([initial.cities.length, initial.res, initial.event.pending, initial.event.resolved], [0, {food: 0, production: 0, science: 0}, 0, 0]);

  const seen = new Set();
  const refusals = {};
  let turns = 0;
  let previous = initial;
  let previousText = report.initial;
  let previousSeq = initial.log_seq;
  for (const step of report.steps) {
    const where = `step ${step.index} ${step.intent}(${step.args.join(", ")})`;
    const state = parseState(step.serialization, where);
    checkInvariants(state, where);
    rngFollowsDraws(state, where);
    assert.equal(step.hash, digest(step.serialization), `${where}: the hash is SHA-256 of the serialization`);
    assert.equal(step.turn, state.turn, where);
    assert.ok(state.turn >= previous.turn && state.turn <= previous.turn + 1, `${where} the turn is monotonic`);

    const reason = refusal(previous, step.intent, step.args);
    assert.equal(step.code, reason === "" ? "ok" : reason, `${where} must be ${reason === "" ? "accepted" : "refused with " + reason}`);
    assert.equal(step.ok, reason === "" ? 1 : 0, where);
    if (reason !== "") {
      assert.equal(step.serialization, previousText, `${where} was refused and must change nothing`);
      refusals[reason] = (refusals[reason] ?? 0) + 1;
    } else {
      const {next, phases} = accept(previous, step.intent, step.args);
      assert.deepEqual(withoutLog(state), withoutLog(next), `${where} must leave the state the rules compute from the state before it`);
      const emitted = state.log_seq - previousSeq;
      if (step.intent === "end_turn") {
        turns += 1;
        assert.deepEqual(step.phases, phases, `${where}: each phase reports the tasks it ran and the events it emitted`);
        assert.deepEqual(step.phases.map(phase => phase.name), PHASES);
        assert.ok(step.phases.every(phase => phase.tasks <= TASK_LIMIT && phase.events <= EVENT_LIMIT), `${where}: no phase passes 64 tasks or 128 events`);
        assert.equal(emitted, phases.reduce((sum, phase) => sum + phase.events, 0), `${where}: the log grows by the events the phases reported`);
      } else if (["select_tile", "select_unit", "clear_selection"].includes(step.intent)) {
        assert.equal(emitted, 0, `${where}: a selection change emits no event`);
      } else {
        assert.equal(emitted, 1, `${where}: an accepted intent emits one event`);
      }
    }
    const context = contextOf(state);
    assert.equal(step.context, context, `${where}: the context is derived from the state`);
    if (step.label.startsWith("cover-")) {
      assert.equal(context, step.label.slice("cover-".length), `${where} covers its context`);
    }
    seen.add(context);
    previous = state;
    previousText = step.serialization;
    previousSeq = state.log_seq;
  }

  assert.equal(turns, 12, "twelve turns were played");
  assert.equal(previous.turn, 13, "turn 13 begins after the twelfth");
  assert.deepEqual([...seen].sort(), [...CONTEXTS].sort(), "the replay covers all seven contexts");
  assert.equal(report.finalHash, report.steps.at(-1).hash, "the final hash is the last step's");
  assert.equal(report.finalHash, digest(report.steps.at(-1).serialization));
  assert.equal(previous.event.resolved, 1, "the event was resolved once");
  assert.equal(previous.cities.length, 1, "one city was founded");

  // The turns the roteiro cannot play, because it never puts the player on the faction's route: states built so the
  // faction's next tile holds the player's city or a unit of the player. Each end_turn is judged as a roteiro step is,
  // and neither state may have units of two sides on a tile.
  assert.ok(Array.isArray(report.waitCases) && report.waitCases.length > 0, "the report holds the states built for the faction's wait");
  for (const entry of report.waitCases) {
    const where = `case ${entry.name}`;
    const before = parseState(entry.before, `${where} before`);
    const after = parseState(entry.after, `${where} after`);
    checkInvariants(before, `${where} before`);
    checkInvariants(after, `${where} after`);
    assert.equal(refusal(before, "end_turn", []), "", `${where} must be an accepted end_turn`);
    assert.deepEqual(withoutLog(after), withoutLog(accept(before, "end_turn", []).next), `${where}: end_turn must leave the state the rules compute from the state before it`);
  }
  return {steps: report.steps.length, turns, finalHash: report.finalHash, contexts: [...seen].sort(), refusals, draws: previous.rng.draws,
    waitCases: report.waitCases.map(entry => entry.name)};
}
