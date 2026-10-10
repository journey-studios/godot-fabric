import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, rmSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES as variants} from "../tests/cpu-time-instrument-sabotages.mjs";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of the CPU-time instrument. Each breaks one source on purpose, runs the headless suite on it
// (tests/cpu-time-instrument-native.test.mjs --sabotage=<name>) and requires the probe's checks and the independent oracle to reject the report. The slice
// changes no C++, so no host is rebuilt: the sources are the instrument and the probe, and they come back byte for byte, proven by hash, whatever ends the
// run (scripts/sabotage-sources.mjs).
//
//  reads-interval      the instrument takes the interval between the starts of two process frames for the frame's process time, which is what a frame
//                      counter or a frame-delta reading gives: it holds the sleeps of the loop and, with the vsync on, the wait for the display. The CPU
//                      rule (the idle total against the idle interval) accuses it first, and the 10% rule accuses the loads it cannot see, since the
//                      loop's own sleep hides a 2 or 5 ms load in an interval of 6.9 ms.
//  load-outside-frame  the busy loop runs from a process_frame handler connected before the instrument's, so it ends before the instrument's clock starts: the
//                      load is outside the measured frame, the engine's clock says it ran, and the 10% rule says the instrument does not see it.
//  reads-monitor       the instrument takes Performance.TIME_PROCESS for the frame's process time. The engine refreshes that monitor once a second with the
//                      largest process time of the second, so the term repeats for a hundred frames: the rule that the process term changes from frame to
//                      frame accuses it, and the idle total, which would be the second's largest idle frame, and the loads that begin inside a second do not
//                      read right.
//
// A variant counts as rejected only if its verdict exists: the file of the result is deleted before the variant runs, and a missing file (a run that died
// before judging) is a variant that was not rejected. A last run of the genuine source writes build/cpu-time-instrument-comparison.json with the verdicts
// beside it. Do not run another suite in the worktree meanwhile. Run with:
//   node scripts/cpu-time-instrument-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const test = "tests/cpu-time-instrument-native.test.mjs";
const digest = content => createHash("sha256").update(content).digest("hex");
const files = [...new Set(variants.map(variant => variant.file))];
const guard = guardSources(root, files);
const receipt = {format: "godot-fabric.cpu-time-instrument-sabotage/v1", sourceSha256: {genuine: guard.genuine}, variants: []};
const verdictFile = name => path.join(root, `build/cpu-time-instrument-sabotage-${name}-verdict.json`);
const reportFile = name => path.join(root, `build/cpu-time-instrument-sabotage-${name}-report.json`);

// The source of a variant with its edits made. The first goes through the guard (which refuses a place that is not unique); the others are checked the same
// way against the text the first left.
function broken(variant) {
  const [first, ...rest] = variant.edits;
  let text = guard.sabotaged({name: variant.name, file: variant.file, ...first});
  for (const {find, replace} of rest) {
    assert.equal(text.split(find).length, 2, `The ${variant.name} sabotage must replace exactly one place in ${variant.file}: ${find}`);
    text = text.replace(find, () => replace);
  }
  return text;
}
for (const variant of variants) {
  broken(variant);
}

try {
  for (const variant of variants) {
    rmSync(verdictFile(variant.name), {force: true});
    rmSync(reportFile(variant.name), {force: true});
    const source = broken(variant);
    const entry = {name: variant.name, file: variant.file, edits: variant.edits, sourceSha256: digest(source)};
    try {
      guard.swap(variant.file, source);
      const result = await guard.run(process.execPath, [test, `--sabotage=${variant.name}`]);
      writeFileSync(path.join(root, `build/cpu-time-instrument-sabotage-${variant.name}-run.log`), result.stdout + result.stderr);
      entry.runStatus = result.status;
    } finally {
      guard.restore();
    }
    let verdict = null;
    try {
      verdict = JSON.parse(readFileSync(verdictFile(variant.name), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    entry.verdictPresent = verdict !== null;
    entry.probeFailures = verdict?.probeFailures ?? null;
    entry.oracleRejection = verdict?.oracleRejection ?? null;
    entry.rejected = entry.runStatus === 0 && verdict !== null && verdict.probeFailures.length > 0 && verdict.oracleRejection !== null;
    receipt.variants.push(entry);
  }
} finally {
  receipt.sourceSha256.restored = guard.restore();
}
assert.deepEqual(receipt.sourceSha256.restored, receipt.sourceSha256.genuine, "Every source is back byte for byte");
// The genuine source once more: the suite writes the comparison with the verdicts of the variants beside it.
const genuine = await guard.run(process.execPath, [test]);
writeFileSync(path.join(root, "build/cpu-time-instrument-sabotage-current-run.log"), genuine.stdout + genuine.stderr);
receipt.genuineRunStatus = genuine.status;
writeFileSync(path.join(root, "build/cpu-time-instrument-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.rejected, true, `The ${entry.name} variant must be rejected by the probe and the oracle: build/cpu-time-instrument-sabotage-${entry.name}-run.log`);
}
assert.equal(receipt.genuineRunStatus, 0, "The genuine source passes: build/cpu-time-instrument-sabotage-current-run.log");
console.log(JSON.stringify(receipt, null, 2));
