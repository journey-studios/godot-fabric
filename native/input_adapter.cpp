#include "input_adapter.h"
#include <algorithm>

namespace fabric_godot {
namespace {
int utf16_offset(const godot::String &text, int column) {
  int result = 0;
  for (int i = 0; i < std::clamp(column, 0, static_cast<int>(text.length())); ++i)
    result += text[i] > 0xffff ? 2 : 1;
  return result;
}
int native_column(const godot::String &text, int offset) {
  int units = 0, column = 0;
  while (column < text.length()) {
    const int next = units + (text[column] > 0xffff ? 2 : 1);
    if (next > offset) break; // Never put a native caret inside a surrogate pair.
    units = next;
    ++column;
  }
  return column;
}
std::string utf8(const godot::String &text) { return text.utf8().get_data(); }
}
folly::dynamic InputAdapter::payload() const {
  return folly::dynamic::object("text", utf8(input_.get_text()))("eventCount", event_count_);
}
std::pair<int, int> InputAdapter::selection() const {
  const auto text = input_.get_text();
  const int caret = input_.get_caret_column();
  return {utf16_offset(text, input_.has_selection() ? input_.get_selection_from_column() : caret),
      utf16_offset(text, input_.has_selection() ? input_.get_selection_to_column() : caret)};
}
void InputAdapter::changed(const godot::String &text) {
  ++event_count_;
  emit_("change", folly::dynamic::object("text", utf8(text))("eventCount", event_count_));
}
void InputAdapter::focus(bool focused) {
  emit_(focused ? "focus" : "blur", payload());
  if (!focused) emit_("endEditing", payload());
}
void InputAdapter::submitted() {
  emit_("submitEditing", payload());
  if (blur_on_submit) input_.release_focus();
}
void InputAdapter::key(const godot::Ref<godot::InputEventKey> &event) {
  if (event.is_null() || !event->is_pressed() || !input_.is_editable() ||
      !input_.is_editing() || input_.has_ime_text()) return;
  std::string name;
  switch (event->get_keycode()) {
    case godot::KEY_BACKSPACE: name = "Backspace"; break;
    case godot::KEY_DELETE: name = "Delete"; break;
    case godot::KEY_ENTER: case godot::KEY_KP_ENTER: name = "Enter"; break;
    case godot::KEY_LEFT: name = "ArrowLeft"; break;
    case godot::KEY_RIGHT: name = "ArrowRight"; break;
    default:
      if (event->get_unicode() && !event->is_ctrl_pressed() && !event->is_meta_pressed() && !event->is_alt_pressed())
        name = utf8(godot::String::chr(event->get_unicode()));
  }
  if (!name.empty()) emit_("keyPress", folly::dynamic::object("key", name));
}
void InputAdapter::setTextAndSelection(int count, std::optional<std::string> text, int start, int end) {
  if (count < event_count_) { ++rejected_; return; }
  Edit edit{count, std::move(text), start, end};
  // Setting text or moving the caret can cancel composition inside LineEdit.
  // Keep only the latest eligible command, then recheck its count on completion.
  if (input_.has_ime_text()) { pending_ = std::move(edit); ++deferred_; return; }
  pending_.reset();
  apply(edit);
}
void InputAdapter::apply(const Edit &edit) {
  const auto old_selection = selection();
  const auto old_caret = utf16_offset(input_.get_text(), input_.get_caret_column());
  if (edit.text && utf8(input_.get_text()) != *edit.text) {
    input_.set_text(godot::String::utf8(edit.text->c_str()));
    input_.set_caret_column(native_column(input_.get_text(), old_caret));
    if (old_selection.first != old_selection.second)
      input_.select(native_column(input_.get_text(), old_selection.first),
          native_column(input_.get_text(), old_selection.second));
  }
  if (edit.start >= 0 && edit.end >= 0) {
    const int start = native_column(input_.get_text(), std::min(edit.start, edit.end));
    const int end = native_column(input_.get_text(), std::max(edit.start, edit.end));
    const auto current = selection();
    if (current != std::pair{utf16_offset(input_.get_text(), start), utf16_offset(input_.get_text(), end)}) {
      input_.deselect();
      input_.set_caret_column(end);
      if (start != end) input_.select(start, end);
    }
  }
}
void InputAdapter::sample() {
  if (pending_ && !input_.has_ime_text()) {
    auto edit = std::move(*pending_);
    pending_.reset();
    if (edit.count < event_count_) ++rejected_;
    else apply(edit);
  }
  // LineEdit has no selection_changed signal. Observe its final native state
  // once per frame, after editing; never derive selection from React props.
  const auto current = selection();
  if (current == last_selection_ || input_.has_ime_text()) return;
  last_selection_ = current;
  emit_("selectionChange", folly::dynamic::object("selection",
      folly::dynamic::object("start", current.first)("end", current.second)));
}
folly::dynamic InputAdapter::snapshot() const {
  const auto current = selection();
  return folly::dynamic::object("eventCount", event_count_)("rejectedCommands", rejected_)
      ("deferredCommands", deferred_)("pendingEdit", pending_.has_value())
      ("composing", input_.has_ime_text())("editing", input_.is_editing())
      ("selection", folly::dynamic::object("start", current.first)("end", current.second));
}
} // namespace fabric_godot
