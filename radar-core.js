const GPU_DATA = {
  '5090': [4000, 100], '5080': [2800, 89], '5070ti': [2000, 82], '5070': [1800, 78], '5060': [1400, 65], '5050': [1000, 50],
  '4090': [2000, 90], '4080super': [1750, 84], '4080': [1650, 82], '4070ti': [1350, 73], '4070super': [1250, 70], '4070': [1150, 66], '4060': [750, 52],
  'rx7900xtx': [1850, 86], 'rx7900xt': [1550, 78], 'rx7800xt': [950, 70], 'rx7700xt': [750, 62], 'rx7600': [500, 48], 'rx6800': [700, 60], 'rx6700xt': [550, 54],
  '3080ti': [850, 64], '3080': [700, 59], '3070ti': [550, 50]
};
const PREMIUM_MODELS = ['msi titan', 'msi raider', 'msi stealth', 'strix scar', 'legion pro 7', 'legion 7', 'alienware', 'blade 14', 'blade 16', 'blade 18', 'zephyrus', 'aero 16', 'proart', 'omen', 'predator', 'nitro'];
const CHEAP_BRANDS = ['thunderobot', 'machenike', 'medion', 'hasee', 'victus', 'msi katana', 'msi cyborg', 'msi thin', 'asus tuf'];
function normalizeListingText(text) {
  return String(text || '').toLowerCase()
    .replace(/\brgx\b|\brta\b|\brt\b|\brxt\b/g, 'rtx')
    .replace(/\brom\b|\braam\b|\br am\b/g, 'ram')
    .replace(/\b(4080|4070|3080)\s*s\b/g, '$1 super')
    .replace(/\bi\s*([3579])\b/g, 'i$1')
    .replace(/\b([0-9]{2})\s*(gb|g b)\b/g, '$1 gb')
    .replace(/\b([0-9]+)\s*(tb|t b)\b/g, '$1 tb')
    .replace(/\s+/g, ' ')
    .trim();
}
function analyzeHardware(text, price) {
  text = normalizeListingText(text);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (/\b(custodia|cover|scatola vuota|solo scatola|cerco|compro|alimentatore per|caricabatterie per)\b/i.test(text)) return null;
  let baseValue = 0, tags = [], damageMultiplier = 1, detectedGpu = '', vsScore = 0;
  const gpuMatch = text.match(/\b(rtx|rx|geforce|nvidia|radeon)\s*(5090|5080|5070\s*ti|5070|5060|5050|4090|4080\s*super|4080|4070\s*ti|4070\s*super|4070|4060|3080\s*ti|3080|3070\s*ti|7900\s*xtx|7900\s*xt|7800\s*xt|7700\s*xt|7600|6800|6700\s*xt)\b/i);
  if (gpuMatch) { const prefix = (gpuMatch[1] || '').toLowerCase(), model = gpuMatch[2].replace(/\s+/g, '').toLowerCase(), key = ['rx', 'radeon'].includes(prefix) ? `rx${model}` : model; if (GPU_DATA[key]) { [baseValue, vsScore] = GPU_DATA[key]; detectedGpu = `${prefix === 'rx' || key.startsWith('rx') ? 'RX' : 'RTX'} ${gpuMatch[2].toUpperCase().replace(/\s+/g, ' ')}`; tags.push({ text: detectedGpu, cls: 't-gpu' }); } }
  if (!detectedGpu) return null;
  for (const model of PREMIUM_MODELS) if (text.includes(model)) { baseValue += 350; vsScore = Math.min(100, vsScore + 5); tags.push({ text: 'Serie premium · stima', cls: 't-up' }); break; }
  if (!baseValue) return null;
  if (!/\b(laptop|notebook|portatile)\b/.test(text) && !PREMIUM_MODELS.some(model => text.includes(model)) && !CHEAP_BRANDS.some(model => text.includes(model))) return null;
  if (/(i9|ryzen 9|ultra 9|core 9|ryzen ai 9)/i.test(text)) { baseValue += 300; vsScore = Math.min(100, vsScore + 5); tags.push({ text: 'CPU top +300 EUR', cls: 't-up' }); }
  for (const brand of CHEAP_BRANDS) if (text.includes(brand)) { damageMultiplier *= .8; vsScore = Math.max(10, vsScore - 10); tags.push({ text: 'Brand eco -20%', cls: 't-down' }); break; }
  const ramMatch = text.match(/\b(8|16|32|64|96)\s*(?:gb|g)\s*(?:di\s+)?ram\b|\bram\s*(?:da\s*)?(8|16|32|64|96)\s*(?:gb|g)\b/);
  const ram = ramMatch ? Number(ramMatch[1] || ramMatch[2]) : 0;
  if (ram) { baseValue += ram >= 64 ? 250 : ram >= 32 ? 100 : 0; tags.push({ text: ram + 'GB RAM', cls: 't-up' }); }
  if (/\b2\s*(tb|t)\b/i.test(text)) { baseValue += 100; tags.push({ text: '2TB storage', cls: 't-up' }); } else if (/\b4\s*(tb|t)\b/i.test(text)) { baseValue += 250; tags.push({ text: '4TB storage', cls: 't-up' }); }
  if (/\b(oled|mini-led|miniled)\b/i.test(text)) { baseValue += 200; tags.push({ text: /\boled\b/.test(text) ? 'Display OLED' : 'Display Mini LED', cls: 't-up' }); }
  if (!/(rotto|da riparare|ricambi|non si accende)/i.test(text) && /\b(nuovo|sigillato|imballato|mai acceso|mai aperto|scontrino di oggi)\b/i.test(text)) { damageMultiplier *= 1.15; tags.push({ text: 'Nuovo / sigillato', cls: 't-up' }); }
  else if (/(rotto|da riparare|per parti|ricambi|schermo rotto|non si accende)/i.test(text)) { damageMultiplier *= .5; tags.push({ text: 'Da riparare', cls: 't-down' }); }
  else if (/(?<!senza )(graffi|ammaccatura|segni|crepa|rovinato)/i.test(text)) { damageMultiplier *= .85; tags.push({ text: 'Usura', cls: 't-down' }); }
  if (!ram) tags.push({ text: 'RAM da verificare', cls: 't-neutral' });
  if (!/(\b(1|2|4)\s*(tb|t)\b|ssd|nvme)/i.test(text)) tags.push({ text: 'Storage non indicato', cls: 't-neutral' });
  const confidence = Math.min(100, 45 + (gpuMatch ? 35 : 0) + (/(ram|gb)/i.test(text) ? 10 : 0) + (/(ssd|nvme|tb)/i.test(text) ? 10 : 0));
  const estimated = Math.round(baseValue * damageMultiplier);
  return { stima: estimated, stimaNuovo: Math.round(estimated * (estimated > 3000 ? 1.55 : 1.4)), reference: null, tags, margine: estimated - price, gpuName: detectedGpu || 'Gaming Laptop', vsScore, confidence };
}

function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 && value <= 100000 ? value : null;
  const text = String(value ?? '').replace(/\u00a0|\u202f/g, ' ').trim();
  if (/(?:^|\s)-\s*\d|(?:€|EUR)\s*-\s*\d/i.test(text)) return null;
  if (/\$|USD|GBP|£/i.test(text) && !/€|EUR/i.test(text)) return null;
  const match = text.match(/(?:EUR|€)\s*(\d[\d., ]*)|(\d[\d., ]*)\s*(?:EUR|€)/i)
    || text.match(/^(\d[\d., ]*)$/);
  if (!match) return null;
  let token = (match[1] || match[2]).replace(/\s/g, '').replace(/[.,]$/, '');
  const comma = token.lastIndexOf(','), dot = token.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    token = token.replace(decimal === ',' ? /\./g : /,/g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(token)) token = token.replace(/[.,]/g, '');
  else token = token.replace(',', '.');
  const result = Number(token);
  return Number.isFinite(result) && result > 0 && result <= 100000 ? result : null;
}
function extractPrices(text) { return parseMoney(text); }
const MARKET_HOSTS = { VINTED: 'vinted.it', EBAY: 'ebay.it', SUBITO: 'subito.it' };
function safeUrl(value, platform) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return '';
    if (platform && ![MARKET_HOSTS[platform], 'www.' + MARKET_HOSTS[platform]].includes(url.hostname)) return '';
    return url.href;
  } catch { return ''; }
}
function canonicalUrl(value, platform) {
  if (!Object.hasOwn(MARKET_HOSTS, platform)) return '';
  if (!safeUrl(value, platform)) return '';
  const url = new URL(value);
  url.hostname = 'www.' + MARKET_HOSTS[platform];
  url.search = ''; url.hash = '';
  url.pathname = url.pathname.replace(/\/$/, '');
  if (platform === 'EBAY') {
    const match = url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d+)/);
    if (match) url.pathname = '/itm/' + match[1];
  } else if (platform === 'VINTED') {
    const match = url.pathname.match(/^\/items\/(\d+)/);
    if (match) url.pathname = '/items/' + match[1];
  }
  return url.href;
}
function pageUrl(value, platform, offset) {
  const url = new URL(value);
  const parameter = platform === 'EBAY' ? '_pgn' : platform === 'SUBITO' ? 'o' : 'page';
  const initial = Number.parseInt(url.searchParams.get(parameter), 10);
  url.searchParams.set(parameter, String((Number.isFinite(initial) && initial > 0 ? initial : 1) + offset - 1));
  return url.href;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}
function cleanResult(item) {
  if (!item || !Object.hasOwn(MARKET_HOSTS, item.platform) || !item.titolo || !item.evalData) return null;
  const url = canonicalUrl(item.url, item.platform), price = Number(item.prezzo), data = item.evalData;
  if (!url || !Number.isFinite(price) || price <= 0 || !Number.isFinite(data.stima) || !Array.isArray(data.tags)) return null;
  return { titolo: String(item.titolo).slice(0, 500), prezzo: price, url, platform: item.platform,
    image: safeUrl(item.image), details: String(item.details || '').slice(0, 6000),
    firstSeen: validTimestamp(item.firstSeen), updatedAt: validTimestamp(item.updatedAt),
    priceHistory: (Array.isArray(item.priceHistory) ? item.priceHistory : []).filter(point => point && Number.isFinite(point.price) && point.price > 0)
      .slice(-20).map(point => ({ price: point.price, at: validTimestamp(point.at) })),
    evalData: { stima: data.stima, margine: data.stima - price, gpuName: String(data.gpuName || 'Da verificare'),
      vsScore: Math.max(0, Math.min(100, Number(data.vsScore) || 0)),
      confidence: Math.max(0, Math.min(100, Number(data.confidence) || 45)),
      tags: data.tags.filter(tag => tag && typeof tag.text === 'string').map(tag => ({
        text: tag.text.slice(0, 100), cls: ['t-up', 't-down', 't-gpu', 't-neutral'].includes(tag.cls) ? tag.cls : 't-neutral'
      })) }
  };
}
function validTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= Date.now() + 86400000 ? number : Date.now();
}
if (typeof module !== 'undefined') module.exports = { parseMoney, extractPrices, analyzeHardware, normalizeListingText, safeUrl, canonicalUrl, pageUrl, escapeHtml, cleanResult };
