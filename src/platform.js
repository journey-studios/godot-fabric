// Pressability's platform seam. This is neither a mobile OS nor a browser.
export default {
  OS: "godot",
  constants: { reactNativeVersion: { major: 0, minor: 87, patch: 1 } },
  select: (values) => values.godot ?? values.native ?? values.default,
};
