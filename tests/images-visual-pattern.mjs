// The pixels of the pictures of the visual images suite as functions of the position. The generator (scripts/images-visual-fixtures.mjs)
// writes them as PNG; the oracle derives what a correct host reports (the blurred pixels, the textures) from these same definitions.
// Written straight (not premultiplied), like every PNG: pixels with no alpha keep a color, so that a blur that forgets the alpha shows.

// A leaf-like shape on a transparent ground: an opaque body whose color changes with the position, a translucent halo that fades into the
// ground, and the ground itself, transparent but red. The same drawing at any size.
function glyphPixel(width, height) {
  return (x, y) => {
    const u = (x + 0.5) / width - 0.5, v = (y + 0.5) / height - 0.5;
    const distance = Math.hypot(u, v * 1.3);
    if (distance < 0.28) return [Math.round(40 + 200 * (u + 0.5)), Math.round(200 - 120 * (v + 0.5)), Math.round(90 + 120 * (v + 0.5)), 255];
    if (distance < 0.4) return [235, 70, 70, Math.round(255 * (0.4 - distance) / 0.12)];
    return [250, 10, 10, 0];
  };
}

// A nine-patch to look at: a colored square in each corner, a white strip along each edge and a checker between them. `edge` is the
// width of the corners and strips in pixels.
const corners = [[230, 60, 50], [60, 190, 90], [60, 110, 230], [240, 200, 40]];
function framePixel(size, edge) {
  return (x, y) => {
    const column = x < edge ? 0 : x >= size - edge ? 2 : 1, row = y < edge ? 0 : y >= size - edge ? 2 : 1;
    if (column !== 1 && row !== 1) return [...corners[(row === 0 ? 0 : 2) + (column === 0 ? 0 : 1)], 255];
    if (column !== 1 || row !== 1) return [255, 255, 255, 255];
    return (x + y) % 4 < 2 ? [34, 40, 60, 255] : [170, 180, 210, 255];
  };
}

// path is relative to tests/fixtures/images-visual; scale is the @Nx of the file name, which a bundled picture is decoded at.
export const visualPictures = {
  "glyph.png": {width: 12, height: 9, pixel: glyphPixel(12, 9), scale: 1},
  "glyph@2x.png": {width: 24, height: 18, pixel: glyphPixel(24, 18), scale: 2},
  "glyph@3x.png": {width: 36, height: 27, pixel: glyphPixel(36, 27), scale: 3},
  "frame@2x.png": {width: 36, height: 36, pixel: framePixel(36, 6), scale: 2},
};
