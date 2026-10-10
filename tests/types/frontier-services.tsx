import { GodotFabric } from "@godot-fabric/runtime";
import {
  callFrontier,
  FRONTIER_CLEAR_SELECTION,
  FRONTIER_END_TURN,
  FRONTIER_FORTIFY,
  FRONTIER_FOUND_CITY,
  FRONTIER_IRRIGATE,
  FRONTIER_MOVE_UNIT,
  FRONTIER_NEW_GAME,
  FRONTIER_RESOLVE_EVENT,
  FRONTIER_SELECT_TILE,
  FRONTIER_SELECT_UNIT,
  FRONTIER_SET_PRODUCTION,
  FRONTIER_SET_RESEARCH,
  FRONTIER_SNAPSHOT,
  FRONTIER_STRESS_BEGIN,
  FRONTIER_STRESS_END,
  FRONTIER_STRESS_STEP,
  FRONTIER_TURN_ENDED,
  type FrontierCall,
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
  const lastJob: number = value.last_job;
  const phase: string = value.phase;
  const context: string = value.context;
  const turn: number = value.turn;
  const foodStock: number = value.resources.food.stock;
  const foodRate: number = value.resources.food.rate;
  const unitId: number = value.actions[0].args[0];
  // The stress mode's lists are there only while it is on: the field is optional, and reading it without that in mind does not compile.
  const stressed: number | undefined = value.stress?.log.length;
  void stressed;
  // @ts-expect-error `stress` may be absent
  const carried: number = value.stress.log.length;
  void carried;
  const reason: string = value.actions[0].reason;
  const terrain: string = value.tile.terrain_name;
  // The tile card says whether the tile is irrigated (0 or 1); its `food` already has the irrigation's.
  const irrigated: number = value.tile.irrigated;
  const queued: string = value.city.queue[0].item;
  const tech: string = value.research.techs[0].state;
  const choice: string = value.dialog.choices[0].label;
  void [epoch, lastJob, phase, context, turn, foodStock, foodRate, unitId, reason, terrain, irrigated, queued, tech, choice, revision, generation];
  // @ts-expect-error irrigated is a number, not a boolean
  const flag: boolean = value.tile.irrigated;
  void flag;
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
  // @ts-expect-error last_job is a number, not a string
  const wrongLastJob: string = value.last_job;
  void wrongLastJob;
});
void snapshot.ready;

// The end of a turn arrives on its own signal, once per job: the turn that begins, the phases that ran and the job it finishes.
const ended = GodotFabric.subscribe<[FrontierTurnEnded]>(FRONTIER_TURN_ENDED, summary => {
  const turn: number = summary.turn;
  const first: string = summary.phases[0].name;
  const tasks: number = summary.phases[0].tasks;
  const job: number = summary.job;
  void [turn, first, tasks, job];
  // @ts-expect-error the job is a number, not a string
  const wrongJob: string = summary.job;
  void wrongJob;
  // @ts-expect-error the summary has no result of the intent
  summary.ok;
});
void ended.ready;

// What each registered name carries is declared once: the state's value and the signal's argument tuple.
declare const published: FrontierStates["frontier.snapshot"];
const publishedSnapshot: FrontierSnapshot = published;
const emitted: FrontierSignals["frontier.turn_ended"] = [{ turn: 2, phases: [{ name: "ai_plan", tasks: 1, events: 1 }], job: 1 }];
void [publishedSnapshot, emitted];

// Calls: the tuple each method declares, and an answer with `ok` as a number. end_turn answers on acceptance, with the id of
// its job: `job` is 0 for every call that starts none.
void callFrontier(FRONTIER_SELECT_TILE, [6, 8]);
void callFrontier(FRONTIER_SELECT_UNIT, [1]);
void callFrontier(FRONTIER_MOVE_UNIT, [1, 7, 8]);
void callFrontier(FRONTIER_SET_PRODUCTION, ["warrior", 0]);
void callFrontier(FRONTIER_CLEAR_SELECTION, []);
void callFrontier(FRONTIER_FOUND_CITY, [1]);
void callFrontier(FRONTIER_FORTIFY, [2]);
void callFrontier(FRONTIER_IRRIGATE, [1]);
void callFrontier(FRONTIER_SET_RESEARCH, ["alphabet"]);
void callFrontier(FRONTIER_RESOLVE_EVENT, ["welcome"]);
void callFrontier(FRONTIER_END_TURN, []);
void callFrontier(FRONTIER_NEW_GAME, []);
// The comparison's stress mode: no arguments, and the snapshot carries `stress` only while it is on (an optional field, so it may be undefined).
void callFrontier(FRONTIER_STRESS_BEGIN, []);
void callFrontier(FRONTIER_STRESS_STEP, []);
void callFrontier(FRONTIER_STRESS_END, []);
const moveArgs: FrontierMethods["frontier.move_unit"] = [1, 7, 8];
void moveArgs;
const answered = callFrontier(FRONTIER_END_TURN, []).then(({ value }) => {
  const result: FrontierResult = value;
  const ok: number = result.ok;
  const code: string = result.code;
  const job: number = result.job;
  void [ok, code, job];
  // @ts-expect-error job is a number, not a string
  const wrongJob: string = result.job;
  void wrongJob;
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
// @ts-expect-error irrigate takes the Settler's id and nothing else
void callFrontier(FRONTIER_IRRIGATE, [1, 6]);
// @ts-expect-error select_unit takes an integer, not an object
void callFrontier(FRONTIER_SELECT_UNIT, [{ unit_id: 1 }]);
// @ts-expect-error there is no such method
void callFrontier("frontier.teleport", [1, 2]);
// @ts-expect-error a method's tuple is exactly its arguments
const tooShort: FrontierMethods["frontier.move_unit"] = [1, 7];
void tooShort;

// A name and its arguments are one pair. A pair can be built, kept and spread into the call.
const pair: FrontierCall = [FRONTIER_SELECT_TILE, [6, 8]];
void callFrontier(...pair);
// @ts-expect-error a pair is the name with the arguments of that same method
const mismatched: FrontierCall = [FRONTIER_END_TURN, [6, 8]];
void mismatched;
// A name that is itself a union must not accept the arguments of only one of its members.
declare const eitherMethod: typeof FRONTIER_END_TURN | typeof FRONTIER_SELECT_TILE;
// @ts-expect-error end_turn takes no argument, though select_tile takes two
void callFrontier(eitherMethod, [6, 8]);
// @ts-expect-error select_tile takes two arguments, though end_turn takes none
void callFrontier(eitherMethod, []);
