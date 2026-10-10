#include "modal_window_stack.h"

#include <godot_cpp/core/object.hpp>
#include <godot_cpp/classes/project_settings.hpp>
#include <godot_cpp/variant/utility_functions.hpp>

#include <algorithm>
#include <stdexcept>

namespace {
constexpr char stack_metadata[] = "godot_fabric_modal_window_stack";
}

namespace fabric_godot {

godot::Ref<ModalWindowStack> ModalWindowStack::for_window(godot::Window &window) {
  const godot::StringName key(stack_metadata);
  if (window.has_meta(key)) {
    godot::Ref<ModalWindowStack> existing = window.get_meta(key);
    if (existing.is_valid()) return existing;
    throw std::runtime_error("E_MODAL_STACK: owner Window metadata has an invalid stack value");
  }

  godot::Ref<ModalWindowStack> stack;
  stack.instantiate();
  stack->owner_window_id_ = window.get_instance_id();
  window.set_meta(key, stack);
  return stack;
}

const ModalWindowStack::Entry *ModalWindowStack::find(Owner identity) const {
  auto found = std::find_if(entries_.begin(), entries_.end(), [&](const Entry &entry) {
    return entry.identity == identity;
  });
  return found == entries_.end() ? nullptr : &*found;
}

godot::Window *ModalWindowStack::window(Owner identity) const {
  const auto *entry = find(identity);
  if (!entry) return nullptr;
  auto *owner = godot::Object::cast_to<godot::Window>(
      godot::ObjectDB::get_instance(owner_window_id_));
  auto *current = godot::Object::cast_to<godot::Window>(
      godot::ObjectDB::get_instance(entry->window_id));
  return owner && current && current->get_parent() == owner ? current : nullptr;
}

std::optional<ModalWindowStack::Owner> ModalWindowStack::top_identity() const {
  auto *owner = godot::Object::cast_to<godot::Window>(
      godot::ObjectDB::get_instance(owner_window_id_));
  if (!owner) return std::nullopt;
  for (auto entry = entries_.rbegin(); entry != entries_.rend(); ++entry) {
    auto *current = godot::Object::cast_to<godot::Window>(
        godot::ObjectDB::get_instance(entry->window_id));
    if (current && current->get_parent() == owner && current->is_visible())
      return entry->identity;
  }
  return std::nullopt;
}

bool ModalWindowStack::contains(Owner identity, uint64_t window_id) const {
  return std::any_of(entries_.begin(), entries_.end(), [&](const Entry &entry) {
    return entry.identity == identity && entry.window_id == window_id;
  });
}

void ModalWindowStack::register_runtime(godot::Window &owner, uint64_t runtime,
    std::function<bool()> cancel) {
  if (owner.get_instance_id() != owner_window_id_ || !cancel)
    throw std::runtime_error("E_MODAL_OWNER: runtime membership requires this owner Window");
  if (runtimes_.contains(runtime)) return;
  runtimes_.emplace(runtime, std::move(cancel));
}

void ModalWindowStack::unregister_runtime(uint64_t runtime) {
  runtimes_.erase(runtime);
}

void ModalWindowStack::cancel_runtimes() {
  std::vector<std::pair<uint64_t, std::function<bool()>>> snapshot(runtimes_.begin(), runtimes_.end());
  for (auto &[runtime, cancel] : snapshot) {
    if (!cancel()) {
      runtimes_.erase(runtime);
    }
  }
}

uint64_t ModalWindowStack::create(godot::Window &owner, Owner identity, const godot::Vector2 &size) {
  if (owner.get_instance_id() != owner_window_id_)
    throw std::runtime_error("E_MODAL_OWNER: modal stack belongs to another Window");
  if (find(identity)) throw std::runtime_error("E_MODAL_OWNER: duplicate runtime/surface/tag/mount identity");
  auto *settings = godot::ProjectSettings::get_singleton();
  if (!settings || !settings->get_setting("display/window/subwindows/embed_subwindows", false).booleanize())
    throw std::runtime_error("E_MODAL_EMBEDDING: Modal requires embedded Godot subwindows");
  if (size.x <= 0 || size.y <= 0 || !size.is_finite())
    throw std::runtime_error("E_MODAL_WINDOW_METRICS: Modal requires positive host Window dimensions");

  auto *window = memnew(godot::Window);
  window->set_visible(false);
  window->set_exclusive(false);
  window->set_transient(true);
  window->set_unparent_when_invisible(false);
  window->set_flag(godot::Window::FLAG_BORDERLESS, true);
  window->set_content_scale_mode(godot::Window::CONTENT_SCALE_MODE_DISABLED);
  window->set_position(godot::Vector2i());
  window->set_size(godot::Vector2i(static_cast<int32_t>(size.x), static_cast<int32_t>(size.y)));
  const auto window_id = window->get_instance_id();
  entries_.push_back({identity, window_id});
  ++revision_;
  owner.add_child(window);
  auto *attached_owner = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(owner_window_id_));
  window = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(window_id));
  if (!attached_owner || !window || window->get_parent() != attached_owner || !window->is_embedded()) {
    if (window && attached_owner && window->get_parent() == attached_owner) {
      attached_owner->remove_child(window);
    }
    if (auto *detached = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(window_id)))
      detached->queue_free();
    entries_.erase(std::remove_if(entries_.begin(), entries_.end(), [&](const Entry &entry) {
      return entry.identity == identity && entry.window_id == window_id;
    }), entries_.end());
    ++revision_;
    throw std::runtime_error("E_MODAL_EMBEDDING: Godot did not embed the modal Window");
  }
  if (!contains(identity, window_id))
    throw std::runtime_error("E_MODAL_OWNER: Modal was retired while its Window entered the scene tree");
  return window_id;
}

void ModalWindowStack::update_exclusive() {
  const auto revision = revision_;
  auto *owner = godot::Object::cast_to<godot::Window>(
      godot::ObjectDB::get_instance(owner_window_id_));
  if (!owner) return;
  const auto selected = top_identity();
  uint64_t top_id{};
  if (selected) {
    const auto *entry = find(*selected);
    if (entry) top_id = entry->window_id;
  }
  std::vector<uint64_t> windows;
  windows.reserve(entries_.size());
  for (const auto &entry : entries_) windows.push_back(entry.window_id);
  for (const auto window_id : windows) {
    if (revision_ != revision) return;
    const bool retained = std::any_of(entries_.begin(), entries_.end(), [window_id](const Entry &entry) {
      return entry.window_id == window_id;
    });
    if (!retained) continue;
    auto *window = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(window_id));
    if (!window || window->get_parent() != owner) continue;
    const bool should_be_exclusive = window_id == top_id;
    const bool newly_exclusive = should_be_exclusive && !window->is_exclusive();
    if (window->is_exclusive() != should_be_exclusive) {
      window->set_exclusive(should_be_exclusive);
      if (revision_ != revision) return;
    }
    if (!newly_exclusive) continue;
    auto *current = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(window_id));
    const bool still_retained = std::any_of(entries_.begin(), entries_.end(), [window_id](const Entry &entry) {
      return entry.window_id == window_id;
    });
    owner = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(owner_window_id_));
    if (still_retained && current && owner && current->get_parent() == owner &&
        current->is_visible() && current->is_exclusive()) current->grab_focus();
    if (revision_ != revision) return;
  }
}

bool ModalWindowStack::present(Owner identity) {
  if (top_identity() != identity) cancel_runtimes();
  auto *entry = find(identity);
  if (!entry) throw std::runtime_error("E_MODAL_OWNER: presentation Window was retired");
  const auto window_id = entry->window_id;
  auto *owner = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(owner_window_id_));
  auto *window = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(window_id));
  if (!owner || !window || window->get_parent() != owner)
    throw std::runtime_error("E_MODAL_OWNER: presentation Window lost its owner");

  auto moving = *entry;
  entries_.erase(std::remove_if(entries_.begin(), entries_.end(), [&](const Entry &value) {
    return value.identity == identity;
  }), entries_.end());
  entries_.push_back(moving);
  ++revision_;
  owner->move_child(window, owner->get_child_count() - 1);
  if (!contains(identity, window_id)) return false;
  owner = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(owner_window_id_));
  window = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(window_id));
  if (!owner || !window || window->get_parent() != owner) return false;
  if (auto *presented = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(window_id)))
    presented->set_visible(true);
  if (!contains(identity, window_id)) return false;
  window = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(window_id));
  owner = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(owner_window_id_));
  if (!window || !owner || window->get_parent() != owner || !window->is_visible()) return false;
  update_exclusive();
  auto *presented = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(window_id));
  if (!contains(identity, window_id)) return false;
  presented = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(window_id));
  return presented && presented->get_parent() == godot::ObjectDB::get_instance(owner_window_id_) &&
      presented->is_visible();
}

void ModalWindowStack::hide(Owner identity) {
  auto *entry = find(identity);
  if (!entry) return;
  if (top_identity() == identity) cancel_runtimes();
  entry = find(identity);
  if (!entry) return;
  const auto window_id = entry->window_id;
  ++revision_;
  if (auto *window = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(window_id)))
    window->set_visible(false);
  update_exclusive();
}

void ModalWindowStack::destroy(Owner identity) {
  auto found = std::find_if(entries_.begin(), entries_.end(), [&](const Entry &entry) {
    return entry.identity == identity;
  });
  if (found == entries_.end()) return;
  if (top_identity() == identity) cancel_runtimes();
  found = std::find_if(entries_.begin(), entries_.end(), [&](const Entry &entry) {
    return entry.identity == identity;
  });
  if (found == entries_.end()) return;
  const auto window_id = found->window_id;
  entries_.erase(found);
  ++revision_;

  auto *window = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(window_id));
  auto *owner = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(owner_window_id_));
  if (window && window->get_parent() == owner) {
    window->set_visible(false);
    auto *still_owned = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(window_id));
    owner = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(owner_window_id_));
    if (still_owned && owner && still_owned->get_parent() == owner && !tree_exit_depth_) {
      owner->remove_child(still_owned);
    }
  }
  // A visibility or focus listener may retire the owner while Godot is still
  // dispatching the Window callback. Revoke/detach now; free after that stack.
  // Within a TreeExitScope the owner may be busy removing children: the hidden
  // Window stays attached until its queued free (or, on quit, the owner's own
  // deletion) detaches it.
  if (auto *retired = godot::Object::cast_to<godot::Window>(godot::ObjectDB::get_instance(window_id)))
    retired->queue_free();
  update_exclusive();
}

}  // namespace fabric_godot
