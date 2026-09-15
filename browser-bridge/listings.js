/* Shared listing extraction for the desktop browser, dashboard fallback and optional legacy bridge. */
const RadarListings = (() => {
  const domains = { EBAY:'ebay.it', VINTED:'vinted.it', SUBITO:'subito.it', WALLAPOP:'wallapop.com', AMAZON:'amazon.it',
    BACKMARKET:'backmarket.it', REFURBED:'refurbed.it', CEX:'webuy.com' };
  const aliases = { EBAY:['ebay.it','ebay.com'], VINTED:['vinted.it'], SUBITO:['subito.it'], WALLAPOP:['wallapop.com'],
    AMAZON:['amazon.it'], BACKMARKET:['backmarket.it'], REFURBED:['refurbed.it'], CEX:['webuy.com'] };
  const canonicalHosts={EBAY:'www.ebay.it',VINTED:'www.vinted.it',SUBITO:'www.subito.it',WALLAPOP:'it.wallapop.com',AMAZON:'www.amazon.it',BACKMARKET:'www.backmarket.it',REFURBED:'www.refurbed.it',CEX:'it.webuy.com'};
  const rules = {
    EBAY:{links:'a[href*="/itm/"]',cards:'.s-item,[data-view="mi:1686"]'},
    VINTED:{links:'a[href*="/items/"]',cards:'[data-testid*="grid-item"],article,.feed-grid__item'},
    SUBITO:{links:'a[href*=".htm"]',cards:'[data-testid*="item-card"],article,[class*="ItemCard"]'},
    WALLAPOP:{links:'a[href*="/item/"]',cards:'article,[class*="ItemCard"],[class*="item-card"]'},
    AMAZON:{links:'a[href*="/dp/"],a[href*="/gp/product/"]',cards:'[data-component-type="s-search-result"]'},
    BACKMARKET:{links:'a[href*="/p/"]',cards:'article,[data-qa*="product"],li'},
    REFURBED:{links:'a[href*="/p/"]',cards:'article,[data-testid*="product"],[class*="product-card"]'},
    CEX:{links:'a[href*="/product-detail"]',cards:'article,[class*="product"],li'}
  };
  function resolve(value, base, platform) {
    if (!value) return '';
    try { const url=new URL(value,base); if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))return '';
      if(platform&&!aliases[platform].some(domain=>url.hostname===domain||url.hostname.endsWith('.'+domain)))return ''; return url.href; } catch{return '';}
  }
  function identity(value, platform) {
    const url=new URL(value), originalSearch=new Map(url.searchParams.entries()); url.hostname=canonicalHosts[platform]; url.search=''; url.hash=''; url.pathname=url.pathname.replace(/\/$/,'');
    const match=platform==='EBAY'?url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d+)/):platform==='VINTED'?url.pathname.match(/^\/items\/(\d+)/):
      platform==='AMAZON'?url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i):null;
    if(match) url.pathname=(platform==='EBAY'?'/itm/':platform==='VINTED'?'/items/':'/dp/')+match[1].toUpperCase();
    if(platform==='CEX'){const key=['id','p-item','productId'].find(name=>originalSearch.has(name));const value=key?originalSearch.get(key):'';if(key)url.searchParams.set(key,value);}
    return url.href;
  }
  function collect(doc, source) {
    const {platform,url:base}=source, rule=rules[platform]; if(!rule)return [];
    const items=new Map(), cards=new Set(doc.querySelectorAll(rule.cards));
    for(const link of doc.querySelectorAll(rule.links)){const card=link.closest('article,li,[data-component-type="s-search-result"],[data-testid*="item"],[class*="card"],[class*="Card"],[class*="product"],[class*="Product"]');if(card)cards.add(card);}
    for(const card of cards){
      if(card.classList.contains('s-item__pl'))continue;
      const link=card.querySelector(rule.links), resolved=resolve(link?.getAttribute('href'),base,platform), url=resolved&&identity(resolved,platform);
      if(!url||items.has(url))continue;
      const all=readableText(card), price=(all.match(/(?:€|EUR)\s*\d[\d., ]*|\d[\d., ]*\s*(?:€|EUR)/i)||[])[0]||'';
      const image=card.querySelector('img');
      const title=(card.querySelector('.s-item__title,h2,h3,h4,[data-testid*="title"],[class*="title"],[class*="name"]')?.textContent||link?.getAttribute('title')||link?.getAttribute('aria-label')||image?.alt||'').replace(/\s+/g,' ').trim();
      if(!title||!price)continue;
      items.set(url,{platform,title:title.slice(0,500),price,url,details:all.slice(0,6000),image:resolve(image?.currentSrc||image?.src||image?.getAttribute('data-src'),base)});
      if(items.size>=500)break;
    }
    return [...items.values()];
  }
  function readableText(node){if(node.nodeType===3)return node.textContent;if(['SCRIPT','STYLE','NOSCRIPT'].includes(node.nodeName))return '';return [...node.childNodes].map(readableText).join(' ').replace(/\s+/g,' ').trim();}
  return {collect,readableText};
})();
if(typeof module!=='undefined')module.exports=RadarListings;
