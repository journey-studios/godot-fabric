import React from "react";
import { Text, View } from "react-native";
import { newGame, useFrontier, useScreen } from "../store";
import { Actions } from "./actions";
import { Bar } from "./bar";
import { City } from "./city";
import { Dialog } from "./dialog";
import { Choice, COLORS } from "./kit";
import { Research } from "./research";
import { Tile } from "./tile";

// The HUD's context switch. Godot derives the context of the session (docs/research/frontier-game.md, `context.gd`); this file
// decides nothing but which panels that context mounts, and nothing else decides it: a panel never looks at whether the city or
// the dialog has data, because the snapshot carries a city once one exists, in every context. The turn and resources bar is in all
// of them.
//
//   none                bar
//   tile                bar, tile
//   settler, warrior    bar, actions, tile
//   stack               bar, actions (one select_unit per unit), tile
//   city                bar, city, research
//   dialog              bar, dialog
//
// The root and the column are `box-none`: they claim no pixel, so the map behind them is the World's. Each panel is a positioned
// box that claims its own.

type PanelName = "actions" | "tile" | "city" | "research" | "dialog";

function panelsOf(context: string): readonly PanelName[] {
  switch (context) {
    case "tile":
      return ["tile"];
    case "settler":
    case "warrior":
    case "stack":
      return ["actions", "tile"];
    case "city":
      return ["city", "research"];
    case "dialog":
      return ["dialog"];
    default:
      return [];
  }
}

function GameScreen() {
  const { snapshot, hover, answer } = useFrontier();
  if (snapshot === null) {
    return <View testID="hud-connecting" style={{ flex: 1, backgroundColor: COLORS.panel, padding: 16 }}>
      <Text style={{ color: COLORS.muted, fontSize: 16 }}>Connecting to the game</Text>
    </View>;
  }
  const panels = panelsOf(snapshot.context);
  return <View testID="hud-root" pointerEvents="box-none" style={{ flex: 1 }}>
    <View pointerEvents="box-none" style={{ position: "absolute", left: 616, top: 24, width: 440, gap: 8 }}>
      {panels.includes("actions") ? <Actions actions={snapshot.actions} /> : null}
      {panels.includes("city") ? <City snapshot={snapshot} /> : null}
      {panels.includes("research") ? <Research snapshot={snapshot} /> : null}
      {panels.includes("dialog") ? <Dialog dialog={snapshot.dialog} /> : null}
    </View>
    {panels.includes("tile") ? <Tile selected={snapshot.tile} hover={hover} /> : null}
    <Bar snapshot={snapshot} answer={answer} />
  </View>;
}

function MenuScreen() {
  return <View testID="menu-panel" style={{ flex: 1, backgroundColor: COLORS.panel, alignItems: "center", justifyContent: "center", gap: 16 }}>
    <Text testID="menu-title" style={{ color: COLORS.text, fontSize: 40, fontWeight: "700" }}>Frontier</Text>
    <Choice id="menu-new-game" label="New game" color={COLORS.warning} enabled onPress={newGame} />
  </View>;
}

/** The HUD: the game while the session is on, the menu after the scene dropped its World. The menu reads nothing from the game. */
export function Hud() {
  return useScreen() === "menu" ? <MenuScreen /> : <GameScreen />;
}
