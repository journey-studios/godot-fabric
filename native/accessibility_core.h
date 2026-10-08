#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

// The semantic descriptor of one accessible View, and the table that maps RN's
// roles to the roles an OS assistive technology can be given. It needs neither
// Godot nor React Native, so that a mobile bridge (GF-34, GF-35) consumes the
// same decisions: it receives what RN parsed (Input) and returns either a
// Descriptor or the reasons it cannot be honored. Nothing is replaced by a
// generic role: a role the table cannot map is rejected, with the reason.
//
// The Godot role is named by the constant of Godot's AccessibilityServer
// ("ROLE_BUTTON"), never by its number: the host resolves the number from the
// running engine, so the table does not copy values that an engine release may
// renumber.
namespace fabric_godot::accessibility {

enum class Vocabulary { AccessibilityRole, Role };
enum class LiveRegion { Off, Polite, Assertive };
enum class Checked { None, Unchecked, Checked, Mixed };
enum class Important { Auto, Yes, No, NoHideDescendants };

// What the role can carry in a state or answer to. A state set on a role without
// the capability is rejected: it would be accepted and then shown to nobody.
enum Capability : unsigned {
  Checkable = 1,   // accessibilityState.checked: the OS shows a 0/1 value
  Selectable = 2,  // accessibilityState.selected
  Expandable = 4,  // accessibilityState.expanded
  Activatable = 8, // the OS can press it (ACTION_CLICK) without an explicit handler
};

struct RoleRule {
  std::string_view name;
  bool accessibility_role; // spelled in RN's accessibilityRole
  bool role;               // spelled in RN's role
  std::string_view godot_role;   // AccessibilityServer constant; empty: no role (none, presentation) or rejected
  std::string_view description;  // role description set over the Godot role; empty: the OS's own word
  unsigned capabilities;
  std::string_view rejection;    // not empty: the role is rejected, and this is why
};

namespace detail {
constexpr RoleRule supported(std::string_view name, bool accessibility_role, bool role, std::string_view godot_role,
    std::string_view description = {}, unsigned capabilities = 0) {
  return {name, accessibility_role, role, godot_role, description, capabilities, {}};
}
constexpr RoleRule rejected(std::string_view name, bool accessibility_role, bool role, std::string_view reason) {
  return {name, accessibility_role, role, {}, {}, 0, reason};
}
inline constexpr std::string_view table_semantics =
    "table semantics need row and column counts and indexes, which are not supported yet";
inline constexpr std::string_view value_semantics =
    "it needs a value and a range (accessibilityValue is not supported yet)";
inline constexpr std::string_view android_class = "it is an Android widget class with no Godot equivalent";
inline constexpr std::string_view no_equivalent = "Godot has no equivalent role";
}

// Every spelling of RN 0.87.1's AccessibilityRole (Libraries/Components/View/ViewAccessibility.js) and Role is
// here, either mapped or rejected. A name that is in neither vocabulary is unknown, which is a different error.
// The role descriptions are English words, set only where Godot has no role of its own.
inline constexpr RoleRule role_rules[] = {
  // No role at all, spelled out.
  detail::supported("none", true, true, {}),
  detail::supported("presentation", false, true, {}),
  // Controls.
  detail::supported("button", true, true, "ROLE_BUTTON", {}, Activatable | Expandable),
  detail::supported("togglebutton", true, false, "ROLE_BUTTON", "toggle button", Checkable | Activatable),
  detail::supported("imagebutton", true, false, "ROLE_BUTTON", "image button", Activatable),
  detail::supported("keyboardkey", true, false, "ROLE_BUTTON", "keyboard key", Activatable),
  detail::supported("link", true, true, "ROLE_LINK", {}, Activatable),
  detail::supported("checkbox", true, true, "ROLE_CHECK_BOX", {}, Checkable | Activatable),
  detail::supported("radio", true, true, "ROLE_RADIO_BUTTON", {}, Checkable | Activatable),
  // Godot's CHECK_BUTTON is AccessKit's Switch.
  detail::supported("switch", true, true, "ROLE_CHECK_BUTTON", {}, Checkable | Activatable),
  detail::supported("menuitem", true, true, "ROLE_MENU_ITEM", {}, Activatable | Expandable),
  detail::supported("option", false, true, "ROLE_LIST_BOX_OPTION", {}, Selectable | Activatable),
  detail::supported("tab", true, true, "ROLE_TAB", {}, Selectable | Activatable),
  // Content.
  detail::supported("text", true, false, "ROLE_STATIC_TEXT"),
  detail::supported("header", true, false, "ROLE_STATIC_TEXT", "heading"),
  detail::supported("heading", false, true, "ROLE_STATIC_TEXT", "heading"),
  detail::supported("image", true, false, "ROLE_IMAGE"),
  detail::supported("img", false, true, "ROLE_IMAGE"),
  detail::supported("progressbar", true, true, "ROLE_PROGRESS_INDICATOR"),
  // The alert, status and timer roles are text with a word: Godot announces by live region only, so none of them
  // announces by itself (combine with accessibilityLiveRegion).
  detail::supported("alert", true, true, "ROLE_STATIC_TEXT", "alert"),
  detail::supported("status", false, true, "ROLE_STATIC_TEXT", "status"),
  detail::supported("timer", true, true, "ROLE_STATIC_TEXT", "timer"),
  detail::supported("tooltip", false, true, "ROLE_TOOLTIP"),
  // Containers.
  detail::supported("list", true, true, "ROLE_LIST"),
  detail::supported("listitem", false, true, "ROLE_LIST_ITEM", {}, Selectable),
  detail::supported("menu", true, true, "ROLE_MENU"),
  detail::supported("menubar", true, true, "ROLE_MENU_BAR"),
  detail::supported("tablist", true, true, "ROLE_TAB_BAR"),
  detail::supported("tabbar", true, false, "ROLE_TAB_BAR"),
  detail::supported("tabpanel", false, true, "ROLE_TAB_PANEL"),
  detail::supported("dialog", false, true, "ROLE_DIALOG"),
  detail::supported("alertdialog", false, true, "ROLE_DIALOG", "alert dialog"),
  detail::supported("radiogroup", true, true, "ROLE_CONTAINER", "radio group"),
  detail::supported("toolbar", true, true, "ROLE_CONTAINER", "toolbar"),
  // Godot's generic container is the group.
  detail::supported("group", false, true, "ROLE_CONTAINER"),
  detail::supported("viewgroup", true, false, "ROLE_CONTAINER"),
  // Landmarks are Godot's region with the landmark's word.
  detail::supported("search", true, false, "ROLE_REGION", "search"),
  detail::supported("region", false, true, "ROLE_REGION"),
  detail::supported("banner", false, true, "ROLE_REGION", "banner"),
  detail::supported("complementary", false, true, "ROLE_REGION", "complementary"),
  detail::supported("contentinfo", false, true, "ROLE_REGION", "content information"),
  detail::supported("form", false, true, "ROLE_REGION", "form"),
  detail::supported("main", false, true, "ROLE_REGION", "main"),
  detail::supported("navigation", false, true, "ROLE_REGION", "navigation"),
  // Rejected: the role would be accepted and then mean less than it says.
  detail::rejected("adjustable", true, false, "it needs increment and decrement actions (accessibilityActions is not supported yet)"),
  detail::rejected("dropdownlist", true, false, "it is an Android Spinner, and Godot has no popup button role"),
  detail::rejected("summary", true, true, detail::no_equivalent),
  detail::rejected("combobox", true, true, "Godot has no combo box role, and its popup and value are not supported yet"),
  detail::rejected("scrollbar", true, true, detail::value_semantics),
  detail::rejected("spinbutton", true, true, "it needs a value and increment and decrement actions"),
  detail::rejected("slider", false, true, detail::value_semantics),
  detail::rejected("meter", false, true, detail::value_semantics),
  detail::rejected("grid", true, true, detail::table_semantics),
  detail::rejected("table", false, true, detail::table_semantics),
  detail::rejected("treegrid", false, true, detail::table_semantics),
  detail::rejected("row", false, true, detail::table_semantics),
  detail::rejected("rowgroup", false, true, detail::table_semantics),
  detail::rejected("rowheader", false, true, detail::table_semantics),
  detail::rejected("columnheader", false, true, detail::table_semantics),
  detail::rejected("cell", false, true, detail::table_semantics),
  detail::rejected("tree", false, true, "tree semantics need levels and expansion, which are not supported yet"),
  detail::rejected("treeitem", false, true, "tree semantics need levels and expansion, which are not supported yet"),
  detail::rejected("pager", true, false, detail::android_class),
  detail::rejected("webview", true, false, detail::android_class),
  detail::rejected("drawerlayout", true, false, detail::android_class),
  detail::rejected("slidingdrawer", true, false, detail::android_class),
  detail::rejected("iconmenu", true, false, detail::android_class),
  detail::rejected("scrollview", true, false, "scroll containers are exposed by the ScrollView component, not by a View role"),
  detail::rejected("horizontalscrollview", true, false, "scroll containers are exposed by the ScrollView component, not by a View role"),
  detail::rejected("searchbox", false, true, "a search box is an editable field, and a View is not editable"),
  detail::rejected("separator", false, true, detail::no_equivalent),
  detail::rejected("application", false, true, detail::no_equivalent),
  detail::rejected("article", false, true, detail::no_equivalent),
  detail::rejected("definition", false, true, detail::no_equivalent),
  detail::rejected("directory", false, true, detail::no_equivalent),
  detail::rejected("document", false, true, detail::no_equivalent),
  detail::rejected("feed", false, true, detail::no_equivalent),
  detail::rejected("figure", false, true, detail::no_equivalent),
  detail::rejected("log", false, true, detail::no_equivalent),
  detail::rejected("marquee", false, true, detail::no_equivalent),
  detail::rejected("math", false, true, detail::no_equivalent),
  detail::rejected("note", false, true, detail::no_equivalent),
  detail::rejected("term", false, true, detail::no_equivalent),
};
inline constexpr size_t role_rule_count = sizeof(role_rules) / sizeof(role_rules[0]);

// The rule for a spelling in a vocabulary, or null if RN's vocabulary does not have it.
inline const RoleRule *find_role(std::string_view name, Vocabulary vocabulary) {
  for (const auto &rule : role_rules) {
    if (rule.name == name && (vocabulary == Vocabulary::AccessibilityRole ? rule.accessibility_role : rule.role)) return &rule;
  }
  return nullptr;
}

// What RN parsed for one View (AccessibilityProps), in plain values. role is empty when RN's Role is None.
struct Input {
  bool accessible{};
  std::string label, hint;
  std::string accessibility_role, role;
  bool disabled{}, selected{}, busy{};
  std::optional<bool> expanded;
  Checked checked{Checked::None};
  LiveRegion live{LiveRegion::Off};
  bool elements_hidden{};
  Important important{Important::Auto};
  bool on_accessibility_tap{};
  size_t action_count{};
};

// What the OS is told about the element. The name and the description are the label and the hint, as they are.
struct Descriptor {
  bool accessible{};
  std::string name, description;
  std::string role;        // the winning RN spelling; empty: no role
  std::string role_source; // "role", "accessibilityRole" or empty
  std::string godot_role;  // an AccessibilityServer constant; empty: Godot's own default
  std::string role_description;
  LiveRegion live{LiveRegion::Off};
  bool hidden{}, disabled{}, busy{};
  Checked checked{Checked::None};
  bool selected{};
  std::optional<bool> expanded;
  bool on_accessibility_tap{};
  // ACTION_CLICK is offered. A hidden or disabled element has none.
  bool click_action{};
  bool operator==(const Descriptor &) const = default;
};

struct Resolution {
  Descriptor descriptor;
  std::vector<std::string> errors;
  bool ok() const { return errors.empty(); }
};

inline std::string_view live_name(LiveRegion live) {
  switch (live) {
    case LiveRegion::Off: return "none";
    case LiveRegion::Polite: return "polite";
    case LiveRegion::Assertive: return "assertive";
  }
  return "none";
}
inline std::string_view checked_name(Checked checked) {
  switch (checked) {
    case Checked::None: return "none";
    case Checked::Unchecked: return "unchecked";
    case Checked::Checked: return "checked";
    case Checked::Mixed: return "mixed";
  }
  return "none";
}

namespace detail {
inline std::string quoted(std::string_view text) { return "\"" + std::string(text) + "\""; }

// A role spelling, checked against its vocabulary. Null with an error when it is unknown or rejected.
inline const RoleRule *role_of(std::string_view prop, std::string_view name, Vocabulary vocabulary,
    std::vector<std::string> &errors) {
  if (name.empty()) return nullptr;
  const RoleRule *rule = find_role(name, vocabulary);
  if (!rule) {
    errors.push_back(std::string(prop) + " " + quoted(name) + " is not a React Native " + std::string(prop));
    return nullptr;
  }
  if (!rule->rejection.empty()) {
    errors.push_back(std::string(prop) + " " + quoted(name) + " has no Godot accessibility role: " + std::string(rule->rejection));
    return nullptr;
  }
  return rule;
}
}

// The descriptor for what RN parsed, or the reasons it cannot be honored. Each reason names its prop. On errors the
// descriptor is the default one: a rejected View carries no semantics, rather than part of them.
inline Resolution resolve(const Input &input) {
  Resolution result;
  auto &errors = result.errors;
  // RN gives the role prop precedence over accessibilityRole; both have to be valid.
  const RoleRule *from_role = detail::role_of("role", input.role, Vocabulary::Role, errors);
  const RoleRule *from_accessibility_role =
      detail::role_of("accessibilityRole", input.accessibility_role, Vocabulary::AccessibilityRole, errors);
  const RoleRule *winner = from_role ? from_role : from_accessibility_role;
  if (winner && winner->name == "none") winner = nullptr;
  const unsigned capabilities = winner ? winner->capabilities : 0;
  const std::string role_name = winner ? std::string(winner->name) : std::string();

  if (input.checked == Checked::Mixed) {
    errors.push_back("accessibilityState.checked \"mixed\" is not supported: Godot's accessibility has no mixed state");
  } else if (input.checked != Checked::None && !(capabilities & Checkable)) {
    errors.push_back("accessibilityState.checked needs a checkable role (checkbox, radio, switch or togglebutton), not " +
        (winner ? detail::quoted(role_name) : std::string("no role")));
  }
  if (input.selected && !(capabilities & Selectable)) {
    errors.push_back("accessibilityState.selected needs a selectable role (tab, listitem or option), not " +
        (winner ? detail::quoted(role_name) : std::string("no role")));
  }
  if (input.expanded.has_value() && !(capabilities & Expandable)) {
    errors.push_back("accessibilityState.expanded needs an expandable role (button, menuitem), not " +
        (winner ? detail::quoted(role_name) : std::string("no role")));
  }
  if (input.action_count > 0) {
    errors.push_back("accessibilityActions is not supported yet: custom actions need Godot's custom-action bridge");
  }
  if (input.important == Important::No) {
    errors.push_back("importantForAccessibility \"no\" is not supported: Godot can hide an element only together with its "
        "descendants (use \"no-hide-descendants\")");
  }
  if (!errors.empty()) return result;

  auto &descriptor = result.descriptor;
  descriptor.accessible = input.accessible;
  descriptor.name = input.label;
  descriptor.description = input.hint;
  if (winner) {
    descriptor.role = role_name;
    descriptor.role_source = from_role ? "role" : "accessibilityRole";
    descriptor.godot_role = std::string(winner->godot_role);
    descriptor.role_description = std::string(winner->description);
  }
  descriptor.live = input.live;
  descriptor.hidden = input.elements_hidden || input.important == Important::NoHideDescendants;
  descriptor.disabled = input.disabled;
  descriptor.busy = input.busy;
  descriptor.checked = input.checked;
  descriptor.selected = input.selected;
  descriptor.expanded = input.expanded;
  descriptor.on_accessibility_tap = input.on_accessibility_tap;
  // As on iOS (RCTViewComponentView accessibilityActivate): an explicit handler answers the activation, and an
  // accessible element that has none is pressed where it is. A role that a user presses offers the same.
  descriptor.click_action = !descriptor.hidden && !descriptor.disabled &&
      (input.on_accessibility_tap || input.accessible || (capabilities & Activatable));
  return result;
}

} // namespace fabric_godot::accessibility
