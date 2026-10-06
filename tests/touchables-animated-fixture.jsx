import React, {Component} from "react";
import {AppRegistry, View} from "react-native";
import OriginalTouchableOpacity from "react-native/Libraries/Components/Touchable/TouchableOpacity";

// Only this probe deep-imports RN's original TouchableOpacity, to show why the
// public facade keeps it unavailable: its Animated.View needs a native driver.
const renderErrors = [], hosts = [];
class Case extends Component {
  state = {error: null};
  static getDerivedStateFromError(error) { return {error}; }
  componentDidCatch(error) {
    renderErrors.push({root: this.props.root, case: this.props.name, name: error?.name ?? null, message: String(error?.message ?? error)});
  }
  render() { return this.state.error ? null : this.props.children; }
}
function Fixture({name}) {
  return <View testID={name + "-root"} pointerEvents="box-none" style={{flex: 1}}>
    <View testID={name + "-sibling"} style={{position: "absolute", left: 16, top: 16, width: 60, height: 30, backgroundColor: "#334155"}} />
    <Case root={name} name="opacity">
      <OriginalTouchableOpacity testID={name + "-opacity"} ref={instance => { hosts.push(instance?.__nativeTag ?? null); }}
        onPress={() => {}} style={{position: "absolute", left: 16, top: 64, width: 120, height: 40, backgroundColor: "#0369a1"}}>
        <View style={{width: 10, height: 10}} />
      </OriginalTouchableOpacity>
    </Case>
  </View>;
}
AppRegistry.registerComponent("TouchablesAnimatedProbe", () => Fixture);

globalThis.TouchablesProbe = {
  renderErrors() { return [...renderErrors]; },
  hosts() { return [...hosts]; },
};
