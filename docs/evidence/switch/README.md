# Switch: o Switch.js original do RN sobre um switch nativo do Godot

Esta fatia entrega o `Switch` público. Antes ele era um placeholder que lançava
erro ao renderizar; agora o facade renderiza o `Switch.js` original do RN 0.87.1,
que no Godot segue o caminho não Android: a ViewConfig `RCTSwitch` gerada pelo
Codegen, o evento `onChange` (`{value, target}`) e o comando `setValue`. O host
registra o descritor `Switch` compartilhado de iOS/macOS do RN, com os
`SwitchProps`/`SwitchEventEmitter` gerados, e desenha trilho e polegar num
Control do Godot que alterna com clique de mouse e toque reais. O
[recibo](report.json) fixa fontes, hashes e resultados.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `cb0486eb`, mesmo bundle | 4/6 | Exatamente as 2 falhas normativas de montagem: o mount rejeita `Switch` |
| Sabotagem retida: `setValue` nativo inerte | 95/108 | 13 falhas, e o oráculo independente rejeita o relatório |
| Host atual, headless | 108/108 | Mouse e toque reais em duas roots de uma aplicação Hermes |

```sh
npm run test:switch
```

## O que o RN faz

O `Libraries/Components/Switch/Switch.js` escolhe o componente nativo pela
plataforma. No Android usa `AndroidSwitch` (`enabled`, `on`, `trackTintColor`,
comando `setNativeValue`); em qualquer outra usa o spec
`src/private/components/switch/specs/SwitchNativeComponent.js`: componente
`Switch` com `paperComponentName: 'RCTSwitch'`, props `disabled`, `value`,
`tintColor`, `onTintColor` e `thumbTintColor` (mais as depreciadas `thumbColor`,
`trackColorForFalse` e `trackColorForTrue`), evento bubbling `onChange` e comando
`setValue`. Com `Platform.OS === "godot"` o módulo original segue esse caminho:
manda `trackColor.false/true` como `tintColor`/`onTintColor`, `thumbColor` como
`thumbTintColor`, compõe `alignSelf: 'flex-start'` no estilo e converte
`ios_backgroundColor` em `backgroundColor` com `borderRadius: 16`. Ele também
assume o responder JS no toque e recusa ceder.

O Switch é controlado. O `handleChange` chama `onChange`, depois `onValueChange`,
e guarda o valor nativo; um layout effect compara esse valor com `value === true`
e, se o JS manteve o valor antigo, restaura o switch nativo com `setValue`.

O plugin Babel do Codegen compila o spec numa ViewConfig estática; o
`componentNameByReactViewName.cpp` tira o prefixo `RCT` e o C++ cria um nó
`Switch`. No iOS e no macOS o C++ é o componente compartilhado `iosswitch`
(`AppleSwitchComponentDescriptor.h`, `AppleSwitchShadowNode.h`); o arquivo da
plataforma define o nome e a medida (`IOSSwitchShadowNode.mm`: tamanho
intrínseco do `UISwitch` mais 2 pontos de largura). O
`RCTSwitchComponentView.mm` aplica `value` só na montagem ou quando a prop muda,
não emite `onChange` quando `props.value == sender.on`, e o `setValue` move o
switch sem evento. O `UIManagerBinding::dispatchEventToJS` acrescenta `target` e
`timeStamp` a todo payload.

## O que este host fazia

O facade exportava `Switch` como `unavailable("Switch")`, que lançava erro ao
renderizar. O host anterior não tinha descritor `Switch`: com o bundle atual, a
interop legada do Fabric resolve `Switch` e o mount rejeita o nó com
`Unsupported GodotControl kind: Switch`, seguido de `map::at` para os Controls
que faltam.

## A implementação

1. O [facade](../../../src/react-native-platform.jsx) renderiza o `Switch.js`
   original depois das verificações usuais da plataforma (sem Controls inline em
   Text, só estilos suportados). A transformação RN do SDK roda o plugin do
   Codegen, então ViewConfig, evento e comando são os gerados.
2. O [CMake](../../../native/CMakeLists.txt) compila os Props/EventEmitters
   gerados do `FBReactNativeSpec` do pacote e o
   [runtime](../../../native/application_runtime.cpp) registra o
   `SwitchComponentDescriptor` do `iosswitch`. O
   [`switch_view.cpp`](../../../native/switch_view.cpp) é o arquivo de plataforma
   do Godot ao lado do `IOSSwitchShadowNode.mm`: nome do componente e medida. O
   registro do SDK nativo passa a listar essas fontes geradas.
3. O `GodotSwitch` é um `Panel` desenhado à mão: o Panel pinta a aparência do
   host e por cima vão um trilho em pílula e um polegar circular sobre todo o
   frame do Yoga. Clique com o botão esquerdo ou toque que começa e termina
   dentro dele alterna o valor nativo e emite `toggled`; o mouse emulado que o
   Godot gera para um toque é ignorado, e o release sintético quando o Godot
   perde o foco do mouse cancela o press. O runtime só transforma `toggled` em
   `SwitchEventEmitter::onChange` quando o valor nativo difere da prop `value`
   commitada, como o `RCTSwitchComponentView`. `setValue` muda o valor nativo sem
   evento; argumentos malformados são rejeitados com diagnóstico.
4. Cores: `tintColor`, `onTintColor` e `thumbTintColor` pintam o trilho desligado,
   o ligado e o polegar; sem elas o trilho é cinza-claro (`#E9E9EA`) desligado e
   verde (`#34C759`) ligado, com polegar branco. Desabilitado, o switch é
   desenhado com metade da opacidade.
5. Os tipos do facade ganham `Switch`, `SwitchProps` e `SwitchChangeEvent`, com
   checagem no consumidor TSX, e um teste de contrato fixa a ViewConfig gerada e
   o comando.

## Tamanho padrão

O Switch do RN não tem tamanho fixo: é o que o controle da plataforma mede.
Rodando a mesma chamada do RN (`[UISwitch new].intrinsicContentSize`, mais os
2 pontos) nos simuladores locais: **51×31** no iOS 18.4 (UISwitch 49×31) e
**63×28** no iOS 26.3.1 (UISwitch 61×28, SDK do Xcode 26.2). A lane de referência
iOS do repositório usa o runtime iOS mais novo disponível, então o Godot mede
**63×28** um Switch sem tamanho explícito. Um tamanho de estilo vence, e o trilho
do Godot ocupa esse frame (o UIKit mantém o `UISwitch` no próprio tamanho dentro
de um host maior). O `alignSelf: 'flex-start'` do Switch.js mantém a largura
medida numa coluna que estica. Com 28 pontos de altura, a resolução de bordas do
RN limita o raio 16 do `ios_backgroundColor` a 14.

## O registro de eventos compartilhado

O registro de ViewConfigs do RN é global por evento. A ViewConfig gerada do
Switch registra `topChange` como bubbling (como as ViewConfigs de TextInput do
próprio RN no iOS e no Android), enquanto a do GodotControl o registra como
direto; o renderer prefere a entrada bubbling quando as duas existem. Então,
depois que um Switch renderiza, uma mudança no `TextInput` do Godot também
propaga: o `onChange` dele roda uma vez só, e `onChangeCapture`/`onChange` dos
ancestrais também observam, como no RN. O probe registra isso com uma tecla real.

## O que foi verificado

Duas roots de uma aplicação Hermes, com input real do Godot
(`Input.parse_input_event`, sem filtro de dispositivo de validação, para o mouse
emulado do toque chegar à GUI):

- **Controlado.** Clique e toque produzem TouchStart, TouchEnd e uma Change
  mirando o Switch; capture, `onChange`, `onValueChange` e bubble rodam uma vez
  nessa ordem; o payload tem `target` (a tag do Switch), `timeStamp` e `value`.
  Durante o press o Switch é o responder JS e o input nativo não é bloqueado.
  Nenhum `setValue` é necessário.
- **`value` que não muda.** O switch nativo alterna pelo input e exatamente um
  `setValue` do Switch.js o restaura, com mouse e com toque; o mesmo para um
  Switch sem `value`. O mouse emulado do toque chega ao Switch e é ignorado.
- **Desabilitado.** O RN ainda vê o toque, mas nada alterna e nenhum handler roda.
- **Cores e tamanho.** Cores nativas, trilho e polegar desenhados, fundo do host,
  atualização e remoção das cores; frame padrão 63×28, frame explícito 80×40 e
  largura medida numa coluna que estica.
- **Comandos, remoção e duas roots.** `setValue` gerado nos dois sentidos e duas
  chamadas malformadas com exatamente dois diagnósticos; remover um Switch
  pressionado libera o responder, o release não alterna nada e o `setValue` pelo
  ref antigo é ignorado sem diagnóstico; o Switch de B mantém estado e tag
  próprios.

## Controles

O host anterior foi preservado e roda o mesmo bundle: falha exatamente os 2
checks normativos de montagem (nenhum Switch nativo; erros do host), com
`Unsupported GodotControl kind: Switch` e `map::at` no log, sem crash, e o
cleanup fica balanceado. A sabotagem retida torna o `setValue` nativo inerte:
13 checks falham (as restaurações por `setValue`, a cascata do segundo toque no
Switch fixo, os comandos e as cores padrão do Switch sem `value`, que ficou
ligado), e o oráculo independente rejeita o relatório no primeiro toque do Switch
fixo. A fonte foi restaurada byte a byte e
o rebuild reproduziu o host `3e316fb6`.

## Regressões

No host atual passaram os três gates do job `contracts` (261 testes Node, um deles
o novo contrato da ViewConfig `RCTSwitch` gerada, do `topChange` bubbling e do
comando `setValue`, e 13 Python; análise estática e scan de publicação), o
`test:recovery` e as suítes nativas do job `native-cold-start`: 22 exemplos,
transform guards, runtime, aplicação compartilhada, módulos, comandos de foco,
processador e geometria de ponteiro, EventTarget original, ancestralidade,
dispatch e dispatch integrado, serviços, interest 233, Down 2.731 nas oito lanes,
query faults 187, resolver faults 66, Document Up 6.459, View Up 297, Move 220,
Document Move 1.940, hover 158, caminho da raiz 82, Document hover 1.530 e
`parity:godot`. Também passaram o teste afim, o codegen nativo, o SDK nativo
(pack/verify, com as 5 fontes geradas do `FBReactNativeSpec` no registro), os
adapters (registry, loader com 89 checks e 21 casos, runtime com 13 execuções e
213 checks), o consumidor (30 + 40) e o cold start.

A bateria rodou a partir de `3e2dc2d`; o amend que gerou a implementação mudou
só `.fallowrc.json`, o oráculo, o probe e o teste de tipos do consumidor, e os
passos que leem esses arquivos (`test:switch`, `test:contracts`, `check:static`,
`check:publication`) rodaram de novo na implementação. As 72 fontes de
código/configuração executadas (14 produtoras do bundle e da suíte, 57 entradas
do build nativo e 6 de verificação, com sobreposição) correspondem à
implementação `a10b19ef42ded706235d6b9d8bc401a66bd796c6` por `git show`/SHA-256.

## Mescla com a main

Depois da execução, a `main` recebeu o click (#29) e o AppState (#31). A `main`
foi mesclada na branch em `16cf38c`, sem rebase, para manter `a10b19e`
alcançável; os conflitos eram só de anexo, e o `application_runtime.cpp` mesclou
sozinho. No host da árvore mesclada (`5e21fd40`) passaram de novo `test:switch`
(108/108), o click (728 checks), o AppState, os 22 exemplos, `test:recovery` e os
três gates do job `contracts` (261 testes Node). O controle foi refeito com o host
da `main` em `8f80fed` (`06a33274`) no lugar de `cb0486eb`: o mesmo bundle falha
exatamente os 2 checks normativos de montagem. Depois a `main` recebeu o
PanResponder (#32, só SDK e testes): a segunda mescla (`049002d`) manteve o host,
e `test:switch`, o PanResponder e os gates passaram de novo, com o controle refeito
para o bundle novo (as mesmas 2 falhas). O recibo registra as duas corridas em
`mergeReverifications`.

## Limites

Ativação por teclado e foco, acessibilidade (`accessibilityRole="switch"`),
animação e arrasto do polegar, cores e tamanhos padrão por alvo do Godot, o
caminho Android, hardware, exports mobile e performance seguem abertos. Nenhum
GF, checkpoint, peso ou denominador fecha.
