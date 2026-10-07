import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";

const resolveInstalled = createRequire(import.meta.url).resolve;
const pinnedVersion = "0.1.0";

// Resolve from the provisioned toolchain, never a global executable or a download.
export function resolveNativeCompiler({resolvePackage = resolveInstalled,
  platform = process.platform, architecture = process.arch} = {}) {
  const target = `${platform}-${architecture}`;
  const fail = message => { throw new Error(`E_TYPESCRIPT_COMPILER: ${message}`); };
  if (!["darwin-arm64", "linux-x64"].includes(target))
    fail(`tsc-rs ${pinnedVersion} does not support ${target}; use macOS arm64 or Linux x64`);
  const platformPackage = `@tsc-rs/${target}`;
  let metadata, nativeMetadata, nativeRoot;
  try {
    metadata = JSON.parse(fs.readFileSync(resolvePackage("tsc-rs/package.json"), "utf8"));
    const nativePackage = resolvePackage(`${platformPackage}/package.json`);
    nativeMetadata = JSON.parse(fs.readFileSync(nativePackage, "utf8"));
    nativeRoot = path.dirname(nativePackage);
  } catch (error) {
    fail(`install the locked tsc-rs and ${platformPackage} packages, including optional dependencies (${error.message})`);
  }
  if (metadata.version !== pinnedVersion || nativeMetadata.version !== pinnedVersion)
    fail(`expected tsc-rs and ${platformPackage} ${pinnedVersion}; reinstall the locked toolchain`);
  if (typeof metadata.tscVersion !== "string" || !metadata.tscVersion)
    fail("tsc-rs is missing its TypeScript compiler version metadata; reinstall the locked toolchain");
  const executable = path.join(nativeRoot, "lib", "tsc");
  try { fs.accessSync(executable, fs.constants.X_OK); }
  catch { fail(`native executable is missing or not executable: ${executable}; reinstall the locked toolchain`); }
  return {executable, packageVersion: metadata.version,
    typescriptVersion: metadata.tscVersion, platformPackage};
}
