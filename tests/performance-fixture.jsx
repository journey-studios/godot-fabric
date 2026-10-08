import React from "react";
import {AppRegistry, Button, FlatList, Switch, Text, TextInput, View} from "react-native";
import {LineChart} from "react-native-chart-kit/v2";
import {COMPONENTS, LIST_ROWS, RETAIN_OBJECTS} from "./performance-cases.mjs";

// The four workloads the soak mounts and unmounts, each a root of its own, through the public
// facade only. The Godot probe mounts them, reads the host's counters, heap and timings and the
// engine's own node counts; this fixture holds no expectation.
const log = [];
let sequence = 0;
let retained = null;
function note(entry) {
  log.push({sequence: ++sequence, now: performance.now(), ...entry});
}

function Idle() {
  return <View testID="performance-idle-root" style={{flex: 1}} />;
}

function Forms() {
  const [text, setText] = React.useState("");
  const [on, setOn] = React.useState(false);
  return <View testID="performance-forms-root" style={{flex: 1, padding: 12, gap: 8}}>
    <Button testID="performance-forms-button" title="Salvar" onPress={() => note({kind: "press"})} />
    <TextInput testID="performance-forms-input" value={text} onChangeText={setText} placeholder="Nome" style={{height: 36}} />
    <Switch testID="performance-forms-switch" value={on} onValueChange={setOn} />
  </View>;
}

const points = [18, 35, 24, 68, 54, 92, 77, 120];
const series = points.map((cargo, index) => ({day: `D${index + 1}`, cargo}));
function Chart() {
  return <View testID="performance-chart-root" style={{flex: 1, padding: 12}}>
    <LineChart testID="performance-chart" width={320} height={200} data={series} xKey="day" yKey="cargo" area
      curve="linear" theme="dark" showHorizontalGridLines legend={false} />
  </View>;
}

const rows = Array.from({length: LIST_ROWS}, (_, index) => ({key: `row-${index}`, index}));
function List() {
  return <View testID="performance-list-root" style={{flex: 1}}>
    <FlatList testID="performance-list" data={rows} initialNumToRender={LIST_ROWS} windowSize={LIST_ROWS}
      getItemLayout={(_, index) => ({length: 28, offset: 28 * index, index})}
      renderItem={({item}) => <View style={{height: 28, paddingHorizontal: 12}}><Text>{`Linha ${item.index}`}</Text></View>} />
  </View>;
}

AppRegistry.registerComponent(COMPONENTS.idle, () => Idle);
AppRegistry.registerComponent(COMPONENTS.forms, () => Forms);
AppRegistry.registerComponent(COMPONENTS.chart, () => Chart);
AppRegistry.registerComponent(COMPONENTS.list, () => List);

globalThis.PerformanceProbe = {
  // Everything recorded since the last call.
  take() { return log.splice(0); },
  // The host's time now, in the base performance.now() reports.
  now() { return performance.now(); },
  // What the runtime says it is, for the report's provenance.
  engine() {
    const properties = typeof HermesInternal === "object" && HermesInternal !== null && typeof HermesInternal.getRuntimeProperties === "function"
      ? HermesInternal.getRuntimeProperties() : null;
    return {properties, hasHermesInternal: properties !== null};
  },
  // JS allocation held on purpose, so that the heap reading can be asked to show it and then to forget it.
  retain() {
    retained = Array.from({length: RETAIN_OBJECTS}, (_, index) => ({index, label: `retained-${index}`}));
    return retained.length;
  },
  release() {
    const held = retained === null ? 0 : retained.length;
    retained = null;
    return held;
  },
  // A JS turn that keeps the engine busy for the given milliseconds (by the host's own clock), run from a timer.
  burn(label, ms) {
    setTimeout(() => {
      const start = performance.now();
      while (performance.now() - start < ms) {
        // Busy on purpose.
      }
      note({kind: "burn", label, requestedMs: ms, ranMs: performance.now() - start});
    }, 0);
  },
};
