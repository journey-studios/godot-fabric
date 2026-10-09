import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {copyFile, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {createHarness, hash, root} from "./consumer-harness.mjs";
import {SABOTAGES} from "../tests/frontier-turn-sabotages.mjs";

// The turn lane of the 0.5 milestone (V05-06, criterion `turno`): the Frontier game measured as a consumer has it. It provisions the template
// (consumers/civ-lite) into a fresh project with the addon, builds its HUD through the editor plugin as scripts/consumer-civ-lite-check.mjs does
// (no Node of its own, no network), and only then copies the probe into the provisioned copy, under res://turn_probe/. The template, its HUD
// and its scene are never touched: the sabotages that need the game or the HUD to be wrong break the provisioned copy, which is thrown away,
// and the sabotage script proves the template's tree is the same before and after.
//
// The probe runs as the SceneTree script (`godot --path <project> -s res://turn_probe/frontier-turn-runner.gd`), which puts the project's own
// main scene in the root and adds the probe to it. The addon's Application works under that script, so the project needs no autoload.
const TEMPLATE = "civ-lite";
const RUNNER = "res://turn_probe/frontier-turn-runner.gd";
const PROBE_FILES = ["tests/frontier-turn-runner.gd", "tests/frontier-turn-probe.gd", "tests/performance-sampler.gd"];
const REPORT = "frontier-turn-report.json";
const CAPTURES = "frontier-turn-captures";

const read = (command, args) => {
  const result = spawnSync(command, args, {encoding: "utf8", timeout: 30000});
  return result.status === 0 ? result.stdout.trim() : null;
};
export const loadAverage = () => read("sysctl", ["-n", "vm.loadavg"]);

// The machine and the system, as they report themselves. Names of the machine and its serials are not kept.
export const machine = () => ({chip: read("sysctl", ["-n", "machdep.cpu.brand_string"]), model: read("sysctl", ["-n", "hw.model"]),
  logicalCores: Number(read("sysctl", ["-n", "hw.ncpu"])), memoryGb: Math.round(Number(read("sysctl", ["-n", "hw.memsize"])) / 2 ** 30),
  os: `macOS ${read("sw_vers", ["-productVersion"])} (${read("sw_vers", ["-buildVersion"])})`, architecture: read("uname", ["-m"])});

// A digest of a tree of files: the path and the content hash of each, in order. The sabotage script takes it of the template before and after.
export async function treeDigest(directory) {
  const entries = [];
  const walk = async (current, prefix) => {
    for (const entry of (await readdir(current, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), `${relative}/`);
      } else {
        entries.push(`${relative} ${hash(await readFile(path.join(current, entry.name)))}`);
      }
    }
  };
  await walk(directory, "");
  return hash(entries.join("\n"));
}

// The lane: a provisioned project with the probe in it, and the means to run the probe in it as often as asked.
export async function createTurnLane({name = "frontier-turn", sabotage = null} = {}) {
  // The sabotages of the provisioned copy are the ones of the table (tests/frontier-turn-sabotages.mjs) that break the project; the others break the probe, before it is copied.
  const breaking = sabotage === null ? null : SABOTAGES.find(entry => entry.name === sabotage && entry.target === "copy");
  assert.ok(sabotage === null || breaking !== undefined, `${sabotage} is not a sabotage of the provisioned copy`);
  const harness = await createHarness({template: TEMPLATE, name});
  const {directory, project, godot, env} = harness;
  const lane = {
    harness, directory, project,
    // Provisions the template, breaks the copy when a sabotage of the copy is asked for, builds the HUD with the editor and copies the probe.
    async prepare() {
      await harness.provision();
      if (breaking !== null) {
        const {file, find, replace} = breaking;
        const target = path.join(project, file);
        const text = await readFile(target, "utf8");
        assert.equal(text.split(find).length, 2, `The ${sabotage} sabotage must replace exactly one place in the provisioned ${file}`);
        await writeFile(target, text.replace(find, () => replace));
      }
      await harness.editor("editor-cold");
      await mkdir(path.join(project, "turn_probe"), {recursive: true});
      const copied = {};
      for (const file of PROBE_FILES) {
        await copyFile(path.join(root, file), path.join(project, "turn_probe", path.basename(file)));
        copied[file] = hash(await readFile(path.join(root, file)));
      }
      const manifest = JSON.parse(await readFile(path.join(project, "addons", "godot_fabric", "manifest.json"), "utf8"));
      const bundle = await readFile(path.join(project, ".godot_fabric", "app.js"));
      return {probeSha256: copied, manifest, bundleSha256: hash(bundle), bundleBytes: bundle.length, sabotage};
    },
    // One process of the probe. A windowed run has a window and a display; a headless one has neither.
    async launch({label, lane: laneName, windowed = false, extra = [], timeout = 1800000}) {
      await rm(path.join(project, REPORT), {force: true});
      const before = loadAverage();
      const started = Date.now();
      const result = spawnSync(godot, ["--path", project, windowed ? "--windowed" : "--headless", "-s", RUNNER, "--", `--lane=${laneName}`, ...extra],
        {env, encoding: "utf8", timeout, maxBuffer: 256 * 1024 * 1024});
      const after = loadAverage();
      const log = (result.stdout ?? "") + (result.stderr ?? "");
      await writeFile(path.join(directory, `${label}.log`), log);
      let report = null;
      try {
        report = JSON.parse(await readFile(path.join(project, REPORT), "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
      return {result, log, report, load: {before, after, seconds: Math.round((Date.now() - started) / 100) / 10}};
    },
    // The captures the captures lane saved, copied out of the project before it is thrown away.
    async keepCaptures(into) {
      await mkdir(into, {recursive: true});
      const kept = [];
      for (const file of (await readdir(path.join(project, CAPTURES)).catch(() => [])).sort()) {
        await copyFile(path.join(project, CAPTURES, file), path.join(into, file));
        kept.push(path.join(into, file));
      }
      return kept;
    },
    cleanup: () => harness.cleanup(),
  };
  return lane;
}
