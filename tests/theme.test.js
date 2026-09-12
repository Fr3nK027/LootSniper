'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../theme.js'), 'utf8');

function harness({ saved = null, systemDark = false } = {}) {
  let click;
  const memory = new Map(saved ? [['lootsniper-theme', saved]] : []);
  const elements = new Map(['btn-theme', 'theme-icon', 'theme-label'].map(id => [id, {
    textContent: '', title: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { if (name === 'click') click = handler; }
  }]));
  const root = { dataset: {}, style: {} };
  vm.runInNewContext(source, {
    document: { readyState: 'complete', documentElement: root, getElementById: id => elements.get(id) },
    localStorage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) },
    matchMedia: () => ({ matches: systemDark, addEventListener() {} })
  });
  return { root, memory, elements, click };
}

test('theme follows the system until the user chooses a mode', () => {
  const app = harness({ systemDark: true });
  assert.equal(app.root.dataset.theme, 'dark');
  assert.equal(app.elements.get('theme-label').textContent, 'Notte');
  app.click();
  assert.equal(app.root.dataset.theme, 'light');
  assert.equal(app.memory.get('lootsniper-theme'), 'light');
  assert.equal(app.elements.get('btn-theme').attributes['aria-label'], 'Passa alla modalità notte');
});

test('saved day mode overrides a dark operating system', () => {
  const app = harness({ saved: 'light', systemDark: true });
  assert.equal(app.root.dataset.theme, 'light');
  assert.equal(app.elements.get('theme-icon').textContent, '☀');
});
