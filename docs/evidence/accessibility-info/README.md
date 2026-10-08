# AccessibilityInfo do RN sobre as configurações de acessibilidade do Godot

Esta fatia, a segunda do GF-20 (parte a: as configurações e os eventos), faz o `AccessibilityInfo`
ORIGINAL do RN 0.87.1, lido pelo import público `react-native`, rodar sobre um TurboModule C++ do
host, o `AccessibilityManager` (o contrato do `RCTAccessibilityManager` do iOS, que é o que o
`AccessibilityInfo.js` toma com `Platform.OS` igual a `"godot"`), e sobre o `DisplayServer` do
Godot. Quatro configurações têm leitura no Godot 4.7.2 (o leitor de tela, o movimento reduzido, a
transparência reduzida e o contraste aumentado, que o RN chama de `darkerSystemColors`); o host as
lê uma vez por frame, porque o Godot não tem sinal de mudança, e cada mudança de valor conhecido é
um evento. As outras quatro (negrito, tons de cinza, cores invertidas e a preferência por
cross-fade) não têm o que ler: seus getters rejeitam, nunca resolvem `false`. Anúncio e foco
programático são a parte b da fatia e lançam `E_UNSUPPORTED`. Um dono por `FabricApplication`,
compartilhado pelas roots da aplicação, cria o módulo quando o JS importa o `AccessibilityInfo.js`
pela primeira vez e o encerra no stop. O [recibo](execution.json) fixa fontes, hashes, capturas e
resultados.

Todo link de código abaixo está fixado no commit de implementação
[`d54e8cd`](https://github.com/journey-studios/godot-fabric/commit/d54e8cdaea64663ed6f9d0f8f93303dec463a162)
(árvore `cb3c08d1`), em cujo conteúdo, limpo e sem arquivos novos, cada comando abaixo rodou.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `43a59607` (main `dd05760`) | 14/54 | Exatamente as 40 falhas normativas: sem o módulo, cada getter rejeita com o texto do próprio RN, `NativeAccessibilityManagerIOS is not available`, nenhum evento chega, e o `sendAccessibilityEvent` de qualquer tipo falha com o erro antigo; os 14 checks estruturais valem nos dois hosts |
| Sabotagem `unknown-as-false`, host `c8d8e847` | 42/54 | Exatamente 12 falhas: lê `-1` como desligado, então o getter resolve `false` onde o RN deve ouvir que não se sabe; o oráculo rejeita o relatório com `A/lazy-read: increaseContrast` |
| Sabotagem `emit-every-poll`, host `d1f2f223` | 37/54 | Exatamente 17 falhas: cada poll reporta o valor conhecido de todos os settings, mudou ou não; o oráculo rejeita com `A/lazy-read: screenReader` |
| Sabotagem `swapped-settings`, host `70b1da49` | 46/54 | Exatamente 8 falhas: as chaves da meta de movimento reduzido e transparência reduzida trocadas na tabela de descritores, então a mudança de um sai como a do outro; o oráculo rejeita com `A/motion-on/motion/get` |
| Sabotagem `display-name`, host `28bf281f` | 52/54 | Exatamente 2 falhas: nomeia um método do `DisplayServer` que não existe para o movimento reduzido; o host lê `-1` (nunca desligado) e o getter continua rejeitando, mas o nome não é o do engine, e o oráculo rejeita com `A/early: reduceMotion` |
| Host atual `29678056`, headless | 54/54 | Duas aplicações do mesmo bundle (a meta de validação com duas roots, e o backend real do Godot), com o oráculo independente |
| Exemplo `accessibility-info` | 10 headless, 10 com o renderer nativo, 12 com captura | Cliques reais no botão React, botões nativos que fingem o sistema, duas capturas |

As lanes executam o mesmo bundle (`ee95940a`), com as mesmas fontes de teste e SDK; só os produtores
nativos diferem. O host anterior foi compilado a partir da main `dd05760`, antes de a árvore receber
o trabalho desta fatia, e o binário anterior fica em `build/accessibility-info-previous-host/`, local
e fora do repositório; o teste só aceita o controle se o dylib em `addons/` for esse binário (compara
o SHA-256). As quatro sabotagens são retidas: `node scripts/accessibility-info-sabotage.mjs` troca um
trecho de `native/accessibility_info_core.h` de cada vez, recompila, roda o runner e o oráculo,
restaura a fonte byte a byte (hash conferido), recompila o host genuíno e registra tudo em um
recibo local. O host genuíno e o restaurado têm o mesmo SHA-256, `29678056…`. Uma quinta sabotagem, a
falta do alias `legacySendAccessibilityEvent` no plugin de plataforma, quebra o bundle e não o host, e
é mostrada por `tests/platform-seams.test.mjs` (17/17).

**Ambiente**: macOS arm64 (26.6.2, Apple M3 Pro); Godot oficial 4.7.2 (`ed1daf0bf`), RN 0.87.1,
React 19.2.3, Hermes 250829098.0.17 e Node v22.23.3. A suíte roda em modo headless; o exemplo, em
headless e com o renderer nativo.

```sh
npm run test:accessibility-info
```

Com o host anterior instalado em `addons/`, o mesmo runner confere o controle com
`node tests/accessibility-info-native.test.mjs --allow-original-negative`; os hosts sabotados rodam
com `--sabotage=unknown-as-false`, `--sabotage=emit-every-poll`, `--sabotage=swapped-settings` e
`--sabotage=display-name`, e o launcher abre o
[exemplo](https://github.com/journey-studios/godot-fabric/blob/d54e8cdaea64663ed6f9d0f8f93303dec463a162/examples/accessibility-info/README.md)
com `npm run example -- accessibility-info` (também `--headless`, `--check` e `--capture`).

> **CI hospedada e Pages pendentes.** O passo `npm run test:accessibility-info` e o artefato
> `native-accessibility-info` do workflow `contracts.yml` ainda não rodaram na CI hospedada, e nada
> foi publicado no Pages; os dois entram depois do merge. Tudo o que esta página registra é
> evidência local, em macOS arm64. O recibo de fonte (o recibo do bundle, que fixa o SHA-256 de cada
> fonte executada) **não certifica o build nativo** que um runner hospedado faz a partir delas.
> O checkpoint `slice` do GF-20 já foi fechado pela primeira fatia; esta, a segunda, não fecha nenhum
> checkpoint, GF, peso ou denominador.

## O que o RN faz

Com `Platform.OS` igual a `"godot"`, o `AccessibilityInfo.js` toma o ramo do iOS: cada getter é uma
`Promise` que chama `NativeAccessibilityManager.getCurrentXState(resolve, reject)`, e um módulo
ausente rejeita com `NativeAccessibilityManagerIOS is not available`. O módulo é procurado com
`TurboModuleRegistry.get('AccessibilityManager')` na importação do arquivo; o módulo do Android,
`AccessibilityInfo`, é procurado do mesmo jeito e vale `null` neste host. O `RCTAccessibilityManager`
do iOS lê as configurações uma vez no `init` e responde cada getter com `onSuccess` a partir desse
valor; o callback de erro é `__unused`, ou seja, o iOS nunca o chama, e o Godot, que pode não saber,
o usa. `addEventListener` mapeia nove nomes públicos para oito eventos de dispositivo
(`change` é o apelido de `screenReaderChanged`), liga-se ao `RCTDeviceEventEmitter` direto, e um nome
fora do mapa devolve `{remove() {}}`. O iOS emite só quando o valor novo difere do guardado, e age no
`sendAccessibilityEvent` só para `focus`. `isHighTextContrastEnabled` (`false`),
`isAccessibilityServiceEnabled` (uma rejeição) e `getRecommendedTimeoutMillis` (o prazo dado)
respondem sem módulo nativo. O `legacySendAccessibilityEvent.js` só importa a si mesmo: o plugin de
plataforma resolve o `.ios.js`. A [nota de pesquisa](https://github.com/journey-studios/godot-fabric/blob/d54e8cdaea64663ed6f9d0f8f93303dec463a162/docs/research/accessibility-info.md)
tem as fontes com as linhas.

## O que esta fatia faz

1. Um [`AccessibilityInfo`](https://github.com/journey-studios/godot-fabric/blob/d54e8cdaea64663ed6f9d0f8f93303dec463a162/native/accessibility_info.cpp)
   por `FabricApplication` registra o `AccessibilityManager` no registro de TurboModules, com o
   `NativeAccessibilityManagerCxxSpec` gerado pelo RN (os doze métodos, nenhum sem implementação), e
   envia os eventos pelo `emitDeviceEvent` original. O
   [`StoppableInvoker`](https://github.com/journey-studios/godot-fabric/blob/d54e8cdaea64663ed6f9d0f8f93303dec463a162/native/stoppable_invoker.h)
   (o mesmo dos módulos de rede e dos serviços de dispositivo) descarta o que ficou na fila depois
   do stop.
2. O [núcleo puro](https://github.com/journey-studios/godot-fabric/blob/d54e8cdaea64663ed6f9d0f8f93303dec463a162/native/accessibility_info_core.h)
   (a leitura de três estados, a regra de mudança, os códigos de erro, os contadores, e as duas
   tabelas de descritores com tudo o que nomeia um setting) não precisa de Godot nem do RN e tem
   [teste próprio](https://github.com/journey-studios/godot-fabric/blob/d54e8cdaea64663ed6f9d0f8f93303dec463a162/native/accessibility_info_core_test.cpp),
   que passa (`ACCESSIBILITY_INFO_CORE_PASSED`, 13 funções) e roda também dentro da suíte.
3. O backend do Godot lê `accessibility_screen_reader_active`, `accessibility_should_reduce_animation`,
   `accessibility_should_reduce_transparency` e `accessibility_should_increase_contrast` pelo
   singleton do `DisplayServer` (sem mexer no perfil de classes). Só um inteiro é leitura: um método
   que o `DisplayServer` não tem, ou uma chamada que devolve outra coisa, é `-1`, nunca `0`. A meta
   `validation_accessibility_settings` da aplicação substitui só as chaves presentes
   (`screen_reader`, `reduce_animation`, `reduce_transparency`, `increase_contrast`).
4. O módulo toma a primeira leitura quando é criado, como o `init` do iOS, e o `poll` do
   `ApplicationRuntime::pump` lê de novo uma vez por frame, antes do dreno do trabalho enfileirado.
   Um getter responde a última leitura: `1` resolve `true`, `0` resolve `false`, `-1` chama o
   callback de erro com um `Error` `E_ACCESSIBILITY_UNKNOWN`; os quatro sem backing chamam-no com
   `E_ACCESSIBILITY_UNAVAILABLE`.
5. Uma mudança é um valor conhecido diferente do último valor conhecido. Ficar desconhecido não emite,
   `-1` depois de `-1` não emite, voltar ao último valor conhecido não emite, e o primeiro valor
   conhecido depois de só desconhecidos é uma mudança. O evento sai uma vez para cada ouvinte de cada
   root, em ordem, e `change` e `screenReaderChanged` ouvem a mesma emissão.
   `boldTextChanged`, `grayscaleChanged`, `invertColorsChanged` e `announcementFinished` nunca disparam.
6. `setAccessibilityContentSizeMultipliers` valida o argumento (`E_ARGUMENT`) e lança
   `E_UNSUPPORTED`; `setAccessibilityFocus`, `announceForAccessibility` e
   `announceForAccessibilityWithOptions` lançam `E_UNSUPPORTED` citando a fatia 2b. O
   `sendAccessibilityEvent` de um tipo que não é `focus` é ignorado e contado por tipo, como no iOS; `focus`
   falha em voz alta (`focus is not implemented yet (GF-20 slice 2b)`).
7. O módulo é criado pela primeira leitura de `AccessibilityInfo`, pelo getter CommonJS de
   [`src/accessibility-info.js`](https://github.com/journey-studios/godot-fabric/blob/d54e8cdaea64663ed6f9d0f8f93303dec463a162/src/accessibility-info.js),
   reexportado por `src/platform-environment.js` no lugar do stub. `environmentStats().reduceMotion`
   conta os ouvintes de `reduceMotionChanged`, e o `disposeEnvironment` remove os ouvintes dos oito
   eventos. O plugin de plataforma resolve o `legacySendAccessibilityEvent` do RN para o `.ios.js`.
   Depois do stop, qualquer um dos doze métodos de um módulo retido lança `E_MODULE_DISPOSED` de forma
   síncrona e nada mais é emitido.

## O que foi verificado

O [probe](https://github.com/journey-studios/godot-fabric/blob/d54e8cdaea64663ed6f9d0f8f93303dec463a162/tests/accessibility-info-probe.gd)
roda duas `FabricApplication` reais, cada uma com seu Hermes e o mesmo bundle:

- **A, a meta de validação**: duas roots, 26 passos. Cobre a criação preguiçosa (nenhum módulo
  antes da primeira leitura, e a busca do módulo do Android devolve `null` sem criar nada); os
  getters com valor conhecido, com `-1`, com chave ausente e com valor inválido; os quatro
  eventos, cada um exatamente uma vez por mudança, aos ouvintes de duas roots e de uma biblioteca,
  em ordem de assinatura, com o apelido `change`; quatro settings que mudam no mesmo frame (quatro
  eventos, na ordem dos settings); uma plataforma inalterada, `-1` depois de `-1` e a volta ao último
  valor conhecido, que não emitem; os callbacks do próprio módulo (sucesso assíncrono, erro síncrono
  com um `Error`); o argumento dos multiplicadores; os anúncios e o foco; o `sendAccessibilityEvent` dos
  tipos que o iOS ignora; remover uma assinatura duas vezes, desmontar uma root e o stop, com o módulo
  retido.
- **R, o backend real**: criada e montada antes de A, e viva enquanto A muda quatro settings e
  para. No Godot headless os quatro valem `-1`: todo getter rejeita, nenhum evento chega, e um evento
  `focus` ainda falha com a mensagem da fatia 2b, uma linha `ERROR:` que o probe declara no relatório
  e o runner confere (nenhum outro erro do engine pode se esconder no log).
- **Os nomes são os do engine**: em headless as quatro leituras reais valem `-1`, então uma leitura tirada
  do método errado parece a certa. O que as distingue é o `displayMethod` que o snapshot do host nomeia
  para cada setting: o probe confere que cada um é um método que o `DisplayServer` tem
  (`ClassDB.class_has_method`) e que a resposta do engine ao chamá-lo é o que o host leu por último; o
  oráculo confere os quatro nomes contra a lista dele dos nomes do Godot 4.7.2.

O [oráculo](https://github.com/journey-studios/godot-fabric/blob/d54e8cdaea64663ed6f9d0f8f93303dec463a162/tests/accessibility-info-oracle.mjs)
refaz cada passo a partir das regras do RN e do iOS (o `AccessibilityInfo.js`, o `RCTAccessibilityManager`):
chamadas, eventos, assinaturas, os erros e os contadores do host, 31 passos refeitos (26 de A e 5 de R) e 9
frames em que algum setting mudou, com os eventos por nome (3 do leitor de tela, 4 do movimento reduzido, 2
da transparência reduzida e 3 do contraste aumentado, e 0 dos outros quatro). O teste o alimenta com um
relatório cujos checks foram todos marcados como passados, e é ele que rejeita o host anterior e as
sabotagens, sem confiar no probe. A sonda julga ordem e contagem, nunca tempo: espera o contador de polls
do host (frames entregues), e o oráculo confere que o host fez pelo menos os polls que a sonda esperou e
nenhum depois do stop.

O host anterior roda o mesmo bundle: as duas aplicações montam e param, e ele falha exatamente os checks
que precisam do módulo nativo. As quatro sabotagens (`-1` lido como desligado, um poll que emite sempre,
dois settings com as chaves trocadas e um nome de método inexistente) são rejeitadas pelo probe e pelo
oráculo; a última mostra que um método que o engine não tem faz o host ler desconhecido, e não
desligado.

## Método → comportamento observado

Lido do relatório da execução (`execution.json`, `observedBehavior`), em headless, com a meta de validação em A:

| API | Observado |
| --- | --- |
| `isScreenReaderEnabled` (a plataforma reporta `1`) | resolve `true` |
| `isReduceMotionEnabled` (reporta `0`) | resolve `false` |
| `isDarkerSystemColorsEnabled` (reporta `-1`) | rejeita `E_ACCESSIBILITY_UNKNOWN: the platform does not report increase contrast` |
| `isBoldTextEnabled`, `isGrayscaleEnabled`, `isInvertColorsEnabled`, `prefersCrossFadeTransitions` | rejeitam `E_ACCESSIBILITY_UNAVAILABLE: Godot has no way to read bold text` (e o equivalente de cada um) |
| `isHighTextContrastEnabled`, `isAccessibilityServiceEnabled`, `getRecommendedTimeoutMillis(3000)` | `false`; rejeita `isAccessibilityServiceEnabled is only available on Android`; `3000` |
| `AccessibilityManager.getCurrentBoldTextState` (chamada direta ao módulo) | o callback de erro, síncrono, recebe um `Error` `E_ACCESSIBILITY_UNAVAILABLE: ...`; o de sucesso nunca é chamado |
| `AccessibilityManager.getCurrentReduceTransparencyState` (reporta `-1`) | o callback de erro recebe `E_ACCESSIBILITY_UNKNOWN: the platform does not report reduce transparency` |
| `setAccessibilityContentSizeMultipliers({extraLarge: 1.5, small: null})` | lança `E_UNSUPPORTED: ... needs a content size category, which Godot does not have` |
| `setAccessibilityContentSizeMultipliers({large: -1})` | lança `E_ARGUMENT: ... requires a finite number above zero for large` |
| `announceForAccessibility`, `announceForAccessibilityWithOptions`, `setAccessibilityFocus` | lançam `E_UNSUPPORTED: ... is not implemented yet (GF-20 slice 2b)` |
| `sendAccessibilityEvent` com `click`, `viewHoverEnter` e `windowStateChange` | retorna; ignorado e contado por tipo (`click` 2, `viewHoverEnter` 1, `windowStateChange` 1), sem erro |
| `sendAccessibilityEvent` com `focus` (aplicação R) | retorna no JS; o erro da aplicação é `focus is not implemented yet (GF-20 slice 2b)` |
| Qualquer dos doze métodos depois do stop | lança `E_MODULE_DISPOSED: AccessibilityManager` de forma síncrona (a mensagem leva o prefixo `Exception in HostFunction:` que o RN acrescenta à exceção de uma função do host) |
| Eventos | uma emissão por mudança de valor conhecido, aos ouvintes de todas as roots em ordem; nenhuma ao ficar desconhecido, em `-1` depois de `-1` ou ao voltar ao último valor; `boldTextChanged`, `grayscaleChanged`, `invertColorsChanged` e `announcementFinished` nunca disparam |

## O exemplo

`npm run example -- accessibility-info` abre uma tela com as oito configurações do `AccessibilityInfo`
(cada getter e cada evento do ramo do iOS), uma linha de eventos ouvidos e o botão React **Ask again**,
que pergunta tudo de novo. Quatro botões nativos do Godot, à direita, fingem o sistema: cada clique
passa um setting por *system* (a leitura real), *unknown*, *off* e *on*, trocando a meta
`validation_accessibility_settings`, e um rótulo nativo mostra o que o stand-in reporta. Sem `--validate`,
a tela segue os settings reais da máquina até um botão assumir um deles. A validação nomeia as quatro
chaves da meta (para a execução ler o mesmo numa máquina com os settings ligados e no engine headless),
pressiona os botões nativos, clica o **Ask again** com eventos reais de mouse e lê o resultado da árvore
nativa, dos contadores do host e do que o React observou, esperando os polls que o host conta, nunca
tempo. Com `--capture` salva dois quadros do renderer:

![Antes de qualquer mudança](accessibility-info-initial.png)

**Inicial**: três settings desligados (`Screen reader`, `Reduce motion`, `Reduce transparency`),
`Increase contrast` desconhecido (a plataforma não o reporta), os quatro sem backing `unavailable`, `Events
heard` em `none yet` e, no rótulo nativo, o que o stand-in reporta (`increase contrast: unknown`).

![Depois de uma mudança](accessibility-info-changed.png)

**Depois da mudança**: depois de pressionar os botões nativos Screen reader, Reduce motion e Increase
contrast, o leitor de tela e o movimento reduzido estão ligados e o contraste aumentado está desligado (era
desconhecido). `Events heard` mostra `3 · darkerSystemColorsChanged=false`: três eventos, o último deles o do
contraste; a lista completa (`screenReaderChanged=true`, `reduceMotionChanged=true`,
`darkerSystemColorsChanged=false`, nessa ordem, uma vez cada) está no relatório que a validação confere. A
transparência reduzida, que não mudou, segue desligada e sem evento, e os quatro `unavailable` seguem
`unavailable`.

As duas capturas têm 900 × 680 pixels, foram conferidas uma a uma e saíram idênticas (mesmo SHA-256) em
duas execuções; o recibo fixa o SHA-256 de cada uma. O exemplo passa 10 checks em headless, 10 com o
renderer nativo e 12 com as capturas.

## Regressões

No mesmo commit passaram `npm run test:accessibility` (a primeira fatia, 80 checks), `npm run test:appearance`,
`npm run test:device-services`, `node --test tests/platform-seams.test.mjs` (17 testes, com o do alias
novo), `npm run test:typography` e `npm run test:nativewind` (4 testes cada, que exigem
`environmentStats().reduceMotion` igual a 0 na saída), o `npm run type-check`, o `npm run check:static`, o
`npm run check:publication` e o `npm run test:contracts` (302 testes Node e 13 Python, com o `test:parity`,
7 testes, e o `test:dashboard`, 43, dentro dele). O `AccessibilityInfo` entra nos tipos de
`types/react-native.ts`, verificados por `tests/types/consumer.tsx` (um handler que não recebe um booleano e
um evento desconhecido são rejeitados).

## Decisões e divergências aceitas

- O primeiro valor conhecido depois de só leituras desconhecidas é uma mudança e emite (a regra "muda em
  relação ao último valor conhecido" não tem valor anterior para comparar); está documentado na nota de
  pesquisa e coberto pelo probe e pelo núcleo.
- Os getters públicos (promessas) depois do stop não são observados: um runtime parado não drena
  microtasks. A checagem de `E_MODULE_DISPOSED` depois do stop está nos doze métodos do módulo retido e no
  `announceForAccessibility` público, que lança de forma síncrona; o oráculo recusa um getter público
  pós-stop.
- `setAccessibilityContentSizeMultipliers` é mais estrito que o iOS: exige um número finito acima de zero
  por categoria (`E_ARGUMENT`), enquanto o iOS guarda qualquer número e o corrige para `1.0` ao usá-lo.
- O erro de um getter é um `Error` entregue ao callback de erro de forma síncrona, não uma string: a promessa
  rejeita com um erro normal cuja mensagem começa com o código.
- O exemplo faz parte desta entrega por exigência do checklist de documentação, embora a especificação não o
  listasse entre as áreas; as edições compartilhadas são só linhas aditivas em `examples/entry.jsx`,
  `examples/catalog.json` e `examples/README.md`.
- A entrada `AccessibilityInfo` da auditoria de compatibilidade continua `environment_or_utility_subset`
  (como `Linking`), com evidência e nota novas; as contagens da fachada não mudam.

## Limites

- Os quatro valores reais não são lidos pela suíte: o engine headless reporta `-1` para todos, e os
  valores vêm da meta de validação. Uma mudança real de VoiceOver, Reduce Motion, Reduce Transparency ou
  Increase Contrast não é exercitada, e o leitor de tela é só o VoiceOver no macOS.
- Em headless a troca entre dois métodos do `DisplayServer` que existem os dois passaria: ambos leem `-1`.
  A suíte prova que cada setting nomeia um método que o engine tem, que o engine responde a ele como o host
  leu e que os nomes são os da lista do oráculo (o Godot 4.7.2), não que o método é o certo numa máquina que
  reporta um valor; a troca das chaves da meta, que o headless distingue, é a que a sabotagem
  `swapped-settings` exercita.
- Anúncio (`announceForAccessibility`, `announceForAccessibilityWithOptions`), foco programático
  (`setAccessibilityFocus` e `sendAccessibilityEvent` com `focus`) e `announcementFinished` ficam para a
  fatia 2b do GF-20, que depende de uma investigação sobre o AccessKit do macOS anunciar live regions.
- Os servidores móveis do Godot reportam `-1` hoje, então todo getter rejeita `E_ACCESSIBILITY_UNKNOWN`
  lá; as pontes de iOS e Android são o GF-34 e o GF-35.
- Negrito, tons de cinza, cores invertidas, cross-fade e a categoria de tamanho de conteúdo não têm
  backing no Godot: rejeitam, e seus eventos nunca disparam. Escala de texto
  (`setAccessibilityContentSizeMultipliers`, `fontScale`) está fora desta fatia.
- Uma mudança é vista no frame seguinte: não há callback de mudança para esperar.
- Windows e Linux têm os mesmos métodos no `DisplayServer`, mas seus valores não foram verificados.
- Não há CI gráfica: a execução hospedada é headless.
- CI hospedada e Pages pendentes, como dito acima. Esta fatia é a segunda do GF-20 (parte a) e não o
  completa: foco e teclado, anúncios, ações personalizadas, escala de texto e as pontes móveis seguem abertos.
