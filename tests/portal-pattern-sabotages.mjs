// The retained sabotages of scripts/portal-pattern-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
const example = "examples/portal-pattern/App.jsx";
const HOST = "        <PortalHost />\n";
const SCROLL = "        <ScrollView testID=\"portal-scroll\" style={styles.scroll}>\n";
// A variant is a list of edits of one file, each made in exactly one place.
export const SABOTAGES = [
  // The host is not the last child of the root: the provider renders none, and the ScrollView's content renders it.
  {name: "host-in-scroll", argument: "--sabotage=host-in-scroll", file: example, edits: [
    {find: HOST, replace: ""}, {find: SCROLL, replace: `${SCROLL}          <PortalHost />\n`}]},
  {name: "host-blocks-world", argument: "--sabotage=host-blocks-world", file: example, edits: [
    {find: " pointerEvents=\"box-none\" style={styles.host}>", replace: " style={styles.host}>"}]},
  {name: "provider-not-installed", argument: "--sabotage=provider-not-installed", file: example, edits: [
    {find: "AppRegistry.setWrapperComponentProvider(() => PortalProvider);\n", replace: "void PortalProvider;\n"}]},
  {name: "portal-leaks", argument: "--sabotage=portal-leaks", file: example, edits: [
    {find: "  useEffect(() => () => api?.remove(key), [api, key]);\n", replace: "  useEffect(() => undefined, [api, key]);\n"}]},
  // Without the zIndex the host forms no stacking context in Fabric, so the portal's Controls are hoisted out of it into the root's Control.
  {name: "host-flattened", argument: "--sabotage=host-flattened", file: example, edits: [
    {find: ", zIndex: HOST_Z_INDEX }", replace: " }"}]},
];
