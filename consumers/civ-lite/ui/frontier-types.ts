import { GodotFabric, type ServiceCallResult } from "@godot-fabric/runtime";

// The TypeScript mirror of Frontier's services, written by hand: the repository has no schema generator and this slice
// does not add one. The Godot side is consumers/civ-lite/services/schema.gd, and tests/frontier-services-parity.test.mjs
// reads THIS file with the TypeScript API, converts every shape to the registry's schema language and compares it, in
// both directions, with the schemas the Godot node registered. A field missing or extra on either side fails there,
// naming the field. The fields are documented in docs/research/frontier-game.md and docs/research/frontier-services.md.
//
// Conventions the extractor reads, which keep the two sides honest:
//   - `Int` is the registry's `integer`; a bare `number` would be read as `number` (nothing here uses it).
//   - A field is never optional, and nothing is `any`, `unknown`, a union or a generic: the schema language has exact
//     objects, arrays and scalars only. A flag is an `Int` that is 0 or 1; a refused or absent thing is 0 or "".
//   - `FrontierStates`, `FrontierSignals` and `FrontierMethods` map each registered name to what it carries.
//   - A shape that a signal carries is a type alias of an object literal with mutable arrays, because the transport's
//     `GodotDTO` constraint on signal argument tuples accepts that and not an interface, which has no index signature.

/** The registry's `integer`: a whole number within JavaScript's safe range. */
export type Int = number;

// --- The snapshot --------------------------------------------------------------------------------------------------

export interface Selection {
  /** The selected tile; -1 when nothing is selected. */
  readonly x: Int;
  readonly y: Int;
  /** The selected unit's id; 0 when no unit is selected. */
  readonly unit: Int;
}

export interface Stock {
  readonly stock: Int;
  /** Per turn; 0 until the city exists. */
  readonly rate: Int;
}

export interface Resources {
  readonly food: Stock;
  readonly production: Stock;
  readonly science: Stock;
}

export interface Action {
  /** The intent's name, which is the method's name without the `frontier.` prefix. */
  readonly id: string;
  readonly label: string;
  /**
   * The intent's positional arguments, in order: `[unit_id]` for select_unit, found_city and fortify, `[]` for
   * clear_selection and end_turn. The HUD sends them back as they are, `GodotFabric.call("frontier." + id, args)`, and
   * needs no knowledge of which intent takes what.
   */
  readonly args: readonly Int[];
  /** 0 or 1: exactly "the intent would be accepted now". */
  readonly enabled: Int;
  /** The refusal code, "" when enabled. */
  readonly reason: string;
  readonly reason_text: string;
}

export interface UnitCard {
  readonly id: Int;
  readonly owner: Int;
  readonly kind: string;
  readonly name: string;
  readonly moves: Int;
  readonly max_moves: Int;
  readonly fortified: Int;
}

export interface TileCard {
  /** 0 or 1. */
  readonly present: Int;
  readonly x: Int;
  readonly y: Int;
  /** The terrain id; -1 if absent. */
  readonly terrain: Int;
  readonly terrain_name: string;
  readonly food: Int;
  readonly production: Int;
  readonly science: Int;
  /** 0: cannot be entered. */
  readonly move_cost: Int;
  /** 0 or 1. */
  readonly city: Int;
  readonly units: readonly UnitCard[];
}

export interface QueueEntry {
  readonly slot: Int;
  readonly item: string;
  readonly label: string;
  readonly cost: Int;
  /** The production stock for slot 0, else 0. */
  readonly stock: Int;
}

export interface Item {
  readonly id: string;
  readonly label: string;
  /** "unit" or "building". */
  readonly kind: string;
  readonly cost: Int;
  /** The technology it needs; "" for none. */
  readonly tech: string;
  readonly enabled: Int;
  readonly reason: string;
  readonly reason_text: string;
}

export interface GarrisonEntry {
  readonly id: Int;
  readonly kind: string;
}

export interface CityScreen {
  /** 0 or 1. */
  readonly present: Int;
  readonly name: string;
  readonly x: Int;
  readonly y: Int;
  readonly size: Int;
  readonly max_size: Int;
  readonly food_needed: Int;
  readonly food_rate: Int;
  readonly production_rate: Int;
  readonly science_rate: Int;
  readonly queue: readonly QueueEntry[];
  readonly queue_max: Int;
  readonly items: readonly Item[];
  /** Item ids, in completion order. */
  readonly buildings: readonly string[];
  readonly garrison: readonly GarrisonEntry[];
}

export interface Tech {
  readonly id: string;
  readonly label: string;
  readonly cost: Int;
  /** "known", "current", "available" or "locked". */
  readonly state: string;
  readonly enabled: Int;
  readonly reason: string;
  readonly reason_text: string;
}

export interface Research {
  /** A technology id, or "". */
  readonly current: string;
  /** How many are learned. */
  readonly known: Int;
  /** The current one's cost; 0 with none. */
  readonly needed: Int;
  readonly rate: Int;
  readonly techs: readonly Tech[];
}

export interface Choice {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

export interface Dialog {
  /** 0 or 1. */
  readonly open: Int;
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly choices: readonly Choice[];
}

export interface FrontierSnapshot {
  /** The DTO version, 1. */
  readonly version: Int;
  /** The session's epoch: 1, and 1 higher after every `new_game`. A snapshot of an older epoch is from a finished game. */
  readonly epoch: Int;
  readonly turn: Int;
  /** "idle", or the phase a turn being processed is at. */
  readonly phase: string;
  /** One of the seven contexts: none, tile, settler, warrior, stack, city, dialog. */
  readonly context: string;
  readonly selection: Selection;
  readonly resources: Resources;
  readonly actions: readonly Action[];
  readonly tile: TileCard;
  readonly city: CityScreen;
  readonly research: Research;
  readonly dialog: Dialog;
}

// --- The end of a turn ---------------------------------------------------------------------------------------------

export type TurnPhase = {
  /** One of ai_plan, ai_move, production, growth, research, refresh, in that order. */
  readonly name: string;
  readonly tasks: Int;
  readonly events: Int;
};

/** What `frontier.turn_ended` carries: the turn that begins, and what each phase of the one that ended did. */
export type FrontierTurnEnded = {
  readonly turn: Int;
  readonly phases: TurnPhase[];
};

// --- Methods -------------------------------------------------------------------------------------------------------

/** What every method answers: `ok` is 0 or 1, `code` is "ok" or the refusal code, `text` is what the HUD shows. */
export interface FrontierResult {
  readonly ok: Int;
  readonly code: string;
  readonly text: string;
}

export const FRONTIER_SNAPSHOT = "frontier.snapshot";
export const FRONTIER_TURN_ENDED = "frontier.turn_ended";
export const FRONTIER_SELECT_TILE = "frontier.select_tile";
export const FRONTIER_SELECT_UNIT = "frontier.select_unit";
export const FRONTIER_CLEAR_SELECTION = "frontier.clear_selection";
export const FRONTIER_MOVE_UNIT = "frontier.move_unit";
export const FRONTIER_FOUND_CITY = "frontier.found_city";
export const FRONTIER_FORTIFY = "frontier.fortify";
export const FRONTIER_SET_PRODUCTION = "frontier.set_production";
export const FRONTIER_SET_RESEARCH = "frontier.set_research";
export const FRONTIER_RESOLVE_EVENT = "frontier.resolve_event";
export const FRONTIER_END_TURN = "frontier.end_turn";
export const FRONTIER_NEW_GAME = "frontier.new_game";
export const FRONTIER_OPEN_MENU = "frontier.open_menu";

/** The state the node publishes: connect to it for the snapshot now and after every accepted intent. */
export interface FrontierStates {
  readonly "frontier.snapshot": FrontierSnapshot;
}

/** The signals the node emits, as the tuple of arguments each carries. */
export interface FrontierSignals {
  readonly "frontier.turn_ended": [summary: FrontierTurnEnded];
}

/** The methods, each with the tuple of arguments it takes. All answer a `FrontierResult`. */
export interface FrontierMethods {
  readonly "frontier.select_tile": [x: Int, y: Int];
  readonly "frontier.select_unit": [unit_id: Int];
  readonly "frontier.clear_selection": [];
  readonly "frontier.move_unit": [unit_id: Int, x: Int, y: Int];
  readonly "frontier.found_city": [unit_id: Int];
  readonly "frontier.fortify": [unit_id: Int];
  readonly "frontier.set_production": [item_id: string, slot: Int];
  readonly "frontier.set_research": [tech_id: string];
  readonly "frontier.resolve_event": [choice_id: string];
  readonly "frontier.end_turn": [];
  readonly "frontier.new_game": [];
  /** Not a rule of the game: the scene drops its World. The HUD shows the menu; a `new_game` brings the World back. */
  readonly "frontier.open_menu": [];
}

/**
 * A method name paired with the arguments it declares: a union of labeled tuples, one per method. Pairing them (and
 * not indexing `FrontierMethods` by a generic name) keeps a name that is itself a union from accepting the arguments of
 * only one of its members.
 */
export type FrontierCall = {
  [Method in keyof FrontierMethods]: [method: Method, args: FrontierMethods[Method]];
}[keyof FrontierMethods];

/**
 * Calls a method with the arguments it declares. `GodotFabric.call` takes any DTO array, so a wrong type or a wrong
 * count only fails when the call reaches Godot (E_SERVICE_SCHEMA); through this function it does not compile.
 */
export function callFrontier(...[method, args]: FrontierCall): Promise<ServiceCallResult<FrontierResult>> {
  return GodotFabric.call<FrontierResult>(method, args);
}
