import { GodotFabric } from "@godot-fabric/runtime";
import {
  callFrontier,
  FRONTIER_CLEAR_SELECTION,
  FRONTIER_END_TURN,
  FRONTIER_FORTIFY,
  FRONTIER_FOUND_CITY,
  FRONTIER_MOVE_UNIT,
  FRONTIER_NEW_GAME,
  FRONTIER_RESOLVE_EVENT,
  FRONTIER_SELECT_TILE,
  FRONTIER_SELECT_UNIT,
  FRONTIER_SET_PRODUCTION,
  FRONTIER_SET_RESEARCH,
  FRONTIER_SNAPSHOT,
  FRONTIER_TURN_ENDED,
  type FrontierMethods,
  type FrontierResult,
  type FrontierSignals,
  type FrontierSnapshot,
  type FrontierStates,
  type FrontierTurnEnded,
} from "../../consumers/civ-lite/ui/frontier-types";

// The types of Frontier's services (consumers/civ-lite/ui/frontier-types.ts). The positive cases are what a HUD writes;
// the @ts-expect-error cases are the mistakes the types exist to stop, and the compiler fails an unused directive, so a
// type that stops rejecting one breaks `npm run type-check`. The names and shapes against Godot are
// tests/frontier-services-parity.test.mjs.

// The snapshot: every field is there, typed, and a field that does not exist does not compile.
const snapshot = GodotFabric.connect<FrontierSnapshot>(FRONTIER_SNAPSHOT, ({ value, revision, generation }) => {
  const epoch: number = value.epoch;
  const context: string = value.context;
  const turn: number = value.turn;
  const foodStock: number = value.resources.food.stock;
  const foodRate: number = value.resources.food.rate;
  const unitId: number = value.actions[0].args[0];
  const reason: string = value.actions[0].reason;
  const terrain: string = value.tile.terrain_name;
  const queued: string = value.city.queue[0].item;
  const tech: string = value.research.techs[0].state;
  const choice: string = value.dialog.choices[0].label;
  void [epoch, context, turn, foodStock, foodRate, unitId, reason, terrain, queued, tech, choice, revision, generation];
  // @ts-expect-error the snapshot has no gold
  value.gold;
  // @ts-expect-error resources have no gold stock
  value.resources.gold;
  // @ts-expect-error an action's args are a list of integers, not an object with named fields
  value.actions[0].args.unit_id;
  // @ts-expect-error an action's args are integers, not strings
  const wrongArg: string = value.actions[0].args[0];
  void wrongArg;
  // @ts-expect-error an action's args are read-only
  value.actions[0].args.push(1);
  // An action is a call: the id is the method's name and the args are the arguments, as they come.
  for (const action of value.actions) {
    void GodotFabric.call<FrontierResult>(`frontier.${action.id}`, action.args);
  }
  // @ts-expect-error a snapshot is read-only
  value.turn = 2;
  // @ts-expect-error epoch is a number, not a string
  const wrongEpoch: string = value.epoch;
  void wrongEpoch;
});
void snapshot.ready;

// The end of a turn arrives on its own signal, with the turn that begins and the phases that ran.
const ended = GodotFabric.subscribe<[FrontierTurnEnded]>(FRONTIER_TURN_ENDED, summary => {
  const turn: number = summary.turn;
  const first: string = summary.phases[0].name;
  const tasks: number = summary.phases[0].tasks;
  void [turn, first, tasks];
  // @ts-expect-error the summary has no result of the intent
  summary.ok;
});
void ended.ready;

// What each registered name carries is declared once: the state's value and the signal's argument tuple.
declare const published: FrontierStates["frontier.snapshot"];
const publishedSnapshot: FrontierSnapshot = published;
const emitted: FrontierSignals["frontier.turn_ended"] = [{ turn: 2, phases: [{ name: "ai_plan", tasks: 1, events: 1 }] }];
void [publishedSnapshot, emitted];

// Calls: the tuple each method declares, and an answer with `ok` as a number.
void callFrontier(FRONTIER_SELECT_TILE, [6, 8]);
void callFrontier(FRONTIER_SELECT_UNIT, [1]);
void callFrontier(FRONTIER_MOVE_UNIT, [1, 7, 8]);
void callFrontier(FRONTIER_SET_PRODUCTION, ["warrior", 0]);
void callFrontier(FRONTIER_CLEAR_SELECTION, []);
void callFrontier(FRONTIER_FOUND_CITY, [1]);
void callFrontier(FRONTIER_FORTIFY, [2]);
void callFrontier(FRONTIER_SET_RESEARCH, ["alphabet"]);
void callFrontier(FRONTIER_RESOLVE_EVENT, ["welcome"]);
void callFrontier(FRONTIER_END_TURN, []);
void callFrontier(FRONTIER_NEW_GAME, []);
const moveArgs: FrontierMethods["frontier.move_unit"] = [1, 7, 8];
void moveArgs;
const answered = callFrontier(FRONTIER_END_TURN, []).then(({ value }) => {
  const result: FrontierResult = value;
  const ok: number = result.ok;
  const code: string = result.code;
  void [ok, code];
  // @ts-expect-error ok is 0 or 1, never a boolean
  const accepted: boolean = result.ok;
  void accepted;
  // @ts-expect-error the result carries no turn: end_turn's turn and phases go out on frontier.turn_ended
  result.turn;
});
void answered;

// @ts-expect-error select_tile takes two integers, and "6" is a string
void callFrontier(FRONTIER_SELECT_TILE, ["6", 8]);
// @ts-expect-error select_tile takes two integers, and one is too few
void callFrontier(FRONTIER_SELECT_TILE, [6]);
// @ts-expect-error select_tile takes two integers, and three are too many
void callFrontier(FRONTIER_SELECT_TILE, [6, 8, 1]);
// @ts-expect-error end_turn takes no argument
void callFrontier(FRONTIER_END_TURN, [1]);
// @ts-expect-error set_production takes (item, slot), not (slot, item)
void callFrontier(FRONTIER_SET_PRODUCTION, [0, "warrior"]);
// @ts-expect-error select_unit takes an integer, not an object
void callFrontier(FRONTIER_SELECT_UNIT, [{ unit_id: 1 }]);
// @ts-expect-error there is no such method
void callFrontier("frontier.teleport", [1, 2]);
// @ts-expect-error a method's tuple is exactly its arguments
const tooShort: FrontierMethods["frontier.move_unit"] = [1, 7];
void tooShort;
