// test/imports.test.mjs — зв'язки модулів без браузера: кожен відносний імпорт (статичний, import('…') з рядком,
// new URL('…', import.meta.url)) веде до наявного файлу, а імпортовані імена той модуль справді експортує. Браузерних
// модулів (main.js, сцена, стенди) node --test не вантажить — без цього битий імпорт там видно лише в браузері.
// Межі: js/engine/ не імпортує гри; детерміновані модулі (GEN_FILES, eslint.config.js) — лише детерміновані й stdlib
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parse } from 'espree';
import { GEN_FILES } from '../eslint.config.js';

const ROOT = join(import.meta.dirname, '..');
const walk = (d) => readdirSync(join(ROOT, d), { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? (d === 'js' && e.name === 'lib' ? [] : walk(posix.join(d, e.name))) : [posix.join(d, e.name)]);
const FILES = [...walk('js').filter((f) => f.endsWith('.js')), ...walk('test').filter((f) => f.endsWith('.mjs'))];
const trees = new Map();
const tree = (f) => { if (!trees.has(f)) trees.set(f, parse(readFileSync(join(ROOT, f), 'utf8'), { ecmaVersion: 2024, sourceType: 'module' })); return trees.get(f); };
const visit = (n, fn) => {
  if (!n || typeof n.type !== 'string') return;
  fn(n);
  for (const k in n) { const v = n[k]; if (Array.isArray(v)) for (const c of v) visit(c, fn); else if (v && typeof v.type === 'string') visit(v, fn); }
};
// імена, які зв'язує шаблон (export const {a, b: [c]} = …)
const bound = (p) => p.type === 'Identifier' ? [p.name] : p.type === 'ObjectPattern' ? p.properties.flatMap((q) => bound(q.type === 'RestElement' ? q.argument : q.value))
  : p.type === 'ArrayPattern' ? p.elements.filter(Boolean).flatMap(bound) : p.type === 'AssignmentPattern' ? bound(p.left) : p.type === 'RestElement' ? bound(p.argument) : [];
const target = (f, spec) => posix.normalize(posix.join(posix.dirname(f), spec));
// відносні імпорти файлу: [{spec, names}] (names — імпортовані імена; [] — лише наявність файлу)
function importsOf(f) {
  const out = [];
  visit(tree(f), (n) => {
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source) {
      const names = n.type === 'ImportDeclaration' ? n.specifiers.flatMap((s) => s.type === 'ImportSpecifier' ? [s.imported.name] : s.type === 'ImportDefaultSpecifier' ? ['default'] : [])
        : n.type === 'ExportNamedDeclaration' ? n.specifiers.map((s) => s.local.name) : [];
      out.push({ spec: n.source.value, names });
    } else if (n.type === 'ImportExpression' && n.source.type === 'Literal') out.push({ spec: n.source.value, names: [] });
    // const { a, b } = await import('…')
    else if (n.type === 'VariableDeclarator' && n.id.type === 'ObjectPattern' && n.init?.type === 'AwaitExpression' && n.init.argument.type === 'ImportExpression' && n.init.argument.source.type === 'Literal')
      out.push({ spec: n.init.argument.source.value, names: n.id.properties.filter((p) => p.type === 'Property').map((p) => p.key.name) });
    else if (n.type === 'NewExpression' && n.callee.name === 'URL' && n.arguments[0]?.type === 'Literal' && n.arguments[1]?.type === 'MemberExpression' && n.arguments[1].object.type === 'MetaProperty')
      out.push({ spec: n.arguments[0].value, names: [] });
  });
  return out.filter((i) => typeof i.spec === 'string' && i.spec.startsWith('.'));
}
const exps = new Map();
function exportsOf(f) {
  if (exps.has(f)) return exps.get(f);
  const out = new Set();
  exps.set(f, out);
  for (const n of tree(f).body) {
    if (n.type === 'ExportNamedDeclaration') {
      const d = n.declaration;
      if (d?.type === 'VariableDeclaration') for (const v of d.declarations) for (const x of bound(v.id)) out.add(x);
      else if (d?.id) out.add(d.id.name);
      for (const s of n.specifiers) out.add(s.exported.name ?? s.exported.value);
    } else if (n.type === 'ExportDefaultDeclaration') out.add('default');
    else if (n.type === 'ExportAllDeclaration') { if (n.exported) out.add(n.exported.name); else for (const x of exportsOf(target(f, n.source.value))) out.add(x); }
  }
  return out;
}

test('імпорти: кожен відносний — наявний файл, імпортовані імена — експортуються (і в браузерних модулях)', () => {
  const bad = [];
  for (const f of FILES) for (const { spec, names } of importsOf(f)) {
    const t = target(f, spec);
    if (!existsSync(join(ROOT, t))) { bad.push(`${f}: ${spec} — файлу немає`); continue; }
    if (/\.m?js$/.test(t)) for (const x of names) if (!exportsOf(t).has(x)) bad.push(`${f}: «${x}» з ${spec} — не експортується`);
  }
  assert.deepEqual(bad, []);
});

test('імпорти: шляхи від сторінки — модуль і import map у index.html, ./js/… у коді для браузера (test/)', () => {
  const bad = [];
  for (const m of readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/(?:src="|": ")\.?\/?(js\/[^"]+)"/g)) if (!existsSync(join(ROOT, m[1]))) bad.push(`index.html: ${m[1]}`);
  for (const f of FILES.filter((x) => x.startsWith('test/'))) for (const m of readFileSync(join(ROOT, f), 'utf8').matchAll(/import\(\s*['"`]\.\/(js\/[^'"`]+)['"`]\s*\)/g)) if (!existsSync(join(ROOT, m[1]))) bad.push(`${f}: ${m[1]}`);
  assert.deepEqual(bad, []);
});

test('межі: рушій (js/engine/) не імпортує гри; детерміноване (GEN_FILES) — лише детерміноване й stdlib', () => {
  const det = (f) => GEN_FILES.some((p) => p.endsWith('/**/*.js') ? f.startsWith(p.slice(0, -'**/*.js'.length)) : f === p);
  const bad = [];
  for (const f of FILES) for (const { spec } of importsOf(f)) {
    const t = target(f, spec);
    if (f.startsWith('js/engine/') && !t.startsWith('js/engine/')) bad.push(`рушій: ${f} → ${t}`);
    if (det(f) && !det(t) && !t.startsWith('js/lib/stdlib/')) bad.push(`детермінізм: ${f} → ${t}`);
  }
  assert.deepEqual(bad, []);
});
