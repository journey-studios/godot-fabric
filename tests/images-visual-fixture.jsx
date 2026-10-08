import React, {useEffect, useState} from "react";
import {AppRegistry, Image, PixelRatio, Text, View, findNodeHandle} from "react-native";

// Public imports only: RN's own Image.ios.js over the host's native image pipeline, with what the Image does to its picture: the tint, the
// blur, the cap insets and the clip of rounded corners, and the props that iOS ignores. Every Image logs what JS observes; the probe
// reads the native view of the same Image beside it. The pictures are the files of tests/fixtures/images-visual, at scales 1, 2 and 3
// (the @Nx of their names is the scale they are decoded at); the view's content scale is 2.
const dir = "res://tests/fixtures/images-visual/";
const glyph = file => ({uri: dir + file, width: 12, height: 9});
const frame = {uri: dir + "frame@2x.png", width: 18, height: 18};
const size = (width, height) => ({width, height});
const everyCap = value => ({top: value, left: value, bottom: value, right: value});

// The declared inputs. `props` are the props of the Image besides its style and source; `style` is its style. Sizes are in points.
const specs = [
  // ---- blur: the box of RCTBlurredImageWithRadius, in the pixels of the picture ----
  {id: "plain-2x", group: "blur", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "stretch"}},
  {id: "blur-1x-r4", group: "blur", source: glyph("glyph.png"), style: size(24, 18), props: {resizeMode: "stretch", blurRadius: 4}},
  {id: "blur-2x-r1", group: "blur", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "stretch", blurRadius: 1}},
  {id: "blur-2x-r2", group: "blur", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "stretch", blurRadius: 2}},
  {id: "blur-2x-r4", group: "blur", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "stretch", blurRadius: 4}},
  {id: "blur-2x-r6", group: "blur", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "stretch", blurRadius: 6}},
  {id: "blur-3x-r4", group: "blur", source: glyph("glyph@3x.png"), style: size(24, 18), props: {resizeMode: "stretch", blurRadius: 4}},
  {id: "blur-3x-r30", group: "blur", source: glyph("glyph@3x.png"), style: size(24, 18), props: {resizeMode: "stretch", blurRadius: 30}},
  {id: "blur-kernel-1", group: "blur", source: glyph("glyph@2x.png"), style: size(24, 18),
    props: {resizeMode: "stretch", blurRadius: 0.2, tintColor: "#ff8800", capInsets: everyCap(2)}},
  {id: "blur-epsilon", group: "blur", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "stretch", blurRadius: 1e-8, tintColor: "#ff8800"}},
  {id: "blur-zero", group: "blur", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "stretch", blurRadius: 0, tintColor: "#ff8800"}},
  {id: "blur-tint", group: "blur", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "stretch", blurRadius: 2, tintColor: "#ff8800"}},
  {id: "blur-caps", group: "blur", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "stretch", blurRadius: 2, capInsets: everyCap(2)}},
  {id: "blur-repeat", group: "blur", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "repeat", blurRadius: 2}},
  {id: "blur-live", group: "blur", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "stretch"}},
  // ---- tint: every non-transparent pixel takes the color ----
  {id: "tint-hex", group: "tint", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "stretch", tintColor: "#ff8800"}},
  {id: "tint-alpha", group: "tint", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "stretch", tintColor: "rgba(0, 120, 255, 0.5)"}},
  {id: "tint-transparent", group: "tint", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "stretch", tintColor: "rgba(255, 0, 0, 0)"}},
  {id: "tint-style", group: "tint", source: glyph("glyph@2x.png"), style: {...size(24, 18), tintColor: "#00cc66"}, props: {resizeMode: "stretch"}},
  {id: "tint-prop-wins", group: "tint", source: glyph("glyph@2x.png"), style: {...size(24, 18), tintColor: "#00ff00"}, props: {resizeMode: "stretch", tintColor: "#ff0000"}},
  {id: "tint-appearance", group: "tint", source: glyph("glyph@2x.png"),
    style: {...size(32, 26), borderWidth: 2, borderColor: "#abcdef", backgroundColor: "#203040", padding: 1}, props: {resizeMode: "stretch", tintColor: "#ff8800"}},
  {id: "tint-live", group: "tint", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "stretch"}},
  // ---- capInsets: a nine-patch of the picture ----
  {id: "caps-object", group: "caps", source: frame, style: size(60, 40), props: {resizeMode: "stretch", capInsets: everyCap(3)}},
  {id: "caps-number", group: "caps", source: frame, style: size(60, 40), props: {resizeMode: "stretch", capInsets: 4}},
  {id: "caps-asymmetric", group: "caps", source: frame, style: size(60, 40), props: {resizeMode: "stretch", capInsets: {top: 1, left: 2, bottom: 3, right: 4}}},
  {id: "caps-partial", group: "caps", source: frame, style: size(60, 40), props: {resizeMode: "stretch", capInsets: {top: 5}}},
  {id: "caps-repeat", group: "caps", source: frame, style: size(60, 40), props: {resizeMode: "repeat", capInsets: everyCap(3)}},
  {id: "caps-repeat-zero", group: "caps", source: frame, style: size(60, 40), props: {resizeMode: "repeat"}},
  {id: "caps-cover", group: "caps", source: frame, style: size(60, 40), props: {resizeMode: "cover", capInsets: everyCap(3)}},
  {id: "caps-zero", group: "caps", source: frame, style: size(60, 40), props: {resizeMode: "stretch", capInsets: everyCap(0)}},
  {id: "caps-oversize", group: "caps", source: frame, style: size(60, 40), props: {resizeMode: "stretch", capInsets: everyCap(12)}},
  {id: "caps-frame", group: "caps", source: frame, style: {...size(60, 40), borderWidth: 3, padding: 2, borderColor: "#444"}, props: {resizeMode: "stretch", capInsets: everyCap(3)}},
  {id: "caps-live", group: "caps", source: frame, style: size(60, 40), props: {resizeMode: "stretch"}},
  // ---- rounded clipping: the border box with the radii, and the content frame with the radii less the border ----
  {id: "mask-radius", group: "mask", source: frame, style: size(40, 40), props: {resizeMode: "stretch"}, rounded: {borderRadius: 10}},
  {id: "mask-border", group: "mask", source: frame, style: {...size(40, 40), borderWidth: 2, borderColor: "#fff"}, props: {resizeMode: "stretch"}, rounded: {borderRadius: 10}},
  {id: "mask-padding", group: "mask", source: frame, style: {...size(40, 40), borderWidth: 2, padding: 3, borderColor: "#fff"}, props: {resizeMode: "stretch"},
    rounded: {borderRadius: 12}},
  {id: "mask-ellipse", group: "mask", source: frame, style: size(60, 30), props: {resizeMode: "stretch"}, rounded: {borderRadius: "50%"}},
  {id: "mask-corners", group: "mask", source: frame,
    style: {...size(60, 40), borderLeftWidth: 4, borderTopWidth: 2, borderRightWidth: 1, borderBottomWidth: 3, borderColor: "#fff"}, props: {resizeMode: "stretch"},
    rounded: {borderTopLeftRadius: 20, borderTopRightRadius: 4, borderBottomRightRadius: 0, borderBottomLeftRadius: 12}},
  {id: "mask-pill", group: "mask", source: frame, style: {...size(40, 40), borderWidth: 2, borderColor: "#fff"}, props: {resizeMode: "stretch"}, rounded: {borderRadius: 999}},
  {id: "mask-overlap", group: "mask", source: frame, style: size(40, 40), props: {resizeMode: "stretch"}, rounded: {borderTopLeftRadius: 30, borderTopRightRadius: 30}},
  {id: "mask-visible", group: "mask", source: frame, style: {...size(40, 40), overflow: "visible"}, props: {resizeMode: "stretch"}, rounded: {borderRadius: 10}},
  {id: "mask-scroll", group: "mask", source: frame, style: {...size(40, 40), overflow: "scroll"}, props: {resizeMode: "stretch"}, rounded: {borderRadius: 10}},
  {id: "mask-square", group: "mask", source: frame, style: {...size(40, 40), borderWidth: 2, borderColor: "#fff"}, props: {resizeMode: "stretch"}},
  {id: "mask-cover", group: "mask", source: glyph("glyph@2x.png"), style: size(40, 40), props: {resizeMode: "cover"}, rounded: {borderRadius: 10}},
  {id: "mask-contain", group: "mask", source: glyph("glyph@2x.png"), style: size(40, 40), props: {resizeMode: "contain"}, rounded: {borderRadius: 10}},
  {id: "mask-center", group: "mask", source: glyph("glyph@2x.png"), style: size(40, 40), props: {resizeMode: "center"}, rounded: {borderRadius: 10}},
  {id: "mask-repeat", group: "mask", source: glyph("glyph@2x.png"), style: size(40, 40), props: {resizeMode: "repeat"}, rounded: {borderRadius: 10}},
  {id: "mask-3x", group: "mask", source: glyph("glyph@3x.png"), style: {...size(30, 30), borderWidth: 1, borderColor: "#fff"}, props: {resizeMode: "cover"}, rounded: {borderRadius: 8}},
  {id: "mask-live", group: "mask", source: frame, style: size(40, 40), props: {resizeMode: "stretch"}},
  {id: "all-together", group: "mask", source: frame, style: {...size(60, 40), borderWidth: 2, borderColor: "#fff"},
    props: {resizeMode: "stretch", tintColor: "#ffcc00", capInsets: everyCap(3)}, rounded: {borderRadius: 12}},
  // ---- the props iOS ignores ----
  {id: "ignored-control", group: "ignored", source: glyph("glyph@2x.png"), style: size(24, 18), props: {resizeMode: "stretch"}},
  {id: "ignored-all", group: "ignored", source: glyph("glyph@2x.png"), style: {...size(24, 18), overlayColor: "#ffffff"},
    props: {resizeMode: "stretch", defaultSource: {uri: dir + "glyph.png", width: 12, height: 9}, loadingIndicatorSource: {uri: dir + "glyph.png"}, fadeDuration: 100,
      progressiveRenderingEnabled: true, resizeMethod: "resize", resizeMultiplier: 2, overlayColor: "#ffffff"}},
];
for (const spec of specs) {
  // Written once, so that the style of the Image and the radii the oracle reads are the same object.
  if (spec.rounded) spec.style = {...spec.style, ...spec.rounded};
  delete spec.rounded;
}

// What the host refuses: the values that are mistakes. (The props that draw and those that iOS ignores are taken.) Each is rendered
// inside a boundary that records the error.
const refusals = [
  {id: "blurRadius-string", props: {blurRadius: "2"}},
  {id: "blurRadius-nan", props: {blurRadius: Number.NaN}},
  {id: "capInsets-list", props: {capInsets: [1, 2, 3, 4]}},
  {id: "capInsets-name", props: {capInsets: {middle: 1}}},
  {id: "capInsets-string", props: {capInsets: "2"}},
];

// The network half: one picture, shown by several Images that differ in what is done to it. Mounted one after the other by the probe.
const netSpecs = [
  {id: "blur-a", props: {blurRadius: 1}},
  {id: "plain-a", props: {}},
  {id: "blur-b", props: {blurRadius: 1}},
  {id: "tint", props: {tintColor: "#ff8800"}},
  {id: "mask", props: {}, style: {borderRadius: 6}},
  {id: "blur-wide", props: {blurRadius: 2}},
];

const logs = {}, cells = new Map(), refs = {}, mounts = {}, cleanups = {}, boundaries = {};
function track(key) {
  const log = (logs[key] ??= []);
  const keys = event => Object.keys(event.nativeEvent ?? {}).sort();
  return {
    onLoadStart: event => log.push({type: "loadStart", keys: keys(event)}),
    onProgress: event => log.push({type: "progress", keys: keys(event), ...event.nativeEvent}),
    onLoad: event => log.push({type: "load", keys: keys(event), uri: event.nativeEvent.source.uri, width: event.nativeEvent.source.width, height: event.nativeEvent.source.height}),
    onError: event => log.push({type: "error", keys: keys(event), ...event.nativeEvent}),
    onLoadEnd: event => log.push({type: "loadEnd", keys: keys(event)}),
  };
}

class Boundary extends React.Component {
  state = {failed: false};
  static getDerivedStateFromError() {
    return {failed: true};
  }
  componentDidCatch(error) {
    boundaries[this.props.id] = String(error?.message ?? error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// A patch changes what the Image was declared with: a key set to null leaves the style or the props.
function merged(base, patch) {
  const out = {...base};
  for (const [name, value] of Object.entries(patch ?? {})) {
    if (value === null) delete out[name];
    else out[name] = value;
  }
  return out;
}

function Cell({name, spec, baseUrl}) {
  const key = `${name}-${spec.id}`;
  const [patch, setPatch] = useState({});
  cells.set(key, {patch: setPatch});
  const state = {...spec, ...patch, style: merged(spec.style, patch.style), props: merged(spec.props, patch.props)};
  useEffect(() => {
    mounts[key] = (mounts[key] ?? 0) + 1;
    return () => {
      cleanups[key] = (cleanups[key] ?? 0) + 1;
      cells.delete(key);
    };
  }, [key]);
  if (state.show === false) return null;
  const source = spec.net ? {uri: `${baseUrl}/pic/max-age/quad24.png`, width: 24, height: 24} : spec.source;
  return <Boundary id={key}>
    <Image testID={key} ref={node => (refs[key] = node)} source={source} style={[{margin: 2}, state.style]} {...state.props} {...track(key)} />
  </Boundary>;
}

function ImagesVisual({name}) {
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => {
      cleanups[name] = (cleanups[name] ?? 0) + 1;
    };
  }, [name]);
  return <View testID={`${name}-root`} style={{flex: 1, flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", padding: 4, backgroundColor: "#0b1120"}}>
    {specs.map(spec => <Cell key={spec.id} name={name} spec={spec} />)}
    {refusals.map(entry => <Boundary key={entry.id} id={`${name}-refusal-${entry.id}`}><Image {...entry.props} /></Boundary>)}
  </View>;
}

// The network cases are not mounted until asked for (show), in the order of the probe's steps.
function ImagesVisualNetwork({name, baseUrl}) {
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => {
      cleanups[name] = (cleanups[name] ?? 0) + 1;
    };
  }, [name]);
  return <View testID={`${name}-root`} style={{flex: 1, flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", padding: 4, backgroundColor: "#111827"}}>
    {netSpecs.map(spec => <Cell key={spec.id} name={name} baseUrl={baseUrl}
      spec={{id: spec.id, group: "network", net: true, show: false, style: {...size(24, 24), ...spec.style}, props: {resizeMode: "stretch", ...spec.props}}} />)}
    <Text style={{color: "#fff"}}>network</Text>
  </View>;
}
AppRegistry.registerComponent("ImagesVisual", () => ImagesVisual);
AppRegistry.registerComponent("ImagesVisualNetwork", () => ImagesVisualNetwork);

function plain(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

globalThis.ImagesVisual = {
  declared: () => specs.map(({id, group, source, style, props}) => ({id, group, source: plain(source), style: plain(style), props: plain(props)})),
  declaredNetwork: () => netSpecs.map(({id, props, style}) => ({id, props: plain(props), style: plain(style ?? {})})),
  refusals: () => refusals.map(({id, props}) => ({id, props: JSON.stringify(props, (_, value) => (Number.isNaN(value) ? "NaN" : value))})),
  snapshot() {
    return {
      mounts: {...mounts}, cleanups: {...cleanups}, logs: plain(logs), boundaries: {...boundaries}, pixelRatio: PixelRatio.get(),
      tags: Object.fromEntries(Object.entries(refs).map(([key, node]) => [key, node ? findNodeHandle(node) : null])), cells: [...cells.keys()],
    };
  },
  clearLog(key) {
    // In place: the handlers of the Images on screen hold this array.
    (logs[key] ??= []).length = 0;
  },
  update(key, patch) {
    // The patches add up; a null stays in them, so that it still takes the declared value away.
    cells.get(key).patch(previous => ({...previous, ...patch, style: {...previous.style, ...patch.style}, props: {...previous.props, ...patch.props}}));
  },
};
