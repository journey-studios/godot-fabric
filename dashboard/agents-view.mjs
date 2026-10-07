import { AGENT_SLOTS, AGENT_STATES, SHARED_PATHS, messageTimeline } from "./agents.mjs";
import { ago, escape, shortPath, url } from "./format.mjs";

const MAX_MESSAGES_SHOWN = 20;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const dot = slot => `<span class="agent-dot agent-${slot}" title="Agente ${slot}">${slot}</span>`;
const code = value => `<code>${escape(value)}</code>`;
const taskChip = (id, tasks) => {
  const task = tasks.find(item => item.id === id);
  return `<button class="dep-button" data-task="${escape(id)}"${task ? ` title="${escape(task.title)}"` : ""}>${escape(id)}</button>`;
};

const issueItem = issue => `<li class="agent-issue ${issue.severity}"><span class="agent-dots">${issue.slots.map(dot).join("")}</span><span class="agent-issue-text"><span class="agent-issue-kind">${issue.severity === "conflict" ? "CONFLITO" : "AVISO"} · ${escape(issue.kind)}</span>${escape(issue.message)}</span></li>`;

function worktreeBlock(agent, home) {
  const git = agent.git;
  let live = '<p class="agent-warning">Git indisponível para esta worktree.</p>';
  if (git?.exists === false) {
    live = '<p class="agent-warning">Worktree não encontrada no disco.</p>';
  } else if (git?.error) {
    live = `<p class="agent-warning">Não foi possível ler o git: ${escape(git.error)}</p>`;
  } else if (git) {
    live = `<div class="agent-git"><span>branch ${code(git.branch)}</span><span>HEAD ${code(git.head.slice(0, 7))}</span><span>+${git.ahead} / −${git.behind} de ${escape(git.base)}</span><span>${plural(git.dirty, "alteração local", "alterações locais")}</span></div>`;
  }
  return `<section class="agent-block"><h4 class="agent-label">WORKTREE</h4><code class="agent-path">${escape(shortPath(agent.worktree, home))}</code>${live}</section>`;
}

function areasBlock(agent) {
  const areas = agent.areas.length ? `<ul class="agent-areas">${agent.areas.map(area => `<li>${code(area)}</li>`).join("")}</ul>` : '<p class="muted">nenhuma área reservada</p>';
  const resources = agent.resources.length ? `<div class="agent-resources">${agent.resources.map(resource => `<span class="pill">${escape(resource)}</span>`).join("")}</div>` : "";
  return `<section class="agent-block"><h4 class="agent-label">ÁREAS RESERVADAS</h4>${areas}${resources}</section>`;
}

function filesBlock(agent, conflictFiles) {
  const files = agent.git?.changed ?? [];
  const items = files.length ? files.map(file => `<li class="${conflictFiles.has(file) ? "in-conflict" : ""}">${code(file)}${conflictFiles.has(file) ? ' <span class="agent-tag conflict">conflito</span>' : ""}</li>`).join("") : '<li class="muted">Nenhum arquivo alterado.</li>';
  return `<details id="agent-files-${agent.slot}" class="agent-files"><summary>Arquivos alterados (${files.length})</summary><ul>${items}</ul></details>`;
}

function freeLane(slot) {
  return `<article class="agent-lane free agent-${slot}" aria-label="Agente ${slot}, livre"><header class="agent-head">${dot(slot)}<div class="agent-id"><strong>Agente ${slot}</strong><span class="agent-who">Livre</span></div></header><p class="muted">Slot disponível. Para assumir, na worktree do agente:</p><code class="agent-command">${escape('npm run agents -- claim --task GF-xx --title "…" --area caminho/')}</code></article>`;
}

function laneCard(agent, slot, { issues, board, tasks }) {
  if (!agent) {
    return freeLane(slot);
  }
  const mine = issues.filter(issue => issue.slots.includes(slot));
  const conflicts = mine.filter(issue => issue.severity === "conflict");
  const stale = mine.some(issue => issue.kind === "stale");
  const fact = (name, value) => `<div><dt>${name}</dt><dd>${value ? escape(value) : '<span class="muted">—</span>'}</dd></div>`;
  return `<article class="agent-lane agent-${slot}${stale ? " stale" : ""}${conflicts.length ? " has-conflict" : ""}" aria-label="Agente ${slot}">`
    + `<header class="agent-head">${dot(slot)}<div class="agent-id"><strong>Agente ${slot}</strong><span class="agent-who">${escape(agent.agent)}</span></div><span class="pill agent-state state-${escape(agent.state)}">${escape(AGENT_STATES[agent.state])}</span></header>`
    + `<div class="agent-meta"><span>atualizado ${ago(agent.updatedAt)}</span>${stale ? '<span class="agent-tag stale">sem sinal</span>' : ""}${conflicts.length ? `<span class="agent-tag conflict">${plural(conflicts.length, "conflito", "conflitos")}</span>` : ""}</div>`
    + (conflicts.length ? `<ul class="agent-issues">${conflicts.map(issueItem).join("")}</ul>` : "")
    + `<h3 class="agent-title">${escape(agent.title)}</h3><div class="dependencies">${agent.taskIds.map(id => taskChip(id, tasks)).join("")}</div>`
    + `<dl class="agent-facts">${fact("Agora", agent.now)}${fact("Próximo", agent.next)}</dl>${agent.blocker ? `<p class="error">Bloqueio: ${escape(agent.blocker)}</p>` : ""}`
    + `${worktreeBlock(agent, board.home)}${areasBlock(agent)}${filesBlock(agent, new Set(conflicts.map(issue => issue.subject)))}`
    + `${agent.pr ? `<a class="agent-pr" href="${url(agent.pr)}" target="_blank" rel="noopener">Pull request ↗</a>` : ""}</article>`;
}

function coordinationPanel(issues, invalid) {
  const clear = issues.some(issue => issue.severity === "conflict") ? "" : '<p class="agents-clear">Nenhum conflito entre os agentes.</p>';
  const broken = invalid.map(item => `<li class="agent-issue warning"><span class="agent-issue-text"><span class="agent-issue-kind">ARQUIVO INVÁLIDO · ${escape(item.file)}</span>${escape(item.error)}</span></li>`).join("");
  return `<article class="panel agents-coordination"><div class="panel-heading"><h3>Coordenação</h3><span class="pill">${plural(issues.length, "ocorrência", "ocorrências")}</span></div>${clear}<ul class="agent-issues">${issues.map(issueItem).join("")}${broken}</ul></article>`;
}

function messagesPanel(agents) {
  const messages = messageTimeline(agents).slice(0, MAX_MESSAGES_SHOWN);
  const items = messages.map(message => `<li class="agent-message"><span class="agent-dots">${dot(message.from)}</span><div><div class="agent-message-head">Agente ${message.from} → ${message.to === null ? "todos" : `Agente ${message.to}`} <time datetime="${escape(message.at)}">${ago(message.at)}</time></div><p>${escape(message.text)}</p></div></li>`).join("");
  return `<article class="panel agents-messages"><div class="panel-heading"><h3>Recados</h3><span class="pill">${messages.length}</span></div>${messages.length ? `<ul class="agent-messages">${items}</ul>` : `<p class="muted">Nenhum recado ainda. Para falar com outro agente: ${code('npm run agents -- say "texto" --to N')}</p>`}</article>`;
}

export function renderAgents(board, coordination, tasks, error = "") {
  const failure = error ? `<p class="agents-notice failure">${escape(error)}${board ? " Exibindo o último quadro recebido." : ""}</p>` : "";
  if (!board || !coordination) {
    return failure || `<p class="agents-notice">Quadro local: rode ${code("npm run dashboard")} na máquina das worktrees para ver os agentes ao vivo.</p>`;
  }
  const { lanes, issues } = coordination;
  const conflicts = issues.filter(issue => issue.severity === "conflict").length;
  const context = { issues, board, tasks };
  return `${failure}<div class="agents-summary"><div class="agents-counts"><strong>${lanes.filter(Boolean).length} / ${AGENT_SLOTS} agentes ativos</strong><span class="agents-count${conflicts ? " conflict" : ""}">${plural(conflicts, "conflito", "conflitos")}</span><span class="agents-count${issues.length > conflicts ? " warning" : ""}">${plural(issues.length - conflicts, "aviso", "avisos")}</span></div><p class="agents-rule">Cada agente: uma worktree, uma branch, áreas reservadas. Arquivos compartilhados entram por merge sequencial do orquestrador: ${SHARED_PATHS.map(code).join(", ")}.</p></div>`
    + `${coordinationPanel(issues, board.invalid)}<div class="agents-grid">${lanes.map((agent, index) => laneCard(agent, index + 1, context)).join("")}</div>${messagesPanel(board.agents)}`;
}

export function agentChips(taskId, coordination) {
  if (!coordination) {
    return "";
  }
  return coordination.lanes.filter(agent => agent?.taskIds.includes(taskId)).map(agent => `<span class="agent-chip agent-${agent.slot}" title="${escape(agent.agent)} · ${escape(agent.title)}">Agente ${agent.slot}</span>`).join("");
}
