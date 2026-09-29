/**
 * api/scraperCluster.js  -  High-performance concurrent scraper cluster
 * Scrapes major Indian e-pharmacies for live market prices and generic alternatives.
 * Uses HTTP fetches + JSON/LD+JSON/Hydration state parsing to bypass heavy browser overhead.
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
];

function getRandomHeader() {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  return {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'User-Agent': ua,
  };
}

/**
 * Scrapes Apollo Pharmacy
 */
async function scrapeApollo(q, timeoutMs = 4000) {
  const url = `https://www.apollopharmacy.in/search-medicines/${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, {
      headers: getRandomHeader(),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return [];

    const html = await res.text();
    
    // Parse Next.js Hydration state
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const apolloState = nextData?.props?.pageProps?.apolloState || {};
        
        // Search through the Apollo normalization state for products
        const products = [];
        for (const key of Object.keys(apolloState)) {
          if (key.startsWith('Product:')) {
            const prod = apolloState[key];
            if (prod && prod.name) {
              const mrp = prod.price?.[0]?.mrp || prod.mrp || 0;
              const salePrice = prod.price?.[0]?.salePrice || prod.price || mrp;
              products.push({
                name: prod.name,
                brand: prod.manufacturer || 'Apollo Brand',
                mrp: parseFloat(mrp) || parseFloat(salePrice) || 0,
                packSize: prod.packSize || '10 tablets',
                url: `https://www.apollopharmacy.in${prod.url || ''}`,
                source: 'Apollo Pharmacy'
              });
            }
          }
        }
        if (products.length) return products;
      } catch (err) {
        console.error("Apollo Hydration Parse Error:", err);
      }
    }

    // Fallback: regex search for product schema in JSON-LD
    const ldJsonMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
    for (const match of ldJsonMatches) {
      try {
        const parsed = JSON.parse(match[1]);
        const items = parsed.itemListElement || parsed.offers || [];
        if (Array.isArray(items)) {
          const products = items.map(item => {
            const p = item.item || item;
            if (p.name && (p.offers?.price || p.price)) {
              return {
                name: p.name,
                brand: p.brand?.name || 'Apollo Brand',
                mrp: parseFloat(p.offers?.price || p.price) || 0,
                packSize: '10 tablets',
                url: p.url || url,
                source: 'Apollo Pharmacy'
              };
            }
          }).filter(Boolean);
          if (products.length) return products;
        }
      } catch {}
    }
  } catch (err) {
    console.error("Apollo scrape failed:", err.message);
  }
  return [];
}

/**
 * Scrapes Netmeds
 */
async function scrapeNetmeds(q, timeoutMs = 4000) {
  const url = `https://www.netmeds.com/catalogsearch/result?q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, {
      headers: getRandomHeader(),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return [];

    const html = await res.text();

    // Regex search for Netmeds products (embedded JSON-LD or html structural parse)
    const ldJsonMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
    const products = [];

    for (const match of ldJsonMatches) {
      try {
        const parsed = JSON.parse(match[1]);
        
        // Netmeds embeds itemList of products
        if (parsed['@type'] === 'ItemList' && Array.isArray(parsed.itemListElement)) {
          for (const item of parsed.itemListElement) {
            const p = item.item;
            if (p && p.name) {
              const offer = p.offers;
              const price = offer?.price || offer?.lowPrice || 0;
              products.push({
                name: p.name,
                brand: p.brand || 'Netmeds Brand',
                mrp: parseFloat(price) || 0,
                packSize: p.description || '10 tablets',
                url: p.image || url, // fallback URL
                source: 'Netmeds'
              });
            }
          }
        }
      } catch {}
    }

    if (products.length) return products;

    // Fallback: Regex parse for product titles and prices
    // Netmeds items: <span class="clsgetname">Name</span> ... <span id="final_price">*</span>
    const names = [...html.matchAll(/<span class="clsgetname">([\s\S]*?)<\/span>/g)].map(m => m[1].trim());
    const prices = [...html.matchAll(/<span id="final_price">₹?([\s\S]*?)<\/span>/g)].map(m => parseFloat(m[1]) || 0);
    const manufacturers = [...html.matchAll(/<span class="drug-manufacture">([\s\S]*?)<\/span>/g)].map(m => m[1].trim());

    const fallbackProducts = [];
    for (let i = 0; i < Math.min(names.length, prices.length); i++) {
      fallbackProducts.push({
        name: names[i],
        brand: manufacturers[i] || 'Generic',
        mrp: prices[i],
        packSize: '10 tablets',
        url,
        source: 'Netmeds'
      });
    }
    return fallbackProducts;
  } catch (err) {
    console.error("Netmeds scrape failed:", err.message);
  }
  return [];
}

/**
 * Scrapes DavaIndia API (High reliability generic DB)
 */
async function scrapeDavaIndia(q, timeoutMs = 4000) {
  const url = `https://www.davaindia.com/api/v1/products/search?query=${encodeURIComponent(q)}&limit=5`;
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENTS[0],
        'Referer': 'https://www.davaindia.com/',
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const products = data?.products || data?.data?.products || data?.results || [];
    
    return products.map(p => {
      const mrp = parseFloat(p.mrp || p.price || p.selling_price) || 0;
      return {
        name: p.name || p.product_name,
        brand: 'Jan Aushadhi / DavaIndia',
        mrp,
        packSize: p.pack_size || p.package_size || '10 tablets',
        url: `https://www.davaindia.com/product/${p.slug || ''}`,
        source: 'DavaIndia (Generic)'
      };
    }).filter(p => p.mrp > 0);
  } catch (err) {
    console.error("DavaIndia API fetch failed:", err.message);
  }
  return [];
}

/**
 * Scrapes 1mg (High reliability e-pharmacy API)
 */
async function scrape1mg(q, timeoutMs = 4000) {
  const url = `https://www.1mg.com/pharmacy_api_gateway/v4/drugs/search_by_name?name=${encodeURIComponent(q)}&per_page=10&page=1`;
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENTS[0]
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const records = data?.data?.attributes?.records || data?.records || data?.data || [];
    if (!Array.isArray(records)) return [];

    return records.map(r => {
      const mrp = parseFloat(r.mrp || r.price) || 0;
      const packSize = r.pack_size_label || r.pack_size || '10 tablets';
      return {
        name: r.name,
        brand: '1mg Brand',
        mrp,
        packSize,
        url: r.slug ? `https://www.1mg.com/drugs/${r.slug}` : null,
        source: '1mg'
      };
    }).filter(p => p.mrp > 0);
  } catch (err) {
    console.error("1mg API fetch failed:", err.message);
  }
  return [];
}

/**
 * Co-ordinates parallel scraping and returns unified list
 */
export async function scrapeMarketPrices(q) {
  if (!q || q.length < 3) return [];

  // Execute all scrapers concurrently
  const results = await Promise.allSettled([
    scrapeDavaIndia(q, 1000),
    scrapeApollo(q, 1200),
    scrapeNetmeds(q, 1200),
    scrape1mg(q, 1200)
  ]);

  const allProducts = [];
  for (const res of results) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      allProducts.push(...res.value);
    }
  }

  // Filter and score products by relevance to match salt composition
  const qLower = q.toLowerCase();
  const qWords = qLower.split(/\s+/).filter(w => w.length > 2);

  const scored = allProducts
    .map(p => {
      const nameLower = p.name.toLowerCase();
      
      // Calculate matching score
      let matchCount = 0;
      for (const word of qWords) {
        if (nameLower.includes(word)) matchCount++;
      }
      const relevance = matchCount / qWords.length;
      return { ...p, relevance };
    })
    .filter(p => p.relevance > 0.3) // must match at least some words
    .sort((a, b) => b.relevance - a.relevance || a.mrp - b.mrp);

  return scored;
}
