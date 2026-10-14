import React from "react";
import * as Fabric from "react-native/Libraries/Renderer/implementations/ReactFabric-prod";
import { RootTagContext, createRootTag } from "react-native/Libraries/ReactNative/RootTag";
import { View } from "./components";

// The root tags this container has rendered and the host has not stopped. The AppRegistry facade (app-registry.js) uses
// them to tell a surface it can run again from a tag no Godot surface owns.
const running = new Set();
export function isRunningSurface(rootTag) {
  return running.has(rootTag);
}
export function forgetSurface(rootTag) {
  running.delete(rootTag);
}

// Platform container invoked by the original AppRegistryImpl. Keep its type
// stable across setSurfaceProps so React preserves the registered root state.
export default function renderApplication({ RootComponent, initialProps, rootTag,
  WrapperComponent, rootViewStyle, displayMode, useOffscreen }) {
  if (!Number.isInteger(rootTag) || rootTag <= 0)
    throw new Error("Godot renderApplication requires a positive root tag");
  if (useOffscreen || (displayMode != null && displayMode !== 1))
    throw new Error("Godot AppRegistry does not implement suspended/hidden display modes");
  const props = initialProps ?? {};
  let content = <RootComponent {...props} rootTag={rootTag} />;
  if (WrapperComponent)
    content = <WrapperComponent initialProps={props}>{content}</WrapperComponent>;
  Fabric.render(
    <RootTagContext.Provider value={createRootTag(rootTag)}>
      <View style={rootViewStyle ?? { flex: 1 }} pointerEvents="box-none">{content}</View>
    </RootTagContext.Provider>,
    rootTag, null, true,
    {
      onCaughtError(error) { console.log("Caught:", error.message); },
      onUncaughtError(error) { throw error; },
      onRecoverableError(error) { console.warn(error.message); },
    },
  );
  running.add(rootTag);
}
