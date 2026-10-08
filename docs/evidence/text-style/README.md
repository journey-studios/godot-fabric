# Estilo de texto: `fontStyle` itálico e `textDecorationLine` no parágrafo

Esta fatia, a terceira do GF-11, faz o parágrafo nativo do `Text` público pintar `fontStyle: 'italic'` e
`textDecorationLine` (sublinhado, tachado e os dois), com `textDecorationColor` e `textDecorationStyle: 'solid'`.
O RN já resolve os quatro estilos; a fachada os rejeitava com erro, o config base não os declarava e o host não
sabia pintá-los. Agora o `base-view-config.js` os declara (`textDecorationColor` com o processador de cor, como
`color`), a fachada valida os valores numa tabela só e o
[`ParagraphLayout`](https://github.com/journey-studios/godot-fabric/blob/7819302a7513363e15437bff70bf982ab2a2ce9f/native/paragraph_layout.cpp)
inclina a fonte do run (itálico sintético: os TTFs do projeto não têm face itálica) e desenha as linhas a partir
das métricas do Godot. Um único `painted_glyphs` diz o que cada linha pinta, e dele saem o desenho, as decorações e o
snapshot, de modo que o snapshot é exatamente o que foi desenhado. A mesma passagem corrige um bug antigo: os glifos
das reticências caíam no run 0, então um texto truncado pintava as reticências na cor do PRIMEIRO run; agora elas
pegam o run do último glifo visível, para a cor e para a linha. A
[pesquisa](../../research/text-style.md) registra as fontes do RN com linhas, as decisões, as métricas medidas, a
divergência das fórmulas entre as plataformas e os abertos. O [recibo](execution.json) fixa fontes, hashes, contagens
e resultados, e o [recibo de capturas](captures.json) os quadros.

Tudo aqui foi executado **a partir do commit de implementação
[`7819302`](https://github.com/journey-studios/godot-fabric/commit/7819302a7513363e15437bff70bf982ab2a2ce9f)**
(`7819302a7513363e15437bff70bf982ab2a2ce9f`, árvore `b45838297ea9f977516817708f1dd6b744d3ed65`, sobre a main
`0f2cc7e`, o PR #62), que traz a implementação (`bc1df3b`) e a rodada de correções da revisão (`7819302`: os `{}` e a
tabela de valores da fachada, e o `toString` do próprio RN no host). A árvore estava limpa e igual à do commit, sem
arquivo novo fora dos diretórios ignorados, quando cada comando abaixo rodou; os arquivos desta evidência foram
acrescentados depois e não são entradas. Ambiente: macOS arm64, Godot oficial **4.7.2** (`ed1daf0bf`), React Native
**0.87.1**, React **19.2.3**, Hermes **250829098.0.17** e Node **v22.23.3**; a suíte roda headless e o exemplo e as
capturas, com o renderizador nativo (OpenGL 4.1 Metal, Apple M3 Pro, renderer de compatibilidade).

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| SDK e host anteriores: o `src/` da main `0f2cc7e`, host `5e4306a8`, bundle `072c5fc5` | 14/61 | Exatamente as 47 falhas (20 normativas e 27 de host): a fachada antiga rejeita `fontStyle` e `textDecoration*` no render, então os casos que os usam nem montam, e o host não inclina, não desenha, não reporta e não recusa. O oráculo rejeita 9 das 10 seções |
| O mesmo bundle atual no host anterior `5e4306a8` | 34/61 | Exatamente as 27 falhas de host: a fachada aceita, mas nada inclina, nenhuma linha é desenhada nem reportada e os 5 casos de contorno ficam em silêncio. O oráculo rejeita só `runs`, `italic`, `decorations`, `inheritance`, `ellipsis` e `bypass` |
| Sabotagem `decoration-above`, bundle `0850aabb`, host reconstruído | 60/61 | 1 falha: o sinal do deslocamento do sublinhado invertido o põe acima da linha de base; o oráculo rejeita `decorations` |
| Sabotagem `color-ignored`, bundle `0850aabb`, host reconstruído | 56/61 | 5 falhas: `textDecorationColor` é ignorado e a linha leva a cor do texto; o oráculo rejeita `runs`, `decorations` e `inheritance` |
| Sabotagem `inherit`, bundle `37406b6c` | 60/61 | 1 falha: a fachada descarta o `textDecorationLine: 'none'` do filho, que herda o sublinhado do pai; o oráculo rejeita `runs`, `decorations` e `inheritance` |
| Sabotagem `whole-line`, bundle `0850aabb`, host reconstruído | 58/61 | 3 falhas: a linha cobre a linha inteira de `line.x` a `line.x + width`, sem olhar o run nem o corte; o oráculo rejeita `decorations` e `ellipsis` |
| Sabotagem `skew-sign`, bundle `0850aabb`, host reconstruído | 59/61 | 2 falhas: a inclinação aponta para o outro lado (−3 em vez de +3 px no topo do "I"); o oráculo rejeita `italic` |
| Sabotagem `facade-dotted`, bundle `08f6973a` | 57/61 | 4 falhas: a fachada deixa `dotted` passar (o host o recusa, mas não é a fachada que falha); o oráculo rejeita `negative` |
| Sabotagem `ellipsis-run`, bundle `0850aabb`, host reconstruído | 59/61 | 2 falhas: as reticências voltam ao run 0; o oráculo rejeita `ellipsis` (`the ellipsis takes the run of the red tail, not the run of the first glyph`) |
| Sabotagem `guard`, bundle `0850aabb`, host reconstruído | 56/61 | 5 falhas: o host não recusa `oblique` nem as linhas não sólidas num `NativeText` direto; o oráculo rejeita `bypass` |
| SDK atual, bundle `0850aabb`, host `3dc5a591`, headless | 61/61 | Uma aplicação Hermes e o oráculo independente: 3 rodadas seguidas (5,0 s, 4,8 s e 4,8 s) e uma com 22 laços de CPU em 11 núcleos (12,1 s), todas com `TEXT_STYLE_PASSED: 61` |
| Laboratório `typography`, headless | 55/55 | Inclui os três checks novos da linha de itálico, decoração e cancelamento |
| Laboratório `typography`, renderizador nativo | 72/72 | Os 55 mais a tinta e os pixels: 4 checks novos de pixel (o itálico, a linha colorida, o tachado e o buraco do cancelamento) |

```sh
npm run test:text-style
node scripts/text-style-sabotage.mjs               # os dois controles, as 8 sabotagens e a lane atual, com os fontes restaurados
node tests/text-style-native.test.mjs --previous        # o SDK e o host anteriores (o host instalado em addons/)
node tests/text-style-native.test.mjs --previous-host   # o bundle atual no host anterior
npm run example -- typography --capture
```

O host anterior é o `fabric_godot.dylib` que o build da main (fontes de `0f2cc7e`) produziu antes da fatia,
preservado em `build/text-style-previous-host/` e instalado em `addons/` pelo `scripts/text-style-sabotage.mjs` só
durante os dois controles sobre ele; o host genuíno volta depois e o rebuild reproduz o mesmo binário (`3dc5a591…`). A
rodada completa do script levou cerca de 1 min 52 s e o `npm run test:text-style`, cerca de 5 s.

## O que foi verificado

O [probe](https://github.com/journey-studios/godot-fabric/blob/7819302a7513363e15437bff70bf982ab2a2ce9f/tests/text-style-probe.gd)
monta o [fixture](https://github.com/journey-studios/godot-fabric/blob/7819302a7513363e15437bff70bf982ab2a2ce9f/tests/text-style-fixture.jsx)
numa aplicação Hermes com duas roots (41 parágrafos estáticos e os estilos rejeitados) e uma root por caso de
contorno, importando só de `react-native`. O bundle precisa conter o `Text.js`, o `TextNativeComponent.js`, o
`TextAncestorContext.js`, o `View.js`, o renderer e o registry originais, ou o teste falha. O
[oráculo](https://github.com/journey-studios/godot-fabric/blob/7819302a7513363e15437bff70bf982ab2a2ce9f/tests/text-style-oracle.mjs)
não lê o `src/` nem os veredictos do probe: lê `head`, `hhea`, `post` e `OS/2` das TTFs em Node, sem Godot e sem
FreeType, e recalcula de cada relatório bruto, em dez seções, o que o estilo declara (`mount`, `runs`), a inclinação
(`italic`), as medidas (`measure`), a geometria de cada linha (`decorations`), a herança e a opacidade
(`inheritance`), as reticências e o texto cortado (`ellipsis`), cada mensagem de erro palavra por palavra
(`negative`), as recusas do contorno (`bypass`) e a parada (`stop`). Ele rejeita um relatório mesmo com todos os
checks marcados como passados.

Os 61 checks são 2 de montagem, 5 de itálico, 2 de medida, 8 de decoração, 1 de herança, 1 de opacidade, 5 de linhas,
3 de reticências, 20 de negativos, 5 de contorno, 8 de parada e 1 do relatório; 47 deles falham no SDK e no host
anteriores (20 normativos, que dependem de a fachada aceitar os estilos, e 27 de host), e 14 valem em qualquer um.

- **Itálico.** O `I` de cada run é medido no contorno da fonte que o run usa (`TextServer.font_get_glyph_contours`),
  não no desenho: o topo se desloca para a direita em 0,25 da altura, a base e o avanço ficam iguais, em NotoSans,
  em JetBrainsMono e em NotoSans bold (tabela abaixo). A altura do `I` é conferida contra o `sCapHeight` da tabela
  `OS/2`, com 1 px de tolerância. Um parágrafo sem `fontFamily` também inclina (cai em NotoSans, como um bold sem
  família já fazia), um span `italic` inclina só o seu run e um `normal` aninhado cancela.
- **Linhas.** O oráculo recalcula a posição e a espessura de cada linha: o centro do sublinhado é
  `(−underlinePosition + espessura/2) / unitsPerEm × tamanho` abaixo da linha de base (o `post` guarda o topo da
  haste, e o `Font::get_underline_position` do Godot devolve o centro), o tachado fica em
  `−ascent + (ascent + descent)/2`, com o ascent e o descent arredondados para cima como o FreeType, e a espessura é
  `max(1, espessura/unitsPerEm × tamanho)`. A tolerância é de 0,1 px; a diferença observada é de no máximo 0,005 px no `y` e 0,006 px na espessura.
  Cada linha vai do x do primeiro glifo pintado do run ao x final do último, e os segmentos de runs vizinhos se
  tocam; um run que cobre a linha vai de `line.x` a `line.x + width` (a largura da linha é arredondada pelo host, com
  1 px de tolerância); um grupo sem largura (o sentinela, um espaço cortado) não ganha linha, e a linha vazia depois de
  um `\n` final também não.
- **Herança, cor e opacidade.** Um filho substitui o `textDecorationLine` e o `textDecorationColor` do pai campo a
  campo: `none` cancela o sublinhado, `line-through` o substitui, uma cor sozinha só recolore, e o parágrafo
  `inherit` confere oito linhas em cinco runs. Sem `textDecorationColor` a linha leva a cor do run; com opacidade 0,5 no
  span, o texto e a linha (de cor explícita ou herdada do texto) levam a metade do alfa.
- **Reticências e corte.** Num parágrafo truncado cujo texto visível termina num run vermelho, as reticências ficam
  no run vermelho (antes ficavam no run 0) e a linha sublinhada vai até o fim delas; na segunda de duas linhas o
  mesmo vale, com sublinhado e tachado de cor explícita; num parágrafo `clip` não há reticências e a linha para no
  último glifo pintado. O oráculo lê isso das linhas que o snapshot reporta como pintadas (`painted`, com as
  reticências separadas do texto).
- **Medida.** Nove parágrafos (normal, itálico, sublinhado, tachado, os dois, `none`, sublinhado colorido, cor e estilo sem
  linha, e estilo sólido) medem e quebram exatamente como o `base`, e oito pares decorados, alinhados, truncados e cortados medem como o mesmo
  sem a decoração: pintar não muda a medida, e a decoração é calculada no `draw` e no `snapshot`, nunca no `prepare`.
- **Negativos, 18 estilos rejeitados palavra por palavra** antes de qualquer layout nativo, cada um num boundary que
  recupera: `fontStyle` `oblique` e um valor qualquer, `textDecorationLine` com os apelidos do parser nativo
  (`strikethrough`, `underline-strikethrough`), a ordem invertida, `overline` e um valor qualquer,
  `textDecorationStyle` `double`, `dotted`, `dashed` e `wavy` (e `dotted` sozinho, sem linha), `oblique` e `dotted`
  num `Text` aninhado e `fontStyle` e `textDecorationLine` num `View` e num `TextInput`. Nenhum deles chega ao host: a aplicação não reporta erro.
- **Contorno.** Um `NativeText` importado direto, sem a fachada, com `fontStyle: 'oblique'` ou com
  `textDecorationStyle` `double`, `dotted`, `dashed` ou `wavy`, monta e é recusado pelo host (`measure` e o paint de
  `GodotParagraph::apply` reportam, e a exceção não atravessa o callback do Yoga), com
  `Godot Text does not implement style fontStyle oblique: use normal or italic` ou
  `Godot Text does not implement style textDecorationStyle <valor>: only solid`, e a aplicação para com todos os
  Controls balanceados.

### Decorações observadas contra o oráculo (16 px, salvo indicação)

Linha de base e `y` em pixels dentro do parágrafo; o `y` esperado é o do oráculo, a partir das tabelas das TTFs.

| Parágrafo | Linha | Linha de base | `y` observado | `y` esperado | Δ | Espessura observada / esperada |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `underline` (NotoSans) | sublinhado | 18 | 20 | 20 | 0 | 1 / 1 |
| `strike` (NotoSans) | tachado | 18 | 11,5 | 11,5 | 0 | 1 / 1 |
| `both` (NotoSans) | sublinhado | 18 | 20 | 20 | 0 | 1 / 1 |
| `both` (NotoSans) | tachado | 18 | 11,5 | 11,5 | 0 | 1 / 1 |
| `color` (NotoSans, `f97316ff`) | sublinhado | 18 | 20 | 20 | 0 | 1 / 1 |
| `mono-underline` (JetBrainsMono) | sublinhado | 17 | 19,875 | 19,88 | −0,005 | 1 / 1 |
| `big-underline` (NotoSans 28) | sublinhado | 30 | 33,5 | 33,5 | 0 | 1,406 / 1,4 |
| `small-underline` (NotoSans 12) | sublinhado | 13 | 14,5 | 14,5 | 0 | 1 / 1 (mínimo de 1 px) |

As tabelas de onde o oráculo tira os números (em unidades da fonte): NotoSans, `unitsPerEm` 1000, `hhea` 1069 e
−293, `post` −100 e 50, `sCapHeight` 714; JetBrainsMono, 1000, 1020 e −300, −155 e 50, 730. O recibo traz essas
tabelas, o SHA-256 de cada TTF e a lista completa de linhas, com as larguras.

### Inclinação medida no contorno do "I" (16 px)

| Fonte | Altura do I | Deslocamento do topo | Razão | Deslocamento da base | Avanço |
| --- | ---: | ---: | ---: | ---: | --- |
| NotoSans (`italic` contra `base`) | 12 | +3,0 | 0,25 | 0 | 5,421875 = 5,421875 |
| JetBrainsMono (`italic-mono` contra `mono`) | 12 | +3,0 | 0,25 | 0 | 9,59375 = 9,59375 |
| NotoSans bold (`italic-bold` contra `bold`) | 12 | +3,0 | 0,25 | 0 | 6,21875 = 6,21875 |

A inclinação é a `Transform2D(Vector2(1, 0.25), Vector2(0, 1), Vector2.ZERO)` de um `FontVariation`. No Godot 4.7.2 a
matriz transposta (`Vector2(1, 0)`, `Vector2(0.25, 1)`) cisalha na vertical e muda a altura do glifo; a usada aqui desloca
só o topo. 0,25 é o valor do falso itálico do Android; o iOS do RN não inclina uma família própria sem face itálica,
então não há referência comum entre as plataformas.

### A divergência medida das fórmulas do RN

As duas plataformas do RN não concordam entre si, e nenhuma concorda com as métricas do Godot que esta fatia usa
(a convenção do `RichTextLabel`). O Android desenha o sublinhado em `linha de base + espessura + 1`
(`ReactUnderlineSpan.kt:32`) e o tachado em `linha de base + (ascent + descent)/2 + 1`
(`ReactStrikethroughSpan.kt:37`), com as métricas do `Paint`; o iOS deixa as duas linhas para o TextKit e não foi
medido (não há iOS aqui). Das tabelas das mesmas fontes, a 16 px:

| Fonte | Sublinhado aqui | Fórmula do Android | Tachado aqui (acima da base) | Fórmula do Android |
| --- | ---: | ---: | ---: | ---: |
| NotoSans | 2,0 px | 1,8 px | 6,5 px | 5,2 px |
| JetBrainsMono | 2,875 px | 1,8 px | 6,0 px | 4,8 px |

O sublinhado daqui fica 0,2 px abaixo do do Android em NotoSans e 1,1 px em JetBrainsMono, e o tachado 1,3 e 1,2 px mais
alto: de sub-pixel a um pixel, sem afirmação de paridade.

## Controles

**SDK e host anteriores.** O fixture roda sobre o `src/` da main `0f2cc7e`, extraído do git (a fachada `057831cf…` é
conferida) para `build/text-style-previous-sdk/` e empacotado pelo mesmo `bundleNativeProbe` (395 entradas, como o
bundle atual), no host da main. Falha exatamente 47 checks: 1 de montagem (os parágrafos com os estilos novos lançam
`Godot Text does not implement style fontStyle` e semelhantes no render), 5 de itálico, 2 de medida, 8 de decoração,
1 de herança, 1 de opacidade, 5 de linhas, 3 de reticências, 16 de negativos (a fachada antiga rejeita tudo com a frase
`does not implement style <nome>`, sem o valor nem a dica) e 5 de contorno (o `NativeText` direto não tem os estilos
no config base, que os descartava em silêncio). Os 14 que passam valem em qualquer SDK: as duas rejeições de `View`
(com as mesmas palavras), a ausência de erro nativo e a recuperação do boundary dos negativos, a ausência de erro do
aplicativo, os 8 de parada e o do relatório.

**O mesmo bundle no host anterior.** O host da main, com o SDK desta fatia, falha exatamente os 27 checks de host e
fica silencioso nos cinco casos de contorno (nenhum erro, o parágrafo montado e pintado como antes); o oráculo rejeita
só `runs`, `italic`, `decorations`, `inheritance`, `ellipsis` e `bypass`. É a prova de que o host, e não a fachada, é
o que inclina, desenha, reporta e recusa o `NativeText` direto.

As oito sabotagens quebram uma decisão cada; os fontes voltam byte a byte (`native/paragraph_layout.cpp`
`2b2bb6f8…` e `src/react-native-platform.jsx` `947856a0…` antes e depois), mesmo que um sinal interrompa a execução
(`scripts/sabotage-sources.mjs`), e o host genuíno volta com o mesmo binário. O probe e o oráculo rejeitam cada uma, e
o teste exige que o oráculo a rejeite na seção própria dela:

| Sabotagem | Checks do probe que falham | Seção do oráculo e a primeira rejeição |
| --- | ---: | --- |
| `decoration-above`: o sinal do deslocamento do sublinhado | 1 de 61 | `decorations`: `underline: line 0 is on the right side of the baseline` |
| `color-ignored`: a linha ignora `textDecorationColor` | 5 | `decorations`: a cor de `color` é a do texto (`f8fafcff` em vez de `f97316ff`); também `runs` e `inheritance` |
| `inherit`: a fachada descarta o `none` do filho | 1 | `inheritance`: `none cancels, line-through replaces, a color alone recolors`; também `runs` e `decorations` |
| `whole-line`: a linha cobre a linha inteira | 3 | `decorations`: `line 0 ends where its glyphs do: 129 differs from 128.796875`; `ellipsis`: `144 differs from 144.46875` |
| `skew-sign`: a inclinação para o outro lado | 2 | `italic`: `the top leans to the right by a quarter of the height: -3 differs from 3` |
| `facade-dotted`: a fachada deixa `dotted` passar | 4 | `negative`: `style-dotted fails with Godot Text does not implement style textDecorationStyle dotted: only solid, not ` (vazio: nada foi lançado) |
| `ellipsis-run`: as reticências voltam ao run 0 | 2 | `ellipsis`: `the ellipsis takes the run of the red tail, not the run of the first glyph` |
| `guard`: o host não recusa o `NativeText` direto | 5 | `bypass`: `oblique: the host refuses it` |

O recibo ([execution.json](execution.json)) tem, de cada lane, o SHA-256 do bundle, do host e do relatório bruto, a
busca e a substituição de cada sabotagem com o SHA-256 do fonte sabotado, e as seções que o oráculo rejeita. Os hosts:
genuíno e restaurado `3dc5a5911aed40bb…` e anterior `5e4306a848d7ac2e…`. O recibo de fonte não certifica o build
nativo hospedado: os SHA-256 dos fontes são os pinos do recibo do bundle (cada um é igual ao blob do commit `7819302`,
conferido na geração do recibo), e os dos hosts são os binários construídos nesta máquina, não os que outra máquina
compilar.

## Capturas

`npm run example -- typography --capture` salva quatro quadros do renderizador nativo enquanto a validação do exemplo
troca a fonte, estreita a janela e confere pixels. Dois deles estão aqui (o inicial e o da janela estreita), e um recorte ampliado
([`crop-line.gd.txt`](crop-line.gd.txt), que não é código do projeto) mostra a linha nova. O
[recibo de capturas](captures.json) registra caminho, SHA-256 e dimensões; o comando rodou duas vezes seguidas e salvou
os mesmos bytes para os quatro quadros, e o recorte é uma função pura do quadro inicial (uma segunda execução salvou os
mesmos bytes). Cada PNG foi conferido a olho nu contra o que a validação reporta.

```sh
node scripts/check.mjs --typography --capture
cp docs/evidence/text-style/crop-line.gd.txt build/crop-line.gd
godot --path . --headless --script res://build/crop-line.gd
```

![O laboratório de tipografia em repouso: abaixo do Hamburgefonts regular e bold, um par Hamburgefonts em pé e em itálico, a linha itálico, sublinhado, tachado (vermelho) e colorido (laranja), e o parágrafo Sublinhado cancelado e de novo com o sublinhado azul interrompido](typography-style-initial.png)

**Inicial** (`typography-style-initial.png`, 900 × 980). O laboratório de tipografia com as linhas novas entre o par
regular e bold e o `letterSpacing`: o par `Hamburgefonts` em pé e em itálico (escrito `italic` com NativeWind), a linha
`itálico · sublinhado · tachado · colorido`, com o sublinhado na cor do texto, o tachado em rosa
(`decoration-rose-400`) e o sublinhado laranja (`decoration-orange-500`), e `Sublinhado cancelado e de novo`, com o
sublinhado azul (`decoration-sky-400`) do pai e o `textDecorationLine: "none"` do span `cancelado`. O resto é o do
laboratório de antes. A validação conferiu que o itálico do par inclina a tinta para a direita da do par em pé, que a
linha laranja está na linha do sublinhado que o host reportou e em nenhuma outra, que o tachado rosa está no meio da
caixa do trecho e que o sublinhado azul para sob `cancelado` e recomeça depois.

![As linhas novas ampliadas quatro vezes: Hamburgefonts em pé e em itálico; itálico, sublinhado, tachado em rosa e colorido em laranja; Sublinhado em azul, cancelado sem linha e e de novo em azul](typography-style-zoom.png)

**Recorte ampliado** (`typography-style-zoom.png`, 1248 × 456). A região de 312 × 114 px do quadro inicial, ampliada
4 vezes sem suavização, para que cada pixel continue um pixel. Dá para ver o topo do `H`, do `b` e do `f` do par em
itálico deslocado para a direita contra o par em pé; o sublinhado branco colado sob `sublinhado`, de uma espessura de
um pixel, e o laranja sob `colorido`; o tachado rosa cruzando o meio de `tachado`; e o sublinhado azul que cobre
`Sublinhado ` (o espaço final incluído), some sob `cancelado` e volta sob ` e de novo`.

![O laboratório com a janela estreita, 620 por 1100, a fonte monoespaçada nos blocos de cima e as linhas novas sem mudança](typography-style-narrow.png)

**Janela estreita** (`typography-style-narrow.png`, 620 × 1100). Depois de a validação trocar a fonte e a escala para a
família monoespaçada (o título, o texto rico e a descrição) e de estreitar a janela: as linhas novas, que não dependem da
fonte trocada, ficam exatamente como antes, no mesmo lugar relativo, e as decorações continuam sob os mesmos trechos.

## Regressões

Na árvore do commit de implementação, com o host `3dc5a591`, passaram (exit 0 em todas):

- `test:text-original` (`TEXT_ORIGINAL_PASSED: 119`, a contagem não mudou: o `font-style` e o `decoration` de lá agora
  tentam `oblique` e um `textDecorationStyle` `dotted`, que o SDK anterior também rejeita com as mesmas palavras),
  `test:text-layout` (`TEXT_LAYOUT_PASSED: 76`), `test:touchables` (93 e a lane animada com 7) e `test:typography`
  (4/4), com o laboratório `typography` em 55 checks headless e 72 com o renderizador;
- `test:examples`, que roda os 35 exemplos headless (o `typography` com 55 checks, o `text-layout` com 22, o
  `touchables` com 13 e o `pressable` com 47);
- `node --test tests/platform-seams.test.mjs` (17/17): a validação de estilo da fachada roda sozinha no teste, por isso
  a tabela de valores mora dentro da função;
- `test:contracts` completo (302 testes Node, 43 do dashboard, 7 de paridade e 13 Python), `test:parity`,
  `type-check` e `check:static`.

## Limites e divergências documentadas

A CI hospedada do passo novo (`native-text-style`, em `contracts.yml`) e a publicação no Pages estão **pendentes**:
nenhuma execução hospedada foi feita, e esta fatia não afirma CI verde; entram depois do merge. Os números acima são
de execução local em macOS arm64. Nenhum GF, checkpoint, peso ou denominador fecha aqui.

Ficam abertos, e não estão neste recibo:

- **Itálico real.** A inclinação é sintética: os TTFs do projeto não têm face itálica nem eixo `ital` ou `slnt`.
  As faces itálicas reais (os TTFs `Italic` do mesmo commit do google/fonts) substituiriam a transformação. `oblique`
  continua rejeitado, com erro.
- **`double`, `dotted`, `dashed` e `wavy`.** Só `solid` é pintado; os outros quatro `textDecorationStyle` falham com
  erro, na fachada e no host. **`overline`** não é um valor dos tipos do RN e continua rejeitado, como os apelidos
  `strikethrough` e `underline-strikethrough` do parser nativo e a ordem invertida.
- **Geometria das linhas.** Segue as métricas do Godot, e não as de nenhuma plataforma: a até cerca de um pixel das do
  Android (tabela acima) e sem medida contra o iOS. Nenhuma paridade de pixel é afirmada.
- **Texto bidirecional.** Os grupos são glifos pintados consecutivos de um run; um run partido por uma reordenação
  bidi ganharia uma linha por pedaço. Bidi está fora da fatia.
- **Cor inválida.** Uma string inválida em `textDecorationColor` é descartada pelo `processColor`, como acontece com
  `color`, e a linha leva a cor do texto.
- **Itálico sem família.** Um parágrafo que pede itálico e não nomeia a família usa NotoSans, como um bold sem família
  já usava, e não a fonte de reserva do tema.
- As capturas são conferidas pelos quatro checks de pixel do próprio exemplo, não por um oráculo independente de
  pixels; a suíte roda headless no host do Godot, e não é um diferencial contra o RN no iOS ou no Android.
- Windows e Linux têm o mesmo JavaScript, sem execução.
