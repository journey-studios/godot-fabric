import React from "react";
import { ActivityIndicator, View } from "react-native";
import { newGame, openMenu, sendAction } from "../store";
import type { FrontierSnapshot, Stock } from "../frontier-types";
import { Choice, COLORS, Icon, Line, Panel, Reason } from "./kit";

// The turn and resources bar, present in every context: the turn, the phase the game is at, the three resources with their rate,
// End turn, and the way to the menu. End turn is the `end_turn` action of the snapshot, so it is enabled exactly when the game
// says so and a disabled one shows the game's reason; while the game processes the turn (`phase` is not `idle`) the spinner shows.

const signed = (rate: number) => (rate >= 0 ? `+${rate}` : `${rate}`);
const resource = (label: string, stock: Stock) => `${label} ${stock.stock} (${signed(stock.rate)})`;

/** A resource of the bar: its icon, then the text the game's numbers give. */
function Resource({ name, label, stock }: { name: "food" | "production" | "science"; label: string; stock: Stock }) {
  return <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
    <Icon id={`hud-bar-${name}-icon`} name={name} />
    <Line id={`hud-bar-${name}`} color={COLORS.resource}>{resource(label, stock)}</Line>
  </View>;
}

export function Bar({ snapshot, answer }: { snapshot: FrontierSnapshot; answer: string }) {
  const endTurn = snapshot.actions.find(action => action.id === "end_turn");
  const enabled = endTurn !== undefined && endTurn.enabled === 1;
  return <Panel id="hud-bar" style={{ position: "absolute", left: 24, bottom: 8, width: 1032, height: 76 }}>
    <View style={{ flexDirection: "row", gap: 18, alignItems: "center" }}>
      <Line id="hud-bar-turn" size={15} color={COLORS.accent}>{`Turn ${snapshot.turn} · epoch ${snapshot.epoch}`}</Line>
      <Line id="hud-bar-phase" color={COLORS.muted}>{snapshot.phase}</Line>
      <Resource name="food" label="Food" stock={snapshot.resources.food} />
      <Resource name="production" label="Production" stock={snapshot.resources.production} />
      <Resource name="science" label="Science" stock={snapshot.resources.science} />
      {answer === "" ? null : <Reason id="hud-bar-answer">{answer}</Reason>}
    </View>
    <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
      <Choice id="hud-bar-end-turn" label="End turn" enabled={enabled}
        onPress={() => { if (endTurn !== undefined) { void sendAction(endTurn); } }} />
      {snapshot.phase === "idle" ? null : <ActivityIndicator testID="hud-turn-spinner" size="small" color={COLORS.accent} />}
      {endTurn === undefined || enabled ? null : <Reason id="hud-bar-end-turn-reason">{endTurn.reason_text}</Reason>}
      <View style={{ flex: 1 }} />
      <Choice id="hud-bar-menu" label="Menu" color={COLORS.neutral} enabled onPress={openMenu} />
      <Choice id="hud-bar-new-game" label="New game" color={COLORS.warning} enabled onPress={newGame} />
    </View>
  </Panel>;
}
