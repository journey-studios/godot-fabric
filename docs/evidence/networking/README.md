# fetch e XMLHttpRequest do RN sobre o HTTPClient do Godot

Esta fatia instala os globais de rede do próprio RN: `fetch` com `Headers`, `Request`
e `Response`, `XMLHttpRequest`, `FormData`, `Blob`, `File`, `FileReader`, `URL`,
`URLSearchParams`, `AbortController` e `AbortSignal` (e o `WebSocket`, que continua
falhando onde é usado até a próxima fatia). A inicialização do host importa o
`setUpXHR` do RN; três TurboModules C++ (`Networking`, no contrato Android do RN,
`BlobModule` e `FileReaderModule`) dão a eles o transporte, sobre um armazém único de
blobs e um `HTTPClient` do Godot por requisição, consultado a cada quadro na thread
principal. Um servidor Node determinístico, sobre HTTP e HTTPS, recebe as requisições
de duas roots de uma aplicação, e um oráculo independente confere as 137 requisições
que ele registrou com o que o JS observou. O [recibo](report.json) fixa fontes,
hashes, capturas e resultados.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `f96d9dfc` (main `99216e2`) | 16/100 | Exatamente as 84 falhas normativas: sem os módulos, o primeiro uso de cada API falha na busca do módulo (`'Networking' could not be found`) e nenhuma requisição chega ao servidor; os 16 checks restantes valem nos dois hosts |
| Sabotagem `redirects`, host `d010013b` | 92/100 | Exatamente 8 falhas: o transporte entrega o 3xx como resposta, o servidor registra 72 requisições em vez de 137 e o oráculo rejeita o relatório |
| Sabotagem `headers`, host `83aed368` | 98/100 | Exatamente 2 falhas: os cabeçalhos repetidos da resposta ficam separados e o JS só vê o último `Set-Cookie` e `X-Multi`; o oráculo rejeita o relatório |
| Host atual `36f25f04`, headless | 100/100 | Duas roots, HTTP e HTTPS, `fetch` e `XMLHttpRequest`, corpos string, base64, `FormData` e `Blob`, redirecionamentos, tempo limite, aborto, erros de rede, blobs e parada da aplicação com requisições em voo |

As lanes executam o mesmo bundle, com as mesmas fontes de teste e SDK; só os
produtores nativos diferem. O host anterior foi compilado a partir da main `99216e2`
(o merge do quadro de paridade), antes de a árvore receber o trabalho desta fatia: as
fontes nativas e de SDK de `99216e2` são as da base da execução. O hash dele
(`f96d9dfc…`) e o do host atual ficam no recibo; o binário anterior fica em
`build/networking-previous-host/`, local e fora do repositório. As duas sabotagens são
retidas: `node scripts/networking-sabotage.mjs` troca uma linha de cada vez, recompila,
roda o runner e o oráculo, restaura a fonte byte a byte (hash conferido), recompila o
host genuíno e registra tudo em um recibo local.

```sh
npm run test:networking
```

Com o host anterior instalado em `addons/`, o mesmo runner confere o controle com
`node tests/networking-native.test.mjs --allow-original-negative`; os hosts sabotados
rodam com `--sabotage=redirects` e `--sabotage=headers`, e o launcher abre o
[exemplo](../../../examples/networking/README.md) com `npm run example -- networking`.

## O que o RN faz

No JS, o `InitializeCore` requer `Libraries/Core/setUpXHR.js`, que instala os globais
acima como getters preguiçosos (`polyfillGlobal`, linhas 21-48): cada módulo carrega na
primeira leitura. O `fetch` é o polyfill whatwg-fetch 3.6.20 (`Libraries/Network/fetch.js`),
escrito sobre o `XMLHttpRequest`: pede `responseType = 'blob'` sempre que `new Blob()`
funciona (`fetch.js` do pacote, linhas 12 e 593-599) e lê o corpo pelo `FileReader`; sem
`BlobModule` ele cairia em `arraybuffer` e decodificaria os bytes como Latin-1, o que
quebra o UTF-8. O `signal` de um `Request` aborta o XHR (linhas 531-626), de modo que o
aborto é só JS.

O `XMLHttpRequest.js` é o único chamador do `RCTNetworking`. O `send()` (linha 564)
assina seis eventos de dispositivo (linhas 576-601: `didSendNetworkData`,
`didReceiveNetworkResponse`, `didReceiveNetworkData`, `didReceiveNetworkIncrementalData`,
`didReceiveNetworkDataProgress` e `didCompleteNetworkResponse`), traduz o `responseType`
para `text`, `base64` (o `arraybuffer`) ou `blob` e chama `RCTNetworking.sendRequest`. Os
eventos trazem arrays `[requestId, ...]`: `__didReceiveResponse(id, status, headers, url)`
(linha 337) leva a HEADERS_RECEIVED, `__didReceiveData(id, response)` (linha 367) guarda o
corpo e `__didCompleteResponse(id, error, timedOut)` (linha 421) conclui; um `error` não
vazio vira `error`, ou `timeout` se o terceiro elemento é verdadeiro, e 4xx e 5xx são
`load`. O `abort()` (linha 654) chama `abortRequest`, que não emite nada, e despacha
sozinho `readystatechange`, `abort` e `loadend`. Listeners de `readystatechange` e
`progress` só pedem atualizações incrementais: uma requisição sem eles, ou cujo nativo
nunca envia os eventos incrementais e de progresso, carrega do único evento final de
dados.

A pilha de blobs precisa do `BlobModule` (`getConstants` é lido quando o `URL.js` carrega,
linhas 17-27; `addNetworkingHandler`, quando o XHR carrega, linha 69; `createFromParts` e
`release` vêm do `BlobManager.js`, linhas 62-99 e 135-142) e do `FileReaderModule`
(`readAsText(blob, encoding)` e `readAsDataURL(blob)`, ambos promessas). O JS cria o UUID
de cada blob que monta; um blob nativo de resposta é `{blobId, offset: 0, size, type?}`.
`Blob.close()` libera os bytes, e o `BlobManager.js` (linhas 37-46) pede ao host um
`__blobCollectorProvider`, cujo objeto hospedado deixa o nativo liberar o blob que o JS
largou sem fechar.

O contrato nativo depende da plataforma. O wrapper Android
(`RCTNetworking.android.js`) deixa o JS atribuir o id da requisição a partir de 1
(linha 35), chama `sendRequest` com argumentos posicionais (método, URL, id, cabeçalhos
como pares `[nome, valor]`, corpo, tipo de resposta, atualizações incrementais, tempo
limite e `withCredentials`) e chama o callback com o id de forma síncrona; o evento de
falha é `[id, mensagem]`, com um terceiro elemento `true` só no tempo limite. O wrapper
iOS entrega um objeto de consulta, o nativo atribui o id e o devolve ao callback
(`RCTNetworking.mm`, linhas 720-725), e a falha traz sempre `[id, mensagem, timedOut]`
(linha 701). No Android o OkHttp segue até 20 redirecionamentos e o `callTimeout` cobre a
chamada inteira (`NetworkingModule.kt`, linhas 416-418), os cookies só valem com
`withCredentials` (linhas 371-373) e a compressão gzip é decodificada pelo OkHttp e,
quando o app pediu `Accept-Encoding`, pelo módulo (linhas 665-690). O módulo Android exige
Content-Type nos corpos string, base64 e uri (linhas 458, 510 e 549), reduz os nomes de
cabeçalho a ASCII imprimível (`HeaderUtil.stripHeaderName`), grava os valores como UTF-8
(`addUnsafeNonAscii`, linhas 1029 e 1035), converte o corpo string em bytes por conta
própria para o OkHttp não acrescentar um charset ao Content-Type (linhas 481-501,
react-native#8237), une os cabeçalhos repetidos da resposta com `", "` pelo nome como
chegou (`NetworkEventUtil.okHttpHeadersToMap`, linhas 239-250) e responde o tipo `text`
com o `string()` do OkHttp (o BOM primeiro, depois o charset do Content-Type, UTF-8 por
padrão; linha 734). A spec C++ `NativeNetworkingAndroidCxxSpec` já está gerada em
`React/FBReactNativeSpec`.

## O que este host fazia

O `src/initialize.js` substitui o `InitializeCore`, de modo que o `setUpXHR` nunca rodava:
`fetch`, `XMLHttpRequest`, `FormData`, `Blob`, `FileReader`, `URL` e `AbortController`
não existiam, e nenhum dos três módulos nativos estava registrado. Importar só o
`setUpXHR` instalaria globais que lançam onde procuram um módulo, e é o que o host
anterior mostra com o bundle desta fatia: os checks de JavaScript passam e todo check de
rede falha na busca (`TurboModuleRegistry.getEnforcing(...): 'Networking' could not be
found`, `'FileReaderModule'`). O RN também entrega o `RCTNetworking.js` só como um arquivo
que importa a si mesmo, apoiado nas variantes `.ios` e `.android` que o resolvedor deste
host nunca escolhe.

## O que o Godot entrega

O `HTTPClient` é o cliente de baixo nível do motor. Ele é não bloqueante quando
consultado: um `poll()` avança resolução, conexão, handshake TLS, pedido e resposta, e o
status nomeia a etapa. `read_response_body_chunk()` devolve no máximo `read_chunk_size`
bytes, 65.536 por padrão; `get_response_headers()` é a lista bruta de linhas
`Nome: valor` na ordem do fio, com duplicatas e a caixa do servidor;
`get_response_body_length()` vale -1 para corpos em chunks ou sem tamanho;
`connect_to_host` recebe `TLSOptions` (`TLSOptions.client()` confia nas raízes do motor,
`TLSOptions.client(chain)` só no `X509Certificate` dado). O TLS é mbedTLS, versões 1.2 e
1.3, sem revogação nem pinning. O cliente não faz redirecionamentos, tempo limite total
(o nó `HTTPRequest` tem um, o `HTTPClient` não), descompressão, cookies, pooling nem
HTTP/2, e acrescenta `Host` a menos que o pedido traga um.

Comportamentos dos quais o transporte depende, cada um agora afirmado pela suíte:

- Um servidor que responde e fecha a conexão de imediato deixa o cliente em
  `STATUS_CONNECTION_ERROR` se ele é consultado de novo depois de a resposta terminar;
  por isso o transporte consulta uma vez por pump e recolhe a resposta pronta antes da
  consulta seguinte.
- Um corpo que acaba antes do tamanho declarado deixa `STATUS_DISCONNECTED` com menos
  bytes que `get_response_body_length()`.
- Um certificado que o motor recusa imprime `ERROR: TLS handshake error: -9984` no log do
  motor e termina em `STATUS_TLS_HANDSHAKE_ERROR`; o runner admite exatamente os três que
  o probe provoca.

## A implementação

`native/networking_modules.{h,cpp}` é o lado de uma aplicação da pilha de rede do RN: os
TurboModules C++ `Networking` (a `NativeNetworkingAndroidCxxSpec` gerada pelo RN),
`BlobModule` e `FileReaderModule`, sobre um único `BlobStore` (`native/blob_store.h`: ids
UUID v4, fatias por deslocamento e tamanho, contadores). Eles se registram por
`TurboModuleRegistry::add` como os demais módulos nativos e usam um invoker de chamadas
interrompível, de modo que todo evento de dispositivo e toda resolução de promessa sai pelo
agendador do RN na ordem em que foi enfileirada e é descartado quando a aplicação para.

O transporte fica atrás de `native/http_transport.h`: `start`, `cancel`, `poll`, `stop` e
um ouvinte com `on_head`, `on_body`, `on_failure` e `on_complete`; toda chamada roda na
thread principal do Godot, que também é a do JS. `native/godot_http_transport.cpp` é a
primeira implementação: um `HTTPClient` e uma conexão por requisição, avançados pelo
`ApplicationRuntime::pump` antes de a fila de trabalho esvaziar, com 1 MiB de bytes de
corpo por pump dividido entre as requisições. As partes puras ficam em
`native/http_core.h` e têm teste C++ próprio (81 asserções em 10 grupos,
`native/http_core_test.cpp`): análise e canonização de URLs, resolução de referências,
as regras de redirecionamento do OkHttp, validação de cabeçalhos, tipos de mídia,
decodificação de charset com BOM, base64 e multipart.

- **Pedidos.** O `sendRequest` valida os argumentos e os cabeçalhos e monta o corpo
  (`string` e `base64` como bytes com o Content-Type do chamador, sem alteração e
  obrigatório como no Android; `formData` com partes string como multipart com boundary
  aleatório; `blob` com o tipo do próprio blob, salvo se o chamador definiu um) e então
  inicia o transporte. Problemas do próprio pedido (tipo de resposta, tempo limite ou
  cabeçalho inválido, corpo ilegível) viram um evento `didCompleteNetworkResponse`, porque
  no Android o wrapper JS ainda não informou o id ao chamador quando o `sendRequest`
  retorna; só um id que não seja inteiro não negativo, ou que já esteja em voo, lança.
  Corpos `uri` e partes de arquivo falham com mensagem explícita.
- **Redirecionamentos.** O transporte os segue por conta própria: 301, 302 e 303 viram GET
  sem corpo (exceto GET e HEAD), 307 e 308 mantêm método e corpo, no máximo 20
  seguimentos (o vigésimo primeiro falha com `Too many follow-up requests: 21`), entre
  origens, com `Authorization` descartado quando a origem muda e um esquema que o host não
  segue (qualquer um fora de http e https) entregue como a resposta. A URL final é a URL da
  resposta.
- **Tempo limite.** O prazo é `agora + timeout` no relógio monotônico, conferido a cada
  poll, e cobre a troca inteira, redirecionamentos e corpo incluídos, como o `callTimeout`
  do OkHttp; 0 é sem prazo. A falha é `[id, "The request timed out.", true]`.
- **Respostas.** Os eventos são `didReceiveNetworkResponse` (cabeçalhos unidos por `", "`),
  `didReceiveNetworkData` e `didCompleteNetworkResponse`. O corpo é acumulado até
  terminar: `text` decodifica pelo charset do Content-Type (UTF-8, ISO-8859-1, US-ASCII ou
  UTF-16, com o BOM valendo mais; UTF-8 inválido vira U+FFFD), `base64` o codifica e
  `blob` o guarda e envia `{blobId, offset: 0, size, type}`. Uma resposta com
  `Content-Encoding` diferente de `identity` falha de forma explícita.
- **Aborto e parada.** O `abortRequest` marca um token compartilhado, de modo que os
  eventos já enfileirados da requisição são descartados, cancela o transporte em silêncio
  e conta. O `stop` encerra o transporte primeiro, libera todos os blobs e recusa os
  métodos retidos dos módulos com `E_MODULE_DISPOSED`; nenhum ouvinte roda depois, e o
  `disposeEnvironment` solta as assinaturas de dispositivo das requisições ainda em voo.
- **Blobs.** O `BlobModule.createFromParts` copia partes string e fatias de blob para o
  armazém; o `release` libera por id; o provedor de coletor devolve um objeto hospedado
  cujo finalizador (o Hermes pode rodá-lo em outra thread) só enfileira o id atrás de um
  mutex, e a thread principal o libera no poll seguinte. O objeto também informa ao
  coletor quantos bytes nativos ele guarda.
- **Fachada e sementes.** O `src/initialize.js` importa o `setUpXHR`; o plugin esbuild do
  SDK aliasa o `RCTNetworking` para o `RCTNetworking.android.js` (um módulo de projeto com
  esse nome fica intocado); o `src/platform-environment.js` conta e solta as seis
  assinaturas de dispositivo. A fachada `react-native` não ganha export: o export
  `Networking` continua ausente e os globais são os do próprio RN. Duas sementes de
  validação do nó `FabricApplication` mantêm a suíte determinística:
  `validation_tls_trusted_authorities` (o PEM das autoridades em que uma requisição HTTPS
  confia no lugar das raízes do Godot) e `validation_clock_offset_ms` (adianta o relógio em
  que os prazos correm, de modo que um tempo limite não precisa de espera). Um produto
  nunca define nenhuma das duas, e os padrões são as raízes do Godot e nenhum deslocamento.

## O que foi verificado

O [servidor](../../../tests/networking-server.mjs) é um processo filho Node que informa as
portas na saída padrão, registra cada requisição exatamente como chegou (nomes de
cabeçalho brutos, ordem e duplicatas, bytes e hash do corpo e como a conexão terminou) e
nunca dorme: uma requisição segurada fica segurada até uma requisição de controle
liberá-la ou o cliente fechar a conexão. Ele serve códigos de status, o eco bruto de
cabeçalhos, cabeçalhos repetidos, JSON, UTF-8, ISO-8859-1, corpos com BOM e UTF-8
inválido, padrões de bytes de qualquer tamanho, um megabyte em chunks, respostas seguidas
de fechamento, uma resposta comprimida, cadeias e laços de redirecionamento, um
redirecionamento entre origens e outro para outro esquema, resets e truncamentos, uma
porta que aceita e nunca responde, e HTTPS com uma CA e uma folha assinadas em tempo de
execução ([certificados](../../../tests/networking-certificates.mjs): só o certificado
público da CA vai para `build/`; nenhuma chave privada é escrita), mais uma segunda
autoridade para os casos negativos. O [fixture](../../../tests/networking-fixture.jsx)
roda as APIs públicas do RN em duas roots de uma aplicação e registra o que o JS observa;
o [probe](../../../tests/networking-probe.gd) espera por condições, nunca por tempo, e lê
também o instantâneo de rede da aplicação.

- **Montagem, módulos e globais.** As duas roots montam pelo `AppRegistry` original de uma
  só aplicação; `Networking`, `BlobModule` e `FileReaderModule` carregam do host, e o
  `XMLHttpRequest` e o `FileReader` globais são os do RN, instalados pela inicialização
  sobre eles; `WebSocketModule` não existe e o primeiro uso de `WebSocket` falha com o
  erro de busca do próprio RN; o transporte da aplicação é o do Godot e nada está em
  voo. Valem nos dois hosts os checks sem rede: os globais existem, o `Headers` junta
  repetições e o `Request` normaliza o método e guarda o corpo string, o
  `AbortController` aborta o sinal uma vez e o `URLSearchParams` decodifica, e o
  `FormData` descreve as partes como o RN as envia ao módulo.
- **fetch: respostas.** O GET devolve status, URL final, cabeçalhos e o JSON; um corpo
  com caracteres de vários bytes volta como texto e o blob conta bytes; o charset do
  Content-Type chega ao blob e o `FileReader` decodifica ISO-8859-1; o BOM é mantido pelo
  caminho do `FileReader` e descartado pelo texto do XHR, como no Android; UTF-8 inválido
  vira U+FFFD nos dois caminhos; o `arrayBuffer` devolve todos os bytes; um corpo de 1 MiB
  chega completo em vários polls com orçamento; um servidor que fecha a conexão logo
  depois da resposta, com tamanho ou em chunks, ainda entrega o corpo inteiro; 404, 500,
  204, 304 e HEAD são respostas, as três últimas sem corpo.
- **fetch: pedidos.** Os cabeçalhos chegam ao servidor (repetições unidas pelo `Headers`,
  `Host` da URL, valores UTF-8 como bytes); os repetidos da resposta são unidos com
  vírgula e os nomes não distinguem caixa; cookies não são guardados nem enviados e o
  `clearCookies` não tem o que limpar; um corpo string vai em UTF-8 com o Content-Type do
  chamador, ou com o da própria whatwg-fetch quando falta; um array tipado viaja em
  base64 e chega byte a byte; um corpo binário sem Content-Type é recusado, como no
  Android; o `FormData` vai como multipart com boundary e partes; uma parte de arquivo
  falha de forma explícita; um `Blob` vai com seus bytes e seu tipo; pedidos que o host
  recusa nunca chegam ao servidor.
- **Redirecionamentos.** O 302 transforma um POST em GET sem corpo e informa a URL final;
  o 307 mantém método e corpo; vinte seguimentos funcionam e o vigésimo primeiro falha; um
  laço termina em erro de rede; o `Authorization` não cruza a origem e o `Host` segue a
  nova URL; um redirecionamento para um esquema que o host não segue é entregue como a
  resposta; o servidor viu 21 requisições por cadeia e pelo laço (a requisição e 20
  seguimentos) e, no 302, o POST e depois o GET que o substituiu.
- **Falhas.** Uma resposta comprimida falha em vez de entregar bytes crus; uma conexão
  recusada e uma reiniciada rejeitam como no Android (`TypeError: Network request
  failed`); um corpo cortado depois dos cabeçalhos termina em erro, não em `load`; um
  esquema não suportado, uma URL inválida e um método não suportado são erros de rede;
  toda requisição que falhou saiu do conjunto em voo.
- **HTTPS.** Um servidor certificado pela autoridade em que a semente confia responde por
  TLS; um certificado de autoridade não confiável é erro de rede; sem a semente só valem
  as raízes padrão do Godot, entre as quais a CA de teste não está; a confiança segue a
  autoridade configurada (o certificado do outro servidor verifica e o do primeiro não);
  um PEM inválido recusa a requisição em vez de confiar em tudo. O runner admite
  exatamente os três erros de handshake que o motor imprime para esses casos.
- **XMLHttpRequest.** Estados e eventos na ordem do RN, com a URL da resposta e os
  cabeçalhos; `getAllResponseHeaders` no formato do RN; uma requisição sem listeners de
  `readystatechange` ou de progresso ainda carrega; pedir atualizações incrementais ainda
  entrega o corpo; `arraybuffer`, `json`, `text` e `blob` devolvem o corpo (blob vazio
  para o 204 e para uma falha); 4xx e 5xx são `load`, nunca `error`.
- **Contrato nativo.** Pelo `RCTNetworking` do próprio RN, a ordem e o conteúdo dos eventos:
  `didReceiveNetworkResponse [id, status, cabeçalhos, url]`, `didReceiveNetworkData` e
  `didCompleteNetworkResponse` com `null` no sucesso; o tipo `base64` entrega o corpo em
  base64; uma falha antes de qualquer resposta é um único `didCompleteNetworkResponse [id,
  mensagem]`; um tempo limite conclui com `[id, mensagem, true]`.
- **Blobs.** Um `Blob` conta os bytes de suas partes e o `FileReader` os lê de volta;
  `readAsDataURL`, `readAsArrayBuffer` e fatias leem os bytes certos; `File` e
  `URL.createObjectURL` funcionam sobre o armazém nativo; blobs ilegíveis, intervalos e
  codificações inválidos rejeitam a promessa do `FileReader`; os blobs que o caso criou
  são fechados pelo JS e liberados do armazém, e as contas do armazém fecham; o
  `XMLHttpRequest` se anunciou ao `BlobModule`; o `fetch` cria um blob nativo por
  resposta e nada na whatwg-fetch o fecha, então só o coletor de lixo pode: ele libera os
  blobs que ninguém fechou, e o armazém nativo não cresce.
- **Duas roots.** Cada root envia quatro requisições ao mesmo tempo e recebe só as suas
  respostas; nada fica em voo.
- **Aborto e tempo limite.** O servidor recebeu e segura a requisição; o `AbortController`
  rejeita o `fetch` com `AbortError`; o aborto fecha a conexão que o servidor segurava;
  uma requisição liberada depois do aborto não entrega nada; um sinal já abortado rejeita
  sem requisição; os cabeçalhos de uma resposta cujo corpo ainda vem chegam ao
  `XMLHttpRequest`; o `abort()` despacha `readystatechange`, `abort` e `loadend`, nunca
  `load` ou `error`, e abortar no corpo fecha a conexão; nada mais chega a um
  `XMLHttpRequest` abortado; uma requisição que passa do prazo termina com `timeout`, sem
  status, e fecha a conexão (o prazo passa pela semente do relógio, sem espera), e uma
  requisição à porta que nunca responde expira no relógio real; abortar um pedido de blob
  não cria blob; o nativo contou os abortos e o tempo limite e não guarda nada; toda
  requisição aceita terminou de um só jeito: concluída, falhada ou abortada.
- **Parada.** Três requisições (um `fetch`, um `XMLHttpRequest` no corpo e um pedido de
  blob) estão em voo no servidor; a aplicação as conta e o JS viu os cabeçalhos de uma;
  parar cancela as requisições em voo, libera os blobs e não deixa nada ativo; o servidor
  viu cada conexão fechada pelo cliente; as limpezas das roots rodam e nada mais chega ao
  JS (nem `load`, `error`, `abort` ou `timeout` das requisições em voo); nenhum evento de
  dispositivo é entregue pela aplicação parada e os enfileirados são contabilizados;
  métodos retidos dos módulos e uma nova busca são recusados; a limpeza tardia
  (`abortRequest` e `release`) é inofensiva; o `disposeEnvironment` solta as assinaturas
  das requisições que ainda estavam em voo; parar as duas roots não gera diagnóstico do
  host.

O [oráculo](../../../tests/networking-oracle.mjs) não confia em nenhum veredito do probe:
ele deriva das definições do servidor o multiconjunto de requisições que os casos devem
ter causado (137, por ouvinte, método e URL), lê corpos, cabeçalhos, redirecionamentos e
o fim de cada conexão no registro do servidor e amarra os contadores nativos a esse
registro por aritmética: toda requisição que o transporte iniciou terminou de um só jeito
(concluída, falhada ou cancelada), 64 redirecionamentos foram seguidos (1 + 1 + 20 + 20 +
20 + 1 + 1), nenhum evento foi entregue depois da parada nem descartado, e as contas do
armazém de blobs fecham (guardados = retidos + fechados + coletados). O runner também
reprova qualquer linha de erro do motor, de script ou do nativo que não esperava, e roda
o oráculo sobre uma cópia do relatório com todos os checks marcados como aprovados, que
um host errado ainda precisa reprovar.

Na execução do recibo (servidor: 125 GET, 1 HEAD e 11 POST; 134 requisições no ouvinte
HTTP, 1 no outro origin, 1 em HTTPS e 1 em HTTPS com a segunda autoridade), 126
requisições terminaram respondidas, 4 foram cortadas pelo servidor (3 resets e 1
truncamento) e 7 fechadas pelo cliente (as seguradas).

## Controles

O host anterior roda o mesmo bundle: as roots montam e param sem diagnóstico e os checks
de JavaScript passam, mas o primeiro uso de `XMLHttpRequest` lança
`TurboModuleRegistry.getEnforcing(...): 'Networking' could not be found` e o de
`FileReader` o equivalente para `'FileReaderModule'`. Falham exatamente os 84 checks que precisam dos módulos
(montagem dos módulos, todas as respostas, pedidos, redirecionamentos, falhas, HTTPS, XHR,
contrato, blobs, roots, aborto e parada) e passam os 16 restantes; nenhuma requisição
chega ao servidor, e o oráculo rejeita o relatório.

A sabotagem `redirects` troca a condição que decide seguir um redirecionamento por uma
que nunca segue: o 3xx é entregue como a resposta, o `fetch` devolve o 302 onde o cliente
Android devolve a página para a qual ele aponta, e o servidor não vê nenhum seguimento (72
requisições em vez de 137). Falham exatamente 8 checks (302, 307, vinte seguimentos, o
vigésimo primeiro, o laço, `Authorization` e `Host`, as 21 requisições por cadeia e o POST
seguido do GET) e o oráculo rejeita o relatório pelo conjunto de requisições que o
servidor recebeu.

A sabotagem `headers` troca a linha que une os cabeçalhos repetidos por uma que os
mantém separados: o JS só vê o último `Set-Cookie` e `X-Multi`, onde o mapa do OkHttp os
tem todos. Falham exatamente 2 checks (a união por vírgula e o dos cookies), e o oráculo
rejeita o relatório.

Em cada sabotagem o `scripts/networking-sabotage.mjs` confere que a âncora aparece uma só
vez, compila, roda o runner com a flag da variante, restaura a fonte byte a byte, prova
isso por hash e recompila o host genuíno, cujo hash volta ao executado. O recibo local
registra as fontes, os hosts e os resultados. A suíte passa também sem nenhum recibo de
controle, como na CI, e sob carga de CPU (14 processos `yes` em 11 núcleos): nenhum check
depende do ritmo da máquina, porque as esperas são condições, o tempo limite determinístico
passa pela semente do relógio e o único em tempo real (150 ms contra a porta que nunca
responde) só espera o evento.

## Capturas

`npm run example -- networking --capture` salva seis quadros do renderizador nativo do
exemplo, e a validação confere o selo, a URL, o Content-Type, o corpo e o registro de cada
um, com cliques reais do mouse: [ocioso](networking-idle.png) (selo cinza, sem
requisição), [GET JSON](networking-json.png) (selo verde `GET JSON: 200`, o JSON lido),
[POST form](networking-form.png) (o servidor recebeu as duas partes do multipart),
[redirecionamento](networking-redirect.png) (a URL final depois do 302),
[lento](networking-pending.png) (selo âmbar, a requisição que o servidor nunca responde)
e [abortado](networking-aborted.png) (selo vermelho `AbortError`, sem requisições em voo).
O recibo registra o SHA-256 e as dimensões (900 × 680) de cada uma, e o
[exemplo](../../../examples/networking/README.md) as mostra com a explicação de cada
estado. A porta do servidor local aparece na linha da URL de quatro delas (GET JSON, POST
form, redirecionamento e lento) e muda a cada execução, de modo que os bytes dessas quatro
mudam de uma execução para outra; a ociosa e a abortada, cujas linhas de URL são traços,
têm bytes estáveis (conferido em três execuções).

## Regressões

Na execução, sobre a árvore commitada `83a3557` e no mesmo host (`36f25f04`), passaram os
três gates do job `contracts` (265 testes Node e 13 Python, análise estática e scan de
publicação), o `test:recovery`, as 37 suítes nativas (30 exemplos com 2.363 checks, o
`networking` com 15; guards de transform 61 e 25 de entrada, mais as lanes de escala
uniforme, 29, e singular, 49; Down 2.731 nas oito lanes, query faults 187, resolver faults
66, Document Up 6.459, View Up 297, Move 220, Document Move 1.940, hover 158, caminho da
raiz 82, hover em Document 1.530, click 728, notificações de captura 672, PanResponder 128,
AppState 75, listas 44, Appearance 79, Switch 108, toques compartilhados 92, touchables 93
(a lane `animated` com 7), ActivityIndicator 33, Animated 75, relógio de quadros 37 e o
próprio Networking 100) e o lote do SDK nativo (affine, codegen, pack/verify, registro e
loader de adapters, runtime de adapters, consumidor independente, cold start e
`parity:godot`). Cada suíte manteve a contagem do recibo anterior, a do Networking à parte:
os exemplos passaram de 2.262 para 2.363 checks pelos seis exemplos lançáveis da #45 e por
este. O controle de host anterior e as duas sabotagens foram refeitos na mesma árvore, nessa
ordem (controle, sabotagens, a lane sem os recibos de controle, como na CI, e a lane atual,
que compara com eles), com a CI do job `native-cold-start` como roteiro dos passos; o exemplo
rodou headless (15 checks) e com captura (27), e a suíte rodou três vezes sob carga de CPU a
partir da árvore commitada.

A inicialização do host passa a importar o `setUpXHR` do RN, e o plugin do SDK e o
`src/platform-environment.js` mudaram: os controles de host anterior e as sabotagens que
outras suítes guardam só em `build/` e que fixam esses arquivos (as do Animated, do relógio
de quadros e dos guards de transform) ficaram defasados e foram refeitos nos hosts anteriores
preservados, com os recibos antigos guardados em `build/stale-controls-for-networking/`. A CI
não os tem e não é afetada.

## Observações fora do recibo

Rodadas uma vez com scripts de rascunho na árvore commitada, não afirmadas pela suíte:

- Requisições da máquina de desenvolvimento a servidores públicos, em 2026-10-07, sobre as
  raízes padrão do Godot e sem a semente de validação: `https://example.com/` e
  `http://example.com/` responderam 200 com `text/html` e 577 caracteres cada;
  `http://www.wikipedia.org/` foi seguida por um redirecionamento até
  `https://www.wikipedia.org/` (200, `text/html`, 91.853 caracteres) e
  `https://api.github.com/zen` respondeu 200 com 36 caracteres de `text/plain`. O transporte
  contou 4 requisições iniciadas, 4 concluídas, nenhuma falha e 1 redirecionamento seguido.
  A verificação TLS real e uma cadeia real de redirecionamento funcionam, mas as respostas
  desses servidores podem mudar, de modo que nada disso é afirmado.
- Três execuções de captura do exemplo deram os mesmos bytes nos quadros ocioso e abortado e
  bytes diferentes nos outros quatro, cuja linha de URL mostra a porta efêmera do servidor
  local.
- A suíte passou 9 de 9 execuções sob carga (14 laços ocupados em 11 núcleos), 6 antes do
  commit e 3 a partir da árvore commitada, e passa sem os recibos de controle, como na CI.

## Limites

- **WebSocket.** O global `WebSocket` é o do RN; seu primeiro uso falha com o erro de busca
  do próprio RN (`'WebSocketModule' could not be found`), e os métodos de socket do
  `BlobModule` lançam `E_UNSUPPORTED`. É a próxima fatia.
- **Cookies.** Nada é guardado nem enviado; `withCredentials` não tem efeito e
  `clearCookies` chama de volta `false`.
- **Compressão.** Uma resposta com `Content-Encoding` diferente de `identity` falha de forma
  explícita, e um corpo de pedido string com `Content-Encoding: gzip` também (esse caminho
  não tem check próprio; os demais corpos descartam o cabeçalho, como no Android). O OkHttp
  e o NSURLSession descomprimem.
- **O corpo chega inteiro.** Atualizações incrementais e eventos de progresso de envio e de
  download nunca são enviados, o que o `XMLHttpRequest` tolera; um corpo de 1 MiB chega em
  vários polls com orçamento, mas é entregue uma vez.
- **Arquivos.** Corpos `uri` e partes de arquivo do `FormData` falham de forma explícita.
- **HTTP/1.1, uma conexão por requisição.** Sem pooling, keep-alive, HTTP/2 nem
  configuração de proxy ou de confiança do sistema; fora a semente de validação, o TLS
  confia nas raízes do Godot.
- **Contrato Android.** O wrapper iOS exigiria um segundo módulo sobre outra spec; os
  textos de falha são os deste host, não os das exceções do OkHttp; as constantes do
  `BlobModule` são as do iOS (`blob`, sem host), porque as do Android dependem de um
  content provider que este host não tem, de modo que `URL.createObjectURL` lê
  `blob:<id>?offset=..&size=..`.
- **Fachada.** O export `Networking` do `react-native` continua ausente da fachada (a
  importação funda de `react-native/Libraries/Network/RCTNetworking` resolve para o wrapper
  Android); esta fatia entrega os globais.
- **Plataformas.** Só macOS arm64 foi executado; exports Android (permissão `INTERNET`),
  iOS e Web (CORS), hardware real, rede offline e reconexão não foram exercitados.
- **CI.** A CI hospedada desta fatia está pendente.

Nenhum GF inteiro, outro checkpoint, peso ou denominador fecha: só o checkpoint de fatia do
GF-22.
