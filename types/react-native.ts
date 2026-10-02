import type * as React from "react";
import type * as RN from "../node_modules/react-native/types_generated/index";

/** The implemented Godot subset, derived from the pinned RN declarations. */
export type ViewStyle = Pick<RN.ViewStyle,
  "width" | "height" | "minWidth" | "minHeight" | "maxWidth" | "maxHeight" |
  "flex" | "flexGrow" | "flexShrink" | "flexBasis" | "flexDirection" | "flexWrap" |
  "justifyContent" | "alignItems" | "alignSelf" | "alignContent" | "gap" | "rowGap" | "columnGap" |
  "padding" | "paddingHorizontal" | "paddingVertical" | "paddingLeft" | "paddingRight" | "paddingTop" | "paddingBottom" |
  "margin" | "marginHorizontal" | "marginVertical" | "marginLeft" | "marginRight" | "marginTop" | "marginBottom" |
  "position" | "top" | "left" | "bottom" | "right" | "display" | "opacity" | "zIndex" | "overflow" |
  "backgroundColor" | "borderColor" | "borderWidth" | "borderTopWidth" | "borderRightWidth" | "borderBottomWidth" |
  "borderLeftWidth" | "borderRadius" | "borderTopLeftRadius" | "borderTopRightRadius" | "borderBottomLeftRadius" | "borderBottomRightRadius">;
export type TextStyle = ViewStyle & Pick<RN.TextStyle, "fontSize" | "color" | "fontFamily" | "fontWeight" | "lineHeight" | "letterSpacing" | "textAlign">;
export type InputStyle = ViewStyle & Pick<RN.TextStyle, "fontSize"> & { color?: string };
export type StyleProp<T> = RN.StyleProp<T>;
export type NativeInstance = Pick<RN.TextInputInstance, "focus" | "blur" | "isFocused" | "measure" | "measureInWindow">;
export interface TextInputInstance extends NativeInstance, Pick<RN.TextInputInstance, "clear" | "setSelection"> {
  getNativeRef(): TextInputInstance | null;
}
export type ViewProps = Pick<RN.ViewProps, "children" | "testID" | "onLayout" | "pointerEvents"> & { style?: StyleProp<ViewStyle> };
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
