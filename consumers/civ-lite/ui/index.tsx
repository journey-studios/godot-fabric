import React, { useEffect, useState } from "react";
import { AppRegistry, Pressable, Text, View } from "react-native";
import { GodotFabric } from "@godot-fabric/runtime";
import type { ServiceSubscription } from "@godot-fabric/runtime";
import { FRONTIER_NEW_GAME, FRONTIER_OPEN_MENU, FRONTIER_SNAPSHOT } from "./frontier-types";
import type { FrontierResult, FrontierSnapshot, Int } from "./frontier-types";

// Frontier's HUD, the smallest that serves the game: it connects to the snapshot, shows the turn, the context and the
// actions with their reasons, and sends an action back as the call it is. It holds no rule: every `enabled` and every
// `reason_text` comes from the game, and a refusal is shown, never decided here. The screens are `game` and `menu`, React
// state; going to the menu tells the scene (`frontier.open_menu`), which drops the World, and "New game" tells it to start
// a session (`frontier.new_game`), which brings the World back. The playable HUD is the V05-05 slice.

type Screen = "game" | "menu";

// The connections this HUD holds right now. A screen that connects must release what it connected when it goes away.
const active = new Set<ServiceSubscription<unknown>>();

// What the validation reads (`FrontierHud.stats()`); nothing in the HUD depends on it. It is bounded, because a HUD runs for as
// long as the game does and this one is the template that gets copied: the counters count for the life of the HUD, and each
// list keeps only the last KEPT entries. A reader that wants what is new takes the counter it saw before from the one it sees
// now, and that many entries from the end of the list.
const KEPT = 64;
type Result = { id: string; ok: Int; code: string };
type Seen = {
  snapshots: number; turn: number; context: string; screen: Screen; calls: number;
  epoch: Int; epochCount: number; epochs: Int[];
  resultCount: number; results: Result[];
  problemCount: number; problems: string[];
};
const seen: Seen = {
  snapshots: 0, turn: 0, context: "", screen: "game", calls: 0,
  epoch: -1, epochCount: 0, epochs: [], resultCount: 0, results: [], problemCount: 0, problems: [],
};

function remember<T>(kept: T[], entry: T) {
  kept.push(entry);
  if (kept.length > KEPT) {
    kept.shift();
  }
}

function track<T>(connection: ServiceSubscription<T>): ServiceSubscription<T> {
  active.add(connection);
  return connection;
}

function release(connection: ServiceSubscription<unknown>) {
  connection.remove();
  active.delete(connection);
}

function fail(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "ERROR";
  const message = error instanceof Error ? error.message : String(error);
  seen.problemCount += 1;
  remember(seen.problems, `${code}: ${message.split("\n")[0]}`);
}

/** Sends a method as the call it is: its registered name, `frontier.<id>`, and the arguments the snapshot's action carries. */
function dispatch(method: string, args: readonly Int[]): Promise<FrontierResult | null> {
  seen.calls += 1;
  return GodotFabric.call<FrontierResult>(method, args).then(result => {
    seen.resultCount += 1;
    remember(seen.results, { id: method, ok: result.value.ok, code: result.value.code });
    return result.value;
  }, error => {
    fail(error);
    return null;
  });
}

declare global {
  var FrontierHud: {
    /** What the validation reads; the HUD never reads it back. */
    stats(): Seen & { subscriptions: number };
    /** The HUD's own way to send an intent: the one its buttons use. */
    send(id: string, args: Int[]): void;
  };
}
globalThis.FrontierHud = {
  stats: () => ({ subscriptions: active.size, ...seen, epochs: [...seen.epochs], results: [...seen.results], problems: [...seen.problems] }),
  send: (id, args) => { void dispatch(`frontier.${id}`, args); },
};

// The HUD's one button: a Pressable around a label, grey and inert while the game says the action is not enabled. These are the
// components and props of the 0.5 scope (docs/compatibility/scope-0.5.json): View, Text and Pressable with testID, style,
// onPress and disabled.
function Choice({ id, label, color, enabled, onPress }: { id: string; label: string; color: string; enabled: boolean; onPress: () => void }) {
  return <Pressable testID={id} disabled={!enabled} onPress={onPress}
    style={{ backgroundColor: enabled ? color : "#334155", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 }}>
    <Text style={{ color: enabled ? "#f8fafc" : "#94a3b8", fontSize: 15 }}>{label}</Text>
  </Pressable>;
}

function GameScreen({ onMenu, onNewGame }: { onMenu: () => void; onNewGame: () => void }) {
  const [snapshot, setSnapshot] = useState<FrontierSnapshot | null>(null);
  const [answer, setAnswer] = useState("");
  useEffect(() => {
    const connection = track(GodotFabric.connect<FrontierSnapshot>(FRONTIER_SNAPSHOT, received => {
      const value = received.value;
      seen.snapshots += 1;
      seen.turn = value.turn;
      seen.context = value.context;
      if (seen.epoch !== value.epoch) {
        seen.epoch = value.epoch;
        seen.epochCount += 1;
        remember(seen.epochs, value.epoch);
      }
      setSnapshot(value);
    }));
    connection.ready.catch(fail);
    return () => release(connection);
  }, []);

  const send = (id: string, args: readonly Int[]) => {
    void dispatch(`frontier.${id}`, args).then(result => setAnswer(result === null || result.ok === 1 ? "" : result.text));
  };
  if (snapshot === null) {
    return <View testID="hud-connecting" style={{ flex: 1, backgroundColor: "#0f172a", padding: 16 }}>
      <Text style={{ color: "#94a3b8", fontSize: 16 }}>Connecting to the game</Text>
    </View>;
  }
  return <View style={{ flex: 1, flexDirection: "row" }}>
    <View style={{ width: 624 }} />
    <View testID="hud-panel" style={{ flex: 1, backgroundColor: "#0f172a", padding: 16, gap: 6 }}>
      <Text testID="hud-title" style={{ color: "#f8fafc", fontSize: 26, fontWeight: "700" }}>Frontier</Text>
      <Text testID="hud-turn" style={{ color: "#fbbf24", fontSize: 18 }}>{`Turn ${snapshot.turn} · epoch ${snapshot.epoch}`}</Text>
      <Text testID="hud-context" style={{ color: "#94a3b8", fontSize: 14 }}>{`Context: ${snapshot.context} · ${snapshot.phase}`}</Text>
      <Text testID="hud-resources" style={{ color: "#a7f3d0", fontSize: 14 }}>
        {`Food ${snapshot.resources.food.stock} · Production ${snapshot.resources.production.stock} · Science ${snapshot.resources.science.stock}`}
      </Text>
      {snapshot.actions.map(action => {
        const key = [action.id, ...action.args].join("-");
        return <View key={key} style={{ gap: 2 }}>
          <Choice id={`action-${key}`} label={action.label} color="#0369a1" enabled={action.enabled === 1}
            onPress={() => send(action.id, action.args)} />
          {action.enabled === 0 ? <Text style={{ color: "#fca5a5", fontSize: 12 }}>{action.reason_text}</Text> : null}
        </View>;
      })}
      <Text testID="hud-answer" style={{ color: "#fca5a5", fontSize: 14 }}>{answer}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Choice id="hud-menu" label="Menu" color="#475569" enabled onPress={onMenu} />
        <Choice id="hud-new-game" label="New game" color="#b45309" enabled onPress={onNewGame} />
      </View>
    </View>
  </View>;
}

function MenuScreen({ onNewGame }: { onNewGame: () => void }) {
  return <View testID="menu-panel" style={{ flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center", gap: 16 }}>
    <Text testID="menu-title" style={{ color: "#f8fafc", fontSize: 40, fontWeight: "700" }}>Frontier</Text>
    <Choice id="menu-new-game" label="New game" color="#b45309" enabled onPress={onNewGame} />
  </View>;
}

function Hud() {
  const [screen, setScreen] = useState<Screen>("game");
  useEffect(() => {
    seen.screen = screen;
  }, [screen]);
  const openMenu = () => {
    void dispatch(FRONTIER_OPEN_MENU, []).then(() => setScreen("menu"));
  };
  const newGame = () => {
    void dispatch(FRONTIER_NEW_GAME, []).then(() => setScreen("game"));
  };
  return screen === "menu" ? <MenuScreen onNewGame={newGame} /> : <GameScreen onMenu={openMenu} onNewGame={newGame} />;
}

AppRegistry.registerComponent("FrontierHUD", () => Hud);
