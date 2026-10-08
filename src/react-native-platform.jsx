// Deliberately bounded public entrypoint for external packages. Unsupported
// native features fail where invoked, instead of becoming inert no-op shims.
import React from "react";
import { ScrollView as GodotScrollView } from "./scroll-view";
import GodotImage from "./image";
import OriginalImageBackground from "react-native/Libraries/Image/ImageBackground";
import OriginalView from "react-native/Libraries/Components/View/View";
import OriginalTouchableHighlight from "react-native/Libraries/Components/Touchable/TouchableHighlight";
import OriginalTouchableWithoutFeedback from "react-native/Libraries/Components/Touchable/TouchableWithoutFeedback";
import OriginalTouchableOpacity from "react-native/Libraries/Components/Touchable/TouchableOpacity";
import OriginalTouchableNativeFeedback from "react-native/Libraries/Components/Touchable/TouchableNativeFeedback";
import OriginalSwitch from "react-native/Libraries/Components/Switch/Switch";
import OriginalActivityIndicator from "react-native/Libraries/Components/ActivityIndicator/ActivityIndicator";
import OriginalModal from "react-native/Libraries/Modal/Modal";
import RCTSafeAreaViewNativeComponent from "react-native/Libraries/Components/SafeAreaView/RCTSafeAreaViewNativeComponent";
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
import { checkProps } from "./prop-scope.mjs";
import { pressableAccessibilityProps, withExplicitRoles } from "./accessibility-view-config.js";
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
// RN's original LayoutAnimation over RN's C++ LayoutAnimationDriver (native/layout_animation.h): configureNext
// reaches nativeFabricUIManager.configureNextLayoutAnimation, and the driver animates the next commit's
// mutations on the Godot frame tick.
export { default as LayoutAnimation } from "react-native/Libraries/LayoutAnimation/LayoutAnimation";
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
// RN's original Linking, Clipboard and Vibration over the application's device
// services. Each is constructed on first read, as in RN's index.js.
export { Linking, Clipboard, Vibration } from "./device-services";
// RN's original iOS- and Android-specific APIs, which RN itself leaves
// unavailable on a platform that is neither: each runs the branch RN takes there
// (a warning, a rejected value, a thrown error or an UnimplementedView) and is
// constructed on first read, as in index.js. See src/os-specific.js.
export {
  ToastAndroid,
  PermissionsAndroid,
  DynamicColorIOS,
  ActionSheetIOS,
  ProgressBarAndroid,
  DrawerLayoutAndroid,
  InputAccessoryView,
  PushNotificationIOS,
} from "./os-specific";
export { useWindowDimensions } from "./window-dimensions";
export { default as useColorScheme } from "react-native/Libraries/Utilities/useColorScheme";
// RN's original Modal.js behind the prop policy (src/prop-scope.mjs): the check runs on every render, so a prop that the host
// cannot take fails on an update as it does on the mount. RN's Modal is a function component that maps ref to modalRef and
// carries Context; this wrapper keeps both.
export function Modal(props) {
  checkProps("Modal", props);
  return <OriginalModal {...props} />;
}
Modal.displayName = OriginalModal.displayName;
Modal.Context = OriginalModal.Context;
// RN's SafeAreaView picks its native component by Platform.OS: RCTSafeAreaViewNativeComponent on "ios" and a plain View on
// any other OS, which would make it one here ("godot"). The host mounts the component iOS selects (RN's own descriptor,
// native/display_insets.h): its State carries the padding that the window's unsafe bands leave of the view, and Yoga applies it.
// Its props are ViewProps, so it runs the checks of the View (renderHostView). Like RN's iOS SafeAreaView it does not go
// through View.js, so the aria-* and id/tabIndex mappings of that file do not apply: the view config drops those names, as it does on iOS.
export function SafeAreaView(props) {
  return renderHostView(RCTSafeAreaViewNativeComponent, props);
}
export {
  FlatList,
  SectionList,
  VirtualizedList,
  VirtualizedSectionList,
} from "./lists";
export { default as Platform } from "./platform";
export const StyleSheet = {
  hairlineWidth: 1,
  // RN 0.87.1's StyleSheetExports.js: an absolutely positioned box over its parent.
  absoluteFill: Object.freeze({ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }),
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
  // The values of the text styles the host paints: a synthetic italic and solid lines under or through the text.
  // Oblique, the aliases of the native parser ("strikethrough", "underline-strikethrough"), another order, overline
  // and the other line styles would be drawn as something else, so they fail instead. In the function because
  // tests/platform-seams.test.mjs runs this function alone.
  const textStyleValues = new Map([
    ["fontStyle", { values: ["normal", "italic"], hint: "use normal or italic" }],
    [
      "textDecorationLine",
      {
        values: ["none", "underline", "line-through", "underline line-through"],
        hint: "use none, underline, line-through or underline line-through",
      },
    ],
    ["textDecorationStyle", { values: ["solid"], hint: "only solid" }],
  ]);
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
    const accepted = textStyleValues.get(name);
    if (accepted !== undefined && !accepted.values.includes(value)) {
      throw new Error(`Godot Text does not implement style ${name} ${String(value)}: ${accepted.hint}`);
    }
  }
  return flat;
}
// What the host takes of a View: the declared props, the explicit roles and the style names it implements. RN's View.js and RN's
// SafeAreaView differ only in the native component, so both run this.
function renderHostView(Component, { style, collapsable, ...props }) {
  if (useTextAncestor())
    throw new Error("Inline Controls are not implemented in Godot Text");
  checkProps("View", props);
  const flat = StyleSheet.flatten(style);
  // Browser text selection is irrelevant to native Controls. The accessibility
  // props reach RN's View, whose view config (src/accessibility-view-config.js)
  // lets through the ones the host maps and rejects the values it cannot honor.
  const { userSelect, ...layout } = flat;
  return <Component {...withExplicitRoles(props)} collapsable={collapsable} style={nativeStyle(layout, "View")} />;
}
export function View(props) {
  return renderHostView(OriginalView, props);
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
      {...pressableAccessibilityProps(props)}
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
// RN's original Image.ios.js behind a validating wrapper (image.jsx), and its original ImageBackground and asset registry.
export const Image = GodotImage;
export const ImageBackground = OriginalImageBackground;
export { default as AssetRegistry } from "react-native/asset-registry";
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
// RN's original TouchableNativeFeedback: Pressability drives the press events and
// RN leaves out the Android drawable (getBackgroundProp is null off Android), so
// no native background or foreground prop reaches the host. Its statics are RN's.
export function TouchableNativeFeedback(props) {
  if (useTextAncestor()) {
    throw new Error("Inline Controls are not implemented in Godot Text");
  }
  return <OriginalTouchableNativeFeedback {...props} />;
}
TouchableNativeFeedback.SelectableBackground = OriginalTouchableNativeFeedback.SelectableBackground;
TouchableNativeFeedback.SelectableBackgroundBorderless = OriginalTouchableNativeFeedback.SelectableBackgroundBorderless;
TouchableNativeFeedback.Ripple = OriginalTouchableNativeFeedback.Ripple;
TouchableNativeFeedback.canUseNativeForeground = OriginalTouchableNativeFeedback.canUseNativeForeground;
// RN's original ActivityIndicator.js takes its non-Android path: a sized View
// around the generated ActivityIndicatorView component.
export function ActivityIndicator({ style, ...props }) {
  if (useTextAncestor()) {
    throw new Error("Inline Controls are not implemented in Godot Text");
  }
  checkProps("ActivityIndicator", props);
  return <OriginalActivityIndicator {...props} style={nativeStyle(style, "ActivityIndicator")} />;
}
export const StatusBar = unavailable("StatusBar");
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
export const ScrollView = Object.assign(React.forwardRef(function ScrollView(props, ref) {
  if (useTextAncestor())
    throw new Error("Inline Controls are not implemented in Godot Text");
  return <GodotScrollView ref={ref} {...props} />;
}), {
  // Preserve the original RN context used by VirtualizedList in development.
  Context: GodotScrollView.Context,
});
// Upstream PanResponder: gesture state from the original responder events and
// their touch history, including multi-touch centroids.
export { default as PanResponder } from "react-native/Libraries/Interaction/PanResponder";
