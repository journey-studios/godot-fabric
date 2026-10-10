# O `.app` Release do Frontier em outra máquina: o runner hospedado (V05-07, critério `limpa`)

Registro do run 38085526897 do workflow Contracts, disparado na `main` em `4767cd1f682dcbe540fa444b9af14f27790db6a1` (o squash do [#147](https://github.com/journey-studios/godot-fabric/pull/147)), que passou os **nove jobs** na primeira tentativa, `macos-clean-run` inclusive. Fecha o critério `limpa` do V05-07 **no limite abaixo**, que a decisão de 2026-10-10 escolheu no lugar de um segundo Mac ou VM sem Node, Godot e Xcode: um runner hospedado do GitHub, com a imagem que traz Node e Xcode.

## O que foi provado

- O `Frontier.app` Release, assinado ad hoc e exportado no job `native-suites-runtime`, foi arquivado, baixado por **outro job**, em **outra VM**, e tocou ali o replay de 12 turnos (77 intents) **três vezes**, cada uma em um perfil de dados que não existia antes e foi removido depois, com o ambiente zerado por `env -i` (só `HOME`, `USER`, `TMPDIR` e `PATH=/usr/bin:/bin:/usr/sbin:/sbin`). As três chegaram ao mesmo **hash dourado** `cb7ab974…540e8d` e ao mesmo **hash de trilha** `ed43495e…66275e` que o lane headless fixa (`tests/civ-lite-game-native.test.mjs`), com 246 de 246 checks do próprio gate, e com relatórios idênticos byte a byte.
- O que chegou à segunda máquina é o que saiu da primeira: o SHA-256 do arquivo `.tar.gz` (`b7ebb7ba…f0f564`) e o hash do bundle desempacotado (`48f648b1…8d4339`, o `hashApp` do lane) são os do registro do uploader, e o hash do bundle é o mesmo depois das execuções.
- `codesign --verify --deep --strict` passa no app, no executável, no host e nos dois frameworks, **antes e depois** das execuções (10 de 10), e a assinatura é ad hoc (`Signature=adhoc`, `TeamIdentifier=not set`). `otool -L` e os `LC_RPATH` dos quatro binários só nomeiam o bundle (`@rpath`, `@loader_path`, `@executable_path`) e o sistema (`/System/Library`, `/usr/lib`).
- A máquina é **outra** e **está limpa** no que o job mede: nenhum `godot` no PATH, nenhum `Godot*.app` em `/Applications` nem em `~/Applications`, nenhum `~/Library/Application Support/Godot`, e nenhum `.deps`, `node_modules` ou `.godot` no workspace (sete verificações, nenhuma achada). O job não instala nada: sem `install-godot`, sem host nativo, sem `npm ci`, sem `setup-node`; o checkout existe só para o script de julgamento, o oráculo do replay e o roteiro do jogo.
- Três controles negativos, retidos no próprio job, foram rejeitados, de modo que o job não passa em vazio (seção abaixo).

## O limite

O runner é uma **VM nova com um usuário limpo, sem Godot, sem `.deps` e sem dependências do projeto**, mas **a imagem do runner traz Node e Xcode** (`macos-15-arm64`, versão `20260907.0337.1`): o Node do job é o `node@22` do Homebrew (v22.23.2) e `xcode-select -p` aponta para `Xcode_16.4`. O app é **mostrado sem usá-los, não rodado sem eles**: o ambiente em que ele corre tem só quatro variáveis e o PATH é `/usr/bin:/bin:/usr/sbin:/sbin` (o job confere que nenhum `node`, `godot` ou `Godot` está nesses diretórios), e os load commands só nomeiam o bundle e o sistema. Não houve rastreamento do processo: a afirmação é a do ambiente e a dos load commands. O Node rodou **só como juiz**: lê arquivos, desempacota, confere hashes e assinaturas e inicia o app; o jogo nunca o vê.

Também não é um Mac físico de outra pessoa nem uma VM do desenvolvedor. A assinatura é ad hoc: Developer ID e notarização seguem fora (ver "Abertos").

## O run e os jobs

| o quê | onde |
| --- | --- |
| run | [38085526897](https://github.com/journey-studios/godot-fabric/actions/runs/38085526897): Contracts, `workflow_dispatch`, ramo `main`, `4767cd1`, tentativa 1, os nove jobs em success (de 20:53:44Z a 21:32:22Z de 2026-10-10) |
| job `macos-clean-run` | [114318383129](https://github.com/journey-studios/godot-fabric/actions/runs/38085526897/job/114318383129): runner `GitHub Actions 1000008097`, 21:31:58Z a 21:32:21Z; o passo que julga durou 8 s |
| job `native-suites-runtime` (o uploader) | [114312595729](https://github.com/journey-studios/godot-fabric/actions/runs/38085526897/job/114312595729): runner `GitHub Actions 1000008063`, 21:01:43Z a 21:31:49Z; exportou o app (`npm run test:export:civ-lite`) e o arquivou no último passo |
| artefato `macos-clean-run` | id 11682881291, 25.556 bytes, zip SHA-256 `59a39cc1…6b635c`: `clean-run.json`, o registro do uploader, os três relatórios e os três logs |
| artefato `frontier-release-app` | id 11682970753, 36.669.826 bytes, zip SHA-256 `2cd130d2…e86ab9`: o `Frontier.app.tar.gz` e o registro; **dura um dia** (`retention-days: 1`), por isso o registro está commitado aqui |
| artefato `native-macos-export-civ-lite` | id 11683390244: o `report.json` do lane do mesmo run, cujo `app.sha256` é o mesmo hash de bundle `48f648b1…8d4339` |
| código | [#147](https://github.com/journey-studios/godot-fabric/pull/147), `4767cd1`: [`scripts/macos-clean-run.mjs`](https://github.com/journey-studios/godot-fabric/blob/4767cd1f682dcbe540fa444b9af14f27790db6a1/scripts/macos-clean-run.mjs), [`tests/macos-clean-run.test.mjs`](https://github.com/journey-studios/godot-fabric/blob/4767cd1f682dcbe540fa444b9af14f27790db6a1/tests/macos-clean-run.test.mjs) e o job no [workflow](https://github.com/journey-studios/godot-fabric/blob/4767cd1f682dcbe540fa444b9af14f27790db6a1/.github/workflows/contracts.yml) |

O log do job termina o passo com `MACOS_CLEAN_RUN_PASSED: hosted-runner runs=3 golden=cb7ab974…540e8d trace=ed43495e…66275e`. A API lista sete passos no job: preparação, `actions/checkout` (com `persist-credentials: false`), `actions/download-artifact`, o passo que roda `node scripts/macos-clean-run.mjs run`, `actions/upload-artifact`, o pós-checkout e o encerramento; nenhum instala Godot, Node ou dependência.

## As duas máquinas

O job `macos-clean-run` precisa de um runner de nome diferente do uploader; o resto é registrado e comparado, não julgado.

| | uploader (`native-suites-runtime`) | runner limpo (`macos-clean-run`) |
| --- | --- | --- |
| nome do runner | `GitHub Actions 1000008063` | `GitHub Actions 1000008097` |
| imagem | `macos-15-arm64` `20260907.0337.1` | a mesma |
| sistema | macOS 15.7.9 (24G830), kernel 24.6.0 | o mesmo |
| hostname do kernel (`uname -a`) | `iad20-gt1019-…` | `sjc22-bm211-…` |
| hora do boot | 2026-10-10T20:58:12Z | 2026-10-10T21:29:20Z |
| hardware | Apple Virtual Machine 1 (`VirtualMac2,1`), Apple M1 (Virtual), 3 núcleos, 7 GB | o mesmo |
| UDID de provisionamento (hash) | `fba4155b…` | `253a472e…` |
| número de série e UUID de hardware (hashes) | `75a3a7e0…` e `f241f037…` | **os mesmos** |

O número de série e o UUID de hardware (só os hashes são guardados, nunca os valores) são iguais nas duas VMs, que partem da mesma imagem; por isso **não distinguem** as máquinas, e o job não os julga. Distinguem-nas o nome do runner, o hostname, a hora do boot (31 minutos de diferença) e o UDID de provisionamento. O usuário nas duas é `runner`.

## As três execuções

Cada execução é `/usr/bin/env -i HOME=… USER=… TMPDIR=… PATH=/usr/bin:/bin:/usr/sbin:/sbin <executável> --headless -- --validate-replay`, a partir de um diretório vazio fora do workspace, com o app desempacotado fora do workspace.

| execução | saída | hash dourado | hash de trilha | checks do gate | perfil antes / depois | SHA-256 do relatório | SHA-256 do log |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `replay-clean-1` | 0 | `cb7ab974…540e8d` | `ed43495e…66275e` | 246 de 246 | não existia / removido | `69fd2dc7…1eb01e` | `83345ca6…766f7a` |
| `replay-clean-2` | 0 | `cb7ab974…540e8d` | `ed43495e…66275e` | 246 de 246 | não existia / removido | `69fd2dc7…1eb01e` | `77438250…9f6cd2` |
| `replay-clean-3` | 0 | `cb7ab974…540e8d` | `ed43495e…66275e` | 246 de 246 | não existia / removido | `69fd2dc7…1eb01e` | `68642513…af49d4` |

Cada execução reporta `template` e `release` verdadeiros e `debug` e `editor` falsos, `headless`, o executável do app desempacotado, o projeto `Frontier Export <token>` e o diretório de dados esperado. O julgamento de cada uma é o do lane (`judgeReplayRun`), o do oráculo independente (`tests/macos-export-civ-lite-oracle.mjs`, que lê o roteiro do próprio `replay.gd`, refaz o hash dourado do estado final e o de trilha dos 77 hashes por passo) e o dos marcadores impressos (`CIVLITE_REPLAY_HASHES` e `CIVLITE_REPLAY_PASSED: 246`).

## As cargas do binário

| binário | load commands | rpaths |
| --- | --- | --- |
| executável (`Contents/MacOS/Frontier Export <token>`) | 30, todos de `/System/Library` e `/usr/lib` | `@executable_path/../Frameworks`, `@executable_path` |
| `fabric_godot.dylib` (o host) | 5: três `@rpath` e dois de `/usr/lib` | `@loader_path/frameworks` |
| `hermesvm.framework/hermesvm` | 6: o próprio `@rpath`, mais sistema | nenhum |
| `ReactNativeDependencies.framework/ReactNativeDependencies` | 9: o próprio `@rpath`, mais sistema | nenhum |

## Os controles negativos

Rodam no próprio job, depois das três execuções, e cada um tem de ser rejeitado, ou o veredito falha ("o job poderia passar sem o juiz nem a verificação da assinatura morderem").

| controle | o que faz | resultado no run |
| --- | --- | --- |
| `wrongGoldenPin` | o mesmo relatório real da execução 1, julgado contra um hash dourado com o primeiro dígito trocado (`0b7ab974…`) | rejeitado: "its golden hash cb7ab974… differs from the pinned 0b7ab974…" (2 problemas), e aceito (0 problemas) contra o pin real |
| `tamperedCopy` | cópia do app com **um byte do PCK** trocado (deslocamento 1.445.954 de 2.891.908); a cópia, antes da troca, passa `codesign` | `codesign` falha depois da troca ("a sealed resource is missing or invalid", status 1) e o hash do bundle difere do registro (`81d39fd4…`) |
| `dirtyProfile` | um perfil criado de propósito antes de uma execução | a mesma guarda das execuções o recusa ("the user profile … exists before the run") e nada fica depois |

## Os arquivos

- [`clean-run.json`](clean-run.json): o resumo do job (veredito `passed`, `claim: hosted-runner`, o limite, as duas máquinas, as verificações, as três execuções, os negativos). É uma cópia com os caminhos absolutos do runner (o diretório home, o TMPDIR e o workspace) trocados por `<HOME>`, `<TMPDIR>` e `<workspace>`, porque o `check:publication` recusa esses prefixos; o original (SHA-256 `e14faa51…976da6`) está no artefato `macos-clean-run`.
- [`frontier-release-app.json`](frontier-release-app.json): o registro do uploader, byte a byte o mesmo nos dois artefatos (SHA-256 `2a4c1599…8737fc`): SHA-256 e tamanho do arquivo, hash do bundle, hash do PCK, os pins, o commit de origem e a máquina que o fez.
- [`report.json`](report.json): o run, os nove jobs, os artefatos com id e digest, os pins, as duas máquinas, o veredito e o SHA-256 das cinco fontes executadas em `4767cd1`.

## Repetir

O que o CI faz, no ramo que se quer julgar:

```sh
gh workflow run contracts.yml --ref <ramo>
```

O job `macos-clean-run` só existe em execuções disparadas à mão e depende do `native-suites-runtime`. Na máquina do desenvolvedor, a mesma lógica roda como **ensaio**, com um app exportado de uma árvore commitada e limpa (a exportação recusa uma árvore suja):

```sh
MACOS_EXPORT_TEMPLATE="$PWD/build/macos-arm64-template.zip" npm run test:export:civ-lite
node scripts/macos-clean-run.mjs pack --app build/macos-export-civ-lite-native/Frontier.app \
  --lane-report build/macos-export-civ-lite-native/report.json --out "$TMPDIR/frontier-release-app"
node scripts/macos-clean-run.mjs run --local --archive "$TMPDIR/frontier-release-app/Frontier.app.tar.gz" \
  --record "$TMPDIR/frontier-release-app/frontier-release-app.json" --out "$TMPDIR/macos-clean-run"
```

`--local` relaxa só as asserções que uma máquina limpa cumpre (nenhum Godot ali, outra máquina que o uploader): o resumo diz `claim: local-rehearsal` e **não reivindica nada**; o script recusa a opção no GitHub Actions e recusa rodar sem ela fora do Actions. A metade sem template, que não roda Godot e está em `npm run test:contracts`, é `node --test tests/macos-clean-run.test.mjs`.

## CI hospedada e Pages

Estes são os recibos deste registro (#150, squash `7e6f0b1`). A prova do critério é o run 38085526897, descrito acima.

**O run.** O push da `main` em `7e6f0b1` rodou a Contracts (run [38089562271](https://github.com/journey-studios/godot-fabric/actions/runs/38089562271)), que passou na primeira tentativa:
- `contracts`, `reference-android` e `reference-ios` em success;
- os jobs nativos e o `macos-clean-run` pulados, porque um push não os roda e este registro não tem passo nativo próprio.

O passo da guarda de marco (X9 e X10) passou contra o pai do squash. O job `contracts` passou `npm run test:contracts` (7, 43 e 736 testes de Node, com o único pulo da lista explícita). O [recibo](hosted-ci.json) guarda os jobs, os passos e os digests.

**O Pages.** O push de `7e6f0b1` rodou o workflow do Pages: run [38089562266](https://github.com/journey-studios/godot-fabric/actions/runs/38089562266), com `build` e `deploy` em success e 43 testes do painel passando. O [recibo](publication.json) registra:
- o deployment 6987435420, em success;
- o artefato `github-pages` que ele usou (id 11683477948, SHA-256 `ca70b042…`);
- que o `migration.json` publicado é o commitado em `7e6f0b1`, com a entrada de atividade do critério (`milestone-0-5-v05-07-limpa-813e9b3`).

O `--work-dir` abaixo é um exemplo: qualquer diretório fora do repositório serve.

```sh
node scripts/hosted-receipts.mjs --write --slice macos-export/clean-machine --work-dir "${TMPDIR:-/tmp}/godot-fabric-hosted-receipts"
node scripts/hosted-receipts.mjs --check
```

## Abertos

- Developer ID e notarização: o app é ad hoc, e nada aqui os reivindica.
- Um Mac ou uma VM sem Node e sem Xcode de fato: este registro prova o app **sem usá-los** numa imagem que os traz. O iPhone segue NO-GO (X8).
- O artefato `frontier-release-app` expira em um dia; o `macos-clean-run` e o `native-macos-export-civ-lite` duram até 2027-01-08. Os recibos de CI hospedada e de Pages deste registro estão na seção "CI hospedada e Pages".
