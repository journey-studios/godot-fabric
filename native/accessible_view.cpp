#include "accessible_view.h"
#include <godot_cpp/classes/class_db_singleton.hpp>
#include <godot_cpp/classes/engine.hpp>
#include <godot_cpp/classes/input_event_mouse_button.hpp>
#include <godot_cpp/classes/viewport.hpp>
#include <react/renderer/components/view/accessibilityPropsConversions.h>
#include <optional>
#include <unordered_map>

using namespace godot;
namespace rn = facebook::react;
namespace ax = fabric_godot::accessibility;

namespace {
// NOTIFICATION_ACCESSIBILITY_UPDATE. Godot 4.7 sends it to a node whose element has to be filled;
// the godot-cpp binding of the pinned 4.5 API does not name it.
constexpr int notification_accessibility_update = 3000;
// Godot's AccessibilityServer is not in the pinned binding profile; it is reached by name, as the
// application reaches the DisplayServer.
constexpr const char *server_class = "AccessibilityServer";

String gd(const std::string &value) { return String::utf8(value.c_str()); }
std::string utf8(const String &value) { return value.utf8().get_data(); }

Object *accessibility_server() { return Engine::get_singleton()->get_singleton(server_class); }

// The number of an AccessibilityServer constant in the running engine. The engine's constants do not change
// while it runs, so each name is asked of ClassDB once per process, whether it exists or not, and apply()
// (which runs for every View on every commit) only looks the answer up. A missing constant stays an error:
// the answer is the same every time.
std::optional<int64_t> server_constant(const std::string &name) {
  static std::unordered_map<std::string, std::optional<int64_t>> known;
  const auto found = known.find(name);
  if (found != known.end()) return found->second;
  auto *classes = ClassDBSingleton::get_singleton();
  std::optional<int64_t> value;
  if (classes->class_has_integer_constant(server_class, String(name.c_str()))) {
    value = classes->class_get_integer_constant(server_class, String(name.c_str()));
  }
  known.emplace(name, value);
  return value;
}

ax::Input input_from(const rn::ViewProps &props) {
  ax::Input input;
  input.accessible = props.accessible;
  input.label = props.accessibilityLabel;
  input.hint = props.accessibilityHint;
  input.accessibility_role = props.accessibilityRole;
  // RN's Role has no "unset": None is both. RN's own platforms read it the same way.
  input.role = props.role == rn::Role::None ? std::string() : rn::toString(props.role);
  if (props.accessibilityState) {
    const auto &state = *props.accessibilityState;
    input.disabled = state.disabled;
    input.selected = state.selected;
    input.busy = state.busy;
    input.expanded = state.expanded;
    switch (state.checked) {
      case rn::AccessibilityState::Unchecked: input.checked = ax::Checked::Unchecked; break;
      case rn::AccessibilityState::Checked: input.checked = ax::Checked::Checked; break;
      case rn::AccessibilityState::Mixed: input.checked = ax::Checked::Mixed; break;
      case rn::AccessibilityState::None: input.checked = ax::Checked::None; break;
    }
  }
  switch (props.accessibilityLiveRegion) {
    case rn::AccessibilityLiveRegion::None: input.live = ax::LiveRegion::Off; break;
    case rn::AccessibilityLiveRegion::Polite: input.live = ax::LiveRegion::Polite; break;
    case rn::AccessibilityLiveRegion::Assertive: input.live = ax::LiveRegion::Assertive; break;
  }
  input.elements_hidden = props.accessibilityElementsHidden;
  switch (props.importantForAccessibility) {
    case rn::ImportantForAccessibility::Auto: input.important = ax::Important::Auto; break;
    case rn::ImportantForAccessibility::Yes: input.important = ax::Important::Yes; break;
    case rn::ImportantForAccessibility::No: input.important = ax::Important::No; break;
    case rn::ImportantForAccessibility::NoHideDescendants: input.important = ax::Important::NoHideDescendants; break;
  }
  input.on_accessibility_tap = props.onAccessibilityTap;
  input.action_count = props.accessibilityActions.size();
  return input;
}

const char *live_constant(ax::LiveRegion live) {
  switch (live) {
    case ax::LiveRegion::Off: return "LIVE_OFF";
    case ax::LiveRegion::Polite: return "LIVE_POLITE";
    case ax::LiveRegion::Assertive: return "LIVE_ASSERTIVE";
  }
  return "LIVE_OFF";
}
}

GodotAccessibleView::GodotAccessibleView() {
  // Control.get_accessibility_name() and get_accessibility_description() translate their text through
  // tr(), which the auto translate mode does not stop (Godot 4.7.2 measured). RN's labels are the app's
  // words, not translation keys, so the message translation of this node is off as well.
  set_auto_translate_mode(Node::AUTO_TRANSLATE_MODE_DISABLED);
  set_message_translation(false);
}

void GodotAccessibleView::_bind_methods() {
  ClassDB::bind_method(D_METHOD("accessibility_click", "data"), &GodotAccessibleView::accessibility_click);
  ADD_SIGNAL(MethodInfo("accessibility_tap"));
}

std::vector<std::string> GodotAccessibleView::apply(const rn::ViewProps &props) {
  ++applies_;
  auto resolution = ax::resolve(input_from(props));
  // Every View of the application comes through here on every commit that touches it, and most carry no
  // accessibility props. A View whose descriptor is the one it already has, with nothing rejected before or now,
  // has nothing to set, check or publish: its Control already holds the name, the description and the live mode of
  // that descriptor, and the constants it needs were checked when it got it. That includes the default descriptor of a
  // View that never had props, whose Control still holds Godot's defaults.
  if (resolution.ok() && errors_.empty() && resolution.descriptor == descriptor_) {
    ++skipped_applies_;
    return {};
  }
  std::vector<std::string> errors;
  for (const auto &error : resolution.errors) errors.push_back("accessibility: " + error);
  std::optional<int64_t> live_value;
  if (resolution.ok()) {
    // Everything the descriptor will be published with has to exist in this engine.
    std::vector<std::string> needed = {"FLAG_HIDDEN", "FLAG_DISABLED", "FLAG_BUSY", "ACTION_CLICK", live_constant(resolution.descriptor.live)};
    if (!resolution.descriptor.godot_role.empty()) needed.push_back(resolution.descriptor.godot_role);
    for (const auto &name : needed) {
      if (!server_constant(name)) errors.push_back("accessibility: this Godot has no AccessibilityServer constant " + name);
    }
    live_value = server_constant(live_constant(resolution.descriptor.live));
  }
  const bool reported = errors != errors_;
  errors_ = errors;
  const auto previous = descriptor_;
  // A View that cannot be honored carries no semantics, not the part that could be.
  descriptor_ = errors.empty() ? resolution.descriptor : ax::Descriptor{};
  set("accessibility_name", gd(descriptor_.name));
  set("accessibility_description", gd(descriptor_.description));
  set("accessibility_live", live_value.value_or(0));
  if (!(previous == descriptor_)) call("queue_accessibility_update");
  return reported ? errors : std::vector<std::string>();
}

void GodotAccessibleView::_notification(int what) {
  if (what == notification_accessibility_update) publish();
}

void GodotAccessibleView::publish() {
  auto *server = accessibility_server();
  if (!server) {
    ++publish_failures_;
    return;
  }
  const RID element = call("get_accessibility_element");
  // No element: no OS tree stands behind this node (a headless run, or no assistive technology).
  if (!element.is_valid()) return;
  ++updates_;
  const auto &descriptor = descriptor_;
  bool failed = false;
  auto constant = [&](const std::string &name) -> int64_t {
    const auto value = server_constant(name);
    if (!value) failed = true;
    return value.value_or(0);
  };
  folly::dynamic flags = folly::dynamic::object();
  folly::dynamic actions = folly::dynamic::array();
  folly::dynamic plan = folly::dynamic::object("role", nullptr);
  if (!descriptor.godot_role.empty()) {
    const auto role = constant(descriptor.godot_role);
    if (!failed) server->call("update_set_role", element, role);
    plan["role"] = descriptor.godot_role;
  }
  server->call("update_set_role_description", element, gd(descriptor.role_description));
  const std::pair<const char *, bool> flag_values[] = {{"FLAG_HIDDEN", descriptor.hidden},
      {"FLAG_DISABLED", descriptor.disabled}, {"FLAG_BUSY", descriptor.busy}};
  for (const auto &[flag, on] : flag_values) {
    const auto number = constant(flag);
    if (!failed) server->call("update_set_flag", element, number, on);
    flags[flag] = on;
  }
  if (descriptor.checked == ax::Checked::Checked || descriptor.checked == ax::Checked::Unchecked) {
    server->call("update_set_checked", element, descriptor.checked == ax::Checked::Checked);
    plan["checked"] = descriptor.checked == ax::Checked::Checked;
  }
  if (descriptor.selected) {
    server->call("update_set_list_item_selected", element, true);
    plan["selected"] = true;
  }
  if (descriptor.expanded) {
    server->call("update_set_list_item_expanded", element, *descriptor.expanded);
    plan["expanded"] = *descriptor.expanded;
  }
  if (descriptor.click_action) {
    const auto click = constant("ACTION_CLICK");
    if (!failed) server->call("update_add_action", element, click, Callable(this, "accessibility_click"));
    actions.push_back("ACTION_CLICK");
  }
  plan["roleDescription"] = descriptor.role_description;
  plan["flags"] = std::move(flags);
  plan["actions"] = std::move(actions);
  if (failed) ++publish_failures_;
  published_ = std::move(plan);
}

void GodotAccessibleView::accessibility_click(const Variant &) {
  ++requests_;
  // The element may have changed since the OS asked, and the OS's call arrives deferred.
  if (!descriptor_.click_action || !is_visible_in_tree()) {
    ++ignored_requests_;
    return;
  }
  if (descriptor_.on_accessibility_tap) {
    ++taps_;
    emit_signal("accessibility_tap");
    return;
  }
  ++clicks_;
  synthesize_click();
}

void GodotAccessibleView::synthesize_click() {
  auto *input = Engine::get_singleton()->get_singleton("Input");
  auto *viewport = get_viewport();
  if (!input || !viewport) {
    ++publish_failures_;
    return;
  }
  // The center of the View as the window sees it: through the View's own transform (RN transforms rotate and
  // scale Controls), the canvas, and the window's content scaling. The pointer route then resolves what is there.
  const Vector2 at = viewport->get_final_transform().xform(get_global_transform_with_canvas().xform(get_size() / 2));
  for (const bool pressed : {true, false}) {
    Ref<InputEventMouseButton> event;
    event.instantiate();
    event->set_button_index(MOUSE_BUTTON_LEFT);
    event->set_position(at);
    event->set_global_position(at);
    event->set_pressed(pressed);
    event->set_button_mask(pressed ? BitField<MouseButtonMask>(MOUSE_BUTTON_MASK_LEFT) : BitField<MouseButtonMask>(0));
    input->call("parse_input_event", event);
  }
}

folly::dynamic GodotAccessibleView::snapshot() {
  const auto &d = descriptor_;
  auto errors = folly::dynamic::array();
  for (const auto &error : errors_) errors.push_back(error);
  const auto role_number = d.godot_role.empty() ? std::nullopt : server_constant(d.godot_role);
  folly::dynamic descriptor = folly::dynamic::object("accessible", d.accessible)("name", d.name)("description", d.description)
      ("role", d.role.empty() ? folly::dynamic(nullptr) : folly::dynamic(d.role))
      ("roleSource", d.role_source.empty() ? folly::dynamic(nullptr) : folly::dynamic(d.role_source))
      ("godotRole", d.godot_role.empty() ? folly::dynamic(nullptr) : folly::dynamic(d.godot_role))
      ("godotRoleValue", role_number ? folly::dynamic(*role_number) : folly::dynamic(nullptr))
      ("roleDescription", d.role_description)("live", std::string(ax::live_name(d.live)))
      ("hidden", d.hidden)("disabled", d.disabled)("busy", d.busy)
      ("checked", std::string(ax::checked_name(d.checked)))("selected", d.selected)
      ("expanded", d.expanded ? folly::dynamic(*d.expanded) : folly::dynamic(nullptr))
      ("onAccessibilityTap", d.on_accessibility_tap)("clickAction", d.click_action);
  // What Godot itself will publish for the Control, read back from the Control.
  folly::dynamic control = folly::dynamic::object
      ("accessibilityName", utf8(static_cast<String>(get("accessibility_name"))))
      ("accessibilityDescription", utf8(static_cast<String>(get("accessibility_description"))))
      ("accessibilityLive", static_cast<int64_t>(get("accessibility_live")))
      ("autoTranslateMode", static_cast<int>(get_auto_translate_mode()))
      ("messageTranslation", can_translate_messages());
  return folly::dynamic::object("descriptor", std::move(descriptor))("rejected", !errors_.empty())("errors", std::move(errors))
      ("control", std::move(control))("published", published_)
      ("applies", applies_)("skippedApplies", skipped_applies_)("updates", updates_)("requests", requests_)("taps", taps_)("clicks", clicks_)
      ("ignoredRequests", ignored_requests_)("publishFailures", publish_failures_);
}
