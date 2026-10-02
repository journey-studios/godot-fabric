import { spawnSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ensureGodotBinary } from "./godot-binary.mjs";
import { examples } from "./examples-catalog.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const binary = await ensureGodotBinary();
const selected = examples.filter((example) => process.argv.includes(`--${example.id}`));
if (selected.length > 1) throw new Error("Choose one example at a time");
const example = selected[0] || examples.find((entry) => entry.id === "react");
if (example.automated) throw new Error("Use npm run example -- parity for the original-native oracle");
const scenario = example.id;
const scene = [`res://${example.scene}`];
const interactive = process.argv.includes("--interactive");
if (!existsSync(path.join(root, "addons/fabric_godot.dylib")))
  throw new Error("Run npm run setup first");
mkdirSync(path.join(root, "build"), { recursive: true });
const errors = /SCRIPT ERROR|(?:^|\n)ERROR:|Program crashed|FABRIC_ERROR/;
function run(name, args) {
  const result = spawnSync(binary, ["--path", root, ...args], {
    encoding: "utf8",
    timeout: 45000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(path.join(root, "build", `${name}.log`), log);
  if (result.error || result.status !== 0 || errors.test(log)) {
    console.error(log);
    throw new Error(`${name} failed: ${result.error ?? result.status}`);
  }
  return log;
}
const startup = spawnSync("python3", [path.join(root, "scripts/extension_startup.py"), root], {
  encoding: "utf8", timeout: 10000,
});
if (startup.error || startup.status !== 0)
  throw new Error(`Extension startup failed: ${startup.stderr || startup.error}`);
run("editor", ["--headless", "--editor", "--import"]);
if (interactive) {
  const child = spawn(binary, ["--path", root, ...scene], { stdio: "inherit" });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  const headed = !process.argv.includes("--headless");
  const capture = process.argv.includes("--capture");
  if (capture && !headed)
    throw new Error("Capture requires the native renderer");
  const log = run(`${scenario}-${headed ? "native" : "headless"}`, [
    ...(headed ? [] : ["--headless"]),
    ...scene,
    "--",
    "--validate",
    ...(capture ? ["--capture"] : []),
  ]);
  if (!log.includes("FABRIC_VALIDATION_PASSED"))
    throw new Error("Godot exited without completing the acceptance checks");
  const report = JSON.parse(
    readFileSync(path.join(root, "build/report.json"), "utf8"),
  );
  if (report.checks.some((check) => !check.passed))
    throw new Error("Acceptance report contains failures");
  console.log(
    `Fabric/Godot: ${report.checks.length} acceptance checks passed (${headed ? "native renderer" : "headless"}).`,
  );
}
