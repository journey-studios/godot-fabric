import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { validate, summarize, progress, taskProgress } from "../dashboard/model.mjs";
import { parseRoadmap, syncRoadmap, expandIds } from "../dashboard/import-roadmap.mjs";
import { createDashboardServer } from "../scripts/migration-dashboard.mjs";
import { buildDashboardPages } from "../scripts/build-dashboard-pages.mjs";

const data = JSON.parse(await readFile(new URL("../dashboard/migration.json", import.meta.url), "utf8"));
const roadmap = await readFile(new URL("../ROADMAP.md", import.meta.url), "utf8");
const clone = () => structuredClone(data);

test("Pages artifact works under a project subpath and contains only public assets", async t => {
  const output = await mkdtemp(path.join(tmpdir(), "fabric-pages-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await buildDashboardPages(output);
  assert.deepEqual((await readdir(output)).sort(), [".nojekyll", "AGENT_PROMPT.md", "agents-view.mjs", "agents.css", "agents.mjs", "app.mjs", "fonts", "format.mjs", "index.html", "migration.json", "model.mjs", "style.css"].sort());
  const html = await readFile(path.join(output, "index.html"), "utf8");
  const app = await readFile(path.join(output, "app.mjs"), "utf8");
  const css = await readFile(path.join(output, "style.css"), "utf8");
  assert.ok(!/(?:href|src)="\//.test(html));
  assert.ok(!app.includes('fetch("/api/data"'));
  assert.match(app, /new URL\("\.\/migration.json", import.meta.url\)/);
  assert.match(css, /url\('\.\/fonts\/NotoSans.ttf'\)/);
  assert.equal(new URL("./migration.json", "https://journey-studios.github.io/godot-fabric/app.mjs").pathname, "/godot-fabric/migration.json");
  assert.deepEqual(JSON.parse(await readFile(path.join(output, "migration.json"), "utf8")), data);
});

test("snapshot covers the complete canonical roadmap, sequences and release gates", () => {
  validate(data);
  const parsed = parseRoadmap(roadmap);
  assert.deepEqual(data.tasks.map(task => task.id), parsed.tasks.map(task => task.id));
  assert.deepEqual(data.tasks.map(task => task.acceptance), parsed.tasks.map(task => task.acceptance));
  assert.deepEqual(data.tasks.map(task => task.dependencies), parsed.tasks.map(task => task.dependencies));
  assert.deepEqual(data.tasks.map(task => task.status), parsed.tasks.map(task => task.status));
  assert.equal(data.tasks.length, 40);
  assert.equal(data.phases.length, 6);
  assert.equal(data.sequences.length, 8);
  assert.equal(data.integrationChecklist.length, 7);
  assert.equal(data.releaseChecklist.length, 9);
  assert.match(data.releaseChecklist[0].label, /inventory is not sufficient\.$/);
  assert.match(data.integrationChecklist[0].label, /explicitly installed\.$/);
  assert.deepEqual(data.releaseChecklist.map(step => step.label), parsed.releaseChecklist.map(step => step.label));
  assert.deepEqual(data.integrationChecklist.map(step => step.label), parsed.integrationChecklist.map(step => step.label));
  assert.equal(data.decisions.length, 32);
  assert.deepEqual(expandIds("GF-01 through GF-03, GF-02"), ["GF-01", "GF-02", "GF-03"]);
  assert.equal(data.tasks.find(task => task.id === "GF-39").dependencies.length, 38);
});

test("progress weights verified checkpoints and excludes later scope", () => {
  const copy = clone();
  const initial = summarize(copy);
  copy.tasks.find(task => task.id === "GF-40").checkpoints.forEach(step => { step.done = true; });
  assert.equal(summarize(copy).percent, initial.percent);
  const tasks = [
    { weight: 3, checkpoints: [{ done: true }, { done: false }] },
    { weight: 1, checkpoints: [{ done: false }] },
  ];
  assert.equal(taskProgress(tasks[0]), 50);
  assert.equal(progress(tasks), 37.5);
  assert.equal(progress([]), 0);
});

test("completion requires evidence, complete scope and completed dependencies", () => {
  const copy = clone(), task = copy.tasks.find(item => item.id === "GF-02");
  task.status = "complete";
  assert.throws(() => validate(copy), /conclusão incompleta/);
  task.checkpoints.forEach(step => { step.done = true; step.evidence = [{ label: "Proof", url: "https://example.com/proof" }]; });
  assert.throws(() => validate(copy), /dependências abertas/);
  const prerequisite = copy.tasks.find(item => item.id === "GF-01");
  prerequisite.status = "complete";
  prerequisite.checkpoints.forEach(step => { step.done = true; step.evidence = [{ label: "Proof", url: "https://example.com/proof" }]; });
  assert.doesNotThrow(() => validate(copy));
  task.checkpoints[1].evidence = [];
  assert.throws(() => validate(copy), /conclusão sem evidência/);
});

test("invalid status, cycles, missing references and arbitrary URLs are rejected", () => {
  const invalid = clone(); invalid.tasks[0].status = "unknown";
  assert.throws(() => validate(invalid), /status inválido/);
  const cycle = clone(); cycle.tasks[0].dependencies = ["GF-02"];
  assert.throws(() => validate(cycle), /circular/);
  const missing = clone(); missing.tasks[0].dependencies = ["GF-99"];
  assert.throws(() => validate(missing), /dependência inválida/);
  const link = clone(); link.tasks[0].checkpoints[0].evidence[0].url = "javascript:alert(1)";
  assert.throws(() => validate(link), /URL deve/);
  const blocked = clone(); blocked.tasks[0].status = "blocked";
  assert.throws(() => validate(blocked), /blocker/);
});

test("sync preserves recorded work and history but rejects removed IDs", () => {
  const stale = roadmap.replace(/\| GF-08 · P1 · (.*?) \| (?:Planned|In progress) \|/, "| GF-08 · P1 · $1 | Planned |");
  assert.match(stale, /\| GF-08 · P1 · .*? \| Planned \|/);
  const updated = stale.replace(/\| GF-08 · P1 · (.*?) \| Planned \|/, "| GF-08 · P1 · $1 | In progress |");
  const next = syncRoadmap(data, updated);
  assert.doesNotThrow(() => validate(next));
  assert.deepEqual(next.tasks[7].checkpoints, data.tasks[7].checkpoints);
  assert.deepEqual(next.activity, data.activity);
  assert.deepEqual(next.decisions, data.decisions);
  assert.throws(() => syncRoadmap(data, updated.replace(/^\| GF-40 .*\n/m, "")), /IDs removidos/);
  // Reading an old roadmap cannot quietly turn verified slices back into Planned.
  assert.throws(() => validate(syncRoadmap(data, stale)), /planejado com checkpoints/);
});

test("server observes external JSON updates, rejects corruption and recovers", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "fabric-dashboard-"));
  const dataFile = path.join(directory, "migration.json");
  await writeFile(dataFile, JSON.stringify(data));
  const server = createDashboardServer({ dataFile });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = await fetch(`${base}/api/data`);
  assert.equal(request.headers.get("cache-control"), "no-store");
  assert.equal((await request.json()).tasks.length, 40);
  const next = clone(); next.tasks[0].note = "Updated while the page is open";
  await writeFile(dataFile, JSON.stringify(next));
  assert.equal((await (await fetch(`${base}/api/data`)).json()).tasks[0].note, next.tasks[0].note);
  await writeFile(dataFile, "{invalid");
  assert.equal((await fetch(`${base}/api/data`)).status, 503);
  await writeFile(dataFile, JSON.stringify(data));
  assert.equal((await fetch(`${base}/api/data`)).status, 200);
  assert.equal((await fetch(`${base}/api/data`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
  for (const resource of ["/", "/style.css", "/app.mjs", "/model.mjs", "/agents.mjs", "/agents-view.mjs", "/format.mjs", "/agents.css", "/fonts/NotoSans.ttf", "/AGENT_PROMPT.md"]) {
    assert.equal((await fetch(`${base}${resource}`)).status, 200, resource);
  }
});

test("Manual publication pins only JSON and identifies data outside main", async () => {
  const { fetchDashboardData } = await import("../scripts/fetch-dashboard-data.mjs");
  const sha = "a".repeat(40);
  const endpoints = [];
  const request = async url => {
    endpoints.push(url);
    const payload = url.includes("/commits/") ? { sha }
      : url.includes("/contents/") ? { encoding: "base64", content: Buffer.from(JSON.stringify(data)).toString("base64") }
      : { status: "diverged" };
    return { ok: true, json: async () => payload };
  };
  const result = await fetchDashboardData({ repository: "journey-studios/godot-fabric", ref: "codex/progress", token: "test", request });
  assert.equal(result.publication.commit, sha);
  assert.equal(result.publication.inMain, false);
  assert.equal(result.publication.ref, "codex/progress");
  assert.ok(endpoints[0].endsWith("commits/codex%2Fprogress"));
  assert.ok(endpoints[1].endsWith(`contents/dashboard/migration.json?ref=${sha}`));
  await assert.rejects(fetchDashboardData({ repository: "journey-studios/godot-fabric", ref: "missing", request: async () => ({ ok: false, status: 404 }) }), /HTTP 404/);
  await assert.rejects(fetchDashboardData({ repository: "journey-studios/godot-fabric", ref: "bad", request: async url => ({ ok: true, json: async () => url.includes("commits") ? { sha } : { encoding: "base64", content: Buffer.from('{}').toString('base64') } }) }));
});

// Optional milestones (the 0.5 cut). They must stay invisible to the 1.0 numbers and to the roadmap parser.
const { criteriaProgress, criteriaStatus, milestoneCriteria } = await import("../dashboard/model.mjs");
const milestoneOf = copy => copy.milestones.find(item => item.id === "0.5");
// A copy with every 0.5 criterion reset: the versioned JSON records live progress, so these tests must not depend on it.
const fresh = () => {
  const copy = clone();
  [...milestoneCriteria(milestoneOf(copy)), ...milestoneOf(copy).exit].forEach(step => { step.done = false; step.evidence = []; });
  return copy;
};

test("the versioned JSON carries the 0.5 milestone: an agent that rebuilds the document with fixed keys would erase it", () => {
  const milestone = milestoneOf(data);
  assert.ok(milestone, "milestones[0.5] ausente: restaure a chave `milestones` do JSON versionado (agentes devem preservar chaves desconhecidas, ver dashboard/AGENT_PROMPT.md)");
  assert.equal(milestone.items.length, 10);
  assert.ok(milestone.items.every(item => /^V05-\d\d$/.test(item.id) && item.criteria.length > 0));
  assert.ok(milestone.exit.length > 0);
  assert.ok(data.tasks.every(task => !("milestone" in task) && !/^V05-/.test(task.id)), "o 0.5 não pode virar tag ou task dos GF: o sync os descarta ou rejeita");
});

test("milestones never change the release numbers and are optional", () => {
  const without = clone();
  delete without.milestones;
  validate(without);
  assert.deepEqual(summarize(without), summarize(data));
  const finished = clone();
  milestoneCriteria(milestoneOf(finished)).forEach(step => { step.done = true; step.evidence = [{ label: "x", url: "https://example.com/x" }]; });
  validate(finished);
  assert.deepEqual(summarize(finished), summarize(data));
  assert.equal(criteriaProgress(milestoneCriteria(milestoneOf(finished))), 100);
  assert.equal(criteriaStatus(milestoneCriteria(milestoneOf(finished))), "complete");
});

test("milestone progress and status are derived from criteria", () => {
  assert.equal(criteriaProgress([]), 0);
  assert.equal(criteriaProgress([{ done: true }, { done: false }, { done: false }, { done: true }]), 50);
  assert.equal(criteriaStatus([{ done: false }]), "planned");
  assert.equal(criteriaStatus([{ done: true }, { done: false }]), "in_progress");
  assert.equal(criteriaStatus([{ done: true }]), "complete");
  assert.equal(criteriaStatus([{ done: true }], "sem aparelho"), "blocked");
  assert.equal(criteriaProgress(milestoneCriteria(milestoneOf(fresh()))), 0);
  assert.ok(milestoneCriteria(milestoneOf(data)).every(step => !step.done || step.evidence.length), "critério do 0.5 concluído sem evidência executada");
});

test("invalid milestones are rejected without touching the release data", () => {
  const broken = mutate => { const copy = fresh(); mutate(milestoneOf(copy), copy); return copy; };
  assert.throws(() => validate({ ...clone(), milestones: {} }), /milestones: lista obrigatória/);
  // "" and null mean "not blocked", as they do on the GF tasks: an agent that unblocks an item must not take the dashboard down.
  for (const empty of ["", null]) {
    validate(broken((milestone, copy) => { milestone.blocker = empty; milestone.items[2].blocker = empty; return copy; }));
  }
  assert.throws(() => validate(broken(milestone => { milestone.items[2].blocker = 7; })), /blocker: texto obrigatório/);
  assert.throws(() => validate(broken((milestone, copy) => { copy.milestones.push({ ...milestone }); })), /IDs duplicados/);
  assert.throws(() => validate(broken(milestone => { milestone.items.push({ ...milestone.items[0] }); })), /IDs duplicados/);
  assert.throws(() => validate(broken(milestone => { milestone.items[1].gf = ["GF-99"]; })), /item GF desconhecido GF-99/);
  assert.throws(() => validate(broken(milestone => { milestone.items[1].dependsOn = ["V05-99"]; })), /dependência inválida/);
  assert.throws(() => validate(broken(milestone => { milestone.items[1].dependsOn = [milestone.items[1].id]; })), /dependência inválida/);
  assert.throws(() => validate(broken(milestone => { milestone.items[0].criteria[0].done = true; })), /conclusão sem evidência/);
  assert.throws(() => validate(broken(milestone => { milestone.exit[0].done = true; })), /conclusão sem evidência/);
  assert.throws(() => validate(broken(milestone => { milestone.items[0].criteria[0].evidence = [{ label: "x", url: "javascript:alert(1)" }]; })), /URL deve usar http ou https/);
  assert.throws(() => validate(broken(milestone => { milestone.items[0].criteria = {}; })), /lista obrigatória/);
  assert.throws(() => validate(broken(milestone => { milestone.scope = "texto"; })), /lista de textos/);
});

test("sync preserves milestones and the 0.5 prose does not reconfigure the roadmap parser", () => {
  const synced = syncRoadmap(clone(), roadmap);
  assert.deepEqual(synced.milestones, data.milestones);
  assert.deepEqual(synced.activity, data.activity);
  const parsed = parseRoadmap(roadmap);
  assert.deepEqual([parsed.phases.length, parsed.tasks.length, parsed.sequences.length, parsed.releaseChecklist.length, parsed.integrationChecklist.length], [6, 40, 8, 9, 7]);
  assert.ok(parsed.tasks.every(task => !task.id.startsWith("V05")));
  const section = roadmap.split("\n## 0.5 — ")[1]?.split("\n## ")[0] ?? "";
  assert.ok(section, "seção `## 0.5 — ` ausente do ROADMAP.md");
  // Every V05 item is named in the roadmap prose and the other way around, so the two descriptions cannot drift apart.
  const inJson = milestoneOf(data).items.map(item => item.id);
  const inProse = [...section.matchAll(/^\| (V05-\d\d) \|/gm)].map(match => match[1]);
  assert.deepEqual(inProse, inJson);
});

test("the milestone section ids used by the renderer exist in the page", async () => {
  const html = await readFile(new URL("../dashboard/index.html", import.meta.url), "utf8");
  for (const id of ["milestones", "milestones-nav", "milestone-list"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
