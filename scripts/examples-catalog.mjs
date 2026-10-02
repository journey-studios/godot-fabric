import { readFileSync } from "node:fs";

export const examples = JSON.parse(readFileSync(new URL("../examples/catalog.json", import.meta.url), "utf8"));

export function exampleOptions(args) {
  const allowed = new Set(["--list", "--help", "--check", "--headless", "--capture"]);
  const flags = args.filter((arg) => arg.startsWith("--"));
  for (const flag of flags) if (!allowed.has(flag)) throw new Error(`Unknown example option: ${flag}`);
  const names = args.filter((arg) => !arg.startsWith("--"));
  if (names.length > 1) throw new Error("Choose one example at a time");
  if (flags.includes("--headless") && flags.includes("--capture")) throw new Error("Capture requires a native window");
  if (flags.includes("--list") || flags.includes("--help")) return { list: true };
  const example = examples.find((entry) => entry.id === (names[0] || "counter"));
  if (!example) throw new Error(`Unknown example: ${names[0]}. Use npm run examples:list`);
  if (example.automated && flags.includes("--capture")) throw new Error("The parity oracle reports observations; it does not capture images");
  return { example, check: flags.some((flag) => ["--check", "--headless", "--capture"].includes(flag)),
    headless: flags.includes("--headless"), capture: flags.includes("--capture") };
}
