import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withoutGitLocation } from "../scripts/git-environment.mjs";
import { scan } from "../scripts/publication-scan.mjs";

function git(directory, ...args) {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8", env: withoutGitLocation() });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr || result.error}`);
}

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

test("a checkout publishes tracked and unignored untracked files, never ignored ones", () => {
  const root = mkdtempSync(path.join(tmpdir(), "publication-git-"));
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  try {
    git(root, "init", "-q");
    write(".gitignore", "reports/\n");
    write(".git/info/exclude", ".openqodex/\n");
    write(".openqodex/reviews/latest/report.html", "/Users/example/worktree");
    write("reports/run.json", "/Users/example/worktree");
    write("tracked.txt", "/Users/example/worktree");
    write("gone.txt", "Generic React UI example for Godot Fabric");
    git(root, "add", "tracked.txt", "gone.txt");
    rmSync(path.join(root, "gone.txt"));
    write("untracked.txt", "/private/var/project");
    git(root, "init", "-q", "nested");
    write("nested/notes.txt", "Generic React UI example for Godot Fabric");
    const result = scan(root);
    assert.equal(result.passed, false);
    assert.deepEqual(result.failures.map((failure) => failure.file).sort(), ["tracked.txt", "untracked.txt"]);
    // .gitignore, tracked.txt and untracked.txt; the deleted index entry and the nested repository carry no file.
    assert.equal(result.files, 3);
    // Without git the walk falls back to every folder outside the fixed exclusions, ignored ones included.
    rmSync(path.join(root, ".git"), { recursive: true });
    rmSync(path.join(root, "nested"), { recursive: true });
    assert.deepEqual(scan(root).failures.map((failure) => failure.file).sort(), [".openqodex/reviews/latest/report.html", "reports/run.json", "tracked.txt", "untracked.txt"]);
  } finally {
    rmSync(root, { recursive: true });
  }
});
