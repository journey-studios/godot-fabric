import React, {useEffect, useState} from "react";
import {AppRegistry, Pressable, Text, View} from "react-native";
import {GodotFabric} from "@godot-fabric/runtime";
import {callFrontier, FRONTIER_SNAPSHOT, FRONTIER_TURN_ENDED} from "../consumers/civ-lite/ui/frontier-types";
import {ACTION_BAR, GARRISON_CAP, PANEL_REGION, PANEL_SHAPE, PANEL_TOGGLE, PAUSE_TOGGLE, START_TILE} from "./frontier-soak-cases.mjs";

// The Frontier HUD of the 100-turn soak and the scripted player that plays the game through it (V05-06, criterion `soak`),
// driven by tests/frontier-soak-probe.gd. It consumes the game only through the public @godot-fabric/runtime and the types of
// the services slice (the snapshot it receives, the typed call it sends back), and keeps nothing that grows with the turns: the
// latest snapshot, a few counters and an outbox that the probe drains every turn. It holds no expectation; the probe and the
// independent oracle judge what it records.
//
// The player. A fixed rule over the snapshot (`decide`), with no Math.random, no Date and nothing the game does not show: what it
// chooses depends only on the snapshot it holds and on which steps of the turn it has already taken in this turn. It founds the
// city on the start tile, then, every turn: sets the research and the production if they are empty (the first enabled technology
// from the snapshot's list; a building if one is enabled, else a Warrior while fewer than GARRISON_CAP units stand on the city
// tile), selects the city, fortifies the first unfortified unit on its tile, selects an empty tile, clears the selection and ends
// the turn. An event that blocks the game is resolved with its first choice. Every call is one the snapshot offers as enabled, so
// the game accepts all of them. The probe plays one step at a time (`step`) and waits for the turn's job by itself.
//
// The HUD. A bar of the turn and the three stocks, a button for the heavy panel, a button that toggles a marker (the pause lane
// clicks it), one button for each action of the snapshot, and the event's dialog when there is one. The heavy panel is the
// baseline's research panel (100 native nodes). The strategy that closes it comes in as a prop: "unmount" renders it only while it
// is open; "hide" keeps it mounted and, closed, makes it invisible (opacity 0) and out of the pointer's way (pointerEvents "none").

const store = {snapshot: null, revision: 0, listeners: new Set(), waiters: []};
const counts = {snapshots: 0, turnEnded: 0, decisions: 0, stepsDone: 0};
const turnEndedLast = {turn: 0, job: 0};
const clicks = {panel: 0, pause: 0};
const ui = {strategy: "", panelOpen: false, pulse: false, mounts: 0, unmounts: 0};
let outbox = [];

const faults = {global: 0, rejections: 0, last: "", handlers: {errorUtils: false, rejectionTracker: false}, control: {rejections: 0}};

function describe(error) {
  return String(error?.message ?? error).split("\n")[0];
}

// What nobody handles. The host counts the errors it sees in its own `errors` (the probe reads them at every reading); these two are
// the JavaScript side's: a global error handler, where the runtime has one, and Hermes' tracker of promises rejected with no handler.
if (typeof globalThis.ErrorUtils === "object" && globalThis.ErrorUtils !== null && typeof globalThis.ErrorUtils.setGlobalHandler === "function") {
  globalThis.ErrorUtils.setGlobalHandler(error => {
    faults.global += 1;
    faults.last = describe(error);
  });
  faults.handlers.errorUtils = true;
}
if (typeof HermesInternal === "object" && HermesInternal !== null && typeof HermesInternal.enablePromiseRejectionTracker === "function") {
  HermesInternal.enablePromiseRejectionTracker({
    allRejections: true,
    onUnhandled: (_id, error) => {
      if (faults.control.armed === true) {
        faults.control.rejections += 1;
        return;
      }
      faults.rejections += 1;
      faults.last = describe(error);
    },
  });
  faults.handlers.rejectionTracker = true;
}

function publish(snapshot) {
  store.snapshot = snapshot;
  store.revision += 1;
  counts.snapshots += 1;
  for (const listener of store.listeners) {
    listener();
  }
  const waiting = store.waiters;
  store.waiters = [];
  for (const waiter of waiting) {
    if (store.revision > waiter.revision) {
      waiter.resolve();
    } else {
      store.waiters.push(waiter);
    }
  }
}

// The application's own connections, made when the bundle evaluates (before any root renders) and kept for the life of the
// application, like a store: one state and one signal.
GodotFabric.connect(FRONTIER_SNAPSHOT, received => publish(received.value));
GodotFabric.subscribe(FRONTIER_TURN_ENDED, summary => {
  counts.turnEnded += 1;
  turnEndedLast.turn = summary.turn;
  turnEndedLast.job = summary.job;
});

function afterSnapshot(revision) {
  if (store.revision > revision) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    store.waiters.push({revision, resolve});
  });
}

// ---------------------------------------------------------------------------------------------------- the player
const memory = {turn: -1, done: new Set()};

function act(id, args) {
  return {id, args};
}

// A step of the turn is taken once: the first time it is asked for in a turn it answers true.
function takes(name) {
  if (memory.done.has(name)) {
    return false;
  }
  memory.done.add(name);
  return true;
}

function decide(s) {
  if (memory.turn !== s.turn) {
    memory.turn = s.turn;
    memory.done.clear();
  }
  if (s.phase !== "idle") {
    return null;
  }
  if (s.dialog.open === 1) {
    return act("resolve_event", [s.dialog.choices[0].id]);
  }
  if (s.city.present === 0) {
    if (s.context === "settler") {
      const found = s.actions.find(action => action.id === "found_city" && action.enabled === 1);
      if (found !== undefined) {
        return act("found_city", found.args);
      }
    }
    if (s.context === "stack") {
      const settler = s.actions.find(action => action.id === "select_unit" && action.label === "Select Settler" && action.enabled === 1);
      if (settler !== undefined) {
        return act("select_unit", settler.args);
      }
    }
    return act("select_tile", [START_TILE.x, START_TILE.y]);
  }
  if (takes("research") && s.research.current === "") {
    const tech = s.research.techs.find(entry => entry.enabled === 1);
    if (tech !== undefined) {
      return act("set_research", [tech.id]);
    }
  }
  if (takes("production") && s.city.queue.length === 0) {
    const building = s.city.items.find(item => item.kind === "building" && item.enabled === 1);
    const warrior = s.city.garrison.length < GARRISON_CAP ? s.city.items.find(item => item.id === "warrior" && item.enabled === 1) : undefined;
    const item = building ?? warrior;
    if (item !== undefined) {
      return act("set_production", [item.id, 0]);
    }
  }
  if (takes("city")) {
    return act("select_tile", [s.city.x, s.city.y]);
  }
  if (takes("unit")) {
    const unit = s.tile.units.find(entry => entry.owner === 1 && entry.fortified === 0);
    if (unit !== undefined) {
      return act("select_unit", [unit.id]);
    }
  }
  if (takes("fortify")) {
    const fortify = s.actions.find(action => action.id === "fortify" && action.enabled === 1);
    if (fortify !== undefined) {
      return act("fortify", fortify.args);
    }
  }
  if (takes("tile")) {
    return act("select_tile", [s.city.x - 1, s.city.y]);
  }
  if (takes("clear")) {
    return act("clear_selection", []);
  }
  return act("end_turn", []);
}

// ------------------------------------------------------------------------------------------------------ the probe
globalThis.FrontierSoakProbe = {
  // Plays one step of the player on the latest snapshot and returns what it chose. The call settles in the background: `stepsDone` rises
  // when its answer is in and, if the game accepted it, the snapshot it published has arrived.
  step() {
    const snapshot = store.snapshot;
    const decision = snapshot === null ? null : decide(snapshot);
    if (decision === null) {
      return {n: 0, id: "", args: []};
    }
    counts.decisions += 1;
    const entry = {n: counts.decisions, turn: snapshot.turn, context: snapshot.context, id: decision.id, args: decision.args, state: "pending", ok: -1,
      code: "", job: 0};
    outbox.push(entry);
    const seen = store.revision;
    callFrontier("frontier." + decision.id, decision.args).then(result => {
      entry.ok = result.value.ok;
      entry.code = result.value.code;
      entry.job = result.value.job;
      return result.value.ok === 1 ? afterSnapshot(seen) : undefined;
    }).then(() => {
      entry.state = "done";
      counts.stepsDone += 1;
    }, error => {
      entry.state = "rejected";
      entry.code = describe(error);
      counts.stepsDone += 1;
    });
    return {n: entry.n, id: entry.id, args: entry.args};
  },
  // The decisions made since the last drain, with their answers; the outbox is emptied so that nothing grows with the turns.
  drain() {
    const taken = outbox;
    outbox = [];
    return taken;
  },
  counts() {
    return {...counts, turnEndedLast: {...turnEndedLast}, clicks: {...clicks}, faults: {global: faults.global, rejections: faults.rejections, last: faults.last,
      handlers: {...faults.handlers}}};
  },
  // The latest snapshot, as far as the probe and the oracle need it.
  latest() {
    const s = store.snapshot;
    if (s === null) {
      return null;
    }
    return {revision: store.revision, turn: s.turn, phase: s.phase, context: s.context, lastJob: s.last_job, epoch: s.epoch, actions: s.actions.length,
      dialog: s.dialog.open, choices: s.dialog.choices.length, city: s.city.present, garrison: s.city.garrison.length, queue: s.city.queue.length,
      known: s.research.known};
  },
  // What React did to the HUD: the state of the panel and of the marker, and how many times the HUD mounted.
  ui() {
    return {...ui, clicks: {...clicks}};
  },
  // A rejection nobody handles, on purpose and once the soak is over: the tracker must see it (so that "0 unhandled" can be told from "cannot see").
  // The tracker reports a rejection from a timer and not at the rejection (a control that waited six frames saw nothing). The delays are those of the
  // `promise` library's rejection tracking, which Hermes' Promise is modelled on and which was not checked against Hermes' source here: 2000 ms for an
  // Error, 100 ms for a TypeError or a ReferenceError. So the control is a TypeError and the soak waits longer than 2000 ms before it reads the count
  // of the rejections it did not make.
  control() {
    faults.control.armed = true;
    Promise.reject(new TypeError("frontier-soak control: an unhandled rejection"));
    return true;
  },
  controlSeen() {
    return {rejections: faults.control.rejections, handlers: {...faults.handlers}};
  },
  // What the runtime says it is, for the report's provenance (the shared sampler reads it).
  engine() {
    const properties = typeof HermesInternal === "object" && HermesInternal !== null && typeof HermesInternal.getRuntimeProperties === "function"
      ? HermesInternal.getRuntimeProperties() : null;
    return {properties, hasHermesInternal: properties !== null};
  },
};

// ----------------------------------------------------------------------------------------------------- the HUD
function useSnapshot() {
  const [snapshot, setSnapshot] = useState(store.snapshot);
  useEffect(() => {
    const listener = () => setSnapshot(store.snapshot);
    store.listeners.add(listener);
    listener();
    return () => {
      store.listeners.delete(listener);
    };
  }, []);
  return snapshot;
}

function Chip({index, last}) {
  return (
    <View style={{width: 100, height: 24, justifyContent: "center", paddingHorizontal: 6, backgroundColor: "#6a3f9a"}}>
      <Text testID={last ? "soak-panel-last" : undefined} style={{color: "#ffffff", fontSize: 12}}>{`Tech ${index + 1}`}</Text>
    </View>
  );
}

// The heavy panel: a root, a header and the chips (100 native nodes). The body does not depend on whether the panel is shown, so it is
// memoized: a panel that is hidden and shown again changes the root's two props and re-renders nothing below it (the strategy that keeps
// the panel mounted is only worth its nodes if closing it is that cheap). Hidden, the root is invisible and out of the pointer's way.
const PanelBody = React.memo(function PanelBody() {
  return (
    <>
      <Text testID="soak-panel-header" style={{width: "100%", color: "#ffffff", fontSize: 16}}>Research</Text>
      {Array.from({length: PANEL_SHAPE.chips}, (_, index) => <Chip key={index} index={index} last={index === PANEL_SHAPE.chips - 1} />)}
    </>
  );
});

function Panel({hidden}) {
  return (
    <View testID="soak-panel" pointerEvents={hidden ? "none" : "auto"}
      style={{opacity: hidden ? 0 : 1, width: PANEL_REGION.width, flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", padding: 8, gap: 6,
        backgroundColor: "rgba(44, 28, 64, 0.92)"}}>
      <PanelBody />
    </View>
  );
}

function Button({testID, label, left, top, width, height, onPress}) {
  return (
    <Pressable testID={testID} onPress={onPress}
      style={{position: "absolute", left, top, width, height, justifyContent: "center", alignItems: "center", backgroundColor: "#445577"}}>
      <Text style={{color: "#ffffff", fontSize: 13}}>{label}</Text>
    </Pressable>
  );
}

function SoakHud({strategy}) {
  const snapshot = useSnapshot();
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    ui.mounts += 1;
    ui.strategy = strategy;
    return () => {
      ui.unmounts += 1;
    };
  }, [strategy]);
  useEffect(() => {
    ui.panelOpen = open;
  }, [open]);
  useEffect(() => {
    ui.pulse = pulse;
  }, [pulse]);
  const actions = snapshot === null ? [] : snapshot.actions;
  const dialog = snapshot === null ? null : snapshot.dialog;
  const stock = key => (snapshot === null ? 0 : snapshot.resources[key].stock);
  return (
    <View testID="soak-root" pointerEvents="box-none" style={{flex: 1}}>
      <View testID="soak-top" pointerEvents="box-none"
        style={{position: "absolute", left: 0, top: 0, width: 800, height: 28, flexDirection: "row", gap: 16, paddingHorizontal: 12, alignItems: "center", backgroundColor: "#223344"}}>
        <Text style={{color: "#ffffff", fontSize: 13}}>{`Turn ${snapshot === null ? 0 : snapshot.turn}`}</Text>
        <Text style={{color: "#ffffff", fontSize: 13}}>{`Food ${stock("food")}`}</Text>
        <Text style={{color: "#ffffff", fontSize: 13}}>{`Production ${stock("production")}`}</Text>
        <Text style={{color: "#ffffff", fontSize: 13}}>{`Science ${stock("science")}`}</Text>
      </View>
      <View testID="soak-controls" pointerEvents="box-none" style={{position: "absolute", left: 0, top: 0, width: 800, height: 68}}>
        <Button testID="soak-panel-toggle" label={open ? "Close panel" : "Open panel"} {...PANEL_TOGGLE}
          onPress={() => {
            clicks.panel += 1;
            setOpen(value => !value);
          }} />
        <Button testID="soak-pause-toggle" label="Marker" {...PAUSE_TOGGLE}
          onPress={() => {
            clicks.pause += 1;
            setPulse(value => !value);
          }} />
        {pulse ? <View testID="soak-pause-marker" style={{position: "absolute", left: 300, top: 40, width: 12, height: 12, backgroundColor: "#ffdd33"}} /> : null}
      </View>
      <View testID="soak-region" pointerEvents="box-none" style={{position: "absolute", left: PANEL_REGION.left, top: PANEL_REGION.top, width: PANEL_REGION.width, height: 480}}>
        {strategy === "hide" ? <Panel hidden={!open} /> : open ? <Panel hidden={false} /> : null}
      </View>
      <View testID="soak-actions" pointerEvents="box-none" style={{position: "absolute", left: 0, top: 0, width: 800, height: 600}}>
        {actions.map((action, index) => (
          <Button key={action.id + ":" + action.args.join(",")} testID={"action-" + action.id} label={action.label}
            left={ACTION_BAR.left + ACTION_BAR.step * index} top={ACTION_BAR.top} width={ACTION_BAR.width} height={ACTION_BAR.height}
            onPress={() => {
              callFrontier("frontier." + action.id, action.args).catch(error => {
                faults.last = describe(error);
              });
            }} />
        ))}
      </View>
      {dialog !== null && dialog.open === 1 ? (
        <View testID="soak-dialog" style={{position: "absolute", left: 300, top: 180, width: 400, backgroundColor: "#33261a", padding: 12, gap: 8}}>
          <Text style={{color: "#ffffff", fontSize: 16}}>{dialog.title}</Text>
          <Text style={{color: "#dddddd", fontSize: 13}}>{dialog.text}</Text>
          {dialog.choices.map(choice => (
            <Pressable key={choice.id} testID={"choice-" + choice.id}
              onPress={() => {
                callFrontier("frontier.resolve_event", [choice.id]).catch(error => {
                  faults.last = describe(error);
                });
              }}
              style={{backgroundColor: "#8a5d2f", padding: 6}}>
              <Text style={{color: "#ffffff", fontSize: 13}}>{choice.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

AppRegistry.registerComponent("FrontierSoakHud", () => SoakHud);
