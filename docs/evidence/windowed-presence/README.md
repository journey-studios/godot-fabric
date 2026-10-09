# A janela das faixas janeladas desenhável, e o motivo de uma recusa por não desenhar: o registro

> **Registro fixado.** Os números, os fontes e os hashes abaixo são os das duas execuções sobre o commit de implementação
> [`1bc3a3c`](https://github.com/journey-studios/godot-fabric/commit/1bc3a3cc7d5d1a160f2158a87a5f8c623b504130) (árvore `5837a44a`, sobre a main `decc2ad`), e o recibo
> [`execution.json`](execution.json) os fixa. As duas faixas rodaram nesta ordem, uma vez cada, com a árvore limpa (`git status` vazio e `HEAD` em `1bc3a3c` antes da primeira, entre as duas e depois da segunda);
> os arquivos desta pasta e os documentos que apontam para eles foram escritos depois e não são entrada de nenhum comando. A [nota de pesquisa](../../research/windowed-presence.md) e esta página dizem os mesmos números.

Esta fatia é o achado do **V05-06 (GF-30)** do marco 0.5 Frontier: as faixas janeladas do [baseline](../../research/frontier-baseline.md) e do [turno](../../research/frontier-turn.md) recusaram corrida após corrida como `undrawn` enquanto o usuário usava o Mac
([as tentativas de 2026-10-09](../frontier-baseline/README.md#tentativas-janeladas-de-2026-10-09-não-apresentadas)), e nada no recibo dizia por quê. A [pesquisa](../../research/windowed-presence.md) lê o motivo na fonte do Godot 4.7.2: no macOS o engine **não desenha uma janela que o sistema diz
ocluída** (`godot_window_delegate.mm` 387-393 limpa `is_visible`; `window_can_draw` o devolve; `main/main.cpp` 5080-5097 pula o `RenderingServer::draw`, e com ele o `frame_post_draw`, **nos quadros em que `window_can_draw()` é falso**; o laço passa a dormir 6,9 ms por quadro). Isso explica os quadros que o helper conta como não desenháveis; uma execução `undrawn` em que todas as amostras dizem `window_can_draw() == true` **fica em aberto**, sem concluir que o draw foi pulado. A fatia põe a janela da faixa à frente das outras e acima delas
([`tests/window-presence.gd`](../../../tests/window-presence.gd): `Window.always_on_top` e `DisplayServer.window_move_to_foreground`) e **grava, a cada quadro de processo, se o engine podia desenhá-la** (`window_can_draw()`): cada tentativa do recibo ganha `undrawableFrames` (de `sampledFrames`), os recibos brutos ganham os trechos
desses quadros, e o motivo de uma recusa `undrawn` diz o que o engine disse da janela (em quantos quadros `window_can_draw()` foi falso, ou que nunca foi, caso em que a causa fica em aberto). **A regra de validade não mudou** (`drew && paced`), nenhum recibo antigo muda de veredito e **nenhum critério, peso ou denominador do 1.0 muda**: o critério `baseline` continua aberto, e esta página não é a entrega que o fecha.

Todo link de código abaixo está fixado no commit [`1bc3a3c`](https://github.com/journey-studios/godot-fabric/commit/1bc3a3cc7d5d1a160f2158a87a5f8c623b504130). Cada fonte executada, listada em `sourcePins` do recibo (11 arquivos), tem o mesmo SHA-256 que o blob desse commit: a árvore estava limpa nos três momentos acima.

| Faixa executada | Resultado | Observação |
| --- | --- | --- |
| Baseline janelado (`caffeinate -d node scripts/frontier-baseline-graphics.mjs`) | **APRESENTADA, código de saída 0** | 5 de 5 vagas aceitas na **primeira** tentativa de cada, nenhuma rejeitada; **0 de 25.469** quadros amostrados sem poder desenhar; janela de 800 × 600, vsync `enabled`, 120 Hz |
| Turno janelado (`caffeinate -d node scripts/frontier-turn-graphics.mjs`) | **APRESENTADA, código de saída 0** | 5 de 5 vagas aceitas na **primeira** tentativa de cada, nenhuma rejeitada; **0 de 68.379** quadros amostrados sem poder desenhar; janela de 1080 × 600; é a **primeira execução ao vivo** do caminho do turno com o helper |
| Usuário no Mac | **ausente nas duas** | o tempo ocioso de teclado e ponteiro cresceu tanto quanto o relógio, do início da primeira ao fim da segunda (cerca de 15 minutos) |
| Host anterior | **N/A** | A fatia não muda C++: não há host a comparar |

**Ambiente**: macOS 26.6.2 (25G83) arm64 num Apple M3 Pro (`Mac15,6`, 11 núcleos lógicos, 18 GB), tela embutida "Color LCD" (1512 × 982 pontos, 3024 × 1964 pixels, 120 Hz); Godot oficial 4.7.2 (`ed1daf0bf`) no `gl_compatibility` sobre `opengl3`, adaptador "Apple M3 Pro", vsync lido da janela como `enabled`;
Hermes 250829098.0.17; Node v22.23.3. O host nativo (`212d0f6e…`) é o mesmo nas duas faixas; os bundles são o do baseline (`7895d359…`) e o do turno (`fce50a0a…`).

## A presença do usuário e a carga

A presença é lida do `HIDIdleTime` do `IOHIDSystem` (os nanossegundos desde o último evento de teclado, ponteiro ou trackpad), antes e depois de cada faixa: se ele cresceu tantos segundos quanto o relógio andou, nenhum evento desses houve entre as duas leituras.

| Intervalo | De | A | Relógio (s) | `HIDIdleTime` cresceu (s) | Veredito |
| --- | --- | --- | ---: | ---: | --- |
| Baseline | 19:56:43Z (6.476,6 s) | 20:00:38Z (6.711,1 s) | 235 | 234,5 | sem evento |
| Entre as faixas | 20:00:38Z | 20:00:59Z (6.732,4 s) | 21 | 21,3 | sem evento |
| Turno | 20:00:59Z | 20:11:37Z (7.370,1 s) | 638 | 637,7 | sem evento |

Ninguém tocou no teclado nem no ponteiro durante as duas faixas, e a sessão não estava bloqueada ao fim (`IOConsoleLocked = No`). Isso **não** diz que ninguém olhou a tela, e entrada por outro dispositivo (Universal Control, compartilhamento de tela) pode não mover esse contador.

`vm.loadavg` (1, 5 e 15 minutos): antes do baseline `{ 5.41 5.71 7.07 }`, depois `{ 6.79 6.05 6.87 }`; antes do turno `{ 5.70 5.85 6.78 }`, depois `{ 5.77 6.18 6.44 }`. Cada tentativa traz o seu par nas tabelas abaixo. O Mac estava carregado (outros agentes): a média de um minuto ficou entre 5,3 e 7,6 em torno das tentativas.

## O baseline janelado

Janela de 800 × 600, 5 vagas × 1 tentativa, cerca de 46 s cada. `Sem desenhar` é `undrawableFrames` de `sampledFrames`: os quadros de processo, do fim da espera de abertura ao fim da medição, em que `window_can_draw()` leu falso. `Abertura` é o que o `open()` leu de volta: `alwaysOnTop` verdadeiro em todas, e quantos quadros e milissegundos levou até 12 quadros seguidos desenháveis.

| Vaga | Tentativa | Veredito | Sem desenhar | Desenhados de processados | Quadros ociosos desenhados | Ref. ociosa (ms) | Mediana ociosa (ms) | Com foco | Abertura | `loadavg` antes | depois |
| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | **aceita** | 0 de 5.120 | 5.117 de 5.133 | 601 de 600 | 8,339 | 6,022 | sim | 12 quadros, 97 ms | `{ 5.70 5.76 7.08 }` | `{ 5.38 5.66 6.97 }` |
| 2 | 2 | **aceita** | 0 de 5.112 | 5.109 de 5.125 | 601 de 600 | 8,336 | 7,928 | sim | 12 quadros, 88 ms | `{ 5.38 5.66 6.97 }` | `{ 5.26 5.60 6.89 }` |
| 3 | 3 | **aceita** | 0 de 5.082 | 5.079 de 5.095 | 601 de 600 | 8,334 | 4,580 | **não** | 12 quadros, 52 ms | `{ 5.26 5.60 6.89 }` | `{ 5.79 5.69 6.85 }` |
| 4 | 4 | **aceita** | 0 de 5.085 | 5.082 de 5.098 | 601 de 600 | 8,338 | 4,367 | sim | 12 quadros, 96 ms | `{ 5.79 5.69 6.85 }` | `{ 6.04 5.82 6.84 }` |
| 5 | 5 | **aceita** | 0 de 5.070 | 5.067 de 5.083 | 601 de 600 | 8,339 | 8,368 | **não** | 12 quadros, 33 ms | `{ 6.04 5.82 6.84 }` | `{ 6.16 5.92 6.82 }` |

A run das capturas (sem medição) amostrou 60 quadros e nenhum sem poder desenhar. As quatro capturas estão no recibo bruto, com o SHA-256 de cada (`baselineLane.captures` do `execution.json`).

## O turno janelado

Janela de 1080 × 600, 5 vagas × 1 tentativa, cerca de 2 minutos cada (o tour de cada rodada tem cliques e 4 turnos; 2 rodadas de aquecimento e 30 medidas).

| Vaga | Tentativa | Veredito | Sem desenhar | Desenhados de processados | Quadros ociosos desenhados | Ref. ociosa (ms) | Mediana ociosa (ms) | Com foco | Abertura | `loadavg` antes | depois |
| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | **aceita** | 0 de 13.696 | 13.696 de 13.707 | 601 de 600 | 8,337 | 6,475 | sim | 12 quadros, 164 ms | `{ 5.94 5.91 6.76 }` | `{ 5.35 5.72 6.57 }` |
| 2 | 2 | **aceita** | 0 de 13.689 | 13.689 de 13.700 | 601 de 600 | 8,336 | 8,868 | sim | 12 quadros, 140 ms | `{ 5.35 5.72 6.57 }` | `{ 5.61 5.76 6.48 }` |
| 3 | 3 | **aceita** | 0 de 13.657 | 13.657 de 13.668 | 601 de 600 | 8,341 | 4,302 | sim | 12 quadros, 134 ms | `{ 5.61 5.76 6.48 }` | `{ 5.36 5.73 6.38 }` |
| 4 | 4 | **aceita** | 0 de 13.643 | 13.643 de 13.654 | 601 de 600 | 8,339 | 5,495 | sim | 12 quadros, 126 ms | `{ 5.36 5.73 6.38 }` | `{ 7.55 6.28 6.50 }` |
| 5 | 5 | **aceita** | 0 de 13.694 | 13.694 de 13.705 | 601 de 600 | 8,333 | 10,623 | sim | 12 quadros, 141 ms | `{ 7.55 6.28 6.50 }` | `{ 5.71 6.19 6.44 }` |

A run das capturas amostrou 421 quadros e nenhum sem poder desenhar; as sete capturas (uma por contexto do jogo) estão no recibo, com o SHA-256 de cada.

Em todas as dez execuções a referência ociosa (a mediana das meias-somas de pares consecutivos dos intervalos ociosos) ficou entre 8,333 e 8,341 ms, o período de 120 Hz (8,333 ms), e a janela desenhou nove de cada dez quadros ociosos ou mais com folga (601 desenhos em 600 intervalos). A mediana ociosa pura, que já não julga, cai de um grupo ao outro dos intervalos (4,3 a 10,6 ms),
como a [nota do baseline](../../research/frontier-baseline.md#the-idle-reference-three-statistics-over-the-raw-intervals-of-2026-10-09) descreve.

**As estatísticas de tempo de quadro dos dois recibos não são publicadas aqui.** Os recibos as trazem, recalculadas dos intervalos brutos; elas pertencem à entrega que fecha o critério `baseline` (e à que fecha o `turno` no comparativo), não a esta fatia, que não muda nenhum critério.

## A execução exploratória, antes do commit

Antes do commit, a faixa do baseline rodou uma vez sobre a árvore de trabalho, e um comentário de `tests/window-presence.gd` foi editado no meio dela (o arquivo tinha SHA-256 `1df96e7f…` no início e `0ee6ce5f…` no fim; o código era o mesmo). **Ela não é a evidência desta página**, porque rodou sobre código que nenhum commit guarda, e fica citada como observação exploratória:
apresentada, 5 de 5 vagas na primeira tentativa, 0 de 25.337 quadros sem poder desenhar, ninguém no Mac (o tempo ocioso foi de 5.470 s para 5.743 s). O recibo dela tem SHA-256 `6cf08c41…` (438.023 bytes) e não é commitado. Os números desta página são os das duas execuções sobre o commit.

## Os recibos brutos e os fontes

Os recibos brutos **não são commitados** (são grandes, e `docs/evidence/**/*-report.json` é ignorado); ficam fora do repositório, e os SHA-256 abaixo os fixam. O `verifyGraphicsReceipt` aceitou os dois antes de os gravar.

| Arquivo | Bytes | SHA-256 |
| --- | ---: | --- |
| `frontier-baseline-graphics.json` | 437.679 | `36b32e0d6d1418af122260aa453bdd77bd9619811181731a88855a1e526e13b7` |
| `frontier-turn-graphics.json` | 1.539.885 | `8dd6ec9cf4776a8026c3056c337da9a9bb7c811b6b529f05c1ecee3ca111e90f` |
| saída do baseline (`.log`) | 4.377 | `d472f960e055f9d908428d67ee2d76fde4bc9c7420087014758f2ba12c74b751` |
| saída do turno (`.log`) | 9.672 | `7cd898aa722470a911f0be7943f0d2e5bbc1f09b7fcafc0290417d908f095d7f` |
| recibo da execução exploratória (antes do commit) | 438.023 | `6cf08c41ba6b9e5a5774b0ffd1318ab2bf6eff3518696dfe2f41c70f1066874a` |

Os fontes executados (`sourcePins`, o mesmo SHA-256 que o blob de `1bc3a3c`): `tests/window-presence.gd` `0ee6ce5f…`, `tests/frontier-baseline-graphics-probe.gd` `dae47afe…`, `tests/frontier-baseline-swap.gd` `31c9e6ce…`, `tests/frontier-baseline-oracle.mjs` `a55e1d85…`, `scripts/frontier-baseline-graphics.mjs` `c974c68b…`,
`tests/frontier-turn-probe.gd` `b750a1e2…`, `tests/frontier-turn-runner.gd` `35f93244…`, `tests/performance-sampler.gd` `1c0020bc…`, `tests/frontier-turn-oracle.mjs` `0cad0833…`, `scripts/frontier-turn-graphics.mjs` `63e514f7…` e `scripts/frontier-turn-lane.mjs` `e8dd315d…` (inteiros no `execution.json`).

**Depois da execução**, a revisão do PR mudou, sem tocar no que as faixas medem: comentários de `tests/window-presence.gd` e dos scripts, o texto do motivo de uma recusa `undrawn` (que agora diz quantos quadros tiveram `window_can_draw()` falso e não nomeia causa; uma execução em que ele nunca foi falso fica em aberto) e o `verifyGraphicsReceipt`, que passou a exigir que a contagem de cada tentativa seja a do `presence` do seu recibo
bruto. Os dois recibos de `1bc3a3c` continuam aceitos pelo `verifyGraphicsReceipt` novo, e os `sourcePins` acima seguem sendo os do commit executado.

## O que isto mostra, e o que não mostra

- **Mostra** que o helper abre uma janela que o engine pode desenhar numa execução real, nas duas faixas; que o registro por quadro é gravado, verificado e aparece em cada tentativa; e que o caminho do turno com o helper roda ao vivo (a primeira vez) e fecha as cinco vagas.
- **Não mostra** que o helper vence interferência. Ninguém estava no Mac, e nada cobriu a janela da faixa em momento algum. Se a janela à frente e acima continua desenhando enquanto o usuário trabalha, troca de Space ou põe uma janela flutuante por cima, só uma execução com o usuário presente responde, pelo `undrawableFrames` e pelo motivo de uma recusa.
- **Não mostra** que o helper causou o resultado: no mesmo dia, mais cedo, a vaga 3 do baseline nunca fechou com o usuário presente, e agora as cinco fecharam com o usuário ausente. As duas situações diferem na presença do usuário e no helper, e esta página não separa uma do outro.

## Limites

- **Sem o usuário presente**, a execução não prova que o helper vence interferência (acima).
- **Tela travada ou apagada** não é coberta: `caffeinate -d` só mantém acordada uma tela que já está acordada, e o helper torna a janela uma que o sistema não tem motivo de esconder, não uma que a tela mostre. Uma tela bloqueada que ainda desenha e não pacea o laço cai na regra `unpaced`, não nesta; se ela limpa a flag do engine, não se sabe.
- **A captura não tem limite próprio**: o run das capturas espera `frame_post_draw` sem um limite seu, e uma janela que não pudesse desenhar o seguraria até o limite de tempo do processo do script (10 minutos). O helper torna isso improvável, não o remove.
- **A contagem é da flag do engine** (`DisplayServer.window_can_draw()`, lida no início de cada quadro de processo), não do que a tela mostrou; a amostra e a decisão de desenhar do mesmo quadro só diferem se uma notificação cair entre as duas, o que a pesquisa toma como não acontecendo (uma inferência da fonte).
- **Os quadros amostrados são menos que os de processo**: o helper amostra do fim da espera de abertura (12 quadros) ao fim da medição.
- Uma máquina, uma tela, um modo de vsync; local apenas, as faixas janeladas nunca rodam no CI hospedado.

## Reproduzir

```sh
caffeinate -d node scripts/frontier-baseline-graphics.mjs   # o recibo em build/frontier-baseline-graphics.json; sai com 3 se não apresentada
caffeinate -d node scripts/frontier-turn-graphics.mjs       # o recibo em build/frontier-turn-graphics.json; sai com 3 se não apresentada
```

Acorde e desbloqueie a tela antes. O recibo de cada tentativa traz `undrawableFrames` e `sampledFrames`; os brutos, os trechos dos quadros sem poder desenhar (`presence.spans`).
