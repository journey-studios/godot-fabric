// The retained sabotages of scripts/layout-animation-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
const module = "native/layout_animation.cpp";
const runtime = "native/application_runtime.cpp";
export const SABOTAGES = [
  {name: "seconds-clock", argument: "--sabotage=seconds-clock", hostDirectory: "build/layout-animation-sabotage-seconds-clock-host", file: module,
    find: "    owner->last_read_ms = static_cast<uint64_t>(owner->frame_ms);",
    replace: "    owner->last_read_ms = static_cast<uint64_t>(owner->frame_ms / 1000.0);"},
  {name: "no-register-surface", argument: "--sabotage=no-register-surface", hostDirectory: "build/layout-animation-sabotage-no-register-surface-host", file: module,
    find: "  tree.getMountingCoordinator()->setMountingOverrideDelegate(state_->recorder);\n",
    replace: ""},
  {name: "no-consumer", argument: "--sabotage=no-consumer", hostDirectory: "build/layout-animation-sabotage-no-consumer-host", file: runtime,
    find: " || (layout_animation && layout_animation->active());",
    replace: ";"},
  {name: "drop-callback", argument: "--sabotage=drop-callback", hostDirectory: "build/layout-animation-sabotage-drop-callback-host", file: module,
    find: "    executor(std::move(callback));\n",
    replace: "    static_cast<void>(callback);\n"},
  {name: "unguarded-tick", argument: "--sabotage=unguarded-tick", hostDirectory: "build/layout-animation-sabotage-unguarded-tick-host", file: module,
    find: "  if (!active()) {\n    return;\n  }\n  clock(frame_ms);\n",
    replace: "  if (state_->stopped) {\n    return;\n  }\n  clock(frame_ms);\n"},
  {name: "no-rearm", argument: "--sabotage=no-rearm", hostDirectory: "build/layout-animation-sabotage-no-rearm-host", file: module,
    find: "    if (state_->stale && state_->driver->shouldOverridePullTransaction()) {\n      state_->animating = true;\n    }\n",
    replace: ""},
];
