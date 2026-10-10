import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, utimes, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { AGENT_SLOTS, MAX_MESSAGES, SHARED_PATHS, STALE_MINUTES, coordinate, messageTimeline, validateAgent } from "../dashboard/agents.mjs";
import { agentChips, renderAgents } from "../dashboard/agents-view.mjs";
import { ago, shortPath } from "../dashboard/format.mjs";
import { createDashboardServer } from "../scripts/migration-dashboard.mjs";
import { readBoard, resolveAgentsDirectory } from "../scripts/agents.mjs";

const exec = promisify(execFile);
const cliPath = fileURLToPath(new URL("../scripts/agents.mjs", import.meta.url));
const start = Date.parse("2026-03-01T12:00:00.000Z");
const iso = minutes => new Date(start + minutes * 60000).toISOString();

const record = (slot, overrides = {}) => ({
  schemaVersion: 1, slot, agent: `Agente de teste ${slot}`, title: `Trabalho ${slot}`, worktree: `/work/tree-${slot}`, branch: `feat/${slot}`,
  taskIds: [`GF-0${slot}`], state: "implementing", now: "", next: "", blocker: "", areas: [], resources: [], pr: "",
  startedAt: iso(0), updatedAt: iso(0), messages: [], ...overrides,
});
// Mirrors what the CLI/server attach: live git data of the worktree.
const live = (agent, changed = [], extra = {}) => ({
  ...agent, git: { exists: true, branch: agent.branch, head: "a".repeat(40), base: "origin/main", ahead: 0, behind: 0, dirty: changed.length, changed, ...extra },
});
const find = (result, kind) => result.issues.filter(issue => issue.kind === kind);

test("overlapping areas conflict, and the narrower path names the subject", () => {
  const result = coordinate([record(1, { areas: ["src/a/"] }), record(2, { areas: ["src/a/x.js"] }), record(3, { areas: ["src/other/"] })], start);
  assert.deepEqual(result.issues.map(issue => [issue.kind, issue.severity, issue.slots, issue.subject]), [["area", "conflict", [1, 2], "src/a/x.js"]]);
  assert.match(result.issues[0].message, /Agente 1/);
});

test("a file changed inside another agent's area is trespass, never a plain file conflict", () => {
  const result = coordinate([live(record(1, { areas: ["src/a/"] }), ["src/a/own.js"]), live(record(2, { areas: ["src/b/"] }), ["src/a/new.js", "src/b/own.js"])], start);
  assert.deepEqual(result.issues.map(issue => [issue.kind, issue.subject]), [["trespass", "src/a/new.js"]]);
  assert.equal(result.issues[0].message, "Agente 2 alterou src/a/new.js na área reservada pelo Agente 1.");
  // Both agents editing a file that sits in one of their areas is trespass too, so no file conflict repeats it.
  const both = coordinate([live(record(1, { areas: ["src/a/"] }), ["src/a/shared.js"]), live(record(2), ["src/a/shared.js"])], start);
  assert.deepEqual(both.issues.map(issue => issue.kind), ["trespass"]);
});

test("the same file outside any area is a file conflict", () => {
  const result = coordinate([live(record(1), ["src/loose.js"]), live(record(2), ["src/loose.js", "src/mine.js"])], start);
  assert.deepEqual(result.issues.map(issue => [issue.kind, issue.severity, issue.slots, issue.subject]), [["file", "conflict", [1, 2], "src/loose.js"]]);
});

test("shared files only warn when 2+ agents change them", () => {
  // Hubs every slice appends to, one per group of SHARED_PATHS.
  const appended = ["tests/types/consumer.tsx", "tests/platform-seams.test.mjs", "native/fabric_application.cpp", "examples/entry.jsx", "docs/API.md", "docs/research/README.md", "docs/NATIVE_EXTENSIONS.md", "scripts/sabotage-sources.mjs", "scripts/hosted-receipts-slices.mjs"];
  for (const shared of ["ROADMAP.md", "native/application_runtime.cpp", "native/CMakeLists.txt", "native/register.cpp", "src/react-native-platform.jsx", "types/react-native.ts", ...appended]) {
    assert.ok(SHARED_PATHS.includes(shared), shared);
  }
  assert.equal(SHARED_PATHS.length, 37);
  assert.equal(new Set(SHARED_PATHS).size, SHARED_PATHS.length, "no duplicates");
  // Outside any area, changing them from two agents is only a shared warning.
  for (const file of appended) {
    const both = coordinate([live(record(1), [file]), live(record(2), [file])], start);
    assert.deepEqual(both.issues.map(issue => [issue.kind, issue.severity, issue.subject]), [["shared", "warning", file]], file);
  }
  const result = coordinate([live(record(1), ["ROADMAP.md", "package.json"]), live(record(2), ["ROADMAP.md"])], start);
  assert.deepEqual(result.issues.map(issue => [issue.kind, issue.severity, issue.subject]), [["shared", "warning", "ROADMAP.md"]]);
  assert.match(result.issues[0].message, /merge sequencial pelo orquestrador/);
});

test("shared files are cut out of every area: reserving one is allowed, never exclusive", () => {
  // Two agents reserving the very same shared file do not conflict; each only gets the shared-area warning.
  const both = coordinate([record(1, { areas: ["native/register.cpp"] }), record(2, { areas: ["native/register.cpp", "native/CMakeLists.txt"] })], start);
  assert.deepEqual(both.issues.map(issue => [issue.kind, issue.severity, issue.slots, issue.subject]), [["shared-area", "warning", [1], "slot 1"], ["shared-area", "warning", [2], "slot 2"]]);
  // A shared file reserved by one agent and a directory containing it reserved by another is not an area conflict.
  const inside = coordinate([record(1, { areas: ["native/register.cpp"] }), record(2, { areas: ["native/"] })], start);
  assert.deepEqual(inside.issues.map(issue => [issue.kind, issue.slots]), [["shared-area", [1]]]);
  // Directories that contain a shared file still conflict with each other.
  const directories = coordinate([record(1, { areas: ["native/"] }), record(2, { areas: ["native/modal/"] })], start);
  assert.deepEqual(directories.issues.map(issue => [issue.kind, issue.severity, issue.slots, issue.subject]), [["area", "conflict", [1, 2], "native/modal/"]]);
  // Changing a shared file inside another agent's area is neither trespass nor a file conflict...
  const changed = coordinate([live(record(1, { areas: ["native/"] })), live(record(2), ["native/register.cpp", "src/react-native-platform.jsx"])], start);
  assert.deepEqual(changed.issues, []);
  // ...it only warns once both changed it, while other files in that area are still trespass.
  const warned = coordinate([live(record(1, { areas: ["native/"] }), ["native/register.cpp"]), live(record(2), ["native/register.cpp", "native/other.cpp"])], start);
  assert.deepEqual(warned.issues.map(issue => [issue.kind, issue.severity, issue.subject]), [["trespass", "conflict", "native/other.cpp"], ["shared", "warning", "native/register.cpp"]]);
  // One shared-area warning per agent, listing every shared file it reserved and none of its exclusive areas.
  const reserved = coordinate([record(1, { areas: ["src/a/", "native/register.cpp", "native/CMakeLists.txt", "ROADMAP.md"] })], start);
  assert.equal(reserved.issues.length, 1);
  assert.deepEqual([reserved.issues[0].kind, reserved.issues[0].severity, reserved.issues[0].subject], ["shared-area", "warning", "slot 1"]);
  assert.equal(reserved.issues[0].message, "Agente 1 reservou arquivos compartilhados (native/register.cpp, native/CMakeLists.txt, ROADMAP.md): a reserva não é exclusiva; merge sequencial pelo orquestrador. Remova-os das áreas no próximo update.");
});

test("the same GF in two agents is a warning", () => {
  const result = coordinate([record(1, { taskIds: ["GF-22", "GF-23"] }), record(2, { taskIds: ["GF-22"] })], start);
  assert.deepEqual(result.issues.map(issue => [issue.kind, issue.severity, issue.slots, issue.subject]), [["task", "warning", [1, 2], "GF-22"]]);
  assert.match(result.issues[0].message, /coordenem a divisão do GF-22/);
});

test("stale records warn only after the threshold", () => {
  const edge = coordinate([record(1, { updatedAt: iso(-STALE_MINUTES) })], start);
  assert.deepEqual(edge.issues, []);
  const old = coordinate([record(1, { updatedAt: iso(-STALE_MINUTES - 5) })], start);
  assert.deepEqual(old.issues.map(issue => [issue.kind, issue.severity, issue.slots]), [["stale", "warning", [1]]]);
  assert.match(old.issues[0].message, /sem sinal há 35 min/);
});

test("branch, resource, worktree and slot clashes are conflicts; missing worktrees and branch drift warn", () => {
  const branch = coordinate([record(1, { resources: ["port:4318", "build:modal"] }), live(record(2, { resources: ["port:4318"] }), [], { branch: "feat/1" })], start);
  assert.deepEqual(branch.issues.map(issue => [issue.kind, issue.severity, issue.subject]), [["branch", "conflict", "feat/1"], ["resource", "conflict", "port:4318"], ["drift", "warning", "feat/1"]]);
  const same = coordinate([record(1, { worktree: "/work/shared" }), record(2, { worktree: "/work/shared" })], start);
  assert.deepEqual(find(same, "worktree").map(issue => issue.subject), ["/work/shared"]);
  const duplicate = coordinate([record(3), record(3, { branch: "feat/other", worktree: "/work/other" })], start);
  assert.deepEqual(find(duplicate, "slot").map(issue => issue.slots), [[3]]);
  const missing = coordinate([live(record(1), [], { exists: false })], start);
  assert.deepEqual(missing.issues.map(issue => issue.kind), ["missing"]);
});

test("an agent whose git state cannot be read gets a git-error warning instead of vanishing silently", () => {
  const unreadable = live(record(1, { areas: ["src/a/"] }), [], { error: "fatal: unknown revision main...HEAD" });
  delete unreadable.git.changed;
  const result = coordinate([unreadable, live(record(2), ["src/a/new.js"])], start);
  assert.deepEqual(result.issues.map(issue => [issue.kind, issue.severity, issue.slots]), [["trespass", "conflict", [1, 2]], ["git-error", "warning", [1]]]);
  const warning = find(result, "git-error")[0];
  assert.match(warning.message, /Agente 1: não foi possível ler o git da worktree \(fatal: unknown revision main\.\.\.HEAD\); arquivos alterados desconhecidos\./);
});

test("lanes always have five positions keyed by slot", () => {
  const result = coordinate([record(5), record(2)], start);
  assert.equal(result.lanes.length, AGENT_SLOTS);
  assert.deepEqual(result.lanes.map(lane => lane?.slot ?? null), [null, 2, null, null, 5]);
  assert.deepEqual(coordinate([], start), { lanes: [null, null, null, null, null], issues: [] });
});

test("issue order is deterministic: conflicts first, then slots and subject", () => {
  const agents = [
    live(record(3, { taskIds: ["GF-01"], updatedAt: iso(-90) }), ["ROADMAP.md", "src/z.js", "src/y.js"]),
    live(record(1, { taskIds: ["GF-01"] }), ["ROADMAP.md", "src/z.js", "src/y.js"]),
    live(record(2, { resources: ["port:1"] }), ["src/z.js"]),
  ];
  const result = coordinate(agents, start);
  assert.deepEqual(result.issues.map(issue => `${issue.severity}:${issue.kind}:${issue.slots}:${issue.subject}`), [
    "conflict:file:1,2:src/z.js", "conflict:file:1,3:src/y.js", "conflict:file:1,3:src/z.js", "conflict:file:2,3:src/z.js",
    "warning:task:1,3:GF-01", "warning:shared:1,3:ROADMAP.md", "warning:stale:3:slot 3",
  ]);
  assert.deepEqual(coordinate([...agents].reverse(), start), result);
  const seen = new Set(result.issues.map(issue => `${issue.kind}|${issue.slots}|${issue.subject}`));
  assert.equal(seen.size, result.issues.length);
});

test("validateAgent accepts a complete record and rejects invalid ones with Portuguese messages", () => {
  const ok = record(1, { areas: ["src/a/", "src/b.js"], resources: ["port:4318"], pr: "https://example.com/pr/1", state: "blocked", blocker: "aguardando CI", messages: [{ at: iso(1), to: null, text: "oi" }, { at: iso(2), to: 2, text: "olá" }] });
  assert.equal(validateAgent(ok), ok);
  // Shared files and the directories that contain them are valid areas (they are just never exclusive).
  const withShared = record(1, { areas: ["native/register.cpp", "native/", "dashboard/", "ROADMAP.md"] });
  assert.equal(validateAgent(withShared), withShared);
  const rejected = {
    "slot 0": [{ slot: 0 }, /slot/],
    "slot 6": [{ slot: 6 }, /slot/],
    "absolute area": [{ areas: ["/src/a/"] }, /areas/],
    "area with ..": [{ areas: ["src/../x.js"] }, /areas/],
    "area with *": [{ areas: ["src/*.js"] }, /areas/],
    "backslash area": [{ areas: ["src\\a\\"] }, /areas/],
    "duplicate area": [{ areas: ["src/a/", "src/a/"] }, /duplicados/],
    "blocked without blocker": [{ state: "blocked" }, /blocker/],
    "unknown state": [{ state: "sleeping" }, /state/],
    "malformed GF": [{ taskIds: ["GF-2"] }, /taskIds/],
    "no GF": [{ taskIds: [] }, /taskIds/],
    "non-https PR": [{ pr: "http://example.com/pr/1" }, /pr/],
    "main branch": [{ branch: "main" }, /branch/],
    "relative worktree": [{ worktree: "work/tree" }, /worktree/],
    "bad resource": [{ resources: ["4318"] }, /resources/],
    "bad date": [{ updatedAt: "yesterday" }, /updatedAt/],
    "bad schema": [{ schemaVersion: 2 }, /schemaVersion/],
    "message to a bad slot": [{ messages: [{ at: iso(1), to: 9, text: "oi" }] }, /messages\.to/],
    "empty message": [{ messages: [{ at: iso(1), to: null, text: " " }] }, /messages\.text/],
    "too many messages": [{ messages: Array.from({ length: MAX_MESSAGES + 1 }, (_, index) => ({ at: iso(index), to: null, text: `m${index}` })) }, /messages/],
  };
  for (const [name, [patch, pattern]] of Object.entries(rejected)) {
    assert.throws(() => validateAgent(record(1, patch)), pattern, name);
  }
  assert.throws(() => validateAgent(null), /registro/);
});

test("the message timeline merges every agent's messages, newest first, with the sender", () => {
  const timeline = messageTimeline([
    record(1, { messages: [{ at: iso(1), to: null, text: "first" }, { at: iso(5), to: 2, text: "third" }] }),
    record(2, { messages: [{ at: iso(3), to: 1, text: "second" }] }),
    record(3),
  ]);
  assert.deepEqual(timeline.map(message => [message.from, message.to, message.text]), [[1, 2, "third"], [2, 1, "second"], [1, null, "first"]]);
  assert.deepEqual(messageTimeline([]), []);
});

test("home directories are shortened to ~ only on whole path segments", () => {
  assert.equal(shortPath("/home/dev/.codex/worktrees/a", "/home/dev"), "~/.codex/worktrees/a");
  assert.equal(shortPath("/home/dev", "/home/dev"), "~");
  assert.equal(shortPath("/home/developer/x", "/home/dev"), "/home/developer/x");
  assert.equal(shortPath("/work/x", ""), "/work/x");
});

test("relative time reads as agora, minutes, hours and days", () => {
  const now = Date.parse(iso(0));
  assert.equal(ago(iso(0), now), "agora");
  assert.equal(ago(iso(1), now), "agora");
  assert.equal(ago("not a date", now), "agora");
  assert.equal(ago(iso(-4), now), "há 4 min");
  assert.equal(ago(iso(-120), now), "há 2 h");
  assert.equal(ago(iso(-3 * 24 * 60), now), "há 3 d");
});

test("the board view escapes registry text, shortens home, shows five lanes and the Pages notice", () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const agents = [
    live(record(1, { title: hostile, worktree: "/home/dev/.codex/worktrees/abc/godot-fabric", areas: ["src/a/"], messages: [{ at: iso(1), to: 2, text: hostile }], pr: "javascript:alert(1)" }), ["src/a/x.js"]),
    live(record(2, { areas: ["src/a/x.js"] }), ["src/a/x.js"], { dirty: 3, ahead: 2, behind: 1 }),
  ];
  const coordination = coordinate(agents, start);
  const board = { capacity: 5, directory: "/home/dev/registry", home: "/home/dev", generatedAt: iso(0), agents, invalid: [{ file: "slot-4.json", error: "JSON inválido" }] };
  const html = renderAgents(board, coordination, [{ id: "GF-01", title: "Primeiro" }]);
  assert.ok(!html.includes("<img"), "registry text must be escaped");
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("~/.codex/worktrees/abc/godot-fabric"));
  assert.ok(!html.includes("/home/dev/.codex"));
  assert.ok(!html.includes('href="javascript:'));
  assert.equal(html.match(/<article class="agent-lane/g).length, AGENT_SLOTS);
  assert.equal(html.match(/<article class="agent-lane free/g).length, AGENT_SLOTS - 2);
  assert.match(html, /2 \/ 5 agentes ativos/);
  // The reason of a conflict is shown inside the card of every agent involved, not only in the coordination panel.
  const [, first, second] = html.split('<article class="agent-lane');
  for (const card of [first, second]) {
    assert.match(card, /<ul class="agent-issues"><li class="agent-issue conflict">/);
    assert.match(card, /alterou src\/a\/x\.js na área reservada pelo Agente [12]/);
  }
  for (const shared of SHARED_PATHS) {
    assert.ok(html.includes(`<code>${shared}</code>`), shared);
  }
  assert.match(html, /\+2 \/ −1 de origin\/main/);
  assert.match(html, /data-task="GF-01"/);
  assert.match(html, /agent-files-1/);
  assert.match(html, /slot-4\.json/);
  assert.match(renderAgents({ ...board, agents: [], invalid: [] }, coordinate([], start), []), /Nenhum conflito entre os agentes\./);
  assert.match(renderAgents(null, null, []), /Quadro local: rode <code>npm run dashboard<\/code>/);
  const unavailable = renderAgents(null, null, [], "Quadro de agentes indisponível: <git> falhou");
  assert.match(unavailable, /Quadro de agentes indisponível: &lt;git&gt; falhou/);
  assert.doesNotMatch(unavailable, /Quadro local/);
  assert.match(renderAgents(board, coordination, [], "Quadro de agentes indisponível: HTTP 503"), /HTTP 503 Exibindo o último quadro recebido\./);
  assert.match(agentChips("GF-01", coordination), /class="agent-chip agent-1"[^>]*>Agente 1</);
  assert.equal(agentChips("GF-99", coordination), "");
  assert.equal(agentChips("GF-01", null), "");
});

// A throwaway clone with an origin and two agent worktrees, mirroring how real agents work.
async function createRepository(t, extra = 0) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "fabric-agents-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const git = (cwd, ...args) => exec("git", args, { cwd });
  const main = path.join(base, "main");
  await mkdir(main);
  await git(main, "init", "-q", "-b", "main");
  for (const [key, value] of [["user.email", "agents@example.test"], ["user.name", "Agents Test"], ["commit.gpgsign", "false"], ["core.hooksPath", devNull]]) {
    await git(main, "config", key, value);
  }
  await writeFile(path.join(main, "README.md"), "base\n");
  await writeFile(path.join(main, "docs.md"), "docs\n");
  await mkdir(path.join(main, "lib"));
  await writeFile(path.join(main, "lib/util.js"), "export {}\n");
  await git(main, "add", ".");
  await git(main, "commit", "-q", "-m", "initial");
  await git(base, "clone", "-q", "--bare", main, "origin.git");
  await git(main, "remote", "add", "origin", path.join(base, "origin.git"));
  await git(main, "fetch", "-q", "origin");
  const a = path.join(base, "a");
  const b = path.join(base, "b");
  await git(main, "worktree", "add", "-q", "-b", "feat/a", a);
  await git(main, "worktree", "add", "-q", "-b", "feat/b", b);
  // `all` is every agent worktree: a, b and `extra` more.
  const all = [a, b];
  for (let index = 0; index < extra; index++) {
    const more = path.join(base, `w${index + 3}`);
    await git(main, "worktree", "add", "-q", "-b", `feat/w${index + 3}`, more);
    all.push(more);
  }
  return { base, main, a, b, all, git, directory: path.join(base, "registry") };
}

async function cliWithEnv(env, cwd, directory, ...args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [cliPath, ...args], { cwd, env: { ...process.env, FABRIC_AGENTS_DIR: directory, FABRIC_AGENT_NAME: "", ...env } });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}
const cli = (...args) => cliWithEnv({}, ...args);

// Leaves a registry lock behind as another command would. Without `pid` there is no owner.json yet.
async function plantLock(directory, { pid, ageMinutes }) {
  const lock = path.join(directory, ".lock");
  await mkdir(lock, { recursive: true });
  if (pid !== undefined) {
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid, token: "planted" }));
  }
  const when = new Date(Date.now() - ageMinutes * 60000);
  await utimes(lock, when, when);
  return lock;
}

test("readBoard reads live git state and reports invalid files without throwing", async t => {
  const { main, a, git, directory } = await createRepository(t);
  await writeFile(path.join(a, "committed.txt"), "new\n");
  await git(a, "add", "committed.txt");
  await git(a, "commit", "-q", "-m", "work");
  await writeFile(path.join(a, "README.md"), "changed\n");
  await git(a, "mv", "docs.md", "guide.md");
  await mkdir(path.join(a, "deep/nested"), { recursive: true });
  await writeFile(path.join(a, "deep/nested/new.txt"), "x\n");
  // origin/main moves ahead of the branch point.
  await writeFile(path.join(main, "upstream.txt"), "upstream\n");
  await git(main, "add", "upstream.txt");
  await git(main, "commit", "-q", "-m", "upstream");
  await git(main, "push", "-q", "origin", "main");
  await mkdir(directory);
  await writeFile(path.join(directory, "slot-1.json"), JSON.stringify(record(1, { worktree: a, branch: "feat/a" })));
  await writeFile(path.join(directory, "slot-2.json"), JSON.stringify(record(2, { worktree: path.join(directory, "gone"), branch: "feat/gone" })));
  await writeFile(path.join(directory, "slot-3.json"), "{oops");
  await writeFile(path.join(directory, "slot-4.json"), JSON.stringify(record(9)));
  await writeFile(path.join(directory, "slot-6.json"), "ignored");
  const board = await readBoard(directory);
  assert.equal(board.capacity, 5);
  assert.equal(board.directory, directory);
  assert.deepEqual(board.agents.map(agent => agent.slot), [1, 2]);
  assert.deepEqual(board.agents[0].git, {
    exists: true, branch: "feat/a", head: board.agents[0].git.head, base: "origin/main", ahead: 1, behind: 1, dirty: 3,
    // The staged rename docs.md -> guide.md touches both paths but is a single status entry.
    changed: ["README.md", "committed.txt", "deep/nested/new.txt", "docs.md", "guide.md"],
  });
  assert.match(board.agents[0].git.head, /^[0-9a-f]{40}$/);
  assert.deepEqual(board.agents[1].git, { exists: false });
  assert.deepEqual(board.invalid.map(item => item.file), ["slot-3.json", "slot-4.json"]);
  assert.match(board.invalid[0].error, /JSON inválido/);
  assert.match(board.invalid[1].error, /slot/);
  const none = await readBoard(path.join(directory, "missing"));
  assert.deepEqual([none.agents, none.invalid], [[], []]);
});

test("polling a worktree never rewrites its index, so it cannot break that agent's git add or commit", async t => {
  const { a, git, directory } = await createRepository(t);
  const index = path.resolve(a, (await git(a, "rev-parse", "--git-path", "index")).stdout.trim());
  // Same content, new mtime: a plain `git status` would refresh the index (taking index.lock) to cache this.
  const later = new Date(Date.now() + 5000);
  await utimes(path.join(a, "README.md"), later, later);
  const before = await stat(index);
  await mkdir(directory);
  await writeFile(path.join(directory, "slot-1.json"), JSON.stringify(record(1, { worktree: a, branch: "feat/a" })));
  assert.equal((await readBoard(directory)).agents[0].git.dirty, 0);
  const after = await stat(index);
  assert.deepEqual([after.ino, after.mtimeMs], [before.ino, before.mtimeMs]);
});

test("the registry defaults to the shared git directory and honors FABRIC_AGENTS_DIR", async t => {
  const { main, a } = await createRepository(t);
  const saved = process.env.FABRIC_AGENTS_DIR;
  t.after(() => {
    if (saved === undefined) {
      delete process.env.FABRIC_AGENTS_DIR;
    } else {
      process.env.FABRIC_AGENTS_DIR = saved;
    }
  });
  delete process.env.FABRIC_AGENTS_DIR;
  const shared = path.join(main, ".git", "fabric-agents");
  assert.equal(resolveAgentsDirectory(a), shared);
  assert.equal(resolveAgentsDirectory(main), shared);
  process.env.FABRIC_AGENTS_DIR = "custom/registry";
  assert.equal(resolveAgentsDirectory(a), path.resolve("custom/registry"));
});

test("agents coordinate through the CLI: claim, conflict, trespass, messages and release", async t => {
  const { main, a, b, directory } = await createRepository(t);
  const claimA = await cli(a, directory, "claim", "--task", "GF-22", "--title", "HTTP", "--agent", "Codex · GPT-5", "--area", "src/a/", "--resource", "port:4318", "--next", "testes");
  assert.equal(claimA.code, 0, claimA.stderr);
  const stored = JSON.parse(await readFile(path.join(directory, "slot-1.json"), "utf8"));
  assert.equal(stored.worktree, a);
  assert.equal(stored.branch, "feat/a");
  assert.deepEqual(Object.keys(stored).filter(key => key === "git" || key === "file"), []);
  assert.doesNotThrow(() => validateAgent(stored));

  const overlap = await cli(b, directory, "claim", "--task", "GF-23", "--title", "WebSocket", "--area", "src/a/x.js");
  assert.equal(overlap.code, 1);
  assert.match(overlap.stderr, /Agente 1/);
  assert.match(overlap.stderr, /src\/a\/x\.js/);
  assert.deepEqual(await readdir(directory), ["slot-1.json"]);

  const sameResource = await cli(b, directory, "claim", "--task", "GF-23", "--title", "WebSocket", "--resource", "port:4318");
  assert.equal(sameResource.code, 1);
  assert.match(sameResource.stderr, /port:4318/);

  const claimB = await cli(b, directory, "claim", "--task", "GF-23", "--title", "WebSocket", "--area", "src/b/", "--agent", "Claude · Opus");
  assert.equal(claimB.code, 0, claimB.stderr);
  assert.deepEqual((await readdir(directory)).sort(), ["slot-1.json", "slot-2.json"]);

  const clean = await cli(a, directory, "check");
  assert.equal(clean.code, 0, clean.stderr);

  await mkdir(path.join(b, "src/a"), { recursive: true });
  await writeFile(path.join(b, "src/a/novo.js"), "export {}\n");
  const checkB = await cli(b, directory, "check");
  assert.equal(checkB.code, 1);
  assert.match(checkB.stderr, /\[trespass\] Agente 2 alterou src\/a\/novo\.js na área reservada pelo Agente 1/);
  assert.equal((await cli(a, directory, "check")).code, 1);

  // An existing conflict does not freeze the agent: only updates that create new ones are refused.
  const heartbeat = await cli(b, directory, "update", "--now", "movendo o arquivo");
  assert.equal(heartbeat.code, 0, heartbeat.stderr);
  const grab = await cli(b, directory, "update", "--area", "src/b/", "--area", "src/a/");
  assert.equal(grab.code, 1);
  assert.match(grab.stderr, /Agente 1/);

  assert.equal((await cli(b, directory, "say", "preciso de src/a/novo.js", "--to", "1")).code, 0);
  assert.equal((await cli(b, directory, "say", "bom dia a todos")).code, 0);
  const listA = await cli(a, directory, "list");
  assert.equal(listA.code, 0, listA.stderr);
  assert.match(listA.stdout, /Agente 1 · Planejando · GF-22 · HTTP {2}← esta worktree/);
  assert.match(listA.stdout, /Agente 2 · Planejando · GF-23 · WebSocket/);
  assert.match(listA.stdout, /Agente 3 · livre/);
  assert.match(listA.stdout, /Agente 2 → Agente 1 \([^)]*\): preciso de src\/a\/novo\.js {2}◀ para você/);
  assert.match(listA.stdout, /Agente 2 → todos \([^)]*\): bom dia a todos\n/);
  assert.match(listA.stdout, /CONFLITO \[trespass\]/);
  const listB = await cli(b, directory, "list");
  assert.doesNotMatch(listB.stdout, /◀ para você/);

  const blocked = await cli(b, directory, "update", "--state", "blocked");
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /blocker/);
  assert.equal((await cli(b, directory, "update", "--state", "blocked", "--blocker", "aguardando o Agente 1")).code, 0);
  assert.equal((await cli(b, directory, "update", "--state", "testing")).code, 0);
  assert.equal(JSON.parse(await readFile(path.join(directory, "slot-2.json"), "utf8")).blocker, "");

  assert.equal((await cli(b, directory, "release")).code, 0);
  assert.deepEqual(await readdir(directory), ["slot-1.json"]);
  assert.equal((await cli(a, directory, "check")).code, 0);
  assert.equal((await cli(b, directory, "release")).code, 0, "releasing twice is harmless");
  assert.equal((await cli(b, directory, "check")).code, 1, "an unregistered worktree must claim first");

  // The leftover edit still sits in Agente 1's area, so B cannot claim until it is gone.
  const again = await cli(b, directory, "claim", "--task", "GF-23", "--title", "WebSocket", "--area", "src/b/");
  assert.equal(again.code, 1);
  assert.match(again.stderr, /trespass/);
  await rm(path.join(b, "src/a"), { recursive: true });
  const freed = await cli(b, directory, "claim", "--task", "GF-23", "--title", "WebSocket", "--area", "src/b/");
  assert.equal(freed.code, 0, freed.stderr);
  assert.deepEqual((await readdir(directory)).sort(), ["slot-1.json", "slot-2.json"], "the freed slot is reused");

  // Reserving shared files is not refused; the warning is printed like any other.
  const shared = await cli(a, directory, "update", "--area", "src/a/", "--area", "native/register.cpp");
  assert.equal(shared.code, 0, shared.stderr);
  assert.match(shared.stdout, /AVISO \[shared-area\] Agente 1 reservou arquivos compartilhados \(native\/register\.cpp\)/);
  const nativeDirectory = await cli(b, directory, "update", "--area", "src/b/", "--area", "native/");
  assert.equal(nativeDirectory.code, 0, nativeDirectory.stderr);
  assert.doesNotMatch(nativeDirectory.stdout, /shared-area/);

  const onMain = await cli(main, directory, "claim", "--task", "GF-24", "--title", "Na main");
  assert.equal(onMain.code, 1);
  assert.match(onMain.stderr, /main/);
});

test("claim honors --slot, keeps the slot on re-claim and refuses a sixth agent", async t => {
  const { a, b, directory } = await createRepository(t);
  assert.equal((await cli(a, directory, "claim", "--task", "GF-22", "--title", "A", "--slot", "3")).code, 0);
  assert.deepEqual(await readdir(directory), ["slot-3.json"]);
  const taken = await cli(b, directory, "claim", "--task", "GF-23", "--title", "B", "--slot", "3");
  assert.equal(taken.code, 1);
  assert.match(taken.stderr, /Agente 3/);
  const moved = await cli(a, directory, "claim", "--task", "GF-22", "--title", "A", "--slot", "1");
  assert.equal(moved.code, 1);
  assert.match(moved.stderr, /release/);
  assert.equal((await cli(a, directory, "say", "recado que sobrevive", "--to", "2")).code, 0);
  const startedAt = JSON.parse(await readFile(path.join(directory, "slot-3.json"), "utf8")).startedAt;
  assert.equal((await cli(a, directory, "claim", "--task", "GF-22", "--task", "GF-24", "--title", "A2")).code, 0);
  const renewed = JSON.parse(await readFile(path.join(directory, "slot-3.json"), "utf8"));
  assert.deepEqual([renewed.slot, renewed.startedAt, renewed.taskIds, renewed.title, renewed.messages.map(message => message.text)], [3, startedAt, ["GF-22", "GF-24"], "A2", ["recado que sobrevive"]]);

  // Five other worktrees (fictional) fill every slot, so a sixth agent is turned away.
  const full = path.join(directory, "full");
  await mkdir(full);
  for (let slot = 1; slot <= AGENT_SLOTS; slot++) {
    await writeFile(path.join(full, `slot-${slot}.json`), JSON.stringify(record(slot, { worktree: path.join(full, `tree-${slot}`) })));
  }
  const sixth = await cli(b, full, "claim", "--task", "GF-30", "--title", "Sexto");
  assert.equal(sixth.code, 1);
  assert.match(sixth.stderr, /5 slots estão ocupados/);
  assert.match(sixth.stderr, /Agente 1/);
  assert.equal((await readdir(full)).length, AGENT_SLOTS);
});

test("concurrent claims are serialized: one winner for a contested area, no lost record otherwise", async t => {
  const contested = await createRepository(t, 1);
  const claim = (directory, cwd, ...extra) => cli(cwd, directory, "claim", "--task", "GF-30", "--title", "Concorrente", ...extra);
  const results = await Promise.all(contested.all.map(cwd => claim(contested.directory, cwd, "--area", "src/shared/")));
  assert.deepEqual(results.map(result => result.code).sort(), [0, 1, 1]);
  for (const loser of results.filter(result => result.code === 1)) {
    assert.match(loser.stderr, /Agente 1/);
  }
  assert.deepEqual(await readdir(contested.directory), ["slot-1.json"]);

  // Without --slot every agent asks for "the first free slot": they must still land in distinct slots.
  const open = await createRepository(t, 3);
  const all = await Promise.all(open.all.map((cwd, index) => claim(open.directory, cwd, "--area", `src/area-${index}/`)));
  assert.deepEqual(all.map(result => result.code), [0, 0, 0, 0, 0], all.map(result => result.stderr).join("\n"));
  assert.deepEqual((await readdir(open.directory)).sort(), [1, 2, 3, 4, 5].map(slot => `slot-${slot}.json`));
  const board = await readBoard(open.directory);
  assert.deepEqual([board.agents.length, board.invalid.length, new Set(board.agents.map(agent => agent.worktree)).size], [5, 0, 5]);
});

test("an abandoned registry lock is recovered by its owner's liveness", async t => {
  const { a, b, directory } = await createRepository(t);
  const claim = cwd => cli(cwd, directory, "claim", "--task", "GF-30", "--title", "Lock");
  const dead = spawn(process.execPath, ["-e", ""]);
  await once(dead, "exit");
  // The owner process is gone: the lock is taken over at once, even though it is brand new.
  await plantLock(directory, { pid: dead.pid, ageMinutes: 0 });
  const recovered = await claim(a);
  assert.equal(recovered.code, 0, recovered.stderr);
  assert.deepEqual(await readdir(directory), ["slot-1.json"], "the recovered lock is released afterwards");
  // No owner.json and old: its process died between mkdir and writing the owner.
  await plantLock(directory, { ageMinutes: 5 });
  const ownerless = await claim(b);
  assert.equal(ownerless.code, 0, ownerless.stderr);
  assert.deepEqual((await readdir(directory)).sort(), ["slot-1.json", "slot-2.json"]);
});

test("a lock held by a live process is never taken over, however old", async t => {
  const { a, directory } = await createRepository(t);
  const claim = () => cliWithEnv({ FABRIC_AGENTS_LOCK_WAIT_MS: "600" }, a, directory, "claim", "--task", "GF-30", "--title", "Lock");
  const lock = await plantLock(directory, { pid: process.pid, ageMinutes: 5 });
  const refused = await claim();
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, new RegExp(`em uso por outro comando \\(PID ${process.pid}\\)`));
  assert.deepEqual((await readdir(directory)).sort(), [".lock"], "no record was written");
  assert.deepEqual(JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8")), { pid: process.pid, token: "planted" }, "the owner's lock is untouched");
  // A recent lock without an owner yet may still be about to get one: also respected.
  await rm(lock, { recursive: true });
  await plantLock(directory, { ageMinutes: 0 });
  const recent = await claim();
  assert.equal(recent.code, 1);
  assert.match(recent.stderr, /em uso por outro comando há mais de/);
  assert.deepEqual((await readdir(directory)).sort(), [".lock"]);
});

test("a held registry lock is waited for, and reads never wait", async t => {
  const { a, b, directory } = await createRepository(t);
  const lock = await plantLock(directory, { ageMinutes: 0 });
  const waiting = cli(b, directory, "claim", "--task", "GF-30", "--title", "Lock");
  assert.equal((await cli(a, directory, "list")).code, 0, "listing is read-only and does not take the lock");
  assert.equal((await cli(a, directory, "check")).code, 1, "check without a record asks for a claim, but does not wait");
  await sleep(1200);
  assert.deepEqual((await readdir(directory)).sort(), [".lock"], "the claim keeps waiting while the lock is held");
  await rm(lock, { recursive: true });
  const done = await waiting;
  assert.equal(done.code, 0, done.stderr);
  assert.deepEqual(await readdir(directory), ["slot-1.json"]);
});

test("check still sees trespass when a git hook leaks its repository variables, and refuses when it cannot read git", async t => {
  const { main, a, b, git, directory } = await createRepository(t);
  assert.equal((await cli(a, directory, "claim", "--task", "GF-22", "--title", "A", "--area", "lib/")).code, 0);
  assert.equal((await cli(b, directory, "claim", "--task", "GF-23", "--title", "B", "--area", "src/b/")).code, 0);
  await writeFile(path.join(b, "lib/leaked.js"), "export {}\n");
  // What a pre-commit hook exports: they would point `git -C <worktree>` at the wrong repository state.
  const leaked = { GIT_DIR: path.join(main, ".git"), GIT_WORK_TREE: main, GIT_INDEX_FILE: path.join(path.dirname(main), "nowhere-index") };
  const check = await cliWithEnv(leaked, b, directory, "check");
  assert.equal(check.code, 1);
  assert.match(check.stderr, /\[trespass\] Agente 2 alterou lib\/leaked\.js na área reservada pelo Agente 1/);

  // Breaking the base branch makes git fail for every worktree: the check cannot vouch for anything and says so.
  await git(main, "update-ref", "-d", "refs/remotes/origin/main");
  await git(main, "update-ref", "-d", "refs/heads/main");
  const blind = await cli(b, directory, "check");
  assert.equal(blind.code, 1);
  assert.match(blind.stdout, /AVISO \[git-error\] Agente 2: não foi possível ler o git da worktree/);
  assert.match(blind.stderr, /Agente 2: check recusado/);
  assert.doesNotMatch(blind.stdout, /sem conflitos/);
});

test("check also fails when only ANOTHER agent's git cannot be read", async t => {
  const { base, a, b, directory } = await createRepository(t);
  assert.equal((await cli(a, directory, "claim", "--task", "GF-22", "--title", "A", "--area", "lib/")).code, 0);
  assert.equal((await cli(b, directory, "claim", "--task", "GF-23", "--title", "B", "--area", "src/b/", "--agent", "Outro agente")).code, 0);
  assert.equal((await cli(a, directory, "check")).code, 0, "both readable: no conflicts");
  // Agent 2's registered worktree turns into a directory that is not a git repository.
  const broken = path.join(base, "broken");
  await mkdir(broken);
  const file = path.join(directory, "slot-2.json");
  await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), worktree: broken }));
  const check = await cli(a, directory, "check");
  assert.equal(check.code, 1);
  assert.match(check.stdout, /AVISO \[git-error\] Agente 2: não foi possível ler o git da worktree/);
  assert.match(check.stderr, /Agente 1: check recusado; o git de Agente 2 \(Outro agente · B\) está ilegível e seus arquivos alterados são desconhecidos\. Fale com esse agente ou espere a worktree voltar\./);
  assert.doesNotMatch(check.stderr, /desta worktree/, "the own-git message is for the agent's own worktree only");
  assert.doesNotMatch(check.stdout, /sem conflitos/);
});

test("renaming a file out of another agent's area is trespass, staged and committed", async t => {
  const { a, b, git, directory } = await createRepository(t);
  assert.equal((await cli(a, directory, "claim", "--task", "GF-22", "--title", "A", "--area", "lib/")).code, 0);
  assert.equal((await cli(b, directory, "claim", "--task", "GF-23", "--title", "B", "--area", "src/b/")).code, 0);
  await mkdir(path.join(b, "src/b"), { recursive: true });
  await git(b, "mv", "lib/util.js", "src/b/util.js");
  const staged = (await readBoard(directory)).agents[1].git;
  assert.deepEqual([staged.changed, staged.dirty], [["lib/util.js", "src/b/util.js"], 1]);
  const checkStaged = await cli(b, directory, "check");
  assert.equal(checkStaged.code, 1);
  assert.match(checkStaged.stderr, /\[trespass\] Agente 2 alterou lib\/util\.js na área reservada pelo Agente 1/);
  assert.equal((await cli(a, directory, "check")).code, 1);

  await git(b, "commit", "-q", "-m", "move out of lib");
  const committed = (await readBoard(directory)).agents[1].git;
  assert.deepEqual([committed.changed, committed.dirty], [["lib/util.js", "src/b/util.js"], 0]);
  const checkCommitted = await cli(b, directory, "check");
  assert.equal(checkCommitted.code, 1);
  assert.match(checkCommitted.stderr, /\[trespass\] Agente 2 alterou lib\/util\.js/);
});

test("server publishes the live agent board and tolerates a missing registry", async t => {
  const { a, directory } = await createRepository(t);
  await mkdir(directory);
  await writeFile(path.join(directory, "slot-1.json"), JSON.stringify(record(1, { worktree: a, branch: "feat/a" })));
  const serve = async options => {
    const server = createDashboardServer(options);
    t.after(() => new Promise(resolve => server.close(resolve)));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return `http://127.0.0.1:${server.address().port}`;
  };
  const base = await serve({ agentsDirectory: directory });
  const response = await fetch(`${base}/agents.json`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const board = await response.json();
  assert.equal(board.capacity, 5);
  assert.equal(board.agents.length, 1);
  assert.equal(board.agents[0].git.branch, "feat/a");
  assert.equal((await fetch(`${base}/agents.json`, { method: "HEAD" })).status, 200);
  assert.equal((await fetch(`${base}/agents.json`, { method: "POST" })).status, 405);
  for (const resource of ["/agents.mjs", "/agents-view.mjs", "/format.mjs", "/agents.css"]) {
    assert.equal((await fetch(`${base}${resource}`)).status, 200, resource);
  }
  const empty = await serve({ agentsDirectory: path.join(directory, "missing") });
  const missing = await fetch(`${empty}/agents.json`);
  assert.equal(missing.status, 200);
  assert.deepEqual((await missing.json()).agents, []);
  // A registry path that is not a directory is a real failure and must surface as 503, not as an empty board.
  const broken = await serve({ agentsDirectory: path.join(directory, "slot-1.json") });
  const failure = await fetch(`${broken}/agents.json`);
  assert.equal(failure.status, 503);
  assert.match((await failure.json()).error, /^Quadro de agentes indisponível: /);
});
