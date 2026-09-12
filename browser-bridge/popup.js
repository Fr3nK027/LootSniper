'use strict';
const $ = id => document.getElementById(id);
const platformInputs = [...document.querySelectorAll('[data-platform]')];
let ready = false;
function showStatus(title, detail) {
  const heading = document.createElement('strong'), text = document.createElement('span');
  heading.textContent = title; text.textContent = detail; $('status').replaceChildren(heading, text);
}
async function request(path) {
  const response = await fetch('http://127.0.0.1:8765' + path, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error('Server non disponibile');
  return response.json();
}
function showAutomation(value) {
  if (!value) return;
  $('automation-detail').textContent = value.message || '';
  $('stop-searches').hidden = !value.running;
  $('run-searches').disabled = !ready || !!value.running;
}
async function initialize() {
  $('import').disabled = true; $('run-searches').disabled = true; $('save-settings').disabled = true;
  try {
    const [payload, settings] = await Promise.all([request('/api/searches'), chrome.storage.local.get({
      enabledPlatforms: ['VINTED', 'EBAY', 'SUBITO'], selectedSearches: [], useAllSearches: null,
      automaticEnabled: true, automationStatus: null
    })]);
    platformInputs.forEach(input => { input.checked = settings.enabledPlatforms.includes(input.dataset.platform); });
    $('automatic-enabled').checked = settings.automaticEnabled;
    $('all-searches').checked = settings.useAllSearches ?? !settings.selectedSearches.length;
    $('saved-searches').replaceChildren();
    for (const search of payload.searches || []) {
      const option = new Option(search.name, search.name);
      option.selected = settings.selectedSearches.includes(search.name); $('saved-searches').add(option);
    }
    $('saved-searches').disabled = $('all-searches').checked;
    ready = true;
    $('import').disabled = false; $('run-searches').disabled = false; $('save-settings').disabled = false;
    showStatus('Server connesso', 'Importa la pagina attiva oppure avvia le ricerche salvate.');
    const live = await chrome.runtime.sendMessage({ type: 'get-run-status' });
    showAutomation(settings.automationStatus ? { ...settings.automationStatus, running: live?.running || false } : null);
  } catch {
    ready = false;
    showStatus('Server offline', 'Avvia “avvia radar locale.bat”, poi riapri questo popup.');
  }
}
async function collectCurrentPage() {
  $('import').disabled = true;
  showStatus('Lettura pagina…', 'Attendo la conferma di salvataggio da LootSniper.');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/(www\.)?(ebay\.it|subito\.it|vinted\.it)\//i.test(tab.url || '')) {
      showStatus('Apri un marketplace', 'Sono supportati eBay, Subito e Vinted.'); return;
    }
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'collect-listings' });
    if (!result?.ok) throw new Error(result?.error || 'Importazione non confermata');
    showStatus(result.count ? 'Pagina importata' : 'Nessun annuncio leggibile',
      result.count ? (result.imported || 0) + ' nuovi · ' + (result.updated || 0) + ' aggiornati · ' + result.count + ' letti.' :
        'Attendi il caricamento della ricerca e riprova.');
  } catch (error) { showStatus('Importazione non riuscita', error.message + ' Ricarica la pagina e controlla il server.'); }
  finally { $('import').disabled = !ready; }
}
async function saveAutomation() {
  const enabledPlatforms = platformInputs.filter(input => input.checked).map(input => input.dataset.platform);
  const selectedSearches = [...$('saved-searches').selectedOptions].map(option => option.value).filter(Boolean);
  await chrome.storage.local.set({ enabledPlatforms, selectedSearches, useAllSearches: $('all-searches').checked,
    automaticEnabled: $('automatic-enabled').checked });
  const result = await chrome.runtime.sendMessage({ type: 'update-alarm' });
  if (!result?.ok) throw new Error(result?.error || 'Salvataggio non confermato');
  showStatus('Impostazioni salvate', enabledPlatforms.length + ' marketplace · controllo automatico ' + ($('automatic-enabled').checked ? 'ogni 15 minuti.' : 'disattivato.'));
}
$('save-settings').addEventListener('click', () => saveAutomation().catch(error => showStatus('Errore', error.message)));
$('run-searches').addEventListener('click', async () => {
  $('run-searches').disabled = true;
  try {
    await saveAutomation();
    const result = await chrome.runtime.sendMessage({ type: 'run-saved-searches' });
    if (!result?.ok) throw new Error(result?.error || 'Avvio non confermato');
    showStatus('Ricerca avviata', 'Puoi chiudere il popup. Lo stato resta disponibile qui.');
  } catch (error) { showStatus('Ricerca non avviata', error.message); $('run-searches').disabled = false; }
});
$('stop-searches').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'stop-searches' });
  $('automation-detail').textContent = 'Interruzione in corso…';
});
$('all-searches').addEventListener('change', () => { $('saved-searches').disabled = $('all-searches').checked; });
$('import').addEventListener('click', collectCurrentPage);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.automationStatus) showAutomation(changes.automationStatus.newValue);
});
initialize();
