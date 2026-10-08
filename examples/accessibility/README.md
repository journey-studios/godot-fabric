# Accessibility

```sh
npm run example -- accessibility              # interactive window
npm run example -- accessibility --headless   # bounded, no window
npm run example -- accessibility --check      # bounded, in a window
npm run example -- accessibility --capture    # bounded, saves the frames
npm run test:accessibility                    # evidence suite, headless (metadata)
npm run test:accessibility:bridge             # the OS tree, graphical macOS only
```

A small feedback form written the way React Native writes accessibility: `View`,
`Pressable` and `TouchableOpacity` from the public `react-native` import, with
`accessibilityLabel`, `accessibilityHint`, `accessibilityRole` and `role`,
`accessibilityState` and `aria-*`, `accessibilityLiveRegion`, `aria-hidden` and
`onAccessibilityTap`. Nothing in the source names Godot. The host gives each View an
accessibility element in Godot's AccessKit tree with that name, description, role,
state and press, so a screen reader on macOS reads and presses it.

What the form has:

- a heading (`accessibilityRole="header"`, announced as a heading);
- a tab list of two tabs, one selected (`role="tab"`, `aria-selected`, `aria-label`);
- a radio group of three radios (`accessibilityRole="radio"`, `accessibilityState.checked`);
- a Send button that is disabled until a rating is chosen (`TouchableOpacity` with `disabled`);
- a Start over button that answers the OS's press with `onAccessibilityTap` and a mouse
  click with `onPress`;
- a status that is a polite live region (`accessibilityLiveRegion="polite"`);
- a decoration hidden from assistive technologies (`aria-hidden`).

## Use the example

![Compact tab selected, no rating chosen and Send disabled](../../docs/evidence/accessibility/accessibility-initial.png)

**Initial** is the screen as mounted: Compact selected, three unchecked radios, Send
disabled until a rating is chosen, and the polite status asking for one. The decoration at
the bottom is drawn, and removed from the OS's accessibility tree by `aria-hidden`.

![Detailed tab selected, rating 2 checked and Send sent](../../docs/evidence/accessibility/accessibility-sent.png)

**After the presses** is the screen after the OS's press (the host path) on the Detailed tab,
the second radio and Send. Send ran once and disabled itself, and the live region says `Thanks!
You rated this 2 of 3`. The [evidence record](../../docs/evidence/accessibility/README.md)
pins these captures and the runs behind this example.

## What the validation establishes

[validation.gd](validation.gd) runs headless and in a window. It reads the semantic
descriptor the host resolved for each element (the name, description, role, Godot role,
checked, selected, disabled, live and hidden state, and whether it offers a press) and
what React observed. Then it presses through the host path of the OS's action, the
method that Godot's `AccessibilityServer` calls (`accessibility_click`):

- the second radio becomes the only checked one, Send is enabled and offers the press, and
  the status says what the screen says;
- the other tab becomes the selected one;
- Send, a `TouchableOpacity`, runs once, tells the live region and disables itself again;
- a press on the disabled Send is refused by the host (one more request, counted as ignored, no
  click or tap sent on) and Send's handler does not run again, and the same press on the hidden
  decoration is refused by the host's counters alone;
- choosing another rating after the send clears it: the status follows the new rating and Send
  offers the press again;
- Start over answers with `onAccessibilityTap`, and the form starts over.

The headless run and the window run both pass 18 checks; `--capture` adds the two
renderer captures (20). **This proves the metadata and the host path of the press. It does
not read the OS tree**, which is why the example has no claim about what an assistive
technology sees: [accessibility-bridge.test.mjs](../../tests/accessibility-bridge.test.mjs)
does that, for the elements of its own fixture, on a graphical macOS run.

## Reading the real tree

```sh
npm run test:accessibility:bridge
```

It needs a macOS login session with a window, and it fails with a clear message
without one. It opens the graphical Godot with `--accessibility always`, injects an
NSAccessibility inspector into the process and reads the tree that the window serves to the
system: role, title, help, value, enabled and selected of every element. It presses elements
with `accessibilityPerformPress` (the call behind `AXPress`) and checks that RN's callbacks
fired, that updating and removing props moves the tree, and that `aria-hidden` removes an
element and its descendants.

## Limits

This slice maps the semantic tree and the OS's press. Text scale, `AccessibilityInfo`
(settings and events), focus and keyboard navigation, announcements, custom
`accessibilityActions`, grouping children under an `accessible` container, `Text`, the host's
`Button` and `TextInput`, and mobile are open. Unsupported values fail explicitly (see the
[research](../../docs/research/accessibility.md)). The OS's press on an element without an
`onAccessibilityTap` handler clicks its center, so an element overlapped there receives the
click instead.
