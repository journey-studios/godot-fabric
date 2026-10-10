import {crc32} from "node:zlib";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

// The seven icons of Frontier's icon set (consumers/civ-lite/ui/icons/): original art, drawn here from shapes, with no third-party image. Each is
// 32x32 with a transparent background, drawn with coverage sampled 4x4 per pixel, and written as a PNG whose zlib stream holds stored
// (uncompressed) blocks, so the bytes depend on nothing but this file: not on the zlib of the Node that runs it. The lane
// (tests/civ-lite-ui-native.test.mjs) draws them again and requires the committed files to be these bytes.
//
//   node scripts/civ-lite-icons.mjs        writes consumers/civ-lite/ui/icons/*.png
const SIZE = 32;
const SAMPLES = 4;

// A shape is a predicate on a point of the 32x32 canvas and the colour it paints; later shapes are painted over earlier ones.
const disc = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const box = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const ring = (cx, cy, inner, outer) => (x, y) => {
  const d = (x - cx) ** 2 + (y - cy) ** 2;
  return d >= inner * inner && d <= outer * outer;
};
// A polygon by the even-odd rule.
const polygon = points => (x, y) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};
// A thick line segment.
const stroke = (x0, y0, x1, y1, width) => (x, y) => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
  return (x - (x0 + t * dx)) ** 2 + (y - (y0 + t * dy)) ** 2 <= (width / 2) ** 2;
};
const either = (...shapes) => (x, y) => shapes.some(shape => shape(x, y));
const without = (shape, hole) => (x, y) => shape(x, y) && !hole(x, y);

const INK = [15, 23, 42];
const SKIN = [253, 224, 178];
const BLUE = [97, 184, 250];
const BLUE_DARK = [3, 105, 161];
const GOLD = [250, 214, 77];
const GOLD_DARK = [180, 83, 9];
const GREEN = [74, 163, 76];
const RED = [220, 68, 68];
const STEEL = [203, 213, 225];
const CYAN = [34, 211, 238];
const SOIL = [146, 94, 48];
const SOIL_DARK = [96, 60, 30];
const LEAF_DARK = [34, 110, 50];
const DROP_LIGHT = [207, 235, 255];

// Their names are the files'.
const ICONS = {
  // A settler: a head over a travelling coat, with the pack on the back.
  settler: [
    [box(7, 12, 14, 27), GOLD_DARK],
    [polygon([[12, 14], [22, 14], [25, 28], [9, 28]]), BLUE],
    [polygon([[12, 14], [22, 14], [23.5, 20], [10.5, 20]]), BLUE_DARK],
    [disc(17, 9, 5), SKIN],
    [polygon([[11.5, 8], [22.5, 8], [20, 3], [14, 3]]), GOLD_DARK],
    [box(10, 7.5, 24, 9), GOLD_DARK],
  ],
  // A warrior: a shield with a boss, and a sword across it.
  warrior: [
    [polygon([[5, 5], [27, 5], [27, 17], [16, 29], [5, 17]]), BLUE_DARK],
    [polygon([[8, 8], [24, 8], [24, 16], [16, 25.5], [8, 16]]), BLUE],
    [disc(16, 15, 3.4), GOLD],
    [stroke(7, 27, 26, 6, 2.6), STEEL],
    [stroke(5.2, 23, 10, 28.2, 2.6), GOLD_DARK],
    [stroke(5, 29, 7.5, 26.5, 3), INK],
  ],
  // A city: walls with battlements and a gate, under a pennant.
  city: [
    [stroke(16, 2, 16, 10, 1.4), INK],
    [polygon([[16.5, 2.5], [24, 5], [16.5, 8]]), RED],
    [box(7, 11, 25, 28), GOLD],
    [box(5, 9, 10, 13), GOLD],
    [box(13.5, 9, 18.5, 13), GOLD],
    [box(22, 9, 27, 13), GOLD],
    [box(5, 13, 27, 15), GOLD_DARK],
    [either(box(13, 20, 19, 28), disc(16, 20, 3)), INK],
    [box(9, 17, 12, 20), INK],
    [box(20, 17, 23, 20), INK],
  ],
  // Food: an apple with a stem and a leaf.
  food: [
    [stroke(16, 9, 17.5, 3.5, 1.8), GOLD_DARK],
    [polygon([[18, 6], [25, 3], [24, 10]]), GREEN],
    [either(disc(11.5, 19, 8.5), disc(20.5, 19, 8.5)), RED],
    [box(12, 12, 20, 27), RED],
    [disc(11, 17, 2.2), [250, 160, 160]],
  ],
  // Production: a gear.
  production: [
    [either(...Array.from({length: 8}, (_, tooth) => {
      const angle = (tooth * Math.PI) / 4;
      return stroke(16 + 8 * Math.cos(angle), 16 + 8 * Math.sin(angle), 16 + 12.5 * Math.cos(angle), 16 + 12.5 * Math.sin(angle), 5);
    })), GOLD_DARK],
    [disc(16, 16, 10.5), GOLD_DARK],
    [ring(16, 16, 5, 9), [245, 158, 11]],
    [disc(16, 16, 4.2), INK],
  ],
  // Science: a flask with a liquid in it and a bubble.
  science: [
    [polygon([[12, 3], [20, 3], [20, 12], [28, 27], [4, 27], [12, 12]]), STEEL],
    [polygon([[12.5, 4.5], [19.5, 4.5], [19.5, 12.5], [26.5, 25.5], [5.5, 25.5], [12.5, 12.5]]), [241, 245, 249]],
    [polygon([[9, 19], [23, 19], [26.5, 25.5], [5.5, 25.5]]), CYAN],
    [box(10, 2, 22, 5), INK],
    [disc(14, 22.5, 1.6), [207, 250, 254]],
    [disc(19, 21, 1.1), [207, 250, 254]],
    [without(disc(16, 9, 2.4), disc(16, 9, 1.2)), BLUE_DARK],
  ],
  // Irrigation: a drop of water over a furrowed bed, with a sprout on each side.
  irrigation: [
    [box(2, 23, 30, 30), SOIL_DARK],
    [box(3, 24, 29, 29), SOIL],
    [stroke(5, 26.5, 27, 26.5, 1.4), SOIL_DARK],
    [stroke(5, 24, 5, 17, 1.6), LEAF_DARK],
    [stroke(27, 24, 27, 17, 1.6), LEAF_DARK],
    [polygon([[5, 19], [1.5, 13], [8.5, 15]]), GREEN],
    [polygon([[27, 19], [30.5, 13], [23.5, 15]]), GREEN],
    [either(polygon([[16, 1], [22.4, 12.5], [9.6, 12.5]]), disc(16, 14, 6.4)), BLUE_DARK],
    [either(polygon([[16, 3.5], [21, 12.5], [11, 12.5]]), disc(16, 14, 4.9)), BLUE],
    [disc(13.6, 14.4, 1.5), DROP_LIGHT],
  ],
};

// The RGBA pixels of an icon: for each pixel, the colour of the last shape under each of its samples, averaged, and the coverage as alpha.
function pixelsOf(shapes) {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  for (let py = 0; py < SIZE; ++py) {
    for (let px = 0; px < SIZE; ++px) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let covered = 0;
      for (let sy = 0; sy < SAMPLES; ++sy) {
        for (let sx = 0; sx < SAMPLES; ++sx) {
          const x = px + (sx + 0.5) / SAMPLES;
          const y = py + (sy + 0.5) / SAMPLES;
          let colour = null;
          for (const [shape, paint] of shapes) {
            if (shape(x, y)) {
              colour = paint;
            }
          }
          if (colour !== null) {
            [red, green, blue] = [red + colour[0], green + colour[1], blue + colour[2]];
            covered += 1;
          }
        }
      }
      const at = (py * SIZE + px) * 4;
      if (covered > 0) {
        pixels[at] = Math.round(red / covered);
        pixels[at + 1] = Math.round(green / covered);
        pixels[at + 2] = Math.round(blue / covered);
        pixels[at + 3] = Math.round((255 * covered) / (SAMPLES * SAMPLES));
      }
    }
  }
  return pixels;
}

const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

// A zlib stream of stored blocks: the header, the blocks of at most 65535 bytes, and the Adler-32 of the data.
function stored(data) {
  const blocks = [Buffer.from([0x78, 0x01])];
  for (let at = 0; at < data.length || at === 0; at += 0xffff) {
    const part = data.subarray(at, at + 0xffff);
    const head = Buffer.alloc(5);
    head[0] = at + 0xffff >= data.length ? 1 : 0;
    head.writeUInt16LE(part.length, 1);
    head.writeUInt16LE(~part.length & 0xffff, 3);
    blocks.push(head, part);
  }
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(((b << 16) | a) >>> 0, 0);
  return Buffer.concat([...blocks, adler]);
}

/** The PNG of an icon: 32x32, 8-bit RGBA, no interlacing, one IDAT of stored blocks. */
function pngOf(shapes) {
  const pixels = pixelsOf(shapes);
  const rows = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; ++y) {
    pixels.copy(rows, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", stored(rows)), chunk("IEND", Buffer.alloc(0))]);
}

/** The seven icons as the files the template holds: name -> bytes. */
export const renderIcons = () => Object.fromEntries(Object.entries(ICONS).map(([name, shapes]) => [`${name}.png`, pngOf(shapes)]));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = path.join(fileURLToPath(new URL("..", import.meta.url)), "consumers", "civ-lite", "ui", "icons");
  await mkdir(directory, {recursive: true});
  for (const [file, bytes] of Object.entries(renderIcons())) {
    await writeFile(path.join(directory, file), bytes);
    console.log(`${path.join(directory, file)}: ${bytes.length} bytes`);
  }
}
