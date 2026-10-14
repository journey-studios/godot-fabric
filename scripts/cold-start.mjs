import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ensureGodotBinary, GODOT_VERSION } from "./godot-binary.mjs";
import {
  createLedger, createSandbox, INSTALL_STEPS, judgeStart, MIN_INSTALLS, parseInstalls, populateColdProject, prepareStartup,
  startGodot, verifyColdReport,
} from "./cold-lanes.mjs";

// Repeated first installs of GF-02 (docs/evidence/cold-start.md, "Repeated first installs"): every install is a new
// disposable project with an empty resource cache and a fresh HOME, a real import, the React and typography scenarios
// and a warm import. Each step runs once; any signal, crash or error fails the run, and nothing is retried.
const root = fileURLToPath(new URL("..", import.meta.url));
const { values } = parseArgs({
  options: { installs: { type: "string", default: String(MIN_INSTALLS) }, "without-startup": { type: "boolean", default: false } },
});
const withoutStartup = values["without-startup"];
mkdirSync(path.join(root, "build"), { recursive: true });
// A report of an earlier run never stands for this one, not even when the arguments or the engine are refused.
rmSync(path.join(root, "build/cold-start.json"), { force: true });
const installs = parseInstalls(values.installs);
const binary = await ensureGodotBinary();
if (!existsSync(path.join(root, "build/app.js"))) {
  throw new Error("Run npm run bundle first");
}

function step({ ledger, sandbox, name, args, marker = null, timeout }) {
  const start = startGodot({ ledger, step: name, binary, sandbox, args, timeout });
  writeFileSync(path.join(root, "build", `cold-${name}.log`), start.log);
  const failure = judgeStart(start, marker);
  if (failure) {
    throw new Error(`${name} failed: ${failure}\n${start.log}`);
  }
}

const runs = [];
for (let index = 1; index <= installs; index++) {
  const sandbox = createSandbox("godot-fabric-cold-");
  try {
    const ledger = createLedger();
    populateColdProject({ root, project: sandbox.project });
    const startupFiles = withoutStartup ? [] : prepareStartup({ root, project: sandbox.project });
    step({ ledger, sandbox, name: `${index}-import`, args: ["--headless", "--editor", "--import"], timeout: 120000 });
    const cases = [];
    for (const [scenario, scene] of [["react", "main"], ["typography", "typography"]]) {
      step({ ledger, sandbox, name: `${index}-${scenario}`, args: ["--headless", `res://${scene}.tscn`, "--", "--validate"], marker: "FABRIC_VALIDATION_PASSED" });
      const report = JSON.parse(readFileSync(path.join(sandbox.project, "build/report.json"), "utf8"));
      if (report.scenario !== scenario || !report.checks.length || report.checks.some((check) => !check.passed)) {
        throw new Error(`${scenario} report is incomplete or failed`);
      }
      cases.push({ scenario, checks: report.checks.length });
    }
    step({ ledger, sandbox, name: `${index}-warm-import`, args: ["--headless", "--editor", "--import"], timeout: 120000 });
    runs.push({ install: index, freshResources: true, freshUserData: true, startupFiles, cases, warmImport: "passed", steps: ledger.entries() });
  } finally {
    sandbox.dispose();
  }
}
const report = {
  schemaVersion: 2, godot: GODOT_VERSION, platform: process.platform, architecture: process.arch, status: "passed",
  startup: withoutStartup ? "skipped" : "prepared", plan: INSTALL_STEPS, installs: runs.length, minimumInstalls: MIN_INSTALLS, runs,
};
const problems = verifyColdReport(report);
if (problems.length) {
  throw new Error(`The cold-start report is not a pass:\n- ${problems.join("\n- ")}`);
}
writeFileSync(path.join(root, "build/cold-start.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`COLD_START_PASSED: ${runs.length} fresh installs, runtime checks and warm imports, one attempt each`);
