import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { compareReports } from "./parity-protocol.mjs";

const index = process.argv.indexOf("--reference");
const platforms = index < 0 ? ["ios", "android"] : [process.argv[index + 1]];
if (platforms.some((platform) => !["ios", "android"].includes(platform))) throw new Error("--reference requires ios or android");
const output = index < 0 ? "build/parity-comparison.json" : `build/parity-comparison-${platforms[0]}.json`;
rmSync(output, { force: true });
const read = (platform) => JSON.parse(readFileSync(`build/parity-${platform}.json`, "utf8"));
const report = compareReports(read("godot"), platforms.map(read));
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(`PARITY_COMPARISON_PASSED: ${report.caseCount} subset cases, ${platforms.join(" + ")}`);
