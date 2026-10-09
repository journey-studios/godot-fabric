# Experimental Godot-to-React game services

Godot Fabric now carries application-scoped GDScript operations, state snapshots
and signal occurrences through an original RN JSI TurboModule, Promise and
AsyncEventEmitter. Game rules remain on the Godot owner. React, Zustand or
another application store chooses how to retain the UI representation.

This is a bounded implementation of Architecture 2.0 D03–D08. The exact schemas,
public signatures and delivery policy are experimental; D19–D32 retain their
existing pending status. This does not complete GF-25 or RN platform parity.

## Register before mounting

The native `FabricApplication` owns its service registry from construction.
Register game sources before its first bundle evaluation or surface mount:

```gdscript
signal health_changed(value: int)
signal damaged(amount: int, reason: String)
var health := 100
var bindings: Array = []

func _enter_tree() -> void:
  var api = GodotFabric.for_application($Application)
  bindings.append(api.bind_state("player.health", get_health, health_changed, "integer"))
  bindings.append(api.bind_signal("player.damaged", damaged, ["integer", "string"]))
  bindings.append(api.register_method("player.damage", damage, ["integer", "string"], "integer"))

func get_health() -> int:
  return health

func damage(amount: int, reason: String) -> int:
  health = maxi(0, health - amount)
  health_changed.emit(health)
  damaged.emit(amount, reason)
  return health
```

This snippet uses a direct native application Node. The provisioned Resource
wrapper creates that Node during tree entry; its `runtime_available` signal is
the pre-mount registration hook. The independent consumer connects this hook
from its parent's `_enter_tree`. Parent `_ready` runs after child surface
`_ready`, and is too late for bundle-level connections.

Each registration returns a token with idempotent `remove()`. Keep tokens for
explicit revocation; dropping the Ref alone does not remove a binding. Source
owner destruction, queued deletion or application stop invalidates a binding.
A facade scope holds only a weak application reference. Use separate scopes
for separate applications; the optional static `set_application` convenience
selects one default scope.

## Use public JavaScript and types

```tsx
import { GodotFabric } from "@godot-fabric/runtime";

const damageEvents = GodotFabric.subscribe<[number, string]>(
  "player.damaged", (amount, reason) => console.log(amount, reason));
const health = GodotFabric.connect<number>("player.health", snapshot => {
  console.log(snapshot.value, snapshot.revision, snapshot.generation);
});
await Promise.all([damageEvents.ready, health.ready]);

const result = await GodotFabric.call<number>("player.damage", [10, "UI"]);
console.log(result.value, result.response);
health.remove();
damageEvents.remove();
```

`@godot-fabric/runtime` is an exact SDK-owned import resolved by the laboratory
and provisioned builder. Other package subpaths remain project-owned. The
TypeScript declaration derives payload and result types from the caller's
generic annotations; runtime registration schemas still validate every value.
It is not generated inference from a GDScript schema yet.

A string names a literal service under origin `default`; dots are not parsed.
Use `{origin: "game", name: "player.health"}` and matching registration
`{origin: "game"}` for another namespace. Missing names fail; a request never
waits silently for a later registration with that address.

`subscribe` reports every signal occurrence, retaining declared argument order.
`connect` returns and delivers an initial `{origin,name,generation,revision,value}`
snapshot, then strictly newer revisions from that registration generation.
The listener is installed before the getter. If the getter emits a change,
the host retries up to three times to obtain a consistent revision; repeated
instability rejects rather than presenting a torn snapshot. A changed signal
must carry one complete state value.

`call` returns `{origin,name,generation,response,value}`. Its Promise settles
after the registered GDScript callback returns and validates. `response` defaults
to `completion`. A method registered with `{response: "acceptance"}` may return a
job identifier while game work continues; completion and cancellation are
explicit game signals/methods. Removing UI does not cancel an accepted game job.

Frontier's `frontier.end_turn` is an example of an accepted job
([research](research/frontier-services.md)): it answers `{ok, code, text, job}`
on acceptance, the persistent node advances the turn one phase per frame, and
`frontier.turn_ended` finishes that job once, whether or not a screen is open.
The probe measures each phase of such a job against the pump's budgets
(`pendingHostTasks`, `pendingEvents`, `hostTasksRun`, `eventsSent`).

## DTO and schema boundary

Supported DTO values are null, booleans, finite numbers, strings, dense arrays
and plain objects. Integers must fit JavaScript's safe range. Godot containers
must be Array/Dictionary with String keys. Resources, Nodes, Vector/Color
Variants, cycles, accessors, hidden properties, symbols and custom JS prototypes
are not public DTOs. Values are copied before queued execution or delivery.

Strings and dictionary keys preserve valid Unicode, including supplementary
characters. Embedded NUL and lone UTF-16 surrogates currently fail with
`E_SERVICE_DTO_STRING` before game code executes: Godot's String cannot retain
those JavaScript values losslessly. The native boundary applies this check even
when a caller bypasses the public facade. Invalid keys are checked before
reading their values. Full JavaScript/JSON string-domain parity remains an open
GF-25/1.0 gap; explicit rejection prevents silent data loss and does not close it.

Scalar schemas are `null`, `boolean`, `number`, `integer` or `string`. Composite
schemas are `{array: schema}` or `{object: {field: schema, ...}}`; object fields
are exact, with no implicit coercion or optional/union support in this slice.
Argument schemas are ordered Arrays matching the declared signal/method tuple.

The current DTO budget is depth 32 and 10,000 value nodes. A call's argument
Array is its DTO root; its address has a separate budget. A state value is its
own root for both initial snapshots and updates. The protocol event's argument
tuple is not an additional value-container depth, and all tuple values share
the event budget. These bounds limit container traversal, not total byte size
or time spent inside a game callback. Byte-size policy, generated schemas,
larger payload policy and binary transfer remain future work.

## Scheduling and teardown

GDScript callbacks execute through an independent deferred Godot MessageQueue
phase outside the application Node's notification stack. They do not reenter
game code during bundle evaluation or JS execution. Responses enter the JS
invoker and are consumed during a subsequent ordinary application frame.
The current same-thread host budgets 64 queued tasks and 128 events per phase;
backlog is retained. This does not establish worker-thread or cross-thread
support or preempt a long-running GDScript callback.

Queued calls and events retain source generations, not public Godot ObjectIDs.
Execution/delivery rechecks owner, binding, subscription and application lifetime.
Removing a listener prevents queued delivery to that handler. State revisions
do not erase separate signal occurrences. Callback exceptions remain visible and
do not prevent other subscriptions from running.

Removing a binding closes its live subscriptions. Application stop disconnects
Godot signals, rejects pending requests and discards queued deliveries. The
registry reports its bindings, subscribers, work, budgets and errors in the
diagnostic `gameServices` snapshot. Runtime-owned references are guarded while a
GDScript callback synchronously stops or frees its application. An ownerless,
weak deferred callback prevents the engine from returning through a freed
application notification stack. Stop is terminal even before the first mount;
a stopped application cannot start Hermes through a later surface.

## Executable evidence and remaining work

The [services example](../examples/services/README.md) exercises real native HUD
and inventory roots with Zustand, a getter race, ordered damage events, typed
errors, explicit acceptance/cancellation, pause, hide/unmount/remount and cleanup.
The [services evidence](evidence/game-services/README.md) retains reports and
actual renderer captures. Public-facade Node tests independently probe malformed
DTOs/events, callback failures, cleanup and SDK resolution/types.

The native boundary fixture additionally tests revocation/rebinding, destroyed
owners, queue budgets, copied Unicode and rejected values. A separate lifetime
fixture synchronously frees a live application from its registered method and
checks the surviving surface's retired nodes, queues and canceled request.

Frontier, the 0.5 reference game, is the reference consumer with a nested object schema: its persistent `GameServices` node
registers a state, a signal and twelve methods from one GDScript schema source, and hand-written TypeScript types are
compared with them in both directions (see [Frontier's services](research/frontier-services.md)). It names no path to the SDK:
the scene injects the facade's script (`@export var fabric_api: Script`), so the same node runs in the laboratory and in a
project provisioned by the addon, where ten cycles of new game, intents, scene reload and menu leave the registry's
bindings and subscriptions, the signal's connections and the nodes where they started (see
[Frontier as a consumer](research/frontier-consumer.md)).

Full generated service/component specs, thread handoff, activation/reload
generations, dev diagnostics and per-target exported consumer certification
remain open. A correct transport does not supply game-state persistence,
automatic Zustand bindings, OS services or compatibility with every RN library.
