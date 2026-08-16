import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(repositoryRoot, 'duckworth-api/package.json'));
const ts = require('typescript');
const config = JSON.parse(await readFile(resolve(repositoryRoot, 'tools/architecture/brain-boundary.json'), 'utf8'));
const violations = [];

for (const file of await sourceFiles(resolve(repositoryRoot, config.webRoot))) {
  const sourceFile = await parse(file);
  visit(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
    const specifier = node.moduleSpecifier.text;
    const forbidden = config.forbiddenWebImports.find((candidate) => specifier === candidate || specifier.startsWith(`${candidate}/`));
    if (forbidden) violations.push(`${relative(file)} imports forbidden browser interpretation dependency ${specifier}`);
  });
}

for (const routeFile of config.apiRouteFiles) {
  const file = resolve(repositoryRoot, routeFile);
  const sourceFile = await parse(file);
  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const called = calledName(node.expression);
    if (called && config.forbiddenApiCalls.includes(called)) {
      violations.push(`${routeFile} calls low-level interpretation function ${called}`);
    }
  });
}

for (const root of config.brainProductionRoots) {
  for (const file of await sourceFiles(resolve(repositoryRoot, root))) {
    const name = relative(file);
    if (config.ignoredFileSuffixes.some((suffix) => name.endsWith(suffix))) continue;
    const sourceFile = await parse(file);
    const matcherAllowed = config.structuralPolicyAllowlist.includes(name);
    const runtimeAllowed = config.runtimeConstructionAllowlist.includes(name);
    visit(sourceFile, (node) => {
      if (!runtimeAllowed && ts.isCallExpression(node)) {
        const called = calledName(node.expression);
        if (called && config.forbiddenRuntimeConstructors.includes(called)) {
          violations.push(`${name} constructs a semantic runtime implicitly with ${called}`);
        }
      }
      if (matcherAllowed || !isStringLiteral(node)) return;
      const literal = node.text.normalize('NFKC').toLocaleLowerCase('und');
      if (config.forbiddenMatcherLiterals.some((candidate) => candidate.normalize('NFKC').toLocaleLowerCase('und') === literal)) {
        violations.push(`${name} embeds reviewed matcher literal ${node.text}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error(['Shopping brain boundary violations:', ...[...new Set(violations)].map((entry) => `- ${entry}`)].join('\n'));
  process.exitCode = 1;
} else {
  console.log('Shopping brain AST architecture boundary passed.');
}

async function parse(file) {
  const source = await readFile(file, 'utf8');
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
}

function scriptKind(file) {
  return ['.js', '.mjs'].includes(extname(file)) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

function visit(node, check) {
  check(node);
  ts.forEachChild(node, (child) => visit(child, check));
}

function calledName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function isStringLiteral(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.mts', '.js', '.mjs'].includes(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}

function relative(path) {
  return path.slice(repositoryRoot.length + 1).replaceAll('\\', '/');
}
