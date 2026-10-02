import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureGodotBinary, GODOT_VERSION } from "./godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const errors = /SCRIPT ERROR|(?:^|\n)ERROR:|Program crashed|FABRIC_ERROR|FABRIC_CHECK_FAILED/;
const runs = [];
mkdirSync(path.join(root, "build"), { recursive: true });
rmSync(path.join(root, "build/cold-start.json"), { force: true });
const binary = await ensureGodotBinary();
if (!existsSync(path.join(root, "build/app.js"))) throw new Error("Run npm run bundle first");

function run(fixture, name, args, marker) {
  const result = spawnSync(binary, ["--path", fixture, ...args], {
    encoding: "utf8", timeout: 45000, maxBuffer: 8 * 1024 * 1024,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(path.join(root, "build", `cold-${name}.log`), log);
  if (result.error || result.status !== 0 || errors.test(log) || (marker && !log.includes(marker)))
    throw new Error(`${name} failed: ${result.error || result.signal || result.status}\n${log}`);
  return log;
}

for (let index = 1; index <= 2; index++) {
  const fixture = mkdtempSync(path.join(tmpdir(), "godot-fabric-cold-"));
  try {
    for (const entry of readdirSync(root)) {
      if (/\.(?:gd|tscn|gdextension)$/.test(entry) || entry === "project.godot" || entry === "assets" || entry === "addons" || entry === "examples")
        cpSync(path.join(root, entry), path.join(fixture, entry), { recursive: true });
    }
    cpSync(path.join(root, "scripts"), path.join(fixture, "scripts"), {
      recursive: true, filter: (source) => !path.extname(source) || source.endsWith(".gd"),
    });
    mkdirSync(path.join(fixture, "build"));
    cpSync(path.join(root, "build/app.js"), path.join(fixture, "build/app.js"));
    if (existsSync(path.join(fixture, ".godot"))) throw new Error("Cold fixture unexpectedly contains a cache");
    if (!process.argv.includes("--without-startup")) {
      const prepared = spawnSync("python3", [path.join(root, "scripts/extension_startup.py"), fixture], { encoding: "utf8", timeout: 10000 });
      if (prepared.error || prepared.status !== 0) throw new Error(prepared.stderr || String(prepared.error));
      const files = readdirSync(path.join(fixture, ".godot"));
      if (files.length !== 1 || files[0] !== "extension_list.cfg") throw new Error("Startup copied unexpected cache state");
    }
    run(fixture, `${index}-import`, ["--headless", "--editor", "--import"]);
    const cases = [];
    for (const [scenario, scene] of [["react", "main"], ["typography", "typography"]]) {
      run(fixture, `${index}-${scenario}`, ["--headless", `res://${scene}.tscn`, "--", "--validate"], "FABRIC_VALIDATION_PASSED");
      const report = JSON.parse(readFileSync(path.join(fixture, "build/report.json"), "utf8"));
      if (report.scenario !== scenario || !report.checks.length || report.checks.some((check) => !check.passed))
        throw new Error(`${scenario} report is incomplete or failed`);
      cases.push({ scenario, checks: report.checks.length });
    }
    run(fixture, `${index}-warm-import`, ["--headless", "--editor", "--import"]);
    runs.push({ freshResources: true, startupFiles: ["extension_list.cfg"], cases, warmImport: "passed" });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}
const report = { schemaVersion: 1, godot: GODOT_VERSION, platform: process.platform, architecture: process.arch, status: "passed", runs };
writeFileSync(path.join(root, "build/cold-start.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`COLD_START_PASSED: ${runs.length} fresh imports, runtime checks and warm imports`);
