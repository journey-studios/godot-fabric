# macOS Release export: executed minimal consumer

## CI hospedada e Pages

**O run.** Desde o #88, um push da `main` não roda as suítes nativas. Por isso o recibo vem do workflow Contracts **disparado à mão** sobre a `main` em `19fbb7b`, o squash do #75: run [38063477166](https://github.com/journey-studios/godot-fabric/actions/runs/38063477166), evento `workflow_dispatch`, ramo `main`, primeira tentativa. O run passou nos **oito jobs**, todos com o checkout em `19fbb7b`.

**O passo.** No job `native-suites-runtime`, o passo 69 deriva o template arm64 de Release a partir dos templates oficiais do Godot 4.7.2 e roda `npm run test:export:macos` com `MACOS_EXPORT_TEMPLATE` apontando para ele. O passo se chama "Export, sign and execute the relocated macOS consumer with rejection controls".
- Passou nos seus 14 testes, sem nenhum pulado (TAP 14 de 14). Entre eles estão o export real, a assinatura ad hoc verificada, o app copiado para outro diretório e executado (headless e com janela) e os controles de rejeição.
- O artefato `native-macos-export` (id 11675292938, SHA-256 `34f9eb69…`, 89 arquivos) traz os relatórios. Neles estão as marcas `CONSUMER_EDITOR_BUILD_PASSED`, `GODOT_FABRIC_EXPORT_PREFLIGHT_PASSED` e `CONSUMER_VALIDATION_PASSED` (headless e com janela).
- O job `contracts` passou `npm run test:contracts` (7, 43 e 583 testes de Node). O único teste pulado é, de propósito, o export nativo, que pula sem o template nesse job; o [recibo](hosted-ci.json) registra esse pulo, e o passo nativo acima roda o mesmo teste com o template.
- O recibo também guarda os jobs, os passos, os digests e os arquivos do artefato.

**O Pages.** O push de `19fbb7b` rodou o workflow do Pages: run [38063457484](https://github.com/journey-studios/godot-fabric/actions/runs/38063457484), com `build` e `deploy` em success e 43 testes do painel passando. O [recibo](publication.json) registra:
- o deployment 6982856021, em success;
- o artefato `github-pages` que ele usou (id 11673644082, SHA-256 `6368f93e…`);
- que o `migration.json` publicado é o commitado em `19fbb7b`, com a entrada de atividade dos critérios `plugin` e `assinatura` do V05-07.

**O que continua só local:** as revisões de contenção e de symlinks, as auditorias locais do arquivo e as capturas comparadas byte a byte, todas registradas abaixo.

O `--work-dir` abaixo é um exemplo: qualquer diretório fora do repositório serve.

```sh
node scripts/hosted-receipts.mjs --write --slice macos-export --work-dir "${TMPDIR:-/tmp}/godot-fabric-hosted-receipts"
node scripts/hosted-receipts.mjs --check
```

## Containment review follow-up

Clean producer `881a711b9972421017e98997539e56615586d1e1` repeated the real
export after consolidating the three path guards: 13/13 native tests, exact
40/43 runtime checks and a 284-check independent local archive audit passed.
All 220 SDK source pins remain identical to the preceding producer; all three
new captures are byte-identical to its exported and independently executed
editable captures. The [review delta](containment-review/README.md) retains the
new observations and hash index. The hosted CI of the final delivery is recorded in [CI hospedada e Pages](#ci-hospedada-e-pages).

## Current fixed-window proof

Producer `29969eb0d64201a1797e6e866a2ef650b1282fde`, including main's accepted
Frontier input policy (`7ef63ed`), passed the real macOS arm64 export lane:
13/13 tests without skips, exact ordered 40 headless / 43 headed consumer checks,
and three 540×300 captures of a complete 1080×600 logical canvas at scale 0.5.
An independently executed editable baseline passed the same checks and produced
byte-identical captures. All 220 SDK source pins were checked against the producer.

The [current evidence packet](fixed-window/README.md) contains receipts, both
sets of images, canonical/adapted fixtures, actual logs, five native controls,
the 280-check local archive audit, the 24-check independent editable review and
the original/public hash index. Contracts passed 395 Node tests plus one explicit
native-template skip and 23 Python tests; static and publication checks passed.

This is local evidence. The hosted `7c6a4f8` run failed its old 1080×600 capture
expectation; the delivery's hosted run passed the native export lane, its headed run included (see
[CI hospedada e Pages](#ci-hospedada-e-pages)).
The [failure history](fixed-window/failure-history.json) also preserves an
unexplained local remount failure and the corrected generic-output false positive.
The Frontier game replay, clean OS profile and second Mac/VM remain open.
The earlier evidence below is retained unchanged and describes its own producer.

The [local dashboard capture](dashboard-fixed-window-local.md) shows these evidence
links and the remaining P2 criteria. It does not claim a public Pages deployment.

![Current exported app after inventory-only resize](fixed-window/export/captures/resized.png)

## Historical producer 58f5271

Producer `58f527193039222b19794960e7b662cb34c65e74`, with main `ec831ac` (LayoutAnimation) integrated, produced and published a signed, relocated macOS arm64 Release application. The run began at 20:04:52.883 UTC and finished at 20:05:27.433 UTC on 2026-10-08. This is local validation of the minimal consumer; hosted CI and the delivery PR review are pending.

The final app contains one Godot engine, one addon host, the two required runtime frameworks and a 27-file PCK. Its regular files total 106,438,140 bytes (filesystem allocation and symlink metadata are separate). React 19.2.3, RN 0.87.1, Hermes 250829098.0.17 and Godot 4.7.2.stable.official.ed1daf0bf are pinned/observed. [Executed summary](executed-summary.json), [app receipt](executed-export.json), [original/public file hashes](executed-observation-files.json).

The exact SDK manifest and actual builder report/bundle were retained before disposable project cleanup. The [independent root review](root-independent-review.json) passed 18 checks, including all 219 source pins against producer Git blobs, SDK/report/bundle bindings, exact PCK contents, capture hashes and final-path `codesign --verify --deep --strict`. Source, unsigned and signed binary hashes are distinct in the receipt.

The exported executable ran from outside the disposable project, after moving the app, with Node absent from PATH and DYLD overrides removed. Its reports preserve the exact ordered 40 headless / 43 macOS assertions from the editable consumer. All three captures are 1080×600 and byte-identical to the editable baseline; they were produced by the exported app in this run.

![Exported app: initial two roots](exported-initial.png)

![Exported app: local/shared state and Godot health updates](exported-updated.png)

![Exported app: independent inventory resize](exported-resized.png)

[Actual headless log](executed-runtime-headless.log), [actual graphical log](executed-runtime-headed.log), [export log](executed-macos-export-release.log), [payload preflight](executed-macos-export-preflight.log). The empty [final signature log](executed-root-final-signature.log) accompanies an independently observed successful exit; the root review records the verdict.

The [native control report](native-controls.json) records an unchanged signed copy after repeated framework normalization, plus four rejected mutations: absent RN framework, modified enclosing Info.plist, an absolute RPATH added by `install_name_tool`, and a changed source lock in an independent native-input copy. Each uses the production gate and retains its actual diagnostic. These copied-app controls test admission gates; they do not claim that each mutation ran the entire export/publish pipeline. The lightweight CLI lane separately verifies existing and dangling-symlink output refusal.

The native lane passed all 7 tests without skips, including the isolated 28-control payload/hook test. Contract testing recorded 327 Node tests: 326 passed and one explicit native-export skip; all 23 Python tests passed. The dedicated macOS CI step supplies the reviewed template and repeats the native lane; its hosted result remains pending.

## Packaging changes and limits

The official template archive was checked against its locked 1,281,349,702 bytes and SHA-256 before deriving a private arm64 member. The [derivation observation](official-template-derivation.json) binds the official TPZ, its macOS ZIP, universal engine, thinned member and derived archive. Installed templates were not modified.

The stock exporter omitted both runtime frameworks. The new platform hook includes them and reuses the same payload validation as iOS. Preflight is mandatory because an export-plugin error alone did not make Godot exit nonzero in the retained stock experiments.

The official RN framework archive ships flattened copies for its root binary, Resources and Versions/Current, plus four resource bundles at the root. macOS signing rejected that structure. The staged-app normalizer checks duplicate bytes before replacing aliases, moves the known resource bundles into Versions/A, and preserves their root lookup through matching links. Nested bundles are signed before the framework. This preserves the vendor/SDK inputs and follows [Apple's versioned-framework requirements](https://developer.apple.com/library/archive/technotes/tn2206/). Godot emits a warning when generating missing Hermes plist fields; actual deep/strict signing and both runtimes passed.

The proof uses the same Mac and fresh per-app user data. It does not establish a clean OS user profile, another Mac/VM, Developer ID distribution, notarization, mobile behavior or the Frontier game's twelve-turn replay. Only the `plugin` and `assinatura` criteria of V05-07 are locally satisfied. The other V05-07 criteria, all exit criteria and the complete GF-28 acceptance remain open. The 1.0 task model stays unchanged.

## Historical preparation

The earlier [editable baseline](editable-baseline-receipt.json), [baseline root review](editable-baseline-root-review.json) and stock observations retain their own provenance. Their captures are named `editable-*`; they are separate from the exported captures above. [Pre-implementation file hashes](pre-implementation-files.json) distinguish original observations from path-redacted public copies. Original JSON/log observations stay untouched under ignored build directories.

The first stock setup attempt failed on missing texture import configuration before the hook ran. A later stock export returned zero and included one host but no Hermes/RN frameworks. The [stock inventory](stock-export-inventory.json) and [invocation](stock-export-invocation.json) record that concrete gap, rather than runtime acceptance. Early implementation attempts and framework-layout signing probes also remain under ignored build directories, including the valid bare-RPATH rejection and flattened-framework failure; no app was published from those rejected attempts.

The [implementation review](implementation-review.md) records the structural fixes and actual builder checks with two PNG variants and missing-manifest rejection. Those asset preflight checks do not claim an image-bearing exported-app acceptance; the minimal consumer is intentionally asset-free.
