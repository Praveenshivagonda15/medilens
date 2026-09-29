

let jaDB    = null
let cdscoDb = null
let loadPromise = null

function dataUrlFor(pathname) {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return new URL(pathname, window.location.origin).toString()
  }
  return new URL(`../../public${pathname}`, import.meta.url).toString()
}

async function readTextFromPublic(pathname) {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return fetch(dataUrlFor(pathname)).then(r => r.text())
  }
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const filePath = fileURLToPath(new URL(`../../public${pathname}`, import.meta.url))
  return readFileSync(filePath, 'utf8')
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return []
  if (lines[0].charCodeAt(0) === 0xFEFF) lines[0] = lines[0].slice(1)
  const headers = parseCSVLine(lines[0])
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line)
    const row = {}
    headers.forEach((h, i) => { row[h.trim().replace(/"/g, '')] = (vals[i] || '').trim().replace(/"/g, '') })
    return row
  }).filter(r => Object.values(r).some(v => v))
}
function parseCSVLine(line) {
  const out = []; let cur = ''; let inQ = false
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ }
    else if (ch === ',' && !inQ) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur); return out
}

export async function ensureLoaded() {
  if (jaDB && cdscoDb) return
  if (!loadPromise) loadPromise = Promise.all([
    readTextFromPublic('/data/jan_aushadhi.csv').then(parseCSV).then(d => { jaDB = d }),
    readTextFromPublic('/data/cdsco.csv').then(parseCSV).then(d => { cdscoDb = d }),
  ])
  await loadPromise
}

const SYNONYMS = {
  'amoxicillin':           'amoxycillin',
  'clavulanic acid':       'clavulanate',
  'potassium clavulanate': 'clavulanate',
  'cloxacillin sodium':    'cloxacillin',
  'frusemide':             'furosemide',
  'furosemide':            'frusemide',
  'lignocaine':            'lidocaine',
  'lidocaine':             'lignocaine',
  'acetaminophen':         'paracetamol',
  'salbutamol':            'albuterol',
  'albuterol':             'salbutamol',
  'acetylsalicylic acid':  'aspirin',
  'diclofenac sodium':     'diclofenac',
  'diclofenac potassium':  'diclofenac',
  'diclofenac diethylamine':'diclofenac',
  'losartan potassium':    'losartan',
  'atorvastatin calcium':  'atorvastatin',
  'metformin hydrochloride':'metformin',
}

function normName(raw) {
  let n = (raw || '').toLowerCase().trim()
  n = n.replace(/^\d+\s*|\s*\d+$/, '').trim()
  return SYNONYMS[n] || n
}

function formBucket(text) {
  const t = (text || '').toLowerCase()
  if (/\bgel\b|\bcream\b|\bointment\b|\blotion\b|\bshampoo\b|\bsoap\b|\btopical\b|\btubes?\b/.test(t)) return 'topical'
  if (/\binjection\b|\binfusion\b|\biv\b|\bampoules?\b|\bvials?\b/.test(t))                 return 'injection'
  if (/\bsuspension\b|\bsyrup\b|\bdrops?\b|\bsolution\b|\boral\s+liquid\b|\bper\s+\d+\s*ml\b|\bbottles?\b/.test(t)) return 'liquid'
  return 'solid'
}

const DRUG_PREFIX = /^(levo|dextro|nor|des|fos|s\s*[-\s]|r\s*[-\s]|methyl|ethyl|iso|neo)\s*/i

const STRIP_WORDS = /\b(tablets?|capsules?|injection|syrup|oral|per|suspension|drops?|infusion|solution|cream|ointment|gel|spray|lotion|shampoo|paediatric|prolonged|sustained|modified|extended|gastro|resistant|resistance|ip|bp|usp|sr|er|xr|mr|forte|plus|ml|gm|hydrochloride|dihydrochloride|hcl|hbr|sulphate|sulfate|phosphate|maleate|tartrate|mesylate|acetate|citrate|gluconate|nitrate|fumarate|release|tablet|capsule|trihydrate|monohydrate|anhydrous|dispersible|enteric|coated|origin|dna|rdna|w\/w|w\/v|v\/v)\b/gi

export function parseSalts(text, formText = '') {
  if (!text) return []

  if (/\bcombipack\b/i.test(text)) return []

  const form = formBucket(text + ' ' + formText)

  let t = text.replace(/\(([^)]*\b\d+\s*(?:mg|mcg|g|iu|%)\b[^)]*)\)/gi, ' $1 ')
  t = t.replace(/\([^)]*\)/g, ' ')
  t = t.replace(/\b\d+%\/\d+%/g, ' ')

  return t
    .split(/\band\b|,|\+|&/i)
    .map(part => {
      const dm = part.match(/(\d+\.?\d*)\s*(mg|mcg|g|iu|%)/i)
      const dose = dm ? parseFloat(dm[1]) : null
      let name = part
        .replace(/(\d+\.?\d*)\s*(mg|mcg|g|iu|%)/gi, '')
        .replace(STRIP_WORDS, '')
        .replace(/[^a-zA-Z\s()]/g, ' ')
        .replace(/\s+/g, ' ').trim().toLowerCase()
      name = normName(name)
      return name.length > 2 ? { name, dose, form } : null
    }).filter(Boolean)
}

function saltNameMatch(a, b) {
  const na = normName(a), nb = normName(b)
  if (na === nb) return true

  const aHasPrefix = DRUG_PREFIX.test(na)
  const bHasPrefix = DRUG_PREFIX.test(nb)
  if (aHasPrefix !== bHasPrefix) return false

  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('\\b' + esc(na) + '\\b', 'i').test(nb) ||
         new RegExp('\\b' + esc(nb) + '\\b', 'i').test(na)
}

export function matchQuality(qSalts, pSalts) {
  if (!qSalts.length || !pSalts.length) return 'blocked'

  if (qSalts.every(s => s.dose == null)) return 'no_dose'

  if (qSalts[0].form !== pSalts[0].form) return 'blocked'

  for (const qs of qSalts) {
    if (!pSalts.some(ps => saltNameMatch(qs.name, ps.name))) return 'blocked'
  }
  for (const ps of pSalts) {
    if (!qSalts.some(qs => saltNameMatch(qs.name, ps.name))) return 'blocked'
  }

  const isCombo = qSalts.length > 1
  const tol = isCombo ? 0.05 : 0.10

  let hasMismatch = false
  for (const qs of qSalts) {
    const ps = pSalts.find(p => saltNameMatch(qs.name, p.name))
    if (!ps?.dose) continue
    const ratio = ps.dose / qs.dose
    if (ratio < (1 - tol) || ratio > (1 + tol)) hasMismatch = true
  }

  return hasMismatch ? 'dose_mismatch' : 'exact'
}

function perUnit(mrp, unitSize) {
  if (!mrp || !unitSize) return null
  const n = unitSize.match(/(\d+)/)
  let count = 1
  if (n) {
    count = parseInt(n[1])
  } else if (/pair/i.test(unitSize)) {
    count = 2
  }
  return count > 0 ? Math.round(mrp / count * 100) / 100 : null
}

function inferUnitLabel(packStr) {
  if (!packStr) return 'tablet'
  const s = packStr.toLowerCase()
  if (/\b(ml|l)\b|liquid|syrup|suspension|drops?\b/.test(s)) return 'ml'
  if (/\b(gm|g|kg)\b|cream|gel|ointment|lotion/.test(s)) return 'gm'
  if (/capsule/.test(s)) return 'capsule'
  if (/sachet/.test(s))  return 'sachet'
  if (/patch/.test(s))   return 'patch'
  if (/vial|ampoule/.test(s)) return 'vial'
  return 'tablet'
}

function srPenalty(productName, queryRaw) {
  const q = (queryRaw || '').toLowerCase()
  const wantsSR = /\bsr\b|\ber\b|\bxr\b|\bprolonged\b|\bsustained\b|\bextended\b/.test(q)
  if (wantsSR) return 0
  return /\bprolonged\b|\bsustained\b|\bextended\b|\bmodified\b/.test(productName.toLowerCase()) ? 1 : 0
}

export function lookupJanAushadhi(saltComposition, brandedMrp, brandedUnitSize) {
  if (!jaDB || !saltComposition) return { best: null, doseMismatch: null, noDose: false }
  const qSalts = parseSalts(saltComposition, brandedUnitSize)
  if (!qSalts.length) return { best: null, doseMismatch: null, noDose: false }

  if (!qSalts.every(s => s.dose != null)) {
    return { best: null, doseMismatch: null, noDose: true }
  }

  const brandedPU = brandedMrp && brandedUnitSize
    ? perUnit(parseFloat(brandedMrp), brandedUnitSize)
    : brandedMrp ? parseFloat(brandedMrp) / 10 : null

  const exact = [], doseMismatch = []

  for (const row of jaDB) {
    const pSalts = parseSalts(row['Generic Name'] || '')
    const quality = matchQuality(qSalts, pSalts)
    if (quality === 'blocked') continue
    const mrp = parseFloat(row['MRP']) || null
    if (!mrp) continue

    const pu = perUnit(mrp, row['Unit Size'])
    let savings = null
    if (brandedPU && pu) {
      const pct = Math.round((1 - pu / brandedPU) * 100)
      const unitLabel = inferUnitLabel(row['Unit Size'] || brandedUnitSize)
      savings = pct > 5 ? `${pct}% cheaper per ${unitLabel}` : null
    }

    const entry = {
      name:        row['Generic Name'],
      salt:        saltComposition,
      unitSize:    row['Unit Size'],
      mrp, perUnit: pu, savings,
      srPenalty:   srPenalty(row['Generic Name'], saltComposition),
      isJanAushadhi: true,
      aiEstimated:   false,
      brand:         'BPPI Jan Aushadhi',
      availableAt:   'Jan Aushadhi Kendra',
      storeLocator:  'https://janaushadhi.gov.in/near-by-kendra',
    }

    if (quality === 'exact') exact.push(entry)
    else doseMismatch.push(entry)
  }

  exact.sort((a, b) => a.srPenalty - b.srPenalty || a.mrp - b.mrp)
  doseMismatch.sort((a, b) => a.srPenalty - b.srPenalty || a.mrp - b.mrp)

  const best   = exact[0]        ? (({ srPenalty: _, ...e }) => e)(exact[0])        : null
  const dmBest = doseMismatch[0] ? (({ srPenalty: _, ...e }) => e)(doseMismatch[0]) : null
  return { best, doseMismatch: dmBest, noDose: false }
}

export function lookupCDSCO(saltComposition) {
  if (!cdscoDb || !saltComposition) return { found: false, badge: null }
  const qSalts = parseSalts(saltComposition)
  if (!qSalts.length) return { found: false, badge: null }
  const primary = qSalts[0].name
  const matches = cdscoDb.filter(row =>
    primary.length > 4 && (row['Drug Name'] || '').toLowerCase().includes(primary)
  )
  if (!matches.length) return { found: false, badge: null }
  const best = matches.find(r => r['Indication'] && !/^additional/i.test(r['Indication'])) || matches[0]
  let indication = (best['Indication'] || '')
    .replace(/^(for\s+)?(the\s+)?(treatment|management)\s+of\s+/i, '')
    .replace(/^as\s+an?\s+/i, '').trim()
  if (indication.length > 80) indication = indication.slice(0, 80) + '...'
  const displayName = primary.charAt(0).toUpperCase() + primary.slice(1)
  return { found: true, badge: ` ${displayName} is CDSCO-approved`, indication: indication || null }
}

export function pharmacyLinks(saltComposition) {
  if (!saltComposition) return []
  const q = encodeURIComponent(saltComposition)
  return [
    { name: 'Netmeds',   url: `https://www.netmeds.com/products/?q=${q}` },
    { name: 'Apollo',    url: `https://www.apollopharmacy.in/search-medicines/${q}` },
    { name: '1mg',       url: `https://www.1mg.com/search/all?name=${q}` },
    { name: 'DavaIndia', url: `https://www.davaindia.com/search/all?search=${q}` },
  ]
}

export function buildSavingsSummary(best, brandedMrp, brandedUnitSize) {
  if (!best?.mrp) return null
  const brandedPU = brandedMrp && brandedUnitSize ? perUnit(parseFloat(brandedMrp), brandedUnitSize) : null
  const jaPU = best.perUnit
  if (brandedPU && jaPU && brandedPU > jaPU) {
    const pct = Math.round((1 - jaPU / brandedPU) * 100)
    const unitLabel = inferUnitLabel(brandedUnitSize || best.unitSize)
    return pct > 5 ? `₹${jaPU}/${unitLabel} vs ₹${brandedPU}/${unitLabel} branded - ${pct}% cheaper.` : null
  }
  return `Jan Aushadhi: ₹${best.mrp} for ${best.unitSize}.`
}
