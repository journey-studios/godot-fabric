#include "accessibility_core.h"
#include <algorithm>
#include <iostream>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>

using namespace fabric_godot::accessibility;

namespace {
int assertions = 0;
void require(bool condition, const char *message) {
  ++assertions;
  if (!condition) throw std::runtime_error(message);
}
template <typename T> void require_equal(const T &actual, const T &expected, const char *message) {
  ++assertions;
  if (!(actual == expected)) throw std::runtime_error(std::string(message) + ": got <" + std::string(actual) + ">, expected <" + std::string(expected) + ">");
}
bool mentions(const std::vector<std::string> &errors, const std::string &text) {
  return std::any_of(errors.begin(), errors.end(), [&](const std::string &error) { return error.find(text) != std::string::npos; });
}

// RN 0.87.1, Libraries/Components/View/ViewAccessibility.js, transcribed apart from the table: the table has to
// cover every spelling, not the spellings the table happens to have.
const std::vector<std::string> accessibility_roles = {"none", "button", "dropdownlist", "togglebutton", "link", "search",
  "image", "keyboardkey", "text", "adjustable", "imagebutton", "header", "summary", "alert", "checkbox", "combobox", "menu",
  "menubar", "menuitem", "progressbar", "radio", "radiogroup", "scrollbar", "spinbutton", "switch", "tab", "tabbar",
  "tablist", "timer", "list", "toolbar", "grid", "pager", "scrollview", "horizontalscrollview", "viewgroup", "webview",
  "drawerlayout", "slidingdrawer", "iconmenu"};
const std::vector<std::string> roles = {"alert", "alertdialog", "application", "article", "banner", "button", "cell",
  "checkbox", "columnheader", "combobox", "complementary", "contentinfo", "definition", "dialog", "directory", "document",
  "feed", "figure", "form", "grid", "group", "heading", "img", "link", "list", "listitem", "log", "main", "marquee", "math",
  "menu", "menubar", "menuitem", "meter", "navigation", "none", "note", "option", "presentation", "progressbar", "radio",
  "radiogroup", "region", "row", "rowgroup", "rowheader", "scrollbar", "searchbox", "separator", "slider", "spinbutton",
  "status", "summary", "switch", "tab", "table", "tablist", "tabpanel", "term", "timer", "toolbar", "tooltip", "tree",
  "treegrid", "treeitem"};
// The role constants of Godot 4.7.2's AccessibilityServer (extension_api.json, AccessibilityRole).
const std::set<std::string> godot_roles = {"ROLE_UNKNOWN", "ROLE_DEFAULT_BUTTON", "ROLE_AUDIO", "ROLE_VIDEO", "ROLE_STATIC_TEXT",
  "ROLE_CONTAINER", "ROLE_PANEL", "ROLE_BUTTON", "ROLE_LINK", "ROLE_CHECK_BOX", "ROLE_RADIO_BUTTON", "ROLE_CHECK_BUTTON",
  "ROLE_SCROLL_BAR", "ROLE_SCROLL_VIEW", "ROLE_SPLITTER", "ROLE_SLIDER", "ROLE_SPIN_BUTTON", "ROLE_PROGRESS_INDICATOR",
  "ROLE_TEXT_FIELD", "ROLE_MULTILINE_TEXT_FIELD", "ROLE_COLOR_PICKER", "ROLE_TABLE", "ROLE_CELL", "ROLE_ROW",
  "ROLE_ROW_GROUP", "ROLE_ROW_HEADER", "ROLE_COLUMN_HEADER", "ROLE_TREE", "ROLE_TREE_ITEM", "ROLE_LIST", "ROLE_LIST_ITEM",
  "ROLE_LIST_BOX", "ROLE_LIST_BOX_OPTION", "ROLE_TAB_BAR", "ROLE_TAB", "ROLE_TAB_PANEL", "ROLE_MENU_BAR", "ROLE_MENU",
  "ROLE_MENU_ITEM", "ROLE_MENU_ITEM_CHECK_BOX", "ROLE_MENU_ITEM_RADIO", "ROLE_IMAGE", "ROLE_WINDOW", "ROLE_TITLE_BAR",
  "ROLE_DIALOG", "ROLE_TOOLTIP", "ROLE_REGION", "ROLE_TEXT_RUN"};

Input with_role(const std::string &accessibility_role, const std::string &role = {}) {
  Input input;
  input.accessibility_role = accessibility_role;
  input.role = role;
  return input;
}

void the_table_covers_both_vocabularies_exactly() {
  for (const auto &name : accessibility_roles)
    require(find_role(name, Vocabulary::AccessibilityRole) != nullptr, ("accessibilityRole is missing from the table: " + name).c_str());
  for (const auto &name : roles)
    require(find_role(name, Vocabulary::Role) != nullptr, ("role is missing from the table: " + name).c_str());
  size_t accessibility_count = 0, role_count = 0;
  std::set<std::string> names;
  for (const auto &rule : role_rules) {
    require(names.insert(std::string(rule.name)).second, ("a name appears once: " + std::string(rule.name)).c_str());
    require(rule.accessibility_role || rule.role, "A rule belongs to a vocabulary");
    if (rule.accessibility_role) {
      ++accessibility_count;
      require(std::find(accessibility_roles.begin(), accessibility_roles.end(), rule.name) != accessibility_roles.end(),
          ("the table invents an accessibilityRole: " + std::string(rule.name)).c_str());
    }
    if (rule.role) {
      ++role_count;
      require(std::find(roles.begin(), roles.end(), rule.name) != roles.end(),
          ("the table invents a role: " + std::string(rule.name)).c_str());
    }
  }
  require(accessibility_count == accessibility_roles.size() && role_count == roles.size(), "No spelling is listed twice or left out");
  require(find_role("heading", Vocabulary::AccessibilityRole) == nullptr && find_role("header", Vocabulary::Role) == nullptr &&
      find_role("img", Vocabulary::AccessibilityRole) == nullptr && find_role("image", Vocabulary::Role) == nullptr,
      "A spelling belongs to its vocabulary only");
  require(find_role("banana", Vocabulary::Role) == nullptr, "An unknown spelling is not in the table");
}

void every_rule_maps_to_a_real_role_or_says_why_not() {
  size_t mapped = 0, rejected = 0, none = 0;
  for (const auto &rule : role_rules) {
    const std::string name(rule.name);
    if (!rule.rejection.empty()) {
      ++rejected;
      require(rule.godot_role.empty() && rule.description.empty() && rule.capabilities == 0, (name + ": a rejected role maps to nothing").c_str());
    } else if (rule.godot_role.empty()) {
      ++none;
      require(name == "none" || name == "presentation", (name + ": only none and presentation are no role").c_str());
    } else {
      ++mapped;
      require(godot_roles.count(std::string(rule.godot_role)) == 1, (name + ": " + std::string(rule.godot_role) + " is not an AccessibilityServer role").c_str());
      require(rule.godot_role != "ROLE_UNKNOWN" && rule.godot_role != "ROLE_PANEL", (name + ": a role is never the generic one").c_str());
    }
  }
  require(none == 2 && mapped + rejected + none == role_rule_count, "Every rule is mapped, rejected or no role");
  // The mapping the research note publishes.
  const auto *header = find_role("header", Vocabulary::AccessibilityRole);
  require(header && header->godot_role == "ROLE_STATIC_TEXT" && header->description == "heading", "header is static text described as a heading");
  const auto *toggle = find_role("togglebutton", Vocabulary::AccessibilityRole);
  require(toggle && toggle->godot_role == "ROLE_BUTTON" && (toggle->capabilities & Checkable), "togglebutton is a checkable button");
  const auto *sw = find_role("switch", Vocabulary::Role);
  require(sw && sw->godot_role == "ROLE_CHECK_BUTTON", "switch is Godot's check button (AccessKit's Switch)");
  require(find_role("webview", Vocabulary::AccessibilityRole)->rejection.size() > 0 && find_role("table", Vocabulary::Role)->rejection.size() > 0, "Roles without an equivalent are rejected");
  // A checkable role is a role the OS can press.
  for (const auto &rule : role_rules)
    if (rule.capabilities & Checkable) require(rule.capabilities & Activatable, (std::string(rule.name) + ": a checkable role is pressable").c_str());
}

void an_empty_input_is_an_empty_descriptor() {
  const auto result = resolve(Input{});
  require(result.ok() && result.descriptor == Descriptor{}, "Nothing set carries no semantics");
  require(!result.descriptor.click_action && !result.descriptor.hidden && result.descriptor.godot_role.empty(),
      "A plain View has no role and offers no action");
}

void label_hint_and_live_region_pass_through_literally() {
  Input input;
  input.label = "Save {0} %s \\ \"x\"";
  input.hint = "Saves the draft";
  input.live = LiveRegion::Assertive;
  input.accessible = true;
  const auto result = resolve(input);
  require(result.ok(), "A label and a hint are valid");
  require_equal(result.descriptor.name, input.label, "The label is the accessible name, untouched");
  require_equal(result.descriptor.description, input.hint, "The hint is the accessible description");
  require(result.descriptor.live == LiveRegion::Assertive && result.descriptor.accessible, "The live region and accessible are carried");
  require(live_name(LiveRegion::Off) == "none" && live_name(LiveRegion::Polite) == "polite" && live_name(LiveRegion::Assertive) == "assertive",
      "Live regions keep RN's spelling");
}

void roles_resolve_with_rn_precedence() {
  auto result = resolve(with_role("button"));
  require(result.ok() && result.descriptor.role == "button" && result.descriptor.godot_role == "ROLE_BUTTON" &&
      result.descriptor.role_source == "accessibilityRole" && result.descriptor.role_description.empty(), "accessibilityRole button");
  result = resolve(with_role("button", "link"));
  require(result.ok() && result.descriptor.role == "link" && result.descriptor.role_source == "role" &&
      result.descriptor.godot_role == "ROLE_LINK", "role wins over accessibilityRole");
  result = resolve(with_role("header"));
  require(result.ok() && result.descriptor.godot_role == "ROLE_STATIC_TEXT" && result.descriptor.role_description == "heading", "header is described as a heading");
  result = resolve(with_role({}, "heading"));
  require(result.ok() && result.descriptor.godot_role == "ROLE_STATIC_TEXT" && result.descriptor.role_description == "heading", "role heading is the same");
  result = resolve(with_role({}, "img"));
  require(result.ok() && result.descriptor.godot_role == "ROLE_IMAGE", "role img is an image");
  result = resolve(with_role("none", {}));
  require(result.ok() && result.descriptor.role.empty() && result.descriptor.godot_role.empty(), "none is no role");
  result = resolve(with_role("button", "presentation"));
  require(result.ok() && result.descriptor.role == "presentation" && result.descriptor.godot_role.empty(),
      "role presentation wins and is no role, rather than falling back to the generic one");
  result = resolve(with_role({}, "banner"));
  require(result.ok() && result.descriptor.godot_role == "ROLE_REGION" && result.descriptor.role_description == "banner", "A landmark is a region with its word");
}

void unknown_and_rejected_roles_fail_with_their_reason() {
  auto result = resolve(with_role("banana"));
  require(!result.ok() && mentions(result.errors, "accessibilityRole \"banana\" is not a React Native accessibilityRole"), "An unknown accessibilityRole");
  result = resolve(with_role({}, "banana"));
  require(!result.ok() && mentions(result.errors, "role \"banana\" is not a React Native role"), "An unknown role");
  result = resolve(with_role("heading"));
  require(!result.ok() && mentions(result.errors, "is not a React Native accessibilityRole"), "heading is a role spelling, not an accessibilityRole");
  result = resolve(with_role("webview"));
  require(!result.ok() && mentions(result.errors, "accessibilityRole \"webview\" has no Godot accessibility role: it is an Android widget class"),
      "A rejected accessibilityRole names the reason");
  result = resolve(with_role({}, "table"));
  require(!result.ok() && mentions(result.errors, "role \"table\" has no Godot accessibility role: table semantics"), "A rejected role names the reason");
  require(result.descriptor == Descriptor{}, "A rejected View carries no semantics at all");
  Input input = with_role("button");
  input.label = "Save";
  input.accessible = true;
  input.disabled = true;
  input.accessibility_role = "adjustable";
  result = resolve(input);
  require(!result.ok() && result.descriptor == Descriptor{} && result.descriptor.name.empty(),
      "Part of a rejected View is not applied either");
  // The loser of the precedence is validated too.
  result = resolve(with_role("webview", "button"));
  require(!result.ok(), "An invalid accessibilityRole is not hidden behind a valid role");
  result = resolve(with_role("banana", "banana"));
  require(result.errors.size() == 2, "Each invalid prop reports once");
}

void states_need_a_role_that_can_show_them() {
  Input input = with_role("checkbox");
  input.checked = Checked::Checked;
  auto result = resolve(input);
  require(result.ok() && result.descriptor.checked == Checked::Checked, "checked on a checkbox");
  input.checked = Checked::Unchecked;
  require(resolve(input).descriptor.checked == Checked::Unchecked, "unchecked on a checkbox");
  input.checked = Checked::Mixed;
  result = resolve(input);
  require(!result.ok() && mentions(result.errors, "\"mixed\" is not supported") && checked_name(Checked::Mixed) == "mixed", "mixed is rejected for every role");
  for (const char *name : {"togglebutton", "radio", "switch"}) {
    input = with_role(name);
    input.checked = Checked::Checked;
    require(resolve(input).ok(), (std::string("checked on ") + name).c_str());
  }
  input = with_role("button");
  input.checked = Checked::Checked;
  result = resolve(input);
  require(!result.ok() && mentions(result.errors, "needs a checkable role (checkbox, radio, switch or togglebutton), not \"button\""), "checked on a button");
  input = Input{};
  input.checked = Checked::Unchecked;
  result = resolve(input);
  require(!result.ok() && mentions(result.errors, "not no role"), "checked on no role");

  input = with_role("tab");
  input.selected = true;
  require(resolve(input).ok() && resolve(input).descriptor.selected, "selected on a tab");
  input = with_role({}, "option");
  input.selected = true;
  require(resolve(input).ok() && resolve(input).descriptor.selected, "selected on an option");
  input = with_role({}, "listitem");
  input.selected = true;
  require(resolve(input).ok(), "selected on a list item");
  input = with_role("button");
  input.selected = true;
  result = resolve(input);
  require(!result.ok() && mentions(result.errors, "needs a selectable role (tab, listitem or option), not \"button\""), "selected on a button");
  input = with_role("button");
  input.selected = false;
  require(resolve(input).ok(), "selected false is the default and always valid");

  input = with_role("button");
  input.expanded = true;
  result = resolve(input);
  require(result.ok() && result.descriptor.expanded == std::optional<bool>(true), "expanded on a button");
  input.expanded = false;
  require(resolve(input).descriptor.expanded == std::optional<bool>(false), "expanded false is kept apart from unset");
  input = with_role("text");
  input.expanded = true;
  require(!resolve(input).ok(), "expanded on static text");

  input = with_role("text");
  input.disabled = true;
  input.busy = true;
  result = resolve(input);
  require(result.ok() && result.descriptor.disabled && result.descriptor.busy, "disabled and busy are valid on any role");
  input = Input{};
  input.disabled = true;
  require(resolve(input).ok(), "disabled needs no role");
}

void unsupported_values_are_rejected_explicitly() {
  Input input;
  input.action_count = 1;
  auto result = resolve(input);
  require(!result.ok() && mentions(result.errors, "accessibilityActions is not supported yet"), "accessibilityActions");
  input = Input{};
  input.important = Important::No;
  result = resolve(input);
  require(!result.ok() && mentions(result.errors, "importantForAccessibility \"no\" is not supported"), "importantForAccessibility no");
  input.important = Important::Yes;
  require(resolve(input).ok(), "importantForAccessibility yes is the default behavior");
  input.important = Important::Auto;
  require(resolve(input).ok(), "importantForAccessibility auto is the default behavior");
  input = with_role("webview");
  input.action_count = 2;
  input.important = Important::No;
  input.checked = Checked::Mixed;
  require(resolve(input).errors.size() == 4, "Every problem is reported, none hides another");
}

void hidden_comes_from_either_rn_spelling() {
  Input input;
  input.elements_hidden = true;
  require(resolve(input).descriptor.hidden, "accessibilityElementsHidden hides");
  input = Input{};
  input.important = Important::NoHideDescendants;
  require(resolve(input).descriptor.hidden, "no-hide-descendants hides");
  input = Input{};
  require(!resolve(input).descriptor.hidden, "Nothing set hides nothing");
}

void the_click_action_follows_ios_activation() {
  Input input;
  require(!resolve(input).descriptor.click_action, "A plain View offers no action");
  input.accessible = true;
  require(resolve(input).descriptor.click_action, "An accessible View is pressed where it is");
  input = Input{};
  input.on_accessibility_tap = true;
  require(resolve(input).descriptor.click_action && resolve(input).descriptor.on_accessibility_tap, "onAccessibilityTap offers the action");
  for (const char *name : {"button", "link", "checkbox", "radio", "switch", "menuitem", "tab", "togglebutton", "imagebutton", "keyboardkey"}) {
    const auto spelled = find_role(name, Vocabulary::AccessibilityRole);
    require(spelled != nullptr, name);
    require(resolve(with_role(name)).descriptor.click_action, (std::string("a ") + name + " is pressable").c_str());
  }
  require(!resolve(with_role("text")).descriptor.click_action && !resolve(with_role("header")).descriptor.click_action &&
      !resolve(with_role("image")).descriptor.click_action, "Content roles are not pressable");
  // Hidden and disabled elements have no action, whatever else asks for one.
  input = with_role("button");
  input.accessible = true;
  input.on_accessibility_tap = true;
  input.disabled = true;
  require(!resolve(input).descriptor.click_action, "A disabled element has no action");
  input.disabled = false;
  input.elements_hidden = true;
  require(!resolve(input).descriptor.click_action, "A hidden element has no action");
  input.elements_hidden = false;
  input.important = Important::NoHideDescendants;
  require(!resolve(input).descriptor.click_action, "An element hidden with its descendants has no action");
  input.important = Important::Auto;
  require(resolve(input).descriptor.click_action, "The same element is pressable when it is neither hidden nor disabled");
}

void resolution_is_deterministic_and_stateless() {
  Input input = with_role("switch");
  input.label = "Dark mode";
  input.checked = Checked::Checked;
  const auto first = resolve(input), second = resolve(input);
  require(first.descriptor == second.descriptor && first.errors == second.errors, "The same input resolves to the same descriptor");
  input.checked = Checked::Unchecked;
  require(!(resolve(input).descriptor == first.descriptor), "A changed input changes the descriptor");
  require(!(Descriptor{} == first.descriptor), "Descriptor equality sees a role");
}
}

int main() {
  the_table_covers_both_vocabularies_exactly();
  every_rule_maps_to_a_real_role_or_says_why_not();
  an_empty_input_is_an_empty_descriptor();
  label_hint_and_live_region_pass_through_literally();
  roles_resolve_with_rn_precedence();
  unknown_and_rejected_roles_fail_with_their_reason();
  states_need_a_role_that_can_show_them();
  unsupported_values_are_rejected_explicitly();
  hidden_comes_from_either_rn_spelling();
  the_click_action_follows_ios_activation();
  resolution_is_deterministic_and_stateless();
  std::cout << "ACCESSIBILITY_CORE_PASSED " << assertions << " assertions in 11 groups\n";
}
