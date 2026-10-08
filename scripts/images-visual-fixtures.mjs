import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {encodePng, fingerprint, pictures, rgba} from "../tests/images-pattern.mjs";
import {blurredPixels} from "../tests/images-visual-oracle.mjs";
import {visualPictures} from "../tests/images-visual-pattern.mjs";

// Writes tests/fixtures/images-visual: the pictures the visual images suite draws effects on (a shape with a translucent halo at three
// densities, and a nine-patch), with manifest.json holding their SHA-256, the fingerprint of their pixels and the fingerprints of the
// bitmaps that the blur must make of them for the boxes the suite asks for (written by the oracle's own blur, which the probe does not
// share). The files are committed; run this only to regenerate them:
//   node scripts/images-visual-fixtures.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const directory = path.join(root, "tests/fixtures/images-visual");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

// The boxes the suite asks for: the formula's box for each blurRadius it declares, at the picture's scale.
const boxes = {"glyph.png": [5], "glyph@2x.png": [3, 5, 7, 11], "glyph@3x.png": [11, 85]};
const blurred = (picture, kernels) => Object.fromEntries(kernels.map(kernel => [kernel, fingerprint(blurredPixels(rgba(picture), picture.width, picture.height, kernel))]));

await mkdir(directory, {recursive: true});
const files = {};
for (const [relative, picture] of Object.entries(visualPictures)) {
  await writeFile(path.join(directory, relative), encodePng(picture));
  const bytes = await readFile(path.join(directory, relative));
  files[relative] = {sha256: sha256(bytes), bytes: bytes.length, width: picture.width, height: picture.height, scale: picture.scale, fingerprint: fingerprint(rgba(picture)),
    ...(boxes[relative] ? {blurred: blurred(picture, boxes[relative])} : {})};
}
// The picture the network images suite's server serves (tests/fixtures/images), blurred for the boxes of a 24-pixel picture at the content
// scale: radius 1 and radius 2.
const shared = {"formats/format.png": {fingerprint: fingerprint(rgba(pictures["formats/format.png"])), blurred: blurred(pictures["formats/format.png"], [3, 5])}};
await writeFile(path.join(directory, "manifest.json"), JSON.stringify({format: "godot-fabric.image-visual-fixtures/v1", generator: "scripts/images-visual-fixtures.mjs",
  files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))), shared}, null, 2) + "\n");
console.log(`Wrote ${Object.keys(files).length} fixture pictures to tests/fixtures/images-visual`);
