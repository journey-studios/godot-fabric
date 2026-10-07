import React, { useCallback, useEffect, useState } from "react";
import { AppRegistry, FlatList, SectionList, StyleSheet, Text, View } from "react-native";

// RN's original FlatList and SectionList through the public react-native import,
// running on the SDK ScrollView: the mouse wheel scrolls them, they window their
// cells, and onScroll and onViewableItemsChanged report what the user sees.
const ROW = 44;
const ROWS = Array.from({ length: 200 }, (_, index) => ({ id: `row-${index}`, index }));
const SECTIONS = ["Fruit", "Vegetables", "Grains", "Dairy", "Herbs", "Nuts", "Seafood", "Spices"].map((key) => ({
  key, data: Array.from({ length: 6 }, (_, item) => `${key} ${item + 1}`),
}));
// RN does not support changing onViewableItemsChanged or viewabilityConfig on the fly,
// so both are created once.
const VIEWABILITY = { itemVisiblePercentThreshold: 50 };
const observations = { renders: 0, mountedRows: 0, feed: { offset: 0, viewable: [] }, agenda: { offset: 0, sections: [] } };
globalThis.VirtualizedListExample = { state: () => JSON.parse(JSON.stringify(observations)) };

function Row({ index }) {
  useEffect(() => {
    observations.mountedRows += 1;
    return () => { observations.mountedRows -= 1; };
  }, []);
  return (
    <View testID={`feed-row-${index}`} style={[styles.row, { backgroundColor: index % 2 ? "#1e293b" : "#172033" }]}>
      <Text style={styles.rowText}>{`Row ${index}`}</Text>
    </View>
  );
}

function VirtualizedListExample() {
  const [feed, setFeed] = useState({ offset: 0, viewable: [] });
  const [agenda, setAgenda] = useState({ offset: 0, sections: [] });
  observations.renders += 1;
  observations.feed = feed;
  observations.agenda = agenda;
  const feedViewable = useCallback(({ viewableItems }) => {
    setFeed((state) => ({ ...state, viewable: viewableItems.map((token) => token.index) }));
  }, []);
  const agendaViewable = useCallback(({ viewableItems }) => {
    setAgenda((state) => ({ ...state, sections: [...new Set(viewableItems.map((token) => token.section.key))] }));
  }, []);
  const range = feed.viewable.length ? `${feed.viewable[0]}–${feed.viewable[feed.viewable.length - 1]}` : "none yet";

  return (
    <View testID="lists-root" style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>GODOT FABRIC / VIRTUALIZED LISTS</Text>
        <Text style={styles.title}>Long lists, a window of cells.</Text>
        <Text style={styles.description}>
          RN's own FlatList and SectionList on the Godot ScrollView. Turn the mouse wheel over a list: cells outside the window unmount.
        </Text>
        <View style={styles.columns}>
          <View style={styles.column}>
            <Text style={styles.heading}>FlatList · 200 rows</Text>
            <FlatList
              testID="feed"
              style={styles.list}
              data={ROWS}
              keyExtractor={(item) => item.id}
              getItemLayout={(_, index) => ({ length: ROW, offset: ROW * index, index })}
              initialNumToRender={10}
              windowSize={5}
              viewabilityConfig={VIEWABILITY}
              onViewableItemsChanged={feedViewable}
              onScroll={(event) => {
                const offset = event.nativeEvent.contentOffset.y; // events are pooled: read before the updater runs
                setFeed((state) => ({ ...state, offset }));
              }}
              renderItem={({ item }) => <Row index={item.index} />}
            />
            <Text testID="feed-status" style={styles.status}>{`offset ${feed.offset} · rows ${range} in view`}</Text>
          </View>
          <View style={styles.column}>
            <Text style={styles.heading}>SectionList · 8 sections</Text>
            <SectionList
              testID="agenda"
              style={styles.list}
              sections={SECTIONS}
              keyExtractor={(item) => item}
              initialNumToRender={12}
              windowSize={5}
              viewabilityConfig={VIEWABILITY}
              onViewableItemsChanged={agendaViewable}
              onScroll={(event) => {
                const offset = event.nativeEvent.contentOffset.y;
                setAgenda((state) => ({ ...state, offset }));
              }}
              renderSectionHeader={({ section }) => (
                <View testID={`agenda-head-${section.key}`} style={styles.header}>
                  <Text style={styles.headerText}>{section.key}</Text>
                </View>
              )}
              renderItem={({ item }) => (
                <View testID={`agenda-item-${item.replace(" ", "-")}`} style={styles.item}>
                  <Text style={styles.itemText}>{item}</Text>
                </View>
              )}
            />
            <Text testID="agenda-status" style={styles.status}>
              {`offset ${agenda.offset} · ${agenda.sections.length ? agenda.sections.join(", ") : "none yet"} in view`}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}
AppRegistry.registerComponent("VirtualizedListExample", () => VirtualizedListExample);

const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#0b1120" },
  card: { width: "100%", padding: 24, gap: 14, backgroundColor: "#172033", borderWidth: 1, borderColor: "#334155", borderRadius: 20 },
  eyebrow: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  title: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 24, fontWeight: "700", lineHeight: 32 },
  description: { color: "#cbd5e1", fontFamily: "NotoSans", fontSize: 14, lineHeight: 21 },
  columns: { flexDirection: "row", gap: 16 },
  column: { flexGrow: 1, flexBasis: 0, gap: 8 },
  heading: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 15, fontWeight: "700", lineHeight: 22 },
  list: { height: 352, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 12 },
  row: { height: ROW, paddingHorizontal: 14, justifyContent: "center" },
  rowText: { color: "#e2e8f0", fontFamily: "NotoSans", fontSize: 14, lineHeight: 20 },
  header: { height: 30, paddingHorizontal: 14, justifyContent: "center", backgroundColor: "#7c3aed" },
  headerText: { color: "#ffffff", fontFamily: "NotoSans", fontSize: 13, fontWeight: "700", lineHeight: 18 },
  item: { height: 40, paddingHorizontal: 14, justifyContent: "center", backgroundColor: "#1e293b", borderBottomWidth: 1, borderBottomColor: "#0f172a" },
  itemText: { color: "#e2e8f0", fontFamily: "NotoSans", fontSize: 14, lineHeight: 20 },
  status: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 12, lineHeight: 18 },
});
