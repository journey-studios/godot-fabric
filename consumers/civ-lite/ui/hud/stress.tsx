import React from "react";
import { ScrollView, Text, View } from "react-native";
import type { Stress } from "../frontier-types";
import { COLORS, Heading, Panel } from "./kit";

// The stress panel of the comparison (docs/research/frontier-stress.md), shown in every context while the snapshot carries `stress`: a log of
// 200 lines and a production list of 100 items, each in a ScrollView, one Text for each row. A step of the mode appends a line, drops the
// oldest and changes one item, so a step touches one row of each list: the rows are keyed, and React moves nothing and mounts only the
// line that is new. A log line begins with its sequence number (the first five characters), which is its key; an item is keyed by its id.

const KEY_DIGITS = 5;
const keyOf = (line: string) => line.slice(0, KEY_DIGITS);
const rowStyle = { color: COLORS.muted, fontSize: 12 };

export function StressPanel({ stress }: { stress: Stress }) {
  return <Panel id="hud-stress" style={{ position: "absolute", left: 616, top: 176, width: 440, height: 332, flexDirection: "row", gap: 8 }}>
    <View style={{ flex: 1, gap: 4 }}>
      <Heading id="hud-stress-log-title">Log</Heading>
      <ScrollView testID="hud-stress-log" style={{ flex: 1 }}>
        {stress.log.map(line =>
          <Text key={keyOf(line)} testID={`hud-stress-log-${keyOf(line)}`} numberOfLines={1} style={rowStyle}>{line}</Text>)}
      </ScrollView>
    </View>
    <View style={{ flex: 1, gap: 4 }}>
      <Heading id="hud-stress-production-title">Production</Heading>
      <ScrollView testID="hud-stress-production" style={{ flex: 1 }}>
        {stress.production.map(item =>
          <Text key={item.id} testID={`hud-stress-production-${String(item.id).padStart(2, "0")}`} numberOfLines={1} style={rowStyle}>
            {`${item.label} ${item.progress}/${item.cost}`}
          </Text>)}
      </ScrollView>
    </View>
  </Panel>;
}
