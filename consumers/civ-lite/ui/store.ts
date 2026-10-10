import { useSyncExternalStore } from "react";
import { GodotFabric } from "@godot-fabric/runtime";
import type { ServiceCallResult, ServiceSubscription } from "@godot-fabric/runtime";
import {
  callFrontier, FRONTIER_CLEAR_SELECTION, FRONTIER_END_TURN, FRONTIER_FORTIFY, FRONTIER_FOUND_CITY, FRONTIER_HOVER,
  FRONTIER_IRRIGATE, FRONTIER_NEW_GAME, FRONTIER_OPEN_MENU, FRONTIER_SELECT_UNIT, FRONTIER_SNAPSHOT,
} from "./frontier-types";
import type { Action, FrontierCall, FrontierResult, FrontierSnapshot, TileCard } from "./frontier-types";
import { installFrontierHud, observe } from "./telemetry";

// The HUD's one store, at module scope. It is the only module that talks to the game: it holds the connections to the two states
// Godot publishes (`frontier.snapshot` and `frontier.hover`), turns what arrives into the view the screens render, and sends the
// intents back as the calls they are. The panels read the view through `useFrontier()` and send through `send` and `sendAction`;
// none of them subscribes, calls a service or registers a listener of its own, and the HUD holds no rule: every `enabled` and every
// `reason_text` comes from the game, a refusal is shown and never decided here.
//
// The connections follow the readers. The first screen that reads the view (React's `useSyncExternalStore` subscribes it) connects,
// the last one that stops reading releases both, and the view goes back to "not connected": the menu reads nothing, so it holds no
// connection, and New game connects again. A new epoch is just the next snapshot on the same connection.
//
// The menu is not part of the game's snapshot, so the screen is a store of its own that never connects to anything.
//
// What the validation reads (`FrontierHud`, in telemetry.ts) is not the store's: the store only tells `observe` what it received and sent.

type Screen = "game" | "menu";

/** What the screens render: the last snapshot (null until it arrives), the tile under the pointer, and the last refusal's text. */
type FrontierView = {
  readonly snapshot: FrontierSnapshot | null;
  readonly hover: TileCard | null;
  readonly answer: string;
};

const NOT_CONNECTED: FrontierView = { snapshot: null, hover: null, answer: "" };
let view: FrontierView = NOT_CONNECTED;
const readers = new Set<() => void>();
const connections = new Set<ServiceSubscription<unknown>>();

function show(next: FrontierView) {
  view = next;
  for (const reader of readers) {
    reader();
  }
}

function receiveSnapshot(value: FrontierSnapshot) {
  observe.snapshot(value);
  show({ ...view, snapshot: value });
}

function receiveHover(value: TileCard) {
  observe.hover(value);
  show({ ...view, hover: value });
}

function hold<T>(connection: ServiceSubscription<T>): ServiceSubscription<T> {
  connection.ready.catch(observe.problem);
  connections.add(connection);
  return connection;
}

function connect() {
  hold(GodotFabric.connect<FrontierSnapshot>(FRONTIER_SNAPSHOT, received => receiveSnapshot(received.value)));
  hold(GodotFabric.connect<TileCard>(FRONTIER_HOVER, received => receiveHover(received.value)));
}

function disconnect() {
  for (const connection of connections) {
    connection.remove();
  }
  connections.clear();
  view = NOT_CONNECTED;
}

function subscribe(reader: () => void) {
  readers.add(reader);
  if (readers.size === 1) {
    connect();
  }
  return () => {
    readers.delete(reader);
    if (readers.size === 0) {
      disconnect();
    }
  };
}

function read(): FrontierView {
  return view;
}

/** The game as the screens render it. Reading it connects to the game; the last reader to go releases the connections. */
export function useFrontier(): FrontierView {
  return useSyncExternalStore(subscribe, read);
}

// --- The screen ----------------------------------------------------------------------------------------------------

let screen: Screen = "game";
const watchers = new Set<() => void>();

function setScreen(next: Screen) {
  screen = next;
  observe.screen(next);
  for (const watcher of watchers) {
    watcher();
  }
}

function watch(watcher: () => void) {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
}

/** Which screen shows: reading it connects to nothing. */
export function useScreen(): Screen {
  return useSyncExternalStore(watch, () => screen);
}

// --- Intents -------------------------------------------------------------------------------------------------------

// Every call goes through here: it tells the telemetry, and shows a refusal. A rejected call (the transport's error) is a problem the
// validation counts, and answers null.
function record(method: string, call: Promise<ServiceCallResult<FrontierResult>>): Promise<FrontierResult | null> {
  observe.call();
  return call.then(result => {
    const reply = result.value;
    observe.result(method, reply);
    if (readers.size > 0) {
      show({ ...view, answer: reply.ok === 1 ? "" : reply.text });
    }
    return reply;
  }, error => {
    observe.problem(error);
    return null;
  });
}

/** Sends an intent as the typed call it is: the method's name and the arguments it declares, or it does not compile. */
export function send(...call: FrontierCall): Promise<FrontierResult | null> {
  return record(call[0], callFrontier(...call));
}

/**
 * Sends an action of the snapshot back. The action carries its own arguments and the game decided it was offered, so the HUD
 * only maps the id to the typed call; an id it does not know is a problem the validation counts, never a guess.
 */
export function sendAction(action: Action): Promise<FrontierResult | null> {
  const [unit] = action.args;
  switch (action.id) {
    case "select_unit":
      return send(FRONTIER_SELECT_UNIT, [unit]);
    case "found_city":
      return send(FRONTIER_FOUND_CITY, [unit]);
    case "irrigate":
      return send(FRONTIER_IRRIGATE, [unit]);
    case "fortify":
      return send(FRONTIER_FORTIFY, [unit]);
    case "clear_selection":
      return send(FRONTIER_CLEAR_SELECTION, []);
    case "end_turn":
      return send(FRONTIER_END_TURN, []);
    default:
      observe.problem(new Error(`The HUD does not know the action ${action.id}`));
      return Promise.resolve(null);
  }
}

/** Goes to the menu once the scene has dropped its World. A refused call leaves the HUD where it was. */
export function openMenu() {
  void send(FRONTIER_OPEN_MENU, []).then(reply => {
    if (reply !== null && reply.ok === 1) {
      setScreen("menu");
    }
  });
}

/** Starts a new session, which brings the World back, and shows the game. */
export function newGame() {
  void send(FRONTIER_NEW_GAME, []).then(reply => {
    if (reply !== null && reply.ok === 1) {
      setScreen("game");
    }
  });
}

installFrontierHud({
  subscriptions: () => connections.size,
  send: (id, args) => { void record(`frontier.${id}`, GodotFabric.call<FrontierResult>(`frontier.${id}`, args)); },
});
