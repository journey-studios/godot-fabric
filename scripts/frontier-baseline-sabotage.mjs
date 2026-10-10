import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, rmSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES as variants} from "../tests/frontier-baseline-sabotages.mjs";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of the performance baseline. Each breaks one source on purpose, runs the headless suite on it
// (tests/frontier-baseline-native.test.mjs --sabotage=<name>, which bundles the broken source) and requires the probe's checks and the
// independent oracle to reject the report. The slice changes no C++, so no host is rebuilt: the sources are the HUD's fixture and the
// shared sampler, and they come back byte for byte, proven by hash, whatever ends the run (scripts/sabotage-sources.mjs).
//
//  leaky-panel  the swap keeps every panel it has shown mounted and makes the ones it replaced invisible (opacity 0), so a panel that was
//               replaced is still there: the nodes the SceneTree and the host hold are not the base's plus the new panel's, and the
//               deletes do not match the old panel. The invariants on nodes, views and deletes reject it. (With display "none"
//               the host mounts no view at all for the hidden panel, so that would not leak a node.)
//  no-gc        the sampler never asks for the forced collection of Hermes' heap before a reading, so the heap readings are not
//               comparable. The reading does not carry the mark of a collection, and the oracle's check on the reading and the
//               probe's check on the heap both reject it.
//  world-leak   the buttons of the bar get pointerEvents="none": the click is not theirs, it goes through to the Godot world and no panel
//               changes. The world hears it, the panel does not show, and the run stops at the first click.
//  no-key       the panel is rendered without its key, so React reuses the nodes of the panel it replaces and updates them instead of
//               mounting a new one: the nodes after the swap may still be the new panel's, but the swap no longer creates the new panel's
//               nodes and deletes the old one's. The invariant on creations and deletions rejects it.
//
// A variant counts as rejected only if its verdict exists: the file of the result is deleted before the variant runs, and a missing
// file (a run that died before judging) is a variant that was not rejected. A last run of the genuine source writes
// build/frontier-baseline-comparison.json with the verdicts beside it. Do not run another suite in the worktree meanwhile. Run with:
//   node scripts/frontier-baseline-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const test = "tests/frontier-baseline-native.test.mjs";
const digest = content => createHash("sha256").update(content).digest("hex");
const files = [...new Set(variants.map(variant => variant.file))];
const guard = guardSources(root, files);
const receipt = {format: "godot-fabric.frontier-baseline-sabotage/v1", sourceSha256: {genuine: guard.genuine}, variants: []};
const verdictFile = name => path.join(root, `build/frontier-baseline-sabotage-${name}-verdict.json`);
const reportFile = name => path.join(root, `build/frontier-baseline-sabotage-${name}-report.json`);

// The source of a variant with its edits made. The first goes through the guard (which refuses a place that is not unique); the others
// are checked the same way against the text the first left.
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
      writeFileSync(path.join(root, `build/frontier-baseline-sabotage-${variant.name}-run.log`), result.stdout + result.stderr);
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
writeFileSync(path.join(root, "build/frontier-baseline-sabotage-current-run.log"), genuine.stdout + genuine.stderr);
receipt.genuineRunStatus = genuine.status;
writeFileSync(path.join(root, "build/frontier-baseline-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.rejected, true, `The ${entry.name} variant must be rejected by the probe and the oracle: build/frontier-baseline-sabotage-${entry.name}-run.log`);
}
assert.equal(receipt.genuineRunStatus, 0, "The genuine source passes: build/frontier-baseline-sabotage-current-run.log");
console.log(JSON.stringify(receipt, null, 2));
