import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = filename => createHash("sha256").update(readFileSync(path.join(root, filename))).digest("hex");

test("native pointer processor preserves original negotiation and survives retained target deletion and reentrant retirement", () => {
  mkdirSync(path.join(root, "build"), {recursive: true});
  const positive = spawnSync(path.join(root, ".deps/build/pointer_processor_test"), [],
    {encoding: "utf8", timeout: 30000});
  const log = (positive.stdout ?? "") + (positive.stderr ?? "");
  writeFileSync(path.join(root, "build/pointer-processor.log"), log);
  assert.equal(positive.error, undefined, log);
  assert.equal(positive.status, 0, log);
  assert.match(log, /POINTER_PROCESSOR_PASSED 144/);
  const acceptance = JSON.parse(positive.stdout.split("\n").find(line => line.startsWith('{"count"')));
  assert.equal(acceptance.count, 144);
  assert.equal(new Set(acceptance.checks).size, 144);
  // Build both original processor and binding against the original header
  // layout; no original/overlaid constructor or destructor is mixed by ODR.
  const compilation = spawnSync(path.join(root, ".deps/python/bin/cmake"),
    ["--build", ".deps/build", "--target", "pointer_processor_original_negative_test", "--parallel", "4"],
    {cwd: root, encoding: "utf8", timeout: 180000});
  const compilationLog = (compilation.stdout ?? "") + (compilation.stderr ?? "");
  writeFileSync(path.join(root, "build/pointer-processor-negative-build.log"), compilationLog);
  assert.equal(compilation.error, undefined, compilationLog);
  assert.equal(compilation.status, 0, compilationLog);
  const negative = spawnSync(path.join(root, ".deps/build/pointer_processor_original_negative_test"), [],
    {encoding: "utf8", timeout: 30000});
  const negativeLog = (negative.stdout ?? "") + (negative.stderr ?? "");
  writeFileSync(path.join(root, "build/pointer-processor-original-negative.log"), negativeLog);
  assert.equal(negative.error, undefined, negativeLog);
  assert.match(negativeLog, /RETAINED_CAPTURE_TARGET_WITHOUT_NEWEST_CLONE/,
    "The original-source failure must reach the retained removed capture target, not fail startup");
  assert.ok(["SIGSEGV", "SIGBUS"].includes(negative.signal),
    "Original RN must reproduce its null-newest-clone crash in the same deletion fixture: " + JSON.stringify(negative));
  const listenerNegative = spawnSync(path.join(root, ".deps/build/pointer_processor_original_negative_test"), ["listener-fault"],
    {encoding: "utf8", timeout: 30000});
  const listenerLog = (listenerNegative.stdout ?? "") + (listenerNegative.stderr ?? "");
  writeFileSync(path.join(root, "build/pointer-processor-original-listener-negative.log"), listenerLog);
  assert.equal(listenerNegative.error, undefined, listenerLog);
  assert.match(listenerLog, /ORIGINAL_LISTENER_FAULT_WITH_MOVED_HOVER_TRACKER/);
  assert.ok(["SIGSEGV", "SIGBUS"].includes(listenerNegative.signal), "Original listener fault must reproduce the next-sample hover crash");
  const original = ".deps/package/ReactCommon/react/renderer/uimanager/";
  const generated = ".deps/build/rn-pointer-overlay/react/renderer/uimanager/";
  const sources = ["native/pointer_processor_test.cpp", "scripts/rn-pointer-overlay.mjs", "native/CMakeLists.txt",
    ...["PointerEventsProcessor.h", "PointerEventsProcessor.cpp", "UIManagerBinding.h", "UIManagerBinding.cpp"]
      .flatMap(filename => [original + filename, generated + filename])];
  writeFileSync(path.join(root, "build/pointer-processor-report.json"), JSON.stringify({
    scenario: "pointer-processor", reactNative: "0.87.1", platform: process.platform, architecture: process.arch,
    positive: {...acceptance, status: positive.status},
    originalNegative: {status: negative.status, signal: negative.signal, reachedRemovedTarget: true,
      processorAndBinding: "unchanged downloaded sources, original include precedence"},
    originalListenerNegative: {status: listenerNegative.status, signal: listenerNegative.signal, reachedMovedHoverTracker: true,
      processorAndBinding: "unchanged downloaded sources, original include precedence"},
    provenance: {node: process.version, sources: Object.fromEntries(sources.map(filename => [filename, sha(filename)])),
      positiveBinarySha256: sha(".deps/build/pointer_processor_test"),
      negativeBinarySha256: sha(".deps/build/pointer_processor_original_negative_test")},
    limitations: ["Portable native processor fixture; not Godot input, hardware or mobile parity evidence"]}, null, 2) + "\n");
});
