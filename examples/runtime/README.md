# JavaScript runtime

Run `npm run example -- runtime`. Start the clock, pause it, or run it again.
The public React/React Native application uses `setInterval`, extra callback
arguments, `requestAnimationFrame`, state and effect cleanup. Four portable
runtime probes are also shared with the original RN iOS/Android reference app.

Acceptance: `npm run example -- runtime --headless` or
`npm run example -- runtime --capture`. The native lane injects actual viewport
pointer input and checks renderer pixels as well as Hermes state and Controls.

Screenshots and the measured scope are documented in
[runtime evidence](../../docs/evidence/runtime/README.md).
