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
  assert.deepEqual((await readdir(output)).sort(), [".nojekyll", "AGENT_PROMPT.md", "app.mjs", "fonts", "index.html", "migration.json", "model.mjs", "style.css"].sort());
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
  const updated = roadmap.replace(/\| GF-08 · P1 · (.*?) \| Planned \|/, "| GF-08 · P1 · $1 | In progress |");
  const next = syncRoadmap(data, updated);
  assert.deepEqual(next.tasks[7].checkpoints, data.tasks[7].checkpoints);
  assert.deepEqual(next.activity, data.activity);
  assert.deepEqual(next.decisions, data.decisions);
  assert.throws(() => syncRoadmap(data, updated.replace(/^\| GF-40 .*\n/m, "")), /IDs removidos/);
  // Reading an old roadmap cannot quietly turn verified slices back into Planned.
  assert.throws(() => validate(syncRoadmap(data, roadmap)), /planejado com checkpoints/);
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
  for (const resource of ["/", "/style.css", "/app.mjs", "/model.mjs", "/fonts/NotoSans.ttf", "/AGENT_PROMPT.md"]) {
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
