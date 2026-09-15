'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'radar usato 3 market.html'), 'utf8');

test('dashboard IDs are unique and every static JavaScript lookup exists in the HTML', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'The HTML contains duplicate IDs');
  const existing = new Set(ids);
  const missing = new Set();
  const generated = new Set();
  const sources = [];
  for (const file of ['app.js', 'radar-runtime.js', 'radar-guide.js', 'theme.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    sources.push(source);
    for (const match of source.matchAll(/\bid=["']([^"']+)["']/g)) generated.add(match[1]);
  }
  for (const source of sources) for (const match of source.matchAll(/\$\('([^']+)'\)/g))
    if (!existing.has(match[1]) && !generated.has(match[1])) missing.add(match[1]);
  assert.deepEqual([...missing].sort(), []);
});
