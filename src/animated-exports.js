// Godot's variant of RN's AnimatedExports, which RN's own Animated.js requires.
// The implementation (values, animations, composition, events, nodes and the
// native helper) and Animated.View are RN's original modules. RN's wrappers
// over components this platform renders differently, or does not render yet,
// fail where they render instead of animating the wrong component.
import Platform from "./platform";
import AnimatedImplementation from "react-native/Libraries/Animated/AnimatedImplementation";
import AnimatedMock from "react-native/Libraries/Animated/AnimatedMock";
import AnimatedView from "react-native/Libraries/Animated/components/AnimatedView";

function uncertified(name, reason) {
  return function UncertifiedGodotAnimatedComponent() {
    throw new Error(`Godot platform has not certified Animated.${name}: ${reason}`);
  };
}
// RN builds these over its own Text, ScrollView, FlatList and SectionList. The
// Godot ones are other components, and a wrapper over them is not verified yet.
const Text = uncertified("Text", "it wraps RN's own Text, not the Godot Text");
const ScrollView = uncertified("ScrollView",
  "it wraps RN's own ScrollView, not the Godot ScrollView, and Animated.event on that one is not verified");
const FlatList = uncertified("FlatList", "its animated wrapper over the Godot ScrollView is not verified");
const SectionList = uncertified("SectionList", "its animated wrapper over the Godot ScrollView is not verified");
const Image = uncertified("Image", "Image is not implemented");

const Animated = Platform.isDisableAnimations ? AnimatedMock : AnimatedImplementation;

export default {
  get FlatList() {
    return FlatList;
  },
  get Image() {
    return Image;
  },
  get ScrollView() {
    return ScrollView;
  },
  get SectionList() {
    return SectionList;
  },
  get Text() {
    return Text;
  },
  get View() {
    return AnimatedView;
  },
  ...Animated,
};
