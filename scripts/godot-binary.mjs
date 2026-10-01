import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const GODOT_VERSION = "4.7.2";

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
  if (detected.error || detected.status !== 0 ||
      !detected.stdout?.startsWith(`${GODOT_VERSION}.stable`))
    throw new Error(`Godot ${GODOT_VERSION}.stable required; found ${detected.stdout?.trim() || detected.error || "no version"}`);
  return binary;
}
