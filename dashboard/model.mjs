export const STATUSES = { planned: "Planejado", in_progress: "Em andamento", blocked: "Bloqueado", complete: "Concluído" };

export function taskProgress(task) {
  return task.checkpoints.filter(step => step.done).length / task.checkpoints.length * 100;
}

export function progress(tasks) {
  const weight = tasks.reduce((sum, task) => sum + task.weight, 0);
  return weight ? tasks.reduce((sum, task) => sum + taskProgress(task) * task.weight, 0) / weight : 0;
}

export function summarize(data) {
  const release = data.tasks.filter(task => task.releaseRequired);
  return {
    percent: progress(release), total: data.tasks.length, required: release.length,
    complete: release.filter(task => task.status === "complete").length,
    active: data.tasks.filter(task => task.status === "in_progress").length,
    blocked: data.tasks.filter(task => task.status === "blocked").length,
    checkpoints: release.flatMap(task => task.checkpoints).filter(step => step.done).length,
    checkpointTotal: release.flatMap(task => task.checkpoints).length,
  };
}

export function pendingDependencies(task, tasks) {
  return task.dependencies.filter(id => tasks.find(item => item.id === id)?.status !== "complete");
}

export function validate(data) {
  const fail = message => { throw new Error(message); };
  const string = (value, field) => { if (typeof value !== "string" || !value.trim()) fail(`${field}: texto obrigatório`); };
  const date = (value, field) => { string(value, field); if (!Number.isFinite(Date.parse(value))) fail(`${field}: data inválida`); };
  const unique = (items, field) => { if (new Set(items.map(item => item.id)).size !== items.length) fail(`${field}: IDs duplicados`); };
  const evidence = (items, field) => {
    if (!Array.isArray(items)) fail(`${field}: lista obrigatória`);
    items.forEach(item => {
      string(item.label, `${field}.label`); string(item.url, `${field}.url`);
      if (!/^https?:\/\//.test(item.url)) fail(`${field}: URL deve usar http ou https`);
    });
  };
  if (!data || data.schemaVersion !== 1) fail("schemaVersion deve ser 1");
  string(data.project?.name, "project.name"); string(data.project?.target, "project.target");
  date(data.updatedAt, "updatedAt");
  string(data.source?.commit, "source.commit"); string(data.source?.url, "source.url");
  string(data.source.scope, "source.scope");
  if (!/^[0-9a-f]{40}$/.test(data.source.commit)) fail("source.commit exige SHA completo");
  if (!/^https?:\/\//.test(data.source.url) || (data.source.implementationPr && !/^https?:\/\//.test(data.source.implementationPr))) fail("source: URL inválida");
  if (!Number.isInteger(data.project.refreshSeconds) || data.project.refreshSeconds < 2) fail("project.refreshSeconds deve ser >= 2");
  for (const key of ["phases", "tasks", "sequences", "decisions", "releaseChecklist", "integrationChecklist", "activity"]) {
    if (!Array.isArray(data[key])) fail(`${key}: lista obrigatória`);
    unique(data[key], key);
  }
  if (!data.phases.length || !data.tasks.length) fail("Roadmap vazio");
  data.phases.forEach(phase => { string(phase.id, "phase.id"); string(phase.title, "phase.title"); });
  for (const task of data.tasks) {
    string(task.id, "task.id"); string(task.title, `${task.id}.title`); string(task.acceptance, `${task.id}.acceptance`);
    if (!data.phases.some(phase => phase.id === task.phase)) fail(`${task.id}: fase desconhecida`);
    if (!Object.hasOwn(STATUSES, task.status)) fail(`${task.id}: status inválido`);
    if (!["P0", "P1", "P2"].includes(task.priority)) fail(`${task.id}: prioridade inválida`);
    if (typeof task.releaseRequired !== "boolean" || !Number.isFinite(task.weight) || task.weight <= 0) fail(`${task.id}: escopo/peso inválido`);
    if (!Array.isArray(task.dependencies) || new Set(task.dependencies).size !== task.dependencies.length) fail(`${task.id}: dependências inválidas`);
    for (const id of task.dependencies) if (id === task.id || !data.tasks.some(item => item.id === id)) fail(`${task.id}: dependência inválida ${id}`);
    if (!Array.isArray(task.checkpoints) || !task.checkpoints.length) fail(`${task.id}: checkpoints obrigatórios`);
    unique(task.checkpoints, `${task.id}.checkpoints`);
    task.checkpoints.forEach(step => {
      string(step.id, `${task.id}.checkpoint.id`); string(step.label, `${task.id}.checkpoint.label`);
      if (typeof step.done !== "boolean") fail(`${task.id}: done deve ser booleano`);
      evidence(step.evidence, `${task.id}.${step.id}.evidence`);
      if (step.done && !step.evidence.length) fail(`${task.id}.${step.id}: conclusão sem evidência`);
    });
    const percent = taskProgress(task);
    if (task.status === "planned" && percent > 0) fail(`${task.id}: planejado com checkpoints concluídos`);
    if (task.status === "complete" && (percent !== 100 || pendingDependencies(task, data.tasks).length)) fail(`${task.id}: conclusão incompleta ou dependências abertas`);
    if (task.status !== "complete" && percent === 100) fail(`${task.id}: todos os checkpoints concluídos exigem status complete`);
    if (task.status === "blocked") string(task.blocker, `${task.id}.blocker`);
  }
  // Cycles would make completion of the dependent tasks impossible.
  const visiting = new Set(), visited = new Set();
  function visit(task) {
    if (visiting.has(task.id)) fail(`Dependência circular: ${task.id}`);
    if (visited.has(task.id)) return;
    visiting.add(task.id);
    task.dependencies.forEach(id => visit(data.tasks.find(item => item.id === id)));
    visiting.delete(task.id); visited.add(task.id);
  }
  data.tasks.forEach(visit);
  data.sequences.forEach(sequence => {
    string(sequence.id, "sequence.id"); string(sequence.title, "sequence.title"); string(sequence.acceptance, "sequence.acceptance");
    if (!Array.isArray(sequence.taskIds) || sequence.taskIds.some(id => !data.tasks.some(task => task.id === id))) fail(`${sequence.id}: itens desconhecidos`);
  });
  data.decisions.forEach(decision => {
    string(decision.id, "decision.id"); string(decision.title, "decision.title");
    if (!["approved", "pending"].includes(decision.status)) fail(`${decision.id}: decisão inválida`);
  });
  for (const key of ["releaseChecklist", "integrationChecklist"]) data[key].forEach(step => {
    string(step.id, `${key}.id`); string(step.label, `${key}.label`);
    if (typeof step.done !== "boolean") fail(`${step.id}: done deve ser booleano`);
    evidence(step.evidence, `${step.id}.evidence`);
    if (step.done && !step.evidence.length) fail(`${step.id}: aceite sem evidência`);
  });
  data.activity.forEach(entry => {
    string(entry.id, "activity.id"); string(entry.message, "activity.message"); date(entry.at, "activity.at");
    if (!Array.isArray(entry.taskIds) || entry.taskIds.some(id => !data.tasks.some(task => task.id === id))) fail(`${entry.id}: itens desconhecidos`);
  });
  return data;
}
