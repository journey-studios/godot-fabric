import React from "react";
import { Text, View } from "react-native";
import { newGame, send, useFrontier, useScreen } from "../store";
import { FRONTIER_CLEAR_SELECTION } from "../frontier-types";
import { Actions } from "./actions";
import { Bar } from "./bar";
import { City } from "./city";
import { Dialog } from "./dialog";
import { Choice, COLORS } from "./kit";
import { Overlay } from "./overlay";
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
// The city screen with the research list, and the event dialog, are overlays: blocking Modals (overlay.tsx), so under them nothing hears
// the pointer. The bar, the actions and the tile card stay in the tree, as positioned boxes that claim their own pixels, and the root is
// `box-none`: it claims none, so the map behind is the World's. The overlay's content is gated by the context like any panel, and the
// dialog is keyed by the event's id: each event of the queue is a fresh subtree, and nothing of one leaks into the next.

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

// Escape on the city screen closes it, as the game's own `clear_selection` does; Escape on the dialog does nothing, because the event has
// to be answered.
const closeSelection = () => { void send(FRONTIER_CLEAR_SELECTION, []); };
const mustAnswer = () => {};

function GameScreen() {
  const { snapshot, hover, answer } = useFrontier();
  if (snapshot === null) {
    return <View testID="hud-connecting" style={{ flex: 1, backgroundColor: COLORS.panel, padding: 16 }}>
      <Text style={{ color: COLORS.muted, fontSize: 16 }}>Connecting to the game</Text>
    </View>;
  }
  const panels = panelsOf(snapshot.context);
  return <View testID="hud-root" pointerEvents="box-none" style={{ flex: 1 }}>
    {panels.includes("actions") ? <Actions actions={snapshot.actions} /> : null}
    {panels.includes("tile") ? <Tile selected={snapshot.tile} hover={hover} /> : null}
    <Bar snapshot={snapshot} answer={answer} />
    {panels.includes("city") || panels.includes("research") ? <Overlay id="hud-city-overlay" onRequestClose={closeSelection}>
      <View pointerEvents="box-none" style={{ position: "absolute", left: 616, top: 24, width: 440, gap: 8 }}>
        {panels.includes("city") ? <City snapshot={snapshot} /> : null}
        {panels.includes("research") ? <Research snapshot={snapshot} /> : null}
      </View>
    </Overlay> : null}
    {panels.includes("dialog") ? <Overlay id="hud-dialog-overlay" onRequestClose={mustAnswer} centered>
      <Dialog key={snapshot.dialog.id} dialog={snapshot.dialog} />
    </Overlay> : null}
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
