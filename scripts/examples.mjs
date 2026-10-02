import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { examples, exampleOptions } from "./examples-catalog.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const options = exampleOptions(process.argv.slice(2));
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Example command failed: ${signal || code}`)));
  });
}
if (options.list) {
  for (const example of examples) console.log(`${example.id.padEnd(12)} ${example.api.padEnd(8)} ${example.title}${example.automated ? " (automated)" : ""}`);
  console.log("\nRun: npm run example -- <name> [--check | --headless | --capture]");
} else if (options.example.automated) {
  await run(["scripts/parity-godot.mjs", ...(options.headless ? [] : ["--headed"])]);
} else {
  await run(["scripts/bundle.mjs"]);
  await run(["scripts/check.mjs", `--${options.example.id}`, ...(options.check ? [] : ["--interactive"]),
    ...(options.headless ? ["--headless"] : []), ...(options.capture ? ["--capture"] : [])]);
}
