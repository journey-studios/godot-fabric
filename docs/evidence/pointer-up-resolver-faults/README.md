# View Up: falha do resolver da ref antes da consulta

Esta fatia valida o que acontece quando o nativo não consegue nem resolver a ref
pública da View para a consulta de interesse do Up. Um getter único é armado no
slot `canonical.publicInstance` da View real, depois do Down; a primeira leitura
nativa desse slot, no lookup do Up, falha antes de chegar ao SDK. O probe de View
Up passou **296 checks**: os 240 checks da
[fatia de faults de componente](../pointer-up-faults/README.md) continuam
presentes, na mesma ordem, e os dois casos novos somam 56. A captura nativa
passou **324 checks**, com os mesmos 24 pixels. O [recibo](report.json) fixa
fontes, hashes e resultados.

Não há alteração na implementação nativa, no SDK nem nos scripts de bundle: a
leitura dos slots do componente já compartilha a fronteira de exceção da
consulta. As mudanças estão só nos testes. O bootstrap do resolver aceita um
novo getter depois que o anterior foi consumido e o descriptor original foi
restaurado (o probe de resolver do Down continua armando um só); o fixture Up
importa esse bootstrap e expõe `armResolverFault`, e o probe/oráculo de View Up
ganharam os estágios abaixo. Como esse bootstrap não está na lista de
proveniência do bundle, o recibo o fixa separadamente. Os defaults públicos
continuam off.

```sh
node tests/pointer-up-native.test.mjs
```

## O que foi verificado

Os casos rodam na mesma segunda aplicação dos faults de componente, depois deles.
O getter é armado depois do Down, porque o Down também lê o slot. Ele restaura o
descriptor de dados original antes de lançar, então só a primeira leitura falha:

| Caso | Listeners na View | Consultas da View que entram no SDK | Ancestrais e root | Up entregue | Diagnóstico |
| --- | --- | --- | --- | --- | --- |
| resolver-bubble | bubble | `37=false` | consultados, todos `false` | nenhum | 1 |
| resolver-both | capture e bubble | `37=true` | não consultados | capture, bubble | 1 |

**A falha acontece antes do SDK.** O lookup 36 da View lê o slot, o getter
lança, e o nativo rejeita esse lookup sem chamar a consulta: o observador do SDK
não tem nenhuma entrada antes do throw, e a linha de 36 da View nem aparece. O
lookup 37 lê o descriptor já restaurado e entra no SDK normalmente. Com capture e
bubble na View, ele qualifica e o dispatch entrega os dois listeners em fase 2,
num único commit. Só com bubble, a consulta segue para os ancestrais da
superfície e para o root, todos `false`; não há Up, mas o `touchend` chega com
seu par Raw e o contato é limpo.

**Diagnóstico e recuperação.** Cada caso deixa exatamente um
`E_POINTER_LISTENER_QUERY` com a causa do getter. O probe confere que o getter
foi lido uma vez, pelo dono certo, e que o descriptor estava restaurado antes do
throw e continua restaurado depois. O gesto de recuperação qualifica na própria
View e não acrescenta diagnóstico. A segunda aplicação para retendo os sete
diagnósticos da fase (cinco dos faults de componente e dois do resolver).

Como controle negativo, o bootstrap foi alterado temporariamente para que o
getter restaurasse o descriptor e devolvesse a ref em vez de lançar, como se a
falha passasse despercebida. O probe falhou em nove checks, todos dos dois casos
de resolver e o de diagnósticos retidos; os casos de faults de componente não
foram afetados. O oráculo do Node rodou direto sobre esse relatório, sem os gates
de status do probe, e o rejeitou; o mesmo oráculo aceita o relatório final. O
relatório, o log e a saída do oráculo ficam retidos, com hashes no
[recibo](report.json), e o bootstrap foi restaurado byte a byte antes das
regressões.

## Controles com os hosts nativos anteriores

O fixture Up e o bootstrap do resolver entram nos bundles do View Up e do
resolver-fault. Os dois controles foram refeitos com os bundles novos, nos
binários preservados, e reproduzem exatamente as 8 e as 3 falhas normativas
esperadas. O bundle do query-fault não mudou nesta fatia.

## Regressões

O query-fault passou 186 checks e o resolver-fault 65, como antes. O Document Up
passou 6.451 checks nas oito lanes e o Down 2.723. Contracts passaram 255 Node/13
Python, os 22 exemplos e a análise estática também.

## Limites

A prova cobre um getter único no slot `canonical.publicInstance` de uma View, lido
pelo lookup nativo do Up, na segunda aplicação, só na lane de flags habilitadas do
probe de View Up. Não certifica faults em `stateNode`/`canonical`, acessores
permanentes ou proxies, falhas de resolver no handle do root, faults repetidos ou
durante retirada/stop, outras combinações de flags nem caminhos com listeners de
Document. Up capturado/sem hit/sem alvo, pareamento Down/Up por pointerId, outras
categorias de evento, mobile/exports, hardware e performance continuam abertos.

A CI desta fatia ainda será executada. Nenhum GF, checkpoint, dependência, peso
ou denominador foi fechado.

As 82 fontes de código/configuração executadas, incluindo o bootstrap do
resolver, correspondem à implementação `6b3554c4218a1605d94acd3cd4a81c0c20c9a984` por
`git show`/SHA-256. O recibo preserva a base 01d3add e a árvore dirty da execução,
e confere que os commits feitos durante ela (o recibo de CI dos faults de root e o
merge da `main`) não tocam nenhuma entrada executada; este pin pós-commit não é
uma nova corrida.
