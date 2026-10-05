# Document Up: `once` e `AbortSignal` original do React Native

Esta fatia amplia a validação de lifecycle dos listeners bubble de Document.
As oito lanes headless foram executadas e passaram **2.143 checks**. A
[baseline anterior](../pointer-document-up/README.md) preserva seus 1.371 checks,
243 checks gráficos e duas imagens; esses recibos não são substituídos pelas
novas contagens. A captura atual passou **414 checks**, incluindo **62 pixels**
e cinco verificações de contador/save, em cinco frames reais de760×220.
O [recibo](report.json) fixa as fontes executadas, hashes e resultados por lane.

Não há alteração na implementação nativa nem no SDK. Cada lane usa duas roots
reais em uma aplicação Hermes, input Godot ScreenTouch e os mesmos gates
originais de RN 0.87.1. `I` é `enableImperativeEvents`; `D` é
`enableNativeEventTargetEventDispatching`. Os defaults públicos continuam off.

## Matriz headless ampliada

| Interesse | Flags | I | D | Passed/checks |
| --- | --- | --- | --- | ---: |
| original | disabled | false | false | 239/239 |
| original | imperative-only | true | false | 239/239 |
| original | internal-only | false | true | 247/247 |
| original | enabled | true | true | 249/249 |
| current | disabled | false | false | 239/239 |
| current | imperative-only | true | false | 239/239 |
| current | internal-only | false | true | 344/344 |
| current | enabled | true | true | 347/347 |

O comando atual mantém os casos anteriores e adiciona três cenários independentes:

```sh
npm run test:pointers:documents:up
```

A [fixture](../../../tests/pointer-document-up-fixture.jsx), o
[driver nativo](../../../tests/pointer-document-up-probe.gd) e o
[oráculo Node](../../../tests/pointer-document-up-native.test.mjs) registram
os estágios `lifecycle/once`, `lifecycle/abort-pre` e `lifecycle/abort-after`.
O registro de uma tentativa de addEventListener não é, sozinho, evidência de
membership; a consulta original e a entrega efetiva estabelecem o resultado.

## O que foi verificado

Com `current` e D habilitado, o primeiro Up de `once` observa root `36=true`
e entrega um `DocB` trusted em fase 3. Up typed/star Raw carregam seu payload,
timestamp e pointerId reais; a atualização funcional incrementa uma vez em
um commit. O segundo gesto observa `36=false, 37=false`, sem callback/Raw Up
ou atualização. A emissão manual após os gestos também fica vazia, confirmando
que a entrega nativa consumiu o listener.

Com `original`, nenhuma consulta do SDK é instalada. D ainda permite registrar
`once`, mas os dois Ups nativos filtrados não o consomem. A primeira emissão
manual posterior chama o listener uma vez, untrusted em fase 2, sem Raw nativo
ou incremento React; a segunda emissão manual fica vazia. Com D desabilitado,
a ausência dos métodos permanece visível e nenhum protótipo é emprestado.

Pre-aborted verifica o `AbortSignal` original do RN e `aborted=true` antes da
inscrição. Os dois gestos e a emissão manual ficam sem entrega Up. No caso
abort-after, o sinal original começa `aborted=false`; o primeiro Up é positivo
em current/D e um controle manual posterior é positivo em todas as lanes D.
O abort muda `aborted` para true sem consultas do SDK, alterações de contador,
commits ou métricas de ownership físico. O segundo Up e o controle manual
pós-abort ficam vazios.

Esses gestos reutilizam as verificações exatas de contexto, prioridade Discrete,
restauração de Default/global event, terminais TouchEnd/Raw e contatos físicos.
A limpeza não depende de entregar Up: todos os segundos gestos terminam
normalmente. Cancel e stop continuam com seus próprios aceites. Com D false,
os métodos do Document estão ausentes e nenhum sinal é associado ao registro
na fixture; isso não declara ausência da classe AbortSignal.

## Capturas nativas verificadas

A execução current/enabled salva os dois frames anteriores e três frames de
`once`. Godot faz readback dos pixels; Node decodifica os PNGs de forma
independente e compara os62 pixels com o relatório. Os347 IDs headless desse
modo são preservados; os67 checks adicionais cobrem pixels e contador/save.

| Antes de `once` | Após o primeiro Up | Após o segundo Up |
| --- | --- | --- |
| ![A12/B2](once-before.png) | ![A13/B2 após primeiro Up](once-first.png) | ![A13/B2 preservado](once-second.png) |

Contadores observados:

| Estágio executado | Contador A | Contador B |
| --- | ---: | ---: |
| Antes do primeiro gesto `once` | 12 | 2 |
| Depois do primeiro Up | 13 | 2 |
| Depois do segundo Up | 13 | 2 |

No primeiro Up, a barra amarela deA muda sua borda dex88 parax92. No segundo,
ela permanece emx92; a barra deB mantémx448. Esses pixels confirmam os
contadores junto à query negativa e à ausência de um segundo commit. As imagens
mostram `once`; abort é provado pelos estágios executados, sem imagem própria.

## Limites

A prova cobre esses três cenários bubble de Document e as quatro combinações
I/D com original/current. Não fecha o GF completo nem certifica `once`/abort
em View/documentElement ou outras fases, abort dentro de um callback/contato
ativo, mutation durante dispatch, retired refs/remount, Up query/resolver faults,
reentrância, pointer-capture ownership, coalescing ou negociação completa de
responders. Down permanece filtrado, sem prova de par público Down/Up pointerId.
Mobile/exports, hardware, development renderer e performance seguem abertos.

A implementação nativa e o SDK são os anteriores; seus recibos permanecem
separados. A regressão Down atual passou **2.723 checks**; contracts passaram
**255 Node/13 Python**, análise estática e scan de publicação passaram.
A [CI anterior](../pointer-document-up/hosted-ci.json) passou1371checks em84270fb;
a CI específica desta ampliação2143 permanece pendente. Veja o [exemplo](../../../examples/pointer-document-up/README.md)
e a [pesquisa](../../research/pointer-document-up.md).
