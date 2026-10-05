import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transformAsync } from "@babel/core";
import { build } from "esbuild";
import { ensureGodotBinary } from "../scripts/godot-binary.mjs";
import { platformPlugin } from "../sdk/toolchain/platform-plugin.mjs";
import { godotExtensions } from "../sdk/toolchain/platform-resolution.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireSdk = createRequire(import.meta.url);
const digest = contents => createHash("sha256").update(contents).digest("hex");

test("real JSX pointer listener faults recover and reentrant native stop revokes capture immediately", async () => {
  const output = path.join(root, "build");
  const bundlePath = path.join(output, "pointer-errors.js");
  const reportPath = path.join(output, "pointer-errors-report.json");
  await mkdir(output, {recursive: true});
  await rm(reportPath, {force: true});
  const bundle = await build({absWorkingDir: root, entryPoints: ["tests/pointer-errors-fixture.jsx"],
    outfile: bundlePath, bundle: true, platform: "neutral", format: "iife", metafile: true,
    define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"},
    mainFields: ["main"], resolveExtensions: godotExtensions,
    plugins: [platformPlugin(path.join(root, "src"), id => requireSdk.resolve(id))]});
  assert.ok(Object.keys(bundle.metafile.inputs).includes("node_modules/react-native/Libraries/Renderer/implementations/ReactFabric-prod.js"));
  const transformed = await transformAsync(await readFile(bundlePath, "utf8"), {
    filename: bundlePath, configFile: false, babelrc: false,
    presets: [["@react-native/babel-preset", {disableImportExportTransform: true, enableBabelRuntime: false}]],
  });
  await writeFile(bundlePath, transformed.code + "\n");
  const result = spawnSync(await ensureGodotBinary(), ["--path", root, "--headless", "--script", "res://tests/pointer_errors.gd"],
    {encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(output, "pointer-errors.log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|FABRIC_CHECK_FAILED|ObjectDB instances leaked|Resources still in use/);
  const diagnostics = [...log.matchAll(/^ERROR: (.+)$/gm)].map(match => match[1]);
  assert.equal(diagnostics.length, 6, log);
  assert.deepEqual(diagnostics.map(message => message.match(/Pointer listener fault (\w+)/)?.[1]),
    ["Out", "Over", "Enter", "Leave", "GotPointerCapture", "Up"], "Exactly the six deliberate original JSX exceptions must remain visible");
  assert.match(log, /POINTER_ERRORS_PASSED/);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.scenario, "pointer-errors");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.checks.length, 43);
  assert.ok(report.checks.every(check => check.passed), JSON.stringify(report.checks));
  assert.equal(new Set(report.checks.map(check => check.name)).size, 43);
  assert.equal(report.cases.length, 6);
  assert.equal(report.focusStops, 1, "Application stop must come from genuine synchronous LineEdit focus signal");
  report.provenance = {bundleSha256: digest(await readFile(bundlePath)),
    nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), node: process.version,
    sources: Object.fromEntries(await Promise.all(["tests/pointer-errors-fixture.jsx", "tests/pointer_errors.gd", "tests/pointer-errors-native.test.mjs"]
      .map(async filename => [filename, digest(await readFile(path.join(root, filename)))])))};
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
});
