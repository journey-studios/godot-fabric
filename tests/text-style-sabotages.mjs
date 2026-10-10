// The retained sabotages of scripts/text-style-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
const layout = "native/paragraph_layout.cpp";
const facade = "src/react-native-platform.jsx";
export const SABOTAGES = [
  {name: "decoration-above", argument: "--sabotage=decoration-above", file: layout, native: true,
    find: "add(false, line.y + run.font->get_underline_position(run.size));",
    replace: "add(false, line.y - run.font->get_underline_position(run.size));"},
  {name: "color-ignored", argument: "--sabotage=color-ignored", file: layout, native: true,
    find: "auto decoration = a.textDecorationColor ? color(a.textDecorationColor) : ink;",
    replace: "auto decoration = ink;"},
  {name: "inherit", argument: "--sabotage=inherit", file: facade,
    find: "  return <GodotText {...props} style={flat} />;",
    replace: "  const { textDecorationLine, ...inherited } = flat;\n" +
      '  return <GodotText {...props} style={textDecorationLine === "none" ? inherited : flat} />;'},
  {name: "whole-line", argument: "--sabotage=whole-line", file: layout, native: true,
    find: "    for (const auto &group : painted_groups(rows[row], false)) {\n",
    replace: "    for (auto group : painted_groups(rows[row], false)) {\n" +
      "      group.x0 = line.x;\n      group.x1 = line.x + line.width;\n"},
  {name: "skew-sign", argument: "--sabotage=skew-sign", file: layout, native: true,
    find: "constexpr float ITALIC_SKEW = 0.25f;", replace: "constexpr float ITALIC_SKEW = -0.25f;"},
  {name: "facade-dotted", argument: "--sabotage=facade-dotted", file: facade,
    find: '["textDecorationStyle", { values: ["solid"], hint: "only solid" }],',
    replace: '["textDecorationStyle", { values: ["solid", "dotted"], hint: "only solid" }],'},
  {name: "ellipsis-run", argument: "--sabotage=ellipsis-run", file: layout, native: true,
    find: "  paint(ts->shaped_text_get_ellipsis_glyphs(line.rid), -1, true);",
    replace: "  run = 0;\n  paint(ts->shaped_text_get_ellipsis_glyphs(line.rid), -1, true);"},
  {name: "guard", argument: "--sabotage=guard", file: layout, native: true,
    find: "  if (a.fontStyle == rn::FontStyle::Oblique) {\n" +
      '    throw std::runtime_error("Godot Text does not implement style fontStyle " + rn::toString(*a.fontStyle) +\n' +
      '        ": use normal or italic");\n' +
      "  }\n" +
      "  if (a.textDecorationStyle.has_value() && *a.textDecorationStyle != rn::TextDecorationStyle::Solid) {\n" +
      '    throw std::runtime_error("Godot Text does not implement style textDecorationStyle " +\n' +
      '        rn::toString(*a.textDecorationStyle) + ": only solid");\n' +
      "  }\n",
    replace: "  (void)a;\n"},
];
