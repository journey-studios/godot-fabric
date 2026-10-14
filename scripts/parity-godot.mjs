import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ensureGodotBinary, GODOT_VERSION } from "./godot-binary.mjs";
import {
  createLedger, createSandbox, judgeStart, listTree, populateColdProject, prepareStartup, sha256, startGodot, treeSha256,
} from "./cold-lanes.mjs";
import { assertReport, provenance } from "./parity-protocol.mjs";

// The shared parity fixture, run from a cold project (docs/evidence/cold-start.md, "Parity from a cold project"): a
// disposable copy with an empty resource cache and a fresh HOME, imported and started once. The report keeps the
// provenance of the fixture and says what project produced it; scripts/parity-protocol.mjs refuses a Godot report that
// was not made this way, so the comparison with the RN references cannot be fed by a run in the checkout.
const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(root, "build/parity-godot.json");
const headed = process.argv.includes("--headed");
mkdirSync(path.join(root, "build"), { recursive: true });
rmSync(output, { force: true });
const bundled = spawnSync("npm", ["run", "bundle"], { cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
if (bundled.error || bundled.status !== 0) {
  throw new Error(`Parity bundle failed: ${bundled.error || bundled.signal || bundled.status}\n${bundled.stdout}${bundled.stderr}`);
}
const binary = await ensureGodotBinary();
const ledger = createLedger();
const sandbox = createSandbox("godot-fabric-parity-");
try {
  populateColdProject({ root, project: sandbox.project, extra: ["tests/parity_guards.gd"] });
  const resourceCacheBeforeImport = prepareStartup({ root, project: sandbox.project });
  const tree = listTree(sandbox.project);
  const cold = {
    disposable: true,
    userData: "fresh",
    resourceCacheBeforeImport,
    files: tree.filter((entry) => entry.kind === "file").length,
    treeSha256: treeSha256(tree),
    bundleSha256: sha256(readFileSync(path.join(root, "build/app.js"))),
  };
  function step(name, args, marker, timeout) {
    const start = startGodot({ ledger, step: name, binary, sandbox, args, timeout });
    const failure = judgeStart(start, marker);
    if (failure) {
      throw new Error(`Parity command ${name} failed: ${failure}\n${start.log}`);
    }
    return start.log;
  }
  step("parity-import", ["--headless", "--editor", "--import"], null, 120000);
  step("parity-guards", ["--headless", "--script", "res://tests/parity_guards.gd"], "FABRIC_PARITY_GUARDS_PASSED");
  const log = step("parity-run", [...(headed ? [] : ["--headless"]), "res://parity.tscn"], "FABRIC_PARITY_PASSED");
  writeFileSync(path.join(root, "build/parity-godot.log"), log);
  const result = JSON.parse(readFileSync(path.join(sandbox.project, "build/parity-godot.json"), "utf8"));
  const report = {
    ...result, platform: "godot", godot: GODOT_VERSION, display: headed ? "native" : "headless", ...provenance(),
    coldProject: { ...cold, launches: ledger.entries() },
  };
  assertReport(report, "godot");
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`PARITY_GODOT_PASSED: ${report.checks.length} native subset cases from a cold project`);
} finally {
  sandbox.dispose();
}
