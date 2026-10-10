import { lstat, mkdir, readdir, readFile, rm, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHarness } from "./consumer-harness.mjs";
import { armProject, shapeArmProject } from "./frontier-comparison-arms.mjs";
import { prepareProbeProject } from "./frontier-comparison-probe-project.mjs";
import { ARMS, MANIFEST_FILE, MANIFEST_FORMAT, PROBE_ARM, manifestErrors, readExports, readProbeExport } from "./frontier-comparison-release.mjs";
import { sha256 } from "./frontier-comparison-run-campaign.mjs";
import { MEASUREMENT_FILES, prepareProject, scriptsOf } from "./frontier-comparison-run.mjs";
import { exportPreparedProject } from "./macos-export.mjs";

// The Release exports of the comparative campaign (V05-10, criterion `execucao`; docs/research/frontier-comparison-entry.md, "The measurement exports"): the `.app` of arms A, B and C and of the
// instrument's probe project, each in <out>/<A|B|C|probe>/ with the manifest that the Release launcher reads (scripts/frontier-comparison-release.mjs), and the size of each arm's PRODUCT.
//
//   node scripts/frontier-comparison-measurement-export.mjs --out <directory> --template <ZIP of the arm64 Release template> [--only A,B,C,probe]
//
// For each arm, one copy of civ-lite at a time (prepareProject: provisioned, its HUD built, the scenario and the entry copied in, imported), shaped as the arm (scripts/frontier-comparison-arms.mjs:
// A and B lose the extension), and with the options the arm describes (`armProject`):
//   1. the MEASUREMENT project is exported once, into <out>/<arm>/: the product's files plus the empty scene, `comparison/` and `override.cfg`; its manifest is written beside it;
//   2. the measurement files are taken out of the copy, which is imported again, and the PRODUCT is exported twice, each time measured and removed: the package the `package-size` axis reads
//      has no measurement file, not even in the cache of global classes. The size is the one of the whole .app (every regular file of the bundle, the engine and the frameworks included): the
//      price of a HUD in package size is what the application weighs with it and without it. The size of the PCK is recorded beside it. The two exports of an arm must have the same size.
// The probe project is exported once with the same template (no frameworks), and its manifest has `exportBytes` twice that size: there is no repeat of it, and no axis reads it.
//
// An --out that already holds an app, a manifest or the summary of an earlier export is refused up front, naming what is there, before anything is provisioned; nothing is deleted.
// A manifest is checked by `manifestErrors` before it is written, and the whole directory by `readExports` and `readProbeExport` when all four are exported. Only one `.app` of a product exists at a
// time, and an export that would start with less than MIN_FREE_BYTES free is refused: the disk of this machine is small, and an export that fails half-way for lack of space leaves nothing to judge.

export const APP_NAMES = { A: "Frontier-A.app", B: "Frontier-B.app", C: "Frontier-C.app", [PROBE_ARM]: "FrontierProbe.app" };
export const MIN_FREE_BYTES = 600 * 1024 * 1024;
const SUMMARY_FILE = "export-summary.json";
const BUNDLE_PREFIX = "org.journeystudios.godotfabric.comparison";
const WORK_PREFIX = "frontier-comparison-measurement-export";
// The probe's project holds no resource of its own, and `override.cfg` (its main scene and its main loop) is not one: the include filter brings it into the PCK.
const PROBE_OPTIONS = { exportFilter: "all_resources", includeFilter: "override.cfg", excludeFilter: "", frameworks: false };

// The bytes free on the volume of `directory`, available to this user.
async function freeBytesOf(directory) {
  const volume = await statfs(directory);
  return Number(volume.bavail) * Number(volume.bsize);
}

// Refuses to start an export with less than `minimum` bytes free where `directory` is.
async function assertRoom(directory, { freeBytes, minimum }) {
  const free = await freeBytes(directory);
  if (free < minimum) {
    throw new Error(`only ${Math.floor(free / 1048576)} MB are free where ${directory} is, and an export needs ${Math.floor(minimum / 1048576)} MB at least: free some space and export again`);
  }
  return free;
}

// What an earlier export left in `out` for the names about to be exported: the app and the manifest of each one's folder, and the summary of a whole run. An existing app is also what
// exportPreparedProject would refuse, but only after the whole preparation; nothing is deleted here, and what is found is named.
async function assertNothingThere(out, names, { summary = false } = {}) {
  const candidates = [...names.flatMap((name) => [path.join(out, name, APP_NAMES[name]), path.join(out, name, MANIFEST_FILE)]), ...(summary ? [path.join(out, SUMMARY_FILE)] : [])];
  const found = [];
  for (const candidate of candidates) {
    if (await lstat(candidate).then(() => true, () => false)) {
      found.push(path.relative(out, candidate));
    }
  }
  if (found.length > 0) {
    throw new Error(`${out} already holds the output of an earlier export (${found.join(", ")}): pass a new --out, or remove it yourself; nothing was provisioned, exported or deleted`);
  }
}

// The size of an application bundle: the bytes of every regular file in it. Symbolic links count for nothing (a framework's `Versions/Current` is one), so a file reached by two paths counts once.
export async function appBytes(app) {
  let total = 0;
  for (const entry of await readdir(app, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      total += (await lstat(path.join(entry.parentPath, entry.name))).size;
    }
  }
  return total;
}

// An export needs the desktop texture formats imported, which the export of the Frontier game writes in its copy (prepareCivLiteProject of scripts/macos-export.mjs); the same two lines.
async function allowTextureExport(project) {
  const projectFile = path.join(project, "project.godot");
  const text = await readFile(projectFile, "utf8");
  if (text.split("[rendering]\n").length !== 2) {
    throw new Error("the rendering section of civ-lite's project.godot is not where the export expects it");
  }
  await writeFile(projectFile, text.replace("[rendering]\n", "[rendering]\ntextures/vram_compression/import_s3tc_bptc=true\ntextures/vram_compression/import_etc2_astc=true\n"));
}

// The manifest of an export that `exportPreparedProject` returned, for `directory` (the folder of the arm, where the manifest sits): the paths relative to it and the hashes the export gives
// (the executable and the PCK after signing). `scripts` is {files, sha256} as `scriptsOf` gives, `sizes` the product's two sizes. Pure.
export function manifestOf({ arm, directory, exported, scripts, sizes }) {
  const relative = (file) => path.relative(directory, file).split(path.sep).join("/");
  return {
    format: MANIFEST_FORMAT,
    arm,
    app: relative(exported.app.path),
    executable: relative(exported.executable.path),
    pck: relative(exported.pck.path),
    binarySha256: exported.executable.sha256,
    packageSha256: exported.pck.sha256,
    scriptSha256: scripts.sha256,
    scriptFiles: scripts.files,
    godot: exported.engineVersion,
    templateSha256: exported.templateSha256,
    exportBytes: sizes,
  };
}

// Writes the manifest beside the .app, after `manifestErrors` found nothing wrong with it.
export async function writeManifest(directory, manifest) {
  const problems = manifestErrors(manifest, manifest.arm);
  if (problems.length > 0) {
    throw new Error(`the manifest of ${manifest.arm} is not good, and was not written:\n${problems.join("\n")}`);
  }
  const file = path.join(directory, MANIFEST_FILE);
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

// What the script of the manifest says about the copy: every file of `scripts.files` is in the copy with that hash (the scenario's files at comparison/<name>, the others at their path).
async function assertScriptsInCopy(project, scripts) {
  for (const [file, hash] of Object.entries(scripts.files)) {
    const inCopy = path.join(project, Object.hasOwn(MEASUREMENT_FILES, file) ? file : path.join("comparison", path.basename(file)));
    const found = sha256(await readFile(inCopy));
    if (found !== hash) {
      throw new Error(`${file} is ${found} in the copy that is exported, and the script registered ${hash}`);
    }
  }
}

// What the export gives that goes in the summary: the PCK's files and hash, and the sizes.
const factsOf = async (exported, staging) => ({
  appBytes: await appBytes(staging),
  pckBytes: (await lstat(exported.pck.path)).size,
  pckSha256: exported.pck.sha256,
  pckFiles: exported.pack.fileCount,
  paths: exported.pack.paths,
});

// One arm: its measurement export in <out>/<arm>/ with the manifest, and the two exports of its product, which are measured and removed. `deps` are the real ones unless a test supplies its own:
// `prepare` (a copy of civ-lite with the scenario in it, as prepareProject gives), `exportApp` (exportPreparedProject), `freeBytes` and `minFreeBytes`. `templateMember` is what the first export
// found in the template, kept so that the template is inspected once. Returns the summary of the arm.
export async function exportArm({ arm, out, template, templateMember = null, log = () => undefined, deps = {} }) {
  const { prepare = prepareProject, exportApp = exportPreparedProject, freeBytes = freeBytesOf, minFreeBytes = MIN_FREE_BYTES } = deps;
  const set = armProject(arm);
  const directory = path.join(out, arm);
  await assertNothingThere(out, [arm]);
  await mkdir(directory, { recursive: true });
  const prepared = await prepare({ name: `${WORK_PREFIX}-${arm.toLowerCase()}` });
  const { harness } = prepared;
  const bundleIdentifier = `${BUNDLE_PREFIX}.${arm.toLowerCase()}`;
  const exportOnce = async (staging, options) => {
    await assertRoom(directory, { freeBytes, minimum: minFreeBytes });
    try {
      const exported = await exportApp({ harness, template, staging, bundleIdentifier, templateMember, receipt: { stages: [] }, ...options });
      templateMember = exported.receipt.templateMember;
      return exported;
    } catch (error) {
      // An export that throws leaves its staging path to the caller to remove (exportPreparedProject).
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  };
  const importAgain = (label) => harness.run(label, harness.godot, ["--path", harness.project, "--headless", "--import"]);
  try {
    log(`arm ${arm}: shaping the copy (${set.fabric ? "with" : "without"} the extension)`);
    await shapeArmProject(harness.project, arm, { measurement: true });
    await allowTextureExport(harness.project);
    await importAgain(`import-${arm.toLowerCase()}-measurement`);
    await assertScriptsInCopy(harness.project, prepared.scripts);

    log(`arm ${arm}: the measurement export`);
    const staging = path.join(directory, APP_NAMES[arm]);
    const measurement = await exportOnce(staging, set.measurement);
    const measurementFacts = await factsOf(measurement, staging);

    // The product never saw the measurement files: they leave the copy, and so do their entries in the cache of global classes, with the next import.
    await rm(path.join(harness.project, "comparison"), { recursive: true, force: true });
    await rm(path.join(harness.project, "override.cfg"), { force: true });
    await importAgain(`import-${arm.toLowerCase()}-product`);
    const classCache = await readFile(path.join(harness.project, ".godot", "global_script_class_cache.cfg"), "utf8").catch(() => "");
    if (/FrontierComparison/.test(classCache)) {
      throw new Error("the cache of global classes still names the measurement entry after the files left the copy");
    }
    const products = [];
    for (const repeat of [1, 2]) {
      log(`arm ${arm}: the product, export ${repeat} of 2`);
      const productStaging = path.join(out, `.${arm}-product-${repeat}.app`);
      try {
        const exported = await exportOnce(productStaging, set.product);
        products.push(await factsOf(exported, productStaging));
      } finally {
        await rm(productStaging, { recursive: true, force: true });
      }
    }
    if (products[0].appBytes !== products[1].appBytes || products[0].pckBytes !== products[1].pckBytes) {
      throw new Error(`the two exports of the product of arm ${arm} differ in size: ${products.map((product) => `${product.appBytes} (pck ${product.pckBytes})`).join(" and ")}`);
    }
    const manifest = manifestOf({ arm, directory, exported: measurement, scripts: prepared.scripts, sizes: products.map((product) => product.appBytes) });
    await writeManifest(directory, manifest);
    return { arm, set: { mainScene: set.mainScene, includes: set.includes, product: set.product, measurement: set.measurement }, measurement: measurementFacts, products, manifest, templateMember };
  } finally {
    await rm(path.join(harness.directory, "template-engine"), { recursive: true, force: true });
    await harness.cleanup();
  }
}

// The probe project, exported once with no frameworks into <out>/probe/, with its manifest. `deps`: `prepareProbe`, `exportApp`, `makeHarness`, `freeBytes` and `minFreeBytes`.
export async function exportProbe({ out, template, templateMember = null, log = () => undefined, deps = {} }) {
  const { prepareProbe = prepareProbeProject, exportApp = exportPreparedProject, makeHarness = createHarness, freeBytes = freeBytesOf, minFreeBytes = MIN_FREE_BYTES } = deps;
  const directory = path.join(out, PROBE_ARM);
  await assertNothingThere(out, [PROBE_ARM]);
  await mkdir(directory, { recursive: true });
  const harness = await makeHarness({ template: "civ-lite", name: `${WORK_PREFIX}-probe` });
  try {
    log("the probe project: preparing");
    // The harness's own project folder is empty and new, which is what the probe's preparation asks of its directory.
    const probe = await prepareProbe(harness.project, { engine: harness.godot });
    // The export refuses a project whose desktop texture formats are not imported, textures or not, and the probe project's project.godot is one of the files its script hashes: the hash follows the edit.
    await allowTextureExport(harness.project);
    const scripts = scriptsOf({ ...probe.scripts.files, "project.godot": sha256(await readFile(path.join(harness.project, "project.godot"))) });
    await assertRoom(directory, { freeBytes, minimum: minFreeBytes });
    log("the probe project: the export");
    const staging = path.join(directory, APP_NAMES[PROBE_ARM]);
    const exported = await exportApp({ harness, template, staging, bundleIdentifier: `${BUNDLE_PREFIX}.probe`, templateMember, receipt: { stages: [] }, ...PROBE_OPTIONS }).catch(async (error) => {
      await rm(staging, { recursive: true, force: true });
      throw error;
    });
    const facts = await factsOf(exported, staging);
    const manifest = manifestOf({ arm: PROBE_ARM, directory, exported, scripts, sizes: [facts.appBytes, facts.appBytes] });
    await writeManifest(directory, manifest);
    return { arm: PROBE_ARM, options: PROBE_OPTIONS, measurement: facts, manifest, templateMember: exported.receipt.templateMember };
  } finally {
    await rm(path.join(harness.directory, "template-engine"), { recursive: true, force: true });
    await harness.cleanup();
  }
}

// The whole export: the arms of `only` (all by default) and the probe, one at a time, then the check of the directory by the launcher's own readers (when all four are there) and the summary.
// Returns {summary, arms, probe}.
export async function exportMeasurementProject({ out, template, only = [...ARMS, PROBE_ARM], log = () => undefined, deps = {} }) {
  const wanted = new Set(only);
  const unknown = [...wanted].filter((name) => ![...ARMS, PROBE_ARM].includes(name));
  if (unknown.length > 0) {
    throw new Error(`--only takes ${[...ARMS, PROBE_ARM].join(", ")}; not ${unknown.join(", ")}`);
  }
  const directory = path.resolve(out);
  // Before anything is provisioned or made: a second run in the same --out would fail late, after the whole preparation of its first arm.
  await assertNothingThere(directory, [...ARMS, PROBE_ARM].filter((name) => wanted.has(name)), { summary: true });
  await mkdir(directory, { recursive: true });
  const arms = {};
  let templateMember = null;
  for (const arm of ARMS.filter((name) => wanted.has(name))) {
    arms[arm] = await exportArm({ arm, out: directory, template, templateMember, log, deps });
    templateMember = arms[arm].templateMember;
  }
  let probe = null;
  if (wanted.has(PROBE_ARM)) {
    probe = await exportProbe({ out: directory, template, templateMember, log, deps });
  }
  if (ARMS.every((arm) => wanted.has(arm)) && probe !== null) {
    await readExports(directory);
    await readProbeExport(directory);
    log("the manifests of the three arms and of the probe were read and checked by the launcher's readers");
  }
  const summary = {
    notAResult: "The sizes are those of one trial of the export, on one machine. They are not the package-size axis of the report, which a campaign's exports will give.",
    templateSha256: probe?.manifest.templateSha256 ?? Object.values(arms)[0]?.manifest.templateSha256 ?? null,
    arms: Object.fromEntries(Object.entries(arms).map(([arm, result]) => [arm, { set: result.set, measurement: result.measurement, products: result.products, manifest: result.manifest }])),
    probe: probe === null ? null : { options: probe.options, measurement: probe.measurement, manifest: probe.manifest },
  };
  await writeFile(path.join(directory, SUMMARY_FILE), `${JSON.stringify(summary, null, 2)}\n`);
  return { summary, arms, probe };
}

function parseArguments(argv) {
  const options = { out: null, template: null, only: [...ARMS, PROBE_ARM] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--out", "--template", "--only"].includes(argument)) {
      throw new Error(`unknown argument ${argument}`);
    }
    if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
      throw new Error(`${argument} takes a value`);
    }
    const value = argv[++index];
    if (argument === "--only") {
      options.only = value.split(",");
    } else {
      options[argument.slice(2)] = path.resolve(value);
    }
  }
  if (options.out === null || options.template === null) {
    throw new Error("use --out <directory> --template <ZIP of the arm64 Release template> [--only A,B,C,probe]");
  }
  return options;
}

async function main(argv) {
  const options = parseArguments(argv);
  const { summary } = await exportMeasurementProject({ ...options, log: (line) => console.log(line) });
  const sizes = Object.entries(summary.arms).map(([arm, result]) => `${arm}=${result.products.map((product) => product.appBytes).join("/")}`).join(" ");
  console.log(`FRONTIER_COMPARISON_MEASUREMENT_EXPORT_WRITTEN: ${options.out}${sizes === "" ? "" : `, product bytes ${sizes}`}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
