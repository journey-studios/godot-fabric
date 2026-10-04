import React, { useRef } from "react";
import { AppRegistry, RootTagContext, Button, TextInput, View, UIManager, findNodeHandle, TurboModuleRegistry, NativeModules, NativeEventEmitter, type TurboModule, type ViewInstance, type TextInputInstance } from "react-native";
import type { TextInputProps as UpstreamInput, ButtonProps as UpstreamButton } from "../../node_modules/react-native/types_generated/index";
import type { TextInputProps, ButtonProps, ViewStyle } from "react-native";

const inputProps: TextInputProps = { value: "A😀B", selection: { start: 1, end: 3 }, submitBehavior: "submit" };
const originalInput: UpstreamInput = inputProps;
const buttonProps: ButtonProps = { title: "Save", disabled: false, onPress: () => {} };
const originalButton: UpstreamButton = buttonProps;
void originalInput; void originalButton;
const transformStyle: ViewStyle = {
  transform: [{translateX: "25%"}, {scaleX: 2}, {rotate: "45deg"}, {skewY: "10deg"}],
  transformOrigin: [20, "75%", 0],
};
const cssTransformStyle: ViewStyle = {transform: "translateX(24px) rotate(90deg)", transformOrigin: "left top"};
// Recognition uses upstream types; 3D still requires native acceptance.
const parsed3DStyle: ViewStyle = {transform: [{rotateX: "45deg"}, {perspective: 800}]};
const upstreamTransformStyle: import("../../node_modules/react-native/types_generated/index").ViewStyle = transformStyle;
void cssTransformStyle; void parsed3DStyle; void upstreamTransformStyle;
// @ts-expect-error a transform operation cannot use an unknown field
const invalidTransform: ViewStyle = {transform: [{warp: 10}]};
// @ts-expect-error transform origin arrays have exactly three entries
const invalidOrigin: ViewStyle = {transformOrigin: [20, "75%"]};
// @ts-expect-error unrelated unsupported View styles remain outside the public subset
const unsupportedFilter: ViewStyle = {filter: "blur(2px)"};
void invalidTransform; void invalidOrigin; void unsupportedFilter;
function Consumer() {
  const view = useRef<ViewInstance>(null);
  view.current?.measureLayout(view.current, (x, y, width, height) => { void x; void y; void width; void height; });
  view.current?.getBoundingClientRect();
  view.current?.setNativeProps({ style: { width: 100 } });
  const nativeTag = findNodeHandle(view.current);
  if (nativeTag != null) UIManager.measureInWindow(nativeTag, (x, y) => { void x; void y; });
  const input = useRef<TextInputInstance>(null);
  input.current?.clear(); input.current?.setSelection(1, 3);
  return <View ref={view}><TextInput {...inputProps} ref={input} /><Button {...buttonProps} /></View>;
}
// Unsupported contracts must fail type checking; these directives fail if that changes.
// @ts-expect-error multiline is not implemented
const multiline = <TextInput multiline />;
// @ts-expect-error mobile keyboard contracts are not implemented
const keyboard = <TextInput keyboardType="email-address" />;
// @ts-expect-error legacy props are not the public Button API
const legacyButton = <Button text="Save" onActivate={() => {}} />;
// @ts-expect-error public Button requires a string title
const invalidTitle = <Button title={12} />;
// @ts-expect-error unsupported Input font features must not type-check
const weight = <TextInput style={{ fontWeight: "bold" }} />;
// @ts-expect-error input color currently accepts static strings only
const dynamicColor = <TextInput style={{ color: {} }} />;
void dynamicColor; void multiline; void keyboard; void legacyButton; void invalidTitle; void weight;

void Consumer;
AppRegistry.registerComponent("Consumer", () => Consumer);
const keys: readonly string[] = AppRegistry.getAppKeys();
const rootTag = React.useContext(RootTagContext);
void keys; void rootTag;
// @ts-expect-error sections are outside the implemented registry subset
AppRegistry.registerComponent("Section", () => Consumer, true);
// @ts-expect-error native application owns mounting; this is not the full registry
AppRegistry.runApplication("Consumer", { rootTag: 1 });

interface NativeSpec extends TurboModule { add(a: number, b: number): number; }
const nativeModule = TurboModuleRegistry.get<NativeSpec>("GodotFabricNativeFixture");
const nativeSum: number | undefined = nativeModule?.add(1, 2);
const nativeEmitter = new NativeEventEmitter(NativeModules.GodotFabricNativeFixture);
const nativeSubscription = nativeEmitter.addListener("GodotFabricFixtureValue", () => {});
nativeSubscription.remove();
void nativeSum;
