# Anúncios ao leitor de tela do `AccessibilityInfo`, pelo AccessKit

Esta fatia, a segunda do GF-20 (parte b: os anúncios e o foco), faz o `announceForAccessibility` e o
`announceForAccessibilityWithOptions` do `AccessibilityInfo` ORIGINAL do RN 0.87.1 serem anunciados no
macOS, pelo AccessKit do Godot 4.7.2, e fecha com dados o motivo de o foco do leitor de tela continuar
recusado. O AccessKit do macOS anuncia um nó novo que tem `value` e modo live: o host cria, a cada anúncio, um
elemento de texto estático novo sob o elemento da própria `FabricApplication`, com o texto no `value` e
`LIVE_POLITE` (`LIVE_ASSERTIVE` para `priority: 'high'`), dentro do update de acessibilidade, e o libera fora do
update seguinte. Um anúncio por update, na ordem em que foram pedidos. Sem leitor de tela a chamada volta sem
erro e o anúncio é descartado e contado, nunca guardado para quando um leitor ligar. `queue: true`,
`priority: 'low'` e o foco programático lançam `E_UNSUPPORTED` com o motivo; `announcementFinished` segue
silencioso. **Nada aqui prova que o VoiceOver falou**: a prova vai até a chamada que o AccessKit faz ao AppKit
(texto, nível de prioridade, ordem, uma vez cada). O [recibo](execution.json) fixa fontes, hashes, capturas e
resultados.

Todo link de código abaixo está fixado no commit de implementação
[`030ebcf`](https://github.com/journey-studios/godot-fabric/commit/030ebcf3c2787e9cb58db0a3f3196b4c55e23b2f)
(árvore `d5bd1aa9`: "Publish one announcement per update, in request order"), que fecha a fatia depois do commit
[`493d8f7`](https://github.com/journey-studios/godot-fabric/commit/493d8f707bdad5a82ea0adda60ea7f6171d8122b)
("Announce to the screen reader through AccessKit"). Cada comando abaixo rodou, de novo, no conteúdo limpo e sem
arquivos novos de `030ebcf`: nenhum número é herdado das execuções que precederam o commit.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Core dos settings (`accessibility_info_core_test`) | 14 funções | `ACCESSIBILITY_INFO_CORE_PASSED`: a leitura de três estados, as tabelas de descritores, a regra de mudança, o stop, as contagens do `UIManager`, os multiplicadores e o motivo do foco |
| Core dos anúncios (`accessibility_announcement_core_test`) | 15 funções | `ACCESSIBILITY_ANNOUNCEMENT_CORE_PASSED`: as chamadas exatas de um anúncio, a ordem de um lote, os descartes, a expiração, o stop (inclusive de dentro de um update) |
| Host anterior `bd0c6f71` (main `bf1e9e9`) | 54/69 | Exatamente as 15 falhas normativas: o host só tem as configurações e os eventos; os anúncios e o foco lançam `E_UNSUPPORTED` citando a fatia 2b |
| Sabotagem `unknown-as-false`, host `93bc7d4d` | 57/69 | Exatamente 12 falhas (a da fatia 2a): lê `-1` como desligado; o oráculo rejeita com `A/lazy-read: increaseContrast` |
| Sabotagem `emit-every-poll`, host `984d1378` | 52/69 | Exatamente 17 falhas; o oráculo rejeita com `A/lazy-read: screenReader` |
| Sabotagem `swapped-settings`, host `a078f2b7` | 61/69 | Exatamente 8 falhas; o oráculo rejeita com `A/motion-on/motion/get` |
| Sabotagem `display-name`, host `d195d4aa` | 67/69 | Exatamente 2 falhas; o oráculo rejeita com `A/early: reduceMotion` |
| Sabotagem `announce-name`, host `509ece64` | 64/69 | Exatamente 5 falhas: o texto vai no `name` e não no `value`; o oráculo rejeita com `A/announce-basic: announcements` |
| Sabotagem `swapped-priorities`, host `1dcef0ca` | 62/69 | Exatamente 7 falhas: `high` sai polite e o resto assertive; o oráculo rejeita com `A/announce-basic: announcements` |
| Sabotagem `ungated-announce`, host `d58de09d` | 63/69 | Exatamente 6 falhas: o gate do leitor responde sempre sim; o oráculo rejeita com `A/announce-no-reader: announcements` |
| Sabotagem `reused-element`, host `859cbfe2` | 63/69 | Exatamente 6 falhas: todo anúncio vai no primeiro elemento; o oráculo rejeita com `A/announce-priorities: announcements` |
| Host atual `62867d91`, headless, 3 execuções | 69/69 | Duas aplicações do mesmo bundle (as metas de validação com o gravador do `AccessibilityServer` e duas roots; o backend real do Godot, sem leitor de tela), com o oráculo independente; as três execuções geram o mesmo relatório, byte a byte |
| Faixa (c), local, host atual `62867d91` | 12/12 | O Godot gráfico, `--accessibility always`, e a interposição de `NSAccessibilityPostNotificationWithUserInfo`: 8 posts, com o texto, o nível de prioridade e a ordem `First, Second, Third` |
| Faixa (c), host anterior `bd0c6f71` | 4/12 | Exatamente as 8 falhas normativas: nenhum post (o host anterior recusa todo anúncio) |
| Faixa (c), sabotagens `announce-name`, `swapped-priorities`, `reused-element` | 6, 7 e 7 de 12 passam | 6, 5 e 5 falhas: nenhum post, níveis de prioridade trocados e só o primeiro anúncio postado; o oráculo da faixa rejeita cada uma |
| Exemplo `accessibility-info` | 12 headless, 12 com o renderer nativo, 15 com captura | Cliques reais no botão React **Announce**, botões nativos que fingem o sistema e o leitor de tela, três capturas |

As lanes headless executam o mesmo bundle (`04b1f2da`), com as mesmas fontes de teste e SDK; só os produtores
nativos diferem. O host anterior foi compilado a partir da main `bf1e9e9`, antes de a árvore receber o trabalho
desta fatia, e o binário fica em `build/accessibility-announcements-previous-host/`, local e fora do repositório; o
teste só aceita o controle se o dylib em `addons/` for esse binário (compara o SHA-256). As oito sabotagens são
retidas: `node scripts/accessibility-info-sabotage.mjs` troca um trecho de `native/accessibility_info_core.h`
(as quatro da fatia 2a) ou de `native/accessibility_announcement_core.h` (as quatro dos anúncios) de cada vez,
recompila, roda o runner e o oráculo, restaura a fonte byte a byte (hash conferido), recompila o host genuíno e
registra tudo em um recibo local. O host genuíno e o restaurado têm o mesmo SHA-256, `62867d91…`. Uma sabotagem a
mais da fatia 2a, a falta do alias `legacySendAccessibilityEvent`, quebra o bundle e não o host, e é mostrada por
`tests/platform-seams.test.mjs` (17/17).

**Ambiente**: macOS arm64 (26.6.2, Apple M3 Pro); Godot oficial 4.7.2 (`ed1daf0bf`), RN 0.87.1, React 19.2.3,
Hermes 250829098.0.17 e Node v22.23.3. A suíte roda em modo headless; o exemplo, em headless e com o renderer
nativo; a faixa (c), numa sessão gráfica do macOS.

```sh
npm run test:accessibility-info
npm run test:accessibility-info:bridge
```

Com o host anterior instalado em `addons/`, o runner confere o controle com
`node tests/accessibility-info-native.test.mjs --allow-original-negative` e a faixa (c) com
`node tests/accessibility-announcements-bridge.test.mjs --allow-original-negative`; os hosts sabotados rodam com
`--sabotage=<nome>` (as oito na suíte headless; `announce-name`, `swapped-priorities` e `reused-element` na faixa
(c), as três cujo dano os posts mostram), e o launcher abre o
[exemplo](https://github.com/journey-studios/godot-fabric/blob/030ebcf3c2787e9cb58db0a3f3196b4c55e23b2f/examples/accessibility-info/README.md)
com `npm run example -- accessibility-info` (também `--headless`, `--check` e `--capture`).

> **A faixa (c) é local.** Ela precisa de uma sessão gráfica do macOS (`launchctl managername` igual a `Aqua`) e
> abre uma janela do Godot por alguns segundos; não precisa de permissão de acessibilidade (TCC), porque o
> inspetor roda dentro do processo, e **não roda na CI hospedada**, que é headless. A CI hospedada cobre só a
> camada headless (`npm run test:accessibility-info`).
>
> **CI hospedada e Pages pendentes.** O passo `npm run test:accessibility-info` de `contracts.yml` ainda não rodou
> na CI hospedada para esta fatia, e nada foi publicado no Pages; os dois entram depois do merge. Tudo o que esta
> página registra é evidência local, em macOS arm64. O recibo de fonte (o recibo do bundle, que fixa o SHA-256 de
> cada fonte executada) **não certifica o build nativo** que um runner hospedado faz a partir delas. Esta fatia
> não fecha nenhum checkpoint, GF, peso ou denominador (a primeira fatia do GF-20 já fechou o `slice`).

## O que o RN faz

No ramo do iOS, o `announceForAccessibility` posta `UIAccessibilityAnnouncementNotification`, e o
`announceForAccessibilityWithOptions` leva `{queue, priority}` como atributos da fala (`queue` vira
`QueueAnnouncement`; `priority` `low`, `default` ou `high` vira a prioridade do anúncio no iOS 17 e uma string
desconhecida é ignorada). Sem VoiceOver a notificação não faz nada, e o Android retorna sem erro com o serviço
desligado. `announcementFinished` é um evento do iOS (a fala terminou). `setAccessibilityFocus` e o
`sendAccessibilityEvent(..., 'focus')` terminam em `UIAccessibilityLayoutChangedNotification`, que move o foco do
VoiceOver e não troca o first responder: um `TextInput` focado continua com o teclado e não recebe blur. A
[nota de pesquisa](https://github.com/journey-studios/godot-fabric/blob/030ebcf3c2787e9cb58db0a3f3196b4c55e23b2f/docs/research/accessibility-announcements.md)
tem as fontes com as linhas.

## O que esta fatia faz

1. O [`Announcer`](https://github.com/journey-studios/godot-fabric/blob/030ebcf3c2787e9cb58db0a3f3196b4c55e23b2f/native/accessibility_announcement_core.h)
   é uma máquina de estados pura, com seu próprio
   [teste](https://github.com/journey-studios/godot-fabric/blob/030ebcf3c2787e9cb58db0a3f3196b4c55e23b2f/native/accessibility_announcement_core_test.cpp),
   independente do [core dos settings](https://github.com/journey-studios/godot-fabric/blob/030ebcf3c2787e9cb58db0a3f3196b4c55e23b2f/native/accessibility_info_core.h).
   `announce` valida as opções (`queue: true`, depois `priority: 'low'`, são recusadas e não levam nada), conta o
   pedido, descarta o texto vazio e o que não tem leitor, e guarda o resto; `pump`, uma vez por frame fora de
   qualquer update, libera os elementos do último update, descarta o que esperou demais e pede o update;
   `publish`, dentro do update, cria o elemento do primeiro anúncio guardado; `stop` descarta o que espera,
   libera o que foi publicado fora de update e é idempotente.
2. A [porta do Godot](https://github.com/journey-studios/godot-fabric/blob/030ebcf3c2787e9cb58db0a3f3196b4c55e23b2f/native/accessibility_announcer.cpp)
   chama o `AccessibilityServer` por nome (`create_sub_element` com `ROLE_STATIC_TEXT`, `update_set_value`,
   `update_set_live`, `free_element`), confere cada nome e cada constante no ClassDB uma vez, e só considera que há
   leitor com `SceneTree.is_accessibility_enabled()`, `AccessibilityServer.is_supported()` e um elemento para a
   aplicação. A meta `validation_accessibility_announcer` troca o servidor por um **gravador** que roda o update que o
   engine rodaria e registra cada chamada; o probe nunca envia a notificação 3000.
3. A `FabricApplication` publica quando recebe `NOTIFICATION_ACCESSIBILITY_UPDATE` (um `case` em
   [`fabric_application.cpp`](https://github.com/journey-studios/godot-fabric/blob/030ebcf3c2787e9cb58db0a3f3196b4c55e23b2f/native/fabric_application.cpp)),
   e o `poll` do
   [`AccessibilityInfo`](https://github.com/journey-studios/godot-fabric/blob/030ebcf3c2787e9cb58db0a3f3196b4c55e23b2f/native/accessibility_info.cpp)
   é o frame do `pump`.
4. **Um anúncio por update, na ordem dos pedidos.** Com os três anúncios de um frame no mesmo update, o AccessKit os
   postou como `Second, First, Third`; num spike que escreveu os elementos direto no Godot, a ordem variou de uma
   execução para outra. No iOS, sem `queue`, cada anúncio interrompe o anterior e o usuário ouve o último pedido, então
   uma ordem que muda com o update mudaria o anúncio ouvido. A decisão (commit `030ebcf`) é publicar um por update, um
   frame de intervalo para cada anúncio a mais; a faixa (c) mede `First, Second, Third`.
5. `setAccessibilityFocus` e o `sendAccessibilityEvent` com `focus` lançam, ou falham em voz alta, com
   `E_UNSUPPORTED: Godot has a single focus; moving the screen reader's focus would move the keyboard focus and blur
   the focused control, which iOS does not do`. O snapshot da aplicação ganha `accessibilityInfo.announcements`
   (contadores, `osTree`, a API do engine que usa, e as chamadas gravadas).

## O que foi verificado

O [probe](https://github.com/journey-studios/godot-fabric/blob/030ebcf3c2787e9cb58db0a3f3196b4c55e23b2f/tests/accessibility-info-probe.gd)
roda duas `FabricApplication` reais, cada uma com seu Hermes e o mesmo bundle:

- **A, as metas de validação**: duas roots, 36 passos. Além dos 25 de settings e eventos (a fatia 2a), onze passos de
  anúncio: um anúncio publicado, as prioridades (`high`, `default`, `urgent`, opções nulas, `queue: false`), o mesmo
  texto duas vezes, um lote de três, um texto vazio e um com acentos e CJK, as recusas (`queue`, `low`, os dois, e os
  tipos errados, `E_ARGUMENT`), o foco, sem leitor de tela, o leitor que sai com um anúncio esperando, o update que
  nunca chega (120 pedidos e a expiração) e a aplicação sem elemento. O stop acontece com um anúncio esperando.
- **R, o backend real**: criada e montada antes de A, e viva enquanto A faz tudo. No Godot headless não há leitor de
  tela (`AccessibilityServer.is_supported()` e `is_accessibility_enabled()` falsos): todo anúncio é descartado e
  contado, `published` fica em 0, `osTree` é falso e nada é gravado.
- **Os nomes são os do engine**: o probe pergunta ao ClassDB cada método e constante que a porta usa
  (`AccessibilityServer`, `SceneTree.is_accessibility_enabled`, `Node.get_accessibility_element`,
  `Node.queue_accessibility_update`), e o oráculo confere a lista que o host reporta contra a dele.

O [oráculo](https://github.com/journey-studios/godot-fabric/blob/030ebcf3c2787e9cb58db0a3f3196b4c55e23b2f/tests/accessibility-info-oracle.mjs)
refaz cada passo a partir das regras do RN, do iOS e do AccessKit: um modelo de estados do anunciador (pendentes,
publicados, descartes, o update que o gravador roda, um anúncio por update, expiração) e compara os contadores e cada
chamada gravada, uma por uma; 42 passos refeitos (36 de A e 6 de R). O teste o alimenta com um relatório cujos
checks foram todos marcados como passados, e é ele que rejeita o host anterior e as sabotagens, sem confiar no
probe. O probe julga ordem e contagem, nunca tempo: espera os polls que o host conta.

### O spike e o dado da ordem

Antes de construir qualquer coisa, um Node escreveu um elemento com `value` e modo live dentro do
`NOTIFICATION_ACCESSIBILITY_UPDATE` de uma janela real (`--accessibility always`), e uma interposição dyld de
`NSAccessibilityPostNotificationWithUserInfo` (o inspetor, injetado com `DYLD_INSERT_LIBRARIES`; os entitlements do
Godot oficial permitem) viu o que o AccessKit pediu ao AppKit. O script do spike é um experimento local, fora do
repositório; foi rodado de novo na árvore desta fatia, e o recibo traz o relatório e os hashes:

| Elemento | Post observado |
| --- | --- |
| `value` "Saved", live assertive | `AXAnnouncementRequested`, "Saved", prioridade 90, na `GodotWindow` |
| Elemento novo, o mesmo texto, live polite | `AXAnnouncementRequested`, "Saved", prioridade 50 |
| Só `name`, assertive | nenhum post |
| Três elementos num update (`First`, `Second`, `Third`) | postados como `Third`, `First`, `Second` nesta execução |

A ordem dos três elementos de um mesmo update foi `First, Second, Third` na primeira execução do spike, `Second, First,
Third` na faixa gráfica do commit `493d8f7` (três anúncios de um frame no mesmo update, medidos na rodada que achou o
problema, e não re-rodados em `030ebcf`, cujo código já não tem esse desenho) e `Third, First, Second` agora: a ordem
dentro de um update é do AccessKit e não é estável. É por isso que um update leva um anúncio.

## Sequências gravadas

Lidas do relatório do probe (aplicação A, gravador no lugar do `AccessibilityServer`; `#n` é o handle do elemento):

| Caso | Chamadas |
| --- | --- |
| Um anúncio publicado | `update.begin; create #1; value #1 "Saved"; live #1 "polite"; update.end; free #1; update.begin; update.end` |
| Prioridade `high` | `update.begin; create #2; value #2 "Alert"; live #2 "assertive"; update.end; free #2; …` (os outros três do passo saem `polite`) |
| O mesmo texto duas vezes | dois ciclos completos, `#6` e `#7`, os dois com `value "Saved"` |
| Três no mesmo frame (`One`, `Two`, `Three`) | `update.begin; create #8 "One"; … update.end; free #8; update.begin; create #9 "Two"; … update.end; free #9; update.begin; create #10 "Three"; … update.end; free #10; update.begin; update.end` |
| Texto vazio | nada gravado; `dropped.empty` |
| `queue: true`, `priority: 'low'` e tipos errados | nada gravado; `refused.queue` 3, `refused.priority` 2 |
| Sem leitor de tela | nada gravado; `dropped.noScreenReader` |
| O leitor sai com um anúncio esperando | nada gravado; `dropped.noScreenReader` |
| O update nunca chega | nada gravado; 120 pedidos de update; `dropped.expired` |
| Sem elemento | `update.begin; update.end`, sem `create`; `dropped.noScreenReader` |
| Stop com um anúncio esperando | nada novo gravado; `dropped.stopped` 1; depois do stop, `E_MODULE_DISPOSED` |
| Servidor real, headless (aplicação R) | nada gravado; `requested` 2, `dropped.noScreenReader` 2, `published` 0, `osTree` falso |

No fim do probe, A tem `requested` 18, `published` 11, `released` 11, `dropped` `{empty 1, expired 1, noScreenReader 4,
stopped 1}`, `refused` `{queue 3, priority 2}`, e `requested = published + pending + dropped` em todo passo.

## A faixa (c): o que o AccessKit posta

`npm run test:accessibility-info:bridge` roda o bundle do probe numa janela real, com o inspetor interposto, numa
`FabricApplication` de verdade (o servidor real, sem gravador). Os 12 checks e os posts medidos:

| Anúncio | Posts de `AXAnnouncementRequested` (texto, prioridade, elemento) |
| --- | --- |
| `announceForAccessibility("Saved")` | `["Saved", 50, "GodotWindow"]` |
| O mesmo texto de novo | `["Saved", 50, "GodotWindow"]` outra vez |
| `{priority: 'high'}`, "Alert" | `["Alert", 90, "GodotWindow"]` |
| `{priority: 'default'}`, "Plain" | `["Plain", 50, "GodotWindow"]` |
| `{priority: 'urgent', queue: false}`, "Odd" | `["Odd", 50, "GodotWindow"]` |
| Três no mesmo frame: `First`, `Second`, `Third` (`high`) | `["First", 50]`, `["Second", 50]`, `["Third", 90]`, nessa ordem |
| Texto vazio, `queue: true`, `priority: 'low'` | nenhum post (o vazio é descartado; os outros dois, recusados com o motivo) |

Depois dos posts, nenhum dos textos está na árvore do SO (os elementos foram liberados), o host publicou 8 e liberou 8
dos 9 pedidos (um era vazio), e depois do stop nada mais é postado. O host anterior falha exatamente os 8 checks de
post; as três sabotagens da faixa (o texto no `name`, as prioridades trocadas, um elemento reaproveitado) são rejeitadas:
`announce-name` não posta nada, `swapped-priorities` posta `["Saved", 90]` e `["Alert", 50]` (os níveis trocados) e
`reused-element` posta só o primeiro anúncio; o oráculo da faixa rejeita cada uma. O inspetor é compilado de
`tests/accessibility-bridge-probe.m` (a primeira fatia, com o `test:accessibility:bridge` de 22 checks, usa o mesmo
arquivo e continua passando).

## Método → comportamento observado

Lido do relatório da execução (`execution.json`, `observedBehavior`), em headless, com o gravador em A:

| API | Observado |
| --- | --- |
| `announceForAccessibility('Saved')` (leitor presente) | retorna; um elemento novo, `value` "Saved", polite, feito num update e liberado fora do seguinte |
| `announceForAccessibilityWithOptions(..., {priority: 'high'})` | retorna; assertive |
| `priority` `default`, `urgent`, `{queue: false}` ou opções nulas | retorna; polite |
| `announceForAccessibility('')` | retorna; nada é feito (`dropped.empty`) |
| `announceForAccessibilityWithOptions(..., {queue: true})` | lança `E_UNSUPPORTED: announceForAccessibilityWithOptions queue: the macOS accessibility API has no announcement queue` |
| `announceForAccessibilityWithOptions(..., {priority: 'low'})` | lança `E_UNSUPPORTED: announceForAccessibilityWithOptions priority "low": AccessKit has only polite and assertive` |
| `{queue: 'yes'}`, `{queue: 1}`, `{priority: 3}`, `{priority: {}}` | lança `E_ARGUMENT: announceForAccessibilityWithOptions requires queue to be a boolean` (ou `priority to be a string`) |
| Sem leitor de tela | retorna; contado e descartado, nunca guardado |
| Anúncios do mesmo frame | publicados um por update, na ordem pedida, um frame de intervalo |
| Um update que não chega | o anúncio é descartado como expirado depois de 120 pumps |
| `setAccessibilityFocus(1)`, pública e no módulo | lança `E_UNSUPPORTED: Godot has a single focus; moving the screen reader's focus would move the keyboard focus and blur the focused control, which iOS does not do` |
| `sendAccessibilityEvent` com `focus` (aplicação R) | retorna no JS; o erro da aplicação é o mesmo texto |
| Os três métodos depois do stop | lançam `E_MODULE_DISPOSED: AccessibilityManager` de forma síncrona (com o prefixo `Exception in HostFunction:` que o RN acrescenta); um anúncio que esperava foi descartado (`dropped.stopped`) e nada mais é gravado |
| `announcementFinished` | nunca dispara |

## O exemplo

O exemplo de `accessibility-info` ganhou o botão React **Announce**, que chama
`AccessibilityInfo.announceForAccessibility("Announcement N")`, e a linha **Announcements sent**; um quinto botão
nativo, **Announcement reader**, faz o stand-in do leitor de tela (a meta `validation_accessibility_announcer`)
passar por *reader* (o gravador que se comporta como leitor), *none* (um gravador sem leitor) e *system* (sem meta:
o servidor real do Godot, que anuncia pelo AccessKit com o VoiceOver ligado e descarta sem ele). Um rótulo nativo
conta o que o host fez: `requested`, `published` e `dropped`. Com `--capture` salva três quadros do renderer, todos
de 900 × 680 pixels, conferidos um a um. As três capturas que já estavam nesta pasta foram refeitas em `030ebcf` e
saíram idênticas (mesmo SHA-256), então ficam: o exemplo não mudou depois delas.

![Antes de qualquer mudança](accessibility-info-initial.png)

**Inicial** (`206b478b`): três settings desligados, `Increase contrast` desconhecido, os quatro sem backing
`unavailable`, `Events heard` em `none yet`, **Announcements sent** em 0 e o rótulo nativo em
`requested 0 · published 0 · dropped 0`; o stand-in lista o que a plataforma reporta e `announcements: reader`.

![Depois de três mudanças](accessibility-info-changed.png)

**Depois da mudança** (`25732abb`): depois de pressionar os botões nativos Screen reader, Reduce motion e Increase
contrast, o leitor de tela e o movimento reduzido estão ligados e o contraste aumentado está desligado (era
desconhecido); `Events heard` mostra `3 · darkerSystemColorsChanged=false`. Nenhum anúncio foi enviado ainda.

![Depois de dois anúncios](accessibility-info-announced.png)

**Anunciado** (`5e7868a4`): depois de pressionar **Announce** duas vezes, a segunda com o *Announcement reader* em
*none*, **Announcements sent** diz 2 e a linha nativa do host diz `requested 2 · published 1 · dropped 1`: o primeiro
anúncio foi publicado (um elemento live, polite, com o texto no `value`) e o segundo foi descartado porque nenhum
leitor de tela estava lá para falar, e um leitor que ligue depois não ouve nenhum dos dois. O stand-in mostra
`announcements: none`, e `Reduce motion` está `unknown` porque a validação o deixou assim antes.

O exemplo passa 12 checks em headless, 12 com o renderer nativo e 15 com as capturas; o recibo fixa o SHA-256 de
cada captura, de cada relatório e das fontes do exemplo.

## Regressões

No mesmo commit passaram `npm run test:accessibility` (a primeira fatia), `npm run test:accessibility:bridge` (22
checks, local), `npm run test:appearance`, `node --test tests/platform-seams.test.mjs` (17 testes), `npm run
test:examples` (os 35 exemplos, o `accessibility-info` com 12 checks), o `npm run type-check`, o `npm run
check:static`, o `npm run check:publication` (1448 arquivos, sem falha, antes de os arquivos de evidência serem
acrescentados, e 1450 depois do `README.md` e do `execution.json` desta pasta) e o `npm run test:contracts` (302 testes Node e 13 Python, com o `test:parity`, 7 testes, e o
`test:dashboard`, 43, dentro dele).

## Decisões e divergências aceitas

- O anúncio é um elemento novo por chamada (um `value` igual ao anterior não fala de novo), com o texto no `value`
  (um `name` sozinho é silencioso, medido) e um modo live, e nasce dentro do update e é liberado fora do seguinte.
- **Um anúncio por update, na ordem pedida**: mudança da decisão original ("vários anúncios no mesmo update") depois
  de a medição mostrar que o AccessKit não preserva a ordem dentro de um update e de o iOS fazer o último pedido ser o
  ouvido. Custa um frame de latência por anúncio a mais do mesmo frame.
- Contadores além do esboço da especificação: `dropped.empty` (o AccessKit limpa um `value` vazio),
  `dropped.expired` (um anúncio que espera mais de 120 pumps por um update que não chega é descartado, para não
  falar tarde demais; a cauda de um lote maior que isso também), `refused.announceInvalid` (opções do tipo errado,
  `E_ARGUMENT`) e `osTree` dentro de `announcements`.
- Um anúncio sem elemento onde ser colocado é descartado como sem leitor e não consome o update do seguinte.
- Os anúncios têm um core puro próprio (`accessibility_announcement_core.h`, com teste próprio), independente do core
  dos settings, que o inclui só porque o `Backend` carrega a porta dos anúncios.
- `announcementFinished` segue silencioso: macOS, AccessKit e Godot não têm sinal de fim de fala, e o TTS do Godot não é
  o leitor de tela (fala sem ele), então usá-lo inventaria o evento.
- O foco do leitor de tela fica recusado, com o motivo: o Godot tem um foco só, e movê-lo é `grab_focus()`, que dá
  blur num `TextInput` focado; o `UIAccessibilityLayoutChangedNotification` do iOS não faz isso.
- A faixa (c) é um script próprio (`test:accessibility-info:bridge`), com o `.gd` e o `.test.mjs` próprios; o
  inspetor (`tests/accessibility-bridge-probe.m`) é o mesmo da primeira fatia, agora com a interposição.
- Os checks antigos de `AccessibilityInfo` deixaram de ser normativos (o host anterior já tem o módulo): só os 15 dos
  anúncios e do motivo do foco o são.

## Limites

- **Fala real do VoiceOver só manual.** Nada aqui prova que o VoiceOver falou: a faixa (c) prova o que o AccessKit
  pede ao AppKit (texto, nível de prioridade, ordem, uma vez cada). Ouvir o anúncio é uma verificação manual (o
  exemplo, com o VoiceOver ligado e o stand-in em *system*).
- A faixa (c) é local e não roda na CI hospedada; a CI hospedada e o Pages estão pendentes, como dito acima, e o recibo
  de fonte não certifica o build nativo hospedado.
- `announcementFinished` nunca dispara (nenhum sinal de fim de fala na pilha).
- `queue: true` e `priority: 'low'` são recusados: o anúncio do AppKit não tem fila e o AccessKit só tem polite e
  assertive. Uma fila no host precisaria do sinal de fim de fala que ninguém tem.
- O foco programático do leitor de tela é recusado (Godot tem um foco só). Os caminhos investigados foram
  `grab_focus()` com `FOCUS_ACCESSIBILITY` e o virtual `_get_focused_accessibility_element`; uma mudança no Godot (um
  foco de acessibilidade separado) seria o caminho.
- O `accessibilityLiveRegion` de uma View (primeira fatia) coloca `accessibility_live` num nó com `name`, não `value`:
  pelo código do adaptador, provavelmente não fala no macOS. Não medido no VoiceOver e não alterado por esta fatia; a
  frase da pesquisa da fatia 1 que mandava combinar `alert`, `status` e `timer` com ele foi corrigida.
- O dado da ordem do primeiro desenho (`Second, First, Third`) vem da rodada que o achou; o spike é um experimento local
  que não está no repositório (o recibo traz relatório e hashes).
- Os anúncios penduram no elemento da própria `FabricApplication`: duas aplicações na mesma janela anunciam para a
  mesma janela, e um nó sem elemento (janela não visível) descarta. Um lote de mais de 120 anúncios de uma vez perde
  a cauda.
- Mobile: os servidores móveis do Godot não têm ponte de acessibilidade (GF-34 e GF-35). Windows e Linux têm adaptadores
  do AccessKit cujo comportamento de anúncio não foi medido aqui.
- Headless não tem leitor de tela: o gravador faz o papel do `AccessibilityServer`, e o servidor real, em headless,
  só prova o caminho do descarte.
- Esta fatia é a segunda do GF-20 (parte b) e não o completa: foco e teclado, a live region de uma View, ações
  personalizadas, escala de texto e as pontes móveis seguem abertos.
