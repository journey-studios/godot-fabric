import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../dashboard/model.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function buildDashboardPages(output = path.join(root, "build/dashboard-pages")) {
  // Publish only the dashboard and licensed fonts, never the whole repository.
  // The agent board needs local worktrees, so agents.json is intentionally absent here.
  const data = validate(JSON.parse(await readFile(path.join(root, "dashboard/migration.json"), "utf8")));
  await mkdir(path.join(output, "fonts"), { recursive: true });
  for (const file of ["index.html", "style.css", "agents.css", "app.mjs", "model.mjs", "agents.mjs", "agents-view.mjs", "format.mjs", "AGENT_PROMPT.md"]) {
    await cp(path.join(root, "dashboard", file), path.join(output, file));
  }
  for (const file of ["NotoSans.ttf", "JetBrainsMono.ttf", "OFL-NotoSans.txt", "OFL-JetBrainsMono.txt"]) {
    await cp(path.join(root, "assets/fonts", file), path.join(output, "fonts", file));
  }
  await writeFile(path.join(output, "migration.json"), JSON.stringify(data, null, 2) + "\n");
  await writeFile(path.join(output, ".nojekyll"), "");
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildDashboardPages().then(output => console.log(`Pages artifact: ${output}`)).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
