// The experiment, as plain data: the fixture renders the HUD from these shapes, the probes click through the tour and the
// oracle derives what each swap must show from the same numbers with its own formulas. Neither side reads the other's
// results here. The HUD is the Frontier game's: a bar of panel buttons over the Godot map and, below it, one panel at a
// time.

// The panels, in the order of the bar. `empty` is the base: the HUD with no panel, whose native nodes every swap and every
// round has to come back to.
export const PANELS = ["units", "city", "research", "empty"];

// What each panel renders, as a HUD would: a root, a header Text, and chips (a View holding a Text) in a wrapping grid, and for
// the city one more View, its production bar. `empty` renders nothing.
export const SHAPES = {
  units: {chips: 24, footer: false},
  city: {chips: 36, footer: true},
  research: {chips: 49, footer: false},
  empty: null,
};

// The native nodes of each panel, as the Surface's snapshot counted them (nativeTags with the panel shown, less the base):
// 50, 75 and 100, the 50 to 100 nodes per swap that the milestone asks to measure. The oracle derives the same numbers from
// the shapes (a root, a header, two nodes a chip, the footer) and the report has to agree with both.
export const NATIVE_NODES = {units: 50, city: 75, research: 100, empty: 0};

// The base: the native nodes the Surface holds with `empty` shown, as the snapshot counted them: the root, the HUD's root, the
// bar, its four buttons and their four labels, and the region.
export const BASE_NATIVE_NODES = 12;

// The buttons of the bar, in the order of PANELS: a Pressable each, in the 800x600 root. The driver clicks the center of the one of the
// panel it swaps to.
export const TAB = {left: 20, top: 8, step: 120, width: 100, height: 28};

// One round of swaps visits every ordered pair of panels once (12 swaps, a closed walk that starts and ends at the base): each
// swap deletes the nodes of A and creates those of B, so the pairs span 0 to 175 nodes touched. A round returns to `empty`.
export const TOUR = ["empty", "units", "empty", "city", "empty", "research", "units", "city", "research", "city", "units", "research", "empty"];

// Rounds: the first WARMUP_ROUNDS warm the runtime up (the first mounts build Hermes' caches and the engine's font and theme
// state) and are left out of what is judged and summarized; the next ROUNDS are the steady state, 30 swaps for every ordered
// pair of panels.
export const WARMUP_ROUNDS = 2;
export const ROUNDS = 30;

// The frames the application has to do nothing before a swap is over, and the idle frames before the heap at rest is read
// at the end of a round (React lets go of the fibers of an unmounted panel in work it does a few frames after the commit).
export const STABLE_FRAMES = 6;
export const REST_FRAMES = 30;

// The live heap at rest is judged on windows of this many steady rounds: a reading can carry a transient allocation
// (2,056 bytes, in one to three consecutive rounds) that the next does not, and the lowest reading of a window leaves it out.
export const HEAP_WINDOW_ROUNDS = 5;

// The windowed lane (scripts/frontier-baseline-graphics.mjs): the processes of an execution, the frames of the idle window, and the
// size and rate of the window it draws in.
export const GRAPHICS_RUNS = 5;
export const IDLE_FRAMES = 600;
export const GRAPHICS_VIEWPORT = [800, 600];
