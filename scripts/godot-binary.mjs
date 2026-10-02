import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GODOT_VERSION = JSON.parse(readFileSync(new URL("../dependencies.json", import.meta.url), "utf8")).godot.version;

export async function ensureGodotBinary() {
  const binary = process.env.GODOT_BIN || [
    "/Applications/Godot.app/Contents/MacOS/Godot",
    spawnSync("which", ["godot"], { encoding: "utf8" }).stdout?.trim(),
  ].find((candidate) => candidate && existsSync(candidate));
  if (!binary || !existsSync(binary))
    throw new Error(`Install official Godot ${GODOT_VERSION} and set GODOT_BIN to its executable`);
  const detected = spawnSync(binary, ["--version"], {
    encoding: "utf8", timeout: 10000,
  });
  const version = detected.stdout?.trim();
  const baseline = `${GODOT_VERSION}.stable`;
  if (detected.error || detected.status !== 0 ||
      !(version === baseline || version?.startsWith(`${baseline}.`)))
    throw new Error(`Godot ${baseline} required; found ${version || detected.error || "no version"}`);
  return binary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await ensureGodotBinary();
  console.log(`Godot ${GODOT_VERSION}.stable preflight passed`);
}
