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
const manualPlatforms = new Set();
const FILTER_IDS = ['search-input', 'platform-filter', 'sort-order', 'max-price', 'min-margin', 'favorites-only'];
function persistFilters() {
  const values = Object.fromEntries(FILTER_IDS.map(id => [id, id === 'favorites-only' ? $(id).checked : $(id).value]));
  persist('radar-filters', values);
}
function restoreFilters() {
  const values = readStorage('radar-filters', {});
  if (!values || typeof values !== 'object' || Array.isArray(values)) return;
  $('search-input').value = typeof values['search-input'] === 'string' ? values['search-input'].slice(0, 500) : '';
  $('platform-filter').value = Object.hasOwn(MARKET_HOSTS, values['platform-filter']) ? values['platform-filter'] : '';
  $('sort-order').value = ['margin-desc', 'price-asc', 'price-desc', 'vs-desc', 'newest'].includes(values['sort-order']) ? values['sort-order'] : 'margin-desc';
  ['max-price', 'min-margin'].forEach(id => { $(id).value = values[id] !== '' && Number.isFinite(Number(values[id])) && Number(values[id]) >= 0 ? String(values[id]) : ''; });
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
    '<span class="saved-empty">Salva una ricerca per ritrovarla qui.</span>';
}
function loadSavedSearch(search) {
  for (const platform of Object.keys(MARKET_HOSTS)) $('link-' + platform.toLowerCase()).value = search[platform.toLowerCase()] || '';
  $('market-query').value = ''; $('search-name').value = search.name;
  quickQueryDirty = false; manualPlatforms.clear(); updateSourceLinks();
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
function getSources() {
  const query = $('market-query').value.trim();
  const sources = Object.keys(MARKET_HOSTS).map(platform => {
    const input = $('link-' + platform.toLowerCase());
    const url = quickQueryDirty && query && !manualPlatforms.has(platform) ? marketplaceSearchUrl(platform, query) :
      input.value.trim() || (query ? marketplaceSearchUrl(platform, query) : '');
    input.setCustomValidity('');
    if (url && !safeUrl(url, platform)) {
      input.setCustomValidity('Inserisci un link HTTPS valido di ' + platform);
      input.reportValidity(); throw new Error('Controlla il link ' + platform + '.');
    }
    if (url) input.value = url;
    return { platform, url };
  }).filter(source => source.url);
  quickQueryDirty = false;
  updateSourceLinks();
  return sources;
}
async function saveSearch() {
  await initialSync;
  const name = $('search-name').value.trim();
  if (!name) { logMsg('Dai un nome alla ricerca.', 'log-warn'); $('search-name').focus(); return; }
  let sources;
  try { sources = getSources(); } catch (error) { logMsg(error.message, 'log-warn'); setScanState('Controlla i link', error.message); return; }
  if (!sources.length) { setScanState('Da dove partiamo?', 'Scrivi cosa cerchi nel campo a sinistra, per esempio laptop RTX 4070.'); logMsg('Inserisci una parola chiave o un link.', 'log-warn'); return; }
  const entry = { name, vinted: '', ebay: '', subito: '', updatedAt: new Date().toISOString() };
  sources.forEach(source => { entry[source.platform.toLowerCase()] = source.url; });
  const index = savedSearches.findIndex(search => search.name.toLowerCase() === name.toLowerCase());
  if (index < 0 && savedSearches.length >= 200) { logMsg('Puoi salvare fino a 200 ricerche.', 'log-warn'); return; }
  if (index >= 0) savedSearches[index] = entry; else savedSearches.unshift(entry);
  persist('radar-searches', savedSearches); renderSavedSearches(); syncSavedSearches();
  logMsg('Ricerca “' + name + '” salvata.', 'log-ok');
}
function filteredItems() {
  const query = normalizeListingText($('search-input').value);
  const maxPrice = Number($('max-price').value) || Infinity;
  const minMargin = $('min-margin').value === '' ? -Infinity : Number($('min-margin').value);
  const items = bombsArray.filter(item => (!$('platform-filter').value || item.platform === $('platform-filter').value)
    && (!$('favorites-only').checked || favorites.has(item.url))
    && item.prezzo <= maxPrice && item.evalData.margine >= minMargin
    && normalizeListingText(item.titolo + ' ' + item.evalData.gpuName + ' ' + item.details).includes(query));
  const sort = $('sort-order').value;
  items.sort((a, b) => sort === 'price-asc' ? a.prezzo - b.prezzo : sort === 'price-desc' ? b.prezzo - a.prezzo
    : sort === 'vs-desc' ? b.evalData.vsScore - a.evalData.vsScore : sort === 'newest' ? b.updatedAt - a.updatedAt
    : b.evalData.margine - a.evalData.margine);
  return items;
}
function renderAllCards() {
  const focusedUrl = document.activeElement?.dataset?.url;
  const items = filteredItems();
  selectedForVersus = selectedForVersus.filter(url => bombsArray.some(item => item.url === url));
  $('results-grid').innerHTML = items.length ? items.slice(0, renderedLimit).map(cardTemplate).join('') :
    '<div class="empty"><span class="empty-icon" aria-hidden="true">◎</span><h2>' +
    (bombsArray.length ? 'Nessun risultato con questi filtri' : 'La tua prossima scoperta parte da qui') +
    '</h2><p>' + (bombsArray.length ? 'Prova a cambiare il budget o a rimuovere un filtro.' :
    'Cerca un portatile gaming, incolla una ricerca oppure importa gli annunci con l’estensione.') + '</p><button class="primary" data-empty-action="' + (bombsArray.length ? 'reset' : 'guide') + '">' + (bombsArray.length ? 'Azzera i filtri' : 'Prepara la prima ricerca') + '</button></div>';
  $('count-bombs').textContent = bombsArray.length;
  $('count-scanned').textContent = totalAnalyzed;
  $('count-favorites').textContent = bombsArray.filter(item => favorites.has(item.url)).length;
  $('results-count').textContent = items.length + ' risultati' + (items.length > renderedLimit ? ' · primi ' + renderedLimit + ' mostrati' : '');
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
    (reason.difference > 0 ? euros.format(reason.difference) + ' sotto la stima indicativa.' : 'Salvato in precedenza: il prezzo attuale non è sotto la stima.') +
    '</p>' + (reason.facts.length ? '<p>Nel testo: ' + reason.facts.map(escapeHtml).join(' · ') + '.</p>' : '') +
    (reason.warnings.length ? '<p class="deal-warning">Attenzione: ' + reason.warnings.map(escapeHtml).join(', ') + '.</p>' : '') +
    '<details><summary>Cosa verificare prima di comprare</summary><ul>' +
    reason.missing.map(label => '<li>' + escapeHtml(label) + ': non riconosciuto nel testo.</li>').join('') +
    '<li>Condizioni, batteria e configurazione esatta.</li><li>Venditore, spedizione e commissioni.</li></ul></details></div>';
  const preview = item.image ? '<img src="' + escapeHtml(item.image) + '" alt="' + escapeHtml(item.titolo) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : '<span>Nessuna anteprima</span>';
  return '<article class="card"><div class="card-image' + (item.image ? '' : ' card-image-empty') + '">' + preview + '</div><button class="favorite" data-action="favorite" data-url="' +
    escapeHtml(item.url) + '" aria-pressed="' + saved + '" aria-label="' + (saved ? 'Rimuovi dai preferiti' : 'Salva preferito') + '">' +
    (saved ? '★' : '☆') + '</button><div class="card-head"><span class="platform ' + item.platform.toLowerCase() + '">' + item.platform +
    '</span><h2 class="card-title">' + escapeHtml(item.titolo) + '</h2><div class="power"><span>Indice hardware ' + data.vsScore +
    '/100</span><span class="power-bar"><i style="width:' + data.vsScore + '%"></i></span></div></div><div class="card-body"><div class="tags">' +
    data.tags.map(tag => '<span class="tag ' + tag.cls + '">' + escapeHtml(tag.text) + '</span>').join('') +
    '</div><div class="prices"><div><span class="price-label">Prezzo annuncio</span><strong class="ask-price">' + euros.format(item.prezzo) +
    '</strong></div><div class="estimate"><span>Stima indicativa</span><strong>' + euros.format(data.stima) +
    '</strong><span class="saving">Differenza ' + euros.format(data.margine) +
    '</span></div></div>' + trend + historyMarkup + reasonMarkup + '<p class="card-note">Spedizione e commissioni da verificare.</p><time class="card-note" datetime="' +
    new Date(item.updatedAt).toISOString() + '">Aggiornato ' + new Date(item.updatedAt).toLocaleDateString('it-IT') +
    '</time></div><div class="card-foot"><label class="compare-label"><input class="compare-check" type="checkbox" data-url="' +
    escapeHtml(item.url) + '" ' + (selectedForVersus.includes(item.url) ? 'checked' : '') + '> Confronta</label><a href="' +
    escapeHtml(item.url) + '" target="_blank" rel="noopener noreferrer">Apri annuncio ↗</a></div></article>';
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
  const rows = [['Prezzo annuncio', item => euros.format(item.prezzo)], ['GPU', item => item.evalData.gpuName],
    ['Indice hardware', item => item.evalData.vsScore + '/100'], ['Stima indicativa', item => euros.format(item.evalData.stima)],
    ['Differenza stimata', item => euros.format(item.evalData.margine)], ['Marketplace', item => item.platform]];
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
  const evaluation = price && analyzeHardware(item.title + ' ' + (item.details || ''), price);
  if (!evaluation) return false;
  const previous = bombsArray.find(result => result.url === url);
  if (!previous && price > evaluation.stima * .95) return false;
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
  if (!sources.length) { setScanState('Da dove partiamo?', 'Scrivi cosa cerchi nel campo a sinistra, per esempio laptop RTX 4070.'); logMsg('Inserisci una parola chiave o almeno un link.', 'log-warn'); $('market-query').focus(); return; }
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
      logMsg(items.length + ' annunci analizzati; ' + changed + ' opportunità aggiunte o aggiornate. Gli annunci senza hardware riconosciuto o sopra la soglia stimata sono esclusi.', 'log-ok');
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
Object.keys(MARKET_HOSTS).forEach(platform => $('link-' + platform.toLowerCase()).addEventListener('input', () => {
  manualPlatforms.add(platform); $('link-' + platform.toLowerCase()).setCustomValidity('');
  updateSourceLinks();
}));
$('btn-generate-links').addEventListener('click', () => {
  const query = $('market-query').value.trim();
  if (!query) { $('market-query').focus(); return; }
  Object.keys(MARKET_HOSTS).forEach(platform => { $('link-' + platform.toLowerCase()).value = marketplaceSearchUrl(platform, query); });
  quickQueryDirty = false; manualPlatforms.clear();
  updateSourceLinks();
  logMsg('Link aggiornati per “' + query + '”.', 'log-ok');
});
FILTER_IDS.forEach(id => {
  $(id).addEventListener('input', () => { renderedLimit = 60; persistFilters(); renderAllCards(); });
});
$('btn-reset-filters').addEventListener('click', () => {
  ['search-input', 'platform-filter', 'max-price', 'min-margin'].forEach(id => { $(id).value = ''; });
  $('favorites-only').checked = false; persistFilters(); renderAllCards();
});
$('btn-more').addEventListener('click', () => { renderedLimit += 60; renderAllCards(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) importBrowserListings(); });
restoreFilters(); renderAllCards(); renderSavedSearches();
if (storageWarning) logMsg('Un archivio locale non è leggibile. Il dato originale è stato conservato.', 'log-warn');
initialSync = initializeSearches();
setInterval(importBrowserListings, 5000);
initialSync.finally(importBrowserListings);
