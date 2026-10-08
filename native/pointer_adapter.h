#pragma once
#include "pointer_event.h"
#include <godot_cpp/classes/input_event.hpp>
#include <godot_cpp/variant/vector2.hpp>
#include <react/renderer/components/view/PointerEvent.h>
#include <react/renderer/components/view/TouchEvent.h>
#include <folly/dynamic.h>
#include <functional>
#include <map>
#include <vector>

namespace fabric_godot {
namespace rn = facebook::react;
// Platform input transport only. Negotiation and press state remain upstream JS.
class PointerAdapter {
 public:
  using HitTest = std::function<int(godot::Vector2, const PointerInputSource &)>;
  // Mounted views from a hit view up to the root's child, nearest first. RN's
  // native hit path also ends in the root view, which never receives events.
  using HitPath = std::function<std::vector<int>(int, const PointerInputSource &)>;
  // Whether a point lies inside the surface's root view. RN resolves an empty
  // area there to the root; touches still start only on a hit view.
  using InsideRoot = std::function<bool(godot::Vector2, const PointerInputSource &)>;
  using LocalPoint = std::function<godot::Vector2(int, godot::Vector2, const PointerInputSource &)>;
  struct Coordinates { godot::Vector2 page, screen; };
  using Project = std::function<Coordinates(godot::Vector2, const PointerInputSource &)>;
  using Emit = std::function<void(int, const std::string &, rn::TouchEvent)>;
  // Active touches of the application's other roots. RN has one JS responder
  // per runtime, so every TouchEvent lists every touch that runtime sees.
  using OtherTouches = std::function<std::vector<rn::Touch>()>;
  // Target tag (0 without a hit view) and whether that empty point is inside the root.
  using EmitPointer = std::function<void(int, bool, const std::string &, rn::PointerEvent, godot::Vector2,
      PointerInputSource, std::shared_ptr<PointerGeometryHistory>)>;
  PointerAdapter(HitTest hit, HitPath path, InsideRoot inside, LocalPoint local, Project project, Emit emit,
      EmitPointer emit_pointer, OtherTouches other_touches);
  bool input(const godot::Ref<godot::InputEvent> &event, int pointer_id, bool primary,
      PointerInputSource source);
  void responder(int tag, bool active, bool block);
  void cancel();
  void removed(int tag);
  // A native ScrollView gesture takes over this pointer and cancels its touch stream.
  void takeover(int tag, int pointer_id);
  void leave_mouse(int pointer_id, const godot::Vector2 *position = nullptr);
  std::vector<int> pointer_ids() const;
  std::vector<rn::Touch> touches() const;
  bool owns(int tag) const { return responder_tag_ == tag; }
  bool blocks_native() const { return responder_tag_ && block_native_; }
  bool invalid_coordinates() const { return invalid_coordinates_; }
  folly::dynamic snapshot() const;
 private:
  HitTest hit_;
  HitPath path_;
  InsideRoot inside_;
  LocalPoint local_;
  Project project_;
  Emit emit_;
  EmitPointer emit_pointer_;
  OtherTouches other_touches_;
  struct PointerSample {
    rn::PointerEvent event{};
    godot::Vector2 viewport_point;
    std::shared_ptr<PointerGeometryHistory> geometry{std::make_shared<PointerGeometryHistory>()};
    PointerInputSource source;
    int target{};
    int touch_id{-1};
    bool mouse{}, active{}, root{};
    // A native gesture took this pressed contact over: JS saw its cancel.
    bool taken{};
    // The hit path at this contact's Down; its release clicks what it shares.
    std::vector<int> down_path;
  };
  struct TouchContact {
    rn::Touch event;
    PointerInputSource source;
  };
  std::map<int, PointerSample> pointers_;
  std::map<int, TouchContact> touches_;
  int responder_tag_{};
  bool block_native_{};
  bool invalid_coordinates_{};
  int starts_{}, moves_{}, ends_{}, cancels_{}, grants_{}, releases_{};
  int pointer_downs_{}, pointer_moves_{}, pointer_ups_{}, pointer_cancels_{}, pointer_leaves_{}, pointer_clicks_{};
  int pointer_takeovers_{};
  void start(int id, godot::Vector2 position, const PointerInputSource &source);
  void update(int id, godot::Vector2 position, const std::string &phase,
      const PointerInputSource &source);
  void dispatch(const rn::Touch &touch, const std::string &phase);
  PointerSample *sample(int id, godot::Vector2 position, bool mouse, bool primary,
      const PointerInputSource &source);
  void pointer(int id, const std::string &phase);
  void click(PointerSample &current);
  void cancel_pointer(int id);
};
}
