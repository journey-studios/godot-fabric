import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { AppRegistry, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

// The overlay pattern of docs/research/overlays-portals.md (option c), written the way an RN app writes it: Context plus a host View
// inside every root, installed with AppRegistry.setWrapperComponentProvider. No createPortal, and nothing in this file is Godot-specific.
//
//   PortalProvider  wraps the registered root. It keeps the portal entries in state and renders the root's content followed by one
//                   PortalHost: an absolutely positioned, full-size View with pointerEvents="box-none", the last child of the root's View.
//   Portal          registers its children with the provider through Context on mount, updates them when they change and removes
//                   them on unmount. It renders nothing where it stands.
//   PortalHost      draws the entries. Because it is the last, absolutely positioned child of the root, what it draws sits above everything
//                   in the root and outside every ScrollView or stacking context the Portal's own ancestors form. Because it is
//                   box-none, a press that finds none of the entries falls through it to the content below, or to the Godot world.
//
// The provider is per root: AppRegistry runs the wrapper provider for each root it runs, so every root has its own state and its own host.
//
// The host has a zIndex for two reasons. Among the positioned children of the root it sorts last, so it stays above a sibling that has a
// zIndex of its own. And a positioned View with a zIndex forms a stacking context in Fabric, so the portal's Controls are children of the
// host's own Control: without it Fabric hoists the host's children into the root's Control, still after everything and still unclipped, but
// no longer inside the host.
const HOST_Z_INDEX = 1000;
const PortalContext = createContext(null);
const PortalEntriesContext = createContext([]);

export function PortalProvider({ children }) {
  const [entries, setEntries] = useState([]);
  const hostRef = useRef(null);
  const api = useMemo(() => ({
    set(key, element) {
      setEntries((list) => (list.some((entry) => entry.key === key)
        ? list.map((entry) => (entry.key === key ? { key, element } : entry))
        : [...list, { key, element }]));
    },
    remove(key) {
      setEntries((list) => list.filter((entry) => entry.key !== key));
    },
    // The host's frame in the window: a portal positions its content in the host's coordinates, so it subtracts this origin from what
    // measureInWindow reports for its trigger (a surface that is not at the window's origin makes the two differ).
    measureHost(callback) {
      hostRef.current?.measureInWindow(callback);
    },
    hostRef,
  }), []);
  return (
    <PortalContext.Provider value={api}>
      <PortalEntriesContext.Provider value={entries}>
        {children}
        <PortalHost />
      </PortalEntriesContext.Provider>
    </PortalContext.Provider>
  );
}

function PortalHost() {
  const api = useContext(PortalContext);
  const entries = useContext(PortalEntriesContext);
  return (
    <View ref={api.hostRef} testID="portal-host" pointerEvents="box-none" style={styles.host}>
      {entries.map((entry) => <React.Fragment key={entry.key}>{entry.element}</React.Fragment>)}
    </View>
  );
}

export function Portal({ children }) {
  const api = useContext(PortalContext);
  const key = useId();
  useEffect(() => {
    api?.set(key, children);
  }, [api, key, children]);
  useEffect(() => () => api?.remove(key), [api, key]);
  return null;
}

export function usePortalHost() {
  return useContext(PortalContext);
}

// Installed before any root runs: every root of the app gets its own PortalProvider and so its own host.
AppRegistry.setWrapperComponentProvider(() => PortalProvider);

// ---- The scenario: a dropdown triggered inside a ScrollView ----

// Every size is fixed so that the layout is plain Yoga arithmetic (tests/portal-pattern-oracle.mjs derives the frames from these).
export const LAYOUT = {
  cardMargin: 16, cardPadding: 12, gap: 8, headerHeight: 28, scrollHeight: 180, statusHeight: 24,
  rowHeight: 44, rowPadding: 12, buttonWidth: 72, buttonHeight: 32, pickRow: 2, rows: 6,
  dropdownWidth: 160, dropdownHeader: 40, itemHeight: 40, dropdownGap: 4,
};
export const OPTIONS = ["Small", "Medium", "Large"];

// The accent the card provides to its subtree. A Portal's children render under the host, not under the card, so they read the default.
const AccentContext = createContext("none");
const ACCENT = "indigo";

// Observations for this repository's native harness. The application itself only needs React and public React Native components.
const observations = { roots: {} };
function observed(name) {
  if (observations.roots[name] === undefined) {
    observations.roots[name] = { renders: 0, rowPresses: [], picks: 0, choices: [], anchors: [], triggerAccent: null, portalAccent: null, portalCount: null };
  }
  return observations.roots[name];
}
globalThis.PortalPatternExample = {
  state: () => JSON.parse(JSON.stringify({ roots: observations.roots, layout: LAYOUT, accent: ACCENT, options: OPTIONS })),
};

function Dropdown({ left, top, selected, count, accent, onChoose, name }) {
  const contextAccent = useContext(AccentContext);
  observed(name).portalAccent = contextAccent;
  observed(name).portalCount = count;
  return (
    <View testID="dropdown" style={[styles.dropdown, { left, top }]}>
      <View testID="dropdown-header" style={styles.dropdownHeader}>
        <Text testID="dropdown-context" style={styles.dropdownText}>context: {contextAccent}</Text>
        <Text testID="dropdown-live" style={styles.dropdownText}>prop: {accent} · rows: {count}</Text>
      </View>
      {OPTIONS.map((option) => (
        <Pressable key={option} testID={`dropdown-item-${option}`} onPress={() => onChoose(option)}
          style={({ pressed }) => [styles.item, { opacity: pressed ? 0.7 : 1 }]}>
          <Text style={styles.itemText}>{option === selected ? `${option} (current)` : option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function PickRow({ index, name, chosen, count, accent, onChoose, onPress }) {
  const triggerRef = useRef(null);
  const host = usePortalHost();
  // Where the trigger lives the card's context is provided; the portal's content below reads it again, from under the host.
  observed(name).triggerAccent = useContext(AccentContext);
  const [anchor, setAnchor] = useState(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    observed(name).picks += 1;
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      host?.measureHost((hostX, hostY) => {
        // Under the trigger, its right edge on the dropdown's right edge, in the host's own coordinates.
        const next = { left: x + width - LAYOUT.dropdownWidth - hostX, top: y + height + LAYOUT.dropdownGap - hostY };
        observed(name).anchors.push({ trigger: [x, y, width, height], host: [hostX, hostY], ...next });
        setAnchor(next);
        setOpen(true);
      });
    });
  };

  return (
    <Pressable testID={`portal-row-${index}`} onPress={onPress} style={[styles.row, index % 2 === 0 ? styles.rowEven : styles.rowOdd]}>
      <Text testID={`portal-row-label-${index}`} style={styles.rowText}>{`Size: ${chosen}`}</Text>
      <Pressable ref={triggerRef} testID="portal-pick" onPress={toggle} style={styles.pick}>
        <Text style={styles.pickText}>Pick</Text>
      </Pressable>
      {open && anchor ? (
        <Portal>
          <Dropdown left={anchor.left} top={anchor.top} selected={chosen} count={count} accent={accent} name={name}
            onChoose={(option) => {
              observed(name).choices.push(option);
              onChoose(option);
              close();
            }} />
        </Portal>
      ) : null}
    </Pressable>
  );
}

function PortalPatternExample({ name = "main" }) {
  const [chosen, setChosen] = useState("Medium");
  const [rowCount, setRowCount] = useState(0);
  const record = observed(name);
  record.renders += 1;
  const pressRow = (index) => {
    record.rowPresses.push(index);
    setRowCount((value) => value + 1);
  };
  return (
    <AccentContext.Provider value={ACCENT}>
      <View testID="portal-card" style={styles.card}>
        <View testID="portal-header" style={styles.header}>
          <Text testID="portal-title" style={styles.title}>Portal pattern · {name}</Text>
        </View>
        <ScrollView testID="portal-scroll" style={styles.scroll}>
          {Array.from({ length: LAYOUT.rows }, (_, index) => (index === LAYOUT.pickRow
            ? <PickRow key={index} index={index} name={name} chosen={chosen} count={rowCount} accent={ACCENT} onChoose={setChosen}
              onPress={() => pressRow(index)} />
            : (
              <Pressable key={index} testID={`portal-row-${index}`} onPress={() => pressRow(index)}
                style={[styles.row, index % 2 === 0 ? styles.rowEven : styles.rowOdd]}>
                <Text testID={`portal-row-label-${index}`} style={styles.rowText}>{`Row ${index + 1}`}</Text>
              </Pressable>
            )))}
        </ScrollView>
        <View testID="portal-status-box" style={styles.status}>
          <Text testID="portal-status" style={styles.statusText}>{`chosen: ${chosen} · rows pressed: ${rowCount}`}</Text>
        </View>
      </View>
    </AccentContext.Provider>
  );
}

AppRegistry.registerComponent("PortalPatternExample", () => PortalPatternExample);

const COLORS = { card: "#172033", line: "#334155", even: "#1e293b", odd: "#243049", accent: "#5eead4", ink: "#f8fafc", mute: "#cbd5e1", blue: "#2563eb" };
const styles = StyleSheet.create({
  card: { margin: LAYOUT.cardMargin, padding: LAYOUT.cardPadding, gap: LAYOUT.gap, backgroundColor: COLORS.card, borderWidth: 0, borderRadius: 16 },
  header: { height: LAYOUT.headerHeight, justifyContent: "center" },
  title: { color: COLORS.ink, fontFamily: "NotoSans", fontSize: 16, fontWeight: "700", lineHeight: 22 },
  scroll: { height: LAYOUT.scrollHeight, backgroundColor: COLORS.even, borderRadius: 8 },
  row: { height: LAYOUT.rowHeight, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: LAYOUT.rowPadding },
  rowEven: { backgroundColor: COLORS.even },
  rowOdd: { backgroundColor: COLORS.odd },
  rowText: { color: COLORS.mute, fontFamily: "NotoSans", fontSize: 14, lineHeight: 20 },
  pick: { width: LAYOUT.buttonWidth, height: LAYOUT.buttonHeight, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.blue, borderRadius: 8 },
  pickText: { color: "#ffffff", fontFamily: "NotoSans", fontSize: 14, fontWeight: "700", lineHeight: 20 },
  status: { height: LAYOUT.statusHeight, justifyContent: "center" },
  statusText: { color: COLORS.accent, fontFamily: "NotoSans", fontSize: 12, lineHeight: 16 },
  host: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: HOST_Z_INDEX },
  dropdown: { position: "absolute", width: LAYOUT.dropdownWidth, backgroundColor: "#0f172a", borderWidth: 0, borderRadius: 8 },
  dropdownHeader: { height: LAYOUT.dropdownHeader, justifyContent: "center", paddingHorizontal: 10, backgroundColor: "#312e81", borderRadius: 8 },
  dropdownText: { color: COLORS.ink, fontFamily: "NotoSans", fontSize: 11, lineHeight: 16 },
  item: { height: LAYOUT.itemHeight, justifyContent: "center", paddingHorizontal: 10, backgroundColor: "#0f172a" },
  itemText: { color: COLORS.ink, fontFamily: "NotoSans", fontSize: 14, lineHeight: 20 },
});
