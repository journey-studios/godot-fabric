import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { AGENT_SLOTS, AGENT_STATES, MAX_MESSAGES, coordinate, messageTimeline, validateAgent } from "../dashboard/agents.mjs";
import { ago, shortPath } from "../dashboard/format.mjs";
import { withoutGitLocation } from "./git-environment.mjs";

const run = promisify(execFile);
const gitEnv = withoutGitLocation();
// The board polls other agents' worktrees: without --no-optional-locks, `git status` would refresh their index
// and could make a concurrent `git add`/`git commit` of that agent fail on index.lock.
const git = async (directory, ...args) => (await run("git", ["--no-optional-locks", "-C", directory, ...args], { env: gitEnv, maxBuffer: 64 * 1024 * 1024 })).stdout;
const slotName = slot => `slot-${slot}.json`;

// The registry lives in the shared git directory, so every worktree of this clone sees it and Git never tracks it.
export function resolveAgentsDirectory(cwd) {
  if (process.env.FABRIC_AGENTS_DIR) {
    return path.resolve(process.env.FABRIC_AGENTS_DIR);
  }
  try {
    const common = execFileSync("git", ["--no-optional-locks", "rev-parse", "--git-common-dir"], { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return path.resolve(cwd, common, "fabric-agents");
  } catch {
    throw new Error("Repositório git não encontrado; use --agents <dir> ou FABRIC_AGENTS_DIR.");
  }
}

// One item per status entry, listing every path it touches. With -z a rename or copy is "XY new\0old\0": a rename
// also empties the old path (which may sit in another agent's area), a copy leaves it untouched.
function parseStatus(output) {
  const tokens = output.split("\0");
  const entries = [];
  for (let index = 0; index < tokens.length; index++) {
    const entry = tokens[index];
    if (entry.length < 4) {
      continue;
    }
    const code = entry.slice(0, 2);
    const paths = [entry.slice(3)];
    if (/[RC]/.test(code)) {
      index++;
      if (code.includes("R")) {
        paths.push(tokens[index]);
      }
    }
    entries.push(paths);
  }
  return entries;
}

const failureOf = error => (error.stderr?.trim() || error.message).split("\n")[0];

async function inspectWorktree(worktree) {
  const info = await stat(worktree).catch(() => null);
  if (!info?.isDirectory()) {
    return { exists: false };
  }
  try {
    const base = await git(worktree, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/main").then(() => "origin/main", () => "main");
    const [branch, head, counts, committed, status] = await Promise.all([
      git(worktree, "rev-parse", "--abbrev-ref", "HEAD"),
      git(worktree, "rev-parse", "HEAD"),
      git(worktree, "rev-list", "--left-right", "--count", `${base}...HEAD`),
      // Plumbing on purpose: porcelain `git diff` refreshes (rewrites) the index even with --no-optional-locks.
      // No rename detection: a committed rename lists both the old and the new path.
      git(worktree, "merge-base", base, "HEAD").then(mergeBase => git(worktree, "diff-tree", "-r", "--no-renames", "--name-only", "-z", mergeBase.trim(), "HEAD")),
      git(worktree, "status", "--porcelain=v1", "-z", "--untracked-files=all"),
    ]);
    const [behind, ahead] = counts.trim().split(/\s+/).map(value => parseInt(value, 10));
    const entries = parseStatus(status);
    const changed = [...new Set([...committed.split("\0").filter(Boolean), ...entries.flat()])].sort();
    return { exists: true, branch: branch.trim(), head: head.trim(), base, ahead, behind, dirty: entries.length, changed };
  } catch (error) {
    return { exists: true, error: failureOf(error) };
  }
}

async function readRecord(file) {
  let source;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  try {
    return validateAgent(JSON.parse(source));
  } catch (error) {
    throw new Error(error instanceof SyntaxError ? `JSON inválido: ${error.message}` : error.message);
  }
}

export async function readBoard(directory) {
  const names = await readdir(directory).catch(error => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const files = Array.from({ length: AGENT_SLOTS }, (_, index) => slotName(index + 1)).filter(name => names.includes(name));
  const results = await Promise.all(files.map(async file => {
    try {
      const record = await readRecord(path.join(directory, file));
      return record ? { agent: { ...record, file, git: await inspectWorktree(record.worktree) } } : {};
    } catch (error) {
      return { invalid: { file, error: error.message } };
    }
  }));
  return {
    capacity: AGENT_SLOTS, directory, home: os.homedir(), generatedAt: new Date().toISOString(),
    agents: results.flatMap(result => result.agent ?? []), invalid: results.flatMap(result => result.invalid ?? []),
  };
}

// FABRIC_AGENTS_LOCK_WAIT_MS shortens the lock wait (tests only).
const LOCK_WAIT_MS = parseInt(process.env.FABRIC_AGENTS_LOCK_WAIT_MS ?? "", 10) || 10_000;
const LOCK_STALE_MS = 60_000;
const LOCK_RETRY_MS = 50;

async function readOwner(lock) {
  try {
    const owner = JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8"));
    return Number.isInteger(owner?.pid) && typeof owner.token === "string" ? owner : null;
  } catch {
    return null;
  }
}

const isAlive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
};

// A lock is abandoned when its owner process is gone. A lock without a readable owner is only abandoned once it is old:
// its process may have died between mkdir and writing owner.json, or may still be about to write it.
async function abandonedOwner(lock) {
  const owner = await readOwner(lock);
  if (owner) {
    return { abandoned: !isAlive(owner.pid), owner };
  }
  const held = await stat(lock).catch(() => null);
  return { abandoned: Boolean(held) && Date.now() - held.mtimeMs > LOCK_STALE_MS, owner };
}

// Every command that writes runs alone: the slot choice, the coordination check and the write all see one snapshot.
// mkdir is atomic, so the lock is a directory; readBoard only reads slot-N.json and never sees it.
async function withRegistryLock(directory, task) {
  await mkdir(directory, { recursive: true });
  const lock = path.join(directory, ".lock");
  const mine = { pid: process.pid, token: randomUUID() };
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await mkdir(lock);
      await writeFile(path.join(lock, "owner.json"), JSON.stringify(mine)).catch(async error => {
        await rm(lock, { recursive: true, force: true });
        throw error;
      });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
    const { abandoned, owner } = await abandonedOwner(lock);
    if (abandoned) {
      // Move it aside (only one waiter wins the rename), and put it back if what we took is not what we inspected.
      const aside = `${lock}.${process.pid}.aside`;
      const moved = await rename(lock, aside).then(() => true, () => false);
      if (moved) {
        const taken = await readOwner(aside);
        if (taken?.token === owner?.token) {
          await rm(aside, { recursive: true, force: true });
        } else {
          await rename(aside, lock).catch(() => {});
        }
      }
      continue;
    }
    if (Date.now() >= deadline) {
      const holder = owner ? ` (PID ${owner.pid})` : "";
      throw new Error(`O registro de agentes está em uso por outro comando${holder} há mais de ${LOCK_WAIT_MS / 1000} s; tente de novo. Se nenhum comando estiver rodando, remova ${lock}.`);
    }
    await sleep(LOCK_RETRY_MS);
  }
  try {
    return await task();
  } finally {
    // Only the owner removes the lock: after a takeover it belongs to someone else.
    if ((await readOwner(lock))?.token === mine.token) {
      await rm(lock, { recursive: true, force: true });
    }
  }
}

async function writeRecord(directory, file, record) {
  const target = path.join(directory, file);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temporary, target);
}

// Board entries carry live git data and their file name; neither belongs in the stored record.
const stored = ({ git: _git, file: _file, ...record }) => record;
const describe = agent => `Agente ${agent.slot} (${agent.agent} · ${agent.title})`;
const conflictsOf = (issues, slot) => issues.filter(issue => issue.severity === "conflict" && issue.slots.includes(slot));
const issueKey = issue => `${issue.kind}|${issue.slots.join(",")}|${issue.subject}`;
const toInteger = value => (/^\d+$/.test(value) ? parseInt(value, 10) : Number.NaN);

function printIssues(issues, print = console.log) {
  for (const issue of issues) {
    print(`${issue.severity === "conflict" ? "CONFLITO" : "AVISO"} [${issue.kind}] ${issue.message}`);
  }
}

function refuse(conflicts, agents, slot) {
  const lines = conflicts.map(issue => {
    const owners = issue.slots.filter(other => other !== slot).map(other => agents.find(agent => agent.slot === other)).filter(Boolean).map(describe);
    return `  [${issue.kind}] ${issue.message}${owners.length ? ` Fale com ${owners.join(" e ")}.` : ""}`;
  });
  throw new Error(`Recusado: conflito com outro agente.\n${lines.join("\n")}`);
}

function ownBranch(info) {
  if (info.error) {
    throw new Error(`Não foi possível ler o git desta worktree: ${info.error}`);
  }
  if (info.branch === "main" || info.branch === "HEAD") {
    throw new Error(`Esta worktree está ${info.branch === "main" ? "em main" : "com HEAD destacado"}; um agente precisa da própria branch (git switch -c feat/...) antes de registrar.`);
  }
  return info.branch;
}

function registered(context) {
  if (!context.mine) {
    throw new Error('Esta worktree não tem registro; rode `npm run agents -- claim --task GF-xx --title "..."` primeiro.');
  }
  return context.mine;
}

// Picks the slot (and its file) for a claim, or explains who holds the wanted one.
function chooseSlot(board, mine, wanted) {
  if (mine) {
    if (wanted !== null && wanted !== mine.slot) {
      throw new Error(`Esta worktree já ocupa o slot ${mine.slot}; rode release antes de escolher outro.`);
    }
    return { slot: mine.slot, file: mine.file };
  }
  const occupied = new Set([...board.agents.map(agent => agent.file), ...board.invalid.map(item => item.file)]);
  if (wanted === null) {
    const slot = Array.from({ length: AGENT_SLOTS }, (_, index) => index + 1).find(number => !occupied.has(slotName(number)));
    if (!slot) {
      throw new Error(`Os ${AGENT_SLOTS} slots estão ocupados por outras worktrees:\n${board.agents.map(agent => `  ${describe(agent)}`).join("\n")}\nFale com um deles para liberar um slot (release).`);
    }
    return { slot, file: slotName(slot) };
  }
  if (Number.isInteger(wanted) && wanted >= 1 && wanted <= AGENT_SLOTS && occupied.has(slotName(wanted))) {
    const holder = board.agents.find(agent => agent.file === slotName(wanted));
    throw new Error(holder ? `Slot ${wanted} ocupado pelo ${describe(holder)}; fale com esse agente ou escolha outro slot.` : `Slot ${wanted} tem um arquivo inválido (${slotName(wanted)}); corrija ou remova o arquivo.`);
  }
  // Anything else (including out-of-range numbers) is validated, and rejected, by validateAgent.
  return { slot: wanted, file: slotName(wanted) };
}

async function claim({ options, context }) {
  if (!context.worktree) {
    throw new Error("Rode dentro de uma worktree git deste repositório.");
  }
  const { board, mine } = context;
  const info = await inspectWorktree(context.worktree);
  const branch = ownBranch(info);
  const { slot, file } = chooseSlot(board, mine, options.slot === undefined ? null : toInteger(options.slot));
  const now = new Date().toISOString();
  const candidate = validateAgent({
    schemaVersion: 1, slot, agent: options.agent || process.env.FABRIC_AGENT_NAME || "Agente", title: options.title ?? "",
    worktree: context.worktree, branch, taskIds: options.task ?? [], state: options.state ?? "planning",
    now: options.now ?? "", next: options.next ?? "", blocker: options.blocker ?? "",
    areas: options.area ?? [], resources: options.resource ?? [], pr: options.pr ?? "",
    startedAt: mine?.startedAt ?? now, updatedAt: now, messages: mine?.messages ?? [],
  });
  const others = board.agents.filter(agent => agent !== mine);
  const { issues } = coordinate([...others, { ...candidate, git: info }]);
  const conflicts = conflictsOf(issues, slot);
  if (conflicts.length) {
    refuse(conflicts, others, slot);
  }
  await writeRecord(context.directory, file, candidate);
  console.log(`Agente ${slot} registrado: ${candidate.title} (${branch}).`);
  printIssues(issues.filter(issue => issue.slots.includes(slot)));
}

async function update({ options, context }) {
  const mine = registered(context);
  const info = await inspectWorktree(context.worktree);
  const state = options.state ?? mine.state;
  const next = validateAgent({
    ...stored(mine), branch: ownBranch(info), state, title: options.title ?? mine.title, taskIds: options.task ?? mine.taskIds,
    areas: options.area ?? mine.areas, resources: options.resource ?? mine.resources,
    now: options.now ?? mine.now, next: options.next ?? mine.next, pr: options.pr ?? mine.pr,
    blocker: options.blocker ?? (state === "blocked" ? mine.blocker : ""), updatedAt: new Date().toISOString(),
  });
  const others = context.board.agents.filter(agent => agent !== mine);
  // Only conflicts this update creates block it, so a heartbeat still works while an older conflict is being resolved.
  const known = new Set(conflictsOf(coordinate(context.board.agents).issues, mine.slot).map(issueKey));
  const { issues } = coordinate([...others, { ...next, git: info }]);
  const created = conflictsOf(issues, next.slot).filter(issue => !known.has(issueKey(issue)));
  if (created.length) {
    refuse(created, others, next.slot);
  }
  await writeRecord(context.directory, mine.file, next);
  console.log(`Agente ${next.slot} atualizado.`);
  printIssues(issues.filter(issue => issue.severity === "warning" && issue.slots.includes(next.slot)));
}

async function say({ positionals, options, context }) {
  const mine = registered(context);
  const at = new Date().toISOString();
  const to = options.to === undefined ? null : toInteger(options.to);
  const next = validateAgent({
    ...stored(mine), messages: [...mine.messages, { at, to, text: positionals.join(" ") }].slice(-MAX_MESSAGES), updatedAt: at,
  });
  await writeRecord(context.directory, mine.file, next);
  console.log(to === null ? "Recado enviado a todos." : `Recado enviado ao Agente ${to}.`);
}

async function check({ context }) {
  const mine = registered(context);
  // Unreadable git state of any agent hides its changed files, so those warnings matter to everyone's check.
  const issues = coordinate(context.board.agents).issues.filter(issue => issue.slots.includes(mine.slot) || issue.kind === "git-error");
  const conflicts = issues.filter(issue => issue.severity === "conflict");
  printIssues(conflicts, console.error);
  printIssues(issues.filter(issue => issue.severity === "warning"));
  // Files that cannot be read are files that cannot be ruled out: any agent with unreadable git fails the check.
  const unreadable = context.board.agents.filter(agent => agent.git.error);
  for (const agent of unreadable) {
    console.error(agent === mine
      ? `Agente ${mine.slot}: check recusado; sem ler o git desta worktree não dá para afirmar que não há conflitos.`
      : `Agente ${mine.slot}: check recusado; o git de ${describe(agent)} está ilegível e seus arquivos alterados são desconhecidos. Fale com esse agente ou espere a worktree voltar.`);
  }
  if (unreadable.length) {
    process.exitCode = 1;
    return;
  }
  if (conflicts.length) {
    process.exitCode = 1;
    return;
  }
  console.log(`Agente ${mine.slot}: sem conflitos.`);
}

async function release({ context }) {
  const { mine } = context;
  if (!mine) {
    console.log("Esta worktree não tem registro; nada a liberar.");
    return;
  }
  await rm(path.join(context.directory, mine.file), { force: true });
  console.log(`Agente ${mine.slot} liberado.`);
}

function branchLine({ git: info }) {
  if (!info.exists) {
    return "worktree não encontrada";
  }
  if (info.error) {
    return `git indisponível: ${info.error}`;
  }
  return `${info.branch} @ ${info.head.slice(0, 7)} (+${info.ahead}/-${info.behind} de ${info.base})${info.dirty ? `, ${info.dirty} alterações locais` : ""}`;
}

async function list({ context }) {
  const { board, mine } = context;
  const { lanes, issues } = coordinate(board.agents);
  console.log(`Registro: ${board.directory}`);
  lanes.forEach((agent, index) => {
    if (!agent) {
      console.log(`Agente ${index + 1} · livre`);
      return;
    }
    console.log(`Agente ${agent.slot} · ${AGENT_STATES[agent.state]} · ${agent.taskIds.join(", ")} · ${agent.title}${agent === mine ? "  ← esta worktree" : ""}`);
    const rows = [
      ["quem", agent.agent], ["worktree", shortPath(agent.worktree, board.home)], ["branch", branchLine(agent)], ["áreas", agent.areas.join(", ")],
      ["recursos", agent.resources.join(", ")], ["agora", agent.now], ["próximo", agent.next], ["bloqueio", agent.blocker],
      ["pr", agent.pr], ["sinal", ago(agent.updatedAt)],
    ];
    for (const [name, value] of rows.filter(([, content]) => content)) {
      console.log(`  ${name.padEnd(9)} ${value}`);
    }
  });
  for (const item of board.invalid) {
    console.log(`ARQUIVO INVÁLIDO ${item.file}: ${item.error}`);
  }
  console.log("");
  if (issues.length) {
    printIssues(issues);
  } else {
    console.log("Nenhum conflito entre os agentes.");
  }
  const messages = messageTimeline(board.agents).slice(0, 10);
  if (messages.length) {
    console.log("\nRecados (mais recentes primeiro):");
    for (const message of messages) {
      console.log(`  Agente ${message.from} → ${message.to === null ? "todos" : `Agente ${message.to}`} (${ago(message.at)}): ${message.text}${mine && message.to === mine.slot ? "  ◀ para você" : ""}`);
    }
  }
}

const commands = { list, claim, update, say, check, release };
// Only these write to the registry, so only these take the lock (reads rely on atomic renames).
const writers = new Set(["claim", "update", "say", "release"]);
const optionSpec = {
  agents: { type: "string" }, agent: { type: "string" }, title: { type: "string" }, state: { type: "string" },
  now: { type: "string" }, next: { type: "string" }, blocker: { type: "string" }, pr: { type: "string" },
  slot: { type: "string" }, to: { type: "string" },
  task: { type: "string", multiple: true }, area: { type: "string", multiple: true }, resource: { type: "string", multiple: true },
};

async function currentWorktree(cwd) {
  try {
    return await realpath((await git(cwd, "rev-parse", "--show-toplevel")).trim());
  } catch {
    return null;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] && !argv[0].startsWith("-") ? argv.shift() : "list";
  if (!Object.hasOwn(commands, command)) {
    throw new Error(`Comando inválido: ${command}. Use ${Object.keys(commands).join(", ")}.`);
  }
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: optionSpec, allowPositionals: true });
  } catch (error) {
    throw new Error(`Argumentos inválidos: ${error.message}`);
  }
  const cwd = process.cwd();
  const directory = parsed.values.agents ? path.resolve(parsed.values.agents) : resolveAgentsDirectory(cwd);
  const worktree = await currentWorktree(cwd);
  const execute = async () => {
    const board = await readBoard(directory);
    const context = { directory, worktree, board, mine: board.agents.find(agent => agent.worktree === worktree) };
    await commands[command]({ options: parsed.values, positionals: parsed.positionals, context });
  };
  await (writers.has(command) ? withRegistryLock(directory, execute) : execute());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
