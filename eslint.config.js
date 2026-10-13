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

export default [
  { ignores: ['.wt/**', 'js/lib/**', 'docs/**', 'temp/**', 'tmp/**', 'node_modules/**', 'echoverse-prompts/**'] },
  { files: ['js/**/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, ...globals.worker } }, plugins: { js }, rules },
  { files: ['test/**/*.mjs', 'eslint.config.js', '*.mjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, WebSocket: 'readonly' } }, rules },
];
