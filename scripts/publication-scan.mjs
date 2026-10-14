import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withoutGitLocation } from "./git-environment.mjs";

// The release contains only this project's reviewed sources and generic demos.
// Generated outputs and downloaded third-party code never enter the Git payload.
const forbidden = [
  /\/Users\//i, /(?<![\w.-])\/private\//i, /[A-Z]:\\Users\\/i,
  /file:\/\/[^/\s"'<>]*\/private\//i,
  /github\.com\/journey-studios\/(?!godot-fabric(?:[./?#]|$))/i,
  /\bapps\/[^/\s]+\/(?:src|scenario|docs)\//i,
  /agent_docs\//i, /docs\/domains\//i, /vision\/EV-/i,
  /dash\.cloudflare\.com/i,
  /gh[pousr]_[a-zA-Z0-9]{30,}/, /github_pat_[a-zA-Z0-9_]{30,}/,
  /AKIA[A-Z0-9]{16}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[=:]\s*["'][^"']{12,}["']/i,
];
// Outside a git checkout the scan walks the tree and skips these generated and downloaded folders.
const excluded = new Set([".git", ".deps", ".godot", ".fallow", "build", "node_modules", "addons", ".venv", "__pycache__"]);
const binaryExtensions = new Set([".ttf", ".png"]);
// The files git would publish from a checkout: tracked ones and untracked ones that no ignore rule drops
// (.gitignore, .git/info/exclude, core.excludesFile). Null when root is not the top of a git work tree.
function publishedFiles(root) {
  const options = { cwd: root, encoding: "utf8", env: withoutGitLocation(), maxBuffer: 64 * 1024 * 1024 };
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], options);
  if (top.status !== 0 || realpathSync(top.stdout.trim()) !== realpathSync(root)) return null;
  const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], options);
  if (listed.status !== 0) throw new Error(`git ls-files failed in ${root}: ${listed.stderr || listed.error}`);
  // A path in conflict is listed once per stage.
  return [...new Set(listed.stdout.split("\0").filter(Boolean))];
}
export function scan(root) {
  const failures = [];
  let files = 0;
  function check(filename, entry) {
    const relative = path.relative(root, filename).split(path.sep).join("/");
    if (entry.isSymbolicLink()) {
      failures.push({ file: relative, pattern: "unreviewed symlink" });
      return;
    }
    const name = path.basename(filename);
    if (!entry.isFile() || /\.(?:uid|import)$/.test(name) || name === ".DS_Store") return;
    ++files;
    if (relative === "scripts/publication-scan.mjs" || relative === "tests/publication-scan.test.mjs" || binaryExtensions.has(path.extname(filename))) return;
    const source = readFileSync(filename, "utf8");
    const candidates = [source];
    for (const match of source.matchAll(/file:\/\/[^\s"'<>`]+/gi)) {
      try {
        const decoded = decodeURIComponent(new URL(match[0]).pathname);
        candidates.push(path.posix.normalize(decoded.replaceAll("\\", "/")));
      } catch {
        failures.push({ file: relative, pattern: "invalid file URL" });
      }
    }
    for (const pattern of forbidden) {
      if (candidates.some((candidate) => pattern.test(candidate))) failures.push({ file: relative, pattern: pattern.source });
    }
  }
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      // Git metadata is not a publication payload, including worktree pointers.
      if (directory === root && entry.name === ".git") continue;
      if (entry.isDirectory() && !excluded.has(entry.name)) visit(path.join(directory, entry.name));
      check(path.join(directory, entry.name), entry);
    }
  }
  const published = publishedFiles(root);
  if (!published) visit(root);
  for (const relative of published ?? []) {
    // A tracked file deleted from disk has nothing to read, and a nested repository
    // (listed as `dir/`) or a submodule is a directory whose content this repository does not carry.
    const filename = path.join(root, relative);
    const entry = lstatSync(filename, { throwIfNoEntry: false });
    if (entry) check(filename, entry);
  }
  return { passed: failures.length === 0, files, failures };
}
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const result = scan(path.dirname(path.dirname(self)));
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
