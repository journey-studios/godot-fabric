import { spawnSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ensureGodotBinary } from "./godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const binary = await ensureGodotBinary();
const scenario = process.argv.includes("--typography")
  ? "typography"
  : process.argv.includes("--nativewind")
    ? "nativewind"
    : process.argv.includes("--chart")
      ? "chart"
      : process.argv.includes("--scroll")
        ? "scroll"
        : process.argv.includes("--pressable")
          ? "pressable"
          : process.argv.includes("--input")
            ? "input"
            : process.argv.includes("--layout")
              ? "layout"
              : "react";
const scene = scenario === "react" ? [] : [`res://${scenario}.tscn`];
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
