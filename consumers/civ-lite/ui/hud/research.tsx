import React from "react";
import { View } from "react-native";
import { send } from "../store";
import { FRONTIER_SET_RESEARCH } from "../frontier-types";
import type { FrontierSnapshot } from "../frontier-types";
import { Choice, COLORS, Heading, Line, Panel, Reason } from "./kit";

// The research panel: the technologies in the game's order, each with its state, its cost and, when the game refuses it, why.

export function Research({ snapshot }: { snapshot: FrontierSnapshot }) {
  const research = snapshot.research;
  const current = research.techs.find(tech => tech.id === research.current);
  return <Panel id="hud-research" style={{ width: 440 }}>
    <Heading id="hud-research-title">{`Research: ${current === undefined ? "none" : current.label}`}</Heading>
    <Line id="hud-research-progress" color={COLORS.resource}>
      {research.needed === 0 ? `${research.known} learned (+${research.rate})` : `${snapshot.resources.science.stock}/${research.needed} (+${research.rate}) · ${research.known} learned`}
    </Line>
    {research.techs.map(tech =>
      <View key={tech.id} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <Choice id={`hud-research-tech-${tech.id}`} label={`${tech.label} (${tech.cost}) · ${tech.state}`} enabled={tech.enabled === 1}
          onPress={() => { void send(FRONTIER_SET_RESEARCH, [tech.id]); }} />
        {tech.enabled === 1 ? null : <Reason id={`hud-research-tech-${tech.id}-reason`}>{tech.reason_text}</Reason>}
      </View>)}
  </Panel>;
}
