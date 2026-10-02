import React, { useState, useEffect } from "react";
import { LineChart } from "react-native-chart-kit/v2";
import { View, Text, Button } from "../../src/components";
import {
  useWindowDimensions,
  windowSubscriptionCount,
} from "../../src/window-dimensions";
import { svgPayload } from "../../src/svg-contract.mjs";

const thresholdSeries = [
  {
    yKey: "cargo",
    threshold: { y: 70, aboveColor: "#fb923c", belowColor: "#38bdf8" },
  },
];
const baseline = [18, 35, 24, 68, 54, 92, 77, 120];
const metrics = {
  mounts: 0,
  cleanups: 0,
  renders: 0,
  selections: [],
  layout: null,
  raf: [],
  cancelledRan: false,
  stoppedCallbackRan: false,
  negatives: [],
};
let commands = {};
const observeLayout = (layout) => {
  metrics.layout = layout;
};

export function ChartApp() {
  const window = useWindowDimensions();
  const chartWidth = Math.max(1, Math.min(2048, window.width - 48));
  const [version, setVersion] = useState(0);
  const [empty, setEmpty] = useState(false);
  const [curve, setCurve] = useState("linear");
  const [selection, setSelection] = useState(null);
  const [visible, setVisible] = useState(true);
  const [threshold, setThreshold] = useState(false);
  const [rotation, setRotation] = useState(0);
  metrics.renders++;
  commands = {
    data: () => setVersion((n) => n + 1),
    curve: () => setCurve((old) => (old === "linear" ? "monotone" : "linear")),
    empty: () => setEmpty((old) => !old),
    visible: () => setVisible((old) => !old),
    threshold: () => setThreshold((old) => !old),
    unsupported: () => setRotation(-35),
    pending: () =>
      requestAnimationFrame(() => {
        metrics.stoppedCallbackRan = true;
      }),
    negative() {
      for (const [tag, props] of [
        ["image", {}],
        ["path", { d: "M0 0", transform: "rotate(30)" }],
        ["rect", { width: NaN }],
        ["svg", { width: 4096, height: 50 }],
        ["text", { children: {}, x: 0 }],
      ]) {
        try {
          svgPayload(tag, props);
          metrics.negatives.push("accepted");
        } catch (error) {
          metrics.negatives.push(error.message);
        }
      }
    },
    raf() {
      const cancelled = requestAnimationFrame(() => {
        metrics.cancelledRan = true;
      });
      cancelAnimationFrame(cancelled);
      requestAnimationFrame((first) => {
        metrics.raf.push(first);
        requestAnimationFrame((second) => metrics.raf.push(second));
      });
    },
  };
  useEffect(() => {
    metrics.mounts++;
    return () => {
      metrics.cleanups++;
    };
  }, []);
  const data = empty
    ? []
    : baseline.map((value, index) => ({
        day: `D${index + 1}`,
        cargo: value + version * (index % 3 === 0 ? 32 : -4),
      }));
  return (
    <View
      testID="chart-root"
      style={{ width: "100%", height: "100%", padding: 24, gap: 12 }}
    >
      <Text testID="chart-title" fontSize={28}>
        Chart Kit · Fabric · Godot
      </Text>
      <Text style={{ height: 28 }}>
        Pacote original 7.0.4 · Hermes · SVG nativo do Godot
      </Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button
          testID="chart-data"
          text="Atualizar dados"
          onActivate={commands.data}
          style={{ flex: 1, height: 42 }}
        />
        <Button
          testID="chart-curve"
          text="Alternar curva"
          onActivate={commands.curve}
          style={{ flex: 1, height: 42 }}
        />
        <Button
          testID="chart-empty"
          text="Vazio / restaurar"
          onActivate={commands.empty}
          style={{ flex: 1, height: 42 }}
        />
      </View>
      <Text
        testID="chart-state"
        style={{ height: 28 }}
      >{`Dados: ${version} · ${curve} · ${window.width} px · ${empty ? "vazio" : "8 pontos"}`}</Text>
      {visible && (
        <LineChart
          testID="library-chart"
          width={chartWidth}
          height={Math.max(160, Math.min(360, window.height - 412))}
          data={data}
          xKey="day"
          yKey="cargo"
          area
          curve={curve}
          theme="dark"
          labelRotation={rotation}
          labelStrategy={rotation ? "rotate" : "auto"}
          series={threshold ? thresholdSeries : undefined}
          showHorizontalGridLines
          legend={false}
          onLayoutDebug={observeLayout}
          interaction={{
            mode: "scrub",
            onSelect: (event) => {
              metrics.selections.push(event);
              setSelection(event);
            },
          }}
          tooltip={{ positionAnimationDuration: 120 }}
        />
      )}
      <Text testID="chart-selection" style={{ height: 28 }}>
        {selection
          ? `Seleção: ${selection.xLabel} · ${selection.series[0].value}`
          : "Clique ou arraste no gráfico para selecionar"}
      </Text>
      <Text style={{ height: 28 }}>
        Sem DOM ou WebView · formas via SVG · texto via fontes Godot
      </Text>
    </View>
  );
}
export function runChart(name) {
  commands[name]();
}
export function chartStats() {
  return { ...metrics, windowSubscribers: windowSubscriptionCount() };
}
