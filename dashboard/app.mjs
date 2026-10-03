import { validate, summarize, progress, taskProgress, pendingDependencies, STATUSES } from "./model.mjs";

const $ = id => document.getElementById(id);
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const percent = value => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}%`;
const date = value => new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "short", year: "numeric" });
const clock = value => new Date(value).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const url = value => /^https?:\/\//.test(value || "") ? escape(value) : "#";
const evidenceLinks = evidence => evidence.map(item => `<a href="${url(item.url)}" target="_blank" rel="noopener">${escape(item.label)} ↗</a>`).join(" · ");
const checkpoint = step => `<div class="checkpoint ${step.done ? "done" : ""}"><span class="check-icon" aria-label="${step.done ? "Concluído" : "Pendente"}">${step.done ? "☑" : "□"}</span><span>${escape(step.label)}${step.evidence.length ? `<span class="checkpoint-links">${evidenceLinks(step.evidence)}</span>` : ""}</span></div>`;
const progressBar = value => `<div class="progress-track" role="progressbar" aria-valuenow="${value.toFixed(1)}" aria-valuemin="0" aria-valuemax="100" aria-label="Progresso"><span style="width:${value}%"></span></div>`;
const status = task => `<span class="status-pill ${task.status}"><i class="dot ${task.status}"></i>${STATUSES[task.status]}</span>`;
let data, lastPayload, live = true, timer, loading = false;

function renderSummary() {
  const summary = summarize(data);
  const sequence = data.sequences.find(item => item.id === data.project.focusSequence);
  const focusTasks = (sequence ? data.tasks.filter(task => sequence.taskIds.includes(task.id) && task.status === "in_progress") : data.tasks.filter(task => task.status === "in_progress")).slice(0, 3);
  $("summary").className = "";
  $("summary").innerHTML = `<div class="overview-grid"><article class="progress-panel"><div class="panel-top"><span class="eyebrow">PROGRESSO DA RELEASE</span><span class="pill">VERSÃO ${escape(data.project.target)}</span></div><div class="big-progress"><strong>${percent(summary.percent).replace("%", "<small>%</small>")}</strong><span>dos critérios de acompanhamento concluídos</span></div>${progressBar(summary.percent)}<div class="progress-meta"><span>${summary.checkpoints} / ${summary.checkpointTotal} checkpoints</span><span>${summary.complete} / ${summary.required} itens concluídos</span></div><p class="progress-explanation">Média do progresso por item GF, com peso definido no JSON. O escopo posterior fica fora da release. Mede checkpoints verificados; não estima esforço ou tempo.</p></article><article class="focus-panel"><span class="eyebrow">EM MOVIMENTO AGORA</span><h3 class="focus-heading"><i></i>${escape(data.project.focusTitle || "Implementação em andamento")}</h3>${focusTasks.length ? focusTasks.map(task => `<a href="#${escape(task.id)}" class="focus-item" data-task="${escape(task.id)}"><span class="task-code">${escape(task.id)}</span><span class="focus-title">${escape(task.title)}</span><span class="focus-percent">${percent(taskProgress(task))}</span></a>`).join("") : '<p class="muted">Nenhum item em andamento neste recorte.</p>'}<a href="#sequence">Ver a sequência e as dependências →</a></article></div><div class="stats"><div class="stat"><div class="stat-label"><i class="dot complete"></i>Concluídos na release</div><strong>${summary.complete}<small>de ${summary.required} itens</small></strong></div><div class="stat"><div class="stat-label"><i class="dot in_progress"></i>Em andamento</div><strong>${summary.active}<small>itens abertos</small></strong></div><div class="stat"><div class="stat-label"><i class="dot blocked"></i>Bloqueados</div><strong>${summary.blocked}<small>bloqueios registrados</small></strong></div><div class="stat"><div class="stat-label"><i class="dot"></i>Escopo completo</div><strong>${summary.total}<small>itens do roadmap</small></strong></div></div>`;
  $("phase-map").innerHTML = data.phases.map(phase => {
    const value = progress(data.tasks.filter(task => task.phase === phase.id && task.releaseRequired));
    return `<button class="phase-button" data-phase="${escape(phase.id)}" aria-label="Filtrar ${escape(phase.id)}: ${escape(phase.shortTitle || phase.title)}, ${percent(value)}"><span class="phase-line"><i style="width:${value}%"></i></span><strong>${escape(phase.id)}</strong><span class="phase-percent">${percent(value)}</span><small>${escape(phase.shortTitle || phase.title)}</small></button>`;
  }).join("");
  $("nav-count").textContent = summary.total;
}

function taskRow(task) {
  const value = taskProgress(task), pending = pendingDependencies(task, data.tasks);
  return `<details id="${escape(task.id)}" class="task-row"><summary><span class="task-code">${escape(task.id)}</span><span class="task-title">${escape(task.title)}</span><span class="priority ${task.priority}">${task.priority}</span>${status(task)}<span class="mini-progress"><span class="mini-track"><i style="width:${value}%"></i></span><b>${percent(value)}</b></span><span class="chevron" aria-hidden="true">›</span></summary><div class="task-detail"><div class="detail-grid"><div><div class="detail-label">RESULTADO E ACEITE COMPLETO</div><p class="acceptance-text" lang="en">${escape(task.acceptance)}</p>${task.note ? `<p class="task-note">${escape(task.note)}</p>` : ""}${task.blocker ? `<p class="error">Bloqueio: ${escape(task.blocker)}</p>` : ""}<div class="detail-label">DEPENDÊNCIAS PARA CONCLUSÃO</div><div class="dependencies">${task.dependencies.length ? task.dependencies.map(id => `<button class="dep-button ${pending.includes(id) ? "pending" : ""}" data-task="${escape(id)}">${escape(id)} ${pending.includes(id) ? "○" : "✓"}</button>`).join("") : '<span class="muted">Sem dependências de conclusão.</span>'}</div>${pending.length ? `<p class="dependency-note">${pending.length} dependências abertas. Fatias limitadas podem avançar antes do fechamento.</p>` : ""}<p class="task-scope">${task.priority} · Peso ${task.weight} · ${task.releaseRequired ? "Obrigatório para 1.0" : "Escopo posterior, fora do percentual 1.0"}</p></div><div><div class="detail-label">CHECKPOINTS · ${percent(value)}</div>${task.checkpoints.map(checkpoint).join("")}</div></div></div></details>`;
}

function renderTasks() {
  if (!data) return;
  const open = new Set([...document.querySelectorAll(".task-row[open]")].map(item => item.id));
  const query = $("search").value.toLocaleLowerCase("pt-BR").trim(), phase = $("phase-filter").value, state = $("status-filter").value, priority = $("priority-filter").value;
  const tasks = data.tasks.filter(task => (phase === "all" || task.phase === phase) && (state === "all" || task.status === state) && (priority === "all" || task.priority === priority) && `${task.id} ${task.title} ${task.acceptance} ${task.note}`.toLocaleLowerCase("pt-BR").includes(query));
  $("roadmap-count").textContent = `${tasks.length} / ${data.tasks.length}`;
  $("clear-filters").hidden = !query && phase === "all" && state === "all" && priority === "all";
  $("tasks").innerHTML = tasks.length ? data.phases.map(item => {
    const matches = tasks.filter(task => task.phase === item.id);
    if (!matches.length) return "";
    const total = data.tasks.filter(task => task.phase === item.id && task.releaseRequired);
    return `<article class="phase-group"><header class="group-heading"><span class="phase-id">${escape(item.id)}</span><h3>${escape(item.title)}</h3><span>${matches.length} ${matches.length === 1 ? "item" : "itens"} · ${percent(progress(total))}</span></header>${matches.map(taskRow).join("")}</article>`;
  }).join("") : '<div class="empty">Nenhum item corresponde aos filtros.<br>Limpe a busca para voltar ao roadmap completo.</div>';
  open.forEach(id => { if ($(id)) $(id).open = true; });
  document.querySelectorAll("[data-phase]").forEach(button => button.classList.toggle("active", button.dataset.phase === phase));
}

function renderRest() {
  $("sequences").innerHTML = data.sequences.map(sequence => {
    const tasks = data.tasks.filter(task => sequence.taskIds.includes(task.id)), value = progress(tasks);
    return `<article class="sequence-card"><div class="sequence-top"><span class="sequence-number">${escape(sequence.id)}</span><span class="pill">${percent(value)}</span></div><h3>${escape(sequence.title)}</h3>${progressBar(value)}<div class="dependencies">${sequence.taskIds.map(id => `<button class="dep-button" data-task="${escape(id)}">${escape(id)}</button>`).join("")}</div><details><summary>Pré-requisito e resultado</summary><p lang="en">${escape(sequence.acceptance)}</p></details></article>`;
  }).join("");
  for (const [key, target] of [["integrationChecklist", "integration-checklist"], ["releaseChecklist", "release-checklist"]]) {
    const steps = data[key];
    $(target).innerHTML = `<p class="check-count">${steps.filter(step => step.done).length} / ${steps.length} critérios aceitos</p>${steps.map(checkpoint).join("")}`;
  }
  $("release-count").textContent = `${data.releaseChecklist.filter(step => step.done).length} / ${data.releaseChecklist.length}`;
  $("decision-count").textContent = data.decisions.length;
  $("decision-summary").textContent = `${data.decisions.filter(item => item.status === "approved").length} aprovadas · ${data.decisions.filter(item => item.status === "pending").length} pendentes`;
  $("decision-list").innerHTML = data.decisions.map(item => `<div class="decision-item"><span class="task-code">${escape(item.id)}</span><a href="https://github.com/journey-studios/godot-fabric/blob/${encodeURIComponent(data.source.commit)}/docs/ARCHITECTURE_V2_DECISIONS.md#${item.id.toLowerCase()}" target="_blank" rel="noopener">${escape(item.title)} ↗</a><span class="status-pill ${item.status === "approved" ? "complete" : "planned"}">${item.status === "approved" ? "Aprovada" : "Pendente"}</span></div>`).join("");
  $("activity-list").innerHTML = [...data.activity].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).map(item => `<article class="activity-entry"><time datetime="${escape(item.at)}">${date(item.at)}</time><div><p>${escape(item.message)}</p><span class="task-code">${item.taskIds.map(escape).join(" · ")}</span>${item.url ? `<a href="${url(item.url)}" target="_blank" rel="noopener">Ver entrega e evidências ↗</a>` : ""}</div></article>`).join("") || '<p class="muted">Nenhuma atividade registrada.</p>';
  $("implementation-pr").href = data.source.implementationPr || data.source.url;
}

function render() {
  const selected = $("phase-filter").value;
  $("phase-filter").innerHTML = '<option value="all">Todas as fases</option>' + data.phases.map(phase => `<option value="${escape(phase.id)}">${escape(phase.id)} · ${escape(phase.shortTitle || phase.title)}</option>`).join("");
  if ([...$("phase-filter").options].some(option => option.value === selected)) $("phase-filter").value = selected;
  renderSummary(); renderTasks(); renderRest();
}

async function refresh() {
  if (loading) return;
  loading = true; $("refresh").disabled = true;
  try {
    const response = await fetch(new URL("./migration.json", import.meta.url), { cache: "no-store", signal: AbortSignal.timeout(8000) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    validate(payload);
    const serialized = JSON.stringify(payload);
    if (serialized !== lastPayload) { data = payload; lastPayload = serialized; render(); }
    $("error").hidden = true;
    $("connection").innerHTML = `${live ? "Sincronizado" : "Atualizado"} às ${clock(new Date())} · JSON de ${date(data.updatedAt)} · <a href="${url(data.source.url)}" target="_blank" rel="noopener">${escape(data.source.scope)} / ${escape(data.source.commit.slice(0, 7))} ↗</a>${data.publication ? ` · Publicado de ${escape(data.publication.ref)} / ${escape(data.publication.commit.slice(0, 7))}${data.publication.inMain ? " (integrado ao main)" : " (fora do main)"}` : ""}`;
  } catch (error) {
    $("error").textContent = `${error.message}. ${data ? "Mantendo a última versão válida; nova tentativa automática quando Ao vivo estiver ativo." : "Corrija o JSON ou a conexão e clique em Atualizar."}`;
    $("error").hidden = false;
    $("connection").textContent = data ? "Sem sincronização · exibindo a última versão válida" : "Dados indisponíveis";
    if (!data) $("summary").textContent = "O roadmap aparecerá assim que os dados estiverem disponíveis.";
  } finally {
    loading = false; $("refresh").disabled = false;
    schedule();
  }
}

function schedule() {
  clearTimeout(timer);
  if (live) timer = setTimeout(() => { if (!document.hidden) refresh(); else schedule(); }, (data?.project.refreshSeconds || 5) * 1000);
}

function clearFilters() {
  $("search").value = "";
  ["phase-filter", "status-filter", "priority-filter"].forEach(id => { $(id).value = "all"; });
}

function revealTask(id) {
  if (!data?.tasks.some(task => task.id === id)) return;
  clearFilters(); renderTasks();
  const target = $(id); target.open = true;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.querySelector("summary").focus({ preventScroll: true });
  history.replaceState(null, "", `#${id}`);
}

$("refresh").addEventListener("click", refresh);
$("live-toggle").addEventListener("click", () => {
  live = !live;
  $("live-toggle").setAttribute("aria-pressed", String(live));
  $("live-toggle").innerHTML = `<i></i>${live ? "Ao vivo" : "Pausado"}`;
  if (live) refresh(); else schedule();
});
$("search").addEventListener("input", renderTasks);
["phase-filter", "status-filter", "priority-filter"].forEach(id => $(id).addEventListener("change", renderTasks));
$("clear-filters").addEventListener("click", () => { clearFilters(); renderTasks(); });
document.addEventListener("click", event => {
  const task = event.target.closest("[data-task]");
  if (task) { event.preventDefault(); revealTask(task.dataset.task); }
  const phase = event.target.closest("[data-phase]");
  if (phase) { $("phase-filter").value = $("phase-filter").value === phase.dataset.phase ? "all" : phase.dataset.phase; renderTasks(); $("roadmap").scrollIntoView({ behavior: "smooth" }); }
});
document.addEventListener("keydown", event => {
  if (event.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { event.preventDefault(); $("search").focus(); }
  if (event.key === "Escape" && document.activeElement === $("search")) { clearFilters(); renderTasks(); }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && live) refresh(); });
const observer = new IntersectionObserver(entries => {
  const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
  if (visible) document.querySelectorAll("[data-nav]").forEach(link => {
    const active = link.dataset.nav === visible.target.id;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "location"); else link.removeAttribute("aria-current");
  });
}, { rootMargin: "-80px 0px -65% 0px" });
document.querySelectorAll("main>section").forEach(section => observer.observe(section));
await refresh();
if (/^#GF-\d+$/.test(location.hash)) revealTask(location.hash.slice(1));
