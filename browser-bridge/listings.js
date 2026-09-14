/* Shared listing extraction: used by the dashboard and the browser extension. */
const RadarListings = (() => {
  const domains = { EBAY: 'ebay.it', VINTED: 'vinted.it', SUBITO: 'subito.it' };
  const aliases = { EBAY: ['ebay.it', 'ebay.com'], VINTED: ['vinted.it'], SUBITO: ['subito.it'] };
  function resolve(value, base, platform) {
    if (!value) return '';
    try {
      const url = new URL(value, base);
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return '';
      if (platform && !aliases[platform].some(domain => url.hostname === domain || url.hostname === 'www.' + domain)) return '';
      return url.href;
    } catch { return ''; }
  }
  function identity(value, platform) {
    const url = new URL(value);
    url.hostname = 'www.' + domains[platform]; url.search = ''; url.hash = '';
    const match = platform === 'EBAY' ? url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d+)(?:\/|$)/) :
      platform === 'VINTED' ? url.pathname.match(/^\/items\/(\d+)(?:[-/]|$)/) : null;
    if (platform !== 'SUBITO' && !match) return '';
    if (match) url.pathname = (platform === 'EBAY' ? '/itm/' : '/items/') + match[1];
    if (platform === 'SUBITO' && !/-\d+\.html?$/.test(url.pathname)) return '';
    return url.href;
  }
  function collect(doc, source) {
    const {platform, url: base} = source;
    if (!Object.hasOwn(domains, platform)) return [];
    const selectors = platform === 'EBAY' ? '.s-item, [data-view="mi:1686"]' : platform === 'VINTED' ?
      '[data-testid*="grid-item"], .feed-grid__item, article' : '[data-testid*="item-card"], article, [class*="ItemCard"]';
    const linkSelector = platform === 'EBAY' ? 'a[href*="/itm/"]' : platform === 'VINTED' ? 'a[href*="/items/"]' : 'a[href*=".htm"]';
    const items = new Map();
    const cards = new Set(doc.querySelectorAll(selectors));
    for (const link of doc.querySelectorAll(linkSelector)) {
      const card = link.closest('article, li, [data-testid*="grid-item"], .feed-grid__item') ||
        link.parentElement?.closest('[class*="card"], [class*="Card"]');
      if (card) cards.add(card);
    }
    for (const card of cards) {
      if (card.classList.contains('s-item__pl')) continue;
      const link = card.querySelector(linkSelector);
      if (!link) continue;
      const resolved = resolve(link.getAttribute('href'), base, platform);
      const url = resolved && identity(resolved, platform);
      if (!url || items.has(url)) continue;
      const titleNode = card.querySelector('.s-item__title, h2, h3, [class*="subject"], [class*="title"]');
      const priceNode = card.querySelector('.s-item__price, [data-testid*="price"], [class*="price"]');
      const image = card.querySelector('img');
      const title = (titleNode?.textContent || link.getAttribute('title') || link.getAttribute('aria-label') || image?.alt || '').replace(/\s+/g, ' ').trim();
      const price = (priceNode?.textContent || '').replace(/\s+/g, ' ').trim();
      if (!title || !price) continue;
      items.set(url, { platform, title: title.slice(0, 500), price, url,
        details: readableText(card).slice(0, 6000),
        image: resolve(image?.getAttribute('data-src') || image?.getAttribute('src') || image?.currentSrc, base) });
      if (items.size >= 500) break;
    }
    return [...items.values()];
  }
  function readableText(node) {
    if (node.nodeType === 3) return node.textContent;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.nodeName)) return '';
    return [...node.childNodes].map(readableText).join(' ').replace(/\s+/g, ' ').trim();
  }
  return { collect, readableText };
})();
if (typeof module !== 'undefined') module.exports = RadarListings;
