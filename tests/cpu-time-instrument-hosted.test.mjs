import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {TARGETS_MS, expectedBlocks, loadInclusion} from "./cpu-time-instrument-oracle.mjs";

// The hosted runs of the CPU-time instrument's headless suite, replayed through the oracle's inclusion rule: tests/fixtures/cpu-time-instrument-hosted/load-blocks.json
// holds, for each of the 20 `native-cpu-time-instrument` artifacts that GitHub still served on 2026-10-13 (the Contracts workflow, job native-suites-frontier, on
// macos-15), the columns of the four load blocks (all of their frames, the settle ones too) that the rule reads: the busy loop of each frame as the engine's clock
// measured it, the process term as microseconds past that loop, and the engine's own TIME_PROCESS reading at the frame's start (the number the retained
// `reads-monitor` sabotage puts in the term). The burn and the monitor are run-length encoded, [value, frames]. `reportSha256` is the hash of the artifact's
// report, so that a re-download can be checked against what was extracted. Two of the runs failed the retired rule (the process term takes at least 8 values and
// repeats at most 10 frames in a row) and passed on a rerun with the same code: their runner was quiet, which makes a clock repeat itself.
const root = fileURLToPath(new URL("..", import.meta.url));
const {runs} = JSON.parse(readFileSync(`${root}tests/fixtures/cpu-time-instrument-hosted/load-blocks.json`, "utf8"));
const loadBlocks = expectedBlocks(false).filter(block => block.kind === "load");
const FRAMES = loadBlocks[0].end - loadBlocks[0].first;
const label = run => `run ${run.run}${run.attempt === null ? "" : `, attempt ${run.attempt}`}`;
const expand = pairs => pairs.flatMap(([value, count]) => Array.from({length: count}, () => value));

// What the oracle's rule takes of a report: the four load blocks one after the other, as the schedule places them with the other blocks left out. `reads`
// is what the instrument takes for the process term: its clock (as the hosted run did) or the engine's monitor (the sabotage).
function loadFrames(run, reads = "clock") {
  const columns = {burnUsec: [], processMs: []};
  const blocks = TARGETS_MS.map((target, index) => {
    const block = run.blocks[target];
    const burn = expand(block.burnUsec);
    const monitor = expand(block.monitorUs);
    columns.burnUsec.push(...burn);
    columns.processMs.push(...(reads === "clock" ? block.excessUs.map((excess, frame) => (burn[frame] + excess) / 1000) : monitor.map(us => us / 1000)));
    return {...loadBlocks[index], first: index * FRAMES, end: (index + 1) * FRAMES};
  });
  return {frames: columns, blocks};
}
const inclusionOf = (run, reads) => {
  const {frames, blocks} = loadFrames(run, reads);
  return loadInclusion(frames, blocks);
};

// The retired rule, as the probe and the oracle had it: over the measured frames of a block, at least 8 distinct values and no more than 10 equal in a row.
function retiredRuleRefuses(run) {
  const {frames, blocks} = loadFrames(run);
  return blocks.some(block => {
    const terms = frames.processMs.slice(block.first + block.settle, block.end);
    let longest = 0;
    let current = 0;
    terms.forEach((term, index) => {
      current = index > 0 && term === terms[index - 1] ? current + 1 : 1;
      longest = Math.max(longest, current);
    });
    return new Set(terms).size < 8 || longest > 10;
  });
}

test("The fixture is the load blocks of the hosted runs it names", () => {
  assert.equal(runs.length, 20);
  assert.equal(new Set(runs.map(run => `${run.run}/${run.attempt}`)).size, runs.length, "no run twice");
  assert.equal(new Set(runs.map(run => run.artifact)).size, runs.length, "an artifact each");
  for (const run of runs) {
    assert.match(run.reportSha256, /^[0-9a-f]{64}$/, label(run));
    assert.match(run.headSha, /^[0-9a-f]{40}$/, label(run));
    for (const target of TARGETS_MS) {
      const block = run.blocks[target];
      assert.equal(expand(block.burnUsec).length, FRAMES, `${label(run)}: the ${target} ms block has the settle and the measured frames of the schedule`);
      assert.equal(expand(block.monitorUs).length, FRAMES);
      assert.equal(block.excessUs.length, FRAMES);
    }
  }
  const failed = runs.filter(run => run.hosted === "failed");
  assert.deepEqual(failed.map(label), ["run 38403991586, attempt 1", "run 38473856206, attempt 1"]);
  for (const run of failed) {
    assert.deepEqual(run.failedChecks, ["cpu/The process term changes from frame to frame in the load blocks, as a clock does and a monitor refreshed once a second does not"]);
  }
  assert.equal(runs.filter(run => run.hosted === "passed").length, 18);
});

test("The retired rule refused exactly the two hosted runs that failed it, though their clock was a genuine one", () => {
  for (const run of runs) {
    assert.equal(retiredRuleRefuses(run), run.hosted === "failed", label(run));
  }
  // The block where it happened: the 10 ms load, most of whose frames are the loop plus one microsecond.
  for (const run of runs.filter(each => each.hosted === "failed")) {
    const burn = expand(run.blocks[10].burnUsec);
    const terms = run.blocks[10].excessUs.map((excess, frame) => burn[frame] + excess).slice(10);
    const counts = new Map();
    for (const term of terms) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    const modal = Math.max(...counts.values());
    assert.ok(modal >= 0.3 * terms.length, `${label(run)}: ${modal} of ${terms.length} frames are one value`);
  }
});

test("The inclusion rule accepts every hosted run, the two that the retired rule refused among them: a clock never reads less than the loop it spans", () => {
  for (const run of runs) {
    for (const [target, row] of Object.entries(inclusionOf(run, "clock"))) {
      assert.equal(row.frames, FRAMES, `${label(run)}, ${target} ms`);
      assert.equal(row.shorterThanTheLoad, 0, `${label(run)}, ${target} ms: no frame is shorter than its loop`);
      assert.ok(row.shortestMarginUs >= 0, `${label(run)}, ${target} ms: the shortest margin is ${row.shortestMarginUs} us`);
    }
  }
});

test("The monitor's reading of each hosted run, put in the term as the reads-monitor sabotage does, is refused in all four load blocks", () => {
  for (const run of runs) {
    for (const [target, row] of Object.entries(inclusionOf(run, "monitor"))) {
      assert.ok(row.shorterThanTheLoad > 0, `${label(run)}, ${target} ms: the monitor is under the loop in ${row.shorterThanTheLoad} frames`);
      assert.ok(row.shortestMarginUs < 0);
    }
    // The first frame of a block is the cause, and no refresh can hide it: the value it reads was set before the load began, and the blocks run in
    // increasing loads, so the second before holds a shorter one.
    for (const target of TARGETS_MS) {
      assert.ok(expand(run.blocks[target].monitorUs)[0] < expand(run.blocks[target].burnUsec)[0], `${label(run)}, ${target} ms: the first frame reads the second before`);
    }
  }
});

// A monitor, as the engine makes it: it shows the largest process term of the frames since its last refresh, and it is refreshed every `period` frames, `phase` frames
// after the block began. The value it holds when the block begins is the idle second's, which is why the loads rise in a schedule that starts from idle.
function staircase(terms, period, phase, idleUsec) {
  const monitor = [];
  let held = idleUsec;
  let largest = idleUsec;
  terms.forEach((term, frame) => {
    monitor.push(held);
    largest = Math.max(largest, term);
    if ((frame + 1 - phase) % period === 0 && frame + 1 >= phase) {
      held = largest;
      largest = 0;
    }
  });
  return monitor;
}

test("A series refreshed once a second is refused wherever in the block the refresh falls, and at any pace", () => {
  const [run] = runs.filter(each => each.hosted === "failed").slice(-1);
  for (const period of [37, 100, 150]) {
    for (let phase = 0; phase < period; ++phase) {
      const frames = {burnUsec: [], processMs: []};
      const blocks = TARGETS_MS.map((target, index) => {
        const burn = expand(run.blocks[target].burnUsec);
        const terms = run.blocks[target].excessUs.map((excess, frame) => burn[frame] + excess);
        frames.burnUsec.push(...burn);
        frames.processMs.push(...staircase(terms, period, phase, 160).map(us => us / 1000));
        return {...loadBlocks[index], first: index * FRAMES, end: (index + 1) * FRAMES};
      });
      for (const [target, row] of Object.entries(loadInclusion(frames, blocks))) {
        assert.ok(row.shorterThanTheLoad > 0, `a refresh every ${period} frames, the first after ${phase}: the ${target} ms block`);
      }
    }
  }
});
