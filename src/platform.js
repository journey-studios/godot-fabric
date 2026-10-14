import ReactNativeVersion from "react-native/Libraries/Core/ReactNativeVersion";

// Pressability's platform seam. This is neither a mobile OS nor a browser.
export default {
  OS: "godot",
  // From RN's own ReactNativeVersion (the one the facade exports), not a copy; the shape has no prerelease.
  constants: { reactNativeVersion: { major: ReactNativeVersion.major, minor: ReactNativeVersion.minor, patch: ReactNativeVersion.patch } },
  select: (values) => values.godot ?? values.native ?? values.default,
};
