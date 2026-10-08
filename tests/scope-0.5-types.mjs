import {mkdirSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {propTable, scopedComponents} from "../src/prop-scope.mjs";

// The type fixture of the 0.5 scope: types/react-native.ts and the tables of src/prop-scope.mjs must agree. For each component
// it writes one positive use per supported prop (an object literal typed with the component's props), one @ts-expect-error per
// refused prop that the types leave out, and for a refused prop that only some values fail and that the types keep (`typed`),
// a positive use of each value that works and a @ts-expect-error for one that fails. The ignored props are not constrained: the types may declare them or not.
// A value of type never is assignable to every prop type, so the only error a statement can have is the name itself. The file
// is generated into build/ and never committed; tests/scope-0.5.test.mjs runs tsc-rs over it.
const root = fileURLToPath(new URL("..", import.meta.url));
const propsTypes = {View: "ViewProps", Text: "TextProps", Pressable: "PressableProps", Image: "ImageProps", Modal: "ModalProps",
  ActivityIndicator: "ActivityIndicatorProps"};
const key = name => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));

export function renderTypeFixture() {
  const lines = ['import type { ' + Object.values(propsTypes).join(", ") + ' } from "react-native";',
    "declare const placeholder: never;"];
  const counts = {positive: 0, negative: 0, valueNegative: 0, valuePositive: 0};
  scopedComponents.forEach(component => {
    const type = propsTypes[component];
    const statement = (index, body) => `const ${component.toLowerCase()}${index}: ${type} = { ${body} };`;
    let index = 0;
    for (const [name, entry] of propTable(component)) {
      if (entry.decision === "supported") {
        lines.push(statement(index++, `${key(name)}: placeholder`));
        counts.positive += 1;
      } else if (entry.decision === "refused" && entry.typed === true) {
        for (const value of entry.accepts) {
          lines.push(statement(index++, `${key(name)}: ${JSON.stringify(value)}`));
          counts.valuePositive += 1;
        }
        lines.push(`// @ts-expect-error ${component}.${name}: a value the host refuses`);
        lines.push(statement(index++, `${key(name)}: ${JSON.stringify(entry.probe)}`));
        counts.valueNegative += 1;
      } else if (entry.decision === "refused") {
        lines.push(`// @ts-expect-error ${component}.${name} is refused, so the types leave it out`);
        lines.push(statement(index++, `${key(name)}: placeholder`));
        counts.negative += 1;
      }
    }
  });
  return {source: lines.join("\n") + "\n", counts};
}

export function writeTypeFixture(directory = path.join(root, "build/scope-0.5-types")) {
  mkdirSync(directory, {recursive: true});
  const {source, counts} = renderTypeFixture();
  writeFileSync(path.join(directory, "fixture.tsx"), source);
  // The consumer's own configuration, with the fixture as the only input and the paths made absolute.
  writeFileSync(path.join(directory, "tsconfig.json"), JSON.stringify({
    compilerOptions: {target: "ESNext", lib: ["ESNext"], types: ["react"], module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx",
      strict: true, noEmit: true, skipLibCheck: true, typeRoots: [path.join(root, "node_modules/@types")],
      paths: {"react-native": [path.join(root, "types/react-native.ts")]}, moduleSuffixes: [".godot", ".native", ""]},
    include: ["fixture.tsx"],
  }, null, 2) + "\n");
  return {directory, counts};
}
