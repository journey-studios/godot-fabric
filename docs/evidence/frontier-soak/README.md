# O soak do Frontier: 100 turnos em três processos, uma pausa que mantém a UI viva e a escolha entre montar e ocultar um painel

> **Registro fixado.** Os números, os fontes e os hashes abaixo são os da execução sobre o commit de implementação `dd67671` (a fatia inteira, sobre a main
> `3bb51d6`) e o recibo [`execution.json`](execution.json) os fixa. Os comandos rodaram nesta ordem e em sequência, com a árvore limpa (todo fonte rastreado
> igual ao do commit); os arquivos desta pasta e os documentos que apontam para eles estavam no working tree, sem commit, e não são entrada de nenhum comando.
> A nota de pesquisa e este registro dizem os mesmos números.
>
> **Depois do registro, sobre a main com o #82.** O merge `a27156b` traz o P8 V05-05 slice 1 (#82), que registra no nó do jogo o estado `frontier.hover` (o cartão do tile
> sob o ponteiro): o registro de serviços passa de **14 para 15 bindings**. Rodado sobre `a27156b`, o soak reprovou um único check, o que conta os bindings (`scene/The registry holds the 14 bindings…`,
> com 15 no registro), e nada mais se moveu: o mesmo hash final e da trilha (`a35c55f2…`, `fe9d4f36…`), o mesmo heap em repouso (2.117.320 e 2.443.832 bytes, crescimento 0), as mesmas
> contagens de views nativas, 0 erros, a mesma pausa, e 2 subscrições. É uma contagem e não uma regra: a expectativa do probe e do oráculo passou de 14 para 15 (`BINDINGS`, comentada nos dois), e a suíte
> passa de novo em `a27156b` com a expectativa trocada (34/34 em cada execução, 67,7, 67,2 e 67,3 s; `test:frontier-services` 11/11; `type-check` limpo). Os números, os `sourcePins` e as tabelas deste
> registro continuam os de `dd67671` (nesse commit a contagem era 14, e as linhas "2 e 14" abaixo dizem 14); as sabotagens não foram rodadas de novo, porque só a contagem mudou.

Esta fatia fecha o critério `soak` do V05-06 do marco 0.5 Frontier (pacote P6): o jogo Frontier jogado por 100 turnos, em 3 execuções, em 3 processos Godot, pelos serviços
tipados, por um jogador roteirizado e um HUD React Native que abre e fecha todo turno um painel de 100 nós nativos. A pergunta tem quatro partes: é o mesmo jogo todas as vezes
(hash final e trilha idênticos), nada cresce (nós, órfãos, heap e memória residente estáveis, 0 erros JS não tratados), a pausa do jogo deixa a UI viva, e o que custa montar e desmontar
um painel grande contra mantê-lo oculto. O [recibo](execution.json) fixa fontes, hashes, contagens, proveniência e resultados; a [nota de pesquisa](../../research/frontier-soak.md)
tem a cena, o jogador, as regras, a pausa e a decisão. Os critérios `turno` e `congelado` do V05-06 seguem abertos.

Todo link de código abaixo está fixado no commit
[`dd67671`](https://github.com/journey-studios/godot-fabric/commit/dd6767182bbf02d0c0de579fadf632bdeda7f8e1) (árvore `5d14a1fa`, SHA completo no recibo). Cada fonte executada,
listada em `sourcePins` do recibo (48 arquivos), tem o mesmo SHA-256 que o blob desse commit, conferido ao gerar o recibo.

| Lane executada | Resultado | Observação |
| --- | --- | --- |
| Suíte headless, 3 processos Godot (unmount, hide, unmount) | 34/34 checks em cada | 100 turnos completos por processo, 427 decisões do jogador, as 427 aceitas pelo jogo; 100 jobs, cada um com 7 snapshots em 7 quadros consecutivos e 1 `turn_ended`; o oráculo independente aceita os 3 relatórios e os 3 juntos |
| Hash do jogo | **idêntico nas 3 execuções**: final, trilha e o hash de cada um dos 100 turnos | final `a35c55f2…de598`, trilha `fe9d4f36…16e0f`, mesmo com a estratégia do painel diferente na segunda |
| Negativos do oráculo sobre relatório gravado | 25 rejeitados, 3 forks de execuções rejeitados, 1 decisão falsa rejeitada, 5 aceitos | cada rejeição pelo motivo para o qual foi escrita; os 5 aceitos não são vazamento (transitório de 2.056 bytes, subida de exatamente o limite do heap, RSS que cai 30 MiB, que sobe 30 MiB e que sobe exatamente 48 MiB) |
| Sabotagem `listener-leak` | rejeitada | 2 checks do probe; oráculo: "The live heap at rest rose 335128 bytes…" |
| Sabotagem `nondeterministic-player` | rejeitada | 0 checks do probe (cada jogo é legal), 2 processos; oráculo: "Execution 2: the final hash is the first's" |
| Sabotagem `pause-kills-ui` | rejeitada | 2 checks do probe; oráculo: "The HUD answered while the game was paused…" |
| Sabotagem `leaky-hide` | rejeitada | 2 checks do probe; oráculo: "base: the HUD holds the native views its state gives…" |
| Host anterior | **N/A** | A fatia não muda C++: não há host a comparar; o controle são as quatro sabotagens |

As quatro sabotagens quebram uma fonte de propósito (`scripts/frontier-soak-sabotage.mjs`, com `guardSources`): o arquivo de veredito de cada variante é apagado antes de rodá-la e um
arquivo ausente conta como não rejeitada; cada rejeição do oráculo tem de casar com o motivo para o qual a variante foi escrita; as fontes voltam byte a byte (SHA-256 igual antes e depois,
no recibo) e o script termina com uma rodada da fonte genuína, que passou (66,7, 66,3 e 67,6 s).

**Ambiente**: macOS 26.6.2 (25G83) arm64 num Apple M3 Pro (`Mac15,6`, 11 núcleos lógicos, 18 GB); Godot oficial 4.7.2 (`ed1daf0bf`), RN 0.87.1, React 19.2.3, Hermes 250829098.0.17 e Node v22.23.3.
A suíte roda em modo headless (`opengl3` nomeado, sem display). O host nativo é o da main, compilado por `npm run setup` nesta árvore (`c5475bff…`); a fatia não o muda.

**Carga do sistema**. O Mac não estava ocioso: outros agentes rodavam trabalho ao mesmo tempo, na mesma máquina (inclusive suítes Godot em outras worktrees). O `vm.loadavg` antes e depois de cada comando:

| Comando | `vm.loadavg` antes | depois | Duração |
| --- | --- | --- | ---: |
| `npm run test:frontier-soak` | `{ 3.58 5.74 7.85 }` | `{ 4.58 5.39 7.26 }` | 204,3 s (3 execuções de 67,0, 66,6 e 66,9 s) |
| `node scripts/frontier-soak-sabotage.mjs` | `{ 5.33 5.53 7.27 }` | `{ 2.04 3.25 5.23 }` | 586,1 s |

Os tempos abaixo são, portanto, uma linha de base desta máquina **como ela estava**, e não o seu melhor caso; as contagens exatas e os hashes não dependem disso.

Os comandos, na ordem em que rodaram:

```sh
npm run test:frontier-soak
node scripts/frontier-soak-sabotage.mjs
```

> **CI hospedada pendente.** O passo `npm run test:frontier-soak` e o artefato `native-frontier-soak` do workflow `contracts.yml` ainda não rodaram na CI hospedada. Tudo o que esta página registra
> é evidência local, em macOS arm64, headless.

## O jogo é o mesmo

Três execuções, uma por processo, a segunda com a estratégia B (o painel fica montado e oculto). O hash é o SHA-256 da serialização canônica do jogo (o oráculo o recalcula de cada serialização), a
trilha é o SHA-256 dos 100 hashes de turno, cada um seguido de uma quebra de linha.

| Execução | Estratégia | Duração | Hash final | Hash da trilha |
| ---: | --- | ---: | --- | --- |
| 1 | unmount (A) | 67,0 s | `a35c55f2def40a3bc6e78ac762ff47aaf27459a4fd0fdc7095dc5107c88de598` | `fe9d4f367b796b2743118aa37755c92541e88d5a7155ed0ac0d24eefd0b16e0f` |
| 2 | hide (B) | 66,6 s | o mesmo | o mesmo |
| 3 | unmount (A) | 66,9 s | o mesmo | o mesmo |

Os 100 hashes de turno estão no recibo (`soak.turnHashes`), distintos entre si e iguais nas três. O jogo termina no turno 101 com a única cidade (tamanho 3, os três prédios), seis unidades do
jogador e o Guerreiro da facção roteirizada. O jogador toma 427 decisões por execução (201 `select_tile`, 100 `clear_selection`, 100 `end_turn`, 8 `set_production`, 7 `select_unit`, 6 `fortify`, 3
`set_research`, 1 `found_city`, 1 `resolve_event`) e o JavaScript recebe 1.028 snapshots e 100 `turn_ended`. Do turno 14 em diante o jogador faz as mesmas quatro coisas a cada turno (o tamanho do exército é limitado
a 6 de propósito: um heap que cresce porque o jogo cresce seria um veredito sobre o exército, não sobre o runtime).

## Estabilidade (as três execuções)

Em cada execução o probe faz 529 leituras leves (depois de cada intenção que muda a seleção, com a aplicação quieta por 6 quadros) e 100 leituras em repouso (uma por turno, depois de 30 quadros
ociosos), com o sampler compartilhado do GF-30.

| Critério | Regra | Resultado |
| --- | --- | --- |
| Nós Godot | a SceneTree e o monitor de nós são as views nativas do host mais uma constante (9), em uma raiz | em todas as leituras, nas três |
| Órfãos | nenhum além do da base (0) | em todas as leituras, nas três |
| Views nativas por contexto, painel desmontado | iguais toda vez que o mesmo contexto volta (a fórmula do HUD, recalculada pelo oráculo) | `none` 16, `tile` 18, `city` 18, `warrior` 20, `settler` 22, `stack` 22, `dialog` 23; com o painel oculto, os mesmos +100 |
| Heap do Hermes em repouso | `heapAtRest` do oráculo do baseline (importado): mediana das 49 últimas voltas estáveis menos a das 49 primeiras ≤ 2.048 bytes, após coleta forçada | crescimento **0**: 2.117.320 → 2.117.320 (A), 2.443.832 → 2.443.832 (B), 2.117.320 → 2.117.320 (A) |
| Memória residente | mediana da segunda metade menos a da primeira ≤ **48 MiB (49.152 KB)** | −96.528 KB, −15.760 KB e −37.520 KB (ver abaixo) |
| Erros | `errors` do host e do registro em 0 em toda leitura; 0 erros e 0 rejeições não tratadas em JS; nenhum `FABRIC_ERROR` no log | 0 em tudo |
| Controle do handler | uma rejeição proposital depois do soak, que o rastreador do Hermes tem de ver | 1 vista (o "zero" não é cegueira); o runtime não tem `ErrorUtils`, e o rastreador de rejeições e a lista `errors` do host são os dois vigias |
| Subscrições e bindings do registro | constantes | 2 e 14 em toda leitura (um `connect` nunca removido as faria crescer) |

**Memória residente.** Por execução, o RSS dos turnos estáveis, em KB, primeira e última metade (mediana), e a faixa (mínimo a máximo):

| Execução | 1ª metade | 2ª metade | Diferença | Faixa na execução |
| ---: | ---: | ---: | ---: | --- |
| 1 (A) | 204.384 | 107.856 | −96.528 | 104.480 a 240.448 (136 MB) |
| 2 (B) | 186.160 | 170.400 | −15.760 | 161.776 a 195.296 (34 MB) |
| 3 (A) | 194.384 | 156.864 | −37.520 | 151.760 a 240.624 (89 MB) |

O RSS caiu nas três execuções desta rodada. Nas quatro rodadas que se fizeram deste código (12 execuções), a diferença entre as metades foi de −96,5 a **+10,1 MB** e a faixa dentro de uma execução de 34 a 137 MB, então o limite
foi **48 MiB** (era 16 MiB; a maior subida vista, +10,1 MB, já era mais da metade desse limite, e uma verificação não deve depender do ruído de um runner hospedado). É uma guarda grosseira: o detector de vazamento é o heap.
Um vazamento sustentado de ~1 MiB por turno (≈49 MiB entre as medianas, que estão 49 turnos afastadas) ainda reprova; um vazamento nativo menor que isso não é visto por nenhuma das duas regras. A medida inclui as leituras que o
próprio probe guarda (a memória estática do Godot foi de 27,2 para 36,8 MB na execução, só registrada). A subida de exatamente 48 MiB passa, 48 MiB + 1 KB reprova, +30 MiB passa e uma rampa sintética de 1 MiB por turno reprova.

**O aquecimento.** O heap em repouso tem um degrau na primeira vez em que o botão do marcador é clicado (1.744 bytes com unmount e 2.360 com hide, em rodadas de desenvolvimento de uma primeira versão, não retidas); com a pausa no meio do
soak, o degrau cairia entre as duas metades e reprovaria uma execução sem vazamento. O probe clica o marcador duas vezes no segundo turno (um turno de aquecimento), e as execuções retidas não têm degrau. A causa não foi isolada (a suspeita
é código compilado preguiçosamente pelo Hermes).

## A pausa (turno 50)

O probe põe `paused = true` no mesmo quadro em que envia o `end_turn`. A chamada é uma task do registro, que a `FabricApplication` roda porque sempre processa (`native/fabric_application.cpp:111`, `PROCESS_MODE_ALWAYS`), então
o job é aceito (job 50, o snapshot `ai_plan` publicado) e o nó que o avança, um filho pausável da raiz, não roda. Mantida por 60 quadros:

| O que se vê | Resultado |
| --- | --- |
| A fase | continua `ai_plan`; o job 50 continua o job em andamento |
| Snapshots publicados e `turn_ended` | só o da aceitação (1 linha); nenhum `turn_ended` |
| A aplicação | bombeou 60 vezes nos 60 quadros |
| A UI | um clique sintético no botão do marcador chega ao handler (contador 2 → 3), o React muda o estado e o marcador é um nó nativo no snapshot da Surface; um segundo clique o remove (contador 4) |
| Depois de despausar | o job termina: 7 snapshots (o da aceitação no quadro 4583 e os outros seis nos quadros 4661 a 4666, um por quadro) e 1 `turn_ended` no quadro 4666, turno 51, `last_job` 50 |

A UI só fica viva porque a `CanvasLayer` do HUD é `PROCESS_MODE_ALWAYS`: a Surface ouve o ponteiro em `_input`, e um nó pausável não o recebe. A sabotagem `pause-kills-ui` torna a camada pausável e o clique nunca chega ao handler.
`consumers/civ-lite/main.tscn` (o V05-05) tem uma `HUDLayer` sem modo de processo: **a recomendação de marcá-la `PROCESS_MODE_ALWAYS` não foi aplicada** (outro dono).

## Montar × ocultar um painel de 100 nós

O mesmo painel (o de pesquisa do baseline: 49 chips, **100 nós nativos**) abre e fecha uma vez por turno, por clique real, no contexto da cidade. **A (unmount)** o renderiza só enquanto aberto; **B (hide)** o mantém montado e, fechado, dá à sua raiz
`opacity: 0` e `pointerEvents="none"` (com o corpo memoizado). A CPU é o tempo da injeção e do flush do clique (como no baseline), num laço headless sem ritmo: **custo de CPU, não tempo de quadro**. Mediana sobre os 98 turnos estáveis
de uma execução, e sobre as duas de A.

| | A: unmount | B: hide |
| --- | ---: | ---: |
| Views nativas, painel fechado (contexto da cidade) / aberto | 18 / 118 | 118 / 118 |
| Abrir: nós do host criados / apagados / atualizados | 100 / 0 / 1 | 0 / 0 / 101 |
| Fechar: nós do host criados / apagados / atualizados | 0 / 100 / 1 | 0 / 0 / 101 |
| Abrir, CPU do clique, p50 / p95 / máx | 14,2 / 18,8 / 27,4 ms | 9,0 / 11,3 / 12,1 ms |
| Fechar, CPU do clique, p50 / p95 / máx | 5,2 / 6,4 / 7,3 ms | 8,9 / 11,5 / 12,0 ms |
| Abrir e fechar, p50 somados | 19,4 ms | 17,9 ms |
| Heap vivo em repouso, painel fechado | 2.117.320 bytes | 2.443.832 bytes (**+326.512**) |
| RSS em repouso, mediana (faixa de 34 a 137 MB numa execução; só registrado) | 156 e 157 MB | 172 MB |
| a2: o mundo ouve o clique onde está o painel fechado | 100 de 100 turnos | 100 de 100 turnos |
| a2: o mundo ouve o clique onde está o painel aberto | 0 de 100 | 0 de 100 |

Um painel oculto com `pointerEvents="none"` não reivindica o mapa (o painel aberto reivindica, como o a2 diz). Se um painel com `opacity: 0` **sem** `pointerEvents="none"` reivindica o mapa não foi medido.

As quatro rodadas deste código (as três anteriores não ficam fixadas), A abrir p50 / p95, A fechar p50, B abrir p50 / p95, B fechar p50:

| Rodada | A abrir | A fechar | B abrir | B fechar |
| --- | ---: | ---: | ---: | ---: |
| anterior 1 | 9,4 / 18,1 ms | 2,7 ms | 7,0 / 10,2 ms | 7,3 ms |
| anterior 2 | 12,4 / 20,2 ms | 3,8 ms | 7,9 / 10,6 ms | 7,4 ms |
| anterior 3 | 16,7 / 20,7 ms | 5,1 ms | 9,2 / 10,8 ms | 8,8 ms |
| **fixada** | **14,2 / 18,8 ms** | **5,2 ms** | **9,0 / 11,3 ms** | **8,9 ms** |

Os tempos andam em dezenas de por cento de uma rodada para outra, na máquina compartilhada; só valem como conclusão as diferenças que se mantiveram nas quatro:

- Ocultar **não é mais barato na soma de abrir e fechar** (17,9 ms oculto contra 19,4 desmontado aqui; 14,3 contra 12,1, 15,2 contra 16,2 e 18,0 contra 21,8 nas anteriores: o sinal da diferença mudou).
- Ocultar dá uma **cauda menor na abertura** (p95 de 11,3 contra 18,8 ms aqui; de 10,2 a 10,8 contra 18,1 a 20,7 nas outras) e um **fechamento mais caro** (8,9 contra 5,2 ms aqui), nas quatro.
- Ocultar **segura memória que não volta**: 100 nós nativos e 326.512 bytes de heap por painel mantido oculto.
- O host atualiza os 101 nós do painel a cada toggle do oculto (os contadores acima); a causa não foi investigada.

**Decisão (uma recomendação para o HUD do V05-05, que esta fatia não muda): desmontar por padrão; ocultar um painel só quando as três condições valem.**
(1) O painel tem da ordem de 100 nós nativos ou mais (um de 50 nós monta em 5,1 a 6,2 ms na mediana, segundo o baseline). (2) Abre com frequência e no clique que o jogador espera, de modo que o p95 da abertura pesa mais que a memória e o
fechamento mais lento. (3) No máximo um ou dois painéis ocultos por vez (cada um segura os seus nós e uns 330 KB de heap pela vida da tela), com `pointerEvents="none"` na raiz e o corpo que não depende de estar visível (memoizado). Para o HUD do
0.5, os seis painéis (50 a 100 nós) ficam desmontados quando fechados; se o congelamento achar a abertura do painel de pesquisa (p95 de 18,8 ms aqui) acima do orçamento, esse é o candidato a ocultar. O p95 da abertura do mesmo painel no baseline
foi 12,4 ms; o limite proposto lá (16 ms no p95) não se sustentaria aqui, com um HUD maior ao redor e a máquina carregada: uma observação para o congelamento, não um resultado desta fatia.

## Sabotagens retidas

`node scripts/frontier-soak-sabotage.mjs` quebra uma fonte de propósito, roda a suíte (`--sabotage=<nome>`, que reempacota a fonte quebrada) e exige que o probe e o oráculo rejeitem a execução, o oráculo pelo motivo da variante.

| Variante | O que quebra | Probe | Oráculo |
| --- | --- | --- | --- |
| `listener-leak` | o fixture reconecta `frontier.snapshot` no fim de cada turno e nunca remove a conexão | 2 checks: as subscrições do registro e o heap em repouso | "The live heap at rest rose 335128 bytes from the median of the first half (49 rounds)…" |
| `nondeterministic-player` | o jogador pula ao acaso (`Math.random`) a decisão de produção de um turno; 2 processos | nenhum: cada jogo é legal e o probe vê um | "Execution 2: the final hash is the first's" |
| `pause-kills-ui` | a camada do HUD no probe é pausável em vez de `PROCESS_MODE_ALWAYS` | 2 checks: a camada é ALWAYS e o HUD responde com o jogo pausado | "The HUD answered while the game was paused: each click reached its handler once" |
| `leaky-hide` | a estratégia B oculta com `display: "none"` em vez de `opacity: 0` | 2 checks: abrir um painel oculto não cria nem apaga nós e fechá-lo mantém os nós | "base: the HUD holds the native views its state gives (context none, 1 actions, panel closed)" |

O `leaky-hide` é o achado do baseline em ação: um `View` com `display: "none"` não monta nó nenhum neste host, então o painel "oculto" é na verdade desmontado e a tabela da decisão (um painel oculto segura os seus 100 nós) seria falsa.

O oráculo é ainda posto à prova sobre um relatório gravado e alterado, sem nada a reconstruir: 25 alterações que ele tem de rejeitar cada uma pelo seu motivo (um nó, um órfão ou uma view nativa que se desvia; um painel oculto contado como desmontado;
um heap que cresce 3.000 bytes, 2.049 e 200 bytes por turno; um RSS que cresce o limite mais 4 MiB, o limite mais 1 KB e 1 MiB por turno; uma intenção recusada; uma rejeição não tratada; um handler que não vê nada; uma subscrição nunca removida; um job que
termina duas vezes; uma fase que avança na pausa; uma UI que não responde; um marcador que nunca aparece; uma pausa curta demais; sem aquecimento; um painel fechado que reivindica o mapa; um aberto que não; um hash forjado; um soak abortado; um painel oculto que apaga nós),
3 formas de bifurcar duas execuções, 1 que faz o painel oculto segurar tantos nós quanto o desmontado, e 5 que ele tem de aceitar por não serem vazamento. A lista completa está em `soak.oracle.negatives` do recibo.

## Host anterior

**N/A: a fatia não muda C++.** Não há host anterior a comparar; o controle são as quatro sabotagens acima, mais os negativos do relatório gravado.

## Limitações

- **Headless e cliques sintéticos**: os eventos são entregues pelo `Input.parse_input_event`; não há ponteiro de hardware, tela de toque real, iPhone nem exportação móvel, e nenhum tempo de quadro de uma janela apresentada (os tempos são o custo de CPU num
  laço que nada freia). A pausa é `SceneTree.paused`, não o ciclo de vida de um telefone.
- **Uma máquina sob carga**: um Apple M3 Pro dividido com outros agentes; o `loadavg` está registrado antes e depois de cada comando e os tempos variam em dezenas de por cento de uma rodada para outra (a tabela das quatro rodadas acima), então só
  as diferenças que se mantiveram são conclusão.
- **As 101 atualizações por toggle do painel oculto não estão explicadas**, e se existe um jeito mais barato de ocultar um painel (uma prop de cada vez, outra estrutura) está em aberto; ele moveria a decisão.
- **A recomendação de `PROCESS_MODE_ALWAYS` para a camada do HUD da cena do V05-05 não foi aplicada** (`consumers/civ-lite/main.tscn` é de outro dono); a UI do jogo pausado só fica viva com ela.
- **O RSS é uma guarda grosseira** (48 MiB entre as medianas das metades, sobre faixas de 34 a 137 MB): não vê um vazamento nativo menor que ~1 MiB por turno, e o heap só julga o heap do JavaScript.
- O rastreador de rejeições do Hermes reporta de um timer e não na rejeição; o soak espera 2,3 s antes de ler a contagem e o controle é um `TypeError`. O runtime não tem `ErrorUtils`.
- O HUD é um fixture e o jogador uma regra fixa sobre um jogo que para de mudar no turno 14 (sem o orçamento de 64 tarefas e 128 eventos, que o caso de estresse dos serviços cobre).
- **`turno` e `congelado`** do V05-06 seguem abertos: a latência clique até painel, o tempo de quadro num turno com IA fatiada e a medição no consumidor do jogo são do `turno`; o congelamento do orçamento é um ato posterior e único.
- **CI hospedada pendente**.
- O host anterior não se aplica (nenhum C++ mudou).
