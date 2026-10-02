import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useContext,
  createContext,
  Suspense,
  useSyncExternalStore,
  startTransition,
  useCallback,
  memo,
} from "react";
import { View, Text, Button, TextInput } from "../../src/components";



const stats = {
  mounts: 0,
  cleanups: 0,
  caught: 0,
  layout: [],
  refCleanups: 0,
  refAttached: 0,
  bubbles: 0,
  rowRenders: 0,
};
const Context = createContext("Fabric");
let controls = {};
let storeValue = 0;
const listeners = new Set();
const subscribe = (callback) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};
let resource;
function AsyncContent() {
  if (!resource.done) throw resource.promise;
  return (
    <Text
      testID="resolved"
      text="Suspense: Promise resolvida no Hermes"
      style={{ height: 32 }}
    />
  );
}
function Throwing() {
  throw new Error("Expected boundary validation");
}
class Boundary extends React.Component {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch() {
    stats.caught++;
  }
  render() {
    return this.state.error ? (
      <Text
        testID="recovered"
        text="ErrorBoundary: recuperado"
        style={{ height: 32 }}
      />
    ) : (
      this.props.children
    );
  }
}
const Row = memo(function Row({ name }) {
  stats.rowRenders++;
  const [count, setCount] = useState(0);
  return (
    <Button
      testID={`row-${name}`}
      text={`${name}: ${count}`}
      onActivate={() => setCount((n) => n + 1)}
      style={{ flex: 1, height: 44 }}
    />
  );
});
function RefProbe() {
  const attach = useCallback((node) => {
    if (node) stats.refAttached++;
    return () => {
      stats.refCleanups++;
    };
  }, []);
  return (
    <Text
      ref={attach}
      testID="ref-probe"
      text="React 19: callback ref com cleanup"
      style={{ height: 32 }}
    />
  );
}
function StoreValue() {
  const value = useSyncExternalStore(subscribe, () => storeValue);
  return (
    <Text
      testID="store"
      text={`External store: ${value}`}
      style={{ height: 32 }}
    />
  );
}
function App() {
  const [count, setCount] = useState(0);
  const [order, setOrder] = useState(["A", "B", "C"]);
  const [value, setValue] = useState("Godot nativo");
  const [async, setAsync] = useState(false);
  const [broken, setBroken] = useState(false);
  const [width, setWidth] = useState(400);
  const [version, setVersion] = useState(0);
  const [probe, setProbe] = useState(true);
  const measured = useRef(null);
  controls = {
    batch() {
      setCount((n) => n + 1);
      setCount((n) => n + 1);
      setCount((n) => n + 1);
    },
    reorder() {
      setOrder((old) => [...old].reverse());
    },
    resize() {
      setWidth(620);
    },
    handlers() {
      setVersion((n) => n + 1);
    },
    ref() {
      setProbe(false);
    },
    suspend() {
      resource = { done: false };
      resource.promise = new Promise((resolve) =>
        setTimeout(() => {
          resource.done = true;
          resolve();
        }, 400),
      );
      setAsync(true);
    },
    error() {
      setBroken(true);
    },
    store() {
      storeValue++;
      listeners.forEach((fn) => fn());
    },
    transition() {
      startTransition(() => setCount((n) => n + 10));
    },
  };
  useEffect(() => {
    stats.mounts++;
    return () => {
      stats.cleanups++;
    };
  }, []);
  useLayoutEffect(() => {
    measured.current.measure((x, y, width, height) =>
      stats.layout.push({
        width,
        height,
        native: measured.current.getNativeMetrics(),
      }),
    );
  }, [width]);
  const context = useContext(Context);
  return (
    <View
      testID="root"
      style={{ width: "100%", height: "100%", padding: 30, gap: 14 }}
    >
      <Text
        text="React Native · Fabric · Godot"
        fontSize={30}
        style={{ height: 46 }}
      />
      <Text
        text="Hermes + JSI → ShadowTree + Yoga → Controls"
        style={{ height: 32 }}
      />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Button
          testID="counter"
          text={`Contador: ${count}`}
          onActivate={() => setCount((n) => n + 1)}
          style={{ flex: 1, height: 44 }}
        />
        <Button
          testID="batch"
          text="Batch +3"
          onActivate={controls.batch}
          style={{ flex: 1, height: 44 }}
        />
        <Button
          testID="reorder"
          text="Inverter lista"
          onActivate={controls.reorder}
          style={{ flex: 1, height: 44 }}
        />
      </View>
      <View
        testID="rows"
        onActivate={() => stats.bubbles++}
        style={{ flexDirection: "row", gap: 12 }}
      >
        {order.map((name) => (
          <Row key={name} name={name} />
        ))}
      </View>
      <TextInput
        testID="input"
        text={value}
        onChange={(event) => {
          setValue(event.nativeEvent.text);
          stats.handlerVersion = version;
        }}
        style={{ height: 44 }}
      />
      <Text
        testID="context"
        text={`Context: ${context} · Input: ${value}`}
        style={{ height: 32 }}
      />
      <Button
        testID="measured"
        ref={measured}
        text="Alterar largura via Yoga"
        onActivate={controls.resize}
        style={{ width, height: 44 }}
      />
      <StoreValue />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Button
          testID="suspend"
          text="Suspense assíncrono"
          onActivate={controls.suspend}
          style={{ flex: 1, height: 44 }}
        />
        <Button
          testID="error"
          text="Testar ErrorBoundary"
          onActivate={controls.error}
          style={{ flex: 1, height: 44 }}
        />
      </View>
      {async && (
        <Suspense
          fallback={
            <Text
              testID="fallback"
              text="Suspense: aguardando..."
              style={{ height: 32 }}
            />
          }
        >
          <AsyncContent />
        </Suspense>
      )}
      {broken && (
        <Boundary>
          <View>
            <Text
              testID="abandoned"
              text="Nunca deve montar"
              style={{ height: 32 }}
            />
            <Throwing />
          </View>
        </Boundary>
      )}
      {probe && <RefProbe />}
      <Text
        text="Os objetos visíveis são Controls reais do Godot."
        style={{ height: 32 }}
      />
    </View>
  );
}

export function ReactApp() {
  return <Context.Provider value="React Native"><App /></Context.Provider>;
}
export function runReact(name) {
  controls[name]();
}
export function reactStats() {
  return { ...stats, subscribers: listeners.size };
}
