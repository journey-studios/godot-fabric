# GF-05: timers, microtasks and native frames

Local validation used macOS arm64, official Godot 4.7.2, React 19.2.3,
RN 0.87.1 and Hermes 250829098.0.17. No Godot engine rebuild was required.
This is a bounded GF-05 implementation; the roadmap item remains In progress.
The counts, hashes and captures below describe this implementation's recorded
snapshot before integration with the public form. The current catalog contains
both examples; [public control evidence](../public-controls/README.md) retains
its separate snapshot.

## What changed

The previous host had no `setInterval` or `queueMicrotask`, dropped extra
`setTimeout` arguments and implemented immediate callbacks as zero-delay timers.
A real-Hermes baseline produced `promise,timer,immediate` and an empty callback
argument list. After this change it produces `promise,immediate,timer` and
preserves `['token', 42]`.

The build compiles upstream RN `TimerManager.cpp` unchanged. It owns callback
arguments, timeout coercion and timer/interval cancellation. The Godot
[deadline registry](../../../native/timer_registry.h) implements the original
`PlatformTimerRegistry` boundary. Original RN portable microtask/immediate
modules execute over Hermes Promise jobs. Fabric's renderer and scheduler
remain upstream; this change adds no separate React reconciler.

## Runnable case and actual captures

```sh
npm run example -- runtime               # interactive native UI
npm run example -- runtime --headless    # 23 contract assertions
npm run example -- runtime --capture     # 33 assertions and renderer readbacks
npm run test:runtime                     # registry and callback-error tests
```

The [React application](../../../examples/runtime/App.jsx) only imports public
React/RN UI primitives and the shared portable runtime probe. Public Pressable
input starts and pauses a 250 ms interval and a recursive RAF loop. These
callbacks update React state; Fabric reconciles it into existing native Controls.
No native signal or direct React setter substitutes for pointer input in either
validation lane. Injected viewport events use device 1001 for OS focus isolation.

**Initial:** no interval or frame loop has started. The initial public Text
shows `0 / 6` and the progress track contains no filled pixels.

![Initial clock and pending runtime probes](initial.png)

**Paused:** pointer input starts the clocks and completes four runtime probes,
then pauses at partial progress. The interval and next RAF are cancelled;
ticks and frames remain unchanged beyond the previous timer deadline. The
original Pressability delayed press-out timer is allowed to finish before
asserting the entire native timer queue is empty. Text keeps its native identity.

![Pointer pause freezes the native progress and frame count](paused.png)

**Complete:** running again reaches six ticks, fills the track and cancels the
next scheduled tick/frame. The task trace below the clock shows the verified
order: sync → promise → microtask → immediate → nested microtask → timer.

![Recurring callbacks commit the complete React UI](complete.png)

These PNGs are 900 × 680 Godot Viewport readbacks. The harness asserts actual
glyph pixels, different Text-region hashes and progress pixels matching the
committed tick fraction. They are not generated illustrations or screenshots
of unrelated applications. Frame counts are observations of each run, not
cross-platform performance guarantees.

## Acceptance and original-native oracle

- **Runtime example:** 23 headless + 33 graphical assertions. Shutdown begins
  with active timers, frames, an immediate and a microtask; none execute after
  stop begins. Cached scheduling functions cannot restart work. Controls/tags,
  timers/frames/work are empty and React cleanup completes.
- **Deadline registry:** 12 native assertions cover deadline order, no early or
  duplicate dispatch, queued cancellation, zero intervals, no catch-up bursts,
  the 256-item dispatch budget and shutdown.
- **Callback failures:** six assertions in actual Hermes. Timeout, microtask,
  RAF and two recurring callback errors remain visible in the host error
  channel. Unrelated tasks still run; an interval survives an exception and
  cancels itself on its second invocation. Failed registrations and native
  work are empty after cleanup. Expected failures run separately from the
  ordinary examples; positive runs still reject every host error.
- **Regression:** all ten interactive examples passed sequentially in both
  lanes: **408 headless + 455 graphical assertions**. Two disposable projects
  passed cold import, runtime and warm import. Source gates passed 21 Node
  tests, eight Python fixtures, static analysis and the publication scan.

> Later note: since commit [`e67f82c`](https://github.com/journey-studios/godot-fabric/commit/e67f82ca54a83c8cfbc7db6e97ae11a70871ea2d) RAF callbacks run on the ticks of the
> [frame clock](../frame-clock/README.md) and not on every Godot process frame, so the
> statements here and under Remaining GF-05 work about real Godot process frames describe
> this record's executed state. The `runtime_errors` check `A failed callback cannot
> prevent unrelated queued work` no longer asserts the exact order
> `["after-frame","timeout","after-timeout"]`: timers run on every Godot frame and frame
> callbacks only on ticks, so which of them runs first is the host's pacing. It asserts that
> all three callbacks ran and that the two timers kept their order; the check name and the
> six callback-failure assertions above are unchanged.

[matrix.json](matrix.json) records fresh per-case counts/report hashes;
[provenance.json](provenance.json) binds source, upstream modules and captures.
Raw reports and logs stay in ignored `build/` and hosted artifacts.

The first hosted source gate caught output URLs in the native test being
interpreted as imports by static analysis. Existing local output files and
incremental analysis state masked the failure. The test now builds filesystem
output paths with `path.join`; `npm run check:static -- --no-cache` was verified
with both generated files absent, without adding an ignore or weakening the gate.

The first hosted iOS execution passed all 13 cases, then its simulator shutdown
exceeded the previous 30-second deadline. The runner now allows two minutes for
that owned-simulator cleanup. Timeout/errors still invalidate the report and
fail the job; a passing fixture alone does not establish a green hosted run.

The shared `core-ui-v2` oracle now has **13 cases**: the original nine UI cases
plus timeout arguments/coercion/cancellation, interval arguments/self-cancellation,
microtask/immediate ordering and cancellable monotonic frames. The same
[runtime probe](../../../tests/parity/runtime.js) is copied verbatim into the
original RN iOS and Android reference applications. Its source has its own
provenance hash; stale nine-case reports are rejected. The Godot oracle passed
locally. The [hosted run](https://github.com/journey-studios/godot-fabric/actions/runs/37006291589)
passed all five jobs on `d4e5673`, including the original iOS/Android references
and the three-way comparison. Downloaded artifacts were accepted by the current
strict protocol: **13 matched subset cases** with both mobile references.
The matrix retains that run/commit and comparison hash. This result certifies
the recorded subset; full RN API
coverage and Godot mobile builds remain separate milestones. See the
[oracle instructions](../../compatibility/BASELINE.md).

## Remaining GF-05 work

The full upstream `InitializeCore` is not installed. Idle callbacks, required
URL/encoding/abort globals, unhandled rejection/error-handler parity and
microtask starvation protection remain open. The bounded native work pump
does not bound an infinite chain of Promise jobs or arbitrary blocking JS.

> Later note: since the [networking record](../networking/README.md), RN's own `URL`,
> `URLSearchParams`, `AbortController` and `AbortSignal` (with the rest of `setUpXHR`'s
> globals) are installed by `src/initialize.js`. Their contract is certified only as far as
> that record's checks (an `AbortController` aborts its signal once, `URLSearchParams`
> decodes, `fetch` honors a signal); the encoding globals are still open, and this
> record's executed files stay as written.

RAF uses real Godot process frames rather than upstream TimerManager's
zero-delay fallback. The oracle certifies cancellation and monotonicity; it
does not require matching frame cadence, exact timestamps or all ordering
relative to UI events. Timer callbacks run on the Godot main thread and overdue
intervals resume from callback completion without replaying missed ticks.

Surface stop suppresses the portable microtask/immediate callbacks owned by
this bootstrap. Ordinary Promises have no general cancellation mechanism.
Hardware input, DPI/font scale, OS app lifecycle and mobile Godot builds are
separate milestones. GF-09 real system metrics remain Planned.

## Bootstrap audit (slice A, 2026-10-13)

The host does not run RN's `InitializeCore`. `sdk/toolchain/platform-plugin.mjs` resolves
`ReactNativePrivateInitializeCore`, the import through which the renderer reaches it, to
`src/initialize.js`, which loads the host runtime, `RCTDeviceEventEmitter` and `setUpXHR` and nothing
else. "Integrate upstream core initialization or an audited equivalent" was therefore not true: no
document said, step by step, what replaces each module of RN's chain. Slice A writes that document
and a gate that keeps it true. It changes no behaviour: `src/initialize.js`, the host and the runtime
are untouched, and slices B to F are the ones that change them.

**The audit** is `docs/compatibility/bootstrap-audit-0.87.1.json`. It has one entry per module of the
chain, in RN's order: the two wrapper files (`InitializeCore.js`, `src/setup-env.js`), the entry
function, the 19 modules the entry function requires and the 3 modules those load
(`setUpPerformanceModern`, `setUpFuseboxReactDevToolsDispatcher`, `setUpReactRefresh`), plus the two
Metro polyfills RN hands its bundler (`@react-native/js-polyfills`: `console.js` and
`error-guard.js`), which run before the chain and define `console` and `ErrorUtils`. The step list is
not typed by hand: `scanBootstrap` in `scripts/parity-upstream-scan.mjs` derives it from the pinned
sources with the scan behind the contract inventory (the inventory's output is unchanged). Each entry
carries the conditions around the step (`__DEV__`, feature flags, `RN$Bridgeless`) and the globals it
installs, both copied from the scan. A step that does several separable things (`setUpTimers`) is
split into parts, and the parts must cover its globals exactly once.

| Status | Means | Evidence the gate checks |
| --- | --- | --- |
| `runs` | RN's module runs unchanged in `src/initialize.js` | `src/initialize.js` imports it (and calls it, for a default-exported setup function) |
| `replaced` | our code does the step's job | the file still contains the symbol; a reason says why |
| `host` | the C++ host, or the Hermes it links, provides it | the file still contains the symbol; a reason says why |
| `pending` | not done yet | the GF-05 slice (`B`, `C`, `D1`, `D2`, `E` or `F`) that does it, and a reason |
| `not-applicable` | RN's step does not apply to this host | a reason, and `owner` when another GF task owns the gap |

Where things stand at slice A, counting a split step by its parts: 1 `runs` (`setUpXHR`), 6 `replaced`
(the three upstream entry files, `AppRegistry`, and `queueMicrotask` and `setImmediate` out of
`setUpTimers`), 4 `host` (`polyfillPromise`, `setUpRegeneratorRuntime`, and the timers and the
animation frame out of `setUpTimers`), 9 `pending` and 12 `not-applicable` (the `__DEV__` developer
tools for GF-29, `setUpAlert` for GF-23, `setUpBatchedBridge` for GF-25, the segment fetcher, the two
flag-gated observers and the modern performance classes for GF-40). The JSON is the record; this
paragraph is a snapshot.

**The gate** is `tests/bootstrap-audit.test.mjs` (rules in `scripts/bootstrap-audit.mjs`), part of
`test:parity` and so of `test:contracts`. It fails when:

- RN's chain gains, loses, renames or reorders a step, or a step's role or conditions change, or a
  step installs a global the audit does not list (an RN upgrade has to be audited first);
- evidence is stale: a `runs` module that `src/initialize.js` no longer imports, a `replaced` or
  `host` file that no longer contains its symbol (or an anchor that is no longer unique), or a
  `pending` slice, `owner`, `decision` or `verifyIn` that does not resolve;
- an entry has no status, or no reason where one is required, or a `replaced` or `host` entry cites
  no evidence;
- one of the recorded decisions (`encoding`, `performance`, `performance-classes`, `starvation`) is dropped.

Each failure mode has a mutation test on a copy of the real inputs (an extra upstream step, a stale
symbol, a missing reason, and the rest), so the gate is shown to reject what it claims to.

**The user's decisions for GF-05 (2026-10-13)** are recorded in the audit and enforced by the gate:

- *Encoding*: parity with Hermes. `TextEncoder`, `atob` and `btoa` are present and tested;
  `TextDecoder` is absent, with a negative fixture, as on RN iOS and Android. Slice E probes it.
- *Performance*: `performance.now`, `mark`, `measure`, `clearMarks` and `clearMeasures` are in 1.0,
  through RN's `setUpPerformance` fallback, and slice B removes the host's `{now}` stub. The 11 Web
  Performance classes that RN installs from `NativePerformance` move to `post_1_0` (GF-40) and are a
  recorded parity gap, because RN iOS and Android have them.
- *Starvation*: parity with RN bridgeless. What RN does under a Promise storm is measured, and the
  host must behave the same; there is no deliberate deviation. Slice F measures it.

**The plan for the pending entries.**

| Slice | Does | Audit entries |
| --- | --- | --- |
| B | JS-installed globals; the host's `performance` and `console` stubs go | `setUpGlobals`, `setUpDOM`, `setUpPerformance`, `setUpNavigator`, the `console` polyfill |
| C | the error path: `ErrorUtils`, `setUpErrorHandling`, `RN$handleException` | `setUpErrorHandling`, the `error-guard` polyfill |
| D1 | `RN$enableMicrotasksInReact` (high regression risk, full sweep) | `setUpTimers` part `react-microtasks` |
| D2 | idle callbacks over `NativeIdleCallbacks` | `setUpTimers` part `idle-callbacks` |
| E | web-globals probe: URL, URLSearchParams, Abort*, encoding per the decision | `setUpXHR` (`verifyIn`), decision `encoding` |
| F | callback exceptions and starvation against RN | `verifyIn` on the timers, animation frame, `queueMicrotask`, `setImmediate` and `polyfillPromise` entries |

The audit found two things the slice list did not name. `setUpDOM` (14 DOM globals and
`RN$isNativeEventTargetEventDispatchingEnabled`) is not imported, and no slice owned it; it is
assigned to B with the other `polyfillGlobal` installers. The `__DEV__` steps, `setUpAlert` and
`setUpBatchedBridge` are real gaps against RN's chain that belong to other tasks, and the audit names
them as `not-applicable` with that owner instead of leaving them silent.

**Limits.** Evidence is a file and a symbol, never a line number: the hub files (`application_runtime.cpp`,
`src/runtime.js`) are edited by most slices, and an unrelated edit must not fail someone else's change.
When a symbol occurs more than once in its file, the entry carries an `anchor`, a short text around it
that occurs exactly once; a symbol that is renamed or removed, or an anchor that is stale or ambiguous,
fails the gate. `runs` is a static claim (an import); the behaviour of each step is certified by the
slice that owns it, with its own fixture.
