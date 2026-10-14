import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES as variants} from "../tests/js-globals-sabotages.mjs";

// The retained sabotages of the JS globals slice. Each runs tests/js-globals-native.test.mjs on an SDK with one override in memory (an
// esbuild plugin in scripts/js-globals-bundle.mjs: no file is edited, which the receipt proves by the hash of every file before and after),
// and the probe's checks and the independent oracle must both reject it. tests/js-globals-sabotages.mjs says what each breaks. The
// current lane runs last, so that its comparison (build/js-globals-comparison.json) holds every sabotage. The control on the previous host is
// run by hand, with that host in addons/: node tests/js-globals-native.test.mjs --allow-original-negative. Run with:
//   node scripts/js-globals-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = content => createHash("sha256").update(content).digest("hex");
const files = [...new Set(variants.map(variant => variant.file))];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, digest(await readFile(path.join(root, file)))])));
const runs = [...variants.map(variant => ({lane: `sabotage-${variant.name}`, argument: `--sabotage=${variant.name}`})), {lane: "current", argument: null}];

const receipt = {format: "godot-fabric.js-globals-sabotage/v1", sourceSha256: {genuine: await hashes()}, runs: []};
for (const run of runs) {
  const result = spawnSync(process.execPath, ["tests/js-globals-native.test.mjs", ...(run.argument === null ? [] : [run.argument])],
    {cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024});
  await writeFile(path.join(root, `build/js-globals-${run.lane}-run.log`), (result.stdout ?? "") + (result.stderr ?? ""));
  const report = JSON.parse(await readFile(path.join(root, `build/js-globals-${run.lane}-report.json`), "utf8"));
  receipt.runs.push({lane: run.lane, argument: run.argument, status: result.status, checks: report.checks.length,
    failures: report.checks.filter(row => !row.passed).map(row => row.name), bundleSha256: report.provenance.bundle.bundle.sha256});
}
receipt.sourceSha256.restored = await hashes();
await writeFile(path.join(root, "build/js-globals-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
assert.deepEqual(receipt.sourceSha256.restored, receipt.sourceSha256.genuine, "No source was edited");
for (const run of receipt.runs) {
  assert.equal(run.status, 0, `${run.lane} must be rejected as designed: build/js-globals-${run.lane}-run.log`);
}
console.log(JSON.stringify(receipt, null, 2));
