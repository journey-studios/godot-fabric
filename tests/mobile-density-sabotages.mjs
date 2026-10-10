// The retained sabotages of scripts/mobile-density-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
const core = "native/display_insets_core.h";
const application = "native/fabric_application.cpp";
export const SABOTAGES = [
  {name: "ignore-frame", argument: "--sabotage=ignore-frame", hostDirectory: "build/mobile-density-sabotage-ignore-frame-host", file: core,
    find: `  return {std::max(0.0, unsafe.left - frame.x),
      std::max(0.0, unsafe.top - frame.y),
      std::max(0.0, unsafe.right - (window_width - (frame.x + frame.width))),
      std::max(0.0, unsafe.bottom - (window_height - (frame.y + frame.height)))};`,
    replace: "  return {unsafe.left, unsafe.top, unsafe.right, unsafe.bottom};"},
  {name: "no-threshold", argument: "--sabotage=no-threshold", hostDirectory: "build/mobile-density-sabotage-no-threshold-host", file: core,
    find: "  const double threshold = update_threshold(scale);\n",
    replace: "  const double threshold = 0.0;\n"},
  {name: "no-reapply", argument: "--sabotage=no-reapply", hostDirectory: "build/mobile-density-sabotage-no-reapply-host", file: application,
    find: "  if (std::abs(window.get_content_scale_factor() - factor) > 1e-6) window.set_content_scale_factor(factor);",
    replace: "  if (window.get_content_scale_factor() == 1.0) window.set_content_scale_factor(factor);"},
  {name: "ignore-seam", argument: "--sabotage=ignore-seam", hostDirectory: "build/mobile-density-sabotage-ignore-seam-host", file: application,
    find: "  if (!has_meta(validation_safe_area)) return fabric_godot::window_unsafe_edges(window, scale);",
    replace: "  if (true) return fabric_godot::window_unsafe_edges(window, scale);"},
];
