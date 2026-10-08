import React, {useEffect, useState} from "react";
import {AppRegistry, Image, PixelRatio, TurboModuleRegistry, View} from "react-native";

// Public imports only: RN's own Image.ios.js over the host's native image pipeline, with sources on the network. Every Image logs
// what JS observes (the payloads of its events, whole); the probe reads the native view of the same Image beside it. A source
// writes its host as $http, $https, $other (a second origin) or $refused (a port nobody listens on), which the probe fills in
// from the ports of the suite's server.
const box = size => ({width: size, height: size});
// The declared cases, mounted with the root. Dynamic ones come later, from the probe, through ImagesNetwork.mount().
const cases = [
  {id: "ok", group: "loads", source: {uri: "$http/pic/plain/quad24.png"}, style: box(24)},
  {id: "ok-wide", group: "loads", source: {uri: "$http/pic/plain/wide.png"}, style: box(60), resizeMode: "cover"},
  {id: "ok-jpg", group: "loads", source: {uri: "$http/pic/plain/format.jpg"}, style: box(24)},
  {id: "ok-svg", group: "loads", source: {uri: "$http/pic/plain/format.svg"}, style: box(24)},
  {id: "ok-https", group: "loads", source: {uri: "$https/pic/plain/quad24.png"}, style: box(24)},
  {id: "ok-chunked", group: "loads", source: {uri: "$http/chunked/quad24.png"}, style: box(24)},
  {id: "ok-redirect", group: "loads", source: {uri: "$http/redirect/302?to=/pic/plain/quad24.png"}, style: box(24)},
  {id: "ok-redirect-cross", group: "loads", source: {uri: "$http/redirect/307?to=$other/pic/plain/quad24.png", headers: {Authorization: "secret", "X-Keep": "kept"}}, style: box(24)},
  {id: "req-post", group: "request", source: {uri: "$http/pic/plain/quad24.png?post", method: "post", headers: {"X-Probe": "one", Accept: "image/png"}, body: "hello body"}, style: box(24)},
  {id: "req-get-body", group: "request", source: {uri: "$http/pic/plain/quad24.png?get-body", body: "a body on a GET"}, style: box(24)},
  {id: "req-props", group: "request", source: {uri: "$http/pic/plain/quad24.png?props"}, crossOrigin: "use-credentials", referrerPolicy: "origin", style: box(24)},
  {id: "err-404", group: "failures", source: {uri: "$http/status/404"}, style: box(24)},
  {id: "err-503-empty", group: "failures", source: {uri: "$http/status-empty/503"}, style: box(24)},
  {id: "err-empty200", group: "failures", source: {uri: "$http/empty200"}, style: box(24)},
  {id: "err-html", group: "failures", source: {uri: "$http/html"}, style: box(24)},
  {id: "err-corrupt", group: "failures", source: {uri: "$http/pic/plain/corrupt.png"}, style: box(24)},
  {id: "err-oversize", group: "failures", source: {uri: "$http/pic/plain/oversize.png"}, style: box(24)},
  {id: "err-reset", group: "failures", source: {uri: "$http/reset"}, style: box(24)},
  {id: "err-truncated", group: "failures", source: {uri: "$http/truncated"}, style: box(24)},
  {id: "err-refused", group: "failures", source: {uri: "$refused/pic/plain/quad24.png"}, style: box(24)},
  {id: "err-redirect-404", group: "failures", source: {uri: "$http/redirect/301?to=/status/404"}, style: box(24)},
  {id: "err-header-name", group: "failures", source: {uri: "$http/pic/plain/quad24.png?bad-header", headers: {"Bad Name": "x"}}, style: box(24)},
  {id: "err-method", group: "failures", source: {uri: "$http/pic/plain/quad24.png?brew", method: "brew"}, style: box(24)},
  {id: "err-only-if-cached", group: "failures", source: {uri: "$http/pic/plain/quad24.png?never-cached", cache: "only-if-cached"}, style: box(24)},
];

const logs = {}, cells = new Map(), results = {}, mounts = {}, boundaries = {};
let inputs = {};
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
// $http/... to the server's address.
const hosts = () => ({$http: inputs.http, $https: inputs.https, $other: inputs.other, $refused: inputs.refused});
const fill = text => text.replace(/\$(http|https|other|refused)\b/g, name => hosts()[name]);
function sourceOf(source) {
  return {...source, uri: fill(source.uri)};
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

function Cell({id, spec}) {
  useEffect(() => {
    mounts[id] = (mounts[id] ?? 0) + 1;
  }, [id]);
  const {source, style, resizeMode, crossOrigin, referrerPolicy} = spec;
  return <Boundary id={id}>
    <Image testID={id} source={sourceOf(source)} style={style ?? box(24)} resizeMode={resizeMode} crossOrigin={crossOrigin} referrerPolicy={referrerPolicy} {...track(id)} />
  </Boundary>;
}

function ImagesNetwork({http, https, other, refused}) {
  inputs = {http, https, other, refused};
  const [specs, setSpecs] = useState(() => Object.fromEntries(cases.map(entry => [entry.id, entry])));
  useEffect(() => {
    cells.set("root", {
      mount: (id, spec) => setSpecs(previous => ({...previous, [id]: spec})),
      unmount: id => setSpecs(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id))),
      update: (id, patch) => setSpecs(previous => (previous[id] ? {...previous, [id]: {...previous[id], ...patch}} : previous)),
    });
    return () => cells.delete("root");
  }, []);
  return <View testID="network-root" style={{flex: 1, flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", gap: 4, padding: 4, backgroundColor: "#0b1120"}}>
    {Object.entries(specs).map(([id, spec]) => <Cell key={id} id={id} spec={spec} />)}
  </View>;
}
AppRegistry.registerComponent("ImagesNetwork", () => ImagesNetwork);

const plain = value => JSON.parse(JSON.stringify(value ?? null));
async function settle(key, run) {
  try {
    results[key] = {ok: true, value: plain(await run())};
  } catch (error) {
    results[key] = {ok: false, message: String(error?.message ?? error), code: error?.code ?? null};
  }
}
// The certification module of the loader (the "images-fixture" scenario). A host without a method of it answers with why.
function fixture(method, value) {
  try {
    TurboModuleRegistry.getEnforcing("GodotImageFixture")[method](value);
    return "ok";
  } catch (error) {
    return String(error?.message ?? error);
  }
}

globalThis.ImagesNetwork = {
  declared: () => cases.map(({id, group, source, style, resizeMode, crossOrigin, referrerPolicy}) =>
    ({id, group, source, style: style ?? null, resizeMode: resizeMode ?? null, crossOrigin: crossOrigin ?? null, referrerPolicy: referrerPolicy ?? null})),
  snapshot: () => ({mounts: {...mounts}, logs: plain(logs), boundaries: {...boundaries}, results: plain(results), pixelRatio: PixelRatio.get(), cells: Object.keys(logs)}),
  mount: (id, spec) => cells.get("root").mount(id, spec),
  unmount: id => cells.get("root").unmount(id),
  update: (id, patch) => cells.get("root").update(id, patch),
  // In place: the handlers of the Images on screen hold these arrays.
  clearLog(id) {
    (logs[id] ??= []).length = 0;
  },
  forget(id) {
    delete logs[id];
  },
  hold: value => fixture("hold", value),
  limit: value => fixture("limit", value),
  budget: value => fixture("budget", value),
  responseLimit: value => fixture("responseLimit", value),
  getSize: (key, uri) => settle(key, () => Image.getSize(fill(uri))),
  getSizeCallback: (key, uri) => settle(key, () => new Promise((resolve, reject) => Image.getSize(fill(uri), (width, height) => resolve({width, height}), reject))),
  getSizeWithHeaders: (key, uri, headers) => settle(key, () => Image.getSizeWithHeaders(fill(uri), headers)),
  prefetch: (key, uri) => settle(key, () => Image.prefetch(fill(uri))),
  prefetchWithMetadata: (key, uri) => settle(key, () => Image.prefetchWithMetadata(fill(uri), "Probe", 1)),
  queryCache: (key, uris) => settle(key, () => Image.queryCache(uris.map(fill))),
  fill,
};
