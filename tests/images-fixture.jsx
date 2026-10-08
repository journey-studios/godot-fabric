import React, {useEffect, useState} from "react";
import {Animated, AppRegistry, AssetRegistry, Image, ImageBackground, PixelRatio, Text, TurboModuleRegistry, View, findNodeHandle} from "react-native";

// Public imports only: RN's own Image.ios.js, ImageBackground, AnimatedImage and AssetRegistry over the host's native
// image pipeline. Every Image logs what JS observes; the probe reads the native view of the same Image beside it.
const assets = {
  badge: require("./fixtures/images/assets/badge.png"),
  wide: require("./fixtures/images/assets/wide.png"),
  tile: require("./fixtures/images/assets/tile.png"),
};
const formats = "res://tests/fixtures/images/formats/";
const broken = "res://tests/fixtures/images/broken/";
// A 8x8 checker PNG and a 24x24 SVG as data URIs (tests/fixtures/images/assets/tile.png in base64; the SVG percent-encoded).
const tileBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIUlEQVR42mP4dUnkPwjLyWmAMTqfgaACXBIwPmEFg8ANACZCiEFN7ZbwAAAAAElFTkSuQmCC";
const garbageBase64 = "dGhpcyBpcyBub3QgYSBwaWN0dXJlIGF0IGFsbA==";
const svgUri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#3c6ee6"/></svg>');

// The declared inputs. A source is an asset (require()), a {uri} object or a list of them; "$user" and "$file" take the
// paths the probe prepared ("$missing" and "$corrupt" are file:// URIs). Sizes are in points.
const box = size => ({width: size, height: size});
const specs = [
  {id: "badge", group: "bundled", source: {asset: "badge"}},
  {id: "badge-big", group: "bundled", source: {asset: "badge"}, style: box(64), resizeMode: "stretch"},
  {id: "mode-cover", group: "modes", source: {asset: "wide"}, style: box(60), resizeMode: "cover"},
  {id: "mode-contain", group: "modes", source: {asset: "wide"}, style: box(60), resizeMode: "contain"},
  {id: "mode-stretch", group: "modes", source: {asset: "wide"}, style: box(60), resizeMode: "stretch"},
  {id: "mode-center", group: "modes", source: {asset: "wide"}, style: box(60), resizeMode: "center"},
  {id: "mode-repeat", group: "modes", source: {asset: "wide"}, style: box(60), resizeMode: "repeat"},
  {id: "mode-none", group: "modes", source: {asset: "wide"}, style: box(60), resizeMode: "none"},
  {id: "mode-small-center", group: "modes", source: {asset: "tile"}, style: box(30), resizeMode: "center"},
  {id: "mode-small-repeat", group: "modes", source: {asset: "tile"}, style: {width: 30, height: 30}, resizeMode: "repeat"},
  {id: "mode-fit", group: "modes", source: {asset: "wide"}, style: {width: 60, height: 60, objectFit: "contain"}},
  {id: "mode-inset", group: "modes", source: {asset: "wide"}, style: {width: 80, height: 40, borderWidth: 3, padding: 2, borderColor: "#fff"}, resizeMode: "stretch"},
  {id: "res-png", group: "sources", source: {uri: formats + "format.png", width: 24, height: 24}},
  {id: "res-jpg", group: "sources", source: {uri: formats + "format.jpg", width: 24, height: 24}},
  {id: "res-webp", group: "sources", source: {uri: formats + "format.webp", width: 24, height: 24}},
  {id: "res-bmp", group: "sources", source: {uri: formats + "format.bmp", width: 24, height: 24}},
  {id: "res-tga", group: "sources", source: {uri: formats + "format.tga", width: 24, height: 24}},
  {id: "res-svg", group: "sources", source: {uri: formats + "format.svg", width: 24, height: 24}},
  {id: "user-png", group: "sources", source: {uri: "$user", width: 40, height: 20}},
  {id: "file-png", group: "sources", source: {uri: "$file", width: 40, height: 20}},
  {id: "file-shrink", group: "sources", source: {uri: "$file"}, style: box(5)},
  {id: "data-png", group: "sources", source: {uri: "data:image/png;base64," + tileBase64, width: 8, height: 8}},
  {id: "data-svg", group: "sources", source: {uri: svgUri, width: 24, height: 24}},
  {id: "multi", group: "sources", source: {list: [{uri: formats + "format.png", width: 16, height: 16, scale: 1}, {uri: formats + "format.bmp", width: 32, height: 32, scale: 2}]}, style: box(20)},
  {id: "neg-missing", group: "failures", source: {uri: formats + "does-not-exist.png", width: 24, height: 24}},
  {id: "neg-corrupt", group: "failures", source: {uri: broken + "corrupt.png", width: 16, height: 16}},
  {id: "neg-truncated", group: "failures", source: {uri: broken + "truncated.png", width: 40, height: 20}},
  {id: "neg-gif", group: "failures", source: {uri: formats + "format.gif", width: 1, height: 1}},
  {id: "neg-notimage", group: "failures", source: {uri: broken + "notimage.png", width: 8, height: 8}},
  {id: "neg-empty", group: "failures", source: {uri: broken + "empty.png", width: 8, height: 8}},
  {id: "neg-oversize-png", group: "failures", source: {uri: broken + "oversize.png", width: 8, height: 8}},
  {id: "neg-oversize-jpg", group: "failures", source: {uri: broken + "oversize.jpg", width: 8, height: 8}},
  {id: "neg-scheme", group: "failures", source: {uri: "ftp://example.invalid/picture.png", width: 8, height: 8}},
  {id: "neg-data", group: "failures", source: {uri: "data:image/png;base64,@@@@", width: 8, height: 8}},
  {id: "neg-data-garbage", group: "failures", source: {uri: "data:image/png;base64," + garbageBase64, width: 8, height: 8}},
  {id: "neg-file", group: "failures", source: {uri: "$missing", width: 8, height: 8}},
  {id: "neg-file-corrupt", group: "failures", source: {uri: "$corrupt", width: 8, height: 8}},
  {id: "swap", group: "dynamic", source: {uri: formats + "format.png", width: 24, height: 24}},
  {id: "removable", group: "dynamic", source: {asset: "badge"}},
  {id: "mode-changing", group: "dynamic", source: {asset: "wide"}, style: box(60), resizeMode: "cover"},
];

// Image props the host refuses where the Image renders: what is a mistake. (What it draws and what it ignores, as iOS does, is taken:
// tests/images-visual-fixture.jsx. The request keys of a source, headers, method, body and cache, and crossOrigin and referrerPolicy,
// are the network's: tests/images-network-fixture.jsx.)
const refusals = [
  {id: "resizeMode", props: {resizeMode: "fill"}},
  {id: "style.resizeMode", props: {style: {resizeMode: "fill"}}},
  {id: "style.objectFit", props: {style: {objectFit: "fill-ish"}}},
  {id: "style.aspectRatio", props: {style: {aspectRatio: 1}}},
  {id: "source.uri", props: {source: {uri: 5}}},
  {id: "source.unregistered", props: {source: 987654}},
  {id: "onLoad", props: {onLoad: "not a function"}},
  {id: "children", props: {children: React.createElement(View)}},
  {id: "inline", inText: true, props: {source: {uri: formats + "format.png", width: 4, height: 4}}},
];

const logs = {}, cells = new Map(), refs = {}, mounts = {}, cleanups = {}, boundaries = {}, results = {};
function track(key) {
  const log = (logs[key] ??= []);
  const keys = event => Object.keys(event.nativeEvent ?? {}).sort();
  return {
    onLoadStart: event => log.push({type: "loadStart", keys: keys(event)}),
    onProgress: event => log.push({type: "progress", keys: keys(event), ...event.nativeEvent}),
    onLoad: event => log.push({type: "load", keys: keys(event), uri: event.nativeEvent.source.uri, width: event.nativeEvent.source.width,
      height: event.nativeEvent.source.height, sourceKeys: Object.keys(event.nativeEvent.source).sort()}),
    onError: event => log.push({type: "error", keys: keys(event), ...event.nativeEvent}),
    onLoadEnd: event => log.push({type: "loadEnd", keys: keys(event)}),
  };
}
function sourceOf(descriptor, inputs) {
  if (descriptor.asset) return assets[descriptor.asset];
  if (descriptor.list) return descriptor.list.map(entry => sourceOf(entry, inputs));
  const {uri, ...rest} = descriptor;
  const named = {$user: inputs.userUri, $file: inputs.fileUri, $missing: inputs.missingUri, $corrupt: inputs.corruptUri};
  return {...rest, uri: Object.hasOwn(named, uri) ? named[uri] : uri};
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

function Cell({name, spec, inputs}) {
  const key = `${name}-${spec.id}`;
  const [patch, setPatch] = useState({});
  cells.set(key, {patch: setPatch});
  const state = {...spec, ...patch};
  useEffect(() => {
    mounts[key] = (mounts[key] ?? 0) + 1;
    return () => {
      cleanups[key] = (cleanups[key] ?? 0) + 1;
      cells.delete(key);
    };
  }, [key]);
  if (state.show === false) return null;
  return <Boundary id={key}>
    <Image testID={key} ref={node => (refs[key] = node)} source={sourceOf(state.source, inputs)} style={state.style} resizeMode={state.resizeMode} {...track(key)} />
  </Boundary>;
}

function Refusals({name}) {
  return <View testID={`${name}-refusals`} style={{width: 4, height: 4}}>
    {refusals.map(entry => <Boundary key={entry.id} id={`${name}-refusal-${entry.id}`}>
      {entry.inText ? <Text><Image {...entry.props} /></Text> : <Image {...entry.props} />}
    </Boundary>)}
  </View>;
}

const held = [
  {asset: "badge"}, {asset: "wide"}, {asset: "tile"}, {uri: formats + "format.png"}, {uri: formats + "format.bmp"}, {uri: formats + "format.tga"},
];

// One Image that resolves its asset again when asked: the pixel ratio is read when RN's Image renders.
function Scaled({name}) {
  const [key, setKey] = useState(0);
  useEffect(() => {
    globalThis.ImagesProbe.rerender = () => setKey(value => value + 1);
  }, []);
  return <Image key={key} testID={`${name}-scales`} ref={node => (refs[`${name}-scales`] = node)} source={assets.badge} {...track(`${name}-scales-${key}`)} />;
}

function ImagesProbe({name, userUri, fileUri, missingUri, corruptUri}) {
  const inputs = {userUri, fileUri, missingUri, corruptUri};
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => {
      cleanups[name] = (cleanups[name] ?? 0) + 1;
    };
  }, [name]);
  const opacity = React.useRef(new Animated.Value(1)).current;
  useEffect(() => {
    globalThis.ImagesProbe.opacity = value => opacity.setValue(value);
  }, [opacity]);
  return <View testID={`${name}-root`} style={{flex: 1, flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", gap: 4, padding: 4, backgroundColor: "#0b1120"}}>
    {specs.map(spec => <Cell key={spec.id} name={name} spec={spec} inputs={inputs} />)}
    <Boundary id={`${name}-scaled`}><Scaled name={name} /></Boundary>
    <Boundary id={`${name}-background-boundary`}>
      <ImageBackground testID={`${name}-background`} source={assets.wide} resizeMode="cover" style={{width: 60, height: 40}} imageStyle={{opacity: 0.9}}
        imageRef={node => (refs[`${name}-background-image`] = node)} {...track(`${name}-background`)}>
        <Text testID={`${name}-background-text`} style={{color: "#fff", fontSize: 10}}>over</Text>
      </ImageBackground>
    </Boundary>
    <Boundary id={`${name}-animated-boundary`}>
      <Animated.Image testID={`${name}-animated`} source={assets.badge} style={{opacity}} {...track(`${name}-animated`)} />
    </Boundary>
    <Refusals name={name} />
  </View>;
}

function ImagesHeld({name, userUri}) {
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => {
      cleanups[name] = (cleanups[name] ?? 0) + 1;
    };
  }, [name]);
  return <View testID={`${name}-root`} style={{flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 4, padding: 4, backgroundColor: "#111827"}}>
    {held.map((source, index) => <Image key={index} testID={`${name}-held-${index}`} source={sourceOf(source, {userUri})} style={box(20)} {...track(`${name}-held-${index}`)} />)}
  </View>;
}
AppRegistry.registerComponent("ImagesProbe", () => ImagesProbe);
AppRegistry.registerComponent("ImagesHeld", () => ImagesHeld);

function plain(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}
async function settle(key, run) {
  try {
    results[key] = {ok: true, value: plain(await run())};
  } catch (error) {
    results[key] = {ok: false, message: String(error?.message ?? error), code: error?.code ?? null};
  }
}

globalThis.ImagesProbe = {
  declared: () => specs.map(({id, group, source, style, resizeMode}) => ({id, group, source, style: style ?? null, resizeMode: resizeMode ?? null})),
  refusals: () => refusals.map(({id}) => id),
  snapshot() {
    return {
      mounts: {...mounts}, cleanups: {...cleanups}, logs: plain(logs), boundaries: {...boundaries}, results: plain(results),
      pixelRatio: PixelRatio.get(), window: plain({scale: PixelRatio.get()}),
      tags: Object.fromEntries(Object.entries(refs).map(([key, node]) => [key, node ? findNodeHandle(node) : null])),
      cells: [...cells.keys()],
      assets: Object.fromEntries(Object.entries(assets).map(([key, id]) => [key, plain({id, descriptor: AssetRegistry.getAssetByID(id), source: Image.resolveAssetSource(id)})])),
    };
  },
  clearLog(key) {
    // In place: the handlers of the Images on screen hold this array.
    (logs[key] ??= []).length = 0;
  },
  update(key, patch) {
    cells.get(key).patch(previous => ({...previous, ...patch}));
  },
  hold(value) {
    TurboModuleRegistry.getEnforcing("GodotImageFixture").hold(value);
  },
  limit(value) {
    TurboModuleRegistry.getEnforcing("GodotImageFixture").limit(value);
  },
  budget(value) {
    TurboModuleRegistry.getEnforcing("GodotImageFixture").budget(value);
  },
  api() {
    const file = "res://tests/fixtures/images/formats/format.png";
    const callbacks = [];
    settle("getSize", () => Image.getSize(file));
    settle("getSize-callback", () => new Promise((resolve, reject) => Image.getSize(file, (width, height) => resolve({width, height}), reject)));
    settle("getSize-svg", () => Image.getSize(formats + "format.svg"));
    settle("getSize-data", () => Image.getSize("data:image/png;base64," + tileBase64));
    settle("getSize-jpeg", () => Image.getSize(formats + "format.jpg"));
    settle("getSize-webp", () => Image.getSize(formats + "format.webp"));
    settle("getSize-missing", () => Image.getSize(formats + "does-not-exist.png"));
    settle("getSize-corrupt", () => Image.getSize(broken + "corrupt.png"));
    settle("getSize-oversize", () => Image.getSize(broken + "oversize.png"));
    settle("getSizeWithHeaders", () => Image.getSizeWithHeaders(file, {Accept: "image/png"}));
    settle("prefetch", () => Image.prefetch(file));
    settle("prefetchWithMetadata", () => Image.prefetchWithMetadata(file, "Probe", 1));
    settle("prefetch-missing", () => Image.prefetch(formats + "does-not-exist.png"));
    settle("queryCache", () => Image.queryCache([file, "https://example.invalid/picture.png"]));
    settle("getSize-failure-callback", () => new Promise(resolve => Image.getSize(formats + "does-not-exist.png", () => resolve("unexpected"), error => resolve(String(error?.message ?? error)))));
    return callbacks.length;
  },
  resolve() {
    const descriptor = AssetRegistry.getAssetByID(assets.badge);
    results.resolve = {ok: true, value: plain({
      pixelRatio: PixelRatio.get(), pickScale: Image.resolveAssetSource.pickScale(descriptor.scales, PixelRatio.get()),
      descriptor, source: Image.resolveAssetSource(assets.badge), object: Image.resolveAssetSource({uri: "res://x.png", width: 3, height: 4}),
      missing: Image.resolveAssetSource(987654), nullish: Image.resolveAssetSource(null),
    })};
  },
};
