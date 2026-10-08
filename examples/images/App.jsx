import React, { useState } from "react";
import { AppRegistry, Image, ImageBackground, PixelRatio, Pressable, StyleSheet, Text, View } from "react-native";

// RN's original Image.ios.js, ImageBackground and asset registry through the public react-native import. Pictures are read and
// decoded on worker threads: the six resize modes of one bundled landscape, a logo with @1x, @2x and @3x files (RN's pickScale
// chooses by the pixel ratio), a PNG and an SVG as data: URIs, an ImageBackground under its children and a picture that does
// not exist, which fails through onError.
const logo = require("./assets/logo.png");
const landscape = require("./assets/landscape.png");
const sprite = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAArUlEQVR42u2XvRGAIAxGrdzA1t4ZHMwlXcBVbLRFj/z6ATkP7tIJ7xE1hGHowziObby4aAYuJpIueu6TKmAiVjAl0gT+SQIFd0mg4WaJEvBUwrX7eVkfQQGk58QsULtHCbBZ4N49WiArEVqgyt/QBbpATkD66qXIzWeLESXgkaDmipUQIcHBVeeBdkELXHUYabLgrYSQnuANoKJoV1QFHqIpDdGWh7iYhLma/XbcImEsh21OnggAAAAASUVORK5CYII=";
const badge = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
  '<stop offset="0" stop-color="#f97316"/><stop offset="1" stop-color="#db2777"/></linearGradient></defs>' +
  '<circle cx="32" cy="32" r="30" fill="url(#g)"/><path d="M20 34l8 8 16-18" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>');
const modes = ["cover", "contain", "stretch", "center", "repeat", "none"];
const observations = { events: {}, mode: "cover", picture: "landscape", renders: 0 };
globalThis.ImagesExample = {
  state: () => ({ ...observations, events: { ...observations.events }, pixelRatio: PixelRatio.get(), logo: Image.resolveAssetSource(logo) }),
};

// What the Image told JS, shown under it and counted for the validation: the same events RN's onLoadStart, onLoad and onError give.
function useLoading(id) {
  const [status, setStatus] = useState("loading");
  const count = (name) => { observations.events[id] = [...(observations.events[id] ?? []), name]; };
  return [status, {
    onLoadStart: () => { count("loadStart"); setStatus("loading"); },
    onLoad: (event) => {
      count("load");
      const { width, height } = event.nativeEvent.source;
      setStatus(`loaded ${width}x${height} px`);
    },
    onError: (event) => { count("error"); setStatus(event.nativeEvent.error); },
    onLoadEnd: () => count("loadEnd"),
  }];
}

function Tile({ id, title, caption, status, children, width = 118 }) {
  return (
    <View style={[styles.tile, { width }]}>
      <View style={styles.stage}>{children}</View>
      <Text style={styles.tileTitle}>{title}</Text>
      <Text style={styles.tileCaption}>{caption}</Text>
      <Text testID={`${id}-status`} style={styles.tileStatus} numberOfLines={2}>{status}</Text>
    </View>
  );
}

function ModeTile({ mode }) {
  const [status, handlers] = useLoading(`mode-${mode}`);
  return (
    <Tile id={`mode-${mode}`} title={mode} caption="120x60 in 84x84" status={status}>
      <Image testID={`images-mode-${mode}`} source={landscape} resizeMode={mode} style={styles.modeImage} {...handlers} />
    </Tile>
  );
}

function ImagesExample() {
  const [mode, setMode] = useState("cover");
  const [picture, setPicture] = useState("landscape");
  const [logoStatus, logoHandlers] = useLoading("logo");
  const [spriteStatus, spriteHandlers] = useLoading("data-png");
  const [badgeStatus, badgeHandlers] = useLoading("data-svg");
  const [backgroundStatus, backgroundHandlers] = useLoading("background");
  const [missingStatus, missingHandlers] = useLoading("missing");
  const [previewStatus, previewHandlers] = useLoading("preview");
  observations.renders += 1;
  observations.mode = mode;
  observations.picture = picture;

  return (
    <View testID="images-root" style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>GODOT FABRIC / IMAGE</Text>
        <Text style={styles.title}>Pictures that never block a frame.</Text>
        <Text style={styles.description}>
          RN's own Image over a native pipeline: files are read and decoded on worker threads, and the six resize modes draw what UIKit draws.
        </Text>
        <View style={styles.grid}>{modes.map((name) => <ModeTile key={name} mode={name} />)}</View>
        <View style={styles.grid}>
          <Tile id="logo" title="Bundled asset" caption={`require() at pixel ratio ${PixelRatio.get()}`} status={logoStatus}>
            <Image testID="images-logo" source={logo} {...logoHandlers} />
          </Tile>
          <Tile id="data-png" title="data: PNG" caption="32x32 sprite, center" status={spriteStatus}>
            <Image testID="images-data-png" source={{ uri: sprite, width: 16, height: 16 }} resizeMode="center" style={styles.dataImage} {...spriteHandlers} />
          </Tile>
          <Tile id="data-svg" title="data: SVG" caption="rasterized at the content scale" status={badgeStatus}>
            <Image testID="images-data-svg" source={{ uri: badge, width: 64, height: 64 }} style={styles.dataImage} {...badgeHandlers} />
          </Tile>
          <Tile id="background" title="Background" caption="ImageBackground, children over it" status={backgroundStatus}>
            <ImageBackground testID="images-background" source={landscape} resizeMode="cover" style={styles.background} {...backgroundHandlers}>
              <Text testID="images-background-text" style={styles.overlay}>over</Text>
            </ImageBackground>
          </Tile>
          <Tile id="missing" title="Missing file" caption="onError, then onLoadEnd" status={missingStatus}>
            <Image testID="images-missing" source={{ uri: "res://examples/images/assets/missing.png", width: 84, height: 84 }} style={styles.missing} {...missingHandlers} />
          </Tile>
        </View>
        <View style={styles.footer}>
          <View style={styles.previewStage}>
            <Image testID="images-preview" source={picture === "landscape" ? landscape : logo} resizeMode={mode} style={styles.preview} {...previewHandlers} />
          </View>
          <View style={styles.controls}>
            <Pressable testID="images-next-mode" onPress={() => setMode(modes[(modes.indexOf(mode) + 1) % modes.length])}
              style={({ pressed }) => [styles.button, { opacity: pressed ? 0.72 : 1 }]}>
              <Text style={styles.buttonText}>Next mode</Text>
            </Pressable>
            <Pressable testID="images-swap" onPress={() => setPicture(picture === "landscape" ? "logo" : "landscape")}
              style={({ pressed }) => [styles.button, { opacity: pressed ? 0.72 : 1 }]}>
              <Text style={styles.buttonText}>Swap the picture</Text>
            </Pressable>
          </View>
          <View style={styles.readout}>
            <Text testID="images-preview-mode" style={styles.status}>{`resizeMode="${mode}"`}</Text>
            <Text testID="images-preview-picture" style={styles.status}>{`picture: ${picture}`}</Text>
            <Text testID="images-preview-status" style={styles.status}>{previewStatus}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
AppRegistry.registerComponent("ImagesExample", () => ImagesExample);

const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#0b1120" },
  card: { width: "100%", padding: 16, gap: 10, backgroundColor: "#172033", borderWidth: 1, borderColor: "#334155", borderRadius: 18 },
  eyebrow: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 11, fontWeight: "700" },
  title: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 22, fontWeight: "700", lineHeight: 28 },
  description: { color: "#cbd5e1", fontFamily: "NotoSans", fontSize: 12, lineHeight: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { padding: 8, gap: 1, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 12 },
  stage: { height: 90, alignItems: "center", justifyContent: "center", backgroundColor: "#111c33", borderRadius: 8, marginBottom: 6 },
  tileTitle: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 13, fontWeight: "700", lineHeight: 18 },
  tileCaption: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 10, lineHeight: 14 },
  tileStatus: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 10, lineHeight: 14, height: 28 },
  modeImage: { width: 84, height: 84, backgroundColor: "#1e293b" },
  dataImage: { width: 72, height: 72, backgroundColor: "#1e293b" },
  background: { width: 96, height: 60, justifyContent: "flex-end", alignItems: "flex-start", backgroundColor: "#1e293b" },
  overlay: { margin: 4, paddingHorizontal: 6, color: "#ffffff", fontFamily: "NotoSans", fontSize: 12, lineHeight: 16, backgroundColor: "#00000099" },
  missing: { width: 84, height: 84, backgroundColor: "#450a0a", borderWidth: 1, borderColor: "#ef4444" },
  footer: { flexDirection: "row", alignItems: "center", gap: 14 },
  previewStage: { padding: 6, backgroundColor: "#111c33", borderRadius: 10 },
  preview: { width: 150, height: 90, backgroundColor: "#1e293b" },
  controls: { gap: 8 },
  button: { paddingVertical: 9, paddingHorizontal: 16, alignItems: "center", backgroundColor: "#2563eb", borderRadius: 10 },
  buttonText: { color: "#ffffff", fontFamily: "NotoSans", fontSize: 13, fontWeight: "700", lineHeight: 18 },
  readout: { gap: 2 },
  status: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 12, lineHeight: 18 },
});
