// Shared verbatim by Godot and the unmodified RN iOS/Android reference app.
import React, { createContext, memo, startTransition, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import nativePackage from "react-native/package.json";

const Context = createContext("initial");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function until(condition) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await sleep(20);
  }
  throw new Error("Parity fixture timed out waiting for a native commit");
}

export function ParityFixture({ onComplete }) {
  const [visible, setVisible] = useState(true);
  const session = useRef(null);
  if (!session.current) session.current = {
    checks: [], counts: [], rowRenders: {}, mounts: [], cleanups: [], refs: {},
    layouts: [], positions: {}, storeValue: 0, subscribers: new Set(), context: "", observedStore: -1,
  };
  const complete = async (error) => {
    setVisible(false);
    try {
      await until(() => session.current.cleanups.length === 2 && session.current.subscribers.size === 0);
      session.current.checks.push({ id: "unmount-cleanup", passed: true });
    } catch (cleanupError) {
      error ||= cleanupError;
    }
    onComplete({ schemaVersion: 1, fixture: "core-ui-v1", react: React.version, reactNative: nativePackage.version,
      renderer: globalThis.nativeFabricUIManager ? "fabric" : "missing", engine: globalThis.HermesInternal ? "hermes" : "missing",
      observations: { box: session.current.layouts[0], rows: { ...session.current.positions }, counts: [...session.current.counts],
        renders: { ...session.current.rowRenders }, mounts: [...session.current.mounts], cleanups: [...session.current.cleanups],
        context: session.current.context, store: session.current.observedStore, subscribers: session.current.subscribers.size },
      status: error ? "failed" : "passed", checks: session.current.checks, ...(error ? { error: String(error.message || error) } : {}) });
  };
  return visible ? <Probe session={session.current} complete={complete} /> : null;
}

const Row = memo(function Row({ name, session }) {
  session.rowRenders[name] = (session.rowRenders[name] || 0) + 1;
  useEffect(() => {
    session.mounts.push(name);
    return () => session.cleanups.push(name);
  }, []);
  return <View ref={(instance) => { session.refs[name] = instance; }} onLayout={(event) => { session.positions[name] = event.nativeEvent.layout.x; }} testID={`parity-row-${name}`} style={{ width: 64, height: 24 }}><Text>{name}</Text></View>;
});
function ContextValue({ session }) {
  const value = useContext(Context);
  useLayoutEffect(() => { session.context = value; }, [value]);
  return <Text testID="parity-context">{value}</Text>;
}
function StoreValue({ session }) {
  const subscribe = React.useCallback((callback) => {
    session.subscribers.add(callback);
    return () => session.subscribers.delete(callback);
  }, [session]);
  const getSnapshot = React.useCallback(() => session.storeValue, [session]);
  const value = useSyncExternalStore(subscribe, getSnapshot);
  useLayoutEffect(() => { session.observedStore = value; }, [value]);
  return <Text testID="parity-store">{value}</Text>;
}
function Probe({ session, complete }) {
  const [count, setCount] = useState(0);
  const [order, setOrder] = useState(["A", "B"]);
  const [context, setContext] = useState("initial");
  const box = useRef(null);
  useLayoutEffect(() => { session.counts.push(count); }, [count]);
  useEffect(() => {
    const check = (id, passed) => {
      session.checks.push({ id, passed });
      if (!passed) throw new Error(`Parity assertion failed: ${id}`);
    };
    async function exercise() {
      await until(() => session.layouts.length && session.mounts.length === 2 && session.observedStore === 0);
      const { x, y, width, height } = session.layouts[0];
      check("native-layout", x === 8 && y === 8 && width === 120 && height === 40);
      const measurement = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Native measure callback missing")), 4000);
        box.current.measure((_x, _y, measuredWidth, measuredHeight) => {
          clearTimeout(timeout);
          resolve({ width: measuredWidth, height: measuredHeight });
        });
      });
      check("native-measure", measurement.width === 120 && measurement.height === 40);
      const beforeRefs = { ...session.refs };
      setCount((value) => value + 1);
      setCount((value) => value + 1);
      await until(() => session.counts.at(-1) === 2);
      check("automatic-batching", session.counts.join(",") === "0,2");
      setOrder(["B", "A"]);
      await until(() => session.positions.A === 64 && session.positions.B === 0);
      check("keyed-reorder", session.refs.A === beforeRefs.A && session.refs.B === beforeRefs.B && session.mounts.length === 2);
      check("memo", session.rowRenders.A === 1 && session.rowRenders.B === 1);
      setContext("updated");
      await until(() => session.context === "updated");
      check("context-update", true);
      session.storeValue = 7;
      for (const callback of session.subscribers) callback();
      await until(() => session.observedStore === 7);
      check("external-store", true);
      startTransition(() => setCount(3));
      await until(() => session.counts.at(-1) === 3);
      check("transition-commit", true);
    }
    exercise().then(() => complete()).catch(complete);
  }, []);
  return <Context.Provider value={context}>
    <View testID="parity-root" style={{ width: 240, height: 200, padding: 8 }}>
      <View ref={box} testID="parity-box" onLayout={(event) => session.layouts.push(event.nativeEvent.layout)} style={{ width: 120, height: 40 }} />
      <Text testID="parity-count">{count}</Text>
      <View style={{ flexDirection: "row" }}>{order.map((name) => <Row key={name} name={name} session={session} />)}</View>
      <ContextValue session={session} />
      <StoreValue session={session} />
    </View>
  </Context.Provider>;
}
