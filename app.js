'use strict';
const $ = id => document.getElementById(id);
const apiBase = location.protocol === 'file:' ? 'http://127.0.0.1:8765' : '';
const euros = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
let storageWarning = false;
let radarStopped = false;
function readStorage(key, fallback) {
  let raw;
  try { raw = localStorage.getItem(key); return JSON.parse(raw || 'null') ?? fallback; }
  catch {
    storageWarning = true;
    if (raw) { try { localStorage.setItem(key + '-corrupt-backup', raw); } catch {} }
    return fallback;
  }
}
function persist(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { logMsg('Memoria browser non disponibile o piena. Esporta un backup per conservare i dati.', 'log-err'); return false; }
}
function readArray(key) { const value = readStorage(key, []); return Array.isArray(value) ? value : []; }
let bombsArray = readArray('radar-results').map(cleanResult).filter(Boolean);
bombsArray = [...new Map(bombsArray.map(item => [item.url, item])).values()];
let favorites = new Set(readArray('radar-favorites').filter(value => typeof value === 'string'));
favorites = new Set([...favorites].map(url => {
  const platform = Object.keys(MARKET_HOSTS).find(key => safeUrl(url, key));
  return platform ? canonicalUrl(url, platform) : '';
}).filter(Boolean));
let savedSearches = readArray('radar-searches').filter(item => item && typeof item.name === 'string');
let selectedForVersus = [];
let totalAnalyzed = 0;
let scanController = null;
let importing = false;
let serverRevision = null;
let saveQueue = Promise.resolve();
let initialSync = null;
let ignoredImports = readStorage('radar-ignored-imports', {});
if (!ignoredImports || typeof ignoredImports !== 'object' || Array.isArray(ignoredImports)) ignoredImports = {};
let importVersions = new Map();
let importCursor = 0;
let lastImportError = '';
let undoArchive = readStorage('radar-undo', null);
if (!undoArchive || !Array.isArray(undoArchive.results) || !Array.isArray(undoArchive.favorites)) undoArchive = null;
let renderedLimit = 60;
let quickQueryDirty = false;
let resultView = readStorage('radar-result-view', 'list') === 'grid' ? 'grid' : 'list';
let linkMode = readStorage('radar-link-mode', 'auto') === 'manual' ? 'manual' : 'auto';
const manualPlatforms = new Set();
const FILTER_IDS = ['search-input', 'platform-filter', 'category-filter', 'sort-order', 'min-price', 'max-price', 'min-margin', 'with-photo-only', 'favorites-only'];
const CHECKBOX_FILTERS = new Set(['with-photo-only', 'favorites-only']);
const SESSION_KEY = 'radar-session';
const SEARCH_PROFILE_FORMAT = 'lootsniper-search';
const SEARCH_PROFILE_VERSION = 1;
const SORT_ORDERS = ['margin-desc', 'price-asc', 'price-desc', 'vs-desc', 'newest'];
const PLATFORM_LABELS = { VINTED: 'Vinted', EBAY: 'eBay', SUBITO: 'Subito' };
const CATEGORY_LABELS = { gaming: 'Portatili gaming', component: 'Componenti PC', nas: 'NAS', network: 'Router e rete', server: 'Server', smartphone: 'Smartphone', other: 'Altra elettronica' };

function resetBrowserSession(session) {
  bombsArray = []; favorites = new Set(); savedSearches = []; selectedForVersus = [];
  totalAnalyzed = 0; ignoredImports = {}; importVersions = new Map(); importCursor = 0;
  undoArchive = null; renderedLimit = 60; quickQueryDirty = false; manualPlatforms.clear();
  persist('radar-results', []); persist('radar-favorites', []); persist('radar-searches', []);
  persist('radar-searches-local-backup', []); persist('radar-ignored-imports', {});
  persist('radar-undo', null); persist('radar-filters', {}); persist(SESSION_KEY, session);
}

function resetRadarResults() {
  bombsArray = []; favorites = new Set(); selectedForVersus = []; totalAnalyzed = 0;
  ignoredImports = {}; importVersions = new Map(); importCursor = 0; undoArchive = null; renderedLimit = 60;
  persist('radar-results', []); persist('radar-favorites', []); persist('radar-ignored-imports', {}); persist('radar-undo', null);
  renderAllCards();
}

async function initializeSession() {
  const status = await api('/api/status');
  if (typeof status.session !== 'string' || !status.session) throw new Error('Riavvia il server per iniziare una nuova sessione.');
  if (readStorage(SESSION_KEY, '') !== status.session) resetBrowserSession(status.session);
}
function persistFilters() {
  const values = Object.fromEntries(FILTER_IDS.map(id => [id, CHECKBOX_FILTERS.has(id) ? $(id).checked : $(id).value]));
  persist('radar-filters', values);
}
function restoreFilters() {
  const values = readStorage('radar-filters', {});
  if (!values || typeof values !== 'object' || Array.isArray(values)) return;
  $('search-input').value = typeof values['search-input'] === 'string' ? values['search-input'].slice(0, 500) : '';
  $('platform-filter').value = Object.hasOwn(MARKET_HOSTS, values['platform-filter']) ? values['platform-filter'] : '';
  $('category-filter').value = Object.hasOwn(CATEGORY_LABELS, values['category-filter']) ? values['category-filter'] : '';
  $('sort-order').value = SORT_ORDERS.includes(values['sort-order']) ? values['sort-order'] : 'margin-desc';
  ['min-price', 'max-price', 'min-margin'].forEach(id => { $(id).value = values[id] !== '' && Number.isFinite(Number(values[id])) && Number(values[id]) >= 0 ? String(values[id]) : ''; });
  $('with-photo-only').checked = values['with-photo-only'] === true;
  $('favorites-only').checked = values['favorites-only'] === true;
}

async function api(path, options = {}) {
  if (radarStopped) throw new Error('LootSniper arrestato. Riaprilo dal collegamento.');
  const response = await fetch(apiBase + path, { ...options, signal: options.signal || AbortSignal.timeout(30000) });
  let payload;
  try { payload = await response.json(); } catch { throw new Error('Risposta del server non valida. Riavvia il server locale.'); }
  if (!response.ok) {
    const error = new Error(payload.error || 'Errore HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }
  return payload;
}
function logMsg(message, type = '') {
  const line = document.createElement('p');
  line.className = type; line.textContent = new Date().toLocaleTimeString('it-IT') + ' · ' + message;
  $('log-box').append(line);
  while ($('log-box').children.length > 100) $('log-box').firstElementChild.remove();
  $('log-box').scrollTop = $('log-box').scrollHeight;
}
function persistResults() { persist('radar-results', bombsArray); }
function setConnection(online) {
  $('connection-status').textContent = online ? 'Server connesso' : 'Server offline';
  $('connection-status').classList.toggle('offline', !online);
  $('offline-help').hidden = online;
}
async function initializeSearches() {
  try {
    const payload = await api('/api/searches');
    if (!Array.isArray(payload.searches) || !payload.revision) throw new Error('Riavvia il server per caricare la nuova versione.');
    serverRevision = payload.revision;
    // Server is authoritative once it contains data; never post an empty browser store on startup.
    if (payload.searches.length) {
      if (savedSearches.length && JSON.stringify(savedSearches) !== JSON.stringify(payload.searches)) persist('radar-searches-local-backup', savedSearches);
      savedSearches = payload.searches;
      persist('radar-searches', savedSearches);
    } else if (savedSearches.length) {
      const result = await api('/api/searches', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searches: savedSearches, revision: serverRevision }) });
      serverRevision = result.revision;
    }
    setConnection(true);
    $('sync-status').textContent = 'Sincronizzato con l’estensione';
  } catch (error) {
    $('sync-status').textContent = 'Ricerche salvate in questo browser';
    logMsg('Ricerche locali disponibili. Sincronizzazione: ' + error.message, 'log-warn');
  }
  renderSavedSearches();
}
function syncSavedSearches() {
  const snapshot = JSON.parse(JSON.stringify(savedSearches));
  saveQueue = saveQueue.then(async () => {
    await initialSync;
    if (!serverRevision) throw new Error('Server non sincronizzato. Ricarica la dashboard quando è online.');
    const result = await api('/api/searches', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searches: snapshot, revision: serverRevision }) });
    serverRevision = result.revision;
    $('sync-status').textContent = 'Sincronizzato con l’estensione';
  }).catch(error => {
    $('sync-status').textContent = 'Salvato solo in questo browser';
    logMsg(error.message, 'log-warn');
  });
}
function renderSavedSearches() {
  $('btn-restore-searches').hidden = !readArray('radar-searches-local-backup').length;
  $('saved-search-list').innerHTML = savedSearches.length ? savedSearches.map((search, index) =>
    '<div class="saved-search"><button class="saved-search-load" data-search="' + index + '" title="Carica ricerca">' + escapeHtml(search.name) +
    '</button><button class="saved-search-run" data-search="' + index + '" aria-label="Avvia ' + escapeHtml(search.name) +
    '">▶</button><button class="saved-search-delete" data-search="' + index + '" aria-label="Elimina ' + escapeHtml(search.name) + '">×</button></div>').join('') :
    '<span class="saved-empty">Salva una ricerca: verrà creato anche il suo file riutilizzabile.</span>';
}
function setLinkMode(mode, announce = false) {
  linkMode = mode === 'manual' ? 'manual' : 'auto';
  $('source-mode-auto').checked = linkMode === 'auto';
  $('source-mode-manual').checked = linkMode === 'manual';
  $('auto-search-panel').hidden = linkMode === 'manual';
  $('source-details').classList.toggle('manual-mode', linkMode === 'manual');
  $('source-details-caption').textContent = linkMode === 'manual' ? 'Incolla i link trovati sui siti' : 'Controlla i link creati dall’app';
  $('source-mode-help').textContent = linkMode === 'manual'
    ? 'Incolla i link di ricerca dei marketplace. Puoi lasciare vuoto un sito che non vuoi controllare.'
    : 'Scrivi cosa cerchi: i link di Vinted, eBay e Subito vengono creati automaticamente.';
  if (linkMode === 'manual') $('source-details').open = true;
  persist('radar-link-mode', linkMode);
  if (announce) logMsg(linkMode === 'manual' ? 'Modalità manuale: incolla i link dei marketplace.' : 'Modalità automatica: scrivi il prodotto e LootSniper preparerà i tre link.', 'log-ok');
}
function loadSavedSearch(search) {
  for (const platform of Object.keys(MARKET_HOSTS)) $('link-' + platform.toLowerCase()).value = search[platform.toLowerCase()] || '';
  $('market-query').value = typeof search.query === 'string' ? search.query : '';
  $('search-name').value = search.name;
  $('search-input').value = typeof search.resultQuery === 'string' ? search.resultQuery : '';
  $('min-price').value = search.minPrice === null || search.minPrice === undefined ? '' : String(search.minPrice);
  $('max-price').value = search.maxPrice === null || search.maxPrice === undefined ? '' : String(search.maxPrice);
  $('min-margin').value = search.minMargin === null || search.minMargin === undefined ? '' : String(search.minMargin);
  $('platform-filter').value = Object.hasOwn(MARKET_HOSTS, search.platformFilter) ? search.platformFilter : '';
  $('category-filter').value = Object.hasOwn(CATEGORY_LABELS, search.categoryFilter) ? search.categoryFilter : '';
  $('sort-order').value = SORT_ORDERS.includes(search.sortOrder) ? search.sortOrder : 'margin-desc';
  $('with-photo-only').checked = search.withPhotoOnly === true;
  $('favorites-only').checked = false;
  $('deep-scan').checked = search.deepScan !== false;
  quickQueryDirty = false; manualPlatforms.clear();
  const customPlatforms = Array.isArray(search.customPlatforms) ? search.customPlatforms : [];
  Object.keys(MARKET_HOSTS).forEach(platform => {
    if (customPlatforms.includes(platform) || (!search.query && search[platform.toLowerCase()])) manualPlatforms.add(platform);
  });
  const savedMode = search.linkMode === 'manual' || (search.linkMode !== 'auto' && manualPlatforms.size) ? 'manual' : 'auto';
  setLinkMode(savedMode);
  updateSourceLinks(); persistFilters(); renderAllCards();
  logMsg('Ricerca “' + search.name + '” caricata.', 'log-ok');
}
function updateSourceLinks() {
  Object.keys(MARKET_HOSTS).forEach(platform => {
    const anchor = $('open-' + platform.toLowerCase());
    const url = safeUrl($('link-' + platform.toLowerCase()).value.trim(), platform);
    anchor.hidden = !url;
    if (url) anchor.href = url; else anchor.removeAttribute('href');
  });
}
function marketplaceSearchUrl(platform, query) {
  const encoded = encodeURIComponent(query);
  if (platform === 'EBAY') return 'https://www.ebay.it/sch/i.html?_nkw=' + encoded;
  if (platform === 'SUBITO') return 'https://www.subito.it/annunci-italia/vendita/usato/?q=' + encoded;
  return 'https://www.vinted.it/catalog?search_text=' + encoded;
}
function prepareQuickQuery(query) {
  const clean = String(query || '').trim().slice(0, 200);
  if (!clean) { $('market-query').focus(); return false; }
  $('market-query').value = clean;
  Object.keys(MARKET_HOSTS).forEach(platform => { $('link-' + platform.toLowerCase()).value = marketplaceSearchUrl(platform, clean); });
  setLinkMode('auto');
  quickQueryDirty = false; manualPlatforms.clear();
  updateSourceLinks();
  logMsg('Ricerca pronta per “' + clean + '”. Puoi precisarla prima di avviarla.', 'log-ok');
  return true;
}
function getSources() {
  const query = $('market-query').value.trim();
  if (linkMode === 'auto' && !query) return [];
  const sources = Object.keys(MARKET_HOSTS).map(platform => {
    const input = $('link-' + platform.toLowerCase());
    const url = linkMode === 'auto' ? marketplaceSearchUrl(platform, query) : input.value.trim();
    input.setCustomValidity('');
    if (url && !safeUrl(url, platform)) {
      input.setCustomValidity('Inserisci un link HTTPS valido di ' + platform);
      input.reportValidity(); throw new Error('Controlla il link ' + platform + '.');
    }
    if (url) input.value = url;
    return { platform, url };
  }).filter(source => source.url);
  quickQueryDirty = false;
  if (linkMode === 'auto') manualPlatforms.clear();
  else { manualPlatforms.clear(); sources.forEach(source => manualPlatforms.add(source.platform)); }
  updateSourceLinks();
  return sources;
}
function optionalProfileNumber(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100000) throw new Error(label + ' deve essere tra 0 e 100000.');
  return number;
}
function searchProfile(entry) {
  const custom = new Set(Array.isArray(entry.customPlatforms) ? entry.customPlatforms : []);
  const marketplaces = {};
  Object.keys(MARKET_HOSTS).forEach(platform => {
    const key = platform.toLowerCase(), url = entry[key] || '';
    marketplaces[key] = !url ? false : custom.has(platform) ? url : true;
  });
  return {
    format: SEARCH_PROFILE_FORMAT,
    version: SEARCH_PROFILE_VERSION,
    _help: 'sourceMode auto: usa true o false. sourceMode manual: incolla un URL HTTPS oppure usa false.',
    name: entry.name,
    query: entry.query || '',
    sourceMode: entry.linkMode === 'manual' ? 'manual' : 'auto',
    marketplaces,
    filters: {
      minPrice: entry.minPrice ?? null,
      maxPrice: entry.maxPrice ?? null,
      minMargin: entry.minMargin ?? null,
      platform: entry.platformFilter || '',
      category: entry.categoryFilter || '',
      withPhoto: entry.withPhotoOnly === true,
      order: entry.sortOrder || 'margin-desc',
      text: entry.resultQuery || ''
    },
    deepScan: entry.deepScan !== false,
    updatedAt: entry.updatedAt
  };
}
function searchProfileFilename(name) {
  const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'ricerca';
  return 'LootSniper-' + slug + '.json';
}
function parseSearchProfile(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== SEARCH_PROFILE_FORMAT) throw new Error('Questo non è un file ricerca LootSniper.');
  if (data.version !== SEARCH_PROFILE_VERSION) throw new Error('Versione del file ricerca non supportata.');
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 80) throw new Error('Il nome deve contenere da 1 a 80 caratteri.');
  if (typeof data.query !== 'string' || data.query.length > 200) throw new Error('La query deve essere un testo di massimo 200 caratteri.');
  if (data.sourceMode !== undefined && !['auto', 'manual'].includes(data.sourceMode)) throw new Error('sourceMode deve essere auto oppure manual.');
  if (!data.marketplaces || typeof data.marketplaces !== 'object' || Array.isArray(data.marketplaces)) throw new Error('Sezione marketplace non valida.');
  const query = data.query.trim(), entry = {name: data.name.trim(), query, vinted: '', ebay: '', subito: '', customPlatforms: []};
  for (const platform of Object.keys(MARKET_HOSTS)) {
    const key = platform.toLowerCase(), choice = data.marketplaces[key];
    if (choice === true) {
      if (!query) throw new Error('Scrivi una query oppure un URL per ' + platform + '.');
      entry[key] = marketplaceSearchUrl(platform, query);
    } else if (choice === false || choice === '' || choice === null || choice === undefined) {
      entry[key] = '';
    } else if (typeof choice === 'string' && safeUrl(choice, platform)) {
      entry[key] = choice.trim(); entry.customPlatforms.push(platform);
    } else {
      throw new Error('Per ' + platform + ' usa true, false oppure un URL HTTPS valido.');
    }
  }
  if (!Object.keys(MARKET_HOSTS).some(platform => entry[platform.toLowerCase()])) throw new Error('Attiva almeno un marketplace.');
  entry.linkMode = data.sourceMode || (entry.customPlatforms.length ? 'manual' : 'auto');
  if (entry.linkMode === 'manual' && !entry.customPlatforms.length) throw new Error('In modalità manuale inserisci almeno un URL completo nei marketplace.');
  if (entry.linkMode === 'auto' && entry.customPlatforms.length) throw new Error('In modalità automatica usa true o false nei marketplace, senza URL manuali.');
  const filters = data.filters === undefined ? {} : data.filters;
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error('Sezione filtri non valida.');
  entry.minPrice = optionalProfileNumber(filters.minPrice, 'Il prezzo minimo');
  entry.maxPrice = optionalProfileNumber(filters.maxPrice, 'Il budget massimo');
  entry.minMargin = optionalProfileNumber(filters.minMargin, 'La differenza minima');
  entry.platformFilter = filters.platform ?? '';
  if (entry.platformFilter !== '' && !Object.hasOwn(MARKET_HOSTS, entry.platformFilter)) throw new Error('Filtro marketplace non valido.');
  entry.categoryFilter = filters.category ?? '';
  if (entry.categoryFilter !== '' && !Object.hasOwn(CATEGORY_LABELS, entry.categoryFilter)) throw new Error('Filtro categoria non valido.');
  if (filters.withPhoto !== undefined && typeof filters.withPhoto !== 'boolean') throw new Error('Filtro foto non valido.');
  entry.withPhotoOnly = filters.withPhoto === true;
  entry.sortOrder = filters.order ?? 'margin-desc';
  if (!SORT_ORDERS.includes(entry.sortOrder)) throw new Error('Ordinamento non valido.');
  entry.resultQuery = filters.text ?? '';
  if (typeof entry.resultQuery !== 'string' || entry.resultQuery.length > 500) throw new Error('Filtro testo non valido.');
  if (data.deepScan !== undefined && typeof data.deepScan !== 'boolean') throw new Error('deepScan deve essere true oppure false.');
  entry.deepScan = data.deepScan !== false;
  entry.updatedAt = new Date().toISOString();
  return entry;
}
function downloadSearchProfile(entry) {
  downloadJson(searchProfile(entry), searchProfileFilename(entry.name));
}
async function importSearchProfile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 256 * 1024) throw new Error('Il file ricerca supera 256 KB.');
    const entry = parseSearchProfile(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
    await initialSync;
    const index = savedSearches.findIndex(search => search.name.toLowerCase() === entry.name.toLowerCase());
    if (index < 0 && savedSearches.length >= 200) throw new Error('Puoi salvare fino a 200 ricerche.');
    if (index >= 0) savedSearches[index] = entry; else savedSearches.unshift(entry);
    persist('radar-searches', savedSearches); renderSavedSearches(); syncSavedSearches(); loadSavedSearch(entry);
    setScanState('File ricerca caricato', 'Controlla i dati e premi Esegui ricerca quando vuoi avviarla.');
    logMsg('File della ricerca “' + entry.name + '” importato.', 'log-ok');
  } catch (error) { logMsg('Importazione ricerca fallita: ' + error.message, 'log-err'); }
  finally { event.target.value = ''; }
}
async function saveSearch() {
  await initialSync;
  const name = $('search-name').value.trim();
  if (!name) { logMsg('Dai un nome alla ricerca.', 'log-warn'); $('search-name').focus(); return; }
  let sources;
  try { sources = getSources(); } catch (error) { logMsg(error.message, 'log-warn'); setScanState('Controlla i link', error.message); return; }
  if (!sources.length) { setScanState('Da dove partiamo?', 'Scrivi cosa cerchi nel campo a sinistra, per esempio laptop RTX 4070.'); logMsg('Inserisci una parola chiave o un link.', 'log-warn'); return; }
  let entry;
  try {
    entry = { name, query: $('market-query').value.trim().slice(0, 200), linkMode, vinted: '', ebay: '', subito: '',
      customPlatforms: linkMode === 'manual' ? sources.map(source => source.platform) : [], minPrice: optionalProfileNumber($('min-price').value, 'Il prezzo minimo'),
      maxPrice: optionalProfileNumber($('max-price').value, 'Il budget massimo'),
      minMargin: optionalProfileNumber($('min-margin').value, 'La differenza minima'), platformFilter: $('platform-filter').value,
      categoryFilter: $('category-filter').value,
      withPhotoOnly: $('with-photo-only').checked,
      sortOrder: SORT_ORDERS.includes($('sort-order').value) ? $('sort-order').value : 'margin-desc',
      resultQuery: $('search-input').value.slice(0, 500), deepScan: $('deep-scan').checked, updatedAt: new Date().toISOString() };
  } catch (error) { logMsg(error.message, 'log-warn'); return; }
  sources.forEach(source => { entry[source.platform.toLowerCase()] = source.url; });
  const index = savedSearches.findIndex(search => search.name.toLowerCase() === name.toLowerCase());
  if (index < 0 && savedSearches.length >= 200) { logMsg('Puoi salvare fino a 200 ricerche.', 'log-warn'); return; }
  if (index >= 0) savedSearches[index] = entry; else savedSearches.unshift(entry);
  persist('radar-searches', savedSearches); renderSavedSearches(); syncSavedSearches();
  downloadSearchProfile(entry);
  logMsg('Ricerca “' + name + '” salvata. Il file modificabile è stato scaricato.', 'log-ok');
}
function resultCategory(item) {
  if (item.evalData.kind !== 'generic') return 'gaming';
  return { 'Componente PC': 'component', NAS: 'nas', 'Router / rete': 'network', Server: 'server', Smartphone: 'smartphone' }[item.evalData.gpuName] || 'other';
}
function updatePlatformFilterCounts() {
  const select = $('platform-filter');
  const selected = Object.hasOwn(PLATFORM_LABELS, select.value) ? select.value : '';
  const counts = Object.fromEntries(Object.keys(PLATFORM_LABELS).map(platform => [platform, 0]));
  bombsArray.forEach(item => { if (Object.hasOwn(counts, item.platform)) counts[item.platform] += 1; });
  select.innerHTML = '<option value="">Tutti (' + bombsArray.length + ')</option>' +
    Object.entries(PLATFORM_LABELS).map(([platform, label]) => '<option value="' + platform + '">' +
      label + ' (' + counts[platform] + ')</option>').join('');
  select.value = selected;
}
function updateCategoryFilterCounts() {
  const select = $('category-filter');
  const selected = Object.hasOwn(CATEGORY_LABELS, select.value) ? select.value : '';
  const counts = Object.fromEntries(Object.keys(CATEGORY_LABELS).map(category => [category, 0]));
  bombsArray.forEach(item => { counts[resultCategory(item)] += 1; });
  select.innerHTML = '<option value="">Tutte (' + bombsArray.length + ')</option>' +
    Object.entries(CATEGORY_LABELS).map(([category, label]) => '<option value="' + category + '">' +
      escapeHtml(label) + ' (' + counts[category] + ')</option>').join('');
  select.value = selected;
}
function priceRangeError() {
  const minimum = $('min-price'), maximum = $('max-price');
  const invalid = minimum.value !== '' && maximum.value !== '' && Number(minimum.value) > Number(maximum.value);
  const message = invalid ? 'Il prezzo minimo non può superare il prezzo massimo.' : '';
  minimum.setCustomValidity(message); maximum.setCustomValidity(message);
  minimum.setAttribute('aria-invalid', String(invalid)); maximum.setAttribute('aria-invalid', String(invalid));
  return message;
}
function filteredItems() {
  if (priceRangeError()) return [];
  const query = normalizeListingText($('search-input').value);
  const minPrice = Number($('min-price').value) || 0;
  const maxPrice = Number($('max-price').value) || Infinity;
  const minMargin = $('min-margin').value === '' ? -Infinity : Number($('min-margin').value);
  const items = bombsArray.filter(item => (!$('platform-filter').value || item.platform === $('platform-filter').value)
    && (!$('category-filter').value || resultCategory(item) === $('category-filter').value)
    && (!$('with-photo-only').checked || Boolean(item.image))
    && (!$('favorites-only').checked || favorites.has(item.url))
    && item.prezzo >= minPrice && item.prezzo <= maxPrice && item.evalData.margine >= minMargin
    && normalizeListingText(item.titolo + ' ' + item.evalData.gpuName + ' ' + item.details).includes(query));
  const sort = $('sort-order').value;
  items.sort((a, b) => sort === 'price-asc' ? a.prezzo - b.prezzo : sort === 'price-desc' ? b.prezzo - a.prezzo
    : sort === 'vs-desc' ? b.evalData.vsScore - a.evalData.vsScore : sort === 'newest' ? b.updatedAt - a.updatedAt
    : b.evalData.margine - a.evalData.margine);
  return items;
}
function applyResultView(view = resultView) {
  resultView = view === 'grid' ? 'grid' : 'list';
  $('results-grid').dataset.view = resultView;
  $('btn-view-list').setAttribute('aria-pressed', String(resultView === 'list'));
  $('btn-view-grid').setAttribute('aria-pressed', String(resultView === 'grid'));
  persist('radar-result-view', resultView);
}
function renderActiveFilters() {
  const entries = [];
  const resultQuery = $('search-input').value.trim();
  const platform = $('platform-filter').value;
  const category = $('category-filter').value;
  if (resultQuery) entries.push(['search-input', 'Testo: “' + resultQuery.slice(0, 60) + '”']);
  if (platform) entries.push(['platform-filter', 'Marketplace: ' + (platform === 'EBAY' ? 'eBay' : platform[0] + platform.slice(1).toLowerCase())]);
  if (category) entries.push(['category-filter', 'Categoria: ' + CATEGORY_LABELS[category]]);
  if ($('min-price').value !== '') entries.push(['min-price', 'Da ' + $('min-price').value + ' €']);
  if ($('max-price').value !== '') entries.push(['max-price', 'Fino a ' + $('max-price').value + ' €']);
  if ($('min-margin').value !== '') entries.push(['min-margin', 'Risparmio da ' + $('min-margin').value + ' €']);
  if ($('with-photo-only').checked) entries.push(['with-photo-only', 'Solo con foto']);
  if ($('favorites-only').checked) entries.push(['favorites-only', 'Solo preferiti']);
  $('active-filters').hidden = !entries.length;
  $('active-filters').innerHTML = entries.length ? '<span>Filtri attivi</span>' + entries.map(([id, label]) =>
    '<button type="button" data-clear-filter="' + id + '" aria-label="Rimuovi filtro ' + escapeHtml(label) + '">' + escapeHtml(label) + ' <b aria-hidden="true">×</b></button>').join('') : '';
}
function clearActiveFilter(id) {
  if (!['search-input', 'platform-filter', 'category-filter', 'min-price', 'max-price', 'min-margin', 'with-photo-only', 'favorites-only'].includes(id)) return false;
  if (CHECKBOX_FILTERS.has(id)) $(id).checked = false; else $(id).value = '';
  renderedLimit = 60; persistFilters(); renderAllCards();
  const nextFilter = $('active-filters').querySelector?.('button');
  (nextFilter || $('results-count')).focus({ preventScroll: true });
  return true;
}
function renderAllCards() {
  const focusedUrl = document.activeElement?.dataset?.url;
  updatePlatformFilterCounts();
  updateCategoryFilterCounts();
  const rangeError = priceRangeError();
  const items = filteredItems();
  selectedForVersus = selectedForVersus.filter(url => bombsArray.some(item => item.url === url));
  const emptyTitle = rangeError
    ? 'Controlla la fascia di prezzo'
    : bombsArray.length
      ? 'Nessun risultato con questi filtri'
      : 'La tua prossima scoperta parte da qui';
  const emptyText = rangeError || (bombsArray.length
    ? 'Prova a cambiare il budget o a rimuovere un filtro.'
    : 'Cerca un NAS, un router, un portatile o un altro prodotto tecnologico; puoi anche importare gli annunci con l’estensione.');
  const emptyAction = bombsArray.length ? 'reset' : 'guide';
  const emptyLabel = bombsArray.length ? 'Azzera i filtri' : 'Prepara la prima ricerca';
  $('results-grid').innerHTML = items.length ? items.slice(0, renderedLimit).map(cardTemplate).join('') :
    '<div class="empty" role="status"><span class="empty-icon" aria-hidden="true">◎</span><h2>' + emptyTitle +
    '</h2><p>' + emptyText + '</p><button class="primary" data-empty-action="' + emptyAction + '">' + emptyLabel + '</button></div>';
  $('count-bombs').textContent = bombsArray.length;
  $('count-scanned').textContent = totalAnalyzed;
  $('count-favorites').textContent = bombsArray.filter(item => favorites.has(item.url)).length;
  $('results-count').textContent = items.length + ' risultati' + (items.length > renderedLimit ? ' · primi ' + renderedLimit + ' mostrati' : '');
  renderActiveFilters();
  const marketQuery = $('market-query').value.trim();
  $('results-title').textContent = marketQuery ? 'Risultati per “' + marketQuery.slice(0, 80) + '”' : bombsArray.length ? 'Annunci nel radar' : 'Trova il tuo prossimo acquisto';
  $('btn-more').hidden = items.length <= renderedLimit;
  $('btn-undo').hidden = !undoArchive;
  $('btn-export').disabled = !bombsArray.length;
  if (focusedUrl) {
    const replacement = [...$('results-grid').querySelectorAll('[data-action="favorite"]')].find(button => button.dataset.url === focusedUrl);
    (replacement || $('results-count')).focus({ preventScroll: true });
  }
  updateCompareBar();
}
function cardTemplate(item) {
  const data = item.evalData, saved = favorites.has(item.url);
  const generic = data.kind === 'generic';
  const history = item.priceHistory || [];
  const previousPrice = history.length > 1 ? history[history.length - 2].price : null;
  const change = previousPrice === null ? 0 : item.prezzo - previousPrice;
  const trend = change ? '<span class="price-trend ' + (change < 0 ? 'price-drop' : 'price-rise') + '">' +
    (change < 0 ? '↓ ' : '↑ ') + euros.format(Math.abs(change)) + ' dall’ultimo prezzo</span>' : '';
  const historyMarkup = history.length > 1 ? '<details class="price-history"><summary>Storico prezzi · ' + history.length +
    ' rilevazioni</summary><ol>' + [...history].reverse().map(point => '<li><time>' + new Date(point.at).toLocaleDateString('it-IT') +
    '</time><span>' + euros.format(point.price) + '</span></li>').join('') + '</ol></details>' : '';
  const reason = explainListing(item);
  const reasonMarkup = '<div class="deal-reason"><strong>Perché è nel radar</strong><p>' +
    (generic ? 'Corrisponde alla ricerca corrente: confronta prezzo, modello e condizioni con gli altri annunci.' :
    reason.difference > 0 ? euros.format(reason.difference) + ' sotto la stima indicativa.' : 'Il prezzo attuale non è sotto la stima indicativa.') +
    '</p>' + (reason.facts.length ? '<p>Nel testo: ' + reason.facts.map(escapeHtml).join(' · ') + '.</p>' : '') +
    (reason.warnings.length ? '<p class="deal-warning">Attenzione: ' + reason.warnings.map(escapeHtml).join(', ') + '.</p>' : '') +
    '<details><summary>Cosa verificare prima di comprare</summary><ul>' +
    reason.missing.map(label => '<li>' + escapeHtml(label) + ': da verificare nell’annuncio.</li>').join('') +
    (generic ? '<li>Compatibilità, condizioni e garanzia.</li>' : '<li>Condizioni, batteria e configurazione esatta.</li>') +
    '<li>Venditore, spedizione e commissioni.</li></ul></details></div>';
  const listingUrl = escapeHtml(item.url);
  const openLabel = escapeHtml('Apri annuncio: ' + item.titolo);
  const preview = item.image ? '<img src="' + escapeHtml(item.image) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '<span class="image-placeholder" aria-hidden="true">▧</span><span>Nessuna immagine</span>';
  const details = item.details ? escapeHtml(item.details.slice(0, 280)) : 'Specifiche non riportate: controlla la descrizione originale.';
  return '<article class="card" aria-label="' + escapeHtml(item.titolo + ' · ' + item.platform + ' · ' + euros.format(item.prezzo)) + '"><div class="card-image' + (item.image ? '' : ' card-image-empty') + '"><a class="card-image-link" href="' + listingUrl + '" target="_blank" rel="noopener noreferrer" aria-label="' + openLabel + '">' + preview + '</a><button class="favorite" data-action="favorite" data-url="' +
    listingUrl + '" aria-pressed="' + saved + '" aria-label="' + (saved ? 'Rimuovi dai preferiti' : 'Salva preferito') + '">' +
    (saved ? '★' : '☆') + '</button></div><div class="card-head card-info"><div class="listing-kicker"><span class="platform ' + item.platform.toLowerCase() + '">' + item.platform +
    '</span><span>' + (generic ? 'Prodotto da confrontare' : 'Occasione rilevata') + '</span></div><h2 class="card-title"><a class="card-title-link" href="' + listingUrl + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.titolo) + '</a></h2><p class="listing-details">' + details + '</p><div class="tags">' +
    data.tags.map(tag => '<span class="tag ' + tag.cls + '">' + escapeHtml(tag.text) + '</span>').join('') + '</div>' +
    (generic ? '<div class="power"><span>Valutazione manuale</span></div>' : '<div class="power"><span>Indice hardware ' + data.vsScore +
    '/100</span><span class="power-bar"><i style="width:' + data.vsScore + '%"></i></span></div>') + reasonMarkup +
    '</div><div class="card-body card-offer"><div class="prices"><div><span class="price-label">Prezzo annuncio</span><strong class="ask-price">' + euros.format(item.prezzo) +
    '</strong></div><div class="estimate">' + (generic ? '<span>Valutazione</span><strong>Da verificare</strong><span class="saving">Confronta i prezzi</span>' : '<span>Stima indicativa</span><strong>' + euros.format(data.stima) +
    '</strong><span class="saving">Possibile differenza ' + euros.format(data.margine) + '</span>') +
    '</div></div>' + trend + historyMarkup + '<div class="card-meta"><p class="card-note">Spedizione e commissioni da verificare.</p><time class="card-note" datetime="' +
    new Date(item.updatedAt).toISOString() + '">Aggiornato ' + new Date(item.updatedAt).toLocaleDateString('it-IT') +
    '</time></div><div class="card-foot"><label class="compare-label"><input class="compare-check" type="checkbox" data-url="' +
    escapeHtml(item.url) + '" ' + (selectedForVersus.includes(item.url) ? 'checked' : '') + '> Confronta</label><a href="' +
    listingUrl + '" target="_blank" rel="noopener noreferrer">Vedi l’annuncio ↗</a></div></div></article>';
}
function updateCompareBar() {
  $('compare-bar').classList.toggle('active', selectedForVersus.length > 0);
  $('compare-bar').inert = !selectedForVersus.length;
  $('compare-text').textContent = selectedForVersus.length + ' / 3 selezionati';
  $('btn-versus').disabled = selectedForVersus.length < 2;
}
function showComparison() {
  const items = selectedForVersus.map(url => bombsArray.find(item => item.url === url)).filter(Boolean);
  if (items.length < 2) return;
  const rows = [['Prezzo annuncio', item => euros.format(item.prezzo)], ['Tipo / componente', item => item.evalData.gpuName],
    ['Dati rilevati', item => item.evalData.tags.filter(tag => tag.text !== 'Prezzo da confrontare').map(tag => tag.text).join(' · ') || 'Da verificare'],
    ['Valutazione', item => item.evalData.kind === 'generic' ? 'Confronto manuale' : item.evalData.vsScore + '/100'],
    ['Stima indicativa', item => item.evalData.kind === 'generic' ? 'Non disponibile' : euros.format(item.evalData.stima)],
    ['Possibile differenza', item => item.evalData.kind === 'generic' ? 'Da confrontare' : euros.format(item.evalData.margine)], ['Marketplace', item => item.platform]];
  $('comparison-content').innerHTML = '<table><caption>Confronto degli annunci selezionati</caption><thead><tr><th scope="col">Caratteristica</th>' +
    items.map(item => '<th scope="col"><a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener noreferrer">' +
    escapeHtml(item.titolo) + ' ↗</a></th>').join('') + '</tr></thead><tbody>' + rows.map(([label, value]) =>
    '<tr><th scope="row">' + label + '</th>' + items.map(item => '<td>' + escapeHtml(value(item)) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>';
  $('comparison-dialog').showModal();
}
function upsertListing(item) {
  const url = canonicalUrl(item.url, item.platform);
  if (!url || !item.title) return false;
  const price = parseMoney(item.price);
  const listingText = item.title + ' ' + (item.details || '');
  if (/\b(custodia|cover|scatola vuota|solo scatola|cerco|compro|alimentatore per|caricabatterie per)\b/i.test(listingText)) return false;
  const generic = analyzeGenericFeatures(listingText);
  const evaluation = price && (analyzeHardware(listingText, price) || {
    stima: price, margine: 0, gpuName: generic.category, vsScore: 0, confidence: 0, kind: 'generic',
    tags: [{ text: 'Prezzo da confrontare', cls: 't-neutral' }, ...generic.tags]
  });
  if (!evaluation) return false;
  const previous = bombsArray.find(result => result.url === url);
  if (!previous && evaluation.kind !== 'generic' && price > evaluation.stima * .95) return false;
  if (previous && item.updatedAt && Number(item.updatedAt) <= previous.updatedAt) return false;
  const updatedAt = Number(item.updatedAt) || Date.now();
  const priceHistory = previous?.priceHistory?.length ? [...previous.priceHistory] :
    previous ? [{ price: previous.prezzo, at: previous.updatedAt }] : [];
  if (!priceHistory.length || priceHistory[priceHistory.length - 1].price !== price) priceHistory.push({ price, at: updatedAt });
  const result = cleanResult({ titolo: item.title, prezzo: price, evalData: evaluation, platform: item.platform, url,
    image: item.image, details: item.details, firstSeen: previous?.firstSeen || Date.now(), updatedAt, priceHistory });
  if (!result) return false;
  if (previous) Object.assign(previous, result); else bombsArray.push(result);
  if (!previous && typeof notifyOpportunity === 'function') notifyOpportunity(result);
  return true;
}
async function importBrowserListings() {
  if (radarStopped || importing || scanController || document.hidden) return;
  importing = true;
  try {
    const payload = await api('/api/import/latest?after=' + importCursor, { signal: AbortSignal.timeout(8000) });
    if (radarStopped) return;
    setConnection(true);
    lastImportError = '';
    let changed = 0, analyzed = 0;
    for (const item of payload.items || []) {
      const key = canonicalUrl(item.url, item.platform);
      const version = String(item.updatedAt || item.price);
      if (!key || importVersions.get(key) === version || ignoredImports[key] === version) continue;
      importVersions.set(key, version); totalAnalyzed++; analyzed++;
      changed += Number(upsertListing(item));
    }
    importCursor = Number(payload.cursor) || 0;
    if (analyzed) renderAllCards();
    if (changed) { persistResults(); logMsg(changed + ' annunci importati o aggiornati dal browser.', 'log-ok'); }
  } catch (error) {
    if (radarStopped) return;
    setConnection(!!error.status);
    if (error.status && lastImportError !== error.message) logMsg('Importazione: ' + error.message, 'log-err');
    lastImportError = error.message;
  }
  finally { importing = false; }
}
function extractListings(doc, source) { return RadarListings.collect(doc, source); }
function setScanState(title, body, help = false) {
  $('scan-feedback').hidden = false;
  $('scan-feedback-title').textContent = title;
  $('scan-feedback-body').textContent = body;
  $('btn-scan-help').hidden = !help;
}
async function runScan() {
  if (radarStopped || scanController) return;
  let sources;
  try { sources = getSources(); } catch (error) { logMsg(error.message, 'log-warn'); setScanState('Controlla i link', error.message); return; }
  if (!sources.length) { setScanState('Da dove partiamo?', 'Scrivi cosa cerchi nel campo a sinistra, per esempio NAS Synology o laptop RTX 4070.'); logMsg('Inserisci una parola chiave o almeno un link.', 'log-warn'); $('market-query').focus(); return; }
  resetRadarResults();
  try {
    const previousImports = await api('/api/import/latest?after=0', { signal: AbortSignal.timeout(8000) });
    importCursor = Number(previousImports.cursor) || 0;
  } catch { /* La ricerca diretta può proseguire anche senza l’estensione. */ }
  logMsg('Nuova ricerca: il radar precedente è stato azzerato.', 'log-ok');
  scanController = new AbortController();
  const signal = scanController.signal;
  $('btn-scan').disabled = true; $('btn-scan').classList.add('loading'); $('btn-stop').hidden = false;
  $('btn-text').textContent = 'Ricerca in corso…'; $('scan-progress').hidden = false; $('btn-clear').disabled = true;
  $('results-grid').setAttribute('aria-busy', 'true');
  const processed = new Set();
  const deepScan = $('deep-scan').checked;
  let errors = 0, changed = 0, unreadable = 0;
  try {
    for (const source of sources) {
      for (let page = 1; page <= (deepScan ? 20 : 1); page++) {
        if (signal.aborted) break;
        const status = source.platform + ' · pagina ' + page;
        $('scan-status').textContent = status;
        setScanState('Sto cercando le opportunità', status + ' · Puoi interrompere senza perdere i risultati.');
        logMsg('Controllo ' + status, 'log-deep');
        try {
          const url = pageUrl(source.url, source.platform, page);
          const payload = await api('/api/fetch?url=' + encodeURIComponent(url), { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
          const doc = new DOMParser().parseFromString(payload.html, 'text/html');
          const items = extractListings(doc, { ...source, url });
          let newItems = 0;
          for (const item of items) {
            if (processed.has(item.url)) continue;
            processed.add(item.url); totalAnalyzed++; newItems++;
            changed += Number(upsertListing(item));
          }
          persistResults(); renderAllCards();
          if (!items.length) unreadable++;
          if (!items.length) logMsg(source.platform + ': nessun annuncio leggibile. Puoi usare l’estensione sulla pagina aperta.', 'log-warn');
          if (!newItems || !payload.hasNext) break;
        } catch (error) {
          if (signal.aborted) break;
          errors++; logMsg(source.platform + ': ' + error.message, 'log-err'); break;
        }
      }
      if (signal.aborted) break;
    }
    setScanState(signal.aborted ? 'Ricerca interrotta' : errors || unreadable ? 'Ricerca completata con alcune fonti da verificare' : 'Ricerca completata',
      changed + ' annunci aggiunti o aggiornati. ' + (errors || unreadable ? 'Alcune pagine non sono accessibili o leggibili: apri la ricerca nel browser e usa l’estensione.' : processed.size ? 'Se non vedi annunci, prova ad allargare i filtri. Vengono salvate le opportunità sotto la stima indicativa.' : 'Nessun annuncio trovato. Prova una parola chiave più generica.'), !!(errors || unreadable));
    logMsg(signal.aborted ? 'Ricerca interrotta. I risultati raccolti sono salvati.' :
      'Ricerca terminata: ' + changed + ' annunci aggiunti o aggiornati' + (errors ? ', ' + errors + ' fonti non raggiungibili.' : '.'), errors ? 'log-warn' : 'log-ok');
  } finally {
    persistResults(); scanController = null; $('btn-scan').disabled = radarStopped; $('btn-clear').disabled = false;
    $('btn-scan').classList.remove('loading'); $('btn-text').textContent = 'Esegui ricerca';
    $('btn-stop').hidden = true; $('scan-progress').hidden = true; $('results-grid').setAttribute('aria-busy', 'false');
    if (bombsArray.length && bombsArray.every(item => item.evalData.kind === 'generic') && $('sort-order').value === 'margin-desc') {
      $('sort-order').value = 'price-asc'; persistFilters();
    }
    renderAllCards(); importBrowserListings();
  }
}
function downloadJson(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportData() {
  downloadJson({ version: 1, exportedAt: new Date().toISOString(), results: bombsArray, favorites: [...favorites], searches: savedSearches }, 'radar-backup-' + new Date().toISOString().slice(0, 10) + '.json');
}
async function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('Il backup supera 10 MB.');
    const data = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
    if (!data || typeof data !== 'object') throw new Error('File LootSniper non valido.');
    if (!Array.isArray(data) && data?.version !== undefined && data.version !== 1) throw new Error('Versione del backup non supportata.');
    if (data.format === 'radar-listings') {
      if (data.version !== 1 || !Array.isArray(data.items) || data.items.length > 5000) throw new Error('Esportazione annunci non valida.');
      const items = data.items.filter(item => item && typeof item.title === 'string' && typeof item.details === 'string' &&
        safeUrl(item.url, item.platform) && Object.hasOwn(MARKET_HOSTS, item.platform) && parseMoney(item.price));
      if (data.items.length && !items.length) throw new Error('Nessun annuncio valido nel file.');
      let changed = 0;
      for (const item of items) { totalAnalyzed++; changed += Number(upsertListing(item)); }
      persistResults(); renderAllCards();
      logMsg(items.length + ' annunci analizzati; ' + changed + ' risultati aggiunti o aggiornati. I prodotti generici restano disponibili per il confronto manuale.', 'log-ok');
      return;
    }
    const rows = Array.isArray(data) ? data : data.results;
    if (!Array.isArray(rows)) throw new Error('Questo file non è un backup LootSniper.');
    const clean = rows.map(cleanResult).filter(Boolean);
    if (rows.length && !clean.length) throw new Error('Nessun annuncio valido nel file.');
    const combined = new Map(bombsArray.map(item => [item.url, item]));
    clean.forEach(item => combined.set(item.url, item)); bombsArray = [...combined.values()];
    if (Array.isArray(data.favorites)) data.favorites.filter(url => combined.has(url)).forEach(url => favorites.add(url));
    if (Array.isArray(data.searches)) {
      await initialSync;
      const known = new Set(savedSearches.map(item => item.name.toLowerCase()));
      for (const search of data.searches) {
        if (!search || typeof search.name !== 'string' || !search.name.trim() || search.name.length > 80 || known.has(search.name.toLowerCase()) || savedSearches.length >= 200) continue;
        if (!Object.keys(MARKET_HOSTS).some(platform => safeUrl(search[platform.toLowerCase()], platform))) continue;
        const entry = { name: search.name, updatedAt: new Date().toISOString() };
        Object.keys(MARKET_HOSTS).forEach(platform => { entry[platform.toLowerCase()] = safeUrl(search[platform.toLowerCase()], platform); });
        savedSearches.push(entry); known.add(entry.name.toLowerCase());
      }
      persist('radar-searches', savedSearches); renderSavedSearches(); syncSavedSearches();
    }
    persistResults(); persist('radar-favorites', [...favorites]); renderAllCards();
    logMsg(clean.length + ' annunci letti dal backup; duplicati uniti.', 'log-ok');
  } catch (error) { logMsg('Importazione fallita: ' + error.message, 'log-err'); }
  finally { event.target.value = ''; }
}
$('saved-search-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-search]');
  if (!button) return;
  await initialSync;
  const index = Number(button.dataset.search), search = savedSearches[index];
  if (!search) return;
  if (button.classList.contains('saved-search-delete')) {
    persist('radar-searches-local-backup', savedSearches);
    savedSearches.splice(index, 1); persist('radar-searches', savedSearches); syncSavedSearches(); renderSavedSearches();
  } else { loadSavedSearch(search); if (button.classList.contains('saved-search-run')) runScan(); }
});
$('results-grid').addEventListener('click', event => {
  const button = event.target.closest('[data-action="favorite"]');
  if (!button) return;
  const url = button.dataset.url; favorites.has(url) ? favorites.delete(url) : favorites.add(url);
  persist('radar-favorites', [...favorites]); renderAllCards();
});
$('results-grid').addEventListener('change', event => {
  if (!event.target.matches('.compare-check')) return;
  const input = event.target;
  if (input.checked && selectedForVersus.length >= 3) { input.checked = false; logMsg('Puoi confrontare fino a 3 annunci alla volta.', 'log-warn'); return; }
  selectedForVersus = input.checked ? [...selectedForVersus, input.dataset.url] : selectedForVersus.filter(url => url !== input.dataset.url);
  updateCompareBar();
});
$('results-grid').addEventListener('error', event => {
  if (event.target.tagName === 'IMG') { event.target.parentElement.textContent = 'Anteprima non disponibile'; }
}, true);
$('btn-clear').addEventListener('click', () => {
  if (!bombsArray.length) return;
  undoArchive = { results: bombsArray, favorites: [...favorites], ignored: { ...ignoredImports } };
  if (!persist('radar-undo', undoArchive)) { undoArchive = null; return; }
  importVersions.forEach((version, url) => { ignoredImports[url] = version; });
  persist('radar-ignored-imports', ignoredImports);
  bombsArray = []; selectedForVersus = []; totalAnalyzed = 0;
  persistResults(); renderAllCards(); logMsg('Archivio svuotato. Puoi ripristinarlo con “Annulla svuotamento”.', 'log-warn');
});
$('btn-undo').addEventListener('click', () => {
  if (!undoArchive) return;
  const restored = new Map(bombsArray.map(item => [item.url, item]));
  undoArchive.results.map(cleanResult).filter(Boolean).forEach(item => restored.set(item.url, item));
  bombsArray = [...restored.values()]; undoArchive.favorites.forEach(url => favorites.add(url));
  ignoredImports = undoArchive.ignored || {}; persist('radar-ignored-imports', ignoredImports);
  undoArchive = null; persist('radar-undo', null); persistResults(); persist('radar-favorites', [...favorites]); renderAllCards();
});
$('btn-scan').addEventListener('click', runScan);
$('btn-stop').addEventListener('click', () => scanController?.abort());
$('btn-export').addEventListener('click', exportData);
$('btn-backup').addEventListener('click', exportData);
$('backup-file').addEventListener('change', importBackup);
$('btn-import-backup').addEventListener('click', () => $('backup-file').click());
$('search-profile-file').addEventListener('change', importSearchProfile);
$('btn-import-search').addEventListener('click', () => $('search-profile-file').click());
$('btn-versus').addEventListener('click', showComparison);
$('btn-close-comparison').addEventListener('click', () => $('comparison-dialog').close());
$('btn-clear-comparison').addEventListener('click', () => { selectedForVersus = []; renderAllCards(); });
$('btn-save-search').addEventListener('click', saveSearch);
$('btn-restore-searches').addEventListener('click', async () => {
  await initialSync;
  const backup = readArray('radar-searches-local-backup');
  let recovered = 0;
  for (const search of backup) {
    if (!search || typeof search.name !== 'string' || !search.name.trim() || savedSearches.length >= 200) continue;
    const links = Object.keys(MARKET_HOSTS).map(platform => safeUrl(search[platform.toLowerCase()], platform));
    if (!links.some(Boolean)) continue;
    if (savedSearches.some(item => Object.keys(MARKET_HOSTS).every((platform, i) => (item[platform.toLowerCase()] || '') === links[i]))) continue;
    let name = search.name.trim().slice(0, 60), suffix = 1;
    while (savedSearches.some(item => item.name.toLowerCase() === name.toLowerCase())) name = search.name.trim().slice(0, 60) + ' (recuperata ' + suffix++ + ')';
    const entry = { name, updatedAt: new Date().toISOString() };
    Object.keys(MARKET_HOSTS).forEach((platform, i) => { entry[platform.toLowerCase()] = links[i]; });
    savedSearches.push(entry); recovered++;
  }
  if (recovered) { persist('radar-searches', savedSearches); renderSavedSearches(); syncSavedSearches(); }
  logMsg(recovered + ' ricerche recuperate dalla copia locale.', 'log-ok');
});
$('search-name').addEventListener('keydown', event => { if (event.key === 'Enter') saveSearch(); });
$('market-query').addEventListener('keydown', event => { if (event.key === 'Enter') runScan(); });
$('market-query').addEventListener('input', () => { quickQueryDirty = true; manualPlatforms.clear(); });
$('source-mode-auto').addEventListener('change', () => { if ($('source-mode-auto').checked) setLinkMode('auto', true); });
$('source-mode-manual').addEventListener('change', () => { if ($('source-mode-manual').checked) setLinkMode('manual', true); });
$('quick-searches').addEventListener('click', event => {
  const query = event.target && event.target.dataset ? event.target.dataset.query : '';
  if (query) prepareQuickQuery(query);
});
Object.keys(MARKET_HOSTS).forEach(platform => $('link-' + platform.toLowerCase()).addEventListener('input', () => {
  setLinkMode('manual'); manualPlatforms.add(platform); $('link-' + platform.toLowerCase()).setCustomValidity('');
  updateSourceLinks();
}));
$('btn-generate-links').addEventListener('click', () => {
  const query = $('market-query').value.trim();
  prepareQuickQuery(query);
});
FILTER_IDS.forEach(id => {
  $(id).addEventListener('input', () => { renderedLimit = 60; persistFilters(); renderAllCards(); });
});
$('btn-reset-filters').addEventListener('click', () => {
  ['search-input', 'platform-filter', 'category-filter', 'min-price', 'max-price', 'min-margin'].forEach(id => { $(id).value = ''; });
  CHECKBOX_FILTERS.forEach(id => { $(id).checked = false; }); persistFilters(); renderAllCards();
});
$('active-filters').addEventListener('click', event => {
  const button = event.target?.closest?.('[data-clear-filter]');
  if (button) clearActiveFilter(button.dataset.clearFilter);
});
$('btn-more').addEventListener('click', () => { renderedLimit += 60; renderAllCards(); });
$('btn-view-list').addEventListener('click', () => applyResultView('list'));
$('btn-view-grid').addEventListener('click', () => applyResultView('grid'));
document.addEventListener('visibilitychange', () => { if (!document.hidden) importBrowserListings(); });
async function initializeApp() {
  try { await initializeSession(); }
  catch (error) { logMsg(error.message, 'log-warn'); }
  restoreFilters(); setLinkMode(linkMode); applyResultView(); renderAllCards(); renderSavedSearches();
  if (storageWarning) logMsg('Un archivio locale non è leggibile. Il dato originale è stato conservato.', 'log-warn');
  await initializeSearches();
}
initialSync = initializeApp();
setInterval(importBrowserListings, 5000);
initialSync.finally(importBrowserListings);
