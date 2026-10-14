import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES as variants} from "../tests/js-errors-sabotages.mjs";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of the error path slice (GF-05 slice C). tests/js-errors-sabotages.mjs says what each breaks. A sabotage of the
// bundle (no-error-guard, no-setup) is an override in memory (scripts/js-errors-bundle.mjs): no file is edited, which the receipt proves by
// the hash of every guarded file before and after. A sabotage of the host breaks one line of native/application_runtime.cpp, rebuilds the
// host, keeps that host in the variant's hostDirectory and puts the source back byte for byte (scripts/sabotage-sources.mjs, which also
// restores it when a signal ends the run); the genuine host is rebuilt at the end and must be the one it started with. Each lane runs
// tests/js-errors-native.test.mjs --sabotage=<name>, and the probe's checks and the independent oracle must both reject it. The current lane
// runs last, so that its comparison (build/js-errors-comparison.json) holds every sabotage. The control on the previous host is run by hand,
// with that host in addons/: node tests/js-errors-native.test.mjs --allow-original-negative. Run with:
//   node scripts/js-errors-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const host = path.join(root, "addons/fabric_godot.dylib");
const cmake = path.join(root, ".deps/python/bin/cmake");
const digest = content => createHash("sha256").update(content).digest("hex");
const sha = async file => digest(await readFile(file));
const files = [...new Set(variants.filter(variant => variant.host === true).map(variant => variant.file))];
const sources = guardSources(root, files);
const testArguments = argument => ["tests/js-errors-native.test.mjs", ...(argument === null ? [] : [argument])];

async function build(name) {
  const result = await sources.run(cmake, ["--build", ".deps/build", "--parallel", "4", "--target", "fabric_godot"]);
  await writeFile(path.join(root, `build/js-errors-sabotage-${name}-build.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `The ${name} host must build: build/js-errors-sabotage-${name}-build.log`);
}

async function lane(name, argument) {
  const result = await sources.run(process.execPath, testArguments(argument));
  await writeFile(path.join(root, `build/js-errors-${name}-run.log`), result.stdout + result.stderr);
  const report = JSON.parse(await readFile(path.join(root, `build/js-errors-${name}-report.json`), "utf8"));
  return {lane: name, argument, status: result.status, checks: report.checks.length,
    failures: report.checks.filter(row => !row.passed).map(row => row.name), bundleSha256: report.provenance.bundle.bundle.sha256,
    nativeHostSha256: report.provenance.nativeHostSha256};
}

const receipt = {format: "godot-fabric.js-errors-sabotage/v1", sourceSha256: {genuine: sources.genuine}, variants: []};
// The genuine host first, so the restored one can be compared to it.
await build("genuine");
receipt.hostSha256 = {genuine: await sha(host)};
try {
  for (const variant of variants.filter(entry => entry.host !== true)) {
    receipt.variants.push({name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, host: false,
      ...await lane(`sabotage-${variant.name}`, `--sabotage=${variant.name}`)});
  }
  for (const variant of variants.filter(entry => entry.host === true)) {
    try {
      const broken = sources.sabotaged(variant);
      const entry = {name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, host: true, sourceSha256: digest(broken)};
      sources.swap(variant.file, broken);
      await build(variant.name);
      assert.notEqual(await sha(host), receipt.hostSha256.genuine, `The ${variant.name} host differs from the genuine one`);
      await mkdir(path.join(root, variant.hostDirectory), {recursive: true});
      await copyFile(host, path.join(root, variant.hostDirectory, "fabric_godot.dylib"));
      Object.assign(entry, await lane(`sabotage-${variant.name}`, `--sabotage=${variant.name}`));
      receipt.variants.push(entry);
    } finally {
      sources.restore();
    }
  }
} finally {
  receipt.sourceSha256.restored = sources.restore();
  await build("restored");
  receipt.hostSha256.restored = await sha(host);
}
assert.equal(receipt.hostSha256.restored, receipt.hostSha256.genuine, "The rebuilt host is the genuine one");
receipt.current = await lane("current", null);
await writeFile(path.join(root, "build/js-errors-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.status, 0, `The probe and the oracle must reject the ${entry.name} lane: build/js-errors-sabotage-${entry.name}-run.log`);
  assert.ok(entry.failures.length > 0, `${entry.name} fails at least one check`);
}
assert.equal(receipt.current.status, 0, "The current lane passes: build/js-errors-current-run.log");
console.log(JSON.stringify(receipt, null, 2));
