import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp, readFile, writeFile, mkdir, access, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { verifyNativeSdk } from "./native-sdk.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const lock = JSON.parse(await readFile(path.join(root, "dependencies.json"), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isNativeInput = file => /^native\/[^/]+\.(?:cpp|h)$/.test(file)
  || ["native/CMakeLists.txt", "native/godot-profile.json", "scripts/rn-pointer-overlay.mjs", "dependencies.json"].includes(file);
function nativeFailure(code, message) {
  const error = new Error(code + ": " + message);
  error.code = code;
  throw error;
}
export async function verifyAddonNativeInputs({sourceRoot = root, nativeSdk = null} = {}) {
  let receipt, sources, nativeCombination, nativeHashes;
  const host = nativeSdk ? path.join(nativeSdk, "lib/fabric_godot.dylib") : path.join(sourceRoot, "addons/fabric_godot.dylib");
  if (nativeSdk) {
    // Package integrity alone does not establish compatibility with today's JS host seam.
    verifyNativeSdk(nativeSdk);
    nativeCombination = JSON.parse(await readFile(path.join(nativeSdk, "native-combination.json"), "utf8"));
    receipt = JSON.parse(await readFile(path.join(nativeSdk, "receipt.json"), "utf8"));
    const sourceLock = JSON.parse(await readFile(path.join(sourceRoot, "dependencies.json"), "utf8"));
    if (receipt.nativeHostBuildRecorded !== true || nativeCombination.purpose !== "build-declaration"
        || nativeCombination.reactNativeVersion !== sourceLock["react-native"].version
        || nativeCombination.hermesVersion !== sourceLock.hermes.version || nativeCombination.godotVersion !== sourceLock.godot.version
        || nativeCombination.godotCppRevision !== sourceLock["godot-cpp"].commit
        || nativeCombination.target.platform !== "macos" || nativeCombination.target.architecture !== "arm64"
        || nativeCombination.target.configuration !== "Release")
      throw new Error("Native SDK must record the matching macOS arm64 Release host/dependency build; test fixtures cannot provision an addon");
    sources = receipt.sourceSha256;
    nativeHashes = {host: receipt.hostSha256, hermes: nativeCombination.hermesRuntimeSha256,
      dependencies: nativeCombination.nativeDependencies.find(dependency => dependency.name === "rn-dependencies")?.sha256};
    if (nativeHashes.host !== nativeCombination.nativeDependencies.find(dependency => dependency.name === "fabric_godot")?.sha256)
      nativeFailure("SDK_HOST_BINARY_MISMATCH", "host receipt differs from the verified SDK combination; rebuild and repack the native SDK");
  } else {
    const filename = path.join(sourceRoot, ".deps/build/native-sdk-build.json");
    try { receipt = JSON.parse(await readFile(filename, "utf8")); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      nativeFailure("SDK_HOST_RECEIPT_MISSING", "rebuild the macOS arm64 Release host with setup/CMake to record .deps/build/native-sdk-build.json, or supply a matching --native-sdk package");
    }
    if (receipt.format !== "godot-fabric.experimental-native-sdk-build/v1" || receipt.nativeHostBuildRecorded !== true
        || receipt.inputs?.format !== "godot-fabric.experimental-native-sdk-inputs/v1"
        || receipt.inputs.target?.platform !== "macos" || receipt.inputs.target?.architecture !== "arm64"
        || receipt.inputs.target?.configuration !== "Release" || receipt.host?.source !== "addons/fabric_godot.dylib")
      nativeFailure("SDK_HOST_RECEIPT_INVALID", "require a recorded macOS arm64 Release host; rebuild with setup/CMake or supply a matching --native-sdk package");
    sources = receipt.inputs.sourceSha256;
    nativeHashes = {host: receipt.host.sha256,
      hermes: receipt.inputs.dependencies?.find(dependency => dependency.name === "hermes")?.sha256,
      dependencies: receipt.inputs.dependencies?.find(dependency => dependency.name === "rn-dependencies")?.sha256};
  }
  const files = (await readdir(path.join(sourceRoot, "native"))).map(name => "native/" + name).filter(isNativeInput);
  files.push("scripts/rn-pointer-overlay.mjs", "dependencies.json");
  const recordedFiles = Object.keys(sources ?? {}).filter(isNativeInput).sort();
  if (JSON.stringify(files.sort()) !== JSON.stringify(recordedFiles))
    nativeFailure("SDK_HOST_SOURCE_MISMATCH", "native source/header inputs were added, removed or missing from the host receipt; rebuild and repack the matching native host");
  for (const file of files) {
    if (sources[file] !== hash(await readFile(path.join(sourceRoot, file))))
      nativeFailure("SDK_HOST_SOURCE_MISMATCH", file + " differs from the native host receipt; rebuild and repack the matching native host");
  }
  if (Object.values(nativeHashes).some(value => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)))
    nativeFailure("SDK_HOST_RECEIPT_INVALID", "native host/dependency hashes are missing; rebuild and repack the matching native host");
  const frameworkRoot = nativeSdk ? path.join(nativeSdk, "lib/frameworks") : path.join(sourceRoot, "addons/frameworks");
  for (const [filename, expected] of [[host, nativeHashes.host],
    [path.join(frameworkRoot, "hermesvm.framework/hermesvm"), nativeHashes.hermes],
    [path.join(frameworkRoot, "ReactNativeDependencies.framework/ReactNativeDependencies"), nativeHashes.dependencies]]) {
    if (hash(await readFile(filename)) !== expected)
      nativeFailure("SDK_HOST_BINARY_MISMATCH", path.relative(sourceRoot, filename) + " differs from its native build receipt; rebuild and repack the matching native host");
  }
  return {nativeCombination, nativeHashes};
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 180000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr);
  return result.stdout.trim();
}
async function main() {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Addon provisioning currently supports macOS arm64 only");
  const [outputArg, ...options] = process.argv.slice(2);
  if (options.length && (options.length !== 2 || options[0] !== "--native-sdk" || !options[1]))
    throw new Error("Expected output directory and optional --native-sdk VERIFIED_PACKAGE");
  const nativeSdk = options.length ? path.resolve(options[1]) : null;
  const {nativeHashes} = await verifyAddonNativeInputs({nativeSdk});
  const output = path.resolve(outputArg ?? path.join(root, "build", "sdk", "godot_fabric"));
  if (existsSync(output)) throw new Error("Use a new output directory; existing addon files are preserved");
  await access(path.join(root, "node_modules/typescript/bin/tsc"));
  await access(nativeSdk ? path.join(nativeSdk, "lib/fabric_godot.dylib") : path.join(root, "addons/fabric_godot.dylib"));
  await access(nativeSdk ? path.join(nativeSdk, "lib/frameworks/hermesvm.framework") : path.join(root, "addons/frameworks/hermesvm.framework"));
  const archive = path.join(root, ".deps", `node-v${lock.node.version}-darwin-arm64.tar.gz`);
  if (!existsSync(archive)) run("curl", ["--fail", "--location", "--retry", "2", "--max-time", "180", lock.node.url, "--output", archive]);
  if (hash(await readFile(archive)) !== lock.node.sha256) throw new Error("Private Node archive checksum mismatch");
  const node = path.join(root, ".deps", `node-v${lock.node.version}-darwin-arm64`);
  if (!existsSync(node)) run("tar", ["-xzf", archive, "-C", path.join(root, ".deps")]);
  if (run(path.join(node, "bin", "node"), ["--version"]) !== "v" + lock.node.version) throw new Error("Private Node version mismatch");
  await mkdir(output, { recursive: true });
  for (const [from, to] of [
    ["sdk/addon", ""], ["sdk/toolchain", "toolchain"], ["src", "src"],
    ["types", "types"], ["assets/fonts", "assets/fonts"],
    [nativeSdk ? path.join(nativeSdk, "lib/fabric_godot.dylib") : "addons/fabric_godot.dylib", "native/fabric_godot.dylib"],
    [nativeSdk ? path.join(nativeSdk, "lib/frameworks") : "addons/frameworks", "native/frameworks"], ["node_modules", "toolchain/node_modules"],
    ["package.json", "toolchain/package.json"], ["package-lock.json", "toolchain/package-lock.json"],
    ["LICENSE", "LICENSE"], ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
    [".deps/hermes/LICENSE", "native/HERMES-LICENSE"],
    [".deps/package/LICENSE", "native/REACT-NATIVE-LICENSE"],
    [".deps/godot-cpp-da26c1732ee8656ef9ccad587cbdd55acf8637c8/LICENSE.md", "native/GODOT-CPP-LICENSE.md"],
  ]) await cp(path.isAbsolute(from) ? from : path.join(root, from), path.join(output, to), { recursive: true, verbatimSymlinks: true });
  await mkdir(path.join(output, "toolchain/scripts"), {recursive: true});
  for (const name of ["codegen.mjs", "codegen-contract.mjs", "adapter-manifest.mjs"])
    await cp(path.join(root, "scripts", name), path.join(output, "toolchain/scripts", name));
  if (nativeSdk) await cp(path.join(nativeSdk, "native-combination.json"), path.join(output, "native/native-combination.json"));
  await cp(node, path.join(output, "toolchain/node"), { recursive: true, verbatimSymlinks: true });
  for (const directory of ["toolchain", "src", "types"])
    await writeFile(path.join(output, directory, ".gdignore"), "");
  const typePath = path.join(output, "types/react-native.ts");
  await writeFile(typePath, (await readFile(typePath, "utf8")).replace("../node_modules/", "../toolchain/node_modules/"));
  await writeFile(path.join(output, "fabric.gdextension"), (await readFile(path.join(root, "fabric.gdextension"), "utf8"))
    .replaceAll("res://addons/fabric_godot.dylib", "res://addons/godot_fabric/native/fabric_godot.dylib"));
  const sourceFiles = {};
  const provenanceFiles = new Set(run("git", ["-C", root, "ls-files", "-z", "sdk", "src", "types", "native", "dependencies.json", "package-lock.json", "fabric.gdextension"]).split("\0").filter(Boolean));
  for (const file of ["scripts/codegen.mjs", "scripts/codegen-contract.mjs", "scripts/adapter-manifest.mjs", "scripts/pack-addon.mjs",
    "sdk/toolchain/adapter-plugin.mjs", "sdk/toolchain/project-config.mjs",
    "sdk/toolchain/project-typecheck.mjs", "src/base-view-config.js"]) provenanceFiles.add(file);
  for (const file of [...provenanceFiles].sort())
    sourceFiles[file] = hash(await readFile(path.join(root, file)));
  await verifyAddonNativeInputs({nativeSdk});
  if (hash(await readFile(path.join(output, "native/fabric_godot.dylib"))) !== nativeHashes.host
      || hash(await readFile(path.join(output, "native/frameworks/hermesvm.framework/hermesvm"))) !== nativeHashes.hermes
      || hash(await readFile(path.join(output, "native/frameworks/ReactNativeDependencies.framework/ReactNativeDependencies"))) !== nativeHashes.dependencies)
    throw new Error("Copied native dependencies differ from the verified native build receipt");
  await writeFile(path.join(output, "manifest.json"), JSON.stringify({
    schemaVersion: 1, experimental: true, host: "macOS arm64", godot: lock.godot.version,
    react: lock.react, "react-native": lock["react-native"].version, node: lock.node.version,
    nodeArchiveSha256: lock.node.sha256,
    sourceCommit: run("git", ["-C", root, "rev-parse", "HEAD"]),
    sourceDirty: run("git", ["-C", root, "status", "--porcelain"]).length > 0,
    sourceFiles,
    nativeSha256: hash(await readFile(path.join(output, "native/fabric_godot.dylib"))),
    lockfileSha256: hash(await readFile(path.join(root, "package-lock.json"))),
    ...(nativeSdk ? {nativeCombinationSha256: hash(await readFile(path.join(output, "native/native-combination.json"))),
      nativeSdkManifestSha256: hash(await readFile(path.join(nativeSdk, "manifest.json")))} : {}),
  }, null, 2) + "\n");
  console.log("GODOT_FABRIC_PROVISIONED: " + output);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
