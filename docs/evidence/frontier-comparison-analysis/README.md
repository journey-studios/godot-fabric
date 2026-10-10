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

O relatório parcial (o braço B não ficou pronto no time-box) tem só H1 e nenhuma categoria em H3. Uma campanha que para (uma vaga sem tentativas, uma repetição de `other-game` num braço, um instrumento que não passou) ou a que tem um braço com menos de 10 execuções aceitas não produz estatística: o relatório diz o `status` e por quê.

## O formato da campanha

`godot-fabric.frontier-comparison-campaign/v1` é o que `execucao` vai produzir. Está definido e validado em
[`scripts/frontier-comparison-format.mjs`](https://github.com/journey-studios/godot-fabric/blob/8554c750936934f85173c8332dbec32237510f04/scripts/frontier-comparison-format.mjs) e descrito campo a campo, com a regra do protocolo que lê cada um, na
[seção "The campaign format" da nota](../../research/frontier-comparison-analysis.md#the-campaign-format).
`node scripts/frontier-comparison-analysis.mjs --check-format <campaign.json>` o valida.

## O exemplo e como regerá-lo

[`example-analysis.json`](example-analysis.json) (125 KB) é o relatório que o script produz de uma campanha **sintética** com a semente fixa `example`: 12 execuções por braço, a ordem do protocolo, as duas faixas e os três braços. O cenário foi escolhido para mostrar as quatro categorias lado a lado
(`ai-phase` ganho, `event-burst` neutro, `context-switches` custo, `stress` inconclusivo, com B e C de variância grande), uma carga acima do limite refeita na vaga 4 da faixa apresentada, e uma janela (`ai-phase`) em que C tem mais quadros por segundo sem limite que B. O texto de `decision`, `limitations` e `cost-of-change` diz "SYNTHETIC EXAMPLE".
A campanha em si, de 1,9 MB, **não está no repositório**: ela se regera, e o relatório registra o SHA-256 dos bytes dela (`sections.reproduction.campaignSha256`, `5e26c425…`).

```sh
node tests/frontier-comparison-synthetic.mjs example-campaign.json
node scripts/frontier-comparison-analysis.mjs example-campaign.json --out docs/evidence/frontier-comparison-analysis/example-analysis.json
```

O primeiro comando grava a campanha sintética (compacta, com uma quebra de linha no fim); o segundo a analisa. O teste `tests/frontier-comparison-analysis.test.mjs` roda **esses dois comandos** num diretório temporário e exige que o relatório seja o `example-analysis.json` desta pasta byte a byte; se o protocolo (o hash do arquivo está no relatório)
ou o script mudarem, o teste falha e o relatório se regera com os mesmos comandos. Apague o `example-campaign.json` depois.

## Os limites

- **É sintético, e nenhum número dele é resultado.** Os testes provam que o script calcula o que o protocolo diz que ele calcula; não provam nada sobre um braço nem sobre como os dados reais vão se parecer. A primeira campanha real vai exercitar caminhos (uma carga rejeitada, uma campanha que para) que as sintéticas só simulam.
- **O script do cenário e os braços são de `execucao`.** Falta o script que roda o soak de 100 turnos, as trocas de contexto, a passagem de latência e as rodadas de estresse; os braços A e B não existem; o autoteste do instrumento ainda precisa rodar na máquina da campanha; os hashes do binário, do pacote e dos scripts são registrados antes da primeira execução.
  O formato pede o que as regras de invalidação leem, e a bancada tem de gravar as flags que só ela vê (um quadro desenhado após cada intenção medida, se os testIDs batem com a matriz, o código de saída e os erros). Se algum campo não puder ser gravado como pedido, muda o formato (o script, os testes e a nota), e só uma regra do protocolo que tenha de mudar é emenda.
- **O texto da decisão é de `relatorio`.** O script calcula os números e não escreve nenhuma frase; `decision`, `limitations` e o texto de `cost-of-change` entram da campanha.
- **A máquina precisa ficar dentro do limite de carga de 2,0** (`runs.load.limit1MinuteAverage`): uma execução com média de 1 minuto acima disso, antes ou depois, é rejeitada e refeita (no máximo 3 tentativas por vaga). As execuções que congelaram os limiares rodaram a 5,3 a 7,6 ([o congelamento](../frontier-freeze/README.md)); o computador de uma campanha real precisa estar bem abaixo.
- **Leituras do texto do protocolo.** Onde o protocolo escreve uma regra em frase, o código a segue, checa a frase ao rodar e a nota lista a leitura escolhida. Três podem mudar um resultado e foram **decididas pelo líder da revisão**: `other-game` ("a repeat of it in one arm") para a campanha na segunda tentativa rejeitada por ele no mesmo braço, em qualquer faixa; o veredito de `rss` é sobre a leitura do fim da execução e o máximo é descritivo; `fps-unlimited` tem um veredito por janela e é N/A sem execuções com o vsync lido como `DISABLED` em número suficiente.
- **O que o script não confere:** o conteúdo da matriz de contextos, o começo e o fim de cada janela (da bancada) e o mínimo de 5 quadros do `event-burst`; ele toma os quadros de cada ocorrência como gravados.
- **Sem host anterior, sem CI hospedado nesta pasta:** a fatia não muda C++ nem código de produto. Os recibos de CI hospedado e de Pages vêm depois do merge.
