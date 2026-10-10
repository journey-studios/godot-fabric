# Os exports Release de medição dos braços e da sonda, e o ensaio headless sobre eles (V05-10, `execucao`)

> **É UM ENSAIO. NENHUM NÚMERO DESTA PASTA É UM RESULTADO.** Os `.app` de A, B, C e da sonda foram exportados uma vez, no mesmo Mac, assinados ad hoc, a partir de uma árvore de trabalho com mudanças ainda não commitadas, e cada braço rodou **uma vez**, headless.
> Os tamanhos são **medidas de um ensaio**, não o eixo `package-size` de relatório algum. Nenhuma campanha rodou, nenhuma janela foi apresentada e nenhum tempo daqui é medida de um braço. Nada aqui diz que o HUD React Native é maior, menor ou igual ao nativo.
> Esta fatia entrega os exports e o ensaio do critério `execucao` do V05-10 e **não fecha critério algum**; não move checkpoint, nota, peso nem denominador do 1.0.

O comparativo precisa de `.app` Release dos três braços e da sonda do instrumento, cada um com o manifesto que o lançador Release lê. Esta pasta registra o primeiro conjunto real deles, a prova de que o conjunto de arquivos de cada braço está completo
(o jogo conta o mesmo no `.app` e no Debug) e um ensaio headless da campanha sobre eles. A [nota de pesquisa](../../research/frontier-comparison-entry.md#the-measurement-exports) tem o raciocínio, e a [nota da execução](../../research/frontier-comparison-execution.md) tem o lançador.

## Registro fixado

- **Código:** o commit [`d88684c`](https://github.com/journey-studios/godot-fabric/commit/d88684cb910df2420a6adf6308d0a8f85a50eb7b), com [`scripts/frontier-comparison-measurement-export.mjs`](../../../scripts/frontier-comparison-measurement-export.mjs) (o script de export),
  os conjuntos de arquivos em [`scripts/frontier-comparison-arms.mjs`](../../../scripts/frontier-comparison-arms.mjs), o modo de ensaio do [lançador Release](../../../scripts/frontier-comparison-campaign-launchers.mjs) e os testes
  [Node](../../../tests/frontier-comparison-measurement-export.test.mjs) e [nativo](../../../tests/frontier-comparison-measurement-export-native.test.mjs).
- **A árvore dos exports e do lane nativo não estava commitada.** Eles rodaram na worktree do slot 3 (base `d60df52`, a `main` com o #145), com as mudanças que viraram o `d88684c` ainda no working tree. O `exportPreparedProject` não exige árvore limpa (essa checagem é do `runMacOSExport`), e **os exports da
  campanha serão refeitos pelo mesmo script a partir da árvore commitada**. Entre o lane e o commit mudaram, sem tocar no conteúdo dos exports: o texto do desvio de ensaio em `campaign-state.mjs` (com seu teste), um `export` a menos no script, a limpeza do `.app` parcial quando um export falha, comentários e a documentação.
  Por isso a linha "a rehearsal does not redo" em [`native-summary.json`](native-summary.json) ainda diz "(the Debug build, the headless display, the load of a busy machine)"; no `d88684c` o ensaio Release headless diz "(the headless display, the load of a busy machine)".
- **Máquina e motor:** o Mac arm64 do slot 3, Godot `4.7.2.stable.official.ed1daf0bf`, o template derivado `macos-arm64-template.zip` (SHA-256 `ec98b2803f5243ea4bc62d61429c12c43b9bec59f855040f713d74307b4c17e6`, o mesmo que a fatia das [opções do export](../macos-export-options/README.md) usou).
  Assinatura ad hoc (`exportPreparedProject` a verifica). Sem Developer ID, sem notarização, sem segundo Mac.
- **Nenhum `.app` está no repositório:** os quatro foram apagados ao fim do lane nativo, e os exports de produto, logo depois de medidos. O disco desta máquina é pequeno (o script recusa um export com menos de 600 MB livres).

Os manifestos (`<braço>/frontier-comparison-export.json`, no formato `godot-fabric.frontier-comparison-export/v1`) registram:

| | executável (SHA-256) | pacote `.pck` (SHA-256) | roteiro (SHA-256) |
| --- | --- | --- | --- |
| A | `123ab4fc3e2d145b…` | `75ff4f9e106916f5…` | `40b56bf258435e3b…` |
| B | `66b3fdf7ba4563e4…` | `dad82fe1e944fc1e…` | `40b56bf258435e3b…` |
| C | `8c0c9996d275a89c…` | `385806d490195813…` | `40b56bf258435e3b…` |
| sonda | `56ccdc61aebb64fe…` | `2cf534b45e604a78…` | `28abaf06d96325b2…` |

O hash do roteiro é o mesmo nos três braços e é o do ensaio de entrada (`40b56bf2…`, [registro da entrada](../frontier-comparison-entry/README.md)): os arquivos do roteiro não mudaram. O SHA-256 do `.pck` **muda de um export para outro** com os mesmos arquivos (visto no produto de A em duas execuções); o que vale para uma campanha é o
que o manifesto do export dela registra, e o lançador confere o executável e o `.pck` de novo antes de cada processo.

## Os conjuntos de arquivos por braço

Cada braço exporta com o filtro `"scenes"`: a cena do braço (`exportFiles`; a medição soma a cena vazia) e o que os **arquivos de cena** referenciam. O Godot 4.7.2 não segue os `preload()` e os `extends "res://…"` dos scripts, e ignora, sem aviso, as entradas de `exportFiles` que não são cenas
(o [achado](../macos-export-options/README.md#o-achado-do-preload) da fatia anterior). O que as cenas carregam por caminho entra pelo `includeFilter`. A medição soma ainda `comparison/*, override.cfg` (o roteiro, a entrada e o `override.cfg`, que vai dentro do `.pck`). `frameworks` é `false` em A e B e `true` em C.
Os conjuntos **não foram escritos de cabeça**: os marcados *falhou* foram achados porque o braço falhou sem eles.

| braço | `exportFiles` | `includeFilter` do produto |
| --- | --- | --- |
| A | `res://main_bare.tscn` | `game/*.gd, services/*.gd` |
| B | `res://main_native.tscn` | `game/*.gd, services/*.gd, native_hud/*, hud_*.gd, ui/icons/*` |
| C | `res://main.tscn` | `game/*.gd, services/*.gd, hud_*.gd, stability_*.gd, addons/godot_fabric/*.gdextension, addons/godot_fabric/assets/fonts/*.ttf` |

| padrão | braço | por que está lá |
| --- | --- | --- |
| `game/*.gd` | A, B, C | as regras do jogo: `game_services.gd` e `world.gd`, que as cenas anexam, fazem `preload` delas, e um arquivo de cena não nomeia os `preload` de um script |
| `services/*.gd` | A, B, C | `schema.gd` e `stress.gd`, que o `game_services.gd` pré-carrega |
| `native_hud/*` | B | o HUD: o `hud.gd` pré-carrega os painéis (`.tscn`), o kit e os ícones, e a cena do HUD só anexa o `hud.gd` |
| `ui/icons/*` | B | o `native_hud/icons.gd` pré-carrega os seis PNG |
| `hud_*.gd` | B, C | a cena anexa o `hud_validation.gd`, que faz `extends "res://hud_probe.gd"` por caminho, e esse pré-carrega os leitores (`hud_reader*.gd`); também traz o `hud_stats.gd` para B, que só a cena de C anexa (padrão largo de propósito) |
| `stability_*.gd` | C | a cena anexa o `stability_validation.gd`, que faz `extends "res://stability_judge.gd"` por caminho |
| `addons/godot_fabric/*.gdextension` | C | *falhou:* nenhuma cena referencia o manifesto da extensão; sem ele o export não copiou o host (`ENOENT Contents/Frameworks/fabric_godot.dylib`) e o motor não carrega extensão alguma |
| `addons/godot_fabric/assets/fonts/*.ttf` | C | *falhou:* o host carrega as fontes por caminho; sem elas C rodou até o fim, com exit 0, e o log ficou cheio de `Godot font asset is unavailable: NotoSans` |
| `hud_*.gd` (só a medição) | A | *falhou:* o ajudante de HUD do roteiro pré-carrega `res://hud_probe.gd` em todo braço; sem ele o `.app` de A deu erro de parse e saiu com exit 2, sem relatório |

C não precisa de mais nada de `ui/` nem do addon: `ui/application.tres` e os três scripts de runtime do addon são referências de cena, e o hook de export do addon põe o bundle JS e os ativos no pacote, seja qual for o filtro. O `.app` de C tem o host e os dois frameworks; os de A, B e da sonda têm `Contents/Frameworks` vazio.
As cenas de B e C anexam os `validation.gd` do próprio consumidor, então o produto desses braços os carrega: o pacote é a cena do produto como ela é.

**O produto nunca viu os arquivos de medição.** O script exporta a medição primeiro, tira `comparison/` e `override.cfg` da cópia, importa de novo (o cache de classes globais deixa de citar `FrontierComparisonEntry`, e o script confere) e só então exporta o produto, duas vezes.

## Os tamanhos de produto (medidas de um ensaio, não o eixo do relatório)

O eixo `package-size` lê `packages.<braço>.exportBytes`, que é o `exportBytes` do manifesto: os bytes do **`.app` inteiro** do produto (todo arquivo regular do bundle; links não contam), num export e na repetição. O `.pck` sozinho não preçaria o HUD: os frameworks do React Native de C ficam em
`Contents/Frameworks`, fora do `.pck`, e `frameworks: false` em A e B não mudaria nada no eixo. O tamanho do `.pck` fica registrado ao lado.

| braço | `.app` do produto, export 1 e 2 (bytes) | `.pck` do produto (bytes) | arquivos no `.pck` | `.app` de medição (bytes) | `.pck` de medição (bytes) |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 82.572.095 e 82.572.095 | 60.020 | 37 | 82.657.715 | 145.640 (82 arquivos) |
| B | 82.683.063 e 82.683.063 | 170.988 | 122 | 82.730.835 | 218.760 (155 arquivos) |
| C | 106.682.110 e 106.682.110 | 2.828.488 | 81 | 106.729.866 | 2.876.244 (114 arquivos) |
| sonda (um export) | 82.533.072 | 20.908 | 12 | igual | igual |

B − A = 110.968 bytes (todo de pacote: os dois não têm framework); C − A = 24.110.015 bytes (2.768.468 de pacote, o resto é o host e os dois frameworks). Os dois exports de cada braço têm o mesmo tamanho e a mesma lista de arquivos (as listas estão em [`export-summary.json`](export-summary.json));
o SHA-256 do `.pck` é igual nos dois de uma execução e muda de uma execução para outra com os mesmos arquivos, então nenhum teste o fixa. A sonda não tem repetição e nenhum eixo a lê: o `exportBytes` dela é o tamanho duas vezes.

## As contagens por braço, Release contra Debug

Cada `.app` de medição rodou o roteiro inteiro, headless, pela faixa apresentada: `Contents/MacOS/Frontier --headless -- --arm=<braço> --lane=presented --out=<arquivo>`, a partir de uma pasta fora do `.app` (51,8 s, 57,1 s e 74,8 s; 7.449, 8.042 e 8.168 quadros). Exit 0, nenhum erro de script, **nenhuma linha `ERROR` do log**,
sem anomalia nem aborto. As contagens foram comparadas com duas coisas: o [ensaio Debug de entrada](../frontier-comparison-entry/README.md) (`comparison.json`, pinado no commit da entrada) e um **controle**, um run Debug **desta árvore** no mesmo lane, braço por braço.
**Os tempos não se comparam**; só se compara o que o roteiro conta.

| contagem | A | B | C |
| --- | --- | --- | --- |
| `scene-nodes`: Release / controle Debug / registro de entrada | 4 / 4 / 4 | 31 / 31 / 31 | **31 / 31 / 30** |
| hash dourado do replay (77 passos), os três | `cb7ab974…` | `cb7ab974…` | `cb7ab974…` |
| hash final do soak (100 turnos, 429 decisões, 0 recusas), os três | `0b21c332…` | `0b21c332…` | `0b21c332…` |
| ocorrências de `ai-phase`, `event-burst`, `context-switches`, `stress` | 100, 100, 74, 32 | idem | idem |
| quadros dessas quatro janelas | 500, 500, 222, 736 | idem | idem |
| paridade | nenhuma (A não tem HUD) | 93, todas casam | 93, todas casam |
| notificações emitidas / consumidas | 2256 / sem consumidor | 2306 / 2306 | 2307 / 2307 |
| quadros de repouso, trocas de contexto, rodadas do estresse, cliques da latência | 600, 74, 32, 0 | 600, 74, 32, 30 | 600, 74, 32, 30 |

Release e controle Debug são **iguais em todos os campos**, nos três braços (o teste compara o hash de cada turno do soak, o traço por tipo, os contadores e as janelas inteiras; a tabela guarda as linhas principais). Contra o registro de entrada também é igual em todo campo que o registro tem, **menos um**:

- **O `scene-nodes` de C é 31, e o registro diz 30.** Não é um conjunto incompleto nem uma diferença entre Debug e Release: o `main.tscn` ganhou um nó (`ReplayValidation`) no #135, depois que o registro foi feito, e o run Debug desta árvore também lê 31 em C. O registro não foi editado; o teste fixa a exceção (`{C: {sceneNodes: 30}}`).

## O ensaio pelo lançador Release

`node scripts/frontier-comparison-campaign.mjs --campaign --lanes presented --build release --exports <pasta> --rehearsal --slots 1-3 --assume-refresh-hz 60 --max-wait 0 --out <pasta>`. O lançador roda em modo de ensaio (`windowed: false`: `--headless`; `rehearsalOnly`; um desvio que diz que o ensaio roda headless), e o `runCampaign` o recusa sem `--rehearsal`.

- **O autoteste do instrumento passou pela sonda exportada**, headless (`entry: "release"`, 20,3 s, as 10 checagens e o oráculo), com o `tests/cpu-time-instrument.gd` do repositório.
- **As três tentativas** (uma vaga de cada braço, sem refazer nada) foram **rejeitadas pela análise, como um ensaio deve mostrar**:

| vaga | braço | segundos | carga antes → depois | motivos da rejeição |
| --- | --- | ---: | --- | --- |
| 1 | A | 52,1 | 5,77 → 6,7 | `load:before`, `load:after`, `not-presented:intent-not-drawn`, `not-presented:idle-not-drawn`, `not-presented:not-paced` |
| 2 | B | 56,6 | 6,7 → 5,87 | os mesmos |
| 3 | C | 74,6 | 5,87 → 5,16 | os mesmos |

  A carga e o `not-presented` são o que uma máquina ocupada e um display headless (que não desenha nem dá ritmo) devem mostrar. **Nenhum `not-the-registered-build`** (o build agora é Release, e os hashes são os dos manifestos) e **nenhum `errors`**; sem problema da análise, sem anomalia, e o jogo com as mesmas contagens
  do run de prova. A análise termina `incomplete`, como a do ensaio Debug. A campanha registrou os hashes e os tamanhos dos manifestos.

## A sensibilidade do autoteste à carga

Rodando o autoteste pela sonda exportada à mão quatro vezes, com a carga em 5 a 6, **uma falhou**: a checagem de que o termo de processo muda de quadro a quadro (18 valores, uma sequência de 12 quadros iguais, onde o oráculo aceita no máximo 10). As outras três, a do lane e a do ensaio passaram.
É o portão funcionando numa máquina ocupada, como o do Debug; para uma campanha a máquina tem de estar quieta. O teste nativo exige que o autoteste passe, então pode oscilar numa máquina ocupada.

## O que há nesta pasta

| Arquivo | Bytes | O que é |
| --- | ---: | --- |
| [`A/frontier-comparison-export.json`](A/frontier-comparison-export.json) | 1.972 | o manifesto de A, como o script o gravou |
| [`B/frontier-comparison-export.json`](B/frontier-comparison-export.json) | 1.972 | o de B |
| [`C/frontier-comparison-export.json`](C/frontier-comparison-export.json) | 1.974 | o de C |
| [`probe/frontier-comparison-export.json`](probe/frontier-comparison-export.json) | 1.358 | o da sonda (`arm: "probe"`) |
| [`export-summary.json`](export-summary.json) | 53.392 | por braço: os conjuntos, o export de medição e os dois de produto (tamanhos, número e lista de arquivos do `.pck`) e o manifesto; o mesmo para a sonda |
| [`native-summary.json`](native-summary.json) | 11.220 | o resumo do lane nativo: os conjuntos, os tamanhos, o tempo e os campos que diferem do registro, o controle Debug, o autoteste direto e o ensaio (tentativas, motivos, desvios) |

Nenhum `.app` e nenhum relatório bruto (os de prova têm ~0,3 MB cada) foram guardados. Os arquivos são os que a máquina escreveu, copiados sem editar (`native-summary.json` é o `native-report.json` do lane; o nome `*-report.json` é ignorado pelo git). Nenhum tem caminho local: a varredura da publicação confere.

## O que falta

- **A janela quieta.** Nada daqui rodou numa máquina quieta nem numa janela: a carga ficou em 5 a 7 e nenhuma execução foi apresentada.
- **O autoteste janelado**, rodado de verdade na máquina da campanha (a sonda com `--windowed`, uma janela na frente, o usuário fora). O desta pasta é headless.
- **A campanha real**, com os exports refeitos pelo script a partir de uma árvore commitada na máquina da campanha, e as 72 execuções.

## Reprodução

```sh
node --test tests/frontier-comparison-measurement-export.test.mjs tests/frontier-comparison-arms.test.mjs tests/frontier-comparison-release.test.mjs   # Node: os conjuntos, o script com um export falso, os manifestos, o lançador headless
MACOS_EXPORT_TEMPLATE="$PWD/build/macos-arm64-template.zip" npm run test:frontier-comparison-exports                                             # nativo, headless: ~13 min, um .app de produto por vez
node scripts/frontier-comparison-measurement-export.mjs --out build/frontier-comparison-measurement-exports --template build/macos-arm64-template.zip
```

O lane nativo grava `export-summary.json` e `native-report.json` em `build/frontier-comparison-measurement-exports/` e apaga os quatro `.app` ao fim.

## CI hospedada e Pages

**O run.** O push da `main` em `86703c5` (o squash do #148; run [38086564677](https://github.com/journey-studios/godot-fabric/actions/runs/38086564677) do workflow Contracts, iniciado às 21:09:57 UTC) passou na primeira tentativa, sem reexecução, nos três jobs que um push roda desde o #88: `contracts` (3 min 38 s), `reference-android` (6 min 16 s) e `reference-ios` (8 min 40 s), todos com checkout em `86703c5`. Os cinco jobs nativos opt-in (`native-cold-start`, os três `native-suites-*` e `parity-comparison`) e o `macos-clean-run` aparecem como **skipped**; o [recibo](hosted-ci.json) os registra assim e só os aceita porque a fatia não tem passo nativo nem artefato. A cabeça da PR (`71e37d9`) tem a mesma árvore que o squash (`9e86502`), e o recibo confere isso.

**O passo da guarda.** "Milestone exit guards (X9 and X10)" passou e imprimiu `MILESTONE_GUARDS_CHECK_PASSED: against 4767cd1 (--base 4767cd1f682dcbe540fa444b9af14f27790db6a1); X9 clean, X10 clean`. A base é o pai do squash.

**Os testes.** `npm run test:contracts` rodou com 7, 43 e 736 testes de Node: os blocos de 7 e 43 passaram todos; no de 736, 735 passaram e 1 saiu como skipped pela allowlist do check (`ALLOWED_SKIPS`): "native macOS arm64 export and copied-app rejection controls", o teste de export macOS do #75, com o motivo "MACOS_EXPORT_TEMPLATE is unset; native export requires the reviewed Godot arm64 Release template". Os 37 testes de Python passaram, e o inventário de paridade confirmou 8.113 contratos e 97 valores públicos. `check:static` e `check:publication` também passaram (2.407 arquivos). O recibo confere, pelo nome e no log do job `contracts`, os 25 testes dos três arquivos desta fatia, todos passados: 6 de [`tests/frontier-comparison-measurement-export.test.mjs`](../../../tests/frontier-comparison-measurement-export.test.mjs), 11 de [`tests/frontier-comparison-arms.test.mjs`](../../../tests/frontier-comparison-arms.test.mjs) e 8 de [`tests/frontier-comparison-campaign-state.test.mjs`](../../../tests/frontier-comparison-campaign-state.test.mjs). O teste nativo (`test:frontier-comparison-exports`) roda só localmente.

**O Pages.** O push de `86703c5` rodou também o workflow do Pages (run [38086564656](https://github.com/journey-studios/godot-fabric/actions/runs/38086564656), de 21:09:57 a 21:10:40 UTC, `build` e `deploy` em success, 43 testes do painel). O [recibo](publication.json) registra o deployment 6986915114 em success e o artefato `github-pages` que ele usou (id 11682707640, 1.495.644 bytes, SHA-256 `882ebd85…`, igual ao digest da API e ao do log de upload). O `migration.json` de dentro tem os mesmos bytes do commitado (SHA-256 `6d877b6b…`), com as 292 entradas de atividade que a `main` tem nesse commit. A única que o squash acrescentou em relação à `4767cd1` (291 entradas) é a desta fatia, `milestone-0-5-v05-10-measurement-exports-3cddd82`, e o [recibo](publication.json) confere que ela está no arquivo publicado (`presentInDeployedJson: true`). Um push seguinte da `main` substitui o deployment, então o site público não foi comparado.

**O que continua só local:** os quatro `.app` deste lane e o teste nativo (`test:frontier-comparison-exports`) rodam só localmente, com o template Release. A CI não exporta nada nesta fatia; os recibos provam os testes de contrato, a guarda e a publicação, não um export.

O `--work-dir` abaixo é um exemplo: qualquer diretório fora do repositório serve.

```sh
node scripts/hosted-receipts.mjs --write --slice frontier-comparison-measurement-exports --work-dir <diretório fora do repositório>
node scripts/hosted-receipts.mjs --check
```
