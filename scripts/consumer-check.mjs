import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ensureGodotBinary } from "./godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const capture = process.argv.includes("--capture");
const directory = path.join(root, "build", "consumer");
await mkdir(directory, { recursive: true });
await rm(path.join(directory, "report.json"), { force: true });
const project = await mkdtemp(path.join(tmpdir(), "godot-fabric-consumer-"));
const sdk = path.join(project, "addons", "godot_fabric");
const env = { ...process.env, PATH: "/usr/bin:/bin", NODE_PATH: "" };
const godot = await ensureGodotBinary();
const checks = [];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function verify(condition, name) { checks.push({ name, passed: !!condition }); assert.ok(condition, name); }
async function run(label, command, args, expected = 0, environment = env) {
  const result = spawnSync(command, args, { cwd: project, env: environment, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(directory, label + ".log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, expected, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|CONSUMER_CHECK_FAILED/);
  return log;
}
async function editor(label, expected = 0) {
  const log = await run(label, godot, ["--path", project, "--headless", "--editor", "--", "--godot-fabric-build-check"], expected);
  assert.match(log, expected === 0 ? /CONSUMER_EDITOR_BUILD_PASSED/ : /CONSUMER_EDITOR_BUILD_REJECTED/);
  if (!expected) assert.doesNotMatch(log, /(?:^|\n)ERROR:/);
  return log;
}
async function runtime(label, headed = false) {
  await rm(path.join(project, "consumer-report.json"), { force: true });
  const log = await run(label, godot, ["--path", project, ...(headed ? [] : ["--headless"]), "--", "--validate", ...(headed ? ["--capture"] : [])]);
  assert.doesNotMatch(log, /(?:^|\n)ERROR:|FABRIC_ERROR/);
  assert.match(log, /CONSUMER_VALIDATION_PASSED/);
  const report = JSON.parse(await readFile(path.join(project, "consumer-report.json"), "utf8"));
  assert.equal(report.checks.length, headed ? 20 : 18);
  assert.ok(report.checks.every(check => check.passed), JSON.stringify(report));
  await writeFile(path.join(directory, label + ".json"), JSON.stringify(report, null, 2) + "\n");
  return report;
}
try {
  await cp(path.join(root, "consumers", "minimal"), project, { recursive: true, filter: (file) => !/\.(?:uid|import)$/.test(file) });
  await run("provision", process.execPath, [path.join(root, "scripts", "pack-addon.mjs"), sdk], 0, process.env);
  await mkdir(path.join(project, ".godot"));
  await writeFile(path.join(project, ".godot", "extension_list.cfg"), "res://addons/godot_fabric/fabric.gdextension\n");
  verify(spawnSync("node", ["--version"], { env }).error?.code === "ENOENT", "Consumer cannot find global Node");
  const lockPath = path.join(project, "package-lock.json");
  const originalLock = await readFile(lockPath);
  await editor("editor-cold");
  verify(hash(await readFile(lockPath)) === hash(originalLock), "Editor build preserves the project lockfile");
  const native = await runtime("headless");
  verify(native.beforeStop.bundleEvaluations === 1, "Native consumer executes its bundle once");
  if (capture) {
    await runtime("graphical", true);
    for (const stage of ["initial", "updated"])
      await cp(path.join(project, `consumer-${stage}.png`), path.join(directory, stage + ".png"));
  }
  const bundlePath = path.join(project, ".godot_fabric", "app.js");
  const bundleHash = hash(await readFile(bundlePath));
  const inputs = JSON.parse(await readFile(path.join(project, ".godot_fabric", "build-report.json"), "utf8")).inputs;
  verify(inputs.every(file => !file.includes("examples/") && !file.startsWith("project/../")), "Bundle has no laboratory or external checkout inputs");
  verify(inputs.some(file => file === "project/ui/platform.godot.ts") && !inputs.some(file => file === "project/ui/platform.native.ts"), "Consumer and types select the Godot platform source");
  await run("offline", "/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)(deny network*)", path.join(sdk, "toolchain", "node", "bin", "node"), path.join(sdk, "toolchain", "build.mjs"), project, "res://ui/index.tsx", "res://.godot_fabric/app.js"]);
  verify(hash(await readFile(bundlePath)) === bundleHash, "Provisioned build works with network denied and no global Node");
  const entryPath = path.join(project, "ui", "index.tsx");
  const originalEntry = await readFile(entryPath, "utf8");
  const packagePath = path.join(project, "package.json");
  const originalPackage = await readFile(packagePath, "utf8");
  for (const [name, source, diagnostic] of [
    ["syntax", originalEntry + "\nconst broken = ;\n", /TypeScript failed/],
    ["unsupported-type", originalEntry.replace('title="Increment local"', 'title="Increment local" accessibilityLabel="unsupported"'), /accessibilityLabel/],
  ]) {
    await writeFile(entryPath, source);
    assert.match(await editor(name, 1), diagnostic);
    verify(hash(await readFile(bundlePath)) === bundleHash, name + " failure preserves the previous bundle");
  }
  await writeFile(entryPath, originalEntry);
  await writeFile(packagePath, JSON.stringify({ ...JSON.parse(originalPackage), dependencies: { react: "0.0.0" } }));
  assert.match(await editor("version", 1), /react must match SDK version/);
  verify(hash(await readFile(bundlePath)) === bundleHash, "Incompatible renderer version cannot replace the bundle");
  await writeFile(packagePath, JSON.stringify({ ...JSON.parse(originalPackage), dependencies: { "consumer-ui-lib": "1.0.0" } }));
  await writeFile(path.join(project, "ui", "library.d.ts"), 'declare module "consumer-ui-lib" { export function useMarker(): string; }\n');
  const libraryEntry = 'import { useMarker } from "consumer-ui-lib";\n' + originalEntry.replace('const root = useContext(RootTagContext);', 'const root = useContext(RootTagContext); const marker = useMarker();').replace('</View>;', '<Text testID="library-marker">{marker}</Text></View>;');
  await writeFile(entryPath, libraryEntry);
  assert.match(await editor("missing-dependency", 1), /Missing project dependency consumer-ui-lib/);
  verify(hash(await readFile(bundlePath)) === bundleHash, "An absent project library is diagnosed without implicit installation");
  const library = path.join(project, "node_modules", "consumer-ui-lib");
  await mkdir(path.join(library, "node_modules", "react"), { recursive: true });
  await writeFile(path.join(library, "package.json"), JSON.stringify({ name: "consumer-ui-lib", version: "1.0.0", main: "index.js" }));
  await writeFile(path.join(library, "index.js"), 'import React from "react"; export function useMarker() { return React.useState("Project library React identity")[0]; }\n');
  await writeFile(path.join(library, "node_modules", "react", "package.json"), '{"name":"react","version":"0.0.0","main":"index.js"}\n');
  await writeFile(path.join(library, "node_modules", "react", "index.js"), 'throw new Error("Wrong duplicated React selected");\n');
  await editor("project-library");
  const withLibrary = await runtime("project-library-native");
  verify(withLibrary.beforeStop.nodes.some(node => node.nativeText === "Project library React identity"), "An explicitly provided project library executes hooks with the SDK React identity");
  const libraryInputs = JSON.parse(await readFile(path.join(project, ".godot_fabric", "build-report.json"), "utf8")).inputs;
  verify(libraryInputs.includes("project/node_modules/consumer-ui-lib/index.js") && !libraryInputs.some(file => file.includes("consumer-ui-lib/node_modules/react")), "Library code is project-owned; duplicated React cannot enter the graph");
  await writeFile(entryPath, originalEntry);
  await writeFile(packagePath, originalPackage);
  await editor("recovery");
  verify(hash(await readFile(lockPath)) === hash(originalLock), "Failure, dependency checks and recovery preserve the project lockfile");
  verify(hash(await readFile(bundlePath)) === bundleHash, "The original consumer can build again after rejected requests");
  await writeFile(path.join(directory, "report.json"), JSON.stringify({ schemaVersion: 1, host: "macOS arm64", checks, nativeChecks: 18, graphicalChecks: capture ? 20 : null }, null, 2) + "\n");
  console.log("CONSUMER_CHECK_PASSED: " + checks.length + " build/ownership checks; 18 native checks");
} finally {
  await rm(project, { recursive: true, force: true });
}
