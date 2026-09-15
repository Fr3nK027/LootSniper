'use strict';
const DASHBOARD_ORIGIN = 'http://127.0.0.1:8765';
function collectListings() {
  const host = location.hostname.replace(/^www\./, '');
  const platform = { 'ebay.it': 'EBAY', 'ebay.com': 'EBAY', 'vinted.it': 'VINTED', 'subito.it': 'SUBITO' }[host];
  return { platform, items: RadarListings.collect(document, { platform, url: location.href }) };
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'collect-listings') return;
  const collected = collectListings();
  if (!collected.items.length) { sendResponse({ ok: true, count: 0, imported: 0, updated: 0, fingerprint: '' }); return; }
  chrome.runtime.sendMessage({ type: 'radar-listings', ...collected }).then(result => {
    sendResponse({ ...result, count: collected.items.length, fingerprint: collected.items.map(item => item.url).sort().join('|') });
  }).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

if (location.origin === DASHBOARD_ORIGIN) {
  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || event.origin !== DASHBOARD_ORIGIN || message?.source !== 'lootsniper-dashboard'
        || typeof message.requestId !== 'string' || !['dashboard-run-current', 'dashboard-run-status', 'dashboard-stop-current'].includes(message.type)) return;
    chrome.runtime.sendMessage({ type: message.type, sources: message.sources, deepScan: message.deepScan }).then(result => {
      window.postMessage({ source: 'lootsniper-extension', requestId: message.requestId, result }, DASHBOARD_ORIGIN);
    }).catch(error => {
      window.postMessage({ source: 'lootsniper-extension', requestId: message.requestId,
        result: { ok: false, error: error.message || 'Estensione non disponibile.' } }, DASHBOARD_ORIGIN);
    });
  });
}
