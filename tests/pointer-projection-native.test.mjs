import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = filename => createHash("sha256").update(readFileSync(path.join(root, filename))).digest("hex");

test("real Hermes binding retains immutable pointer sources and isolates native projection faults", () => {
  mkdirSync(path.join(root, "build"), {recursive: true});
  const result = spawnSync(path.join(root, ".deps/build/pointer_projection_test"), [],
    {encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(path.join(root, "build/pointer-projection.log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, log);
  assert.equal(result.signal, null, log);
  assert.doesNotMatch(log, /POINTER_PROJECTION_FAILED|Program crashed|Segmentation fault/);
  const line = result.stdout.split("\n").find(value => value.startsWith("{"));
  assert.ok(line, "Binding witness must emit executed checks and actual public payloads: " + log);
  const acceptance = JSON.parse(line);
  assert.equal(acceptance.count, acceptance.checks.length);
  assert.ok(acceptance.count >= 100, "Result must contain executed payload, metadata and fault checks");
  assert.equal(new Set(acceptance.checks).size, acceptance.count);
  assert.ok(log.includes("POINTER_PROJECTION_PASSED " + acceptance.count));
  assert.equal(acceptance.retargetedCopySeen, true);
  assert.equal(acceptance.nativeFaultObserved, true);
  assert.equal(acceptance.jsFaultObserved, true);
  assert.deepEqual([...new Set(acceptance.projections.map(value => value.origin))].sort((a, b) => a - b), [1, 11]);
  const interleaved = acceptance.deliveries.filter(value => value.type === "topPointerMove" && value.serial >= 3 && value.serial <= 6);
  assert.deepEqual(interleaved.map(value => [value.serial, value.origin, value.payload.target]),
    [[3, 1, 14], [4, 11, 4], [5, 1, 14], [6, 11, 4]], "Each retained raw sample keeps its own metadata");
  const original = ".deps/package/ReactCommon/react/renderer/";
  const generated = ".deps/build/rn-pointer-overlay/react/renderer/uimanager/";
  const sources = ["native/pointer_projection_test.cpp", "tests/pointer-projection-native.test.mjs",
    "scripts/rn-pointer-overlay.mjs", "native/CMakeLists.txt", "native/pointer_geometry_history.h",
    original + "core/EventQueueProcessor.cpp", original + "core/EventTarget.cpp",
    ...["PointerEventsProcessor.h", "PointerEventsProcessor.cpp", "UIManagerBinding.h", "UIManagerBinding.cpp"]
      .flatMap(filename => [original + "uimanager/" + filename, generated + filename])];
  writeFileSync(path.join(root, "build/pointer-projection-report.json"), JSON.stringify({
    scenario: "pointer-binding-projection", reactNative: "0.87.1", platform: process.platform, architecture: process.arch,
    ...acceptance, provenance: {node: process.version, binarySha256: sha(".deps/build/pointer_projection_test"),
      sources: Object.fromEntries(sources.map(filename => [filename, sha(filename)]))},
    limitations: [
      "Injected portable projection callback does not execute Godot affine geometry or input hardware",
      "Original EventQueueProcessor flushes retained RawEvent batches; EventQueue enqueue/coalescing is not exercised",
      "Custom envelope is fixture-owned; public native example proves the production GodotPointerEvent path separately",
      "History serial ordering is a direct semantic check of the host helper, not an executed EventQueue coalescing claim",
    ]}, null, 2) + "\n");
});
