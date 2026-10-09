import {ROUNDS, WARMUP_ROUNDS} from "./frontier-baseline-cases.mjs";

// Series of the live heap at rest (Hermes' allocated bytes after a forced collection and 30 idle frames, one per round: 2 warm-up and 30 steady)
// for the tests of how the heap at rest is judged (tests/frontier-baseline-heap.test.mjs for the oracle, tests/frontier-baseline-native.test.mjs
// for the probe's replay in Godot). They are numbers, not a report: nothing here depends on a machine.

// The two processes of the hosted run of PR #77 (job native-cold-start, run 37868943054), on a GitHub macOS runner. They move between four levels,
// 2,031,680 to 2,034,056 bytes, a band of 2,376 bytes that is wider than the 2,048 limit; with windows of five steady rounds the floors of process 2
// were 2,031,680 and 2,033,736, 2,056 bytes apart, and the check failed on a run that had no trend at all.
export const HOSTED_HEAP_AT_REST = {
  "process 1": [2033736, 2033736, 2033736, 2033736, 2034056, 2033736, 2034056, 2032000, 2033736, 2034056, 2034056, 2034056, 2032000, 2034056, 2034056, 2034056,
    2034056, 2033736, 2034056, 2034056, 2033736, 2033736, 2033736, 2034056, 2031680, 2034056, 2034056, 2034056, 2034056, 2032000, 2034056, 2032000],
  "process 2": [2034056, 2033736, 2034056, 2034056, 2034056, 2034056, 2031680, 2033736, 2033736, 2034056, 2033736, 2031680, 2033736, 2033736, 2034056, 2033736,
    2031680, 2032000, 2033736, 2032000, 2034056, 2033736, 2033736, 2034056, 2034056, 2034056, 2033736, 2033736, 2034056, 2033736, 2034056, 2033736],
};

// A series whose first half alone dips to the low level (2,031,680 and 2,032,000 bytes, five readings of fifteen) and whose last half never does:
// the floors of the halves are 2,056 bytes apart, 8 over the limit, which a gate on floors would call a leak (it was the flake of that gate), and the
// medians of the halves are the same.
export const FIRST_HALF_DIPS = [2034056, 2034056,
  2034056, 2031680, 2034056, 2033736, 2034056, 2032000, 2034056, 2034056, 2033736, 2031680, 2034056, 2034056, 2033736, 2034056, 2034056,
  2033736, 2034056, 2034056, 2033736, 2034056, 2034056, 2033736, 2034056, 2034056, 2033736, 2034056, 2033736, 2034056, 2034056, 2034056];

// A heap that does not move, with the last rounds raised by a number of bytes (the last half, or one round), to show where the limit is.
export const FLAT_HEAP_BYTES = 2032000;
export const flatSeries = (rise = 0, lastRounds = 0) => Array.from({length: WARMUP_ROUNDS + ROUNDS},
  (_, round) => FLAT_HEAP_BYTES + (round >= WARMUP_ROUNDS + ROUNDS - lastRounds ? rise : 0));

// A leak of this many bytes every steady round on top of a series, and the one the tests use: it crosses the limit on both hosted series (the
// smallest leaks that do are 158 and 113 bytes a round).
export const LEAK_BYTES_PER_ROUND = 200;
export const withLeak = (series, bytesPerRound) => series.map((heap, round) => heap + bytesPerRound * Math.max(0, round - WARMUP_ROUNDS));
