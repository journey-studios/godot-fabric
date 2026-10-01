import React, { useEffect, useRef, useState } from "react";
import { View, Text, Button, Pressable, TextInput } from "./components";
import { ScrollView } from "./scroll-view";

const observations = {
  events: [],
  selected: null,
  cleanups: 0,
  content: [],
  measured: null,
};
const actions = {};
class ScrollOptionBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    observations.unsupportedProp = error.message;
  }
  render() {
    return this.state.failed ? (
      <Text
        testID="unsupported-scroll-error"
        text="Opção rejeitada"
        style={{ height: 0 }}
      />
    ) : (
      this.props.children
    );
  }
}
function record(type, event) {
  observations.events.push({ type, ...event?.nativeEvent });
}

export function ScrollApp() {
  const [items, setItems] = useState(() =>
    Array.from({ length: 48 }, (_, id) => ({
      id,
      name: `Registro ${String(id).padStart(2, "0")}`,
    })),
  );
  const [selected, select] = useState(null);
  const [query, filter] = useState("");
  const [enabled, enable] = useState(true);
  const [locked, lock] = useState(false);
  const [nativeProbe, showNativeProbe] = useState(false);
  const [unsupportedProbe, showUnsupportedProbe] = useState(false);
  const [initialOffset, setInitialOffset] = useState(undefined);
  const [present, show] = useState(true);
  const vertical = useRef(null);
  const horizontal = useRef(null);
  const row = useRef(null);
  actions.populate = (count) =>
    setItems(
      Array.from({ length: count }, (_, id) => ({
        id,
        name: `Registro ${String(id).padStart(2, "0")}`,
      })),
    );
  actions.clear = () => {
    observations.events.length = 0;
  };
  actions.nativeProbe = (value) => showNativeProbe(value);
  actions.unsupportedProp = (value) => showUnsupportedProbe(value);
  actions.propOffset = (y) => setInitialOffset({ x: 0, y });
  actions.offset = (y) => vertical.current?.scrollTo({ y });
  actions.end = () => vertical.current?.scrollToEnd();
  actions.horizontal = (x) => horizontal.current?.scrollTo({ x });
  actions.enable = (value) => enable(value);
  actions.lock = (value) => lock(value);
  actions.remove = () => show(false);
  actions.restore = () => show(true);
  actions.shrink = () => setItems((value) => value.slice(0, 2));
  actions.reverse = () => setItems((value) => [...value].reverse());
  actions.filter = (value) => filter(value);
  actions.measure = () =>
    row.current?.measureInWindow((x, y, width, height) => {
      observations.measured = { x, y, width, height };
    });
  actions.unsupported = () => {
    try {
      vertical.current.scrollTo({ y: 50, animated: true });
    } catch (error) {
      observations.unsupported = error.message;
    }
  };
  useEffect(
    () => () => {
      observations.cleanups++;
    },
    [],
  );
  const visible = items.filter((item) =>
    item.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <View
      testID="inventory-root"
      pointerEvents="box-none"
      style={{ padding: 24, gap: 12, height: "100%" }}
    >
      <Text
        text="Fabric + Godot · inventário com ScrollView nativo"
        style={{ height: 32 }}
      />
      <TextInput
        testID="filter"
        value={query}
        onChangeText={filter}
        placeholder="Filtrar mercadorias"
        style={{ height: 38 }}
      />
      <Text
        testID="selection"
        text={
          selected === null
            ? "Selecione uma mercadoria; arraste para rolar"
            : `Selecionado: ${items.find((item) => item.id === selected)?.name ?? selected}`
        }
        style={{ height: 28 }}
      />
      {selected !== null && (
        <TextInput
          testID="rename"
          value={items.find((item) => item.id === selected)?.name ?? ""}
          onChangeText={(name) =>
            setItems((value) =>
              value.map((item) =>
                item.id === selected ? { ...item, name } : item,
              ),
            )
          }
          style={{ height: 38 }}
        />
      )}
      {present && (
        <ScrollView
          testID="inventory"
          ref={vertical}
          scrollEnabled={enabled}
          contentOffset={initialOffset}
          style={[{ flex: 1 }, null]}
          onScroll={(event) => record("Scroll", event)}
          onScrollBeginDrag={(event) => record("Begin", event)}
          onScrollEndDrag={(event) => record("End", event)}
          onResponderReject={() => record("Reject")}
          onContentSizeChange={(width, height) => {
            observations.content = [width, height];
          }}
        >
          {visible.map((item) => (
            <Pressable
              key={item.id}
              testID={`item-${item.id}`}
              ref={item.id === 0 ? row : undefined}
              cancelable={!locked}
              delayLongPress={400}
              onPressIn={() => record(`In:${item.id}`)}
              onPressOut={() => record(`Out:${item.id}`)}
              onLongPress={() => record(`Long:${item.id}`)}
              onPress={() => {
                select(item.id);
                observations.selected = item.id;
                record(`Press:${item.id}`);
              }}
              style={({ pressed }) => ({
                height: 48,
                paddingLeft: 12,
                opacity: pressed ? 0.5 : 1,
              })}
            >
              <Text
                text={`${String(item.id).padStart(2, "0")}  ·  ${item.name}  ·  ${item.id % 2 ? "12 un." : "8 un."}`}
                style={{ height: 48 }}
              />
            </Pressable>
          ))}
          {nativeProbe && (
            <Button
              testID="native-inventory-action"
              text="Detalhes"
              onActivate={() => record("NativeAction")}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                width: 140,
                height: 32,
              }}
            />
          )}
          {visible.length === 0 && (
            <Text
              testID="empty"
              text="Nenhuma mercadoria encontrada"
              style={{ height: 48 }}
            />
          )}
        </ScrollView>
      )}
      <ScrollView
        testID="categories"
        ref={horizontal}
        horizontal
        style={{ height: 48 }}
      >
        {[
          "Alimentos",
          "Ferramentas",
          "Materiais",
          "Equipamentos",
          "Relíquias",
          "Comércio",
        ].map((name) => (
          <Text
            key={name}
            text={name}
            style={{ width: 220, height: 48, paddingLeft: 12 }}
          />
        ))}
      </ScrollView>
      <View pointerEvents="box-none" style={{ flexDirection: "row", gap: 12 }}>
        <Button
          text="Início"
          onActivate={() => actions.offset(0)}
          style={{ height: 38, flex: 1 }}
        />
        <Button
          text="Fim"
          onActivate={() => actions.end()}
          style={{ height: 38, flex: 1 }}
        />
        <Button
          text={enabled ? "Desativar rolagem" : "Ativar rolagem"}
          onActivate={() => enable((value) => !value)}
          style={{ height: 38, flex: 1 }}
        />
      </View>
      {unsupportedProbe && (
        <ScrollOptionBoundary>
          <ScrollView
            testID="unsupported-scroll"
            disableScrollViewPanResponder
            style={{ height: 0 }}
          />
        </ScrollOptionBoundary>
      )}
    </View>
  );
}
export function runScroll(name, ...args) {
  actions[name](...args);
}
export function scrollStats() {
  return { ...observations };
}
