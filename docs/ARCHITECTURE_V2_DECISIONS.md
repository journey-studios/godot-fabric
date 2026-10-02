# Godot Fabric — Registro de decisões da arquitetura 2.0

**Status:** 15 decisões aprovadas (V2-D01 a V2-D15) e 17 pendentes (V2-D16 a V2-D32).

**Data:** 2026-10-02.

Este documento complementa a [direção da arquitetura 2.0](ARCHITECTURE_V2.md).
Ele detalha os contratos ainda necessários, incluindo lacunas da proposta de
migração e pontos deixados abertos nos temas discutidos.

As direções de V2-D01 a V2-D15 foram aprovadas em 2026-10-02. Seus contratos
estão consolidados na arquitetura principal; as alternativas dessas entradas
ficam como histórico da escolha. V2-D16 a V2-D32 continuam como propostas.
A aprovação não implementa APIs nem muda o status do [roadmap para 1.0](../ROADMAP.md).
Uma aplicação compartilhada, AppRegistry, a separação entre janela e surface,
gestão de estado independente e o nome público `GodotFabric` continuam sendo
a direção consolidada.

## Como fechar uma decisão

Cada ID tem uma questão, alternativas e cenário de validação. Entradas pendentes
têm uma recomendação; entradas aprovadas apontam para seu contrato na arquitetura
principal. Aprovar o contrato não equivale a provar sua implementação; a
evidência executada deve ser registrada separadamente. Assinaturas finais e
detalhes deixados para especificação não são inventados pelo registro da aprovação.

Os IDs são estáveis. A ordem abaixo organiza a discussão; não aprova uma
sequência de implementação nem cria novos itens de roadmap.

## Como entender o que está sendo decidido

As entradas aprofundadas apresentam situação de uso, consequências dos caminhos
e detalhes a especificar. V2-D11 a V2-D15 estão aprovados na direção discutida,
com retomada, contextos e integração nativa ainda a especificar. V2-D16 a V2-D32
continuam como propostas, incluindo seus exemplos de comportamento;
nenhuma entrada descreve implementação comprovada.

Há três naturezas de discussão, que podem aparecer juntas:

- **Produto:** comportamento percebido ou compromisso público do SDK. Precisa
  de escolha consciente: pausar a UI, perder estado num reload, exigir instalação
  externa ou anunciar suporte a uma plataforma.
- **Contrato:** limite que autores de bibliotecas e projetos precisam conhecer.
  Aprovar a direção deixa formatos e casos de borda para especificação, como
  versões de adapters e comandos que uma ref aceita.
- **Execução:** mecanismo interno a escolher por evidência. Cache, orçamento de
  fila, executor e uso de Rust devem cumprir o contrato e ser medidos; não
  precisam virar preferências arbitrárias do consumidor.

Compatibilidade com o RN não é uma alternativa à correção. Algumas perguntas
localizam uma obrigação técnica; outras oferecem comportamentos diferentes.
Cada aprofundamento indica essa diferença. Nenhuma classificação aprova
automaticamente um ponto pendente.

| Discussão | O que precisa ficar claro antes de aprovar |
| --- | --- |
| [Extensões](#v2-d16), D16–D17 | Comportamentos dos componentes e reuso das libs; descoberta, compatibilidade binária e specs/Codegen aprovados em D13–D15 |
| [Ferramentas](#v2-d18), D18–D21 | Instalar, escrever TSX e apertar Play, incluindo dependências |
| [Desenvolvimento e distribuição](#v2-d22), D22–D27 | Salvar código, errar, exportar ou fechar o jogo |
| [Execução e tipos](#v2-d28), D28–D29 | O que preservar ao otimizar e publicar APIs |
| [Plataformas e certificação](#v2-d30), D30–D31 | O que significa dizer que algo é compatível |
| [Migração](#v2-d32), D32 | Como chegar à 1.0 sem perder o que funciona |

Discutir uma família de comportamento por vez. Os IDs mantêm rastreabilidade;
não exigem aprovações rápidas sem exemplos.

### Termos usados nas discussões

| Termo | Significado aqui |
| --- | --- |
| Runtime / Hermes | Ambiente em que o JavaScript da aplicação executa dentro do Godot |
| Surface / raiz | Área hospedada pelo Godot em que uma entrada React está montada |
| Fabric / Yoga | Renderer que produz a árvore/transações nativas e mecanismo que calcula seu layout |
| Adapter | Implementação Godot dos componentes ou serviços nativos que uma lib espera |
| Spec / Codegen | Declaração da interface e geração de partes da integração; não gera o comportamento do backend |
| ABI | Contrato entre binários compilados: como funções, objetos e dados atravessam a interface |
| Builder / bundle | Ferramenta que transforma e reúne fontes/dependências, e o código resultante |
| Manifesto | Descrição do conteúdo, versões, requisitos e identidades de um conjunto distribuído |
| Geração | Identidade de um build, runtime ou montagem; são ciclos distintos, não um único contador universal |
| Source map | Mapa que relaciona posição no código gerado à fonte original para diagnóstico |
| Executor | Mecanismo que decide onde/quando trabalho é executado, incluindo thread e agendamento |
| Shaping de texto | Preparação de caracteres em glifos e posições usados para medir/desenhar |

## Índice

| ID | Contrato | Status |
| --- | --- | --- |
| [V2-D01](#v2-d01) | Configuração da aplicação e registro automático da entrada | Aprovada |
| [V2-D02](#v2-d02) | Identidade, montagem e atualização das surfaces | Aprovada |
| [V2-D03](#v2-d03) | Leitura inicial e subscription sem perder mudanças | Aprovada |
| [V2-D04](#v2-d04) | Nomes, escopos e argumentos dos signals | Aprovada |
| [V2-D05](#v2-d05) | Registro de métodos e chamadas JavaScript → Godot | Aprovada |
| [V2-D06](#v2-d06) | Conversão de valores e validade das referências | Aprovada |
| [V2-D07](#v2-d07) | Ordem, prioridade e limites da entrega de eventos | Aprovada |
| [V2-D08](#v2-d08) | Posse e cleanup das conexões nativas | Aprovada |
| [V2-D09](#v2-d09) | Autoridade sobre layout e árvore nativa | Aprovada |
| [V2-D10](#v2-d10) | Input, foco e interação com o gameplay | Aprovada |
| [V2-D11](#v2-d11) | Pausa do jogo, background e relógios da UI | Aprovada |
| [V2-D12](#v2-d12) | Janelas, SubViewports e contexto de métricas | Aprovada |
| [V2-D13](#v2-d13) | Registro e descoberta de adapters | Aprovada |
| [V2-D14](#v2-d14) | Compatibilidade binária do SDK e dos adapters | Aprovada |
| [V2-D15](#v2-d15) | Schemas, Codegen e artefatos gerados | Aprovada |
| [V2-D16](#v2-d16) | Contrato completo de um componente nativo | Pendente |
| [V2-D17](#v2-d17) | Reuso da biblioteca original versus uma facade alternativa | Pendente |
| [V2-D18](#v2-d18) | Distribuição do SDK e dependências do projeto | Pendente |
| [V2-D19](#v2-d19) | Builder, protocolo, cache e workspaces | Pendente |
| [V2-D20](#v2-d20) | Resolução de módulos e identidade única de React | Pendente |
| [V2-D21](#v2-d21) | Babel, configuração do usuário e NativeWind | Pendente |
| [V2-D22](#v2-d22) | Ativação de builds e recuperação após falhas | Pendente |
| [V2-D23](#v2-d23) | Fast Refresh e limites da preservação de estado | Pendente |
| [V2-D24](#v2-d24) | Assets, recursos importados e manifesto | Pendente |
| [V2-D25](#v2-d25) | Exportação, targets e falha obrigatória do processo | Pendente |
| [V2-D26](#v2-d26) | Erros, source maps e diagnósticos | Pendente |
| [V2-D27](#v2-d27) | Encerramento, cancelamento e trabalho pendente | Pendente |
| [V2-D28](#v2-d28) | Threads, medição de texto e desempenho | Pendente |
| [V2-D29](#v2-d29) | Tipos coerentes com build e runtime | Pendente |
| [V2-D30](#v2-d30) | Identidade Godot e serviços do sistema operacional | Pendente |
| [V2-D31](#v2-d31) | Certificação, versões e bibliotecas suportadas | Pendente |
| [V2-D32](#v2-d32) | Migração e relação com a entrega 1.0 | Pendente |

## Aplicação e surfaces — completar o tema 1

### V2-D01

**Status:** aprovada na direção recomendada em 2026-10-02.

**Contrato aprovado:** [V2-D01 na arquitetura consolidada](ARCHITECTURE_V2.md#v2-d01).

**Decisão:** onde configurar entry, bundle, opções da aplicação e o nome da raiz
registrada automaticamente para um `export default`.

- **Alternativas avaliadas:** ProjectSettings, um recurso de configuração da aplicação ou
  bootstrap por script; todos respeitando a posse da aplicação já decidida.
- **Validação:** dois painéis usam a mesma aplicação; projeto com uma entrada
  funciona sem registro manual; entrada ausente ou duplicada gera erro claro.

### V2-D02

**Status:** aprovada na direção recomendada em 2026-10-02.

**Contrato aprovado:** [V2-D02 na arquitetura consolidada](ARCHITECTURE_V2.md#v2-d02).

**Decisão:** como atribuir IDs, distinguir montagens e atualizar props sem
reaproveitar referências de uma raiz encerrada.

- **Alternativas avaliadas:** identidade baseada no caminho do Node ou IDs do host com
  geração de montagem/runtime; APIs explícitas ou montagem ligada ao ciclo do Node.
- **Validação:** montar duas instâncias da mesma entrada, mudar props, substituir
  uma raiz e reenviar um comando antigo; somente a referência vigente funciona.

## Comunicação Godot ↔ JavaScript — completar o tema 3

### V2-D03

**Status:** aprovada na direção recomendada em 2026-10-02.

**Contrato aprovado:** [V2-D03 na arquitetura consolidada](ARCHITECTURE_V2.md#v2-d03).

**Decisão:** como obter dados iniciais e acompanhar alterações sem perder uma
mudança entre a leitura e a instalação do listener.

- **Alternativas avaliadas:** leitura e subscription atômicas no publisher; ou instalar o
  listener, ler uma revisão e ordenar os eventos recebidos durante a leitura.
- **Validação:** modificar o valor durante a conexão e reabrir um painel depois
  de várias mudanças; ele recebe o estado atual sem perda ou regressão de revisão.

### V2-D04

**Status:** aprovada na direção recomendada em 2026-10-02.

**Contrato aprovado:** [V2-D04 na arquitetura consolidada](ARCHITECTURE_V2.md#v2-d04).

**Decisão:** como nomes de eventos, várias instâncias e signals com múltiplos
argumentos aparecem em `GodotFabric.bind_signal` e `GodotFabric.subscribe`.

- **Alternativas avaliadas:** nomes globais livres, namespaces registrados ou canais
  associados a uma origem/instância; argumentos posicionais ou payload tipado.
- **Validação:** dois jogadores emitem o mesmo tipo de signal; um signal envia
  vários argumentos; nomes conflitantes e payload inválido não chegam ao destino errado.

### V2-D05

**Status:** aprovada na direção recomendada em 2026-10-02.

**Contrato aprovado:** [V2-D05 na arquitetura consolidada](ARCHITECTURE_V2.md#v2-d05).

**Decisão:** como publicar funções do jogo e chamá-las pelo JavaScript, incluindo
resultado, erro, conclusão e cancelamento.

- **Alternativas avaliadas:** chamada genérica por nome, interfaces geradas por serviço ou
  módulos nativos específicos; cada uma com métodos síncronos e/ou assíncronos.
- **Validação:** método inexistente, argumento inválido, exceção, execução
  bem-sucedida e pedido de cancelamento têm respostas distinguíveis.

### V2-D06

**Status:** aprovada na direção recomendada em 2026-10-02.

**Contrato aprovado:** [V2-D06 na arquitetura consolidada](ARCHITECTURE_V2.md#v2-d06).

**Decisão:** quais valores atravessam a integração e como referenciar objetos
Godot sem deixar ponteiros ou referências inválidas no JavaScript.

- **Alternativas avaliadas:** DTOs, handles opacos, wrappers de objetos ou conversores
  registrados para tipos específicos.
- **Validação:** referência removida ou de outra geração falha; números grandes,
  estruturas aninhadas e payload cíclico preservam o contrato ou são rejeitados.

### V2-D07

**Status:** aprovada na direção recomendada em 2026-10-02.

**Contrato aprovado:** [V2-D07 na arquitetura consolidada](ARCHITECTURE_V2.md#v2-d07).

**Decisão:** quais garantias de ordem e prioridade oferecer e como agir quando
o produtor envia mais eventos do que a UI consegue consumir.

- **Alternativas avaliadas:** fila global, filas por canal, agrupamento explícito de estado
  ou controle de produção; descarte apenas se o contrato o autorizar.
- **Validação:** dois danos permanecem dois eventos; uma sequência de medidas
  pode agrupar conforme contrato; carga alta tem comportamento e métricas verificáveis.

### V2-D08

**Status:** aprovada na direção recomendada em 2026-10-02.

**Contrato aprovado:** [V2-D08 na arquitetura consolidada](ARCHITECTURE_V2.md#v2-d08).

**Decisão:** quem possui o binding nativo de um signal e como desligá-lo,
substituí-lo ou encerrar suas subscriptions.

- **Alternativas avaliadas:** tokens explícitos de binding, posse pelo Node de origem ou
  pelo serviço registrado; lifetimes de aplicação e surface permanecem distintos.
- **Validação:** cleanup duplo, Node destruído, troca de origem e remount repetido
  não duplicam listeners nem entregam callbacks de uma geração encerrada.

## Autoridade sobre UI, input e tempo

### V2-D09

**Status:** aprovada na direção recomendada em 2026-10-02.

**Contrato aprovado:** [V2-D09 na arquitetura consolidada](ARCHITECTURE_V2.md#v2-d09).

**Decisão:** onde Godot e Fabric podem alterar layout, hierarquia e propriedades
sem criar dois sistemas disputando o mesmo conteúdo.

- **Alternativas avaliadas:** subtree exclusivamente gerida por Fabric ou mistura com
  Nodes externos através de pontos de integração definidos.
- **Validação:** uma surface dentro de um Container recebe constraints corretas;
  alterações externas em descendentes são tratadas explicitamente, sem disputa de layout.

### V2-D10

**Status:** aprovada na direção recomendada em 2026-10-02.

**Contrato aprovado:** [V2-D10 na arquitetura consolidada](ARCHITECTURE_V2.md#v2-d10).

**Decisão:** como distribuir input entre roots, Controls externos e gameplay,
incluindo foco, teclado/gamepad, transparência e modais.

- **Alternativas avaliadas:** capturar toda a região da surface, consumir somente destinos
  interativos ou definir políticas explícitas por surface/overlay.
- **Validação:** clique em fundo transparente chega ao jogo quando permitido;
  botão e modal não ativam gameplay; foco atravessa e retorna às árvores corretas.

### V2-D11

**Status:** aprovada na direção discutida em 2026-10-02; semântica exata de retomada
pendente de especificação e comparação com o RN da versão fixada por OS.

**Contrato aprovado:** [V2-D11 na arquitetura consolidada](ARCHITECTURE_V2.md#v2-d11).

**Decisão:** o que pausa ao pausar o jogo, ocultar UI ou colocar o aplicativo em
background, e qual relógio alimenta timers, RAF e animações.

- **Alternativas avaliadas:** UI acompanha o tempo do jogo, usa tempo real ou recebe uma
  política explícita separada para cada situação.
- **Validação:** menu funciona durante pausa; alterar velocidade da simulação
  não muda timers públicos; retomada tem política clara para callbacks atrasados.

**Natureza:** produto e contrato; a implementação do relógio é execução.

**Na prática:** o jogador pausa durante um combate. O mundo para, mas o botão
de continuar, o indicador de salvamento e a transição do menu precisam funcionar.
Uma lib que faz debounce de busca com `setTimeout` não deveria mudar de
comportamento porque a simulação passou a rodar em velocidade 4×.

| Situação | Direção aprovada; detalhes de retomada ainda a especificar |
| --- | --- |
| Jogo pausado | Runtime, input da UI e timers continuam; simulação depende do jogo |
| Simulação acelerada | Timers públicos mantêm tempo real; tempo do jogo chega como dado explícito |
| Uma surface oculta | Estado/effects continuam, conforme aprovado; otimizar pintura não suspende a aplicação |
| Aplicativo em background | Mapear lifecycle do OS; não prometer execução enquanto o processo estiver suspenso |
| Retorno do background | Reconectar estado atual e tratar callbacks vencidos sem simular frames que não existiram |

**Consequências dos caminhos:** usar o delta da simulação como relógio público
acopla as libs ao jogo e pode congelar o menu de pausa. Tempo real separa as
responsabilidades: cooldown depende de dados do jogo; busca da UI depende do
tempo real. Uma política de execução por surface parece flexível, mas um único
Hermes tem timers e stores globais: pausar todo o JS de um painel não é isolamento
disponível nessa arquitetura.

**Como ler o contrato aprovado:** deadlines monotônicos para agendamento, separados
do relógio civil de `Date.now()`, do tempo da simulação e dos frames apresentados.
RAF acompanha oportunidades de apresentação; não prometer que todo mecanismo
de animação roda pelo mesmo callback.

**Ainda a especificar:** um timeout vencido durante suspensão, um interval que
perdeu cem períodos e uma animação retomada são casos diferentes. A direção de
evitar rajadas está aprovada; entregar um timeout vencido quando o host puder
executar, reprogramar intervals e retomar animações ainda exige contrato preciso
e comparação com o RN da versão fixada por OS. Não usar essa direção para descartar
acontecimentos do jogo, sujeitos a V2-D07. Foco de janela, background e surface
oculta precisam de sinais distintos. JS longo pode bloquear a UI mesmo com relógio correto.

O RN oferece [timers e RAF](https://reactnative.dev/docs/timers) e
[AppState para lifecycle](https://reactnative.dev/docs/appstate). No Godot,
[process mode participa da pausa](https://docs.godotengine.org/en/stable/tutorials/scripting/pausing_games.html),
e signals podem executar em Nodes sem processamento. Cobrir tanto o pump do
runtime quanto callbacks que chegam do Godot.

### V2-D12

**Status:** aprovada na direção discutida em 2026-10-02; contexto explícito
desde o início, com suporte por modo sujeito a testes próprios e certificação.

**Contrato aprovado:** [V2-D12 na arquitetura consolidada](ARCHITECTURE_V2.md#v2-d12).

**Decisão:** como associar raiz, Window e SubViewport e expressar medidas,
coordenadas, safe areas e foco fora da janela principal.

- **Alternativas avaliadas:** escopo inicial limitado à janela principal ou contexto de
  surface que também suporte outras janelas/viewports com diferenças declaradas.
- **Validação:** dois painéis, viewport escalado e janela secundária têm medidas
  e hit testing coerentes; APIs globais mantêm o significado já aprovado.

**Natureza:** produto para contextos suportados e contrato para coordenadas.

**Na prática:** um inventário de 600 × 700 ocupa parte de uma janela maior.
Outra UI tem 400 × 300 num SubViewport e aparece ampliada a 800 × 600. Um botão
em x=100 na UI passa por essa transformação; comparar diretamente o mouse da
janela com o rect local erra o alvo.

**Consequências dos caminhos:** limitar inicialmente à janela principal permite
certificar um contexto claro, mas os demais precisam ser recusados ou marcados
como experimentais. Aceitar qualquer viewport sem contrato parece funcionar
até surgirem escala, clipping e foco. Contexto por surface representa essas
diferenças sem fazer `Dimensions` mudar de significado conforme o painel.

**Como ler o contrato aprovado:** cada raiz sabe onde está hospedada; APIs globais
continuam ligadas à janela principal, como aprovado. Medidas da surface usam
um contrato próprio. Safe area da janela não é copiada para todo painel sem
primeiro relacionar suas regiões e unidades.

**Ainda a especificar:** quais contextos entram em cada marco, origem/unidade,
transforms, notificações e foco ao transferir uma raiz ou fechar uma janela.
UI numa textura de objeto 3D exige mapear o hit do mundo para a textura; esse
caso não é automaticamente coberto por um SubViewport retangular na janela.

## SDK nativo, adapters e bibliotecas

### V2-D13

**Status:** aprovada em 2026-10-02 seguindo o modelo de integração nativa do RN,
com a adaptação Godot descrita no contrato consolidado.

**Contrato aprovado:** [V2-D13 na arquitetura consolidada](ARCHITECTURE_V2.md#v2-d13).

**Decisão:** quem registra adapters, quando o registry pode mudar e como validar
nomes, dependências e serviços exigidos pelo bundle.

- **Alternativas avaliadas:** registro antes da criação do runtime, atualização dinâmica
  ou rebuild explícito do host para mudar a configuração.
- **Validação:** dois adapters externos registram seus contratos sem recompilar
  o core; duplicação e dependência ausente falham antes de executar o app.

**Natureza:** contrato de extensibilidade; descoberta e validação são execução.

**Na prática:** alguém instala um componente de gráfico e seu adapter Godot.
Antes do bundle executar, o host precisa conhecer os componentes e módulos
fornecidos e confirmar implementação para o target selecionado.

**Consequências dos caminhos:** editar/recompilar o core para cada lib fecha o
conjunto de integrações. Registro externo anterior ao runtime permite extensões
independentes e configuração verificável. Troca dinâmica de código nativo exige
outro contrato: objetos e callbacks antigos podem usar o adapter removido.

**Como ler o contrato aprovado:** seguir descoberta/configuração e integração
nativa das dependências como no RN, com caminho de build/export próprio do Godot.
Definir seleção/versões dos adapters por geração; não congelar o registry interno
do Fabric nem proibir registro/criação sob demanda de implementações disponíveis.
Substituir o binário de um adapter exige operação compatível com o host e suas
posses, podendo exigir reiniciar o processo; reiniciar Hermes não comprova
descarregamento nativo seguro.

**Precisão em relação ao RN:** autolinking disponibiliza dependências nativas
no aplicativo através da integração no build. “Registry fixo” era uma expressão
imprecisa: o Fabric permite registrar providers sob demanda. O contrato distingue
o conjunto de adapters escolhido de suas estruturas internas de registro;
montagens/re-renders e bindings do jogo seguem seus ciclos próprios.

**Ainda a especificar:** manifesto, ordem/dependências/ciclos, duplicação, API de
registro e descoberta no editor/export. Esse registro nativo é distinto do
AppRegistry de entradas React. Uma `HealthBar` composta com componentes existentes
não precisa de adapter nem de registro para cada JSX.

### V2-D14

**Status:** aprovada na direção recomendada em 2026-10-02.

**Contrato aprovado:** [V2-D14 na arquitetura consolidada](ARCHITECTURE_V2.md#v2-d14).

**Decisão:** qual fronteira binária oferecer aos adapters e o que comprova sua
compatibilidade com o SDK carregado.

- **Alternativas avaliadas:** interface C opaca estável ou interface C++ vinculada a uma
  combinação exata de SDK, dependências e toolchain.
- **Validação:** adapter correto carrega; variante com toolchain/dependência
  incompatível é rejeitada antes de cruzar a fronteira binária.

**Natureza:** contrato público de versões e distribuição de extensões.

**Na prática:** um plugin compilado para um SDK é copiado para um projeto que
atualizou o RN. O nome do componente pode continuar igual, mas layouts de tipos,
símbolos e convenções nativas podem mudar. Abrir o arquivo não comprova que seus
objetos podem atravessar a interface.

**Consequências dos caminhos:** expor estruturas C++ do Fabric dá acesso aos
contratos existentes com dependência da combinação de build. Uma interface C
com handles opacos evita expor esse layout, mas precisa definir/versionar tudo
que atravessa a fronteira; não torna implementações RN compatíveis com toda versão.

**Como ler o contrato aprovado:** publicar uma combinação identificada de SDK,
headers, runtime e toolchain por target. O autor de TSX usa o artefato correspondente;
o autor de extensão nativa pode precisar recompilá-la ao atualizar o SDK. Isso
não implica recompilar Godot; editar somente TSX, estilos ou JavaScript não
exige recompilação nativa por esse contrato.

**Ainda a especificar:** diferenças incompatíveis, detecção anterior à chamada,
rejeição e distribuição por target. Se carregar a biblioteca executa inicializadores,
validar seu manifesto antes do carregamento é necessário; o teste posterior
não desfaz essas ações. Fingerprint verifica a combinação declarada, não substitui
certificação. Fronteira opaca continua outra proposta, não estabilidade já prometida.

### V2-D15

**Status:** aprovada na direção recomendada em 2026-10-02.

**Contrato aprovado:** [V2-D15 na arquitetura consolidada](ARCHITECTURE_V2.md#v2-d15).

**Decisão:** qual schema é fonte de props, eventos, métodos, commands e tipos,
e como gerar/atualizar os artefatos do host Godot.

- **Alternativas avaliadas:** schemas manuais próprios, specs do RN com Codegen ou uma
  combinação com extensão explícita para aspectos específicos do Godot.
- **Validação:** alterar uma spec atualiza tipos e native artifacts; schema
  incompatível ou arquivo gerado desatualizado produz erro verificável.

**Natureza:** contrato de autoria de adapters e compatibilidade de schemas.

**Na prática:** uma lib declara prop numérica, evento com payload e comando.
Se TS, bridge e C++ mantêm declarações manualmente, uma alteração pode compilar
de um lado e enviar argumentos inválidos do outro. A spec precisa ser a fonte
identificada da parte derivável desse contrato.

**Consequências dos caminhos:** schema exclusivo Godot serve a componentes
próprios, mas exige traduzir novamente specs upstream. Reaproveitar specs RN
preserva a interface da lib e permite consumir artefatos pertinentes. Isso não
gera por si só desenho, input ou operações do Godot.

**Como ler o contrato aprovado:** usar specs/Codegen RN onde cabem, acrescentando a
integração Godot. O adapter continua implementando o backend. O
[Codegen documentado pelo RN](https://reactnative.dev/docs/the-new-architecture/using-codegen)
está integrado aos builds Android/iOS; precisamos de nosso caminho de consumo e
geração, sem fingir ser um desses targets.

**Ainda a especificar:** schemas iniciais, defaults/nullability, comandos/eventos,
extensões Godot, quem gera e distribui, e gate de drift. Schema não suportado
precisa de diagnóstico, sem remoção silenciosa de campos. Aprovar Codegen não
aprova automaticamente suporte a toda lib que o utiliza.

### V2-D16

**Decisão:** o que um adapter de componente precisa implementar além de criar
um Control, incluindo state nativo, refs, comandos, eventos e medição.

- **Alternativas:** adapter reduzido por props ou contrato de componente
  completo, com capacidades opcionais declaradas por schema.
- **Recomendação:** explicitar mount/update/removal, defaults, state, eventos,
  comandos, refs e ownership de medidas. Definir interação com nós virtuais e
  flattening; montar um Control por nó React não deve ser uma premissa universal.
- **Validação:** componente externo recebe updates/remoção de props, emite
  eventos, executa comando e invalida ref; medição e pintura concordam.

**Natureza:** contrato funcional; mapeamento para Nodes é execução.

**Na prática:** um campo recebe texto controlado por React. O jogador digita e
muda seleção enquanto JS envia atualização atrasada. Criar um `LineEdit` e copiar
`value` não define ordem de updates, seleção, eventos ou comandos de foco.
Esse é um exercício de contrato, não uma garantia do campo atual.

**Consequências dos caminhos:** adapter só de props serve a um componente simples
que declare essa capacidade. Anunciá-lo como substituto completo deixa libs
falharem em refs/commands/state. Contrato completo cobre capacidades declaradas;
componentes não precisam inventar capacidades ausentes da própria spec.

**Como ler a recomendação:** descrever create/update/remove, defaults na remoção
de props, state, eventos, commands, refs e medição. O RN documenta
[eventos e métodos de TextInput](https://reactnative.dev/docs/textinput) e
[flattening de views](https://reactnative.dev/architecture/view-flattening).
Um elemento React não implica sempre um Control materializado; o host segue
árvore e transações produzidas pelo Fabric.

**Ainda a especificar:** capacidades por componente, agendamento de eventos,
coordenadas e invalidação de refs/commands. Exercitar prop removida, reordenação
de filhos e comando antigo. Print correto valida aparência de um estado, não
esse ciclo inteiro.

### V2-D17

**Decisão:** como distinguir uma biblioteca original funcionando sobre nosso
backend de uma API alternativa que apenas oferece aparência semelhante.

- **Alternativas:** executar JS/specs originais com adapter, substituir o pacote
  inteiro por facade local ou publicar uma alternativa com outro nome.
- **Recomendação:** classificar e nomear essas situações separadamente.
  Certificação de uma biblioteca original exige seu código e contratos relevantes.
  O SVG limitado atual não prova execução do pacote upstream inteiro; NativeWind
  exige validar runtime além de transforms.
- **Validação:** consumidor independente instala a versão declarada, e a prova
  identifica exatamente quais arquivos e adapters executam.

**Natureza:** produto e contrato de compatibilidade anunciado ao consumidor.

**Na prática:** um gráfico aparece, mas seu pacote JS chama uma implementação
SVG local. A prova vale para o gráfico e comportamentos exercitados; não demonstra
que outra lib com máscaras, gradientes ou outros contratos SVG funcionará.

**Consequências dos caminhos:** pacote original com backend Godot permite
reivindicar contratos certificados. Substituir todo o pacote por facade parecida
pode ser útil, mas exige outra descrição de compatibilidade. Publicar alternativa
com outro nome explicita a dependência, exigindo mudar imports do consumidor.

**Como ler a recomendação:** identificar JS original, adapter nativo e facades
substitutas na evidência. Suporte parcial pode ser declarado com versão e limites,
sem esconder um experimento útil. O objetivo continua ampliar reuso do RN original.

**Ainda a especificar:** rótulos públicos, fixtures por biblioteca e tratamento
de APIs fora do subset. Reproduzir instalação num consumidor independente evita
prova que depende de aliases internos não publicados. D15/D16 definem contrato;
D31 certifica. Esta classificação não troca paridade por semelhança visual.

## Distribuição, builder e resolução

### V2-D18

**Decisão:** quais ferramentas o addon distribui por host, como atualizá-las e
quem instala as dependências de usuário sem transformar o SDK em package manager.

- **Alternativas:** toolchain embutida, download versionado pelo addon ou Node
  externo como caminho avançado; dependências do projeto continuam do usuário.
- **Recomendação:** SDK autocontido para o fluxo básico, com versões/proveniência
  e suporte offline definidos. Separar dependências React/RN do SDK e packages
  do projeto. Instalação de bibliotecas é operação explícita, não efeito de Play.
- **Validação:** consumidor limpo inicia o exemplo básico sem Node global;
  dependência ausente tem diagnóstico; atualizar o SDK não reescreve seu lockfile.

**Natureza:** produto para instalação/offline; contrato para versões e dependências.

**Na prática:** alguém baixa o addon num computador sem Node global, abre o
exemplo e aperta Play. Em outro projeto, instala uma lib de formulário. O SDK
precisa fornecer suas ferramentas sem assumir a posse de todas as bibliotecas
que o projeto decidiu usar.

**Consequências dos caminhos:** ferramenta embutida entrega uma versão conhecida
junto do SDK, aumentando o pacote. Download versionado reduz o pacote inicial,
mas exige instalação online e um caminho offline definido. Node externo deixa
mais trabalho de preparação para o consumidor e pode servir ao fluxo avançado.
Nenhuma opção resolve sozinha instalar dependências adicionais do projeto.

**Como ler a recomendação:** fluxo básico autocontido, com React/RN e ferramentas
compatíveis sob posse do SDK. Libs do usuário têm instalação explícita, versões
e lockfile preservados. Play verifica e diagnostica; não instala silenciosamente
pacotes nem troca a versão de React escolhida para o renderer.

**Ainda a especificar:** o que vem no download, quais hosts têm ferramentas,
atualização/reversão, diretório de cache e experiência de instalação de lib.
Offline precisa distinguir exemplo já incluído de projeto com dependências
nunca baixadas. Aprovar a direção não decide embutido versus bootstrap por download;
ambos precisam cumprir a experiência básica e a política de versões.

### V2-D19

**Decisão:** contrato do builder independente: protocolo, watch, stop,
diagnósticos, caches e resolução de workspaces/symlinks.

- **Alternativas:** serviço Metro através de API/IPC ou outro builder com
  conformidade demonstrada; cache implícito ou chaves/artifact generations explícitas.
- **Recomendação:** processo separado, protocolo versionado com IDs de pedidos
  e gerações. Invalidar por fontes/grafo, lockfile, configuração e versões.
  Definir roots visíveis e resolução real de symlinks; suporte a Yarn PnP é
  escolha de escopo, não consequência automática de aceitar package.json.
- **Validação:** respostas fora de ordem, crash do builder, cancelamento,
  arquivo removido, workspace externo e mudança de Babel não ativam bundle obsoleto.

**Natureza:** execução do builder; contrato para integração e workspaces suportados.

**Na prática:** salvar arquivo dispara build 12; outro save dispara build 13.
O 13 termina primeiro. Se o 12 chegar depois e substituir a UI, o editor mostra
código antigo apesar de ter compilado a versão nova. Uma lib local via workspace
pode ainda estar fora do diretório observado e nunca invalidar o cache.

**Consequências dos caminhos:** builder no processo do editor acopla travamentos
à edição. Processo separado contém essa falha, mas precisa de pedidos/respostas,
cancelamento e encerramento explícitos. Reusar Metro mantém uma referência do
ecossistema; trocar o builder exige demonstrar os mesmos contratos necessários,
e não apenas gerar um arquivo JS.

**Como ler a recomendação:** cada resposta identifica pedido, geração e entradas
usadas. Só a geração vigente pode ser ativada; resposta atrasada é descartada
mesmo se o cancelamento não conseguiu interromper seu processamento. Cache
considera grafo, configuração, lockfile e ferramentas, além do arquivo editado.

**Ainda a especificar:** protocolo, eventos de watch, crash/restart, limites e
visibilidade real dos diretórios. Testar alterar/remover uma fonte, mudar Babel
ou o lockfile e editar lib externa. npm/pnpm/workspaces/symlinks e Yarn PnP não
são o mesmo contrato; definir a matriz de suporte sem anunciar compatibilidade
com todos os managers por reconhecer `package.json`.

### V2-D20

**Decisão:** condições de packages, `.godot`/`.native`, subpaths, imports e
aliases protegidos que garantem a mesma identidade de React.

- **Alternativas:** resolução Metro como referência ou implementação alternativa
  comparada a ela; ativar condição `godot-fabric` junto às condições aplicáveis.
- **Recomendação:** respeitar a ordem de chaves escrita pelo package author;
  não impor uma prioridade universal entre condições. Um match de `exports`
  usa o target exato, sem expansão de suffixes de plataforma. Proteger também
  `react/jsx-runtime`, dev runtime e subpaths pertinentes, incluindo workspaces.
- **Validação:** fixtures com ordem de condições invertida, import/require,
  arquivos concorrentes e React duplicado comprovam resolução e identidade.

Esse limite vem dos contratos de
[conditional exports do Node](https://nodejs.org/api/packages.html#conditional-exports)
e [package exports do Metro](https://metrobundler.dev/docs/package-exports/).

**Natureza:** contrato de resolução; identidade de React é obrigação técnica.

**Na prática:** uma lib publica caminhos distintos para RN, Godot e uso genérico.
O builder escolhe qual código o import executa. Outro risco aparece quando uma
lib local traz uma segunda cópia de React: componente e renderer podem usar
instâncias diferentes, condição associada a falhas de hooks na
[documentação do React](https://react.dev/warnings/invalid-hook-call-warning).

**Consequências dos caminhos:** seguir as condições e a ordem publicadas pela lib
preserva seu contrato. Forçar uma prioridade fixa Godot → RN → genérico pode
selecionar arquivo diferente do que o autor declarou. Resolver por suffixes
serve ao caminho que permite essa busca; não pode substituir um target exato
já selecionado em `exports`.

**Como ler a recomendação:** usar Metro como referência, declarar as condições
do host e proteger a mesma identidade React/RN pertinente ao SDK. Isso inclui
imports indiretos, JSX runtimes e libs em workspaces, não só `import React` no
arquivo de entrada. Não significa reescrever todo import privado de qualquer pacote.

**Ainda a especificar:** conjunto de condições por modo, resolução fora de
`exports`, subpaths protegidos, peer dependencies e diagnóstico de versões
incompatíveis. Resolver um pacote com a mesma versão de React escrita no lockfile
não prova identidade de módulo; a fixture precisa verificar o que executa.
A ordem/exatidão seguem [os contratos de Metro](https://metrobundler.dev/docs/package-exports/);
a escolha pendente é como aplicá-los na plataforma, não se podemos ignorá-los.

### V2-D21

**Decisão:** como combinar transforms do SDK e Babel do projeto e quais
contratos de runtime são necessários às versões suportadas de NativeWind.

- **Alternativas:** configuração gerada apenas pelo SDK ou composição com
  configuração do projeto; caminho alternativo OXC somente após conformidade.
- **Recomendação:** baseline RN obrigatória e extensão do usuário com ordem,
  caller, resolução de plugins e campos protegidos definidos. Testar NativeWind
  com métricas, tema, interação e container queries; transforms não bastam.
- **Validação:** plugin do projeto executa na ordem prevista, override proibido
  falha e estilos reagem às mudanças no runtime, incluindo remoção de classes.

**Natureza:** contrato de configuração; NativeWind funcionando é comportamento do produto.

**Na prática:** o projeto adiciona um plugin Babel e usa classes condicionais,
tema e breakpoints. O TSX pode compilar, mas a cor não muda ao alternar o tema,
ou uma classe removida continua aplicada. Isso revela lacuna de runtime mesmo
quando o transform de `className` funcionou.

**Consequências dos caminhos:** configuração fechada do SDK garante um caminho
conhecido, mas bloqueia plugins esperados por libs. Extensão sem regras permite
remover transforms que o RN precisa. Composição explícita preserva uma baseline
e oferece pontos de extensão, ordem e erros compreensíveis.

**Como ler a recomendação:** configurar transforms RN obrigatórios e extensões
do projeto com contrato verificável. O consumidor não precisa descobrir a ordem
por tentativa. NativeWind é exercitado em métricas, tema, interação e remoção,
além da compilação. Seu [design responsivo](https://www.nativewind.dev/docs/core-concepts/responsive-design)
e [container queries](https://www.nativewind.dev/docs/tailwind/plugins/container-queries)
distinguem janela de container; isso se conecta ao tema de dimensões já aprovado.

**Ainda a especificar:** versão certificada, campos extensíveis/protegidos,
resolução dos plugins, caller e ordenação. Testar também classes que mudam ao
redimensionar só um painel. Aprovar composição não promete todo plugin Babel
compatível; alternativas de transform só entram após prova, mantendo a semântica.

## Ativação, desenvolvimento e exportação

### V2-D22

**Decisão:** quando um build pode substituir a aplicação e como recuperar
falhas de avaliação JavaScript ou montagem após compilação bem-sucedida.

- **Alternativas:** reiniciar o runtime ativo com recuperação explícita ou
  preparar um candidato isolado antes da troca; rollback de artefato não garante
  rollback de efeitos já executados no jogo.
- **Recomendação:** publicar bundle/assets/maps/manifest como uma geração
  consistente e descartar respostas antigas. Falha de build preserva a execução
  atual. Escolher a política de falha de ativação separadamente; manter a UI
  anterior após qualquer erro exige isolamento comprovado dos efeitos do candidato.
- **Validação:** syntax error, throw no módulo, erro de mount e chamada ao jogo
  durante ativação verificam exatamente o que foi preservado ou reiniciado.

**Natureza:** produto para recuperação e contrato para ativação de gerações.

**Na prática:** enquanto a UI A funciona, você salva B. B pode falhar no build,
lançar ao avaliar um módulo ou falhar ao montar. São etapas diferentes. Pior:
B pode chamar uma operação do jogo antes de lançar. Restaurar o arquivo A não
desfaz essa operação aceita pelo jogo.

**Consequências dos caminhos:** reiniciar com recuperação explícita pode perder
estado local/shared da VM, mas permite especificar um fluxo honesto. Preparar
candidato isolado pode manter A até B estar pronto, desde que isole também chamadas
e outros efeitos observáveis. Um runtime escondido não é isolamento suficiente
se ele pode escrever no mesmo mundo ou em serviços externos.

**Como ler a recomendação:** build falhou, A continua. Publicar artefatos B como
conjunto consistente não autoriza sua ativação. Falhas de avaliação/mount têm
política própria, visível para o desenvolvedor; não prometer rollback universal.
A distinção permanece relevante mesmo quando D23 introduzir Fast Refresh.

**Ainda a especificar:** escolher reinício/recuperação ou candidato com restrições
comprovadas; determinar quando B ganha permissão para chamar o jogo, que estado
se perde e qual geração fica ativa depois de falhar. Testar throw no módulo e no
render, e uma chamada ao jogo antes do throw. Esse ponto pede decisão explícita:
manter a tela anterior após qualquer erro é uma garantia mais forte que preservar
a tela após erro de compilação.

### V2-D23

**Decisão:** quais mudanças permitem Fast Refresh e quais obrigam reload,
incluindo roots registrados, stores de módulo e adapters.

- **Alternativas:** reload inicial explícito ou Fast Refresh do ecossistema RN
  com runtime/transforms de desenvolvimento e limites documentados.
- **Recomendação:** integrar o mecanismo original quando seus contratos forem
  atendidos, com fallback explícito. Não prometer preservar estado após qualquer
  alteração; definir effect cleanup e relação com gerações/registro da aplicação.
- **Validação:** editar componente preserva estado quando permitido; mudança
  incompatível reinicia com diagnóstico; efeitos não duplicam listeners.

Os limites de preservação precisam seguir
[Fast Refresh do RN](https://reactnative.dev/docs/fast-refresh).

**Natureza:** produto para experiência ao salvar; contrato de preservação de estado.

**Na prática:** você está com o inventário aberto e busca preenchida. Mudar o
padding deveria permitir continuar inspecionando esse estado quando a edição
for elegível. Mudar ordem de hooks, exports ou configuração nativa pode exigir
remount/reload. Uma store no módulo tem ainda outro ciclo de reavaliação.

**Consequências dos caminhos:** reload integral inicial é previsível, com perda
de estado declarada. Fast Refresh do ecossistema preserva estado em casos
permitidos; reinjetar um bundle arbitrariamente na VM não equivale a integrar
seu protocolo. Preservar absolutamente todo estado cria uma promessa que nem o
[mecanismo documentado pelo RN](https://reactnative.dev/docs/fast-refresh) oferece.

**Como ler a recomendação:** integrar runtime/transforms de desenvolvimento
originais, com fallback visível. Preservar `useState` quando seguro, e executar
cleanup/reexecução dos effects conforme o mecanismo; não bloquear effects para
parecer que o estado foi preservado.

**Ainda a especificar:** limites por tipo de arquivo, entradas AppRegistry,
stores de módulo, múltiplas roots e ligação à geração de artefatos. Alteração
nativa de adapter não vira alteração JS elegível por ter sido observada pelo watch.
Testar listener antes/depois de cinco saves e detectar duplicação; documentar a
perda de estado de um reload e sua diferença para a falha de ativação em D22.

### V2-D24

**Decisão:** como assets JS, recursos Godot, densidades, fontes e arquivos
importados se identificam no build e no aplicativo exportado.

- **Alternativas:** caminhos diretos, registry/IDs estáveis ou manifestos que
  mapeiam os assets para recursos empacotados.
- **Recomendação:** registry e manifesto coerentes com a geração, usando o
  pipeline de recursos do Godot. Definir cache, cancelamento e erros. Não tratar
  o cache `.godot` como contrato de distribuição; distinguir bytes adicionados
  ao export de recursos que precisam ser importados/remapeados.
- **Validação:** app exportado encontra imagem/fonte sem diretório de trabalho;
  asset ausente/corrompido falha; atualização não mistura recursos de gerações.

**Natureza:** contrato de recursos; empacotamento/cache são execução.

**Na prática:** `<Image source={require("./icon.png")} />` funciona no editor,
mas o jogo exportado vai para outro computador. O caminho da fonte pode não
existir lá; imagem, dimensões, variantes de densidade e arquivo importado precisam
continuar identificados. Fonte carregada também precisa participar da medição.

**Consequências dos caminhos:** caminho local absoluto resolve um protótipo e
quebra distribuição. ID sem manifesto pode apontar para recurso errado após
rebuild. Registry/manifesto da geração relaciona a referência JS ao recurso que
foi efetivamente empacotado. O RN documenta
[assets estáticos e variantes de densidade](https://reactnative.dev/docs/images);
essas expectativas precisam de integração com recursos Godot.

**Como ler a recomendação:** resolver asset no build, incluir metadados pertinentes
e empacotar pelo pipeline apropriado. Diferenciar recursos importados de bytes
incluídos diretamente; a existência de um arquivo no cache do editor não comprova
que o export terá o recurso correspondente.

**Ainda a especificar:** identidade por geração, deduplicação, fontes/erro/cancelamento,
carregamento assíncrono e URIs remotas, que têm contrato distinto de assets locais.
Validar export em ambiente sem fontes do projeto e trocar imagem/fonte entre builds.
Definir separadamente o que pode invalidar layout após um recurso terminar de carregar.

### V2-D25

**Decisão:** como build de produção e empacotamento bloqueiam export inválido,
distinguindo o host de build e o target do aplicativo.

- **Alternativas:** preflight obrigatório, integração EditorExportPlugin ou
  pipeline headless que só inicia o export após produzir artefatos válidos.
- **Recomendação:** gates obrigatórios e manifesto por target, arquitetura,
  SDK/Hermes, adapters e hashes. Compilar bytecode com a combinação correspondente.
  Provar propagação de falhas: `_export_begin` retorna `void`, portanto não
  pressupor que um retorno booleano do plugin cancela a exportação.
- **Validação:** bundle quebrado, adapter ausente e target incompatível geram
  falha visível no editor e exit não zero no headless, sem publicar pacote inválido.

Os recursos e hooks de export devem ser verificados contra
[EditorExportPlugin](https://docs.godotengine.org/en/stable/classes/class_editorexportplugin.html).

**Natureza:** produto para exportação confiável e contrato por target.

**Na prática:** desenvolver no macOS e exportar para Windows exige binários e
adapters Windows, não copiar os do editor. Um pacote pode conter um bundle válido
e ainda faltar uma extensão ou recurso necessário. Ele precisa falhar antes da
entrega ao usuário.

**Consequências dos caminhos:** validação apenas no Play testa o host, não o
aplicativo distribuído. Preflight por target e integração ao export verificam
o conjunto real. Uma CLI externa pode garantir a ordem do próprio fluxo, mas
não prova que o botão de export do editor passa pelo mesmo bloqueio.

**Como ler a recomendação:** exigir artefatos compatíveis com target/arquitetura,
Hermes correspondente, adapters e assets identificados. O build de JS pode ocorrer
no host enquanto os binários do aplicativo pertencem ao target. A validação deve
rejeitar a combinação ausente, sem escolher por conveniência o arquivo do host.

**Ainda a especificar:** caminho canônico do export, hooks e propagação efetiva
de falha no editor e headless. A assinatura documentada de
[EditorExportPlugin](https://docs.godotengine.org/en/stable/classes/class_editorexportplugin.html)
não oferece um booleano de cancelamento em `_export_begin`; demonstrar o bloqueio,
sem deduzi-lo de uma intenção no plugin. Testar falhas deliberadas e verificar
exit não zero e ausência de pacote final novo. Relatar erro em log deixando um
pacote incompleto ser publicado não atende ao contrato.

### V2-D26

**Decisão:** política de erros de build, compatibilidade, render, callbacks,
Promises e native calls, com localização útil para desenvolvimento e CI.

- **Alternativas:** log, overlay/painel, boundary por raiz ou encerramento;
  a escolha depende da classe de falha e do modo dev/release.
- **Recomendação:** categorias e códigos explícitos, source maps da mesma
  geração e diagnóstico que identifica raiz/serviço quando aplicável. Definir
  destino de exceções assíncronas e falhas fatais; cleanup não transforma erro em sucesso.
- **Validação:** erro em TSX aponta para a fonte correta; callback lança sem
  esconder o erro; CI detecta falha mesmo quando o processo encerra normalmente.

**Natureza:** produto para diagnóstico/recuperação; contrato para classes de falha.

**Na prática:** um erro em `Inventory.tsx` deveria apontar arquivo, linha e raiz,
não apenas uma posição no bundle. Erro de render, listener que lança, Promise
rejeitada e falha fatal nativa não têm a mesma possibilidade de recuperação.
Num teste headless, sair com código zero não deveria esconder falhas registradas.

**Consequências dos caminhos:** só escrever log facilita começar, mas exige que
o usuário procure a causa e permite falso sucesso no CI. Overlay/painel com
source maps melhora diagnóstico, sem transformar todo erro em recuperável.
Boundary por raiz atende certos erros de render; não isola toda atividade de
um Hermes compartilhado, como já registrado na arquitetura.

**Como ler a recomendação:** dar destino e códigos às classes de erro, com
build/runtime/raiz/serviço identificados quando aplicável. O map precisa ser da
geração do bundle executado; combinar versões produz uma linha convincente e errada.
Separar dev e release para apresentação, preservando visibilidade da falha.

**Ainda a especificar:** o que mantém uma raiz operante, o que exige restart e
como release apresenta indisponibilidade. Definir erros tratados pela aplicação
versus não tratados, rejeições assíncronas e integração com o resultado dos testes.
Crash nativo pode impedir produzir o diagnóstico ideal; não anunciar boundary
como contenção de acesso inválido em código nativo.

### V2-D27

**Decisão:** quando shutdown terminou e o que acontece com trabalho enfileirado,
Promises nunca resolvidas, callbacks e operações já aceitas pelo jogo.

- **Alternativas:** esperar toda atividade, drenar um número fixo de turnos ou
  protocolo de encerramento com posses e limite observável.
- **Recomendação:** impedir novas entradas, desmontar raízes e concluir/cancelar
  trabalho conforme seu owner; esvaziar o trabalho controlado pelo host com limite
  explícito. Não esperar toda Promise existente nem usar uma contagem mágica
  como prova de quiescência. Invalidar gerações antes de liberar recursos nativos.
- **Validação:** shutdown com listener ativo, timer, chamada pendente e Promise
  que nunca resolve encerra sem use-after-free e informa trabalho não concluído.

**Natureza:** contrato de lifecycle; protocolo e prazo de shutdown são execução.

**Na prática:** fechar o jogo enquanto uma operação está pendente, um intervalo
está ativo e uma Promise nunca vai resolver. Esperar tudo pode impedir sair;
liberar a VM imediatamente pode permitir um callback acessar memória encerrada.
Uma ação já aceita pelo Godot tem ainda sua própria posse.

**Consequências dos caminhos:** esperar toda Promise exige controlar trabalho
arbitrário do usuário, incluindo tarefas sem fim. Rodar um número fixo de pumps
pode passar um teste sem comprovar encerramento. Um protocolo com owners define
qual trabalho é cancelado, concluído ou abandonado com resultado observável.

**Como ler a recomendação:** recusar novas entradas, desmontar roots, invalidar
referências/callbacks de gerações encerradas e drenar apenas o trabalho controlado
pelo host conforme seu contrato. Prazo de shutdown não significa liberar objetos
enquanto outro executor ainda os usa; ao vencer, a política precisa manter essa
segurança e informar trabalho que não terminou.

**Ainda a especificar:** ordem de cleanup, cancelamento do builder, timers,
queues e adapters; comportamento ao vencer o limite; e garantia de que executores
pararam de acessar a VM. Fechar uma surface não é desligar a aplicação toda.
Operação aceita pelo jogo pode concluir sem a UI original, como em D05; não
pode devolver resultado usando a ref que foi desmontada.

## Threads, tipos, plataforma e certificação

### V2-D28

**Decisão:** como dividir execução, mount e medição preservando prioridade,
segurança e semântica, e onde otimização em C++/Rust traz ganho demonstrável.

- **Alternativas:** JS e mount inicialmente na thread principal ou JS dedicado
  com medição/cache/protocolo capazes de atender as chamadas do renderer.
- **Recomendação:** contratos separados de runtime/mount executor desde já;
  otimizar a partir de profiling. Resolver acesso ao TextServer, cache e medidas
  antes de mover JS. Preservar scheduler RN; avaliar Rust em trabalho delimitado,
  sem criar outra reconciliação. Definir reentrada e chamadas síncronas sem deadlock.
- **Validação:** traces de input/layout/commit, carga de JS, misses de medição e
  cleanup mantêm semântica e acesso seguro às views; budgets são medidos.

O [modelo de threads do RN](https://reactnative.dev/architecture/threading-model)
inclui execução síncrona de render em situações prioritárias na UI thread.
Uma regra genérica de sempre enfileirar tudo precisa ser verificada contra o
renderer da versão fixada, não presumida equivalente.

**Natureza:** execução guiada por medição, com contratos de prioridade e acesso nativo.

**Na prática:** digitar num campo enquanto uma lista grande atualiza causa atraso.
Ele pode vir de trabalho JS, shaping de texto, Yoga, mount de Controls ou pintura.
Mover código para Rust sem localizar a origem pode deixar o atraso intacto.
Mover JS para worker também não autoriza modificar SceneTree dessa thread.

**Consequências dos caminhos:** começar na principal simplifica acesso ao host,
mas trabalho longo disputa frames com o jogo. JS dedicado pode reduzir essa disputa,
exigindo coordenação, prioridades e um caminho correto para medidas/comandos.
Uma fila que sempre adia tudo pode mudar observações síncronas; bloquear duas
threads esperando uma à outra cria deadlock.

**Como ler a recomendação:** separar contratos dos executores e medir os trechos.
A [arquitetura de threads do RN](https://reactnative.dev/architecture/threading-model)
reserva manipulação de host views à UI thread e descreve render síncrono para
situações prioritárias. Verificar esses caminhos no renderer fixado. Medição
precisa concordar com desenho e com os requisitos dos recursos/TextServer usados.

**Ainda a especificar:** traces e budgets por carga/target, cache de medição,
reentrada e política de chamadas síncronas. Chaves de cache precisam incluir
entradas que mudam o resultado, como constraints, fonte e escala; uma medida
rápida desatualizada não é otimização correta. C++/Rust são opções para trabalho
delimitado com ganho medido; React/Fabric continuam donos da reconciliação.
Aprovar a direção não escolhe antecipadamente uma thread ou linguagem para tudo.

### V2-D29

**Decisão:** como tipos publicados, resolução no editor e resolução do builder
descrevem a mesma API, incluindo diferenças de plataforma.

- **Alternativas:** tipos upstream completos, subset explícito ou geração
  composta das specs suportadas; caminhos de types sincronizados com o resolver.
- **Recomendação:** contrato versionado e coerente em editor/build/runtime,
  com consumidor externo compilado. Tipos não certificam props que o host ignora;
  a meta de paridade exige ampliar implementação e tipos juntos.
- **Validação:** imports resolvem para o mesmo contrato; prop suportada compila
  e executa; API ainda ausente produz diagnóstico explícito no ponto correto.

**Natureza:** contrato público de autoria e coerência de APIs.

**Na prática:** autocomplete aceita uma prop, o TypeScript compila, mas o host
a ignora. Ou o editor importa tipos de um pacote enquanto o builder executa uma
facade diferente. O consumidor perde tempo depurando uma garantia que só existia
na declaração de tipos.

**Consequências dos caminhos:** publicar tipos upstream completos sem runtime
correspondente aparenta paridade. Um subset explícito retrata o estágio atual,
mas precisa ampliar com a implementação rumo à meta. Gerar tipos das specs ajuda
coerência; ainda não prova que o backend cumpre os métodos declarados.

**Como ler a recomendação:** editor, build e execução precisam representar o
mesmo contrato versionado. APIs comuns suportadas mantêm a experiência React/RN;
extensões Godot recebem tipos próprios. O projeto consumidor não deveria depender
do `tsconfig` privado do repositório para seus imports funcionarem.

**Ainda a especificar:** exports/types conditions, versão de TS suportada,
tratamento de APIs de outros OS e diagnóstico de capacidade ausente. Não prometer
que TypeScript sozinho detecta prop dinâmica ou capability específica do target;
validar também build/runtime no nível adequado. Exercitar um caso positivo e um
negativo no consumidor externo. O subset transitório não redefine o objetivo da 1.0.

### V2-D30

**Decisão:** como representar a plataforma Godot e seu OS físico, e quem
implementa teclado, rede, acessibilidade, storage e outros serviços nativos.

- **Alternativas:** `Platform.OS = godot` com metadata/capabilities do host ou
  seleção que finja ser outra plataforma; adapters fornecem serviços específicos.
- **Recomendação:** identidade Godot explícita, com OS físico separado e
  mapeamentos documentados. Declarar capacidades aplicáveis e gaps; não anunciar
  suporte mobile porque o Godot exporta para mobile ou porque existe um nome na facade.
- **Validação:** biblioteca escolhe o caminho Godot correto; serviços observam
  o sistema real; implementação ausente falha de forma distinguível.

**Natureza:** produto para plataformas anunciadas e contrato de serviços nativos.

**Na prática:** o mesmo bundle Godot roda em Windows e Android. Uma lib pode
precisar do teclado virtual no Android ou de um módulo específico de iOS.
Compartilhar JSX não cria automaticamente esse módulo, nem transforma um Control
Godot numa view UIKit/Android esperada pelo código nativo da lib.

**Consequências dos caminhos:** fingir `Platform.OS = ios` pode selecionar um
caminho cuja implementação depende de UIKit. Identidade `godot` evita essa
promessa, mas libs que só têm branches iOS/Android precisam de caminho Godot,
adapter ou adaptação explícita. Não existe uma resposta universal para toda lib.

**Como ler a recomendação:** distinguir plataforma de UI do OS físico e suas
capabilities. Componentes React montam no Godot; serviços que dependem do sistema
devem ter implementação apropriada e contratos verificáveis. A API RN de
[código por plataforma](https://reactnative.dev/docs/platform-specific-code)
mostra que pacotes podem selecionar implementações diferentes; nossa identidade
precisa se encaixar sem simular um backend que não existe.

**Ainda a especificar:** acesso ao OS físico, capability checks e responsáveis
por rede/storage, teclado, acessibilidade, lifecycle e serviços específicos.
Certificar por target, incluindo aparelhos pertinentes; exportar um executável
não prova teclado, permissões ou integração assistiva. O rumo multiplataforma
continua, com estágios declarados e sem anunciar todos os OS pela existência do addon.

### V2-D31

**Decisão:** como afirmar compatibilidade por versão/API/plataforma/biblioteca,
definir diferenças aceitáveis e acompanhar novos React Native estáveis.

- **Alternativas:** checklist manual, fixtures locais ou certificados com
  referências originais RN e consumidores independentes.
- **Recomendação:** matriz versionada com fixtures diferenciais iOS/Android,
  traces semânticos, tolerâncias justificadas e evidência por target. Manter
  React/RN/Hermes/Yoga e configuração da biblioteca identificados. Diferenças
  requerem contrato explícito; aprovar a arquitetura não fecha o certificado.
- **Validação:** a mesma fixture roda nos hosts pertinentes, divergências são
  classificadas e upgrades invalidam os certificados que precisam de nova execução.

**Natureza:** contrato público de evidência e política de atualização.

**Na prática:** dizer “suporta React Native” pode significar que `View` aparece,
que uma versão de uma lib executa ou que um conjunto amplo de comportamentos é
pareado. Precisamos indicar o que foi executado e em qual combinação. Um scroll
visualmente parecido pode ter outra sequência de eventos ou comportamento de foco.

**Consequências dos caminhos:** checklist nominal é barato de ler, mas não
identifica lacunas de comportamento. Fixture local testa a implementação contra
suas próprias expectativas. Comparação com RN original e consumidor independente
ajuda a detectar expectativa errada ou dependência escondida do nosso repositório.
Ainda exige declarar diferenças específicas de plataforma.

**Como ler a recomendação:** fixar versões, configuração e matriz API × target
× biblioteca. Comparar semântica, lifecycle, refs, eventos e medidas pertinentes;
não exigir pixels idênticos entre sistemas com renderização/fontes diferentes.
Tolerância visual não pode justificar evento perdido ou ordem funcional errada.
Diferença precisa de justificativa e contrato.

**Ainda a especificar:** critérios mínimos de cada certificado, reexecução por
upgrade, manutenção das referências e classificação de falhas/intermitência.
Fixture positiva de um gráfico não certifica todos os componentes SVG. CI verde
também não certifica targets que não executou. Atualizar RN pode invalidar provas
mesmo sem mudar uma linha do adapter; a matriz deve tornar isso rastreável.

### V2-D32

**Decisão:** como migrar da base atual sem perder provas existentes, e quais
contratos da v2 são necessários para entregar a versão inicial 1.0 do produto.

- **Alternativas:** troca ampla do host ou fatias verticais que preservam a
  comparação; separar geração de arquitetura e número de versão publicada.
- **Recomendação:** acordar as fronteiras primeiro, migrar por cenários e
  manter fixtures atuais como regressão. Associar decisões aprovadas aos itens
  existentes do roadmap antes de criar trabalho adicional; explicitar escopo
  de alpha/beta/1.0 e gates por plataforma sem reduzir a meta por conveniência.
- **Validação:** cada fatia tem comportamento antes/depois, consumidor externo
  e evidência pertinente; múltiplas roots e comunicação são exercitadas junto à UI.

**Natureza:** produto para marcos de entrega; execução para ordem da migração.

**Na prática:** o protótipo já tem exemplos e provas. Trocar host, builder,
comunicação e extensões ao mesmo tempo dificulta descobrir qual contrato deixou
de funcionar. Uma fatia como HUD + inventário na mesma aplicação permite observar
estado local/shared, lifecycle e comunicação juntos, antes de ampliar.

**Consequências dos caminhos:** troca ampla pode eliminar rapidamente código
antigo, mas perde comparações úteis se os exemplos forem substituídos junto.
Fatias verticais mantêm o antes/depois e deixam uma sequência revisável. Manter
a base antiga temporariamente exige marcar qual host cada prova exercita; teste
verde no antigo não comprova o novo.

**Como ler a recomendação:** migrar cenários preservando regressões e rastrear
contratos nos itens existentes do roadmap. “Arquitetura 2.0” descreve a direção;
SDK 1.0 descreve uma entrega pública. Alpha/beta podem ter escopos parciais claros,
sem renomear uma entrega parcial como a paridade completa desejada.

**Ainda a especificar:** critérios de saída de cada etapa, targets, dependências
entre fatias e remoção da base antiga. A ordem concreta vem após fechar os contratos
que a condicionam. Não criar automaticamente 22 tarefas paralelas só porque há
22 decisões. D31 define a evidência; este ponto conecta essa evidência ao plano
de entrega, sem marcar itens shipped pela aprovação de documentos.

## Ordem sugerida para continuar a discussão

1. Definir comportamentos dos componentes e reuso de bibliotecas: V2-D16 a V2-D17.
   As direções de aplicação, comunicação, árvore, input, tempo, contextos, descoberta,
   compatibilidade binária e specs/Codegen de V2-D01 a V2-D15 estão aprovadas;
   seus detalhes e provas continuam na especificação e validação.
2. Definir experiência do consumidor e build: V2-D18 a V2-D21, V2-D29 e V2-D30.
3. Fechar ativação, desenvolvimento, export e encerramento: V2-D22 a V2-D27.
4. Fechar execução/performance, certificação e migração: V2-D28, V2-D31 e V2-D32;
   seus requisitos devem orientar as etapas anteriores desde o início.

Essa sequência é recomendação de discussão. As decisões de V2-D16 em diante,
a implementação e suas prioridades finais continuam em aberto.
