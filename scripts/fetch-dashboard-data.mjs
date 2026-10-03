import { writeFile } from "node:fs/promises";
import { validate } from "../dashboard/model.mjs";

// Only download data. The renderer and validation code remain from main.
export async function fetchDashboardData({ repository, ref, token, request = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || "") || !ref?.trim()) throw new Error("Repository and data_ref are required");
  const api = async endpoint => {
    const response = await request(`https://api.github.com/repos/${repository}/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}: ${endpoint}`);
    return response.json();
  };
  const commit = (await api(`commits/${encodeURIComponent(ref)}`)).sha;
  if (!/^[0-9a-f]{40}$/.test(commit || "")) throw new Error("Invalid resolved commit");
  const file = await api(`contents/dashboard/migration.json?ref=${commit}`);
  if (file.encoding !== "base64" || typeof file.content !== "string") throw new Error("Missing JSON file content");
  const data = validate(JSON.parse(Buffer.from(file.content, "base64").toString("utf8")));
  const comparison = await api(`compare/${commit}...main`);
  data.publication = { ref, commit, inMain: ["ahead", "identical"].includes(comparison.status), at: new Date().toISOString() };
  return data;
}

if (process.argv[1]?.endsWith("/fetch-dashboard-data.mjs")) {
  try {
    const data = await fetchDashboardData({ repository: process.env.GH_REPOSITORY, ref: process.env.DATA_REF, token: process.env.GH_TOKEN });
    await writeFile(new URL("../dashboard/migration.json", import.meta.url), JSON.stringify(data, null, 2) + "\n");
    console.log(`Dashboard data: ${data.publication.ref} / ${data.publication.commit}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
