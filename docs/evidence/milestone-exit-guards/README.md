# As guardas das saídas X9 e X10 do 0.5: a 1.0 não se move e a cauda continua congelada

Esta entrega transforma duas saídas do marco 0.5 Frontier em verificações que rodam: **X9** ("A 1.0 não se move: diff de tasks, phases, sequences, checklists
e decisions vazio; summarize() idêntico com e sem milestones") e **X10** ("Cauda congelada: 0 fatias novas de pointer-*, EventTarget, Document ou hover
durante o 0.5"). Uma guarda de PR, `--check`, compara a árvore com a base e roda no passo "Milestone exit guards (X9 and X10)" do `contracts.yml`. Uma
auditoria, `--audit`, percorre os commits de primeiro pai do 0.5 e grava o recibo [`audit.json`](audit.json), que `--audit --verify` julga de novo sem git. A
[nota de pesquisa](../../research/milestone-exit-guards.md) traz as regras exatas, os limites e a decisão sobre as duas saídas.

**Esta entrega não fecha X9 nem X10.** Os dois falam "durante o 0.5" e só fecham quando o marco fechar, rodando a auditoria de novo sobre o histórico inteiro. Também
não muda nenhum checkpoint, GF, peso ou denominador da 1.0. A segunda metade do X9, `summarize()` igual com e sem `milestones`, já é provada por
`tests/migration-dashboard.test.mjs` ("milestones never change the release numbers and are optional"), em `test:dashboard`; a guarda cobre a primeira metade.

> **Registro fixado.** Os números abaixo são os da execução sobre o commit de implementação
> [`bf00341`](https://github.com/journey-studios/godot-fabric/commit/bf00341d6c50eddd9795d9b9b5ccf2b5f91989b7) (árvore `ddc396bb`), cujo pai é a main `8b7a5e6` (#85). Os fontes
> executados (o script, o teste, o passo do `contracts.yml`, o `scripts/git-environment.mjs` e o `package.json`) são os desse commit, sem diferença no working tree. A
> auditoria lê só objetos do git, até `bf00341`, e não depende do working tree; o `audit.json`, esta página, a nota de pesquisa e o índice de evidência foram
> escritos depois dela, sem commit, e não são entrada de nenhum comando.
>
> **Depois do registro, na revisão do PR #87.** O CodeRabbit apontou duas falhas, e as duas procediam. (1) O passo do `contracts.yml` tomava a base de `github.event.pull_request.base.sha`; num `pull_request` o
> `GITHUB_SHA` é o merge sintético, cujo primeiro pai pode não ser esse SHA se a main avançou ou o ref foi refeito, e a guarda compararia a árvore do PR com commits alheios. O passo passou a usar o primeiro pai do `HEAD`
> nos dois eventos (veja "A guarda de PR"). (2) A comparação por `id` guardava só o último item de cada `id`, e uma cópia acrescentada de um checkpoint existente passava como "sem mudança"; agora uma lista só é
> comparada item a item se os `id` são distintos nos dois lados, e senão é comparada inteira (classe `moves-1.0`), de modo que a guarda falha fechada. A auditoria não mudou: nenhuma lista do histórico repete `id`, e
> `--audit --to bf00341` com o script corrigido reproduz o `audit.json` byte a byte (SHA-256 abaixo). O teste passou de 35 para 36 checks (o caso do `id` repetido, que falha no `isKeyed` antigo), e os números da tabela
> abaixo são os de `bf00341`.

> **Depois do registro: execução manual.** O passo da guarda ganhou o ramo `workflow_dispatch`: num despacho manual ele busca o histórico e a `main` e roda `--check` sem `--base`, então a base é o merge-base de `HEAD` com `origin/main`, e não a ponta da main. Reproduzido em clones rasos de profundidade 1 de um remoto de teste (a branch acrescenta uma entrada do 0.5, e a main, que avançou, mudou uma nota do 1.0): o despacho sai com `MILESTONE_GUARDS_CHECK_PASSED: against 333181d4a068 (the merge-base of HEAD and origin/main); X9 clean, X10 clean`; a mesma árvore contra a ponta de `origin/main` falha em `tasks[GF-01].note`; e um evento sem base falha com mensagem. Nenhum recibo, SHA ou número desta página mudou, e isto não é uma execução da CI hospedada.

Todo link de código abaixo está fixado em `bf00341`.

| Lane executada | Resultado | Observação |
| --- | --- | --- |
| `node scripts/milestone-guards.mjs --audit --to bf00341` | passou: **28 commits** de primeiro pai, 15 acrescentam uma entrada `milestone-0-5-*` | X9: 14 limpos, 13 não se aplicam (sem entrada do 0.5), **1 violação** (`b0e40aa`, a exceção do #74, que está no `KNOWN`); X10: 28 limpos; o GF-13 igual em profundidade em todos |
| `node scripts/milestone-guards.mjs --audit --verify` | passou, sem git | `MILESTONE_GUARDS_AUDIT_VERIFIED`: os veredictos seguem dos dados do recibo e as violações são exatamente as do `KNOWN` |
| `node scripts/milestone-guards.mjs --check --base origin/main` | passou | `X9 not-applicable, X10 clean` (a árvore da branch contra a main `8b7a5e6`) |
| `node --test tests/milestone-guards.test.mjs` | 35/35 | funções puras sobre JSON sintético, `--check` e `--audit` em repositórios descartáveis, o recibo commitado verificado offline, mutações do recibo recusadas e o passo da CI fixado |
| Lanes vizinhas | `type-check`, `check:static`, `check:publication` e `test:dashboard` (43/43) passam | `check:static` sem achados; `check:publication` com `"passed": true` |
| Host anterior e sabotagens | **N/A** | a entrega é só Node e git, sem C++ nem fonte do host; o controle negativo são os repositórios descartáveis do teste, que reprovam o X9 e o X10 pelo motivo certo |

**Ambiente**: macOS 26.6.2 arm64; Node v22.23.3; git 2.50.1. Nada nativo foi construído nem rodou. O SHA-256 do [`audit.json`](audit.json) é
`1c6f452dcbc824b10d2576ea161a8ad9414fdb5075020e7c3be776bcef5efdb4`; rodar a auditoria outra vez com o mesmo `--to` o reproduz byte a byte.

Os comandos, na ordem em que rodaram:

```sh
node scripts/milestone-guards.mjs --audit --to bf00341
node scripts/milestone-guards.mjs --audit --verify
node scripts/milestone-guards.mjs --check --base origin/main
node --test tests/milestone-guards.test.mjs
npm run type-check && npm run check:static && npm run check:publication && npm run test:dashboard
```

> **CI hospedada pendente.** O passo "Milestone exit guards (X9 and X10)" do job `contracts` de `contracts.yml` e o teste `tests/milestone-guards.test.mjs`,
> dentro de `test:contracts`, ainda não rodaram na CI hospedada. Tudo o que esta página registra é evidência local, em macOS arm64. O passo foi reproduzido
> localmente, na forma corrigida (primeiro pai), em clones rasos (profundidade 1): num `pull_request` sobre um merge criado com `git merge --no-ff` cujo primeiro pai não é o `base.sha` do payload
> (a guarda passa com `X9 clean, X10 clean`, e o passo antigo, com o `base.sha`, reprovaria o PR por uma nota que a main mudou), num `push` e num evento sem base (o passo falha com mensagem), mas isso não é a CI. Esta
> entrega não fecha checkpoint, GF, peso, denominador nem as saídas X9 e X10.

## As regras

**X9.** O alvo é uma mudança (um commit contra o pai, ou a árvore contra a base) que acrescenta uma entrada de `activity` cujo id começa com `milestone-0-5-` e muda
qualquer campo de `tasks`, `phases`, `sequences`, `releaseChecklist`, `integrationChecklist` ou `decisions`. A comparação é em profundidade, com as listas casadas por `id`, e cada
mudança sai com o caminho do que mudou (`tasks[GF-27].note`) e uma classe: `moves-1.0` (`done`, `status`, `weight`, um GF, checkpoint ou item novo ou removido, a ordem de uma
lista, ou qualquer outro campo) ou `text-or-evidence` (`note`, `label`, `evidence`). **As duas classes são violação**, porque o critério diz "diff vazio"; a classe vai para o relatório
para o usuário julgar a gravidade. Uma mudança que não acrescenta entrada do 0.5 é uma entrega de GF e não é julgada pelo X9.

**X10.** O padrão da cauda, sem distinguir maiúsculas, é `/(^|[-_/])(pointer|event[-_]?target|document|hover)/i`. Vale para o nome de uma entrada nova diretamente sob `docs/evidence/`, para um
arquivo novo diretamente sob `docs/research/` e para um arquivo novo sob `tests/` ou `scripts/`. É permitido o que é do V05-02: qualquer segmento do caminho que comece com `world-input`.
Um arquivo novo dentro de uma pasta de evidência que não é, ela mesma, uma fatia não conta; se o nome casa o padrão, o relatório o lista em `insideFolders`. Além disso, nenhuma entrada de `activity`
com `GF-13` em `taskIds` pode ser acrescentada, e a tarefa GF-13 tem de ficar igual em profundidade, salvo numa mudança que entrega o V05-02 (acrescenta uma entrada `milestone-0-5-v05-02-*`).

O `KNOWN`, dentro do script, lista as violações históricas aceitas, com o SHA, o PR, o que mudou e por quê. A auditoria passa só se as violações encontradas forem **exatamente** as do `KNOWN`
(mesmo commit, mesma regra, mesmos itens e classes), e falha se uma entrada do `KNOWN` está no intervalo e deixou de ser violação. O `--check` não lê o `KNOWN`: um PR não tem exceção.

## A auditoria

De `c0f3702` (#60, inclusive: o commit que abre o 0.5) a `bf00341`: 28 commits de primeiro pai, cada um comparado com o seu pai. Os 15 que acrescentam uma entrada do 0.5:

| Commit | PR | Entrada `milestone-0-5-*` acrescentada | X9 | X10 |
| --- | ---: | --- | --- | --- |
| `c0f3702` | #60 | `milestone-0-5-frontier-20261008` | limpo | limpo |
| `e1c7a39` | #70 | `milestone-0-5-v05-03-replay-c2e4501` | limpo | limpo |
| `75a85ad` | #73 | `milestone-0-5-v05-03-servicos-f199dd0` | limpo | limpo |
| **`b0e40aa`** | **#74** | `milestone-0-5-v05-04-scope-1b9f120` | **violação (texto ou evidência)** | limpo |
| `7ef63ed` | #71 | `milestone-0-5-v05-02-pointer-03f039a` | limpo | limpo |
| `c8de44b` | #76 | `milestone-0-5-v05-03-consumidor-b9a40cb` | limpo | limpo |
| `2a3f4b0` | #78 | `milestone-0-5-v05-02-pointer-a2-af941dd` | limpo | limpo |
| `5e1f6a1` | #79 | `milestone-0-5-v05-03-autoridade-5ee0127` | limpo | limpo |
| `3bb51d6` | #77 | `milestone-0-5-v05-06-baseline-headless-ebfe8a0` | limpo | limpo |
| `3d531a6` | #80 | `milestone-0-5-v05-02-decision-09ec1e0` | limpo | limpo |
| `622102e` | #82 | `milestone-0-5-v05-05-matriz-mapa-096a018` | limpo | limpo |
| `818d2f1` | #81 | `milestone-0-5-exit-x3-x4-x5` | limpo | limpo |
| `a49f851` | #83 | `milestone-0-5-v05-06-soak-b77178a` | limpo | limpo |
| `82f5f43` | #84 | `milestone-0-5-v05-10-protocol-draft` | limpo | limpo |
| `8b7a5e6` | #85 | `milestone-0-5-hosted-receipts-70cf43b` | limpo | limpo |

Os outros 13 commits não acrescentam entrada do 0.5, e o X9 não se aplica a eles: 12 são entregas de GF-xx ou registros delas (mudam `tasks`, que é o trabalho deles) e o 13º é `bf00341`, que não
muda a 1.0. O X10 é limpo nos 28.

### A exceção: `b0e40aa` (#74, P5 V05-04, de outro agente)

O #74 acrescentou `milestone-0-5-v05-04-scope-1b9f120` e, no mesmo pull request, mudou dois campos do GF-27:

- `tasks[GF-27].note`: o fecho "CI hospedada ... pendente" virou o resultado da CI hospedada do #69 (2.805 para 3.030 caracteres);
- `tasks[GF-27].checkpoints[slice].evidence`: duas entradas a mais, de 7 para 9, o recibo da CI hospedada e o do Pages do #69.

As duas são da classe `text-or-evidence`. **Nenhum `done`, peso, status, checkpoint ou item mudou**: 0 mudanças da classe `moves-1.0`, e os números da 1.0 não se moveram. São os recibos do #69 (GF-27,
uma entrega da 1.0) que o #74 juntou ao seu PR. Pela letra do X9 ("diff vazio") é violação, e é a única do histórico. Está no `KNOWN` para o usuário julgar, e não aprovada pela regra: um PR do
0.5 que carregue os recibos de uma entrega de GF falharia o `--check` hoje. O caminho é o dos outros 14 commits da tabela: os recibos do GF vão num PR que não acrescenta entrada do 0.5.

### O X10 limpo e o GF-13 igual

Nenhuma fatia nova (permitida ou não) foi aberta sob `docs/evidence`, `docs/research`, `tests` ou `scripts`; nenhuma entrada de `activity` com `GF-13`; a tarefa GF-13 igual em profundidade do pai de
`c0f3702` até `bf00341` (`gf13ChangedIn: []` no recibo). `native/pointer_adapter.*` e `tests/pointer-click-*` foram modificados e não acrescentados, e a guarda olha acréscimos.

Os únicos arquivos acrescentados cujo nome casa o padrão são seis sob `docs/evidence/scroll-view/` (`pointer-route-capture-retirement.json`, `source-pins-18d3478-pointer-click-group.json` e quatro
`metafiles-3bf129c/pointerClick-*.json`), todos do GF-14, que retira rotas de ponteiro. Essa pasta foi criada pelo #58 (`66c948b`), dentro do 0.5 e não antes dele, com um nome que o padrão não casa. Os seis aparecem
em `insideFolders` desse commit (`folder: "new"`) e não são fatia.

## A guarda de PR

O [`contracts.yml`](https://github.com/journey-studios/godot-fabric/blob/bf00341d6c50eddd9795d9b9b5ccf2b5f91989b7/.github/workflows/contracts.yml) roda, no job `contracts`, depois do `npm ci` e antes do `test:contracts`,
`node scripts/milestone-guards.mjs --check --base "$base"`. Em um `pull_request` e em um `push`, `git fetch --no-tags --depth=2 origin "$GITHUB_SHA"` traz um commit a mais que o checkout raso e a
`base` é `HEAD^`, o **primeiro pai** do commit que o evento baixou:

- num `pull_request`, o `GITHUB_SHA` é o commit de merge sintético do GitHub (`refs/pull/N/merge`), e o primeiro pai dele é a branch base como o merge foi feito, que é aquilo de que a árvore do PR de fato difere.
  O `pull_request.base.sha` do payload não é usado: ele pode ser outro quando a main avançou ou o ref do merge foi refeito, e a guarda compararia a árvore do PR com commits alheios;
- num `push` na main, o `GITHUB_SHA` é o commit enviado e a `base` é o pai dele;
- qualquer outro evento: o passo falha com uma mensagem. O passo não tem `if:` nem `continue-on-error`, e o teste fixa isso e a escolha do primeiro pai.

Ela não depende de histórico. O checkout é raso, o passo busca um commit a mais, por SHA, e o `--check` lê o `dashboard/migration.json` e a lista de arquivos da base com `git show` e `git ls-tree`,
nunca `git log`. O teste também não precisa de histórico: as funções puras rodam sobre JSON
sintético, `--check` e `--audit` rodam em repositórios descartáveis que o próprio teste cria, e o recibo commitado é verificado com `--audit --verify`. Só a auditoria completa sobre o histórico real é local.
O [script](https://github.com/journey-studios/godot-fabric/blob/bf00341d6c50eddd9795d9b9b5ccf2b5f91989b7/scripts/milestone-guards.mjs) e o
[teste](https://github.com/journey-studios/godot-fabric/blob/bf00341d6c50eddd9795d9b9b5ccf2b5f91989b7/tests/milestone-guards.test.mjs) fixados em `bf00341` têm a forma anterior à correção da revisão (o passo lia o `base.sha` do payload no `pull_request`).

## Limites

- **X9 e X10 só fecham no fim do 0.5.** Quando o marco estiver fechando, rodar `--audit --to <commit de fechamento>` outra vez, esperar exatamente as violações do `KNOWN`, commitar o recibo e só então marcar X9 e
  X10 como `done: true`, com ele de evidência. Uma violação nova que a auditoria achar então é do usuário julgar; ela nunca entra no `KNOWN` pelo agente que a achou. Uma auditoria limpa hoje não diz nada do próximo PR;
  é para isso que o `--check` existe.
- **Uma pasta nova com nome neutro esconde uma fatia.** A regra olha o nome da pasta nova: `docs/evidence/scroll-view-2/pointer-slice.json` não é violação, só aparece em `insideFolders` para uma pessoa olhar. Segue a
  decisão de que arquivos dentro de uma pasta não são fatia nova, e é o preço de deixar o `scroll-view/` retirar rotas de ponteiro.
- **O padrão é cego ao contexto.** Um nome novo com `document` ou `hover` no começo de uma palavra casa mesmo que o assunto não seja a cauda; o falso positivo se resolve com outro nome ou pelo líder, e o padrão não é afrouxado.
- **Só acréscimos contam para os nomes.** Um `native/pointer_adapter.cpp` modificado não é fatia nova; o que o V05-02 precisa é permitido pelo líder, e a guarda não opina sobre quanto de um arquivo existente pode mudar.
- **O X9 precisa da entrada.** Um PR que muda a 1.0 e não acrescenta entrada `milestone-0-5-*` é uma entrega de GF e não é julgado. Uma mudança do 0.5 registrada só em `milestones`, sem entrada em `activity`, também não; o
  registro é por `activity`.
- **Sem base não há veredito.** Sem `--base`, a base é o merge-base de `HEAD` com `origin/main` (uma branch atrasada não é culpada pelo que a main acrescentou) e, sem merge-base, `origin/main`; se nenhuma resolve, o
  comando falha com uma mensagem. Na CI, a base é explícita no `pull_request` e no `push` (o primeiro pai de `HEAD`); no `workflow_dispatch` é o merge-base de `HEAD` com `origin/main`, depois de buscar o histórico e a main.
- **O `--check` lê o working tree**, com a lista de arquivos do índice do git mais os não rastreados (os ignorados não contam); o resultado é o mesmo antes e depois do commit.
