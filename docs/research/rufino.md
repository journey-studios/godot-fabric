# Rufino: TSX scene and resource authoring

[Rufino](https://github.com/fgcoelho/rufino) belongs in this research as a
related Godot authoring tool. It makes native scene/resource composition
available through TSX; Godot Fabric provides React execution during the game.
Those responsibilities could complement each other.

Reviewed on **2026-10-01**, at commit
[`e504a75164987410e8e7d42be4cd3ab33986d31c`](https://github.com/fgcoelho/rufino/tree/e504a75164987410e8e7d42be4cd3ab33986d31c).
The source package declares version **0.0.2** and the project is **MIT licensed**.
This is a source review; Rufino was not installed or executed, and no integration,
performance or platform compatibility is claimed.
[Package metadata](https://github.com/fgcoelho/rufino/blob/e504a75164987410e8e7d42be4cd3ab33986d31c/package.json),
[license](https://github.com/fgcoelho/rufino/blob/e504a75164987410e8e7d42be4cd3ab33986d31c/license).

## What the inspected implementation does

- **Own JSX runtime.** Elements use Rufino-specific symbols. Function components
  are called directly to resolve a document; class components are explicitly
  rejected. The package does not depend on React. This authoring path does not
  supply React hooks, scheduling or ongoing reconciliation simply because it
  accepts TSX.
  [JSX elements](https://github.com/fgcoelho/rufino/blob/e504a75164987410e8e7d42be4cd3ab33986d31c/src/core/jsx.ts),
  [document resolution](https://github.com/fgcoelho/rufino/blob/e504a75164987410e8e7d42be4cd3ab33986d31c/src/core/runtime.ts).
- **Native file generation.** The CLI evaluates documents in a Node subprocess,
  serializes a JSON intermediate representation, then invokes headless Godot.
  Its GDScript builder instantiates nodes/resources through ClassDB, applies
  properties and method operations, assigns scene ownership, packs scenes and
  saves `.tscn`/`.tres` files. TypeScript functions participate in generation;
  they are not a React runtime embedded in the resulting game.
  [Build orchestration](https://github.com/fgcoelho/rufino/blob/e504a75164987410e8e7d42be4cd3ab33986d31c/src/build/build.ts),
  [IR](https://github.com/fgcoelho/rufino/blob/e504a75164987410e8e7d42be4cd3ab33986d31c/src/build/ir.ts),
  [Godot builder](https://github.com/fgcoelho/rufino/blob/e504a75164987410e8e7d42be4cd3ab33986d31c/src/godot/build_from_ir.gd).
- **Generated Godot types.** Code generation reads Godot class documentation,
  combines property/method metadata with ClassDB instantiability information,
  and emits typed wrappers. The inspected generator defaults target **Godot
  4.6**; compatibility with this project's Godot 4.7.2 needs a separate check.
  [Class manifest](https://github.com/fgcoelho/rufino/blob/e504a75164987410e8e7d42be4cd3ab33986d31c/src/codegen/manifest/generate.ts),
  [property metadata](https://github.com/fgcoelho/rufino/blob/e504a75164987410e8e7d42be4cd3ab33986d31c/src/codegen/manifest/generate-props.ts),
  [typed wrappers](https://github.com/fgcoelho/rufino/blob/e504a75164987410e8e7d42be4cd3ab33986d31c/src/codegen/generate-wrappers.ts).
- **Development reload.** A filesystem watcher rebuilds documents. A persistent
  Godot wrapper reads build status, reloads resources and calls
  `change_scene_to_packed`. On a reported build error, it leaves the current
  scene in place and reports a warning. Successful scene replacement is not
  React Fast Refresh or evidence of preserving component state.
  [Watcher](https://github.com/fgcoelho/rufino/blob/e504a75164987410e8e7d42be4cd3ab33986d31c/src/commands/dev.ts),
  [scene reload](https://github.com/fgcoelho/rufino/blob/e504a75164987410e8e7d42be4cd3ab33986d31c/src/godot/dev_wrapper.gd).

## Comparison with Godot Fabric

| Concern | Rufino at the reviewed commit | Godot Fabric |
| --- | --- | --- |
| Main responsibility | Author scenes and resources before they run | Render reactive UI while the game runs |
| JSX meaning | Own document elements and function evaluation | Original React elements, hooks and reconciliation |
| Native result | Saved Godot scene/resource files | Live Controls mounted by Fabric transactions |
| Layout | Properties of authored Godot nodes and containers | Yoga layout translated to native Controls |
| Updates | Regenerate files; the dev wrapper replaces the scene | React updates state/props and reconciles the mounted tree |
| API scope | Godot node/resource wrappers from generated metadata | Bounded React Native platform facade and native adapters |

The Fabric column describes the current experimental
[architecture](../ARCHITECTURE.md) and [API limits](../API.md), not complete
React Native parity. Rufino components cannot be assumed interchangeable with
React components: they create different element types and use different
execution contracts.

## Opportunities to evaluate

1. **Generate types for the supported host API.** Its metadata pipeline is a
   useful design reference for reducing manual property maintenance. Fabric's
   supported props, events and lifecycle still need explicit adapters and
   validation; discovering a Godot property does not implement RN semantics.
2. **Improve the development loop.** Watch/build/error reporting could inform a
   Fabric CLI. Resource refresh, React rerenders and scene replacement need
   separate policies, especially when retaining state is part of the contract.
3. **Compose a static shell with dynamic UI.** Rufino could author ordinary Godot
   scenes/resources while a loader attaches a FabricSurface and mounts React.
   This is a proposed integration, not an existing feature. Godot and Fabric
   must have clear ownership of their respective nodes.

## Small integration experiment, not yet implemented

Generate a generic host scene and resource with Rufino, then attach the existing
FabricSurface through a Godot loader and mount a React counter. Validate the
generated files against Godot 4.7.2 before expanding API coverage.

Acceptance should distinguish three behaviors: a React state update retains
component identity; refreshing a supported resource preserves the mounted
surface; replacing the host scene performs explicit unmount/remount with
balanced native cleanup. Invalid generated input must remain visible as an
error. Do not advertise state-preserving reload from the watcher alone.

No Rufino dependency, upstream code or demonstration assets were added to this
repository. This note records a candidate and a test boundary, not a completed
runtime test.
