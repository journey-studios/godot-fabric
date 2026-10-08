import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ensureGodotBinary } from "./godot-binary.mjs";

export const root = fileURLToPath(new URL("..", import.meta.url));
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// What the consumer lanes share: a template provisioned into a fresh project
// outside the SDK checkout, a Node-less environment, and the editor and runtime
// invocations whose logs and reports land in build/<name>.
export async function createHarness({ template, name }) {
  const directory = path.join(root, "build", name);
  await mkdir(directory, { recursive: true });
  const temporary = await mkdtemp(path.join(tmpdir(), `godot-fabric-${name}-`));
  const project = path.join(temporary, "project");
  const outside = await mkdtemp(path.join(tmpdir(), `godot-fabric-${name}-output-control-`));
  const env = { ...process.env, PATH: "/usr/bin:/bin", NODE_PATH: "" };
  const removedDyldEnvironmentKeys = [];
  for (const key of Object.keys(env)) {
    if (key.startsWith("DYLD_")) {
      delete env[key];
      removedDyldEnvironmentKeys.push(key);
    }
  }
  const godot = await ensureGodotBinary();
  const checks = [];
  const harness = {
    root, directory, project, outside, env, godot, checks, removedDyldEnvironmentKeys,
    sdk: path.join(project, "addons", "godot_fabric"),
    verify(condition, name) { checks.push({ name, passed: !!condition }); assert.ok(condition, name); },
    async run(label, command, args, expected = 0, environment = env, options = {}) {
      const result = spawnSync(command, args, { cwd: options.cwd ?? (label === "provision" ? root : project), env: environment, encoding: "utf8",
        timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
      const log = (result.stdout ?? "") + (result.stderr ?? "");
      await writeFile(path.join(directory, label + ".log"), log);
      assert.equal(result.error, undefined, log);
      assert.equal(result.status, expected, log);
      assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|CONSUMER_CHECK_FAILED/);
      return log;
    },
    async provision() {
      return harness.run("provision", process.execPath, [path.join(root, "scripts", "create-consumer.mjs"), "--template", template, project], 0, process.env);
    },
    async editor(label, expected = 0) {
      const log = await harness.run(label, godot, ["--path", project, "--headless", "--editor", "--", "--godot-fabric-build-check"], expected);
      assert.match(log, expected === 0 ? /CONSUMER_EDITOR_BUILD_PASSED/ : /CONSUMER_EDITOR_BUILD_REJECTED/);
      if (!expected) {
        assert.doesNotMatch(log, /(?:^|\n)ERROR:/);
      }
      return log;
    },
    // The scene validates itself and writes its report; the harness reads both back.
    async runtime(label, { headed = false, marker, report, expectedChecks }) {
      await rm(path.join(project, report), { force: true });
      const log = await harness.run(label, godot, ["--path", project, ...(headed ? [] : ["--headless"]), "--", "--validate", ...(headed ? ["--capture"] : [])]);
      assert.doesNotMatch(log, /(?:^|\n)ERROR:|FABRIC_ERROR/);
      assert.match(log, marker);
      const result = JSON.parse(await readFile(path.join(project, report), "utf8"));
      assert.equal(result.checks.length, expectedChecks);
      assert.ok(result.checks.every(check => check.passed), JSON.stringify(result));
      await writeFile(path.join(directory, label + ".json"), JSON.stringify(result, null, 2) + "\n");
      return result;
    },
    async cleanup() {
      await rm(temporary, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    },
  };
  return harness;
}
