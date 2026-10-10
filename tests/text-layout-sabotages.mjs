// The retained sabotages of scripts/text-layout-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
const file = "native/paragraph_layout.cpp";
export const SABOTAGES = [
  {name: "all-lines", argument: "--sabotage=all-lines", hostDirectory: "build/text-layout-sabotage-all-lines-host", file,
    find: "    return lines_of(prepare(text.getValue(), props, size.width));",
    replace: "    auto unlimited = props;\n    unlimited.maximumNumberOfLines = 0;\n    return lines_of(prepare(text.getValue(), unlimited, size.width));"},
  {name: "no-centering", argument: "--sabotage=no-centering", hostDirectory: "build/text-layout-sabotage-no-centering-host", file,
    find: "    const float ascender = line.y - line.top;",
    replace: "    const float ascender = line.ascent;"},
  {name: "sentinel", argument: "--sabotage=sentinel", hostDirectory: "build/text-layout-sabotage-sentinel-host", file,
    find: "lines.emplace_back(std::string(full.substr(line.start, line.end - line.start).utf8().get_data()),",
    replace: "lines.emplace_back(std::string((full + String::chr(0x200B)).substr(line.start, line.end - line.start + (line.end == full.length() ? 1 : 0)).utf8().get_data()),"},
];
