// eslint.config.js — лінтер (npm run lint): невизначені й зайві імена, повторні оголошення, недосяжний код —
// те, що інакше видно лише в браузері (13.10.2026: прибраний з імпорту LEVEL кидав виняток щокадру)
import js from '@eslint/js';
import globals from 'globals';

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-const-assign': 'error',
  'no-import-assign': 'error',
  'no-self-assign': 'error',
  'no-unsafe-negation': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
};

// Детермінізм генерації (CLAUDE.md): у файлах генерації — лише функції, точні за IEEE 754 (однакові до біта в будь-якому
// рушії JS); трансцендентні — з num.js (stdlib). Неточні Math.* й оператор ** — помилка лінтера; межі імпортів цих
// файлів — test/imports.test.mjs
export const GEN_FILES = ['js/laws/**/*.js', 'js/gen/chunk.js', 'js/gen/biomes.js', 'js/gen/flora.js'];
const INEXACT = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'exp', 'expm1', 'log', 'log10', 'log2', 'log1p', 'pow', 'cbrt', 'hypot',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'random'];
const determinism = {
  'no-restricted-properties': ['error', ...INEXACT.map((property) => ({ object: 'Math', property, message: 'генерація: останній біт залежить від рушія — функції num.js (stdlib)' }))],
  'no-restricted-syntax': ['error', { selector: "BinaryExpression[operator='**'], AssignmentExpression[operator='**=']", message: 'генерація: ** — це Math.pow; множення чи функції num.js' }],
};

export default [
  { ignores: ['.wt/**', 'js/lib/**', 'docs/**', 'temp/**', 'tmp/**', 'node_modules/**', 'echoverse-prompts/**'] },
  { files: ['js/**/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, ...globals.worker } }, plugins: { js }, rules },
  { files: GEN_FILES, rules: determinism },
  { files: ['test/**/*.mjs', 'eslint.config.js', '*.mjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, WebSocket: 'readonly' } }, rules },
];
