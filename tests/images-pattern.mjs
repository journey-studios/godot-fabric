// The pixels of the fixture pictures as functions of the position, and the encoders that write them. The generator
// (scripts/images-fixtures.mjs) writes them in each format; the oracle derives what a correct decoder must produce
// from these same definitions, so a decoder cannot agree with the files by reading them.
import {crc32, deflateSync} from "node:zlib";

const quadrants = [[230, 60, 50], [60, 190, 90], [60, 110, 230], [240, 200, 40]];

// Four colored quadrants (red, green, blue and yellow, from the top-left clockwise... row by row) inside a one-pixel
// white border, scaled in brightness by `tint`: the quadrants show orientation, the border the edges.
function quadrantPixel(width, height, tint) {
  return (x, y) => {
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return [255, 255, 255, 255];
    const color = quadrants[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)];
    return [...color.map(channel => Math.round(channel * tint)), 255];
  };
}
function checkerPixel(size, step) {
  return (x, y) => ((Math.floor(x / step) + Math.floor(y / step)) % 2 === 0 ? [250, 210, 20, 255] : [30, 30, 40, 255]);
}

// path is relative to tests/fixtures/images; scale is the @Nx of a bundled variant.
export const pictures = {
  "assets/badge.png": {width: 16, height: 16, pixel: quadrantPixel(16, 16, 0.6), scale: 1},
  "assets/badge@2x.png": {width: 32, height: 32, pixel: quadrantPixel(32, 32, 0.8), scale: 2},
  "assets/badge@3x.png": {width: 48, height: 48, pixel: quadrantPixel(48, 48, 1), scale: 3},
  "assets/wide.png": {width: 40, height: 20, pixel: quadrantPixel(40, 20, 1), scale: 1},
  "assets/tile.png": {width: 8, height: 8, pixel: checkerPixel(8, 2), scale: 1},
  "formats/format.png": {width: 24, height: 24, pixel: quadrantPixel(24, 24, 1), exact: true},
  "formats/format.bmp": {width: 24, height: 24, pixel: quadrantPixel(24, 24, 1), exact: true},
  "formats/format.tga": {width: 24, height: 24, pixel: quadrantPixel(24, 24, 1), exact: true},
  "formats/format.webp": {width: 24, height: 24, pixel: quadrantPixel(24, 24, 1), exact: true},
  // Lossy: only the size is exact.
  "formats/format.jpg": {width: 24, height: 24, pixel: quadrantPixel(24, 24, 1), exact: false},
  "formats/format.svg": {width: 24, height: 24, exact: false},
};
for (const picture of Object.values(pictures)) picture.exact ??= picture.pixel != null;

export function rgba(picture) {
  const bytes = Buffer.alloc(picture.width * picture.height * 4);
  for (let y = 0; y < picture.height; y++) {
    for (let x = 0; x < picture.width; x++) bytes.set(picture.pixel(x, y), (y * picture.width + x) * 4);
  }
  return bytes;
}

// The 64-bit FNV-1a the host records for a decoded picture, over its RGBA bytes.
export function fingerprint(bytes) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return hash.toString(16).padStart(16, "0");
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}
const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function header(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return chunk("IHDR", ihdr);
}

export function encodePng(picture) {
  const stride = picture.width * 4, pixels = rgba(picture), rows = Buffer.alloc((stride + 1) * picture.height);
  for (let y = 0; y < picture.height; y++) pixels.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([signature, header(picture.width, picture.height), chunk("IDAT", deflateSync(rows, {level: 9})), chunk("IEND", Buffer.alloc(0))]);
}

// 24-bit, bottom-up, rows padded to four bytes: the BMP every decoder reads.
export function encodeBmp(picture) {
  const stride = Math.ceil(picture.width * 3 / 4) * 4, size = 54 + stride * picture.height, out = Buffer.alloc(size);
  out.write("BM", 0, "ascii");
  out.writeUInt32LE(size, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(picture.width, 18);
  out.writeInt32LE(picture.height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  out.writeUInt32LE(stride * picture.height, 34);
  for (let y = 0; y < picture.height; y++) {
    for (let x = 0; x < picture.width; x++) {
      const [r, g, b] = picture.pixel(x, picture.height - 1 - y);
      out.set([b, g, r], 54 + y * stride + x * 3);
    }
  }
  return out;
}

// 32-bit uncompressed, bottom-left origin, version 2 footer.
export function encodeTga(picture) {
  const out = Buffer.alloc(18 + picture.width * picture.height * 4 + 26);
  out[2] = 2;
  out.writeUInt16LE(picture.width, 12);
  out.writeUInt16LE(picture.height, 14);
  out[16] = 32;
  out[17] = 8;
  for (let y = 0; y < picture.height; y++) {
    for (let x = 0; x < picture.width; x++) {
      const [r, g, b, a] = picture.pixel(x, picture.height - 1 - y);
      out.set([b, g, r, a], 18 + (y * picture.width + x) * 4);
    }
  }
  out.write("TRUEVISION-XFILE.\0", out.length - 18, "latin1");
  return out;
}

export function encodeSvg(picture) {
  const {width, height} = picture;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#ffffff"/><rect x="1" y="1" width="${width / 2 - 1}" height="${height / 2 - 1}" fill="#e63c32"/>` +
    `<rect x="${width / 2}" y="1" width="${width / 2 - 1}" height="${height / 2 - 1}" fill="#3cbe5a"/>` +
    `<rect x="1" y="${height / 2}" width="${width / 2 - 1}" height="${height / 2 - 1}" fill="#3c6ee6"/>` +
    `<rect x="${width / 2}" y="${height / 2}" width="${width / 2 - 1}" height="${height / 2 - 1}" fill="#f0c828"/></svg>\n`);
}

// A one-pixel GIF89a: a format the host recognizes and refuses by name.
export const gif = Buffer.from("47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b", "hex");

// Pictures that must fail, each in its own way.
export function brokenFiles() {
  const wide = encodePng(pictures["assets/wide.png"]);
  const garbage = Buffer.alloc(64);
  for (let i = 0; i < garbage.length; i++) garbage[i] = (i * 73 + 41) & 255;
  const oversizeJpeg = Buffer.from("ffd8ffc00011080000ffff03011100021101031101ffd9".replace("0000ffff", "ffffffff"), "hex");
  return {
    "broken/corrupt.png": Buffer.concat([signature, header(16, 16), chunk("IDAT", garbage), chunk("IEND", Buffer.alloc(0))]),
    "broken/truncated.png": wide.subarray(0, Math.floor(wide.length * 0.6)),
    // A header that claims 65535 x 65535 pixels over a handful of bytes: no decoder may be asked to believe it.
    "broken/oversize.png": Buffer.concat([signature, header(65535, 65535), chunk("IEND", Buffer.alloc(0))]),
    "broken/oversize.jpg": oversizeJpeg,
    "broken/notimage.png": Buffer.from("<!doctype html><title>not an image</title>\n"),
    "broken/empty.png": Buffer.alloc(0),
  };
}
