# Prompt para a thread de implementação

Continue a implementação do roadmap do Godot Fabric e mantenha o dashboard
de migração atualizado durante o trabalho.

Primeiro leia `dashboard/README.md`, `dashboard/migration.json`,
`ROADMAP.md` e `docs/ARCHITECTURE_V2_DECISIONS.md`. Se o dashboard ainda não
estiver no seu checkout, integre somente os arquivos novos da branch
`codex/migration-dashboard`: `dashboard/`, `scripts/migration-dashboard.mjs`
e `tests/migration-dashboard.test.mjs`. Preserve seu trabalho e adapte os
scripts npm sem substituir seu `package.json` ou trocar sua branch.

Confirme qual JSON o servidor aberto está lendo: o caminho é impresso ao
iniciá-lo. Se você trabalha em outro checkout, inicie o servidor de lá ou use
`node scripts/migration-dashboard.mjs serve --data /caminho/absoluto/do/seu/dashboard/migration.json`.
O painel só acompanhará o arquivo observado. Execute com uma porta livre e
informe a URL atual ao usuário se ela mudar.

A cada avanço verificável, fechamento, falha ou bloqueio relevante:

1. Atualize os itens pelo ID estável GF-xx no JSON. Use `planned`,
   `in_progress`, `blocked` ou `complete`; explique bloqueios reais em `blocker`
   e registre o escopo implementado e as lacunas em `note`.
2. Atualize `checkpoints`. Marque `done: true` apenas com evidência executada
   e link durável em `evidence: [{label, url}]`. Registre no relatório commit,
   versões, plataforma, modo, comando/fixture, resultado e limitações.
   Separe validação local, CI, compilação/exportação e runtime real.
3. Não escreva percentuais manualmente: o dashboard calcula a proporção de
   checkpoints e a média ponderada dos itens obrigatórios. Preserve pesos e
   `releaseRequired`; GF-40 fica fora do percentual da 1.0. Ao detalhar novos
   checkpoints, explique no histórico a mudança do denominador.
4. Feche um GF apenas quando todo seu aceite do ROADMAP.md, seus checkpoints
   e suas dependências de conclusão estiverem comprovados. Uma fatia funcional,
   PR mergeada ou CI verde não fecha o item completo. Mantenha separados os
   checklists HUD/inventário e release e as decisões aprovadas/pendentes.
5. Atualize `updatedAt` em ISO 8601, `source.commit/url/scope`,
   `project.focusSequence/focusTitle` e acrescente a `activity` uma entrada
   única com `id`, `at`, `taskIds`, `message` e, quando disponível, `url`.
6. Mantenha ROADMAP.md coerente e use `node scripts/migration-dashboard.mjs sync
   --source-ref <SHA-completo>` quando o plano mudar. O sync preserva evidências
   e histórico; leia a documentação sobre status inconsistentes e novos IDs.
7. Valide com `node scripts/migration-dashboard.mjs check` e
   `node --test tests/migration-dashboard.test.mjs`. Publique o JSON por arquivo
   temporário + rename. Inclua dados/documentação atualizados na mesma entrega
   da implementação e mantenha o servidor funcionando para o acompanhamento.

O painel lê o JSON automaticamente a cada cinco segundos quando “Ao vivo”
estiver ativo. Atualize após cada fatia comprovada; não espere o roadmap inteiro
terminar. Não invente percentuais, evidências ou aprovações arquiteturais.

O dashboard público está configurado para GitHub Pages em
https://journey-studios.github.io/godot-fabric/. Inclua o JSON atualizado na
entrega da implementação. Para publicar antes do merge, siga o disparo
manual abaixo; o deploy automático continua ocorrendo ao chegar ao main. Verifique o workflow `Migration dashboard Pages` antes de afirmar
que o site público já mostra a atualização. Alterações somente locais não
atualizam o Pages.

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
