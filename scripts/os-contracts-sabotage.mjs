import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {sabotageNames} from "./os-contracts-bundle.mjs";

// The retained controls of the OS-specific contracts slice. Each runs tests/os-contracts-native.test.mjs on
// another SDK, and the probe's checks and the independent oracle must both reject it:
//
//   previous SDK       the same fixture bundled with the src/ that origin/main had before this slice (extracted from
//                      git). It exports none of the APIs, so it must fail exactly the normative checks. This slice
//                      has no native code, so this is its control in place of a previous host.
//   platform-android   Platform.OS is "android": the modules that need a host module throw, and
//                      TouchableNativeFeedback sends a native background and native commands to the host.
//   silent-shim        ToastAndroid stays silent and PermissionsAndroid grants.
//   self-import        The facade uses RN's generic ToastAndroid path, which imports itself and is undefined.
//
// The sabotages are overrides in memory (an esbuild plugin in scripts/os-contracts-bundle.mjs): no source file is
// edited, which the receipt proves by the hash of every SDK file before and after. The current lane runs last, so
// that its comparison (build/os-contracts-comparison.json) holds all four controls. Run with:
//   node scripts/os-contracts-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = content => createHash("sha256").update(content).digest("hex");
const files = ["src/os-specific.js", "src/platform.js", "src/react-native-platform.jsx"];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, digest(await readFile(path.join(root, file)))])));
const runs = [{lane: "previous-sdk", argument: "--allow-previous-sdk"},
  ...sabotageNames.map(name => ({lane: `sabotage-${name}`, argument: `--sabotage=${name}`})), {lane: "current", argument: null}];

const receipt = {format: "godot-fabric.os-contracts-sabotage/v1", sourceSha256: {genuine: await hashes()}, runs: []};
for (const run of runs) {
  const result = spawnSync(process.execPath, ["tests/os-contracts-native.test.mjs", ...(run.argument === null ? [] : [run.argument])],
    {cwd: root, encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024});
  await writeFile(path.join(root, `build/os-contracts-${run.lane}-run.log`), (result.stdout ?? "") + (result.stderr ?? ""));
  const report = JSON.parse(await readFile(path.join(root, `build/os-contracts-${run.lane}-report.json`), "utf8"));
  receipt.runs.push({lane: run.lane, argument: run.argument, status: result.status,
    checks: report.checks.length, failures: report.checks.filter(row => !row.passed).map(row => row.name), bundleSha256: report.provenance.bundle.bundle.sha256});
}
receipt.sourceSha256.restored = await hashes();
await writeFile(path.join(root, "build/os-contracts-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
assert.deepEqual(receipt.sourceSha256.restored, receipt.sourceSha256.genuine, "No SDK source was edited");
for (const run of receipt.runs) {
  assert.equal(run.status, 0, `${run.lane} must be rejected as designed: build/os-contracts-${run.lane}-run.log`);
}
console.log(JSON.stringify(receipt, null, 2));
