import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {encodePng} from "../tests/images-pattern.mjs";

// Draws the pictures of examples/images: a logo at three densities (logo.png, logo@2x.png and logo@3x.png, the same drawing
// at 32, 64 and 96 pixels), a landscape that shows how each resize mode crops, pads or repeats a picture, the small
// sprite the example embeds as a data URI, and the three pictures of what is done to a picture: an icon on a transparent
// ground (tinted), an avatar (clipped to rounded corners) and a panel (stretched by cap insets), each at two densities. The files
// are committed; run this only to draw them again:
//   node scripts/images-example-assets.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const directory = path.join(root, "examples/images/assets");
const mix = (a, b, t) => a.map((channel, index) => Math.round(channel + (b[index] - channel) * t));

// Supersampled, so that the edges of the logo are smooth at every density.
function logoAt(size) {
  const samples = 4;
  return {width: size, height: size, pixel(x, y) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < samples; sy++) {
      for (let sx = 0; sx < samples; sx++) {
        const u = (x + (sx + 0.5) / samples) / size, v = (y + (sy + 0.5) / samples) / size;
        // A rounded square, bounded by 0.06 of the picture on every side.
        const dx = Math.max(Math.abs(u - 0.5) - (0.5 - 0.06 - 0.2), 0), dy = Math.max(Math.abs(v - 0.5) - (0.5 - 0.06 - 0.2), 0);
        if (Math.hypot(dx, dy) > 0.2) continue;
        const ring = Math.hypot(u - 0.5, v - 0.5);
        let color = mix([14, 165, 233], [99, 102, 241], (u + v) / 2);
        if (ring > 0.27 && ring < 0.34) color = [248, 250, 252];
        if (Math.abs(u - 0.5) + Math.abs(v - 0.5) < 0.15) color = [250, 204, 21];
        r += color[0]; g += color[1]; b += color[2]; a += 255;
      }
    }
    const count = samples * samples;
    return a === 0 ? [0, 0, 0, 0] : [Math.round(r / (a / 255)), Math.round(g / (a / 255)), Math.round(b / (a / 255)), Math.round(a / count)];
  }};
}

// 120 x 60: a sky, a sun and two ridges, with a red mark on the left edge and a green one on the right, so that every crop shows which side it kept.
const landscape = {width: 120, height: 60, pixel(x, y) {
  if (y >= 27 && y < 33 && x < 6) return [239, 68, 68, 255];
  if (y >= 27 && y < 33 && x >= 114) return [34, 197, 94, 255];
  if (x < 3 && y < 3) return [255, 255, 255, 255];
  const sun = Math.hypot(x - 84, y - 24);
  if (sun < 9) return [253, 224, 71, 255];
  const ridge = (offset, height) => 60 - height * (1 - Math.abs(((x + offset) % 60) / 30 - 1));
  if (y > ridge(0, 30)) return [30, 41, 59, 255];
  if (y > ridge(30, 20)) return [51, 65, 85, 255];
  return mix([30, 64, 175], [251, 146, 60], y / 60).concat(255);
}};

const tile = {width: 16, height: 16, pixel: (x, y) => ((x + y) % 8 < 4 ? [20, 184, 166, 255] : [15, 23, 42, 255])};

// A 32 x 32 sprite for the data: URI, drawn with shapes: a face, two eyes and a smile on a transparent ground.
const spritePicture = {width: 32, height: 32, pixel(x, y) {
  const px = x + 0.5, py = y + 0.5;
  const face = Math.hypot(px - 16, py - 16);
  if (face > 14) return [0, 0, 0, 0];
  if (Math.hypot(px - 11, py - 12) < 2.4 || Math.hypot(px - 21, py - 12) < 2.4) return [30, 41, 59, 255];
  const mouth = Math.hypot(px - 16, py - 17);
  if (py > 19 && mouth > 7 && mouth < 9.2) return [30, 41, 59, 255];
  return face > 12.5 ? [217, 119, 6, 255] : [250, 204, 21, 255];
}};

// Supersampled, like the logo: `shade(u, v)` gives the color of a point of the unit square, or null where the picture is transparent.
function drawn(size, shade) {
  const samples = 4;
  return {width: size, height: size, pixel(x, y) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < samples; sy++) {
      for (let sx = 0; sx < samples; sx++) {
        const color = shade((x + (sx + 0.5) / samples) / size, (y + (sy + 0.5) / samples) / size);
        if (color == null) continue;
        r += color[0]; g += color[1]; b += color[2]; a += 255;
      }
    }
    const count = samples * samples;
    return a === 0 ? [0, 0, 0, 0] : [Math.round(r / (a / 255)), Math.round(g / (a / 255)), Math.round(b / (a / 255)), Math.round(a / count)];
  }};
}

// A disc on a transparent ground: a gradient body, a white ring and a yellow dot. Every pixel is opaque or partly so, and a tint takes them all.
const iconAt = size => drawn(size, (u, v) => {
  const ring = Math.hypot(u - 0.5, v - 0.5);
  if (ring > 0.46) return null;
  if (ring < 0.1) return [250, 204, 21];
  if (ring > 0.22 && ring < 0.3) return [248, 250, 252];
  return mix([14, 165, 233], [99, 102, 241], (u + v) / 2);
});

// A portrait on a gradient that covers the whole square: its corners are what a rounded clip takes away.
const avatarAt = size => drawn(size, (u, v) => {
  if (Math.hypot((u - 0.5) / 0.17, (v - 0.4) / 0.17) < 1 || Math.hypot((u - 0.5) / 0.36, (v - 1) / 0.32) < 1) return [248, 250, 252];
  return mix([244, 114, 182], [99, 102, 241], (u + v) / 2);
});

// A card whose border is two points wide and whose corners are eight points round, on a transparent ground (24 points at any density):
// a nine-patch with cap insets of ten points keeps both, whatever size it is stretched to.
const panelAt = size => drawn(size, (u, v) => {
  const x = u * 24, y = v * 24;
  const dx = Math.max(Math.abs(x - 12) - 4, 0), dy = Math.max(Math.abs(y - 12) - 4, 0);
  const outside = Math.hypot(dx, dy);
  if (outside > 8) return null;
  if (outside > 6) return [244, 114, 182];
  return mix([30, 41, 59], [51, 65, 85], v);
});

await mkdir(directory, {recursive: true});
for (const [name, picture] of [["logo.png", logoAt(32)], ["logo@2x.png", logoAt(64)], ["logo@3x.png", logoAt(96)], ["landscape.png", landscape], ["tile.png", tile],
  ["sprite.png", spritePicture], ["icon.png", iconAt(32)], ["icon@2x.png", iconAt(64)], ["avatar.png", avatarAt(56)], ["avatar@2x.png", avatarAt(112)],
  ["panel.png", panelAt(24)], ["panel@2x.png", panelAt(48)]]) {
  const bytes = encodePng(picture);
  await writeFile(path.join(directory, name), bytes);
  console.log(`${name} ${picture.width}x${picture.height} ${bytes.length} bytes`);
}
