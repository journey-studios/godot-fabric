# WebSocket do RN sobre o WebSocketPeer do Godot

Esta fatia dá ao `WebSocket` do próprio RN o módulo nativo que faltava. O global já existia
desde a fatia de rede (a inicialização do host importa o `setUpXHR`), mas o primeiro uso
falhava onde o RN procura o módulo. Agora um quarto TurboModule C++, o `WebSocketModule`, no
contrato Android do RN, e as ligações de socket do `BlobModule` dão a ele um transporte sobre o
`WebSocketPeer` do Godot: um par por socket, consultado a cada quadro na thread principal, no
mesmo poll de rede do HTTP. Um servidor Node determinístico, que implementa o RFC 6455 à mão
sobre ws e wss, recebe os sockets de duas roots de uma aplicação, e um oráculo independente
confere, frame a frame, as 59 conexões que ele registrou com o que o JS observou. O
[recibo](report.json) fixa fontes, hashes, capturas e resultados.

| Lane executada | Checks | Observação |
| --- | ---: | --- |
| Host anterior `36f25f04` (main `afa5d87`) | 12/93 | Exatamente as 81 falhas normativas: sem o módulo, o primeiro `new WebSocket` falha na busca (`'WebSocketModule' could not be found`) e nenhuma conexão chega ao servidor; os 12 checks restantes valem nos dois hosts |
| Sabotagem `origin`, host `48ce2de1` | 89/93 | Exatamente 4 falhas: o módulo nunca envia o Origin padrão, o servidor registra o handshake sem ele e o oráculo rejeita o relatório |
| Sabotagem `stop`, host `de98476c` | 91/93 | Exatamente 2 falhas: o stop da aplicação fecha com 1000 em vez de 1001 e o servidor registra o código errado; o oráculo rejeita o relatório |
| Host atual `40f53ec9`, headless | 93/93 | Duas roots, ws e wss, textos e binários (`arraybuffer` e `blob`), subprotocolos, cabeçalhos, closes, handshakes recusados, conexões cortadas, mensagens de 1 MiB, ping, fragmentação, TLS, prazo do close, `close()` em CONNECTING e a parada da aplicação com sockets em voo |

As lanes executam o mesmo bundle, com as mesmas fontes de teste e SDK; só os produtores nativos
diferem. O host anterior foi compilado a partir das fontes nativas e de SDK da main `afa5d87`
(a fusão da fatia de rede, idênticas às de `83a3557`): ele tem os módulos de rede e não tem o
`WebSocketModule`. O hash dele (`36f25f04…`) e o do host atual ficam no recibo; o binário
anterior fica em `build/websocket-previous-host/`, local e fora do repositório. As duas
sabotagens são retidas: `node scripts/websocket-sabotage.mjs` troca uma linha de cada vez,
recompila, roda o runner e o oráculo, restaura a fonte byte a byte (hash conferido), recompila o
host genuíno e registra tudo em um recibo local.

```sh
npm run test:websocket
```

Com o host anterior instalado em `addons/`, o mesmo runner confere o controle com
`node tests/websocket-native.test.mjs --allow-original-negative`; os hosts sabotados rodam
com `--sabotage=origin` e `--sabotage=stop`, e o launcher abre o
[exemplo](../../../examples/networking/README.md), agora com dois cards, com
`npm run example -- networking`. A [nota de pesquisa](../../research/websocket.md) tem, para
cada comportamento do motor e cada escolha do host, a linha do Godot 4.7.2 ou do OkHttp 4.9.2
de onde ele vem.

## O que o RN faz

No JS, o `Libraries/Core/setUpXHR.js` instala o `WebSocket` como getter preguiçoso (linha 31).
O construtor (`Libraries/WebSocket/WebSocket.js`, linhas 98-149) lê a URL, os subprotocolos e
`options.headers` (a opção `origin`, obsoleta, avisa e passa para `headers`), cria um
`NativeEventEmitter` que só recebe o módulo nativo no iOS (linhas 141-145), de modo que nesta
plataforma os eventos chegam pelo emissor global de dispositivo do RN, pega o próximo id de um
contador do módulo (linha 146) e chama `NativeWebSocketModule.connect(url, protocols,
{headers}, id)` (linha 148). O `binaryType` aceita `'blob'` e `'arraybuffer'` e liga o socket
ao manipulador de conteúdo do `BlobModule` (linhas 155-171). O `send` (linhas 182-207) lança
`INVALID_STATE_ERR` enquanto o socket está em CONNECTING, envia um `Blob` por
`BlobManager.sendOverSocket`, uma string por `send` e um `ArrayBuffer` ou uma view em base64
por `sendBinary`; o `ping()` (linhas 209-215) tem a mesma checagem de estado. O `close(code,
reason)` (linhas 173-180) marca CLOSING e chama `_close` (linhas 217-226), que assume 1000 e
`''`. Os quatro eventos (linhas 233-290) trazem um objeto cada, com o `id` do socket:
`websocketMessage` (`type` `text`, `binary` em base64 ou `blob` com um BlobData),
`websocketOpen` (`protocol`), `websocketClosed` (`code` e `reason`: readyState CLOSED e um
`close`) e `websocketFailed` (`message`: readyState CLOSED, um `error` e um `close` com código
1006 e a mensagem como motivo, linhas 273-288). Depois de qualquer um dos dois eventos finais o
socket cancela as assinaturas (linhas 270 e 286), de modo que o JS ignora o que o nativo enviar
depois: o que um módulo nativo precisa cumprir é que todo `connect` termine em um
`websocketClosed` ou em um `websocketFailed` e que a falha seja o último evento.

O contrato nativo depende da plataforma:

| | Android `WebSocketModule.kt` (OkHttp 4.9.2) | iOS `RCTWebSocketModule.mm` (SocketRocket) |
| --- | --- | --- |
| Origin | um Origin feito do esquema, do host e da porta escrita da URL, se o chamador não deu um (linhas 104-128 e 387-410) | nenhum |
| Subprotocolos | aparados; vazios e com vírgula descartados; unidos por `,` em um cabeçalho (linhas 130-143) | o array vai ao SocketRocket |
| Cabeçalhos | um valor string é adicionado e o OkHttp valida nomes e valores; um valor que não é string é ignorado com aviso (linhas 106-123) | cada um é adicionado; um inválido é registrado |
| Cookies | `CookieJar.NO_COOKIES` no cliente e o Cookie do gerenciador do app, para a URL, acrescentado à mão (linhas 88, 99-102 e 347-361) | os cookies do armazenamento compartilhado (linhas 85-99) |
| Tempos limite | conexão e escrita 10 s, leitura nenhum (linhas 89-91) | os do SocketRocket |
| URL ilegível | `Request.Builder.url` lança na thread de módulos nativos | `websocketFailed` "Invalid WebSocket URL" (linhas 77-81) |
| `send`, `sendBinary` e `ping` de um socket que não existe | `websocketFailed` e `websocketClosed` com código 0, ambos dizendo "client is null" (linhas 225-243, 252-271 e 306-325) | nada: mensagem a um socket ausente não faz nada (linhas 141-159) |
| `ping` | `send(ByteString.EMPTY)`: uma mensagem binária vazia (linha 327) | um frame de ping (linhas 156-159) |
| `close` | não faz nada para um socket que ainda não abriu (linhas 208-215); recusas do OkHttp são capturadas e registradas (linhas 216-222) | fecha e esquece (linhas 161-165) |
| `websocketClosed` | `{id, code, reason}` (linhas 161-168) | também `clean` (linhas 223-241) |
| Parada da aplicação | `invalidate` fecha todo socket com 1001 (linhas 54-60) | solta o delegate e fecha: nenhum evento (linhas 62-71) |

O `BlobModule` guarda o estado de blob do socket: o manipulador de conteúdo deixa o texto como
texto e transforma a mensagem binária em `{blobId, offset: 0, size}` com `type: 'blob'`
(`BlobModule.kt`, linhas 49-67; `addWebSocketHandler` e `removeWebSocketHandler`, linhas
281-289), e `sendOverSocket` envia os bytes de um blob como uma mensagem binária, nada para um
blob que ele não tem (linhas 291-297). A versão iOS é o `RCTBlobManager.mm`, linhas 167-190. A
spec C++ do módulo (`NativeWebSocketModuleCxxSpec`) já vem gerada em
`React/FBReactNativeSpec`.

## O que este host fazia

A fatia de rede fez o `src/initialize.js` importar o `setUpXHR`, de modo que o global
`WebSocket` do RN existia, mas o host não registrava nenhum `WebSocketModule`: o primeiro `new
WebSocket` lançava onde o RN procura o módulo (`TurboModuleRegistry.getEnforcing(...):
'WebSocketModule' could not be found`) e os métodos `addWebSocketHandler`,
`removeWebSocketHandler` e `sendOverSocket` do `BlobModule` lançavam `E_UNSUPPORTED`. No host
anterior o mesmo bundle roda os checks que não precisam de módulo nativo e todos os outros
falham nessa busca.

## O que o Godot entrega

O `WebSocketPeer` é o ponto de extremidade WebSocket do motor (`modules/websocket`, sobre a
biblioteca wslay). O lado cliente é `connect_to_url(url, TLSOptions)` e depois `poll()`, com
regularidade: ele não bloqueia, e o estado (`STATE_CONNECTING`, `OPEN`, `CLOSING`, `CLOSED`)
nomeia a etapa. O `send(bytes, modo)` escreve uma mensagem de texto ou binária, o
`get_packet()` lê uma e o `was_string_packet()` diz qual era, o `get_selected_protocol()` é o
subprotocolo que o servidor escolheu, o `get_close_code()` e o `get_close_reason()` descrevem o
fechamento depois de CLOSED (o código é -1 quando a conexão não fechou limpa), o `close(code,
reason)` começa o handshake de fechamento (um código negativo derruba a conexão na hora) e
`supported_protocols`, `handshake_headers`, os dois tamanhos de buffer (65.535 bytes por padrão)
e `max_queued_packets` (4.096) são propriedades definidas antes de conectar. O TLS é o mbedTLS
do motor, com as raízes dele ou o `TLSOptions` dado.

O que o host usa, contorna ou escolheu, cada um com a origem na
[nota de pesquisa](../../research/websocket.md):

- **A mensagem só é legível com o par ABERTO.** `get_packet` e `get_available_packet_count` não
  dão nada fora de OPEN; um frame de close leva OPEN a CLOSING dentro do `poll()`, e um fechamento
  limpo chega a CLOSED e limpa o buffer de entrada na mesma chamada. O que chegou no poll do
  frame de close se perde ([godotengine/godot#115384](https://github.com/godotengine/godot/issues/115384),
  aberta em 2026-10-07), e o mesmo vale para o que o servidor envia depois do close do próprio
  cliente. Não há mitigação no host (ler depois do `poll()` não ajuda, porque o buffer é limpo
  dentro dele). A suíte reproduz a perda com uma rota que escreve três mensagens e o frame de
  close num só write e exige só que o close chegue com o código e o motivo do servidor e que o JS
  receba no máximo três mensagens; no recibo chegaram 0 de 3. Todas as outras rotas separam
  dados e close pela ordem do protocolo, nunca por um temporizador.
- **Subprotocolos.** O motor falha o handshake se o servidor escolhe um que o cliente não
  ofereceu e também se não escolhe nenhum quando algum foi oferecido (o padrão WHATWG exige o
  mesmo; o RFC 6455 exige o primeiro caso); o OkHttp 4.9.2 não olha o cabeçalho.
- **Handshake que falha.** O par fica CLOSED com código -1 e o motivo só aparece como erros do
  motor; não há status HTTP, de modo que um 403, uma chave de aceite errada e uma porta recusada
  parecem iguais. O runner admite exatamente as linhas de erro que o probe provoca (5 causas, cada
  uma seguida do "Invalid response headers." do motor, e 3 certificados) e reprova qualquer outra.
- **Um close que chega no poll que completa o handshake** leva o par de CONNECTING a CLOSED sem
  que o host veja OPEN: o host informa `websocketOpen` e depois `websocketClosed`.
- **Close sem resposta.** O motor nunca desiste de um handshake de fechamento que o servidor não
  responde, e o OkHttp cancela a chamada 60 s depois de escrever o frame de close. O host começa um
  prazo de 60 s quando pede o close, no mesmo relógio dos prazos do HTTP, derruba a conexão e
  falha o socket.
- **Motivo de close acima de 123 bytes.** O `close()` do motor ignora o resultado de enfileirar o
  frame que a wslay recusa, e o par fica em CLOSING sem enviar nada. O módulo recusa antes, com as
  palavras do OkHttp, e deixa o socket como estava.
- **TLS.** Um fechamento que o cliente começou, sobre TLS, termina com o par CLOSED e código -1: o
  frame de close do servidor e o `close_notify` chegam juntos e a leitura do motor falha. O host
  toma o fechamento como completo, com o código e o motivo que pediu, que um servidor ecoa; o
  mesmo fim sobre TCP, ou um que a aplicação não começou, é falha.
- **UTF-8 inválido.** Um frame de texto que não é UTF-8 falha o par com 1007 e o motivo "Invalid
  frame payload data" (o RFC 6455 exige falhar a conexão); o OkHttp o lê com caracteres de
  substituição.
- **Ping entre fragmentos.** O motor escreve o payload de um ping que fica entre os fragmentos
  de uma mensagem dentro dela (o RFC 6455 permite o ping ali); ele responde os pings do servidor
  sozinho.
- **Anéis.** Os anéis de 65.535 bytes não comportam uma mensagem de 1 MiB (acima do tamanho de
  entrada o par falha com 1009), de modo que o host fixa os dois em 16 MiB, o limite da fila do
  OkHttp, e `max_queued_packets` em 16.384, e confere o tamanho de saída antes de enviar, para
  o motor nunca ter que recusar (e imprimir) uma mensagem: uma que não cabe faz o módulo fechar o
  socket com 1001 e não enviar nada, como o `send` do OkHttp. Os anéis custam espaço de
  endereços, não memória residente: 40 sockets abertos de uma vez elevaram o contador de alocação
  estática do motor em cerca de 1.925 MB (uns 48 MiB por socket) e o conjunto residente em 6 MB
  (rascunho, 3 de 3 execuções).
- **`ping()`.** Uma mensagem vazia por `send` vai como frame vazio, o que o `put_packet` não faz,
  de modo que o `ping()` é uma mensagem binária vazia, como o do Android; o iOS envia um frame de
  ping, que o par do Godot não sabe enviar.

## A implementação

`native/websocket_module.{h,cpp}` é o módulo: o TurboModule C++ `WebSocketModule` (a
`NativeWebSocketModuleCxxSpec` gerada pelo RN) e as ligações de socket do `BlobModule`, sobre o
`WebSocketState` que ele guarda no `NetworkingState` da aplicação (`native/networking_state.h`,
compartilhado com `Networking`, `BlobModule` e `FileReaderModule`, que ficam em
`native/networking_modules.cpp`). O estado guarda a fase de cada socket que não terminou
(conectando, aberto ou fechando, o que o mapa de sockets abertos do Android e o estado do JS do
RN fazem juntos), os ids cujas mensagens binárias são blobs e os contadores que o instantâneo
informa em `networking.webSocket`. O módulo se registra por `TurboModuleRegistry::add` como os
demais, usa o mesmo invoker de chamadas interrompível e enfileira seus eventos pela mesma
`queue_event` do lado HTTP, de modo que todo evento de dispositivo sai pelo agendador do RN na
ordem em que foi enfileirado e é descartado quando a aplicação para.

O transporte fica atrás de `native/websocket_transport.h`: `start`, `send`, `close`, `cancel`,
`poll(orçamento de bytes)`, `stop` e um ouvinte com `on_open`, `on_message`, `on_closed` e
`on_failure`, chamado só de dentro do `poll()` na thread principal do Godot, que também é a do
JS. `native/godot_websocket_transport.cpp` é a primeira implementação: um `WebSocketPeer` por
socket, avançado pelo `ApplicationRuntime::pump` no mesmo poll de rede do transporte HTTP, com
o mesmo orçamento de bytes (uma conexão entrega ao JS no máximo 256 mensagens por pump, e a
primeira mensagem de um pump é lida seja qual for o orçamento restante, de modo que nenhum socket
espera atrás de outro). O `native/godot_tls.h` monta as opções TLS dos dois transportes (as raízes
do motor ou o PEM em que a semente de validação confia). As partes puras ficam em
`native/websocket_core.h` e têm teste C++ próprio (47 asserções em 6 grupos,
`native/websocket_core_test.cpp`): URLs lidas como o `HttpUrl` do OkHttp as lê (por
`native/http_core.h`, de modo que `ws:` e `wss:` são `http:` e `https:` por baixo, e uma URL
`http:` ou `https:` também conecta, como no Android), o Origin padrão, a lista de subprotocolos, a
validação de cabeçalhos com as mensagens do OkHttp (o valor fica fora da mensagem para os
cabeçalhos de credencial) e os parâmetros de close.

- **Conexão.** O `connect` valida o que o `Request.Builder` e o `Headers` do OkHttp validariam: a
  URL, cada cabeçalho string (um valor que não é string é ignorado e contado) e o cabeçalho de
  subprotocolos. Um pedido que não pode ser feito não lança, o que o Android faz numa thread que o
  JS nunca vê e o iOS faz como evento: vira um `websocketFailed` com a mensagem do OkHttp, de modo
  que todo `connect` termina em um close ou em uma falha; só um id que não é inteiro não negativo,
  ou que já está em uso, lança. O Origin padrão entra se o chamador não deu um. Os cabeçalhos do
  próprio handshake (`Host`, `Upgrade`, `Connection`, `Sec-WebSocket-Key`, `-Version`,
  `-Extensions` e `-Protocol`) são do motor: o valor que o chamador der para um deles é
  descartado e contado.
- **Mensagens.** O texto sai como mensagem de texto, o base64 como binária, os bytes de um blob
  como binária e o `ping` como binária vazia. O texto que chega é um evento `text`; o binário
  é base64 ou, num socket em modo blob, um blob no armazém compartilhado que o JS embrulha e
  libera. `send`, `sendBinary` e `ping` de um socket que não está aberto (desconhecido, ainda
  conectando ou já fechado pelo JS) levantam o erro de programador do Android: um
  `websocketFailed` e um `websocketClosed` com código 0, ambos "client is null"; um base64 que
  não decodifica é a falha "bytes == null" do Android e encerra o socket.
- **Close.** O `close` não faz nada para um socket desconhecido ou que já está fechando; num
  socket que ainda conecta ele falha a tentativa (a diferença deliberada em relação ao Android).
  Um código ou motivo que o OkHttp recusa é um aviso no JS e deixa o socket em paz. Um frame de
  close sem status é informado como 1005. Um socket que o servidor fecha chega como `open`, as
  mensagens e `close` com o código e o motivo do servidor.
- **Parada.** O stop da aplicação encerra o transporte primeiro: todo socket aberto recebe um
  frame de close com 1001, o motor é consultado uma vez para que o frame saia antes da conexão,
  o módulo esquece todos e nenhum evento chega ao JS depois; os métodos retidos que começam algo
  são recusados com `E_MODULE_DISPOSED`, e a limpeza tardia é inofensiva.
- **Sementes.** `validation_tls_trusted_authorities` e `validation_clock_offset_ms` são as duas
  sementes de validação que o transporte HTTP já tinha; os sockets usam as mesmas, a segunda para
  o prazo do fechamento. Um produto nunca define nenhuma das duas.

## O que foi verificado

O [servidor](../../../tests/websocket-server.mjs) é um processo filho Node, sobre `node:http`,
`node:https` e `node:net`, que implementa o RFC 6455 à mão no evento `upgrade` (handshake, frames
mascarados do cliente e sem máscara do servidor, fragmentação, ping, pong e close). Ele informa as
portas na saída padrão e registra cada conexão exatamente como aconteceu no fio: os nomes de
cabeçalho do handshake, brutos, na ordem e com duplicatas, a resposta que enviou e cada frame nos
dois sentidos, com opcode, flags, tamanho e hash do payload. Nunca espera por um relógio: um
handshake segurado fica segurado até uma requisição de controle liberá-lo ou o cliente ir
embora. Ele serve um eco, a escolha de subprotocolo, um relatório do handshake, closes com e sem
status, handshakes recusados e respondidos errado, conexões largadas e reiniciadas, um megabyte nos
dois sentidos, texto inválido, fragmentação com e sem um ping dentro, um servidor que nunca
responde um close, e wss com uma CA e uma folha assinadas em tempo de execução
([certificados](../../../tests/networking-certificates.mjs), os mesmos da suíte HTTP: só o
certificado público da CA vai para `build/`), mais uma segunda autoridade para os casos negativos
e uma porta que aceita e nunca responde. O [fixture](../../../tests/websocket-fixture.jsx) roda o
`WebSocket` público do RN em duas roots de uma aplicação e registra todo evento de todo socket na
ordem, com o estado que viu; o [probe](../../../tests/websocket-probe.gd) espera por condições,
nunca por tempo, e lê também o instantâneo de rede da aplicação.

- **Montagem, módulos e globais.** As duas roots montam pelo `AppRegistry` original de uma só
  aplicação; `WebSocketModule` e `BlobModule` carregam do host; o `WebSocket` do RN constrói sobre
  o módulo e o transporte da aplicação é o `WebSocketPeer` do Godot, sem nada aberto. Vale nos
  dois hosts o check que aceita as duas respostas (o construtor funciona ou falha com o erro de
  busca do próprio RN).
- **Estados.** Um `WebSocket` novo está CONNECTING e sem `binaryType`; `send` e `ping` em
  CONNECTING lançam `INVALID_STATE_ERR`; o `binaryType` aceita `blob` e `arraybuffer` e recusa o
  resto; o `readyState` vai de OPEN a CLOSING e CLOSED, e o `send` recusa o que não sabe enviar.
- **Eco.** Um socket abre, recebe e fecha na ordem do RN, com os estados que o RN informa e sem
  subprotocolo; um texto de vários bytes (acentos, japonês e emoji) volta inteiro, e `close(4000,
  'bye')` é o eco do servidor; arrays tipados, `ArrayBuffer`s e `DataView`s vão com seus
  deslocamentos e voltam como `ArrayBuffer`s; sem `binaryType` uma mensagem binária é um
  `ArrayBuffer`; com `binaryType = 'blob'` as mensagens binárias chegam como blobs, um `Blob`
  enviado vai com seus bytes, o texto segue texto e `arraybuffer` devolve `ArrayBuffer`s; as
  ligações do `BlobModule` rodaram (duas mensagens viraram blobs e um blob foi enviado) e os blobs
  foram fechados pelo JS e liberados, de modo que o armazém voltou ao que era; o servidor viu um
  frame de texto, um close mascarado com 4000 e `bye` e o respondeu, e os bytes do blob como um
  frame binário, com todo frame do cliente mascarado.
- **Subprotocolos.** A escolha do servidor entre os oferecidos é o `protocol` do socket, e `''`
  quando nenhum foi oferecido; os subprotocolos viajam num cabeçalho só, aparados, e os vazios e
  os que têm vírgula não são oferecidos.
- **Cabeçalhos.** Sem Origin o socket envia um feito da própria URL, como o módulo Android; os
  cabeçalhos das opções vão no handshake, um valor que não é string é ignorado e o Origin padrão
  é acrescentado; os cabeçalhos do próprio handshake continuam do motor (um `Host`, `Upgrade` ou
  protocolo que o chamador deu é descartado); um Origin do chamador é o único, seja qual for a
  caixa; o Origin padrão de uma URL wss é o https; uma URL http ou https conecta como ws ou wss,
  com a própria origem; nenhum cookie é enviado e os cabeçalhos do motor aparecem uma vez.
- **Close.** Um close que o servidor inicia de imediato chega como open e depois close, com o
  código e o motivo do servidor e sem erro, e o mesmo vale para um close depois de uma mensagem;
  um frame de close sem status é 1005 sem motivo; `close()` envia 1000 sem motivo, e um código e
  um motivo vão como dados; um motivo acima de 123 bytes, um código reservado e um fora da faixa
  são recusados como o OkHttp os recusa, e o socket continua aberto; um `send` depois de
  `close()` falha o socket com o "client is null" do Android antes de o servidor responder; o
  servidor recebeu a mensagem enviada depois do close recusado e encerrou o socket; viu os frames
  de close com seus códigos e motivos e um fim TCP limpo.
- **Close durante a conexão.** O servidor recebeu o handshake e o segura; `close()` em CONNECTING
  encerra a tentativa com um erro e um close, sem open; a conexão da tentativa é fechada, o que o
  servidor viu enquanto ainda segurava o handshake; o módulo contou o fechamento, soltar o
  handshake retido não abriu nada e nada chega ao socket depois do close.
- **Falhas.** Um handshake que o servidor recusa (403, 401 ou uma chave de aceite errada) ou uma
  porta que recusa é um erro e um close com código 1006; uma URL que o OkHttp não lê falha com as
  palavras do OkHttp em vez de lançar; um cabeçalho ou subprotocolo que o OkHttp recusa falha o
  socket com a mensagem dele; uma conexão cortada depois de aberta, por FIN ou por reset, é um
  erro e um close 1006 depois do open; o servidor registrou cada recusa e a conexão que cortou, e
  um pedido que o host recusa por conta própria nunca chega ao servidor.
- **Limites do motor.** O motor é tão estrito quanto um navegador: um subprotocolo que o cliente
  nunca ofereceu, ou nenhum quando algum foi oferecido, falha o handshake (o OkHttp aceita os
  dois); um frame de texto que não é UTF-8 falha o socket com 1007; esteja ou não o motor
  entregando as mensagens escritas com um frame de close, o close chega com o código e o motivo do
  servidor; um ping entre fragmentos não impede o socket de fechar; o servidor escreveu as três
  mensagens e o frame de close.
- **Mensagens grandes.** Uma mensagem de 1 MiB, binária ou de texto, vai ao servidor e volta
  inteira; 1 MiB que o servidor envia chega inteiro, como `ArrayBuffer` e como blob; os hashes do
  próprio servidor concordam com o que o JS enviou e recebeu; o transporte contou os megabytes nos
  dois sentidos; uma mensagem que não cabe nos 16 MiB que o OkHttp enfileira fecha o socket com
  1001 e nada é enviado.
- **Frames.** As mensagens fragmentadas chegam como uma mensagem cada; o motor responde o ping do
  servidor com um pong que leva o payload e o JS não vê nada disso; o `ping()` envia uma
  mensagem binária vazia, como o módulo Android, e o eco dela é um `ArrayBuffer` vazio.
- **TLS.** Um servidor certificado pela autoridade em que a semente confia responde por wss; um
  certificado de autoridade não confiável é um erro e um close 1006; sem a semente só valem as
  raízes padrão do Godot, entre as quais a CA de teste não está; a confiança segue a autoridade
  configurada (o certificado do outro servidor verifica e o do primeiro não); um PEM inválido
  recusa o socket em vez de confiar em tudo. O runner admite exatamente os três erros de handshake
  que o motor imprime para esses casos.
- **Contrato nativo.** Os quatro eventos de dispositivo trazem um objeto cada, com as chaves do RN
  Android: `open {id, protocol}`, `message {id, type, data}` e `closed {id, code, reason}`, e o de
  falha com `{id, message}`; `send`, `sendBinary` e `ping` de um socket que não está aberto levantam
  o erro de programador do Android (uma falha e um close que dizem "client is null") e o `close` não
  diz nada; bytes que não são base64 falham o socket com "bytes == null", e a falha é o último
  evento dele; um id em uso e um que não é id são recusados por exceção; fechar um socket que ainda
  conecta o encerra com uma só falha; o servidor viu o socket falhado fechado com 1001 e recebeu o
  texto, os três bytes e a mensagem binária vazia do ping.
- **Duas roots.** Cada root abre três sockets ao mesmo tempo que a outra e recebe só as mensagens
  dos seus; nada fica aberto.
- **Prazo do close.** Um close que o servidor nunca responde termina com um erro e um close 1006
  quando o prazo do host passa (pela semente do relógio, sem espera), e o servidor tinha recebido
  o frame de close e não enviou nada de volta.
- **Contas.** Nenhum socket sobra; todo connect terminou de um só jeito: recusado, fechado ou
  falhado; todo socket que o transporte iniciou terminou em um close, uma falha ou um
  cancelamento; as contas de mensagens e bytes do módulo concordam com as do transporte; todo
  evento enfileirado foi entregue ou descartado.
- **Parada.** Quatro sockets estão em voo (dois abertos, um deles com uma mensagem blob, um
  fechando num servidor que nunca responde e um conectando); parar fecha os sockets em voo,
  esquece-os, libera os blobs e não deixa nada ativo; o servidor viu 1001 em cada socket aberto, a
  conexão que ainda conectava largada e a que fechava num servidor mudo também largada; as
  limpezas das roots rodam e nada mais chega ao JS (nenhuma mensagem, erro ou close de um socket
  que estava em voo); nenhum evento de dispositivo é entregue pela aplicação parada e os
  enfileirados são contabilizados; métodos retidos que começam algo e uma nova busca são
  recusados; a limpeza tardia e os envios tardios são inofensivos; o `disposeEnvironment` não
  deixa assinatura de dispositivo para trás; parar as duas roots não gera diagnóstico do host.

O [oráculo](../../../tests/websocket-oracle.mjs) não confia em nenhum veredito do probe: ele declara,
para cada uma das 59 conexões que os casos abrem, o que o servidor deve ter recebido e enviado (das
constantes e do padrão de bytes do próprio servidor), lê o que o servidor registrou e compara os
dois com o que o JS observou: o handshake (um só `Host`, `Upgrade`, `Connection`, versão e Origin;
uma chave de 16 bytes que nenhuma outra conexão reutilizou; nenhum cookie), todo frame que um cliente
enviou mascarado, as mensagens de dados de cada sentido byte a byte, os frames e códigos de close,
como cada conexão terminou no servidor e, em 52 sockets, que o JS viu as mesmas mensagens e terminou
como o caso documenta. Ele amarra os contadores nativos ao registro do servidor por aritmética: o
transporte enviou tantas mensagens e bytes quantos o servidor recebeu, leu o que o servidor enviou
menos as mensagens que o motor descarta ou recusa, iniciou toda conexão que o servidor viu mais as
seis que ele não podia ver (duas portas recusadas, uma que nunca responde e três certificados não
confiáveis), e todo connect terminou como recusa, close, falha ou o stop que encerrou quatro. O
runner também reprova qualquer linha de erro do motor, de script ou do nativo que não esperava e
roda o oráculo sobre uma cópia do relatório com todos os checks marcados como aprovados, que um
host errado ainda precisa reprovar.

Na execução do recibo o servidor registrou 59 conexões (55 no ouvinte ws, 3 em wss e 1 em wss com a
segunda autoridade): 55 foram respondidas com 101, uma com 403 e outra com 401, e duas ficaram
seguradas sem resposta; 50 terminaram com a troca de close, 2 foram largadas pelo cliente antes de
abrir, 2 recusadas, 1 trouxe uma chave de aceite errada, 2 foram largadas pelo cliente por causa do
subprotocolo e 2 foram cortadas pelo servidor. Foram 34 mensagens do cliente (20 de texto e 14
binárias) e 48 do servidor (31 de texto e 17 binárias, as fragmentadas contadas como uma só), 71
connects no JS, 65 iniciados no transporte e 52 abertos.

## Controles

O host anterior roda o mesmo bundle: as roots montam e param sem diagnóstico e os checks de
JavaScript passam, mas o primeiro `new WebSocket` lança `TurboModuleRegistry.getEnforcing(...):
'WebSocketModule' could not be found`. Falham exatamente os 81 checks que precisam do módulo
(módulos, estados, eco, subprotocolos, cabeçalhos, closes, conexão, falhas, limites, mensagens
grandes, frames, TLS, contrato, roots, prazo, contas e parada) e passam os 12 restantes
(montagem, o construtor que aceita as duas respostas, o pedido que o host recusa por conta própria,
o fim das roots, as contas de eventos e de assinaturas e a parada sem diagnóstico); nenhuma conexão
chega ao servidor, e o oráculo rejeita o relatório.

A sabotagem `origin` troca a condição que acrescenta o Origin padrão por uma que nunca acrescenta:
um socket aberto sem Origin envia nenhum, onde o módulo Android envia o origin da URL, e o registro
do handshake do servidor mostra isso. Falham exatamente 4 checks (o Origin sem cabeçalho dado, o
Origin padrão com cabeçalhos das opções, o de uma URL wss e o de uma URL http) e o oráculo rejeita
o relatório na primeira conexão ("connection 1 /echo?case=states carries exactly one Origin").

A sabotagem `stop` troca o código com que o stop da aplicação fecha os sockets, 1001 (a saída de
quem vai embora), por 1000: o servidor registra o frame de close errado. Falham exatamente 2 checks
(o socket que o módulo encerra com "bytes == null", visto fechado com 1001, e os sockets em voo no
stop) e o oráculo rejeita o relatório.

Em cada sabotagem o `scripts/websocket-sabotage.mjs` confere que a âncora aparece uma só vez,
compila, roda o runner com a flag da variante, restaura a fonte byte a byte, prova isso por hash e
recompila o host genuíno, cujo hash volta ao executado. O recibo local registra as fontes, os hosts
e os resultados. A suíte passa também sem nenhum recibo de controle, como na CI, e sob carga de CPU
(14 processos `yes` em 11 núcleos): nenhum check depende do ritmo da máquina, porque as esperas são
condições, o prazo de 60 s do close passa pela semente do relógio e o servidor nunca depende de um
temporizador.

A suíte de networking da fatia anterior ganha dois checks normativos: `modules/WebSocketModule is
provided by the native host` e `modules/RN's own WebSocket constructs over the native module`. Ela
segue com 100 checks, mas o controle do host anterior dela falha 86 (eram 84) e 14 valem nos dois
hosts (eram 16); as sabotagens dela seguem falhando 8 e 2.

## Capturas

`npm run example -- networking --capture` salva onze quadros do renderizador nativo do exemplo, que
agora tem dois cards, e a validação confere o selo, os textos e o registro de cada um, com cliques
reais do mouse. Os seis do card de fetch foram tirados de novo com o novo leiaute
([ocioso](networking-idle.png), [GET JSON](networking-json.png), [POST form](networking-form.png),
[redirecionamento](networking-redirect.png), [lento](networking-pending.png) e
[abortado](networking-aborted.png)); os seis de [`docs/evidence/networking`](../networking/README.md)
ficam como a história da primeira fatia. Os cinco do card de WebSocket são
[Connect](websocket-open.png) (selo verde `WebSocket: open`, o protocolo `echo.v1` que o servidor
escolheu entre os dois oferecidos), [Send](websocket-echo.png) (o texto `olá, servidor` de volta,
com o log de `open`, `send` e `echo`), [Server close](websocket-server-close.png) (selo cinza
`WebSocket: closed 4001`, o motivo `closed by the server`), [Drop](websocket-dropped.png) (selo
vermelho `WebSocket: failed`, a mensagem de conexão perdida sem frame de close e o log `close 1006`)
e [Close](websocket-closed.png) (selo cinza `WebSocket: closed 1000`, o motivo `done`). O recibo
registra o SHA-256 e as dimensões (900 × 680) de cada uma, e o
[exemplo](../../../examples/networking/README.md) as mostra com a explicação de cada estado. A linha
de URL de cada card mostra a porta efêmera do servidor local, de modo que os bytes de todas as
onze mudam de uma execução para outra (conferido em três execuções).

## Regressões

Na execução, sobre a árvore commitada `16dd2be` e no mesmo host (`40f53ec9`), passaram os três
gates do job `contracts` (265 testes Node e 13 Python, análise estática e scan de publicação), o
`test:recovery`, as 38 suítes nativas (30 exemplos com 2.377 checks, o `networking` com 29 e 51 com
captura; guards de transform 61 e 25 de entrada, mais as lanes de escala uniforme, 29, e singular,
49; Down 2.731 nas oito lanes, query faults 187, resolver faults 66, Document Up 6.459, View Up 297,
Move 220, Document Move 1.940, hover 158, caminho da raiz 82, hover em Document 1.530, click 728,
notificações de captura 672, PanResponder 128, AppState 75, listas 44, Appearance 79, Switch 108,
toques compartilhados 92, touchables 93 (a lane `animated` com 7), ActivityIndicator 33, Animated
75, relógio de quadros 37, Networking 100 e o próprio WebSocket 93) e o lote do SDK nativo (affine,
codegen, pack/verify, registro e loader de adapters, runtime de adapters, consumidor independente,
cold start e `parity:godot`), este em diretórios novos, apagados depois. Cada suíte manteve a
contagem do recibo anterior, a do exemplo de networking à parte: os exemplos passaram de 2.364 para
2.377 checks pelo segundo card (o exemplo de networking, de 16 checks headless e 28 com captura
para 29 e 51). O controle de host anterior e as duas sabotagens foram refeitos na
mesma árvore, nessa ordem (controle, sabotagens, a lane sem os recibos de controle, como na CI, e a
lane atual, que compara com eles), para a suíte de WebSocket e depois para a de networking, com a CI
do job `native-cold-start` como roteiro dos passos; o exemplo rodou headless (29 checks) e com
captura (51), e as suítes de WebSocket e de networking rodaram três vezes cada uma sob carga de CPU
a partir da árvore commitada.

O `src/initialize.js` (um comentário sobre a importação do `setUpXHR`) e o host novo tornaram
defasados os controles de host anterior e as sabotagens que as suítes do Animated, do relógio de
quadros e dos guards de transform guardam só em `build/`; eles foram refeitos nos hosts anteriores
preservados antes do commit, e as três suítes passaram da árvore commitada sem outro ajuste. A CI
não os tem e não é afetada.

## Observações fora do recibo

Rodadas com scripts de rascunho na árvore commitada, não afirmadas pela suíte:

- Quarenta `WebSocketPeer`s abertos de uma vez contra o servidor local, com os anéis de 16 MiB e as
  16.384 mensagens enfileiradas do host, ficaram todos OPEN: o contador de alocação estática do
  motor foi de 23,2 MB a 1.948,4 MB (uns 48 MiB de espaço de endereços por socket) e o conjunto
  residente do processo de 114,4, 114,6 e 114,7 MB a 120,2, 120,4 e 120,4 MB em três execuções, de
  modo que as páginas só são confirmadas conforme as mensagens as usam. Um ambiente que limita o
  espaço de endereços ou não aceita overcommit sentiria os 48 MiB por socket.
- A reprodução da godotengine/godot#115384 não entregou nenhuma das três mensagens escritas num
  só write com o frame de close, na execução da suíte e em 3 de 3 execuções de rascunho, e nenhuma
  variação de polling em volta do frame de close as recuperou.
- Três execuções de captura do exemplo deram três arquivos diferentes para cada um dos onze quadros,
  porque a linha de URL de cada card mostra a porta efêmera do servidor local.
- A suíte passou 9 de 9 execuções sob carga (14 laços ocupados em 11 núcleos), 3 na árvore anterior
  à divisão do módulo em sua própria unidade, 3 depois dela e 3 a partir da árvore commitada, e
  passa sem os recibos de controle, como na CI.

## Limites

- **Perda de mensagens no close.** O motor descarta as mensagens que o servidor escreve no mesmo
  poll que o frame de close e as que chegam depois do close do próprio cliente
  ([godot#115384](https://github.com/godotengine/godot/issues/115384)); o host não as recupera. A
  suíte reproduz a perda sem exigi-la.
- **Ping entre fragmentos.** O motor funde o payload do ping na mensagem; a suíte registra o que o
  JS recebeu e confere que um pong com o payload voltou.
- **Extensões, cookies e tempo limite de conexão.** Não há `permessage-deflate` (o OkHttp o oferece,
  o motor não oferece nenhuma extensão), nem cookies, nem tempo limite de conexão (o do Android é
  de 10 s); um `Host`, `Upgrade`, `Connection`, `Sec-WebSocket-Key`, `-Version`, `-Extensions` ou
  `-Protocol` dado pelo chamador é descartado, porque o handshake é do motor, e só os casos de
  `Host`, `Upgrade` e do cabeçalho de subprotocolo têm check próprio. O OkHttp mantém um `Host` do
  chamador e recusa um `Sec-WebSocket-Extensions`.
- **O motor é mais estrito que o OkHttp.** Um servidor que não escolhe subprotocolo, ou escolhe um
  que não foi oferecido, falha o socket; um texto que não é UTF-8 falha com 1007; um handshake
  que falha não traz status HTTP.
- **`close()` em CONNECTING.** Falha o socket, como o de um navegador (o padrão WHATWG falha a
  conexão), onde o módulo Android não faz nada e o socket abre mesmo assim; é uma diferença
  deliberada em relação ao Android.
- **Fechamento sobre TLS.** O fechamento que o cliente começou é tomado como completo com o código
  e o motivo que ele enviou, porque o motor o termina sem o frame de close do servidor.
- **Anéis de 16 MiB.** Reservam uns 48 MiB de espaço de endereços por socket aberto (cerca de 6 MB
  residentes para 40 sockets, em rascunho); a aplicação não escolhe um tamanho menor.
- **Contrato Android.** O módulo iOS (nenhum evento para um socket ausente, um frame de ping de
  verdade, a flag `clean`) exigiria um segundo módulo; os textos de falha são os do host e do
  motor, não os das exceções do OkHttp.
- **Fachada.** O `WebSocket` é o global do RN; a fachada `react-native` não ganha export.
- **Plataformas.** Só macOS arm64 foi executado; exports Android (permissão `INTERNET`), iOS e Web
  (o `WebSocket` do navegador não aceita cabeçalhos), hardware real, rede offline e reconexão não
  foram exercitados.
- **CI.** A CI hospedada desta fatia está pendente.

Nenhum GF, checkpoint, peso ou denominador fecha: o checkpoint de fatia do GF-22 já fechou com o
[registro da rede](../networking/README.md), e esta é a segunda fatia dele.
