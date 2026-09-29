

export async function fetchDavaIndiaPrice(saltComposition) {
  if (!saltComposition) return null
  if (typeof window === 'undefined') return null
  try {
    const searchQuery = saltComposition
      .replace(/\d+\.?\d*\s*(mg|mcg|g|iu|ml|%)/gi, '')
      .replace(/\band\b|\+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (searchQuery.length < 2) return null

    const url = `/api/prices?q=${encodeURIComponent(searchQuery)}`

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null

    const data = await res.json()
    if (!data || !data.found) return null

    return {
      found:          true,
      name:           data.name,
      mrp:            data.mrp,
      packSize:       data.packSize || null,
      perUnit:        data.perUnit  || null,
      productUrl:     data.url      || null,
      priceSource:    data.priceSource || 'Live Store',
      highConfidence: true,
    }
  } catch (err) {
    console.error("fetchDavaIndiaPrice failed:", err)
    return null
  }
}

export async function batchFetchDavaIndiaPrices(alts) {
  const map = new Map()
  if (!alts?.length) return map

  const results = await Promise.allSettled(
    alts.map(alt => fetchDavaIndiaPrice(alt.salt || alt.name))
  )

  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value?.found) {
      const key = alts[i].salt || alts[i].name
      map.set(key, result.value)
    }
  })

  return map
}
