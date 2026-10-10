# Os projetos dos braços da comparação (V05-10): A e B sem a extensão Fabric

> **É UMA VERIFICAÇÃO DOS PROJETOS. NENHUM NÚMERO DESTA PASTA É RESULTADO.** O roteiro rodou **uma vez em cada braço, em cada rodada**, num build **Debug**, num display **headless**, numa **única cópia provisionada** do civ-lite: primeiro com a extensão Fabric, depois sem ela.
> As contagens e os hashes das duas rodadas são comparados; **os tempos não se comparam**. Nenhuma campanha rodou e **nada foi exportado**.
> Nada aqui diz que o HUD React Native é mais rápido, mais lento ou igual ao nativo, nem fixa o preço de um HUD em tamanho de pacote. Esta fatia entrega os **projetos** dos braços para o critério `execucao` do V05-10 e **não fecha nenhum critério**; não move checkpoint, nota, peso nem denominador do 1.0.

Os braços A (sem HUD, `main_bare.tscn`) e B (HUD nativa em GDScript, `main_native.tscn`) **não levam a extensão Fabric**: ficam de fora `addons/godot_fabric` (o addon, o `.gdextension`, o host e os frameworks Hermes e React Native). Só C (`main.tscn`) a leva. O protocolo lê o preço de cada HUD em tamanho de pacote como C−A e B−A, e a carga da extensão também entraria nas medidas de execução de A e B. A decisão, o porquê e a leitura dos filtros estão na [nota de pesquisa](../../research/frontier-comparison-entry.md#the-projects-of-the-arms).

## O que mudou

- [`scripts/frontier-comparison-arms.mjs`](https://github.com/journey-studios/godot-fabric/blob/769145dd8acf0fa522548c4dbb4c232c049a6776/scripts/frontier-comparison-arms.mjs): `armProject(arm)`, pura, descreve o projeto de cada braço (a cena principal de produto, se leva a extensão e os filtros de export do produto e da medição); `shapeArmProject(directory, arm, { measurement })` aplica a descrição a uma cópia provisionada e devolve o que mudou. Um braço desconhecido é recusado.
- [`tests/frontier-comparison-arms.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/769145dd8acf0fa522548c4dbb4c232c049a6776/tests/frontier-comparison-arms.test.mjs): 10 testes Node, entre eles a edição do `project.godot` real do civ-lite (as duas seções saem, o resto fica byte a byte igual, a cena é escrita) e os filtros.
- [`tests/frontier-comparison-arms-native.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/769145dd8acf0fa522548c4dbb4c232c049a6776/tests/frontier-comparison-arms-native.test.mjs): 8 testes nativos, `npm run test:frontier-comparison-arms`. Provisiona **uma** cópia e roda, nesta ordem: A e B com a extensão; o shape de A sem ela, com os arquivos de medição; o `--import` do editor; A; o shape de B; B. Ao fim roda C na mesma cópia, como controle.

## Registro fixado

O código e os testes estão no commit [`769145d`](https://github.com/journey-studios/godot-fabric/commit/769145dd8acf0fa522548c4dbb4c232c049a6776). A rodada nativa desta pasta foi feita na árvore que esse commit guarda (nenhum arquivo do código mudou depois dela), no motor Godot 4.7.2-stable (`ed1daf0bf`), Debug, headless, em macOS arm64, faixa apresentada, com a taxa de atualização assumida de 60 Hz para o formato (o display headless lê −1), como nos ensaios anteriores.

### Os filtros dos projetos

Escritos como o `export_presets.cfg` escreve `include_filter` e `exclude_filter` (globs relativos a `res://`, separados por vírgula). Os padrões da medição vêm dos arquivos que o executor escreve na cópia (`MEASUREMENT_FILES`).

| Projeto | `include_filter` | `exclude_filter` |
| --- | --- | --- |
| produto, A e B | (vazio) | `comparison/*, override.cfg, addons/godot_fabric/*` |
| produto, C | (vazio) | `comparison/*, override.cfg` |
| medição, A e B | `comparison/*, override.cfg` | `addons/godot_fabric/*` |
| medição, C | `comparison/*, override.cfg` | (vazio) |

### O que o shape tira da cópia, em A e B

| O quê | Como |
| --- | --- |
| `addons/godot_fabric` | a pasta inteira (o addon, o `.gdextension`, o host e os frameworks) |
| `[editor_plugins]` e `[godot_fabric]` do `project.godot` | as duas seções, editadas por linhas; no `project.godot` real do civ-lite o resto fica byte a byte igual, e o arquivo termina onde termina a última seção mantida |
| `.godot/extension_list.cfg` | a lista de extensões que o editor guarda; o import a regenera (aqui, sem nenhuma extensão, ela fica ausente) |
| `.godot_fabric/` | a saída do build do HUD de C (`app.js`, `app.js.assets.json`, seis ícones e `build-report.json`, 9 arquivos) |

Em todos os braços o shape escreve o `run/main_scene` de produto. Com `measurement`, escreve também os `MEASUREMENT_FILES`, cujo `override.cfg` sobrepõe a cena e o main loop. O resto de `.godot` (o cache do próprio motor) fica. O que o shape de A mudou na cópia, no teste: `removedAddon: true`, `removedArtifacts: [".godot/extension_list.cfg", ".godot_fabric"]`, seções `editor_plugins` e `godot_fabric`; o de B, que vem depois na mesma cópia, não tinha mais o que remover.

## As contagens com e sem a extensão

Mesma cópia, headless, faixa apresentada. Cada coluna é uma execução do roteiro inteiro pelo main loop do projeto de medição. O teste compara **tudo** que o roteiro conta (incluindo o hash de cada um dos 100 turnos do soak) e dá `sameCounts: true` nos dois braços; a tabela mostra as linhas principais.

| | A com | A sem | B com | B sem |
| --- | --- | --- | --- | --- |
| processo: código de saída, erros de script, erros do log | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 |
| `scene-nodes` | 4 | 4 | 31 | 31 |
| hash dourado do replay (77 passos, nenhuma divergência) | `cb7ab974f47f18c3…` | `cb7ab974f47f18c3…` | `cb7ab974f47f18c3…` | `cb7ab974f47f18c3…` |
| hash final do soak (100 turnos, 429 decisões, 0 recusas) | `0b21c332c1f86fb4…` | `0b21c332c1f86fb4…` | `0b21c332c1f86fb4…` | `0b21c332c1f86fb4…` |
| hash do rastro do soak | `4d6d3c4c1078518f…` | `4d6d3c4c1078518f…` | `4d6d3c4c1078518f…` | `4d6d3c4c1078518f…` |
| ocorrências de `ai-phase`, `event-burst`, `context-switches`, `stress` | 100, 100, 74, 32 | 100, 100, 74, 32 | 100, 100, 74, 32 | 100, 100, 74, 32 |
| dessas, medidas (sem aquecimento) | 98, 98, 50, 30 | 98, 98, 50, 30 | 98, 98, 50, 30 | 98, 98, 50, 30 |
| quadros das quatro janelas | 500, 500, 222, 736 | 500, 500, 222, 736 | 500, 500, 222, 736 | 500, 500, 222, 736 |
| quadros de repouso, trocas de contexto, rodadas do estresse | 600, 74, 32 | 600, 74, 32 | 600, 74, 32 | 600, 74, 32 |
| notificações emitidas / consumidas | 2256 / sem consumidor (−1) | 2256 / sem consumidor (−1) | 2306 / 2306 | 2306 / 2306 |
| checagens de paridade | nenhuma: A não tem HUD | nenhuma | 93, todas casam, nos 7 contextos | 93, todas casam, nos 7 contextos |
| `sameCounts` (a comparação inteira) | | `true` | | `true` |

O rastro por tipo é o mesmo nas quatro colunas: `context-switch` 74, `end-turn-accepted` 100, `events-settled` 100, `stress-begin` 32, `stress-step` 640, `turn-ended` 100. Os `scene-nodes` de A (4) e de B (31) são os do [registro da entrada](../frontier-comparison-entry/README.md). A paridade de A sai `checked: 0, matches: false` no relatório do roteiro porque não há HUD a checar.

Os logs de A e de B sem a extensão têm três linhas: a faixa do motor, uma linha vazia e a linha que encerra o roteiro (`FRONTIER_COMPARISON_SCENARIO_DONE: arm <A|B>, lane presented, <n> frames`). Nenhuma cita `godot_fabric`, `GDExtension` ou Fabric.

## O log do import: nenhuma linha sobre a extensão

O `--import` do editor depois do shape de A (código de saída 0), sem as cores do terminal. A única linha com "GDExtensions" é o rótulo do editor para o passo que confere as extensões de **qualquer** projeto; nenhuma cita o addon, o `.gdextension` ou uma classe Fabric. O teste exige zero linhas do import que citem a extensão, fora esse rótulo.

```text
Godot Engine v4.7.2.stable.official.ed1daf0bf - https://godotengine.org

[   0% ] first_scan_filesystem | Started Inicialização do Projeto (5 steps)
[   0% ] first_scan_filesystem | Escaneando estrutura de arquivos...
[  16% ] first_scan_filesystem | Carregando nomes de classe globais...
[  33% ] first_scan_filesystem | Verificando GDExtensions...
[  50% ] first_scan_filesystem | Criando scripts autoload...
[  66% ] first_scan_filesystem | Inicializando plugins...
[  83% ] first_scan_filesystem | Iniciando escaneamento de arquivos...
[ DONE ] first_scan_filesystem

[   0% ] loading_editor_layout | Started Carregando editor (5 steps)
[   0% ] loading_editor_layout | Carregando layout do editor...
[  16% ] loading_editor_layout | Carregando abas...
[ DONE ] loading_editor_layout
```

Depois do import, `addons/godot_fabric` não existe na cópia, nenhum `.gdextension` está nela, nenhum caminho dela cita `godot_fabric` (a pasta oculta `.godot_fabric/` inclusive) e `.godot/extension_list.cfg` está **ausente**.

**Por que o shape remove a lista.** Uma primeira versão da verificação não removia `.godot/extension_list.cfg`. A cópia tinha carregado a extensão antes do shape, a lista ainda a nomeava, e o import saía com código 0 mas com três linhas `ERROR` (e os lugares do motor onde ocorreram) sobre `res://addons/godot_fabric/fabric.gdextension`: `Error loading GDExtension configuration file`, `GDExtension dynamic library not found` e `Error loading extension`. É um vestígio de dar o shape numa cópia **no lugar**; o shape agora remove a lista e o log acima é o que sobra.

## O controle: o braço C não roda sem a extensão

Para mostrar que as verificações acima podem falhar, o teste roda C, cuja cena precisa da extensão, **na mesma cópia, depois do shape de A e de B**. Resultado: código de saída 1, 202 erros de script, 14 erros do log, 12 linhas que citam Fabric. As 12, sem as cores do terminal:

```text
ERROR: Attempt to open script 'res://addons/godot_fabric/godot_fabric.gd' resulted in error 'File not found'.
ERROR: Failed loading resource: res://addons/godot_fabric/godot_fabric.gd.
ERROR: Attempt to open script 'res://addons/godot_fabric/application_node.gd' resulted in error 'File not found'.
ERROR: Failed loading resource: res://addons/godot_fabric/application_node.gd.
ERROR: Attempt to open script 'res://addons/godot_fabric/application_resource.gd' resulted in error 'File not found'.
ERROR: Failed loading resource: res://addons/godot_fabric/application_resource.gd.
ERROR: res://ui/application.tres:6 - Parse Error: [ext_resource] referenced non-existent resource at: res://addons/godot_fabric/application_resource.gd.
ERROR: res://ui/application.tres:6 - Parse Error: [ext_resource] referenced non-existent resource at: res://addons/godot_fabric/application_resource.gd.
ERROR: res://main.tscn:16 - Parse Error: [ext_resource] referenced non-existent resource at: res://addons/godot_fabric/godot_fabric.gd.
ERROR: res://main.tscn:20 - Parse Error: [ext_resource] referenced non-existent resource at: res://addons/godot_fabric/application_node.gd.
ERROR: Cannot get class 'FabricSurface'.
WARNING: Node HUD of type FabricSurface cannot be created. A placeholder will be created instead.
```

O log de C tem mais linhas além dessas 12 (as que não citam Fabric); elas não foram guardadas, só a contagem e o código de saída (em `summary.json`, `control`). O que o controle mostra: a verificação "nenhuma linha cita a extensão" falha quando há dependência de verdade, e A e B, que saem limpos, **não dependem da extensão em tempo de parse**: o jogo, os serviços e a HUD de B carregam sem ela.

## O que há nesta pasta

| Arquivo | Bytes | O que é |
| --- | ---: | --- |
| [`summary.json`](summary.json) | 8.534 | o resumo que o teste nativo escreve (`build/frontier-comparison-arms-report.json`), copiado sem editar: a marca `notAResult`, por braço a cena principal, o processo e as contagens com e sem a extensão e `sameCounts`, a lista de extensões depois do import (`absent`), os artefatos removidos, as linhas do import que citam a extensão (0) e o controle de C. Sem caminho local. |

Não commitados: os logs de cada processo e os relatórios brutos do roteiro (cerca de 270 KB cada), que o teste regera. O teste apaga a cópia provisionada ao terminar.

## Verificações

| Verificação | Resultado | Observação |
| --- | --- | --- |
| `node --test tests/frontier-comparison-arms.test.mjs tests/frontier-comparison-run.test.mjs` | 32 testes, verdes | 10 do `frontier-comparison-arms.test.mjs` |
| `npm run test:frontier-comparison-arms` (nativo, headless, Debug) | 8 testes, verdes, cerca de 269 s | a duração é a do teste, não de um braço |
| `npm run test:contracts` | verde: 638 aprovados, 1 pulado | o pulado é o do #75, aceito por lista explícita; nenhum `.skip` novo |
| `npm run test:dashboard` | 43 testes, verdes | |
| `npm run type-check`, `npm run check:static`, `npm run check:publication` | verdes | |
| `node scripts/milestone-guards.mjs --check --base origin/main` | passou | |

## O que este registro não mostra

- **O export.** Nada foi exportado. A função de export do V05-07 (`scripts/macos-export.mjs`) recebe um diretório de projeto já preparado, mas a assinatura dela ainda não está publicada e nada aqui a chama. Faltam essa função sobre os três diretórios, o manifesto `frontier-comparison-export.json` e o lançador Release ([o que falta](../../research/frontier-comparison-execution.md#what-is-missing-for-the-campaign)).
- **Os conjuntos de arquivos por braço.** Os filtros acima são os da decisão e não tiram de A e B o `main.tscn`, o `ui/application.tres` (que referenciam o addon removido e falham ao carregar, como o controle mostra) nem os recursos do HUD do outro braço (`ui/`, `native_hud/`). Com `export_filter="all_resources"`, o que cada braço leva num export depende do que o export seleciona; não foi tentado aqui, e é o próximo passo.
- **O tamanho do pacote** dos três braços, e portanto C−A e B−A: não foram medidos.
- **Uma campanha.** Esta rodada é Debug, headless, uma cópia, uma execução por braço e por rodada. Os tempos não foram comparados e nenhum número é medida de um braço.
- Os recibos hospedados (CI e Pages) desta entrega estão na seção [CI hospedada e Pages](#ci-hospedada-e-pages): provam o código e os testes dos projetos, não uma execução comparativa.

## CI hospedada e Pages

**O run.** O push da `main` em `2d2ba46` (o squash do #138; run [38071259582](https://github.com/journey-studios/godot-fabric/actions/runs/38071259582) do workflow Contracts, iniciado às 17:19:29 UTC) passou na primeira tentativa, sem reexecução, nos três jobs que um push roda desde o #88: `contracts` (3 min 21 s), `reference-android` (6 min 28 s) e `reference-ios` (6 min 55 s), todos com checkout em `2d2ba46`. Os cinco jobs nativos aparecem como **skipped**; o [recibo](hosted-ci.json) os registra assim e só os aceita porque a fatia não tem passo nativo nem artefato. A cabeça da PR (`d9985f4`) tem outra árvore que o squash: a `main` mudou 9 caminhos entre a bifurcação e o squash, e o recibo lista esses caminhos e confere que a `main` os tocou depois da bifurcação.

**O passo da guarda.** "Milestone exit guards (X9 and X10)" passou e imprimiu `MILESTONE_GUARDS_CHECK_PASSED: against 28edbbce7cb7 (--base 28edbbce7cb7e25af9e8163511943ab7556820ba); X9 clean, X10 clean`. A base é o pai do squash.

**Os testes.** `npm run test:contracts` rodou com 7, 43 e 656 testes de Node: os blocos de 7 e 43 passaram todos; no de 656, 655 passaram e 1 saiu como skipped pela allowlist do check (`ALLOWED_SKIPS`): "native macOS arm64 export and copied-app rejection controls", o teste de export macOS do #75, com o motivo "MACOS_EXPORT_TEMPLATE is unset; native export requires the reviewed Godot arm64 Release template". O recibo confere, pelo nome e no log do job `contracts`, os 10 testes de `tests/frontier-comparison-arms.test.mjs` (10 de 10). Os 23 testes de Python passaram. `check:static` e `check:publication` também passaram (2.353 arquivos). O teste nativo (`test:frontier-comparison-arms`) roda só localmente, e por isso não está no recibo.

**O Pages.** O push de `2d2ba46` rodou também o workflow do Pages (run [38071259623](https://github.com/journey-studios/godot-fabric/actions/runs/38071259623), de 17:19:29 a 17:20:05 UTC, `build` e `deploy` em success, 43 testes do painel). O [recibo](publication.json) registra o deployment 6984221530 em success e o artefato `github-pages` que ele usou (id 11676434340, SHA-256 `2cd8c473…`, igual ao digest da API e ao do log de upload). O `migration.json` de dentro tem os mesmos bytes do commitado, e a entrada de atividade desta fatia, `milestone-0-5-v05-10-arm-projects-85d2c99`, está nele. Esse push não tem a entrada do #136 (`milestone-0-5-v05-10-release-launcher-29e379f`), que entrou depois, em `e4730cb`. Um push seguinte da `main` substitui o deployment, então o site público não foi comparado.

**O que continua só local:** a fatia não mede nenhum braço, e os recibos provam os projetos e seus testes, não uma execução comparativa.

O `--work-dir` abaixo é um exemplo: qualquer diretório fora do repositório serve.

```sh
node scripts/hosted-receipts.mjs --write --slice frontier-comparison-arms --work-dir <diretório fora do repositório>
node scripts/hosted-receipts.mjs --check
```
