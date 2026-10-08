# Clipboard, links and vibration over Godot's device services

```sh
npm run example -- device-services
npm run example -- device-services --headless
npm run example -- device-services --capture
npm run test:device-services
```

React Native's original `Clipboard`, `Linking` and `Vibration` run in the application from the
public `react-native` import, over three C++ TurboModules the host installs (`LinkingManager` with
iOS's contract, `Clipboard` and `Vibration`). The first command opens the interactive scene;
`--headless` and `--capture` are the bounded runs (headless engine, and the native renderer with
the frames saved to `build/`). The scene never touches the real machine: it replaces every
platform backend (`OS.shell_open`, the `DisplayServer` clipboard and `Input.vibrate_handheld`) with
a stand-in that records what it was asked, through the application's
`validation_device_services` meta, so **Open URL does not open a browser, Copy and Paste use an
in-memory pasteboard and Vibrate does not vibrate**, interactive runs included.

## Use the example

The React screen has four buttons and a status block:

- **Copy** calls `Clipboard.setString` with a sample text that has multibyte characters and an
  emoji; **Paste** calls `Clipboard.getString` and shows what came back.
- **Open URL** calls `Linking.openURL` with a fixed `https` URL; the status line reports it opened,
  or the rejection (`Unable to open URL: ...`).
- **Vibrate** calls `Vibration.vibrate(150)`.
- **Launch URL** shows what `Linking.getInitialURL()` returned: the `--uri=` the process was
  started with, or `No launch URL`.
- **Deep link** shows the links the screen's `Linking.addEventListener('url', ...)` heard.

The **Deep link** button and the list of recorded backend calls on the right are native Godot
nodes, not React. A deep link is something the platform hands to the running application, not
something a React screen can ask for, so the button calls `FabricApplication.deliver_url(url)`, the
entry point a launcher or a future mobile plugin would call; the screen only listens, and hears each
link once. The list shows the stand-in backend's last calls (`set ...`, `get`, `open ...`,
`vibrate 150`), which is how you can see that Open URL asked for the exact URL and nothing opened.

Try this: press Copy, then Paste (the pasted text is what Copy wrote, the emoji included), and press
Deep link twice (two numbered links, in order). To see the launch URL change, start Godot yourself
after one `npm run example -- device-services` has built the bundle, with the scene and a user
argument: `Godot --path . res://examples/device-services/scene.tscn -- --uri=godotfabric://launch/x`
(on macOS a launcher passes the URL the same way). The failure paths, a backend that refuses and a
clipboard that is unavailable, are driven by the validation run, which flips the stand-in
backend's switches and reads `Unable to open URL: ...` and `E_CLIPBOARD_UNAVAILABLE` off the screen;
`--capture` saves a frame of them.

## What the validation proves

`validation.gd` clicks every button with real mouse events (the native Deep link button too, with
the surface's own input suspended, because the surface consumes the mouse events of its validation
device) and reads the result from the native tree, from what React observed and from the host's
own counters:

- the four buttons mount as native Controls, and a process started without `--uri=` shows no launch
  URL; only the `LinkingManager` module exists until a button is pressed;
- Copy writes the sample to the clipboard backend, Paste reads it back, and a change made outside
  the application is what Paste reads next;
- Open URL asks the backend for the exact URL once, a backend that fails rejects with RN's message,
  and an unavailable clipboard makes both Copy and Paste report `E_CLIPBOARD_UNAVAILABLE`;
- the native button's links arrive once each, in order; Vibrate passes 150 to the backend; the host's
  counters match the clicks; a stop releases the root and makes `deliver_url` return `false`.

The same checks run headless and with the native renderer; the [evidence record](../../docs/evidence/device-services/README.md)
has the seven frames that `--capture` saves. `npm run test:device-services` is the
evidence suite, outside the catalog: the original modules in two applications (a recording
validation backend, and Godot's real one in headless Godot) with the preceding host as the control,
two retained sabotages and an independent oracle; the [research note](../../docs/research/device-services.md)
has the contract and its limits.

## Limits

`canOpenURL` answers by scheme because Godot cannot ask which handlers are installed; `openSettings`
and `sendIntent` reject; a vibration cannot be cancelled and RN's own repeating pattern is not
stopped by `cancel()`; the real pasteboard, a real browser and real vibration are not exercised here;
Alert, Share, Settings and BackHandler, mobile deep-link plugins, Windows and Linux are open.
