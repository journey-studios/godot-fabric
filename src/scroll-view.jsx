import React from "react";
import "./scroll-view-native-config";
import OriginalScrollView from "react-native/Libraries/Components/ScrollView/ScrollView";
import {prepareScrollViewProps} from "./scroll-view-contract.mjs";

function PublicScrollView(props, ref) {
  const forwarded = prepareScrollViewProps(props);
  return <OriginalScrollView ref={ref} {...forwarded} />;
}

// Keep React Native's component, methods, responder policy and child structure;
// the wrapper only rejects native behavior that the Godot host cannot honor.
export const ScrollView = Object.assign(React.forwardRef(PublicScrollView), {
  // VirtualizedList reads this static context in development builds.
  Context: OriginalScrollView.Context,
});
