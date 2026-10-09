import {GRAPHICS_RUNS, IDLE_FRAMES, REST_FRAMES, STABLE_FRAMES, WARMUP_ROUNDS} from "./frontier-baseline-cases.mjs";
import {TABLE as HUD_TABLE} from "./civ-lite-ui-oracle.mjs";

// The experiment of the turn (V05-06, criterion `turno`), as plain data: the probe drives the provisioned Frontier game from these
// numbers and the oracle derives what must hold from the same numbers with its own formulas. Neither side reads the other's results
// here. The game, its HUD and its panels are the consumer's (consumers/civ-lite) as the template has them; the harness and the thresholds
// are the baseline's and GF-30's (frontier-baseline-cases.mjs, performance-cases.mjs, frontier-soak-cases.mjs).

export {GRAPHICS_RUNS, IDLE_FRAMES, REST_FRAMES, STABLE_FRAMES, WARMUP_ROUNDS};

// A round of the tour starts on a new game and ends on the answer to the event; the first WARMUP_ROUNDS warm the runtime up (the
// baseline's number: its heap rule drops that many readings from the front of the list it is given) and are left out of what is judged and
// summarized. STEADY_ROUNDS is the steady state: at least 30 rounds, and four turns in each of them.
export const STEADY_ROUNDS = 30;
export const TURNS_PER_ROUND = 4;

// The limits of a wait for state, in frames. They are a ceiling on a stall, never a measure: a click whose panels do not show within
// the limit ends the run (what follows would start from a state nobody knows), and the frames a click really takes are recorded and
// summarized, not fixed here.
export const CLICK_FRAME_LIMIT = 10;
// The end of a turn is a job of seven frames; the limit leaves room for the pointer and the render around it.
export const TURN_FRAME_LIMIT = 40;

// The contexts of the game (docs/research/frontier-game.md) and the panels the HUD mounts for each: the table of the HUD lane's own oracle, which is where
// it is written once for the JavaScript side (the one in consumers/civ-lite/hud_validation.gd is the probe's, and the report echoes it for this oracle to
// compare). The HUD's test IDs are the panels' names under `hud-`. The device of the validation events, the viewport and the map's geometry are that
// file's too: the probe reads them from it and the report carries them, and nothing here repeats them.
export const CONTEXT_PANELS = Object.fromEntries(Object.entries(HUD_TABLE).map(([context, panels]) => [context, panels.map(panel => `hud-${panel}`)]));
export const GAME_CONTEXTS = Object.keys(CONTEXT_PANELS);
export const HUD_PANELS = [...new Set(Object.values(CONTEXT_PANELS).flat())];
// The settler, the warrior and the stack mount the same panels; what tells them apart is one button of the actions panel that only that
// context lists in the tour's state (its testID is the action's id and arguments).
export const MARKERS = {stack: "hud-actions-select_unit-2", settler: "hud-actions-found_city-1", warrior: "hud-actions-fortify-2"};

// The sequence of phases of the end of a turn, as the services run it (docs/research/frontier-services.md): one phase per frame, and the
// frame that finishes the last one hands the game back at rest.
export const PHASES = ["ai_plan", "ai_move", "production", "growth", "research", "refresh", "idle"];

// The tour. Every step is one real click of the pointer at the point it names, on the device of the validation: a tile of the map (the World
// asks the game to select it), a button of the actions panel, the End turn of the bar or the choice of the dialog. A round starts on a new game
// (prepared through the services, not measured) and visits all seven contexts: `dialog` is opened by the End turn of the fourth turn, which raises
// the event when turn 5 begins. `intent` is the one call the click makes to the game. `from` and `to` are the contexts before and after.
export const STEPS = [
  {id: "map-stack", kind: "map", tile: [6, 8], from: "none", to: "stack", intent: "select_tile"},
  {id: "select-warrior", kind: "action", target: "hud-actions-select_unit-2", from: "stack", to: "warrior", intent: "select_unit"},
  {id: "clear-selection", kind: "action", target: "hud-actions-clear_selection", from: "warrior", to: "none", intent: "clear_selection"},
  {id: "map-stack-again", kind: "map", tile: [6, 8], from: "none", to: "stack", intent: "select_tile"},
  {id: "select-settler", kind: "action", target: "hud-actions-select_unit-1", from: "stack", to: "settler", intent: "select_unit"},
  {id: "map-tile", kind: "map", tile: [9, 8], from: "settler", to: "tile", intent: "select_tile"},
  {id: "map-stack-third", kind: "map", tile: [6, 8], from: "tile", to: "stack", intent: "select_tile"},
  {id: "select-settler-again", kind: "action", target: "hud-actions-select_unit-1", from: "stack", to: "settler", intent: "select_unit"},
  {id: "found-city", kind: "action", target: "hud-actions-found_city-1", from: "settler", to: "city", intent: "found_city"},
  {id: "map-tile-again", kind: "map", tile: [9, 8], from: "city", to: "tile", intent: "select_tile"},
  {id: "map-city", kind: "map", tile: [6, 8], from: "tile", to: "city", intent: "select_tile"},
  {id: "end-turn-1", kind: "turn", target: "hud-bar-end-turn", from: "city", to: "none", intent: "end_turn"},
  {id: "end-turn-2", kind: "turn", target: "hud-bar-end-turn", from: "none", to: "none", intent: "end_turn"},
  {id: "end-turn-3", kind: "turn", target: "hud-bar-end-turn", from: "none", to: "none", intent: "end_turn"},
  {id: "end-turn-4", kind: "turn", target: "hud-bar-end-turn", from: "none", to: "dialog", intent: "end_turn"},
  {id: "answer-event", kind: "dialog", target: "hud-dialog-choice-welcome", from: "dialog", to: "none", intent: "resolve_event"},
];

// What the HUD holds while the game screen is up: the connection to the snapshot and the one to the tile under the pointer.
export const HUD_CONNECTIONS = 2;

// The windowed lane (scripts/frontier-turn-graphics.mjs) runs GRAPHICS_RUNS processes and an idle window of IDLE_FRAMES frames: the baseline's.
