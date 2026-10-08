import React, { useRef } from "react";
import { AccessibilityInfo, AppRegistry, AppState, Appearance, Linking, Clipboard, Vibration, useColorScheme, RootTagContext, Button, Switch, ActivityIndicator, Modal, SafeAreaView, ScrollView, Text, TextInput, View, UIManager, findNodeHandle, TurboModuleRegistry, NativeModules, NativeEventEmitter, type AppStateEvent, type AppStateStatus, type ColorSchemeName, type ModalProps, type ScrollViewInstance, type ScrollViewProps, type TurboModule, type ViewInstance, type TextInputInstance, ToastAndroid, PermissionsAndroid, DynamicColorIOS, ActionSheetIOS, ProgressBarAndroid, DrawerLayoutAndroid, InputAccessoryView, PushNotificationIOS } from "react-native";
import { FlatList, SectionList, VirtualizedList, VirtualizedSectionList, type ListRenderItem, type SectionListData } from "react-native";
import { Animated, Easing, TouchableOpacity, TouchableNativeFeedback, useAnimatedValue, useAnimatedValueXY, type TouchableOpacityProps, type TouchableNativeFeedbackProps } from "react-native";
import { AssetRegistry, Image, ImageBackground, type ImageProps, type ImageBackgroundProps, type ImageStyle, type ImageLoadEvent, type ImageErrorEvent, type ImageProgressEventIOS, type ImageResizeMode, type ImageSourcePropType } from "react-native";
import { Pressable, useWindowDimensions, type PressableProps } from "react-native";
import { Dimensions, Platform, StyleSheet, type EmitterSubscription, type ScaledSize } from "react-native";
import type { TextInputProps as UpstreamInput, ButtonProps as UpstreamButton } from "../../node_modules/react-native/types_generated/index";
import type { TextInputProps, ButtonProps, SwitchChangeEvent, TextLayoutEvent, ActivityIndicatorProps, ViewStyle, PointerEvent, NativePointerEvent, AccessibilityProps } from "react-native";

const inputProps: TextInputProps = { value: "A😀B", selection: { start: 1, end: 3 }, submitBehavior: "submit" };
const originalInput: UpstreamInput = inputProps;
const buttonProps: ButtonProps = { title: "Save", disabled: false, onPress: () => {} };
const originalButton: UpstreamButton = buttonProps;
void originalInput; void originalButton;
const modalProps: ModalProps = {visible: true, transparent: true, animationType: "none",
  presentationStyle: "overFullScreen", backdropColor: "#101820", testID: "modal", onShow: () => {},
  onRequestClose: () => {}, children: <SafeAreaView testID="modal-content" />};
void modalProps;
// @ts-expect-error Godot currently presents modals without animation
const animatedModal = <Modal animationType="fade" />;
// @ts-expect-error sheet presentation styles are outside the Godot host contract
const sheetModal = <Modal presentationStyle="pageSheet" />;
// @ts-expect-error Android system-window flags are outside this desktop host
const hardwareModal = <Modal hardwareAccelerated />;
void animatedModal; void sheetModal; void hardwareModal;
const scrollViewProps: ScrollViewProps = {
  horizontal: false,
  scrollEventThrottle: 16,
  onScroll: () => {},
};
function ScrollConsumer() {
  const scroll = useRef<ScrollViewInstance>(null);
  scroll.current?.scrollTo({x: 0, y: 40, animated: false});
  scroll.current?.scrollToEnd();
  return <ScrollView ref={scroll} {...scrollViewProps}>
    <ScrollView.Context.Consumer>{value => { void value; return null; }}</ScrollView.Context.Consumer>
  </ScrollView>;
}
void ScrollConsumer;
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
  return <View ref={view}><TextInput {...inputProps} ref={input} /><Button {...buttonProps} />
    <Modal {...modalProps}><SafeAreaView ref={view} testID="safe-area" /></Modal></View>;
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

// RN's original lists keep their upstream props and instance methods.
type Row = { id: string };
function Lists() {
  const list = useRef<FlatList<Row>>(null);
  list.current?.scrollToIndex({ index: 0, animated: false });
  list.current?.scrollToOffset({ offset: 0, animated: false });
  // @ts-expect-error scrollToIndex needs the index to scroll to
  list.current?.scrollToIndex({ animated: false });
  const renderRow: ListRenderItem<Row> = ({ item }) => <View testID={item.id} />;
  const sections: ReadonlyArray<SectionListData<string>> = [{ key: "s", data: ["a"] }];
  return <View>
    <FlatList ref={list} data={[{ id: "a" }]} renderItem={renderRow} keyExtractor={row => row.id} />
    <SectionList sections={sections} renderItem={({ item }) => <View testID={item} />} />
    <VirtualizedList data={3} getItemCount={() => 3} getItem={(_, index) => ({ id: String(index) })}
      renderItem={renderRow} />
  </View>;
}
void Lists; void VirtualizedSectionList;

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

// AppState is the original pinned module and keeps its event contract.
const appState: AppStateStatus | null | undefined = AppState.currentState === "active" ? "active" : null;
const appStateSubscription = AppState.addEventListener("change", (state: AppStateStatus) => { void state; });
const memorySubscription = AppState.addEventListener("memoryWarning", () => {});
const blurEvent: AppStateEvent = "blur";
appStateSubscription.remove(); memorySubscription.remove();
void appState; void blurEvent;
// @ts-expect-error change handlers receive the original AppStateStatus
AppState.addEventListener("change", (state: number) => { void state; });
// @ts-expect-error unknown AppState events are rejected
AppState.addEventListener("suspend", () => {});

// AccessibilityInfo is the original pinned module and keeps its getter and event contract.
const screenReader: Promise<boolean> = AccessibilityInfo.isScreenReaderEnabled();
const reduceMotion: Promise<boolean> = AccessibilityInfo.isReduceMotionEnabled();
const reduceTransparency: Promise<boolean> = AccessibilityInfo.isReduceTransparencyEnabled();
const darkerColors: Promise<boolean> = AccessibilityInfo.isDarkerSystemColorsEnabled();
const boldText: Promise<boolean> = AccessibilityInfo.isBoldTextEnabled();
const recommended: Promise<number> = AccessibilityInfo.getRecommendedTimeoutMillis(3000);
const motionSubscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled: boolean) => { void enabled; });
const aliasSubscription = AccessibilityInfo.addEventListener("change", (enabled: boolean) => { void enabled; });
const announcementSubscription = AccessibilityInfo.addEventListener("announcementFinished", (result: { announcement: string; success: boolean }) => { void result; });
motionSubscription.remove(); aliasSubscription.remove(); announcementSubscription.remove();
AccessibilityInfo.announceForAccessibility("Saved");
void screenReader; void reduceMotion; void reduceTransparency; void darkerColors; void boldText; void recommended;
// @ts-expect-error change handlers receive a boolean
AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled: string) => { void enabled; });
// @ts-expect-error unknown AccessibilityInfo events are rejected
AccessibilityInfo.addEventListener("fontScaleChanged", () => {});

// Linking, Clipboard and Vibration are the original pinned modules.
const initialURL: Promise<string | null | undefined> = Linking.getInitialURL();
const canOpen: Promise<boolean> = Linking.canOpenURL("https://example.com");
const opened: Promise<void> = Linking.openURL("https://example.com");
const urlSubscription = Linking.addEventListener("url", (event: { url: string }) => { void event.url; });
urlSubscription.remove();
void initialURL; void canOpen; void opened;
// @ts-expect-error openURL takes a string
Linking.openURL(42);
// @ts-expect-error Linking only emits url events
Linking.addEventListener("focus", () => {});
const clipboardText: Promise<string> = Clipboard.getString();
Clipboard.setString("copied");
void clipboardText;
// @ts-expect-error setString takes a string
Clipboard.setString(1);
Vibration.vibrate();
Vibration.vibrate(250);
Vibration.vibrate([0, 100, 50, 100], false);
Vibration.cancel();
// @ts-expect-error a vibration pattern is a number or an array of numbers
Vibration.vibrate("long");

// iOS- and Android-specific APIs are the original pinned modules; on Godot they warn, resolve a fixed value or throw.
ToastAndroid.show("Saved", ToastAndroid.SHORT);
ToastAndroid.showWithGravity("Saved", ToastAndroid.LONG, ToastAndroid.TOP);
const cameraGranted: Promise<boolean> = PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
const cameraStatus: Promise<"granted" | "denied" | "never_ask_again"> = PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
void cameraGranted; void cameraStatus;
// @ts-expect-error a permission is one of RN's names
PermissionsAndroid.check("camera");
ActionSheetIOS.showActionSheetWithOptions({ options: ["Cancel"], cancelButtonIndex: 0 }, (index: number) => { void index; });
// @ts-expect-error the options are required
ActionSheetIOS.showActionSheetWithOptions({}, () => {});
const themedColor = DynamicColorIOS({ light: "white", dark: "black" });
void themedColor;
PushNotificationIOS.checkPermissions((permissions) => { const alert: boolean = permissions.alert; void alert; });
const unavailableBar = <ProgressBarAndroid styleAttr="Horizontal" indeterminate={false} progress={0.5} />;
const unavailableDrawer = <DrawerLayoutAndroid drawerPosition="left" drawerWidth={200} renderNavigationView={() => <View />}><View /></DrawerLayoutAndroid>;
const unavailableAccessory = <InputAccessoryView nativeID="accessory"><View /></InputAccessoryView>;
void unavailableBar; void unavailableDrawer; void unavailableAccessory;
// TouchableNativeFeedback: Pressability's press props and RN's own statics.
const feedbackProps: TouchableNativeFeedbackProps = { background: TouchableNativeFeedback.Ripple("#ffffff", false), useForeground: false, onPress: () => {} };
const originalFeedbackProps: import("../../node_modules/react-native/types_generated/index").TouchableNativeFeedbackProps = feedbackProps;
const feedback = <TouchableNativeFeedback {...feedbackProps}><View /></TouchableNativeFeedback>;
const canUseForeground: boolean = TouchableNativeFeedback.canUseNativeForeground();
// @ts-expect-error accessibility props are not verified on this platform
const feedbackAccessibility = <TouchableNativeFeedback accessibilityLabel="Save"><View /></TouchableNativeFeedback>;
void originalFeedbackProps; void feedback; void canUseForeground; void feedbackAccessibility;

// Appearance and useColorScheme are the original pinned modules.
const scheme: ColorSchemeName | null = Appearance.getColorScheme();
Appearance.setColorScheme("unspecified");
const appearanceSubscription = Appearance.addChangeListener(({colorScheme}) => {
  const changed: ColorSchemeName | null = colorScheme;
  void changed;
});
appearanceSubscription.remove();
function ThemedLabel() {
  const colorScheme: ColorSchemeName | null = useColorScheme();
  return <View testID={colorScheme ?? "none"} />;
}
void scheme; void ThemedLabel;
// @ts-expect-error overrides are light, dark, auto or unspecified
Appearance.setColorScheme("sepia");

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

// Public Switch: RN's original props and change event through the facade.
const switchProps: import("react-native").SwitchProps = {
  value: true, disabled: false, thumbColor: "#ffffff", trackColor: {false: "#767577", true: "#81b0ff"},
  ios_backgroundColor: "#3e3e3e", testID: "switch", style: {marginTop: 8},
  onValueChange: value => { const next: boolean = value; void next; },
  onChange: (event: SwitchChangeEvent) => {
    const changed: boolean = event.nativeEvent.value;
    const target: number = event.nativeEvent.target;
    void changed; void target;
  },
};
const originalSwitchProps: import("../../node_modules/react-native/types_generated/index").SwitchProps = switchProps;
const publicSwitch = <Switch {...switchProps} ref={instance => { if (instance) instance.measure(() => {}); }} />;
// @ts-expect-error Switch.js overrides the deprecated iOS tint props
const deprecatedTint = <Switch onTintColor="#00ff00" />;
// @ts-expect-error the value is a boolean
const textValue = <Switch value="on" />;
void originalSwitchProps; void publicSwitch; void deprecatedTint; void textValue;

// Public ActivityIndicator: RN's original props through the facade.
const indicatorProps: ActivityIndicatorProps = {
  animating: true, hidesWhenStopped: false, color: "#0a84ff", size: "large", testID: "spinner", style: {margin: 4},
};
const originalIndicatorProps: import("../../node_modules/react-native/types_generated/index").ActivityIndicatorProps = indicatorProps;
const numericIndicator = <ActivityIndicator size={48} ref={instance => { if (instance) instance.measure(() => {}); }} />;
// @ts-expect-error size is small, large or a number
const invalidIndicatorSize = <ActivityIndicator size="medium" />;
void originalIndicatorProps; void numericIndicator; void invalidIndicatorSize;

// RN's original Animated, Easing and hooks keep their upstream declarations.
function AnimatedConsumer() {
  const opacity: Animated.Value = useAnimatedValue(0);
  const position: Animated.ValueXY = useAnimatedValueXY({x: 0, y: 0});
  const rotate: Animated.Interpolation<string> = opacity.interpolate({inputRange: [0, 1], outputRange: ["0deg", "180deg"]});
  const timing: Animated.CompositeAnimation = Animated.timing(opacity, {toValue: 1, duration: 200,
    easing: Easing.inOut(Easing.quad), useNativeDriver: true});
  const spring = Animated.spring(position, {toValue: {x: 10, y: 20}, stiffness: 200, damping: 20, mass: 1, useNativeDriver: true});
  const decay = Animated.decay(opacity, {velocity: 0.5, deceleration: 0.99, useNativeDriver: false});
  Animated.sequence([timing, Animated.parallel([spring, decay]), Animated.delay(10)]).start(({finished}) => { const done: boolean = finished; void done; });
  Animated.loop(Animated.stagger(30, [timing, spring]), {iterations: 2}).stop();
  opacity.addListener(({value}) => { const next: number = value; void next; });
  opacity.stopAnimation(value => { const last: number = value; void last; });
  const AnimatedBox = Animated.createAnimatedComponent(View);
  return <Animated.View style={{opacity, transform: [{translateX: position.x}, {translateY: position.y}, {rotate}]}}>
    <AnimatedBox style={{opacity}} testID="created" />
  </Animated.View>;
}
// @ts-expect-error useNativeDriver is required by RN's animation configs
Animated.timing(new Animated.Value(0), {toValue: 1, duration: 100});
// @ts-expect-error a value animates to a number, not a string
Animated.timing(new Animated.Value(0), {toValue: "1", duration: 100, useNativeDriver: true});
const easing: typeof Easing.linear = Easing.bezier(0.4, 0, 0.2, 1);
void AnimatedConsumer; void easing;

// TouchableOpacity: Pressability's press props and a Godot View style.
const touchableProps: TouchableOpacityProps = {activeOpacity: 0.4, delayPressOut: 100, disabled: false, testID: "touchable",
  onPress: () => {}, onPressIn: () => {}, onPressOut: () => {}, onLongPress: () => {}, style: {width: 100, height: 40, opacity: 0.9}};
const originalTouchableProps: import("../../node_modules/react-native/types_generated/index").TouchableOpacityProps = touchableProps;
const publicTouchable = <TouchableOpacity {...touchableProps} ref={instance => { if (instance) instance.measure(() => {}); }}><View /></TouchableOpacity>;
// @ts-expect-error the style is the Godot View subset
const touchableShadow = <TouchableOpacity style={{shadowColor: "#000000"}} />;
void originalTouchableProps; void publicTouchable; void touchableShadow;

// Accessibility: the props the host maps to the OS's assistive technology, on View and TouchableOpacity.
const accessibleProps: AccessibilityProps = {accessible: true, accessibilityLabel: "Save", accessibilityHint: "Saves the draft",
  accessibilityRole: "button", accessibilityState: {disabled: false, busy: false, checked: undefined, expanded: true},
  accessibilityLiveRegion: "polite", accessibilityElementsHidden: false, importantForAccessibility: "no-hide-descendants",
  onAccessibilityTap: () => {}, "aria-label": "Save", "aria-live": "off", "aria-hidden": false, "aria-disabled": true};
const accessibleView = <View {...accessibleProps} role="tab" testID="accessible" />;
const touchableAccessibilityProps: Omit<AccessibilityProps, "role" | "onAccessibilityTap"> = {...accessibleProps};
const accessibleTouchable = <TouchableOpacity {...touchableAccessibilityProps} onPress={() => {}} disabled accessibilityRole="switch"
  accessibilityState={{checked: true}} />;
// @ts-expect-error RN's TouchableOpacity forwards accessibilityRole but not role or onAccessibilityTap to its View
const touchableRole = <TouchableOpacity role="button" onAccessibilityTap={() => {}} />;
const ariaSwitch = <View role="switch" aria-checked aria-label="Dark mode" />;
// The platform's props are RN's own types, so a screen-reader label from RN code type-checks unchanged.
const upstreamAccessibility: Pick<import("../../node_modules/react-native/types_generated/index").ViewProps,
  "accessible" | "accessibilityLabel" | "accessibilityHint" | "accessibilityLiveRegion" | "accessibilityElementsHidden"> = accessibleProps;
// @ts-expect-error an unknown role is rejected before it reaches the host
const unknownRole = <View accessibilityRole="banana" />;
// @ts-expect-error webview has no Godot accessibility role, so only the host's explicit error could say so
const rejectedRole = <View accessibilityRole="webview" />;
// @ts-expect-error a table role needs row and column counts, which are not supported
const rejectedAriaRole = <View role="table" />;
// @ts-expect-error heading is a role spelling, not an accessibilityRole
const wrongVocabulary = <View accessibilityRole="heading" />;
// @ts-expect-error Godot's accessibility has no mixed state
const mixedState = <View accessibilityRole="checkbox" accessibilityState={{checked: "mixed"}} />;
// @ts-expect-error custom accessibility actions are not supported yet
const customActions = <View accessibilityActions={[{name: "activate"}]} />;
// @ts-expect-error Godot hides an element only together with its descendants
const hideOnly = <View importantForAccessibility="no" />;
// @ts-expect-error a label is text
const numericLabel = <TouchableOpacity accessibilityLabel={5} />;
// @ts-expect-error the value of the accessibility state is a boolean
const stateNotBoolean = <View accessibilityState={{disabled: "yes"}} />;
// @ts-expect-error a live region is none, polite or assertive
const assertiveOff = <View accessibilityLiveRegion="off" />;
// @ts-expect-error accessibilityValue is not supported yet
const valueProp = <View accessibilityValue={{now: 5}} />;
void accessibleView; void accessibleTouchable; void touchableRole; void ariaSwitch; void upstreamAccessibility; void unknownRole; void rejectedRole;
void rejectedAriaRole; void wrongVocabulary; void mixedState; void customActions; void hideOnly; void numericLabel;
void stateNotBoolean; void assertiveOff; void valueProp;

// Public Image: RN's original Image.ios.js over the Godot pipeline. Sources are assets, res://, user://, file:// and data: URIs.
const mode: ImageResizeMode = "repeat";
const asset: ImageSourcePropType = { uri: "res://pictures/logo.png", width: 40, height: 20 };
const imageStyle: ImageStyle = { width: 60, height: 60, resizeMode: "cover", opacity: 0.9, borderWidth: 2 };
const imageProps: ImageProps = {
  source: asset, resizeMode: mode, style: imageStyle, testID: "logo",
  onLoadStart: () => {},
  onProgress: (event: ImageProgressEventIOS) => { const loaded: number = event.nativeEvent.loaded; const total: number = event.nativeEvent.total; void loaded; void total; },
  onLoad: (event: ImageLoadEvent) => { const uri: string = event.nativeEvent.source.uri; const width: number = event.nativeEvent.source.width; void uri; void width; },
  onError: (event: ImageErrorEvent) => { const message: string = event.nativeEvent.error; void message; },
  onLoadEnd: () => {},
};
const originalImageStyle: import("../../node_modules/react-native/types_generated/index").ImageStyle = imageStyle;
const publicImage = <Image {...imageProps} ref={instance => { if (instance) instance.measure(() => {}); }} />;
const background = <ImageBackground source={asset} imageStyle={{ opacity: 0.5 }} style={{ borderRadius: 8, width: 80, height: 40 }}><View /></ImageBackground>;
const backgroundProps: ImageBackgroundProps = { source: asset, resizeMode: "contain" };
async function imageApis() {
  const size: { width: number; height: number } = await Image.getSize("res://pictures/logo.png");
  Image.getSize("res://pictures/logo.png", (width, height) => { void width; void height; });
  const sized = await Image.getSizeWithHeaders("res://pictures/logo.png", { Accept: "image/png" });
  const resolved = Image.resolveAssetSource(asset);
  const registered: unknown = AssetRegistry.getAssetByID(1);
  void Image.prefetch("res://pictures/logo.png"); void Image.queryCache(["res://pictures/logo.png"]);
  return { size, sized, resolved, registered };
}
const animatedImage = <Animated.Image source={asset} style={{ opacity: 0.5 }} />;
// What the Image draws (the tint, the blur, the cap insets and the radii of its style) and the props iOS ignores are props of the public Image.
const tinted = <Image source={asset} tintColor="#ff0000" blurRadius={4} capInsets={{ top: 1, left: 1, bottom: 1, right: 1 }} />;
const ignored = <Image source={asset} defaultSource={{ uri: "res://pictures/placeholder.png" }} fadeDuration={0} progressiveRenderingEnabled resizeMethod="resize" resizeMultiplier={2} />;
const rounded = <Image source={asset} style={{ borderRadius: 8, borderTopLeftRadius: 2, borderWidth: 1, overflow: "hidden", tintColor: "#00f", overlayColor: "#fff" }} />;
// @ts-expect-error a blur radius is a number
const blurredByText = <Image source={asset} blurRadius="4" />;
// @ts-expect-error resize modes are cover, contain, stretch, center, repeat and none
const invalidMode = <Image source={asset} resizeMode="fill" />;
void originalImageStyle; void publicImage; void background; void backgroundProps; void imageApis; void animatedImage; void tinted; void ignored; void rounded; void blurredByText; void invalidMode;

// Text: onTextLayout is RN's original event, with one entry per visible line.
const layoutHandler = (event: TextLayoutEvent) => {
  const [first] = event.nativeEvent.lines;
  const baseline: number = first.ascender;
  const letters: string = first.text;
  const ink: number = first.capHeight + first.xHeight + first.descender + first.x + first.y + first.width + first.height;
  void baseline; void letters; void ink;
};
const measuredText = <Text numberOfLines={2} onTextLayout={layoutHandler} ref={instance => { if (instance) instance.measure(() => {}); }}>Lines</Text>;
const originalTextProps: import("../../node_modules/react-native/types_generated/index").TextProps = { onTextLayout: layoutHandler };
// @ts-expect-error the handler receives the layout event, not a press
const wrongTextLayout = <Text onTextLayout={(event: PointerEvent) => { void event; }}>Lines</Text>;
// The outer paragraph presses through RN's original Text: the press events, the retention region and disabled.
const pressableText = <Text onPress={() => {}} onPressIn={() => {}} onPressOut={() => {}} onLongPress={() => {}} disabled
  pressRetentionOffset={{ top: 10, left: 10, bottom: 10, right: 10 }} allowFontScaling={false} maxFontSizeMultiplier={1.2}
  dynamicTypeRamp="body" suppressHighlighting>Press</Text>;
// The seven responder props of RN's TextProps, on an outer paragraph: each handler has RN's own signature.
const responderText = <Text onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => false}
  onResponderGrant={event => { void event.nativeEvent.pageX; }} onResponderMove={event => { void event.nativeEvent.locationY; }}
  onResponderRelease={event => { void event.nativeEvent.timestamp; }} onResponderTerminate={() => {}}
  onResponderTerminationRequest={() => true}>Responder</Text>;
// @ts-expect-error a responder handler receives the gesture event, not a layout event
const wrongResponder = <Text onResponderGrant={(event: TextLayoutEvent) => { void event; }}>Responder</Text>;
// @ts-expect-error the Capture, Reject, Start and End variants are not props of RN's TextProps
const captureResponder = <Text onStartShouldSetResponderCapture={() => true}>Responder</Text>;
// @ts-expect-error selection and font fitting are not implemented
const selectableText = <Text selectable adjustsFontSizeToFit>Lines</Text>;
// @ts-expect-error head and middle ellipsizing are not implemented
const middleEllipsis = <Text numberOfLines={1} ellipsizeMode="middle">Lines</Text>;
// @ts-expect-error fontSize is a style, not a prop of RN's Text
const fontSizeProp = <Text fontSize={20}>Lines</Text>;
void measuredText; void originalTextProps; void wrongTextLayout; void pressableText; void responderText; void wrongResponder; void captureResponder; void selectableText; void middleEllipsis; void fontSizeProp;
// The text style the host paints: a synthetic italic and solid lines, in the values RN's own TextStyle declares.
const styledText = <Text style={{ fontStyle: "italic", textDecorationLine: "underline line-through", textDecorationColor: "#ff0000",
  textDecorationStyle: "solid" }}>Styled</Text>;
const resetText = <Text style={[{ textDecorationLine: "underline" }, { textDecorationLine: "none", fontStyle: "normal" }]}>Reset</Text>;
// @ts-expect-error oblique is not a fontStyle of RN's TextStyle
const obliqueText = <Text style={{ fontStyle: "oblique" }}>Lines</Text>;
// @ts-expect-error only solid lines are drawn: dotted, dashed, double and wavy are not implemented
const dottedText = <Text style={{ textDecorationStyle: "dotted" }}>Lines</Text>;
// @ts-expect-error the line is none, underline, line-through or underline line-through, in that order
const overlineText = <Text style={{ textDecorationLine: "overline" }}>Lines</Text>;
void styledText; void resetText; void obliqueText; void dottedText; void overlineText;
// Pressable is RN's original: Pressability's press props, accessibility, and a style that may depend on `pressed`.
const pressableProps: PressableProps = { onPress: () => {}, onPressIn: () => {}, onPressOut: () => {}, onLongPress: () => {},
  delayLongPress: 300, disabled: false, hitSlop: 4, pressRetentionOffset: 8, testID: "press", accessibilityRole: "button",
  style: ({ pressed }) => ({ opacity: pressed ? 0.5 : 1 }) };
const pressable = <Pressable {...pressableProps}><Text>Press</Text></Pressable>;
const staticPressable = <Pressable style={{ padding: 8 }} onPress={() => {}} />;
function WindowSize() {
  const { width, height, scale } = useWindowDimensions();
  void width; void height; void scale;
  return <View />;
}
// @ts-expect-error the Android ripple is outside the Godot Pressable contract
const ripplePressable = <Pressable android_ripple={{ color: "red" }} />;
// @ts-expect-error hover handlers are not verified on this platform
const hoverPressable = <Pressable onHoverIn={() => {}} />;
// className exists only after a project opts in with types/nativewind.ts, which this fixture does not.
// @ts-expect-error className on View
const classView = <View className="p-4" />;
// @ts-expect-error className on Text
const classText = <Text className="text-sm" />;
// @ts-expect-error className on Image
const classImage = <Image source={{ uri: "res://logo.png" }} className="w-8" />;
// @ts-expect-error className on Pressable
const classPressable = <Pressable className="p-2" />;
void pressable; void staticPressable; void WindowSize; void ripplePressable; void hoverPressable; void classView; void classText; void classImage; void classPressable;

// The utilities of the 0.5 scope (docs/compatibility/scope-0.5.json): Platform, Dimensions, useWindowDimensions and StyleSheet.
// Platform.OS is "godot": the first line is the whole OS test, and the other two systems are not names of it.
const platformIsGodot: boolean = Platform.OS === "godot";
const pickedNumber: number = Platform.select({ godot: 1, native: 2, default: 3 });
const pickedOptional: string | undefined = Platform.select({ native: "native" });
const reactNativeMinor: number = Platform.constants.reactNativeVersion.minor;
// @ts-expect-error "ios" is not the OS of this platform
const platformIsIOS = Platform.OS === "ios";
// @ts-expect-error the ios key of select is never selected
const iosKey = Platform.select({ ios: 1, default: 2 });
// @ts-expect-error Version is not part of the Godot Platform
const platformVersion = Platform.Version;
void platformIsGodot; void pickedNumber; void pickedOptional; void reactNativeMinor; void platformIsIOS; void iosKey; void platformVersion;
// Dimensions: get takes window or screen, and the change handler may destructure what it receives.
const windowSize: ScaledSize = Dimensions.get("window");
const screenScale: number = Dimensions.get("screen").scale;
const dimensionsSubscription: EmitterSubscription = Dimensions.addEventListener("change", ({ window, screen }) => {
  const width: number = window.width; const fontScale: number = screen.fontScale;
  void width; void fontScale;
});
dimensionsSubscription.remove();
// @ts-expect-error only window and screen exist
const displaySize = Dimensions.get("display");
// @ts-expect-error the change handler receives { window, screen }, not a number
const wrongHandler = Dimensions.addEventListener("change", (change: number) => { void change; });
// @ts-expect-error change is the only event
const resizeEvent = Dimensions.addEventListener("resize", () => {});
void windowSize; void screenScale; void displaySize; void wrongHandler; void resizeEvent;
function Metrics() {
  const metrics: ScaledSize = useWindowDimensions();
  // @ts-expect-error the host reports no densityDpi
  const density = metrics.densityDpi;
  void density;
  return <View />;
}
// StyleSheet.create keeps the literal types of the values, so a sheet entry fits an Image, a Text and a View.
const sheet = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: "#000000" },
  picture: { width: 24, height: 24, resizeMode: "contain" },
  label: { color: "#ffffff", fontSize: 12, textAlign: "center" },
  box: { flex: 1, position: "absolute", transform: [{ translateX: 4 }] },
});
const sheetView = <View style={[sheet.root, sheet.box]}>
  <Image source={{ uri: "res://logo.png" }} style={sheet.picture} /><Text style={sheet.label}>Label</Text>
</View>;
const composedStyle = StyleSheet.compose(sheet.box, sheet.root);
const flatStyle = StyleSheet.flatten([sheet.box, sheet.root]);
const thinLine: number = StyleSheet.hairlineWidth;
// @ts-expect-error a style outside the Godot subset
const shadowSheet = StyleSheet.create({ shadow: { shadowColor: "#000000" } });
void Metrics; void sheetView; void composedStyle; void flatStyle; void thinLine; void shadowSheet;
