# Isolated Document and documentElement pointerup

This native validation registers ordinary original RN `pointerup` listeners on
Document and documentElement while the blue target has no JSX pointer helper.
Two roots share one Hermes application; each owns a distinct original Document.
The fixture is outside the interactive launcher catalog and public EventTarget
flags remain disabled.

The historical [evidence](../../docs/evidence/pointer-document-up/README.md) records eight
successful headless lanes: four immutable original flag configurations for each
of `interestMode=original` and `current`, totaling 1,371 executed checks. The current/enabled macOS viewport passes 243 checks, including 20 actual
pixels and two counter/save assertions. The screenshots below are native frames.

## Run the isolated matrix

After existing native setup, from the repository root:

```sh
npm run test:pointers:documents:up
```

A bounded lane can be selected explicitly:

```sh
node tests/pointer-document-up-native.test.mjs --interest=current --flag=internal-only
node tests/pointer-document-up-native.test.mjs --interest=original --flag=enabled
```

`internal-only` enables native EventTarget dispatch and retains the original
Document methods while View/documentElement imperative methods remain absent.
`enabled` enables both original flags. The original-interest control installs no
SDK query; positive manual registration controls still run where methods exist.
Every lane uses actual Godot ScreenTouch input and its own Hermes execution.
The public application bundle is preserved.

Reproduce the verified native captures:

```sh
node tests/pointer-document-up-native.test.mjs --interest=current --flag=enabled --capture
```

## Ordinary original Document syntax inside the opt-in

The example below assumes the isolated bootstrap has enabled D before RN imports
and selected the current-interest experimental dispatcher. It does not change
public defaults or introduce a `GodotFabric` event method:

```jsx
import {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';

function DocumentUpCounter() {
  const ref = useRef(null);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const doc = ref.current.ownerDocument;
    const onUp = event => {
      if (event.isTrusted) setCount(value => value + 1);
    };
    doc.addEventListener('pointerup', onUp, true);
    doc.addEventListener('pointerup', onUp);
    return () => {
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('pointerup', onUp);
    };
  }, []);
  return <View ref={ref} testID="document-up-target"
    style={{width: 110 + count * 4, height: 70, backgroundColor: '#2563eb'}} />;
}
```

A native Up on the leaf reaches Document capture and bubble at phases 1 and 3.
Each listener increments the functional counter once; both updates batch into
one React/native commit. An untrusted public `dispatchEvent` is only a listener
installation control, so this snippet deliberately increments on trusted input.
For documentElement, use `doc.documentElement` and the same add/remove methods;
those methods additionally require I. A capture listener's third argument does
not request pointer-capture ownership.

The [executed wrapper](../../tests/pointer-document-up-fixture.jsx) reuses the
[actual original Document scene](../../tests/pointer-document-fixture.jsx).
B has no leaf ref; the bounded test obtains its existing original Document from
RN's original root getter. That internal fixture control is not a new public
Godot Fabric lookup API.

## What the cases exercise

- Document-only, element-only, combined and independently capture-only listeners
  check exact method gates, native root qualification, callback order and phases.
  Combined enabled delivery is `DocC, RootC, RootB, DocB`.
- Root qualification reads `36=true` for bubble interest or `36=false, 37=true`
  for capture-only. Earlier View lookups are real false observations. Typed/star
  Raw still occur only once per native Up, with the callbacks' actual payload,
  timestamp and pointer ID.
- An initially cold no-ref B leaf keeps its null publicInstance slot through
  the actual first Down root query. B's later Up runs after the original
  dispatcher has legitimately materialized the target.
- A has no listeners while B has Document listeners and holds a contact. A's
  negative Up cannot borrow B's interest, alter its counter or end its contact;
  B's own Up then works. Final listener removal, real Cancel and balanced stop
  have independent terminal checks.
- A separate JSX sentinel proves Up transport in every flag lane. Methods that
  are absent remain absent; the fixture never borrows an EventTarget prototype.

The blue Controls are native targets, green is the JSX sentinel, yellow width
follows the Up callback count and purple width follows the scene's revision state.
The actual graphical lane shows the initial scene and the first Document-only
Up: A's two callbacks advance its count to 2 while B stays at 0 in one commit.
The Node runner independently decodes the saved pixels.

| Before real native Up | After Document capture and bubble |
| --- | --- |
| ![Initial native counters A0/B0](../../docs/evidence/pointer-document-up/initial.png) | ![Native Document callbacks commit A2/B0](../../docs/evidence/pointer-document-up/updated.png) |

## `once` e cancelamento por `AbortSignal`

A [nova evidência de lifecycle](../../docs/evidence/pointer-document-up-lifecycle/README.md)
registra oito lanes headless com **2.143 checks**. O recibo de 1.371 checks e as
imagens acima preservam a baseline anterior; a matriz atual inclui as novas
etapas. Não há mudança na implementação nativa ou no SDK.

As opções usam o EventTarget e o sinal original do RN, dentro dos mesmos gates:

```js
doc.addEventListener('pointerup', onUp, {once: true});

const controller = new AbortController();
doc.addEventListener('pointerup', onUp, {signal: controller.signal});
controller.abort();
```

Com current e D habilitado, `once` entrega um `DocB` trusted no primeiro Up e
nenhum no segundo. Cada gesto mantém seu TouchEnd/Raw e limpa o contato físico.
No controle original, o input nativo filtrado deixa o listener instalado:
somente a primeira emissão manual posterior o consome, sem Raw nativo ou
incremento React; a segunda emissão manual não chama o callback.

O sinal pre-aborted já está em `aborted=true` ao registrar e não entrega Up.
Abort-after prova o sinal original mudando `false→true` após o primeiro Up:
o abort não muda o contador, o commit ou o ownership físico, e o próximo gesto
não entrega Up. Um controle manual positivo antes do abort e negativo depois
confirma a mudança no listener. Com D desabilitado, os métodos do Document
estão ausentes e a fixture não associa um sinal ao registro.

A execução gráfica atual passou **414 checks**, com cinco PNGs nativos e
**62 pixels** conferidos por Godot e decodificados independentemente no Node.
As três imagens novas abaixo mostram A12/B2→A13/B2→A13/B2: a barra amarela
cresce no primeiro Up e fica igual no segundo.

| Antes de `once` | Primeiro Up | Segundo Up |
| --- | --- | --- |
| ![A12/B2](../../docs/evidence/pointer-document-up-lifecycle/once-before.png) | ![A13/B2](../../docs/evidence/pointer-document-up-lifecycle/once-first.png) | ![A13/B2 mantido](../../docs/evidence/pointer-document-up-lifecycle/once-second.png) |

A aceitação cobre listeners bubble do Document; outras fases, View/element,
abort durante gesto ativo ou callback e retired refs seguem fora desta fatia.

## Rerender, retirada e remount do root

A [evidência de refs](../../docs/evidence/pointer-document-up-refs/README.md)
amplia a matriz para **2.709 checks** headless. Um rerender mantém Document,
documentElement e a ref da View, e o Up seguinte entrega os mesmos listeners.
Retirar A com um contato ativo produz um único `TouchCancel` original e nenhum
`pointerup`; o contato que B segura continua intacto e o Up de B é entregue
depois. A nova geração de A tem um Document novo: os listeners retidos no
Document antigo não recebem input nativo (embora ainda respondam a uma emissão
manual), o release do contato cancelado é descartado, e só os listeners do
Document novo qualificam o gesto seguinte.

```js
const oldDoc = viewRef.current.ownerDocument;
oldDoc.addEventListener('pointerup', onOldUp);   // root generation 1
// ...surface unmounts while a finger is down, then mounts again...
const freshDoc = newViewRef.current.ownerDocument; // freshDoc !== oldDoc
freshDoc.addEventListener('pointerup', onUp);     // only this one qualifies Up
```

| A retirado, B com contato | A remontado após gesto novo |
| --- | --- |
| ![A retirado, B2](../../docs/evidence/pointer-document-up-refs/retired.png) | ![A2/B4](../../docs/evidence/pointer-document-up-refs/remounted.png) |

## Limits

This matrix certifies the listed healthy Document/element Up cases, including
Document/documentElement rerender, held-root retirement and one replacement root.
It does not certify Up-specific faults, mutation during dispatch, capture-phase or
View listeners across retirement, explicit pointer capture, coalescing, full responders, development
renderer, hardware/mobile exports or performance. Down is filtered here; no
public Down/Up pointer-ID equality is claimed. The final Down regression passes 2,723 checks; contracts pass 255 Node/13 Python.
Native/SDK production bytes are unchanged from the separately proven View Up
slice. Hosted baseline 84270fb passed 1,371 checks in five successful jobs and
lifecycle run 37246479501 passed 2,143 and refs run 37310815360 passed 2,709. The
[research](../../docs/research/pointer-document-up.md) explains the boundaries.
