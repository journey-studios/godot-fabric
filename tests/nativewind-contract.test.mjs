import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { assertNativeWindBundle } from "../scripts/nativewind-compile.mjs";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const inputs = JSON.parse(read("../build/bundle-inputs.json"));
const compiled = JSON.parse(read("../build/nativewind-compiled.json"));
test("bundle contém JSX e interop nativos originais, sem GDSS", () => {
  assert.doesNotThrow(() => assertNativeWindBundle(inputs));
  assert.equal(
    inputs.some((input) => /(?:^|\/)gdss(?:\/|$)/i.test(input)),
    false,
  );
  assert.equal(
    inputs.some((input) =>
      input.includes("node_modules/react-native-reanimated/"),
    ),
    false,
  );
});
test("guard reprova fallback para web e perda do interop nativo", () => {
  assert.throws(
    () =>
      assertNativeWindBundle(
        inputs.filter((input) => !input.endsWith("runtime/api.native.js")),
      ),
    /missing.*api.native/,
  );
  assert.throws(
    () =>
      assertNativeWindBundle([
        ...inputs,
        "node_modules/react-native-css-interop/dist/runtime/web/api.js",
      ]),
    /must not use the web/,
  );
});
test("Tailwind e compilador original preservam variantes, variáveis e animação", () => {
  assert.equal(compiled.$compiled, true);
  assert.equal(compiled.rem, 14);
  assert.equal(compiled.rules["active:bg-blue-400"].active, true);
  assert.ok(compiled.rules["lg:flex-row"].n.some((rule) => rule.media));
  assert.ok(compiled.rules["dark:bg-slate-800"].n.some((rule) => rule.media));
  assert.ok(compiled.rules["bg-[--accent]"].n.some((rule) => rule.d.length));
  assert.equal(compiled.rules["animate-spin"].animation, true);
  assert.ok(compiled.keyframes.some(([name]) => name === "spin"));
});
test("fronteira ausente de Reanimated falha em todas as tentativas de render", () => {
  const context = { module: { exports: {} } };
  vm.runInNewContext(read("../src/unsupported-reanimated.js"), context);
  for (const name of ["Easing", "default", "makeMutable", "Easing"])
    assert.throws(
      () => context.module.exports[name],
      /does not implement Reanimated\/worklets/,
    );
});
