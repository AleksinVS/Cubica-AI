/**
 * Extract module references with the TypeScript parser rather than text search.
 *
 * The parser ignores comments and understands imports, re-exports, `require`,
 * import types and statically computable dynamic imports. This matters for
 * dependency-boundary checks: splitting a package name across string operands
 * must not bypass the rule.
 */
const path = require("node:path");
const ts = require("typescript");

const scriptKinds = new Map([
  [".js", ts.ScriptKind.JS],
  [".jsx", ts.ScriptKind.JSX],
  [".mjs", ts.ScriptKind.JS],
  [".cjs", ts.ScriptKind.JS],
  [".ts", ts.ScriptKind.TS],
  [".tsx", ts.ScriptKind.TSX]
]);

/**
 * Collect every simple constant binding used to assemble a module name.
 *
 * Keeping all declarations is deliberately conservative. A repository gate
 * must not let an unrelated same-named variable in another lexical scope
 * overwrite the binding used by a forbidden import and hide that dependency.
 */
function collectConstantBindings(sourceFile) {
  const bindings = new Map();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const declarations = bindings.get(node.name.text) ?? [];
      declarations.push(node.initializer);
      bindings.set(node.name.text, declarations);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

/** Evaluate every possible side-effect-free string; other syntax stays unknown. */
function evaluateStaticStrings(node, bindings, seen = new Set()) {
  if (!node) return [];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
    return evaluateStaticStrings(node.expression, bindings, seen);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evaluateStaticStrings(node.left, bindings, seen);
    const right = evaluateStaticStrings(node.right, bindings, seen);
    return [...new Set(left.flatMap((leftValue) => right.map((rightValue) => leftValue + rightValue)))];
  }
  if (ts.isTemplateExpression(node)) {
    let values = [node.head.text];
    for (const span of node.templateSpans) {
      const expressions = evaluateStaticStrings(span.expression, bindings, seen);
      if (expressions.length === 0) return [];
      values = values.flatMap((prefix) =>
        expressions.map((expression) => prefix + expression + span.literal.text)
      );
    }
    return [...new Set(values)];
  }
  if (ts.isIdentifier(node) && bindings.has(node.text) && !seen.has(node.text)) {
    const nextSeen = new Set(seen).add(node.text);
    return [...new Set(bindings.get(node.text).flatMap((initializer) =>
      evaluateStaticStrings(initializer, bindings, nextSeen)
    ))];
  }
  return [];
}

/** Return every statically identifiable module specifier in one JS/TS file. */
function collectModuleSpecifiers(source, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKinds.get(path.extname(fileName)) ?? ts.ScriptKind.TS
  );
  const bindings = collectConstantBindings(sourceFile);
  const specifiers = [];

  const add = (expression) => {
    specifiers.push(...evaluateStaticStrings(expression, bindings));
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      add(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) add(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

/** Read a named string-array constant from TypeScript source as one CI source of truth. */
function collectStringArrayConstant(source, fileName, constantName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKinds.get(path.extname(fileName)) ?? ts.ScriptKind.TS
  );
  const bindings = collectConstantBindings(sourceFile);
  const declarations = bindings.get(constantName);
  if (!declarations) throw new Error(`Cannot find constant ${constantName} in ${fileName}.`);
  if (declarations.length !== 1) {
    throw new Error(`${constantName} in ${fileName} must have one unambiguous declaration.`);
  }
  let initializer = declarations[0];
  while (ts.isAsExpression(initializer) || ts.isTypeAssertionExpression(initializer) || ts.isParenthesizedExpression(initializer)) {
    initializer = initializer.expression;
  }
  if (!ts.isArrayLiteralExpression(initializer)) {
    throw new Error(`${constantName} in ${fileName} must be a literal string array.`);
  }
  return initializer.elements.map((element) => {
    const values = evaluateStaticStrings(element, bindings);
    if (values.length !== 1) {
      throw new Error(`${constantName} in ${fileName} contains a non-static string element.`);
    }
    return values[0];
  });
}

module.exports = { collectModuleSpecifiers, collectStringArrayConstant };
