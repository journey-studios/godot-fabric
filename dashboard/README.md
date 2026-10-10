# Dashboard de migração

Painel local em português, sem build de frontend ou dependências adicionais.
Os dados são renderizados de `dashboard/migration.json`. Roadmap GF-01–GF-40,
fases M0–M5, sequência da Arquitetura 2.0, marco HUD/inventário, aceite da
release e decisões arquiteturais estão incluídos.

```sh
node scripts/migration-dashboard.mjs
# http://127.0.0.1:4317
node scripts/migration-dashboard.mjs check
node --test tests/migration-dashboard.test.mjs tests/agents-board.test.mjs
```

Busca, filtros de fase/status/prioridade e detalhes de cada item funcionam
com teclado. `/` foca a busca; Escape limpa seus filtros. Os chips de
dependência abrem o item correspondente. “Ao vivo” lê o JSON a cada cinco
segundos, sem recarregar a página. “Atualizar” força uma leitura. Um JSON
inválido ou uma falha de conexão preserva a última versão válida e mostra
o erro; a próxima atualização recupera o painel.

O servidor aceita somente leitura e escuta em `127.0.0.1`. Não exige Godot,
setup nativo, npm install ou acesso à internet. As fontes já pertencem ao
repositório e são servidas localmente; as evidências abrem links no GitHub.

## Percentual

Cada item contém checkpoints de acompanhamento com `done` e `evidence`.
Seu progresso é a proporção de checkpoints concluídos. A release usa a
média ponderada por `weight` dos itens com `releaseRequired: true`.
Os pesos iniciais são iguais. GF-40 é escopo posterior e fica fora da 1.0.
Os percentuais de fases/sequências usam a mesma fórmula dentro de seu recorte.
Um item que aparece em duas sequências conta uma única vez no total da release.

Este número mede critérios de acompanhamento, não horas, esforço ou paridade
de cada API. Os checkpoints iniciais separam uma fatia funcional comprovada,
o contrato completo, a certificação positiva/negativa contra RN e o aceite
das dependências/alvos. O resultado completo de cada item permanece em
`acceptance`, copiado integralmente do roadmap. Se os checkpoints forem
detalhados depois, registre a mudança de denominador no histórico.

O snapshot inicial identifica o commit da PR #14 e inclui fatias já integradas
ao main. Há 14 fatias documentadas, 39 itens obrigatórios e nenhum item
com aceite completo: **9,0% de checkpoints, 0/39 itens fechados**. Os links
de evidência apontam ao commit, sem depender do head mutável da PR.
Uma PR/CI verde ou compilação iOS não fecha o contrato completo do item.

## Atualizar o JSON

1. Localize o item pelo `id`; preserve IDs, aceite, dependências e escopo.
2. Use `planned`, `in_progress`, `blocked` ou `complete`. Um bloqueio exige
   `blocker` com a causa real. Dependências ainda abertas não tornam
   automaticamente o item bloqueado; fatias podem avançar antes de seu fechamento.
3. Marque `checkpoints[].done` somente com evidência executada. Cada checkpoint
   concluído exige pelo menos `{ "label": "...", "url": "https://..." }`.
   A evidência deve registrar fonte/commit, versões, plataforma, comando,
   resultado e limitações, conforme o roadmap.
4. Use `complete` somente com todos os checkpoints concluídos e dependências
   completas. Checklist de integração/release também exige evidência para `done`.
5. Atualize `updatedAt` com ISO 8601, `source` para o commit/escopo correto,
   `project.focusSequence`/`focusTitle` e acrescente uma entrada a `activity`.
6. Execute `node scripts/migration-dashboard.mjs check`. Publique o JSON
   por escrita temporária + rename para evitar leituras de conteúdo parcial.

Exemplo de checkpoint:

```json
{
  "id": "slice",
  "label": "Refs e invalidação comprovadas no host",
  "done": true,
  "evidence": [{
    "label": "Relatório macOS / commit exato",
    "url": "https://github.com/journey-studios/godot-fabric/blob/4085865a309de62cf4e893324f485439f5fb4b55/docs/evidence/native-foundation/README.md"
  }]
}
```

## Sincronizar mudanças do planejamento

`ROADMAP.md` é a autoridade do plano; o JSON registra progresso e evidências
para a visualização. Atualize os dois quando o status de um item mudar.

```sh
node scripts/migration-dashboard.mjs sync --source-ref <SHA-completo>
# Opcional: ler ROADMAP.md de outro checkout
node scripts/migration-dashboard.mjs sync --roadmap /caminho/ROADMAP.md --decisions /caminho/docs/ARCHITECTURE_V2_DECISIONS.md --source-ref <SHA-completo>
```

O sync importa textos/status/dependências, fases, sequência, checklist e
decisões. Preserva checkpoints, evidências, notas, pesos, bloqueios reais e
histórico; conserva aceite de checklist somente quando seu texto continua
idêntico. IDs removidos e estado inconsistente falham antes da escrita.
Use o roadmap mais recente da implementação: sincronizar uma versão antiga
que chama de Planned uma fatia já concluída será rejeitado pelo validador.
Novos itens começam com checkpoints pendentes; uma linha marcada Complete
exige evidências/checkpoints completos no JSON antes do sync.

## Outra thread ou worktree

O painel lê um arquivo específico, não qualquer arquivo com o mesmo nome.
Ao integrar esta PR em outro checkout, rode o servidor naquele checkout ou
aponte o servidor existente para o JSON que a thread realmente atualiza:

```sh
node scripts/migration-dashboard.mjs serve --data /caminho/checkout/dashboard/migration.json --port 4317
```

O terminal imprime o caminho observado. Use uma porta diferente se 4317 já
estiver ocupada. Não copie o dashboard a cada entrega: mantenha um JSON
observado e valide antes de publicar sua atualização.

[Prompt para a thread de implementação](AGENT_PROMPT.md).

## Marco 0.5 (`milestones`)

Chave top-level **opcional** `milestones`: marcos de recorte com itens, critérios
e critérios de saída próprios, calculados à parte do percentual da 1.0
(`summarize()` não a lê). Hoje contém o `0.5 · Frontier`, descrito na seção
`## 0.5 — Frontier` do `ROADMAP.md`. A seção do painel só aparece se a chave existe.

```json
"milestones": [{
  "id": "0.5", "title": "…", "summary": "…",
  "scope": ["…"], "outOfScope": ["…"], "goNoGo": "…",
  "items": [{
    "id": "V05-02", "title": "…", "effort": "L",
    "gf": ["GF-13"], "dependsOn": [], "acceptance": "…",
    "criteria": [{ "id": "vermelho", "label": "…", "done": false, "evidence": [] }]
  }],
  "exit": [{ "id": "X1", "label": "…", "done": false, "evidence": [] }]
}]
```

- O percentual do marco é critérios concluídos sobre critérios dos itens. O status
  do item e do marco é derivado (planejado, em andamento, concluído ou, com
  `blocker`, bloqueado): não existe campo de status para manter coerente.
- `done: true` exige `evidence` com URL http(s), como nos checkpoints dos GF. `gf`
  só referencia GF existentes e `dependsOn` só itens do mesmo marco.
- Fica fora do `sync` de propósito: o `ROADMAP.md` não o define, e uma chave
  desconhecida sobrevive ao `sync`. Já uma tag nos GF, uma fase ou tasks `V05-xx`
  seriam descartadas ou rejeitadas, e mudariam o denominador da 1.0.
- Não use no `ROADMAP.md` o heading `## M<n> — `, linhas de tabela que começam por
  número ou `GF-`, a frase de aceite do primeiro marco integrado nem itens
  `- [ ]` no checklist da 1.0 para falar do 0.5: o parser os leria como
  fase, sequência, task ou critério da 1.0.
- A mensagem de direcionamento está em `activity`, mas ela afunda quando entram
  entradas mais novas: o canal durável é `AGENT_PROMPT.md` e este arquivo.

## Agentes em paralelo (até 6)

O painel local mostra até seis agentes trabalhando ao mesmo tempo, cada um em
sua própria worktree: quem é, o que faz, em qual worktree, branch e HEAD está,
quais áreas reservou e se atrapalha outro agente. Aparece na seção **Agentes**
e como chips "Agente N" nos itens GF do roadmap.

O registro é um arquivo por agente em `<git-common-dir>/fabric-agents/slot-N.json`
(N de 1 a 6), no diretório git compartilhado por todas as worktrees do clone.
Fica fora do git de propósito: é coordenação ao vivo e local, e um campo no
`migration.json` divergiria por branch e geraria conflitos de merge. Cada agente
escreve só o próprio arquivo. `FABRIC_AGENTS_DIR` ou `--agents <dir>` (também no
servidor) apontam para outro diretório. `FABRIC_AGENT_NAME` define o `--agent`
padrão do `claim`.

Protocolo, rodando na worktree de cada agente:

```sh
# 1. antes de editar: reserva o slot, o GF e as áreas
npm run agents -- claim --task GF-22 --title "Rede sobre o cliente HTTP" \
  --agent "Codex · GPT-5" --area src/networking/ --resource port:4318
# 2. a cada marco (sem opções é só um sinal de vida)
npm run agents -- update --state testing --now "rodando os testes" --next "abrir a PR"
# 3. recados para outro agente (sem --to vai para todos)
npm run agents -- say "contrato do fetch pronto" --to 2
# 4. antes de commit e push: sai com 1 se houver conflito com você ou se o
#    git de algum agente estiver ilegível (arquivos alterados desconhecidos)
npm run agents -- check
# 5. ao entregar
npm run agents -- release
```

`npm run agents` sem comando (ou `list`) imprime o quadro no terminal.

Regras:

- Um agente por worktree e uma branch por agente, nunca `main`. A worktree
  (raiz do `git rev-parse --show-toplevel`) identifica o agente; o slot sai do
  `claim` (primeiro livre, ou `--slot N`). Com os seis slots ocupados o `claim`
  é recusado e indica com quem falar.
- Áreas são exclusivas por prefixo: diretório termina com `/`
  (`src/networking/`), arquivo não (`src/a.js`). Sem caminho absoluto, `..` ou
  curingas. Áreas que se sobrepõem entre agentes são conflito, assim como um
  arquivo alterado dentro da área reservada por outro agente ou o mesmo arquivo
  alterado por dois agentes fora de áreas. O `claim` e o `update` recusam o que
  criaria um conflito.
- O git é a verdade: branch, HEAD, ahead/behind de `origin/main` e arquivos
  alterados são lidos ao vivo da worktree. Conflitos usam o que foi declarado e
  o que realmente mudou.
- Arquivos compartilhados são os hubs que toda entrega altera: `ROADMAP.md`,
  `README.md`, `package.json`, `docs/API.md`, `examples/entry.jsx`,
  `native/register.cpp`, `native/fabric_application.cpp`,
  `src/react-native-platform.jsx`, `types/react-native.ts`,
  `tests/types/consumer.tsx` e outros. A lista completa (32 caminhos) é
  `SHARED_PATHS` em `dashboard/agents.mjs`, a fonte única; o painel a mostra na
  linha da regra. Eles nunca são exclusivos: ficam fora de toda área. Reservá-los
  é aceito, mas ignorado, com o aviso `shared-area` (tire-os das áreas no
  próximo `update`); diretórios que os contêm (`native/`, `dashboard/`) são
  áreas normais, e alterar um compartilhado dentro da área de outro agente não
  é conflito. Quando 2 ou mais agentes os alteram o painel só avisa: o
  orquestrador faz o merge sequencial e todos mantêm os dois lados.
- Recursos `tipo:valor` (`port:4318`, `build:modal-consumer`) são exclusivos.
  O mesmo GF em dois agentes é só aviso: fatias diferentes de um GF podem andar
  em paralelo, mas combinem a divisão.
- Sem `update` há 30 minutos o agente aparece como "sem sinal". As áreas
  continuam reservadas até o `release`; libere o slot de uma worktree removida.
- O quadro é local: precisa do servidor (`npm run dashboard`) na máquina das
  worktrees. No GitHub Pages não há servidor Node e a seção mostra só um aviso.

## GitHub Pages

O workflow `Migration dashboard Pages` testa e prepara somente os arquivos do
dashboard e as fontes/licenças. Publica automaticamente quando esses arquivos,
incluindo `dashboard/migration.json`, mudam no `main`. PRs validam o artefato
sem publicar. Também é possível iniciar o workflow manualmente no `main`.

URL: https://journey-studios.github.io/godot-fabric/

Em Settings → Pages, use **Source: GitHub Actions**. Deploy por branch também
é possível com um artefato estático na raiz da branch ou em `/docs`, mas este
workflow evita duplicar o JSON e os assets em uma branch de publicação.

```sh
node scripts/build-dashboard-pages.mjs
# Artefato: build/dashboard-pages/
```

No site público, o navegador lê `migration.json` diretamente; não há servidor
Node ou endpoint API. Os caminhos são relativos para funcionar sob
`/godot-fabric/`. A atualização de cinco segundos consulta a última versão
publicada: mudanças locais só aparecem após commit, push e
deploy bem-sucedido. O Pages/CDN pode levar um tempo para propagar a versão.

## Publicar progresso sem merge

Faça commit e push de `dashboard/migration.json` na sua branch. O workflow
busca somente esse JSON, fixa o commit resolvido, valida os dados e usa o
renderer do main. A branch precisa conter o JSON; um arquivo local não basta.

```sh
gh workflow run dashboard-pages.yml --ref main -f data_ref="SUA_BRANCH"
```

Na interface: Actions → Migration dashboard Pages → Run workflow, selecione
`main` para o workflow e informe sua branch em `data_ref` (também aceita SHA
ou tag). Confirme o sucesso da execução antes de dizer que publicou.
O mesmo site público é substituído pela publicação mais recente. O painel
mostra branch, commit do JSON e se esse commit está integrado ao main.
Um push relevante no main volta a publicar os dados do main; para restaurar
manualmente, dispare com `data_ref=main`. Não execute o workflow com
`--ref SUA_BRANCH`: o deploy é permitido apenas pelo workflow do main.
