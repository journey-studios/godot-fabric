// The experiment, as plain data: the fixture runs a native decay in one box per
// run, and the oracle derives what each run must show from the same numbers with
// its own formulas. Neither side reads the other's results here.

// One box, and so one value and one decay, per run. The first four runs are
// Godot's pacing patterns at the fallback rate, then the same 144 Hz loop on a
// screen that reports 144 Hz and on one that reports nothing, and last the
// pipelined frames of a V-Sync window presented (Presentation pacing) and, for
// contrast, timed (Time pacing).
export const BOXES = ["paced-60", "headless", "fast", "bursts", "display-144", "fallback-144", "presentation-bimodal", "time-bimodal"];

// RN's decay as the Animated slice runs it. The value moves along x, so the
// Control's x is the box's rest x plus the value.
export const DECAY = {from: 0, velocity: 0.5, deceleration: 0.99};

// The refresh rate the simulated screen reports in the display lane, and the rate
// the clock falls back to when the display reports none.
export const DISPLAY_RATE = 144;
export const FALLBACK_RATE = 60;
