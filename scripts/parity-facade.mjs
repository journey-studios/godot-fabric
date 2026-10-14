import ts from "typescript";

// How src/react-native-platform.jsx binds each name of RN's root: "exported_unverified" for a name it exports, and
// "explicit_placeholder" for a constant initialized with `unavailable(...)`, a component that throws when it renders. A name
// that is not in the map is missing. scripts/parity-status.mjs counts the root names with this rule and
// tests/root-names.test.mjs keeps the public types in step with it, so the rule lives here once.
export function classifyFacade(contents) {
  const source = ts.createSourceFile("facade.jsx", contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const facade = new Map();
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      const clause = statement.exportClause;
      // `export { a, b as c }` names each specifier; `export * as name` binds one name to a whole module.
      if (ts.isNamedExports(clause)) {
        for (const exported of clause.elements) {
          facade.set(exported.name.text, "exported_unverified");
        }
      } else if (ts.isNamespaceExport(clause)) {
        facade.set(clause.name.text, "exported_unverified");
      }
    }
    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      continue;
    }
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      facade.set(statement.name.text, "exported_unverified");
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          throw new Error("Review destructured facade exports");
        }
        const placeholder = ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(source) === "unavailable";
        facade.set(declaration.name.text, placeholder ? "explicit_placeholder" : "exported_unverified");
      }
    }
  }
  return facade;
}
