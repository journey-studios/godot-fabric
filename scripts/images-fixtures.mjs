import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {ensureGodotBinary} from "./godot-binary.mjs";
import {brokenFiles, encodeBmp, encodePng, encodeSvg, encodeTga, fingerprint, gif, pictures, rgba} from "../tests/images-pattern.mjs";

// Writes tests/fixtures/images: the tiny pictures the Images suite loads (bundled assets with scale variants, one
// picture in each format Godot decodes, and the files that must fail) and manifest.json with their SHA-256. The
// files are committed; run this only to regenerate them:
//   node scripts/images-fixtures.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const directory = path.join(root, "tests/fixtures/images");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

async function write(relative, bytes) {
  const file = path.join(directory, relative);
  await mkdir(path.dirname(file), {recursive: true});
  await writeFile(file, bytes);
}

for (const [relative, picture] of Object.entries(pictures)) {
  if (relative.endsWith(".png")) await write(relative, encodePng(picture));
  else if (relative.endsWith(".bmp")) await write(relative, encodeBmp(picture));
  else if (relative.endsWith(".tga")) await write(relative, encodeTga(picture));
  else if (relative.endsWith(".svg")) await write(relative, encodeSvg(picture));
}
await write("formats/format.gif", gif);
for (const [relative, bytes] of Object.entries(brokenFiles())) await write(relative, bytes);

// JPEG and lossless WebP come from Godot's encoders, so that their bytes are what its decoders were built for.
const godot = spawnSync(await ensureGodotBinary(), ["--path", root, "--headless", "--script", "res://scripts/images-fixtures.gd"], {encoding: "utf8", timeout: 60000});
assert.equal(godot.status, 0, godot.stdout + godot.stderr);

const files = {};
for (const [relative, picture] of Object.entries(pictures)) {
  const bytes = await readFile(path.join(directory, relative));
  files[relative] = {sha256: sha256(bytes), bytes: bytes.length, width: picture.width, height: picture.height,
    ...(picture.scale ? {scale: picture.scale} : {}), exact: picture.exact, ...(picture.exact ? {fingerprint: fingerprint(rgba(picture))} : {})};
}
for (const relative of ["formats/format.gif", ...Object.keys(brokenFiles())]) {
  const bytes = await readFile(path.join(directory, relative));
  files[relative] = {sha256: sha256(bytes), bytes: bytes.length};
}
await writeFile(path.join(directory, "manifest.json"), JSON.stringify({format: "godot-fabric.image-fixtures/v1", generator: "scripts/images-fixtures.mjs",
  files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)))}, null, 2) + "\n");
console.log(`Wrote ${Object.keys(files).length} fixture pictures to tests/fixtures/images`);
