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
/** RN's original iOS- and Android-specific APIs, which RN itself leaves unavailable on a platform that is neither. Godot
 * runs the branch RN takes there, so none of them reaches a native module (see docs/research/os-contracts.md):
 * ToastAndroid's constants are 0 and every call warns; PermissionsAndroid's check resolves false, request 'denied'
 * and requestMultiple {}, each after a warning, so on Godot 'denied' and false mean unavailable; DynamicColorIOS,
 * ActionSheetIOS and PushNotificationIOS throw; ProgressBarAndroid and DrawerLayoutAndroid render a plain View
 * around their children and the drawer's methods throw; InputAccessoryView warns and renders null. */
export declare const ToastAndroid: typeof RN.ToastAndroid;
export declare const PermissionsAndroid: typeof RN.PermissionsAndroid;
export declare const DynamicColorIOS: typeof RN.DynamicColorIOS;
export declare const ActionSheetIOS: typeof RN.ActionSheetIOS;
export declare const ProgressBarAndroid: typeof RN.ProgressBarAndroid;
export declare const DrawerLayoutAndroid: typeof RN.DrawerLayoutAndroid;
export declare const InputAccessoryView: typeof RN.InputAccessoryView;
export declare const PushNotificationIOS: typeof RN.PushNotificationIOS;
/** RN's original AccessibilityInfo over Godot's DisplayServer, with iOS's contract: isScreenReaderEnabled,
 * isReduceMotionEnabled, isReduceTransparencyEnabled and isDarkerSystemColorsEnabled resolve the platform's setting,
 * or reject with E_ACCESSIBILITY_UNKNOWN where the platform does not report it (the headless server, mobile today);
 * isBoldTextEnabled, isGrayscaleEnabled, isInvertColorsEnabled and prefersCrossFadeTransitions reject with
 * E_ACCESSIBILITY_UNAVAILABLE, never false. screenReaderChanged (and its alias change), reduceMotionChanged,
 * reduceTransparencyChanged and darkerSystemColorsChanged fire once per change; boldTextChanged, grayscaleChanged,
 * invertColorsChanged and announcementFinished never fire. announceForAccessibility, announceForAccessibilityWithOptions
 * and setAccessibilityFocus throw E_UNSUPPORTED until GF-20's next slice. */
export declare const AccessibilityInfo: typeof RN.AccessibilityInfo;
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
 * createAnimatedComponent over the public View, and Animated.Image over the
 * Godot Image. Animated.Text, ScrollView, FlatList and SectionList fail where
 * they render. */
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
/** fontStyle italic is synthetic (the bundled fonts have no italic face) and the text decoration is solid: a
 * textDecorationStyle other than "solid" fails where the Text renders (docs/research/text-style.md). */
export type TextStyle = ViewStyle & Pick<RN.TextStyle, "fontSize" | "color" | "fontFamily" | "fontWeight" | "lineHeight" | "letterSpacing" | "textAlign" |
  "fontStyle" | "textDecorationLine" | "textDecorationColor"> & { textDecorationStyle?: "solid" };
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
/** The values of RN's accessibilityRole that the host maps to a Godot accessibility role (native/accessibility_core.h).
 * The others, such as "webview" or "adjustable", fail at the host with the reason. */
export type AccessibilityRole = "none" | "button" | "togglebutton" | "imagebutton" | "keyboardkey" | "link" | "checkbox" |
  "radio" | "switch" | "menuitem" | "tab" | "text" | "header" | "image" | "progressbar" | "alert" | "timer" | "list" | "menu" |
  "menubar" | "tablist" | "tabbar" | "radiogroup" | "toolbar" | "viewgroup" | "search";
/** The values of RN's role that the host maps to a Godot accessibility role. */
export type AccessibilityAriaRole = "presentation" | "none" | "button" | "link" | "checkbox" | "radio" | "switch" |
  "menuitem" | "option" | "tab" | "heading" | "img" | "progressbar" | "alert" | "status" | "timer" | "tooltip" | "list" |
  "listitem" | "menu" | "menubar" | "tablist" | "tabpanel" | "dialog" | "alertdialog" | "radiogroup" | "toolbar" | "group" |
  "region" | "banner" | "complementary" | "contentinfo" | "form" | "main" | "navigation";
/** accessibilityState as the host maps it: checked has no "mixed", and a state fails on a role that cannot show it
 * (checked needs checkbox, radio, switch or togglebutton; selected tab, listitem or option; expanded button or menuitem). */
export interface AccessibilityState {
  busy?: boolean; checked?: boolean; disabled?: boolean; expanded?: boolean; selected?: boolean;
}
/** The accessibility props the Godot host maps to the OS's assistive technology: the name, the description, the role,
 * the states, the live region, hidden, and the press of the OS (onAccessibilityTap). The rest of RN's accessibility
 * props, accessibilityActions among them, are not supported: accessibilityActions fails where it renders. */
export interface AccessibilityProps {
  accessible?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  role?: AccessibilityAriaRole;
  accessibilityState?: AccessibilityState;
  accessibilityLiveRegion?: "none" | "polite" | "assertive";
  accessibilityElementsHidden?: boolean;
  importantForAccessibility?: "auto" | "yes" | "no-hide-descendants";
  /** Only the empty list: a custom action fails where the View renders. */
  accessibilityActions?: readonly never[];
  onAccessibilityTap?: () => void;
  "aria-label"?: string;
  "aria-live"?: "off" | "polite" | "assertive";
  "aria-hidden"?: boolean;
  "aria-busy"?: boolean;
  "aria-checked"?: boolean;
  "aria-disabled"?: boolean;
  "aria-expanded"?: boolean;
  "aria-selected"?: boolean;
}
/** What the host gives every View-like element (a View, an Image, an ActivityIndicator, and through the View a Pressable): the
 * identifiers, the layout event, the hit area, and the pointer, click, touch and responder events its input pipeline
 * dispatches. One list, so that the components that share it cannot disagree. */
type HostViewProps = Pick<RN.ViewProps, "testID" | "nativeID" | "onLayout" | "pointerEvents" | "hitSlop" | "collapsable" | "collapsableChildren" |
  "onPointerDown" | "onPointerDownCapture" | "onPointerMove" | "onPointerMoveCapture" |
  "onPointerUp" | "onPointerUpCapture" | "onPointerCancel" | "onPointerCancelCapture" |
  "onPointerOver" | "onPointerOverCapture" | "onPointerOut" | "onPointerOutCapture" |
  "onPointerEnter" | "onPointerEnterCapture" | "onPointerLeave" | "onPointerLeaveCapture" |
  "onGotPointerCapture" | "onGotPointerCaptureCapture" | "onLostPointerCapture" | "onLostPointerCaptureCapture" |
  "onClick" | "onClickCapture" | "onTouchStart" | "onTouchStartCapture" | "onTouchMove" | "onTouchMoveCapture" |
  "onTouchEnd" | "onTouchEndCapture" | "onTouchCancel" | "onTouchCancelCapture" | "onStartShouldSetResponder" |
  "onStartShouldSetResponderCapture" | "onMoveShouldSetResponder" | "onMoveShouldSetResponderCapture" | "onResponderGrant" |
  "onResponderReject" | "onResponderStart" | "onResponderEnd" | "onResponderMove" | "onResponderRelease" | "onResponderTerminate" |
  "onResponderTerminationRequest">;
// An interface, so that a project's opt-in declarations (types/nativewind.ts) can merge into it. Every prop here is one that
// src/prop-scope.mjs classifies as supported for the View. The props it refuses, and the ones it ignores (accessibilityValue,
// focusable, tabIndex, the focus events and the rest), are not declared, and tests/scope-0.5.test.mjs keeps the two in step.
export interface ViewProps extends HostViewProps, Pick<RN.ViewProps, "children" | "id">, AccessibilityProps {
  style?: StyleProp<ViewStyle>;
}
/** Text renders RN's original Text.js (see docs/research/text-original.md). onTextLayout is RN's original event, one
 * entry per visible line (docs/research/text-layout.md); only the outer Text emits it, a nested Text ignores it, as
 * in RN. The outer paragraph presses with onPress, onPressIn, onPressOut and onLongPress (Pressability, with
 * pressRetentionOffset and disabled) and takes the seven responder props RN's TextProps declares (onResponderGrant,
 * onResponderMove, onResponderRelease, onResponderTerminate, onResponderTerminationRequest, onStartShouldSetResponder
 * and onMoveShouldSetResponder); a nested Text fails if it sets any press or responder prop. allowFontScaling,
 * maxFontSizeMultiplier, dynamicTypeRamp and suppressHighlighting are accepted and change nothing: the host's font
 * scale is 1 and nothing highlights outside iOS. selectable, adjustsFontSizeToFit, selectionColor, dataDetectorType,
 * textBreakStrategy, lineBreakStrategyIOS, android_hyphenationFrequency and the head and middle ellipsize modes fail
 * where the Text renders. */
export interface TextProps extends Pick<RN.TextProps, "children" | "testID" | "onLayout" | "numberOfLines" | "nativeID" | "id" | "onTextLayout" |
  "pointerEvents" | "onPointerEnter" | "onPointerLeave" | "onPointerMove" |
  "onPress" | "onPressIn" | "onPressOut" | "onLongPress" | "pressRetentionOffset" | "disabled" | "allowFontScaling" |
  "maxFontSizeMultiplier" | "dynamicTypeRamp" | "suppressHighlighting" | "onResponderGrant" | "onResponderMove" |
  "onResponderRelease" | "onResponderTerminate" | "onResponderTerminationRequest" | "onStartShouldSetResponder" |
  "onMoveShouldSetResponder">, Omit<AccessibilityProps, "onAccessibilityTap" | "aria-live"> {
  style?: StyleProp<TextStyle>; ellipsizeMode?: "tail" | "clip";
}
export type TextLayoutEvent = RN.TextLayoutEvent;
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
export type ActivityIndicatorProps = Pick<RN.ActivityIndicatorProps, "animating" | "color" | "hidesWhenStopped" | "size" | "children"> &
  HostViewProps & Omit<AccessibilityProps, Extract<keyof AccessibilityProps, `aria-${string}`>> & { style?: StyleProp<ViewStyle> };
/** RN's original Image.ios.js behind a validating wrapper, with RN's own native image pipeline (ImageShadowNode, its
 * ImageRequest and the observers) over a host ImageManager that reads and decodes on worker threads. Sources are
 * require()d assets, res://, user://, file:// and data: URIs, and http(s) addresses. tintColor, blurRadius, capInsets and the
 * border radius of the style are drawn as on iOS. loadingIndicatorSource, fadeDuration, progressiveRenderingEnabled,
 * resizeMethod, resizeMultiplier, defaultSource and overlayColor are taken and have no effect, as on iOS. */
export type ImageResizeMode = RN.ImageResizeMode;
export type ImageSourcePropType = RN.ImageSourcePropType;
export type ImageLoadEvent = RN.ImageLoadEvent;
export type ImageErrorEvent = RN.ImageErrorEvent;
export type ImageProgressEventIOS = RN.ImageProgressEventIOS;
export type ImageStyle = Omit<ViewStyle, "overflow"> & Pick<RN.ImageStyle, "resizeMode" | "objectFit" | "overflow" | "tintColor" | "overlayColor">;
export interface ImageProps extends Pick<RN.ImageProps, "source" | "src" | "srcSet" | "alt" | "width" | "height" | "resizeMode" |
  "onLoadStart" | "onLoad" | "onLoadEnd" | "onError" | "onProgress" | "onPartialLoad" | "blurRadius" | "capInsets" | "tintColor" |
  "defaultSource" | "loadingIndicatorSource" | "fadeDuration" | "progressiveRenderingEnabled" | "resizeMethod" | "resizeMultiplier" |
  "crossOrigin" | "referrerPolicy">, HostViewProps, Omit<AccessibilityProps, "aria-live"> { style?: StyleProp<ImageStyle> }
export type ImageBackgroundProps = ImageProps & { children?: React.ReactNode; style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>; imageRef?: React.Ref<NativeInstance> };
export interface ImageStatics {
  getSize(uri: string): Promise<{ width: number; height: number }>;
  getSize(uri: string, success: (width: number, height: number) => void, failure?: (error: unknown) => void): void;
  getSizeWithHeaders(uri: string, headers: { [key: string]: string }): Promise<{ width: number; height: number }>;
  getSizeWithHeaders(uri: string, headers: { [key: string]: string }, success: (width: number, height: number) => void,
    failure?: (error: unknown) => void): void;
  prefetch: typeof RN.Image.prefetch;
  prefetchWithMetadata: typeof RN.Image.prefetchWithMetadata;
  queryCache: typeof RN.Image.queryCache;
  resolveAssetSource: typeof RN.Image.resolveAssetSource;
}
export declare const Image: React.ComponentType<ImageProps & React.RefAttributes<NativeInstance>> & ImageStatics;
export declare const ImageBackground: React.ComponentType<ImageBackgroundProps & React.RefAttributes<NativeInstance>>;
/** RN's AssetRegistry, which the bundled asset modules register their descriptors in. */
export declare const AssetRegistry: typeof RN.AssetRegistry;
/** RN's original Modal with the Godot presentation and lifecycle props. */
export type ModalProps = Pick<RN.ModalProps, "visible" | "transparent" | "onShow" | "onRequestClose" |
  "testID" | "children" | "backdropColor" | "modalRef"> & {
  style?: StyleProp<ViewStyle>;
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
  "testID" | "nativeID" | "onLayout" | "children"> & Omit<AccessibilityProps, "role" | "onAccessibilityTap" | "accessibilityActions"> & { style?: StyleProp<ViewStyle> };
export declare const TouchableOpacity: React.ComponentType<TouchableOpacityProps & React.RefAttributes<NativeInstance>>;
/** RN's original TouchableNativeFeedback.js: Pressability's press props around the single child RN clones. Off Android RN
 * leaves out the drawable, so `background` and `useForeground` are accepted and never reach the host. The statics are
 * RN's own; props this platform has not verified are omitted. */
export type TouchableNativeFeedbackProps = Pick<RN.TouchableNativeFeedbackProps, "background" | "useForeground" | "onPress" |
  "onPressIn" | "onPressOut" | "onLongPress" | "delayLongPress" | "delayPressIn" | "delayPressOut" | "disabled" | "hitSlop" |
  "pressRetentionOffset" | "testID" | "nativeID" | "onLayout" | "children">;
export declare const TouchableNativeFeedback: React.ComponentType<TouchableNativeFeedbackProps> &
  Pick<typeof RN.TouchableNativeFeedback, "SelectableBackground" | "SelectableBackgroundBorderless" | "Ripple" | "canUseNativeForeground">;
/** RN's original Pressable.js over the Godot View: Pressability's press props, and a style that may be a function of
 * `pressed`. It takes the props of the Godot View, with its own press props; the hover handlers, the Android ripple and
 * sound, `testOnly_pressed`, `focusable` and `tabIndex` are not declared (the hover handlers and `testOnly_pressed` fail
 * where the Pressable renders; the Android props, `focusable` and `tabIndex` are accepted and change nothing). */
export interface PressableProps extends Omit<ViewProps, "children" | "style">, Pick<RN.PressableProps, "onPress" | "onPressIn" |
  "onPressOut" | "onLongPress" | "onPressMove" | "delayLongPress" | "disabled" | "pressRetentionOffset" | "unstable_pressDelay" |
  "cancelable" | "blockNativeResponder" | "children"> {
  style?: StyleProp<ViewStyle> | ((state: RN.PressableStateCallbackType) => StyleProp<ViewStyle>);
}
export declare const Pressable: React.ComponentType<PressableProps & React.RefAttributes<NativeInstance>>;
/** The metrics of the window or the screen, as RN's DisplayMetrics: the host reports its window in points, the scale of its
 * display and a fontScale that is always 1. */
export interface ScaledSize { width: number; height: number; scale: number; fontScale: number }
/** What a `change` of the dimensions carries: both sets, as RN's DimensionsPayload. */
export interface DimensionsChange { window: ScaledSize; screen: ScaledSize }
/** RN's original Dimensions state, fed by the host. `set` is RN's native-only entry point and is not declared. */
export declare const Dimensions: {
  get(dimension: "window" | "screen"): ScaledSize;
  addEventListener(type: "change", handler: (change: DimensionsChange) => void): EmitterSubscription;
};
/** React hook over the window's metrics: width, height, scale and fontScale (always 1). */
export declare function useWindowDimensions(): ScaledSize;
/** The platform object: `OS` is "godot", which is neither "ios" nor "android", so `select` picks the `godot` key, then
 * `native`, then `default`; the `ios` and `android` keys are never selected. `constants` has the RN version only: Version,
 * isTV and the rest of RN's Platform are absent. */
export declare const Platform: {
  readonly OS: "godot";
  readonly constants: { readonly reactNativeVersion: { readonly major: number; readonly minor: number; readonly patch: number } };
  select<T>(specifics: { godot?: T; native?: T; default: T }): T;
  select<T>(specifics: { godot?: T; native?: T; default?: T }): T | undefined;
};
/** The styles `StyleSheet.create` takes: a View, Text or Image style, with the literal types of its values kept, so that a
 * `resizeMode: "contain"` written in a sheet still fits an Image. */
export type NamedStyle = ViewStyle | TextStyle | ImageStyle;
export declare const StyleSheet: {
  /** RN's iOS-like constant: 1 on this host. */
  readonly hairlineWidth: number;
  /** An absolutely positioned box over its parent, as RN 0.87.1's. */
  readonly absoluteFill: { readonly position: "absolute"; readonly left: 0; readonly right: 0; readonly top: 0; readonly bottom: 0 };
  create<const T extends Record<string, NamedStyle>>(styles: T): T;
  compose<A, B>(style1: StyleProp<A>, style2: StyleProp<B>): StyleProp<A | B>;
  flatten<T>(style?: StyleProp<T>): T;
};
