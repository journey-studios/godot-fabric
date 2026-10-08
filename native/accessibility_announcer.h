#pragma once

#include "accessibility_info_core.h"
#include <folly/dynamic.h>
#include <cstdint>
#include <functional>

namespace fabric_godot {
// The announcer's port into Godot for one FabricApplication, found by its instance id on every call (the owner may outlive the
// Node until the VM is released). Every call to the engine is by name, and the names and constants it uses are asked of
// ClassDB (announce_api_report): an engine that lacks one has no screen reader to announce to, as far as the announcer knows.
//
// An announcement is put in an element of AccessibilityServer (create_sub_element of the application's own element, with
// ROLE_STATIC_TEXT; update_set_value; update_set_live with LIVE_POLITE or LIVE_ASSERTIVE; free_element). A screen reader is
// there when SceneTree.is_accessibility_enabled() and AccessibilityServer.is_supported() hold and the application has an element,
// which none of them does in a headless run. `publish` is what runs the announcer's update; the engine runs it through
// NOTIFICATION_ACCESSIBILITY_UPDATE, so only the validation recorder calls it.
//
// A validation run replaces the AccessibilityServer by a recorder by setting the application's
// "validation_accessibility_announcer" meta to a Dictionary (read on every call; an empty one is a recorder that behaves as a
// screen reader). Its keys, each a bool:
//   available  (default true)  whether a screen reader stands behind the application
//   element    (default true)  whether the application has an element to put announcements in
//   delivers   (default true)  whether the update that was asked for comes (a screen reader that is not looking at the window
//                              never delivers one)
// The recorder runs the update itself when one is asked for, as the engine would, and records every call the announcer makes
// to the platform (AnnouncePort::recorded), the boundaries of the update included.
accessibility::AnnouncePort make_godot_announce_port(uint64_t application_id, std::function<void()> publish);

// The engine API the announcements use, by name, and which of it this engine lacks:
// {server, methods, constants, tree, node, missing}.
folly::dynamic announce_api_report();
}
