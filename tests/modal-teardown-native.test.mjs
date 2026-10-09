import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleModalHostProbe} from "../scripts/modal-host-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const digest = value => createHash("sha256").update(value).digest("hex");
const exitedPrefix = "MODAL_TEARDOWN_APPLICATION_EXITED=";

// GF-18: each scenario is its own Godot process, because SceneTree.quit ends it.
async function runScenario(binary, bundle, scenario) {
  const reportPath = path.join(root, `build/modal-teardown-${scenario}-report.json`);
  await rm(reportPath, {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/modal-teardown-probe.gd",
    "--", `--scenario=${scenario}`], {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/modal-teardown-${scenario}.log`), log);
  let report;
  try { report = JSON.parse(await readFile(reportPath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") assert.fail(`No ${scenario} report was written:\n${log}`); throw error; }
  report.provenance = {bundleSha256: bundle.bundle.sha256,
    probeSha256: digest(await readFile(path.join(root, "tests/modal-teardown-probe.gd"))),
    nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib")))};
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");

  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  // The defect was one "Parent node is busy adding/removing children" ERROR per teardown.
  assert.doesNotMatch(log, /(^|\n)(?:SCRIPT ERROR|ERROR:)|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, `modal-teardown-${scenario}`);
  assert.equal(new Set(report.checks.map(row => row.id)).size, report.checks.length);
  assert.ok(report.checks.every(row => row.passed), JSON.stringify(report.checks.filter(row => !row.passed), null, 2));
  for (const id of ["open/the RN Modal is an exclusive embedded Window under the scene's owner Window",
    "open/the Modal was shown once without runtime errors"])
    assert.ok(report.checks.some(row => row.id === id), `Required teardown precondition: ${id}`);
  // The application left the tree while its Modal Window was still alive, so the
  // teardown under test is the one that retires an open Modal.
  const exited = log.split("\n").find(line => line.startsWith(exitedPrefix));
  assert.ok(exited, log);
  assert.deepEqual(JSON.parse(exited.slice(exitedPrefix.length)),
    {errors: [], modalWindowAlive: true, rootCount: 0, stopped: true});
  return {report, log};
}

test("an RN Modal open while its scene leaves the tree retires without a busy-parent error", {timeout: 180000}, async t => {
  const bundle = await bundleModalHostProbe("modal-teardown");
  const binary = await ensureGodotBinary();

  await t.test("SceneTree.quit with the Modal open", async () => {
    const {report, log} = await runScenario(binary, bundle, "quit");
    assert.equal(report.stage, "before-quit");
    assert.equal(report.checks.length, 2);
    assert.match(log, new RegExp(`MODAL_TEARDOWN_QUIT_WITH_OPEN_MODAL=${report.observed.open.window.id}\\b`));
  });

  for (const scenario of ["change-scene", "free-owner"]) {
    await t.test(`${scenario} with the Modal open`, async () => {
      const {report, log} = await runScenario(binary, bundle, scenario);
      assert.equal(report.stage, "after-teardown");
      assert.equal(report.checks.length, scenario === "change-scene" ? 6 : 5);
      for (const id of ["teardown/the application stopped from _exit_tree without runtime errors",
        "teardown/the retired Modal Window is freed after the owner finishes removing children",
        "teardown/the old scene, its application and its surface are freed"])
        assert.ok(report.checks.some(row => row.id === id), `Required teardown check: ${id}`);
      assert.deepEqual(report.observed.after.rootWindows, []);
      assert.match(log, new RegExp(`MODAL_TEARDOWN_${scenario.toUpperCase().replace("-", "_")}=PASSED`));
    });
  }
});
