# Original Codegen native extension

This independent consumer selects an installed native package without editing the
renderer core. Its two React roots render `ExternalBadge` as real Godot Buttons.
The original RN Codegen supplies descriptors, Props, events, Commands and the
`ExternalProbe` CxxSpec. The package imports one shared Godot Fabric native host.

```sh
npm run test:adapters:loader -- --sdk build/native-sdk --out build/adapter-loader
npm run test:adapters:runtime -- --sdk build/native-sdk --out build/adapter-runtime --capture
```

Use a freshly built/verified macOS arm64 Release SDK and new output directories.
The runtime command provisions an independent addon/project, compiles the fixture
package and uses the addon's private tools for the JSX bundle. It exercises
native props/events/commands, shared roots, retirement and stale authority, then
runs graphical checks with captures. The generated project can be opened in
Godot from `build/adapter-runtime/project/project.godot`.
The package is a test fixture, not a published npm library or a new core primitive.

![Initial external components in two roots](../../docs/evidence/native-adapters/initial.png)

Keys `a` and `b` retain native identity when React reorders them. Props update on
the existing Control, removing props restores generated defaults, and retained
transports resolve the latest emitter. The updated first root has a reordered
Button with removed/default props and a disabled updated Button; the second root
keeps its initial props.

![Reordered/defaulted first root, unchanged second root](../../docs/evidence/native-adapters/updated.png)

Original module calls cover sync results, Promise resolution and one emitter
subscription. Removal, unmount, remount and stop verify disposal and stale-command,
stale-callback and extracted-method behavior. Native events in this fixture use
Godot's Button signal; the captures prove rendering, not hardware input/IME.

[Source package](../../tests/adapters/package) ·
[Consumer JSX](../../tests/adapters/consumer/ui/index.tsx) ·
[Validation](../../tests/adapters/consumer/validation.gd) ·
[Executed evidence and gaps](../../docs/evidence/native-adapters/README.md)

[Native callback shutdown](../../docs/evidence/adapter-shutdown/README.md) covers
application-wide shutdown from native callbacks. The
[root-retirement checkpoint](../../docs/evidence/root-retirement/README.md)
adds individual root retirement from resize, pressed, RAF/timer and host removal,
plus reentrant remount and application-owner replacement.

`unmount()` immediately sets the active surface ID to zero and removes input,
event and command authority. Original React cleanup and physical Control
deletion run in a deferred host phase, after the signal stack can return. The
other root keeps its runtime, module state and scheduling. Reentrant `mount()`
reserves a new ID and starts Fabric outside the old registry visit; completion
of the retired root cannot clear the new application/surface binding.

![First root retired, second root still mounted](../../docs/evidence/root-retirement/root-unmounted.png)

![New first-root generation beside the surviving second root](../../docs/evidence/root-retirement/root-remounted.png)

Core Button and LineEdit callbacks retain their originating runtime, surface,
tag and mount generation, rather than consulting the surface's mutable owner.
An old deferred Button signal cannot activate a new owner with reused root/tag
values. The adapter's generated Props remain separate from core ControlProps;
common ViewProps appearance preserves its own `font_color` override.

![First surface under a new application owner](../../docs/evidence/root-retirement/root-owner-switched.png)

These are experimental macOS arm64 contracts. Arbitrary host-owned descendant
deletion, complete multi-root input/DOM parity and unrestricted asynchronous
cancellation remain open.
