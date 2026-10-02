import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ensureGodotBinary } from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

async function withBinary(version, action) {
  const directory = mkdtempSync(path.join(tmpdir(), "fabric-engine-contract-"));
  const previous = process.env.GODOT_BIN;
  try {
    const binary = path.join(directory, "Godot with spaces");
    writeFileSync(binary, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(version)});\n`, { mode: 0o755 });
    process.env.GODOT_BIN = binary;
    await action(binary, directory);
  } finally {
    if (previous === undefined) delete process.env.GODOT_BIN;
    else process.env.GODOT_BIN = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}

test("the extension minimum matches the tested engine pin", () => {
  const pin = JSON.parse(readFileSync(path.join(root, "dependencies.json"), "utf8")).godot;
  assert.equal(pin.version, "4.7.2");
  const manifest = readFileSync(path.join(root, "fabric.gdextension"), "utf8");
  assert.equal(manifest.match(/^compatibility_minimum\s*=\s*"([^"]+)"/m)?.[1], pin.version);
});

test("the resolver accepts the stable baseline at a path containing spaces", async () => {
  await withBinary("4.7.2.stable.official.ed1daf0bf", async (binary) => {
    assert.equal(await ensureGodotBinary(), binary);
  });
});

test("the resolver rejects other versions and malformed stable labels", async () => {
  for (const version of ["4.6.2.stable.official.hash", "4.7.1.stable.official.hash",
    "4.8.stable.official.hash", "4.7.2.dev.custom_build.hash", "4.7.2.stable-ish", ""]) {
    await withBinary(version, async () => {
      await assert.rejects(ensureGodotBinary(), /4\.7\.2\.stable required/);
    });
  }
});

test("an explicit missing executable never falls back to another installed engine", async () => {
  await withBinary("unused", async (_binary, directory) => {
    process.env.GODOT_BIN = path.join(directory, "missing");
    await assert.rejects(ensureGodotBinary(), /Install official Godot 4\.7\.2/);
  });
});

test("runner preflight failures remove prior passing reports", async () => {
  for (const [script, reportName] of [["cold-start.mjs", "cold-start.json"], ["check.mjs", "report.json"]]) {
    await withBinary("4.6.2.stable.official.hash", async (_binary, directory) => {
      const fixture = path.join(directory, "project");
      mkdirSync(path.join(fixture, "scripts"), { recursive: true });
      mkdirSync(path.join(fixture, "build"));
      mkdirSync(path.join(fixture, "examples"));
      for (const file of [`scripts/${script}`, "scripts/godot-binary.mjs", "scripts/examples-catalog.mjs",
        "examples/catalog.json", "dependencies.json"])
        cpSync(path.join(root, file), path.join(fixture, file));
      const report = path.join(fixture, "build", reportName);
      writeFileSync(report, '{"status":"passed"}\n');
      const result = spawnSync(process.execPath, [path.join(fixture, "scripts", script)], {
        encoding: "utf8", timeout: 15000,
      });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /4\.7\.2\.stable required/);
      assert.throws(() => readFileSync(report), { code: "ENOENT" });
    });
  }
});

test("cold fixtures are removed when imports or runtime checks fail", async () => {
  for (const stage of ["import", "runtime"]) {
    await withBinary("unused", async (binary, directory) => {
      writeFileSync(binary, `#!/usr/bin/env node
if (process.argv.includes("--version")) console.log("4.7.2.stable.official.ed1daf0bf");
else if (${JSON.stringify(stage)} === "import") { console.error("FABRIC_TEST_IMPORT_FAILURE"); process.exitCode = 1; }
else if (!process.argv.includes("--editor")) console.error("SCRIPT ERROR: FABRIC_TEST_RUNTIME_FAILURE");
`);
      const fixture = path.join(directory, "project");
      const scratch = path.join(directory, "scratch");
      for (const folder of ["scripts", "build", "addons"])
        mkdirSync(path.join(fixture, folder), { recursive: true });
      mkdirSync(scratch);
      for (const file of ["scripts/cold-start.mjs", "scripts/godot-binary.mjs", "scripts/extension_startup.py",
        "dependencies.json", "project.godot", "fabric.gdextension"])
        cpSync(path.join(root, file), path.join(fixture, file));
      writeFileSync(path.join(fixture, "addons/fabric_godot.dylib"), "fixture");
      writeFileSync(path.join(fixture, "build/app.js"), "fixture");
      const result = spawnSync(process.execPath, [path.join(fixture, "scripts/cold-start.mjs")], {
        encoding: "utf8", timeout: 15000,
        env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch },
      });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, stage === "import" ? /FABRIC_TEST_IMPORT_FAILURE/ : /FABRIC_TEST_RUNTIME_FAILURE/);
      assert.match(readFileSync(path.join(fixture, "build", `cold-1-${stage === "import" ? "import" : "react"}.log`), "utf8"), /FABRIC_TEST_/);
      assert.deepEqual(readdirSync(scratch), []);
      assert.throws(() => readFileSync(path.join(fixture, "build/cold-start.json")), { code: "ENOENT" });
    });
  }
});
