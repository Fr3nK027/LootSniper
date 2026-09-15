'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const coreSource = fs.readFileSync(path.join(__dirname, '../radar-core.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
function harness({storage = {}, searches = [], revision = 'v1', session = 'session-a', storedSession = session} = {}) {
  const initialStorage = {...storage};
  if (storedSession !== null && !Object.hasOwn(initialStorage, 'radar-session')) initialStorage['radar-session'] = JSON.stringify(storedSession);
  const memory = new Map(Object.entries(initialStorage)), elements = new Map(), requests = [], downloads = [], blobs = [];
  function element() {
    return { value: '', checked: false, hidden: false, disabled: false, children: [], dataset: {},
      innerHTML: '', textContent: '', files: [], classList: {toggle(){}, add(){}, remove(){}},
      addEventListener(){}, setAttribute(){}, removeAttribute(){}, append(child){this.children.push(child);},
      setCustomValidity(message){this.validationMessage=message;}, reportValidity(){}, focus(){}, click(){ if (this.download) downloads.push({filename:this.download,url:this.href}); }, showModal(){}, close(){} };
  }
  class BrowserURL extends URL {}
  BrowserURL.createObjectURL = blob => { blobs.push(blob); return 'blob:lootsniper-' + blobs.length; };
  BrowserURL.revokeObjectURL = () => {};
  const context = vm.createContext({
    URL:BrowserURL, Blob, Intl, Date, AbortSignal, AbortController, console, Map, Set, Promise,
    DOMParser: class { parseFromString() { return {}; } },
    setInterval(){}, setTimeout, location: {protocol:'http:'},
    document: { hidden: true, body: {classList:{toggle(){},add(){},remove(){}}}, getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement: element, addEventListener(){} },
    localStorage: {getItem:key=>memory.get(key) ?? null, setItem:(key,value)=>memory.set(key,value)},
    fetch: async (url, options={}) => {
      requests.push({url, options});
      const payload = options.method === 'POST' ? {revision:'v2',saved:1} :
        url === '/api/status' ? {online:true,session} : url === '/api/searches' ? {searches,revision} : {items:[]};
      return {ok:true, json:async()=>payload};
    }
  });
  vm.runInContext(coreSource + '\n' + appSource, context);
  return {context,memory,elements,requests,downloads,blobs,run:code=>vm.runInContext(code,context)};
}
const localSearch = {name:'Locale',ebay:'https://ebay.it/sch/i.html?_nkw=laptop'};
const serverSearch = {name:'Server',vinted:'https://vinted.it/catalog?search_text=laptop'};
test('a new server session clears the previous radar and searches', async () => {
  const app = harness({storedSession:'old-session', session:'new-session', storage:{
    'radar-results':JSON.stringify([{titolo:'Vecchio',prezzo:500,url:'https://ebay.it/itm/123',platform:'EBAY',evalData:{stima:900,tags:[]}}]),
    'radar-favorites':JSON.stringify(['https://ebay.it/itm/123']), 'radar-searches':JSON.stringify([localSearch]),
    'radar-filters':JSON.stringify({'max-price':'800'})
  }});
  await app.run('initialSync');
  assert.equal(app.run('bombsArray.length'), 0);
  assert.equal(app.run('favorites.size'), 0);
  assert.equal(app.run('savedSearches.length'), 0);
  assert.equal(app.memory.get('radar-session'), JSON.stringify('new-session'));
  assert.deepEqual(JSON.parse(app.memory.get('radar-results')), []);
  assert.equal(app.elements.get('max-price').value, '');
});
test('startup reads saved searches without overwriting existing server searches', async () => {
  const app = harness({storage:{'radar-searches':JSON.stringify([localSearch])}, searches:[serverSearch]});
  await app.run('initialSync');
  assert.equal(app.requests.filter(request=>request.options.method === 'POST').length, 0);
  assert.equal(JSON.parse(app.memory.get('radar-searches'))[0].name, 'Server');
  assert.equal(JSON.parse(app.memory.get('radar-searches-local-backup'))[0].name, 'Locale');
});
test('first-run migration sends existing local searches with the server revision', async () => {
  const app = harness({storage:{'radar-searches':JSON.stringify([localSearch])}});
  await app.run('initialSync');
  const post = app.requests.find(request=>request.options.method === 'POST');
  assert.equal(JSON.parse(post.options.body).revision, 'v1');
  assert.equal(JSON.parse(post.options.body).searches[0].name, 'Locale');
});
test('corrupt JSON is recoverable and does not stop dashboard initialization', async () => {
  const app = harness({storage:{'radar-results':'{broken', 'radar-undo':'{"results":null}'}});
  await app.run('initialSync');
  assert.equal(app.memory.get('radar-results-corrupt-backup'), '{broken');
  assert.equal(app.run('bombsArray.length'), 0);
  assert.equal(app.run('undoArchive'), null);
});
test('imports update a saved listing even when its price is no longer a deal', async () => {
  const app = harness(); await app.run('initialSync');
  assert.equal(app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/123',title:'Laptop RTX 4070 32 GB RAM',price:900,updatedAt:Date.now()-10000})"), true);
  assert.equal(app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/123',title:'Laptop RTX 4070 32 GB RAM',price:2000,updatedAt:Date.now()})"), true);
  assert.equal(app.run('bombsArray[0].prezzo'), 2000);
  assert.equal(app.run('bombsArray.length'), 1);
  assert.equal(app.run('filteredItems().length'), 0);
  app.run("resultScope = 'all'");
  assert.equal(app.run('filteredItems().length'), 1);
});
test('default radar shows only qualified deals and guided facets support optional multi-selection', async () => {
  const app = harness(); await app.run('initialSync');
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/101',title:'Laptop RTX 4070 32 GB RAM 1 TB NVMe ottime condizioni',price:800,updatedAt:Date.now()})");
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/102',title:'Laptop RTX 4070 16 GB RAM 512 GB SSD usato',price:1300,updatedAt:Date.now()})");
  assert.equal(app.run('bombsArray[0].evalData.isDeal'), true);
  assert.equal(app.run('bombsArray[1].evalData.isDeal'), false);
  assert.equal(app.run('filteredItems().length'), 1);
  assert.equal(app.run("setGuidedFilter('ramAmount', '32', true)"), true);
  assert.equal(app.run("JSON.stringify(guidedFilters.ramAmount)"), '["32"]');
  assert.equal(app.run('filteredItems().length'), 1);
  app.run("resultScope = 'all'; setGuidedFilter('ramAmount', '16', true)");
  assert.equal(app.run("JSON.stringify(guidedFilters.ramAmount)"), '["32","16"]');
  assert.equal(app.run('filteredItems().length'), 2);
  app.run("setGuidedFilter('ramAmount', '32', false)");
  assert.equal(app.run('filteredItems().length'), 1);
  assert.match(app.run('filteredItems()[0].titolo'), /16 GB/);
});
test('generic technology such as NAS and routers remains visible for manual comparison', async () => {
  const app = harness(); await app.run('initialSync');
  assert.equal(app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/456',title:'NAS Synology DS224+ 2 bay',price:280,updatedAt:Date.now()})"), true);
  assert.equal(app.run('bombsArray[0].evalData.kind'), 'generic');
  assert.equal(app.run('bombsArray[0].evalData.gpuName'), 'NAS');
  assert.match(app.run('cardTemplate(bombsArray[0])'), /2 bay/);
  assert.match(app.run('cardTemplate(bombsArray[0])'), /confronto manuale/);
  assert.match(app.run('cardTemplate(bombsArray[0])'), /card-offer/);
  assert.match(app.run('cardTemplate(bombsArray[0])'), /Vedi l’annuncio/);
  assert.equal(app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/789',title:'Alimentatore per NAS Synology',price:30,updatedAt:Date.now()})"), false);
  app.run('resetRadarResults()');
  assert.equal(app.run('bombsArray.length'), 0);
});
test('generic comparison uses categories and honest manual values', async () => {
  const app = harness(); await app.run('initialSync');
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/1',title:'NAS Synology 4 bay 8TB HDD',price:500,updatedAt:Date.now()})");
  app.run("upsertListing({platform:'SUBITO',url:'https://subito.it/informatica/router-1.htm',title:'Router Wi-Fi 7 2.5 GbE',price:120,updatedAt:Date.now()})");
  app.run('selectedForVersus = bombsArray.map(item => item.url); showComparison()');
  const table = app.elements.get('comparison-content').innerHTML;
  assert.match(table, /Tipo \/ componente/);
  assert.match(table, /Dati rilevati/);
  assert.match(table, /Confronto manuale/);
  assert.match(table, /Non disponibile/);
  assert.doesNotMatch(table, />GPU</);
});
test('product image, title and action all open the original listing safely', async () => {
  const app = harness(); await app.run('initialSync');
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/456',title:'NAS Synology DS224+',price:280,updatedAt:Date.now()})");
  const card = app.run('cardTemplate(bombsArray[0])');
  assert.match(card, /class="card-image-link"/);
  assert.match(card, /class="card-title-link"/);
  assert.equal((card.match(/target="_blank" rel="noopener noreferrer"/g) || []).length, 3);
  assert.match(card, /aria-label="Apri annuncio: NAS Synology DS224\+"/);
});
test('old import snapshots cannot overwrite a more recent price', async () => {
  const app = harness(); await app.run('initialSync');
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/123',title:'Laptop RTX 4070',price:900,updatedAt:Date.now()})");
  assert.equal(app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/123',title:'Laptop RTX 4070',price:800,updatedAt:Date.now()-1000})"), false);
  assert.equal(app.run('bombsArray[0].prezzo'), 900);
});
test('favorites migrate from tracked URLs to their canonical listing identity', () => {
  const app = harness({storage:{'radar-favorites':JSON.stringify(['https://ebay.it/itm/123?track=1'])}});
  assert.equal(app.run("favorites.has('https://www.ebay.it/itm/123')"), true);
});
test('saved filters restore only valid values and do not become arbitrary HTML', async () => {
  const app = harness({storage:{'radar-filters':JSON.stringify({'min-price':'200','max-price':'800','platform-filter':'EBAY','category-filter':'nas','with-photo-only':true,'favorites-only':true,'sort-order':'not-a-sort'})}});
  await app.run('initialSync');
  assert.equal(app.elements.get('min-price').value, '200');
  assert.equal(app.elements.get('max-price').value, '800');
  assert.equal(app.elements.get('platform-filter').value, 'EBAY');
  assert.equal(app.elements.get('category-filter').value, 'nas');
  assert.equal(app.elements.get('with-photo-only').checked, true);
  assert.equal(app.elements.get('favorites-only').checked, true);
  assert.equal(app.elements.get('sort-order').value, 'deal-desc');
});
test('catalog category filter separates product families', async () => {
  const app = harness(); await app.run('initialSync');
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/1',title:'NAS Synology 4 bay',price:500,updatedAt:Date.now()})");
  app.run("upsertListing({platform:'SUBITO',url:'https://subito.it/informatica/router-1.htm',title:'Router Wi-Fi 7',price:120,updatedAt:Date.now()})");
  app.run("resultScope = 'all'");
  app.elements.get('category-filter').value = 'nas';
  assert.equal(app.run('filteredItems().length'), 1);
  assert.equal(app.run('filteredItems()[0].evalData.gpuName'), 'NAS');
  app.run('renderActiveFilters()');
  assert.match(app.elements.get('active-filters').innerHTML, /Categoria: NAS/);
});
test('category menu shows live product counts and preserves the selected category', async () => {
  const app = harness(); await app.run('initialSync');
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/1',title:'NAS Synology 4 bay',price:500,updatedAt:Date.now()})");
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/2',title:'NAS QNAP 2 bay',price:250,updatedAt:Date.now()})");
  app.run("upsertListing({platform:'SUBITO',url:'https://subito.it/informatica/router-1.htm',title:'Router Wi-Fi 7',price:120,updatedAt:Date.now()})");
  app.run("resultScope = 'all'");
  app.elements.get('category-filter').value = 'nas';
  app.run('renderAllCards()');
  const options = app.elements.get('category-filter').innerHTML;
  assert.match(options, /Tutte \(3\)/);
  assert.match(options, /NAS \(2\)/);
  assert.match(options, /Router e rete \(1\)/);
  assert.match(options, /Smartphone \(0\)/);
  assert.equal(app.elements.get('category-filter').value, 'nas');
  assert.equal(app.run('filteredItems().length'), 2);
});
test('marketplace menu shows live counts and preserves the selected marketplace', async () => {
  const app = harness(); await app.run('initialSync');
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/1',title:'NAS Synology 4 bay',price:500,updatedAt:Date.now()})");
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/2',title:'NAS QNAP 2 bay',price:250,updatedAt:Date.now()})");
  app.run("upsertListing({platform:'SUBITO',url:'https://subito.it/informatica/router-1.htm',title:'Router Wi-Fi 7',price:120,updatedAt:Date.now()})");
  app.run("resultScope = 'all'");
  app.elements.get('platform-filter').value = 'EBAY';
  app.run('renderAllCards()');
  const options = app.elements.get('platform-filter').innerHTML;
  assert.match(options, /Tutti \(3\)/);
  assert.match(options, /eBay \(2\)/);
  assert.match(options, /Subito \(1\)/);
  assert.match(options, /Vinted \(0\)/);
  assert.equal(app.elements.get('platform-filter').value, 'EBAY');
  assert.equal(app.run('filteredItems().length'), 2);
});
test('catalog price range applies both minimum and maximum limits', async () => {
  const app = harness(); await app.run('initialSync');
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/1',title:'NAS Synology 2 bay',price:150,updatedAt:Date.now()})");
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/2',title:'NAS Synology 4 bay',price:350,updatedAt:Date.now()})");
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/3',title:'NAS Synology 8 bay',price:900,updatedAt:Date.now()})");
  app.run("resultScope = 'all'");
  app.elements.get('min-price').value = '200';
  app.elements.get('max-price').value = '500';
  assert.equal(app.run('filteredItems().length'), 1);
  assert.equal(app.run('filteredItems()[0].prezzo'), 350);
  app.run('renderActiveFilters()');
  assert.match(app.elements.get('active-filters').innerHTML, /Da 200 €/);
  assert.match(app.elements.get('active-filters').innerHTML, /Fino a 500 €/);
});
test('an inverted price range explains the error instead of looking like an empty catalog', async () => {
  const app = harness(); await app.run('initialSync');
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/1',title:'NAS Synology 4 bay',price:350,updatedAt:Date.now()})");
  app.run("resultScope = 'all'");
  app.elements.get('min-price').value = '700';
  app.elements.get('max-price').value = '500';
  app.run('renderAllCards()');
  assert.equal(app.run('filteredItems().length'), 0);
  assert.equal(app.elements.get('min-price').validationMessage, 'Il prezzo minimo non può superare il prezzo massimo.');
  assert.match(app.elements.get('results-grid').innerHTML, /Controlla la fascia di prezzo/);
  assert.match(app.elements.get('results-grid').innerHTML, /prezzo minimo non può superare il prezzo massimo/);
  app.elements.get('min-price').value = '300';
  app.elements.get('max-price').value = '800';
  app.run('renderAllCards()');
  assert.equal(app.elements.get('min-price').validationMessage, '');
  assert.equal(app.run('filteredItems().length'), 1);
});
test('photo filter keeps only listings with an image and exposes a removable chip', async () => {
  const app = harness(); await app.run('initialSync');
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/1',title:'NAS Synology 2 bay',price:150,image:'https://images.example/nas.jpg',updatedAt:Date.now()})");
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/2',title:'NAS QNAP 4 bay',price:350,updatedAt:Date.now()})");
  app.run("resultScope = 'all'");
  app.elements.get('with-photo-only').checked = true;
  assert.equal(app.run('filteredItems().length'), 1);
  assert.match(app.run('filteredItems()[0].image'), /^https:/);
  app.run('renderActiveFilters()');
  assert.match(app.elements.get('active-filters').innerHTML, /Solo con foto/);
  assert.equal(app.run("clearActiveFilter('with-photo-only')"), true);
  assert.equal(app.elements.get('with-photo-only').checked, false);
  assert.equal(app.run('filteredItems().length'), 2);
});
test('catalog view defaults to list and remembers the optional grid choice', async () => {
  const gridApp = harness({storage:{'radar-result-view':JSON.stringify('grid')}}); await gridApp.run('initialSync');
  assert.equal(gridApp.elements.get('results-grid').dataset.view, 'grid');
  gridApp.run("applyResultView('list')");
  assert.equal(gridApp.elements.get('results-grid').dataset.view, 'list');
  assert.equal(JSON.parse(gridApp.memory.get('radar-result-view')), 'list');
  const defaultApp = harness(); await defaultApp.run('initialSync');
  assert.equal(defaultApp.elements.get('results-grid').dataset.view, 'list');
});
test('active catalog filters are visible and can be removed independently', async () => {
  const app = harness(); await app.run('initialSync');
  app.elements.get('search-input').value = 'synology';
  app.elements.get('platform-filter').value = 'EBAY';
  app.elements.get('max-price').value = '500';
  app.run('renderAllCards()');
  assert.equal(app.elements.get('active-filters').hidden, false);
  assert.match(app.elements.get('active-filters').innerHTML, /Testo: “synology”/);
  assert.match(app.elements.get('active-filters').innerHTML, /Marketplace: eBay/);
  assert.equal(app.run("clearActiveFilter('platform-filter')"), true);
  assert.equal(app.elements.get('platform-filter').value, '');
  assert.equal(app.elements.get('search-input').value, 'synology');
  assert.equal(app.run("clearActiveFilter('unknown')"), false);
});
test('price history records changes and survives backup normalization', async () => {
  const app = harness(); await app.run('initialSync');
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/123',title:'Laptop RTX 4070',price:900,updatedAt:Date.now()-2000})");
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/123',title:'Laptop RTX 4070',price:800,updatedAt:Date.now()-1000})");
  app.run("upsertListing({platform:'EBAY',url:'https://ebay.it/itm/123',title:'Laptop RTX 4070',price:800,updatedAt:Date.now()})");
  assert.equal(app.run('bombsArray[0].priceHistory.length'), 2);
  assert.equal(app.run('cleanResult(bombsArray[0]).priceHistory[0].price'), 900);
  assert.match(app.run('cardTemplate(bombsArray[0])'), /price-drop/);
});
test('the user explicitly chooses automatic generation or manually pasted links', async () => {
  const app = harness(); await app.run('initialSync');
  app.elements.get('market-query').value='RTX 4080';
  app.elements.get('link-ebay').value='https://www.ebay.it/sch/i.html?_nkw=old';
  app.run('quickQueryDirty = true');
  assert.match(app.run('getSources()[1].url'), /RTX%204080/);
  app.run("setLinkMode('manual'); Object.keys(MARKET_HOSTS).forEach(key => $('link-' + key.toLowerCase()).value = '')");
  app.elements.get('link-ebay').value='https://www.ebay.it/sch/i.html?_nkw=custom';
  assert.equal(app.run('getSources().length'), 1);
  assert.match(app.run('getSources()[0].url'), /custom/);
  assert.equal(app.elements.get('auto-search-panel').hidden, true);
  app.run("setLinkMode('auto')");
  assert.equal(app.run('getSources().length'), 8);
  assert.equal(app.elements.get('auto-search-panel').hidden, false);
});
test('category shortcuts prepare an editable search on every marketplace', async () => {
  const app = harness(); await app.run('initialSync');
  assert.equal(app.run("prepareQuickQuery('NAS 4 bay')"), true);
  assert.equal(app.elements.get('market-query').value, 'NAS 4 bay');
  assert.match(app.elements.get('link-vinted').value, /NAS%204%20bay/);
  assert.match(app.elements.get('link-ebay').value, /NAS%204%20bay/);
  assert.match(app.elements.get('link-subito').value, /NAS%204%20bay/);
  assert.equal(app.run('quickQueryDirty'), false);
});
test('saving a generic electronics search downloads a reusable editable profile', async () => {
  const app = harness(); await app.run('initialSync');
  app.elements.get('search-name').value = 'NAS economici';
  app.elements.get('market-query').value = 'NAS Synology 4 bay';
  app.elements.get('min-price').value = '150';
  app.elements.get('max-price').value = '450';
  app.elements.get('category-filter').value = 'nas';
  app.elements.get('with-photo-only').checked = true;
  app.elements.get('sort-order').value = 'price-asc';
  app.run("resultScope = 'all'; primaryIntent = 'nas'; guidedFilters = {usage:['nas'], storageType:['hdd','unknown'], brand:['other']}");
  app.run("$('deep-scan').checked = true; quickQueryDirty = true");
  await app.run('saveSearch()');
  assert.equal(app.downloads.length, 1);
  assert.equal(app.downloads[0].filename, 'LootSniper-NAS-economici.json');
  const profile = JSON.parse(await app.blobs[0].text());
  assert.equal(profile.format, 'lootsniper-search');
  assert.equal(profile.query, 'NAS Synology 4 bay');
  assert.equal(profile.sourceMode, 'auto');
  assert.equal(profile.marketplaces.ebay, true);
  assert.equal(profile.filters.minPrice, 150);
  assert.equal(profile.filters.maxPrice, 450);
  assert.equal(profile.filters.category, 'nas');
  assert.equal(profile.filters.withPhoto, true);
  assert.equal(profile.filters.order, 'price-asc');
  assert.equal(profile.filters.scope, 'all');
  assert.equal(profile.filters.primaryIntent, 'nas');
  assert.deepEqual(profile.filters.facets, {usage:['nas'], storageType:['hdd','unknown'], brand:['other']});
});
test('a manual search keeps pasted links in its reusable file and restores manual mode', async () => {
  const app = harness(); await app.run('initialSync');
  app.elements.get('search-name').value = 'Router con filtri manuali';
  app.run("setLinkMode('manual'); $('link-ebay').value = 'https://www.ebay.it/sch/i.html?_nkw=router&_udhi=120'; $('deep-scan').checked = false");
  await app.run('saveSearch()');
  await app.run('saveQueue');
  const profile = JSON.parse(await app.blobs[0].text());
  assert.equal(profile.sourceMode, 'manual');
  assert.match(profile.marketplaces.ebay, /_udhi=120/);
  assert.equal(profile.marketplaces.vinted, false);
  assert.equal(app.run('savedSearches[0].linkMode'), 'manual');
  app.run("setLinkMode('auto'); loadSavedSearch(savedSearches[0])");
  assert.equal(app.elements.get('source-mode-manual').checked, true);
});
test('executing a query generates the marketplace links and renders collected results', async () => {
  const app = harness(); await app.run('initialSync');
  app.elements.get('market-query').value = 'RTX 4070';
  app.run(`$('deep-scan').checked = false; quickQueryDirty = true;
    extractListings = () => [{platform:'EBAY',url:'https://www.ebay.it/itm/987654321',title:'Laptop RTX 4070',price:'890 EUR',details:'32 GB RAM',updatedAt:Date.now()}];
    api = async path => path.startsWith('/api/import/latest') ? {items:[],cursor:0} : {html:'<html></html>',hasNext:false};`);
  await app.run('runScan()');
  assert.equal(app.run('bombsArray.length'), 1);
  assert.equal(app.run('bombsArray[0].titolo'), 'Laptop RTX 4070');
  assert.match(app.elements.get('link-vinted').value, /RTX%204070/);
  assert.match(app.elements.get('link-ebay').value, /RTX%204070/);
  assert.match(app.elements.get('link-subito').value, /RTX%204070/);
  assert.equal(app.elements.get('btn-scan').disabled, false);
  assert.equal(app.elements.get('btn-text').textContent, 'Esegui ricerca');
});
test('the dashboard prefers the integrated browser and avoids blocked direct requests when available', async () => {
  const app = harness(); await app.run('initialSync');
  app.elements.get('market-query').value = 'Router Wi-Fi 7';
  app.run(`$('deep-scan').checked = false; quickQueryDirty = true;
    runBrowserScan = async () => ({handled:true,changed:4,status:{failures:0}});`);
  await app.run('runScan()');
  assert.equal(app.requests.some(request => String(request.url).startsWith('/api/fetch')), false);
  assert.equal(app.elements.get('scan-feedback-title').textContent, 'Ricerca completata dal browser');
  assert.match(app.elements.get('scan-feedback-body').textContent, /4 annunci/);
});
test('an empty page after readable results is a normal end of pagination', async () => {
  const app = harness(); await app.run('initialSync');
  app.run(`setLinkMode('manual'); $('link-vinted').value='https://www.vinted.it/catalog?search_text=laptop'; $('deep-scan').checked=true;
    let collectedPage=0; runBrowserScan=async()=>{throw new Error('Estensione non rilevata.')};
    api=async path=>path.startsWith('/api/import/latest')?{items:[],cursor:0}:{html:'<html></html>',hasNext:collectedPage===0};
    extractListings=()=>++collectedPage===1?[{platform:'VINTED',url:'https://www.vinted.it/items/123',title:'Laptop RTX 4070',price:'800 EUR',updatedAt:Date.now()}]:[];`);
  await app.run('runScan()');
  assert.equal(app.run('bombsArray.length'), 1);
  assert.equal(app.elements.get('scan-feedback-title').textContent, 'Ricerca completata');
  assert.match(app.elements.get('scan-feedback-body').textContent, /da 1 fonti/);
  assert.doesNotMatch(app.elements.get('scan-feedback-body').textContent, /bloccata|non leggibile/);
});
test('an edited search profile restores query, custom URLs and filters', async () => {
  const app = harness(); await app.run('initialSync');
  const profile = {format:'lootsniper-search',version:1,name:'Telefono ricondizionato',query:'iPhone 15 256GB',
    marketplaces:{vinted:true,ebay:'https://www.ebay.it/sch/i.html?_nkw=iphone+15&_udhi=700',subito:false},
    filters:{minPrice:300,maxPrice:700,minMargin:null,platform:'EBAY',category:'smartphone',withPhoto:true,order:'price-asc',text:'256GB',scope:'all',primaryIntent:'smartphone',facets:{usage:['smartphone'],condition:['refurbished','good']}},deepScan:false};
  await app.run(`importSearchProfile({target:{files:[{size:1000,text:async()=>${JSON.stringify(JSON.stringify(profile))}}],value:'profile'}})`);
  assert.equal(app.run('savedSearches[0].name'), 'Telefono ricondizionato');
  assert.equal(app.elements.get('market-query').value, 'iPhone 15 256GB');
  assert.match(app.elements.get('link-vinted').value, /iPhone%2015%20256GB/);
  assert.match(app.elements.get('link-ebay').value, /_udhi=700/);
  assert.equal(app.elements.get('link-subito').value, '');
  assert.equal(app.elements.get('min-price').value, '300');
  assert.equal(app.elements.get('max-price').value, '700');
  assert.equal(app.elements.get('platform-filter').value, 'EBAY');
  assert.equal(app.elements.get('category-filter').value, 'smartphone');
  assert.equal(app.elements.get('with-photo-only').checked, true);
  assert.equal(app.run('resultScope'), 'all');
  assert.equal(app.run('primaryIntent'), 'smartphone');
  assert.equal(app.run('JSON.stringify(guidedFilters.usage)'), '["smartphone"]');
  assert.equal(app.run('JSON.stringify(guidedFilters.condition)'), '["refurbished","good"]');
  assert.equal(app.elements.get('deep-scan').checked, false);
  assert.equal(app.elements.get('source-mode-manual').checked, true);
});
test('legacy result-array backups merge duplicates and reject unsupported versions', async () => {
  const app = harness(); await app.run('initialSync');
  await app.run(`importBackup({target:{files:[{size:100,text:async()=>JSON.stringify([
    {titolo:'Laptop',platform:'EBAY',url:'https://ebay.it/itm/1',prezzo:500,evalData:{stima:1000,tags:[]}},
    {titolo:'Laptop aggiornato',platform:'EBAY',url:'https://ebay.it/itm/1?track=2',prezzo:450,evalData:{stima:1000,tags:[]}}
  ])}],value:'backup'}})`);
  assert.equal(app.run('bombsArray.length'), 1);
  assert.equal(app.run('bombsArray[0].prezzo'), 450);
  await app.run("importBackup({target:{files:[{size:10,text:async()=>JSON.stringify({version:99,results:[]})}],value:'backup'}})");
  assert.equal(app.run('bombsArray.length'), 1);
});
