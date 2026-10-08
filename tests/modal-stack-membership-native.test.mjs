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
const sha256 = value => createHash("sha256").update(value).digest("hex");

test("Modal runtime membership follows live surfaces on its persistent Window", {timeout: 180000}, async () => {
  const bundle = await bundleModalHostProbe("modal-stack-membership");
  const binary = await ensureGodotBinary();
  const reportPath = path.join(root, "build/modal-stack-membership-report.json");
  const logPath = path.join(root, "build/modal-stack-membership.log");
  await rm(reportPath, {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/modal-stack-membership-probe.gd"],
    {encoding: "utf8", timeout: 90000, maxBuffer: 8 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(logPath, log);
  let report;
  try { report = JSON.parse(await readFile(reportPath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") assert.fail(`No membership report was written:\n${log}`); throw error; }
  report.provenance = {bundle, nativeHostSha256: sha256(await readFile(path.join(root, "addons/fabric_godot.dylib")))};
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");

  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /(^|\n)(?:SCRIPT ERROR|ERROR:)|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "modal-window-stack-runtime-membership");
  assert.equal(report.checks.length, 31);
  assert.equal(new Set(report.checks.map(check => check.id)).size, report.checks.length);
  assert.ok(report.checks.every(check => check.passed), JSON.stringify(report.checks.filter(check => !check.passed), null, 2));
  assert.equal(report.observer.initialMembers, 1);
  assert.equal(report.observer.churn.length, 10);
  for (const row of report.observer.churn) {
    assert.equal(row.mountedCount, 2);
    assert.equal(row.afterStopCount, 1);
    assert.equal(row.stopped.rootCount, 0);
    assert.deepEqual(row.stopped.errors, []);
  }
  assert.deepEqual([report.multiSurface.bothMounted.members, report.multiSurface.oneRemaining.members,
    report.multiSurface.noneRemaining.members, report.multiSurface.afterRemount.members,
    report.multiSurface.afterForeignTakeover.members, report.multiSurface.afterForeignStop.members], [2, 2, 1, 2, 3, 2]);
  assert.equal(report.multiSurface.afterForeignTakeover.lower.cancels,
    report.multiSurface.afterRemount.state.cancels + 1);
  assert.equal(report.multiSurface.afterForeignTakeover.lower.losts,
    report.multiSurface.afterRemount.state.losts + 1);
});
