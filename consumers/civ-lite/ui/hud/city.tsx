import React from "react";
import { View } from "react-native";
import { send } from "../store";
import { FRONTIER_SET_PRODUCTION } from "../frontier-types";
import type { CityScreen, FrontierSnapshot } from "../frontier-types";
import { Choice, COLORS, Heading, Line, Panel, Reason } from "./kit";

// The city screen: what the city is, what it builds and what it can be told to build. Each item carries the game's own `enabled` and
// `reason_text`; pressing one puts it in the slot the snapshot's items were checked for, the first free one or the last.

const slotFor = (city: CityScreen) => Math.min(city.queue.length, city.queue_max - 1);

export function City({ snapshot }: { snapshot: FrontierSnapshot }) {
  const city = snapshot.city;
  const food = snapshot.resources.food.stock;
  return <Panel id="hud-city" style={{ width: 440 }}>
    <Heading id="hud-city-title">{city.present === 1 ? `${city.name} · size ${city.size}/${city.max_size}` : "No city yet"}</Heading>
    <Line id="hud-city-rates" color={COLORS.resource}>
      {`Food ${food}/${city.food_needed} (+${city.food_rate}) · Production +${city.production_rate} · Science +${city.science_rate}`}
    </Line>
    <Line id="hud-city-queue-title" color={COLORS.muted}>{`Queue ${city.queue.length}/${city.queue_max}`}</Line>
    {city.queue.map(entry =>
      <Line key={entry.slot} id={`hud-city-queue-${entry.slot}`}>{`${entry.slot + 1}. ${entry.label} ${entry.stock}/${entry.cost}`}</Line>)}
    {city.items.map(item =>
      <View key={item.id} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <Choice id={`hud-city-item-${item.id}`} label={`${item.label} (${item.cost})`} enabled={item.enabled === 1}
          onPress={() => { void send(FRONTIER_SET_PRODUCTION, [item.id, slotFor(city)]); }} />
        {item.enabled === 1 ? null : <Reason id={`hud-city-item-${item.id}-reason`}>{item.reason_text}</Reason>}
      </View>)}
    <Line id="hud-city-buildings" color={COLORS.muted}>{`Buildings: ${city.buildings.length === 0 ? "none" : city.buildings.join(", ")}`}</Line>
    <Line id="hud-city-garrison" color={COLORS.muted}>
      {`Garrison: ${city.garrison.length === 0 ? "none" : city.garrison.map(unit => `${unit.kind} #${unit.id}`).join(", ")}`}
    </Line>
  </Panel>;
}
