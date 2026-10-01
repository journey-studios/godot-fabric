import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The release contains only this project's reviewed sources and generic demos.
// Generated outputs and downloaded third-party code never enter the Git payload.
const forbidden = [
  /\/Users\//i, /\/private\//i, /[A-Z]:\\Users\\/i,
  /github\.com\/journey-studios\/(?!godot-fabric(?:[./?#]|$))/i,
  /\bapps\/[^/\s]+\/(?:src|scenario|docs)\//i,
  /agent_docs\//i, /docs\/domains\//i, /vision\/EV-/i,
  /dash\.cloudflare\.com/i,
  /gh[pousr]_[a-zA-Z0-9]{30,}/, /github_pat_[a-zA-Z0-9_]{30,}/,
  /AKIA[A-Z0-9]{16}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[=:]\s*["'][^"']{12,}["']/i,
];
const excluded = new Set([".git", ".deps", ".godot", ".fallow", "build", "node_modules", "addons", ".venv", "__pycache__"]);
const binaryExtensions = new Set([".ttf", ".png"]);
export function scan(root) {
  const failures = [];
  let files = 0;
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !excluded.has(entry.name)) visit(path.join(directory, entry.name));
      if (entry.isSymbolicLink()) {
        failures.push({ file: path.relative(root, path.join(directory, entry.name)), pattern: "unreviewed symlink" });
        continue;
      }
      if (!entry.isFile() || /\.(?:uid|import)$/.test(entry.name) || entry.name === ".DS_Store") continue;
      const filename = path.join(directory, entry.name);
      const relative = path.relative(root, filename).split(path.sep).join("/");
      ++files;
      if (relative === "scripts/publication-scan.mjs" || relative === "tests/publication-scan.test.mjs" || binaryExtensions.has(path.extname(filename))) continue;
      const source = readFileSync(filename, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(source)) failures.push({ file: relative, pattern: pattern.source });
      }
    }
  }
  visit(root);
  return { passed: failures.length === 0, files, failures };
}
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const result = scan(path.dirname(path.dirname(self)));
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
