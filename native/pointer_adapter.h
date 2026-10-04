#pragma once
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
  using HitTest = std::function<int(godot::Vector2)>;
  using LocalPoint = std::function<godot::Vector2(int, godot::Vector2)>;
  struct Coordinates { godot::Vector2 page, screen; };
  using Project = std::function<Coordinates(godot::Vector2)>;
  using Emit = std::function<void(int, const std::string &, rn::TouchEvent)>;
  using EmitPointer = std::function<void(int, const std::string &, rn::PointerEvent)>;
  PointerAdapter(HitTest hit, LocalPoint local, Project project, Emit emit, EmitPointer emit_pointer);
  bool input(const godot::Ref<godot::InputEvent> &event, int pointer_id, bool primary);
  void responder(int tag, bool active, bool block);
  void cancel();
  void removed(int tag);
  void leave_mouse(int pointer_id, const godot::Vector2 *position = nullptr);
  std::vector<int> pointer_ids() const;
  bool owns(int tag) const { return responder_tag_ == tag; }
  bool blocks_native() const { return responder_tag_ && block_native_; }
  bool invalid_coordinates() const { return invalid_coordinates_; }
  folly::dynamic snapshot() const;
 private:
  HitTest hit_;
  LocalPoint local_;
  Project project_;
  Emit emit_;
  EmitPointer emit_pointer_;
  struct PointerSample {
    rn::PointerEvent event{};
    int target{};
    int touch_id{-1};
    bool mouse{}, active{};
  };
  std::map<int, PointerSample> pointers_;
  std::map<int, rn::Touch> touches_;
  int responder_tag_{};
  bool block_native_{};
  bool invalid_coordinates_{};
  int starts_{}, moves_{}, ends_{}, cancels_{}, grants_{}, releases_{};
  int pointer_downs_{}, pointer_moves_{}, pointer_ups_{}, pointer_cancels_{}, pointer_leaves_{};
  void start(int id, godot::Vector2 position);
  void update(int id, godot::Vector2 position, const std::string &phase);
  void dispatch(const rn::Touch &touch, const std::string &phase);
  PointerSample *sample(int id, godot::Vector2 position, bool mouse, bool primary);
  void pointer(int id, const std::string &phase);
  void cancel_pointer(int id);
};
}
