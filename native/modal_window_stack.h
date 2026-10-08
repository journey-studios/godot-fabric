#pragma once

#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/classes/window.hpp>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <vector>

namespace fabric_godot {

class ModalWindowStack final : public godot::RefCounted {
  GDCLASS(ModalWindowStack, godot::RefCounted)

 public:
  struct Owner {
    uint64_t runtime{};
    int surface{};
    int tag{};
    uint64_t mount{};
    bool operator==(const Owner &) const = default;
  };

  static godot::Ref<ModalWindowStack> for_window(godot::Window &window);

  uint64_t create(godot::Window &owner, Owner identity, const godot::Vector2 &size);
  void register_runtime(godot::Window &owner, uint64_t runtime, std::function<bool()> cancel);
  void unregister_runtime(uint64_t runtime);
  size_t runtime_count() const { return runtimes_.size(); }
  godot::Window *window(Owner identity) const;
  bool present(Owner identity);
  void hide(Owner identity);
  void destroy(Owner identity);

 protected:
  static void _bind_methods() {}

 private:
  struct Entry {
    Owner identity;
    uint64_t window_id{};
  };
  uint64_t owner_window_id_{};
  uint64_t revision_{};
  std::vector<Entry> entries_;
  std::map<uint64_t, std::function<bool()>> runtimes_;

  const Entry *find(Owner identity) const;
  std::optional<Owner> top_identity() const;
  bool contains(Owner identity, uint64_t window_id) const;
  void update_exclusive();
  void cancel_runtimes();
};

}  // namespace fabric_godot
