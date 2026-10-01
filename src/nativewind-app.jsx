import React, { useEffect, useState } from "react";
import { View, Text, Pressable, Appearance } from "react-native";
import { vars } from "nativewind";
import "../build/nativewind-compiled";
import { disposeEnvironment, environmentStats } from "./platform-environment";
import { windowSubscriptionCount } from "./window-dimensions";

const stats = { mounts: 0, cleanups: 0, renders: 0, errors: [] };
let actions = {};
class Boundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    stats.errors.push(error.message);
  }
  render() {
    return this.state.failed ? (
      <Text testID="unsupported-fallback" className="text-red-300 text-[16px]">
        Recurso indisponível: falha explícita, capturada pelo React.
      </Text>
    ) : (
      this.props.children
    );
  }
}
export function NativeWindApp() {
  const [changed, setChanged] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [count, setCount] = useState(0);
  const [failure, setFailure] = useState(null);
  stats.renders++;
  actions = {
    change: () => setChanged((value) => !value),
    clear: () => setCleared((value) => !value),
    theme: (value) => Appearance.setColorScheme(value),
    unsupported: () => setFailure("style"),
    animation: () => setFailure("animation"),
    recover: () => setFailure(null),
  };
  stats.changed = changed;
  stats.cleared = cleared;
  stats.count = count;
  useEffect(() => {
    stats.mounts++;
    return () => {
      stats.cleanups++;
    };
  }, []);
  return (
    <View
      testID="nw-root"
      className="w-full h-full p-6 gap-4 bg-slate-950"
      style={vars({ "--accent": changed ? "#34d399" : "#fbbf24" })}
    >
      <Text className="text-slate-400 text-[14px]">
        LABORATÓRIO / UI NATIVA
      </Text>
      <Text
        testID="nw-title"
        className={
          changed ? "text-white text-[32px]" : "text-white text-[28px]"
        }
      >
        NativeWind → Fabric → Godot
      </Text>
      <Text className="text-slate-300 text-[16px]">
        Tailwind e interop originais executando sobre Hermes, Yoga e Controls.
      </Text>
      <View testID="nw-row" className="h-[300px] flex-col lg:flex-row gap-4">
        <View
          testID="nw-card"
          className={
            changed
              ? "flex-1 p-5 gap-3 bg-teal-500 border-2 border-teal-200 rounded-[16px]"
              : "flex-1 p-5 gap-3 bg-indigo-600 border-2 border-indigo-300 rounded-[16px]"
          }
        >
          <Text className="text-white text-[22px]">Classes vivas</Text>
          <Text className="text-white text-[16px]">
            Cor, borda, espaçamento e tamanho de texto mudam via React.
          </Text>
          <View
            testID="nw-variable"
            className="w-[48px] h-[24px] rounded-[6px] bg-[--accent]"
          />
        </View>
        <View
          testID="nw-theme"
          className="flex-1 p-5 gap-3 bg-slate-100 dark:bg-slate-800 rounded-[16px]"
        >
          <Text className="text-slate-900 dark:text-slate-100 text-[22px]">
            Tema explícito
          </Text>
          <Text className="text-slate-600 dark:text-slate-300 text-[16px]">
            lg: altera o layout com a largura real da surface. dark: acompanha o
            tema manual.
          </Text>
        </View>
      </View>
      <View className="flex-row gap-4">
        <Pressable
          testID="nw-press"
          className="flex-1 h-[48px] px-5 justify-center rounded-[12px] bg-blue-600 active:bg-blue-400"
          onPress={() => setCount((value) => value + 1)}
        >
          <Text testID="nw-count" className="text-white text-[18px]">
            Pressability original · cliques: {count}
          </Text>
        </Pressable>
        <Pressable
          testID="nw-change"
          className="h-[48px] px-5 justify-center rounded-[12px] bg-slate-700 active:bg-slate-600"
          onPress={actions.change}
        >
          <Text className="text-white text-[16px]">Trocar classes</Text>
        </Pressable>
        <Pressable
          className="h-[48px] px-5 justify-center rounded-[12px] bg-slate-700 active:bg-slate-600"
          onPress={() =>
            Appearance.setColorScheme(
              Appearance.getColorScheme() === "light" ? "dark" : "light",
            )
          }
        >
          <Text className="text-white text-[16px]">Tema</Text>
        </Pressable>
      </View>
      <View className="flex-row gap-4 items-center">
        <View
          testID="nw-clear"
          className={
            cleared
              ? "w-[96px] h-[48px]"
              : "w-[96px] h-[48px] bg-rose-500 border-2 border-white rounded-[12px] opacity-50"
          }
        />
        <View
          testID="nw-inline"
          className="w-[48px] h-[48px] bg-red-500 rounded-[8px]"
          style={{ backgroundColor: "#2563eb" }}
        />
        <View
          testID="nw-important"
          className="w-[48px] h-[48px] !bg-emerald-500 rounded-[8px]"
          style={{ backgroundColor: "#f43f5e" }}
        />
        <Text className="text-slate-400 text-[14px]">
          Remoção de estilos · inline · !important
        </Text>
      </View>
      {failure && (
        <Boundary key={failure}>
          {failure === "style" ? (
            <Text style={{ textShadowRadius: 2 }}>Sombra de texto ainda sem adapter</Text>
          ) : (
            <View className="animate-spin w-[24px] h-[24px] bg-white" />
          )}
        </Boundary>
      )}
      <Text className="text-slate-500 text-[14px]">
        Cena isolada · sem GDSS · sem recompilar o Godot
      </Text>
    </View>
  );
}
export function runNativeWind(name, ...args) {
  actions[name](...args);
}
export function nativewindStats() {
  return {
    ...stats,
    environment: environmentStats(),
    subscribers: windowSubscriptionCount(),
  };
}
export function stopNativeWind() {
  disposeEnvironment();
}
