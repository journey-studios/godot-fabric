import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, rmSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of the 100-turn soak. Each breaks one source on purpose, runs the headless suite on it (tests/frontier-soak-native.test.mjs
// --sabotage=<name>, which bundles the broken source) and requires the probe's checks and the independent oracle to reject the run, the oracle for the
// reason the variant was written for. The slice changes no C++, so no host is rebuilt: the sources are the fixture and the probe, and they come back
// byte for byte, proven by hash, whatever ends the run (scripts/sabotage-sources.mjs).
//
//  listener-leak            the fixture connects to frontier.snapshot again at the end of every turn and never removes the connection. The registry
//                           holds one more subscription every turn, every publication sends one more event, and the heap at rest grows. The probe's
//                           check of the subscriptions and the oracle's (and, as the connections add up, the heap's) reject it.
//  nondeterministic-player  the player skips the production decision of a turn at random (Math.random), so what it decides is no longer a function of the
//                           snapshot. Each run is a game of its own (a legal one, which the oracle accepts alone), and two runs have different hashes:
//                           the oracle's comparison of the executions rejects it. The probe, which sees one run, cannot, and does not claim to.
//  pause-kills-ui           the HUD's layer pauses with the game (PROCESS_MODE_PAUSABLE instead of ALWAYS): the Surface hears no pointer while the tree
//                           is paused, the click does not reach the handler and the marker never mounts. The probe's pause checks and the oracle's reject it.
//  leaky-hide               the strategy that keeps the panel mounted hides it with display "none" instead of opacity 0: on this host a View with
//                           display "none" mounts no native node, so the "hidden" panel is really unmounted and the table of the decision (a hidden panel
//                           holds its 100 nodes) would be false. The probe's check of the panel and the oracle's count of the HUD's native views reject it.
//
// A variant counts as rejected only if its verdict exists: the file of the result is deleted before the variant runs, and a missing file (a run that
// died before judging) is a variant that was not rejected. A last run of the genuine source writes build/frontier-soak-comparison.json with the verdicts
// beside it (about four minutes). Do not run another suite in the worktree meanwhile. Run with:
//   node scripts/frontier-soak-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const test = "tests/frontier-soak-native.test.mjs";
const fixture = "tests/frontier-soak-fixture.jsx";
const probe = "tests/frontier-soak-probe.gd";
// A variant is a list of edits of one file, each made in exactly one place, the text the oracle's rejection must match and whether the probe's own checks
// must fail too (they cannot for a game that is legal in each run).
const variants = [
  {name: "listener-leak", file: fixture, probeMustFail: true, expected: /same subscriptions at every reading|live heap at rest rose/,
    edits: [{find: "  counts.turnEnded += 1;\n", replace: "  counts.turnEnded += 1;\n  GodotFabric.connect(FRONTIER_SNAPSHOT, () => {});\n"}]},
  {name: "nondeterministic-player", file: fixture, probeMustFail: false, expected: /Execution 2: the final hash is the first's/,
    edits: [{find: 'takes("production") && s.city.queue.length === 0', replace: 'takes("production") && s.city.queue.length === 0 && Math.random() < 0.5'}]},
  {name: "pause-kills-ui", file: probe, probeMustFail: true, expected: /HUD answered while the game was paused/,
    edits: [{find: "hud.process_mode = Node.PROCESS_MODE_ALWAYS", replace: "hud.process_mode = Node.PROCESS_MODE_PAUSABLE"}]},
  {name: "leaky-hide", file: fixture, probeMustFail: true, expected: /the HUD holds the native views its state gives/,
    edits: [{find: "opacity: hidden ? 0 : 1,", replace: 'display: hidden ? "none" : "flex",'}]},
];
const digest = content => createHash("sha256").update(content).digest("hex");
const files = [...new Set(variants.map(variant => variant.file))];
const guard = guardSources(root, files);
const receipt = {format: "godot-fabric.frontier-soak-sabotage/v1", sourceSha256: {genuine: guard.genuine}, variants: []};
const verdictFile = name => path.join(root, `build/frontier-soak-sabotage-${name}-verdict.json`);
const reportFiles = name => [1, 2].map(number => path.join(root, `build/frontier-soak-sabotage-${name}-${number}-report.json`));

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
    reportFiles(variant.name).forEach(file => rmSync(file, {force: true}));
    const source = broken(variant);
    const entry = {name: variant.name, file: variant.file, edits: variant.edits, sourceSha256: digest(source)};
    try {
      guard.swap(variant.file, source);
      const result = await guard.run(process.execPath, [test, `--sabotage=${variant.name}`], {timeout: 1500000});
      writeFileSync(path.join(root, `build/frontier-soak-sabotage-${variant.name}-run.log`), result.stdout + result.stderr);
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
    entry.runs = verdict?.runs ?? null;
    entry.probeFailures = verdict?.probeFailures ?? null;
    entry.oracleRejection = verdict?.oracleRejection ?? null;
    entry.rejected = entry.runStatus === 0 && verdict !== null && verdict.oracleRejection !== null && variant.expected.test(verdict.oracleRejection)
      && (!variant.probeMustFail || verdict.probeFailures.length > 0);
    receipt.variants.push(entry);
  }
} finally {
  receipt.sourceSha256.restored = guard.restore();
}
assert.deepEqual(receipt.sourceSha256.restored, receipt.sourceSha256.genuine, "Every source is back byte for byte");
// The genuine source once more: the suite writes the comparison with the verdicts of the variants beside it.
const genuine = await guard.run(process.execPath, [test], {timeout: 2400000});
writeFileSync(path.join(root, "build/frontier-soak-sabotage-current-run.log"), genuine.stdout + genuine.stderr);
receipt.genuineRunStatus = genuine.status;
writeFileSync(path.join(root, "build/frontier-soak-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.rejected, true, `The ${entry.name} variant must be rejected by the probe and the oracle: build/frontier-soak-sabotage-${entry.name}-run.log`);
}
assert.equal(receipt.genuineRunStatus, 0, "The genuine source passes: build/frontier-soak-sabotage-current-run.log");
console.log(JSON.stringify(receipt, null, 2));
