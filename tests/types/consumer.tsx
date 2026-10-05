import React, { useRef } from "react";
import { AppRegistry, RootTagContext, Button, TextInput, View, UIManager, findNodeHandle, TurboModuleRegistry, NativeModules, NativeEventEmitter, type TurboModule, type ViewInstance, type TextInputInstance } from "react-native";
import type { TextInputProps as UpstreamInput, ButtonProps as UpstreamButton } from "../../node_modules/react-native/types_generated/index";
import type { TextInputProps, ButtonProps, ViewStyle, PointerEvent, NativePointerEvent } from "react-native";

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
  TextInput.State.focusTextInput(input.current);
  TextInput.State.blurTextInput(input.current);
  const focused: ViewInstance | null = TextInput.State.currentlyFocusedInput();
  const focusedTag: number | null = TextInput.State.currentlyFocusedField();
  void focused; void focusedTag;
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
// @ts-expect-error focus accepts a public input instance, not a legacy tag
TextInput.State.focusTextInput(42);
// @ts-expect-error internal registry management is not the public State API
TextInput.State.registerInput(null);
// @ts-expect-error the singleton may hold an internal input without public clear
TextInput.State.currentlyFocusedInput()?.clear();

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

// DOM traversal comes from the original pinned public instance types.
function readTree(element: ViewInstance) {
  const identifier: string = element.id;
  const name: string = element.nodeName;
  const type: number = element.nodeType;
  const child = element.firstChild;
  const following = child?.nextSibling;
  const parent = child?.parentElement;
  const found = element.ownerDocument?.getElementById(identifier);
  const hasChildren: boolean = element.hasChildNodes();
  const elementCount: number = element.childElementCount;
  return {name, type, following, parent, found, hasChildren, elementCount};
}
const identified = <View id="jsx-id" nativeID="native-id" />;
// @ts-expect-error Native IDs use the original string contract
const invalidIdentifier = <View id={42} />;
void readTree; void identified; void invalidIdentifier;

function capturePointer(instance: ViewInstance, event: PointerEvent) {
  const native: NativePointerEvent = event.nativeEvent;
  const id: number = event.nativeEvent.pointerId;
  const pointerType: string = event.nativeEvent.pointerType;
  instance.setPointerCapture(id);
  const captured: boolean = instance.hasPointerCapture(id);
  instance.releasePointerCapture(id);
  return {captured, pointerType, native};
}
const pointerProps: import("react-native").ViewProps = {
  onPointerDown: event => { const id: number = event.nativeEvent.pointerId; void id; },
  onPointerMoveCapture: event => { const x: number = event.nativeEvent.clientX; void x; },
  onPointerUp: () => {}, onPointerCancel: () => {}, onPointerOver: () => {},
  onPointerOutCapture: () => {}, onPointerEnter: () => {}, onPointerLeaveCapture: () => {},
  onGotPointerCapture: () => {}, onLostPointerCaptureCapture: () => {},
};
const originalPointerProps: import("../../node_modules/react-native/types_generated/index").ViewProps = pointerProps;
const pointerView = <View {...pointerProps} ref={instance => { if (instance) instance.hasPointerCapture(1); }} />;
// @ts-expect-error original capture methods require a numeric pointer ID
const invalidPointerId = (instance: ViewInstance) => instance.setPointerCapture("mouse");
// @ts-expect-error original PointerEvent keeps coordinates numeric
const invalidPointerPosition = (event: import("react-native").PointerEvent): string => event.nativeEvent.clientX;
void capturePointer; void originalPointerProps; void pointerView; void invalidPointerId; void invalidPointerPosition;
