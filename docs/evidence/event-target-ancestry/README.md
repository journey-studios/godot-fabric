# Current ancestry for EventTarget dispatch

Shared consumer/laboratory bundling now removes the permanent parent cache in
the exact pinned RN 0.87.1 EventTargetInternals module. Each new dispatch resolves
the current parent through the original symbol/getter. The original dispatcher
still builds its complete path before invoking callbacks. Downloaded RN files,
native host binary and public feature-flag defaults remain unchanged.

The identical fixture executes **102/102 checks in each variant** on macOS
arm64/headless: original source versus the generated correction. These are
separate 102-check executions. [Curated receipt](report.json) records every
check, both traces, source/bundle/host hashes and original/generated module
hashes. All 10 implementation/config/fixture hashes match implementation
[`53eae43`](https://github.com/journey-studios/godot-fabric/commit/53eae437c2a2ad8c7af3dab9e3614dd3a9e193d4);
execution preceded the commit.

```sh
npm run test:events:ancestry
```

| Case | Original source | Current-parent correction |
| --- | --- | --- |
| Warm item removed; cold sibling never dispatched | Warm reaches old flattened parent, ancestor, root and document; cold delivers only to itself | Both deliver only to themselves |
| Entire ancestor subtree removed | Warm still reaches cached retired ancestors | Current NativeDOM disconnection removes all old ancestor deliveries |
| Root retired while another root survives | Warm reaches old parent/root/document | Retained refs dispatch locally; surviving root keeps surface/Control identities |
| Root remounted in the same Hermes | Retained warm ref keeps the old chain | New refs/tags/document/Control generation cannot revive the retained old chain |
| Keyed sibling reorder | Ref/Control identities and listeners survive | The same pre-registered listeners survive; NativeDOM sibling order updates |

Manual refs include an actually flattened View, document/documentElement,
capture/bubble phases, target/currentTarget/this and transient-field cleanup.
Warm listeners are positively dispatched before removal; NativeDOM independently
reports disconnected refs and null parent afterward. Native nodes and all
application roots/work/timers/retirements clean up without errors.

A separate causal graph uses original EventTarget subclasses with mutable
parent getters. Its capture listener changes the parent synchronously: both
variants preserve every callback/path/phase of the current dispatch. The next
corrected dispatch uses the new parent, and the following detached dispatch
uses self only; the original repeats its cached path. A cached null parent also
updates correctly. This proves the path algorithm separately from native React
commits; it does not claim React preserves a keyed host ref when moving it
between different parents.

The overlay validates a whole-file SHA-256 and one exact replacement span
before Babel. Five Node guards cover unchanged control, input drift, repeated
application, invalid modes and a project-owned matching module name. Original
control mode is internal test infrastructure; default bundles use the correction.
Addon packaging includes the same helper and hashes; the independent consumer
passes **30 build/ownership checks and 40 native**.

The full contract command passes (last Node suite: 204; Python: 13). The original
119-check baseline still reproduces all three gaps under its explicit original
control. Focus/command and pointer processor/error gates pass; all 22 examples
pass 2,246 headless checks. Static/publication checks pass. CI is configured to
retain both variants and their comparison; hosted execution of the correction
remains pending.

GF-08 remains in progress. Public EventTarget flags are off; imperative native
interest and dispatcher integration remain open. This correction intentionally
differs from the pinned permanent-cache behavior. It adds current parent queries
when building new paths; no performance benchmark or revision-aware cache is
certified. Graphical/hardware/mobile, full responder/PanResponder and native
trusted-error contracts remain separate.
[Integration findings and acceptance](../../research/event-target-boundary.md).
