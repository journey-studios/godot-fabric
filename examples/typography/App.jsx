import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import "../../build/nativewind-compiled";
import { Button as LegacyButton } from "../../src/components";
import { disposeEnvironment, environmentStats } from "../../src/platform-environment";

const stats = {
  mounts: 0,
  cleanups: 0,
  childMounts: 0,
  childCleanups: 0,
  errors: [],
};
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
      <Text testID="ty-fallback" className="text-red-300">
        Recurso recusado pelo contrato de texto.
      </Text>
    ) : (
      this.props.children
    );
  }
}
function StatefulSpan() {
  const [count, setCount] = useState(0);
  actions.increment = () => setCount((value) => value + 1);
  stats.count = count;
  useEffect(() => {
    stats.childMounts++;
    return () => {
      stats.childCleanups++;
    };
  }, []);
  return <Text className="text-emerald-300 font-bold">{count} itens</Text>;
}
export function TypographyApp() {
  const [changed, setChanged] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [failure, setFailure] = useState(null);
  const [clipped, setClipped] = useState(false);
  const [limit, setLimit] = useState(2);
  stats.changed = changed;
  stats.cleared = cleared;
  stats.clipped = clipped;
  stats.limit = limit;
  actions.change = () => setChanged((value) => !value);
  actions.clear = () => setCleared((value) => !value);
  actions.fail = (value) => setFailure(value);
  actions.clip = () => setClipped((value) => !value);
  actions.limit = (value) => setLimit(value);
  useEffect(() => {
    stats.mounts++;
    return () => {
      stats.cleanups++;
    };
  }, []);
  return (
    <View testID="ty-root" className="w-full h-full p-6 gap-4 bg-slate-950">
      <Text className="font-sans text-slate-400 text-sm">
        LABORATÓRIO / TIPOGRAFIA FABRIC ORIGINAL
      </Text>
      <Text
        testID="ty-title"
        className={
          changed
            ? "font-mono text-3xl font-bold leading-10 text-white"
            : "font-sans text-xl font-bold leading-7 text-white"
        }
      >
        Exemplo de tipografia
      </Text>
      <Text
        testID="ty-rich"
        className={
          changed
            ? "font-mono text-lg leading-8 text-slate-200"
            : "font-sans text-base leading-6 text-slate-200"
        }
      >
        Contador com <StatefulSpan /> e{" "}
        <Text className="text-amber-300 font-semibold">destaques</Text>.
        Trechos, herança e estado pertencem ao React.
      </Text>
      <View className="flex-row gap-3">
        <Pressable
          testID="ty-change"
          className="px-4 py-3 bg-indigo-600 rounded-lg"
          onPress={actions.change}
        >
          <Text className="font-sans text-white text-base">
            Trocar fonte e escala
          </Text>
        </Pressable>
        <Pressable
          testID="ty-increment"
          className="px-4 py-3 bg-slate-700 rounded-lg"
          onPress={() => actions.increment()}
        >
          <Text className="font-sans text-white text-base">Adicionar item</Text>
        </Pressable>
      </View>
      <View testID="ty-card" className="p-4 gap-3 bg-slate-800 rounded-xl">
        <Text className="font-sans font-semibold text-lg text-white leading-7">
          Cartão de exemplo
        </Text>
        <Text
          testID="ty-description"
          className={
            changed
              ? "font-mono text-lg leading-8 text-slate-200"
              : "font-sans text-base leading-6 text-slate-200"
          }
        >
          Uma descrição genérica com detalhes para exercitar a quebra de linhas.
          A descrição usa largura disponível, mantém acentos e cresce quando a
          janela fica estreita. Nenhuma altura foi fixada para este parágrafo.
        </Text>
        <Text testID="ty-after" className="font-mono text-sm text-emerald-300">
          Peso total: 12 kg · condição: boa
        </Text>
      </View>
      <View className="flex-row gap-2">
        {["left", "center", "right"].map((align) => (
          <Text
            key={align}
            testID={`ty-${align}`}
            className="font-sans text-base leading-6 text-white bg-slate-800"
            style={{ width: 150, textAlign: align }}
          >
            Alinhamento
          </Text>
        ))}
      </View>
      <View className="flex-row items-start gap-4">
        <Text
          testID="ty-regular"
          className="font-sans text-xl font-normal text-white leading-8"
        >
          Hamburgefonts
        </Text>
        <Text
          testID="ty-bold"
          className="font-sans text-xl font-bold text-white leading-8"
        >
          Hamburgefonts
        </Text>
      </View>
      <View className="flex-row items-start gap-4">
        <Text
          testID="ty-spacing"
          className="font-sans text-xl text-white leading-8"
          style={{ letterSpacing: 2 }}
        >
          Hamburgefonts
        </Text>
        <Text
          testID="ty-break"
          className="font-sans text-sm text-slate-400 leading-6"
        >
          {"Quebras\nexplícitas\n"}
        </Text>
        <Text
          testID="ty-empty"
          className="font-sans font-bold text-white leading-6"
        />
      </View>
      <Text
        testID="ty-reset"
        className={
          cleared
            ? "text-white"
            : "font-mono text-xl font-bold leading-10 text-right text-white"
        }
      >
        Propriedades removíveis
      </Text>
      <Text
        testID="ty-limited"
        numberOfLines={limit}
        ellipsizeMode={clipped ? "clip" : "tail"}
        className="font-sans text-base leading-6 text-white"
        style={{ width: 260 }}
      >
        Uma descrição longa para mostrar o corte em duas linhas, com reticências
        reais na última linha visível e sem ocupar a altura inteira do texto
        original.
      </Text>
      <ScrollView
        testID="ty-scroll"
        style={{ flex: 1, minHeight: 90 }}
        contentContainerStyle={{ gap: 8 }}
      >
        {[
          "Primeiro item",
          "Ferramentas de reparo",
          "Reservas de emergência",
          "Quarto item",
          "Material de acampamento",
          "Peças de reposição",
          "Instrumentos de medição",
          "Coleção de amostras",
          "Nono item",
          "Décimo item",
        ].map((item, index) => (
          <View key={item} style={{ padding: 12, backgroundColor: "#1e293b" }}>
            <Text className="font-sans text-white text-base leading-6">
              {index + 1}. {item}
            </Text>
          </View>
        ))}
      </ScrollView>
      {failure && (
        <Boundary key={failure}>
          {failure === "native" ? (
            <Text>
              <LegacyButton
                text="Unsupported attachment"
                style={{ width: 60, height: 30 }}
              />
            </Text>
          ) : failure === "font" ? (
            <Text style={{ fontFamily: "UnknownFont" }}>Inválido</Text>
          ) : failure === "inline" ? (
            <Text>
              <View />
            </Text>
          ) : (
            <Text ellipsizeMode="middle">Inválido</Text>
          )}
        </Boundary>
      )}
    </View>
  );
}
export function runTypography(name, ...args) {
  actions[name](...args);
}
export function typographyStats() {
  return { ...stats, environment: environmentStats() };
}
export function stopTypography() {
  disposeEnvironment();
}
