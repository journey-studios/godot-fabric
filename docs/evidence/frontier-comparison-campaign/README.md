# A campanha da execução comparativa final (V05-10), parte 2: o orquestrador, retomável, com lançador trocável e o autoteste do instrumento como portão

> **Registro fixado.** O orquestrador, a máquina de estados, o lançador, a trava, o autoteste e os testes citados abaixo são os do commit
> [`f9aabb3`](https://github.com/journey-studios/godot-fabric/commit/f9aabb3c8110dc963afd587589919f03dd901fbe), de 2026-10-10. O ensaio curto desta pasta rodou sobre o `a618d0e`, que é o `f9aabb3` mesclado com a `origin/main` no `5683a5b`
> (os recibos do #120 e o passe do braço B, #121, entre outros), com a árvore limpa; o `summary.json` registra esse commit. A mesclagem não toca o orquestrador: traz o HUD nativo otimizado, os recibos e os registros.
> Este README, os outros arquivos desta pasta, o índice das evidências e o link da nota foram escritos depois e não são entrada de nenhum comando.
> A [nota de pesquisa](../../research/frontier-comparison-execution.md#the-campaign) e esta página dizem as mesmas coisas.

> **É UM ENSAIO. NENHUM NÚMERO DESTA PASTA É RESULTADO.** O orquestrador rodou **três vagas da faixa apresentada, uma por braço**, num build **Debug**, num display **headless**, numa máquina com média de carga de 1 minuto entre 3,39 e 11,05 (o limite do protocolo é 2,0), sem o export Release do V05-07.
> **Nenhuma campanha rodou.** Os 36 + 36 lugares da sequência não foram jogados: o orquestrador completo só rodou contra um lançador falso, em Node, com execuções sintéticas, e este ensaio com o lançador Debug de três vagas.
> As três tentativas foram **rejeitadas pela análise**, como um ensaio deve mostrar (`not-the-registered-build`, `not-presented` e `load`), e o relatório da análise sai com `status: incomplete` e nenhuma estatística.
> Nada aqui diz que o HUD React Native é mais rápido, mais lento ou igual ao nativo, nem que um braço é mais lento que o outro. Esta fatia entrega a **segunda parte** do critério `execucao` do V05-10 e **não fecha nenhum critério**; não move checkpoint, nota, peso nem denominador do 1.0.
> Não muda código de produto: a API pública, o PARITY e a compatibilidade ficam como estavam.

O protocolo do comparativo final ([`docs/research/frontier-comparison-protocol.json`](../../research/frontier-comparison-protocol.json), com as quatro emendas e os limiares congelados) manda 12 execuções por braço em cada uma de duas faixas, na ordem `ABC CAB BCA` quatro vezes; cada execução é um processo novo, e duas nunca se sobrepõem (`runs.process`); a execução cuja média de carga de 1 minuto passa de 2,0, antes ou depois, é refeita; são no máximo 3 tentativas por vaga, e quando acabam a campanha para (`runs.load`); e o autoteste do instrumento tem de rodar de novo na máquina da campanha antes dela (`cpu-time-instrument`, `gate`).
A [parte 1](../frontier-comparison-execution/README.md) entregou uma execução, em qualquer braço. Esta é o trecho entre ela e a campanha: **o orquestrador da campanha inteira**, que joga a sequência nas duas faixas, julga cada tentativa pelas regras da [análise](../frontier-comparison-analysis/README.md), refaz as rejeitadas na mesma vaga, espera a máquina ficar quieta, grava o estado depois de cada tentativa para retomar uma campanha interrompida, só começa se o autoteste do instrumento passar e roda por um lançador que se troca.

Todo link de código abaixo está fixado no commit [`f9aabb3`](https://github.com/journey-studios/godot-fabric/commit/f9aabb3c8110dc963afd587589919f03dd901fbe). Em [`scripts/`](https://github.com/journey-studios/godot-fabric/tree/f9aabb3c8110dc963afd587589919f03dd901fbe/scripts):
[`frontier-comparison-campaign.mjs`](https://github.com/journey-studios/godot-fabric/blob/f9aabb3c8110dc963afd587589919f03dd901fbe/scripts/frontier-comparison-campaign.mjs) (a linha de comando e o orquestrador),
[`-campaign-state.mjs`](https://github.com/journey-studios/godot-fabric/blob/f9aabb3c8110dc963afd587589919f03dd901fbe/scripts/frontier-comparison-campaign-state.mjs) (a máquina de estados, pura),
[`-campaign-load.mjs`](https://github.com/journey-studios/godot-fabric/blob/f9aabb3c8110dc963afd587589919f03dd901fbe/scripts/frontier-comparison-campaign-load.mjs) (a espera de carga),
[`-campaign-instrument.mjs`](https://github.com/journey-studios/godot-fabric/blob/f9aabb3c8110dc963afd587589919f03dd901fbe/scripts/frontier-comparison-campaign-instrument.mjs) (o autoteste),
[`-campaign-launchers.mjs`](https://github.com/journey-studios/godot-fabric/blob/f9aabb3c8110dc963afd587589919f03dd901fbe/scripts/frontier-comparison-campaign-launchers.mjs) (o lançador Debug e o Release que recusa),
[`-campaign-lock.mjs`](https://github.com/journey-studios/godot-fabric/blob/f9aabb3c8110dc963afd587589919f03dd901fbe/scripts/frontier-comparison-campaign-lock.mjs) (a trava).
Os testes: [`tests/frontier-comparison-campaign.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/f9aabb3c8110dc963afd587589919f03dd901fbe/tests/frontier-comparison-campaign.test.mjs),
[`-campaign-state.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/f9aabb3c8110dc963afd587589919f03dd901fbe/tests/frontier-comparison-campaign-state.test.mjs) e
[`-campaign-guards.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/f9aabb3c8110dc963afd587589919f03dd901fbe/tests/frontier-comparison-campaign-guards.test.mjs) (só Node, dentro de `npm run test:contracts`, com o lançador falso de
[`-campaign-fake.mjs`](https://github.com/journey-studios/godot-fabric/blob/f9aabb3c8110dc963afd587589919f03dd901fbe/tests/frontier-comparison-campaign-fake.mjs)), e
[`-campaign-native.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/f9aabb3c8110dc963afd587589919f03dd901fbe/tests/frontier-comparison-campaign-native.test.mjs) (o ensaio curto, nativo, em `npm run test:frontier-comparison-run`).
Nada de `consumers/`, do JSON do protocolo nem dos scripts da análise é editado: a regra das janelas da parte 1 só passou a devolver seus problemas como `{code, message}`, e a campanha **importa** a validade da análise (`assessValidity`, `campaignErrors`, `proseRulesOf`, `slotsOf`) sem duplicar nenhuma regra.

| Verificação (no commit fixado) | Resultado | Observação |
| --- | --- | --- |
| `node --test` dos testes novos e dos do run, da análise, da validade e do protocolo | 91 testes, verdes | a sequência e o equilíbrio por posição; o refazer por carga, por não apresentada, por incompleta e por erro; o limite de 3 tentativas e a campanha que para; o `other-game` repetido; a espera de carga com relógio e `loadavg` injetados; a retomada depois de interrupções simuladas (após 1, 2, 38 e 74 tentativas, e duas vezes numa campanha), idêntica byte a byte à corrida sem interrupção; a recusa da retomada com um hash mudado; o autoteste que falha e bloqueia; a recusa do Release; a trava; o autoteste em faixa headless e janelada |
| `npm run test:frontier-comparison-run` | 16 testes nativos, verdes, 741 s | o jogador, o ensaio da parte 1 nos três braços e o ensaio curto da campanha |
| `npm run type-check`, `npm run check:static` | limpos | |

Essas contagens são as do líder da revisão no commit fixado. O `npm run test:contracts` do implementador passou no mesmo código (565 testes no bloco principal, 7 do parity, 43 do dashboard e os 13 do Python). As verificações do repositório do commit de evidência que segue o fixado estão no [fim](#as-verificações-do-commit-de-evidência).

## O que há nesta pasta

Os arquivos **commitados** são os que a máquina escreveu, copiados sem editar (os dois JSON), ou os registros de texto do que a linha de comando imprimiu, com o caminho da árvore de trabalho tirado. Nenhum tem caminho local: conferido nas cópias, e a varredura da publicação confere de novo.

| Arquivo | Bytes | O que é |
| --- | ---: | --- |
| [`summary.json`](summary.json) | 5.176 | o resumo do ensaio: as opções, os hashes registrados, o autoteste, a faixa e o braço de cada vaga com as rejeições e seus motivos, as esperas, as anomalias, a análise, a procedência (commit, máquina, motor, custos de leitura) |
| [`rehearsal.json`](rehearsal.json) | 1.088 | a marca: `rehearsal: true`, `notAResult`, o SHA-256 da campanha, a faixa, as vagas, a taxa de atualização assumida e a procedência dos custos de leitura |
| [`resume-sigkill.txt`](resume-sigkill.txt) | 1.241 | a saída da linha de comando de um ensaio **morto com `SIGKILL`** durante a vaga 2 e a do mesmo comando com `--resume` |
| [`resume-refused.txt`](resume-refused.txt) | 632 | a recusa de uma retomada cujo pacote tem outro hash |

**Não commitados** (a campanha tem 74 KB, o estado 79 KB e os relatórios brutos do cenário, de 274 a 297 KB, são a entrada da campanha): só os SHA-256 deles, que se conferem contra o `campaignSha256` do `rehearsal.json` e contra os arquivos regerados.

| Arquivo do ensaio | Bytes | SHA-256 |
| --- | ---: | --- |
| `campaign.json` (no formato da análise) | 73.880 | `72c52c53e481ffbb6588efe7a4078c8f3c20cb78915352359a6c77af06c64de0` |
| `report.json` (o relatório da análise) | 33.155 | `0063b86aaf2c488ca33b988d8325576651e8557001fdcfe8341a1bbd16de505c` |
| `raw/presented-1-1.json` (cenário, braço A) | 273.873 | `09c2114e4dbe4fc68670f1042bf224a8cd4e8f669dedb7ea6091ed35b35f0e06` |
| `raw/presented-2-1.json` (cenário, braço B) | 291.814 | `e1d8a99d6dc5820cacee6b06addd11227d1500ae5ab69fc1be550cdd6c9c9ab6` |
| `raw/presented-3-1.json` (cenário, braço C) | 297.292 | `34b19f1f2bce6ac5240454ec6b14cc15bd1e61681e8020055a16a4c24d5e5294` |
| `self-check/probe-report.json` (o relatório bruto do probe do instrumento) | 190.499 | `160892122c134c945c6591ea408853e4db1447f414fc164560eb142010d49e96` |

A análise do próprio script (`node scripts/frontier-comparison-analysis.mjs <campaign.json> --out <report.json>`) leu esse `campaign.json` e produziu um relatório **dos mesmos bytes** que o do orquestrador.

Os quatro hashes registrados, os mesmos nas três tentativas (`summary.json`, `launcher.registered`): o protocolo `2319c9b6fbe39262c932c439a5642525818ea4d3e0c66f278f8039d491526f93`, o binário do motor `c7cccbf8fb143e34e02fd6521e09be2c2b974f0d5db080b19071c9c570718ccf`, a cópia provisionada como foi construída (o pacote)
`9a12994c9d7c8ab638c301df0a21bd281523ed6a1610ec14e273346c49d12b34` e os arquivos do roteiro `ec1789425c93432f8885690671dca8a0e588b7e68ac62a663301cc6f4ce19029`; mais o arquivo do instrumento (`tests/cpu-time-instrument.gd`) `4bdcda83771c38221b3e9da47bdca2622ac4bda119d0b41809e83bceabf28c9d`, o replay dourado `cb7ab974…` e o soak final `0b21c332…`.
O binário e o pacote são os substitutos de um ensaio para os do export Release: o executável do motor e a cópia provisionada. **O hash do pacote depende do commit e da árvore** (veja [a retomada](#a-retomada-e-a-recusa)).

## A máquina de estados

```text
prepare do lançador ─▶ trava ─▶ autoteste ─▶ [falhou: nada roda, parada `instrument`]
        └▶ próxima vaga do plano ─▶ espera de carga ─▶ lança (processo novo) ─▶ registra ─▶ julga ─▶ grava o estado ─┐
                 ▲                                                                                                  │
                 └──── aceita: a próxima vaga │ rejeitada: a mesma vaga, tentativa + 1 (no máximo 3) │ para │ fim ◀───┘
```

- **O plano** é a sequência do protocolo (`ABC CAB BCA` quatro vezes, 36 vagas) na primeira faixa e depois na outra (`--lanes`); `--slots a-b` limita as vagas de cada faixa e só vale num ensaio.
- **O veredito** de cada tentativa é o da análise: a campanha que o estado forma (suas execuções, numeradas 1, 2, ... em cada vaga) passa por `assessValidity`, e a tentativa é aceita se nenhuma regra a rejeita (`load`, `not-presented`, `not-the-registered-build`, `other-game`, `errors`, `parity`, `incomplete`). Os motivos são os `{rule, clause, ...valores}` da análise. A rejeitada fica no estado e em `raw/` com as leituras de carga e os motivos.
- **O refazer** toma o lugar da rejeitada: o próximo lançamento é a mesma vaga com o número seguinte, antes da vaga seguinte. Um ensaio **não refaz**: cada vaga roda uma vez, para que as rejeições que ele existe para mostrar (o Debug, o display headless, a carga de uma máquina ocupada) apareçam e se contem; sem isso o Debug esgotaria a primeira vaga.
- **As paradas** são as que a análise relata (`validity.stopped`: uma vaga com as 3 tentativas gastas, o segundo `other-game` num braço, um instrumento que não passou), mais três que ela não vê: uma vaga esgotada contando a tentativa sem relatório, um cenário que esperou com números diferentes dos do protocolo (os problemas `config-waits` e `config-idle-frames`) e um motor ou display diferente do que o autoteste usou.
- **A faixa `unlimited`** é N/A desde a primeira tentativa cujo vsync não leu `DISABLED`, e as vagas seguintes dela não rodam (`runs.lanes`).
- **O estado** (`campaign-state.json`) é gravado de forma atômica (um arquivo temporário, renomeado por cima) depois de cada tentativa: as opções, o hash do protocolo, o que o lançador registrou, o autoteste, o motor, cada tentativa (vaga, braço, número, a espera, a carga antes e depois, os hashes, o código de saída, a execução no formato da análise, o veredito, as anomalias, os caminhos de `raw/`) e as tentativas sem relatório. Os arquivos brutos são gravados antes do estado, então o estado nunca nomeia um arquivo que não existe.

## O portão do autoteste

No começo de uma campanha (e não de uma retomada, a menos que ele não tenha passado) o probe `tests/cpu-time-instrument-probe.gd` roda no motor do lançador, e o oráculo `tests/cpu-time-instrument-oracle.mjs` julga o relatório bruto dele: o processo do probe, as checagens do próprio probe, um log sem erro escondido e o veredito do oráculo têm de passar. A campanha grava `instrument.selfCheckPassed` e `instrument.sha256`, o SHA-256 de `tests/cpu-time-instrument.gd` (ao lado de `registered.instrumentSha256`, que a análise compara: um arquivo que mudou depois do autoteste faz o instrumento não passar). **Se o autoteste falha, nenhuma execução roda.**

**A faixa do autoteste é a do lançador.** O portão do congelado pede "o motor e o renderizador da campanha", e a campanha real roda as duas faixas **janeladas** (a apresentada precisa do display; a sem limite precisa da janela para ler o vsync `DISABLED`). Um lançador janelado (o Release será) recebe o autoteste **janelado**: o mesmo probe com `--windowed` e o mesmo oráculo, e uma janela que nenhum display apresentou não é medida e **não passa** (o script `cpu-time-instrument-graphics.mjs` sai com 3 nesse caso). Um lançador headless, como o Debug, recebe o autoteste **headless**, o de `npm run test:cpu-time-instrument`, e os desvios da campanha dizem isso.
O estado guarda a procedência do probe, e a campanha **para** se um cenário relata outro motor, display, driver, método de renderização ou adaptador que o do autoteste: um autoteste headless não vale para uma janela. **O autoteste janelado foi testado com o probe e o oráculo substituídos e nunca rodou de verdade**; o ensaio rodou o headless, que é a faixa do Debug.

No ensaio: o autoteste passou em 20,4 s (10 checagens do probe, nenhuma violação do oráculo), a faixa foi `headless`, e o motor, o display, o driver (`opengl3`), o método (`gl_compatibility`) e o adaptador que o probe gravou foram os do cenário, então a campanha não parou neles.

## A carga e a espera

Antes de cada execução a campanha lê `sysctl -n vm.loadavg` (a média de 1 minuto) a cada 5 segundos até ela **não passar** de `runs.load.limit1MinuteAverage` (2,0, lido do protocolo; a regra rejeita o que está *acima* do limite) ou até `--max-wait` segundos. A espera vai para o estado (`waited`: a primeira e a última leitura, quantas, os segundos, se esgotou). Se esgota, a tentativa roda assim mesmo: as leituras que a regra julga são as do lançador, tomadas logo antes do processo e logo depois dele, e gravadas exatamente como foram lidas (`load.before`, `load.after`). A espera é uma cortesia às tentativas de uma vaga, não uma garantia.

No ensaio (`--max-wait 0`, porque numa máquina ocupada a espera só atrasaria a rejeição que ela existe para mostrar):

| | A | B | C |
| --- | ---: | ---: | ---: |
| Vaga, tentativa | 1, 1 | 2, 1 | 3, 1 |
| Segundos | 51,9 | 56,4 | 81,9 |
| Carga de 1 minuto, antes → depois | 4,86 → 3,39 | 3,39 → 3,42 | 3,42 → 11,05 |
| Código de saída | 0 | 0 | 0 |
| Espera | esgotada (0 s) | esgotada (0 s) | esgotada (0 s) |

A carga não ficou dentro de 2,0 em nenhum momento (a de depois da vaga 3, 11,05, é de outros agentes na máquina). Os números acima são os de **uma** execução de cada braço e **não são medida de braço nenhum**.

## A retomada e a recusa

`--resume` lê o estado, roda de novo o `prepare()` do lançador e **recusa** a menos que o protocolo, o roteiro, o binário e o pacote tenham os mesmos hashes (e o resto do que foi registrado, e as opções que decidem quais execuções existem); depois continua da primeira vaga sem tentativa aceita. O autoteste não se repete se já passou. Uma retomada com outro arquivo do instrumento é recusada: o arquivo está no hash do roteiro. O registro de uma retomada fica no estado (`resumes`), nunca na campanha, para que uma campanha retomada termine com o mesmo `campaign.json` e o mesmo `report.json`, byte a byte, que uma nunca interrompida (os testes Node matam o lançador falso depois de 1, 2, 38 e 74 tentativas e duas vezes numa campanha, e comparam).

**Provado de verdade, com o `SIGKILL`** ([`resume-sigkill.txt`](resume-sigkill.txt)): o mesmo ensaio, morto com `kill -9` durante a vaga 2 (o estado em disco tinha a vaga 1). Com a árvore limpa, `--resume` reprovisionou o consumidor, achou o protocolo, o roteiro, o binário e o pacote com os hashes registrados, **não repetiu o autoteste**, recomeçou na vaga 2 (`resuming after 1 attempt(s)`) e fechou com as três tentativas, no formato (`FRONTIER_COMPARISON_FORMAT_PASSED: 3 attempts`), com `resumes: [{attempts: 1}]` no estado.

**Provada a recusa, com o hash mudado** ([`resume-refused.txt`](resume-refused.txt)): a mesma retomada, feita depois de o implementador criar esta pasta (um diretório novo, sem commit, em `docs/evidence/`), foi **recusada** nos três braços, sem lançar nada e sem tocar o estado: `arm A package: the state registered 9a12994c…, now ea5dbecf…`. O pacote do lançador Debug é a cópia provisionada, e o `scripts/pack-addon.mjs` escreve nela um `manifest.json` com o `HEAD` do repositório e se a árvore de trabalho está suja (`sourceCommit`, `sourceDirty`), além de uma cópia do `node_modules`. O hash do pacote muda, portanto, com um commit, com qualquer mudança na árvore e com uma escrita em `node_modules` (numa rodada anterior, `npm run check:static` criou `node_modules/@fallow-cli/darwin-arm64/.fallow-verified` e uma retomada foi recusada do mesmo jeito). Duas cópias provisionadas em seguida, sem nada no meio, têm o mesmo hash. **Um ensaio Debug só se retoma com o commit, a árvore e o `node_modules` como eram quando ele começou; o export Release é um arquivo só e não tem essa dependência.** Tirada a pasta da árvore, a mesma retomada foi aceita.

## A trava

Um arquivo em `os.tmpdir()` (`godot-fabric-frontier-comparison-campaign.lock`) guarda o pid e o `--out` da campanha que está rodando. Uma campanha, ou uma retomada, que acha a trava com um pid vivo **recusa começar** e diz quem a tem; uma trava de pid morto é de uma campanha que foi morta e é tomada; uma trava ilegível é recusada em vez de adivinhada; a trava é solta no fim, qualquer que seja o fim, e só por quem a tem. Ela é tomada antes do `prepare()` do lançador, porque provisionar uma cópia também é um processo do Godot. Protege uma máquina de duas campanhas; o que pega as outras faixas do repositório é a regra da carga.

## O lançador

```text
launcher.build                  "debug" | "release", o build gravado em cada execução
launcher.windowed               se os processos rodam numa janela; o autoteste roda no mesmo modo
await launcher.prepare()        {engine, registered, packages, deviations}: pronto, e o que se registra antes da primeira execução; pode recusar
await launcher.launch({arm, lane, slot, attempt})
                                {report, exitCode, signal, log, load: {before, after}, hashes: {binary, package, script}, seconds}: UM processo novo
await launcher.cleanup()
```

- **Debug** reaproveita a parte 1: a cópia provisionada do civ-lite com o HUD construído e o cenário copiado (`prepareProject`), e `launchScenario` (`--path`, headless). Registra o que mediu, como o ensaio da parte 1, e seus desvios dizem isso.
- **Release** é um ponto de extensão e **recusa** (`--build release`): "The Release launcher is not defined yet: the campaign needs the Release export of the civ-lite game in the three arms (V05-07, the macOS export), and that slice has not said how the scenario ... runs inside an exported .app ... Nothing was run and no campaign directory was made." Recusa no `prepare()`, antes do autoteste e de qualquer processo, até o V05-07 definir o caminho. O Release **não foi inventado**.
- **O falso**, nos testes, joga execuções sintéticas programáveis: carga alta, janela não apresentada, erro, outro jogo, janela incompleta, processo sem relatório, vsync que lê `ENABLED`, interrupção, e um lançador janelado.

## As tentativas sem relatório

Um processo que não escreveu relatório no formato do cenário (um travamento, um estouro de tempo) é uma rejeição pela regra `errors`: conta nas 3 tentativas da vaga e é refeito. Mas o formato da campanha não tem objeto de execução para uma execução sem relatório (a taxa de atualização tem de ser positiva, as janelas e as leituras têm de existir), e a campanha **não inventa** um. A tentativa fica no estado e no `.log` guardado, **fica fora de `executions`** (que se renumeram 1, 2, ... entre as que existem) e os desvios da campanha a nomeiam. **O estado e o `summary.json` a listam, uma a uma** (`unreported`: a vaga, o braço, a tentativa, o motivo `errors` com sua cláusula, o código de saída, o sinal e o caminho do log), para que quem lê o resumo veja todas as tentativas feitas. Neste ensaio, `unreported` é `[]`: as três tentativas escreveram relatório. A análise vê menos tentativas do que as feitas, se isso ocorrer; a parada de 3 tentativas esgotadas é do orquestrador.

## O ensaio curto

Rodado pelo implementador, sobre o `a618d0e` com a árvore limpa, em 2026-10-10, pela linha de comando (as três tentativas, de 13:55:05 a 13:58:15 UTC), com a saída em `build/frontier-comparison-campaign-evidence/` (ignorada pelo git):

```sh
node scripts/frontier-comparison-campaign.mjs --campaign --lanes presented --build debug --rehearsal --slots 1-3 --assume-refresh-hz 60 --max-wait 0 --out build/frontier-comparison-campaign-evidence
```

Um display headless lê a taxa de atualização `-1` e o formato exige uma taxa positiva (a análise recusa `refreshHz <= 0`), então o ensaio assume 60 Hz e **diz isso**, nos desvios da campanha e no `rehearsal.json` (`assumedRefreshHz`: lido −1, assumido 60, nas três tentativas).

| | A | B | C |
| --- | --- | --- | --- |
| Rejeições da análise | `load:before`, `load:after`, `not-presented:intent-not-drawn`, `not-presented:idle-not-drawn`, `not-presented:not-paced`, `not-the-registered-build:build` | as mesmas | as mesmas |
| Anomalias, problemas do cenário | nenhum | nenhum | nenhum |
| Tentativas sem relatório | nenhuma | nenhuma | nenhuma |

O autoteste do instrumento rodou e passou, então o relatório da análise **não** sai `stopped` (como o da parte 1, cujo autoteste não rodou): sai `incomplete`, porque nenhuma tentativa foi aceita e nenhum braço tem as 10 execuções aceitas que a faixa apresentada pede. O formato da campanha passou em `campaignErrors`. As rejeições são as de um ensaio: o build Debug, um display headless que não desenha nem dá o ritmo do laço, e a carga de uma máquina que não está quieta. **Nada mais disparou.**

O ensaio também rodou como teste, no `npm run test:frontier-comparison-run`, que confere o autoteste real, a ausência de anomalias, as rejeições esperadas, a marca do ensaio, os desvios e os arquivos escritos (`tests/frontier-comparison-campaign-native.test.mjs`).

Os desvios da campanha, como o formato os guarda: é um ensaio e não é resultado; o build é Debug e não o export do V05-07 (o binário é o executável do motor e o pacote é a cópia provisionada); o registro é o do próprio ensaio (registra o que mediu, no mesmo processo que mediu); o tamanho do pacote é o da cópia, duas vezes; o ensaio não refaz; só as vagas 1 a 3 das 36 de cada faixa rodaram; a taxa de atualização assumida; e o autoteste rodou headless porque o lançador é headless, enquanto uma campanha real roda numa janela e tem o autoteste dela.

## O que falta para a campanha real

- **O V05-07, o export Release do jogo civ-lite** nos três braços (A e B também), **e o lançador Release**: como o cenário (um script `SceneTree` rodado com `-s`) roda dentro de um `.app` exportado, onde um template de export pode não rodar `-s`, está **em aberto** e é da fatia do V05-07. Até lá, `--build release` recusa.
- **Uma máquina quieta e o usuário ausente**: média de carga de 1 minuto de 2,0 ou menos antes e depois de cada execução e uma janela apresentada para as 36 execuções da faixa apresentada (e as 36 da sem limite), que o usuário vai reservar. A campanha espera a carga, mas não torna a máquina quieta.
- **O autoteste janelado, rodado de verdade** na máquina da campanha: um lançador janelado o roda antes de tudo (o probe com `--windowed`, uma janela na frente) e a campanha para se ele não passa ou se nenhum display apresentou a janela. O código existe e foi testado com o probe e o oráculo substituídos; nunca rodou.
- **O registro antes da primeira execução**, no Release: o ensaio registra o que mediu; a campanha real precisa que o lançador Release registre os hashes dos três exports no `prepare()`.
- **Uma representação, no formato da análise, de uma tentativa sem relatório**: se ela ocorrer na campanha real, o resumo a carrega (`unreported`), e um acerto do formato a poria nos dados.
- **Os dados brutos sob `docs/evidence/`**: o `raw/` de uma campanha tem cerca de 0,3 MB por tentativa (cerca de 22 MB para 75); onde fica e como se publica é da fatia que a roda.

## Reproduzir

```sh
node --test tests/frontier-comparison-campaign.test.mjs tests/frontier-comparison-campaign-state.test.mjs tests/frontier-comparison-campaign-guards.test.mjs   # só Node; parte de npm run test:contracts
npm run test:frontier-comparison-run                                   # nativo, headless: o jogador, o ensaio da parte 1 e o ensaio curto da campanha
node scripts/frontier-comparison-campaign.mjs --campaign --lanes presented --build debug --rehearsal --slots 1-3 --assume-refresh-hz 60 --max-wait 0 --out build/frontier-comparison-campaign-evidence
node scripts/frontier-comparison-analysis.mjs --check-format build/frontier-comparison-campaign-evidence/campaign.json
node scripts/frontier-comparison-analysis.mjs build/frontier-comparison-campaign-evidence/campaign.json --out build/report.json   # os mesmos bytes do report.json do orquestrador
node scripts/frontier-comparison-campaign.mjs --campaign --lanes presented --build debug --rehearsal --slots 1-3 --assume-refresh-hz 60 --max-wait 0 --out <o mesmo diretório> --resume   # continua um ensaio interrompido, com o commit e a árvore como eram
node scripts/frontier-comparison-campaign.mjs --campaign --lanes presented,unlimited --build release --out <diretório>   # recusa até o V05-07 definir o lançador Release
```

Os números do ensaio mudam de uma rodada para outra (a carga, os segundos, o hash do pacote, que depende do commit e da árvore): os da tabela e os SHA-256 são os desta rodada. Os hashes do protocolo, do binário e do roteiro, o replay e o soak não mudam.

## As verificações do commit de evidência

Preenchidas no commit de evidência, depois deste README.
