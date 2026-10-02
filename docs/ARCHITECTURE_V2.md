# Godot Fabric — Arquitetura 2.0

**Status:** documento de direção, consolidado parcialmente até o tema 3.

**Data:** 2026-10-02.

**Base consultada:** `main@7e61b74`, React Native 0.87.1 / React 19.2.3.

“2.0” identifica a proposta de arquitetura. Não representa uma versão publicada
do SDK nem certificação de paridade com React Native. Os exemplos de integração
abaixo descrevem APIs propostas e ainda não executam no projeto atual.

Este documento registra as decisões da discussão e os contratos que precisam
ser implementados. O [registro de 32 decisões pendentes](ARCHITECTURE_V2_DECISIONS.md)
detalha alternativas, recomendações e validações para continuar a discussão.
A [arquitetura atual](ARCHITECTURE.md), a
[auditoria de paridade](PARITY.md) e o [roadmap para 1.0](../ROADMAP.md) continuam
descrevendo, respectivamente, a implementação, seus gaps e o status do trabalho.

## Objetivo e escopo desta consolidação

Construir uma plataforma React Native para Godot, aproveitando React, Fabric,
Hermes e Yoga originais. JSX, hooks e reconciliação devem produzir UI na árvore
do Godot através do addon, usando o executável oficial do engine.

A direção geral busca uma experiência integrada ao Godot: configurar o addon,
adicionar uma surface e executar o jogo. Distribuição do SDK, ferramentas de
build, extensões nativas e exportação ainda precisam de discussão específica.

Os temas consolidados são:

1. Aplicação, runtime, raízes e ciclo de vida.
2. Dimensões, layout adaptativo e NativeWind.
3. Comunicação entre Godot e JavaScript, com gestão de estado independente.

As decisões de arquitetura desses temas foram alinhadas na discussão. Assinaturas
finais de APIs, detalhes dos protocolos e suas provas de comportamento ainda
precisam ser fechados e implementados. Os demais temas estão listados ao final.

## Tema 1 — Aplicação, runtime e surfaces

### Uma aplicação compartilhada, várias raízes

A configuração inicial será uma aplicação React Native por execução do jogo,
com um runtime Hermes compartilhado e várias surfaces. O runtime pertence à
aplicação e pode sobreviver à troca de cenas.

Cada surface tem sua identidade de raiz, componente de entrada, props,
constraints de layout, ciclo de vida e conteúdo nativo. HUD e inventário podem
existir simultaneamente sem serem duas aplicações independentes.

```mermaid
flowchart TD
  Application[Aplicação React Native] --> Runtime[Hermes compartilhado]
  Runtime --> Registry[AppRegistry]
  Registry --> HUD[Raiz HUD / SurfaceId próprio]
  Registry --> Inventory[Raiz Inventory / SurfaceId próprio]
  HUD --> HUDControls[Controls do HUD]
  Inventory --> InventoryControls[Controls do inventário]
```

Separar raízes não isola a execução JavaScript: uma tarefa que bloqueie o runtime
afeta todas as surfaces. Aplicações com runtimes separados seriam uma extensão
futura, com outro contrato de isolamento.

### AppRegistry desde o início

O host deve integrar o AppRegistry do RN para registrar, iniciar e desmontar
raízes. Somente componentes montados diretamente pelo Godot como entradas
precisam de registro. Componentes filhos seguem a composição normal do React.

```tsx
import { AppRegistry } from "react-native";
import { HUD } from "./HUD";
import { Inventory } from "./Inventory";

AppRegistry.registerComponent("HUD", () => HUD);
AppRegistry.registerComponent("Inventory", () => Inventory);
```

Uma `HealthBar` dentro de `HUD` não precisa ser registrada. A mesma entrada
registrada pode ser montada em duas surfaces com props diferentes e estados
locais independentes.

Para o caso simples, o autor poderá exportar um componente padrão e o builder
gerará o registro no AppRegistry. O nome dessa entrada e sua configuração ainda
precisam de definição. Várias entradas externas terão registro explícito.

Essa direção usa o [contrato de entrada e ciclo de vida do AppRegistry](https://reactnative.dev/docs/appregistry).

### Posse de estado e recursos

| Escopo | Responsabilidade |
| --- | --- |
| Aplicação | Hermes, cache de módulos, AppRegistry e timers globais |
| Store criada no escopo de um módulo | Dados compartilhados pelas raízes que a utilizam |
| Instância da raiz e seus componentes | `useState`, providers, effects e suas subscriptions |
| Surface e árvore montada | Controls, referências nativas e destinos de input |
| Projeto do jogo | Definir onde ficam suas regras e seu estado de domínio |

Context não atravessa automaticamente raízes diferentes. Compartilhar uma store
é uma escolha explícita. Dados de gameplay mantidos no Godot podem ser
representados no JavaScript para apresentação, sem transferir sua autoridade.

### Ciclo de vida

| Operação | Comportamento decidido |
| --- | --- |
| Ocultar uma surface | Preserva a raiz, estado local e effects; ocultar não suspende o trabalho |
| Desmontar uma surface | Executa o cleanup do React, remove a árvore nativa e invalida suas referências |
| Montar novamente | Cria novo estado local; stores da aplicação continuam disponíveis |
| Trocar de cena | Pode desmontar suas surfaces, preservando a aplicação compartilhada |
| Reiniciar a aplicação | Recria o runtime e suas raízes; referências e callbacks da execução anterior ficam inválidos |

Uma futura política de suspensão de trabalho em surfaces ocultas será uma
operação distinta. Pausa do jogo e background do sistema ainda precisam de
contratos próprios.

### Timers e falhas

Desmontar uma raiz não cancela todos os timers do runtime compartilhado. Um
effect que cria um intervalo deve cancelá-lo no cleanup. Recursos nativos
vinculados a uma montagem precisam de identidade e geração para impedir que
respostas antigas acessem uma árvore substituída.

Erros de render podem ser tratados por error boundaries. Exceções assíncronas
precisam de política própria; boundaries não fornecem isolamento geral da VM.
O compartilhamento do runtime torna explícito esse acoplamento de execução.

### Aceitação do tema 1

Montar HUD e inventário simultaneamente; atualizar seus estados locais de forma
independente; desmontar e remontar o inventário sem reiniciar o HUD ou perder a
store compartilhada. Verificar cleanup, timers globais preservados e rejeição de
referências antigas após substituição da raiz ou reinício da aplicação.

## Tema 2 — Dimensões, layout adaptativo e NativeWind

### Janela e surface têm medidas diferentes

As métricas públicas do RN descrevem a janela ou o display. O tamanho disponível
para uma raiz é uma constraint própria de sua surface.

| Elemento | Exemplo em unidades lógicas |
| --- | --- |
| Janela principal | 1920 × 1080 |
| Surface do HUD | 1920 × 1080 |
| Surface do inventário | 600 × 700 |

`Dimensions.get("window")` e `useWindowDimensions()` descrevem a janela da
aplicação. `Dimensions.get("screen")` descreve o display, convertido segundo a
política de escala da plataforma. Redimensionar somente o inventário altera
suas constraints Yoga, sem redefinir o significado das métricas da janela.

Esses significados seguem [Dimensions](https://reactnative.dev/docs/dimensions)
e [useWindowDimensions](https://reactnative.dev/docs/usewindowdimensions).

### Layout pelo espaço realmente disponível

Flexbox, porcentagens e `onLayout` serão os mecanismos portáveis para compor UI
dentro de um painel. Um gráfico, por exemplo, pode receber a largura medida de
seu contêiner.

Foi aceita a direção de um helper opcional `useSurfaceDimensions()`, específico
do SDK, para consultar a raiz atual. Seu nome final e import ainda precisam de
definição. Ele não muda a semântica de `useWindowDimensions()`.

### NativeWind: janela para media queries, contêiner para container queries

Breakpoints como `md:` usam as métricas da janela. Container queries usam o
tamanho do contêiner marcado na árvore. Essa diferença permite adaptar um
inventário pequeno dentro de uma janela grande.

```tsx
// Sintaxe-alvo; suporte no Godot ainda precisa ser certificado.
<View className="flex-1 @container">
  <View className="flex-col @md:flex-row">
    <ItemList />
    <ItemDetails />
  </View>
</View>
```

NativeWind v4 documenta suporte ao
[plugin de container queries](https://www.nativewind.dev/docs/tailwind/plugins/container-queries).
Isso não prova que nosso host já fornece todos os contratos necessários. A
integração deverá exercitar compilação, runtime, medição e mudanças de layout.

### Coordenadas, escala e associação ao viewport

Yoga trabalha em unidades lógicas. O host converte entre coordenadas locais,
viewport, janela e pixels físicos. Transformações de Controls, densidade do
display e `fontScale` precisam preservar seus significados próprios.

Renderização, medição e hit testing devem concordar. Alterar a escala visual de
um Control não redefine automaticamente a densidade do dispositivo.

Cada surface identifica sua janela e viewport. Na configuração inicial, as
métricas globais do RN referem-se à janela principal. Uma segunda janela exige
política explícita de métricas e foco; essa política ainda está aberta.

### Aceitação do tema 2

Com HUD e inventário montados, redimensionar apenas o inventário. Seu layout e
container queries reagem, o tamanho do HUD permanece estável e as métricas da
janela não mudam. Cliques e medidas continuam alinhados à geometria resultante.
Redimensionar a janela deve atualizar suas métricas e os breakpoints pertinentes.

## Tema 3 — Comunicação entre Godot e JavaScript

### Integração independente da gestão de estado

Godot Fabric fornece chamadas, conversão de valores, resultados, erros e eventos
entre Godot e JavaScript. O projeto escolhe Zustand, Redux, Jotai, Context ou
hooks do React para organizar o estado da aplicação.

O núcleo não obriga uma store nem inclui `useGameState` ou `useGameCommand` como
contratos fundamentais. Helpers desse tipo podem existir em um pacote opcional.
Uma representação local dos dados pode ser útil para renderizar; ela não exige
um gerenciador de estado de domínio dentro do addon.

| Camada | Responsabilidade |
| --- | --- |
| Godot | Executar os métodos e regras que o projeto mantém no jogo |
| Godot Fabric | Entregar chamadas e eventos, com contratos de execução e validade |
| Aplicação JavaScript / biblioteca escolhida | Organizar dados, seletores e ações |
| React e Fabric | Renderizar, reconciliar e atualizar a árvore nativa |

O RN oferece [módulos nativos](https://reactnative.dev/docs/turbo-native-modules-introduction)
e [eventos nativos tipados](https://reactnative.dev/docs/the-new-architecture/native-modules-custom-events).
Essa é a direção da integração. JSX não recebe um signal automaticamente.

### Nome público: GodotFabric nos dois lados

O serviço do addon em GDScript será chamado `GodotFabric`. A interface
JavaScript também será `GodotFabric`, com `GodotFabric.subscribe(...)`.

O import `@godot-fabric/runtime` é a localização proposta para essa interface;
não representa um pacote já publicado. A nomenclatura pública não renomeia os
tipos e componentes internos do Fabric original do RN.

### Exemplo completo: signal até a UI

**Exemplo de API proposta, ainda não executável.** No Godot, o addon conecta um
callback nativo ao signal indicado:

```gdscript
extends Node

signal health_changed(value: int)
var health: int = 100

func _ready():
    GodotFabric.bind_signal("player.health_changed", health_changed)

func take_damage(amount: int):
    health = maxi(0, health - amount)
    health_changed.emit(health)
```

No JavaScript, a interface do SDK registra um listener no serviço exposto ao
Hermes pelo addon. O componente usa um effect para assinar e remover o listener:

```tsx
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { GodotFabric } from "@godot-fabric/runtime";

export function HealthBar() {
  const [health, setHealth] = useState<number | null>(null);

  useEffect(() => {
    const subscription = GodotFabric.subscribe(
      "player.health_changed",
      (value: number) => setHealth(value),
    );

    return () => subscription.remove();
  }, []);

  return <Text>Vida: {health ?? "—"}</Text>;
}
```

```mermaid
sequenceDiagram
  participant Game as Godot / GDScript
  participant Addon as Addon Godot Fabric
  participant JS as Hermes / GodotFabric
  participant React as Componente React
  participant Mount as Fabric / Controls
  Game->>Addon: health_changed.emit(80)
  Addon->>Addon: Converter argumentos e encaminhar evento
  Addon->>JS: Entregar player.health_changed com valor 80
  JS->>React: Chamar listener registrado
  React->>React: setHealth(80) e render
  React->>Mount: Reconciliar e aplicar atualização nativa
```

O caminho ocorre no processo do jogo. O callback executa no contexto permitido
pelo runtime executor; emitir o signal não deve causar reentrada arbitrária em
render ou montagem. O JSX apresenta o valor atualizado pelo React.

Com Zustand, o listener atualiza a store escolhida e o componente usa seu hook
normal. A conexão com o Godot pode pertencer à aplicação compartilhada, enquanto
HUD e inventário assinam a mesma store. Não é preciso abrir uma assinatura nativa
por componente. O projeto continua responsável pelo cleanup dessas conexões.

### Valor inicial, estado e acontecimentos

O exemplo acompanha eventos futuros. Se o signal já foi emitido antes da
assinatura, ele não fornece a vida atual automaticamente.

Precisamos definir um contrato de leitura inicial mais acompanhamento de
mudanças que evite perder atualizações durante a conexão. A API e o protocolo
de versões ainda estão abertos; não é suficiente fazer uma leitura e assinar
sem tratar essa janela de concorrência.

Estado representa um valor atual; eventos representam acontecimentos. Uma
publicação de estado pode agrupar valores intermediários quando seu contrato
permitir. Eventos como dois danos consecutivos precisam preservar sua identidade
e ordem. Política de agrupamento, limites da fila e comportamento sob carga
devem ser definidos por contrato, sem descarte silencioso.

Raízes diferentes podem observar a mesma revisão de dados. Isso não implica um
commit visual simultâneo de todas as raízes; seus commits continuam sob o RN.

### Props, métodos, tipos e ciclo de vida

- Props configuram uma entrada da surface. Atualizações normais preservam sua
  identidade e estado local; reiniciar a raiz é explícito.
- Métodos publicados pelo jogo ficam acessíveis ao JavaScript, com argumentos,
  resultados e erros. A integração básica por GDScript deve evitar exigir C++
  por jogo. O registro de métodos e a API de chamada ainda precisam ser definidos.
- Operações que acessam Godot executam na thread apropriada, em um ponto seguro.
  Resultado e conclusão têm semântica definida pelo método publicado.
- Uma operação aceita pelo jogo pode concluir após fechar o painel. Cancelamento
  depende do contrato da operação. A conclusão não pode acessar refs desmontadas.
- Subscriptions globais podem sobreviver ao fechamento de uma surface.
  Subscriptions criadas em effects seguem seu cleanup. O serviço deve permitir
  remoção e invalidar callbacks da geração anterior quando o runtime reiniciar.
- Métodos e eventos terão contratos de tipos. Referências a objetos e recursos
  precisam de validade e erro definido após remoção; conversões de estruturas
  do Godot e geração de tipos TypeScript ainda precisam de especificação.
- A conexão nativa criada por `bind_signal` precisa de cleanup ao remover sua
  origem ou encerrar a integração. API de desligamento, conflitos de nomes e
  sinais com vários argumentos ainda precisam ser definidos.

### Aceitação do tema 3

Criar um exemplo genérico com HUD e inventário, usando Zustand para demonstrar
que o transporte funciona com uma biblioteca independente. Alterar a vida no
Godot atualiza a UI; equipar um item chama o jogo e atualiza os consumidores.

Fechar o inventário durante uma operação aceita permite sua conclusão conforme
o contrato. Reabrir mostra os dados atuais. Verificar leitura inicial sem perda
de atualização, cleanup repetido, ordem dos eventos e referências invalidadas
quando uma entidade ou geração do runtime deixa de existir.

## Distância entre a direção e a implementação consultada

| Área | Base consultada | Direção deste documento |
| --- | --- | --- |
| Posse do runtime | `FabricSurface::Impl` cria seu Hermes e seus serviços | Aplicação compartilhada possui o runtime; surfaces possuem raízes |
| Entrada React | Exemplo chama `ReactFabric.render` com raiz `1` | AppRegistry, identidades distintas e registro automático no caso simples |
| Constraints e métricas | Surface usa o rect do viewport; métricas expostas têm `scale` e `fontScale` fixos em `1` | Separar janela, display e tamanho disponível para cada surface |
| Integração com o jogo | As APIs públicas `GodotFabric` deste documento ainda não existem | Métodos/eventos tipados, com execução e ciclos de vida explícitos |
| Gestão de estado | A proposta não altera nem impõe uma biblioteca | Biblioteca escolhida pelo projeto, com utilitários opcionais |

Referências da implementação consultada:
[host nativo](../native/fabric_surface.cpp),
[entrada dos exemplos](../examples/entry.jsx) e
[métricas JavaScript](../src/window-dimensions.js).
Essa comparação é uma fotografia da base indicada no início, não um status
automaticamente atualizado da migração.

## Próximos temas ainda abertos

As escolhas pendentes têm IDs estáveis no
[registro de decisões da v2.0](ARCHITECTURE_V2_DECISIONS.md).
As recomendações desse registro não representam aprovação nem implementação.

| Tema | Contrato a discutir |
| --- | --- |
| Autoridade sobre árvore e input | Limites entre Containers/Controls do Godot e layout Fabric/Yoga; foco, modais, consumo de input, pausa e SubViewports |
| Extensões e adapters | Registro, schemas, Codegen, componentes/módulos externos e fronteira ABI do SDK |
| Builder e resolução | Toolchain privada, Metro/Babel, condições de packages, identidade única de React e configuração do projeto |
| Ativação e desenvolvimento | Gerações de artefatos, falhas de avaliação/montagem, reload, Fast Refresh e encerramento seguro |
| Assets e exportação | Recursos, manifestos, host versus target, empacotamento e falhas verificáveis de export |
| Tipos e plataformas | Coerência entre editor/build/runtime, identidade da plataforma Godot e serviços específicos de cada OS |
| Threads e desempenho | Runtime/mount executors, medição de texto, prioridades, reentrada, filas e profiling |
| Certificação de compatibilidade | Oráculo RN original, fixtures diferenciais, tolerâncias e matriz por biblioteca/plataforma |

A ordem de implementação da migração ainda não foi aprovada. A proposta não
encerra gaps do roadmap nem amplia a matriz de plataformas suportadas pelo
protótipo. Novas decisões devem atualizar este documento com seu status e
critérios de aceitação, preservando a distinção entre direção e prova executada.
