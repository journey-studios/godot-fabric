import React, {useEffect, useState} from 'react';
import {AppRegistry, View, Text} from 'react-native';
import {Badge, Commands, Probe} from '@godot-fabric/adapter-fixture';

const controls = new Map<string, any>();
const setters = new Map<string, (action: string) => void>();
const events: any[] = [];
const results: any[] = [];
let mounts = 0, cleanups = 0, promise: any = null, probeError = '', stale: any = null;
const subscription = Probe.onResult(value => {results.push(value);});
const api = {
  stats: () => ({events, results, mounts, cleanups, promise, probeError, probe: JSON.parse(Probe.getStats())}),
  action: (panel: string, action: string) => setters.get(panel)?.(action),
  focus: (id: string) => Commands.focus(controls.get(id)),
  retain: (id: string) => {stale = controls.get(id);},
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
  const [order, setOrder] = useState(['a', 'b']);
  const [phase, setPhase] = useState(0);
  const [defaults, setDefaults] = useState(false);
  useEffect(() => {
    mounts++;
    setters.set(panel, action => {
      if (action === 'reorder') setOrder(value => [...value].reverse());
      else if (action === 'update') setPhase(1);
      else if (action === 'defaults') setDefaults(true);
      else if (action === 'remove') setOrder(value => value.filter(key => key !== 'a'));
    });
    return () => {cleanups++; setters.delete(panel);};
  }, [panel]);
  return <View style={{flex: 1, padding: 16, gap: 12, backgroundColor: '#14213d'}}>
    <Text style={{fontSize: 24, color: '#ffffff'}}>{`Original Codegen · ${panel}`}</Text>
    <Text style={{fontSize: 16, color: '#a7c7e7'}}>An external native adapter in the Fabric tree</Text>
    {order.map(key => <Badge key={key} ref={value => {
      const id = `${panel}-${key}`;
      if (value) controls.set(id, value); else controls.delete(id);
    }} testID={`${panel}-${key}`} style={{height: 52, width: '100%', backgroundColor: '#31597e'}}
      {...(defaults && key === 'a' ? {} : {caption: `${panel} ${key} ${phase ? 'updated' : 'initial'}`, count: phase ? 18 : 7, enabled: !phase})}
      onBadgeActivate={event => {events.push({panel, key, phase, ...event.nativeEvent});}} />)}
  </View>;
}
AppRegistry.registerComponent('AdapterShowcase', () => Showcase);
