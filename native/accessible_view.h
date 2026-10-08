#pragma once
#include "accessibility_core.h"
#include <godot_cpp/classes/panel.hpp>
#include <react/renderer/components/view/ViewProps.h>
#include <folly/dynamic.h>
#include <string>
#include <vector>

// RN's View on a Godot Panel that tells the OS's assistive technology what the
// View is. Godot already gives every Node an accessibility element (AccessKit
// on desktop); this view fills it from RN's accessibility props: the label and
// the hint as the element's name and description, the role, the states, the
// live region, hidden, and an action that presses the View.
//
// apply() resolves the props with the pure core (accessibility_core.h) and keeps
// the descriptor. The name, the description and the live region are Godot
// properties of every Control, set at once. The rest is published inside
// NOTIFICATION_ACCESSIBILITY_UPDATE, the only place the AccessibilityServer
// accepts it, which Godot sends only while a screen reader (or --accessibility
// always) is on. A headless run therefore proves the descriptor and the Control
// properties, never the OS tree; snapshot() says which is which.
//
// The OS's press (ACTION_CLICK) behaves like iOS's accessibilityActivate: with an
// onAccessibilityTap handler it dispatches that event and nothing else; without
// one it clicks the View's center through Godot's input, so that the View's own
// press handling (Pressable, Touchable) runs through the pipeline a mouse uses.
// Whatever is on top of the center receives that click instead.
class GodotAccessibleView final : public godot::Panel {
  GDCLASS(GodotAccessibleView, godot::Panel)
 public:
  GodotAccessibleView();
  // Applies the props of the View. Returns the reasons they cannot be honored,
  // each once per change (none when they are applied, or when the same reasons
  // were already returned); a rejected View carries no semantics.
  std::vector<std::string> apply(const facebook::react::ViewProps &props);
  void _notification(int what);
  // The OS's press, called deferred by the AccessibilityServer with the action's
  // data. Public because the headless probe calls it as the host path of the action.
  void accessibility_click(const godot::Variant &data);
  folly::dynamic snapshot();
 protected:
  static void _bind_methods();
 private:
  void publish();
  void synthesize_click();
  fabric_godot::accessibility::Descriptor descriptor_;
  std::vector<std::string> errors_;
  // What the last publish told the AccessibilityServer, as plain values.
  folly::dynamic published_ = nullptr;
  // applies_ counts every apply(); skipped_applies_ those that found the descriptor unchanged and did nothing.
  int applies_{}, skipped_applies_{}, updates_{}, requests_{}, taps_{}, clicks_{}, ignored_requests_{}, publish_failures_{};
};
