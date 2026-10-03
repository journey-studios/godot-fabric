import React from "react";
import * as Fabric from "react-native/Libraries/Renderer/implementations/ReactFabric-prod";
import { RootTagContext, createRootTag } from "react-native/Libraries/ReactNative/RootTag";
import { View } from "./components";

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
}
