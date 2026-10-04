# Original listener storage drives native pointerdown interest

The opt-in SDK can now qualify a native `pointerdown` from original RN
`addEventListener` registrations without a JSX handler on that View path.
The original EventTarget owns its listener Maps, removal, abort, `once`,
deduplication and callback dispatch. A generated pure query reads those Maps;
the native processor uses the answer only for View-path Down capture/bubble.
No listener mirror, wrapped callback or `ViewProps.events` mutation is involved.

[Curated receipt](report.json), [isolated example](../../../examples/pointer-interest/README.md)
and [design boundaries](../../research/native-pointer-interest.md).

| Executed lane | Result |
| --- | --- |
| Original interest filter, headless | 193 checks pass; imperative-only Down is filtered before Raw, with separate manual positive controls |
| Pure listener query, headless | 230 checks pass; native imperative-only Down reaches original dispatch once |
| Pure listener query, actual macOS viewport | 260 checks pass, including 28 asserted pixels and two saved captures |
| Shared source/SDK guards | 15 pure-query/toolchain tests plus six native processor overlay tests |

Both native lanes use the original experimental dispatcher with its original
flags enabled in the isolated fixture. The comparison changes the interest
selection, with the same 13 producer pins, 13 original RN inputs and native
host. Public default flags remain disabled. `report.json` records exact source,
generated bundle, host, report and image hashes; execution precedes its source
commit and that commit is pinned after comparing every recorded source hash.

The 14 native cases cover bubble/capture/both, duplicate identity, `once`, no
listener, wrong event type, pre-abort, abort after registration, final removal,
removal of the next callback, a genuinely flattened ancestor, mixed JSX and
imperative delivery, and the remaining document-only negative. Each negative
consumes a real native Down with an active native contact. Manual untrusted
dispatch proves the relevant original listener separately and does not update
the React counter. Original/current are causal controls of this host filter;
they are not mobile differential certification.

Actual React re-render preserves ref/tag/listener identity. Keyed replacement
disconnects the old ref while its retained self-dispatch stays functional; the
new native family cannot revive that listener. B retains a held contact while
A unmounts, releases it normally, and receives another Down. Remount creates a
new root generation in the same Hermes runtime. Stop removes/releases the
query and clears roots, contacts, pointer processor state, work, timers and
frames with balanced native nodes. This proves teardown, not a post-stop query
call returning `false`.

These are actual Godot viewport captures at 820 × 280. Blue is imperative-only,
teal combines JSX and imperative listeners, purple sits beneath a flattened
ancestor, orange exercises keyed replacement, and yellow reflects React state.

![Two native surfaces before injected Down cases](initial.png)

![React state expands A's yellow bar while B remains unchanged](updated.png)

The second capture follows the case matrix, before replacement and root
retirement. Fourteen expected-color assertions per frame check the native
rectangles, background and counter change. Input uses injected
`InputEventScreenTouch` Down/Up/Cancel; these are native-input checks, not
physical hardware touch.

Reproduce with the locked Node/toolchain and built native host:

```sh
npm run test:pointers:interest
node tests/pointer-interest-native.test.mjs --capture
```

The fixture uses isolated `build/pointer-interest-enabled.js` and does not
replace the public bundle within those runs. Regressions on the new host pass:
250 Node/13 Python contracts, 22 examples/2,250 headless checks, independent
consumer 30 build/ownership and 40 native checks, fresh native SDK pack/verify,
loader 89 checks/21 cases and 13 actual adapter runs/213 checks. Previous native
dispatcher 181/206, pointer processor and geometry gates also pass. Adapter ABI
certification remains false.

The preceding [integration CI](https://github.com/journey-studios/godot-fabric/actions/runs/37223152112)
passed five jobs at `0478499`, with its 181/206 headless artifact audited.
It does not cover this new query source; this slice's hosted run is pending.

Document-only interest still has a manual positive and zero native Raw.
Other pointer categories, the full flag matrix, arbitrary query fault cleanup,
complete responders/PanResponder, performance, dev renderer, hardware and Godot
mobile exports remain open. Pinned Android filtering differs from the compiled
C++ lane, so the original negative is specific to this host. GF-05/06/07/08/13
stay In progress; no complete contract or additional checkpoint is closed.
