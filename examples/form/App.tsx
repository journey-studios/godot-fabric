import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, StyleSheet, Text, TextInput, View, type TextInputInstance, type TextInputProps } from "react-native";

const observations = { value: "Ada", saves: 0, mounts: 0, cleanups: 0, refAttaches: 0, refCleanups: 0,
  events: [] as Array<{ type: string; text?: string; key?: string }>, errors: [] as string[], focused: false, nativeRef: false, staleRefReleased: false, measurement: null as null | { width: number; height: number } };
let retainedInput: TextInputInstance | null = null;
let actions: Record<string, (...args: any[]) => void> = {};
export function formStats() { return { ...observations }; }
export function runForm(name: string, ...args: any[]) { actions[name](...args); }
class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { observations.errors.push(error.message); }
  render() { return this.state.failed ? <Text testID="form-error" style={styles.error}>Unsupported contract rejected.</Text> : this.props.children; }
}
export function FormApp() {
  const [value, setValue] = useState("Ada");
  const [saves, setSaves] = useState(0);
  const [locked, setLocked] = useState(false);
  const [changed, setChanged] = useState(false);
  const [probe, setProbe] = useState("");
  const [bare, setBare] = useState(false);
  const controlled = useRef<TextInputInstance | null>(null);
  const free = useRef<TextInputInstance | null>(null);
  const attach = useCallback((instance: TextInputInstance | null) => {
    controlled.current = instance; retainedInput = instance; observations.refAttaches++;
    return () => { controlled.current = null; observations.refCleanups++; };
  }, []);
  const record = (type: string, text?: string, key?: string) => observations.events.push({ type, text, key });
  actions = {
    focus: () => controlled.current?.focus(), blur: () => controlled.current?.blur(),
    focused: () => { observations.focused = controlled.current?.isFocused() ?? false; },
    nativeRef: () => { observations.nativeRef = controlled.current?.getNativeRef() === controlled.current; },
    measure: () => controlled.current?.measure((_x, _y, width, height) => { observations.measurement = { width, height }; }),
    staleRef: () => { retainedInput?.clear(); retainedInput?.setSelection(0, 0); observations.staleRefReleased = retainedInput?.getNativeRef() === null; },
    freeFocus: () => free.current?.focus(), freeClear: () => free.current?.clear(),
    select: () => controlled.current?.setSelection(0, value.length),
    invalidSelection: () => { try { controlled.current?.setSelection(-1, 2); } catch (error) { observations.errors.push((error as Error).message); } },
    removeStyle: () => setBare(v => !v),
    value: (next: string) => setValue(next), lock: () => setLocked(v => !v), styles: () => setChanged(v => !v), probe: setProbe,
  };
  useLayoutEffect(() => { observations.value = value; observations.saves = saves; }, [value, saves]);
  useEffect(() => { observations.mounts++; return () => { observations.cleanups++; }; }, []);
  const probeProps = probe === "multiline" ? { multiline: true } : probe === "keyboard" ? { keyboardType: "email-address" }
    : probe === "accessibility" ? { accessibilityLabel: "Name" } : probe === "weight" ? { style: { fontWeight: "bold" } } : {};
  return <View testID="form-root" style={styles.screen}>
    <Text style={styles.eyebrow}>GODOT FABRIC / PUBLIC CONTROLS</Text>
    <Text style={styles.title}>A native form, written in TSX.</Text>
    <Text style={styles.description}>Edit a name, save it, and exercise real Godot editing and keyboard focus.</Text>
    <Text style={styles.label}>Controlled name</Text>
    <TextInput testID="form-input" ref={attach} value={value} editable={!locked} submitBehavior="submit"
      onChangeText={setValue} onChange={e => record("change", e.nativeEvent.text)}
      onFocus={() => record("focus")} onBlur={() => record("blur")}
      onEndEditing={e => record("end", e.nativeEvent.text)} onSubmitEditing={e => record("submit", e.nativeEvent.text)}
      onKeyPress={e => record("key", undefined, e.nativeEvent.key)}
      onSelectionChange={e => record("selection", `${e.nativeEvent.selection.start}:${e.nativeEvent.selection.end}`)}
      style={bare ? { height: 44 } : changed ? styles.changedInput : styles.input} />
    <Text testID="form-value" style={styles.description}>React value: {value}</Text>
    <Button testID="form-save" title={`Save name · ${saves}`} disabled={locked || value.length === 0}
      color={changed ? "#0f766e" : "#2563eb"} onPress={() => setSaves(v => v + 1)} />
    <View style={styles.row}>
      <View style={styles.action}><Button testID="form-lock" title={locked ? "Unlock" : "Lock editing"} onPress={() => setLocked(v => !v)} /></View>
      <View style={styles.action}><Button testID="form-styles" title="Change styles" onPress={() => setChanged(v => !v)} /></View>
      <View style={styles.action}><Button testID="form-clear" title="Clear name" onPress={() => setValue("")} /></View>
    </View>
    <Text style={styles.label}>Uncontrolled note</Text>
    <TextInput testID="form-free" ref={free} autoFocus defaultValue="Native-owned text" placeholder="Write a note" style={styles.input} />
    {probe && <Boundary key={probe}>
      {probe === "button" ? <Button title="Invalid" {...({ onActivate: () => {} } as any)} />
        : <TextInput {...(probeProps as TextInputProps)} testID="form-probe" />}
    </Boundary>}
    <Text style={styles.caption}>Single-line subset · original React / Fabric · official Godot</Text>
  </View>;
}
const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 28, gap: 14, backgroundColor: "#0b1120" },
  eyebrow: { color: "#5eead4", fontSize: 12, fontFamily: "NotoSans", fontWeight: "700" },
  title: { color: "#f8fafc", fontSize: 28, fontFamily: "NotoSans", fontWeight: "700" },
  description: { color: "#cbd5e1", fontSize: 16, fontFamily: "NotoSans", lineHeight: 24 },
  label: { color: "#94a3b8", fontSize: 14, fontFamily: "NotoSans" },
  input: { height: 44, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#172033", borderWidth: 1, borderColor: "#475569", borderRadius: 8, fontSize: 18, color: "#ffffff" },
  changedInput: { height: 48, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#134e4a", borderWidth: 2, borderColor: "#5eead4", borderRadius: 12, fontSize: 20, color: "#fef08a" },
  row: { flexDirection: "row", gap: 12 }, action: { flex: 1 },
  caption: { color: "#94a3b8", fontSize: 12, fontFamily: "NotoSans" },
  error: { color: "#fda4af", fontSize: 14 },
});
