# Dashboard de migração

Painel local em português, sem build de frontend ou dependências adicionais.
Os dados são renderizados de `dashboard/migration.json`. Roadmap GF-01–GF-40,
fases M0–M5, sequência da Arquitetura 2.0, marco HUD/inventário, aceite da
release e decisões arquiteturais estão incluídos.

```sh
node scripts/migration-dashboard.mjs
# http://127.0.0.1:4317
node scripts/migration-dashboard.mjs check
node --test tests/migration-dashboard.test.mjs
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
publicada: mudanças locais só aparecem após commit, push/merge no main e
deploy bem-sucedido. O Pages/CDN pode levar um tempo para propagar a versão.
