// Deliberately bounded public entrypoint for external packages. Unsupported
// native features fail where invoked, instead of becoming inert no-op shims.
import React from "react";
import { ScrollView as GodotScrollView } from "./scroll-view";
import OriginalView from "react-native/Libraries/Components/View/View";
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
import { validateButton, validateInput } from "./control-contracts.mjs";
import processColor from "react-native/Libraries/StyleSheet/processColor";
export { default as NativeModules } from "./native-modules";
export { default as NativeEventEmitter } from "react-native/Libraries/EventEmitter/NativeEventEmitter";
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
export { default as Platform } from "./platform";
export const StyleSheet = {
  hairlineWidth: 1,
  create: (styles) => styles,
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
function unavailable(name) {
  return function UnsupportedGodotComponent() {
    throw new Error(`Godot platform does not implement ${name}`);
  };
}
export const Image = unavailable("Image");
export const Switch = unavailable("Switch");
export const TouchableHighlight = unavailable("TouchableHighlight");
export const TouchableOpacity = unavailable("TouchableOpacity");
export const TouchableWithoutFeedback = unavailable("TouchableWithoutFeedback");
export const ActivityIndicator = unavailable("ActivityIndicator");
export const StatusBar = unavailable("StatusBar");
export const FlatList = unavailable("FlatList");
export const ImageBackground = unavailable("ImageBackground");
export const KeyboardAvoidingView = unavailable("KeyboardAvoidingView");
export const VirtualizedList = unavailable("VirtualizedList");
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
export function ScrollView(props) {
  if (useTextAncestor())
    throw new Error("Inline Controls are not implemented in Godot Text");
  return <GodotScrollView {...props} />;
}
export const PanResponder = {
  create() {
    throw new Error(
      "Chart platform PanResponder/pinch zoom is not implemented",
    );
  },
};
export function useColorScheme() {
  throw new Error(
    "Chart platform system color scheme is not implemented; use an explicit chart theme",
  );
}
