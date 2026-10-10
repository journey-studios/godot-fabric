// The retained sabotages of scripts/accessibility-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
export const SABOTAGES = [
  {name: "name", argument: "--sabotage=name", hostDirectory: "build/accessibility-sabotage-name-host",
    file: "native/accessible_view.cpp", find: '  set("accessibility_name", gd(descriptor_.name));',
    replace: '  set("accessibility_name", gd(std::string()));'},
  {name: "click", argument: "--sabotage=click", hostDirectory: "build/accessibility-sabotage-click-host",
    file: "native/accessible_view.cpp", find: "  ++requests_;\n", replace: "  ++requests_;\n  return;\n"},
  {name: "roles", argument: "--sabotage=roles", hostDirectory: "build/accessibility-sabotage-roles-host",
    file: "native/accessibility_core.h", find: 'detail::supported("button", true, true, "ROLE_BUTTON", {}, Activatable | Expandable),',
    replace: 'detail::supported("button", true, true, "ROLE_LINK", {}, Activatable | Expandable),'},
  {name: "hidden", argument: "--sabotage=hidden", hostDirectory: "build/accessibility-sabotage-hidden-host",
    file: "native/accessibility_core.h", find: "  descriptor.hidden = input.elements_hidden || input.important == Important::NoHideDescendants;",
    replace: "  descriptor.hidden = false;"},
];
