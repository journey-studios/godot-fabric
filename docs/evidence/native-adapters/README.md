# Executed external native adapter slice

Local execution on 2026-10-03 uses macOS arm64 Release, AppleClang 17
(clang-1700.6.3.2), Node 22.23.3, React 19.2.3, RN/Codegen 0.87.1 and the official
Godot 4.7.2 executable. Only the GDExtension/godot-cpp bindings were rebuilt.
[Provenance](provenance.json) records consumed native sources, host/SDK hashes,
actual tools and commands. Original Codegen claims remain build-only; execution
claims belong to the separate client/runtime reports.

| Executed proof | Result | Boundaries |
| --- | --- | --- |
| Shared-host loader client | [21 cases / 89 checks](loader.json) | No VM, Godot engine or view/module factory execution |
| Relocated registry regression | [11 cases / 207 checks](registry-regression.json) | Original descriptors, shared linking, registration/rollback/lazy factories |
| Independent consumer in headless Godot | [35/35 checks](headless.json) | Real Hermes/Fabric/native Controls, native Button signal transport |
| Same consumer with Godot rendering | [37/37 checks](graphical.json) | Same 35 lifecycle checks plus two actual renderer captures; no hardware input/IME certification |

The loader checks every selected manifest/source/artifact/bundle/hash and native
combination before dlopen. Negative fixtures prove no static/entry initializer
runs on those rejection paths. Other cases cover entry/witness failures, actual
hidden duplicate Godot binding variables, initializer rollback, process-pinned
library replacement, extra generated files and changes during load or witness
execution. Loaded UUIDs and file receipts are separate observations, not hashes
of arbitrary loaded memory or ABI certification.

The independent package links the shared host without Godot/RN/JSI archives or
another GDExtension initializer. Original TS specs/Babel Codegen generate its
static ViewConfig and Commands before type erasure. JSX enters the original RN
registry/reconciler and descriptor registry. Native factories run on committed
Create mutations. Generated Props/emitter/CxxSpec stay unchanged.

Runtime acceptance covers two independent roots; one module factory/VM/bundle;
real native geometry; typed events; named focus Commands; keyed reorder; generated
defaults after prop removal; current payload/callback after re-render; off-thread,
removed and unmounted transports; stale refs; fresh tag/Control/mount identity on
remount; sync call; original Promise/CallInvoker/emitter; root effect cleanup;
application/provider shutdown; and rejection of an extracted native method after
cleanup. This is a leaf Button fixture, not full external-container/state support.

![Original external components in two roots](initial.png)

![First root reordered and defaulted, second root preserved](updated.png)

The first attempted runtime harness listed a nonexistent module .cpp: original
CxxSpec generation is header-only. Subsequent attempts caught strict callback
return types and a GDScript type-inference error. Startup now uses the existing
startup extension-list contract before the official editor filesystem scan;
resource/import caches are not copied. A real stale-ref test found upstream's
legacy-command fallback: the Godot seam now ignores a retired tag and still
rejects a fallback aimed at a live node. Failed local output directories remain
in ignored build storage; they are not successful evidence.

GF-26/GF-28/GF-31 remain In progress. Open acceptance includes unrestricted
schemas/names/reflection, external children/native state/measurement and failed
factory transactions, long-lived asynchronous cancellation, other target/mode
exports, stable ABI, development refresh, full iOS/Android differential parity
and arbitrary React Native library compatibility. This slice does not approve
pending architecture decisions. New hosted loader/runtime lanes are configured;
local results do not establish their CI success.

Local core regressions passed: 121 Node checks / 13 Python tests, native
runtime/application/modules/services suites (2/4/2/2), 15 examples / 605 checks,
static and publication checks. The traditional consumer replay passed 18 tooling
and 40 native checks. A preceding recovery sequence had a bundle fingerprint
mismatch; it did not reproduce on the replay without changing the builder.
The exact assertion remains, and baseline/recovered bytes are now saved in
ignored build evidence for diagnosis. The cause is still open in GF-28; this
report does not claim that the first failure was fixed or inherited.
