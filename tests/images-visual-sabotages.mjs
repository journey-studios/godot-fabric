// The retained sabotages of scripts/images-visual-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
export const SABOTAGES = [
  {name: "mask-borders", argument: "--sabotage=mask-borders", hostDirectory: "build/images-visual-sabotage-mask-borders-host",
    file: "native/image_effects_core.h",
    find: "  clip.inner = {content, fit_corners({content.width, content.height}, corner_insets(radii, widths))};",
    replace: "  clip.inner = {content, fit_corners({content.width, content.height}, corner_insets(radii, {}))};"},
  {name: "blur-passes", argument: "--sabotage=blur-passes", hostDirectory: "build/images-visual-sabotage-blur-passes-host",
    file: "native/image_effects_core.h",
    find: "  box_pass(scratch.data(), pixels, width, height, kernel);\n  for (std::size_t i = 0; i < count; ++i) {\n    for (std::size_t channel = 0; channel < 3; ++channel) pixels[i * 4 + channel] = straightened(",
    replace: "  box_pass(scratch.data(), pixels, width, height, kernel);\n  box_pass(pixels, scratch.data(), width, height, kernel);\n  std::copy(scratch.begin(), scratch.end(), pixels);\n  for (std::size_t i = 0; i < count; ++i) {\n    for (std::size_t channel = 0; channel < 3; ++channel) pixels[i * 4 + channel] = straightened("},
  {name: "blur-cache", argument: "--sabotage=blur-cache", hostDirectory: "build/images-visual-sabotage-blur-cache-host",
    file: "native/image_loader.cpp",
    find: "!job.measure_only && !job.prefetch && !job.blurs()); }",
    replace: "!job.measure_only && !job.prefetch); }"},
  {name: "nine-patch-scale", argument: "--sabotage=nine-patch-scale", hostDirectory: "build/images-visual-sabotage-nine-patch-scale-host",
    file: "native/image_effects_core.h",
    find: "  margins.left = std::min(positive(insets.left * scale), pixels.width);",
    replace: "  margins.left = std::min(positive(insets.left), pixels.width);"},
];
