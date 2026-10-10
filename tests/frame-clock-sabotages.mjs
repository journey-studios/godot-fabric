// The retained sabotages of scripts/frame-clock-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
const genuine = "    const bool tick = consumer && (pacing == Pacing::Presentation || due);";
export const SABOTAGES = [
  {name: "always", argument: "--sabotage", hostDirectory: "build/frame-clock-sabotage-always-host",
    file: "native/frame_clock.h", find: genuine, replace: "    const bool tick = consumer;"},
  {name: "idle", argument: "--sabotage=idle", hostDirectory: "build/frame-clock-sabotage-idle-host",
    file: "native/frame_clock.h", find: genuine, replace: "    const bool tick = pacing == Pacing::Presentation || due;"},
  {name: "presentation", argument: "--sabotage=presentation", hostDirectory: "build/frame-clock-sabotage-presentation-host",
    file: "native/frame_clock.h", find: genuine, replace: "    const bool tick = consumer && due;"},
];
