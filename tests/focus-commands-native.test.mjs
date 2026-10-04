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

test("original Fabric focus commands reject malformed arguments without changing native focus or lifetime authority", async () => {
  const output = path.join(root, "build");
  const bundlePath = path.join(output, "focus-commands.js");
  const reportPath = path.join(output, "focus-commands-report.json");
  await mkdir(output, { recursive: true });
  await rm(reportPath, { force: true });
  // This fixture owns a distinct bundle path; never modify the examples bundle.
  const bundle = await build({ absWorkingDir: root, entryPoints: ["tests/focus-command-fixture.jsx"],
    outfile: bundlePath, bundle: true, platform: "neutral", format: "iife", metafile: true,
    define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
    mainFields: ["main"], resolveExtensions: godotExtensions,
    plugins: [platformPlugin(path.join(root, "src"), id => requireSdk.resolve(id))] });
  assert.ok(Object.keys(bundle.metafile.inputs).includes("node_modules/react-native/Libraries/Renderer/implementations/ReactFabric-prod.js"),
    "The isolated bundle must contain the original pinned ReactFabric renderer");
  const transformed = await transformAsync(await readFile(bundlePath, "utf8"), {
    filename: bundlePath, configFile: false, babelrc: false,
    presets: [["@react-native/babel-preset", { disableImportExportTransform: true, enableBabelRuntime: false }]],
  });
  await writeFile(bundlePath, transformed.code + "\n");
  const result = spawnSync(await ensureGodotBinary(), ["--path", root, "--headless", "--script", "res://tests/focus_commands.gd"],
    { encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(output, "focus-commands.log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|FABRIC_CHECK_FAILED|ObjectDB instances leaked|Resources still in use/);
  const expectedErrors = Array.from({ length: 4 }, () => [
    "FABRIC_ERROR: focus requires an empty argument array", "FABRIC_ERROR: blur requires an empty argument array",
  ]).flat();
  assert.deepEqual([...log.matchAll(/^ERROR: (.+)$/gm)].map(match => match[1]), expectedErrors,
    "Every malformed argument must reach precisely the intended native guard, with no unrelated error");
  assert.match(log, /FOCUS_COMMANDS_PASSED/);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.scenario, "focus-commands");
  assert.equal(report.engine, "hermes");
  assert.equal(report.renderer, "fabric");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.bundlePath, "res://build/focus-commands.js");
  assert.equal(report.checks.length, 112, "The complete malformed-command and lifetime acceptance must execute");
  assert.ok(report.checks.every(check => check.passed), JSON.stringify(report.checks));
  assert.equal(new Set(report.checks.map(check => check.name)).size, report.checks.length, "Checks must name distinct acceptance observations");
  assert.deepEqual(report.cases.map(entry => `${entry.command}/${entry.kind}`),
    ["null", "object", "string", "nonempty"].flatMap(kind => [`focus/${kind}`, `blur/${kind}`]));
  assert.equal(report.focusOwners.length, 40);
  assert.ok(report.focusOwners.every(owner => owner.passed && owner.actual === owner.expected));
  assert.deepEqual(report.expectedErrors.map(message => "FABRIC_ERROR: " + message), expectedErrors);
  report.provenance = { bundleSha256: digest(await readFile(bundlePath)),
    nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
    node: process.version,
    sources: Object.fromEntries(await Promise.all(["tests/focus-command-fixture.jsx", "tests/focus_commands.gd", "tests/focus-commands-native.test.mjs"]
      .map(async filename => [filename, digest(await readFile(path.join(root, filename)))]))) };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
});
