# Document Up: rerender, retirada e remount do root

Esta fatia valida o que acontece com os listeners `pointerup` de Document e
documentElement quando o root React muda de geração. As oito lanes headless
passaram **2.709 checks**. Os 2.143 checks da
[fatia de lifecycle](../pointer-document-up-lifecycle/README.md) continuam
presentes, na mesma ordem, em cada lane; os novos estágios `refs/*` somam 64
checks por lane, ou 91 nas duas lanes current com D habilitado. A captura
current/enabled passou **535 checks**, com **90 pixels** em sete frames reais
de 760×220. O [recibo](report.json) fixa fontes, hashes e resultados por lane.

Não há alteração na implementação nativa, no SDK nem nos scripts de bundle.
As mudanças estão só nos testes: a fixture compartilhada passou a aceitar o
tipo de evento em `retainRoot`/`manualRetained` (Down continua o padrão), e o
probe/oráculo Up ganhou os estágios abaixo. `I` é `enableImperativeEvents`;
`D` é `enableNativeEventTargetEventDispatching`. Os defaults públicos continuam off.

## Matriz headless

| Interesse | Flags | I | D | Passed/checks | Novos |
| --- | --- | --- | --- | ---: | ---: |
| original | disabled | false | false | 303/303 | 64 |
| original | imperative-only | true | false | 303/303 | 64 |
| original | internal-only | false | true | 311/311 | 64 |
| original | enabled | true | true | 313/313 | 64 |
| current | disabled | false | false | 303/303 | 64 |
| current | imperative-only | true | false | 303/303 | 64 |
| current | internal-only | false | true | 435/435 | 91 |
| current | enabled | true | true | 438/438 | 91 |

```sh
npm run test:pointers:documents:up
```

## O que foi verificado

**Rerender.** Com listeners `all` instalados em A, uma atualização de estado
gera exatamente um commit React. Document, documentElement, a ref da View e o
getter original do root mantêm a mesma identidade. O Up nativo seguinte entrega
`DocC, RootC, RootB, DocB` (ou `DocC, DocB` sem I) com as mesmas fases e a
mesma consulta de root `36=true` de antes do rerender.

**Retirada com contatos ativos.** `retainRoot` registra `OldDoc` no Document e
`OldRoot` no documentElement de A, ambos mantidos depois do unmount. B segura
um contato com listeners de Document próprios, e A segura outro. Ao retirar A
pelo `FabricSurface.unmount`, o host cancela o contato de A antes do teardown:
a folha recebe exatamente um `TouchCancel` original (trusted com D, legacy sem
D) com seu par Raw typed/star. Nenhum `pointerup` é emitido: sem callback,
Raw, consulta de interesse ou atualização React. Os Controls nativos de A
balanceiam, `pointerCancels` sobe um e `pointerUps` não muda. O contato de B
permanece intacto, com as mesmas métricas e contador. Os objetos retidos ficam
desconectados, saem do registro de roots e mantêm sua matriz de métodos. Em
seguida, o Up de B entrega `DocC, DocB` normalmente.

**Remount.** A mesma superfície monta uma nova geração de root, com outro
surfaceId e um Document novo e conectado; nenhuma identidade retida é
reutilizada. Sem listeners novos, um gesto real em A consulta `36=false,
37=false` e não entrega Up: os listeners retidos não recebem input da nova
geração. Uma emissão manual no Document retido ainda chama `OldDoc` uma vez,
untrusted em fase 2, sem Raw, consulta ou estado. Isso mostra que o listener
continua registrado e que a ausência de entrega não vem de remoção.

**Release obsoleto.** Com `DocC/DocB` já instalados no Document novo, o
release do índice cancelado pela retirada é consumido pelo adaptador sem
emitir nada: sem eventos, Raw, consulta, commit ou mudança nas métricas de
ponteiro, processador e roteamento. O gesto completo seguinte, no mesmo
Document novo, entrega `DocC, DocB` e incrementa o contador.

Com `original`, nenhuma consulta do SDK é instalada e os Ups nativos de Document
ficam filtrados, mas TouchCancel/TouchEnd, retirada, isolamento de B, remount e
o controle manual retido se comportam da mesma forma. Com D desabilitado, os
métodos ausentes continuam visíveis e não há listener retido para disparar.

## Capturas nativas verificadas

A execução current/enabled salva os cinco frames anteriores e dois novos. Godot
faz readback dos pixels; Node decodifica os PNGs de forma independente e
compara os 90 pixels com o relatório. Os 438 IDs headless desse modo são
preservados; os 97 checks adicionais cobrem pixels e contador/save.

| A retirado, B com contato | A remontado após gesto novo |
| --- | --- |
| ![A retirado, B2](retired.png) | ![A2/B4](remounted.png) |

| Estágio executado | Contador A | Contador B |
| --- | ---: | ---: |
| Depois da retirada de A | — | 2 |
| Depois do gesto no Document novo | 2 | 4 |

No primeiro frame, os sete pixels da região de A têm a cor de fundo do projeto
(`0b1019`, `default_clear_color` truncado), e a barra de B termina em x448. No
segundo, a nova barra de A termina em x48 e a de B, depois do seu Up positivo,
em x456. Os outros cinco frames repetem os da fatia de lifecycle.

## Limites

A prova cobre listeners bubble de Document e documentElement em um rerender,
uma retirada com contato ativo e uma nova geração de root no mesmo aplicativo.
Não certifica listeners de capture ou de View/elemento através da retirada,
stop do aplicativo, restart do Hermes, hot reload, remount por `key` de toda a
árvore nem coleta de lixo dos objetos retidos. O release obsoleto é o índice
ScreenTouch cancelado; não é uma prova geral de pareamento Down/Up por
pointerId. Mutation durante dispatch, abort dentro de callback, reentrância,
faults de query/resolver Up e pointer capture continuam abertos, assim como
mobile/exports, hardware e performance.

A regressão Down passou **2.723 checks**; contracts passaram **255 Node/13
Python** e a análise estática passou. A CI desta fatia ainda será executada. A
[CI da fatia anterior](../pointer-document-up-lifecycle/hosted-ci.json) continua
válida para os seus 2.143 checks.

As 71 fontes de código/configuração executadas correspondem à implementação
`f7c0babf32717a2e399cb9c9ed90f669d721d8a2` por `git show`/SHA-256. O recibo preserva a
base 3b74ae8 e a árvore dirty da execução; este pin pós-commit não é uma nova corrida.
