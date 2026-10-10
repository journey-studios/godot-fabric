import { readFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./frontier-comparison-run-campaign.mjs";
import { scriptsOf } from "./frontier-comparison-run.mjs";

// The manifest of a Release export of the comparative campaign (V05-10, `execucao`, part 2): what the Release launcher
// (scripts/frontier-comparison-campaign-launchers.mjs) reads of the three exported .app, and the checks that tell it whether the .app on disk are the ones that were registered.
//
// Beside each measurement .app, in <exports>/<A|B|C>/, the script that measures the export writes `frontier-comparison-export.json`:
//
//   format           MANIFEST_FORMAT
//   arm              "A", "B" or "C": the directory it is in
//   app              the .app, relative to the manifest's directory                    e.g. "Civ.app"
//   executable       Contents/MacOS/<executable> of that .app, relative to the same    e.g. "Civ.app/Contents/MacOS/Civ"
//   pck              Contents/Resources/<name>.pck of that .app, relative to the same  e.g. "Civ.app/Contents/Resources/Civ.pck"
//   binarySha256     SHA-256 of the executable
//   packageSha256    SHA-256 of the .pck (the product's package, with `res://override.cfg` inside it: the launcher puts nothing in Contents/MacOS)
//   scriptSha256     the hash of the scenario's files, as `scriptsOf` (scripts/frontier-comparison-run.mjs) computes it from `scriptFiles`
//   scriptFiles      {path: SHA-256}, the scenario's files, the support files it uses and what the runner writes (override.cfg, the entry)
//   godot            the engine's version, for the record
//   templateSha256   SHA-256 of the export template the .app was made from
//   exportBytes      [n, n]: the size of the product's package in one export and in its repeat (the protocol asks for the two to be equal), without the comparison's files
//
// The paths are relative to the manifest's directory and have no `..`: what a manifest names is inside the folder of its arm.
//
// The instrument's probe project, exported with the same template, has a manifest of the same format in <exports>/probe/ with `arm` "probe": the `.app` that the instrument's self-check runs through its
// main loop (scripts/frontier-comparison-probe-project.mjs). It is optional: an exports directory without it can still be read, and the campaign then has no self-check in a template.

export const MANIFEST_FILE = "frontier-comparison-export.json";
export const MANIFEST_FORMAT = "godot-fabric.frontier-comparison-export/v1";
export const ARMS = ["A", "B", "C"];
export const PROBE_ARM = "probe";

const HEX = /^[0-9a-f]{64}$/;
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value !== "";

// Why `value` is not a path of the manifest (a text, relative, with no `..` in it), or null.
function pathProblem(field, value) {
  if (!isText(value)) {
    return `${field} is not a path (${JSON.stringify(value)})`;
  }
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    return `${field} must be relative to the manifest's directory and have no "..": ${value}`;
  }
  return null;
}

// What is wrong with a manifest that is meant for `arm`, as a list of sentences (empty when it is good). Pure: it reads no file. It checks the fields and their types, that every SHA-256 has
// 64 hexadecimal digits, that `exportBytes` are two equal positive integers, that `arm` is the expected one, that the paths are inside the manifest's directory, that the executable and the
// package are where an exported .app keeps them, and that `scriptSha256` is the hash of `scriptFiles`.
export function manifestErrors(manifest, arm) {
  if (!isObject(manifest)) {
    return ["the manifest is not an object"];
  }
  const problems = [];
  if (manifest.format !== MANIFEST_FORMAT) {
    problems.push(`format is ${JSON.stringify(manifest.format)}, not ${MANIFEST_FORMAT}`);
  }
  if (manifest.arm !== arm) {
    problems.push(`arm is ${JSON.stringify(manifest.arm)}, but this is the export of arm ${arm}`);
  }
  for (const field of ["app", "executable", "pck"]) {
    const problem = pathProblem(field, manifest[field]);
    if (problem !== null) {
      problems.push(problem);
    }
  }
  if (isText(manifest.app) && !manifest.app.endsWith(".app")) {
    problems.push(`app is not a .app: ${manifest.app}`);
  }
  const macos = `${manifest.app}/Contents/MacOS/`;
  const resources = `${manifest.app}/Contents/Resources/`;
  if (isText(manifest.app) && isText(manifest.executable) && !(manifest.executable.startsWith(macos) && manifest.executable.length > macos.length)) {
    problems.push(`executable is not a file in ${macos}: ${manifest.executable}`);
  }
  if (isText(manifest.app) && isText(manifest.pck) && !(manifest.pck.startsWith(resources) && manifest.pck.endsWith(".pck") && manifest.pck.length > resources.length + 4)) {
    problems.push(`pck is not a .pck in ${resources}: ${manifest.pck}`);
  }
  for (const field of ["binarySha256", "packageSha256", "scriptSha256", "templateSha256"]) {
    if (!(typeof manifest[field] === "string" && HEX.test(manifest[field]))) {
      problems.push(`${field} is not a SHA-256 of 64 hexadecimal digits (${JSON.stringify(manifest[field])})`);
    }
  }
  if (!isText(manifest.godot)) {
    problems.push(`godot is not the engine's version (${JSON.stringify(manifest.godot)})`);
  }
  const files = manifest.scriptFiles;
  if (!isObject(files) || Object.keys(files).length === 0 || !Object.entries(files).every(([file, hash]) => file !== "" && typeof hash === "string" && HEX.test(hash))) {
    problems.push("scriptFiles is not a non-empty object of file -> SHA-256 of 64 hexadecimal digits");
  } else if (typeof manifest.scriptSha256 === "string" && HEX.test(manifest.scriptSha256) && scriptsOf(files).sha256 !== manifest.scriptSha256) {
    problems.push(`scriptSha256 is not the hash of scriptFiles (${scriptsOf(files).sha256})`);
  }
  const sizes = manifest.exportBytes;
  if (!(Array.isArray(sizes) && sizes.length === 2 && sizes.every((size) => Number.isSafeInteger(size) && size > 0))) {
    problems.push(`exportBytes is not two positive integers (${JSON.stringify(sizes)})`);
  } else if (sizes[0] !== sizes[1]) {
    problems.push(`exportBytes are ${sizes[0]} and ${sizes[1]}: the protocol asks for the export and its repeat to have the same size`);
  }
  return problems;
}

// The manifest of `arm` in <base>/<arm>, read, checked and with its paths resolved: {entry} when it is good, {problems} (sentences, each naming the arm) when it is missing, is not JSON or is not good,
// and {problems, missing: true} when there is no file there.
async function readEntry(base, arm) {
  const file = path.join(base, arm, MANIFEST_FILE);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return { problems: [`arm ${arm}: ${file} is missing`], missing: true };
    }
    if (error instanceof SyntaxError) {
      return { problems: [`arm ${arm}: ${file} is not JSON (${error.message})`] };
    }
    throw error;
  }
  const found = manifestErrors(manifest, arm);
  if (found.length > 0) {
    return { problems: found.map((problem) => `arm ${arm}: ${file}: ${problem}`) };
  }
  const directory = path.join(base, arm);
  return { entry: { arm, manifest, app: path.join(directory, manifest.app), executable: path.join(directory, manifest.executable), pck: path.join(directory, manifest.pck) } };
}

// The manifests of arms A, B and C in `directory`, read, checked and with their paths resolved: {A: {arm, manifest, app, executable, pck}, B, C}, the three paths absolute. It throws, naming every
// problem of every arm, if a manifest is missing, is not JSON or is not good: nothing is half-read.
export async function readExports(directory) {
  const base = path.resolve(directory);
  const entries = {};
  const problems = [];
  for (const arm of ARMS) {
    const read = await readEntry(base, arm);
    if (read.entry === undefined) {
      problems.push(...read.problems);
    } else {
      entries[arm] = read.entry;
    }
  }
  if (problems.length > 0) {
    throw new Error(`the Release exports in ${base} are refused:\n${problems.join("\n")}`);
  }
  return entries;
}

// The probe's export in <directory>/probe, as an entry of `readExports` with `arm` "probe", or null when the directory has no manifest of it. A manifest that is there and is not good throws, naming
// every problem.
export async function readProbeExport(directory) {
  const base = path.resolve(directory);
  const read = await readEntry(base, PROBE_ARM);
  if (read.entry !== undefined) {
    return read.entry;
  }
  if (read.missing === true) {
    return null;
  }
  throw new Error(`the probe's export in ${base} is refused:\n${read.problems.join("\n")}`);
}

// The SHA-256 of a file, or null when there is no file there.
async function fileHash(file) {
  try {
    return sha256(await readFile(file));
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code)) {
      return null;
    }
    throw error;
  }
}

// The hashes of the files an entry names, as they are now: {binary, package}; null for a file that is not there.
export async function hashesOf(entry) {
  return { binary: await fileHash(entry.executable), package: await fileHash(entry.pck) };
}

// What differs between the hashes of the files now (`hashesOf`) and the ones the manifest registered, as sentences (empty when they are the same).
export function hashProblems(entry, hashes) {
  const checks = [
    ["executable", entry.executable, hashes.binary, entry.manifest.binarySha256],
    ["package", entry.pck, hashes.package, entry.manifest.packageSha256],
  ];
  return checks.flatMap(([what, file, now, registered]) => {
    if (now === null) {
      return [`arm ${entry.arm}: the ${what} ${file} is not a file`];
    }
    return now === registered ? [] : [`arm ${entry.arm}: the ${what} ${file} has the SHA-256 ${now}, and the manifest registered ${registered}`];
  });
}
