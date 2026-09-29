

let ZXing = null

async function getZXing() {
  if (ZXing) return ZXing
  const m = await import('https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm')
  ZXing = m
  return ZXing
}

export async function readBarcode(fileOrString) {
  if (typeof fileOrString === 'string') {
    return parseAll(fileOrString.trim())
  }
  try {
    const { BrowserMultiFormatReader } = await getZXing()
    const reader = new BrowserMultiFormatReader()
    const url = URL.createObjectURL(fileOrString)
    try {
      const result = await reader.decodeFromImageUrl(url)
      if (!result?.text) return null
      return parseAll(result.text.trim())
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch { return null }
}

export async function decodeBarcodeFromCanvas(canvas) {
  try {
    const { BrowserMultiFormatReader } = await getZXing()
    const reader = new BrowserMultiFormatReader()
    const result = await reader.decodeFromCanvas(canvas)
    return result?.text || null
  } catch {
    return null
  }
}

function parseEmergencyQR(raw) {
  if (!raw.includes('MEDILENS EMERGENCY MEDICAL ID')) return null
  const result = { isEmergencyCard: true }
  
  for (const line of raw.split('\n')) {
    const cleanLine = line.trim()
    if (cleanLine.startsWith('Patient:')) {
      result.name = cleanLine.slice(8).trim()
    } else if (cleanLine.startsWith('Blood Group:')) {
      result.bloodGroup = cleanLine.slice(12).trim()
    } else if (cleanLine.startsWith('Allergies:')) {
      result.allergies = cleanLine.slice(10).trim()
    } else if (cleanLine.startsWith('Chronic Conditions:')) {
      result.chronicConditions = cleanLine.slice(19).trim()
    } else if (cleanLine.startsWith('Emergency Contact:')) {
      const contactVal = cleanLine.slice(18).trim()
      const phoneMatch = contactVal.match(/\((.+?)\)/)
      if (phoneMatch) {
        result.emergencyPhone = phoneMatch[1].trim()
        result.emergencyName = contactVal.replace(phoneMatch[0], '').trim()
      } else {
        result.emergencyName = contactVal
      }
    }
  }
  return result
}

function parseAll(raw) {
  if (!raw) return null
  const parsed = parseEmergencyQR(raw) || parseGS1(raw) || parsePipeText(raw) || parseKVText(raw) || parseURLQR(raw)
  if (!parsed || !Object.keys(parsed).length) return null
  if (parsed.expiryDate) parsed.isExpired = isExpired(parsed.expiryDate)
  if (parsed.saltFromQR) {
    parsed.saltFromQR = parsed.saltFromQR.replace(/\s+/g, ' ').trim()
      .replace(/\b\w/g, c => c.toUpperCase())
  }
  return { raw, ...parsed }
}

function parseGS1(raw) {
  const result = {}
  const parenMatches = [...raw.matchAll(/\((\d{2,3})\)([^(]+)/g)]
  if (parenMatches.length) {
    for (const [, ai, val] of parenMatches) applyAI(result, ai, val.trim())
    if (Object.keys(result).length) return result
  }
  const raw01 = raw.match(/^01(\d{14})/)
  if (raw01) {
    result.gtin = raw01[1]
    const rest = raw.slice(16)
    const b = rest.match(/10([A-Z0-9\-]{1,20})/); if (b) result.batchNumber = b[1]
    const e = rest.match(/17(\d{6})/); if (e) result.expiryDate = fmt6(e[1])
    const d = rest.match(/240(.{4,60})/); if (d) { result.productDescription = d[1].trim(); extractSalt(d[1].trim(), result) }
    return Object.keys(result).length ? result : null
  }
  return null
}

function applyAI(result, ai, val) {
  if (ai === '01')  result.gtin = val
  if (ai === '10')  result.batchNumber = val
  if (ai === '17')  result.expiryDate = fmt6(val)
  if (ai === '21')  result.serialNumber = val
  if (ai === '11')  result.manufacturingDate = fmt6(val)
  if (ai === '240') { result.productDescription = val; extractSalt(val, result) }
}

function extractSalt(desc, result) {
  const branded = desc.match(/^(.+?)\s*\((.+?)\)/)
  if (branded) { result.brandFromQR = branded[1].trim(); result.saltFromQR = branded[2].trim(); return }
  const clean = desc.replace(/\b(tablets?|capsules?|injection|syrup|oral|suspension|drops?|solution|infusion|cream|ip|bp|usp|sr|er)\b/gi, '').replace(/\s+/g, ' ').trim()
  if (clean.length > 3) result.saltFromQR = clean
}

function parsePipeText(raw) {
  if (!raw.includes('|') && !raw.includes(';')) return null
  const result = {}
  for (const part of raw.split(/[|;]/)) {
    const ci = part.indexOf(':'); if (ci < 0) continue
    const k = part.slice(0, ci).trim().toLowerCase()
    const v = part.slice(ci + 1).trim()
    if (!v) continue
    if (['brand','product','name'].includes(k))           result.brandFromQR = v
    if (['salt','composition','ingredient'].includes(k))  result.saltFromQR  = v
    if (['batch','lot'].includes(k))                      result.batchNumber = v
    if (['exp','expiry','expires'].includes(k))           result.expiryDate  = v
    if (['mrp','price'].includes(k))                      result.mrpFromQR   = parseFloat(v) || null
    if (['mfg','manufacturer'].includes(k))               result.manufacturer = v
    if (['pack','size','units'].includes(k))              result.unitSize    = v
  }
  return Object.keys(result).length ? result : null
}

function parseKVText(raw) {
  const result = {}
  for (const line of raw.split(/\n/)) {
    const m = line.match(/^([A-Za-z\s]+?)\s*[:\-]\s*(.+)$/)
    if (!m) continue
    const [, k, v] = m; const kl = k.trim().toLowerCase()
    if (kl.includes('batch') || kl.includes('lot')) result.batchNumber = v.trim()
    if (kl.includes('exp'))                         result.expiryDate  = v.trim()
    if (kl.includes('mrp') || kl.includes('price')) result.mrpFromQR  = parseFloat(v) || null
    if (kl.includes('salt') || kl.includes('comp')) result.saltFromQR = v.trim()
    if (kl.includes('brand'))                       result.brandFromQR = v.trim()
  }

  const first = raw.split('\n')[0]?.trim()
  if (!result.saltFromQR && first && /\d+\s*(mg|mcg|g|ml)/i.test(first)) extractSalt(first, result)
  return Object.keys(result).length ? result : null
}

function parseURLQR(raw) {
  if (!raw.startsWith('http')) return null
  try {
    const path = new URL(raw).pathname.replace(/[\/\-_]/g, ' ').trim()
    const result = { productUrl: raw }
    if (/\d+(mg|mcg|g)/i.test(path)) extractSalt(path, result)
    return Object.keys(result).length > 1 ? result : null
  } catch { return null }
}

function fmt6(s) {
  if (!s || s.length < 6) return s
  const yy = s.slice(0,2), mm = s.slice(2,4), dd = s.slice(4,6)
  const year = parseInt(yy) > 50 ? `19${yy}` : `20${yy}`
  return dd === '00' ? `${mm}/${year}` : `${dd}/${mm}/${year}`
}

function isExpired(d) {
  try {
    const p = d.split('/')
    const dt = p.length === 3 ? new Date(`${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`)
             : p.length === 2 ? new Date(`${p[1]}-${p[0].padStart(2,'0')}-01`) : null
    return dt ? dt < new Date() : false
  } catch { return false }
}
