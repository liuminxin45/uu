import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import assert from 'node:assert/strict';

const root = path.resolve('build/src');
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(Object.keys(manifest.dependencies || {}).length, 0, 'Core must not gain runtime dependencies');
assert.deepEqual(manifest.files, ['build/src', 'README.md', 'docs/PROTOCOL.md']);
for (const entry of Object.values(manifest.exports)) { assert.ok(entry.import.startsWith('./build/src/')); assert.ok(fs.existsSync(entry.import)); assert.ok(fs.existsSync(entry.types)); }
const files = fs.readdirSync(root).filter(f => f.endsWith('.js'));
assert.ok(files.length >= 3);
for (const file of files) {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const inspect = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      assert.ok(ts.isStringLiteral(node.moduleSpecifier)); const name = node.moduleSpecifier.text;
      if (name !== 'node:crypto') {
        assert.ok(name.startsWith('./') || name.startsWith('../'), 'Unexpected runtime dependency');
        const target = path.resolve(root, name), relative = path.relative(root, target);
        assert.ok(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep), 'Import leaves the portable core');
        assert.ok(fs.existsSync(target), 'Missing compiled dependency');
      }
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && ['require', 'eval', 'Function'].includes(node.expression.text)))) assert.fail('Dynamic runtime loader is forbidden in core');
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
  assert.doesNotMatch(code, /personalKnowledge\.memory|memory\.search|process\.env|createRequire/);
}
console.log(JSON.stringify({ result: 'passed', runtimeModules: files.length, runtimeDependencies: 0, fixturePackaged: false }));
