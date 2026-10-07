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

async function runProbe(binary, bundle, name, script, headless = true) {
  const reportPath = path.join(root, `build/${name}-report.json`);
  const logPath = path.join(root, `build/${name}.log`);
  await rm(reportPath, {force: true});
  const args = ["--path", root];
  if (headless) args.push("--headless");
  args.push("--script", `res://${script}`);
  const result = spawnSync(binary, args,
    {encoding: "utf8", timeout: 60000, maxBuffer: 12 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(logPath, log);
  let report;
  try { report = JSON.parse(await readFile(reportPath, "utf8")); }
  catch (error) { if (error.code === "ENOENT") assert.fail(`No ${name} report was written:\n${log}`); throw error; }
  report.provenance = {bundleSha256: bundle.bundle.sha256,
    nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib")))};
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /(^|\n)(?:SCRIPT ERROR|ERROR:)|Program crashed|ObjectDB instances leaked|Resources still in use/);
  return report;
}

test("Modal capture endpoint retirement and sibling reorder stay bounded", {timeout: 240000}, async t => {
  const bundle = await bundleModalHostProbe("modal-discriminators");
  const binary = await ensureGodotBinary();

  await t.test("captured contacts retire when their Modal Window is destroyed", async () => {
    const report = await runProbe(binary, bundle, "modal-capture-lifetime", "tests/modal-capture-lifetime-probe.gd");
    const passed = new Map(report.checks.map(row => [row.id, row.passed]));
    assert.equal(report.scenario, "modal-capture-endpoint-lifetime");
    assert.equal(report.cycles.length, 10);
    assert.equal(new Set(report.destroyedWindowIds).size, 10);
    for (let cycle = 0; cycle < 10; cycle++) {
      for (const suffix of ["window-and-target-mounted", "pointer-capture-active", "physical-endpoint-and-capture-owner-destroyed",
        "dead-window-route-and-processor-state-retired", "removed-target-receives-no-fabricated-terminal-callback"])
        assert.equal(passed.get(`capture/cycle-${String(cycle).padStart(2, "0")}-${suffix}`), true,
          `Required capture endpoint invariant: ${suffix} at cycle ${cycle}`);
    }
    assert.equal(passed.get("lifecycle/window-visibility-callback-stops-owner-after-modal-revocation"), true);
    assert.equal(passed.get("lifecycle/reentrant-window-is-freed-after-callback-unwinds"), true);
    assert.equal(passed.get("lifecycle/reentrant-stop-leaves-no-dead-endpoint-or-phantom-press"), true);
    assert.equal(report.reentrant.triggered, true);
    assert.equal(report.reentrant.application.rootCount, 0);
    assert.deepEqual(report.reentrant.application.errors, []);
  });

  await t.test("React reorders siblings around the portal without moving it into the physical tree", async () => {
    const report = await runProbe(binary, bundle, "modal-sibling-order", "tests/modal-sibling-order-probe.gd");
    const passed = new Map(report.checks.map(row => [row.id, row.passed]));
    assert.equal(report.scenario, "modal-logical-sibling-order");
    assert.equal(report.observed.length, 3);
    assert.deepEqual(report.observed.map(row => row.physicalOrder), [
      ["ordinary-a", "ordinary-b", "ordinary-c"],
      ["ordinary-c", "ordinary-a", "ordinary-b"],
      ["ordinary-a", "ordinary-b", "ordinary-c"],
    ]);
    for (let step = 0; step < 3; step++) {
      assert.equal(passed.get(`reorder/step-${step}-physical-order-excludes-modal`), true);
      assert.equal(passed.get(`reorder/step-${step}-retains-controls-focus-text-and-onShow`), true);
    }
    assert.equal(report.observed.every(row => row.retained && row.focused && row.text === "seedz"), true);
    assert.deepEqual(report.application.errors, []);
  });

  await t.test("native owner Windows keep independent Modal stacks and input routes", async () => {
    const report = await runProbe(binary, bundle, "modal-owner-windows", "tests/modal-owner-windows-probe.gd", false);
    const passed = new Map(report.checks.map(row => [row.id, row.passed]));
    assert.equal(report.scenario, "modal-two-native-owner-windows");
    assert.notEqual(report.displayServer, "headless");
    assert.equal(new Set(report.modalWindowIds).size, 2);
    for (const id of [
      "owners/second-owner-is-a-distinct-native-window",
      "owners/each-runtime-modal-window-is-embedded-under-its-own-owner",
      "owners/both-independent-modal-stacks-hold-their-own-exclusive-top",
      "owners/input-in-owner-A-is-confined-to-runtime-A",
      "owners/input-in-owner-B-is-confined-to-runtime-B",
      "owners/removing-A-presentation-preserves-B-window-stack-and-control-identity",
      "owners/B-remains-interactive-after-A-presentation-is-destroyed",
      "owners/stopping-runtime-A-does-not-retire-owner-B-stack",
      "owners/both-native-owner-runtimes-clean-up-independently",
    ]) assert.equal(passed.get(id), true, `Required native owner invariant: ${id}`);
    assert.deepEqual(report.errors, [[], []]);
  });
});
