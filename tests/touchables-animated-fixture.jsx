import React, {Component} from "react";
import {AppRegistry, TouchableOpacity, View} from "react-native";

// The public TouchableOpacity alone in one root. RN's original module renders
// an Animated.View whose opacity Pressability animates with the native driver,
// which RN's C++ NativeAnimatedModule runs; a real press must dim it and
// release must bring it back. The animated suite (test:animated) checks that
// animation frame by frame; this lane keeps the touchables contract honest.
const renderErrors = [], events = [];
class Case extends Component {
  state = {error: null};
  static getDerivedStateFromError(error) { return {error}; }
  componentDidCatch(error) {
    renderErrors.push({root: this.props.root, case: this.props.name, name: error?.name ?? null, message: String(error?.message ?? error)});
  }
  render() { return this.state.error ? null : this.props.children; }
}
function Fixture({name}) {
  const record = type => () => events.push({root: name, type});
  return <View testID={name + "-root"} pointerEvents="box-none" style={{flex: 1}}>
    <View testID={name + "-sibling"} style={{position: "absolute", left: 16, top: 16, width: 60, height: 30, backgroundColor: "#334155"}} />
    <Case root={name} name="opacity">
      <TouchableOpacity testID={name + "-opacity"} activeOpacity={0.5} onPressIn={record("in")} onPressOut={record("out")}
        onPress={record("press")}
        style={{position: "absolute", left: 16, top: 64, width: 120, height: 40, backgroundColor: "#0369a1"}}>
        <View style={{width: 10, height: 10}} />
      </TouchableOpacity>
    </Case>
  </View>;
}
AppRegistry.registerComponent("TouchablesAnimatedProbe", () => Fixture);

globalThis.TouchablesProbe = {
  renderErrors() { return [...renderErrors]; },
  take() { return events.splice(0); },
};
