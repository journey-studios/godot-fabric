# Accessibility announcements: AccessKit speaks them, the screen reader's focus stays refused

Godot 4.7.2 (headless for the hosted suite; a graphical macOS window for the local lane), RN
0.87.1, for the second slice of GF-20, part b. Slice 2a (PR #63) brought RN's original
`AccessibilityInfo` over an `AccessibilityManager` module and left three things refused
as "not implemented yet (GF-20 slice 2b)": `announceForAccessibility`,
`announceForAccessibilityWithOptions`, and the screen reader's focus
(`setAccessibilityFocus`, `sendAccessibilityEvent(handle, 'focus')`). This slice makes the
announcements real, through AccessKit, and closes the focus question with the data that says it
cannot be honored without a side effect iOS does not have. Nothing here says that VoiceOver
spoke: the proof reaches the call AccessKit makes to AppKit, and no further (see "What is
derived and what is measured").

## What RN does

- `AccessibilityInfo.announceForAccessibility(text)` (`AccessibilityInfo.js:459-465`) calls the
  iOS module's method; Android's goes to a different module and is ignored here.
  `announceForAccessibilityWithOptions(text, {queue, priority})` (`:479-495`) calls the iOS
  module's method with the options if it exists and the plain one if not. The Flow spec is
  `{queue?: boolean, priority?: 'low' | 'default' | 'high'}`
  (`NativeAccessibilityManager.js:63-70`).
- iOS posts `UIAccessibilityAnnouncementNotification`
  (`RCTAccessibilityManager.mm:319-358`). `queue` becomes
  `UIAccessibilitySpeechAttributeQueueAnnouncement`. `priority` becomes
  `UIAccessibilitySpeechAttributeAnnouncementPriority` on iOS 17 and later: `"low"`,
  `"default"` and `"high"` map to the three constants, and any other string is ignored (the
  announcement is then a default one). With no screen reader the notification does nothing
  (Apple's documentation); Android's module returns without error when the accessibility
  service is off (`AccessibilityInfoModule.kt:282-292`).
- `announcementFinished` is an iOS device event (`RCTAccessibilityManager.mm:55-56`,
  `111-123`) sent when `UIAccessibilityAnnouncementDidFinishNotification` arrives, with
  `{announcement, success}`.
- `setAccessibilityFocus(tag)` (`AccessibilityInfo.js:436`) and
  `sendAccessibilityEvent(handle, 'focus')` both end in
  `UIAccessibilityLayoutChangedNotification` on the view
  (`RCTAccessibilityManager.mm:311-317`, `RCTMountingManager.mm:342-348`). That notification
  moves VoiceOver's focus. It does not change the first responder: a focused `TextInput` keeps
  the keyboard focus and receives no blur.

## What Godot offers

- **No announce method for an extension.** `Window::accessibility_announcement`
  (`scene/main/window.cpp:2492-2496`) exists but is not in the ClassDB or in
  `extension_api.json`. It keeps one element per window and sets its **name** and an
  assertive live mode (`window.cpp:1613-1621`), and, as measured below, AccessKit's macOS
  adapter does not speak a name. The extension builds its own announcement instead.
- **What AccessKit's macOS adapter speaks** (accesskit_macos, `platforms/macos/src/event.rs`):
  `node_added` (`:228-240`) and `node_updated` (`:242-306`) queue a live-region announcement
  when the node has a **value** and a live mode other than off, and, for an update, when the
  value or the live mode changed. The text is the value; the priority level is high for
  assertive and medium for polite (`:35-43`); the notification is
  `NSAccessibilityAnnouncementRequestedNotification` posted on the window with
  `NSAccessibilityPostNotificationWithUserInfo` (`:65-103`). A value equal to the one
  before is not a change, which is why the same text said twice needs an element of its own.
- **The server's API** (`servers/display/accessibility_server.cpp`, `accessibility_server_accesskit.cpp`):
  `create_sub_element(parent, ROLE_STATIC_TEXT)` (`:294`), `update_set_value` (`:833`),
  `update_set_live` with `LIVE_POLITE` or `LIVE_ASSERTIVE` (`:1061`) and `free_element`
  (`:598`). The three updates are refused outside the `NOTIFICATION_ACCESSIBILITY_UPDATE` (3000)
  of a Node (`in_accessibility_update`, `:613` and following), and `free_element` is refused
  inside it (`:599`). A sub-element joins its parent's child list at creation and leaves it when
  freed, but the OS tree only drops its node when the parent is updated again.
- **The update arrives only when a screen reader is looking.** `SceneTree::_flush_accessibility_changes`
  (`scene_tree.cpp:304-315`) calls `update_if_active`, whose callback runs only while the
  window's adapter is active (a client has asked for the tree). It runs at most
  `accessibility/general/updates_per_second` times a second (`:307-310`, `:2059`), so several
  announcements of one frame share an update. In a headless run everything is a dummy:
  `AccessibilityServer.is_supported()` is false, `is_accessibility_enabled()` is false,
  `create_element` returns an invalid RID and 3000 never arrives, even with
  `--accessibility always`.
- **No end-of-speech signal** exists in AccessKit, macOS or Godot. Godot's
  `DisplayServer.tts_speak` is not VoiceOver (it speaks without a screen reader), so using it to
  fabricate `announcementFinished` would invent an event.
- **Focus.** There is one: `SceneTree::_process_accessibility_changes` takes the AccessKit
  focus from `gui_get_focus_owner()` and overwrites any `update_set_focus` of the same batch
  (`scene_tree.cpp:285-295`). Moving the screen reader's focus is therefore `grab_focus()`,
  which releases the focus of every viewport and sends `FOCUS_EXIT` to a focused `TextInput`
  (`viewport.cpp:2724-2744`). The Views of the host are `FOCUS_NONE`; `FOCUS_ACCESSIBILITY`
  exists only with the screen reader on. The virtual `_get_focused_accessibility_element` can name another
  element for the same focus owner, but it still answers for the one keyboard focus.

## The contract

| RN | Here | Why |
| --- | --- | --- |
| `announceForAccessibility(text)` | A new static text element under the application's own element, with `text` as its value and `LIVE_POLITE`, made in the next accessibility update and freed outside the update after it. With no screen reader the call returns and the announcement is counted and dropped | AccessKit speaks a live node's value; an element per announcement is the iOS notification's equivalent |
| `announceForAccessibilityWithOptions(text, {priority})` | `"high"` is `LIVE_ASSERTIVE`; `"default"`, an absent or null priority and a string iOS ignores are `LIVE_POLITE`. `queue: false`, absent or null is accepted | iOS's own mapping, with the two live modes AccessKit has |
| `{queue: true}` | `E_UNSUPPORTED: announceForAccessibilityWithOptions queue: the macOS accessibility API has no announcement queue` | AppKit's announcement has no queue |
| `{priority: 'low'}` | `E_UNSUPPORTED: announceForAccessibilityWithOptions priority "low": AccessKit has only polite and assertive` | AccessKit has no live mode below polite |
| `{queue: <not a boolean>}`, `{priority: <not a string>}` | `E_ARGUMENT` (the typed bridge of iOS would not take them) | counted as `refused.announceInvalid` |
| An empty text | The call returns; counted as `dropped.empty` | AccessKit clears an empty value, so there is nothing to speak |
| `setAccessibilityFocus(tag)`, `sendAccessibilityEvent(handle, 'focus')` | `E_UNSUPPORTED: Godot has a single focus; moving the screen reader's focus would move the keyboard focus and blur the focused control, which iOS does not do`; the second fails out loud as a `FABRIC_ERROR` with the same text | See "Focus" above |
| `announcementFinished` | Never fires | No end-of-speech signal anywhere in the stack |

After `stop()` every method throws `E_MODULE_DISPOSED`; nothing is made, set or freed.

### The mechanism

`announcer` is a pure state machine in `native/accessibility_info_core.h`
(`accessibility::Announcer`), with a port (`AnnouncePort`) into the platform. The host's
port is `native/accessibility_announcer.{h,cpp}`; `FabricApplication` is the Node whose element
the announcements hang from, and it publishes when it receives
`NOTIFICATION_ACCESSIBILITY_UPDATE`.

1. **`announce(text, options)`** (a JS call). Options are checked first (`queue: true`, then
   `priority: "low"`, are refused and take nothing). The call is counted as requested
   and remembered as the last one. An empty text is dropped. With no screen reader (see the gate
   below) it is dropped and counted; it is never kept for one that turns on later. Otherwise it
   waits.
2. **`pump()`**, once per frame from the application's pump (`AccessibilityInfo::poll`), outside
   any update: frees the elements the last update published (`free_element` is refused
   inside an update), drops the waiting announcements if the screen reader is gone, expires the ones that
   waited more than 120 pumps for an update that never came (a screen reader that is not looking at this
   window), and asks for an update (`queue_accessibility_update()`) when something waits or something was
   freed (the update takes the freed nodes out of the OS tree).
3. **`publish()`**, inside `NOTIFICATION_ACCESSIBILITY_UPDATE`: for each waiting announcement, in order,
   `create_sub_element(application element, ROLE_STATIC_TEXT)`, `update_set_value(text)` and
   `update_set_live(...)`. Announcements of one frame share the update.
4. **`stop()`** drops what waits (`dropped.stopped`), frees what was published (outside any update,
   and never from inside the one the announcer runs), and is idempotent.

The **gate** that says a screen reader is there is `SceneTree.is_accessibility_enabled()` and
`AccessibilityServer.is_supported()` and an accessibility element for the application, and every
name the port calls is asked of the ClassDB once (`announcements.api` in the snapshot lists them and says
which, if any, are missing; an engine without one has no screen reader as far as the announcer knows).

The snapshot (`accessibilityInfo.announcements`) is `{requested, published, released, updatesRequested,
updates, pending, held, dropped: {noScreenReader, empty, expired, stopped}, refused: {queue, priority},
lastText, lastPriority, osTree, stopped, maxPendingPumps, api, recorded}`; `requested = published + pending
+ dropped`, always. `osTree` is whether an OS accessibility tree stands behind the application now.
`dropped.noScreenReader` also counts an announcement that found no element to be put in.

### The validation seam

A validation run replaces the AccessibilityServer by a recorder with the application's
`validation_accessibility_announcer` meta (a Dictionary read on every call: `available`, `element` and
`delivers`, each true unless it says false). The recorder runs the update the engine would run when one is
asked for, and records every call the announcer makes (`recorded`: `update.begin`, `create`, `value`,
`live`, `update.end`, `free`). The probe never sends the notification.

## What the tests prove

Three layers; none says that VoiceOver spoke.

- **The core** (`native/accessibility_info_core_test.cpp`, no engine): the exact sequence of calls of one
  announcement (create, value, live inside the update; the free outside the next one, followed by an
  update); the priority mapping; the refusals; the drop without a screen reader, including one that goes away while
  an announcement waits; an empty text; an element that cannot be made; expiry after 120 pumps; the same
  text twice as two elements; several announcements in one update; stop dropping what waits, freeing
  outside an update and idempotent, including a stop that arrives from inside the update.
- **The headless probe** (`npm run test:accessibility-info`, hosted CI): in application A the recorder is the
  server and every call above is made through RN's public `AccessibilityInfo` and through the module itself,
  with the independent oracle replaying each step against a state machine written from the rules (it
  compares counters and every recorded call); in application R the real, headless server has no screen
  reader, so announcements are dropped and counted, `osTree` is false and nothing is published. The engine's
  own ClassDB is asked for every name the port uses. The preceding host (slice 2a) fails exactly the 15
  checks this slice added, and eight retained sabotages are rejected (four of the announcements: the text
  in the name, the priorities swapped, no gate, one element reused).
- **The graphical lane** (`npm run test:accessibility-info:bridge`, local, a window session on macOS,
  no TCC permission): the same bundle runs in a real window with `--accessibility always`, and an inspector
  injected with `DYLD_INSERT_LIBRARIES` (`tests/accessibility-bridge-probe.m`) interposes
  `NSAccessibilityPostNotificationWithUserInfo`, the call AccessKit makes for the announcement. The
  test judges what the host made AccessKit post.

### What is derived and what is measured

**Derived from the code** (not measured here): the conditions under which the adapter queues an announcement
(`event.rs`); the 60 updates a second; that the update comes only while the adapter is active; the
structure of the Godot sources quoted above; iOS's behavior (the RN sources, Apple's documentation).

**Measured** (Godot 4.7.2 official build, macOS, arm64, 2026-10-08):

- dyld interposition works with the official binary (its entitlements allow
  `DYLD_INSERT_LIBRARIES`); the first query of the tree activates the adapter.
- A node with a value and a live mode posts `AXAnnouncementRequested` on the window with the text and
  the priority level 90 for assertive and 50 for polite. A node with only a **name** posts nothing: on the
  `announce-name` host, the same lane records no post for eight announcements.
- The same text said twice in two elements is posted twice.
- Through RN and the host, one frame's three announcements were three posts, **in an order that was not the
  order made** (`Second`, `First`, `Third`, with `Third` high), while a spike that wrote the elements in
  Godot directly happened to post them in creation order. The order inside one update belongs to AccessKit.
- The announcement elements are gone from the OS tree after they are freed.
- On the sabotage hosts: the priorities swapped post 90 for the default ones and 50 for the high one;
  one reused element posts the first announcement only.

**Not measured**: that VoiceOver spoke; any other screen reader or platform; the `accessibilityLiveRegion`
of a View (see below); an announcement while the user's own VoiceOver was running.

## Open

- **Order inside a frame.** The order in which AccessKit posts the announcements of one update is not the order
  they were made in (measured, above). iOS posts them in order, and without `queue` each interrupts the one before,
  so which of several announcements of one frame is heard differs. A fix is to publish one announcement per update
  (one more frame of latency for each additional announcement of the same frame); the slice keeps the closed
  decision that a frame's announcements share an update, and reports this.
- **`queue: true` and `priority: 'low'`** are refused: AppKit's announcement has no queue and AccessKit has two live
  modes. A later slice could queue in the host (announce the next when the first would be done), which needs the
  end-of-speech signal nobody has.
- **`announcementFinished`** never fires. A mobile bridge (GF-34, GF-35) may have one.
- **Focus.** `grab_focus()` with `FOCUS_ACCESSIBILITY` (the mode that exists only with the screen reader on) and the
  virtual `_get_focused_accessibility_element` were the investigated paths. The first moves the keyboard focus and
  blurs the focused control, which iOS does not do; the second names another element for the same keyboard focus owner and
  cannot move the screen reader without it. Refused with the reason; a Godot change (a separate accessibility focus) is the way.
- **`accessibilityLiveRegion` of a View** (slice 1) sets `accessibility_live` on a node with a name, not a value
  (`native/accessible_view.cpp:134-136`). By the adapter's code that probably speaks nothing on macOS, and the sentence of
  [accessibility.md](accessibility.md) that said to combine `alert`, `status` and `timer` with it was probably wrong (corrected).
  Not measured on VoiceOver and not changed by this slice.
- **One application element.** Announcements hang from the `FabricApplication`'s own element; two applications in one window
  announce to the same window. A node out of the window's tree (not visible, not inside the tree) has no element and drops.
- **Text beyond a screen reader's buffer**, long texts and rate limits of an application that announces in a loop are not bounded
  by the host beyond the 120-pump expiry.
- **Windows and Linux** have AccessKit adapters whose announcement behavior is not measured here.

## Sources

- `Libraries/Components/AccessibilityInfo/AccessibilityInfo.js`: 436, 459-465, 479-495.
- `src/private/specs_DEPRECATED/modules/NativeAccessibilityManager.js`: 63-70.
- `React/CoreModules/RCTAccessibilityManager.mm`: 55-56, 111-123, 311-358.
- `React/Fabric/Mounting/RCTMountingManager.mm`: 342-348.
- `ReactAndroid/src/main/java/com/facebook/react/modules/accessibilityinfo/AccessibilityInfoModule.kt`: 282-292.
- Godot 4.7.2: `scene/main/node.cpp` (`NOTIFICATION_ACCESSIBILITY_UPDATE`, `get_accessibility_element`),
  `scene/main/scene_tree.cpp:285-315,2059`, `scene/main/window.cpp:1577-1621,2492-2496`,
  `servers/display/accessibility_server.cpp`, `accessibility_server_accesskit.cpp:294,598-599,613,833,1061`,
  `scene/main/viewport.cpp:2724-2744`.
- AccessKit macOS adapter 0.26: `platforms/macos/src/event.rs:35-43,65-103,228-240,242-306`.
