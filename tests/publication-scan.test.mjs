import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scan } from "../scripts/publication-scan.mjs";

test("publication rejects private game references, local paths and credential-shaped fixtures", () => {
  const root = mkdtempSync(path.join(tmpdir(), "publication-scan-"));
  try {
    for (const content of ["apps/private-example/scenario/data.json", "/Users/example/project", "ghp_" + "x".repeat(36)]) {
      writeFileSync(path.join(root, "fixture.txt"), content);
      const result = scan(root);
      assert.equal(result.passed, false);
      assert.equal(result.failures[0].file, "fixture.txt");
    }
    writeFileSync(path.join(root, "fixture.txt"), "Generic React UI example for Godot Fabric");
    assert.equal(scan(root).passed, true);
  } finally {
    rmSync(root, { recursive: true });
  }
});
