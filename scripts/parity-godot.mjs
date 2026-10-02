import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ensureGodotBinary, GODOT_VERSION } from "./godot-binary.mjs";
import { assertReport, provenance } from "./parity-protocol.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(root, "build/parity-godot.json");
mkdirSync(path.join(root, "build"), { recursive: true });
rmSync(output, { force: true });
function command(binary, args, marker) {
  const result = spawnSync(binary, args, { cwd: root, encoding: "utf8", timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  if (result.error || result.status !== 0 || /SCRIPT ERROR|(?:^|\n)ERROR:|Program crashed|FABRIC_ERROR/.test(log) || (marker && !log.includes(marker)))
    throw new Error(`Parity command failed: ${result.error || result.signal || result.status}\n${log}`);
  return log;
}
command("npm", ["run", "bundle"]);
command("python3", ["scripts/extension_startup.py", root]);
const binary = await ensureGodotBinary();
command(binary, ["--path", root, "--headless", "--editor", "--import"]);
command(binary, ["--path", root, "--headless", "--script", "res://tests/parity_guards.gd"], "FABRIC_PARITY_GUARDS_PASSED");
const log = command(binary, ["--path", root, ...(process.argv.includes("--headed") ? [] : ["--headless"]), "res://parity.tscn"], "FABRIC_PARITY_PASSED");
writeFileSync(path.join(root, "build/parity-godot.log"), log);
const result = JSON.parse(readFileSync(output, "utf8"));
const report = { ...result, platform: "godot", godot: GODOT_VERSION, display: process.argv.includes("--headed") ? "native" : "headless", ...provenance() };
assertReport(report, "godot");
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(`PARITY_GODOT_PASSED: ${report.checks.length} native subset cases`);
