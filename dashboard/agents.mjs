// Pure agent-board rules shared by the browser and the Node CLI/server (no fs, no DOM).
export const AGENT_SLOTS = 5;
export const AGENT_STATES = { planning: "Planejando", implementing: "Implementando", testing: "Testando", ci: "Aguardando CI", review: "Em revisão", blocked: "Bloqueado" };
// Wired by every delivery and merged sequentially by the orchestrator: never exclusive. They are cut out of every
// area (reserving one is accepted, ignored and warned about) and only warn when 2+ agents change them.
export const SHARED_PATHS = [
  "ROADMAP.md", "dashboard/migration.json", "package.json", "package-lock.json", ".github/workflows/contracts.yml", ".fallowrc.json", "examples/catalog.json", "docs/evidence/README.md",
  "native/application_runtime.cpp", "native/CMakeLists.txt", "native/register.cpp", "src/react-native-platform.jsx", "types/react-native.ts",
];
export const STALE_MINUTES = 30;
export const MAX_MESSAGES = 20;

const fail = message => {
  throw new Error(message);
};
const text = (value, field) => {
  if (typeof value !== "string" || !value.trim()) {
    fail(`${field}: texto obrigatório`);
  }
};
const loose = (value, field) => {
  if (typeof value !== "string") {
    fail(`${field}: deve ser texto`);
  }
};
const isoDate = (value, field) => {
  text(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(`${field}: data ISO inválida`);
  }
};
const slotNumber = (value, field) => {
  if (!Number.isInteger(value) || value < 1 || value > AGENT_SLOTS) {
    fail(`${field}: deve ser um inteiro de 1 a ${AGENT_SLOTS}`);
  }
};
const list = (value, field) => {
  if (!Array.isArray(value)) {
    fail(`${field}: lista obrigatória`);
  }
};
const unique = (items, field) => {
  if (new Set(items).size !== items.length) {
    fail(`${field}: valores duplicados`);
  }
};

function pathsOverlap(a, b) {
  return a === b || (a.endsWith("/") && b.startsWith(a)) || (b.endsWith("/") && a.startsWith(b));
}

function validateArea(area) {
  text(area, "areas");
  const segments = (area.endsWith("/") ? area.slice(0, -1) : area).split("/");
  if (area.startsWith("/") || /[\\*?[]/.test(area) || segments.some(segment => !segment || segment === "." || segment === "..")) {
    fail(`areas: caminho relativo POSIX inválido (${area}); use diretorio/ ou arquivo, sem / inicial, .., *, ? ou \\`);
  }
}

function validateMessage(message) {
  if (!message || typeof message !== "object") {
    fail("messages: objeto obrigatório");
  }
  isoDate(message.at, "messages.at");
  if (message.to !== null) {
    slotNumber(message.to, "messages.to");
  }
  text(message.text, "messages.text");
}

export function validateAgent(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    fail("registro: objeto obrigatório");
  }
  if (record.schemaVersion !== 1) {
    fail("schemaVersion deve ser 1");
  }
  slotNumber(record.slot, "slot");
  text(record.agent, "agent");
  text(record.title, "title");
  text(record.worktree, "worktree");
  if (!/^(?:\/|[A-Za-z]:[\\/])/.test(record.worktree)) {
    fail("worktree: caminho absoluto obrigatório");
  }
  text(record.branch, "branch");
  if (record.branch === "main") {
    fail("branch: não pode ser main; cada agente usa a própria branch");
  }
  list(record.taskIds, "taskIds");
  if (!record.taskIds.length) {
    fail("taskIds: informe ao menos um GF-xx");
  }
  for (const id of record.taskIds) {
    if (typeof id !== "string" || !/^GF-\d{2}$/.test(id)) {
      fail(`taskIds: ID inválido (${id}); use GF-xx`);
    }
  }
  unique(record.taskIds, "taskIds");
  if (!Object.hasOwn(AGENT_STATES, record.state)) {
    fail(`state: use ${Object.keys(AGENT_STATES).join(", ")}`);
  }
  for (const field of ["now", "next", "blocker"]) {
    loose(record[field], field);
  }
  if (record.state === "blocked" && !record.blocker.trim()) {
    fail("blocker: obrigatório quando o estado é blocked");
  }
  list(record.areas, "areas");
  record.areas.forEach(validateArea);
  unique(record.areas, "areas");
  list(record.resources, "resources");
  for (const resource of record.resources) {
    if (typeof resource !== "string" || !/^[a-z][a-z0-9_-]*:\S+$/.test(resource)) {
      fail(`resources: use tipo:valor (${resource})`);
    }
  }
  unique(record.resources, "resources");
  loose(record.pr, "pr");
  if (record.pr && !/^https:\/\/\S+$/.test(record.pr)) {
    fail("pr: use uma URL https://");
  }
  isoDate(record.startedAt, "startedAt");
  isoDate(record.updatedAt, "updatedAt");
  list(record.messages, "messages");
  if (record.messages.length > MAX_MESSAGES) {
    fail(`messages: no máximo ${MAX_MESSAGES} recados`);
  }
  record.messages.forEach(validateMessage);
  return record;
}

// Every message of every agent with its sender, newest first.
export function messageTimeline(agents) {
  return agents.flatMap(agent => agent.messages.map(message => ({ ...message, from: agent.slot }))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

const label = agent => `Agente ${agent.slot}`;
const branchOf = agent => agent.git?.branch ?? agent.branch;
const changedOf = agent => agent.git?.changed ?? [];
const within = (file, areas) => areas.some(area => pathsOverlap(file, area));
const isShared = path => SHARED_PATHS.includes(path);
// Areas an agent really holds: shared files are never exclusive, wherever they are reserved.
const exclusiveAreas = agent => agent.areas.filter(area => !isShared(area));

function comparePair(a, b, add) {
  const slots = [a.slot, b.slot];
  const both = `${label(a)} e ${label(b)}`;
  if (a.slot === b.slot) {
    add("slot", "conflict", slots, `slot ${a.slot}`, `Dois registros usam o slot ${a.slot} (${a.worktree} e ${b.worktree}); mantenha só um arquivo de slot por agente.`);
  }
  if (a.worktree === b.worktree) {
    add("worktree", "conflict", slots, a.worktree, `${both} usam a mesma worktree (${a.worktree}); é um agente por worktree.`);
  }
  if (branchOf(a) === branchOf(b)) {
    add("branch", "conflict", slots, branchOf(a), `${both} estão na mesma branch (${branchOf(a)}); cada agente precisa da própria branch.`);
  }
  for (const x of exclusiveAreas(a)) {
    for (const y of exclusiveAreas(b)) {
      if (pathsOverlap(x, y)) {
        const subject = x.length >= y.length ? x : y;
        add("area", "conflict", slots, subject, `${both} reservaram áreas que se sobrepõem em ${subject}.`);
      }
    }
  }
  for (const resource of a.resources.filter(item => b.resources.includes(item))) {
    add("resource", "conflict", slots, resource, `${both} declararam o recurso ${resource}; usem valores diferentes ou combinem o uso.`);
  }
  for (const [offender, owner] of [[a, b], [b, a]]) {
    for (const file of changedOf(offender).filter(item => !isShared(item) && within(item, exclusiveAreas(owner)))) {
      add("trespass", "conflict", slots, file, `${label(offender)} alterou ${file} na área reservada pelo ${label(owner)}.`);
    }
  }
  const other = new Set(changedOf(b));
  for (const file of changedOf(a).filter(item => other.has(item))) {
    if (isShared(file)) {
      add("shared", "warning", slots, file, `${both} alteraram ${file}, arquivo compartilhado: merge sequencial pelo orquestrador; mantenham os dois lados.`);
    } else if (!within(file, exclusiveAreas(a)) && !within(file, exclusiveAreas(b))) {
      add("file", "conflict", slots, file, `${both} alteraram o mesmo arquivo (${file}) fora de áreas reservadas.`);
    }
  }
  for (const id of a.taskIds.filter(item => b.taskIds.includes(item))) {
    add("task", "warning", slots, id, `${both} trabalham em ${id}; coordenem a divisão do ${id}.`);
  }
}

function checkAgent(agent, now, add) {
  const idle = now - Date.parse(agent.updatedAt);
  if (idle > STALE_MINUTES * 60000) {
    add("stale", "warning", [agent.slot], `slot ${agent.slot}`, `${label(agent)} sem sinal há ${Math.floor(idle / 60000)} min; áreas continuam reservadas até release.`);
  }
  const reserved = agent.areas.filter(isShared);
  if (reserved.length) {
    add("shared-area", "warning", [agent.slot], `slot ${agent.slot}`, `${label(agent)} reservou arquivos compartilhados (${reserved.join(", ")}): a reserva não é exclusiva; merge sequencial pelo orquestrador. Remova-os das áreas no próximo update.`);
  }
  if (agent.git?.exists === false) {
    add("missing", "warning", [agent.slot], agent.worktree, `${label(agent)}: worktree não encontrada (${agent.worktree}); libere o slot.`);
  }
  if (agent.git?.branch && agent.git.branch !== agent.branch) {
    add("drift", "warning", [agent.slot], agent.git.branch, `${label(agent)}: branch mudou para ${agent.git.branch}; atualize o registro.`);
  }
}

const compareText = (a, b) => Number(a > b) - Number(a < b);
const compareSlots = (a, b) => {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] !== b[index]) {
      return (a[index] ?? 0) - (b[index] ?? 0);
    }
  }
  return 0;
};
const severityRank = issue => (issue.severity === "conflict" ? 0 : 1);

export function coordinate(agents, now = Date.now()) {
  const sorted = [...agents].sort((a, b) => a.slot - b.slot);
  const lanes = Array.from({ length: AGENT_SLOTS }, (_, index) => sorted.find(agent => agent.slot === index + 1) ?? null);
  const found = new Map();
  const add = (kind, severity, slots, subject, message) => {
    const ordered = [...new Set(slots)].sort((a, b) => a - b);
    const key = `${kind}|${ordered.join(",")}|${subject}`;
    if (!found.has(key)) {
      found.set(key, { kind, severity, slots: ordered, subject, message });
    }
  };
  sorted.forEach((agent, index) => {
    checkAgent(agent, now, add);
    for (const other of sorted.slice(index + 1)) {
      comparePair(agent, other, add);
    }
  });
  const issues = [...found.values()].sort((a, b) => severityRank(a) - severityRank(b) || compareSlots(a.slots, b.slots) || compareText(a.subject, b.subject) || compareText(a.kind, b.kind));
  return { lanes, issues };
}
