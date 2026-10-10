import React from "react";
import { View } from "react-native";
import type { TileCard } from "../frontier-types";
import { unitIcon } from "./icons";
import { COLORS, Heading, Icon, Line, Panel } from "./kit";

// The tile card: the tile under the pointer while the pointer is over the map (Godot hears it and publishes `frontier.hover`),
// otherwise the selected tile of the snapshot. Both are the same card. The units on the tile show their icon beside the text, and a tile with
// the city shows the city's.

export function Tile({ selected, hover }: { selected: TileCard; hover: TileCard | null }) {
  const hovered = hover !== null && hover.present === 1;
  const card = hovered ? hover : selected;
  return <Panel id="hud-tile" style={{ position: "absolute", left: 24, top: 416, width: 576, height: 92 }}>
    <Heading id="hud-tile-title">
      {card.present === 1 ? `${hovered ? "Pointer" : "Selected"} · (${card.x}, ${card.y}) ${card.terrain_name}` : "No tile"}
    </Heading>
    {card.present === 1 ? <>
      <Line id="hud-tile-yields" color={COLORS.resource}>
        {`Food ${card.food} · Production ${card.production} · Science ${card.science} · Move ${card.move_cost}${card.city === 1 ? " · City" : ""}`}
      </Line>
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
        {card.city === 1 ? <Icon id="hud-tile-city-icon" name="city" /> : null}
        {card.units.map(unit => {
          const icon = unitIcon(unit.kind);
          return icon === null ? null : <Icon key={unit.id} id={`hud-tile-unit-${unit.id}-icon`} name={icon} />;
        })}
        <Line id="hud-tile-units" color={COLORS.muted}>
          {card.units.length === 0 ? "No units" : card.units.map(unit =>
            `${unit.name} (${unit.owner === 1 ? "yours" : "foreign"}) ${unit.moves}/${unit.max_moves}${unit.fortified === 1 ? " fortified" : ""}`).join(" · ")}
        </Line>
      </View>
    </> : null}
  </Panel>;
}
