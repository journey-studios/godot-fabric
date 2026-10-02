# Godot Fabric — Registro de decisões da arquitetura 2.0

**Status:** 10 decisões aprovadas (V2-D01 a V2-D10) e 22 pendentes (V2-D11 a V2-D32).

**Data:** 2026-10-02.

Este documento complementa a [direção da arquitetura 2.0](ARCHITECTURE_V2.md).
Ele detalha os contratos ainda necessários, incluindo lacunas da proposta de
migração e pontos deixados abertos nos temas discutidos.

As recomendações de V2-D01 a V2-D10 foram aprovadas em 2026-10-02. Seus contratos
estão consolidados na arquitetura principal; as alternativas dessas entradas
ficam como histórico da escolha. V2-D11 a V2-D32 continuam como propostas.
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
| [V2-D11](#v2-d11) | Pausa do jogo, background e relógios da UI | Pendente |
| [V2-D12](#v2-d12) | Janelas, SubViewports e contexto de métricas | Pendente |
| [V2-D13](#v2-d13) | Registro e descoberta de adapters | Pendente |
| [V2-D14](#v2-d14) | Compatibilidade binária do SDK e dos adapters | Pendente |
| [V2-D15](#v2-d15) | Schemas, Codegen e artefatos gerados | Pendente |
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

**Decisão:** o que pausa ao pausar o jogo, ocultar UI ou colocar o aplicativo em
background, e qual relógio alimenta timers, RAF e animações.

- **Alternativas:** UI acompanha o tempo do jogo, usa tempo real ou recebe uma
  política explícita separada para cada situação.
- **Recomendação:** timers públicos usam tempo real monotônico; pausa da
  simulação não bloqueia o menu. Tempo de jogo é dado explícito do projeto.
  Definir background/resume e `AppState` sem confundir visibilidade da surface
  com estado do aplicativo; ocultar continua preservando effects como já decidido.
- **Validação:** menu funciona durante pausa; alterar velocidade da simulação
  não muda timers públicos; retomada tem política clara para callbacks atrasados.

### V2-D12

**Decisão:** como associar raiz, Window e SubViewport e expressar medidas,
coordenadas, safe areas e foco fora da janela principal.

- **Alternativas:** escopo inicial limitado à janela principal ou contexto de
  surface que também suporte outras janelas/viewports com diferenças declaradas.
- **Recomendação:** registrar a associação desde o início, mantendo as métricas
  globais na janela principal. Definir contrato do helper de surface, unidades
  e conversões para medições/input; suporte adicional só com casos certificados.
- **Validação:** dois painéis, viewport escalado e janela secundária têm medidas
  e hit testing coerentes; APIs globais mantêm o significado já aprovado.

## SDK nativo, adapters e bibliotecas

### V2-D13

**Decisão:** quem registra adapters, quando o registry pode mudar e como validar
nomes, dependências e serviços exigidos pelo bundle.

- **Alternativas:** registro antes da criação do runtime, atualização dinâmica
  ou rebuild explícito do host para mudar a configuração.
- **Recomendação:** registro determinístico antes do runtime e configuração
  congelada por geração. Manifesto declara componentes/módulos/capabilities;
  colisões e dependências ausentes impedem ativação. Definir registro por
  GDExtension independente e sua descoberta pelo editor/export.
- **Validação:** dois adapters externos registram seus contratos sem recompilar
  o core; duplicação e dependência ausente falham antes de executar o app.

### V2-D14

**Decisão:** qual fronteira binária oferecer aos adapters e o que comprova sua
compatibilidade com o SDK carregado.

- **Alternativas:** interface C opaca estável ou interface C++ vinculada a uma
  combinação exata de SDK, dependências e toolchain.
- **Recomendação:** começar com compatibilidade exata e artefatos/header sets
  identificados, se a fronteira expuser tipos C++ do RN. Uma ABI opaca pode ser
  uma evolução separada. Semver e `adapterAbi` sozinhos não certificam essa
  combinação; definir fingerprint, target, arquitetura, runtime e carregamento.
- **Validação:** adapter correto carrega; variante com toolchain/dependência
  incompatível é rejeitada antes de cruzar a fronteira binária.

### V2-D15

**Decisão:** qual schema é fonte de props, eventos, métodos, commands e tipos,
e como gerar/atualizar os artefatos do host Godot.

- **Alternativas:** schemas manuais próprios, specs do RN com Codegen ou uma
  combinação com extensão explícita para aspectos específicos do Godot.
- **Recomendação:** preservar specs/Codegen do RN onde aplicáveis e definir a
  geração para Godot. Código derivado tem versão/proveniência e verificação de
  atualização; registro manual não substitui os contratos completos.
- **Validação:** alterar uma spec atualiza tipos e native artifacts; schema
  incompatível ou arquivo gerado desatualizado produz erro verificável.

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

## Ordem sugerida para continuar a discussão

1. Definir pausa, relógios e contextos adicionais: V2-D11/V2-D12. As direções de
   aplicação, comunicação, árvore e input de V2-D01 a V2-D10 já estão aprovadas.
2. Definir extensibilidade e fronteira binária: V2-D13 a V2-D17.
3. Definir experiência do consumidor e build: V2-D18 a V2-D21, V2-D29 e V2-D30.
4. Fechar ativação, desenvolvimento, export e encerramento: V2-D22 a V2-D27.
5. Fechar execução/performance, certificação e migração: V2-D28, V2-D31 e V2-D32;
   seus requisitos devem orientar as etapas anteriores desde o início.

Essa sequência é recomendação de discussão. As decisões de V2-D11 em diante,
a implementação e suas prioridades finais continuam em aberto.
