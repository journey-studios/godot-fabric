import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, rmSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES} from "../tests/frontier-turn-sabotages.mjs";
import {treeDigest} from "./frontier-turn-lane.mjs";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of the turn measured on the Frontier game as a consumer has it (V05-06, criterion `turno`), which tests/frontier-turn-sabotages.mjs lists once: what
// each breaks, where and which rules of the oracle must reject it. Each breaks one thing on purpose, runs the headless lane on it (tests/frontier-turn-native.test.mjs
// --sabotage=<name>) and requires both the probe's checks and the independent oracle to reject the report, the oracle for the rule the variant was written for. The template
// (consumers/civ-lite) is never edited: the variants of the provisioned copy are made by the lane in the project it throws away, and the probe's own variants are swapped in
// and out through scripts/sabotage-sources.mjs (restored byte for byte, proven by hash, whatever ends the run). The tree of the template is hashed before and after and must
// be the same.
//
// A variant counts as rejected only if its verdict exists: the file of the result is deleted before the variant runs, and a missing file (a run that died before judging) is a
// variant that was not rejected. A last run of the genuine source writes build/frontier-turn-comparison.json with the verdicts beside it. Do not run another suite in the
// worktree meanwhile (a variant swaps the probe). Run with:
//   node scripts/frontier-turn-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const test = "tests/frontier-turn-native.test.mjs";
const digest = content => createHash("sha256").update(content).digest("hex");
const swapped = SABOTAGES.filter(variant => variant.target === "probe");
const guard = guardSources(root, [...new Set(swapped.map(variant => variant.file))]);
const receipt = {format: "godot-fabric.frontier-turn-sabotage/v1", sourceSha256: {genuine: guard.genuine}, variants: []};
const verdictFile = name => path.join(root, `build/frontier-turn-sabotage-${name}-verdict.json`);
const reportFile = name => path.join(root, `build/frontier-turn-sabotage-${name}-report.json`);
const template = path.join(root, "consumers", "civ-lite");

// The probe with the variant's edit made, in exactly one place (the guard refuses any other); the variants of the provisioned copy are made by the lane.
const broken = variant => variant.target === "probe" ? guard.sabotaged(variant) : null;
for (const variant of SABOTAGES) {
  broken(variant);
}

const templateBefore = await treeDigest(template);
receipt.templateSha256 = {before: templateBefore};
try {
  for (const variant of SABOTAGES) {
    rmSync(verdictFile(variant.name), {force: true});
    rmSync(reportFile(variant.name), {force: true});
    const source = broken(variant);
    const entry = {name: variant.name, target: variant.target, where: variant.target === "probe" ? variant.file : `the provisioned copy of ${variant.file}`,
      breaks: variant.breaks, find: variant.find, replace: variant.replace, sourceSha256: source === null ? null : digest(source)};
    try {
      if (source !== null) {
        guard.swap(variant.file, source);
      }
      const result = await guard.run(process.execPath, [test, `--sabotage=${variant.name}`]);
      writeFileSync(path.join(root, `build/frontier-turn-sabotage-${variant.name}-run.log`), result.stdout + result.stderr);
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
    entry.oracleRules = verdict?.oracleRules ?? null;
    entry.expectedRules = variant.rules;
    entry.rejected = entry.runStatus === 0 && verdict !== null && verdict.probeFailures.length > 0 && variant.rules.every(rule => verdict.oracleRules.includes(rule));
    receipt.variants.push(entry);
  }
} finally {
  receipt.sourceSha256.restored = guard.restore();
}
assert.deepEqual(receipt.sourceSha256.restored, receipt.sourceSha256.genuine, "Every source is back byte for byte");
receipt.templateSha256.after = await treeDigest(template);
assert.equal(receipt.templateSha256.after, templateBefore, "The template was never touched: its tree is the same before and after");
// The genuine source once more: the suite writes the comparison with the verdicts of the variants beside it.
const genuine = await guard.run(process.execPath, [test]);
writeFileSync(path.join(root, "build/frontier-turn-sabotage-current-run.log"), genuine.stdout + genuine.stderr);
receipt.genuineRunStatus = genuine.status;
writeFileSync(path.join(root, "build/frontier-turn-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.rejected, true, `The ${entry.name} variant must be rejected by the probe and the oracle: build/frontier-turn-sabotage-${entry.name}-run.log`);
}
assert.equal(receipt.genuineRunStatus, 0, "The genuine source passes: build/frontier-turn-sabotage-current-run.log");
console.log(JSON.stringify(receipt, null, 2));
