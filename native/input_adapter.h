#pragma once
#include <godot_cpp/classes/input_event_key.hpp>
#include <godot_cpp/classes/line_edit.hpp>
#include <folly/dynamic.h>
#include <functional>
#include <optional>
#include <string>

namespace fabric_godot {
// Per committed LineEdit. Godot owns editing/IME; React commands acknowledge
// native edits before they may change text or selection, as in RN TextInput.
class InputAdapter final {
 public:
  using Emit = std::function<void(const std::string &, folly::dynamic)>;
  InputAdapter(godot::LineEdit &input, Emit emit) : input_(input), emit_(std::move(emit)) {}
  void changed(const godot::String &text);
  void focus(bool focused);
  void submitted();
  void key(const godot::Ref<godot::InputEventKey> &event);
  void sample();
  void setTextAndSelection(int count, std::optional<std::string> text, int start, int end);
  folly::dynamic snapshot() const;
  bool blur_on_submit{true};
 private:
  struct Edit { int count; std::optional<std::string> text; int start; int end; };
  void apply(const Edit &edit);
  std::pair<int, int> selection() const;
  folly::dynamic payload() const;
  godot::LineEdit &input_;
  Emit emit_;
  int event_count_{};
  int rejected_{};
  int deferred_{};
  std::pair<int, int> last_selection_{-1, -1};
  std::optional<Edit> pending_;
};
} // namespace fabric_godot
