import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";

// The one place image assets enter a bundle. `require("./logo.png")` becomes what Metro's asset plugin makes of it:
//   module.exports = require("react-native/asset-registry").registerAsset({...the descriptor Metro writes...})
// so RN's own AssetRegistry, resolveAssetSource and Image take it from there. Every variant (logo.png, logo@2x.png,
// logo@3x.png, ...) is copied next to the bundle at the path RN's AssetSourceResolver derives from the descriptor
// (assets/<dir>/<name>@Nx.<ext>, with ../ written as _), and <bundle>.assets.json lists them with their SHA-256 so that an
// export carries exactly those files. Nothing goes through esbuild's output files.
//
// Sources: node_modules/metro/src/Assets.js (getAssetData, buildAssetMap, the md5 hash), src/node-haste/lib/AssetPaths.js
// (the @Nx suffix), src/Bundler/util.js (generateAssetCodeFileAst, which fields the module keeps) and src/lib/imageSize.js
// (the sizes of the first file).
const assetFilter = /\.(?:png|jpe?g|webp|bmp|gif|svg)$/i;
const assetManifestFormat = "godot-fabric.assets/v1";
const defaultPublicPath = "/assets";
const manifestSuffix = ".assets.json";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const posix = (file) => file.split(path.sep).join("/");

// Metro's AssetPaths.parse for a file with no platform extension: logo@2x.png is the 2x file of the asset logo.png.
export function parseAssetFile(file) {
  const extension = path.extname(file).slice(1);
  if (!extension) return null;
  const base = path.basename(file, "." + extension);
  const match = /^(.+?)(?:@([\d.]+)x)?$/.exec(base);
  const resolution = match[2] != null ? Number.parseFloat(match[2]) : Number.NaN;
  return { name: match[1], scale: Number.isNaN(resolution) ? 1 : resolution, type: extension };
}

// The size Metro reads from the first file of an asset; the descriptor holds it divided by that file's scale.
export function imageDimensions(type, content, file) {
  const parse = { bmp, gif, jpeg, jpg: jpeg, png, svg, webp }[type];
  const dimensions = parse?.(content);
  if (!dimensions || !(dimensions.width > 0) || !(dimensions.height > 0)) throw new Error(`Invalid ${type} image asset: ${file}`);
  return dimensions;
}
const ascii = (content, start, end) => content.toString("ascii", start, end);
function png(content) {
  if (content.length < 24 || !content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  // Apple's CgBI PNGs put their IHDR second.
  const first = ascii(content, 12, 16);
  if (first === "IHDR") return content.readUInt32BE(8) === 13 ? { width: content.readUInt32BE(16), height: content.readUInt32BE(20) } : null;
  if (first !== "CgBI") return null;
  const at = 8 + 12 + content.readUInt32BE(8);
  if (content.length < at + 24 || ascii(content, at + 4, at + 8) !== "IHDR") return null;
  return { width: content.readUInt32BE(at + 8), height: content.readUInt32BE(at + 12) };
}
function bmp(content) {
  if (content.length < 26 || ascii(content, 0, 2) !== "BM") return null;
  const header = content.readUInt32LE(14);
  if (header === 12) return { width: content.readUInt16LE(18), height: content.readUInt16LE(20) };
  return header < 40 ? null : { width: Math.abs(content.readInt32LE(18)), height: Math.abs(content.readInt32LE(22)) };
}
function gif(content) {
  return content.length >= 10 && /^GIF8[79]a$/.test(ascii(content, 0, 6))
    ? { width: content.readUInt16LE(6), height: content.readUInt16LE(8) } : null;
}
function jpeg(content) {
  if (content.length < 4 || content[0] !== 0xff || content[1] !== 0xd8) return null;
  let at = 2;
  while (at < content.length) {
    while (at < content.length && content[at] === 0xff) at++;
    if (at >= content.length) return null;
    const marker = content[at++];
    if (marker === 0x00) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      if (marker === 0xd9) return null;
      continue;
    }
    if (at + 2 > content.length) return null;
    const length = content.readUInt16BE(at);
    if (length < 2 || at + length > content.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return length < 7 ? null : { height: content.readUInt16BE(at + 3), width: content.readUInt16BE(at + 5) };
    }
    if (marker === 0xda) return null;
    at += length;
  }
  return null;
}
function webp(content) {
  if (content.length < 20 || ascii(content, 0, 4) !== "RIFF" || ascii(content, 8, 12) !== "WEBP") return null;
  let at = 12;
  while (at + 8 <= content.length) {
    const type = ascii(content, at, at + 4);
    const length = content.readUInt32LE(at + 4);
    const data = at + 8;
    if (data + length > content.length) return null;
    if (type === "VP8X" && length >= 10) {
      return { width: 1 + content.readUIntLE(data + 4, 3), height: 1 + content.readUIntLE(data + 7, 3) };
    }
    if (type === "VP8L" && length >= 5 && content[data] === 0x2f) {
      return { width: 1 + (((content[data + 2] & 0x3f) << 8) | content[data + 1]),
        height: 1 + (((content[data + 4] & 0x0f) << 10) | (content[data + 3] << 2) | ((content[data + 2] & 0xc0) >> 6)) };
    }
    if (type === "VP8 " && length >= 10 && content[data + 3] === 0x9d && content[data + 4] === 0x01 && content[data + 5] === 0x2a) {
      return { width: content.readUInt16LE(data + 6) & 0x3fff, height: content.readUInt16LE(data + 8) & 0x3fff };
    }
    const next = data + length + (length % 2);
    if (next <= at) return null;
    at = next;
  }
  return null;
}
const svgUnits = { in: 96, cm: 96 / 2.54, em: 16, ex: 8, mm: 96 / 2.54 / 10, pc: (96 / 72) * 12, pt: 96 / 72, px: 1 };
function svgLength(value) {
  if (value == null || value.endsWith("%")) return null;
  const match = /^([+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([a-z]*)$/i.exec(value.trim());
  if (!match) return null;
  const factor = match[2] === "" ? 1 : svgUnits[match[2].toLowerCase()];
  return factor == null ? null : Math.round(Number(match[1]) * factor);
}
function svg(content) {
  const header = content.subarray(0, Math.min(content.length, 64 * 1024)).toString("utf8");
  const start = /<svg(?:\s|>)/.exec(header);
  if (!start) return null;
  let quote = null, end = -1;
  for (let at = start.index; at < header.length && end < 0; at++) {
    const character = header[at];
    if (quote) quote = character === quote ? null : quote;
    else if (character === '"' || character === "'") quote = character;
    else if (character === ">") end = at;
  }
  if (end < 0) return null;
  const root = header.slice(start.index, end + 1);
  const attributes = {};
  for (const match of root.matchAll(/\b(width|height|viewBox)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) attributes[match[1].toLowerCase()] = match[2] ?? match[3];
  const width = svgLength(attributes.width), height = svgLength(attributes.height);
  if (width != null && height != null) return { width, height };
  const box = attributes.viewbox?.trim().split(/[\s,]+/).map(Number);
  if (!box || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) return null;
  if (width != null) return { width, height: Math.floor(width / (box[2] / box[3])) };
  if (height != null) return { width: Math.floor(height * (box[2] / box[3])), height };
  return { width: box[2], height: box[3] };
}

// Where the assets of a bundle live, relative to the bundle: RN's AssetSourceResolver builds assets/<dir>/<name>[@Nx].<ext>
// from the descriptor's httpServerLocation and turns every ../ into _ (scaledAssetURLNearBundle).
export function assetFilePath(descriptor, scale) {
  const directory = descriptor.httpServerLocation.replace(/^\//, "").replace(/\.\.\//g, "_");
  return `${directory}/${descriptor.name}${scale === 1 ? "" : `@${scale}x`}.${descriptor.type}`;
}

async function readManifest(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

// `root` is the project directory the assets' httpServerLocation is relative to, as Metro's project root is.
export function createAssetPipeline({ root: projectRoot, publicPath = defaultPublicPath }) {
  // esbuild hands the plugin real paths, so the root the locations are relative to has to be one too.
  const root = realpathSync(projectRoot);
  const assets = new Map();

  async function describe(file) {
    const parsed = parseAssetFile(file);
    const directory = path.dirname(file);
    const key = path.join(directory, `${parsed.name}.${parsed.type}`);
    if (assets.has(key)) return assets.get(key);
    // Every sibling with the same name and type is a scale of this asset, sorted by scale (buildAssetMap).
    const variants = [];
    for (const entry of await readdir(directory)) {
      const sibling = parseAssetFile(entry);
      if (sibling && sibling.name === parsed.name && sibling.type === parsed.type) variants.push({ ...sibling, source: path.join(directory, entry) });
    }
    variants.sort((a, b) => a.scale - b.scale);
    const contents = await Promise.all(variants.map((variant) => readFile(variant.source)));
    const hash = createHash("md5");
    for (const content of contents) hash.update(content);
    if (contents[0].length === 0) throw new Error(`Image asset \`${variants[0].source}\` cannot be an empty file.`);
    const first = imageDimensions(parsed.type, contents[0], variants[0].source);
    const local = path.relative(root, file);
    const location = local.startsWith("..")
      ? publicPath.replace(/\/$/, "") + "/" + posix(path.dirname(local))
      : posix(path.join(publicPath, path.dirname(local)));
    const descriptor = { __packager_asset: true, httpServerLocation: location, width: first.width / variants[0].scale,
      height: first.height / variants[0].scale, scales: variants.map((variant) => variant.scale), hash: hash.digest("hex"),
      name: parsed.name, type: parsed.type };
    const record = { descriptor, files: variants.map((variant, index) => ({ source: variant.source, scale: variant.scale,
      path: assetFilePath(descriptor, variant.scale), sha256: sha256(contents[index]), bytes: contents[index].length })) };
    assets.set(key, record);
    return record;
  }

  const plugin = {
    name: "godot-assets",
    setup(builder) {
      builder.onLoad({ filter: assetFilter }, async ({ path: file }) => {
        const { descriptor, files } = await describe(file);
        return { loader: "js", resolveDir: path.dirname(file), watchFiles: files.map((variant) => variant.source),
          contents: `module.exports = require("react-native/asset-registry").registerAsset(${JSON.stringify(descriptor)});\n` };
      });
    },
  };

  // Writes what a bundle at `bundleFile` with this SHA-256 needs beside it, under staging names, and returns the step that
  // puts it in place (every file, then the manifest) and the one that takes the staging files away. Without assets it
  // retires the manifest a previous build left and the files only that manifest named.
  async function stage(bundleFile, bundleSha256) {
    const directory = path.dirname(bundleFile);
    const manifestFile = bundleFile + manifestSuffix;
    const suffix = `.staging-${process.pid}`;
    const files = new Map();
    for (const { files: variants } of assets.values()) for (const variant of variants) files.set(variant.path, variant);
    const sorted = [...files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const manifest = sorted.length === 0 ? null : {
      format: assetManifestFormat, bundle: path.basename(bundleFile), bundleSha256, publicPath,
      assets: [...assets.values()].map(({ descriptor, files: variants }) => ({ name: descriptor.name, type: descriptor.type,
        httpServerLocation: descriptor.httpServerLocation, scales: descriptor.scales, hash: descriptor.hash,
        files: variants.map((variant) => variant.path) })).sort((a, b) => (a.files[0] < b.files[0] ? -1 : 1)),
      files: sorted.map(({ path: file, sha256: digest, bytes }) => ({ path: file, sha256: digest, bytes })) };
    const staged = [];
    const discard = async () => { await Promise.all(staged.map((file) => rm(file, { force: true }))); };
    try {
      for (const variant of sorted) {
        const target = path.join(directory, variant.path);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(variant.source, target + suffix);
        staged.push(target + suffix);
      }
      if (manifest) {
        await writeFile(manifestFile + suffix, JSON.stringify(manifest, null, 2) + "\n");
        staged.push(manifestFile + suffix);
      }
    } catch (error) {
      await discard();
      throw error;
    }
    const commit = async () => {
      const previous = await readManifest(manifestFile);
      for (const variant of sorted) await rename(path.join(directory, variant.path) + suffix, path.join(directory, variant.path));
      if (manifest) await rename(manifestFile + suffix, manifestFile);
      else await rm(manifestFile, { force: true });
      // What the previous manifest named and nobody names now. Another bundle in the directory may still name it.
      const keep = new Set(sorted.map((variant) => variant.path));
      for (const sibling of await readdir(directory)) {
        if (!sibling.endsWith(manifestSuffix) || path.join(directory, sibling) === manifestFile) continue;
        for (const entry of (await readManifest(path.join(directory, sibling)))?.files ?? []) keep.add(entry.path);
      }
      for (const entry of previous?.files ?? []) if (!keep.has(entry.path)) await rm(path.join(directory, entry.path), { force: true });
    };
    return { manifest, commit, discard };
  }

  return { plugin, stage, get count() { return assets.size; } };
}

// For the bundlers that write their bundle themselves: put the assets and manifest beside a bundle that is already there.
export async function publishAssets(pipeline, bundleFile, code) {
  const staged = await pipeline.stage(bundleFile, sha256(code));
  try {
    await staged.commit();
  } finally {
    await staged.discard();
  }
  return staged.manifest;
}
