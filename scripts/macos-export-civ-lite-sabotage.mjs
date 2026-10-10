import {spawnSync} from "node:child_process";
import {mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES} from "../tests/macos-export-civ-lite-sabotages.mjs";
import {treeDigest} from "./frontier-turn-lane.mjs";

// The retained sabotage of the Frontier export (V05-07, criterion `replay`): the game's fixed seed is altered in the project the export provisions, and the export, run through
// tests/macos-export-civ-lite.test.mjs --sabotage=<name>, must be rejected for the replay's golden and trace hashes in all six runs (three in the project, three in the copied
// Release app) and publish nothing, while the independent oracle rejects the reports too. tests/macos-export-civ-lite-sabotages.mjs lists it once.
//
// The template (consumers/civ-lite) is never edited, so there is nothing to restore: the replacement is made in the disposable copy, and the tree of the template is hashed
// before and after and must be the same. A variant counts as rejected only if its verdict exists: the file of the verdict is deleted before the run, and a missing file (a run that
// died before judging) is a variant that was not rejected. It needs MACOS_EXPORT_TEMPLATE and a committed, clean tree, like the lane. Run with:
//   MACOS_EXPORT_TEMPLATE=build/macos-arm64-template.zip node scripts/macos-export-civ-lite-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const test = "tests/macos-export-civ-lite.test.mjs";
const template = path.join(root, "consumers", "civ-lite");
if (!process.env.MACOS_EXPORT_TEMPLATE) {
  console.error("MACOS_EXPORT_TEMPLATE must name the derived arm64 template ZIP");
  process.exit(2);
}
mkdirSync(path.join(root, "build"), {recursive: true});
const receipt = {format: "godot-fabric.macos-export-civ-lite-sabotage/v1", templateSha256: {before: await treeDigest(template)}, variants: []};
let failed = 0;
for (const variant of SABOTAGES) {
  const verdictFile = path.join(root, `build/macos-export-civ-lite-sabotage-${variant.name}-verdict.json`);
  rmSync(verdictFile, {force: true});
  const run = spawnSync(process.execPath, [test, `--sabotage=${variant.name}`], {cwd: root, encoding: "utf8", timeout: 1800000, maxBuffer: 64 * 1024 * 1024});
  writeFileSync(path.join(root, `build/macos-export-civ-lite-sabotage-${variant.name}-run.log`), (run.stdout ?? "") + (run.stderr ?? ""));
  let verdict = null;
  try {
    verdict = JSON.parse(readFileSync(verdictFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  const rejected = run.status === 0 && verdict?.rejected === true;
  failed += rejected ? 0 : 1;
  receipt.variants.push({name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, runStatus: run.status, rejected,
    runs: verdict?.runs ?? null, published: verdict?.published ?? null});
  console.log(`${rejected ? "MACOS_EXPORT_CIVLITE_SABOTAGE_REJECTED" : "MACOS_EXPORT_CIVLITE_SABOTAGE_NOT_REJECTED"}: ${variant.name}`);
}
receipt.templateSha256.after = await treeDigest(template);
receipt.templateTreeUnchanged = receipt.templateSha256.before === receipt.templateSha256.after;
writeFileSync(path.join(root, "build/macos-export-civ-lite-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
if (!receipt.templateTreeUnchanged) {
  console.error("The template's tree changed during the sabotage run");
}
process.exitCode = failed > 0 || !receipt.templateTreeUnchanged ? 1 : 0;
