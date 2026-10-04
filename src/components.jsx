import React, {
  useState,
  useRef,
  useLayoutEffect,
  useCallback,
  useMemo,
} from "react";
import { register } from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";

import usePressability from "react-native/Libraries/Pressability/usePressability";
import processColor from "react-native/Libraries/StyleSheet/processColor";
import { getInternalInstanceHandleFromPublicInstance } from "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactFabricPublicInstance";
import TextInputState from "./text-input-state";

import { controlViewConfig } from "./base-view-config";
export { controlViewConfig };

export const NativeControl = register("GodotControl", () => controlViewConfig);
export function View(props) {
  return <NativeControl {...props} kind="view" />;
}
export function Text({ children, text, ...props }) {
  if (children !== undefined && text !== undefined)
    throw new Error("Text accepts children or text, not both");
  const values =
    children === undefined ? [text ?? ""] : React.Children.toArray(children);
  if (
    values.some(
      (value) => typeof value !== "string" && typeof value !== "number",
    )
  )
    throw new Error(
      "Godot Text currently accepts plain strings/numbers; rich text is not implemented",
    );
  return <NativeControl {...props} text={values.join("")} kind="text" />;
}
export function Button(props) {
  return <NativeControl {...props} kind="button" />;
}
export function TextInput({
  ref,
  value,
  text,
  defaultValue = "",
  selection,
  editable = true,
  disabled = false,
  placeholder = "",
  submitBehavior = "blurAndSubmit",
  multiline = false,
  onChange,
  onChangeText,
  onSelectionChange,
  onFocus,
  onBlur,
  ...props
}) {
  if (value !== undefined && text !== undefined)
    throw new Error(
      "TextInput accepts value or the legacy text prop, not both",
    );
  if (multiline)
    throw new Error("Godot TextInput currently supports a single line");
  if (!["submit", "blurAndSubmit"].includes(submitBehavior))
    throw new Error("TextInput submitBehavior must be submit or blurAndSubmit");
  const controlled = value ?? text;
  if (
    (controlled !== undefined && typeof controlled !== "string") ||
    typeof defaultValue !== "string"
  )
    throw new Error("TextInput value/text/defaultValue must be strings");
  if (
    selection &&
    (!Number.isInteger(selection.start) ||
      selection.start < 0 ||
      (selection.end !== undefined &&
        (!Number.isInteger(selection.end) || selection.end < 0)))
  )
    throw new Error("TextInput selection uses nonnegative UTF-16 offsets");
  const initial = useRef(controlled ?? defaultValue);
  const native = useRef(null);
  const ownedInput = useRef(null);
  const [eventCount, acknowledge] = useState(0);
  const [nativeSelection, observeSelection] = useState(null);
  const attach = useCallback(
    (instance) => {
      native.current = instance;
      if (instance && ownedInput.current !== instance) {
        if (ownedInput.current) {
          TextInputState.blurInput(ownedInput.current);
          TextInputState.unregisterInput(ownedInput.current);
        }
        ownedInput.current = instance;
        Object.defineProperty(instance, "currentProps", {
          configurable: true,
          get() {
            const handle = getInternalInstanceHandleFromPublicInstance(instance);
            const props = handle?.stateNode?.canonical?.currentProps ?? {};
            const metrics = instance.getNativeMetrics();
            // RN's canonical props can be updated during a speculative render.
            // Eligibility follows the committed native editability/lifetime;
            // a retired or temporarily detached input cannot claim focus.
            return { ...props, editable: instance.isConnected &&
              metrics?.insideTree === true && metrics.editable === true };
          },
        });
        instance.isFocused = () => TextInputState.currentlyFocusedInput() === instance;
        TextInputState.registerInput(instance);
      }
      let cleanup;
      if (typeof ref === "function") cleanup = ref(instance);
      else if (ref) ref.current = instance;
      return () => {
        native.current = null;
        if (typeof cleanup === "function") cleanup();
        else if (typeof ref === "function") ref(null);
        else if (ref) ref.current = null;
      };
    },
    [ref],
  );
  useLayoutEffect(() => () => {
    if (ownedInput.current) {
      TextInputState.blurInput(ownedInput.current);
      TextInputState.unregisterInput(ownedInput.current);
      ownedInput.current = null;
    }
  }, []);
  useLayoutEffect(() => {
    if (controlled === undefined && selection === undefined) return;
    native.current?.setTextAndSelection(
      eventCount,
      controlled ?? null,
      selection?.start ?? -1,
      selection?.end ?? selection?.start ?? -1,
    );
  }, [
    eventCount,
    controlled,
    selection?.start,
    selection?.end,
    nativeSelection?.start,
    nativeSelection?.end,
  ]);
  return (
    <NativeControl
      {...props}
      ref={attach}
      kind="input"
      text={controlled ?? initial.current}
      disabled={disabled || !editable}
      placeholder={placeholder}
      submitBehavior={submitBehavior}
      onFocus={(event) => {
        TextInputState.focusInput(native.current);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        TextInputState.blurInput(native.current);
        onBlur?.(event);
      }}
      onSelectionChange={(event) => {
        onSelectionChange?.(event);
        observeSelection(event.nativeEvent.selection);
      }}
      onChange={(event) => {
        onChange?.(event);
        onChangeText?.(event.nativeEvent.text);
        // Updating the acknowledgement also rerenders a controlled input whose
        // owner rejects an edit by leaving its value unchanged.
        acknowledge(event.nativeEvent.eventCount);
      }}
    />
  );
}

// This wrapper supplies Godot's View and React's pressed render state. The
// responder handlers, geometry, delays and transitions are upstream Pressability.
export function Pressable({
  children,
  style,
  disabled = false,
  hitSlop,
  pressRetentionOffset,
  delayLongPress,
  unstable_pressDelay,
  cancelable,
  blockNativeResponder,
  onPress,
  onPressMove,
  onPressIn,
  onPressOut,
  onLongPress,
  onHoverIn,
  onHoverOut,
  ...props
}) {
  if (onHoverIn || onHoverOut)
    throw new Error("Godot Pressable hover events are not implemented yet");
  const [pressed, setPressed] = useState(false);
  const config = useMemo(
    () => ({
      disabled,
      hitSlop,
      pressRectOffset: pressRetentionOffset,
      delayLongPress,
      delayPressIn: unstable_pressDelay,
      cancelable,
      blockNativeResponder,
      onPress,
      onPressMove,
      onLongPress,
      onPressIn(event) {
        setPressed(true);
        onPressIn?.(event);
      },
      onPressOut(event) {
        setPressed(false);
        onPressOut?.(event);
      },
    }),
    [
      disabled,
      hitSlop,
      pressRetentionOffset,
      delayLongPress,
      unstable_pressDelay,
      cancelable,
      blockNativeResponder,
      onPress,
      onPressMove,
      onPressIn,
      onPressOut,
      onLongPress,
    ],
  );
  const handlers = usePressability(config);
  // Hover/click activation needs a desktop/accessibility adapter. Never pretend
  // those paths work by registering callbacks that native input cannot emit.
  const { onMouseEnter, onMouseLeave, onClick, ...responderHandlers } =
    handlers;
  return (
    <View
      {...props}
      {...responderHandlers}
      disabled={disabled}
      hitSlop={hitSlop}
      style={typeof style === "function" ? style({ pressed }) : style}
    >
      {typeof children === "function" ? children({ pressed }) : children}
    </View>
  );
}
