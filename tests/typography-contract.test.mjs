import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const compiled = JSON.parse(
  readFileSync(new URL("../build/nativewind-compiled.json", import.meta.url)),
);
function value(rule, property) {
  for (const declaration of compiled.rules[rule].n.flatMap(
    (style) => style.d,
  )) {
    if (declaration.length === 1 && property in declaration[0])
      return declaration[0][property];
    if (declaration[1]?.at(-1) === property || declaration[1] === property)
      return declaration[0];
  }
}
test("compilador original emite família, peso, leading e alinhamento", () => {
  assert.equal(value("font-sans", "fontFamily"), "NotoSans");
  assert.equal(value("font-mono", "fontFamily"), "JetBrainsMono");
  assert.equal(value("font-bold", "fontWeight"), "700");
  assert.equal(value("leading-7", "lineHeight"), 24.5);
  assert.equal(value("text-right", "textAlign"), "right");
  assert.equal(value("text-xl", "fontSize"), 17.5);
});
test("fontes variáveis e licenças correspondem aos assets oficiais fixados", () => {
  const files = {
    "NotoSans.ttf":
      "bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d",
    "JetBrainsMono.ttf":
      "48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda",
    "OFL-NotoSans.txt":
      "cee9892f9f0cc8fe882c9e9537ee6a89621d86ee7ceaf70b02e2b2b1c25c061a",
    "OFL-JetBrainsMono.txt":
      "b2fe5e8987594e9ffd1d2ca52a2f5d73eb8335243893c5d6254b5ad69269591d",
  };
  for (const [file, expected] of Object.entries(files)) {
    const bytes = readFileSync(
      new URL(`../assets/fonts/${file}`, import.meta.url),
    );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected);
    if (file.endsWith(".ttf")) {
      assert.ok(
        bytes.includes(Buffer.from("fvar")),
        `${file}: variable font axes`,
      );
      assert.ok(bytes.includes(Buffer.from("wght")), `${file}: weight axis`);
    }
  }
});
