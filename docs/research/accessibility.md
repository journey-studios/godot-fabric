# Accessibility: RN's accessibility props over Godot's AccessKit tree

Status: first slice of GF-20. The semantic tree of `View`, `Pressable` and the
touchables reaches Godot's accessibility element for each Control, and on
macOS the tree is readable and pressable through NSAccessibility (proved by an
in-process inspector, not by a screen reader).
**Two kinds of proof back this, and they are not the same.** The headless
suite (`npm run test:accessibility`) proves metadata: the descriptor the host
resolved, the properties it set on each Control and the host path of the OS's
press. It cannot prove what an assistive technology sees, because Godot has no
OS accessibility driver without a window. The graphical macOS test
(`npm run test:accessibility:bridge`, local, not in hosted CI) proves the real
tree: it injects an NSAccessibility inspector into the running Godot and reads
the tree that `NSApp` serves, and presses elements with `AXPress`. Neither
certifies a screen reader's speech, other platforms or mobile. The
[evidence record](../evidence/accessibility/README.md) pins the runs, hashes,
controls and captures.

Not in this slice: `AccessibilityInfo` (settings and events, the fatter half of
the roadmap item; they are the [next note](accessibility-info.md), and the announcements `announceForAccessibility` speaks are the
[one after](accessibility-announcements.md)), text scale, focus and keyboard navigation, the announcement of a View's live region, custom actions (`accessibilityActions`), group
semantics that suppress children (`accessible` on a container), Text (GF-11),
Button and TextInput of the host (GF-17), and the mobile bridges (see Open).

## What RN does

`View.js` (`Libraries/Components/View/View.js` lines 35-110) turns the `aria-*`
props into `accessibility*` props before the native component sees them:
`aria-label` into `accessibilityLabel`, `aria-live` into `accessibilityLiveRegion`
(`off` becomes `none`), `aria-hidden` into `accessibilityElementsHidden` (and
`importantForAccessibility="no-hide-descendants"` when true), and the
busy/checked/disabled/expanded/selected `aria-*` into one `accessibilityState`.
The touchables forward the props (`TouchableOpacity.js` lines 229-270); RN's
`Pressable.js` (lines 249-280) merges its `disabled` prop into the state and is
accessible unless told otherwise. The platform base ViewConfig
(`BaseViewConfig.ios.js` lines 192-239, 385-388) is what lets the props through
to the host.

The C++ side parses all of it in `AccessibilityProps`
(`ReactCommon/react/renderer/components/view/AccessibilityProps.h` lines 31-57).
The iOS mount (`RCTViewComponentView.mm` lines 398-506) applies the label, hint,
role traits, `selected`/`disabled`, `accessible` and the rest to the view's
accessibility element, and `accessibilityActivate` (lines 1601-1650) dispatches
`onAccessibilityTap` when there is a handler, and otherwise returns NO so that
iOS synthesizes a tap at the element.

## What Godot offers

Godot 4.7.2 has the `AccessibilityServer` singleton, and every `Node` already
owns an element in the tree it builds with AccessKit (macOS, Windows, Linux).
`Control` publishes `accessibility_name`, `accessibility_description` and
`accessibility_live`; `BaseButton` adds the button role and `ACTION_CLICK`. The
tree is updated only while an assistive technology is active (or with
`--accessibility always`), and only inside `NOTIFICATION_ACCESSIBILITY_UPDATE`
(3000). `AccessibilityServer` has no getters, and a headless Godot runs the
dummy driver (`is_supported()` is false and an element's RID is invalid).

## What this host did

The host drew a `View` as a plain `Panel`: the element existed, without a name,
a description, a role or an action. The facade `View` discarded `accessible`,
`accessibilityRole` and `accessibilityLabel`, and the ViewConfig did not let
the accessibility props through.

## The implementation

- **Core.** `native/accessibility_core.h` is pure C++ (no Godot, no RN). It
  holds the role table below and `resolve()`: from what RN parsed (`Input`) to
  a `Descriptor`, or to the reasons it cannot be honored. A mobile bridge
  (GF-34, GF-35) consumes the same decisions. Its own test,
  `native/accessibility_core_test.cpp`, checks that the table covers exactly the
  two RN vocabularies and every Godot role constant it names exists.
- **View.** `GodotAccessibleView` (`native/accessible_view.{h,cpp}`) is a
  GDExtension subclass of `Panel` that becomes the Control of every `View`
  (and of the touchables, which are Views in the host). `apply()` resolves the
  props; the name, description and live region are Godot properties of the
  Control, set at once; the role, role description, states and the press are
  published inside `NOTIFICATION_ACCESSIBILITY_UPDATE`. It stays a `Panel` and
  keeps its mouse filter. `apply()` runs for every View on every commit that
  touches it, and most Views carry no accessibility props, so a View whose
  resolved descriptor is the one it already has (nothing rejected before or now)
  is counted and skipped: no property is set and no constant is looked up. The
  engine's `AccessibilityServer` constants are asked of `ClassDB` once per
  process; a missing one is still an explicit error.
- **JS.** `src/accessibility-view-config.js` lists the supported attributes
  and checks their values in `process`, so an unsupported value fails where the
  View renders, naming the prop. `src/base-view-config.js` imports it for both
  the GodotControl ViewConfig and the base config of RN's `View`. The facade
  `View` no longer discards the props; the Godot `Pressable` applies RN's
  `aria-*` conversion and `Pressable` defaults itself, because it does not
  render RN's `View.js`.
- **Types.** `AccessibilityProps` in `types/react-native.ts`, on `View` and
  `TouchableOpacity`, lists only the supported roles; unsupported values are
  compile errors (`tests/types/consumer.tsx`).

### Props

| Prop | Becomes |
| --- | --- |
| `accessibilityLabel`, `aria-label` | the Control's `accessibility_name`, literally |
| `accessibilityHint` | the Control's `accessibility_description`, literally |
| `accessibilityRole`, `role` | the Godot role and role description of the table; `role` wins |
| `accessibilityState` / `aria-*` | `disabled` and `busy` flags; `checked` (true/false); `selected`; `expanded` |
| `accessibilityLiveRegion`, `aria-live` | `accessibility_live` (`none`, `polite`, `assertive`) |
| `accessibilityElementsHidden`, `importantForAccessibility="no-hide-descendants"`, `aria-hidden` | `FLAG_HIDDEN` |
| `onAccessibilityTap` | the OS's press dispatches this event (see Activation) |
| `accessible` | recorded; it offers the press, and nothing else (no grouping) |

The label and the hint are the app's words, not translation keys. Godot's
`Control.get_accessibility_name()` runs the text through `tr()`, and
`auto_translate_mode` does **not** stop that (measured in 4.7.2: with the mode
disabled and a translation for the word, the name was still translated), so
the view turns the node's message translation off as well
(`set_message_translation(false)`).

### Roles

Every spelling of RN 0.87.1's `accessibilityRole` and `role`
(`ViewAccessibility.js`) is either mapped or rejected: of the 105 spellings (40 + 65), 61 map and
name 44 distinct roles (42 with a Godot role, plus `none` and `presentation`), and 44 are rejected
and name 39 distinct roles (five names are rejected in both vocabularies). `role` takes precedence
over `accessibilityRole`, as in RN, and both are validated. A role without a
Godot equivalent is never replaced by a generic one (`ROLE_UNKNOWN` and
`ROLE_PANEL` are used by no row); a role Godot has no word for gets the nearest
role plus a role description (`header` is static text described as a
heading). The role descriptions are English words; where a role has none the OS
says its own, localized word. The pure table in the core, the oracle's table,
the TypeScript unions and this table are checked against each other by the test.

| Spelling | Vocabulary | Godot role | Role description | Capabilities |
| --- | --- | --- | --- | --- |
| `none` | accessibilityRole, role | none | - | - |
| `presentation` | role | none | - | - |
| `button` | accessibilityRole, role | `ROLE_BUTTON` | - | pressed, expanded |
| `togglebutton` | accessibilityRole | `ROLE_BUTTON` | `toggle button` | checked, pressed |
| `imagebutton` | accessibilityRole | `ROLE_BUTTON` | `image button` | pressed |
| `keyboardkey` | accessibilityRole | `ROLE_BUTTON` | `keyboard key` | pressed |
| `link` | accessibilityRole, role | `ROLE_LINK` | - | pressed |
| `checkbox` | accessibilityRole, role | `ROLE_CHECK_BOX` | - | checked, pressed |
| `radio` | accessibilityRole, role | `ROLE_RADIO_BUTTON` | - | checked, pressed |
| `switch` | accessibilityRole, role | `ROLE_CHECK_BUTTON` | - | checked, pressed |
| `menuitem` | accessibilityRole, role | `ROLE_MENU_ITEM` | - | pressed, expanded |
| `option` | role | `ROLE_LIST_BOX_OPTION` | - | selected, pressed |
| `tab` | accessibilityRole, role | `ROLE_TAB` | - | selected, pressed |
| `text` | accessibilityRole | `ROLE_STATIC_TEXT` | - | - |
| `header` | accessibilityRole | `ROLE_STATIC_TEXT` | `heading` | - |
| `heading` | role | `ROLE_STATIC_TEXT` | `heading` | - |
| `image` | accessibilityRole | `ROLE_IMAGE` | - | - |
| `img` | role | `ROLE_IMAGE` | - | - |
| `progressbar` | accessibilityRole, role | `ROLE_PROGRESS_INDICATOR` | - | - |
| `alert` | accessibilityRole, role | `ROLE_STATIC_TEXT` | `alert` | - |
| `status` | role | `ROLE_STATIC_TEXT` | `status` | - |
| `timer` | accessibilityRole, role | `ROLE_STATIC_TEXT` | `timer` | - |
| `tooltip` | role | `ROLE_TOOLTIP` | - | - |
| `list` | accessibilityRole, role | `ROLE_LIST` | - | - |
| `listitem` | role | `ROLE_LIST_ITEM` | - | selected |
| `menu` | accessibilityRole, role | `ROLE_MENU` | - | - |
| `menubar` | accessibilityRole, role | `ROLE_MENU_BAR` | - | - |
| `tablist` | accessibilityRole, role | `ROLE_TAB_BAR` | - | - |
| `tabbar` | accessibilityRole | `ROLE_TAB_BAR` | - | - |
| `tabpanel` | role | `ROLE_TAB_PANEL` | - | - |
| `dialog` | role | `ROLE_DIALOG` | - | - |
| `alertdialog` | role | `ROLE_DIALOG` | `alert dialog` | - |
| `radiogroup` | accessibilityRole, role | `ROLE_CONTAINER` | `radio group` | - |
| `toolbar` | accessibilityRole, role | `ROLE_CONTAINER` | `toolbar` | - |
| `group` | role | `ROLE_CONTAINER` | - | - |
| `viewgroup` | accessibilityRole | `ROLE_CONTAINER` | - | - |
| `search` | accessibilityRole | `ROLE_REGION` | `search` | - |
| `region` | role | `ROLE_REGION` | - | - |
| `banner` | role | `ROLE_REGION` | `banner` | - |
| `complementary` | role | `ROLE_REGION` | `complementary` | - |
| `contentinfo` | role | `ROLE_REGION` | `content information` | - |
| `form` | role | `ROLE_REGION` | `form` | - |
| `main` | role | `ROLE_REGION` | `main` | - |
| `navigation` | role | `ROLE_REGION` | `navigation` | - |

Capabilities say what a role can carry. A state set on a role without the
capability is rejected rather than accepted and shown to nobody: `checked` needs
a checkable role, `selected` a selectable one (the roles whose selection the
macOS adapter showed: tab, list item, option), `expanded` an expandable one (the
disclosure-style controls, button and menuitem; the macOS adapter shows `expanded`
on none, see Open), and "pressed" says the OS offers the press without an
`onAccessibilityTap`. `disabled` and `busy` are valid on every role.

Rejected, each with its reason in the error:

- `accessibilityRole`: `dropdownlist` (an Android Spinner), `adjustable`
  (needs increment and decrement actions), `summary`, `combobox`, `scrollbar`,
  `spinbutton` (they need a value and a range), `grid` (table semantics),
  `pager`, `webview`, `drawerlayout`, `slidingdrawer`, `iconmenu` (Android
  widget classes), `scrollview`, `horizontalscrollview` (the ScrollView
  component exposes those).
- `role`: `application`, `article`, `definition`, `directory`, `document`,
  `feed`, `figure`, `log`, `marquee`, `math`, `note`, `term`, `separator`
  (no Godot equivalent); `slider`, `meter`, `scrollbar`, `spinbutton`
  (value semantics); `table`, `treegrid`, `row`, `rowgroup`, `rowheader`,
  `columnheader`, `cell`, `grid` (table semantics); `tree`, `treeitem` (levels);
  `combobox`, `summary`; `searchbox` (a View is not editable).

`alert`, `status` and `timer` are static text with a word, and the word does not make
them speak. Godot has no announce method for an extension, and AccessKit's macOS
adapter speaks a live node only when it has a **value** (`event.rs` `node_added` and
`node_updated`): `accessibilityLiveRegion` sets `accessibility_live` on a node that has
a name (`native/accessible_view.cpp:134-136`), so it is probably silent on macOS too. This
sentence used to say to combine the roles with `accessibilityLiveRegion` and was probably
wrong; the behavior of the live region is not measured on VoiceOver and is open
([accessibility-announcements.md](accessibility-announcements.md); use
`AccessibilityInfo.announceForAccessibility` to speak).

### Errors

A value the host cannot honor fails explicitly, and the View then carries no
semantics at all (not the part that could have been applied; a half-applied
View would be a generic one in disguise). The same reasons are reported once
while they stand.

At the JS layer (where the View renders, a React error naming the prop):
a value of the wrong type (a numeric label, a string `accessible`, a state
value that is not a boolean), a role outside RN's two vocabularies (`banana`,
or `heading` as an `accessibilityRole`), `accessibilityLiveRegion` or
`importantForAccessibility` outside RN's values, and non-empty
`accessibilityActions`.

At the host (a `FABRIC_ERROR`, listed in the application's `errors`): a role of
the rejected list, `accessibilityState.checked: "mixed"` (Godot has no mixed
state), a state on a role that cannot show it, and `importantForAccessibility="no"`
(Godot hides an element only with its descendants). The core rejects
`accessibilityActions` too, for a bridge that does not go through the JS
ViewConfig. `accessibilityState` as a string is not an error the platform can
see: RN's own `View.js` rebuilds the state object from its keys before the
ViewConfig.

### Updating and removing

The host recomputes the descriptor from the full prop set at every update, so
a removed prop clears what it set. One exception comes from RN itself:
`AccessibilityProps.cpp` keeps the previous value of `accessibilityRole` and
`role` when the prop arrives as `null`, which is how a removal is sent. The
ViewConfig maps a `null` role to `"none"` and the facade `View` and `Pressable`
send `"none"` explicitly, so a role does clear; code that renders RN's own
`View` module directly must do the same.

### Activation

An OS press (`ACTION_CLICK`) behaves like iOS's `accessibilityActivate`:

- With an `onAccessibilityTap` handler it dispatches that event
  (`topAccessibilityTap`) and nothing else: no touch, no `onPress`.
- Without one, it presses the View where it is: a primary mouse press and
  release at the center of the element through Godot's input
  (`Input.parse_input_event`), so the View's `Pressable` or Touchable handling
  runs through the pipeline a mouse uses and `onPress` follows. The click goes
  to whatever is on top of the center: an element overlapped there receives
  it instead.
- A hidden or disabled element has no action. A View offers the press when it
  is `accessible`, has an `onAccessibilityTap` handler, or has a role the
  table marks "pressed". A plain View offers none.

## Proof

### Headless (`npm run test:accessibility`)

`tests/accessibility-probe.gd` mounts two roots of one Hermes application with
RN's `View`, `Pressable` and `TouchableOpacity`, and
`tests/accessibility-oracle.mjs` re-derives every stage from the raw
observations with its own table. It proves, and says in its report that this is
metadata only (`scope.metadataOnly`, `osTree: false`):

- the descriptor of every static element, in both roots, and the Control's
  name, description and live mode (the engine's constants, looked up by the
  probe itself);
- 32 updates and removals of one view, `aria-*` against `accessibility*`, and
  the whole of both role vocabularies (105 spellings, 61 mapped and 44 rejected) swept, each mapped with the
  engine's number or rejected with exactly one error;
- the negatives: 13 invalid values stopped where the View renders (an error
  boundary keeps each), 9 the host rejects, their reasons reported once, and a
  rejected View carrying nothing;
- the host path of the OS's press: `onAccessibilityTap` alone, a touch and one
  `onPress` for `Pressable` and `TouchableOpacity` without a handler, no effect on
  a disabled, hidden or plain View, the other root unaffected;
- hiding, removal, a remount and an in-place relabel;
- the skip of an unchanged descriptor, from counters in each View's snapshot
  (`applies` and `skippedApplies`, no timing): every View with the empty
  descriptor is skipped every time, one with a descriptor is applied at least
  once, and an update with different props and the same descriptor is skipped.

What the headless run does not do is publish: `NOTIFICATION_ACCESSIBILITY_UPDATE`
never arrives without an OS tree, so the role, the states and the action are in
the descriptor and not yet in Godot's server. The press is called by the probe
(`accessibility_click`, the method the AccessibilityServer calls), not by the OS.

The control with the preceding host (the same bundle, `main`'s dylib) fails
exactly 10 checks, the ones that read a descriptor the preceding host does not
have. Four retained sabotages, each rebuilding the host with one decision
broken, are rejected by the probe's checks and by the oracle:

- the applier does not set the name;
- `ACTION_CLICK` does nothing;
- the role table is swapped (`button` becomes a link);
- `hidden` is ignored.

### Graphical, on macOS (`npm run test:accessibility:bridge`)

Not part of hosted CI (which is headless), and it needs a window session; it
fails with a clear message when there is none, and is never skipped. It
compiles `tests/accessibility-bridge-probe.m`, runs the graphical Godot with
`DYLD_INSERT_LIBRARIES` (the official build's entitlements allow it) and
`--accessibility always`, and the inspector walks the real NSAccessibility
tree of the window (`AccessKitSubclassOfGodotContentView`): role, title, help,
value, enabled, selected. It presses elements with `accessibilityPerformPress`
and checks that RN's callbacks fired, that updating and removing props moves the
tree, and that `aria-hidden` removes the element together with its descendants.
An external `AXUIElement` client would need the TCC permission; the injected
inspector needs none.

What the tree showed (macOS 26.6.2, Godot 4.7.2, one real run): the label as
the title and the hint as the help; `button` as `AXButton`; `switch` as
`AXCheckBox` with subrole `AXSwitch` and `checked` as its value (1 or 0);
`togglebutton` as `AXCheckBox` / `AXToggle` with the role description
`toggle button`; `tab` as `AXRadioButton` / `AXTabButton` whose value is
`selected`; `header` as `AXStaticText` described as `heading`; `banner` as
`AXGroup` / `AXLandmarkRegion`; `link` as `AXLink`; `selected` on a list item as
`AXSelected`; `disabled` as not enabled; a View without a role as `AXUnknown`.
The press of `AXPress` ran `onAccessibilityTap` on the View that had it, a click and
`onPress` on `Pressable` and `TouchableOpacity`, and was refused by the disabled
ones. Hiding a View removed it and its descendants from the tree, and `display:
none` is never mounted by Fabric, so nothing of it exists. A prop update, a removal
and an unmount/remount moved the tree as soon as the frames delivered it (the
waits met their state in one to four polls).

## Open

- **AccessibilityInfo** (settings and events, the `AccessibilityManager`
  contract) is the second slice, part a, now in the [AccessibilityInfo note](accessibility-info.md): the alias in the SDK's platform
  plugin and the polling of the OS settings are in place; the announcements (`announceForAccessibility`) and the refused
  focus are part b, the [announcements note](accessibility-announcements.md).
- **Mobile.** Godot 4.7.2 has no accessibility bridge on iOS or Android. This is a
  real blocker for GF-34 and GF-35, to be resolved early: the core is ready to
  feed a bridge, but the bridge is not.
- **Hosted CI** is headless, so the bridge test does not run there.
- **Not mapped yet**: `accessibilityValue` and `aria-value*`,
  `accessibilityLabelledBy`/`aria-labelledby`, `accessibilityViewIsModal`,
  `accessibilityLanguage`, `accessibilityActions` (fails) and the handlers that
  need them, `focusable`/`tabIndex`, group semantics, the announcement of a View's live region (probably silent on
  macOS; see Errors above and [accessibility-announcements.md](accessibility-announcements.md)), text scale.
  The first ones are dropped by the ViewConfig like any unregistered prop and have
  no type.
- **Selection, expansion and busy on macOS.** Measured on macOS 26.6.2:
  AccessKit's adapter exposes `selected` for list items and options only (a tab
  shows it as the radio value), and serves neither `expanded` nor `busy`. Those two
  are published to Godot (the descriptor and the headless suite carry them), and
  the bridge test does not cover them because the NSAccessibility tree does not
  show them; other platforms' trees are unverified.
- **Other elements.** `Text` (GF-11), the host's Button and TextInput (GF-17)
  and the Switch keep their own Godot semantics; the Switch's accessible role is
  not yet RN's.
- **Wider hardware certification**: no screen reader's speech was heard, only
  the tree a screen reader reads.
