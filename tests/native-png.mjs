import assert from "node:assert/strict";
import {inflateSync} from "node:zlib";

// Decode the actual saved Godot PNG, independently of its JSON pixel report.
// This bounded reader accepts only lossless 8-bit noninterlaced RGB/RGBA images.
export function decodeNativePng(bytes, expectedWidth, expectedHeight) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let header = null, ended = false, offset = 8;
  const blocks = [];
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, "Saved PNG chunk header is complete");
    const length = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
    assert.ok(offset + 12 + length <= bytes.length, "Saved PNG chunk data is complete");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") { assert.equal(header, null); assert.equal(length, 13); header = data; }
    if (type === "IDAT") blocks.push(data);
    offset += length + 12;
    if (type === "IEND") { assert.equal(length, 0); ended = true; break; }
  }
  assert.ok(header != null && blocks.length > 0 && ended); assert.equal(offset, bytes.length);
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4), colorType = header[9];
  assert.equal(width, expectedWidth); assert.equal(height, expectedHeight); assert.equal(header[8], 8);
  assert.ok(colorType === 2 || colorType === 6); assert.deepEqual([...header.subarray(10)], [0, 0, 0]);
  const channels = colorType === 6 ? 4 : 3, stride = width * channels;
  const filtered = inflateSync(Buffer.concat(blocks)), decoded = Buffer.alloc(stride * height);
  assert.equal(filtered.length, height * (stride + 1));
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; ++y) {
    const input = y * (stride + 1), output = y * stride, filter = filtered[input];
    assert.ok(filter <= 4, "Saved PNG uses an original lossless filter");
    for (let x = 0; x < stride; ++x) {
      const a = x >= channels ? decoded[output + x - channels] : 0;
      const b = y > 0 ? decoded[output + x - stride] : 0;
      const c = y > 0 && x >= channels ? decoded[output + x - stride - channels] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      decoded[output + x] = (filtered[input + 1 + x] + predictor) & 255;
    }
  }
  return {width, height, color(x, y) {
    assert.ok(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height);
    const start = y * stride + x * channels;
    return decoded.subarray(start, start + channels).toString("hex") + (channels === 3 ? "ff" : "");
  }};
}
