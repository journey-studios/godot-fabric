# Shared-root validation — GF-07 / migration 2A

Validated locally on **2026-10-02**, macOS arm64, official Godot **4.7.2**,
RN **0.87.1**, React **19.2.3** and Hermes **250829098.0.17**. Godot itself
was not rebuilt. The [matrix](matrix.json) records the native runs and report
hashes; [provenance](provenance.json) identifies the validated runtime/example
sources and original upstream registry/binding files. Raw logs/reports remain
in ignored `build/` and hosted artifacts rather than the publication payload.

## Delivered boundary

The [scene](../../../examples/shared/scene.tscn) has an explicit
`FabricApplication` and two `FabricSurface` Controls. One application owns
Hermes, UIManager, scheduler, module cache, native timers and frame callbacks.
Each root owns its ShadowTree, Yoga constraints, native tree and pointer adapter.
The original AppRegistryImpl and C++ AppRegistryBinding mount/update registered
entries. Godot replaces the native `renderApplication` container and supplies
the original RootTagContext; the reconciler remains original ReactFabric.

Only root components are registered. The example's ordinary children use
public RN View/Text/Button. A module store shared through useSyncExternalStore
is explicit; local useState and React Context belong to their respective roots.
Native application/surface properties are an experimental authoring API, not
the final application Resource, singleton activation or `GodotFabric` SDK.

## Observable checks

The shared example passes **35 headless checks** and **38 graphical checks**.
The three additional graphical checks save actual Viewport captures.
Headless Button input uses its real native `pressed` signal; graphical input
uses logical Viewport mouse motion/press/release with validation device 1001.
Neither transport certifies physical hardware, mobile gestures or system IME.

The checks require distinct root IDs with one runtime/bundle evaluation,
RootTagContext identity, separate constraints and native input, explicit shared
store updates, state-preserving prop updates, balanced tag/control release,
independent cleanup, stale-tag rejection, fresh remount identity, hide/show,
replacement scene Nodes, zero-root timer survival and global shutdown.
A freed application leaves an inspectable finalized surface snapshot.

The **19 negative checks** reject a wrong owner, missing entry, inherited
prototype entry, duplicate/reserved registration, unsupported sections,
stopped/off-tree owners and missing bundles. Exact expected native errors are
required; additional errors, repetitions, crashes, script errors or incomplete
reports fail the runner. Rejected entry lookup happens before ShadowTree
allocation, and a valid entry can subsequently use the already evaluated bundle.
Failed initial bundle load stops the owner and releases scheduling resources.
The suite also destroys an owner with a live root/timer and requires complete
native cleanup while the surface Node survives.

## Captures

![Initial roots](initial.png)

HUD is root 1; Inventory is root 11. Both start with local/store value 0 and
real Godot Controls. The initial capture follows input-isolation checks and a
temporary resize of Inventory, restored before capture.

![Prop update and explicit shared store](updated.png)

HUD's title changes through native `update_props`; its local value remains 2.
Inventory retains local value 0. Both display shared value 7 from the same module
store, with their original root identities intact.

![Only Inventory removed](unmounted.png)

Inventory's React effects and native tree have been removed. HUD still displays
its title, local value 2 and shared value 7. The running test separately verifies
the application interval continues and only HUD's subscription remains.

## Regression and reproduction

```sh
npm run test:application
npm run example -- shared --capture
npm run test:examples
npm run test:examples -- --capture
npm run test:runtime
npm run test:cold
npm run parity:godot
npm run test:contracts
npm run check:static
npm run check:publication
```

All **12 interactive examples** passed headless and graphical validation.
The legacy anonymous examples keep whole-application shutdown on scene exit;
registered roots use independent unmount. Runtime exception recovery passed,
as did two fresh cold-import projects and the existing 13-case Godot oracle.
The parity completion guard now waits for the deferred implicit owner before
enforcing exactly one completion callback; its timeout and final assertion remain.

The workflow adds a macOS shared-application lane within native-cold-start and
uploads the positive/negative reports/logs. Local success is separate from hosted
CI. The existing iOS/Android oracle covers core-ui-v2; it does not yet compare
the new shared-root fixture.

## Remaining gaps

GF-07 remains In progress. Full bootstrap/dev renderer, original RN multi-root
comparison, portals/overlapping-root input, native/React error recovery during
root teardown, pause/resume, Activity hidden semantics, transformed/multiwindow
geometry, public refs/game services and resource/SDK/editor authoring remain open.
`hide()` preserves effects; it does not implement Activity hidden behavior.

One application Node is manually placed and shared in this prototype; the SDK
must still enforce primary-application/resource activation. Its stopped owner
cannot restart. JS, Fabric and Godot still execute on the main thread. Final
activation, shutdown/restart, threading and tooling policies retain their pending
V2 decision status. This delivery supplies a tested foundation for those contracts
without claiming complete GF-05/GF-06/GF-07 or full RN parity.
