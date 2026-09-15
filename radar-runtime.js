'use strict';
let discordEnabled = false;
let discordConfigured = false;
const dashboardClient = crypto.randomUUID();

function showDiscordStatus(data, restoreInputs = false) {
  discordEnabled = data.enabled === true;
  discordConfigured = data.configured === true;
  if (restoreInputs) {
    $('discord-enabled').checked = discordEnabled;
    $('discord-margin').value = String(data.minMargin || 0);
  }
  $('discord-url').placeholder = discordConfigured ? 'Webhook salvato · incolla qui solo per sostituirlo' : 'https://discord.com/api/webhooks/…';
  $('btn-discord-test').disabled = !discordConfigured;
  $('discord-status').textContent = data.message + (data.pending ? ' · ' + data.pending + ' in coda' : '');
}
async function refreshDiscord(restoreInputs = false) {
  if (radarStopped) return;
  try { const status = await api('/api/discord'); if (!radarStopped) showDiscordStatus(status, restoreInputs); }
  catch { $('discord-status').textContent = 'Impostazioni non disponibili. Avvia il server aggiornato.'; }
}
async function notifyOpportunity(item) {
  await discordReady;
  if (!discordEnabled || radarStopped) return;
  try {
    await api('/api/discord/notify', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({item:{title:item.titolo, url:item.url, platform:item.platform, price:item.prezzo,
        estimate:item.evalData.stima, isDeal:item.evalData.isDeal, score:item.evalData.dealScore,
        confidence:item.evalData.confidence, condition:item.evalData.conditionLabel}})});
  } catch { logMsg('Notifica Discord non accodata. Controlla il server e le impostazioni.', 'log-warn'); }
}
async function saveDiscord(clear = false) {
  $('btn-discord-save').disabled = true;
  try {
    const data = await api('/api/discord', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({enabled:$('discord-enabled').checked, url:$('discord-url').value.trim(),
        minMargin:Number($('discord-margin').value), clear})});
    $('discord-url').value = '';
    showDiscordStatus(data, true);
  } catch (error) { $('discord-status').textContent = error.message; }
  finally { $('btn-discord-save').disabled = false; }
}
$('btn-discord-save').addEventListener('click', () => saveDiscord());
$('btn-discord-clear').addEventListener('click', () => saveDiscord(true));
$('btn-discord-test').addEventListener('click', async () => {
  $('btn-discord-test').disabled = true;
  try {
    const data = await api('/api/discord/test', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
    $('discord-status').textContent = data.queued ? 'Messaggio di prova in coda…' : 'Salva prima un webhook.';
  } catch (error) { $('discord-status').textContent = error.message; }
  finally { $('btn-discord-test').disabled = !discordConfigured; }
});

async function heartbeat() {
  if (radarStopped) return;
  try {
    const status = await api('/api/heartbeat', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({client:dashboardClient}), signal:AbortSignal.timeout(5000)});
    $('lifetime-status').textContent = status.autoStop ?
      'Il server lavora in background. Chiudi tutte le schede di LootSniper: si arresterà dopo circa 45 secondi. Oppure premi Arresta LootSniper.' :
      'Server avviato manualmente: premi Arresta LootSniper per chiuderlo.';
  } catch { /* The main connection indicator already explains an offline server. */ }
}
window.addEventListener('pagehide', () => {
  if (radarStopped) return;
  const body = JSON.stringify({client:dashboardClient, closing:true});
  navigator.sendBeacon(apiBase + '/api/heartbeat', new Blob([body], {type:'application/json'}));
});
window.addEventListener('pageshow', heartbeat);
document.addEventListener('visibilitychange', () => { if (!document.hidden) heartbeat(); });
$('btn-shutdown').addEventListener('click', async () => {
  $('btn-shutdown').disabled = true;
  try {
    scanController?.abort();
    persistResults();
    await api('/api/shutdown', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    radarStopped = true;
    clearInterval(heartbeatTimer); clearInterval(discordTimer);
    $('connection-status').textContent = 'LootSniper arrestato';
    $('connection-status').classList.add('offline');
    $('lifetime-status').textContent = 'Server arrestato. Puoi chiudere questa scheda. Per riavviare usa avvia radar.vbs.';
    $('btn-scan').disabled = true;
    $('btn-discord-save').disabled = true; $('btn-discord-test').disabled = true;
  } catch (error) { logMsg(error.message, 'log-err'); $('btn-shutdown').disabled = false; }
});
const heartbeatTimer = setInterval(heartbeat, 20000);
const discordTimer = setInterval(() => refreshDiscord(), 5000);
heartbeat();
const discordReady = refreshDiscord(true);
