import React, {useEffect} from "react";
import {AppRegistry, View} from "react-native";
import {GodotFabric} from "@godot-fabric/runtime";
import {callFrontier, FRONTIER_SNAPSHOT, FRONTIER_TURN_ENDED} from "../consumers/civ-lite/ui/frontier-types";

// The stand-in for Frontier's HUD, driven by tests/frontier-services-probe.gd. It consumes the services through the
// public @godot-fabric/runtime and the slice's own types, and records everything it observes in order, so the probe and
// the independent oracle judge the observations and not this file's opinion.
//
// Two kinds of connection. The application's own are made when the bundle evaluates, before any root renders: that is
// the proof that the services were registered before the mount (a late registration would answer E_SERVICE_MISSING
// here), and they stay for the life of the application, like a store. The panel's are the root's: it connects when
// it mounts and removes the connection when it unmounts, so a remount reconnects and receives the current snapshot.
//
// The end of a turn is a job (docs/research/frontier-services.md): `frontier.end_turn` answers on acceptance, and the
// application's own `turn_ended` subscription, which does not go away with the root, is where a job is seen to finish. The
// calls a HUD makes while a job runs are kept in `attempts`, apart from `results`, so that the step that is being played
// still has its own answer as the last result. `extras` are further module-scope subscribers of the snapshot, the stress of
// the registry's budgets: each keeps what it received and the order the registry delivered it in (`arrivals`).

let sequence = 0;
const snapshots = [];
const turnEnded = [];
const results = [];
const attempts = [];
const extras = [];
const arrivals = [];
const panelSnapshots = [];
const panel = {mounts: 0, cleanups: 0, connected: false, readyCount: 0, error: null};
const application = {snapshotReady: 0, signalReady: 0, errors: []};
let steps = [];

function failure(error) {
  return {code: error?.code ?? null, message: String(error?.message ?? error).split("\n")[0]};
}

// The application's connections: one state and one signal. Both are installed now, while the bundle evaluates.
const snapshotConnection = GodotFabric.connect(FRONTIER_SNAPSHOT, snapshot => snapshots.push({
  seq: ++sequence, revision: snapshot.revision, generation: snapshot.generation, value: snapshot.value}));
snapshotConnection.ready.then(() => { application.snapshotReady += 1; }, error => application.errors.push({connection: "snapshot", ...failure(error)}));
const signalConnection = GodotFabric.subscribe(FRONTIER_TURN_ENDED, summary => turnEnded.push({seq: ++sequence, value: summary}));
signalConnection.ready.then(() => { application.signalReady += 1; }, error => application.errors.push({connection: "turn_ended", ...failure(error)}));

// One call, recorded whatever happens. The id orders the calls; `settled` orders the settlement against the events.
function record(label, method, args, run) {
  const entry = {id: results.length + 1, label, method, args, state: "pending", response: null, generation: null, value: null,
    error: null, settled: null};
  results.push(entry);
  run().then(result => {
    Object.assign(entry, {state: "resolved", response: result.response, generation: result.generation, value: result.value, settled: ++sequence});
  }, error => {
    Object.assign(entry, {state: "rejected", error: failure(error), settled: ++sequence});
  });
}

// A call made while a job runs, recorded apart from `results`.
function attempt(label, method, args) {
  const entry = {id: attempts.length + 1, label, method, args, state: "pending", response: null, value: null, error: null};
  attempts.push(entry);
  callFrontier(method, args).then(result => {
    Object.assign(entry, {state: "resolved", response: result.response, value: result.value});
  }, error => {
    Object.assign(entry, {state: "rejected", error: failure(error)});
  });
}

function FrontierServicesProbe(props) {
  steps = props.steps;
  useEffect(() => {
    panel.mounts += 1;
    // This connection belongs to the root: it receives the current snapshot as its first value, and the cleanup removes it.
    const connection = GodotFabric.connect(FRONTIER_SNAPSHOT, snapshot => panelSnapshots.push({
      seq: ++sequence, mount: panel.mounts, revision: snapshot.revision, generation: snapshot.generation, value: snapshot.value}));
    panel.connected = true;
    connection.ready.then(() => { panel.readyCount += 1; }, error => { panel.error = failure(error); });
    return () => {
      connection.remove();
      panel.connected = false;
      panel.cleanups += 1;
    };
  }, []);
  return <View testID="frontier-services-probe" style={{width: 120, height: 40, backgroundColor: "#7c2d12"}} />;
}
AppRegistry.registerComponent("FrontierServicesProbe", () => FrontierServicesProbe);

globalThis.FrontierServicesProbe = {
  // One step of the roteiro the probe passed as a prop, through the typed helper of the slice.
  step(index) {
    const step = steps[index];
    record(`step ${index}`, "frontier." + step.intent, step.args, () => callFrontier("frontier." + step.intent, step.args));
  },
  // A call with whatever name and arguments: the schema violations and the control for a missing service.
  call(label, name, args) {
    record(label, name, args, () => GodotFabric.call(name, args));
  },
  // The calls a HUD makes while a job runs: the same method and arguments, recorded in `attempts` and not in `results`.
  during(label, name, args) {
    attempt(label, name, args);
  },
  attempts() {
    return attempts.map(entry => ({...entry}));
  },
  // Further module-scope subscribers of the snapshot. Each one keeps what it received ([revision, turn, phase, last_job]),
  // and every delivery is also appended to `arrivals` as [subscriber, revision] in the order JavaScript saw it.
  addSubscribers(count) {
    for (let index = 0; index < count; index += 1) {
      const subscriber = {index: extras.length, ready: false, error: null, received: [], connection: null};
      subscriber.connection = GodotFabric.connect(FRONTIER_SNAPSHOT, snapshot => {
        subscriber.received.push([snapshot.revision, snapshot.value.turn, snapshot.value.phase, snapshot.value.last_job]);
        arrivals.push([subscriber.index, snapshot.revision]);
      });
      subscriber.connection.ready.then(() => { subscriber.ready = true; }, error => { subscriber.error = failure(error); });
      extras.push(subscriber);
    }
  },
  subscribers() {
    return {count: extras.length, ready: extras.filter(subscriber => subscriber.ready).length,
      errors: extras.filter(subscriber => subscriber.error !== null).map(subscriber => subscriber.error),
      received: extras.map(subscriber => subscriber.received.length)};
  },
  // What the extras received after the given number of arrivals: the global order as [subscriber, revision], and per
  // subscriber what it received as [revision, turn, phase, last_job].
  subscribersSince(arrivalCount) {
    return {arrivals: arrivals.slice(arrivalCount), arrivalCount: arrivals.length,
      received: extras.map(subscriber => subscriber.received.map(entry => [...entry]))};
  },
  removeSubscribers() {
    for (const subscriber of extras) {
      subscriber.connection.remove();
    }
    extras.length = 0;
    arrivals.length = 0;
  },
  // Every turn_ended the application's own subscription ever received, and every snapshot's progress, in order.
  turnEndedLog() {
    return turnEnded.map(entry => ({seq: entry.seq, ...entry.value}));
  },
  progressLog(from) {
    return snapshots.slice(from).map(entry => ({seq: entry.seq, revision: entry.revision, turn: entry.value.turn, phase: entry.value.phase,
      last_job: entry.value.last_job}));
  },
  // The counters the probe polls while it waits.
  counts() {
    return {snapshots: snapshots.length, turnEnded: turnEnded.length, results: results.length,
      settled: results.filter(entry => entry.state !== "pending").length, panelSnapshots: panelSnapshots.length,
      attempts: attempts.length, attemptsSettled: attempts.filter(entry => entry.state !== "pending").length, arrivals: arrivals.length,
      stepsReceived: steps.length, panel: {...panel}, application: {...application, errors: [...application.errors]}};
  },
  // What the last step left: its result and the events it produced after the given counts.
  since(snapshotCount, turnEndedCount) {
    return {result: results.at(-1) ?? null, snapshots: snapshots.slice(snapshotCount), turnEnded: turnEnded.slice(turnEndedCount)};
  },
  panelSince(count) {
    return panelSnapshots.slice(count);
  },
  latest() {
    return snapshots.at(-1) ?? null;
  },
};
