import React from "react";
import { View } from "react-native";
import { send } from "../store";
import { FRONTIER_RESOLVE_EVENT } from "../frontier-types";
import type { Dialog as DialogCard } from "../frontier-types";
import { Choice, COLORS, Heading, Line, Panel } from "./kit";

// The event dialog: the game raised an event and refuses every intent but the answer to it. This slice shows it in its context as a
// positioned panel; it does not yet hold the screen as a Modal.

export function Dialog({ dialog }: { dialog: DialogCard }) {
  return <Panel id="hud-dialog" style={{ width: 440 }}>
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
