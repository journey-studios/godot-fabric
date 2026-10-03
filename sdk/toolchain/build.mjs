import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { transformAsync } from "@babel/core";
import { platformPlugin } from "./platform-plugin.mjs";
import { godotExtensions } from "./platform-resolution.mjs";

const toolchain = path.dirname(fileURLToPath(import.meta.url));
const sdk = path.dirname(toolchain);
const requireSdk = createRequire(path.join(toolchain, "package.json"));

function projectPath(root, resource) {
  if (!resource.startsWith("res://")) throw new Error("Use res:// project paths");
  const result = path.resolve(root, resource.slice(6));
  if (!result.startsWith(root + path.sep)) throw new Error("Path escapes the project");
  let ancestor = result;
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const physical = realpathSync(ancestor);
  if (physical !== root && !physical.startsWith(root + path.sep))
    throw new Error("Resource path resolves outside the project");
  return result;
}

async function main() {
  const [projectArg, entryArg, bundleArg] = process.argv.slice(2);
  if (!bundleArg) throw new Error("Expected project, entry and output bundle paths");
  const project = realpathSync(projectArg);
  const entry = projectPath(project, entryArg);
  const outfile = projectPath(project, bundleArg);
  if (!bundleArg.startsWith("res://.godot_fabric/") || !bundleArg.endsWith(".js"))
    throw new Error("This prototype writes bundles only under res://.godot_fabric/");
  if (!existsSync(entry)) throw new Error("Entry missing: " + entryArg);
  if (!realpathSync(entry).startsWith(project + path.sep)) throw new Error("Entry must remain inside the project");
  if (entry === outfile) throw new Error("Entry and output must differ");
  const manifest = JSON.parse(await readFile(path.join(sdk, "manifest.json"), "utf8"));
  if (process.version !== "v" + manifest.node) throw new Error("Use the provisioned private Node " + manifest.node);
  const packageFile = path.join(project, "package.json");
  const dependencies = existsSync(packageFile) ? JSON.parse(readFileSync(packageFile, "utf8")) : {};
  for (const name of ["react", "react-native"]) {
    const version = dependencies.dependencies?.[name] ?? dependencies.devDependencies?.[name] ?? dependencies.peerDependencies?.[name];
    if (version && version !== manifest[name]) throw new Error(`${name} must match SDK version ${manifest[name]}`);
  }
  for (const name of Object.keys(dependencies.dependencies ?? {}))
    if (!["react", "react-native"].includes(name) && !existsSync(path.join(project, "node_modules", name, "package.json")))
      throw new Error(`Missing project dependency ${name}; install it explicitly with the project's package manager`);
  if (dependencies.babel) throw new Error("Project Babel configuration is not supported by this prototype: package.json");
  for (const name of ["babel.config.js", "babel.config.cjs", "babel.config.mjs", "babel.config.json", "babel.config.cts", ".babelrc", ".babelrc.json", ".babelrc.js", ".babelrc.cjs", ".babelrc.mjs", ".babelrc.cts"])
    if (existsSync(path.join(project, name))) throw new Error("Project Babel configuration is not supported by this prototype: " + name);
  const typecheck = spawnSync(process.execPath, [requireSdk.resolve("typescript/bin/tsc"), "--project", path.join(project, "tsconfig.json")], {
    cwd: project, encoding: "utf8", timeout: 30000,
  });
  if (typecheck.error || typecheck.status !== 0)
    throw new Error("TypeScript failed\n" + (typecheck.stdout ?? "") + (typecheck.stderr ?? "") + (typecheck.error?.message ?? ""));
  const result = await build({
    absWorkingDir: project, entryPoints: [entry], outfile, write: false,
    bundle: true, platform: "neutral", format: "iife", metafile: true,
    define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
    mainFields: ["main"], resolveExtensions: godotExtensions,
    plugins: [
      {
        name: "project-owned-dependencies",
        setup(builder) {
          builder.onResolve({ filter: /^[^./]/ }, (args) => {
            if (args.importer.startsWith(sdk + path.sep) || /^react(?:\/|$)|^react-native(?:\/|$)/.test(args.path)) return;
            const name = args.path.startsWith("@") ? args.path.split("/").slice(0, 2).join("/") : args.path.split("/")[0];
            if (!args.importer.includes(path.sep + "node_modules" + path.sep) && !dependencies.dependencies?.[name])
              throw new Error(`Declare ${name} in the project's dependencies and install it explicitly; Play does not install packages`);
            if (!existsSync(path.join(project, "node_modules", name, "package.json")))
              throw new Error(`Missing project dependency ${name}; install it explicitly with the project's package manager`);
          });
        },
      },
      platformPlugin(path.join(sdk, "src"), (id) => requireSdk.resolve(id)),
    ],
  });
  if (result.outputFiles.length !== 1) throw new Error("Asset/CSS output is not supported by this consumer prototype");
  const transformed = await transformAsync(result.outputFiles[0].text, {
    filename: outfile, configFile: false, babelrc: false,
    presets: [[requireSdk.resolve("@react-native/babel-preset"), { disableImportExportTransform: true, enableBabelRuntime: false }]],
  });
  const code = transformed.code + "\n";
  await mkdir(path.dirname(outfile), { recursive: true });
  const staging = outfile + ".staging-" + process.pid;
  try { await writeFile(staging, code); await rename(staging, outfile); }
  finally { await rm(staging, { force: true }); }
  const inputs = Object.keys(result.metafile.inputs).map((file) => {
    const absolute = path.resolve(project, file);
    return absolute.startsWith(sdk + path.sep) ? "sdk/" + path.relative(sdk, absolute) : "project/" + path.relative(project, absolute);
  });
  await writeFile(path.join(path.dirname(outfile), "build-report.json"), JSON.stringify({
    schemaVersion: 1, entry: entryArg, bundle: bundleArg, sdkSourceCommit: manifest.sourceCommit,
    sha256: createHash("sha256").update(code).digest("hex"), inputs,
  }, null, 2) + "\n");
  console.log("GODOT_FABRIC_BUILT: " + entryArg);
}
try { await main(); }
catch (error) { console.error("GODOT_FABRIC_BUILD_ERROR: " + error.message); process.exitCode = 1; }
