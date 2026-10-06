// Deliberately bounded public entrypoint for external packages. Unsupported
// native features fail where invoked, instead of becoming inert no-op shims.
import React from "react";
import { ScrollView as GodotScrollView } from "./scroll-view";
import OriginalView from "react-native/Libraries/Components/View/View";
import OriginalTouchableHighlight from "react-native/Libraries/Components/Touchable/TouchableHighlight";
import OriginalTouchableWithoutFeedback from "react-native/Libraries/Components/Touchable/TouchableWithoutFeedback";
import OriginalTouchableOpacity from "react-native/Libraries/Components/Touchable/TouchableOpacity";
import OriginalSwitch from "react-native/Libraries/Components/Switch/Switch";
import OriginalActivityIndicator from "react-native/Libraries/Components/ActivityIndicator/ActivityIndicator";
import {
  Pressable as GodotPressable,
  Button as GodotButton,
  controlViewConfig,
} from "./components";
import {
  ParagraphText as GodotText,
  textStyleAttributes,
  useTextAncestor,
} from "./text";
import { PublicInput } from "./public-input";
import TextInputState from "./text-input-state";
import { validateButton, validateInput } from "./control-contracts.mjs";
import processColor from "react-native/Libraries/StyleSheet/processColor";
import OriginalStyleSheet from "react-native/Libraries/StyleSheet/StyleSheet";
export { default as NativeModules } from "./native-modules";
export { default as NativeEventEmitter } from "react-native/Libraries/EventEmitter/NativeEventEmitter";
// RN's original Animated over RN's C++ NativeAnimatedModule (useNativeDriver)
// or requestAnimationFrame (JS driver), and its original Easing and hooks.
export { default as Animated } from "react-native/Libraries/Animated/Animated";
export { default as Easing } from "react-native/Libraries/Animated/Easing";
export { default as useAnimatedValue } from "react-native/Libraries/Animated/useAnimatedValue";
export { default as useAnimatedValueXY } from "react-native/Libraries/Animated/useAnimatedValueXY";
export * as TurboModuleRegistry from "react-native/Libraries/TurboModule/TurboModuleRegistry";
export { default as codegenNativeComponent } from "react-native/Libraries/Utilities/codegenNativeComponent";
export { default as codegenNativeCommands } from "react-native/Libraries/Utilities/codegenNativeCommands";
export { findNodeHandle } from "./renderer-proxy";
export { UIManager } from "./private-interface";
export { AppRegistry, RootTagContext } from "./app-registry";
export {
  Dimensions,
  Appearance,
  AppState,
  AccessibilityInfo,
  PixelRatio,
  I18nManager,
} from "./platform-environment";
export { useWindowDimensions } from "./window-dimensions";
export { default as useColorScheme } from "react-native/Libraries/Utilities/useColorScheme";
export {
  FlatList,
  SectionList,
  VirtualizedList,
  VirtualizedSectionList,
} from "./lists";
export { default as Platform } from "./platform";
export const StyleSheet = {
  hairlineWidth: 1,
  create: (styles) => styles,
  // RN's own compose, which VirtualizedList uses for its cells and headers.
  compose: (style1, style2) => OriginalStyleSheet.compose(style1, style2),
  flatten(style) {
    return Array.isArray(style)
      ? Object.assign({}, ...style.map(StyleSheet.flatten))
      : style || {};
  },
};
function nativeStyle(style, kind) {
  const flat = StyleSheet.flatten(style);
  for (const [name, value] of Object.entries(flat)) {
    if (value == null) continue;
    if (
      !(name in controlViewConfig.validAttributes.style) &&
      !(kind === "Text" && textStyleAttributes.includes(name))
    )
      throw new Error(`Godot ${kind} does not implement style ${name}`);
    if (kind !== "Text" && textStyleAttributes.includes(name))
      throw new Error(`Godot ${kind} does not implement text style ${name}`);
    if (name === "borderStyle" && value !== "solid")
      throw new Error("Godot platform supports solid borders only");
    if (
      name === "fontFamily" &&
      !["NotoSans", "JetBrainsMono", ""].includes(value)
    )
      throw new Error(`Godot font family is not registered: ${value}`);
    if (
      name === "textAlign" &&
      !["left", "center", "right", "auto"].includes(value)
    )
      throw new Error(
        "Godot Text supports left, center, right or auto alignment",
      );
    if (
      ["fontSize", "lineHeight"].includes(name) &&
      (!Number.isFinite(value) || value <= 0)
    )
      throw new Error(`Godot Text ${name} must be finite and positive`);
    if (name === "letterSpacing" && !Number.isFinite(value))
      throw new Error("Godot Text letterSpacing must be finite");
    if (
      name === "fontWeight" &&
      ![
        "normal",
        "bold",
        "100",
        "200",
        "300",
        "400",
        "500",
        "600",
        "700",
        "800",
        "900",
      ].includes(String(value))
    )
      throw new Error("Godot Text fontWeight must be normal, bold or 100..900");
  }
  return flat;
}
export function View({
  style,
  accessible,
  accessibilityRole,
  accessibilityLabel,
  collapsable,
  ...props
}) {
  if (useTextAncestor())
    throw new Error("Inline Controls are not implemented in Godot Text");
  const flat = StyleSheet.flatten(style);
  // Browser text selection is irrelevant to native Controls. Accessibility
  // metadata remains explicitly unsupported, documented in the laboratory.
  const { userSelect, ...layout } = flat;
  return <OriginalView {...props} collapsable={collapsable} style={nativeStyle(layout, "View")} />;
}
export function Text({ style, ...props }) {
  const flat = nativeStyle(style, "Text");
  if (useTextAncestor()) {
    for (const name of Object.keys(flat))
      if (!textStyleAttributes.includes(name) && name !== "opacity")
        throw new Error(`Godot inline Text does not implement style ${name}`);
  }
  return <GodotText {...props} style={flat} />;
}
export function Pressable({ style, ...props }) {
  if (useTextAncestor())
    throw new Error("Inline Controls are not implemented in Godot Text");
  return (
    <GodotPressable
      {...props}
      style={
        typeof style === "function"
          ? (state) => nativeStyle(style(state), "Pressable")
          : nativeStyle(style, "Pressable")
      }
    />
  );
}
// O interop registra estes tipos na inicialização; isso não fornece os controles.
function unavailable(name, reason) {
  return function UnsupportedGodotComponent() {
    throw new Error(`Godot platform does not implement ${name}${reason ? `: ${reason}` : ""}`);
  };
}
export const Image = unavailable("Image");
// RN's original Switch.js takes its non-Android path: the generated
// SwitchNativeComponent ViewConfig, its onChange event and setValue command.
export function Switch({ style, ...props }) {
  if (useTextAncestor()) {
    throw new Error("Inline Controls are not implemented in Godot Text");
  }
  return <OriginalSwitch {...props} style={nativeStyle(style, "Switch")} />;
}
// RN's original touchables own Pressability, their timers and feedback state.
// The facade only keeps its host contract: no Controls inside Text and
// validated styles on the View a touchable renders itself.
export function TouchableWithoutFeedback(props) {
  if (useTextAncestor()) {
    throw new Error("Inline Controls are not implemented in Godot Text");
  }
  return <OriginalTouchableWithoutFeedback {...props} />;
}
export function TouchableHighlight({ style, ...props }) {
  if (useTextAncestor()) {
    throw new Error("Inline Controls are not implemented in Godot Text");
  }
  return <OriginalTouchableHighlight {...props} style={nativeStyle(style, "TouchableHighlight")} />;
}
// RN's original TouchableOpacity: Pressability drives its Animated.View opacity
// timing through the native driver, which the C++ NativeAnimatedModule runs.
export function TouchableOpacity({ style, ...props }) {
  if (useTextAncestor()) {
    throw new Error("Inline Controls are not implemented in Godot Text");
  }
  return <OriginalTouchableOpacity {...props} style={nativeStyle(style, "TouchableOpacity")} />;
}
// RN's original ActivityIndicator.js takes its non-Android path: a sized View
// around the generated ActivityIndicatorView component.
export function ActivityIndicator({ style, ...props }) {
  if (useTextAncestor()) {
    throw new Error("Inline Controls are not implemented in Godot Text");
  }
  return <OriginalActivityIndicator {...props} style={nativeStyle(style, "ActivityIndicator")} />;
}
export const StatusBar = unavailable("StatusBar");
export const ImageBackground = unavailable("ImageBackground");
export const KeyboardAvoidingView = unavailable("KeyboardAvoidingView");
export const RefreshControl = unavailable("RefreshControl");
export function Button(props) {
  if (useTextAncestor()) throw new Error("Inline Controls are not implemented in Godot Text");
  validateButton(props);
  const { title, onPress, disabled = false, color = "#2563eb", ...native } = props;
  if (processColor(color) == null) throw new Error("Godot Button color is invalid");
  return <GodotButton {...native} text={title} onActivate={() => onPress?.()} disabled={disabled}
    color="#ffffff" style={{ minHeight: 44, paddingHorizontal: 12, paddingVertical: 8,
      backgroundColor: color, borderRadius: 8, opacity: disabled ? 0.4 : 1 }} />;
}
export function TextInput(props) {
  if (useTextAncestor()) throw new Error("Inline Controls are not implemented in Godot Text");
  validateInput(props);
  const style = nativeStyle(props.style, "Text");
  for (const name of textStyleAttributes)
    if (style[name] != null && !["fontSize", "color"].includes(name))
      throw new Error(`Godot TextInput does not implement style ${name}`);
  if (style.color != null && (typeof style.color !== "string" || processColor(style.color) == null))
    throw new Error("Godot TextInput color requires a valid static color string");
  return <PublicInput {...props} style={{ minHeight: 44, ...style }} />;
}
TextInput.State = {
  currentlyFocusedInput: TextInputState.currentlyFocusedInput,
  currentlyFocusedField: TextInputState.currentlyFocusedField,
  focusTextInput: TextInputState.focusTextInput,
  blurTextInput: TextInputState.blurTextInput,
};
export function ScrollView(props) {
  if (useTextAncestor())
    throw new Error("Inline Controls are not implemented in Godot Text");
  return <GodotScrollView {...props} />;
}
// Upstream PanResponder: gesture state from the original responder events and
// their touch history, including multi-touch centroids.
export { default as PanResponder } from "react-native/Libraries/Interaction/PanResponder";
