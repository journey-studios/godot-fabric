// React Native 0.87.1 selects its iOS ScrollView view config for custom OS
// names. Register the original component first, then extend only its composed
// native config so horizontal survives Fabric's attribute create/diff path.
import "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent";
import * as ViewConfigRegistry from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";

const scrollViewConfig = ViewConfigRegistry.get("RCTScrollView");
if (scrollViewConfig.uiViewClassName !== "RCTScrollView" || !scrollViewConfig.validAttributes)
  throw new Error("Godot ScrollView expected React Native's registered RCTScrollView config");
scrollViewConfig.validAttributes.horizontal = true;
