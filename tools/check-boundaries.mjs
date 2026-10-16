import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import assert from 'node:assert/strict';

const root = path.resolve('build/src');
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(Object.keys(manifest.dependencies || {}).length, 0, 'Core must not gain runtime dependencies');
assert.deepEqual(manifest.files, ['build/src', 'README.md', 'docs/PROTOCOL.md', 'docs/CONTEXT.md']);
for (const entry of Object.values(manifest.exports)) { assert.ok(entry.default.startsWith('./build/src/')); assert.ok(fs.existsSync(entry.default)); assert.ok(fs.existsSync(entry.types)); }
const files = fs.readdirSync(root, {recursive:true}).filter(f => f.endsWith('.js'));
assert.ok(files.length >= 3);
for (const file of files) {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const inspect = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      assert.ok(ts.isStringLiteral(node.moduleSpecifier)); const name = node.moduleSpecifier.text;
      if (name !== 'node:crypto') {
        assert.ok(name.startsWith('./') || name.startsWith('../'), 'Unexpected runtime dependency');
        const target = path.resolve(root, path.dirname(file), name), relative = path.relative(root, target);
        assert.ok(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep), 'Import leaves the portable core');
        assert.ok(fs.existsSync(target), 'Missing compiled dependency');
      }
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && ['require', 'eval', 'Function'].includes(node.expression.text)))) assert.fail('Dynamic runtime loader is forbidden in core');
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
  assert.doesNotMatch(code, /personalKnowledge\.memory|memory\.search|process\.env|createRequire/);
  if (file.startsWith('context' + path.sep)) {
    assert.doesNotMatch(code,/\bPHD\b|@phd|phabricator|node:|process\.|console\./i,'Context must remain product-neutral and IO-free');
    for (const statement of ast.statements) {
      if ((ts.isImportDeclaration(statement)||ts.isExportDeclaration(statement))&&statement.moduleSpecifier) {
        const target=path.resolve(root,path.dirname(file),statement.moduleSpecifier.text);
        assert.ok(target.startsWith(path.join(root,'context')+path.sep),'Context may not import Memory lifecycle or Host code');
      }
    }
  }
}
console.log(JSON.stringify({ result: 'passed', runtimeModules: files.length, contextModules:files.filter(f=>f.startsWith('context'+path.sep)).length, runtimeDependencies: 0, fixturePackaged: false }));
