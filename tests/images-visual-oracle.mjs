import assert from "node:assert/strict";
import {fingerprint, pictures, rgba} from "./images-pattern.mjs";
import {contentModeDraw} from "./images-oracle.mjs";
import {visualPictures} from "./images-visual-pattern.mjs";

// Independent oracle for build/images-visual-report.json, written apart from tests/images-visual-probe.gd and from the C++ it probes. It
// recomputes what a correct host reports from the declared inputs of the fixture and from RN iOS's own formulas (the box of
// RCTBlurredImageWithRadius and its two passes, in premultiplied alpha, with its rounding written out; the corner insets and the rounded
// rectangle's clamp of RCTBorderDrawing.m; the CSS overlap rule of BaseViewProps.cpp; the order in which RCTImageComponentView applies tint,
// caps and blur), from the pictures themselves (tests/images-pattern.mjs and images-visual-pattern.mjs, which also wrote the files), and only
// then compares: the blurred pixels exactly (by the fingerprint of the bitmap the worker made), every rectangle, radius, margin and
// color the view asked the renderer for within a thousandth, and the counters and caches of the loader by a model of what each request
// must do to them.
const SCALE = 2;
const tolerance = 1e-3;
export const visualJsOnlyChecks = [
  "mount/Every declared Image mounts one native GodotImage, and the application reports no host or runtime error",
  "contract/A blur radius or cap insets that are not numbers fail where the Image renders, and no declared Image fails",
  "contract/Each refusal names the prop and what it must be",
  "mount/Every Image asked the loader for exactly one request",
  "ignored/An Image with all of them loads and reports exactly what one without them does",
  "ignored/and draws the same picture the same way, with the same effects",
  "blur/A blurred Image reports loadStart, progress, load and loadEnd, once each",
  "tint/The background and the border of a tinted Image are painted as they are: the tint belongs to the picture's own item",
  "network/A tinted view and a masked view of the cached picture are answered by the decoded cache: they share its picture, and no texture is made",
  "network/and the cached picture, shown by two other views, is as it was",
  "cleanup/No host or runtime diagnostic was reported",
  "cleanup/Stop releases every root and queued work",
  "report/The visual images report is saved",
];
export const visualCheckCount = 53;

const declaredIds = {
  blur: ["plain-2x", "blur-1x-r4", "blur-2x-r1", "blur-2x-r2", "blur-2x-r4", "blur-2x-r6", "blur-3x-r4", "blur-3x-r30", "blur-kernel-1", "blur-epsilon", "blur-zero",
    "blur-tint", "blur-caps", "blur-repeat", "blur-live"],
  tint: ["tint-hex", "tint-alpha", "tint-transparent", "tint-style", "tint-prop-wins", "tint-appearance", "tint-live"],
  caps: ["caps-object", "caps-number", "caps-asymmetric", "caps-partial", "caps-repeat", "caps-repeat-zero", "caps-cover", "caps-zero", "caps-oversize", "caps-frame", "caps-live"],
  mask: ["mask-radius", "mask-border", "mask-padding", "mask-ellipse", "mask-corners", "mask-pill", "mask-overlap", "mask-visible", "mask-scroll", "mask-square", "mask-cover",
    "mask-contain", "mask-center", "mask-repeat", "mask-3x", "mask-live", "all-together"],
  ignored: ["ignored-control", "ignored-all"],
};

// ---- numbers ----

function close(actual, expected, label) {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual) && actual.length === expected.length, `${label}: ${JSON.stringify(actual)} is not ${JSON.stringify(expected)}`);
    expected.forEach((value, index) => close(actual[index], value, `${label}[${index}]`));
  } else if (expected !== null && typeof expected === "object") {
    assert.ok(actual !== null && typeof actual === "object", `${label}: ${JSON.stringify(actual)} is not an object`);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${label}: the keys`);
    for (const key of Object.keys(expected)) close(actual[key], expected[key], `${label}.${key}`);
  } else if (typeof expected === "number") {
    assert.ok(typeof actual === "number" && Math.abs(actual - expected) <= tolerance, `${label}: ${actual} is not ${expected}`);
  } else {
    assert.equal(actual, expected, label);
  }
}
const rectOf = (x, y, width, height) => ({x, y, width, height});
const scaledRect = (rect, factor) => rectOf(rect.x * factor, rect.y * factor, rect.width * factor, rect.height * factor);
const rectValues = rect => [rect.x, rect.y, rect.width, rect.height];

// ---- the blur: RCTBlurredImageWithRadius, written out pixel by pixel ----

const FLT_EPSILON = 2 ** -23;
function boxSide(radius, scale) {
  if (!(radius > FLT_EPSILON)) return 0;
  return Math.floor((radius * scale * 3 * Math.sqrt(2 * Math.PI) / 4 + 0.5) / 2) | 1;
}
// Straight RGBA8 to premultiplied: round(c a / 255). Two passes of a square box of kernel x kernel pixels, the edge extended: the mean of the
// window, rounded to the nearest (the divisor is odd, so there is no tie). Back to straight: round(p 255 / a), at most 255, black where a is 0.
export function blurredPixels(bytes, width, height, kernel) {
  const out = Buffer.from(bytes);
  for (let at = 0; at < out.length; at += 4) {
    for (let channel = 0; channel < 3; channel++) out[at + channel] = Math.floor((bytes[at + channel] * bytes[at + 3] + 127) / 255);
  }
  const reach = (kernel - 1) / 2, area = kernel * kernel;
  let current = out;
  for (let pass = 0; pass < 2; pass++) {
    const next = Buffer.alloc(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let channel = 0; channel < 4; channel++) {
          let sum = 0;
          for (let dy = -reach; dy <= reach; dy++) {
            const row = Math.min(Math.max(y + dy, 0), height - 1);
            for (let dx = -reach; dx <= reach; dx++) sum += current[(row * width + Math.min(Math.max(x + dx, 0), width - 1)) * 4 + channel];
          }
          next[(y * width + x) * 4 + channel] = Math.floor((sum + Math.floor(area / 2)) / area);
        }
      }
    }
    current = next;
  }
  for (let at = 0; at < current.length; at += 4) {
    const alpha = current[at + 3];
    for (let channel = 0; channel < 3; channel++) current[at + channel] = alpha === 0 ? 0 : Math.min(255, Math.floor((2 * 255 * current[at + channel] + alpha) / (2 * alpha)));
  }
  return current;
}

// ---- the declared pictures ----

const visualDir = "res://tests/fixtures/images-visual/";
function pictureOf(source) {
  if (source.uri.startsWith(visualDir)) {
    const picture = visualPictures[source.uri.slice(visualDir.length)];
    assert.ok(picture, "A declared picture: " + source.uri);
    return {width: picture.width, height: picture.height, scale: picture.scale, bytes: rgba(picture)};
  }
  // The server's picture, decoded for a 24x24 point frame at the content scale: its own 24x24 pixels, which are 12 points.
  assert.match(source.uri, /^http:\/\/127\.0\.0\.1:\d+\/pic\/max-age\/quad24\.png$/);
  const picture = pictures["formats/format.png"];
  return {width: picture.width, height: picture.height, scale: SCALE, bytes: rgba(picture)};
}

// ---- colors ----

function parseColor(value) {
  if (value === undefined || value === null) return null;
  let r, g, b, a;
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  const functional = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (hex) [r, g, b, a] = [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16), 255];
  else if (functional) [r, g, b, a] = [Number(functional[1]), Number(functional[2]), Number(functional[3]), Math.round(Number(functional[4]) * 255)];
  else throw new Error("The oracle reads #rrggbb and rgba(r, g, b, a): " + value);
  // RN's C++ colors are one integer of the platform it was built for, and zero is "no color": a fully transparent black is not a tint.
  if (r === 0 && g === 0 && b === 0 && a === 0) return null;
  return [r / 255, g / 255, b / 255, a / 255];
}

// ---- the view's geometry: ViewProps' radii, RCTBorderDrawing's insets and clamp ----

const corners = ["tl", "tr", "br", "bl"];
const cornerStyles = {tl: "borderTopLeftRadius", tr: "borderTopRightRadius", br: "borderBottomRightRadius", bl: "borderBottomLeftRadius"};
function radiiOf(style, width, height) {
  const resolve = (value, reference) => (typeof value === "string" && value.endsWith("%") ? Number.parseFloat(value) / 100 * reference : value);
  const radii = {};
  for (const corner of corners) {
    const value = style[cornerStyles[corner]] ?? style.borderRadius ?? 0;
    // A percentage is of the width along a corner's horizontal radius, and of the height along its vertical one.
    radii[corner] = {h: resolve(value, width), v: resolve(value, height)};
  }
  // The CSS rule: when two radii of one side add up to more than the side, every radius is reduced in proportion.
  const scale = (size, total) => (total > 0 ? Math.min(size / total, 1) : 0);
  const left = scale(height, radii.tl.v + radii.bl.v), top = scale(width, radii.tl.h + radii.tr.h);
  const right = scale(height, radii.tr.v + radii.br.v), bottom = scale(width, radii.bl.h + radii.br.h);
  const by = (corner, a, b) => ({h: radii[corner].h * Math.min(a, b), v: radii[corner].v * Math.min(a, b)});
  return {tl: by("tl", top, left), tr: by("tr", top, right), br: by("br", bottom, right), bl: by("bl", bottom, left)};
}
function insetCorners(radii, widths) {
  const less = (radius, width) => Math.max(0, radius - width);
  return {tl: {h: less(radii.tl.h, widths.left), v: less(radii.tl.v, widths.top)}, tr: {h: less(radii.tr.h, widths.right), v: less(radii.tr.v, widths.top)},
    br: {h: less(radii.br.h, widths.right), v: less(radii.br.v, widths.bottom)}, bl: {h: less(radii.bl.h, widths.left), v: less(radii.bl.v, widths.bottom)}};
}
// RCTPathCreateWithRoundedRect: a radius never exceeds what the neighbouring one leaves of the side.
function pathCorners(width, height, c) {
  const fit = (radius, room) => Math.max(0, Math.min(radius, room));
  return {tl: {h: fit(c.tl.h, width - c.tr.h), v: fit(c.tl.v, height - c.bl.v)}, tr: {h: fit(c.tr.h, width - c.tl.h), v: fit(c.tr.v, height - c.br.v)},
    br: {h: fit(c.br.h, width - c.bl.h), v: fit(c.br.v, height - c.tr.v)}, bl: {h: fit(c.bl.h, width - c.br.h), v: fit(c.bl.v, height - c.tl.v)}};
}
const cornersJson = c => ({horizontal: corners.map(corner => c[corner].h), vertical: corners.map(corner => c[corner].v)});

function layoutOf(style) {
  const widths = {left: style.borderLeftWidth ?? style.borderWidth ?? 0, top: style.borderTopWidth ?? style.borderWidth ?? 0, right: style.borderRightWidth ?? style.borderWidth ?? 0,
    bottom: style.borderBottomWidth ?? style.borderWidth ?? 0};
  const padding = {left: style.paddingLeft ?? style.padding ?? 0, top: style.paddingTop ?? style.padding ?? 0, right: style.paddingRight ?? style.padding ?? 0,
    bottom: style.paddingBottom ?? style.padding ?? 0};
  const content = rectOf(widths.left + padding.left, widths.top + padding.top, style.width - widths.left - widths.right - padding.left - padding.right,
    style.height - widths.top - widths.bottom - padding.top - padding.bottom);
  return {width: style.width, height: style.height, widths, content};
}

// ---- what a view must hold and ask of the renderer ----

function expectedView(state) {
  const {source, style, props} = state;
  const layout = layoutOf(style);
  const picture = pictureOf(source);
  const mode = props.resizeMode ?? "cover";
  const given = parseColor(props.tintColor ?? style.tintColor);
  const radius = props.blurRadius ?? 0;
  const kernel = boxSide(radius, picture.scale);
  const applies = kernel > 1;
  // What the picture holds of the blur it was asked for: nothing, for a radius RN does not blur at.
  const blur = {radius: radius > FLT_EPSILON ? radius : 0, scale: radius > FLT_EPSILON ? picture.scale : 0, kernel, passes: 2, applies};
  const bytes = applies ? blurredPixels(picture.bytes, picture.width, picture.height, kernel) : picture.bytes;
  const caps = typeof props.capInsets === "number" ? {left: props.capInsets, top: props.capInsets, right: props.capInsets, bottom: props.capInsets}
    : {left: props.capInsets?.left ?? 0, top: props.capInsets?.top ?? 0, right: props.capInsets?.right ?? 0, bottom: props.capInsets?.bottom ?? 0};
  const clips = (style.overflow ?? "hidden") !== "visible";
  const radii = radiiOf(style, layout.width, layout.height);
  // A blurred picture is rebuilt from its bitmap: it has lost the template mode, the caps and the tiling.
  const plain = applies;
  const tint = plain ? null : given;
  const effective = plain && mode === "repeat" ? "stretch" : mode;
  const natural = [picture.width / picture.scale, picture.height / picture.scale];
  const plan = contentModeDraw(effective, [layout.content.width, layout.content.height], natural);
  assert.ok(plan, "Something is drawn");
  const factor = picture.scale;
  const dst = scaledRect(rectOf(layout.content.x + plan.dst.x, layout.content.y + plan.dst.y, plan.dst.width, plan.dst.height), factor);
  const src = scaledRect(plan.src, factor);
  const margins = {left: Math.min(Math.max(caps.left * factor, 0), picture.width), top: Math.min(Math.max(caps.top * factor, 0), picture.height)};
  margins.right = Math.min(Math.max(caps.right * factor, 0), picture.width - margins.left);
  margins.bottom = Math.min(Math.max(caps.bottom * factor, 0), picture.height - margins.top);
  const hasMargins = Object.values(margins).some(value => value > 0);
  let kind = plan.tiled ? "tile" : "region";
  let command = plan.tiled ? {op: "textureRectTile", dst} : {op: "textureRectRegion", dst, src};
  if (!plain && hasMargins && (effective === "stretch" || effective === "repeat")) {
    const axis = effective === "repeat" ? "tile" : "stretch";
    kind = "ninePatch";
    command = {op: "ninePatch", dst, src: rectOf(0, 0, picture.width, picture.height), margins, xMode: axis, yMode: axis};
  }
  let clip = null;
  if (clips) {
    const outer = {rect: rectOf(0, 0, layout.width, layout.height), radii: pathCorners(layout.width, layout.height, insetCorners(radii, {left: 0, top: 0, right: 0, bottom: 0}))};
    const inner = {rect: layout.content, radii: pathCorners(layout.content.width, layout.content.height, insetCorners(radii, layout.widths))};
    const round = shape => corners.some(corner => shape.radii[corner].h > 0 || shape.radii[corner].v > 0);
    if (round(outer) || round(inner)) clip = {outer, inner};
  }
  const shaded = tint !== null || clip !== null;
  const pixelShape = shape => (shape === null ? {rect: [0, 0, 0, 0], rx: [0, 0, 0, 0], ry: [0, 0, 0, 0]}
    : {rect: rectValues(scaledRect(shape.rect, factor)), rx: corners.map(corner => shape.radii[corner].h * factor), ry: corners.map(corner => shape.radii[corner].v * factor)});
  const outerPx = pixelShape(clip?.outer ?? null), innerPx = pixelShape(clip?.inner ?? null);
  const params = shaded ? {tinted: tint ? 1 : 0, tint: tint ?? [1, 1, 1, 1], clipped: clip ? 1 : 0, outer_rect: outerPx.rect, outer_rx: outerPx.rx, outer_ry: outerPx.ry,
    inner_rect: innerPx.rect, inner_rx: innerPx.rx, inner_ry: innerPx.ry} : {};
  return {
    layout, picture,
    props: {tint: given, blurRadius: radius, capInsets: caps, clips, frame: {width: layout.width, height: layout.height}, borderWidths: layout.widths, borderRadii: cornersJson(radii)},
    image: {width: picture.width, height: picture.height, scale: picture.scale, fingerprint: fingerprint(bytes), blur},
    drawn: {mode: effective, dst: rectOf(layout.content.x + plan.dst.x, layout.content.y + plan.dst.y, plan.dst.width, plan.dst.height), src: plan.src, tiled: plan.tiled},
    effects: {kind, scale: factor, tint, clip: clip === null ? null : {outer: {rect: clip.outer.rect, radii: cornersJson(clip.outer.radii)},
      inner: {rect: clip.inner.rect, radii: cornersJson(clip.inner.radii)}}, shaded, params, commands: [command]},
  };
}

// One view, against what the oracle derives from the Image's declared state.
function verifyView(view, state, label) {
  const expected = expectedView(state);
  assert.equal(view.status, "loaded", `${label}: the picture loaded`);
  close(view.props, expected.props, `${label}: what the view was given`);
  close(view.content, expected.layout.content, `${label}: the content frame`);
  const picture = view.image;
  close([picture.width, picture.height, picture.scale, picture.textureWidth, picture.textureHeight],
    [expected.picture.width, expected.picture.height, expected.picture.scale, expected.picture.width, expected.picture.height], `${label}: the texture`);
  assert.equal(picture.format, "png", label);
  close(picture.blur, expected.image.blur, `${label}: the blur`);
  assert.equal(picture.fingerprint, expected.image.fingerprint, `${label}: the pixels of the bitmap are those the blur must make`);
  const drawn = view.drawn;
  assert.equal(drawn.mode, expected.drawn.mode, `${label}: the mode`);
  close(drawn.dst, expected.drawn.dst, `${label}: where it is drawn`);
  close(drawn.src, expected.drawn.src, `${label}: what of it is drawn`);
  assert.equal(drawn.tiled, expected.drawn.tiled, `${label}: tiled`);
  const effects = drawn.effects, wanted = expected.effects;
  assert.equal(effects.kind, wanted.kind, `${label}: how it is drawn`);
  close(effects.scale, wanted.scale, `${label}: the scale`);
  close(effects.tint, wanted.tint, `${label}: the tint`);
  close(effects.clip, wanted.clip, `${label}: the clip`);
  const layer = effects.layer;
  assert.equal(layer.item, true, `${label}: an item of its own`);
  assert.equal(layer.shaded, wanted.shaded, `${label}: the shader`);
  // A material is made the first time a picture needs the shader and kept for the view's life.
  if (wanted.shaded) assert.equal(layer.material, true, `${label}: a material of its own`);
  close(layer.params, wanted.params, `${label}: the parameters of the material`);
  close(layer.commands, wanted.commands, `${label}: the commands`);
  close(view.planned, {dst: expected.drawn.dst, src: expected.drawn.src, tiled: expected.drawn.tiled}, `${label}: planned`);
  return expected;
}

// What an Image declares once the changes the probe made are in: the fixture's merge, where a null takes the declared value away.
const merged = (base, patch) => {
  const out = {...base};
  for (const [name, value] of Object.entries(patch ?? {})) {
    if (value === null) delete out[name];
    else out[name] = value;
  }
  return out;
};

function declaredState(report, prefix, id) {
  const stages = report.stages;
  if (prefix === "V") {
    const spec = stages.mount.declared.find(entry => entry.id === id);
    assert.ok(spec, "A declared Image: " + id);
    return {source: spec.source, style: spec.style, props: spec.props};
  }
  const spec = stages.network.declared.find(entry => entry.id === id);
  assert.ok(spec, "A declared network Image: " + id);
  return {source: {uri: `${report.baseUrl}/pic/max-age/quad24.png`, width: 24, height: 24}, style: {width: 24, height: 24, ...spec.style}, props: {resizeMode: "stretch", ...spec.props}};
}

// Every state an Image was in: as declared, and after each change the probe made to it.
function statesOf(report, prefix, id) {
  const declared = declaredState(report, prefix, id);
  const states = [declared];
  let accumulated = {style: {}, props: {}};
  for (const change of report.stages.changes.filter(entry => entry.prefix === prefix && entry.id === id)) {
    accumulated = {style: {...accumulated.style, ...change.patch.style}, props: {...accumulated.props, ...change.patch.props}};
    states.push({source: declared.source, style: merged(declared.style, accumulated.style), props: merged(declared.props, accumulated.props)});
  }
  return states;
}

// ---- the report ----

function verifyDeclared(report) {
  const declared = report.stages.mount.declared;
  assert.deepEqual(declared.map(entry => entry.id), Object.values(declaredIds).flat(), "The fixture declares the Images the oracle knows, in order");
  for (const [group, ids] of Object.entries(declaredIds)) {
    for (const id of ids) assert.equal(declared.find(entry => entry.id === id).group, group, id);
  }
}

function verifyMount(report) {
  const nodes = report.stages.mount.surface.nodes.filter(node => node.kind === "image");
  const logs = report.stages.mount.react.logs;
  assert.equal(nodes.length, report.stages.mount.declared.length);
  const expected = {};
  for (const spec of report.stages.mount.declared) {
    const node = nodes.find(entry => entry.testID === `V-${spec.id}`);
    assert.ok(node, spec.id);
    const state = declaredState(report, "V", spec.id);
    expected[spec.id] = verifyView(node.image, state, spec.id);
    // The events of a bundled picture, and what onLoad says of it: its size in points, in pixels of the content scale.
    assert.deepEqual(logs[`V-${spec.id}`].map(event => event.type), ["loadStart", "progress", "load", "loadEnd"], `${spec.id}: events`);
    const picture = expected[spec.id].picture;
    const load = logs[`V-${spec.id}`].find(event => event.type === "load");
    close([load.width, load.height], [picture.width / picture.scale * SCALE, picture.height / picture.scale * SCALE], `${spec.id}: onLoad's size`);
    assert.equal(node.image.counters.loads, 1, spec.id);
  }
  // The box of each declared blur, from the formula alone.
  const kernels = {"blur-1x-r4": 5, "blur-2x-r1": 3, "blur-2x-r2": 5, "blur-2x-r4": 7, "blur-2x-r6": 11, "blur-3x-r4": 11, "blur-3x-r30": 85, "blur-kernel-1": 1, "blur-epsilon": 0, "blur-zero": 0,
    "blur-tint": 5, "blur-caps": 5, "blur-repeat": 5, "plain-2x": 0};
  for (const [id, kernel] of Object.entries(kernels)) assert.equal(expected[id].image.blur.kernel, kernel, `${id}: the box the formula gives`);
  // The unblurred pictures are the files'.
  assert.equal(expected["plain-2x"].image.fingerprint, fingerprint(rgba(visualPictures["glyph@2x.png"])));
  for (const id of ["blur-kernel-1", "blur-epsilon", "blur-zero"]) assert.equal(expected[id].image.fingerprint, expected["plain-2x"].image.fingerprint, id);
  // Boxes of different sizes make different pixels, and the picture a blur makes is never the file's.
  const blurred = ["blur-2x-r1", "blur-2x-r2", "blur-2x-r4", "blur-2x-r6"].map(id => expected[id].image.fingerprint);
  assert.equal(new Set([...blurred, expected["plain-2x"].image.fingerprint]).size, 5);
  // Ignored props: what the view holds is the default of what iOS drops, and defaultSource, which reaches it.
  const held = {loadingIndicatorSource: false, fadeDuration: 300, progressiveRenderingEnabled: false, resizeMethod: "auto", resizeMultiplier: 1, overlayColor: false};
  const ignored = id => nodes.find(node => node.testID === id).image;
  close(ignored("V-ignored-all").ignored, {...held, defaultSource: true}, "ignored-all");
  close(ignored("V-ignored-control").ignored, {...held, defaultSource: false}, "ignored-control");
  assert.deepEqual(ignored("V-ignored-all").drawn, ignored("V-ignored-control").drawn, "ignored props change nothing that is drawn");
  return expected;
}

function verifyContract(report) {
  const messages = report.stages.mount.react.boundaries;
  assert.deepEqual(report.stages.mount.refusals.map(entry => entry.id), ["blurRadius-string", "blurRadius-nan", "capInsets-list", "capInsets-name", "capInsets-string"]);
  for (const id of ["blurRadius-string", "blurRadius-nan"]) assert.equal(messages[`V-refusal-${id}`], "Godot Image blurRadius must be a finite number", id);
  for (const id of ["capInsets-list", "capInsets-name", "capInsets-string"]) {
    assert.equal(messages[`V-refusal-${id}`], "Godot Image capInsets must be a number or an object of top, left, bottom and right numbers", id);
  }
  assert.deepEqual(Object.keys(messages).filter(key => !key.includes("refusal")), []);
}

// Every change the probe made, replayed on the declared state: the view after it is what the oracle derives for that state.
function verifyChanges(report) {
  const seen = [];
  const counts = new Map();
  for (const change of report.stages.changes) {
    const key = `${change.prefix}-${change.id}`;
    const index = (counts.get(key) ?? 0) + 1;
    counts.set(key, index);
    const state = statesOf(report, change.prefix, change.id)[index];
    assert.equal(change.reached, true, `${key}: the view drew the change`);
    verifyView(change.view, state, `${key} after ${JSON.stringify(change.patch)}`);
    seen.push([key, change.patch]);
  }
  assert.deepEqual(seen, [
    ["V-blur-live", {props: {blurRadius: 2}}], ["V-blur-live", {props: {blurRadius: null}}],
    ["V-tint-live", {props: {tintColor: "#ff00ff"}}], ["V-tint-live", {props: {tintColor: "#00ffff"}}], ["V-tint-live", {props: {tintColor: null}}],
    ["V-caps-live", {props: {capInsets: {top: 3, left: 3, bottom: 3, right: 3}}}], ["V-caps-live", {props: {capInsets: 5}}], ["V-caps-live", {props: {capInsets: null}}],
    ["V-mask-live", {style: {borderRadius: 12}}], ["V-mask-live", {style: {overflow: "visible"}}], ["V-mask-live", {style: {overflow: "hidden", borderRadius: 6, borderWidth: 1}}],
    ["N-plain-a", {props: {blurRadius: 2}}], ["N-plain-a", {props: {blurRadius: null}}]], "The changes the probe made");
  // Each change is one request, and a blur change asks for the same source again, so that it has no onLoadStart.
  const live = report.stages.blurLive;
  assert.deepEqual(live.types, ["progress", "load", "loadEnd"]);
  assert.equal(live.asked, 1);
}

// The network half, as a model of what each request does to the caches: the server saw one request, and every step below follows.
function verifyNetwork(report) {
  const network = report.stages.network;
  const records = report.server.records.filter(row => row.url === "/pic/max-age/quad24.png");
  assert.equal(records.length, 1, "The server was asked for the picture once: everything else came from the byte cache");
  assert.equal(records[0].method, "GET");
  assert.equal(records[0].status, 200);
  const plain = fingerprint(rgba(pictures["formats/format.png"]));
  const blurred = radius => fingerprint(blurredPixels(rgba(pictures["formats/format.png"]), 24, 24, boxSide(radius, SCALE)));
  assert.notEqual(blurred(1), plain);
  assert.notEqual(blurred(2), blurred(1));
  const before = network.before, [a, b, c, d, e, f] = network.steps;
  assert.deepEqual(network.steps.map(step => step.label), ["blur-a", "plain-a", "blur-b", "shared", "blurred-again", "plain-again"]);
  const delta = (step, previous, key) => step.counters[key] - previous.counters[key];
  // 1. A blurred request: a download, a decode and a blur; the decoded cache is untouched.
  assert.equal(a.counters.downloads - before.downloads, 1);
  assert.equal(a.counters.decodedHits - before.decodedHits, 0);
  assert.equal(a.counters.blurred - before.blurred, 1);
  assert.deepEqual([a.decoded.entries, a.decoded.stores, a.bytes.entries], [network.beforeDecoded.entries, network.beforeDecoded.stores, 1]);
  assert.equal(a.views["blur-a"].image.fingerprint, blurred(1));
  // 2. The plain request after it: the byte cache, a decode of the file's pixels, and the decoded cache has them now.
  assert.deepEqual([delta(b, a, "downloads"), delta(b, a, "byteHits"), delta(b, a, "decodedHits"), delta(b, a, "blurred")], [0, 1, 0, 0]);
  assert.deepEqual([b.decoded.entries, b.decoded.stores], [1, 1]);
  assert.equal(b.views["plain-a"].image.fingerprint, plain);
  // 3. A blurred request again: the decoded cache holds a plain picture and is not asked; the byte cache is, and the blur is made again.
  assert.deepEqual([delta(c, b, "downloads"), delta(c, b, "byteHits"), delta(c, b, "decodedHits"), delta(c, b, "blurred")], [0, 1, 0, 1]);
  assert.deepEqual([c.decoded.entries, c.decoded.stores], [1, 1]);
  assert.equal(c.views["blur-b"].image.fingerprint, blurred(1));
  assert.deepEqual(c.views["blur-b"].image.blur, c.views["blur-a"].image.blur);
  // 4. Two views of the cached picture: the decoded cache answers both, no texture is made, and they hold one picture.
  assert.deepEqual([delta(d, c, "decodedHits"), delta(d, c, "uploads"), delta(d, c, "loaded"), delta(d, c, "downloads"), delta(d, c, "blurred")], [2, 0, 2, 0, 0]);
  assert.deepEqual(d.views.tint.image, d.views["plain-a"].image);
  assert.deepEqual(d.views.mask.image, d.views["plain-a"].image);
  assert.equal(d.views.tint.image.fingerprint, plain);
  assert.equal(d.live, network.beforeLive + 3, "The live textures: the cached picture and the two blurred, no more");
  // Each view draws what it was given over that picture.
  const state = id => declaredState(report, "N", id);
  verifyView(d.views.tint, state("tint"), "N-tint");
  verifyView(d.views.mask, state("mask"), "N-mask");
  verifyView(d.views["blur-a"], state("blur-a"), "N-blur-a");
  assert.equal(d.views.tint.drawn.effects.layer.params.tinted, 1);
  assert.equal(d.views.mask.drawn.effects.layer.params.clipped, 1);
  // 5. The plain Image blurs: a new request for the same source with no onLoadStart, the decoded cache not asked, its picture as it was.
  assert.deepEqual([delta(e, d, "downloads"), delta(e, d, "byteHits"), delta(e, d, "decodedHits"), delta(e, d, "blurred")], [0, 1, 0, 1]);
  assert.equal(e.decoded.entries, 1);
  assert.equal(e.views["plain-a"].image.fingerprint, blurred(2));
  assert.deepEqual(e.views.tint.image, d.views.tint.image, "The cached picture is untouched by a blur of one of its views");
  assert.deepEqual(network.types, ["load", "loadEnd"]);
  // 6. The blur is cleared: the decoded cache answers.
  assert.deepEqual([delta(f, e, "downloads"), delta(f, e, "byteHits"), delta(f, e, "decodedHits"), delta(f, e, "blurred")], [0, 0, 1, 0]);
  assert.equal(f.views["plain-a"].image.fingerprint, plain);
  assert.deepEqual(f.views["plain-a"].image, d.views["plain-a"].image);
}

function verifyLifecycle(report) {
  const {first, afterTinted, afterPlain, afterRemount, local, remote} = report.stages.lifecycle;
  const items = first.itemsCreated - first.itemsFreed, materials = first.materialsCreated - first.materialsFreed;
  assert.equal(items, local.items + remote.items);
  assert.equal(items, local.views + remote.views, "Every Image with a picture has an item");
  assert.equal(local.views, report.stages.mount.declared.length);
  assert.equal(remote.views, 5, "Five of the six network Images were mounted");
  // The Images that tint or clip have a material, and keep it: the oracle counts the ones that did in any state they were in.
  const shaded = report.stages.mount.declared.filter(spec => statesOf(report, "V", spec.id).some(state => expectedView(state).effects.shaded)).length;
  assert.equal(local.materials, shaded, "A material for each local Image that tints or clips, or did");
  assert.equal(remote.materials, 2, "and for the tinted and the masked network ones");
  assert.equal(materials, shaded + 2);
  assert.deepEqual([first.shadersCreated, first.shadersFreed], [1, 0]);
  assert.deepEqual([afterTinted.itemsFreed - first.itemsFreed, afterTinted.materialsFreed - first.materialsFreed], [1, 1]);
  assert.deepEqual([afterPlain.itemsFreed - afterTinted.itemsFreed, afterPlain.materialsFreed - afterTinted.materialsFreed], [1, 0]);
  assert.deepEqual([afterRemount.itemsCreated - afterPlain.itemsCreated, afterRemount.materialsCreated - afterPlain.materialsCreated, afterRemount.shadersCreated], [1, 1, 1]);
}

function verifyStop(report) {
  const {application, effects, afterSurface} = report.stages.afterStop;
  assert.equal(application.stopped, true);
  assert.equal(effects.itemsCreated, effects.itemsFreed, "No item outlives the application");
  assert.equal(effects.materialsCreated, effects.materialsFreed, "No material outlives it");
  assert.deepEqual([effects.shadersCreated, effects.shadersFreed], [1, 0], "The shader is the extension's: made once, and freed when it ends");
  assert.ok(afterSurface.itemsCreated - afterSurface.itemsFreed > 0, "The first root's views were still alive when the second went");
  const images = application.images;
  assert.equal(images.liveTextures, 0, "No texture outlives it");
  assert.equal(images.counters.tasksStarted, images.counters.tasksAwaited);
  assert.equal(application.imageEffects.itemsCreated, application.imageEffects.itemsFreed);
  // Every job that blurred: the formula's box for its radius and its picture's scale, two passes, on a worker thread.
  let blurred = 0;
  for (const job of images.jobs) {
    if (!(job.blur.radius > FLT_EPSILON)) {
      assert.deepEqual([job.blur.kernel, job.blur.applies], [0, false], "A job with no blur has none");
      continue;
    }
    const kernel = boxSide(job.blur.radius, job.scale);
    assert.deepEqual([job.blur.kernel, job.blur.passes, job.blur.applies], [kernel, 2, kernel > 1], `The blur of job ${job.id}`);
    if (kernel > 1) {
      blurred += 1;
      assert.equal(job.thread.worker, true, `Job ${job.id} blurred on a worker`);
      assert.notEqual(job.thread.id, images.hostThread, `Job ${job.id} did not blur on the main thread`);
      assert.equal(job.outcome, "loaded");
    }
  }
  assert.equal(images.counters.blurred, blurred, "The loader counted every picture it blurred, and no other");
  assert.ok(blurred >= 14, "The suite blurred pictures");
}

export function verifyImagesVisualReport(report, {original = false} = {}) {
  assert.equal(report.scale, SCALE);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  verifyDeclared(report);
  verifyContract(report);
  if (original) {
    // The preceding host loads every picture and draws none of the effects: no view has anything to say of them, and every picture it
    // loaded is the file's, blurred or not.
    for (const node of report.stages.mount.surface.nodes.filter(entry => entry.kind === "image")) {
      assert.equal(node.image.status, "loaded", node.testID);
      assert.equal(node.image.drawn.effects, undefined, `${node.testID}: the preceding host asks the renderer for nothing of the effects`);
      assert.equal(node.image.props, undefined, node.testID);
      assert.equal(node.image.image.blur, undefined, node.testID);
    }
    assert.equal(report.stages.afterStop.effects.itemsCreated, undefined);
    return {original: true, views: report.stages.mount.surface.nodes.length};
  }
  const expected = verifyMount(report);
  verifyChanges(report);
  verifyNetwork(report);
  verifyLifecycle(report);
  verifyStop(report);
  assert.equal(report.checks.length, visualCheckCount);
  assert.ok(report.allCurrentAssertionsPassed && report.checks.every(row => row.passed));
  return {cases: Object.keys(expected).length, changes: report.stages.changes.length, jobs: report.stages.afterStop.application.images.jobs.length};
}
