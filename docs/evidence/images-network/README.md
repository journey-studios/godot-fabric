# Imagens de rede: o carregador de imagens do RN sobre o transporte HTTP do host

Esta fatia faz o `Image` público carregar fontes `http` e `https`, com `headers`, `method`, `body`
e `cache`, e faz `Image.prefetch`, `Image.prefetchWithMetadata`, `Image.queryCache`,
`Image.getSize` e `Image.getSizeWithHeaders` valerem para elas. Antes, uma fonte de rede falhava
por `onError` nomeando a fatia futura, o `prefetch` rejeitava, o `queryCache` respondia `{}` e o
wrapper recusava as chaves `headers`, `method`, `body` e `cache`. Agora o `ImageLoader` tem o
próprio `HttpTransport` (o mesmo `make_godot_http_transport` do Networking, com as mesmas
autoridades confiáveis e o mesmo relógio, mas outra instância), baixa no máximo quatro imagens ao
mesmo tempo e julga cada resultado como o `RCTImageLoader` julga; os bytes baixados seguem o mesmo
caminho do pool de threads da primeira fatia (leitura do formato, cabeçalho, limites, decodificação
e redução). Dois caches em memória decidem de onde sai a imagem: o decodificado, no papel do
`RCTImageCache`, e o de bytes, no papel do `NSURLCache`. O [recibo](report.json) fixa fontes,
hashes e resultados, executados na implementação
[`6bbd036`](https://github.com/journey-studios/godot-fabric/commit/6bbd03665b0b2136f0eabe58a540cbf4394215ee).

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `42584494` (main `6d02746`), mesmo bundle | 7/37 | Só 37 checks são alcançáveis lá: passam os 7 que não dependem da rede e falham exatamente os 30 normativos que dependem; os outros 27 normativos não são executados |
| Sabotagem retida: a rota consulta o cache decodificado mesmo com `reload`, host `6fd2f8c8` | 71/72 | 1 falha, e o oráculo independente rejeita o relatório |
| Sabotagem retida: o download abandonado não fecha o pedido no transporte, host `6e13ea1c` | 40/72 | 32 falhas, e o oráculo independente rejeita o relatório |
| Sabotagem retida: o Image com `repeat` redimensiona a textura compartilhada, host `0f09f7bc` | 70/72 | 2 falhas, e o oráculo independente rejeita o relatório |
| Host atual `034bc08d`, headless | 72/72 | Frames reais do SceneTree, 24 Images de rede declaradas, 100 operações de cache e o oráculo independente sobre o relatório |

```sh
npm run test:images-network
```

A suíte nova tem 72 checks, 64 normativos (os que dependem do carregamento de rede) e 8
estruturais. O mesmo bundle, de SHA-256 `1b8c5343…`, rodou em todas as lanes.

## O que o RN faz

Do lado C++, o `ImageShadowNode` e o `ImageRequest` já decidem quando uma imagem é pedida; o que
muda para a rede está no que o gerenciador iOS faz com a fonte. O `RCTImageManager` monta um
`NSURLRequest` da fonte (`NSURLRequestFromImageSource`): o método é `GET` ou o da fonte, em
maiúsculas; cada cabeçalho entra por `setValue:forHTTPHeaderField:`, então o último valor de um nome
(sem distinguir caixa) vale; o corpo vale para qualquer método; e `cache` vira a política do
`NSURLRequest` (`reload` ignora o cache local, `force-cache` devolve o que houver, `only-if-cached`
nunca vai à rede). Quem entrega o resultado é o `RCTImageLoader`: um pedido sem loader de URL
específico passa pelo `RCTNetworking`, com no máximo quatro tarefas (`maxConcurrentLoadingTasks`),
consulta o `RCTImageCache` antes (exceto em `reload`) e guarda a imagem decodificada depois. Um
corpo vazio falha com `Unknown image download error`, um status diferente de 200 com
`Failed to load <URL final>` e o status como código, e os dois chegam ao loader com a resposta. O
`RCTImageCache` usa a chave `url|largura|altura|escala|modo` escrita com `%g`, não guarda imagem de
mais de 2 MiB, limita-se a 20 MiB, e calcula quando a entrada envelhece pelo `Cache-Control`
(`no-cache`, `no-store` e `max-age=0` proíbem guardar; `max-age=N` vale a partir do `Date`), depois
pelo `Expires`, depois por um décimo do tempo entre `Last-Modified` e `Date`. O `queryCache` pergunta
ao `NSURLCache` compartilhado, o `prefetch` carrega como um pedido sem tamanho, e `getSize` baixa e
lê só o cabeçalho. O progresso é o `loaded` e o `total` do `RCTNetworkTask`, e o
`RCTImageComponentView` lê o código e os cabeçalhos da resposta de uma falha das chaves
`httpStatusCode` e `httpResponseHeaders` do `userInfo`, que o `RCTImageLoader` preenche
(`addResponseHeadersToError`). As referências com linha estão na
[nota de pesquisa](../../research/images.md).

## O que este host fazia

A primeira fatia classificava a URI `http(s)` e falhava `onError` com o nome da fatia futura; o
`prefetch` rejeitava com `E_PREFETCH_FAILURE: this host has no image cache yet`; o `queryCache`
respondia `{}`; `getSize` e `getSizeWithHeaders` de uma URL de rede rejeitavam; o wrapper recusava
`headers`, `method`, `body` e `cache` nas fontes e `crossOrigin` e `referrerPolicy` na Image; e um
`repeat` ladrilhava num tamanho inteiro de pontos, redimensionando a textura da própria Image. O
host anterior ainda faz tudo isso: o mesmo bundle falha nele em cada Image de rede, e a lane de
controle mostra quais checks dependem da rede.

## A implementação

1. O [contrato do wrapper](https://github.com/journey-studios/godot-fabric/blob/6bbd03665b0b2136f0eabe58a540cbf4394215ee/src/image-contract.mjs)
   deixa de recusar `headers`, `method`, `body` e `cache` nas fontes e `crossOrigin` e
   `referrerPolicy` na Image (o `ImageSourceUtils` do RN transforma os dois últimos em cabeçalhos do
   pedido); o resto da recusa continua como estava.
2. O [`ImageNetwork`](https://github.com/journey-studios/godot-fabric/blob/6bbd03665b0b2136f0eabe58a540cbf4394215ee/native/image_network.cpp)
   monta o pedido como o `NSURLRequestFromImageSource` (e valida com `http::valid_header_name` e
   `http::valid_header_value` o que o transporte escreveria na rede), enfileira os downloads em
   ordem de chegada, roda no máximo quatro e os julga como o `RCTImageLoader`. Os listeners do
   transporte só gravam na estrutura do download; cancelar (um download que ninguém quer mais),
   os limites de tamanho e de ociosidade, o progresso e o resultado acontecem no `poll()`, depois
   que o `poll` do transporte retornou, porque cancelar dentro de um listener é um uso depois da
   liberação no `godot_http_transport.cpp`. O `stop()` para o transporte primeiro, de modo que nenhum
   listener roda depois, e esquece os downloads sem avisar ninguém.
3. O [`image_cache.h`](https://github.com/journey-studios/godot-fabric/blob/6bbd03665b0b2136f0eabe58a540cbf4394215ee/native/image_cache.h)
   reúne o que não depende de Godot: o formato único de data HTTP que o formatador do
   `RCTImageCache` lê, o `integerValue` do `NSString`, a regra de validade (`response_freshness`), a
   chave do cache decodificado, a decisão `route()` (decodificada, bytes em cache, download ou falha
   por `only-if-cached`) e o `ExpiringLru`, um armazém limitado em bytes que descarta o menos
   recente. A decisão consulta cada cache só quando precisa, porque uma consulta move a entrada para
   a frente.
4. O [`ImageSources`](https://github.com/journey-studios/godot-fabric/blob/6bbd03665b0b2136f0eabe58a540cbf4394215ee/native/image_sources.cpp)
   é dono do `ImageNetwork` e dos dois caches e roda o ciclo de vida de um pedido de rede: monta o
   pedido, consulta `route()`, entrega a imagem do cache decodificado ou os bytes do cache de bytes,
   ou enfileira o download, e guarda no cache de bytes a resposta 200 de um `GET` sem corpo que o
   `Cache-Control` permite (no máximo 1 MiB por entrada e 20 MiB no total). O cache decodificado
   guarda só o resultado de uma Image (um `prefetch` e um `getSize` não guardam a imagem
   decodificada), nunca em `reload` e nunca de uma resposta que proíbe guardar.
5. O [`ImageLoader`](https://github.com/journey-studios/godot-fabric/blob/6bbd03665b0b2136f0eabe58a540cbf4394215ee/native/image_loader.cpp)
   passa os bytes baixados pelo mesmo pipeline do pool de threads da primeira fatia: o sniff, a
   leitura do cabeçalho, os limites, a decodificação e a redução (os bytes de rede são dados não
   confiáveis, então as checagens de cabeçalho seguem obrigatórias) e nunca lê, mede ou decodifica na
   thread principal. Uma imagem vinda do cache decodificado não usa o pool nem cria textura nova: a
   textura é a mesma de quem a pediu antes. O `Job::release()` solta os bytes e a imagem quando o
   pedido acaba, porque a função de cancelamento do pedido retinha o job e uma textura vazava.
   `prefetch` baixa e confere, fora da thread principal, que os bytes são uma imagem, e fica só no
   cache de bytes; `getSize` baixa (ou usa o cache de bytes) e lê o cabeçalho fora da thread
   principal.
6. O [`GodotImage`](https://github.com/journey-studios/godot-fabric/blob/6bbd03665b0b2136f0eabe58a540cbf4394215ee/native/image_view.cpp)
   deixa de redimensionar a textura em `repeat`: ladrilha no tamanho da imagem em pontos, exatamente
   (fracionário também), com uma transformação sob o desenho, porque o cache decodificado entrega a
   mesma textura a toda Image da imagem e nenhuma pode mudá-la. A falha de uma Image preenche
   `responseCode` e `httpResponseHeaders`, que o emissor do RN só envia quando existem.
7. O [módulo `ImageLoader`](https://github.com/journey-studios/godot-fabric/blob/6bbd03665b0b2136f0eabe58a540cbf4394215ee/native/image_loader_module.cpp)
   responde `prefetchImage` e `prefetchImageWithMetadata` (verdadeiro, ou `E_PREFETCH_FAILURE` com
   o texto da falha), `queryCache` (`"memory"` para uma URL no cache de bytes, nada para o resto) e
   `getSize` e `getSizeWithHeaders` de uma URL de rede (as formas de resultado do iOS e
   `E_GET_SIZE_FAILURE`).
8. O `AppLifecycle` ganhou `on_memory_warning`, uma lista de ouvintes do aviso de memória do sistema
   que roda antes de o JS ser avisado; o `application_runtime.cpp` registra nela a limpeza dos dois
   caches e liga o loader ao transporte, ao relógio e ao deslocamento do relógio de validação (o
   `validation_clock_offset_ms`, que move o tempo monotônico e o de parede sem dormir).

## Padrões e desvios

A [nota de pesquisa](../../research/images.md) lista cada desvio do RN com a referência de linha. Os
que mudam o que se vê ou o que se mede (os que dependem do comportamento interno do `NSURLSession` e do
`NSURLCache`, como o progresso de uma resposta em cache, o que o cache guarda, a revalidação e a oferta de
`gzip`, vêm da documentação da Apple e do código do RN, e nenhum foi comparado num aparelho iOS):

- **Progresso.** O host entrega no máximo um evento por pedido a cada pump, com o acumulado; o iOS
  entrega um por pedaço de dados. Uma imagem que vem de um dos dois caches não informa progresso; no
  iOS o `NSURLSession` entrega o corpo em cache como dados, e o bloco de progresso o conta.
- **Redirecionamentos.** O host mantém os cabeçalhos da fonte no redirecionamento (o transporte só
  retira um `Authorization` que passaria para outra origem); o `willPerformHTTPRedirection` do iOS
  troca os cabeçalhos do pedido seguinte pelos dos cookies, então um cabeçalho do app se perde lá.
- **O que o cache de bytes guarda.** Só a resposta 200 final, sob a URL pedida; o `NSURLCache` guarda
  também os redirecionamentos. Uma entrada velha é baixada de novo, nunca revalidada (nenhum
  `If-None-Match`, nenhum 304), e `Vary`, `Set-Cookie` e `Authorization` não são considerados ao
  guardar. O cache é do próprio host: 20 MiB em memória, nenhuma entrada acima de 1 MiB, só `GET` sem
  corpo, uma resposta sem `Date` legível é datada pela hora em que chegou e `queryCache` responde
  `memory` ou nada, nunca `disk`.
- **`prefetch` e `getSize`.** O `prefetch` guarda só os bytes; o `RCTImageLoader` guarda também a imagem
  decodificada sob a chave de tamanho 0x0 e escala 1, que nenhuma view pede, e o host não. O `getSize` não
  consulta o cache decodificado. O `prefetch` também aceita fontes locais, que resolvem sem pedido.
- **Textos de falha.** Um erro de transporte tem o texto do host (`Failed to connect to 127.0.0.1:N`,
  `unexpected end of stream from H:N`, `The request timed out.`), não o de `NSError`; a mensagem de um
  cabeçalho ou método inválido também é do host e a falha ocorre antes de qualquer pedido. O status e os
  cabeçalhos que acompanham uma falha são os do `RCTImageLoader`, e o `responseCode` e o
  `httpResponseHeaders` do `onError` do host correspondem ao iOS: o `RCTImageLoader` põe o status e os
  cabeçalhos da resposta no `userInfo` do erro (`addResponseHeadersToError`, `RCTImageLoader.mm:37-46`,
  aplicado em 576-579 a todo erro que chega com um `NSHTTPURLResponse` quando a conclusão não roda na fila
  principal, que é o caminho normal da rede) e o `RCTImageComponentView.mm:195-205` os leva ao `onError`.
  A única conclusão que não os recebe é a entregue na fila principal com dados (567-574), que não é a de um
  download.
- **Protocolo.** Nenhum cookie, nenhuma compressão oferecida (o iOS oferece `gzip` e a decodifica),
  HTTP/1.1 apenas, e `http` em claro é permitido (não há App Transport Security).
- **Limites do host.** Uma resposta acima de 128 MiB é recusada (pelo `Content-Length` ou conforme
  chega) e um download sem bytes por 60 s falha com `The request timed out.`: o loader do RN limita a
  concorrência, não o tamanho de uma resposta, e 60 s é o tempo limite padrão do `NSURLSession`, lido
  como ociosidade. O limite de quatro downloads é exato; o `dequeueTasks` do iOS decrementa
  `_activeTasks` também para uma tarefa cancelada que nunca começou, e o iOS pode passar de quatro
  depois disso.
- **`repeat`.** Ladrilha no tamanho exato da imagem em pontos; o limite de tamanho inteiro da primeira
  fatia acabou.
- **Memória.** O aviso de memória do sistema esvazia os dois caches pelo `AppLifecycle`; o
  `RCTImageCache` também esvazia quando o app deixa de estar ativo, e o host não.

## O que foi verificado

Uma aplicação Hermes, 24 Images de rede declaradas, os estágios que seguram downloads no servidor e as
100 operações de cache sobre um servidor Node em loopback (HTTP em duas origens e HTTPS com uma
autoridade de teste), e 72 checks, 64 deles normativos e 8 estruturais:

- **Carregamento.** PNG, JPEG, SVG e um PNG largo por `http` e `https`, com redirecionamentos 302 e 307
  (este para outra origem) e corpo em pedaços, chegam nos tamanhos dos cabeçalhos; os pixels
  decodificados de um PNG baixado são os do arquivo; a imagem baixada é desenhada como qualquer outra
  (40×20 pixels são 20×10 pontos na escala 2, e `cover` a recorta no quadro de 60×60); e `onLoad`
  informa a URI que a fonte pediu, também depois do redirecionamento.
- **Pedido.** O método (em maiúsculas), os cabeçalhos e o corpo chegam ao servidor como declarados, um
  corpo vai com qualquer método, `crossOrigin` e `referrerPolicy` viram os cabeçalhos que o `Image` do RN
  dá a eles, um redirecionamento a outra origem mantém os cabeçalhos da fonte e retira o `Authorization`,
  e uma fonte simples é um `GET` sem cookies e sem compressão oferecida.
- **Falhas.** Um status diferente de 200 falha com `Failed to load <URL>`, o código e os cabeçalhos
  (repetidos juntados); depois de um redirecionamento a falha nomeia a URL final; um corpo vazio falha com
  `Unknown image download error`, com o código e os cabeçalhos, qualquer que seja o status; um 200 que
  não é imagem falha só com o erro de decodificação; uma conexão recusada ou perdida antes da resposta
  falha com a mensagem do transporte e sem código; uma conexão perdida no corpo falha com a mensagem, o
  200 e os cabeçalhos que vieram; um 301 que leva a um 404 falha nomeando a URL final; um cabeçalho que a
  rede não carrega e um método que o transporte não envia falham por `onError` sem que nada chegue ao
  servidor; `only-if-cached` sem nada em cache falha nomeando a política, sem pedido; e a Image que
  falhou termina com `error` e `loadEnd`, sem textura.
- **Progresso.** É cumulativo, os bytes até agora sobre o `Content-Length`, e termina no corpo todo; um
  corpo em pedaços não tem total (`-1`) e a fração é negativa; enquanto só parte do corpo chegou a Image
  informa o parcial e ainda não carregou. Nenhum check conta eventos.
- **Threads.** Os bytes de cada imagem baixada foram lidos, medidos e decodificados numa thread de
  worker, de identidade diferente da principal, e toda tarefa entregue pelo pool foi aguardada.
- **Concorrência.** O servidor segura os quatro primeiros pedidos e o loader enfileira os outros dois;
  um download que acaba abre vaga para o próximo da fila e para nenhum outro; as seis imagens carregam ao
  serem soltas e nunca houve mais de quatro ativas; e um download desmontado na fila nunca começa (o
  servidor nunca o vê e o loader o conta como abandonado).
- **Cancelamento.** Desmontar uma Image no meio do download, antes ou depois do cabeçalho, fecha o pedido
  (o servidor vê o cliente sair e o transporte conta o cancelamento) e não entrega nada ao JS nem cria
  textura; trocar a fonte no meio fecha o pedido antigo e só o novo carrega.
- **Limites.** Uma resposta acima do limite é recusada, anunciada pelo `Content-Length` ou descoberta
  conforme chega, com a resposta que veio; uma resposta do tamanho exato do limite é aceita (falha depois,
  porque os bytes não são uma imagem) e restaurar o limite padrão aceita a maior; um download sem bytes
  pelo tempo ocioso falha com a mensagem do tempo limite, com a resposta se o cabeçalho tinha chegado, e o
  servidor vê o cliente sair. O tempo ocioso corre pelo deslocamento do relógio de validação, nunca por
  uma espera.
- **Cache decodificado.** Uma segunda Image da mesma URL, tamanho e escala sai do cache decodificado, sem
  pedido nem progresso, e as duas partilham uma imagem; outro tamanho é outra imagem, e o cache de bytes
  responde sem pedido; `reload` ignora os dois caches e pergunta ao servidor, deixando a decodificada onde
  estava, e não guarda a imagem decodificada, mas guarda a resposta; uma resposta que proíbe guardar
  (`no-store`, `no-cache`, `max-age=0`) não fica em nenhum dos dois; nenhuma imagem acima de 2 MiB fica (uma de
  900×600 é decodificada de novo, uma de 800×655 fica); e aos 20 MiB sai a menos recente (a primeira de
  onze volta a ser decodificada dos bytes, a última continua e pedir a primeira expulsou a seguinte).
- **Validade.** Pelo relógio de validação, uma imagem em cache é servida enquanto fresca e carregada de
  novo depois de velha: `max-age` depois dos seus segundos, `Expires` na data, um décimo do tempo desde o
  `Last-Modified` na heurística, e nunca sem nenhum dos três; `force-cache` e `only-if-cached` servem uma
  resposta velha do cache de bytes (a imagem decodificada dela já nasce velha e não fica) e a política
  padrão pergunta ao servidor. Cada tempo de validade fica a mais de 20 s do relógio dos estágios, de modo
  que a lane não depende do ritmo da máquina.
- **Cache de bytes.** Uma resposta de menos de 1 MiB é baixada, decodificada para conferir que é uma
  imagem e guardada; aos 20 MiB sai a menos recente (a primeira de 21), e nenhuma entrada acima de 1 MiB
  fica; uma resposta acima do limite de uma entrada ainda é um `prefetch` bem-sucedido, mas é baixada de
  novo na vez seguinte.
- **Textura compartilhada.** Duas Images de uma imagem em cache partilham uma só textura; nenhuma muda a
  textura que partilham (as duas leem os 40×20 pixels da imagem, embora uma ladrilhe); cada uma desenha o
  próprio tamanho (uma recorta para cobrir o quadro, a outra ladrilha em 20×10 pontos); e trocar os
  modos das duas muda o que cada uma desenha e nunca a textura.
- **API estática.** `Image.prefetch` baixa para o cache de bytes e resolve verdadeiro, e `queryCache`
  informa exatamente a URL que ele guarda, como `memory`; depois de um `prefetch`, uma Image `only-if-cached`
  carrega sem pedido e uma `force-cache` seguinte sai da imagem decodificada; `prefetchWithMetadata`
  resolve verdadeiro, um `prefetch` que falha rejeita com `E_PREFETCH_FAILURE` e o texto da falha (um status,
  um corpo que não decodifica) e uma fonte local resolve; `getSize` e `getSizeWithHeaders` baixam (ou usam o
  cache de bytes), leem o tamanho do cabeçalho fora da thread principal, mandam os cabeçalhos e não
  decodificam nada; um tamanho que não pode ser baixado rejeita com `E_GET_SIZE_FAILURE` e o texto da
  falha, com a mensagem do iOS de cada um dos dois métodos; e `queryCache` não informa nada para um
  download que falhou nem para uma fonte que não é de rede.
- **Memória.** O aviso de memória do sistema esvazia os dois caches, as imagens decodificadas e as
  respostas baixadas; depois dele `queryCache` não acha nada e a Image seguinte pergunta ao servidor.
- **Parada.** Com uma decodificação e quatro downloads em andamento e um quinto esperando vaga, parar a
  aplicação encerra todos: todo contador do loader e do transporte volta a zero, toda tarefa foi
  aguardada e nenhuma imagem nem resposta fica; o servidor viu cada pedido iniciado fechado pelo cliente e
  nunca viu o que esperava; e nada chegou ao JS depois da parada.

Nenhum check fixa uma contagem que dependa de ritmo de quadros, de tempo ou de como o transporte
segmentou os bytes: as esperas são por estado, o servidor segura as respostas até uma requisição de
controle soltá-las, o relógio se move por deslocamento, e as cotas (no máximo 4 ativos, margem de 20 s)
vêm de limites com motivo. Na execução registrada o servidor viu 111 requisições (109 em HTTP, 1 em
HTTPS e 1 na outra origem) e o loader gravou 133 jobs, 97 deles em threads de worker de 11 identidades
(nenhum na principal), servidos 106 pela rede, 14 pelo cache decodificado e 9 pelo de bytes, 3 recusados
antes de qualquer fonte (um cabeçalho inválido e dois `only-if-cached` sem nada em cache) e 1 `prefetch` de
fonte local; as 100 operações percorreram 56 URLs. Os contadores do loader na parada eram 105 pedidos de
Image (75 carregados, 20 falhos, 4 cancelados, 0 descartados e 6 ainda em andamento ou esperando), 28 `prefetch`, 6
medidas, 98 tarefas iniciadas e 98 aguardadas, 112 downloads, 14 acertos decodificados, 9 acertos de bytes,
2 limpezas de cache, no máximo 4 ao mesmo tempo e 61 texturas criadas; a rede contava 109 iniciados, 4
abandonados, 2 abortados por ociosidade, 2 abortados por tamanho e 123 eventos de progresso, e o
transporte 109 iniciados, 96 completos, 3 falhos, 10 cancelados, 3 redirecionamentos e 36.408.736 bytes. Antes
da parada havia 1 decodificação segurada no portão e 5 downloads (4 ativos e 1 na fila); os avisos de
memória acharam 19 imagens decodificadas e 22 respostas, depois 10 e 20. Esses números são observações
desta execução.

O runner roda os testes C++ antes da lane atual: `image_cache_test` (7 grupos, 66 asserções), `image_network_test`
(10 grupos, 60 asserções) e `image_core_test` (7 grupos, 70 asserções).

## Controles

O host anterior foi preservado e roda o mesmo bundle. Como ele recusa toda fonte de rede, a sonda só
executa os estágios que independem do que o loader da rede segura: 37 checks, dos quais os 7 que não
dependem da rede passam e os 30 que dependem falham (a rede carregando, o progresso, os redirecionamentos,
o pedido, as falhas, as threads, a memória e a API estática). Os outros 27 checks normativos não são
executados nesse host, o que o recibo registra. O oráculo aceita o relatório em modo original: as falhas
são exatamente as normativas entre as que a sonda rodou, cada Image de rede declarada falha com a recusa
do host anterior e o servidor não viu requisição nenhuma.

As três sabotagens retidas quebram um comportamento cada e o oráculo rejeita as três. Na primeira, a rota
consulta o cache decodificado mesmo para um pedido que pede `reload` (uma linha em `native/image_cache.h`):
1 check falha, o do `reload`, e o oráculo rejeita a operação `c1-reload` (de onde saiu a imagem). Na
segunda, o `ImageNetwork` não manda o transporte fechar o pedido de um download que ninguém quer mais
(`native/image_network.cpp`): 32 checks falham, todos a partir do primeiro cancelamento (o próprio
cancelamento e a troca de fonte, os limites, os caches, a textura compartilhada, a API estática, a memória
e a parada: o servidor não vê o cliente sair), e o oráculo rejeita no primeiro Image que não termina em
`loadEnd` (`expires-1`). Na terceira, uma Image com `repeat` redimensiona a textura que o cache entrega a
todas (`native/image_view.cpp`): 2 checks falham, e o oráculo rejeita a leitura dos pixels da textura
compartilhada. As fontes foram restauradas byte a byte
(os três SHA-256 de antes e de depois conferem) e o rebuild reproduziu o host `034bc08d`.

O oráculo também recusa 27 mutações do relatório genuíno, cada uma pelo motivo que o dano nomeia (o
progresso, a fração de um comprimento desconhecido, o código e os cabeçalhos de uma falha, o corpo vazio, a
textura nunca redimensionada, o método, os cookies, o pedido fechado pelo cancelamento, o servidor que
segura cada download, de onde saiu a imagem em cinco operações do modelo de cache, o que `queryCache` informa, a
ordem do LRU dos bytes, o que os caches guardavam no aviso de memória, a thread de worker e a principal, a
textura viva, o download vivo, o JS depois da parada, os quatro ao mesmo tempo, o limite de tamanho e a
textura compartilhada).

## Capturas

O exemplo interativo [`images`](../../../examples/images/README.md) abre no launcher com
`npm run example -- images`, e `npm run example -- images --capture` salva dois quadros do renderizador
nativo, de 1800 × 1676 pixels (900 × 838 pontos na escala de conteúdo 2), enquanto a validação dele
clica de verdade e lê cada imagem na `GodotImage` que a mostra, no que o JS observou e, com o
renderizador, em pontos do quadro (22 checks headless, 30 com o renderizador). O exemplo inclui agora um
servidor HTTP de loopback em GDScript que a cena sobe e consulta a cada quadro. O recibo registra o
caminho, o SHA-256 e as dimensões de cada quadro, e os bytes se repetiram em duas execuções.

![As imagens do exemplo, a linha de rede e o preview em cover](images-network-all-modes.png)

**As fontes e a linha de rede.** Os seis modos de uma paisagem de 120×60 pontos, o logo do arquivo `@2x`,
o sprite e o SVG de `data:`, o `ImageBackground` e o arquivo ausente continuam como na primeira fatia. A
linha nova tem três cartões: `Network PNG`, o PNG que o servidor do exemplo desenha, baixado e
decodificado como 192×128 pixels no quadro de 96×64 pontos (`loaded 192x128 px`); `Remount`, que guarda
um botão `Mount again` e diz `not mounted`; e `HTTP error`, o 404 do servidor, uma caixa vermelha escura
com `HTTP 404` no cartão. O preview está em `cover` e diz `loaded 240x120 px`.

![O preview depois dos cliques, com a imagem montada de novo](images-network-remount.png)

**Depois dos cliques.** Nove cliques reais em `Next mode` levam o preview por todos os modos até `center`,
um em `Swap the picture` carrega o logo, e um em `Mount again` monta uma segunda Image do mesmo endereço e
tamanho: o cartão `Remount` mostra o nascer do sol de novo, `loaded 192x128 px`, respondido pelo cache
decodificado, sem segundo pedido ao servidor (ele recebeu exatamente um), sem progresso e sem segunda
textura. O preview mostra o logo em `center`, com `resizeMode="center"`, `picture: logo` e
`loaded 64x64 px`.

A validação compara a cor de pontos do quadro com as marcas que a imagem tem, como na primeira fatia, e a
imagem que falhou não deixa pixels de imagem. Não há oráculo independente de pixels do quadro inteiro, e a
comparação com o UIKit segue aberta em Limites. Os dois quadros da primeira fatia continuam em
[`docs/evidence/images`](../images/README.md), mostrando o exemplo antes da linha de rede.

Estas execuções são locais: a CI hospedada ainda não rodou esta fatia.

## Regressões

Passaram na árvore da implementação, depois da revisão que extraiu do `image_loader.cpp` a decisão e o
ciclo de vida das fontes de rede para o `ImageSources` (o arquivo foi de 591 linhas na primeira fatia para
789): os testes C++ de imagens, a suíte nova (72 checks na lane atual, 37 executados e 30 falhando no
controle, 1, 32 e 2 falhas nas sabotagens), a suíte da primeira fatia (73 checks, 62 normativos; 11 checks e
3 falhas normativas no controle; 12 e 2 falhas nas sabotagens), Networking, WebSocket, AppState,
`test:contracts` (301 testes Node, 43 do painel e 13 Python), os exemplos (22 checks headless no `images` e 30
com o renderizador), o `type-check`, a análise estática, o scan de publicação e o teste de recuperação. O
recibo registra cada passo.

Quatro passos falharam na primeira passada por motivos alheios ao comportamento testado e foram
corrigidos e repetidos: a análise estática (exports sem uso no módulo do servidor e dois nomes duplicados
entre os oráculos), a suíte de Imagens da primeira fatia contra um controle local defasado depois de o
bundle mudar, e os controles e sabotagens locais do Networking e do WebSocket, que fixam bundles que o
`src/image-contract.mjs` mudou. Esses recibos vivem só em `build/`, não vão para o git e não existem na
CI; foram refeitos nos hosts anteriores preservados.

A suíte da primeira fatia mudou com o contrato: o caso `neg-http`, os casos de `getSize` por `http` e as
seis recusas de chave saíram do fixture; `prefetch` resolve verdadeiro para um arquivo carregável e rejeita
com `E_PREFETCH_FAILURE` para um ausente; um `repeat` não redimensiona mais a textura; e a suíte tem agora 73
checks (62 normativos), onde tinha 74 (63). O [registro dela](../images/README.md) leva uma nota datada.

As 190 fontes de código e configuração executadas (16 do bundle e da suíte, 123 do build nativo, 33 de
verificação e 18 do fixture, com sobreposição) correspondem à implementação
`6bbd03665b0b2136f0eabe58a540cbf4394215ee` por `git show`/SHA-256, e as lanes rodaram dessa árvore
commitada, sem fonte alterada durante a execução. Os documentos desta fatia foram escritos depois delas; os
gates que os leem rodaram de novo na árvore final.

## Limites

- **Disco.** Não há cache em disco: o de bytes é só de memória, nada sobrevive à aplicação e `queryCache`
  nunca responde `disk` ou `disk/memory`.
- **Rede.** Sem revalidação, `Vary`, cookies, compressão, HTTP/2 nem cache HTTP de redirecionamentos. O
  transporte e os caches rodaram contra um servidor Node em loopback (HTTP e HTTPS com uma autoridade de
  teste) e o servidor GDScript do exemplo; um servidor remoto, um proxy, um portal cativo e condições
  reais de rede não foram exercitados.
- **Props visuais.** `tintColor`, `blurRadius`, `capInsets`, `defaultSource`, `loadingIndicatorSource`,
  `fadeDuration`, `progressiveRenderingEnabled`, `resizeMethod`, `resizeMultiplier` e `overlayColor` falham
  onde a Image renderiza, e um raio de borda no estilo da própria Image também (o host recorta só
  retângulos).
- **Formatos.** GIF e WebP animados, `nativeImageSource` e Image dentro de `Text` não são entregues.
- **Export.** As imagens foram carregadas na execução do próprio projeto; nenhum app exportado, export
  desktop ou Android foi executado.
- **Pixels e memória.** As capturas são do renderizador nativo do macOS na escala 2 e a validação amostra
  alguns pontos; não há oráculo independente do quadro inteiro, e o arredondamento da miniatura do ImageIO, a
  geometria exata do ladrilho do UIKit, a memória de decodificação num aparelho e o comportamento dos caches
  sob um aviso de memória real não foram comparados com o iOS.
- **Plataformas.** Só macOS arm64 foi executado; Windows, Linux, Android, iOS e Web não foram exercitados,
  nem hardware real.
- **CI.** A CI hospedada desta fatia está pendente: o oráculo e a sonda afirmam valores que o host entregou
  ou limites (quatro downloads ao mesmo tempo, margem de 20 s em torno de cada tempo de validade), nunca o
  ritmo de quadros nem a segmentação dos bytes.

Nenhum GF inteiro, contrato, paridade, alvo, outro checkpoint, peso ou denominador fecha: o GF-16
continua aberto, e esta segunda fatia não fecha nenhum checkpoint.
