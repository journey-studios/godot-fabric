// The retained sabotages of scripts/images-network-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
export const SABOTAGES = [
  {name: "decoded-reload", argument: "--sabotage=decoded-reload", hostDirectory: "build/images-network-sabotage-decoded-reload-host",
    file: "native/image_cache.h",
    find: "  if (view && policy != CachePolicy::Reload) {",
    replace: "  if (view) {"},
  {name: "cancel-open", argument: "--sabotage=cancel-open", hostDirectory: "build/images-network-sabotage-cancel-open-host",
    file: "native/image_network.cpp",
    find: "      transport_->cancel(id);\n      active_.erase(id);\n      ++abandoned_;",
    replace: "      active_.erase(id);\n      ++abandoned_;"},
  {name: "texture-mutation", argument: "--sabotage=texture-mutation", hostDirectory: "build/images-network-sabotage-texture-mutation-host",
    file: "native/image_view.cpp",
    find: "  layer_.draw(get_canvas_item(), image_->texture->get_rid(), *painted);",
    replace: "  if (painted->kind == img::PaintKind::Tile) image_->texture->set_size_override(Vector2i(std::max(1, static_cast<int>(std::lround(natural_size().width))), std::max(1, static_cast<int>(std::lround(natural_size().height)))));\n  layer_.draw(get_canvas_item(), image_->texture->get_rid(), *painted);"},
];
