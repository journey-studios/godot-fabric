import { Component, type ReactNode, useEffect, useState } from "react";
import { Appearance, Image, Pressable, Text, View, useColorScheme, useWindowDimensions } from "react-native";
import { LineChart } from "react-native-chart-kit/v2";
import { stats } from "./stats";
import swatch from "./swatch.png";

const days = [18, 35, 24, 68, 54, 92, 77, 120];
const panelWidth = 420;
const gutter = 16;

// React catches what the platform refuses to render; the validation reads the message from the counters.
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    stats.errors.push(error.message);
  }
  render() {
    return this.state.failed ? (
      <Text testID="lib-unsupported" className="text-sm text-red-500">
        Unsupported: caught by React
      </Text>
    ) : (
      this.props.children
    );
  }
}

function Subtree() {
  const [local, setLocal] = useState(0);
  useEffect(() => {
    stats.subtreeMounts++;
    return () => {
      stats.subtreeCleanups++;
    };
  }, []);
  return (
    <View testID="lib-subtree" className="p-3 gap-2 rounded-lg bg-white dark:bg-slate-800">
      <Text testID="lib-subtree-text" className="text-base text-slate-700 dark:text-slate-200">
        Local: {local}
      </Text>
      <Pressable
        testID="lib-subtree-press"
        className="h-9 px-3 justify-center rounded-md bg-emerald-600 active:bg-emerald-400"
        onPress={() => setLocal((value) => value + 1)}
      >
        <Text className="text-sm text-white">Increment subtree</Text>
      </Pressable>
    </View>
  );
}

export function App() {
  const [count, setCount] = useState(0);
  const [accent, setAccent] = useState(false);
  const [subtree, setSubtree] = useState(true);
  const [version, setVersion] = useState(0);
  const [animate, setAnimate] = useState(false);
  const scheme = useColorScheme();
  const window = useWindowDimensions();
  stats.renders++;
  useEffect(() => {
    stats.appMounts++;
    return () => {
      stats.appCleanups++;
    };
  }, []);
  const chartWidth = Math.max(1, window.width - panelWidth - gutter * 3);
  const data = days.map((value, index) => ({ day: `D${index + 1}`, cargo: value + version * (index % 3 === 0 ? 32 : -4) }));
  return (
    <View testID="lib-root" className="w-full h-full flex-row gap-4 p-4 bg-slate-100 dark:bg-slate-900">
      <View testID="lib-panel" className="w-[420px] gap-3">
        <Text testID="lib-title" className="text-2xl font-semibold text-slate-900 dark:text-white">
          NativeWind and Chart Kit
        </Text>
        <Text testID="lib-theme-label" className="text-sm text-slate-600 dark:text-slate-300">
          Theme: {scheme ?? "unset"}
        </Text>
        <View
          testID="lib-card"
          className={
            accent
              ? "flex-row items-center gap-3 p-4 rounded-xl border-2 bg-brand-600 border-brand-400"
              : "flex-row items-center gap-3 p-4 rounded-xl border-2 bg-indigo-600 border-indigo-300"
          }
        >
          <Image testID="lib-image" source={swatch} className="w-14 h-14 rounded-lg" />
          <Text testID="lib-count" className="text-lg text-white">
            Count: {count}
          </Text>
        </View>
        <View className="flex-row flex-wrap gap-2">
          <Pressable
            testID="lib-count-press"
            className="h-11 px-4 justify-center rounded-lg bg-blue-600 active:bg-blue-400"
            onPress={() => {
              stats.presses++;
              setCount((value) => value + 1);
            }}
          >
            <Text className="text-base text-white">Count</Text>
          </Pressable>
          <Pressable
            testID="lib-accent-press"
            className="h-11 px-4 justify-center rounded-lg bg-slate-700 active:bg-slate-500"
            onPress={() => setAccent((value) => !value)}
          >
            <Text className="text-base text-white">Accent</Text>
          </Pressable>
          <Pressable
            testID="lib-light-press"
            className="h-11 px-4 justify-center rounded-lg bg-slate-700 active:bg-slate-500"
            onPress={() => Appearance.setColorScheme("light")}
          >
            <Text className="text-base text-white">Light</Text>
          </Pressable>
          <Pressable
            testID="lib-dark-press"
            className="h-11 px-4 justify-center rounded-lg bg-slate-700 active:bg-slate-500"
            onPress={() => Appearance.setColorScheme("dark")}
          >
            <Text className="text-base text-white">Dark</Text>
          </Pressable>
          <Pressable
            testID="lib-subtree-toggle"
            className="h-11 px-4 justify-center rounded-lg bg-slate-700 active:bg-slate-500"
            onPress={() => setSubtree((value) => !value)}
          >
            <Text className="text-base text-white">Subtree</Text>
          </Pressable>
          <Pressable
            testID="lib-data-press"
            className="h-11 px-4 justify-center rounded-lg bg-slate-700 active:bg-slate-500"
            onPress={() => setVersion((value) => value + 1)}
          >
            <Text className="text-base text-white">Data</Text>
          </Pressable>
          <Pressable
            testID="lib-animate-press"
            className="h-11 px-4 justify-center rounded-lg bg-slate-700 active:bg-slate-500"
            onPress={() => setAnimate((value) => !value)}
          >
            <Text className="text-base text-white">Animate</Text>
          </Pressable>
        </View>
        {subtree ? <Subtree /> : null}
        {animate ? (
          <Boundary key="animate">
            <View testID="lib-animated" className="animate-spin w-4 h-4 bg-white" />
          </Boundary>
        ) : null}
      </View>
      <View testID="lib-chart-panel" className="flex-1 self-start p-3 rounded-xl bg-white dark:bg-slate-800">
        <LineChart
          testID="lib-chart"
          width={chartWidth - 24}
          height={260}
          data={data}
          xKey="day"
          yKey="cargo"
          area
          theme={scheme === "dark" ? "dark" : "light"}
          showHorizontalGridLines
          legend={false}
        />
      </View>
    </View>
  );
}
