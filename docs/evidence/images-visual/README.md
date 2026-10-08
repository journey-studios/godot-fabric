# Efeitos de imagem: tint, blur, capInsets e recorte arredondado

Esta fatia faz o `Image` público desenhar `tintColor`, `blurRadius`, `capInsets` e o recorte que o
`borderRadius` do estilo faz na imagem, e aceitar sem efeito os sete props que o RN iOS ignora
(`defaultSource`, `loadingIndicatorSource`, `fadeDuration`, `progressiveRenderingEnabled`,
`resizeMethod`, `resizeMultiplier` e `overlayColor`). Antes, o wrapper recusava cada um deles onde a Image
renderiza, nomeando a fatia futura, e recusava um raio de borda no estilo. Agora a `GodotImage` desenha a
imagem num canvas item filho do próprio, de modo que o fundo e a borda que a view pinta nunca são tingidos
nem recortados; um shader único, compartilhado por todas as views, tinge e recorta, e o nine-patch dos
`capInsets` é um comando do mesmo item. O blur é o `RCTBlurredImageWithRadius` do RN iOS (caixa quadrada,
alfa pré-multiplicado, duas passadas) e roda no worker, depois da decodificação e antes de a textura existir:
uma imagem borrada tem textura própria e nunca entra no cache decodificado nem sai dele. A textura que o cache
entrega a todas as Images de uma imagem não é tocada. O [recibo](report.json) fixa fontes, hashes e
resultados, executados na árvore de
[`6c221e8`](https://github.com/journey-studios/godot-fabric/commit/6c221e8500e159ba9322d9b7a6b5adace4f8aff2).

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `f44b7c3b` (main `fb50a32`), mesmo bundle | 13/53 | Falham exatamente os 40 normativos; passam os 13 que valem em qualquer host |
| Sabotagem retida: o recorte do conteúdo ignora a largura da borda, host `f8f87d75` | 51/53 | 2 falhas, e o oráculo independente rejeita o relatório |
| Sabotagem retida: o blur faz uma terceira passada, host `a17cfe75` | 50/53 | 3 falhas, e o oráculo independente rejeita o relatório |
| Sabotagem retida: o pedido borrado lê e grava o cache decodificado, host `b6afebb6` | 45/53 | 8 falhas, e o oráculo independente rejeita o relatório |
| Sabotagem retida: os `capInsets` ignoram a escala da imagem, host `30ef3479` | 51/53 | 2 falhas, e o oráculo independente rejeita o relatório |
| Host atual `3ddf4725`, headless | 53/53 | Frames reais do SceneTree, 52 Images declaradas, 13 mudanças ao vivo, 6 passos de rede sobre os dois caches e o oráculo independente sobre o relatório |

```sh
npm run test:images-visual
```

A suíte tem 53 checks, 40 normativos (os que dependem de um efeito) e 13 estruturais. O mesmo bundle, de
SHA-256 `814ca94d…`, rodou em todas as lanes, e cada uma percorre todos os estágios.

> Nota posterior (2026-10-08): esta página, as contagens e o [recibo](report.json) descrevem a execução em
> [`6c221e8`](https://github.com/journey-studios/godot-fabric/commit/6c221e8500e159ba9322d9b7a6b5adace4f8aff2). Depois
> dos merges da `main` (#62 e #59) e da revisão do PR #66, o commit
> [`b5471d9`](https://github.com/journey-studios/godot-fabric/commit/b5471d9a36a36e5aabd9469652b9b9b9e6113248) acolheu
> duas observações do CodeRabbit (3 arquivos) e manteve as contagens da execução, exceto a das asserções do teste C++.
> O `postReview` do recibo guarda os SHA-256 dos arquivos mudados nos dois lados, as lanes reexecutadas e a causa de
> cada mudança. As observações e o que mudou:
>
> 1. **O tamanho do buffer do blur.** O `box_blur_rgba8` calculava `width × height` e depois `count × 4` sem checar o
>    estouro de `size_t`: dimensões que nenhum bitmap tem davam uma conta que dá a volta, e a função poderia ler e escrever
>    fora do buffer que recebeu. Agora ela retorna sem tocar no buffer quando uma das duas contas estouraria; nos
>    tamanhos reais nada muda. O `image_effects_test` ganhou o grupo `dimensions_that_overflow_leave_the_buffer`, com
>    três casos (`2^63 × 2`, que dá a volta até zero pixels; `SIZE_MAX × 3`; e uma largura de `SIZE_MAX / 4 + 1`, cuja
>    contagem de pixels cabe e a de bytes não), e passa a ter 11 grupos e 49 asserções, onde tinha 10 e 46.
>
> 2. **Um laço de supersampling só.** O `logoAt` do `scripts/images-example-assets.mjs` repetia o laço que o `drawn` roda
>    para os outros assets; agora o `drawn` vem antes dele e o `logoAt` o chama, e todo asset desenhado passa pelo mesmo
>    laço. Os 12 PNGs de `examples/images/assets` foram desenhados de novo e têm os mesmos SHA-256 de antes, byte a byte.
>
> Arquivos mudados depois de `6c221e8`, com o SHA-256 em `b5471d9` (o `postReview` guarda os dois lados):
> `native/image_effects_core.h` (`20877a74…`), `native/image_effects_test.cpp` (`5d8ecbbe…`) e
> `scripts/images-example-assets.mjs` (`0401ef5f…`). Reexecutado na árvore de `b5471d9`, sem mudança fora do commit e
> com o host `a231884f` (a árvore inclui os merges da `main`): a lane atual passa 53/53, o controle no host anterior
> falha os mesmos 40 normativos entre 53 checks, as sabotagens falham 2, 3, 8 e 2, todas rejeitadas pelo oráculo, e a
> lane atual passa 53/53 outra vez. O bundle das lanes é o `9e2b7e03…`: o de `6c221e8` (`814ca94d…`) mudou porque a
> #62 alterou `src/text.jsx` e `src/base-view-config.js`, que ele contém, e a revisão não o mudou. Passam também o
> `test:images` (72 checks) e o `test:images-network` (74), o `test:examples` (35 exemplos, o `images` com 26 checks
> headless), a captura com o renderizador (39 checks, com os dois quadros nos SHA-256 dos commitados, `a1b31fee` e
> `7f92a89a`), o `type-check`, a análise estática, o scan de publicação e o `test:dashboard`. O host `3ddf4725` e o
> bundle `814ca94d…` das tabelas acima são os de `6c221e8`.

## O que o RN faz

**O que chega ao lado nativo.** A view config que o `Image.ios.js` usa no iOS
(`ImageViewNativeComponent.js:133-153`) lista `blurRadius`, `capInsets`, `defaultSource`, `resizeMode`,
`source` e `tintColor`; `ReactNativeAttributePayload.js:73-74` e `246-247` descartam todo prop que não esteja
nos `validAttributes`, então `loadingIndicatorSource`, `fadeDuration`, `progressiveRenderingEnabled`,
`resizeMethod`, `resizeMultiplier` e `overlayColor` (que só a ramificação do Android lista, 81-109, o primeiro
como `loadingIndicatorSrc`) nunca chegam ao iOS. O `defaultSource` chega e o `ImageProps.cpp:22-27` o lê, mas nenhum componente iOS o consome; o mesmo vale
para o `overlayColor` lido em `82-87`. O `Image.ios.js` calcula `tintColor` como `props.tintColor ??
flattenedStyle?.tintColor` (141-146) e põe `overflow: 'hidden'` no estilo base (261-265). O
`ImageShadowNode::updateStateIfNeeded` (45-108) monta o `ImageRequestParams` só com o `blurRadius` no iOS
(`ImageRequestParams.h:17`) e pede outra imagem quando os parâmetros mudam, mesmo com a mesma fonte (77-80).

**O que o componente faz com a imagem.** `RCTImageComponentView.mm:64-67` põe o `tintColor` na UIImageView; ao
chegar uma imagem (`didReceiveImage`, 127-169) ele envia `onLoad` e `onLoadEnd` (139-140), faz a imagem um
template se há `tintColor` (144-146), torna-a redimensionável com os `capInsets` (modo de ladrilho para `repeat`,
148-150; esticado se os insets não são zero, 151-155) e, se `blurRadius > __FLT_EPSILON__`, borra o resultado numa
fila de fundo (157-166). O `RCTBlurredImageWithRadius` (`RCTImageBlurUtils.mm`) lê só o `CGImage` e a escala da
imagem recebida e monta outra: o template, os caps e o ladrilho se perdem (85-96). A caixa é
`floor((raio × escala × 3·√(2π)/4 + 0.5) / 2) | 1` (52-53), quadrada e com a borda estendida; as três chamadas de
convolução (76-78) escrevem `buffer2`, `buffer1` e `buffer2`, mas a função libera `buffer2` e monta a imagem de
`buffer1` (81-96): chegam duas passadas. Uma caixa de um pixel não tem buffer temporário e a função devolve a
imagem que recebeu (56-62).

**O recorte.** `RCTViewComponentView.mm:371-374` liga o `clipsToBounds` de quem não tem `overflow: visible`, e o
bloco de 1300-1337 (com `enableIOSViewClipToPaddingBox` falso, `ReactNativeFeatureFlagsDefaults.h:138-140`) recorta
a view pela caixa de borda com os raios (um `cornerRadius` se são circulares e uniformes,
`primitives.h:251-254`; uma máscara de caminho senão) e, no filho `UIImageView`, aplica uma máscara com os raios
menos as larguras das bordas vizinhas (`RCTGetCornerInsets`, `RCTBorderDrawing.m:43-61`), no tamanho do content
frame (1315-1324), com o limite de `RCTPathCreateWithRoundedRect` (104-130: cada raio não passa do que o vizinho
deixa do lado). Os raios que chegam ali já passaram pela regra de sobreposição do CSS
(`BaseViewProps.cpp:415-468`, `506-524`), e uma porcentagem é da largura no raio horizontal e da altura no vertical
(470-487).

## O que este host fazia

A `GodotImage` desenhava a textura direto no próprio canvas item (`draw_texture_rect_region`, ou um
`draw_texture_rect` com `repeat`), sem material, sem nine-patch e sem recorte; o `GodotImageManager` ignorava os
parâmetros do pedido; e o wrapper recusava `tintColor`, `blurRadius`, `capInsets`, os sete props que o iOS ignora
e qualquer raio de borda no estilo da Image. O host anterior ainda faz tudo isso: o mesmo bundle carrega cada
Image nele, e a lane de controle mostra quais checks dependem de um efeito.

## A implementação

1. O [contrato do wrapper](https://github.com/journey-studios/godot-fabric/blob/6c221e8500e159ba9322d9b7a6b5adace4f8aff2/src/image-contract.mjs)
   deixa de recusar os props que desenham e os que o iOS ignora; recusa um `blurRadius` que não seja um número
   finito e `capInsets` que não sejam um número ou um objeto de `top`, `left`, `bottom` e `right` numéricos. Uma
   lista `[l, t, r, b]` é recusada (ver Padrões e desvios).
2. O [`image_effects_core.h`](https://github.com/journey-studios/godot-fabric/blob/6c221e8500e159ba9322d9b7a6b5adace4f8aff2/native/image_effects_core.h),
   puro e sem Godot nem RN, reúne a caixa do blur (`blur_plan`), as passadas (`box_blur_rgba8`: pré-multiplicar,
   duas passadas de média exata da janela com a borda estendida, desfazer), os raios (`corner_insets`,
   `fit_corners`, `clip_geometry`), as margens do nine-patch (`patch_margins`) e `paint()`, que descreve um
   desenho inteiro: o modo efetivo, os retângulos em pixels da imagem, o nine-patch, o tint e o recorte. Uma
   imagem borrada é "plain": sem tint, sem caps e com `repeat` esticado.
3. O [`PictureLayer`](https://github.com/journey-studios/godot-fabric/blob/6c221e8500e159ba9322d9b7a6b5adace4f8aff2/native/image_effects.cpp)
   cria o item filho (`canvas_item_create` e `canvas_item_set_parent`), escalado por 1/escala, de modo que um
   pixel da imagem é uma unidade do item e o shader lê texels. O shader (tint: `COLOR.rgb = tint.rgb` e
   `COLOR.a *= tint.a`; máscara: dois retângulos arredondados com SDF e AA de um pixel de tela por `fwidth`) é
   criado na primeira necessidade e liberado quando a extensão termina; cada view tem um material, criado na
   primeira vez que precisa do shader. Como os RIDs não têm contagem de referências, a view libera o item e
   depois o material, e o snapshot conta o que foi criado e liberado. O snapshot guarda também os valores que
   passou a cada `material_set_param` e a lista de comandos que adicionou.
4. A [`GodotImage`](https://github.com/journey-studios/godot-fabric/blob/6c221e8500e159ba9322d9b7a6b5adace4f8aff2/native/image_view.cpp)
   lê `tintColor`, `capInsets`, `blurRadius`, os raios e larguras de `resolveBorderMetrics` e o `overflow`; chama
   `paint()` e entrega o resultado ao `PictureLayer`, sem ramificações próprias. A textura que desenha é a do
   cache e nunca é escrita.
5. O [`ImageLoader`](https://github.com/journey-studios/godot-fabric/blob/6c221e8500e159ba9322d9b7a6b5adace4f8aff2/native/image_loader.cpp)
   recebe o raio do pedido (o `GodotImageManager` o lê do `ImageRequestParams`), borra a imagem no worker depois
   do decode e antes da impressão digital e da textura, e trata um pedido que borra como `view = false` nas
   fontes: não lê nem escreve o cache decodificado (o de bytes continua valendo). O registro de cada job leva o
   raio, a caixa, as passadas e se a imagem mudou.
6. As [fixtures](https://github.com/journey-studios/godot-fabric/tree/6c221e8500e159ba9322d9b7a6b5adace4f8aff2/tests/fixtures/images-visual)
   são quatro PNGs (uma forma com halo translúcido em três densidades e um nine-patch) cujo manifest guarda os
   fingerprints dos bitmaps que o blur deve fazer; o exemplo `images` ganhou quatro cartões e seis arquivos de
   imagem.

## Padrões e desvios

A [nota de pesquisa](../../research/images.md) lista cada desvio do RN com a referência de linha. Os que mudam o
que se vê ou o que se mede:

- **O blur não é idêntico bit a bit ao do vImage.** O `vImageBoxConvolve_ARGB8888` é fechado; o host declara a
  própria aritmética: `round(c·a/255)` ao pré-multiplicar, a média exata da janela dividida e arredondada uma só
  vez (o divisor é ímpar, sem empate), `round(p·255/a)` limitada a 255 ao desfazer, preto onde `a` é 0. Uma caixa
  de mais de 2^20 pixels é limitada a 2^20 + 1.
- **`tintColor`, `capInsets` e o recorte valem no próximo desenho.** No iOS o template e os caps entram quando
  chega uma resposta de imagem (`RCTImageComponentView.mm:144-155`): mudar o `tintColor` espera a resposta
  seguinte, e apagá-lo deixa uma imagem template tingida pela janela.
- **`onLoad` vem depois do blur.** O worker borra antes de a textura existir, e a view é avisada então. No iOS
  `onLoad` e `onLoadEnd` saem antes de o blur ser feito (139-140, 157-168), com o mesmo payload.
- **`capInsets` só valem em `stretch` e `repeat`.** `cover`, `contain`, `center` e `none` desenham como sem eles; o
  que o UIKit faz com uma imagem redimensionável nesses modos não foi verificado, nem como ele ladrilha as bordas
  de um nine-patch em `repeat`, nem o que faz quando a view é menor que os caps (o Godot não limita as margens ao
  destino; o host as limita à imagem).
- **Uma lista `[l, t, r, b]` de `capInsets` é recusada.** O `graphicsConversions.h:147-180` lê uma lista, mas tenta a
  forma de objeto primeiro (155) e a lista passa por um objeto com as chaves 0 a 3: o RN registra `Unsupported
  EdgeInsets map key` para cada uma e não guarda inset algum. O wrapper diz isso em vez de ignorar.
- **Um `tintColor` preto totalmente transparente não é tint.** A cor C++ do RN neste host é um inteiro em que zero
  é "sem cor" (`Color.h:56-59`, `HostPlatformColor.h:19`); `"transparent"` é zero. No iOS é um `UIColor` definido
  e a imagem template some. Qualquer outra cor totalmente transparente é um tint.
- **A borda fica abaixo da imagem aqui e acima dela no iOS** (o item da view a pinta, o da imagem vem depois). Com
  as regras do recorte, a imagem nunca alcança a borda, então nada difere no que se vê.
- **Uma imagem borrada tem textura própria**, que nenhum cache guarda; um caso a mais que o iOS não tem.
- **Os sete props que o iOS ignora são aceitos como ele aceita**, sem efeito: o `defaultSource` chega à view
  (o snapshot o mostra) e nada o lê; os outros seis nunca chegam, e a view guarda os valores padrão deles.

## O que foi verificado

A sonda ([`images-visual-probe.gd`](../../../tests/images-visual-probe.gd)) monta um fixture com 52 Images
declaradas, mais as de rede, e cada estágio espera um estado (o loader ocioso, um pedido respondido, uma view
desenhada), nunca um número de quadros; o limite de cada espera é um tempo. O renderer de uma execução headless é
o dummy do Godot, que não desenha pixel e ignora os parâmetros de um material, então cada efeito é conferido pelo
que a view pediu ao renderer (o snapshot), e o blur pela impressão digital do bitmap que o worker fez.

| Área | Checks | O que estabelecem |
| --- | ---: | --- |
| `mount`, `contract` | 4 | As 52 Images montam, cada uma faz um pedido, e um `blurRadius` ou `capInsets` que não são números falham onde a Image renderiza, com as palavras do host |
| `ignored` | 4 | `defaultSource` chega à view e nada o lê; os outros seis nunca chegam; uma Image com todos carrega, reporta e desenha como uma sem eles |
| `blur` | 9 | A caixa pela fórmula (5, 3, 5, 7, 11, 11 e 85 para os raios e escalas declarados), duas passadas, a textura própria, uma caixa de um pixel, um raio no epsilon e raio zero deixam os pixels do arquivo (e a imagem segue template e nine-patch), cada bitmap é, byte a byte, o do manifest, a imagem borrada não leva tint nem caps e `repeat` a estica, e todo blur rodou num worker e foi contado |
| `live` | 2 | Pôr e tirar `blurRadius` pede a mesma fonte de novo, sem `onLoadStart`, um pedido por mudança |
| `tint` | 7 | A cor vem do prop e do estilo (o prop primeiro), os parâmetros do material, nenhum material sem tint nem recorte, o fundo e a borda ficam como estão, a imagem fica no content frame, mudar e apagar o tint redesenha na hora, e o material é feito uma vez |
| `caps` | 4 | Número e objeto viram um nine-patch com as margens em pixels da imagem e os modos do resize mode, `repeat` sem insets ladrilha, `cover` e insets zero desenham como antes, o nine-patch não usa shader, e mudar os insets redesenha sem pedido |
| `mask` | 5 | A caixa de borda e o content frame com os raios menos as bordas, limitados como o `RCTPathCreateWithRoundedRect` (borda, padding, elipse por porcentagem, cantos distintos, 999, sobreposição), as coordenadas do shader são pixels da imagem (escala 3), `overflow: visible` e uma view sem raio não têm máscara, a máscara é da view e vale em todo modo, e mudar raio e `overflow` redesenha |
| `combined` | 1 | Um nine-patch tingido numa view arredondada é um item: tint, máscara e nine-patch juntos |
| `network` | 8 | Um pedido borrado baixa, decodifica, borra e guarda a imagem para si; o pedido liso depois sai do cache de bytes com os pixels do arquivo; um pedido borrado não lê o cache decodificado que já tem a imagem; duas views da imagem em cache a compartilham sem textura nova, cada uma com o que recebeu; borrar uma Image dessas pede de novo e deixa a imagem em cache como estava; limpar o blur a encontra de novo |
| `lifecycle` | 6 | Cada Image com imagem tem um item, cada uma que tinge ou recorta tem um material, um shader serve todas, desmontar libera o item e o material, montar de novo faz outros, desmontar uma raiz libera só os dela, e na parada nada sobra e o shader espera a extensão |
| `cleanup`, `report` | 3 | Sem diagnóstico do host, a parada libera as raízes e o relatório é salvo |

O [oráculo](../../../tests/images-visual-oracle.mjs) foi escrito à parte da sonda e do C++. Ele recalcula o bitmap
de cada Image borrada pixel a pixel (pré-multiplicar, duas passadas com a borda estendida, desfazer) e compara a
impressão digital com a do worker, para 14 imagens borradas (10 casos declarados, uma mudança ao vivo e três de
rede) e as caixas 3, 5, 7, 11 e 85 (esta última maior que a imagem de 36×27 pixels); deriva da declaração de cada
caso o layout, os raios (porcentagens, a regra do CSS, os insets de canto e o limite do retângulo arredondado), o
tint, as margens, os retângulos de desenho e os parâmetros do material, e compara com o que a view pediu ao
renderer dentro de um milésimo; repete as 13 mudanças ao vivo sobre o estado declarado; e modela o que cada um
dos seis passos de rede faz aos dois caches, lendo o log do servidor (um pedido só). Recusa 48 mutações do
relatório genuíno, cada uma pelo motivo que o dano nomeia: o bitmap, a caixa, as passadas, a escala da caixa, o
tint, o `repeat` borrado, os parâmetros do material, as margens, o nine-patch em `repeat`, os raios internos, a
sobreposição, a porcentagem, o `overflow`, as coordenadas do shader, os props ignorados, as mudanças ao vivo, o
cache decodificado, a textura compartilhada, os RIDs, o shader e as threads.

O teste C++ [`image_effects_test`](../../../native/image_effects_test.cpp) cobre as partes puras em 10 grupos e 46
asserções: a caixa, o arredondamento, a soma corrente contra uma soma ingênua (7 tamanhos e 5 caixas, inclusive
uma caixa maior que a imagem), os raios, o recorte, as margens e o `paint()`.

## Controles

O host anterior foi preservado e roda o mesmo bundle. Ele carrega cada Image e não faz nenhum dos efeitos, então a
sonda executa todos os estágios nele: 53 checks, dos quais os 13 estruturais passam e os 40 normativos falham (o
`defaultSource` que nada lê, a caixa e os pixels do blur, o tint e o material, o nine-patch, a máscara, os seis
passos de rede e o ciclo de vida dos RIDs). O oráculo aceita o relatório em modo original: nenhuma view tem
`props`, `drawn.effects` nem `blur`, e nenhum item foi criado.

As quatro sabotagens retidas quebram um comportamento cada, e a sonda e o oráculo rejeitam as quatro. Na
primeira, o recorte do content frame usa os raios da view inteiros, como se a borda não tivesse largura
(`native/image_effects_core.h`): 2 checks falham, o das máscaras e o das coordenadas do shader na escala 3, e o
oráculo rejeita o raio interno de `mask-border` (10 em vez de 8). Na segunda, o blur faz uma terceira passada: 3
checks falham, os que comparam o bitmap com o do manifest (o dos casos declarados e os dois do estágio de rede que
borram), e o oráculo rejeita a impressão digital do primeiro caso borrado, `blur-1x-r4`. Na terceira, um pedido
borrado lê e grava o cache decodificado (`native/image_loader.cpp`): 8 checks falham, todos do estágio de rede, e
o oráculo rejeita a Image lisa que, ao borrar com raio 2, guarda o bitmap borrado com raio 1 que o cache lhe
entregou. Na quarta, os `capInsets` ignoram a escala (`native/image_effects_core.h`): 2 checks falham, o das
margens e o das mudanças ao vivo, e o oráculo rejeita a margem esquerda do primeiro nine-patch declarado (2 em
vez de 4). As fontes foram restauradas byte a byte (os SHA-256 de antes e de depois conferem) e o rebuild
reproduziu o host `3ddf4725`.

## Capturas

O exemplo interativo [`images`](../../../examples/images/README.md) abre no launcher com
`npm run example -- images`, e `npm run example -- images --capture` salva dois quadros do renderizador nativo,
de 1800 × 1676 pixels (900 × 838 pontos na escala de conteúdo 2), enquanto a validação dele clica de verdade e lê
cada imagem na `GodotImage` que a mostra, no que o JS observou e, com o renderizador, em pontos do quadro
(26 checks headless, 39 com o renderizador). O recibo registra o caminho, o SHA-256 e as dimensões de cada quadro,
e os bytes se repetiram em todas as execuções.

![O exemplo com os cartões de tint, blur, capInsets e borderRadius, a linha de rede e o preview em cover](images-visual-all-modes.png)

**Os efeitos.** Os seis modos, as fontes e a linha de rede continuam como na fatia anterior. Quatro cartões
novos mostram o que se faz com a imagem. `tintColor`: o ícone com as cores que tem, ao lado do mesmo ícone pintado
inteiro de laranja, e os cantos transparentes continuam vazios. `blurRadius`: a paisagem borrada por uma caixa de
7 pixels, mole na borda do sol. `capInsets`: o cartão esticado para 96×38 pontos com a borda de 2 pontos e os
cantos redondos como são, acima do mesmo cartão esticado sem insets, cuja borda ficou quatro vezes mais larga.
`borderRadius`: um avatar circular com a borda suavizada, e um segundo com borda de 3 pontos e o canto redondo
inteiro. O preview está em `cover` e diz `loaded 240x120 px`.

![O preview depois dos cliques, com a imagem de rede montada de novo](images-visual-interaction.png)

**Depois dos cliques.** Nove cliques reais em `Next mode` levam o preview por todos os modos até `center`, um em
`Swap the picture` carrega o logo e um em `Mount again` monta uma segunda Image do nascer do sol, respondida pelo
cache decodificado. O preview mostra o logo em `center`, com `resizeMode="center"`, `picture: logo` e
`loaded 64x64 px`; os quatro cartões dos efeitos seguem como estavam.

A validação do exemplo compara a cor de pontos do quadro: cada pixel do ícone tingido (o miolo, o anel e o corpo) é
o laranja do tint e o canto transparente é o fundo; a paisagem borrada difere da nítida na borda do sol e é igual
onde o céu é liso; a borda do cartão com `capInsets` tem 2 pontos e a do cartão sem eles 8; o avatar tem os cantos
no fundo, o centro na imagem e pixels parciais na borda; e o segundo avatar mantém a borda inteira, canto
redondo incluído, com a imagem recortada pelo raio menos a borda. Não há oráculo independente de pixels do quadro
inteiro, e a comparação com o UIKit segue aberta em Limites. Os quadros da fatia de rede ficam em
[`docs/evidence/images-network`](../images-network/README.md), mostrando o exemplo antes dos quatro cartões.

A lane com o renderizador roda só localmente; a CI hospedada rodou a lane headless da suíte (veja Limites).

## Regressões

Passaram na árvore da implementação: os testes C++ de imagens e o `http_core_test`; a suíte nova (53 checks na lane
atual, 53 executados e 40 falhando no controle, 2, 3, 8 e 2 falhas nas sabotagens); a suíte da primeira fatia (72
checks, com o controle e as sabotagens refeitos); a da fatia de rede (74 checks, com o controle e as três sabotagens
refeitos); `test:contracts`, `test:examples` (o exemplo `images` passa 26 checks headless e 39 com o renderizador),
o `type-check`, a análise estática e o scan de publicação. O recibo registra cada passo.

Alguns passos falharam na primeira passada por motivos alheios ao comportamento testado e foram corrigidos e
repetidos: o host abortou ao carregar porque um `RID` estático era construído antes de a extensão iniciar (agora
nasce no primeiro uso); a sonda parou num erro de inferência de tipo do GDScript; as primeiras execuções do
oráculo recusaram três expectativas dele mesmo (o tint de uma imagem borrada pertence aos props da view e não ao
que se desenha, o raio guardado na imagem é 0 abaixo do epsilon, e o JSON do Godot ordena as chaves); a execução do
controle achou quatro checks que valem no host anterior e os tornou estruturais; o `consumer.tsx` ainda esperava as
recusas como erros de tipo; e a sabotagem `texture-mutation` da fatia de rede não achou mais o código de
ladrilho que remendava, que passou para o `image_effects.cpp`, e a string de busca dela foi portada para a chamada
que entrega a textura ao item. Os controles e as sabotagens locais das duas fatias anteriores, que só vivem em
`build/` e nunca foram para o git, foram refeitos nos hosts anteriores preservados porque o bundle e os produtores
delas mudaram.

A suíte da primeira fatia mudou com o contrato: as 13 recusas de props que agora valem saíram do fixture (de 22 para
9) e o check que as nomeava saiu (de 73 para 72 checks). O [registro dela](../images/README.md) leva uma nota
datada.

As fontes de código e configuração executadas (17 da suíte e do bundle, 134 do build nativo, 21 de verificação e 11
do fixture) correspondem à implementação `6c221e8500e159ba9322d9b7a6b5adace4f8aff2` por `git show`/SHA-256, e as lanes
rodaram dessa árvore commitada, sem fonte alterada durante a execução. Os documentos desta fatia foram escritos
depois delas; os gates que os leem rodaram de novo na árvore final.

## Limites

- **Pixels.** O renderer de uma execução headless é o dummy do Godot: a sonda e o oráculo certificam o que a view
  pediu ao renderer e os pixels do blur pelo bitmap do worker; só o exemplo, com o renderizador nativo, viu o shader
  desenhar. A captura amostra alguns pontos e não há oráculo independente do quadro inteiro.
- **UIKit.** Nenhuma comparação com um aparelho iOS foi feita: a caixa e o arredondamento do blur, o ladrilho de um
  nine-patch, a imagem redimensionável nos outros modos de conteúdo e o template não foram comparados.
- **Blur.** Uma caixa maior que a imagem (raio 30 na escala 3, numa imagem de 36×27 pixels) foi conferida contra o
  blur do próprio oráculo; o blur de imagens grandes e o tempo dele num aparelho não foram medidos.
- **Props.** `defaultSource` (o placeholder), `loadingIndicatorSource`, `fadeDuration`, `resizeMethod` e
  `resizeMultiplier` são aceitos sem efeito, como no iOS. Animated GIF e WebP, `nativeImageSource` e Image dentro de
  `Text` (uma falha por projeto) não são entregues.
- **Export.** As imagens foram carregadas na execução do próprio projeto, contra um servidor de loopback; nenhum
  app exportado, export desktop ou Android foi executado.
- **Plataformas.** Só macOS arm64 foi executado; Windows, Linux, Android, iOS e Web não foram exercitados, nem
  hardware real.
- **CI.** A CI hospedada do push da `main` em `9c5d0eb` (o squash do #66, run 37773373567) passou nos cinco jobs na
  primeira tentativa, sem reexecução. O job `native-cold-start` rodou `npm run test:images-visual` (1 de 1 teste
  ok), e o artefato `native-images-visual` repete os **53 checks headless** com os IDs do relatório commitado (o
  mesmo digest, `cc900508…`) e o bundle que o `postReview` do relatório registra (`9e2b7e03…`); o mesmo job rodou o
  exemplo `images` no `test:examples` (26 checks headless). O oráculo independente aceita o relatório baixado (52
  Images declaradas, 13 mudanças ao vivo, 62 jobs), e os 40, 2, 3, 8 e 2 checks que o controle e as sabotagens
  locais falham existem e passam todos no run. Dos 181 pins de código e configuração, 168 têm em `9c5d0eb` os bytes
  de `6c221e8` e 13 diferem: 3 são os arquivos do commit da revisão, com os SHA-256 que o `postReview` registra, e
  10 vieram com os merges da `main` (#59 e #62); nenhum dos 181, os 34 produtores do bundle entre eles, difere
  entre o commit da revisão `b5471d9` e o run. O hash do host nativo (`964c61dd…`) é declarado pelo runner, que usou o Node
  v22.23.2 onde o estado commitado rodou o v22.23.3. O [Pages](publication.json) (run 37773373621) implantou
  exatamente os dados commitados de `9c5d0eb`; o site público já foi substituído pelo deploy de `b82fbdd` (run
  37780395930). O oráculo e a sonda afirmam valores que o host entregou ou estados de um modelo, nunca o ritmo de
  quadros nem a segmentação dos bytes, e toda espera é limitada por tempo e termina num estado. A CI hospedada não
  roda o controle no host anterior, as sabotagens nem a captura com o renderizador, e o renderer headless não
  desenha pixel. [Recibo](hosted-ci.json).

Nenhum GF inteiro, contrato, paridade, alvo, outro checkpoint, peso ou denominador fecha: o GF-16 continua aberto,
e esta terceira fatia não fecha nenhum checkpoint.
