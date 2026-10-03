import React, {useEffect, useRef, useState} from 'react';
import {AppRegistry, View, Text, Button} from 'react-native';
import {Badge, Commands, Probe} from '@godot-fabric/adapter-fixture';

const controls = new Map<string, {owner: object; ref: any}>();
const setters = new Map<string, {owner: object; update: (action: string) => void}>();
const lifecycle = new Map<string, {mounts: number; cleanups: number}>();
const events: any[] = [];
const results: any[] = [];
let mounts = 0, cleanups = 0, promise: any = null, probeError = '', stale: any = null;
const subscription = Probe.onResult(value => {results.push(value);});
const api = {
  stats: () => ({events, results, mounts, cleanups, promise, probeError,
    lifecycle: Object.fromEntries(lifecycle), probe: JSON.parse(Probe.getStats())}),
  action: (panel: string, action: string) => setters.get(panel)?.update(action),
  focus: (id: string) => Commands.focus(controls.get(id)?.ref),
  retain: (id: string) => {stale = controls.get(id)?.ref;},
  staleFocus: () => Commands.focus(stale),
  fire: (index: number, offThread = false) => Probe.fireCaptured(index, offThread),
  add: () => Probe.add(2, 3),
  describe: () => {void Probe.describe('original CxxSpec').then(value => {promise = value;});},
  retainMethod: () => {const add = Probe.add; (api as any).oldAdd = () => {
    try {return add(1, 1);} catch (error) {probeError = String(error); return -1;}
  };},
  unsubscribe: () => subscription.remove(),
};
(globalThis as any).AdapterFixture = api;

function Showcase({panel}: {panel: string}) {
  const owner = useRef({}).current;
  const [order, setOrder] = useState(['a', 'b']);
  const [phase, setPhase] = useState(0);
  const [defaults, setDefaults] = useState(false);
  const [resized, setResized] = useState(false);
  useEffect(() => {
    mounts++;
    const root = lifecycle.get(panel) ?? {mounts: 0, cleanups: 0};
    lifecycle.set(panel, root);
    root.mounts++;
    setters.set(panel, {owner, update: action => {
      if (action === 'reorder') setOrder(value => [...value].reverse());
      else if (action === 'update') setPhase(1);
      else if (action === 'defaults') setDefaults(true);
      else if (action === 'remove') setOrder(value => value.filter(key => key !== 'a'));
      else if (action === 'resize') setResized(true);
    }});
    return () => {
      cleanups++;
      root.cleanups++;
      if (setters.get(panel)?.owner === owner) setters.delete(panel);
    };
  }, [owner, panel]);
  return <View style={{flex: 1, padding: 16, gap: 12, backgroundColor: '#14213d'}}>
    <Text style={{fontSize: 24, color: '#ffffff'}}>{`Original Codegen · ${panel}`}</Text>
    <Text style={{fontSize: 16, color: '#a7c7e7'}}>An external native adapter in the Fabric tree</Text>
    {order.map(key => <Badge key={key} ref={value => {
      const id = `${panel}-${key}`;
      if (value) controls.set(id, {owner, ref: value});
      else if (controls.get(id)?.owner === owner) controls.delete(id);
    }} testID={`${panel}-${key}`} style={{height: resized ? 64 : 52, width: '100%', backgroundColor: '#31597e'}}
      {...(defaults && key === 'a' ? {} : {caption: `${panel} ${key} ${phase ? 'updated' : 'initial'}`, count: phase ? 18 : 7, enabled: !phase})}
      onBadgeActivate={event => {events.push({panel, key, phase, ...event.nativeEvent});}} />)}
    <Button testID={`${panel}-internal`} title="Core callback" onPress={() => {events.push({panel, kind: 'core'});}} />
  </View>;
}
AppRegistry.registerComponent('AdapterShowcase', () => Showcase);
