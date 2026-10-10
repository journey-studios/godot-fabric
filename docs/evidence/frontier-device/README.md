# Frontier: NO-GO do gate do iPhone (2026-10-09)

**Decisão do usuário, não medição.** Em 2026-10-09 o usuário decidiu que o gate físico do iPhone do marco 0.5 (item V05-09, pacote P7) é **NO-GO**. Ele não fornecerá um iPhone, um Apple Team ID nem o Developer Mode. A decisão vem da indisponibilidade desses três itens; nenhum resultado de aparelho a sustenta.

## Regra aplicada

O plano já define a consequência. O parágrafo **Go/no-go.** da seção [`## 0.5 — Frontier`](../../../ROADMAP.md#05--frontier-a-priority-cut-not-a-separate-release) do ROADMAP diz: "On the phone, a no-go closes the 0.5 as macOS-complete and hands mobile back to GF-35 without moving any 1.0 number." O mesmo vale em [`milestones[0].goNoGo`](../../../dashboard/migration.json): "No iPhone, um NO-GO fecha o 0.5 como macOS completo e devolve o mobile ao GF-35, sem alterar nenhum número da 1.0."

## Consequências

- **V05-09.** Só o critério `decisao` fecha, com este registro como evidência. Os critérios `g0`, `export`, `toque` e `turno` não foram executados e permanecem abertos; o item carrega um `blocker`.
- **V05-08 (preparação iOS no simulador).** É preparação mobile e volta ao GF-35 junto com o aparelho. O item carrega um `blocker`, e este registro não o reivindica. A densidade e o SafeAreaView já construídos na branch `feat/mobile-density` entram como uma fatia do GF-09, sem reivindicar V05-08.
- **Critérios `iphone`.** Os de V05-02 e de V05-10 não se aplicam: o 0.5 fecha como macOS completo, e o comparativo final (V05-10) cobre só o macOS, como diz o aceite dele. Nenhum `done` desses critérios muda aqui.
- **Saída X8.** "iPhone: estágios do gate passando no aparelho, ou NO-GO registrado fechando o 0.5 como macOS completo" está atendida por este registro.
- **1.0.** Nenhum número da 1.0 se move: nenhuma task GF, checkpoint, peso ou decisão muda.
