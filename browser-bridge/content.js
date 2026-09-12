'use strict';
function collectListings() {
  const host = location.hostname.replace(/^www\./, '');
  const platform = { 'ebay.it': 'EBAY', 'vinted.it': 'VINTED', 'subito.it': 'SUBITO' }[host];
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
