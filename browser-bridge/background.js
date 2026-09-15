'use strict';
const API = 'http://127.0.0.1:8765';
const AUTOMATION_ALARM = 'radar-automatic-search';
const MAX_PAGES = 20;
const HOSTS = { VINTED: 'vinted.it', EBAY: 'ebay.it', SUBITO: 'subito.it' };
const HOST_ALIASES = { VINTED: ['vinted.it'], EBAY: ['ebay.it', 'ebay.com'], SUBITO: ['subito.it'] };
let automationRunning = false;
let stopRequested = false;
let automationTabId = null;

async function radarApi(path, options = {}) {
  const response = await fetch(API + path, { ...options, signal: AbortSignal.timeout(15000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Server HTTP ' + response.status);
  return payload;
}
async function sendToRadar(message) {
  if (!Array.isArray(message.items) || message.items.length > 500) throw new Error('Formato annunci non valido.');
  const total = { imported: 0, updated: 0, received: 0 };
  for (let offset = 0; offset < message.items.length; offset += 100) {
    const result = await radarApi('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: message.platform, items: message.items.slice(offset, offset + 100) }) });
    total.imported += result.imported || 0; total.updated += result.updated || 0; total.received += result.received || 0;
  }
  return total;
}
function validSource(value, platform) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && HOST_ALIASES[platform].some(domain => url.hostname === domain || url.hostname === 'www.' + domain);
  } catch { return false; }
}
function wait(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
function pageUrl(value, platform, offset) {
  const url = new URL(value), parameter = platform === 'EBAY' ? '_pgn' : platform === 'SUBITO' ? 'o' : 'page';
  const current = Number.parseInt(url.searchParams.get(parameter), 10);
  url.searchParams.set(parameter, String((current > 0 ? current : 1) + offset - 1));
  return url.href;
}
async function status(value) {
  await chrome.storage.local.set({ automationStatus: { ...value, updatedAt: Date.now() } });
}
function navigateTab(tabId, url) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = error => {
      if (done) return;
      done = true; clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      error ? reject(error) : resolve();
    };
    const onUpdated = (id, change) => { if (id === tabId && change.status === 'complete') finish(); };
    const onRemoved = id => { if (id === tabId) finish(new Error('Scheda chiusa prima della lettura.')); };
    const timer = setTimeout(() => finish(new Error('Caricamento pagina scaduto.')), 30000);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.update(tabId, { url, active: false }).then(tab => {
      if (tab.status === 'complete') finish();
    }).catch(finish);
  });
}
async function collectTab(tabId) {
  let lastError;
  for (let attempt = 0; attempt < 4 && !stopRequested; attempt++) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, { type: 'collect-listings' });
      if (!result?.ok) throw new Error(result?.error || 'Importazione non confermata.');
      return result;
    } catch (error) { lastError = error; await wait(1000); }
  }
  if (stopRequested) return { count: 0 };
  throw lastError || new Error('La pagina non risponde.');
}
async function processSource(source, maxPages = MAX_PAGES) {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  automationTabId = tab.id;
  let imported = 0, updated = 0;
  const fingerprints = new Set();
  try {
    for (let page = 1; page <= maxPages && !stopRequested; page++) {
      await status({ running: true, message: source.name + ' · ' + source.platform + ' · pagina ' + page });
      await navigateTab(tab.id, pageUrl(source.url, source.platform, page));
      if (stopRequested) break;
      await wait(1200);
      const result = await collectTab(tab.id);
      imported += result.imported || 0; updated += result.updated || 0;
      if (!result.count || !result.fingerprint || fingerprints.has(result.fingerprint)) break;
      fingerprints.add(result.fingerprint);
      await wait(700);
    }
  } finally { await chrome.tabs.remove(tab.id).catch(() => {}); automationTabId = null; }
  return { imported, updated };
}
function cleanCurrentSources(values) {
  if (!Array.isArray(values) || !values.length || values.length > 3) return [];
  const known = new Set(), clean = [];
  for (const value of values) {
    if (!value || !Object.hasOwn(HOSTS, value.platform) || !validSource(value.url, value.platform) || known.has(value.url)) return [];
    known.add(value.url); clean.push({ platform: value.platform, url: value.url, name: 'Ricerca corrente' });
  }
  return clean;
}
async function runCurrentSources(sources, deepScan) {
  automationRunning = true; stopRequested = false;
  let imported = 0, updated = 0, failures = 0;
  try {
    await status({ running: true, mode: 'current', message: 'Avvio ricerca dal browser…' });
    for (const source of sources) {
      if (stopRequested) break;
      try {
        const result = await processSource(source, deepScan ? MAX_PAGES : 1);
        imported += result.imported; updated += result.updated;
      } catch (error) { failures++; console.warn('Radar:', source.platform, error.message); }
    }
    await status({ running: false, mode: 'current', imported, updated, failures,
      message: stopRequested ? 'Ricerca interrotta.' : imported + ' nuovi · ' + updated + ' aggiornati' +
        (failures ? ' · ' + failures + ' fonti non leggibili' : '') });
  } catch (error) {
    await status({ running: false, mode: 'current', error: true, message: error.message || 'Ricerca dal browser non riuscita.' });
  } finally { automationRunning = false; stopRequested = false; }
}
async function runSavedSearches() {
  if (automationRunning) return;
  automationRunning = true; stopRequested = false;
  let imported = 0, updated = 0, failures = 0;
  try {
    await status({ running: true, message: 'Caricamento ricerche…' });
    const payload = await radarApi('/api/searches');
    const settings = await chrome.storage.local.get({ enabledPlatforms: Object.keys(HOSTS), selectedSearches: [], useAllSearches: null });
    const useAll = settings.useAllSearches ?? !settings.selectedSearches.length;
    const searches = useAll ? payload.searches : payload.searches.filter(search => settings.selectedSearches.includes(search.name));
    const known = new Set(), sources = [];
    for (const search of searches) for (const platform of settings.enabledPlatforms) {
      const url = search[platform.toLowerCase()];
      if (!validSource(url, platform) || known.has(url)) continue;
      known.add(url); sources.push({ platform, url, name: search.name });
    }
    for (const source of sources) {
      if (stopRequested) break;
      try {
        const result = await processSource(source);
        imported += result.imported; updated += result.updated;
      } catch (error) { failures++; console.warn('Radar:', source.platform, error.message); }
    }
    await status({ running: false, imported, updated, failures,
      message: stopRequested ? 'Ricerca interrotta.' : !sources.length ? 'Nessuna ricerca selezionata.' :
        imported + ' nuovi · ' + updated + ' aggiornati' + (failures ? ' · ' + failures + ' fonti non leggibili' : '') });
  } catch (error) { await status({ running: false, error: true, message: error.message || 'Server locale non raggiungibile.' }); }
  finally { automationRunning = false; stopRequested = false; }
}
async function ensureAlarm() {
  const settings = await chrome.storage.local.get({ automaticEnabled: true });
  if (settings.automaticEnabled) await chrome.alarms.create(AUTOMATION_ALARM, { delayInMinutes: 1, periodInMinutes: 15 });
  else await chrome.alarms.clear(AUTOMATION_ALARM);
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'radar-listings') {
    if (!validSource(sender.url || sender.tab?.url, message.platform)) {
      sendResponse({ ok: false, error: 'Pagina non autorizzata.' }); return;
    }
    sendToRadar(message).then(result => sendResponse({ ok: true, ...result }))
      .catch(error => sendResponse({ ok: false, error: error.message || 'Server offline.' }));
    return true;
  }
  const dashboardSender = (() => { try { return new URL(sender.url || '').origin === API; } catch { return false; } })();
  if (dashboardSender && message?.type === 'dashboard-run-current') {
    const sources = cleanCurrentSources(message.sources);
    if (!sources.length) { sendResponse({ ok: false, error: 'Sorgenti della dashboard non valide.' }); return; }
    if (automationRunning) { sendResponse({ ok: false, error: 'Una ricerca del browser è già in corso.' }); return; }
    runCurrentSources(sources, message.deepScan === true); sendResponse({ ok: true }); return;
  }
  if (dashboardSender && message?.type === 'dashboard-run-status') {
    chrome.storage.local.get({ automationStatus: null }).then(value => sendResponse({ ok: true, running: automationRunning, status: value.automationStatus }));
    return true;
  }
  if (dashboardSender && message?.type === 'dashboard-stop-current') {
    stopRequested = true;
    if (automationTabId !== null) chrome.tabs.remove(automationTabId).catch(() => {});
    sendResponse({ ok: true }); return;
  }
  // Commands can only come from extension pages, not a marketplace content script.
  if (sender.tab) return;
  if (message?.type === 'get-run-status') {
    sendResponse({ running: automationRunning });
  } else if (message?.type === 'run-saved-searches') {
    if (automationRunning) { sendResponse({ ok: false, error: 'Una ricerca è già in corso.' }); return; }
    runSavedSearches(); sendResponse({ ok: true });
  } else if (message?.type === 'stop-searches') {
    stopRequested = true;
    if (automationTabId !== null) chrome.tabs.remove(automationTabId).catch(() => {});
    sendResponse({ ok: true });
  } else if (message?.type === 'update-alarm') {
    ensureAlarm().then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  const settings = await chrome.storage.local.get({ automaticEnabled: true });
  if (settings.automaticEnabled) runSavedSearches();
});
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== AUTOMATION_ALARM) return;
  const settings = await chrome.storage.local.get({ automaticEnabled: true });
  if (settings.automaticEnabled) runSavedSearches();
});
