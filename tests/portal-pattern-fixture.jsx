import {AppRegistry} from "react-native";
import "../examples/portal-pattern/App";

// The roots of this suite run the example's own component, with the wrapper provider the example installs: importing it installs the
// provider (AppRegistry.setWrapperComponentProvider) and registers "PortalPatternExample" before any root runs. Everything the probe
// reads about the pattern comes from the example's observation hook (globalThis.PortalPatternExample.state) and from the native tree; this
// file adds what the example does not say about itself, which registry the roots ran through.
const reply = value => JSON.parse(JSON.stringify(value));
globalThis.PortalPatternProbe = {
  keys() {
    return reply(AppRegistry.getAppKeys());
  },
  state() {
    return reply(globalThis.PortalPatternExample.state());
  },
};
