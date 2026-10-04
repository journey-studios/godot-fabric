import type * as React from "react";
import type * as RN from "../node_modules/react-native/types_generated/index";

export declare const AppRegistry: Pick<typeof RN.AppRegistry, "getAppKeys"> & {
  registerComponent(key: Parameters<typeof RN.AppRegistry.registerComponent>[0],
    provider: Parameters<typeof RN.AppRegistry.registerComponent>[1]): string;
};
export declare const RootTagContext: typeof RN.RootTagContext;
export declare const NativeModules: typeof RN.NativeModules;
export declare const NativeEventEmitter: typeof RN.NativeEventEmitter;
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
export type NativeInstance = Pick<RN.TextInputInstance, "focus" | "blur" | "isFocused" | "measure" | "measureInWindow" | "setNativeProps" |
  "getBoundingClientRect" | "isConnected" | "parentNode" | "childNodes" | "children" |
  "ownerDocument" | "getRootNode" | "contains" | "compareDocumentPosition" | "textContent" |
  "offsetWidth" | "offsetHeight" | "offsetLeft" | "offsetTop" | "offsetParent" |
  "clientWidth" | "clientHeight" | "scrollWidth" | "scrollHeight" | "scrollLeft" | "scrollTop"> & {
  measureLayout(relative: number | NativeInstance,
    onSuccess: Parameters<RN.ViewInstance["measureLayout"]>[1], onFail?: () => void): void;
};
export type ViewInstance = NativeInstance;
export declare const findNodeHandle: typeof RN.findNodeHandle;
export declare const UIManager: Pick<typeof RN.UIManager, "measure" | "measureInWindow" | "measureLayout">;
export interface TextInputInstance extends NativeInstance, Pick<RN.TextInputInstance, "clear" | "setSelection"> {
  getNativeRef(): TextInputInstance | null;
}
export type ViewProps = Pick<RN.ViewProps, "children" | "testID" | "onLayout" | "pointerEvents" | "collapsable" | "collapsableChildren"> & { style?: StyleProp<ViewStyle> };
export type TextProps = Pick<RN.TextProps, "children" | "testID" | "onLayout" | "numberOfLines"> & {
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
export declare const View: React.ComponentType<ViewProps & React.RefAttributes<NativeInstance>>;
export declare const Text: React.ComponentType<TextProps & React.RefAttributes<NativeInstance>>;
export declare const TextInput: React.ComponentType<TextInputProps & React.RefAttributes<TextInputInstance>>;
export declare const Button: React.ComponentType<ButtonProps & React.RefAttributes<NativeInstance>>;
export declare const StyleSheet: {
  hairlineWidth: number;
  create<T extends Record<string, TextStyle>>(styles: T): T;
  flatten(style: StyleProp<TextStyle>): TextStyle;
};
