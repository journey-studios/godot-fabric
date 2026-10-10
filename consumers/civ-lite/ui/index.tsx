import { AppRegistry } from "react-native";
import { Hud } from "./hud/hud";

// Frontier's HUD, context-driven: Godot derives the context of the session and publishes it with the rest of the snapshot, and the
// HUD mounts the panels that context calls for (hud/hud.tsx) over the map the World draws. Everything the HUD knows comes from the
// store (store.ts), which holds the only connections to the game and the only way to send an intent back; the panels hold no rule,
// no subscription and no listener. The screens are `game` and `menu`: going to the menu tells the scene (`frontier.open_menu`),
// which drops the World, and New game tells it to start a session (`frontier.new_game`), which brings the World back.
//
// The end of a turn is a job the game runs by itself: End turn is accepted at once and the snapshot shows the turn's progress,
// one phase after another, until it is at rest again with `last_job` set to the job. The bar shows the `phase` and a spinner
// while it runs; closing the HUD or going to the menu in the meantime does not stop it.

AppRegistry.registerComponent("FrontierHUD", () => Hud);
