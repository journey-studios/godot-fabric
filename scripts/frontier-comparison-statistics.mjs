import { nearestRank, quartiles } from "../tests/performance-oracle.mjs";

// The statistics of the final comparison of the 0.5 Frontier (V05-10), as docs/research/frontier-comparison-protocol.json defines them under `statistics`. Pure functions of numbers: the
// numbers they need (the seed, the resamples, the level, the alpha) are arguments that the caller reads from the protocol, none is written here.
//
// Where the repository already computes a statistic, this module uses that one (tests/performance-oracle.mjs: `nearestRank` and the quartiles by nearest rank). The median of the protocol is
// not the oracle's: statistics.acrossRuns.center says "the mean of the two middle values when the number of values is even", while the oracle's `median` is the nearest rank (the lower of
// the two middle values for an even count), so `median` below is the protocol's own.

export { nearestRank };

export const ascending = (values) => [...values].sort((a, b) => a - b);

// The protocol's median of a run of numbers already sorted: the mean of the two middle values when their number is even.
function medianOfSorted(sorted) {
  const middle = sorted.length / 2;
  return sorted.length % 2 === 1 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// statistics.acrossRuns.center: the median of the per-run values.
export const median = (values) => medianOfSorted(ascending(values));

// statistics.acrossRuns.spread: the interquartile range by nearest rank, the ranks ceil(n / 4) and ceil(3 n / 4) of the sorted values. The oracle's quartiles take the nearest rank at 25 and 75,
// which are those two ranks, so its `iqr` is this one.
export const iqr = (values) => quartiles(values).iqr;

// statistics.interval.prng: mulberry32, whose step and first three draws for the seed 20261009 are in the protocol (`knownAnswer`).
export function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// statistics.interval: the difference of the medians of `minuend` and `subtrahend` for `resamples` resamples. The unit of resampling is the execution, resampled with replacement and
// independently within each arm, as many as the arm has (`unitOfResampling`); `stream`: one generator per interval, seeded with the seed, and for each resample the draws of the minuend arm
// and then the draws of the subtrahend arm, each draw being floor(u n).
export function bootstrapDifferences(minuend, subtrahend, { seed, resamples }) {
  const next = mulberry32(seed);
  const drawnMinuend = new Float64Array(minuend.length);
  const drawnSubtrahend = new Float64Array(subtrahend.length);
  const differences = [];
  for (let index = 0; index < resamples; index += 1) {
    for (let draw = 0; draw < drawnMinuend.length; draw += 1) {
      drawnMinuend[draw] = minuend[Math.floor(next() * minuend.length)];
    }
    for (let draw = 0; draw < drawnSubtrahend.length; draw += 1) {
      drawnSubtrahend[draw] = subtrahend[Math.floor(next() * subtrahend.length)];
    }
    differences.push(medianOfSorted(drawnMinuend.sort()) - medianOfSorted(drawnSubtrahend.sort()));
  }
  return differences;
}

// statistics.interval.bounds: the elements of rank round(R (1 - level) / 2) and R - that rank + 1 of the R sorted differences (250 and 9750 of 10,000 at the level 0.95), one-based.
export function intervalOf(differences, level) {
  const sorted = ascending(differences);
  const lowerRank = Math.round((sorted.length * (1 - level)) / 2);
  return [sorted[lowerRank - 1], sorted[sorted.length - lowerRank - 1]];
}

// statistics.multiplicity.procedure (Holm): sort the p-values; the k-th smallest (k from 1) stands when it is at most alpha / (m - k + 1) and every smaller one stood. Returns, for each
// p-value in the order given, whether it stands. Ties are taken in the order given.
export function holmStands(pValues, alpha) {
  const order = pValues.map((p, index) => [p, index]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const stands = pValues.map(() => false);
  for (let rank = 0; rank < order.length; rank += 1) {
    if (order[rank][0] > alpha / (order.length - rank)) {
      break;
    }
    stands[order[rank][1]] = true;
  }
  return stands;
}

// statistics.multiplicity.effect: the guard only downgrades. A category whose claim does not stand is reported as inconclusive; an inconclusive one stays so.
export const guarded = (categories, stands) => categories.map((category, index) => (stands[index] ? category : "inconclusive"));

// statistics.multiplicity.pValues: for a window, the smallest of three one-sided bootstrap p-values of the resampled differences `d` (oriented so that negative is better), with R the number
// of resamples: for a gain (1 + #{d >= -margin}) / (R + 1); for a cost (1 + #{d <= margin}) / (R + 1); for neutral the larger of (1 + #{d <= -margin}) / (R + 1) and
// (1 + #{d >= margin}) / (R + 1).
export function claimPValue(differences, margin) {
  const count = (predicate) => differences.filter(predicate).length;
  const total = differences.length + 1;
  const gain = (1 + count((d) => d >= -margin)) / total;
  const cost = (1 + count((d) => d <= margin)) / total;
  const neutral = Math.max((1 + count((d) => d <= -margin)) / total, (1 + count((d) => d >= margin)) / total);
  return Math.min(gain, cost, neutral);
}

// idleReference.rule: the run's idle reference is the median (nearest rank) of the half-sums of the consecutive pairs of the n per-frame values,
// median((x[i] + x[i+1]) / 2) for i from 0 to n - 2. The same function serves the two quantities the protocol names, the CPU time per frame and the elapsed intervals between process frames.
export function idleReference(values) {
  const halfSums = values.slice(1).map((value, index) => (values[index] + value) / 2);
  return nearestRank(halfSums, 50);
}

// statistics.acrossRuns for a list of per-run values: how many executions, the median and the interquartile range.
export const acrossRuns = (values) => ({ executions: values.length, median: median(values), iqr: iqr(values) });

// statistics.contrast and statistics.interval for two arms: the difference of the medians of their per-run values, its percentile bootstrap interval at the protocol's level, and the
// resampled differences (the Holm guard reads the p-values from them). `interval` is the protocol's statistics.interval.
export function contrastOf(minuend, subtrahend, interval) {
  const differences = bootstrapDifferences(minuend, subtrahend, interval);
  return { difference: median(minuend) - median(subtrahend), interval: intervalOf(differences, interval.level), differences };
}
