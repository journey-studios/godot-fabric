import {SHAPES} from "./frontier-baseline-cases.mjs";

// The experiment of the 100-turn soak (V05-06, criterion `soak`), as plain data: the fixture renders the HUD and plays the
// scripted player from these numbers, the probe drives the scene from them, and the oracle derives what must hold from the same
// numbers with its own formulas. Neither side reads the other's results here. The panel, the harness and the thresholds are the
// baseline's and GF-30's (frontier-baseline-cases.mjs, performance-cases.mjs); only what this experiment adds is here.

// 100 complete turns in each execution, the first WARMUP_TURNS of which are left out of the heap and RSS judgements. The
// baseline's heap rule (`heapAtRest`) drops its own WARMUP_ROUNDS from the front of the list it is given, and the soak gives it
// one reading at rest per turn, so the two numbers are the same one: the oracle asserts it.
export const TURNS = 100;
export const WARMUP_TURNS = 2;

// The three executions, one per process, and the strategy the heavy panel is closed with in each: A drops the panel when it
// closes ("unmount") and B keeps it mounted and invisible ("hide": opacity 0 and pointerEvents "none"; display "none" would
// mount no native node on this host, docs/research/frontier-baseline.md). The strategy changes the HUD only, so the game, its
// hashes and its trail are the same in the three.
export const STRATEGIES = ["unmount", "hide"];
export const EXECUTIONS = ["unmount", "hide", "unmount"];

// The heavy panel is the baseline's research panel: a root, a header and 49 chips of two nodes each, 100 native nodes.
export const PANEL_SHAPE = SHAPES.research;

// The player, a fixed rule over the snapshot (tests/frontier-soak-fixture.jsx): it never keeps more than this many units
// on the city tile, so the game's own state is bounded and what the heap judgement sees is the runtime and not a growing army.
export const GARRISON_CAP = 6;
// The scenario's start tile, where the Settler and the Warrior stand: the one fact about the map the player does not read from
// the snapshot (the snapshot shows a tile only once it is selected).
export const START_TILE = {x: 6, y: 8};

// The turn on whose end_turn the game is paused, and for how many frames (the job must not move for any of them).
export const PAUSE_TURN = 50;
export const PAUSE_FRAMES = 60;

// The rule for the resident memory, which moves by tens of MB and cannot be an exact limit (GF-30 saw 90 to 188 MB): the median
// of the last half of the steady turns, less the median of the first half, in KB. It is a coarse guard that must not depend on a runner's
// noise (within a run the resident memory spans 43 to 110 MB and the largest half-to-half rise seen was +10.1 MB); a leak of about
// 1 MiB a turn over the 49 turns between the medians would still cross it, and finer leaks belong to the heap rule.
export const RSS_GROWTH_LIMIT_KB = 48 * 1024;

// The HUD in the 800x600 root. The probe clicks the center of a button; the claim point is inside the heavy panel.
export const VIEWPORT = [800, 600];
export const PANEL_TOGGLE = {left: 20, top: 36, width: 120, height: 28};
export const PAUSE_TOGGLE = {left: 160, top: 36, width: 120, height: 28};
export const PANEL_REGION = {left: 12, top: 72, width: 440};
export const CLAIM_POINT = {x: 230, y: 300};
// An action button of the bar: the i-th is at left + step * i.
export const ACTION_BAR = {left: 12, top: 552, step: 150, width: 140, height: 32};

// The contexts the player visits (docs/research/frontier-game.md): the seven of the game.
export const CONTEXTS = ["none", "tile", "settler", "warrior", "stack", "city", "dialog"];
