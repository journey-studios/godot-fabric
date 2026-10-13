# X9 and X10: isolation of the 0.5 scope

[audit.json](audit.json) audits `c0f3702` through `9ba77d6`, 98 first-parent commits, of which 75 add a milestone entry. X10 has no violation. X9 has the one already-known exception, `b0e40aa` / #74: the GF-27 note/evidence changed, while no weight, checkpoint or status moved. The audit's repository allowlist retains that exception explicitly; this record does not erase it or introduce another.

The merged candidate preserves `tasks`, `phases`, `sequences`, `releaseChecklist`, `integrationChecklist` and `decisions` exactly from main `38caaea22a891fceb2f1195b9b39c1e5b6af7413`. This includes GF-01 S1 from #153. `summarize()` is identical with and without the milestone: 32/156 checkpoints, 20.5128%, 0/39 required items complete. The milestone's documented mobile exclusions affect its own denominator only.

[validation.json](validation.json) records the full local contracts, targeted merge checks, current-base guards, publication scan and byte-for-byte raw/analysis reproduction. Native jobs skipped by the contracts are separate from the actual local Release campaign; the stopped campaign supplies no performance conclusion.

```sh
node scripts/milestone-guards.mjs --check --base 38caaea22a891fceb2f1195b9b39c1e5b6af7413
node scripts/milestone-guards.mjs --audit --from c0f3702 --to 9ba77d6 --out /tmp/frontier-isolation-audit.json
```

Future milestone changes remain subject to these guards. Closing the audit criteria does not close the comparison, X6 or X11.
