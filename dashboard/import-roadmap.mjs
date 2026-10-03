const statusMap = { Planned: "planned", "In progress": "in_progress", Complete: "complete", Completed: "complete", Done: "complete", Blocked: "blocked" };

export function expandIds(text) {
  const ids = new Set();
  const expanded = text.replace(/GF-(\d+)\s+through\s+GF-(\d+)/g, (_, start, end) => {
    const values = [];
    for (let index = Number(start); index <= Number(end); index++) values.push(`GF-${String(index).padStart(2, "0")}`);
    return values.join(", ");
  });
  for (const match of expanded.matchAll(/GF-\d+/g)) ids.add(match[0]);
  return [...ids];
}

export function parseRoadmap(markdown) {
  const phases = [], tasks = [], sequences = [];
  let phase;
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^## (M\d+) — (.+)$/);
    if (heading) { phase = heading[1]; phases.push({ id: phase, title: heading[2] }); }
    const row = line.match(/^\| (GF-\d+) · (P\d) · (.+?) \| (.+?) \| (.+?) \| (.+?) \|$/);
    if (row) {
      const [, id, priority, title, sourceStatus, acceptance, dependencies] = row;
      if (!statusMap[sourceStatus]) throw new Error(`${id}: status não reconhecido ${sourceStatus}`);
      tasks.push({ id, phase, priority, title, status: statusMap[sourceStatus], acceptance,
        dependencies: expandIds(dependencies), releaseRequired: priority !== "P2", weight: 1,
        note: "", blocker: "", checkpoints: [
          { id: "slice", label: "Primeira fatia funcional validada no host", done: false, evidence: [] },
          { id: "contract", label: "Contrato completo descrito no aceite implementado", done: false, evidence: [] },
          { id: "parity", label: "Casos positivos/negativos e comparação RN certificados", done: false, evidence: [] },
          { id: "targets", label: "Dependências e alvos aplicáveis aceitos com evidência", done: false, evidence: [] },
        ] });
    }
    const sequence = line.match(/^\| (\d[A-B]?) \| (.+?) \| (.+?) \| (.+?) \|$/);
    if (sequence) sequences.push({ id: sequence[1], title: sequence[2], taskIds: expandIds(sequence[3]), acceptance: sequence[4] });
  }
  const releaseBlock = markdown.split("## 1.0 acceptance checklist")[1]?.split("\nEvidence format")[0] || "";
  const releaseChecklist = [...releaseBlock.matchAll(/^- \[([ x])\] ([\s\S]*?)(?=\n- \[|(?![\s\S]))/gm)].map((match, index) => ({
    id: `RC-${String(index + 1).padStart(2, "0")}`, label: match[2].replace(/\s+/g, " ").trim(), done: match[1] === "x", evidence: [],
  }));
  const integrationBlock = markdown.split("Acceptance for this milestone:")[1]?.split("\nRecord semantic")[0] || "";
  const integrationChecklist = [...integrationBlock.matchAll(/^\d+\. ([\s\S]*?)(?=\n\d+\. |(?![\s\S]))/gm)].map((match, index) => ({
    id: `HUD-${index + 1}`, label: match[1].replace(/\s+/g, " ").trim(), done: false, evidence: [],
  }));
  if (!tasks.length || !phases.length) throw new Error("Nenhum item GF encontrado no roadmap");
  return { phases, tasks, sequences, releaseChecklist, integrationChecklist };
}

function parseDecisions(markdown) {
  return [...markdown.matchAll(/^\| \[(V2-D\d+)\]\([^)]+\) \| (.+?) \| (Aprovada|Pendente) \|$/gm)].map(match => ({
    id: match[1], title: match[2], status: match[3] === "Aprovada" ? "approved" : "pending",
  }));
}

// Source text can evolve without destroying manually recorded evidence or history.
export function syncRoadmap(data, markdown, decisionMarkdown) {
  const parsed = parseRoadmap(markdown);
  const mergeChecklist = (next, previous) => next.map(step => {
    const old = previous.find(item => item.id === step.id);
    return old && old.label === step.label ? { ...step, done: old.done, evidence: old.evidence } : step;
  });
  const removed = data.tasks.filter(old => !parsed.tasks.some(task => task.id === old.id));
  if (removed.length) throw new Error(`IDs removidos do roadmap: ${removed.map(task => task.id).join(", ")}. Revise o escopo antes de sincronizar.`);
  return { ...data, ...parsed,
    phases: parsed.phases.map(phase => ({ ...phase, shortTitle: data.phases.find(old => old.id === phase.id)?.shortTitle || phase.title })),
    tasks: parsed.tasks.map(task => {
      const old = data.tasks.find(item => item.id === task.id);
      if (!old) return task;
      return { ...task, weight: old.weight, checkpoints: old.checkpoints, note: old.note, blocker: old.blocker,
        status: old.status === "blocked" ? old.status : task.status };
    }),
    releaseChecklist: mergeChecklist(parsed.releaseChecklist, data.releaseChecklist),
    integrationChecklist: mergeChecklist(parsed.integrationChecklist, data.integrationChecklist),
    decisions: decisionMarkdown === undefined ? data.decisions : parseDecisions(decisionMarkdown),
    updatedAt: new Date().toISOString(),
  };
}
