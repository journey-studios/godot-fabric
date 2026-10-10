// The retained sabotages of scripts/native-animated-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
export const SABOTAGES = [
  {name: "frames", argument: "--sabotage", hostDirectory: "build/native-animated-sabotage-host",
    file: "native/native_animated.cpp",
    find: "onAnimationFrame(rn::AnimationTimestamp(timestamp_ms));",
    replace: "onAnimationFrame(rn::AnimationTimestamp(timestamp_ms / 1000.0));"},
  {name: "persistence", argument: "--sabotage=persistence", hostDirectory: "build/native-animated-sabotage-persistence-host",
    file: "native/application_runtime.cpp",
    find: "rn::ShadowNode::setUseRuntimeShadowNodeReferenceUpdateOnThread(true);",
    replace: "rn::ShadowNode::setUseRuntimeShadowNodeReferenceUpdateOnThread(false);"},
];
