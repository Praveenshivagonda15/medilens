/**
 * api/prices.js  -  MediLens Price Engine
 * 
 * Strategy:
 * 1. Local Jan Aushadhi database - fastest, most reliable
 * 2. Groq AI fallback (strict no-hallucination)
 * 
 * Uses ESM (export default) because package.json has "type": "module"
 */

const GROQ_KEYS = [
  process.env.GROQ_KEY_1,
  process.env.GROQ_KEY_2,
  process.env.GROQ_KEY_3,
  process.env.GROQ_KEY_4,
  process.env.GROQ_KEY_5,
  process.env.GROQ_KEY,
].filter(Boolean)

// ─── Local Jan Aushadhi Data ───────────────────────────────────────────────
const JAN_AUSHADHI_DB = [
  { salt: 'Paracetamol 500mg', name: 'Paracetamol 500mg', mrp: 2.5, pack: '10 tablets', generic: true },
  { salt: 'Paracetamol 650mg', name: 'Paracetamol 650mg', mrp: 3.0, pack: '10 tablets', generic: true },
  { salt: 'Ibuprofen 400mg', name: 'Ibuprofen 400mg', mrp: 2.0, pack: '10 tablets', generic: true },
  { salt: 'Cetirizine 10mg', name: 'Cetirizine 10mg', mrp: 2.5, pack: '10 tablets', generic: true },
  { salt: 'Metformin 500mg', name: 'Metformin 500mg', mrp: 5.0, pack: '10 tablets', generic: true },
  { salt: 'Metformin 850mg', name: 'Metformin 850mg', mrp: 7.5, pack: '10 tablets', generic: true },
  { salt: 'Amlodipine 5mg', name: 'Amlodipine 5mg', mrp: 4.0, pack: '10 tablets', generic: true },
  { salt: 'Atenolol 50mg', name: 'Atenolol 50mg', mrp: 4.0, pack: '14 tablets', generic: true },
  { salt: 'Omeprazole 20mg', name: 'Omeprazole 20mg', mrp: 5.0, pack: '10 capsules', generic: true },
  { salt: 'Pantoprazole 40mg', name: 'Pantoprazole 40mg', mrp: 7.0, pack: '10 tablets', generic: true },
  { salt: 'Azithromycin 500mg', name: 'Azithromycin 500mg', mrp: 15.0, pack: '3 tablets', generic: true },
  { salt: 'Amoxycillin 500mg', name: 'Amoxycillin 500mg', mrp: 15.0, pack: '10 capsules', generic: true },
  { salt: 'Ciprofloxacin 500mg', name: 'Ciprofloxacin 500mg', mrp: 18.0, pack: '10 tablets', generic: true },
  { salt: 'Diclofenac 50mg', name: 'Diclofenac 50mg', mrp: 3.0, pack: '10 tablets', generic: true },
  { salt: 'Ranitidine 150mg', name: 'Ranitidine 150mg', mrp: 3.0, pack: '10 tablets', generic: true },
  { salt: 'Losartan 50mg', name: 'Losartan 50mg', mrp: 5.0, pack: '10 tablets', generic: true },
  { salt: 'Atorvastatin 10mg', name: 'Atorvastatin 10mg', mrp: 8.0, pack: '10 tablets', generic: true },
  { salt: 'Clotrimazole 1%', name: 'Clotrimazole Cream', mrp: 15.0, pack: '15g', generic: true },
  { salt: 'ORS', name: 'Oral Rehydration Salts', mrp: 20.0, pack: '1 sachet', generic: true },
]

function normalizeSalt(salt) {
  return salt.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function lookupLocal(saltQuery) {
  const q = normalizeSalt(saltQuery)
  const qWords = q.split(' ').filter(w => w.length > 2)
  
  let best = null
  let bestScore = 0
  
  for (const item of JAN_AUSHADHI_DB) {
    const itemNorm = normalizeSalt(item.salt)
    let score = 0
    for (const w of qWords) {
      if (itemNorm.includes(w)) score++
    }
    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }
  
  if (bestScore > 0) {
    const count = parseInt(best.pack) || 10
    return {
      found: true,
      name: best.name,
      mrp: best.mrp,
      packSize: best.pack,
      perUnit: Math.round(best.mrp / count * 100) / 100,
      priceSource: 'Jan Aushadhi (Local DB)',
      highConfidence: true,
      aiEstimated: false,
      generic: best.generic,
    }
  }
  return null
}

async function askGroqForPrice(q) {
  const prompt = `Indian medicine price lookup. Return ONLY JSON.
Medicine: "${q}"

Rules:
- Only return price if HIGHLY CONFIDENT (±20% of actual MRP)
- Use knowledge of Indian pharmacy prices
- If unsure, return {"found":false}

Format: {"found":true,"name":"Brand Name","mrp":50,"packSize":"10 tablets","perUnit":5,"priceSource":"AI Estimate","confidence":70,"aiEstimated":true}`

  for (const key of GROQ_KEYS) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 200,
          temperature: 0.0,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: AbortSignal.timeout(10000),
      })
      if (r.status === 429 || r.status === 401) continue
      if (!r.ok) continue
      
      const data = await r.json()
      const raw = data?.choices?.[0]?.message?.content || ''
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const parsed = JSON.parse(cleaned)
      
      if (parsed?.found && parsed.mrp > 0 && (parsed.confidence || 0) >= 60) {
        return { ...parsed, highConfidence: false, aiEstimated: true }
      }
    } catch { continue }
  }
  return { found: false }
}

import { scrapeMarketPrices } from './scraperCluster.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') { res.status(200).end(); return }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  const q = (req.query.q || '').trim()
  if (!q || q.length < 2) { res.status(400).json({ found: false, error: 'Query too short' }); return }

  // 1. Try local Jan Aushadhi DB first (fastest)
  const local = lookupLocal(q)
  if (local) {
    return res.status(200).json(local)
  }

  // 2. Try the Live Scraper Cluster to query e-pharmacies concurrently
  try {
    const scrapedResults = await scrapeMarketPrices(q)
    if (scrapedResults.length > 0) {
      const best = scrapedResults[0]
      const packSizeStr = best.packSize || ''
      const numMatch = packSizeStr.match(/(\d+)/)
      let count = 1
      if (numMatch) {
        count = parseInt(numMatch[1])
      } else if (/pair/i.test(packSizeStr)) {
        count = 2
      }
      return res.status(200).json({
        found: true,
        name: best.name,
        mrp: best.mrp,
        packSize: best.packSize,
        perUnit: count > 0 ? Math.round((best.mrp / count) * 100) / 100 : best.mrp,
        priceSource: `${best.source} (Live Scrape)`,
        highConfidence: true,
        aiEstimated: false,
        url: best.url,
      })
    }
  } catch (err) {
    console.error("Scraper cluster failed inside prices api:", err)
  }

  // 3. Try Groq AI (fallback)
  if (GROQ_KEYS.length) {
    const groqResult = await askGroqForPrice(q)
    if (groqResult?.found) {
      return res.status(200).json(groqResult)
    }
  }

  // 4. Not found
  return res.status(200).json({ found: false, reason: 'no_results', query: q })
}