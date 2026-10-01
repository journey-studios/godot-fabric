module.exports = {
  content: ["./src/nativewind-app.jsx", "./src/typography-app.jsx"],
  theme: {
    extend: { fontFamily: { sans: ["NotoSans"], mono: ["JetBrainsMono"] } },
  },
  presets: [require("nativewind/preset")],
  corePlugins: { preflight: false },
};
