import type * as React from "react";
import type * as RN from "../node_modules/react-native/types_generated/index";

export declare const AppRegistry: Pick<typeof RN.AppRegistry, "getAppKeys"> & {
  registerComponent(key: Parameters<typeof RN.AppRegistry.registerComponent>[0],
    provider: Parameters<typeof RN.AppRegistry.registerComponent>[1]): string;
};
export declare const RootTagContext: typeof RN.RootTagContext;
export declare const NativeModules: typeof RN.NativeModules;
export declare const NativeEventEmitter: typeof RN.NativeEventEmitter;
/** RN's original AppState, fed by the Godot application lifecycle. */
export declare const AppState: typeof RN.AppState;
export type AppStateStatus = RN.AppStateStatus;
export type AppStateEvent = RN.AppStateEvent;
/** RN's original Linking over the host's LinkingManager module (iOS contract):
 * openURL, canOpenURL, getInitialURL and the "url" event. openSettings and
 * sendIntent reject. */
export declare const Linking: typeof RN.Linking;
/** RN's original, deprecated Clipboard. Both calls fail with
 * E_CLIPBOARD_UNAVAILABLE where the display server has no clipboard. */
export declare const Clipboard: typeof RN.Clipboard;
/** RN's original Vibration over Godot's Input.vibrate_handheld. */
export declare const Vibration: typeof RN.Vibration;
/** RN's original Appearance and useColorScheme, fed by Godot's system theme. */
export declare const Appearance: typeof RN.Appearance;
export declare const useColorScheme: typeof RN.useColorScheme;
export type ColorSchemeName = RN.ColorSchemeName;
/** RN's original lists on the Godot ScrollView. Sticky headers, pull to refresh
 * and animated scrolling fail when requested. */
export declare const FlatList: typeof RN.FlatList;
export type FlatList<ItemT = unknown> = RN.FlatList<ItemT>;
export declare const SectionList: typeof RN.SectionList;
export declare const VirtualizedList: typeof RN.VirtualizedList;
export declare const VirtualizedSectionList: typeof RN.VirtualizedSectionList;
export type ListRenderItem<ItemT> = RN.ListRenderItem<ItemT>;
export type SectionListData<ItemT> = RN.SectionListData<ItemT>;
/** RN's original Animated: values, timing, spring, decay, composition and
 * interpolation, with the JS driver or, with useNativeDriver, RN's C++ native
 * animations run on the Godot frame tick; Animated.View and
 * createAnimatedComponent over the public View. Animated.Text, Image,
 * ScrollView, FlatList and SectionList fail where they render. */
export declare const Animated: typeof RN.Animated;
export declare namespace Animated {
  type Value = RN.Animated.Value;
  type ValueXY = RN.Animated.ValueXY;
  type Interpolation<OutputT extends number | string = number | string> = RN.Animated.Interpolation<OutputT>;
  type CompositeAnimation = RN.Animated.CompositeAnimation;
  type Numeric = RN.Animated.Numeric;
  type TimingAnimationConfig = RN.Animated.TimingAnimationConfig;
  type SpringAnimationConfig = RN.Animated.SpringAnimationConfig;
  type DecayAnimationConfig = RN.Animated.DecayAnimationConfig;
  type WithAnimatedValue<T> = RN.Animated.WithAnimatedValue<T>;
}
export declare const Easing: typeof RN.Easing;
export type EasingFunction = RN.EasingFunction;
export declare const useAnimatedValue: typeof RN.useAnimatedValue;
export declare const useAnimatedValueXY: typeof RN.useAnimatedValueXY;
export declare const TurboModuleRegistry: typeof RN.TurboModuleRegistry;
export type TurboModule = RN.TurboModule;
export type EmitterSubscription = RN.EmitterSubscription;
export type HostComponent<Props extends {}> = RN.HostComponent<Props>;
export declare const codegenNativeComponent: typeof RN.codegenNativeComponent;
export declare const codegenNativeCommands: typeof RN.codegenNativeCommands;

/** The Godot subset, derived from pinned RN declarations. Transform syntax is
 * upstream; native support is validated separately for affine 2D matrices. */
export type ViewStyle = Pick<RN.ViewStyle,
  "width" | "height" | "minWidth" | "minHeight" | "maxWidth" | "maxHeight" |
  "flex" | "flexGrow" | "flexShrink" | "flexBasis" | "flexDirection" | "flexWrap" |
  "justifyContent" | "alignItems" | "alignSelf" | "alignContent" | "gap" | "rowGap" | "columnGap" |
  "padding" | "paddingHorizontal" | "paddingVertical" | "paddingLeft" | "paddingRight" | "paddingTop" | "paddingBottom" |
  "margin" | "marginHorizontal" | "marginVertical" | "marginLeft" | "marginRight" | "marginTop" | "marginBottom" |
  "position" | "top" | "left" | "bottom" | "right" | "display" | "opacity" | "zIndex" | "overflow" | "transform" | "transformOrigin" |
  "backgroundColor" | "borderColor" | "borderLeftColor" | "borderTopColor" | "borderRightColor" | "borderBottomColor" |
  "borderWidth" | "borderTopWidth" | "borderRightWidth" | "borderBottomWidth" |
  "borderLeftWidth" | "borderRadius" | "borderTopLeftRadius" | "borderTopRightRadius" | "borderBottomLeftRadius" | "borderBottomRightRadius">;
export type TextStyle = ViewStyle & Pick<RN.TextStyle, "fontSize" | "color" | "fontFamily" | "fontWeight" | "lineHeight" | "letterSpacing" | "textAlign">;
export type InputStyle = ViewStyle & Pick<RN.TextStyle, "fontSize"> & { color?: string };
export type StyleProp<T> = RN.StyleProp<T>;
export type PointerEvent = RN.PointerEvent;
export type NativePointerEvent = RN.NativePointerEvent;
export type NativeInstance = Pick<RN.TextInputInstance, "focus" | "blur" | "isFocused" | "measure" | "measureInWindow" | "setNativeProps" |
  "getBoundingClientRect" | "id" | "nodeName" | "nodeType" | "nodeValue" | "tagName" |
  "firstChild" | "lastChild" | "nextSibling" | "previousSibling" | "parentElement" | "hasChildNodes" |
  "childElementCount" | "firstElementChild" | "lastElementChild" | "nextElementSibling" | "previousElementSibling" |
  "clientLeft" | "clientTop" | "isConnected" | "parentNode" | "childNodes" | "children" |
  "ownerDocument" | "getRootNode" | "contains" | "compareDocumentPosition" | "textContent" |
  "offsetWidth" | "offsetHeight" | "offsetLeft" | "offsetTop" | "offsetParent" |
  "clientWidth" | "clientHeight" | "scrollWidth" | "scrollHeight" | "scrollLeft" | "scrollTop" |
  "hasPointerCapture" | "setPointerCapture" | "releasePointerCapture"> & {
  measureLayout(relative: number | NativeInstance,
    onSuccess: Parameters<RN.ViewInstance["measureLayout"]>[1], onFail?: () => void): void;
};
export type ViewInstance = NativeInstance;
export declare const findNodeHandle: typeof RN.findNodeHandle;
export declare const UIManager: Pick<typeof RN.UIManager, "measure" | "measureInWindow" | "measureLayout">;
export interface TextInputInstance extends NativeInstance, Pick<RN.TextInputInstance, "clear" | "setSelection"> {
  getNativeRef(): TextInputInstance | null;
}
export type ViewProps = Pick<RN.ViewProps, "children" | "testID" | "onLayout" | "pointerEvents" | "collapsable" | "collapsableChildren" | "id" | "nativeID" |
  "onPointerDown" | "onPointerDownCapture" | "onPointerMove" | "onPointerMoveCapture" |
  "onPointerUp" | "onPointerUpCapture" | "onPointerCancel" | "onPointerCancelCapture" |
  "onPointerOver" | "onPointerOverCapture" | "onPointerOut" | "onPointerOutCapture" |
  "onPointerEnter" | "onPointerEnterCapture" | "onPointerLeave" | "onPointerLeaveCapture" |
  "onGotPointerCapture" | "onGotPointerCaptureCapture" | "onLostPointerCapture" | "onLostPointerCaptureCapture"> & { style?: StyleProp<ViewStyle> };
export type TextProps = Pick<RN.TextProps, "children" | "testID" | "onLayout" | "numberOfLines" | "nativeID"> & {
  style?: StyleProp<TextStyle>; ellipsizeMode?: "tail" | "clip";
};
export interface TextInputProps extends Pick<RN.TextInputProps, "onChange" | "onChangeText" | "onSelectionChange" |
  "onFocus" | "onBlur" | "onEndEditing" | "onSubmitEditing" | "onKeyPress" | "onLayout"> {
  value?: string; defaultValue?: string; placeholder?: string; editable?: boolean;
  autoFocus?: boolean; multiline?: false; submitBehavior?: "submit" | "blurAndSubmit";
  selection?: { start: number; end?: number }; testID?: string; style?: StyleProp<InputStyle>;
}
export interface ButtonProps extends Pick<RN.ButtonProps, "onPress"> {
  title: string; color?: string; disabled?: boolean; testID?: string;
}
/** RN's original Switch.js (non-Android path) over the native Switch component.
 * The deprecated iOS tint props are omitted: Switch.js overrides them. */
export type SwitchProps = Pick<RN.SwitchProps, "value" | "disabled" | "onChange" | "onValueChange" |
  "thumbColor" | "trackColor" | "ios_backgroundColor" | "testID" | "nativeID" | "onLayout"> & { style?: StyleProp<ViewStyle> };
export type SwitchChangeEvent = RN.SwitchChangeEvent;
/** RN's original ActivityIndicator.js (non-Android path) over the generated
 * ActivityIndicatorView component; a numeric size sizes the Godot spinner. */
export type ActivityIndicatorProps = Pick<RN.ActivityIndicatorProps, "animating" | "color" | "hidesWhenStopped" | "size" |
  "testID" | "nativeID" | "onLayout"> & { style?: StyleProp<ViewStyle> };
/** RN's original Modal with the Godot presentation and lifecycle props. */
export type ModalProps = Pick<RN.ModalProps, "visible" | "transparent" | "onShow" | "onRequestClose" |
  "testID" | "children" | "backdropColor"> & {
  animationType?: "none";
  presentationStyle?: "fullScreen" | "overFullScreen";
};
/** RN's original Modal with the subset currently hosted by Godot. */
export declare const Modal: React.ComponentType<ModalProps>;
/** RN's original SafeAreaView maps to the View path on Godot; device safe-area
 * insets are not supplied by this desktop host. */
export declare const SafeAreaView: React.ComponentType<ViewProps & React.RefAttributes<NativeInstance>>;
export declare const View: React.ComponentType<ViewProps & React.RefAttributes<NativeInstance>>;
export declare const Text: React.ComponentType<TextProps & React.RefAttributes<NativeInstance>>;
export declare const TextInput: React.ComponentType<TextInputProps & React.RefAttributes<TextInputInstance>> & {
  State: {
    currentlyFocusedInput(): NativeInstance | null;
    currentlyFocusedField(): number | null;
    focusTextInput(input: NativeInstance | null | undefined): void;
    blurTextInput(input: NativeInstance | null | undefined): void;
  };
};
export declare const Button: React.ComponentType<ButtonProps & React.RefAttributes<NativeInstance>>;
export declare const Switch: React.ComponentType<SwitchProps & React.RefAttributes<NativeInstance>>;
export declare const ActivityIndicator: React.ComponentType<ActivityIndicatorProps & React.RefAttributes<NativeInstance>>;
/** RN's original TouchableOpacity.js: Pressability's press props over an
 * Animated.View whose opacity RN animates with the native driver. The style is
 * the Godot View subset; props this platform has not verified are omitted. */
export type TouchableOpacityProps = Pick<RN.TouchableOpacityProps, "activeOpacity" | "onPress" | "onPressIn" | "onPressOut" |
  "onLongPress" | "delayLongPress" | "delayPressIn" | "delayPressOut" | "disabled" | "hitSlop" | "pressRetentionOffset" |
  "testID" | "nativeID" | "onLayout" | "children"> & { style?: StyleProp<ViewStyle> };
export declare const TouchableOpacity: React.ComponentType<TouchableOpacityProps & React.RefAttributes<NativeInstance>>;
export declare const StyleSheet: {
  hairlineWidth: number;
  create<T extends Record<string, TextStyle>>(styles: T): T;
  flatten(style: StyleProp<TextStyle>): TextStyle;
};
