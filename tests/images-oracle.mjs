import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {crc32, inflateSync} from "node:zlib";
import {imageDimensions} from "../sdk/toolchain/asset-plugin.mjs";
import {brokenFiles, encodeBmp, encodePng, encodeSvg, encodeTga, fingerprint, gif, pictures, rgba} from "./images-pattern.mjs";

// Independent oracle for build/images-report.json, written apart from tests/images-probe.gd and from the C++ it probes.
// It recomputes what a correct host reports from RN's formulas (pickScale, the sources ImageShadowNode picks, RCTImageUtils.mm's
// decode sizes, RCTImageComponentView's events, UIViewContentMode's rectangles), from the fixture files themselves and from the
// inputs the fixture declared, and only then compares. Its image header sizes come from the asset pipeline's JavaScript parsers.
const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = path.join(root, "tests/fixtures/images");
const manifest = JSON.parse(readFileSync(path.join(fixtures, "manifest.json"), "utf8"));
const fround = Math.fround;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const same = (actual, expected, label) => assert.deepEqual(actual, expected, label);
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The checks that need nothing of the native host: the contract the wrapper enforces before RN's Image loads, and the
// asset descriptors the bundler wrote. Every other check needs the native pipeline and must fail on a host that has none.
export const jsOnlyChecks = [
  "mount/The application reports no host or runtime error",
  "contract/Every unsupported Image prop fails where the Image renders",
  "contract/Each refusal names the prop and why the host does not implement it yet",
  "contract/Invalid values, unregistered assets and Images inside Text are refused with the host's messages",
  "assets/The bundled asset registers the descriptor Metro writes, with the first scale's size in points",
  "assets/RN's resolver turns the descriptor into the file beside the bundle",
  "cleanup/Stop releases every root and queued work",
  "report/The Images report is saved",
];
export const expectedCheckCount = 74;

// ---- RN's formulas ----

const pickScale = (scales, ratio) => scales.find(scale => scale >= ratio) ?? scales[scales.length - 1] ?? 1;
const scaleSuffix = scale => (scale === 1 ? "" : `@${scale}x`);
const suffixScale = file => {
  const match = /@([\d.]+)x\.[^.]+$/.exec(file);
  return match ? Number.parseFloat(match[1]) : 1;
};
const ceilValue = (value, scale) => Math.ceil(value * scale) / scale;

// RCTImageUtils.mm RCTTargetRect, for the modes the loader asks (the decoder turns stretch into cover): the rectangle's size.
function targetRectSize(source, destination, scale) {
  let [dw, dh] = destination;
  const aspect = source[0] / source[1];
  if (dw === 0) dw = dh * aspect;
  if (dh === 0) dh = dw / aspect;
  const targetAspect = dw / dh;
  if (aspect === targetAspect) return [ceilValue(dw, scale), ceilValue(dh, scale)];
  if (targetAspect <= aspect) return [ceilValue(dh * aspect, scale), ceilValue(dh, scale)];
  return [ceilValue(dw, scale), ceilValue(dw / aspect, scale)];
}
// RCTDecodeImageWithData + RCTTargetSize (cover, no upscaling): the pixels a picture of `source` pixels is decoded at.
function decodedPixels(source, destination, scale) {
  if (destination[0] === 0 && destination[1] === 0) return source;
  let size = targetRectSize(source, destination, scale);
  if (source[0] < size[0] * scale) size = source;
  const pixels = size.map(value => Math.ceil(value * scale));
  if (!(pixels[0] !== 0 && pixels[1] !== 0 && (source[0] > pixels[0] || source[1] > pixels[1]))) return source;
  const factor = Math.max(...pixels) / Math.max(...source);
  return source.map(value => Math.max(1, Math.round(value * factor)));
}

// What UIImageView draws for the content modes RCTContentModeFromImageResizeMode picks (repeat is a tiled resizable image).
function contentModeDraw(mode, [cw, ch], [nw, nh]) {
  if (!(cw > 0 && ch > 0 && nw > 0 && nh > 0)) return null;
  const frame = {x: 0, y: 0, width: cw, height: ch}, whole = {x: 0, y: 0, width: nw, height: nh};
  if (mode === "stretch") return {dst: frame, src: whole, tiled: false};
  if (mode === "repeat") return {dst: frame, src: whole, tiled: true, tile: [nw, nh]};
  if (mode === "contain" || mode === "cover") {
    const fit = Math.min(cw / nw, ch / nh), fill = Math.max(cw / nw, ch / nh);
    if (mode === "contain") {
      const width = nw * fit, height = nh * fit;
      return {dst: {x: (cw - width) / 2, y: (ch - height) / 2, width, height}, src: whole, tiled: false};
    }
    const width = cw / fill, height = ch / fill;
    return {dst: frame, src: {x: (nw - width) / 2, y: (nh - height) / 2, width, height}, tiled: false};
  }
  // center and none keep the picture's size; the frame clips it.
  const x = mode === "center" ? (cw - nw) / 2 : 0, y = mode === "center" ? (ch - nh) / 2 : 0;
  const left = Math.max(0, x), top = Math.max(0, y), right = Math.min(cw, x + nw), bottom = Math.min(ch, y + nh);
  if (!(right > left && bottom > top)) return null;
  return {dst: {x: left, y: top, width: right - left, height: bottom - top},
    src: {x: left - x, y: top - y, width: right - left, height: bottom - top}, tiled: false};
}

// ---- the sources ----

function scheme(uri) {
  const lower = uri.toLowerCase();
  if (uri === "") return "empty";
  if (lower.startsWith("res://")) return "bundle";
  if (lower.startsWith("user://") || lower.startsWith("file://")) return "file";
  if (lower.startsWith("data:")) return "data";
  if (lower.startsWith("http://") || lower.startsWith("https://")) return "network";
  return "unsupported";
}
// The repository file a res:// URI reads: the project, or the assets copied beside the bundle (build/assets/tests/... is tests/...).
function projectFile(uri) {
  const relative = uri.replace(/^res:\/\//i, "").replace(/^build\/assets\//, "");
  return path.join(root, relative);
}
function readSource(uri, inputs) {
  const kind = scheme(uri);
  if (kind === "data") {
    const comma = uri.indexOf(",");
    const header = uri.slice(5, comma), payload = uri.slice(comma + 1);
    const mime = header.split(";")[0];
    if (/;base64$/i.test(header)) return {kind, mime, bytes: /^[A-Za-z0-9+/=\s_-]*$/.test(payload) ? Buffer.from(payload, "base64") : null};
    return {kind, mime, bytes: Buffer.from(decodeURIComponent(payload), "latin1")};
  }
  if (kind === "bundle" || kind === "file") {
    const file = kind === "bundle" ? projectFile(uri) : uri.toLowerCase().startsWith("user://") ? inputs.userFile : decodeURIComponent(uri.slice(7));
    return {kind, file, bytes: existsSync(file) ? readFileSync(file) : null};
  }
  return {kind, bytes: null};
}

function sniff(bytes, file) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (/^GIF8[79]a/.test(bytes.toString("ascii", 0, 6))) return "gif";
  if (bytes.length >= 2 && bytes.toString("ascii", 0, 2) === "BM") return "bmp";
  if (bytes.toString("utf8", 0, 4096).trimStart().startsWith("<") && bytes.toString("utf8", 0, 4096).includes("<svg")) return "svg";
  if (bytes.length >= 18 && /\.tga$/i.test(file ?? "")) return "tga";
  return "unknown";
}
// Whether libpng-class decoders accept the PNG: every chunk's CRC and a chunk walk that reaches IEND after some IDAT.
function pngDecodes(bytes) {
  let at = 8, header = false, data = 0;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at), type = bytes.toString("ascii", at + 4, at + 8);
    if (at + 12 + length > bytes.length) return false;
    if (bytes.readUInt32BE(at + 8 + length) !== crc32(bytes.subarray(at + 4, at + 8 + length))) return false;
    if (type === "IHDR") header = true;
    if (type === "IDAT") data += length;
    at += 12 + length;
    if (type === "IEND") return header && data > 0;
  }
  return false;
}
// The zlib stream inside the IDATs must inflate to the rows of the picture; a corrupt one does not.
function pngInflates(bytes) {
  let at = 8;
  const chunks = [];
  let header;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at), type = bytes.toString("ascii", at + 4, at + 8);
    if (type === "IHDR") header = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IDAT") chunks.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  try {
    const rows = inflateSync(Buffer.concat(chunks));
    return rows.length === (header.readUInt32BE(0) * 4 + 1) * header.readUInt32BE(4);
  } catch {
    return false;
  }
}
const decodes = (format, bytes) => (format === "png" ? pngDecodes(bytes) && pngInflates(bytes) : true);

const sizeLimit = 16384, pixelLimit = 64 * 1024 * 1024;
function headerSize(format, bytes, file) {
  if (format === "tga") return {width: bytes.readUInt16LE(12), height: bytes.readUInt16LE(14)};
  return imageDimensions(format === "jpeg" ? "jpg" : format, bytes, file);
}

// What a correct host makes of one request: its events, its picture, or the failure and its message.
function expectRequest(uri, request, inputs) {
  const read = readSource(uri, inputs);
  const out = {kind: read.kind, events: ["loadStart"]};
  const fail = (message, progress) => {
    if (progress) out.events.push("progress");
    out.events.push("error", "loadEnd");
    out.error = message;
    out.progress = progress ?? null;
    return out;
  };
  if (read.kind === "empty") return fail("The image source has an empty URI");
  if (read.kind === "network") return fail(/^Network images are not supported by this host yet: .*later slice \(/);
  if (read.kind === "unsupported") return fail(new RegExp(`^Unsupported image URI "${escape(uri)}": this host loads`));
  if (read.kind === "data" && read.bytes == null) return fail(/^The data: image URI does not hold valid base64 data$/);
  if (read.bytes == null) {
    return fail(read.kind === "bundle" ? new RegExp(`^Could not find image ${escape(uri)} \\(no such file\\)$`) : /^The file .* could not be opened: no such file$/);
  }
  const size = read.bytes.length;
  if (size === 0) return fail("No image data");
  // File and data handlers deliver the bytes (and so report progress) before the decode can fail.
  const progress = read.kind === "file" ? {progress: 1, loaded: size, total: size}
    : read.kind === "data" ? {progress: fround(-size), loaded: size, total: -1} : null;
  const decodeError = reason => new RegExp(`^Error decoding image data <${size} bytes>: ${reason}`);
  const format = sniff(read.bytes, read.file);
  if (format === "gif") return fail(decodeError("GIF images are not supported"), progress);
  if (format === "unknown") return fail(decodeError("the bytes are not an image format this host decodes"), progress);
  const header = headerSize(format, read.bytes, read.file ?? uri);
  if (header.width > sizeLimit || header.height > sizeLimit || header.width * header.height > pixelLimit) {
    return fail(decodeError("The image is \\d+x\\d+ pixels, over the host limit"), progress);
  }
  if (!decodes(format, read.bytes)) return fail(decodeError(`the ${format} decoder rejected the data`), progress);
  // The picture: bundled files are decoded whole at the scale their name states; vectors are rasterized at the content scale;
  // the rest are decoded at the size that covers the request.
  const scale = request.scale;
  const vector = format === "svg";
  const imageScale = read.kind === "bundle" && !vector ? suffixScale(read.file) : scale;
  const [width, height] = vector ? [Math.ceil(header.width * scale), Math.ceil(header.height * scale)]
    : read.kind === "bundle" ? [header.width, header.height] : decodedPixels([header.width, header.height], request.size, scale);
  out.picture = {format, width, height, sourceWidth: vector ? width : header.width, sourceHeight: vector ? height : header.height, scale: imageScale,
    resized: width !== header.width || height !== header.height};
  out.reported = [fround(fround(width / imageScale) * fround(scale)), fround(fround(height / imageScale) * fround(scale))];
  if (read.kind === "bundle") out.progress = {progress: 1, loaded: 1, total: 1};
  else out.progress = progress;
  if (out.progress) out.events.push("progress");
  out.events.push("load", "loadEnd");
  // The fixture the bytes are, by hash: its pixels are known whatever the way they came.
  const digest = sha256(read.bytes);
  out.fixture = Object.entries(manifest.files).find(([, entry]) => entry.sha256 === digest)?.[0] ?? null;
  return out;
}

// ---- the declared cases ----

function sourcesOf(spec, report) {
  const {inputs} = report;
  const descriptors = report.stages.mount.react.assets;
  const one = descriptor => {
    if (descriptor.asset) {
      const {descriptor: asset} = descriptors[descriptor.asset];
      const scale = pickScale(asset.scales, report.stages.mount.react.pixelRatio);
      return {uri: `res://build${asset.httpServerLocation}/${asset.name}${scaleSuffix(scale)}.${asset.type}`, width: asset.width, height: asset.height,
        scale, packaged: true};
    }
    const named = {$user: inputs.userUri, $file: inputs.fileUri, $missing: inputs.missingUri, $corrupt: inputs.corruptUri};
    return {...descriptor, uri: Object.hasOwn(named, descriptor.uri) ? named[descriptor.uri] : descriptor.uri};
  };
  return spec.source.list ? spec.source.list.map(one) : [one(spec.source)];
}
// Image.ios.js: the style carries the source's size unless the style says otherwise; the mode is objectFit, then the prop, then the style, then cover.
function layoutOf(spec, sources) {
  const style = spec.style ?? {};
  const single = sources.length === 1 ? sources[0] : {};
  const objectFits = {contain: "contain", cover: "cover", fill: "stretch", "scale-down": "contain", none: "none"};
  const width = style.width ?? single.width, height = style.height ?? single.height;
  const inset = (style.borderWidth ?? 0) + (style.padding ?? 0);
  return {width, height, content: [width - 2 * inset, height - 2 * inset], origin: inset,
    mode: objectFits[style.objectFit] ?? spec.resizeMode ?? style.resizeMode ?? "cover"};
}
// ImageShadowNode::getImageSource: the one source, or of several the one whose area is nearest the content's.
function chosenSource(sources, content, scale) {
  if (sources.length === 1) return sources[0];
  const target = content[0] * content[1] * scale * scale;
  let best = Infinity, chosen = sources[0];
  for (const source of sources) {
    const area = source.width * source.height * (source.scale === 0 ? scale : source.scale) ** 2;
    const fit = Math.abs(1 - area / target);
    if (fit < best) {
      best = fit;
      chosen = source;
    }
  }
  return chosen;
}

const rectOf = value => [value.x, value.y, value.width, value.height];
function verifyDraw(planned, view, origin, label) {
  if (planned == null) {
    assert.equal(view.drawn, null, label);
    return;
  }
  same(rectOf(view.drawn.dst), [planned.dst.x + origin, planned.dst.y + origin, planned.dst.width, planned.dst.height], label + ": dst");
  same(rectOf(view.drawn.src), rectOf(planned.src), label + ": src");
  assert.equal(view.drawn.tiled, planned.tiled, label + ": tiled");
  if (planned.tiled) same([view.drawn.tileWidth, view.drawn.tileHeight], planned.tile, label + ": tile");
  assert.equal(view.drawn.mode, view.mode, label);
}

function verifyCase(spec, report) {
  const {logs} = report.stages.mount.react;
  const node = report.stages.mount.surface.nodes.find(entry => entry.testID === `A-${spec.id}`);
  assert.ok(node && node.kind === "image", spec.id);
  const view = node.image;
  const label = spec.id;
  const sources = sourcesOf(spec, report);
  const layout = layoutOf(spec, sources);
  same([node.fabricWidth, node.fabricHeight], [layout.width, layout.height], label + ": layout");
  same(view.content, {x: layout.origin, y: layout.origin, width: layout.content[0], height: layout.content[1]}, label + ": content frame");
  assert.equal(view.mode, layout.mode, label + ": mode");
  const scale = report.scale;
  const chosen = chosenSource(sources, layout.content, scale);
  same([view.source.uri, view.source.width, view.source.height, view.source.scale], [chosen.uri, layout.content[0], layout.content[1], scale], label + ": state source");
  assert.equal(view.source.type, chosen.packaged ? "local" : "remote", label);
  const expected = expectRequest(chosen.uri, {size: layout.content, scale}, report.inputs);
  const log = logs[`A-${spec.id}`];
  same(log.map(event => event.type), expected.events, label + ": events");
  same(view.events.map(event => event.type), expected.events, label + ": native emission");
  for (const event of log) {
    if (event.type === "loadStart" || event.type === "loadEnd") same(event.keys, ["target", "timeStamp"], label + ": " + event.type + " payload");
  }
  if (expected.error != null) {
    const event = log.find(entry => entry.type === "error");
    same(event.keys, ["error", "target", "timeStamp"], label + ": error payload");
    if (expected.error instanceof RegExp) assert.match(event.error, expected.error, label);
    else assert.equal(event.error, expected.error, label);
    assert.equal(view.error, event.error, label);
    assert.equal(view.status, "failed", label);
    assert.equal(view.image, null, label + ": no texture");
    assert.equal(view.drawn, null, label + ": nothing drawn");
    assert.equal(view.counters.errors, 1, label);
  } else {
    assert.equal(view.status, "loaded", label);
    const picture = view.image, wanted = expected.picture;
    same([picture.format, picture.width, picture.height, picture.sourceWidth, picture.sourceHeight, picture.scale],
      [wanted.format, wanted.width, wanted.height, wanted.sourceWidth, wanted.sourceHeight, wanted.scale], label + ": picture");
    same([picture.textureWidth, picture.textureHeight], view.mode === "repeat" ? [Math.round(wanted.width / wanted.scale), Math.round(wanted.height / wanted.scale)] : [wanted.width, wanted.height], label + ": texture");
    const load = log.find(entry => entry.type === "load");
    same(load.keys, ["source", "target", "timeStamp"], label + ": load payload");
    same(load.sourceKeys, ["height", "uri", "width"], label);
    same([load.uri, load.width, load.height], [chosen.uri, ...expected.reported], label + ": onLoad");
    assert.equal(view.counters.loads, 1, label);
    // The pixels: the lossless formats decode to the pattern the generator drew, whenever the decoder left the size alone.
    const known = pictures[expected.fixture];
    if (known?.exact && !wanted.resized) assert.equal(picture.fingerprint, fingerprint(rgba(known)), label + ": pixels");
    else assert.match(picture.fingerprint, /^[0-9a-f]{16}$/, label);
    const natural = [wanted.width / wanted.scale, wanted.height / wanted.scale];
    same([picture.naturalWidth, picture.naturalHeight], natural, label + ": natural size");
    verifyDraw(contentModeDraw(layout.mode, layout.content, natural), view, layout.origin, label);
  }
  if (expected.progress != null) {
    const event = log.find(entry => entry.type === "progress");
    same(event.keys, ["loaded", "progress", "target", "timeStamp", "total"], label + ": progress payload");
    same([event.progress, event.loaded, event.total], [expected.progress.progress, expected.progress.loaded, expected.progress.total], label + ": progress");
  }
  return expected;
}

// ---- the loader ----

function verifyJobs(loader, label) {
  for (const job of loader.jobs) {
    if (job.outcome === "cancelled") {
      assert.equal(job.thread.worker, false, `${label}: a request cancelled before it started never ran`);
      continue;
    }
    assert.equal(job.thread.worker, true, `${label}: job ${job.id} ran on a worker thread`);
    assert.notEqual(job.thread.id, loader.hostThread, `${label}: job ${job.id} ran off the main thread`);
    assert.match(job.thread.id, /^[0-9a-f]{16}$/);
  }
}

const accounted = counters => counters.loaded + counters.failed + counters.cancelled + counters.dropped;

function verifyFixtures() {
  // The committed fixtures are what the generator writes, and the manifest names them.
  const generated = {};
  for (const [relative, picture] of Object.entries(pictures)) {
    if (relative.endsWith(".png")) generated[relative] = encodePng(picture);
    else if (relative.endsWith(".bmp")) generated[relative] = encodeBmp(picture);
    else if (relative.endsWith(".tga")) generated[relative] = encodeTga(picture);
    else if (relative.endsWith(".svg")) generated[relative] = encodeSvg(picture);
  }
  generated["formats/format.gif"] = gif;
  Object.assign(generated, brokenFiles());
  for (const [relative, entry] of Object.entries(manifest.files)) {
    const bytes = readFileSync(path.join(fixtures, relative));
    assert.equal(sha256(bytes), entry.sha256, relative);
    assert.equal(bytes.length, entry.bytes, relative);
    if (generated[relative]) assert.ok(generated[relative].equals(bytes), `${relative} is what the generator writes`);
    if (pictures[relative]?.exact) assert.equal(entry.fingerprint, fingerprint(rgba(pictures[relative])), relative);
    if (pictures[relative]) {
      const size = relative.endsWith(".tga") ? {width: bytes.readUInt16LE(12), height: bytes.readUInt16LE(14)}
        : imageDimensions(relative.split(".").pop(), bytes, relative);
      same([size.width, size.height], [pictures[relative].width, pictures[relative].height], relative);
    }
  }
}

function verifyOriginal(report) {
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  same([...failures].sort(), [...report.expectedOriginalFailures].sort(), "Only the checks that need the native pipeline fail on a host that has none");
  assert.ok(failures.length > 0 && failures.length < report.checks.length);
  for (const name of jsOnlyChecks) {
    const row = report.checks.find(entry => entry.name === name);
    assert.ok(row?.passed, `${name} holds on a host without the native pipeline`);
    assert.ok(!report.expectedOriginalFailures.includes(name), name);
  }
  const mount = report.stages.mount;
  assert.equal(mount.nodes, 0, "No Image reaches a host that cannot render it");
  assert.equal(mount.loader.counters, undefined, "The preceding host has no image loader");
  for (const spec of mount.declared) {
    assert.match(mount.react.boundaries[`A-${spec.id}`], /ImageLoader/, `${spec.id} fails where RN's Image asks for the ImageLoader module`);
  }
}

// ---- the whole report ----

export function verifyImagesReport(report, {original = false} = {}) {
  assert.equal(report.scenario, "images");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, original);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(report.scale, 2);
  verifyFixtures();
  if (original) {
    verifyOriginal(report);
    return;
  }
  const {stages} = report;
  const user = path.join(fixtures, "assets/wide.png");
  report.inputs.userFile = user;
  assert.equal(report.inputs.fileUri, "file://" + user);
  assert.equal(report.inputs.userUri, "user://images-probe/wide.png");
  // Every declared case, from its declared inputs.
  const cases = {};
  assert.equal(stages.mount.declared.length, stages.mount.nodes - 3);
  assert.equal(stages.mount.react.pixelRatio, 2);
  for (const spec of stages.mount.declared) cases[spec.id] = verifyCase(spec, report);
  const mountLoader = stages.mount.loader;
  assert.equal(mountLoader.counters.requested, stages.mount.nodes, "One request per Image");
  assert.equal(accounted(mountLoader.counters), mountLoader.counters.requested);
  same(Object.keys(stages.mount.react.boundaries).filter(key => !key.includes("refusal")), [], "No Image failed to render");
  // The extras: the scale probe, the ImageBackground and the Animated.Image all loaded, the background under its children.
  for (const id of ["A-scales", "A-background", "A-animated"]) {
    const node = stages.mount.surface.nodes.find(entry => entry.testID === id);
    assert.ok(node && node.kind === "image" && node.image.status === "loaded", id);
  }
  assert.ok(stages.mount.surface.nodes.find(entry => entry.testID === "A-background-text"), "ImageBackground renders its children over the Image");
  // Bundled: the chosen file and its pixels.
  const badge = stages.bundled.badge;
  assert.match(badge.source.uri, /\/assets\/tests\/fixtures\/images\/assets\/badge@2x\.png$/);
  assert.equal(badge.image.fingerprint, manifest.files["assets/badge@2x.png"].fingerprint);
  // Modes: the six rectangles, from the formulas.
  const wide = [40, 20];
  for (const mode of ["cover", "contain", "stretch", "center", "repeat", "none"]) {
    verifyDraw(contentModeDraw(mode, [60, 60], wide), {drawn: stages.modes.drawn[mode], mode}, 0, `mode ${mode}`);
  }
  verifyDraw(contentModeDraw("contain", [60, 60], wide), {drawn: stages.modes.changed.drawn, mode: "contain"}, 0, "mode change");
  assert.equal(stages.modes.requestedAfter, stages.modes.requestedBefore, "A resize mode loads nothing");
  assert.equal(stages.modes.changed.counters.loads, 1);
  // Scales: pickScale at each pixel ratio, and the variant's pixels. The Image with several sources picks again at each ratio.
  const bundled = stages.mount.react.assets.badge.descriptor.scales;
  same(bundled, [1, 2, 3]);
  const multiSpec = stages.mount.declared.find(spec => spec.id === "multi");
  const multiAt = factor => {
    const sources = sourcesOf(multiSpec, report);
    return chosenSource(sources, layoutOf(multiSpec, sources).content, factor).uri;
  };
  let previousMulti = multiAt(report.scale);
  for (const entry of stages.scales.results) {
    const scale = pickScale(bundled, entry.factor);
    assert.ok(entry.ratio && entry.loaded, `ratio ${entry.factor}`);
    assert.equal(entry.uri, `res://build/assets/tests/fixtures/images/assets/badge${scaleSuffix(scale)}.png`);
    same([entry.width, entry.scale, entry.layoutWidth, entry.stateScale], [16 * scale, scale, 16, entry.factor], `ratio ${entry.factor}`);
    assert.equal(entry.fingerprint, manifest.files[`assets/badge${scaleSuffix(scale)}.png`].fingerprint);
    assert.equal(entry.multi, multiAt(entry.factor), `ratio ${entry.factor}: the best source`);
    assert.equal(entry.requested[1] - entry.requested[0], 1 + (entry.multi === previousMulti ? 0 : 1), "The scale probe and any Image whose best source changed asked again");
    previousMulti = entry.multi;
  }
  // Swap: one loadStart per URI change, none for the same URI.
  same(stages.swap.log.map(event => event.type), ["loadStart", "progress", "load", "loadEnd"]);
  assert.match(stages.swap.log[2].uri, /format\.bmp$/);
  assert.equal(stages.swap.requestedAfter, stages.swap.requestedBefore + 1, "swap: one request for the new source");
  assert.equal(stages.swap.view.counters.loadStarts, 2, "swap: one loadStart per URI");
  // The upload budget: a poll creates one texture however many are ready, and none is starved.
  const budget = stages.budget;
  assert.equal(budget.after.peakUploadsPerPoll, 1, "budget: a poll creates exactly one texture at a budget of one byte (peakUploadsPerPoll)");
  assert.equal(budget.after.uploads - budget.before.uploads, 6, "budget: every picture is uploaded eventually (uploads)");
  assert.equal(budget.after.loaded - budget.before.loaded, 6, "budget: every picture loads");
  assert.equal(budget.after.requested - budget.before.requested, 6, "budget: six requests");
  // In flight: the request swapped away is cancelled; its decode finishes and is dropped; only the replacement reports.
  const flight = stages.inflight;
  same(flight.log.map(event => event.type), ["loadStart", "loadStart", "progress", "load", "loadEnd"]);
  assert.match(flight.log[3].uri, /format\.tga$/);
  assert.equal(flight.after.dropped - flight.before.dropped, 1, "in flight: the cancelled decode is dropped");
  assert.equal(flight.after.uploads - flight.before.uploads, 1, "in flight: only the replacement creates a texture (uploads)");
  assert.equal(flight.after.cancelled, flight.before.cancelled, "in flight: nothing was cancelled before it started");
  assert.equal(flight.jobs.at(-1).outcome, "dropped", "in flight: the outcome of the swapped-away decode is dropped");
  assert.equal(flight.jobs.at(-1).uploaded, false, "in flight: it uploaded nothing");
  // Removal: no event after the unmount; the decode is dropped.
  const removal = stages.removal;
  same(removal.log.map(event => event.type), ["loadStart"]);
  assert.equal(removal.last.outcome, "dropped", "removal: the unmounted Image's decode is dropped");
  assert.equal(removal.after.uploads, removal.before.uploads, "removal: it creates no texture (uploads)");
  assert.equal(removal.after.dropped - removal.before.dropped, 1, "removal: exactly one decode dropped");
  assert.equal(removal.liveAfter, removal.liveBefore, "removal: no texture leaks");
  // The root's unmount: what was in flight is dropped, what waited is cancelled.
  const unmount = stages.rootUnmount;
  assert.equal(unmount.held.inFlight, 1, "root unmount: one decode in flight");
  assert.equal(unmount.held.pending, 5, "root unmount: five requests waited");
  assert.equal(unmount.held.atGate, 1, "root unmount: the decode was done");
  assert.equal(unmount.after.dropped - unmount.before.dropped, unmount.held.inFlight, "root unmount: the decodes in flight are dropped");
  assert.equal(unmount.after.cancelled - unmount.before.cancelled, unmount.held.pending, "root unmount: the requests that waited are cancelled");
  assert.equal(unmount.after.uploads, unmount.before.uploads, "root unmount: no texture is created (uploads)");
  assert.equal(unmount.liveAfter, unmount.liveBefore, "root unmount: no texture leaks");
  for (let index = 0; index < 6; index++) same(unmount.logs[`B-held-${index}`].map(event => event.type), ["loadStart"], `B-held-${index}`);
  // Stop: every task that was started was awaited; nothing is left.
  const stopped = stages.afterStop.loader;
  assert.equal(stages.beforeStop.loader.inFlight, 1, "stop: a decode is in flight");
  assert.equal(stages.beforeStop.loader.pending, 5, "stop: five requests wait");
  assert.equal(stages.beforeStop.loader.atGate, 1, "stop: the decode in flight is done");
  assert.equal(stopped.stopped, true, "stop: the loader stopped");
  assert.equal(stopped.counters.tasksStarted, stopped.counters.tasksAwaited, "stop: every task started was awaited (tasksStarted)");
  assert.equal(stopped.inFlight + stopped.pending + stopped.finished + stopped.ready, 0, "stop: nothing is left in the loader");
  assert.equal(stopped.liveTextures, 0, "stop: no texture outlives the application");
  assert.equal(stopped.counters.requested, accounted(stopped.counters) + stages.beforeStop.loader.pending + stages.beforeStop.loader.inFlight, "stop: every request is accounted for");
  assert.ok(stages.afterStop.application.stopped && stages.afterStop.application.rootCount === 0 && stages.afterStop.application.pendingWork === 0);
  // Every job that ran did so on a worker thread, at every point of the run.
  verifyJobs(mountLoader, "mount");
  verifyJobs(unmount.held, "held");
  verifyJobs(stopped, "stop");
  const ran = stopped.jobs.filter(job => job.outcome !== "cancelled");
  assert.ok(ran.length > 60);
  assert.ok(ran.every(job => job.thread.worker && job.thread.id !== stopped.hostThread));
  assert.ok(stopped.counters.peakInFlight >= 1 && stopped.counters.peakInFlight <= 4);
  // The statics, from what the host measures.
  const results = stages.api.results;
  const size = (key, expected) => same([results[key].ok, results[key].value?.width, results[key].value?.height], [true, ...expected], key);
  size("getSize", [24, 24]);
  size("getSize-callback", [24, 24]);
  size("getSize-svg", [24, 24]);
  size("getSize-data", [8, 8]);
  size("getSize-jpeg", [24, 24]);
  size("getSize-webp", [24, 24]);
  size("getSize-corrupt", [16, 16]);
  size("getSize-oversize", [65535, 65535]);
  size("getSizeWithHeaders", [24, 24]);
  assert.match(results["getSize-missing"].message, /^E_GET_SIZE_FAILURE: Failed to getSize of res:\/\/tests\/fixtures\/images\/formats\/does-not-exist\.png: Could not find image/);
  assert.match(results["getSize-failure-callback"].value, /^E_GET_SIZE_FAILURE: /);
  assert.match(results["getSize-http"].message, /^E_GET_SIZE_FAILURE: Failed to getSize of https:\/\/example\.invalid\/picture\.png: Network images are not supported by this host yet/);
  assert.match(results["getSizeWithHeaders-http"].message, /^E_GET_SIZE_FAILURE: Network images are not supported/);
  for (const key of ["prefetch", "prefetchWithMetadata"]) assert.match(results[key].message, /^E_PREFETCH_FAILURE: this host has no image cache yet/);
  same(results.queryCache, {ok: true, value: {}});
  const resolved = results.resolve.value;
  same([resolved.pixelRatio, resolved.pickScale, resolved.missing, resolved.nullish], [2, 2, null, null]);
  same(resolved.object, {uri: "res://x.png", width: 3, height: 4});
  // The contract: the messages, from the declared props.
  const messages = stages.contract.messages;
  const later = ["tintColor", "style.tintColor", "blurRadius", "capInsets", "defaultSource", "loadingIndicatorSource", "fadeDuration", "progressiveRenderingEnabled",
    "resizeMethod", "resizeMultiplier", "overlayColor", "style.borderRadius", "style.borderTopLeftRadius", "source.headers", "source.method", "source.body", "source.cache",
    "crossOrigin", "referrerPolicy"];
  for (const id of later) assert.match(messages[`A-refusal-${id}`], new RegExp(`^Godot Image does not implement ${escape(id)} yet: `), id);
  assert.equal(messages["A-refusal-resizeMode"], "Godot Image resizeMode must be cover, contain, stretch, center, repeat, none");
  assert.equal(messages["A-refusal-style.resizeMode"], messages["A-refusal-resizeMode"]);
  assert.equal(messages["A-refusal-style.objectFit"], "Godot Image objectFit must be contain, cover, fill, scale-down, none");
  assert.equal(messages["A-refusal-style.aspectRatio"], "Godot Image does not implement style aspectRatio");
  assert.equal(messages["A-refusal-source.uri"], "Godot Image source.uri must be a string");
  assert.equal(messages["A-refusal-source.unregistered"], "Godot Image source is a number that no asset registered");
  assert.equal(messages["A-refusal-onLoad"], "Image onLoad must be a function");
  assert.match(messages["A-refusal-children"], /^The <Image> component cannot contain children/);
  assert.equal(messages["A-refusal-inline"], "Inline Controls are not implemented in Godot Text");
  same(Object.keys(messages).filter(key => !key.includes("refusal")), []);
  assert.equal(stages.contract.refusals.length, 28);
  // The descriptor Metro writes: recomputed from the three variant files.
  const descriptor = stages.contract.assets.badge.descriptor;
  const md5 = createHash("md5");
  for (const scale of [1, 2, 3]) md5.update(readFileSync(path.join(fixtures, `assets/badge${scaleSuffix(scale)}.png`)));
  same(Object.keys(descriptor).sort(), ["__packager_asset", "hash", "height", "httpServerLocation", "name", "scales", "type", "width"]);
  same(descriptor, {__packager_asset: true, httpServerLocation: "/assets/tests/fixtures/images/assets", width: 16, height: 16, scales: [1, 2, 3],
    hash: md5.digest("hex"), name: "badge", type: "png"});
  assert.equal(stages.contract.assets.badge.source.uri, "res://build/assets/tests/fixtures/images/assets/badge@2x.png");
  same(stages.contract.assets.wide.descriptor.scales, [1]);
  // The summary last: the probe's own verdict.
  assert.equal(report.checks.length, expectedCheckCount);
  assert.ok(report.allCurrentAssertionsPassed && report.checks.every(row => row.passed));
  return {cases: Object.keys(cases).length, jobs: stopped.jobs.length};
}
