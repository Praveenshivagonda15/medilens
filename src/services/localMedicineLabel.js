const KNOWN_BRANDS = {
  'dolo 650': { brandName: 'Dolo 650', saltComposition: 'Paracetamol 650mg' },
  dolo650: { brandName: 'Dolo 650', saltComposition: 'Paracetamol 650mg' },
  crocin: { brandName: 'Crocin', saltComposition: 'Paracetamol 500mg' },
  calpol: { brandName: 'Calpol', saltComposition: 'Paracetamol 500mg' },
  panadol: { brandName: 'Panadol', saltComposition: 'Paracetamol 500mg' },
  sumo: { brandName: 'Sumo', saltComposition: 'Paracetamol 500mg' },
  augumentin: { brandName: 'Augmentin', saltComposition: 'Amoxicillin 500mg + Clavulanate 125mg' },
  augmentin: { brandName: 'Augmentin', saltComposition: 'Amoxicillin 500mg + Clavulanate 125mg' },
  telma: { brandName: 'Telma', saltComposition: 'Telmisartan 40mg' },
  rosuvas: { brandName: 'Rosuvas', saltComposition: 'Rosuvastatin 10mg' },
  atorva: { brandName: 'Atorva', saltComposition: 'Atorvastatin 10mg' },
  zita: { brandName: 'Zita', saltComposition: 'Amlodipine 5mg' },
  metformin: { brandName: 'Metformin', saltComposition: 'Metformin 500mg' },
  omeprazole: { brandName: 'Omeprazole', saltComposition: 'Omeprazole 20mg' },
  pantop: { brandName: 'Pantop', saltComposition: 'Pantoprazole 40mg' },
  pantoprazole: { brandName: 'Pantoprazole', saltComposition: 'Pantoprazole 40mg' },
  domstal: { brandName: 'Domstal', saltComposition: 'Domperidone 10mg' },
  ody: { brandName: 'Ody', saltComposition: 'Domperidone 10mg' },
  combo: { brandName: 'Combo', saltComposition: 'Paracetamol 500mg' },
}

function normalizeText(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function resolveKnownMedicineBrand(text) {
  const normalized = normalizeText(text)
  const aliases = Object.keys(KNOWN_BRANDS).sort((a, b) => b.length - a.length)

  for (const alias of aliases) {
    const normalizedAlias = normalizeText(alias)
    if (` ${normalized} `.includes(` ${normalizedAlias} `)) {
      return { ...KNOWN_BRANDS[alias] }
    }
  }

  const textTokens = normalized.split(/\s+/).filter(Boolean)
  for (const alias of aliases) {
    const aliasTokens = normalizeText(alias).split(/\s+/).filter(Boolean)
    const usedTokens = new Set()
    const matchesAlias = aliasTokens.every(aliasToken => {
      const matchIndex = textTokens.findIndex((textToken, index) =>
        !usedTokens.has(index) && isCloseOcrToken(aliasToken, textToken, 1)
      )
      if (matchIndex < 0) return false
      usedTokens.add(matchIndex)
      return true
    })
    if (matchesAlias) return { ...KNOWN_BRANDS[alias] }
  }

  return null
}

export function hasMedicineLabelEvidence(text, labelDetails = {}) {
  if (Object.values(labelDetails).some(Boolean)) return true
  return /\b(?:tablets?|capsules?|pills?|syrup|suspension|injection|vial|ampoule|drops?|ointment|cream|gel|composition|active ingredient|each tablet|each capsule|mrp|batch|expiry|exp|mfg|manufactured|\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|iu|ml))\b/i.test(text || '')
}

export function selectBestMedicineOcrText(processedText, originalText) {
  const score = (text) => {
    if (!text?.trim()) return -1
    const details = extractLocalLabelDetails(text)
    const detailCount = Object.values(details).filter(Boolean).length
    const labelCueCount = (text.match(/\b(?:tablet|capsule|syrup|injection|composition|mrp|batch|expiry|exp|mfg|manufactured|licence|license)\b/gi) || []).length
    return (resolveKnownMedicineBrand(text) ? 1000 : 0) + detailCount * 40 + labelCueCount * 10 + Math.min(text.length, 1000) / 1000
  }

  return score(originalText) > score(processedText) ? originalText : processedText
}

const NON_INGREDIENT_TOKENS = new Set([
  'tablet', 'tablets', 'capsule', 'capsules', 'injection', 'syrup', 'suspension', 'ointment', 'cream', 'gel',
  'hydrochloride', 'dihydrochloride', 'hydrobromide', 'sulphate', 'sulfate', 'phosphate', 'maleate', 'tartrate',
  'mesylate', 'acetate', 'citrate', 'gluconate', 'nitrate', 'fumarate', 'bicarbonate', 'carbonate',
  'sodium', 'potassium', 'calcium', 'magnesium', 'monohydrate', 'trihydrate', 'anhydrous', 'equivalent',
  'contains', 'each', 'uncoated', 'coated', 'extended', 'release', 'sustained', 'modified', 'prolonged',
  'prepared', 'precipitated', 'sterile', 'oral', 'topical', 'additional', 'strength', 'ip', 'bp', 'usp'
])

function labelTokens(text) {
  return (text || '').toLowerCase().match(/[a-z]{3,}/g) || []
}

function isCloseOcrToken(expected, actual, maxDistance = 2) {
  if (Math.abs(expected.length - actual.length) > 2) return false
  let previous = Array.from({ length: actual.length + 1 }, (_, index) => index)
  for (let i = 1; i <= expected.length; i++) {
    const current = [i]
    for (let j = 1; j <= actual.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (expected[i - 1] === actual[j - 1] ? 0 : 1)
      )
    }
    previous = current
  }
  return previous[actual.length] <= maxDistance
}

export function hasCatalogIngredientMatch(ocrText, match) {
  const row = match?.row || match || {}
  const name = row['Generic Name'] || row['Drug Name'] || row.name || ''
  const ingredients = [...new Set(labelTokens(name).filter(token =>
    token.length >= 6 && !NON_INGREDIENT_TOKENS.has(token)
  ))]
  if (!ingredients.length) return false

  const ocrTokens = labelTokens(ocrText)
  return ingredients.every(ingredient => ocrTokens.some(token => isCloseOcrToken(ingredient, token)))
}

export function hasVerifiedMedicineEvidence({ text, labelDetails, knownBrand, catalogMatches = [] }) {
  if (!hasMedicineLabelEvidence(text, labelDetails)) return false
  return Boolean(knownBrand || catalogMatches.some(match => hasCatalogIngredientMatch(text, match)))
}

function parseExpiry(line) {
  const value = line.replace(/^.*?\b(?:exp(?:iry)?)(?:\s*date)?\b/i, ' ')
  const numeric = value.match(/\b(0?[1-9]|1[0-2])\s*[/.\-]\s*(20\d{2}|\d{2})\b/)
  if (numeric) {
    const year = numeric[2].length === 2 ? `20${numeric[2]}` : numeric[2]
    return `${numeric[1].padStart(2, '0')}/${year}`
  }

  const named = value.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s*[,.\-/]?\s*(20\d{2}|\d{2})\b/i)
  if (!named) return null

  const monthNumbers = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', SEPT: '09', OCT: '10', NOV: '11', DEC: '12' }
  const year = named[2].length === 2 ? `20${named[2]}` : named[2]
  return `${monthNumbers[named[1].toUpperCase().slice(0, named[1].startsWith('SEPT') ? 4 : 3)]}/${year}`
}

export function extractLocalLabelDetails(text) {
  const lines = (text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const details = {
    manufacturer: null,
    mrp: null,
    unitSize: null,
    batchNumber: null,
    expiryDate: null,
  }

  for (const line of lines) {
    if (details.manufacturer == null) {
      const manufacturer = line.match(/\b(?:manufactured|marketed|mfg\.?)\s+by\s*[:.-]?\s*([A-Z][A-Z0-9 &.,()'-]{2,})/i)
      if (manufacturer) details.manufacturer = manufacturer[1].replace(/[.,;\s]+$/, '').trim()
    }

    if (details.mrp == null && /\b(?:mrp|maximum retail price)\b/i.test(line)) {
      const price = line.match(/\b(?:mrp|maximum retail price)\b[^\d]{0,28}(\d{1,6}(?:[.,]\d{1,2})?)/i)
      if (price) details.mrp = Number(price[1].replace(',', '.'))
    }

    if (details.unitSize == null) {
      const count = line.match(/\b(\d{1,3})\s*(?:tablets?|capsules?)\b|\b(\d{1,3})\s*['’]s\b/i)
      if (count) details.unitSize = `${count[1] || count[2]} tablets`
    }

    if (details.batchNumber == null && /\b(?:batch|b\.?\s*no\.?|lot)\b/i.test(line)) {
      const batch = line.match(/\b(?:batch|b\.?\s*no\.?|lot)\s*(?:number|no\.?)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,})/i)
      if (batch) details.batchNumber = batch[1].replace(/[.,;]+$/, '')
    }

    if (details.expiryDate == null && /\bexp(?:iry)?\b/i.test(line)) {
      details.expiryDate = parseExpiry(line)
    }
  }

  return details
}

export function isExpiryMonthExpired(expiryDate, now = new Date()) {
  const match = (expiryDate || '').match(/^(\d{2})\/(\d{4})$/)
  if (!match) return false

  const expiryMonthEnd = new Date(Number(match[2]), Number(match[1]), 0, 23, 59, 59, 999)
  return expiryMonthEnd < now
}