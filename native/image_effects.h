#pragma once

#include "image_effects_core.h"
#include <folly/dynamic.h>
#include <godot_cpp/variant/rid.hpp>
#include <string>
#include <vector>

namespace fabric_godot {

// Where an Image's picture is drawn: a canvas item of its own, a child of the view's, so that what the view paints itself (the
// background and the border) is never tinted or masked by what is done to the picture. The item is scaled by 1/scale, which puts the
// picture's pixels on the item's units: tiles, nine-patch margins and the shader's coordinates are all pixels of the texture.
//
// What is done to the picture is the one shader below, shared by every view and made the first time one is needed, with a material of
// the view's own. The texture is never touched: it is shared by every view of the picture (and by the decoded cache). Godot's RIDs
// are not reference counted, so each is freed by whoever made it: the item and then the material by the view, the shader when the
// extension ends. The renderer of a headless run is a dummy that draws nothing and ignores the material's parameters, so the layer
// keeps what it asked the renderer for and reports it (snapshot()), and the captures of a real renderer prove what it drew.
class PictureLayer final {
 public:
  PictureLayer() = default;
  ~PictureLayer();
  PictureLayer(const PictureLayer &) = delete;
  PictureLayer &operator=(const PictureLayer &) = delete;

  // Replaces what the layer holds with the drawing of `painting` of `texture`, as a child of `parent`.
  void draw(const godot::RID &parent, const godot::RID &texture, const image::Painting &painting);
  // Draws nothing (a view with no picture), keeping the item.
  void clear();
  // What the last draw asked the renderer for, in the renderer's own terms.
  folly::dynamic snapshot() const;

  // The RIDs created and freed so far, for the whole process.
  static folly::dynamic counters();
  // Frees the shared shader. Called when the extension ends, after every view is gone.
  static void release_shader();

 private:
  void ensure_item(const godot::RID &parent);
  void set_material(const image::Painting &painting);

  godot::RID item_, material_;
  bool shaded_{};
  // The calls of the last draw, as the values passed.
  std::vector<std::pair<std::string, folly::dynamic>> params_;
  folly::dynamic commands_ = folly::dynamic::array();
};

}  // namespace fabric_godot
