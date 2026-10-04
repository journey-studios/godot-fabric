# Native touch tags and responder lifetime

Ending one of two contacts inside the same responder previously released its
owner prematurely. Godot serializes `touches[].target` as a native numeric tag;
the pinned ReactFabric renderer's instance lookup returned that number instead
of the current Fiber. Its descendant check therefore found no surviving contact.

The shared production bundler now inserts a hash-guarded numeric-tag lookup
into the original RN 0.87.1 renderer. The native lookup returns the original
weak instance handle from a family in the current committed UIManager tree,
with a live root in the same runtime. Invalid and removed tags return null.
Canonical/public-instance and Fiber inputs keep their original lookup paths.
No parallel Fiber registry is created. Downloaded RN source stays intact;
the official Godot engine remains unchanged and its GDExtension is rebuilt.

```sh
npm run test:events:dispatch
```

[Curated receipt](report.json) records the environment, exact source and bundle
hashes, raw report digests, identical check-ID digest and native responder traces.
All 17 executed implementation/config/fixture hashes match implementation
[`7a05e4a`](https://github.com/journey-studios/godot-fabric/commit/7a05e4afdfcc018a34e0eb4b6dc6e74433def234);
execution preceded the commit. Both variants execute the same **647 checks**
on the same native host:

| Renderer lookup | Result | Two contacts inside the owner |
| --- | --- | --- |
| Original source | 645 pass; exactly two expected normative failures | First end releases owner; second end has no owner |
| Corrected numeric lookup | 647 pass | First end retains owner; last end releases it once |

The original control must fail those exact assertions, without unrelated errors.
The corrected variant must pass every unchanged assertion. It agrees with the
original experimental responder's lifecycle for this inside-contact sequence.

## What this executes

Each variant uses two independent Hermes runtimes with two real roots each.
The enabled runtime calls the original experimental `dispatchNativeEvent`
explicitly with original refs and payloads. The disabled runtime receives actual
injected Godot ScreenTouch/ScreenDrag input through the compiled legacy renderer,
its native queue, emitter and responder. These are distinct execution paths.

Checks include normal trusted capture/bubble, JSX before imperative listeners,
exact target/currentTarget/this, payload identity, timestamps, stop/cancel,
flattened ancestry, independent roots, nested dispatch and `global.event`
restoration. A JSX-only fast path and an imperative-only target have positive
delivery and fault/recovery controls. Responder negotiation covers capture/bubble,
grant/start/move/end/release/cancel, accepted/rejected transfer and touch history.
Responder events retain their own original untrusted/NONE/empty-path contract.

Eight deliberately caught original JS faults are checked separately from native
application errors. A registered null target throws before recovery; an unknown
event with null target is inert. Twelve real refs, including flattened families,
resolve to their exact original instance handles. Invalid tags and a retained
tag removed by a real React commit have no authority. All roots, contacts, work
and timers retire without native application errors.

## Native package composition

The corrected JS facade requires the rebuilt native instance-handle seam.
Provisioning checks the recorded native sources, headers, CMake/profile,
dependency build definition and pointer-overlay generator before copying files.
It also verifies the host/framework bytes and repeats validation after copying.
An internally valid older SDK is rejected with `SDK_HOST_SOURCE_MISMATCH` rather
than being combined with the current JS. The default local host needs its
CMake build receipt; missing receipts direct the developer to setup/rebuild or
a matching `--native-sdk`. JS/docs/package changes alone do not require native
receipt identity. This is exact build composition, not ABI certification.

Thirteen synthetic guards cover positive composition, stale/missing inputs,
changed native dependency definitions, corrupted packages, mismatched binaries
and missing/wrong-target receipts. They pass alongside 14 existing native SDK
tests. The real fresh SDK and default host pass composition; the older intact
SDK is rejected at `native/application_runtime.cpp`. SDK pack/verify claims
remain separate from adapter execution and ABI certification.

The fresh SDK provisions an addon with the same native host, tag helper, platform
plugin and facade hashes as the independent consumer. The old SDK CLI is rejected
before creating its output directory. Consumer checks pass 30 build/ownership
and 40 native assertions. Contracts pass 227 Node and 13 Python tests; all 22
examples pass 2,250 headless checks, including 47 Pressability assertions. The
119-check original EventTarget baseline, 102-check ancestry variants, focus
commands and pointer processor/error gates pass. Static/publication scans pass.
Hosted CI for this new slice remains pending.

## Remaining integration gaps

The original experimental dispatcher still differs from the compiled legacy
responder in four executed cases: an unrelated surviving contact delays release;
a thrown should-set callback retains currentTarget; should-set uses strict true
instead of the legacy truthy result; and an installed termination callback that
returns undefined permits transfer instead of rejecting it. These observations
remain open in the receipt; this correction does not select that dispatcher.

Public imperative/native EventTarget flags remain off. Native imperative interest,
batched EventTarget delivery, complete PanResponder/error/lifecycle acceptance,
dev renderer, lookup during reentrant teardown, lookup cost and hardware/mobile
differentials remain unverified. Explicit JS dispatcher calls do not certify
native scheduling or priorities. GF-05/GF-08/GF-13 stay in progress.
[Research and next acceptance](../../research/event-target-boundary.md).
