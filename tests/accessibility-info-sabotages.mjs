// The retained sabotages of scripts/accessibility-info-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
const table = "native/accessibility_info_core.h";
// The announcements' pure core, where the four sabotages of the announcements are made.
const announcements = "native/accessibility_announcement_core.h";
export const SABOTAGES = [
  {name: "unknown-as-false", argument: "--sabotage=unknown-as-false", hostDirectory: "build/accessibility-info-sabotage-unknown-as-false-host",
    file: table, find: "  if (raw == 0) {\n    return Reading::Off;\n  }\n  return Reading::Unknown;\n", replace: "  return Reading::Off;\n"},
  {name: "emit-every-poll", argument: "--sabotage=emit-every-poll", hostDirectory: "build/accessibility-info-sabotage-emit-every-poll-host",
    file: table, find: "      if (state.known && *state.known == *value) {\n", replace: "      if (false && state.known && *state.known == *value) {\n"},
  {name: "swapped-settings", argument: "--sabotage=swapped-settings", hostDirectory: "build/accessibility-info-sabotage-swapped-settings-host",
    file: table,
    find: "        \"reduce_animation\", \"accessibility_should_reduce_animation\"},\n"
      + "    {\"getCurrentReduceTransparencyState\", \"reduceTransparencyChanged\", \"reduceTransparency\", \"reduce transparency\",\n"
      + "        \"reduce_transparency\", \"accessibility_should_reduce_transparency\"},\n",
    replace: "        \"reduce_transparency\", \"accessibility_should_reduce_animation\"},\n"
      + "    {\"getCurrentReduceTransparencyState\", \"reduceTransparencyChanged\", \"reduceTransparency\", \"reduce transparency\",\n"
      + "        \"reduce_animation\", \"accessibility_should_reduce_transparency\"},\n"},
  {name: "display-name", argument: "--sabotage=display-name", hostDirectory: "build/accessibility-info-sabotage-display-name-host",
    file: table, find: "        \"reduce_animation\", \"accessibility_should_reduce_animation\"},\n",
    replace: "        \"reduce_animation\", \"accessibility_should_reduce_animations\"},\n"},
  {name: "announce-name", argument: "--sabotage=announce-name", hostDirectory: "build/accessibility-info-sabotage-announce-name-host",
    file: announcements, find: "inline constexpr TextProperty announcement_text = TextProperty::Value;\n",
    replace: "inline constexpr TextProperty announcement_text = TextProperty::Name;\n"},
  {name: "swapped-priorities", argument: "--sabotage=swapped-priorities", hostDirectory: "build/accessibility-info-sabotage-swapped-priorities-host",
    file: announcements,
    find: "  if (priority == \"high\") {\n    return Live::Assertive;\n  }\n  if (priority == \"low\") {\n    return std::nullopt;\n  }\n  return Live::Polite;\n",
    replace: "  if (priority == \"high\") {\n    return Live::Polite;\n  }\n  if (priority == \"low\") {\n    return std::nullopt;\n  }\n  return Live::Assertive;\n"},
  {name: "ungated-announce", argument: "--sabotage=ungated-announce", hostDirectory: "build/accessibility-info-sabotage-ungated-announce-host",
    file: announcements, find: "  bool available() const { return port_.available && port_.available(); }\n",
    replace: "  bool available() const { return true; }\n"},
  {name: "reused-element", argument: "--sabotage=reused-element", hostDirectory: "build/accessibility-info-sabotage-reused-element-host",
    file: announcements, find: "      const uint64_t handle = port_.create ? port_.create() : 0;\n      if (handle == 0) {\n",
    replace: "      static uint64_t reused = 0;\n      if (reused == 0) {\n        reused = port_.create ? port_.create() : 0;\n      }\n      const uint64_t handle = reused;\n      if (handle == 0) {\n"},
];
