// The retained sabotages of scripts/transform-singular-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
export const SABOTAGES = [
  {name: "collapsed-branch", hostDirectory: "build/transforms-singular-sabotage-host", file: "native/pointer_geometry.cpp",
    find: "if (collapsed(*layout)) {", replace: "if (false && collapsed(*layout)) {"},
];
