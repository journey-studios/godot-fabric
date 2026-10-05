import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { examples, exampleOptions } from "../scripts/examples-catalog.mjs";

test("catalog routes every example to a real documented source and scene", () => {
  assert.equal(new Set(examples.map(({ id }) => id)).size, examples.length);
  for (const entry of examples) {
    assert.match(entry.id, /^[a-z]+(?:-[a-z]+)*$/);
    assert.ok(["public", "internal", "mixed"].includes(entry.api));
    for (const path of [entry.source, entry.scene, `examples/${entry.id}/README.md`])
      assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path);
    assert.equal(exampleOptions([entry.id]).example, entry);
  }
});
test("interactive and bounded modes select the same scene", () => {
  assert.equal(exampleOptions([]).example.id, "counter");
  assert.equal(exampleOptions(["layout"]).check, false);
  for (const mode of ["--check", "--headless", "--capture"]) {
    const options = exampleOptions([mode, "layout"]);
    assert.equal(options.example.id, "layout");
    assert.equal(options.check, true);
    assert.equal(options.headless, mode === "--headless");
    assert.equal(options.capture, mode === "--capture");
  }
});
test("list and help need no native setup", () => {
  assert.deepEqual(exampleOptions(["--list"]), { list: true });
  assert.deepEqual(exampleOptions(["--help"]), { list: true });
});
test("typos, multiple scenes and invalid capture modes fail before launch", () => {
  assert.throws(() => exampleOptions(["typo"]), /Unknown example/);
  assert.throws(() => exampleOptions(["--captuer"]), /Unknown example option/);
  assert.throws(() => exampleOptions(["react", "layout"]), /one example/);
  assert.throws(() => exampleOptions(["--capture", "--headless"]), /native window/);
  assert.throws(() => exampleOptions(["parity", "--capture"]), /does not capture/);
});
