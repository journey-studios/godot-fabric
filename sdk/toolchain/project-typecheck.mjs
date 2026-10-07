import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {prepareProjectResolution} from "./project-resolution.mjs";
import {formatNativeDiagnostics} from "./native-typecheck.mjs";

// Native tsc-rs checking with module lookup scoped to the importing owner.
// No program emit, package installation, project scripts, or config JS runs.
export function checkProjectTypes({project, sdk, expectedConfigFingerprint}) {
  project = fs.realpathSync(project);
  sdk = fs.realpathSync(sdk);
  const filename = path.join(project, "package.json");
  const dependencies = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, "utf8")) : {};
  const sdkRequire = createRequire(path.join(sdk, "toolchain/package.json"));
  const resolution = prepareProjectResolution({project, sdk, dependencies, resolveSdk: id => sdkRequire.resolve(id)});
  if (expectedConfigFingerprint !== undefined && expectedConfigFingerprint !== resolution.configFingerprint)
    throw new Error("E_PROJECT_CONFIG_CHANGED: typecheck configuration differs from the builder's preflight");
  const result = resolution.checkTypes();
  resolution.assertUnchanged();
  return {...result, configFingerprint: resolution.configFingerprint};
}

function main() {
  const [project, sdk, expectedConfigFingerprint, ...extra] = process.argv.slice(2);
  if (!project || !sdk || extra.length) throw new Error("Expected project, SDK and optional config fingerprint");
  const result = checkProjectTypes({project, sdk, expectedConfigFingerprint});
  if (result.diagnostics.length) process.stdout.write(formatNativeDiagnostics(result.diagnostics, {
    getCanonicalFileName: filename => filename, getCurrentDirectory: () => project, getNewLine: () => "\n",
  }));
  if (result.errorCount) process.exitCode = 1;
}
// Canonicalize symlink spellings before deciding whether this is the CLI entry.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
