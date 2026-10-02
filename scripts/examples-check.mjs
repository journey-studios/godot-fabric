import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { examples } from "./examples-catalog.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
if (args.some((arg) => !["--capture", "--headed"].includes(arg)))
  throw new Error("Use test:examples with --headed or --capture; default is headless");
const capture = args.includes("--capture");
const headed = capture || args.includes("--headed");
const directory = new URL(`../build/examples/${headed ? "native" : "headless"}/`, import.meta.url);
mkdirSync(directory, { recursive: true });
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", timeout: 180000 });
  if (result.error || result.status !== 0)
    throw new Error(`Example suite failed: ${result.error || result.signal || result.status}`);
}
run(["scripts/bundle.mjs"]);
for (const example of examples.filter((entry) => !entry.automated)) {
  console.log(`Checking example: ${example.id}`);
  run(["scripts/check.mjs", `--${example.id}`, ...(headed ? [] : ["--headless"]),
    ...(capture ? ["--capture"] : [])]);
  copyFileSync(join(root, "build", "report.json"), new URL(`${example.id}.json`, directory));
}
