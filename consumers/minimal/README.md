# Independent TSX consumer

This template becomes a separate Godot project after provisioning the addon.
It has its own `project.godot`, `ui/index.tsx`, Resource, scene, package manifest
and lockfile. It does not import `examples/entry.jsx` or select a laboratory
demo. Follow the [SDK provisioning guide](../../sdk/README.md) first; opening
this unprovisioned source template directly cannot load its native surfaces.

## Author and run

1. Open the generated `project.godot` in official Godot 4.7.2 on macOS arm64.
2. Edit `ui/index.tsx`. The provisioned Godot Fabric plugin is already enabled.
3. Press Play, or use **Project → Tools → Godot Fabric: Build UI** to build alone.
   Build diagnostics appear in Output; errors reject Play. No global Node or
   package-manager command is required for this basic project.

The application Resource at `ui/application.tres` selects:

```text
format_version = 1
entry_file = "res://ui/index.tsx"
bundle_file = "res://.godot_fabric/app.js"
```

`ProjectSettings["godot_fabric/application"]` points to that Resource. The
`Application` scene node also references it and creates a native
`FabricApplication` child named `Runtime` during game execution. Scene nodes
remain available for authoring without evaluating React in the editor.

## How JSX enters the SceneTree

The entry uses public React and React Native imports:

```tsx
import { useState } from "react";
import { AppRegistry, View, Text, Button } from "react-native";

function HUD({ title }: { title: string }) {
  const [count, setCount] = useState(0);
  return <View style={{ padding: 24 }}>
    <Text>{title}: {count}</Text>
    <Button title="Increment" onPress={() => setCount(value => value + 1)} />
  </View>;
}
AppRegistry.registerComponent("HUD", () => HUD);
```

Register an **entry root**, not every component in its tree. The `HUD`
`FabricSurface` Control selects `component_name = "HUD"`, receives
`initial_props` and points `application_path` at `../Application/Runtime`.
Fabric commits create actual Godot Controls below that surface; this Button
becomes a native Godot Button. The surface's size supplies its Yoga constraints.

`Inventory` selects another registered entry in the same runtime. The actual
template registers both names with `Panel` and passes different props. Both
roots keep separate `useState`; `ui/store.ts` explicitly shares data through
`useSyncExternalStore`. Context does not implicitly cross roots.

During game execution, Godot can update a root without remounting it:

```gdscript
$HUD.update_props({"panel": "hud", "title": "Props from Godot"})
$Inventory.unmount()
$Inventory.mount()
```

Updating props preserves local state. Inventory remount resets its local
state while retaining the module store in the shared application. The
application owner must outlive the surfaces that reference it.
These native APIs and the service signatures below are experimental contracts.

## Game services without game C++

`game.gd` owns health, implements damage and emits ordinary Godot signals.
The parent connects to the SDK application's `runtime_available` signal in
`_enter_tree()`. The SDK emits it after creating `Runtime`, before sibling
surfaces mount or the UI bundle evaluates. Registering services there avoids
racing the first React state read:

```gdscript
func _enter_tree() -> void:
  $Application.runtime_available.connect(_bind_services)

func _bind_services(runtime: Node) -> void:
  var services := GodotFabric.for_application(runtime)
  service_bindings.append(services.bind_signal("consumer.damaged", damaged, ["integer", "string"]))
  service_bindings.append(services.bind_state("consumer.health", get_health, health_changed, "integer"))
  service_bindings.append(services.register_method("consumer.damage", damage, ["integer", "string"], "integer"))
```

The separate TypeScript entry consumes the public SDK API:

```tsx
import { GodotFabric } from "@godot-fabric/runtime";

const happenings = GodotFabric.subscribe<[number, string]>(
  "consumer.damaged", (amount, reason) =>
    updateGame({ damages: [...gameState.damages, { amount, reason }] }),
);
const state = GodotFabric.connect<number>("consumer.health", snapshot =>
  updateGame({ health: snapshot.value, revision: snapshot.revision }),
);
const result = await GodotFabric.call<number>("consumer.damage", [3, "consumer-call"]);
happenings.remove();
state.remove();
```

Names are literal strings under the default origin. Native schemas validate
arguments/results; TypeScript types describe the values expected by this
project. Methods run on the next safe Godot frame and return a completion
result for this synchronous game operation. The first health getter deliberately
changes health while being read: the consistent snapshot is 95 at revision 1,
and the corresponding damage signal arrives once.

`ui/index.tsx` uses its own small application store with `useSyncExternalStore`.
Both roots observe the same game state. Closing Inventory retains the HUD's
connections; remount restores current health. When the last root unmounts,
React cleanup removes the shared connections. Application shutdown disconnects
Godot bindings and clears native service queues. The registration tokens also
support explicit idempotent `remove()`. No game C++ or extra state library is
required.

## What this example exercises

![Initial independent roots with Godot service state](../../docs/evidence/game-services/consumer-initial.png)

Initially, HUD and Inventory have local/shared counters at zero. The label
comes from `ui/platform.godot.ts`, exercising Godot source selection alongside
the competing `.native.ts` fixture. Both roots display health 95/revision 1
from the consistent Godot state connection. Fonts load from the addon itself.

![Native input, props and game state in the independent consumer](../../docs/evidence/game-services/consumer-updated.png)

The validation clicks HUD's native increment/publish buttons, edits its
TextInput, then replaces its title from Godot. HUD has local count 1; Inventory
keeps local count 0; both show shared count 1. The follow-up unmount/remount and
shutdown assertions verify lifecycle and native cleanup.
The service assertions also verify initial revision races, typed call
completion, ordered signals, both native health labels and cleanup after stop.

![Only inventory resizes; public refs and input follow its geometry](../../docs/evidence/game-services/consumer-resized.png)

The fixture narrows only inventory to 430 points. Its Yoga constraints and the
original public View ref's `measureInWindow` follow the Godot global rectangle;
HUD identity/geometry and RN window/screen metrics stay stable. Editing the
resized inventory reaches its own React root. Restoring its size uses the same
ref and retains state without a remount. Measurements use a 0.1-point tolerance.

The repository command `node scripts/consumer-check.mjs` provisions and checks
a separate consumer, including all existing editor/tooling rejection cases and
40 runtime assertions. Add `--capture` for the graphical run with 43 assertions
and three screenshots. These are the current fixture's required counts;
the linked evidence records which runs have actually completed.

## Dependencies and limits

The project declares exact React/RN peer versions; the addon provides their
runtime identity. `tsconfig.json` points to the SDK's React types and narrowed
RN types, with strict project checking. `skipLibCheck` skips third-party
declaration bodies; it does not make unsupported public props valid.

Additional libraries belong in this project's `dependencies`, installed
explicitly with its package manager. Play preserves its lockfile. The fixture
tests a small hook-using project library and duplicate-React protection; it
does not certify a specific external UI library, package manager/workspace
matrix, project Babel plugins or NativeWind consumer compilation.

Only the pinned macOS arm64 combination is provisioned. Development renderer,
Fast Refresh, mapped errors, general assets, signed/prebuilt releases, upgrades,
complete exports and the other operating systems remain open. The
[services evidence](../../docs/evidence/game-services/README.md) states precisely
which checks ran; the [roadmap](../../ROADMAP.md) retains full
GF-28/GF-29 acceptance.
