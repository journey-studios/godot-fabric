import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scan } from "../scripts/publication-scan.mjs";

test("publication rejects private game references, local paths and credential-shaped fixtures", () => {
  const root = mkdtempSync(path.join(tmpdir(), "publication-scan-"));
  try {
    for (const content of ["apps/private-example/scenario/data.json", "/Users/example/project", "/private/var/project", "file:///private/var/project", "file://localhost/private/var/project", "ghp_" + "x".repeat(36)]) {
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

test("worktree metadata and relative upstream declaration paths are not private OS paths", () => {
  const root = mkdtempSync(path.join(tmpdir(), "publication-worktree-"));
  try {
    writeFileSync(path.join(root, ".git"), "gitdir: /Users/example/worktree-metadata");
    writeFileSync(path.join(root, "inventory.json"), JSON.stringify({ source: "types_generated/src/private/dom/ReactNativeElement.d.ts" }));
    const result = scan(root);
    assert.equal(result.passed, true);
    assert.equal(result.files, 1);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("encoded file URLs cannot hide private paths while public paths remain valid", () => {
  const root = mkdtempSync(path.join(tmpdir(), "publication-url-"));
  try {
    for (const content of ["file:///%70rivate/var/project", "file://localhost/%55sers/example/project", "file:///opt/../%70rivate/var/project", "file:///C:/%55sers/example/project", "file:///opt/%ZZ"]) {
      writeFileSync(path.join(root, "fixture.txt"), content);
      const result = scan(root);
      assert.equal(result.passed, false, content);
      assert.equal(result.failures[0].file, "fixture.txt");
    }
    for (const content of ["file:///opt/shared/icons%20large.png", "file://localhost/opt/public/../shared/icon.png", "file:///opt/%70rivate/icon.png", "file:///%2570rivate/var/project"]) {
      writeFileSync(path.join(root, "fixture.txt"), content);
      assert.equal(scan(root).passed, true, content);
    }
  } finally {
    rmSync(root, { recursive: true });
  }
});
