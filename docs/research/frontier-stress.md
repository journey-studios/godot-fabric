# The comparison's stress window and the runner's `stats()` (V05-10, serving `execucao` and `metricas`)

Status: the game, both HUDs and the runner's hook have what the `stress` window of [the comparison's protocol](frontier-comparison-protocol.md) needs. The protocol's
window starts "at the frame that receives the intent that fills a log with 200 lines and a production list with 100 items" and ends at the second frame after the last of
20 consecutive per-frame updates (a log line appended and an item changed in each); it was a window with no game behind it, and the user decided to build it and not to amend
it away. This slice builds the mode, a panel for it in the React Native HUD (arm C) and in the native HUD (arm B), and `stats()`, the call the execution runner reads in
measured frames. **It states no measurement result**: no comparative execution has run, and the numbers below are what the hook costs, not what either HUD costs.
The record of the runs, the controls and the captures is [docs/evidence/frontier-stress/](../evidence/frontier-stress/README.md).

## The mode, outside the state

`consumers/civ-lite/services/stress.gd` is an overlay that the `GameServices` node owns (`stress`, null while the mode is off). It is not in the game's state: the state, its
hash, the game's own log (`LOG_MAX` 32), the replay's golden hash and the trace hash are the ones they were, and the probe and the game lane check it. Three methods of the node
enter it, change it and leave it, registered for React Native like the others (the registry holds 18 bindings now, 15 before):

| Method | What it does | Refused when |
| --- | --- | --- |
| `stress_begin()` | in the frame that receives it, fills a log of 200 lines and a list of 100 items, and publishes a snapshot | a turn job runs (`turn_in_progress`, the game's own code and text); the mode is on (`stress_on`, new) |
| `stress_step()` | appends one line (the log stays at 200: the oldest goes), raises the progress of item `steps % 100` by one, and publishes a snapshot | the mode is off (`stress_off`, new) |
| `stress_end()` | leaves the mode and publishes a snapshot | the mode is off (`stress_off`) |

The result is the existing one (`ok`, `code`, `text`, `job`), and the two new codes are in the game's `REASONS` table. A new game leaves the mode.

**What the snapshot carries.** `stress: {log: [200 strings], production: [100 items]}`, only while the mode is on. `GameServices._published()` is the one place the snapshot is made
for publication: the game's frozen snapshot while the mode is off (untouched), and a frozen copy with `stress` while it is on. Every publication goes through `_publish()`, so the
mode, the counters and the numbering below cannot disagree. Leaving the mode leaves the snapshot byte for byte the one before it began, which the HUD probe and the stress probe
compare as text with sorted keys.

**The content is deterministic and keyed.** A line begins with its sequence number in five digits (`00021 · the watch counts 797 bags of grain at gate 9`): the number is its
key, so a step appends one key and drops one and the other 199 keep theirs; an item is `{id, label: "Item 07", progress, cost: 100 + id}`, keyed by its id. Both HUDs name a row by
its key (`hud-stress-log-00021`, `hud-stress-production-07`).

### The one optional field of the schema language

The snapshot's schema had to accept a field that is sometimes absent, and the registry's language had no optional field. It has one now, and only this one:
an object's field may be declared `{optional: schema}` (`consumers/civ-lite/services/schema.gd`: `"stress": {"optional": STRESS}`). The value may omit it, and when it is there it must
match; a value still carries no field the declaration does not name (the objects stay exact: the check is that every key of the value is declared and every required field is present),
and an `optional` that is not an object's field (the root, an array's element, an argument) is refused when the schema is registered. It is `native/game_service_registry.cpp`, `check_schema` and
`validate`, about 25 lines, and it needed the host rebuilt. The TypeScript mirror declares `readonly stress?: Stress`; the parity extractor reads a `?` as `{optional: ...}` and
compares it with Godot's registration in both directions, with mutations of its own; the oracle's `conforms` follows the same rule. `docs/GAME_SERVICES.md` says so.

## The panels

`hud-stress` is a panel of both HUDs, shown in **every context** while `snapshot.stress` is present, with `hud-stress-log` (200 rows) and `hud-stress-production` (100 rows), each row a
testID'd text. It is not in the table of panels per context: the table is unchanged, and the matrix of the HUD probe runs with the mode off and has the same verdict as before.
It sits at the right-hand column under the overlays, 440 by 332.

- **React Native (arm C).** `ui/hud/stress.tsx`: two `ScrollView`s of `Text`, a row keyed by its key, so a step mounts one `Text`, unmounts one and changes the text of one. No `FlatList`
  (the 0.5 manifest has none) and no ref or effect (the HUD scan forbids them): the log is not scrolled to its tail.
- **Native (arm B).** `native_hud/stress.tscn` and `stress.gd`: two `ScrollContainer`s of `VBoxContainer`s of `Label`s, kept by key in place by a reconciler the panel carries (a row whose key is gone is
  freed, a key that is new makes a row, a row whose text did not change is left alone, a row moves only when it is not where the order puts it). It does not depend on the
  optimization pass's helpers.

The probe's row-identity check is the same for both: after 20 steps, 180 of the 200 log rows and all 100 production rows are the very Controls they were.

## The runner's `stats()`

The contract, in the same shape in both arms:

```
stats() -> {snapshots: int, context: String, events: int}
```

`snapshots` is how many snapshots the HUD applied since boot, `context` the context it shows now (the names of the probe's table), `events` how many notifications of the game it consumed since boot.
`GameServices.notifications_emitted()` counts the same set on the emitting side, and the runner closes `event-burst` at the first frame where `events` equals it, with at least five frames.

**The set of notifications.** The node emits three things: a snapshot (`snapshot_changed`), the card of the hovered tile (`hover_changed`) and the end of a turn (`turn_ended`). A notification
is any of the three, and `notifications_emitted()` counts the three. (The contract's words, "`turn_ended` and each game event the turn's queue delivers", are read as the
registry's queue: what a turn delivers to a HUD is its snapshots, one for the acceptance and one for each phase, and `turn_ended` between them. The game's own queue of three events reaches a HUD
as the dialog of a snapshot, not as a notification of its own.)

- **B** counts in the handlers of the signals it already connects (`snapshot_changed`, `hover_changed`) and in one more, `turn_ended`: three increments in the code that applies the notification, and
  a read of three variables. `native_hud/hud.gd`'s old `stats()` (the validation's `calls`) is `intents_sent()` now, read through the reader seam.
- **C** has no listener of `turn_ended` (the HUD's two subscriptions are the snapshot and the hover, and a third would change what the leak guards count), so the end of a turn is consumed for C when
  the registry takes it in. The counters are the registry's, kept natively.

### The path for C

The two ways the brief offered are a native counter and a push from the store through a registered method. The native counter was chosen, because it is the only one that is free for C in the frames that
are measured:

- **A push from the store** costs a JavaScript call, a registry task and a Callable invocation in Godot for every snapshot and every hover card, in the frames of the window itself, and shows up a
  frame late (the task runs at the next pump). It would put the instrument's cost in C's primary outcome and nowhere in B's.
- **The native counter** costs a map lookup and two increments for each event the registry hands to JavaScript, and nothing in JavaScript. It needed C++, a test, a rebuild and the
  previous-host control, and the schema's optional field needed all of that anyway.

`FabricApplication.service_delivery(name)` (new, `native/fabric_application.cpp`) reads, for the binding of the default origin with that name (the registry's own default, the one the game's services
register under; a same-name binding under another origin is another service and is not read), `emitted` (its revision: every emission the registry ingested), `sent` (the **distinct revisions** of it that the pump
handed to the JavaScript runtime for any subscription: one emission that reaches three subscriptions counts once, and the initial read of a subscription is not an emission and counts none) and `delivered` (the revision of the last
value a subscription got, the initial read included). It returns a Dictionary of integers, with no JSON and no JavaScript, and **it does not read the application's snapshot**, which is the whole status of the host (32 KB at rest: see below).
The registry does not coalesce: every emission queues one event for each live subscription, the pump hands them on in order and drops none of a live subscription's, and the runtime's own filter only skips a revision it already
has. So with one HUD subscription `sent` is the number of values the store's listener is called with, which is what B's handler counts; with more subscriptions it stays the number of values. If a later registry ever coalesced
revisions (the store seeing fewer values than the node emitted), `sent` would count against the emissions and not against the handler calls, and the pair would have to be re-decided. `hud_stats.gd`, a
`Node` of `main.tscn` named `HudStats`, is what the runner holds for C: `snapshots` is `sent` of the snapshot binding, `events` is `sent` of the snapshot and of the hover plus `emitted` of
`turn_ended`, and `context` is `GameServices.context_at(delivered)`, the context of the snapshot revision the registry last delivered (the node numbers its publications the way the registry numbers the
binding, and keeps the context of the last 256).

What the counters count is "handed to the JavaScript runtime": the store's listeners run in the same process step, when Hermes drains its queue, so `stats()` can be ahead of the store by what
that step has not yet run, and it is never behind. Both arms have the same cumulative numbers in the stress stage of the lane (73 to 81 events and 67 to 74 snapshots over a turn, 103 events at the end),
and the stage requires `events` to equal `notifications_emitted()` once the HUD has settled.

### What `stats()` costs, measured

Headless, macOS arm64, the Release host, 20 000 reads in 10 rounds, with the machine under the load of the other work (a 1-minute load average of 4 to 8); one process per run, never both arms at once.
The costs of the paths the runner must not take in a measured frame are measured with the same harness, for the record.

| Read | Cost per read |
| --- | ---: |
| B: `stats()` on the native HUD | 0.9 µs (median over the rounds; 95th percentile 1.1 µs) |
| C: `stats()` on `HudStats` (three counter reads and a context lookup) | 4.5 µs (median; 95th percentile 10.2 µs) |
| C, the path not taken: `application.evaluate("JSON.stringify(FrontierHud.stats())")` | 130 µs |
| C, the path not taken: the Surface's `snapshot()` (the host's status, 32 347 bytes at rest) | 581 µs |

The counters' own cost in C, per notification, was measured as the difference of the soak's frames between the tree before this slice on the previous host (no counters) and the tree after it on the new one,
with the same harness (5 runs of 60 turns each way, alternating, the CPU-time instrument of #97): the median of the `ai-phase` frames is 3.22 ms before and 3.22 ms after, the 95th percentile 6.98 ms and 7.04 ms, and the `event-burst`
median 0.065 ms and 0.086 ms: **inside the run-to-run spread** (the medians of single runs span 0.4 ms). After the review's fix (the counter counts distinct revisions: one more comparison per event) the per-read costs above were
measured again, and the new tree alone gave an `ai-phase` median of 3.44 ms over 5 runs (3.43 to 3.46): 0.2 ms over the first measurement of the same tree, which is the drift between two sessions of measurement on this machine and as large as any
difference the counters could make. The cost per notification is below what the instrument can see, and by construction it is a few instructions. B pays three increments per notification.

## Proof

- **The HUD probe** (`hud_validation.gd`, a fourth stage on both arms through the reader seam, 152 checks now): the mode refused during a turn; `stats()` over a whole turn; the refusals of a step and an end with the mode off;
  begin, with 200 and 100 rows in the context's own panels; a second begin; twenty steps one frame apart with the identity check; end, with the panel gone and the snapshot byte for byte as it was; and the final
  `stats()` against the node's counter. The oracle (`tests/civ-lite-ui-oracle.mjs`) writes the lines and the items from the rules, apart from the game, and judges the raw rows; 11 mutations of a copy of the report
  are rejected in the two categories it adds, `stress` and `stats`.
- **The registry and the node** (`tests/frontier-stress-probe.gd`, `npm run test:frontier-stress`, 18 checks, no JavaScript): the three intents and their codes and texts, the snapshots they publish, the game's state hash
  unmoved, the byte identity, the counters, a new game leaving the mode, and the optional field of the schema through real bindings: accepted absent and present, and refused with the wrong type, with a field the declaration
  does not name, with a required field missing, and as an optional that is not an object's field; and the accessor reads the default origin's binding (two emissions of a same-name binding under another
  origin that sorts first move nothing, one of the default's moves it by one). The services lane's many-subscriber case checks the other half: with 150 more subscriptions of the snapshot, a job's seven publications move
  `sent` by seven, as they move `emitted`, while the events sent to subscriptions are a hundred times as many.
- **Five retained sabotages** (`scripts/civ-lite-ui-sabotage.mjs`, which now also runs only the variants named on its command line): the stress panel's rows rebuilt on every step, in C and in B; `stress_end` that leaves the overlay;
  and a `stats()` that does not count the end of a turn, in C and in B. Each is rejected by the probe and by the oracle for the rule it breaks.
- **The causal control: the previous host.** The same bundle on the host built before the optional field refuses the snapshot's schema, so the HUD never receives a snapshot: the HUD probe fails 139 of its 145 checks
  and the stress probe fails what it reaches.

## Not in this slice

The runner and its scenario script, the soak player, the context cycle, arm A's harness, the comparative executions, the optimization pass of arm B (which now covers four windows), the protocol, and Release
exports. The log is not scrolled to its tail in either HUD. `context` is exact in both arms only in the sense above (the last revision handed to JavaScript), and a runner that wants to know that the store has *applied*
what `stats()` counted can wait the frame that Hermes needs.
