# As opções `exportFiles` e `frameworks: false` do export macOS (V05-10, critério `execucao`)

Registro do commit de implementação [`a44d552`](https://github.com/journey-studios/godot-fabric/commit/a44d5520a822fd8e3126e7ef1be712c9f7b991a8). É uma capacidade do export, não um resultado do comparativo: nenhum tamanho de pacote, tempo ou
contagem do Frontier é comparado aqui, e o `.app` do braço A **não foi executado**.

## O que foi provado

- `exportPreparedProject` e `presetText` ([`scripts/macos-export.mjs`](../../../scripts/macos-export.mjs)) ganharam `exportFiles` e `frameworks`. Sem as opções o export é o de antes:
  o texto do preset é byte a byte o mesmo (quatro SHA-256 calculados com a função anterior, com os argumentos do minimal e do civ-lite), e os dois lanes de antes passam sem mudança (tabela abaixo).
- O Frontier preparado como o **braço A** do comparativo (`shapeArmProject` de [`scripts/frontier-comparison-arms.mjs`](../../../scripts/frontier-comparison-arms.mjs): sem o addon, sem as seções da extensão, `main_bare.tscn` como cena principal)
  exporta como um `.app` Release arm64 do Godot 4.7.2, **assinado ad hoc** (`codesign --verify --deep --strict` passa), com o motor do membro arm64 do template, `--version` `4.7.2.stable.official.ed1daf0bf`,
  **sem frameworks, sem o host da Fabric e com só os arquivos selecionados**: `Contents/Frameworks` fica vazio e o PCK não tem `main.tscn`, `main_native.tscn`, `ui/`, `native_hud/` nem `addons/`.
- O **controle negativo** recusa o mesmo export sobre a cópia com o addon (ver abaixo).
- O que um `.app` carrega da extensão é agora **dado** ([`scripts/macos-export-payload.mjs`](../../../scripts/macos-export-payload.mjs)): `FABRIC_PAYLOAD` (host, frameworks, pacotes de recursos e o bundle JS) e `BARE_PAYLOAD` (listas vazias, sem bundle).
  A opção `frameworks` só escolhe um; a inspeção, a assinatura, a verificação de assinatura, a auditoria de caminhos de carga e a normalização dos frameworks iteram as listas do payload num fluxo só.
  Uma única checagem, `assertPayloadExact`, vale para os dois modos: `Contents/Frameworks` tem exatamente o host e a pasta `frameworks` do payload, essa pasta tem exatamente os frameworks do payload, nenhum outro arquivo tem o nome do host, e o PCK
  tem entradas em `addons/godot_fabric/` se e somente se o payload carrega a extensão.
- O inspetor do PCK ([`scripts/godot_pack.py`](../../../scripts/godot_pack.py)) ganhou o modo `--no-bundle`. Os dois modos informam `fabricAddonExcluded` e a lista ordenada `paths`; o modo com bundle mantém os seus fatos.

## Execução

Tudo no commit `a44d552`, com a árvore limpa, um comando depois do outro (os `.app` e as cópias de cada lane foram apagados antes do seguinte, por causa do disco), no mesmo Mac, com o template derivado `macos-arm64-template.zip`
(SHA-256 `ec98b2803f5243ea4bc62d61429c12c43b9bec59f855040f713d74307b4c17e6`; é um ZIP derivado que já existia na worktree `fabric-roadmap`, copiado para esta e não derivado de novo aqui, registrado como entrada observada):

| comando | resultado |
| --- | --- |
| `npm run test:export:options` | 1 de 1 passa, 0 pulados: os três exports abaixo |
| `npm run test:export:macos` | 14 de 14 passam, 0 pulados: o lane do minimal, o caminho padrão (com a extensão), sem mudança |
| `npm run test:export:civ-lite` | 1 de 1 passa, 0 pulados: o replay nas 6 execuções e a matriz da HUD, o caminho padrão sem mudança |
| `node --test tests/macos-export-options.test.mjs tests/macos-export.test.mjs tests/macos-export-native.test.mjs` | 27 passam, 0 falham, 1 pulado (o export nativo completo, sem a variável do template) |
| `python3 -m unittest tests/godot_pack_test.py` | 13 de 13 passam (também com o `/usr/bin/python3` 3.9.6 que o export usa) |

O resumo do export de A está em [`summary.json`](summary.json), copiado do `build/macos-export-options-native/report.json` dessa execução (o nome `*-report.json` é ignorado pelo git).

Os três exports do teste, em ordem, cada `.app` apagado logo depois de inspecionado:

1. **A com a cena sozinha** (`exportFilter: "scenes"`, `exportFiles: ["res://main_bare.tscn"]`): 11 arquivos no PCK. Veja "O achado do preload".
2. **A como o comparativo vai exportar** (a mesma cena e `includeFilter: "game/*.gd, services/*.gd"`): 37 arquivos no PCK, o export julgado.
3. **O controle negativo** (a cópia com o addon, provisionada e construída pelo editor, as mesmas opções): recusado.

## Os 37 arquivos do PCK de A

`fabricAddonExcluded: true`; o `payloadCheck` do recibo diz `hosts: []`, `frameworks: []`, `bundle: null`, `pckAddonEntries: 0`. As entradas do `.app` são `Contents/Info.plist`, `MacOS/Frontier`, `Resources/{Frontier.pck, icon.icns, PrivacyInfo.xcprivacy}`,
`PkgInfo`, `_CodeSignature` e um `Contents/Frameworks` vazio.

```text
.godot/exported/133200997/export-2e39bfcb78f48d24f065899919b8e4c4-main_bare.scn
.godot/exported/133200997/export-47749b605ed9c7a5a39a491f936b1e42-world.scn
.godot/global_script_class_cache.cfg
.godot/uid_cache.bin
game/canon.gd.remap
game/canon.gdc
game/context.gd.remap
game/context.gdc
game/economy.gd.remap
game/economy.gdc
game/game.gd.remap
game/game.gdc
game/intents.gd.remap
game/intents.gdc
game/prng.gd.remap
game/prng.gdc
game/replay.gd.remap
game/replay.gdc
game/rules.gd.remap
game/rules.gdc
game/snapshot.gd.remap
game/snapshot.gdc
game/turn.gd.remap
game/turn.gdc
game/world.gd.remap
game/world.gdc
main_bare.tscn.remap
project.binary
services/game_services.gd.remap
services/game_services.gdc
services/schema.gd.remap
services/schema.gdc
services/stress.gd.remap
services/stress.gdc
world/world.gd.remap
world/world.gdc
world/world.tscn.remap
```

Cada script aparece como o `.gdc` compilado e o seu `.gd.remap`, e cada cena como o `.tscn.remap` e o `.scn` importado em `.godot/exported/`. O filtro `game/*.gd` também traz `game/replay.gd`, que `main_bare.tscn` não usa:
o conjunto de cada braço é escolha da fatia seguinte (`scripts/frontier-comparison-arms.mjs`), e este é o do teste.

Hashes dessa execução: `.app` `a8c8d34ab49b627c8caedf4bd9f2ccec3e7d3011dad868bc548688cec3d3594b`, executável `e8f353a8e1f0cc796cd40272f8ed21c9a1669e8b7d8763655882a79516f1ec8c`, PCK
`be199ac73ebd21a6c42d25970a6401a3233a4c5aa1ce115dcc9aa1d01610451b`, preset `5d94ea1c80def8d2983e5b96e281bf2018831bf3e561bf525cc3eb7e78dfd7bf`, membro arm64 do template
`e914bf38d2369aa0066dc3dbb825744fce98b10fed3a7fc66305875ded0e6b06`.

**O SHA-256 do PCK varia de uma execução para outra** com o mesmo código e o mesmo conjunto de arquivos: as duas execuções que fiz com este código deram `d1db0a28d80b8cffa0ebe3b442e0334ee810d8035a8a0243171493da8a7ccd1c` e o `be199ac7…` acima para o PCK de A
(e `7ffd284361a94f0fdf02db16b0446b014b19f52dc9178bf0ebb1c203e41db540` e `9749053f043c8a1f1a7616da0c8496c614d02758f7810caffcce2a2729c8ef1f` para o da cena sozinha), com 37 e 11 arquivos nas duas. Não investiguei a causa. Por isso nenhum teste fixa
esse hash, o `.app` também muda de SHA-256 e a comparação entre execuções é pelos caminhos e pela contagem, não pelos bytes.

## O achado do preload

O modo "scenes" do Godot 4.7.2 **segue as referências dos arquivos de cena e não os `preload()` dos scripts**, e **ignora, sem aviso, as entradas de `export_files` que não são cenas**. Medido com o Godot direto e, nos pontos abaixo que o dizem, provado no teste:

- `exportFiles: ["res://main_bare.tscn"]` sozinho exporta 11 arquivos: a cena, `world/world.tscn` e os scripts que os arquivos de cena anexam (`services/game_services.gd` e `world/world.gd`), e mais o que todo export leva (`project.binary`, o cache de classes e o de UIDs).
  Nenhum `game/*.gd`, nem `services/schema.gd` nem `services/stress.gd`, que esses scripts só fazem `preload()`: esse `.app` não estaria completo.
- Listar os scripts em `export_files` não muda nada (o PCK sai com o mesmo SHA-256 de antes), e o modo `resources` os exportaria (35 arquivos), mas a decisão do V05-10 é `exportFiles` só com `scenes`. Estas duas medidas foram feitas com o Godot direto, num projeto descartável, e não estão no teste.
- O `includeFilter` os leva: com `game/*.gd, services/*.gd` o PCK passa a 37 arquivos, e o teste confere que o acréscimo são só scripts de `game/` e `services/` e que nada do que a cena selecionou saiu.

Para a fatia seguinte, a seleção de cada braço nomeia as cenas em `exportFiles` e os scripts em `includeFilter`.

## O controle negativo

A cópia com o addon (o arm C: provisionada e construída pelo editor, com a extensão e o bundle) exportada com as mesmas opções (`frameworks: false`, `scenes`, `exportFiles: ["res://main_bare.tscn"]`) é recusada pela checagem exata, depois do export e antes de qualquer assinatura:

```text
the exported .app does not hold exactly its payload (without the Fabric extension (frameworks: false)): Contents/Frameworks holds [frameworks], not the payload's []; Contents/Frameworks/frameworks holds [ReactNativeDependencies.framework, hermesvm.framework], not the payload's []
```

Os frameworks vêm do hook de export do addon, que roda mesmo no modo `scenes`; o host e as entradas do addon não chegam ao PCK nesse modo. Os testes de unidade
([`tests/macos-export-options.test.mjs`](../../../tests/macos-export-options.test.mjs)) recusam também o host, o host em outro lugar, o addon no PCK e o inverso (um app com a extensão que perdeu um framework, o host ou o addon do PCK).

## Limites

- O `.app` de A não foi executado: a medição precisa dos projetos de medição, que são a fatia seguinte, e nada aqui é um número do comparativo.
- Assinatura ad hoc, no mesmo Mac; sem Developer ID, notarização nem segundo Mac.
- A CI hospedada e a publicação das páginas deste commit estão na seção [CI hospedada e Pages](#ci-hospedada-e-pages); os testes nativos de export continuam só locais.

## Reprodução

```sh
MACOS_EXPORT_TEMPLATE="$PWD/build/macos-arm64-template.zip" npm run test:export:options
```

O teste grava o resumo em `build/macos-export-options-native/report.json`.

## CI hospedada e Pages

**O run.** O push da `main` em `5b60789` (o squash do #145, mesclado às 19:48:33 UTC; run [38081266792](https://github.com/journey-studios/godot-fabric/actions/runs/38081266792) do workflow Contracts, de 19:48:36 a 19:54:58 UTC) passou na primeira tentativa, sem reexecução, nos três jobs que um push roda desde o #88: `contracts` (até 19:52:06 UTC), `reference-android` (até 19:53:55 UTC) e `reference-ios` (até 19:54:58 UTC), todos com checkout em `5b60789`. Os cinco jobs nativos aparecem como **skipped**; o [recibo](hosted-ci.json) os registra assim e só os aceita porque a fatia não tem passo nativo nem artefato. A cabeça da PR (`e6f650e`) tem a mesma árvore que o squash, então a `main` não mudou caminho nenhum entre a bifurcação e o squash.

**O passo da guarda.** "Milestone exit guards (X9 and X10)" passou e imprimiu `MILESTONE_GUARDS_CHECK_PASSED: against a36824fc49e1 (--base a36824fc49e178956231323eea31de2095679a41); X9 clean, X10 clean`. A base é o pai do squash, `a36824f`.

**Os testes.** `npm run test:contracts` rodou com 7, 43 e 711 testes de Node, em três blocos: os de 7 e 43 passaram todos; no de 711, 710 passaram e 1 saiu como skipped pela allowlist do check (`ALLOWED_SKIPS`): "native macOS arm64 export and copied-app rejection controls", o teste de export macOS do #75, com o motivo "MACOS_EXPORT_TEMPLATE is unset; native export requires the reviewed Godot arm64 Release template". O recibo confere, pelo nome e no log do job `contracts`, os 14 testes de `tests/macos-export-options.test.mjs` (14 de 14). Os 37 testes de Python do step passaram. `check:static` e `check:publication` também passaram (2.393 arquivos). Os testes nativos (`test:export:options`, `test:export:macos` e `test:export:civ-lite`) rodam só localmente e não estão no recibo.

**O Pages.** O push de `5b60789` rodou também o workflow do Pages (run [38081266834](https://github.com/journey-studios/godot-fabric/actions/runs/38081266834), de 19:48:36 a 19:49:11 UTC, `build` e `deploy` em success na primeira tentativa, com 43 testes do painel, todos passando). O [recibo](publication.json) registra o deployment 6986014338 em success e o artefato `github-pages` que ele usou (id 11680448194, SHA-256 `cdf98b0c…`, igual ao digest da API e ao do log de upload). O `migration.json` publicado tem os mesmos bytes do commitado (SHA-256 `46b64a7e…`) e 290 entradas de atividade. A mais recente é a desta fatia, `milestone-0-5-v05-10-export-options-ecf637e`, que o `publication.json` confirma presente no JSON publicado; as duas seguintes são `milestone-0-5-hosted-receipts-13-f1bdaae` e `milestone-0-5-hosted-receipts-12-97af2c2`. Um push seguinte da `main` substitui o deployment, então o site público não foi comparado.

**O que continua só local:** a fatia não executa o `.app` do braço A nem mede nenhum número. Os recibos provam os testes de contrato e a publicação, não uma execução nativa.

O `--work-dir` abaixo é um exemplo: qualquer diretório fora do repositório serve.

```sh
node scripts/hosted-receipts.mjs --write --slice macos-export-options --work-dir <diretório fora do repositório>
node scripts/hosted-receipts.mjs --check
```
