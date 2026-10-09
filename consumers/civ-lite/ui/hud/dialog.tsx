import React from "react";
import { View } from "react-native";
import { send } from "../store";
import { FRONTIER_RESOLVE_EVENT } from "../frontier-types";
import type { Dialog as DialogCard } from "../frontier-types";
import { Choice, COLORS, Heading, Line, Panel } from "./kit";

// The event dialog: the game raised its events and refuses every intent but the answer to the head of the queue. It shows that one
// event, "n of m" as the game counts them, and its choices; answering sends `resolve_event` and the game's next snapshot has the next
// event as the head (hud.tsx keys the dialog by the event's id, so each event is a subtree of its own). It is shown in an overlay.

export function Dialog({ dialog }: { dialog: DialogCard }) {
  return <Panel id="hud-dialog" style={{ width: 440 }}>
    <Line id="hud-dialog-position" color={COLORS.muted} size={12}>{`${dialog.index} of ${dialog.count}`}</Line>
    <Heading id="hud-dialog-title">{dialog.title}</Heading>
    <Line id="hud-dialog-text">{dialog.text}</Line>
    {dialog.choices.map(choice =>
      <View key={choice.id} style={{ gap: 2, alignItems: "flex-start" }}>
        <Choice id={`hud-dialog-choice-${choice.id}`} label={choice.label} enabled
          onPress={() => { void send(FRONTIER_RESOLVE_EVENT, [choice.id]); }} />
        <Line id={`hud-dialog-choice-${choice.id}-detail`} color={COLORS.muted} size={12}>{choice.detail}</Line>
      </View>)}
  </Panel>;
}
