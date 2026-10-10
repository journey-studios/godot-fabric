// The retained sabotages of scripts/frontier-baseline-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
const fixture = "tests/frontier-baseline-fixture.jsx";
// A variant is a list of edits of one file, each made in exactly one place.
export const SABOTAGES = [
  {name: "leaky-panel", file: fixture, edits: [
    {find: "function Panel({id}) {", replace: "function Panel({id, hidden}) {"},
    {find: "style={{width: 440, flexDirection", replace: "style={{opacity: hidden ? 0 : 1, width: 440, flexDirection"},
    {find: '{panel !== "empty" ? <Panel key={panel} id={panel} /> : null}',
      replace: '{(globalThis.shownPanels ??= new Set()).add(panel) && [...globalThis.shownPanels].map(id => id === "empty" ? null : '
        + '<Panel key={id} id={id} hidden={id !== panel} />)}'}]},
  {name: "no-gc", file: "tests/performance-sampler.gd", edits: [{find: "  set_flag(COLLECT_META, collecting)\n", replace: "  set_flag(COLLECT_META, false)\n"}]},
  {name: "world-leak", file: fixture, edits: [{find: "testID={`tab-${id}`} ", replace: 'testID={`tab-${id}`} pointerEvents="none" '}]},
  {name: "no-key", file: fixture, edits: [{find: "<Panel key={panel} id={panel} />", replace: "<Panel id={panel} />"}]},
];
