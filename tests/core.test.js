'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../radar-core.js');

test('Italian and international euro amounts, without guessed shipping', () => {
  for (const [input, expected] of [
    ['1.250,50 €', 1250.5], ['EUR 1,250.50', 1250.5], ['950,00 EUR', 950],
    ['1.500 €', 1500], ['€ 1 250,00', 1250], [900, 900], ['900', 900],
    ['€ 900 + € 25 spedizione', 900], ['€ 99,95', 99.95],
    ['$ 900', null], ['Prezzo da concordare', null], ['0 €', null], [null, null], ['-900 €', null], [100001, null],
    ['RTX 4070 32GB', null], ['EUR 1.234.567', null]
  ]) assert.equal(core.parseMoney(input), expected, String(input));
});
test('canonical identities remove trackers, slug aliases and fragments', () => {
  assert.equal(core.canonicalUrl('https://ebay.it/itm/Notebook/123456?tracking=1#foo', 'EBAY'), 'https://www.ebay.it/itm/123456');
  assert.equal(core.canonicalUrl('https://vinted.it/items/123-name?ref=x', 'VINTED'), 'https://www.vinted.it/items/123');
  assert.equal(core.canonicalUrl('javascript:alert(1)', 'EBAY'), '');
  assert.equal(core.canonicalUrl('https://evil.example/itm/123', 'EBAY'), '');
  assert.equal(core.safeUrl('https://user:pass@ebay.it/itm/1', 'EBAY'), '');
  const filteredEbay = 'https://www.ebay.com/sch/i.html?_dcat=177&_fsrp=1&_nkw=gaming+laptop&RAM%2520Size=64%2520GB%7C32%2520GB&_udlo=1300&_udhi=2000';
  assert.equal(core.safeUrl(filteredEbay, 'EBAY'), filteredEbay);
  assert.equal(core.safeUrl('https://fake-ebay.com/sch/i.html?_nkw=laptop', 'EBAY'), '');
});
test('pagination starts at the supplied page and preserves filters', () => {
  const url = new URL(core.pageUrl('https://www.vinted.it/catalog?catalog[]=1&page=3#results', 'VINTED', 2));
  assert.equal(url.searchParams.get('page'), '4');
  assert.equal(url.searchParams.get('catalog[]'), '1');
  assert.equal(url.hash, '#results');
  assert.equal(new URL(core.pageUrl('https://ebay.it/sch/i.html?_pgn=bad', 'EBAY', 1)).searchParams.get('_pgn'), '1');
  const ebayCom = new URL(core.pageUrl('https://www.ebay.com/sch/i.html?_nkw=gaming+laptop&_udlo=1300&_udhi=2000', 'EBAY', 2));
  assert.equal(ebayCom.hostname, 'www.ebay.com');
  assert.equal(ebayCom.searchParams.get('_udlo'), '1300');
  assert.equal(ebayCom.searchParams.get('_udhi'), '2000');
  assert.equal(ebayCom.searchParams.get('_pgn'), '2');
});
test('hardware analysis avoids component and CPU false positives', () => {
  assert.ok(core.analyzeHardware('Laptop RTX 4070 32 GB RAM 1 TB SSD', 800));
  assert.ok(core.analyzeHardware('Notebook Radeon 7800 XT 32GB RAM', 500));
  assert.equal(core.analyzeHardware('Ryzen 7600 notebook', 500), null);
  assert.equal(core.analyzeHardware('Scheda video RTX 4070', 300), null);
  assert.equal(core.analyzeHardware('Custodia per laptop RTX 4070', 20), null);
  assert.equal(core.analyzeHardware('Laptop RTX 4070', -1), null);
  assert.equal(core.analyzeHardware('Monitor HP Omen', 100), null);
});
test('VRAM and substring storage capacities do not inflate the laptop estimate', () => {
  const vram = core.analyzeHardware('Laptop RTX 5090 32 GB VRAM 12 TB storage', 1000);
  assert.ok(!vram.tags.some(tag => tag.text === '32GB RAM' || tag.text === '2TB storage'));
  const ram = core.analyzeHardware('Laptop RTX 4070 RAM 32GB', 1000);
  assert.ok(ram.tags.some(tag => tag.text === '32GB RAM'));
});
test('damage wins over new condition language; partial words are not damage', () => {
  const damaged = core.analyzeHardware('Laptop RTX 4070 nuovo ma schermo rotto', 300);
  assert.ok(damaged.tags.some(tag => tag.text === 'Da riparare'));
  const clean = core.analyzeHardware('Laptop RTX 4070 senza segni in tutte le sue parti', 300);
  assert.ok(!clean.tags.some(tag => ['Da riparare', 'Usura'].includes(tag.text)));
});
test('restored cards reject invalid links and strip untrusted tag classes', () => {
  const entry = { titolo: '<img src=x onerror=alert(1)>', prezzo: 500, url: 'https://ebay.it/itm/123', platform: 'EBAY',
    evalData: { stima: 900, vsScore: 900, tags: [{ text: 'test', cls: '" onclick="evil' }, { text: 'Brand eco -20%', cls: 't-down' }] } };
  const clean = core.cleanResult(entry);
  assert.equal(clean.evalData.vsScore, 100);
  assert.equal(clean.evalData.tags[0].cls, 't-neutral');
  assert.equal(clean.evalData.tags[1].text, 'Serie essenziale');
  assert.equal(core.cleanResult({ ...entry, url: 'javascript:alert(1)' }), null);
  assert.equal(core.escapeHtml(entry.titolo), '&lt;img src=x onerror=alert(1)&gt;');
});
test('listing explanation separates observed specifications from missing details', () => {
  const item = { titolo: 'Laptop RTX 4070 con 32 GB RAM', details: '', prezzo: 800,
    evalData: { stima: 1250 } };
  const explanation = core.explainListing(item);
  assert.equal(explanation.difference, 450);
  assert.ok(explanation.facts.includes('RTX 4070'));
  assert.ok(explanation.facts.includes('32GB RAM'));
  assert.ok(explanation.missing.includes('Capacità di archiviazione'));
  assert.ok(explanation.missing.includes('Processore'));
});
test('generic electronics expose only specifications found in listing text', () => {
  const nas = core.analyzeGenericFeatures('NAS Synology 4 bay con 8TB HDD e rete 2.5 GbE');
  assert.equal(nas.category, 'NAS');
  assert.deepEqual(nas.facts, ['8 TB', '4 bay', '2,5 GbE']);
  assert.deepEqual(nas.warnings, []);
  assert.ok(!nas.missing.includes('Numero di bay'));
  const router = core.analyzeGenericFeatures('Router WiFi 7 mesh 10 Gbps');
  assert.equal(router.category, 'Router / rete');
  assert.ok(router.facts.includes('Wi-Fi 7'));
  assert.ok(router.facts.includes('10 Gbps'));
  const phone = core.analyzeGenericFeatures('iPhone 15 256GB dual SIM con iCloud bloccato');
  assert.equal(phone.category, 'Smartphone');
  assert.ok(phone.facts.includes('256 GB memoria'));
  assert.ok(phone.warnings.includes('Possibile blocco account'));
});
test('older generic results are enriched when they are restored', () => {
  const restored = core.cleanResult({titolo:'NAS Synology 2 bay',details:'senza dischi',prezzo:280,url:'https://subito.it/informatica/nas-1.htm',platform:'SUBITO',
    evalData:{stima:280,kind:'generic',gpuName:'Prodotto generico',tags:[{text:'Prezzo da confrontare',cls:'t-neutral'}]}});
  assert.equal(restored.evalData.gpuName, 'NAS');
  assert.ok(restored.evalData.tags.some(tag => tag.text === '2 bay'));
  assert.ok(restored.evalData.tags.some(tag => tag.text === 'Senza dischi'));
});
