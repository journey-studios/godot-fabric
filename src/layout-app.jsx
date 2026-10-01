import React, { useState, useLayoutEffect, useRef, useEffect } from "react";
import { View, Text, Button } from "./components";
import {
  useWindowDimensions,
  windowSubscriptionCount,
} from "./window-dimensions";

const observations = { mounts: 0, cleanups: 0, layouts: [], errorsCaught: 0 };
let controls = {};
const longText = "Texto sem dimensões fixas: ação, ç, ffi e العربية.";
const paragraph =
  "O texto é medido pelo TextServer do Godot antes da montagem. Quando a janela muda, o Fabric recalcula as constraints e o Yoga quebra as linhas. A altura se adapta ao conteúdo, sem recriar o Label e sem perder o estado do React. ".repeat(
    2,
  );

export function LayoutApp() {
  const dimensions = useWindowDimensions();
  const [text, setText] = useState("Olá, Fabric!");
  const [fontSize, setFontSize] = useState(20);
  const [count, setCount] = useState(0);
  const [paragraphWidth, setParagraphWidth] = useState("100%");
  const probe = useRef(null);
  controls = {
    text() {
      setText(longText);
    },
    short() {
      setText("Olá, Fabric!");
    },
    font() {
      setFontSize((size) => (size === 20 ? 32 : 20));
    },
    count() {
      setCount((value) => value + 1);
    },
    narrow() {
      setParagraphWidth(280);
    },
    fluid() {
      setParagraphWidth("100%");
    },
  };
  useEffect(() => {
    observations.mounts++;
    return () => {
      observations.cleanups++;
    };
  }, []);
  useLayoutEffect(() => {
    probe.current.measure((x, y, width, height) =>
      observations.layouts.push({
        width,
        height,
        native: probe.current.getNativeMetrics(),
        window: dimensions,
      }),
    );
  }, [text, fontSize, dimensions]);
  return (
    <View
      testID="layout-root"
      style={{ width: "100%", height: "100%", padding: 24, gap: 16 }}
    >
      <Text fontSize={28}>Fabric: texto e janela responsivos</Text>
      <Text testID="dimensions">{`Viewport: ${dimensions.width} × ${dimensions.height} · Estado: ${count}`}</Text>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Button
          testID="text-change"
          text="Mudar conteúdo"
          onActivate={controls.text}
          style={{ flex: 1, height: 44 }}
        />
        <Button
          testID="font-change"
          text="Mudar fonte"
          onActivate={controls.font}
          style={{ flex: 1, height: 44 }}
        />
        <Button
          testID="layout-count"
          text="Estado +1"
          onActivate={controls.count}
          style={{ flex: 1, height: 44 }}
        />
      </View>
      <Text
        testID="intrinsic"
        ref={probe}
        fontSize={fontSize}
        style={{ alignSelf: "flex-start" }}
      >
        {text}
      </Text>
      <Text testID="paragraph" style={{ width: paragraphWidth, padding: 10 }}>
        {paragraph}
      </Text>
      <Text testID="after-paragraph">
        Este Label acompanha a altura do parágrafo acima.
      </Text>
      <Text testID="clipped" fontSize={28} style={{ height: 12 }}>
        Altura explícita continua pertencendo ao Yoga.
      </Text>
      <Text testID="newline">
        {"Duas linhas explícitas\nsem height manual."}
      </Text>
      <Text testID="empty">{""}</Text>
      <Text testID="numeric">{42}</Text>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Button
          testID="paragraph-narrow"
          text="Parágrafo: 280 px"
          onActivate={controls.narrow}
          style={{ flex: 1, height: 44 }}
        />
        <Button
          testID="paragraph-fluid"
          text="Parágrafo: fluido"
          onActivate={controls.fluid}
          style={{ flex: 1, height: 44 }}
        />
      </View>
    </View>
  );
}
export function runLayout(name) {
  controls[name]();
}
export function layoutStats() {
  return { ...observations, windowSubscribers: windowSubscriptionCount() };
}
