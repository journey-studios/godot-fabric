# Original TextInputState and Godot focus

Implementation [3b09b37](https://github.com/journey-studios/godot-fabric/commit/3b09b37acf735664301d3ddaf9ab275519893267)
matches all recorded source, native input and capture hashes.

The [public focus fixture](../../../examples/focus/README.md) runs on macOS
arm64, official Godot 4.7.2 Compatibility, React Native 0.87.1, React 19.2.3,
Hermes and a Release GDExtension. Source/native identities are recorded in
[provenance.json](provenance.json), including 13 JS/fixture inputs and 47 native
inputs. The native host SHA-256 is
`6abafb9f751b1b75f477b76d0db76dc9d3c4a897a91d76f158cbffc564845f2e`.
The official Godot engine was not rebuilt.

## Executed results

| Check | Result | Receipt |
| --- | --- | --- |
| Final focus fixture, headless | 175/175 | [checks](checks.json) |
| Final focus fixture, native window | 189/189; 12 RGBA samples and two captures | [checks](checks.json) |
| Same final fixture, preceding native host `42ee5c7…` | 23 expected failures / 160 executed checks, exit 1; six expected unsupported focus/blur diagnostics | [negative controls](negative-controls.json) |
| Same final fixture, final native host with JS eligibility based only on canonical props/connection | 11 expected failures / 175 checks, exit 1; no host errors | [negative controls](negative-controls.json) |
| Contracts | 207 Node / 13 Python | [regressions](regressions.json) |
| Native lifecycle/services tests | 10/10 | [regressions](regressions.json) |
| Headless examples | 20 examples / 1,483 checks | [regressions](regressions.json) |
| Independent original-Codegen adapter consumer | 17 runs / 318 checks, including graphical lanes | [regressions](regressions.json) |

Negative runs retain the final fixture and change only the recorded host or
eligibility expression. The older host cannot enter both reentrant command
callbacks, explaining its smaller executed-check total. Its expected diagnostics
are retained. Both controls restore exact source, host and positive bundle bytes.
No crash, script error or unexpected native error is accepted.

The first fixture run failed one of 175 assertions because an ordinary View's
inline callback ref detached during mutation. Stabilizing that callback retains
all assertions and the dedicated input ref-churn test. The owner oracle also
requires a named target to exist. [Preflight record](fixture-preflight.json)
keeps this test correction separate from production changes.

## Shared original state and command path

The original [TextInputState](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/Libraries/Components/TextInput/TextInputState.js)
owns the input set and focused public instance. Godot augments its two platform
dispatch functions while retaining the original singleton, guards and methods.
`TextInput.State` exposes the four upstream public statics. Original
[codegenNativeCommands](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/Libraries/Utilities/codegenNativeCommands.js)
and the original Fabric renderer dispatch against the public instance's
ShadowNode. Native identity/root guards reject removed or retiring targets.

The original element prototype implements focus/blur. Registration precedes
external callback refs; ref callback replacement preserves the input's lifetime.
Native focus/blur events synchronize State before user callbacks. The fixture
records 32 focus/blur/end-editing events with valid refs and checks the singleton
inside focus/blur callbacks. All seven input instances and their callback refs
have balanced cleanup after root/application retirement.

`ReactFabric-prod` updates canonical props during completion, before commit.
Godot's compatibility getter therefore derives focus eligibility from actual
native editability, SceneTree membership and live authority, rather than treating
canonical props as committed native state. It rejects readonly Controls,
deleted tags, stopping roots and the Remove/Insert off-tree interval. Native
commands independently validate editability and mounting. Ordinary View refs
retain the original no-op policy with `enableImperativeFocus` disabled.

## Independent native oracles

The test compares original/public State against
`Viewport.gui_get_focus_owner()` and every real LineEdit's `has_focus()`.
Native transfer uses `grab_focus()` and real signals, not a synthetic runtime
focus event. Frames and pixels use declared root/row coordinates independent of
the measured Controls. A callback ref focuses A before validation mounts B;
B's `autoFocus` then has a separate native oracle.

Each final mode executes one `tree_exited` callback while the same input is
reparented by removing its wrapper's nativeID, one `focus_entered` callback that
retires A while attempting stale focus, and one `focus_entered` callback that
stops the entire application. Their checks require B's surviving focus during
partial retirement, then zero native tags, balanced create/delete counters,
empty registry/focus and zero pending scheduling/retirement work after shutdown.

![B autoFocus owns the actual native input](focus-initial.png)

![A keeps focus through callback ref replacement](focus-updated.png)

## Reproduce and limits

```sh
npm run example -- focus --headless
npm run example -- focus --capture
npm run test:contracts
npm run test:examples
```

These local receipts prove this desktop focus slice. They do not certify hardware
keyboard/tab/mouse traversal, hidden-tree behavior, IME, multiline editing,
virtual keyboards/insets, mobile reference differentials or all HostInstance
commands. GF-08/GF-12 remain In progress; full acceptance and dependencies remain
open. Native SDK/adapter packaging is experimental and does not certify the
complete ABI. Hosted CI and Pages publication are separate dated receipts.

The [hosted observation](ci.json) records successful manual Pages run
[37177743564](https://github.com/journey-studios/godot-fabric/actions/runs/37177743564):
build/deploy passed, and the served JSON exactly matched branch data `0d7c731`
with source `3b09b37`, outside main. The new focus CI remains at the recorded
snapshot status. The preceding tree CI passed five jobs at `a608d07`; that
limited reference suite is not a focus differential.

A later completed observation records [run37177820811](https://github.com/journey-studios/godot-fabric/actions/runs/37177820811)
at `1699e5c`: contracts, native-cold-start, reference-ios, reference-android and
parity-comparison all passed. The earlier pending snapshot is retained. This
certifies those hosted lanes, not a new full focus/mobile differential.

## Native command argument and recovery complement

`npm run test:focus:commands` passes **112 checks** and **40 independent native
focus-owner observations**. Original renderer dispatch sends null, object,
string and nonempty-array arguments to both focus and blur. Each of the eight
calls reaches the native empty-array guard, reports exactly one expected
diagnostic and preserves focus, State and editing events. Original Codegen
commands recover after every rejection. Two shared roots and an independent
Hermes application keep committing; readonly and retained removed/stopped refs
cannot steal focus. All nine mounted inputs are explicitly checked as
unregistered/disconnected after final cleanup. [Curated receipt](commands.json).

The dedicated bundle does not modify the examples bundle. The existing native
host and all 47 recorded native inputs remain unchanged. The native CI now runs
this fixture and retains its report/log artifact; a CI configuration is distinct
from completed hosted evidence. The test is headless and does not extend the
hardware/mobile claims of the graphical focus example.

[Pointer transport/capture research](../../research/pointer-capture-boundary.md)
records the next lifetime prerequisite and the pinned EventTarget baseline.
It does not claim capture support, a reproduced crash or an approved cleanup
solution.
