# Original View pointerup: native filter gap

The original RN imperative `pointerup` listener can be registered and invoked
with an independent untrusted public dispatch. The Down-only native interest
filter still drops the real Up before the SDK query is entered.

[Initial executed negative receipt](negative.json) uses official Godot 4.7.2,
RN 0.87.1 and React 19.2.3 on macOS arm64. The two bubble/capture-only cases
retain **54/62 passing checks and eight visible normative failures**: callback,
typed/star Raw, React/native commit and SDK qualification for each phase.
TouchStart, TouchEnd and its Raw channels, B while A is held, Cancel and stop
remain independently healthy. Both Up stages record zero SDK entries.

```sh
node tests/pointer-up-native.test.mjs --allow-original-negative
```

This option selects no binary and permits only the exact eight failures.
It records failed checks before process assertions; unexpected errors fail.
The current normative command is `npm run test:pointers:up` and remains red
on this preceding host. A production correction and its verified receipt
are the next step. Public flags remain disabled.

This is the View/both-flags scope. Document/other flags, removal/once/abort,
captured-Up, physical hardware, mobile exports and complete priorities remain
open. Down is deliberately filtered; no Down/Up pointer-ID identity is claimed.
