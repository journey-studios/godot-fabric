import ts from "typescript";

// The static scan of Frontier's HUD against the 0.5 manifest (docs/compatibility/scope-0.5.json), written on the TypeScript syntax tree and
// never from a copy of the lists: every name the HUD imports from `react-native` must be one the manifest decides (`names`) and none
// the manifest leaves out (`outOfScope`, `notInTheManifest`); every prop a JSX element of those components is given must be one the manifest
// supports for it (a refused prop passes only with a value its `accepts` lists, an ignored one is refused because it changes nothing here,
// and one the component does not declare is refused as unknown); and every member the HUD reads of a name with a `subset.members` list must
// be in it. What the manifest cannot say, the lane's own patterns say (hooks, listeners, talking to the game): they are not here.
//
// A type-only import of `react-native` itself is erased by the build and not a name the HUD uses; a namespace or default import, a `require` and a dynamic
// import would hide which names are used and are refused. So is any subpath of the package (`react-native/Libraries/...`), however it is reached (a static
// import, a re-export, a `require`, a dynamic import, an import type): the manifest decides names of the public module and nothing deeper. A name with a list
// of members is read only as `Name.member` (or by destructuring members of the list): an alias, an argument or any other loose use of it would hide which
// member is read, and is refused.
const MODULE = "react-native";
const isDeep = specifier => typeof specifier === "string" && specifier.startsWith(`${MODULE}/`);
const words = text => text.match(/\b[A-Z][A-Za-z0-9]*\b/g) ?? [];

/** What the manifest leaves out: a name that its prose or `notInTheManifest` names and `names` does not decide, with the sentence that says so. */
export function leftOut(manifest) {
  const decided = new Set(manifest.names.map(row => row.name));
  const out = new Map(Object.entries(manifest.notInTheManifest).map(([name, why]) => [name, why]));
  for (const sentence of manifest.outOfScope) {
    for (const name of words(sentence)) {
      if (!decided.has(name) && !out.has(name)) {
        out.set(name, sentence);
      }
    }
  }
  return out;
}

// The classes of a component's props, by name, from the manifest's rules.
function tableOf(component) {
  const table = new Map();
  for (const rule of component.rules) {
    for (const name of rule.names) {
      table.set(name, rule);
    }
  }
  return table;
}

// The literal a JSX attribute gives, or `undefined` when it is not one (an expression), `true` for a bare attribute.
function literalOf(attribute) {
  const value = attribute.initializer;
  if (value === undefined) {
    return {literal: true};
  }
  if (ts.isStringLiteral(value)) {
    return {literal: value.text};
  }
  if (ts.isJsxExpression(value) && value.expression !== undefined) {
    const expression = value.expression;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return {literal: expression.text};
    }
    if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) {
      return {literal: expression.kind === ts.SyntaxKind.TrueKeyword};
    }
  }
  return {};
}

/** The findings, `{file, kind, message}`, of scanning `sources` (a file name -> its text) against the manifest. Empty when the HUD is inside it. */
export function scanHud(sources, manifest) {
  const findings = [];
  const names = new Map(manifest.names.map(row => [row.name, row]));
  const out = leftOut(manifest);
  for (const [file, text] of Object.entries(sources)) {
    const found = (kind, message) => findings.push({file, kind, message});
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    // local name -> the name the manifest decides
    const bound = new Map();
    const deep = (specifier, how) => found("import", `${how} the subpath ${specifier} of ${MODULE}: only the names of ${MODULE} itself, which the manifest decides, may be used`);
    const importedFrom = specifier => ts.isStringLiteral(specifier) && specifier.text === MODULE;
    for (const statement of tree.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && isDeep(statement.moduleSpecifier.text)) {
        deep(statement.moduleSpecifier.text, "the HUD imports");
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier) && isDeep(statement.moduleSpecifier.text)) {
        deep(statement.moduleSpecifier.text, "the HUD re-exports");
      } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference) && ts.isStringLiteral(statement.moduleReference.expression)
          && isDeep(statement.moduleReference.expression.text)) {
        deep(statement.moduleReference.expression.text, "the HUD requires");
      } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference) && ts.isStringLiteral(statement.moduleReference.expression)
          && statement.moduleReference.expression.text === MODULE) {
        found("import", `${MODULE} is required by an import-equals, which hides which names the HUD uses: import the names`);
      } else if (ts.isImportDeclaration(statement) && importedFrom(statement.moduleSpecifier)) {
        const clause = statement.importClause;
        if (clause === undefined || clause.isTypeOnly) {
          continue;
        }
        if (clause.name !== undefined || (clause.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings))) {
          found("import", `${MODULE} is imported as a default or a namespace, which hides which names the HUD uses: import the names`);
          continue;
        }
        for (const element of clause.namedBindings?.elements ?? []) {
          if (element.isTypeOnly) {
            continue;
          }
          const name = (element.propertyName ?? element.name).text;
          if (names.has(name)) {
            bound.set(element.name.text, name);
          } else if (out.has(name)) {
            found("import", `${name} is out of the 0.5 scope: ${out.get(name)}`);
          } else {
            found("import", `${name} is in neither \`names\` nor \`outOfScope\` of the manifest: the HUD may not use it until the manifest decides it`);
          }
        }
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined && importedFrom(statement.moduleSpecifier)) {
        found("import", `${MODULE} is re-exported, which hides which names the HUD uses`);
      }
    }
    const visit = node => {
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        const [argument] = node.arguments;
        if (argument !== undefined && ts.isStringLiteralLike(argument) && isDeep(argument.text)) {
          deep(argument.text, "the HUD loads");
        } else {
          found("import", "a `require` or a dynamic import: the HUD imports its names statically");
        }
      }
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal) && isDeep(node.argument.literal.text)) {
        deep(node.argument.literal.text, "the HUD names a type of");
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        scanElement(node);
      }
      if (ts.isJsxElement(node) && ts.isIdentifier(node.openingElement.tagName) && bound.has(node.openingElement.tagName.text)) {
        const tag = bound.get(node.openingElement.tagName.text);
        const rule = manifest.components[tag] === undefined ? undefined : tableOf(manifest.components[tag]).get("children");
        if (rule?.decision === "refused" && node.children.some(child => !ts.isJsxText(child) || child.text.trim() !== "")) {
          found("prop", `<${tag}> is given children, which the manifest refuses (${rule.reason})`);
        }
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && bound.has(node.expression.text)) {
        const row = names.get(bound.get(node.expression.text));
        if (Array.isArray(row.subset?.members) && !row.subset.members.includes(node.name.text)) {
          found("member", `${row.name}.${node.name.text} is not a member of the manifest's subset (${row.subset.members.join(", ")})`);
        }
      }
      if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && bound.has(node.expression.text)) {
        found("member", `${node.expression.text} is read by a computed member, which the subset cannot be checked against`);
      }
      if (ts.isVariableDeclaration(node) && node.initializer !== undefined && ts.isIdentifier(node.initializer) && ts.isObjectBindingPattern(node.name)) {
        const row = withMembers(node.initializer.text);
        for (const element of row === null ? [] : node.name.elements) {
          const key = element.propertyName ?? element.name;
          if (element.dotDotDotToken !== undefined) {
            found("member", `${row.name} is destructured with a rest element, which takes members the subset cannot be checked against`);
          } else if (!(ts.isIdentifier(key) || ts.isStringLiteral(key))) {
            found("member", `${row.name} is destructured by a computed member, which the subset cannot be checked against`);
          } else if (!row.subset.members.includes(key.text)) {
            found("member", `${row.name}.${key.text} is not a member of the manifest's subset (${row.subset.members.join(", ")}), and it is destructured`);
          }
        }
      }
      if (ts.isIdentifier(node) && withMembers(node.text) !== null && useOf(node) === "value") {
        found("member", `${node.text} is used as a value (an alias, an argument, a return, an export): the subset can only be checked against ${node.text}.member, or members destructured from it`);
      }
      ts.forEachChild(node, visit);
    };
    // The names the manifest gives a list of members (AppRegistry, Platform, ...), by their local binding.
    const withMembers = local => {
      const row = bound.has(local) ? names.get(bound.get(local)) : undefined;
      return Array.isArray(row?.subset?.members) ? row : null;
    };
    // How an identifier that is bound to such a name is used: as the object of a member access, as the initializer of a destructuring, as a name that
    // declares something or names a property (not a use), or as a value (everything else).
    const useOf = identifier => {
      const parent = identifier.parent;
      if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isTypeQueryNode(parent) || ts.isTypeReferenceNode(parent)) {
        return "type or declaration";
      }
      if (ts.isPropertyAccessExpression(parent) && parent.expression === identifier) {
        return "member access";
      }
      if (ts.isElementAccessExpression(parent) && parent.expression === identifier) {
        return "computed member";
      }
      if (ts.isVariableDeclaration(parent) && parent.initializer === identifier && ts.isObjectBindingPattern(parent.name)) {
        return "destructured";
      }
      if (ts.isShorthandPropertyAssignment(parent)) {
        return "value";
      }
      if (ts.isExportSpecifier(parent)) {
        return parent.propertyName === identifier || (parent.propertyName === undefined && parent.name === identifier) ? "value" : "name";
      }
      if (parent.name === identifier || parent.propertyName === identifier || ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent)) {
        return "name";
      }
      return "value";
    };
    const scanElement = element => {
      if (!ts.isIdentifier(element.tagName) || !bound.has(element.tagName.text)) {
        return;
      }
      const component = manifest.components[bound.get(element.tagName.text)];
      if (component === undefined) {
        return;
      }
      const table = tableOf(component);
      const tag = bound.get(element.tagName.text);
      for (const attribute of element.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) {
          found("prop", `<${tag}> takes a spread: its props cannot be checked against the manifest`);
          continue;
        }
        const name = attribute.name.getText(tree);
        if (name === "key") {
          continue;
        }
        const rule = table.get(name);
        if (rule === undefined) {
          found("prop", `<${tag} ${name}> is not a prop the manifest knows for ${tag}: RN does not declare it, and the platform would drop it unseen`);
        } else if (rule.decision === "ignored") {
          found("prop", `<${tag} ${name}> is accepted and changes nothing here (${rule.reason})`);
        } else if (rule.decision === "refused") {
          const {literal} = literalOf(attribute);
          if (!(literal !== undefined && (rule.accepts ?? []).includes(literal))) {
            found("prop", `<${tag} ${name}> is refused (${rule.reason})${rule.accepts === undefined ? "" : `: it accepts ${JSON.stringify(rule.accepts)}`}`);
          }
        }
      }
    };
    visit(tree);
  }
  return findings;
}
