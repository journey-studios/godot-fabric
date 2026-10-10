// The retained sabotages of scripts/scope-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
// `updates` keeps the call `checkProps("View", props);` as it is in the text and guards it with a ref that is set on the first render: the JS lane's
// test of the facade (tests/scope-0.5.test.mjs, "every component facade runs the check") reads that text since #104 moved the check into renderHostView, and
// only a runtime check of an update can tell a mount-only check, which is what this sabotage is for and why the lane is not meant to reject it.
export const SABOTAGES = [
  {name: "updates", file: "src/react-native-platform.jsx", find: '  checkProps("View", props);\n',
    replace: '  const checked = React.useRef(false);\n  if (!checked.current) {\n    checked.current = true;\n    checkProps("View", props);\n  }\n', lane: false},
  {name: "undeclared", file: "src/components.jsx", find: '} = declaredProps("Pressable", allProps);', replace: "} = allProps;", lane: true},
  {name: "modal", file: "src/react-native-platform.jsx", find: '  checkProps("Modal", props);\n', replace: "", lane: true},
  {name: "scroll", file: "src/scroll-view-contract.mjs", find: '  checkProps("ScrollView", props);\n', replace: "", lane: true},
  {name: "defaults", file: "src/prop-scope.mjs", find: "!(entry.accepts ?? []).some(works", replace: "!(entry.accepts ?? []).slice(1).some(works", lane: true},
  {name: "reason", file: "docs/compatibility/scope-0.5.json", find: '"reason": "iOS calls it after the modal is dismissed and Modal.js calls it on iOS only"',
    replace: '"reason": ""', lane: true},
];
