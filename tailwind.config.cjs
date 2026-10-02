module.exports = {
  content: ["./examples/**/*.{jsx,tsx}"],
  theme: {
    extend: { fontFamily: { sans: ["NotoSans"], mono: ["JetBrainsMono"] } },
  },
  presets: [require("nativewind/preset")],
  corePlugins: { preflight: false },
};
