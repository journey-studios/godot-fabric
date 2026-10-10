import assert from "node:assert/strict";
import test from "node:test";
import {HEAP_STEADY_GROWTH_LIMIT_BYTES} from "./performance-cases.mjs";
import {ROUNDS, WARMUP_ROUNDS} from "./frontier-baseline-cases.mjs";
import {FIRST_HALF_DIPS, FLAT_HEAP_BYTES, HOSTED_HEAP_AT_REST, LEAK_BYTES_PER_ROUND, flatSeries, withLeak} from "./frontier-baseline-heap-series.mjs";
import {heapAtRest} from "./frontier-baseline-oracle.mjs";

// How the oracle judges the live heap at rest, on series of numbers (no Godot, no report): the median of the last half of the steady rounds against the
// median of the first, against the GF-30 limit, inclusive. The two series of the hosted run of PR #77 carry no trend and must pass; a leak must not.
const restsOf = series => series.map(heap => ({reading: {performance: {hermes: {heap: {hermes_allocatedBytes: heap}}}}}));
const growthOf = series => heapAtRest(restsOf(series)).growth;
const rejects = series => {
  try {
    heapAtRest(restsOf(series));
  } catch (error) {
    return String(error.message);
  }
  return null;
};
const hosted = Object.entries(HOSTED_HEAP_AT_REST);
const smallestLeak = series => {
  for (let bytes = 0; bytes <= 400; ++bytes) {
    if (rejects(withLeak(series, bytes)) !== null) {
      return bytes;
    }
  }
  return null;
};

// The two judgements this one replaces, to show what they did to the hosted run: the floor of the first five steady rounds against the last five (it
// failed process 2 by 8 bytes) and the floors of the two halves (4 processes in 100 would fail it on noise alone).
const floorOfFives = series => {
  const steady = series.slice(WARMUP_ROUNDS);
  return Math.min(...steady.slice(-5)) - Math.min(...steady.slice(0, 5));
};
const floorOfHalves = series => {
  const steady = series.slice(WARMUP_ROUNDS);
  const half = Math.floor(steady.length / 2);
  return Math.min(...steady.slice(steady.length - half)) - Math.min(...steady.slice(0, half));
};

test("the hosted series are 32 readings that move in a band wider than the limit, with no trend", () => {
  for (const [name, series] of hosted) {
    assert.equal(series.length, WARMUP_ROUNDS + ROUNDS, name);
    const band = Math.max(...series) - Math.min(...series);
    assert.equal(band, 2376, `${name}: four levels from 2,031,680 to 2,034,056`);
    assert.ok(band > HEAP_STEADY_GROWTH_LIMIT_BYTES, `${name}: the noise band is wider than the limit`);
  }
});

test("the hosted series pass with a growth of 0: the median of the last half is the median of the first", () => {
  const medians = {"process 1": 2034056, "process 2": 2033736};
  for (const [name, series] of hosted) {
    const heap = heapAtRest(restsOf(series));
    assert.equal(heap.halfRounds, 15, `${name}: 15 rounds a half of 30`);
    assert.deepEqual([heap.firstMedian, heap.lastMedian, heap.growth], [medians[name], medians[name], 0], name);
    assert.equal(rejects(series), null, name);
  }
});

test("the floors judged the hosted run wrongly: five-round floors failed process 2 by 8 bytes, the floors of the halves are 320 apart in both", () => {
  assert.equal(floorOfFives(HOSTED_HEAP_AT_REST["process 2"]), 2056);
  assert.ok(floorOfFives(HOSTED_HEAP_AT_REST["process 2"]) > HEAP_STEADY_GROWTH_LIMIT_BYTES);
  assert.equal(floorOfHalves(HOSTED_HEAP_AT_REST["process 1"]), -320);
  assert.equal(floorOfHalves(HOSTED_HEAP_AT_REST["process 2"]), 320);
  assert.equal(growthOf(HOSTED_HEAP_AT_REST["process 2"]), 0);
});

test("a first half that alone dips to the low level, with a last half that never does, is not a leak (it was the flake of the floors)", () => {
  assert.equal(FIRST_HALF_DIPS.length, WARMUP_ROUNDS + ROUNDS);
  assert.equal(floorOfHalves(FIRST_HALF_DIPS), 2056, "the floors of the halves are 8 bytes over the limit");
  assert.ok(floorOfHalves(FIRST_HALF_DIPS) > HEAP_STEADY_GROWTH_LIMIT_BYTES, "and would call it a leak");
  const heap = heapAtRest(restsOf(FIRST_HALF_DIPS));
  assert.deepEqual([heap.firstMedian, heap.lastMedian, heap.growth], [2034056, 2034056, 0]);
  assert.equal(rejects(FIRST_HALF_DIPS), null, "the medians are the same and it passes");
});

test("a leak on top of either hosted series is rejected", () => {
  assert.deepEqual(hosted.map(([, series]) => growthOf(series)), [0, 0]);
  for (const [name, series] of hosted) {
    const message = rejects(withLeak(series, LEAK_BYTES_PER_ROUND));
    assert.match(message ?? "", /The live heap at rest rose \d+ bytes from the median of the first half \(15 rounds\)/, `${name}: +${LEAK_BYTES_PER_ROUND} bytes a round is a leak`);
  }
});

test("the leak the medians catch: 158 and 113 bytes a round on the hosted series, 137 on a heap with no noise", () => {
  assert.equal(smallestLeak(flatSeries()), 137, "a heap with no noise: 15 rounds apart, 15 L over 2,048 from L = 137");
  assert.equal(smallestLeak(HOSTED_HEAP_AT_REST["process 1"]), 158);
  assert.equal(smallestLeak(HOSTED_HEAP_AT_REST["process 2"]), 113);
  assert.ok(smallestLeak(HOSTED_HEAP_AT_REST["process 1"]) < LEAK_BYTES_PER_ROUND && smallestLeak(HOSTED_HEAP_AT_REST["process 2"]) < LEAK_BYTES_PER_ROUND,
    "the leak of the tests is over both");
});

test("the limit is the GF-30 limit and it is inclusive", () => {
  assert.equal(HEAP_STEADY_GROWTH_LIMIT_BYTES, 2048);
  const half = ROUNDS / 2;
  assert.equal(growthOf(flatSeries(2048, half)), 2048);
  assert.equal(rejects(flatSeries(2048, half)), null, "exactly the limit passes");
  assert.match(rejects(flatSeries(2049, half)) ?? "", /rose 2049 bytes/, "one byte more fails");
  assert.match(rejects(flatSeries(3000, half)) ?? "", /rose 3000 bytes/, "a rise of 3,000 bytes fails");
});

test("a transient in the last round is not growth", () => {
  assert.equal(growthOf(flatSeries(2056, 1)), 0);
  assert.equal(rejects(flatSeries(2056, 1)), null, "one reading 2,056 bytes up, even the last one, passes");
  assert.equal(rejects(flatSeries(2056, 3)), null, "and so do three of them");
});

test("an odd number of steady rounds leaves the one between the halves out, and an even one takes the lower median", () => {
  const odd = restsOf([...flatSeries(), FLAT_HEAP_BYTES]);
  odd[WARMUP_ROUNDS + 15].reading.performance.hermes.heap.hermes_allocatedBytes += 5000;
  assert.equal(heapAtRest(odd).halfRounds, 15, "31 steady rounds make halves of floor(31/2) = 15");
  assert.equal(heapAtRest(odd).growth, 0, "and the one in the middle belongs to neither");
  // 32 steady rounds: halves of 16, whose median by nearest rank is the 8th of 16 (the lower one). The last half has eight readings of the base and eight
  // of the base plus 4,000: the lower median is the base, the upper would be 4,000 over it.
  const even = [...flatSeries(), FLAT_HEAP_BYTES, FLAT_HEAP_BYTES];
  for (let round = even.length - 8; round < even.length; ++round) {
    even[round] += 4000;
  }
  assert.equal(heapAtRest(restsOf(even)).halfRounds, 16);
  assert.equal(growthOf(even), 0, "the lower median of the last half is the base");
});

test("a run without two halves, or without a heap, is refused", () => {
  assert.throws(() => heapAtRest(restsOf([FLAT_HEAP_BYTES, FLAT_HEAP_BYTES, FLAT_HEAP_BYTES])), /fill two halves/);
  assert.throws(() => heapAtRest(restsOf(flatSeries().map(() => 0))), /The heap at rest is read/);
});
