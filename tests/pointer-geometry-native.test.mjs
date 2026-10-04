import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = filename => createHash("sha256").update(readFileSync(path.join(root, filename))).digest("hex");
function runWitness(binary, expectedSource) {
  const result = spawnSync(path.join(root, ".deps/build", binary), [], {encoding: "utf8", timeout: 30000});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(path.join(root, "build", binary + ".log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, log);
  assert.equal(result.signal, null, log);
  const line = result.stdout.split("\n").find(value => value.startsWith("{"));
  assert.ok(line, "Native witness must emit its structured acceptance and actual geometry: " + log);
  const acceptance = JSON.parse(line);
  assert.equal(acceptance.count, 108);
  assert.equal(new Set(acceptance.checks).size, acceptance.count);
  assert.match(log, /POINTER_GEOMETRY_PASSED 108/);
  assert.equal(acceptance.source, expectedSource);
  assert.equal(acceptance.geometryProjectionInstalled, false);
  assert.equal(acceptance.cases.length, 4);
  assert.equal(acceptance.cases.filter(value => value.upstreamLimitation).length, 3);
  return {...acceptance, status: result.status, signal: result.signal};
}

test("original and overlaid RN preserve the same unprojected capture geometry limitation", () => {
  mkdirSync(path.join(root, "build"), {recursive: true});
  const overlaid = runWitness("pointer_geometry_test", "lifetime-overlay-without-geometry-projection");
  // Both unchanged implementation units and their original header layout are
  // compiled together; do not mix an original binding with an overlaid class.
  const compilation = spawnSync(path.join(root, ".deps/python/bin/cmake"),
    ["--build", ".deps/build", "--target", "pointer_geometry_original_test", "--parallel", "4"],
    {cwd: root, encoding: "utf8", timeout: 180000});
  const log = (compilation.stdout ?? "") + (compilation.stderr ?? "");
  writeFileSync(path.join(root, "build/pointer-geometry-original-build.log"), log);
  assert.equal(compilation.error, undefined, log);
  assert.equal(compilation.status, 0, log);
  const original = runWitness("pointer_geometry_original_test", "unchanged-original-processor-and-binding");
  assert.deepEqual(overlaid.checks, original.checks);
  assert.deepEqual(overlaid.cases, original.cases,
    "Without a native projection hook, lifetime guards must not masquerade as a coordinate fix");
  const originals = ".deps/package/ReactCommon/react/renderer/uimanager/";
  const generated = ".deps/build/rn-pointer-overlay/react/renderer/uimanager/";
  const sources = ["native/pointer_geometry_test.cpp", "tests/pointer-geometry-native.test.mjs", "scripts/rn-pointer-overlay.mjs", "native/CMakeLists.txt",
    ...["PointerEventsProcessor.h", "PointerEventsProcessor.cpp", "UIManagerBinding.h", "UIManagerBinding.cpp"]
      .flatMap(filename => [originals + filename, generated + filename])];
  writeFileSync(path.join(root, "build/pointer-geometry-report.json"), JSON.stringify({
    scenario: "pointer-geometry-upstream-witness", reactNative: "0.87.1", platform: process.platform, architecture: process.arch,
    overlaid, original, provenance: {node: process.version,
      sources: Object.fromEntries(sources.map(filename => [filename, sha(filename)])),
      overlaidBinarySha256: sha(".deps/build/pointer_geometry_test"),
      originalBinarySha256: sha(".deps/build/pointer_geometry_original_test")},
    limitations: [
      "This fixture verifies original RN capture order and its incomplete unprojected numerical behavior; it does not prove the Godot fix",
      "Native root embeddings are independently declared hypothetical geometry because RN shadow trees contain no Godot Control or Window",
      "Physical targets are supplied directly to the portable processor; this is not native hit-testing, hardware, mobile or window parity evidence",
    ]}, null, 2) + "\n");
});
