# Fontes do laboratório

Assets originais de [`google/fonts`](https://github.com/google/fonts/tree/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl), commit `9710da1eacb3be272583c3224dcb70f9da6eadbb`:

- `NotoSans.ttf`: `ofl/notosans/NotoSans[wdth,wght].ttf`; licença `OFL-NotoSans.txt`.
- `JetBrainsMono.ttf`: `ofl/jetbrainsmono/JetBrainsMono[wght].ttf`; licença `OFL-JetBrainsMono.txt`.

O eixo `wght` da Noto Sans vai de 100 a 900; o da JetBrains Mono, de 100 a 800.
Pedidos fora da faixa efetiva da família dependem do ajuste feito pelo Godot;
a prova visual exercita 400/600/700, sem certificar peso 900 na fonte mono.

Os arquivos não foram modificados. `tests/typography-contract.test.mjs` verifica SHA-256 dos quatro assets e a presença do eixo `wght`. O adapter usa `FontVariation` e os pesos reais desse eixo; não sintetiza bold. O Godot importa as fontes pelo fluxo normal do editor. Cache `.godot/` e arquivos `.import` não são versionados.

As famílias públicas registradas são `NotoSans` e `JetBrainsMono`; o Tailwind usa `font-sans` e `font-mono`. Texto sem família explícita usa a fonte capturada do Theme ao iniciar a surface. Família arbitrária, fontes de rede e troca do Theme em execução ainda exigem um contrato próprio.
