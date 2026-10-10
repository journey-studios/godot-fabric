// The retained sabotages of scripts/text-original-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
export const SABOTAGES = [
  {name: "register", argument: "--sabotage=register", file: "src/text.jsx",
    find: 'import OriginalText from "react-native/Libraries/Text/Text";',
    replace: 'import { register } from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";\n' +
      'import { controlViewConfig } from "./components";\n' +
      'import OriginalText from "react-native/Libraries/Text/Text";\n' +
      'const own = (name, extra) => register(name, () => ({ ...controlViewConfig, uiViewClassName: name, ...extra }));\n' +
      'own("RCTText", {});\nown("RCTVirtualText", {});'},
  {name: "style", argument: "--sabotage=style", file: "src/base-view-config.js",
    find: "    style: platformStyle,\n", replace: ""},
  {name: "ancestor", argument: "--sabotage=ancestor", file: "src/text.jsx",
    find: 'import TextAncestorContext from "react-native/Libraries/Text/TextAncestorContext";',
    replace: "const TextAncestorContext = React.createContext(false);"},
  {name: "span-press", argument: "--sabotage=span-press", file: "src/text.jsx",
    find: "    for (const name of Object.keys(props)) {\n      if (isSpanPressProp(name) && props[name] != null) {\n" +
      "        throw new Error(`Godot Text does not implement ${name} on a nested Text: only the outer paragraph is pressable`);\n" +
      "      }\n    }\n", replace: ""},
  {name: "default", argument: "--sabotage=default", file: "src/text.jsx",
    find: "const DEFAULT_FONT_SIZE = 18;", replace: "const DEFAULT_FONT_SIZE = 14;"},
  {name: "guard", argument: "--sabotage=guard", file: "native/paragraph_layout.cpp", native: true,
    find: "  if (props.ellipsizeMode == rn::EllipsizeMode::Head || props.ellipsizeMode == rn::EllipsizeMode::Middle)\n" +
      '    throw std::runtime_error("Godot Text supports tail or clip ellipsizeMode");\n' +
      "  if (props.adjustsFontSizeToFit)\n" +
      '    throw std::runtime_error("Godot Text does not implement adjustsFontSizeToFit");\n', replace: ""},
];
