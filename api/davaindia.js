/**
 * api/davaindia.js  -  Vercel serverless proxy for DavaIndia search
 *
 * Why a proxy: DavaIndia's search API returns JSON but requires same-origin
 * or at least doesn't set CORS headers for browser requests. This proxy
 * runs server-side (Vercel Edge) and returns the cheapest matching result.
 *
 * Route: GET /api/davaindia?q=Amoxycillin+500mg
 * Returns: { found: true, name, mrp, packSize, perUnit, priceSource } | { found: false }
 */

export default async function handler(req, res) {
  // CORS  -  allow our own Vercel domain + localhost dev
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const q = (req.query.q || '').trim()
  if (!q || q.length < 3) return res.status(400).json({ found: false, error: 'Query too short' })

  try {
    // DavaIndia search endpoint  -  returns JSON with product array
    const searchUrl = `https://www.davaindia.com/api/v1/products/search?query=${encodeURIComponent(q)}&limit=10`

    const response = await fetch(searchUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; MediLens/1.0)',
        'Referer': 'https://www.davaindia.com/',
      },
      signal: AbortSignal.timeout(6000),
    })

    if (!response.ok) {
      // If DavaIndia blocks or is down, return not-found gracefully
      return res.status(200).json({ found: false, reason: `upstream_${response.status}` })
    }

    const data = await response.json()

    // DavaIndia response shape (observed): { products: [...] } or { data: { products: [...] } }
    const products = data?.products || data?.data?.products || data?.results || []

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(200).json({ found: false, reason: 'no_results' })
    }

    // Find best match: prefer exact salt/name match, then cheapest
    const qLower = q.toLowerCase()
    const scored = products
      .filter(p => p && (p.mrp || p.price || p.selling_price))
      .map(p => {
        const nameLower = (p.name || p.product_name || p.title || '').toLowerCase()
        const saltLower = (p.salt_composition || p.composition || p.generic_name || '').toLowerCase()
        const mrp = parseFloat(p.mrp || p.price || p.selling_price) || 0
        const packSize = p.pack_size || p.package_size || p.quantity || ''
        const countMatch = packSize.match(/(\d+)/)
        const count = countMatch ? parseInt(countMatch[1]) : null
        const perUnit = (count && count > 0 && mrp > 0) ? Math.round(mrp / count * 100) / 100 : null

        // Relevance: both salt and name contain query fragments
        const qWords = qLower.split(/\s+/).filter(w => w.length > 3)
        const nameHits = qWords.filter(w => nameLower.includes(w)).length
        const saltHits = qWords.filter(w => saltLower.includes(w)).length
        const relevance = nameHits + saltHits * 1.5

        return { name: p.name || p.product_name || p.title, mrp, packSize, perUnit, relevance, saltComposition: p.salt_composition || p.composition || null }
      })
      .filter(p => p.mrp > 0 && p.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance || a.mrp - b.mrp)

    if (!scored.length) {
      return res.status(200).json({ found: false, reason: 'no_relevant_match' })
    }

    const best = scored[0]
    return res.status(200).json({
      found: true,
      name: best.name,
      mrp: best.mrp,
      packSize: best.packSize || null,
      perUnit: best.perUnit,
      saltComposition: best.saltComposition,
      priceSource: 'DavaIndia',
      highConfidence: true,
    })

  } catch (err) {
    // Never crash the app  -  degrade gracefully
    return res.status(200).json({ found: false, reason: 'proxy_error', detail: err.message })
  }
}
