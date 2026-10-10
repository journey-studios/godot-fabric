# O script de análise do comparativo final (V05-10): escrito e verificado antes da primeira medição

> **Registro fixado.** O script, os testes e a nota de pesquisa citados abaixo são os do commit de implementação
> [`8554c75`](https://github.com/journey-studios/godot-fabric/commit/8554c750936934f85173c8332dbec32237510f04), de 2026-10-10. A única entrada do exemplo é o gerador sintético desse commit e o arquivo do protocolo
> (`docs/research/frontier-comparison-protocol.json`, intocado); este README, o `example-analysis.json`, o teste que o confere e o índice das evidências foram escritos depois e não são entrada de nenhum comando.
> A [nota de pesquisa](../../research/frontier-comparison-analysis.md) e esta página dizem as mesmas coisas.

O protocolo do comparativo final exige que a análise rode "de um script commitado antes da primeira execução comparativa" e que a saída seja "reprodutível a partir dos dados brutos e da semente" (`statistics.analysis`). Este é esse script:
`node scripts/frontier-comparison-analysis.mjs <campaign.json> [--out <report.json>]`, que lê o protocolo em tempo de execução (os percentis, o bootstrap, os pares, a margem, as categorias, o Holm, a ordem das execuções, o limite de carga, as regras de invalidação, os limiares congelados e as seções do relatório são do JSON, não do código) e produz todos os números do relatório final.

**Nada aqui é resultado.** O exemplo desta pasta é **sintético**: a campanha foi inventada por um gerador com semente fixa para exercitar o script, e **nenhum número dela é resultado de qualquer braço**. Os braços B e A ainda não existem, nenhuma execução comparativa rodou,
e nada aqui diz que o HUD React Native é mais rápido, mais lento ou igual a qualquer coisa. Esta fatia **prepara** os critérios `execucao` e `relatorio` do V05-10 e **não fecha nenhum**; não move checkpoint, nota, peso nem denominador do 1.0.
Não muda código de produto: a API pública, o PARITY e a compatibilidade ficam como estavam.

Todo link de código abaixo está fixado no commit [`8554c75`](https://github.com/journey-studios/godot-fabric/commit/8554c750936934f85173c8332dbec32237510f04). O script é feito de módulos pequenos, em
[`scripts/`](https://github.com/journey-studios/godot-fabric/tree/8554c750936934f85173c8332dbec32237510f04/scripts) (`frontier-comparison-statistics.mjs`, `-decision.mjs`, `-protocol.mjs`, `-format.mjs`, `-validity.mjs`, `-measures.mjs`, `-primary.mjs`, `-axes.mjs`, `-report.mjs` e a linha de comando `-analysis.mjs`); os testes são
[`tests/frontier-comparison-analysis.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/8554c750936934f85173c8332dbec32237510f04/tests/frontier-comparison-analysis.test.mjs),
[`tests/frontier-comparison-validity.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/8554c750936934f85173c8332dbec32237510f04/tests/frontier-comparison-validity.test.mjs) e
[`tests/frontier-comparison-protocol.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/8554c750936934f85173c8332dbec32237510f04/tests/frontier-comparison-protocol.test.mjs), este último agora importando as funções de estatística e de decisão dos módulos, com os exemplos e o intervalo fixados intactos.

| Verificação | Resultado | Observação |
| --- | --- | --- |
| `node --test tests/frontier-comparison-analysis.test.mjs` | 18/18 | as estatísticas, as quatro categorias e o `nonInferior`, a margem (piso de 0,5 ms contra 10% da mediana de B), o rebaixamento pelo Holm, os eixos, o FPS, os descritivos, os orçamentos, o relatório parcial, os parâmetros lidos do protocolo, o determinismo byte a byte, a linha de comando |
| `node --test tests/frontier-comparison-validity.test.mjs` | 7/7 | a carga acima do limite refeita na vaga, a execução não apresentada, a incompleta, o hash errado, a quarta tentativa que para a campanha, a repetição de `other-game`, o instrumento, o equilíbrio por posição, os dados fora do formato |
| `node --test tests/frontier-comparison-protocol.test.mjs` | 18/18 | igual ao de antes da fatia; o **pin `PINS[2]` não se move** e o JSON do protocolo não foi editado |
| `node --test tests/frontier-freeze.test.mjs` | 21/21 | o congelamento continua verificado |
| `npm run type-check` | passou | |
| `npm run check:static` | `No issues found` | |
| `npm run check:publication` | passou | 1.992 arquivos, sem falhas |
| `npm run test:contracts` | saiu com 0 | 514 testes de Node e 13 de Python, sem falhas (parity 7/7 e dashboard 43/43 dentro dele) |
| `node scripts/migration-dashboard.mjs check`, `node scripts/milestone-guards.mjs --check --base origin/main` | passaram | |

As contagens são as do commit fixado `8554c75`; o commit de evidência que o segue acrescenta ao teste de análise o teste do exemplo desta pasta (19 testes) e ao gerador sintético a linha de comando que o regera.

## O que o script calcula

Uma linha por seção do relatório (`report.sections` do protocolo, na ordem do protocolo); a regra do protocolo que cada número implementa está citada ao lado do código e na [nota](../../research/frontier-comparison-analysis.md#what-the-script-computes).

| Seção | O que contém | Caminho no protocolo |
| --- | --- | --- |
| `provenance` | o SHA-256 do arquivo do protocolo lido, os valores congelados com as datas, o registro (sementes, hashes, instrumento), as leituras de vsync e de carga, os desvios | `report.sections`, `thresholds`, `runs.provenance` |
| `validity` | as execuções planejadas, aceitas e rejeitadas por vaga das duas faixas, com o motivo de cada rejeição; o limite de 3 tentativas; a campanha que para; o equilíbrio por posição | `invalidation`, `runs.load.redo`, `runs.sequence`, `runs.balance` |
| `primary` | por janela e por braço, o p95 por execução, a mediana e o IQR; por par, a diferença e o intervalo de 95% pelo bootstrap percentil com `mulberry32`; em C menos B, a margem, a categoria, o `nonInferior` e o rebaixamento pelo Holm na família das quatro janelas | `primaryOutcome`, `statistics`, `decisionRule` |
| `axes` | o veredito de C contra B em cada eixo com `verdict: true` (latência até o painel, memória residente, tempo até a HUD interativa, FPS sem limite por janela, tamanho do pacote, custo de mudança) e os desfechos descritivos com medianas e intervalos | `secondaryOutcomes`, `decisionRule` (`orientation`, `fpsGain`, `deterministic`, `singleObservation`) |
| `cost-of-change` | a observação única de cada braço, dita como tal; o texto vem da campanha | `decisionRule.singleObservation` |
| `budgets` | o orçamento congelado de cada janela e, por braço, a mediana do p95 por execução contra ele: cumprido, excedido ou N/A (o `stress` é N/A pelo próprio congelado) | `decisionRule.absoluteBudget`, `thresholds` |
| `decision`, `limitations` | só o texto que veio da campanha (`null` sem ele); o script não inventa texto; `decision` diz se o relatório é parcial | `decisionRule.partialReport` |
| `reproduction` | onde estão os dados brutos, o SHA-256 da campanha e do protocolo, a semente, os resamples, o comando | `statistics.analysis`, `runs.rawData` |

O relatório parcial (o braço B não ficou pronto no time-box) tem só H1 e nenhuma categoria em H3. Uma campanha que para (uma vaga que esgotou as tentativas sem nenhuma aceita, uma repetição de `other-game` num braço, um instrumento que não passou) ou a que tem um braço com menos de 10 execuções aceitas não produz estatística: o relatório diz o `status` e por quê.

## O formato da campanha

`godot-fabric.frontier-comparison-campaign/v1` é o que `execucao` vai produzir. Está definido e validado em
[`scripts/frontier-comparison-format.mjs`](https://github.com/journey-studios/godot-fabric/blob/8554c750936934f85173c8332dbec32237510f04/scripts/frontier-comparison-format.mjs) e descrito campo a campo, com a regra do protocolo que lê cada um, na
[seção "The campaign format" da nota](../../research/frontier-comparison-analysis.md#the-campaign-format).
`node scripts/frontier-comparison-analysis.mjs --check-format <campaign.json>` o valida.

## O exemplo e como regerá-lo

[`example-analysis.json`](example-analysis.json) (127 KB) é o relatório que o script produz de uma campanha **sintética** com a semente fixa `example`: 12 execuções por braço, a ordem do protocolo, as duas faixas e os três braços. O cenário foi escolhido para mostrar as quatro categorias lado a lado
(`ai-phase` ganho, `event-burst` neutro, `context-switches` custo, `stress` inconclusivo, com B e C de variância grande), uma carga acima do limite refeita na vaga 4 da faixa apresentada, e uma janela (`ai-phase`) em que C tem mais quadros por segundo sem limite que B. O texto de `decision`, `limitations` e `cost-of-change` diz "SYNTHETIC EXAMPLE".
A campanha em si, de 1,9 MB, **não está no repositório**: ela se regera, e o relatório registra o SHA-256 dos bytes dela em `sections.reproduction.campaignSha256`, junto com o `protocolSha256`; esse hash muda quando o protocolo muda, porque a campanha embute o pin do protocolo, e o valor vigente é o do próprio relatório.

```sh
node tests/frontier-comparison-synthetic.mjs example-campaign.json
node scripts/frontier-comparison-analysis.mjs example-campaign.json --out docs/evidence/frontier-comparison-analysis/example-analysis.json
```

O primeiro comando grava a campanha sintética (compacta, com uma quebra de linha no fim); o segundo a analisa. O teste `tests/frontier-comparison-analysis.test.mjs` roda **esses dois comandos** num diretório temporário e exige que o relatório seja o `example-analysis.json` desta pasta byte a byte; se o protocolo (o hash do arquivo está no relatório)
ou o script mudarem, o teste falha e o relatório se regera com os mesmos comandos. Apague o `example-campaign.json` depois.

## A tentativa sem relatório (2026-10-10)

A campanha de `execucao` (#126) deixava de fora da campanha a tentativa cujo processo não escreveu relatório (travamento, estouro de tempo), e o relatório contava menos tentativas do que as feitas. O formato ganhou o campo opcional `unreported`
(a mudança é do formato, que é da análise; o protocolo não muda e o formato continua `.../v1`): uma entrada por tentativa, com o braço, a faixa, a vaga, o número da tentativa, a carga antes e depois, como o processo terminou (`crashed`, `timedOut` e `exitCode` ou `signal`) e o SHA-256 do `.log` guardado.
A análise julga essa tentativa rejeitada pela regra `errors`, cláusula `no-report`, com esses valores; ela conta nas 3 tentativas da vaga e na parada por tentativas esgotadas, e o relatório a mostra em `validity.slots[].attempts[]` com `reported: false`, a carga e sem `vsync`.
Por isso toda tentativa do relatório agora tem `reported`, e o [`example-analysis.json`](example-analysis.json) foi regerado pelos dois comandos acima: a única diferença é o `"reported": true` em cada tentativa.

[`example-unreported-validity.json`](example-unreported-validity.json) (41 KB) é **só a seção `validity`** do relatório do mesmo cenário sintético com uma tentativa sem relatório: o processo da tentativa 1 da vaga 7 da faixa apresentada (braço B) travou com `SIGSEGV`, e a tentativa 2 foi aceita (`rejected: 1`). É sintético, e nenhum número dele é resultado.

```sh
node tests/frontier-comparison-synthetic.mjs --unreported-validity docs/evidence/frontier-comparison-analysis/example-unreported-validity.json
```

O comando gera a campanha, analisa-a e grava a seção; o teste `tests/frontier-comparison-analysis.test.mjs` o roda e exige o arquivo desta pasta byte a byte, e confere que o script de análise, sobre a campanha que `node tests/frontier-comparison-synthetic.mjs --unreported <campaign.json>` grava, produz a mesma seção.

## O relatório como documento (Markdown)

[`example-analysis.md`](example-analysis.md) é o `example-analysis.json` lido por uma pessoa: o renderizador `scripts/frontier-comparison-report-markdown.mjs` transforma o JSON do relatório em Markdown, em inglês, com uma seção por seção do relatório e na ordem do protocolo.
Este passo prepara o fechamento do critério `relatorio` do V05-10 e não o fecha: o fechamento passa a ser mecânico (análise → `report.json` → documento), mas o critério segue aberto até a campanha real e o texto da decisão. O exemplo continua **sintético**, e o próprio texto do JSON (`decision`, `limitations`, `cost-of-change`) diz "SYNTHETIC EXAMPLE"; nenhum número dele é resultado de qualquer braço.

```sh
node scripts/frontier-comparison-report-markdown.mjs docs/evidence/frontier-comparison-analysis/example-analysis.json --out docs/evidence/frontier-comparison-analysis/example-analysis.md
```

Sem `--out` o documento vai para a saída padrão. O comando lê também o protocolo (`docs/research/frontier-comparison-protocol.json`, ou `--protocol <arquivo>`) e calcula o SHA-256 dos bytes dele: os ids e a ordem das seções e as palavras da regra do relatório parcial (`decisionRule.partialReport`) são do protocolo, não do renderizador,
e um relatório cujo `sections.provenance.protocol.sha256` não seja o do protocolo lido é recusado (foi feito sob outro protocolo). **O `.md` não se edita à mão:** ele é a saída do comando sobre o `.json` desta pasta, byte a byte, e o teste `tests/frontier-comparison-report-markdown.test.mjs` exige isso. Mudou o relatório ou o renderizador, o teste falha e o documento se regera com o mesmo comando.
O mesmo vale para o documento final da campanha real: ele sai do `report.json` dela, e as palavras da decisão e das limitações são o campo `text` da campanha, escritas por quem fecha o comparativo.

O renderizador não calcula estatística, não arredonda veredito e não decide nada; só formata o que o JSON tem. Os números seguem uma regra única, sem locale: até 3 casas decimais, sem zeros à direita, os inteiros como inteiros e as unidades do JSON ao lado
(um número diferente de zero que 3 casas apagariam, como um p-valor de 0,00009999, mostra 3 algarismos significativos em notação plana: 0.0001, nunca 0 e nunca exponencial). Os vereditos e as categorias aparecem com as palavras do JSON. O que o JSON tem e o documento não repete, de propósito, são os valores por execução (`perRun`) e os intervalos orientados; um campo que o renderizador não conhece vai para um bloco "Other fields", em JSON compacto, no fim da seção dele,
e o teste prova que o exemplo desta pasta não cai nesse bloco. O teste confere ainda os quatro `status` (`complete`, `partial`, `incomplete` e `stopped`), a tentativa sem relatório marcada na validade (`reported: false`), o escape de `|` em tabela, a recusa de um JSON de outro formato, de um relatório feito sob outro protocolo (outro SHA-256) ou com as seções fora da ordem do protocolo, e que nenhum número do documento falta no JSON.

## Os limites

- **É sintético, e nenhum número dele é resultado.** Os testes provam que o script calcula o que o protocolo diz que ele calcula; não provam nada sobre um braço nem sobre como os dados reais vão se parecer. A primeira campanha real vai exercitar caminhos (uma carga rejeitada, uma campanha que para) que as sintéticas só simulam.
- **O script do cenário e os braços são de `execucao`.** Falta o script que roda o soak de 100 turnos, as trocas de contexto, a passagem de latência e as rodadas de estresse; os braços A e B não existem; o autoteste do instrumento ainda precisa rodar na máquina da campanha; os hashes do binário, do pacote e dos scripts são registrados antes da primeira execução.
  O formato pede o que as regras de invalidação leem, e a bancada tem de gravar as flags que só ela vê (um quadro desenhado após cada intenção medida, se os testIDs batem com a matriz, o código de saída e os erros). Se algum campo não puder ser gravado como pedido, muda o formato (o script, os testes e a nota), e só uma regra do protocolo que tenha de mudar é emenda.
- **O texto da decisão é de `relatorio`.** O script calcula os números e não escreve nenhuma frase; `decision`, `limitations` e o texto de `cost-of-change` entram da campanha.
- **A máquina precisa ficar dentro do limite de carga de 2,0** (`runs.load.limit1MinuteAverage`): uma execução com média de 1 minuto acima disso, antes ou depois, é rejeitada e refeita (no máximo 3 tentativas por vaga). As execuções que congelaram os limiares rodaram a 5,3 a 7,6 ([o congelamento](../frontier-freeze/README.md)); o computador de uma campanha real precisa estar bem abaixo.
- **Leituras do texto do protocolo.** Onde o protocolo escreve uma regra em frase, o código a segue, checa a frase ao rodar e a nota lista a leitura escolhida. Três podem mudar um resultado e foram **decididas pelo líder da revisão**: `other-game` ("a repeat of it in one arm") para a campanha na segunda tentativa rejeitada por ele no mesmo braço, em qualquer faixa; o veredito de `rss` é sobre a leitura do fim da execução e o máximo é descritivo; `fps-unlimited` tem um veredito por janela e é N/A sem execuções com o vsync lido como `DISABLED` em número suficiente.
- **O que o script não confere:** o conteúdo da matriz de contextos, o começo e o fim de cada janela (da bancada) e o mínimo de 5 quadros do `event-burst`; ele toma os quadros de cada ocorrência como gravados.
- **Sem host anterior:** a fatia não muda C++ nem código de produto; os recibos hospedados e o de Pages estão na seção abaixo.

## CI hospedada e Pages

**O run.** O push da `main` em `4a73a86` (o squash do #110, com 8 commits e 22 arquivos no PR; run [38030014224](https://github.com/journey-studios/godot-fabric/actions/runs/38030014224) do workflow Contracts, iniciado às 06:10:27 UTC) passou na primeira tentativa, sem reexecução, nos três jobs que um push roda desde o #88: `contracts` (3 min 36 s), `reference-android` (5 min 58 s) e `reference-ios` (6 min 42 s). Os outros cinco (`native-cold-start`, `native-suites-frontier`, `native-suites-input`, `native-suites-runtime` e `parity-comparison`) aparecem como **skipped**; o [recibo](hosted-ci.json) os registra assim e só os aceita porque a linha da fatia não tem passo nativo nem artefato. Os três jobs que rodaram usaram `4a73a86`, e a árvore do head do PR é a árvore do squash.

**O passo da guarda.** "Milestone exit guards (X9 and X10)" passou num push e imprimiu `MILESTONE_GUARDS_CHECK_PASSED: against b23009d00f5f (--base b23009d00f5f2fe419f4016c1484f1e9039f40c6); X9 clean, X10 clean`. A base é o pai do squash.

**Os testes.** `npm run test:contracts` passou com 7, 43 e 518 testes de Node, todos em `pass`, e 13 de Python. O recibo confere, pelo nome e no log do job `contracts`, os testes de nível superior dos três arquivos que este PR criou ou mudou: `tests/frontier-comparison-analysis.test.mjs` (19 de 19), `tests/frontier-comparison-validity.test.mjs` (7 de 7) e `tests/frontier-comparison-protocol.test.mjs` (18 de 18). `check:static` e `check:publication` também passaram (2.005 arquivos).

**O Pages.** O push de `4a73a86` rodou também o workflow do Pages (run [38030014288](https://github.com/journey-studios/godot-fabric/actions/runs/38030014288), 06:10:27 a 06:11:11 UTC, `build` e `deploy` em success, 43 testes do painel). O [recibo](publication.json) registra o deployment 6976986838 em success e o artefato `github-pages` (id 11662101552, SHA-256 `8c89d3da…`, igual ao digest da API e ao do log de upload). O `migration.json` de dentro tem os mesmos bytes do `dashboard/migration.json` do squash, e a entrada de atividade da fatia, `milestone-0-5-v05-10-analysis-4592dba`, está nele. Um push seguinte da `main` substitui o deployment, então o site público não foi comparado.

**O que continua só local:** a análise roda sobre campanhas sintéticas, e nenhuma medição de braço entra nesta fatia; os recibos hospedados provam o código e os testes, não um resultado.

```sh
node scripts/hosted-receipts.mjs --write --slice frontier-comparison-analysis --work-dir <diretório fora do repositório>
node scripts/hosted-receipts.mjs --check
```
