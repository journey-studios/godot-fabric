import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { View, Text, Button, TextInput } from "./components";

const observations = {
  mounts: 0,
  cleanups: 0,
  events: [],
  measurements: [],
  presses: 0,
  refAttached: 0,
  refCleanups: 0,
};
let actions = {};
function record(id, type, event) {
  observations.events.push({ id, type, ...event.nativeEvent });
}
export function inputStats() {
  return { ...observations };
}
export function runInput(name, ...args) {
  return actions[name](...args);
}

export function InputApp() {
  const [value, setValue] = useState("A😀B");
  const [selection, setSelection] = useState({ start: 1, end: 3 });
  const [upper, setUpper] = useState(false);
  const [order, setOrder] = useState(["controlled", "uncontrolled"]);
  const [version, setVersion] = useState(0);
  const [editable, setEditable] = useState(true);
  const [submitBehavior, setSubmitBehavior] = useState("submit");
  const [tinySize, setTinySize] = useState(12);
  const controlled = useRef(null),
    uncontrolled = useRef(null),
    fixed = useRef(null);
  const tiny = useRef(null),
    tinyInput = useRef(null);
  const attachTinyInput = useCallback((instance) => {
    tinyInput.current = instance;
    observations.refAttached++;
    return () => {
      tinyInput.current = null;
      observations.refCleanups++;
    };
  }, []);
  actions = {
    focus(id = "controlled") {
      ({ controlled, uncontrolled, fixed })[id].current.focus();
    },
    blur() {
      controlled.current.blur();
    },
    isFocused() {
      observations.refFocused = controlled.current.isFocused();
    },
    value(next, nextSelection) {
      setValue(next);
      setSelection(nextSelection);
    },
    upper() {
      setUpper(true);
      setSelection(undefined);
    },
    handlers() {
      setVersion((n) => n + 1);
    },
    reorder() {
      setOrder((old) => [...old].reverse());
    },
    editable(next) {
      setEditable(next);
    },
    submit() {
      setSubmitBehavior("blurAndSubmit");
    },
    resize() {
      setTinySize(8);
    },
    command(count, next, start = -1, end = start) {
      controlled.current.setTextAndSelection(count, next, start, end);
    },
  };
  useEffect(() => {
    observations.mounts++;
    return () => {
      observations.cleanups++;
    };
  }, []);
  useLayoutEffect(() => {
    for (const ref of [tiny, tinyInput])
      ref.current.measure((x, y, width, height) =>
        observations.measurements.push({
          width,
          height,
          native: ref.current.getNativeMetrics(),
        }),
      );
  }, [tinySize]);
  const inputEvents = (id) => ({
    onFocus: (e) => record(id, "focus", e),
    onBlur: (e) => record(id, "blur", e),
    onEndEditing: (e) => record(id, "end", e),
    onSelectionChange: (e) => record(id, "selection", e),
    onSubmitEditing: (e) => record(id, "submit", e),
    onKeyPress: (e) => record(id, "key", e),
    onChange: (e) => {
      record(id, "change", e);
      observations.handlerVersion = version;
    },
  });
  return (
    <View
      testID="input-root"
      style={{ width: "100%", height: "100%", padding: 24, gap: 14 }}
    >
      <Text fontSize={28}>Fabric · edição nativa e teclado</Text>
      <Text>Seleção UTF-16, comandos com confirmação e foco preservado.</Text>
      {order.map((id) =>
        id === "controlled" ? (
          <TextInput
            key={id}
            testID={id}
            ref={controlled}
            value={value}
            selection={selection}
            editable={editable}
            submitBehavior={submitBehavior}
            {...inputEvents(id)}
            onChangeText={(next) => {
              observations.changedText = next;
              setValue(upper ? next.toUpperCase() : next);
            }}
            style={{ height: 44 }}
          />
        ) : (
          <TextInput
            key={id}
            testID={id}
            ref={uncontrolled}
            defaultValue="livre"
            placeholder="Digite aqui"
            {...inputEvents(id)}
            style={{ height: 44 }}
          />
        ),
      )}
      <Text testID="value-label">React: {value}</Text>
      <TextInput
        testID="fixed"
        ref={fixed}
        value="fixo"
        {...inputEvents("fixed")}
        style={{ height: 44 }}
      />
      <Button
        testID="keyboard-button"
        text="Enter / Espaço: ativação nativa"
        onActivate={() => {
          observations.presses++;
          setVersion((n) => n + 1);
        }}
        style={{ height: 44 }}
      />
      <Text>
        Retângulos menores que o mínimo do tema (clipping intencional):
      </Text>
      <View style={{ flexDirection: "row", gap: 14 }}>
        <Button
          ref={tiny}
          testID="tiny-button"
          text="Texto largo"
          fontSize={32}
          style={{ width: 20, height: tinySize }}
        />
        <TextInput
          ref={attachTinyInput}
          testID="tiny-input"
          defaultValue="Texto largo"
          fontSize={32}
          style={{ width: 30, height: tinySize }}
        />
        <Text testID="zero-text" style={{ width: 0, height: 0 }}>
          zero
        </Text>
        <Button
          testID="zero-button"
          text="zero"
          style={{ width: 0, height: 0 }}
        />
      </View>
      <Text>
        O Godot mantém seus widgets; React controla estado e reconciliação.
      </Text>
    </View>
  );
}
