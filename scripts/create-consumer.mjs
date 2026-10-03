import path from "node:path";
import { fileURLToPath } from "node:url";
import { cp, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = process.argv[2] && path.resolve(process.argv[2]);
if (!output || existsSync(output)) throw new Error("Provide a new consumer directory; existing project files are preserved");
await cp(path.join(root, "consumers", "minimal"), output, {
  recursive: true, filter: (file) => !/\.(?:uid|import)$/.test(file),
});
const result = spawnSync(process.execPath, [path.join(root, "scripts", "pack-addon.mjs"), path.join(output, "addons", "godot_fabric")], { stdio: "inherit" });
if (result.error || result.status !== 0) throw new Error("Provisioning failed; see the diagnostic above");
// The copied guide must remain usable outside the SDK checkout. Bind its
// documentation and images to the provisioned source revision.
const manifest = JSON.parse(await readFile(path.join(output, "addons/godot_fabric/manifest.json"), "utf8"));
const guide = path.join(output, "README.md");
await writeFile(guide, (await readFile(guide, "utf8")).replace(/\]\(\.\.\/\.\.\/([^)]*)\)/g, (_, target) => {
  const base = target.endsWith(".png")
    ? "https://raw.githubusercontent.com/journey-studios/godot-fabric/"
    : "https://github.com/journey-studios/godot-fabric/blob/";
  return "](" + base + manifest.sourceCommit + "/" + target + ")";
}));
// Startup discovery only, never a copied resource/import cache. This contains
// Godot 4.7.2's known late GDExtension class-discovery crash on first import.
await mkdir(path.join(output, ".godot"));
await writeFile(path.join(output, ".godot", "extension_list.cfg"), "res://addons/godot_fabric/fabric.gdextension\n");
console.log("Open this project's project.godot in the official engine: " + output);
