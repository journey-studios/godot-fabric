import { createServer } from "node:http";
import { readFile, writeFile, rename, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate, summarize } from "../dashboard/model.mjs";
import { syncRoadmap } from "../dashboard/import-roadmap.mjs";
import { readBoard, resolveAgentsDirectory } from "./agents.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

export function createDashboardServer({ dataFile = path.join(root, "dashboard/migration.json"), agentsDirectory } = {}) {
  const files = new Map([
    ["/", ["dashboard/index.html", "text/html"]], ["/index.html", ["dashboard/index.html", "text/html"]],
    ["/style.css", ["dashboard/style.css", "text/css"]], ["/app.mjs", ["dashboard/app.mjs", "text/javascript"]],
    ["/model.mjs", ["dashboard/model.mjs", "text/javascript"]],
    ["/agents.mjs", ["dashboard/agents.mjs", "text/javascript"]], ["/agents-view.mjs", ["dashboard/agents-view.mjs", "text/javascript"]],
    ["/format.mjs", ["dashboard/format.mjs", "text/javascript"]], ["/agents.css", ["dashboard/agents.css", "text/css"]],
    ["/AGENT_PROMPT.md", ["dashboard/AGENT_PROMPT.md", "text/plain"]],
    ["/fonts/NotoSans.ttf", ["assets/fonts/NotoSans.ttf", "font/ttf"]],
    ["/fonts/JetBrainsMono.ttf", ["assets/fonts/JetBrainsMono.ttf", "font/ttf"]],
  ]);
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return; }
    const pathname = new URL(request.url, "http://localhost").pathname;
    try {
      if (pathname === "/api/data" || pathname === "/migration.json") {
        const data = validate(JSON.parse(await readFile(dataFile, "utf8")));
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(request.method === "HEAD" ? undefined : JSON.stringify(data)); return;
      }
      if (pathname === "/agents.json") {
        const board = await readBoard(agentsDirectory ?? resolveAgentsDirectory(root));
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(request.method === "HEAD" ? undefined : JSON.stringify(board)); return;
      }
      if (!files.has(pathname)) { response.writeHead(404); response.end("Não encontrado"); return; }
      const [relative, mime] = files.get(pathname);
      const filename = await realpath(path.join(root, relative));
      if (!filename.startsWith(root)) throw new Error("Arquivo fora do dashboard");
      const content = await readFile(filename);
      response.writeHead(200, { "Content-Type": `${mime}${mime.startsWith("text/") ? "; charset=utf-8" : ""}` });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      response.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
      const source = { "/api/data": "JSON", "/migration.json": "JSON", "/agents.json": "Quadro de agentes" }[pathname];
      response.end(JSON.stringify({ error: source ? `${source} indisponível: ${error.message}` : "Arquivo indisponível" }));
    }
  });
}

async function main() {
  const args = process.argv.slice(2), command = args[0]?.startsWith("--") ? "serve" : args.shift() || "serve";
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (!["--data", "--roadmap", "--decisions", "--port", "--source-ref", "--agents"].includes(key) || !args.length) throw new Error(`Opção inválida: ${key}`);
    options[key.slice(2)] = args.shift();
  }
  const dataFile = path.resolve(options.data || path.join(root, "dashboard/migration.json"));
  const data = validate(JSON.parse(await readFile(dataFile, "utf8")));
  if (command === "check") { console.log(JSON.stringify({ valid: true, ...summarize(data) }, null, 2)); return; }
  if (command === "sync") {
    const roadmap = await readFile(path.resolve(options.roadmap || path.join(root, "ROADMAP.md")), "utf8");
    const decisions = await readFile(path.resolve(options.decisions || path.join(root, "docs/ARCHITECTURE_V2_DECISIONS.md")), "utf8");
    const next = syncRoadmap(data, roadmap, decisions);
    if (options["source-ref"]) {
      if (!/^[0-9a-f]{40}$/.test(options["source-ref"])) throw new Error("--source-ref exige SHA completo");
      next.source.commit = options["source-ref"];
      next.source.url = `https://github.com/journey-studios/godot-fabric/blob/${next.source.commit}/ROADMAP.md`;
    }
    validate(next);
    const temporary = `${dataFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`);
    await rename(temporary, dataFile);
    console.log(`Roadmap sincronizado: ${next.tasks.length} itens; evidências e histórico preservados.`); return;
  }
  if (command !== "serve") throw new Error(`Comando inválido: ${command}`);
  const port = Number(options.port || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Porta inválida");
  const agentsDirectory = options.agents ? path.resolve(options.agents) : resolveAgentsDirectory(root);
  const server = createDashboardServer({ dataFile, agentsDirectory });
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(`Dashboard: http://127.0.0.1:${port}\nJSON: ${dataFile}\nAgentes: ${agentsDirectory}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
