

import { ensureLoaded, lookupJanAushadhi, lookupCDSCO, buildSavingsSummary, parseSalts } from './dbService.js'
import { logAIResponse } from './debugLog.js'
import { batchFetchDavaIndiaPrices } from './davaIndiaService.js'
import { resolveKnownMedicineBrand } from './localMedicineLabel.js'

const VISION_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
]

const TEXT_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'llama-3.1-8b-instant',
  'gemma2-9b-it',
]

const GROQ_PROXY = '/api/groq'

let keyIndex = 0

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

export async function resolveOfflineQuery(rawQuery) {
  const query = (rawQuery || '').trim()
  if (!query) return { brandName: '', saltComposition: '' }

  const knownBrand = resolveKnownMedicineBrand(query)
  if (knownBrand) {
    return {
      brandName: query,
      saltComposition: knownBrand.saltComposition,
    }
  }

  try {
    const text = await readTextFromPublic('/data/jan_aushadhi.csv')
    const lines = text.split(/\r?\n/).filter(line => line.trim())
    if (!lines.length) return { brandName: query, saltComposition: query }

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
    let best = null

    for (const line of lines.slice(1)) {
      const vals = []
      let cur = ''
      let inQ = false
      for (const ch of line) {
        if (ch === '"') inQ = !inQ
        else if (ch === ',' && !inQ) { vals.push(cur); cur = '' }
        else cur += ch
      }
      vals.push(cur)

      const row = {}
      headers.forEach((h, idx) => { row[h] = (vals[idx] || '').trim().replace(/"/g, '') })
      const generic = (row['Generic Name'] || '').toLowerCase()
      const haystack = `${generic} ${row['Group Name'] || ''}`.toLowerCase()
      const hitCount = haystack.split(/\s+/).filter(token => token && key.includes(token)).length
      if (!hitCount && !generic.includes(key)) continue

      const score = generic.includes(key) ? 10 : hitCount * 2
      if (!best || score > best.score) {
        best = { score, saltComposition: row['Generic Name'] || query }
      }
    }

    if (best) {
      return {
        brandName: query,
        saltComposition: best.saltComposition,
      }
    }
  } catch {
    // intentionally silent; we keep the original query as fallback below
  }

  return {
    brandName: query,
    saltComposition: query,
  }
}

const IMAGE_READ_PROMPT = `Medicine label reader. Extract ONLY what is printed. No advice.

SALT NAME: Drug name only, NO dose (e.g. "Amoxycillin" not "Amoxycillin 500mg"). Copy exactly.
DOSE: Numbers + unit only (e.g. "500mg" or "500mg + 125mg"). Use + to join multiple doses.
MULTILINE: Salt name and dose are often on separate lines or inside parentheses on the next line. Read across ALL lines - do not treat a line break as meaning the dose is absent. Example: "Mavyret\n(glecaprevir and pibrentasvir)\n100mg/40mg" → saltName="glecaprevir and pibrentasvir", doseStr="100mg/40mg".
DOSE SEPARATORS: doses may be separated by /, +, or commas - treat all as multi-dose. "100mg/40mg" = two doses.
If dose not visible on a MEDICINE or INJECTION label after reading ALL text on the image: doseStr=null, cannotRead=true, cannotReadReason="Dose not visible on label".
For TOPICAL, LIQUID, AYURVEDIC, SUPPLEMENT: dose is often absent by design - set doseStr=null but do NOT set cannotRead=true just because dose is missing.
If label totally unreadable: saltName=null, doseStr=null, confidence<50, cannotRead=true.
TORN/BLURRY/BOTTLE: Read what IS visible. cannotRead=true only if zero text legible.
BACK OF PACK / CONTENTS PAGE: If the image shows the back or side of a pack with an ingredients or composition table but no brand name - this is valid. Extract saltName and doseStr from the "Each tablet/capsule contains" or "Composition" section. List only the ACTIVE ingredients (ignore excipients like starch, lactose, magnesium stearate). Set brandName=null if not visible. Do NOT set cannotRead=true just because the front of the pack is not shown.
Damaged areas: ignore for fake signals.
productType: INJECTION for injections, LIQUID for oral liquids/syrups/drops, TOPICAL for gels/creams/ointments, MEDICINE for oral solids that are prescription or OTC pharmaceutical drugs.
Set productType=SUPPLEMENT for vitamins, minerals, calcium, vitamin D3, omega-3, multivitamins, nutraceuticals, health supplements - even if they come as tablets or strips (e.g. Calxofine D3, Shelcal, Neurobion, Limcee). These have no mg dose requirement.
Set productType=HAZARDOUS if the item is a dangerous non-medicine that should NOT be consumed - e.g. acids (hydrochloric acid, sulphuric acid, acetic acid), hydrogen peroxide (H2O2), bleach, caustic soda, industrial solvents, disinfectants, pesticides, drain cleaners. These are harmful if ingested or misused.
Set productType=NOT_MEDICINE if the item is clearly NOT a medicine and NOT hazardous - e.g. adhesives (Fevibond, Fevicol), cosmetics, food products, stationery, household items. When in doubt and there is no salt/drug name visible, use NOT_MEDICINE.

Genuine signals (only list if actually SEEN): hologram, QR/barcode, govt MRP sticker, tamper seal, batch no, expiry, full address+PIN, licence no
Fake signals (only list if actually SEEN): pixelated text on clear image, font mismatch, missing MRP/batch/expiry on INTACT label

JSON only, no markdown:
{"productType":"MEDICINE|INJECTION|LIQUID|TOPICAL|AYURVEDIC|SUPPLEMENT","brandName":null,"saltName":null,"doseStr":null,"manufacturer":null,"mrp":null,"unitSize":null,"batchNumber":null,"expiryDate":null,"licenceNumber":null,"genuineSignalsFound":[],"fakeSignalsFound":[],"confidence":85,"cannotRead":false,"cannotReadReason":null}`

function mergeSaltDose(saltName, doseStr) {
  if (!saltName) return null
  if (!doseStr) return saltName
  const salts = saltName.split(/\band\b|\+/i).map(s => s.trim()).filter(Boolean)
  const doses  = doseStr.split(/\+|,|\/|\band\b/i).map(d => d.trim()).filter(Boolean)
  if (salts.length === doses.length) return salts.map((s, i) => `${s} ${doses[i]}`).join(' and ')
  if (salts.length === 1 && doses.length === 1) return `${salts[0]} ${doses[0]}`

  return `${saltName} ${doseStr}`
}

const SCHEDULE_RX = new Set([

  'alprazolam','clonazepam','diazepam','lorazepam','nitrazepam','triazolam',
  'midazolam','zolpidem','zopiclone','buprenorphine','tramadol','codeine',
  'morphine','oxycodone','fentanyl','pethidine','pentazocine','phenobarbitone',
  'phenobarbital','methylphenidate','modafinil',

  'amoxycillin','amoxicillin','azithromycin','ciprofloxacin','levofloxacin',
  'norfloxacin','ofloxacin','metronidazole','tinidazole','doxycycline',
  'clindamycin','cephalexin','cefixime','cefpodoxime','ceftriaxone','cefuroxime',
  'meropenem','piperacillin','vancomycin','rifampicin','isoniazid','ethambutol',
  'pyrazinamide','fluconazole','itraconazole','voriconazole','acyclovir',
  'oseltamivir','chloroquine','hydroxychloroquine','artemether','lumefantrine',
  'atorvastatin','rosuvastatin','simvastatin','metformin','glibenclamide',
  'glimepiride','sitagliptin','insulin','metoprolol','atenolol','amlodipine',
  'ramipril','enalapril','losartan','telmisartan','hydrochlorothiazide','furosemide',
  'frusemide','spironolactone','digoxin','warfarin','clopidogrel','aspirin',
  'atorvastatin','omeprazole','pantoprazole','rabeprazole','esomeprazole',
  'ondansetron','domperidone','metoclopramide','prednisolone','dexamethasone',
  'betamethasone','methylprednisolone','hydrocortisone','levothyroxine',
  'carbimazole','propylthiouracil','phenytoin','carbamazepine','valproate',
  'levetiracetam','gabapentin','pregabalin','amitriptyline','nortriptyline',
  'imipramine','fluoxetine','sertraline','escitalopram','paroxetine','venlafaxine',
  'duloxetine','mirtazapine','quetiapine','olanzapine','risperidone','haloperidol',
  'lithium','methotrexate','cyclophosphamide','imatinib','tamoxifen','letrozole',
  'norgestrel','ethinyloestradiol','ethinylestradiol','levonorgestrel','progesterone',
  'testosterone','sildenafil','tadalafil','vardenafil','finasteride','dutasteride',
  'allopurinol','colchicine','isotretinoin','acitretin','tacrolimus','cyclosporine',
  'mycophenolate','azathioprine','hydroxychloroquine','sulfasalazine','leflunomide',
])
const SCHEDULE_OTC = new Set([
  'paracetamol','ibuprofen','diclofenac','cetirizine','loratadine','fexofenadine',
  'levocetirizine','chlorpheniramine','diphenhydramine','antacid','ranitidine',
  'famotidine','dextromethorphan','guaifenesin','zinc','vitamin c','ascorbic acid',
  'vitamin d3','cholecalciferol','calcium','iron','folic acid','vitamin b12',
  'cyanocobalamin','vitamin b complex','multivitamin','magnesium','potassium',
  'oral rehydration','ors','povidone iodine','hydrogen peroxide','clotrimazole',
  'miconazole','terbinafine','permethrin','betadine','savlon',
])

function resolveRx(saltComposition, aiSaid) {
  if (!saltComposition) return aiSaid
  const s = saltComposition.toLowerCase()

  for (const drug of SCHEDULE_RX) {
    if (s.includes(drug)) return true
  }

  for (const drug of SCHEDULE_OTC) {
    if (s.includes(drug)) return false
  }

  return aiSaid
}

const mkDescPrompt = (brand, salt, type) =>
`Indian patient medicine info. Medicine: ${brand||'Unknown'} (${salt||'Unknown'}). Type: ${type||'MEDICINE'}.
PRESCRIPTION RULE: Set prescriptionRequired=true if this drug is Schedule H, H1, or X under Indian drug law (requires a doctor's prescription). Set false ONLY for genuinely OTC drugs (paracetamol, antacids, antihistamines, vitamins, minerals). When in doubt, set true.
No brand suggestions. General drug class only. JSON only:
{"whatItDoes":"2-3 plain sentences","howToTake":"general guidance","commonUses":["","",""],"prescriptionRequired":false,"sideEffects":["","",""],"importantWarnings":["",""],"overdoseRisk":"plain language","ayurvedicWarning":null,"supplementWarning":null,"doNotTakeWith":null}`

const mkGenericsPrompt = (salt, productType) => {
  const routeRule = productType === 'INJECTION'
    ? 'ONLY injectable forms (vial/ampoule/IV). NEVER tablets or oral forms.'
    : productType === 'LIQUID'
    ? 'ONLY oral liquid forms (syrup/suspension/drops). NEVER tablets or injections.'
    : productType === 'TOPICAL'
    ? 'ONLY topical forms (gel/cream/ointment/lotion). NEVER oral or injectable forms.'
    : 'ONLY oral solid forms (tablets/capsules). NEVER injections or topicals.'
  return `You are an Indian pharmacist. Patient needs: ${salt}
List up to 3 real branded generics sold at Indian chemists containing EXACTLY this salt at EXACTLY this dose. Nothing else.
${routeRule}
STRICT RULES - violating any rule means the product must be excluded:
1. The "salt" field in your response MUST be exactly: ${salt}
2. NEVER include a product unless you are certain it contains ${salt} as its ONLY active ingredient(s).
3. If a brand name sounds similar but contains a different salt - EXCLUDE IT.
4. If you are not sure a product is real - EXCLUDE IT. Return 1 item rather than fabricate 2 or 3.
5. EACH item must be from a DIFFERENT manufacturer.
6. The "brand" field MUST contain ONLY the clean, official manufacturer name (e.g. "GlaxoSmithKline", "Cipla", "Sun Pharma"). Do NOT include any explanations, justifications, meta-reasoning, or "for this example" comments. It must be a short name.
Use prices from Netmeds, Apollo Pharmacy, 1mg, DavaIndia as reference.
JSON array only, no markdown, 1-3 items:
[{"name":"Full Brand Name Strength","brand":"Manufacturer","salt":"${salt}","packSize":"10 tablets","estimatedMrp":25,"perUnit":2.5,"availableAt":"Any chemist","isJanAushadhi":false,"aiEstimated":true}]`
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

export async function scanMedicine(imageBase64, mimeType = 'image/jpeg', barcodeData = null) {

  const dbPromise = ensureLoaded().catch(() => {})

  const qrSalt     = barcodeData?.saltFromQR  || null
  const qrBrand    = barcodeData?.brandFromQR || null
  const qrBatch    = barcodeData?.batchNumber || null
  const qrExpiry   = barcodeData?.expiryDate  || null
  const qrMrp      = barcodeData?.mrpFromQR   || null

  const img = await callVision(imageBase64, mimeType, IMAGE_READ_PROMPT)

  if (img.productType === 'HAZARDOUS') {
    return {
      productType:     'HAZARDOUS',
      brandName:       img.brandName || null,
      saltComposition: null,
      manufacturer:    img.manufacturer || null,
      mrp:             null,
      unitSize:        null,
      batchNumber:     null,
      expiryDate:      null,
      isExpired:       false,
      licenceNumber:   null,
      confidence:      img.confidence || 90,
      saltSource:      'AI_VISION',
      cannotRead:      true,
      cannotReadReason: '️ DANGER: This appears to be a hazardous chemical - NOT a medicine. Do NOT consume or ingest this product. Keep away from children. In case of accidental ingestion, call Poison Control: 1800-116-117 (India, free).',
      authenticity:    { status: 'CANNOT_DETERMINE', reason: 'Hazardous substance - not a medicine.', genuineSignalsFound: [], fakeSignalsFound: [], cdscoBadge: null, warning: '️ HAZARDOUS SUBSTANCE - NOT FOR CONSUMPTION' },
      medicineInfo:    null,
      alternatives:    { hasGenerics: false, topAlternatives: [], pharmacyLinks: [] },
      dataSource:      { salt: 'N/A', alts: 'N/A', cdsco: 'N/A', cdscoFound: false },
    }
  }

  if (img.productType === 'NOT_MEDICINE') {
    return {
      productType:     'NOT_MEDICINE',
      brandName:       img.brandName || null,
      saltComposition: null,
      manufacturer:    img.manufacturer || null,
      mrp:             null,
      unitSize:        null,
      batchNumber:     null,
      expiryDate:      null,
      isExpired:       false,
      licenceNumber:   null,
      confidence:      img.confidence || 90,
      saltSource:      'AI_VISION',
      cannotRead:      true,
      cannotReadReason: 'This does not appear to be a medicine. MediLens only processes pharmaceutical products.',
      authenticity:    { status: 'CANNOT_DETERMINE', reason: 'Not a medicine.', genuineSignalsFound: [], fakeSignalsFound: [], cdscoBadge: null, warning: null },
      medicineInfo:    null,
      alternatives:    { hasGenerics: false, topAlternatives: [], pharmacyLinks: [] },
      dataSource:      { salt: 'N/A', alts: 'N/A', cdsco: 'N/A', cdscoFound: false },
    }
  }

  const mergedSalt  = mergeSaltDose(img.saltName, img.doseStr)
  const finalSalt   = qrSalt   || mergedSalt
  const finalBrand  = qrBrand  || img.brandName
  const finalBatch  = qrBatch  || img.batchNumber
  const finalExpiry = qrExpiry || img.expiryDate
  const finalMrp    = qrMrp    || img.mrp

  const typeNeedsDose = !img.productType || img.productType === 'MEDICINE' || img.productType === 'INJECTION'
  const hasDoseNumber = /\d+\s*(mg|mcg|g|iu)/i.test(finalSalt || '') || /\d+\s*(mg|mcg|g|iu)/i.test(img.doseStr || '')
  const hasSalt       = !!(finalSalt && finalSalt.trim().length > 3)

  const doseConfirmed = !!qrSalt || hasDoseNumber || !typeNeedsDose || hasSalt

  if (!doseConfirmed && !hasSalt) {
    img.cannotRead = true
    img.cannotReadReason = img.cannotReadReason || 'Could not read medicine name or dose. Try scanning a clearer image or the barcode.'
  } else {

    if (img.cannotRead && img.cannotReadReason && /dose/i.test(img.cannotReadReason)) {
      img.cannotRead = false
      img.cannotReadReason = null
    }
  }

  if (qrSalt) {
    img.genuineSignalsFound = [...(img.genuineSignalsFound || []), 'QR/barcode decoded - salt verified']
  }

  const expiryStr = finalExpiry
  const isExpired = expiryStr ? checkExpired(expiryStr) : false

  await dbPromise

  const jaLookup    = doseConfirmed ? lookupJanAushadhi(finalSalt, finalMrp, img.unitSize) : { best: null, doseMismatch: null, noDose: false }
  const cdscoResult = lookupCDSCO(finalSalt)
  const jaBest      = jaLookup.best
  const jaDoseDiff  = jaLookup.doseMismatch

  let info = null, aiGenerics = []
  if (finalSalt || finalBrand) {
    const [infoRes, genRes] = await Promise.allSettled([
      callText(mkDescPrompt(finalBrand, finalSalt, img.productType)),
      (finalSalt && doseConfirmed) ? callText(mkGenericsPrompt(finalSalt, img.productType)) : Promise.resolve(null),
    ])
    info = infoRes.status === 'fulfilled' ? infoRes.value : null

    if (info) info.prescriptionRequired = resolveRx(finalSalt, info.prescriptionRequired)
    if (genRes.status === 'fulfilled' && Array.isArray(genRes.value)) {

      const queryDrugNames = (finalSalt || '')
        .toLowerCase()
        .split(/\band\b|\+|,/i)
        .map(s => s.replace(/\d+\s*(mg|mcg|g|iu|ml)/gi, '').trim())
        .filter(s => s.length > 3)

      const seen = new Set()
      aiGenerics = genRes.value
        .filter(g => g && g.name && g.brand)

        .filter(g => {
          if (!queryDrugNames.length) return true
          const returnedSalt = (g.salt || '').toLowerCase()
          const returnedName = (g.name || '').toLowerCase()

          return queryDrugNames.every(drug =>
            returnedSalt.includes(drug) || returnedName.includes(drug)
          )
        })

        .filter(g => {
          const key = (g.brand || '').toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .slice(0, 3)
    }
  }

  let allAlts = [
    ...(jaBest ? [jaBest] : []),
    ...aiGenerics,
  ]

  if (allAlts.length > 0) {
    try {
      const davaMap = await batchFetchDavaIndiaPrices(allAlts)
      allAlts = allAlts.map(alt => {
        const key = alt.salt || alt.name
        const dava = davaMap.get(key)
        if (!dava) return alt
        return {
          ...alt,

          mrp:           dava.mrp,
          estimatedMrp:  dava.mrp,
          packSize:      dava.packSize || alt.packSize,
          perUnit:       dava.perUnit  ?? alt.perUnit,

          priceSource:   'DavaIndia',
          highConfidence: true,
          aiEstimated:   false,
          davaIndiaName: dava.name,
        }
      })
    } catch {

    }
  }

  const authenticity = buildAuthenticity(img, cdscoResult, isExpired, barcodeData, qrSalt)
  if ((img.confidence || 0) < 50 && !qrSalt) {
    authenticity.status  = 'CANNOT_DETERMINE'
    authenticity.warning = ((authenticity.warning || '') + ' Low confidence - verify with pharmacist.').trim()
  }

  const doseUnconfirmed = hasSalt && !hasDoseNumber && !qrSalt && typeNeedsDose

  return {
    productType:     img.productType || 'MEDICINE',
    brandName:       finalBrand,
    saltComposition: finalSalt,
    manufacturer:    img.manufacturer,
    mrp:             finalMrp,
    unitSize:        img.unitSize,
    batchNumber:     finalBatch,
    expiryDate:      expiryStr,
    isExpired,
    licenceNumber:   img.licenceNumber,
    confidence:      qrSalt ? 99 : (img.confidence || 70),
    saltSource:      qrSalt ? 'QR_BARCODE' : 'AI_VISION',
    doseUnconfirmed,
    cannotRead:      img.cannotRead || false,
    cannotReadReason:img.cannotReadReason || null,
    authenticity,
    medicineInfo:    info || fallbackInfo(img.productType),
    alternatives: {
      hasGenerics:          allAlts.length > 0,
      janAushadhiAvailable: !!jaBest,
      topAlternatives:      allAlts,
      doseMismatchAlt:      jaDoseDiff,
      jaCount:              jaBest ? 1 : 0,
      savingsSummary:       buildSavingsSummary(jaBest, finalMrp, img.unitSize),
      pharmacyLinks:        pharmacyLinks(finalSalt),
      whereToFind:          'Jan Aushadhi Kendras - janaushadhi.gov.in · 1800-180-8080',
      disclaimer:           'Jan Aushadhi prices from official BPPI database. HIGH CONFIDENCE prices are sourced live from DavaIndia. AI ESTIMATED prices are approximate - verify at the chemist.',
    },
    dataSource: {
      salt:       qrSalt ? 'QR barcode (verified)' : 'AI vision (estimated)',
      alts:       'BPPI Jan Aushadhi DB + AI',
      cdsco:      cdscoResult.found ? 'CDSCO Drug Registry' : 'Not in CDSCO registry',
      cdscoFound: cdscoResult.found,
    }
  }
}

function buildAuthenticity(img, cdsco, isExpired, barcode, qrSalt) {
  const genuine = img.genuineSignalsFound || []
  const fake    = img.fakeSignalsFound    || []

  if (isExpired) return {
    status: 'CANNOT_DETERMINE',
    reason: `Medicine appears expired (${img.expiryDate}).`,
    genuineSignalsFound: genuine, fakeSignalsFound: [...fake, 'Expired'],
    cdscoBadge: cdsco.badge || null, cdscoIndication: cdsco.indication || null,
    warning: ' Expired. Do not consume.',
  }

  const score = genuine.length * 18 - fake.length * 25 + (cdsco.found ? 20 : 0) + (barcode ? 15 : 0) + (qrSalt ? 20 : 0)
  const status = fake.length >= 2 || score < -20 ? 'LIKELY_FAKE'
    : score >= 30 || genuine.length >= 2           ? 'LIKELY_GENUINE'
    : 'CANNOT_DETERMINE'

  return {
    status,
    reason: [
      genuine.length ? `Genuine signals: ${genuine.join(', ')}` : '',
      fake.length    ? `Suspicious: ${fake.join(', ')}` : '',
      !genuine.length && !fake.length ? 'Insufficient visual evidence.' : '',
    ].filter(Boolean).join(' | '),
    genuineSignalsFound: genuine,
    fakeSignalsFound:    fake,
    cdscoBadge:      cdsco.badge || (
      img.productType === 'AYURVEDIC'  ? ' Regulated by AYUSH, not CDSCO.' :
      img.productType === 'SUPPLEMENT' ? 'Dietary supplement - not CDSCO scheduled.' :
      'Salt not found in CDSCO registry.'
    ),
    cdscoIndication:  cdsco.indication || null,
    cdscoFound:       cdsco.found,
    approvalDate:     cdsco.approvalDate || null,
    warning: fake.length ? 'Return to chemist. Report fakes: 1800-180-3024 (free).' : null,
  }
}

async function callVision(b64, mime, prompt) {

  let lastErr = 'no models available'
  const t0 = Date.now()
  for (const model of VISION_MODELS) {
    try {
      const res = await fetch(GROQ_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, max_tokens: 600, temperature: 0.05,
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }
          ]}]
        })
      })
      if (res.status === 429) { lastErr = `${model} rate-limited`; continue }
      if (res.status === 404) { lastErr = `${model} decommissioned`; continue }
      if (!res.ok) { const e = await res.json().catch(()=>({})); lastErr = e?.error?.message || `${res.status}`; continue }
      const data = await res.json()
      const rawResponse = data?.choices?.[0]?.message?.content
      const parsed = safeJSON(rawResponse)
      logAIResponse({ phase: 'vision', prompt, rawResponse, parsed, durationMs: Date.now()-t0 })
      if (parsed) return parsed
      lastErr = 'JSON parse fail'
    } catch(e) {
      lastErr = e.message
    }
  }

  return {
    productType: 'MEDICINE',
    brandName: null,
    saltName: null,
    doseStr: null,
    manufacturer: null,
    mrp: null,
    unitSize: null,
    batchNumber: null,
    expiryDate: null,
    confidence: 0,
    genuineSignalsFound: [],
    fakeSignalsFound: [],
    cannotRead: true,
    cannotReadReason: 'AI image analysis is unavailable in this local setup. Please use the text search or connect API keys to enable OCR.',
  }
}

async function callText(prompt) {

  let lastErr = 'no models'
  const t0 = Date.now()
  const phase = prompt.includes('pharmacist') ? 'generics' : 'description'
  for (const model of TEXT_MODELS) {
    try {
      const res = await fetch(GROQ_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 800, temperature: 0.1, messages: [{ role: 'user', content: prompt }] })
      })
      if (res.status === 429) { lastErr = `${model} rate-limited`; continue }
      if (res.status === 404) { lastErr = `${model} decommissioned`; continue }
      if (!res.ok) { lastErr = `${res.status}`; continue }
      const data = await res.json()
      const rawResponse = data?.choices?.[0]?.message?.content
      const parsed = safeJSON(rawResponse)
      logAIResponse({ phase, prompt, rawResponse, parsed, durationMs: Date.now()-t0 })
      if (parsed) return parsed
      lastErr = 'JSON parse'
    } catch(e) { lastErr = e.message }
  }
  return null
}

function safeJSON(t) {
  try { return JSON.parse((t||'').replace(/```json\n?/g,'').replace(/```\n?/g,'').trim()) }
  catch { return null }
}

function checkExpired(d) {
  try {
    const p = d.split('/')
    const dt = p.length === 3 ? new Date(`${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`)
             : p.length === 2 ? new Date(`${p[1]}-${p[0].padStart(2,'0')}-01`) : null
    return dt ? dt < new Date() : false
  } catch { return false }
}

function fallbackInfo(type) {
  if (type === 'AYURVEDIC') return { whatItDoes: 'Ayurvedic product.', ayurvedicWarning: 'Regulated by AYUSH Ministry. Consult a qualified practitioner.', commonUses:[], sideEffects:[], importantWarnings:[], prescriptionRequired:false }
  if (type === 'SUPPLEMENT') return { whatItDoes: 'Dietary supplement.', supplementWarning: 'Do not exceed stated dose. Consult doctor if on other medicines.', commonUses:[], sideEffects:[], importantWarnings:[], prescriptionRequired:false }
  return { whatItDoes: 'Medicine information unavailable.', commonUses:[], sideEffects:[], importantWarnings:[], prescriptionRequired:false }
}

export async function compressAndEncode(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      const MAX = 1000
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height/width*MAX); width = MAX }
        else { width = Math.round(width/height*MAX); height = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,width,height); ctx.drawImage(img,0,0,width,height)
      const tryEncode = (quality, cb) => {
        canvas.toBlob(blob => {
          const r = new FileReader()
          r.onload = () => cb(r.result.split(',')[1])
          r.onerror = reject
          r.readAsDataURL(blob)
        }, 'image/jpeg', quality)
      }
      tryEncode(0.50, resolve)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')) }
    img.src = url
  })
}

export const PRESCRIPTION_PROMPT = `Medical prescription reader. Extract ONLY patient name, doctor/hospital name, date, and the list of prescribed medicines.
Strive to read handwriting accurately. Infer common medical abbreviations (e.g., "1-0-1" = Morning & Night, "BD" = twice a day, "PC" = after food, "OD" = once a day).
If the image is totally unreadable or NOT a medical prescription, set cannotRead=true.

JSON only, no markdown:
{
  "doctorName": "Dr. Name / Clinic Name",
  "patientName": "Patient Name",
  "date": "Date if written",
  "medicines": [
    {
      "name": "Full drug name and strength",
      "dosage": "e.g., 1 tablet, 5ml",
      "frequency": "e.g., 1-1-1, or Twice a day",
      "duration": "e.g., 5 days",
      "instructions": "e.g., After food"
    }
  ],
  "confidence": 85,
  "cannotRead": false,
  "cannotReadReason": null
}`

export async function scanPrescription(imageBase64, mimeType = 'image/jpeg') {
  
  const img = await callVision(imageBase64, mimeType, PRESCRIPTION_PROMPT)
  
  if (img.cannotRead) {
    img.cannotReadReason = img.cannotReadReason || 'Could not read the prescription clearly. Try taking a brighter, closer photo.'
  }
  
  return {
    isPrescription: true,
    data: img
  }
}

export async function lookupMedicineNameOnly(name) {

  await ensureLoaded()

  let finalBrand = name
  let saltComposition = name

  try {
    const resolvePrompt = `You are an Indian pharmacological API. Given a search query (which can be a brand name, generic salt name, or combination), resolve it into the generic active ingredient salt name(s) (including typical strength/dose, e.g. "Paracetamol 500mg" or "Pantoprazole 40mg + Domperidone 30mg") and the active brand name.
Query: "${name}"
JSON ONLY, NO OTHER TEXT OR MARKDOWN:
{
  "brandName": "e.g. Crocin",
  "saltComposition": "e.g. Paracetamol 500mg"
}`;
    const resolved = await callText(resolvePrompt)
    if (resolved && resolved.saltComposition) {
      saltComposition = resolved.saltComposition
      if (resolved.brandName) {
        finalBrand = resolved.brandName
      }
    }
  } catch (e) {
    console.error("Failed to resolve brand to salt composition:", e)
  }

  if (!saltComposition || !saltComposition.trim() || saltComposition === name) {
    const offline = await resolveOfflineQuery(name)
    if (offline?.saltComposition) {
      saltComposition = offline.saltComposition
      finalBrand = offline.brandName || finalBrand
    }
  }

  const cdscoResult = lookupCDSCO(saltComposition)
  const jaLookup = lookupJanAushadhi(saltComposition, null, null)
  const jaBest = jaLookup.best
  const jaDoseDiff = jaLookup.doseMismatch

  let info = null, aiGenerics = []
  try {
    const [infoRes, genRes] = await Promise.allSettled([
      callText(mkDescPrompt(finalBrand, saltComposition, 'MEDICINE')),
      callText(mkGenericsPrompt(saltComposition, 'MEDICINE')),
    ])
    info = infoRes.status === 'fulfilled' ? infoRes.value : null
    if (info) info.prescriptionRequired = resolveRx(saltComposition, info.prescriptionRequired)
    if (genRes.status === 'fulfilled' && Array.isArray(genRes.value)) {

      const queryDrugNames = (saltComposition || '')
        .toLowerCase()
        .split(/\band\b|\+|,/i)
        .map(s => s.replace(/\d+\s*(mg|mcg|g|iu|ml)/gi, '').trim())
        .filter(s => s.length > 3)

      const seen = new Set()
      aiGenerics = genRes.value
        .filter(g => g && g.name && g.brand)
        .filter(g => {
          if (!queryDrugNames.length) return true
          const returnedSalt = (g.salt || '').toLowerCase()
          const returnedName = (g.name || '').toLowerCase()
          return queryDrugNames.every(drug =>
            returnedSalt.includes(drug) || returnedName.includes(drug)
          )
        })
        .filter(g => {
          const key = (g.brand || '').toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .slice(0, 3)
    }
  } catch (e) {
    console.error(e)
  }

  let allAlts = [
    ...(jaBest ? [jaBest] : []),
    ...aiGenerics,
  ]

  if (allAlts.length > 0) {
    try {
      const davaMap = await batchFetchDavaIndiaPrices(allAlts)
      allAlts = allAlts.map(alt => {
        const key = alt.salt || alt.name
        const dava = davaMap.get(key)
        if (!dava) return alt
        return {
          ...alt,
          mrp: dava.mrp,
          estimatedMrp: dava.mrp,
          packSize: dava.packSize || alt.packSize,
          perUnit: dava.perUnit ?? alt.perUnit,
          priceSource: 'DavaIndia',
          highConfidence: true,
          aiEstimated: false,
          davaIndiaName: dava.name,
        }
      })
    } catch {}
  }

  try {
    const cleanBrand = finalBrand.toLowerCase().replace(/\s*\d.*/g, '').trim()
    if (cleanBrand.length > 2) {
      allAlts = allAlts.filter(alt => {
        const b = (alt.brand || '').toLowerCase()
        return !b.includes(cleanBrand) && !cleanBrand.includes(b)
      })
    }
  } catch {}

  const authenticity = {
    status: cdscoResult.found ? 'LIKELY_GENUINE' : 'CANNOT_DETERMINE',
    reason: cdscoResult.found ? 'Matches national CDSCO registration database.' : 'Formulation not located in offline CDSCO registry index.',
    genuineSignalsFound: [],
    fakeSignalsFound: [],
    cdscoBadge: cdscoResult.badge || 'Salt not found in CDSCO registry.',
    cdscoIndication: cdscoResult.indication || null,
    cdscoFound: cdscoResult.found,
    approvalDate: cdscoResult.approvalDate || null,
    warning: null,
  }

  return {
    productType: 'MEDICINE',
    brandName: finalBrand,
    saltComposition: saltComposition,
    manufacturer: null,
    mrp: null,
    unitSize: null,
    batchNumber: null,
    expiryDate: null,
    isExpired: false,
    licenceNumber: null,
    confidence: 100,
    saltSource: 'GLOBAL_TEXT_LOOKUP',
    doseUnconfirmed: false,
    cannotRead: false,
    cannotReadReason: null,
    authenticity,
    medicineInfo: info || fallbackInfo('MEDICINE'),
    alternatives: {
      hasGenerics: allAlts.length > 0,
      janAushadhiAvailable: !!jaBest,
      topAlternatives: allAlts,
      doseMismatchAlt: jaDoseDiff,
      jaCount: jaBest ? 1 : 0,
      savingsSummary: buildSavingsSummary(jaBest, null, null),
      pharmacyLinks: pharmacyLinks(saltComposition),
      whereToFind: 'Jan Aushadhi Kendras - janaushadhi.gov.in · 1800-180-8080',
      disclaimer: 'Jan Aushadhi prices from official BPPI database. HIGH CONFIDENCE prices are sourced live from DavaIndia. AI ESTIMATED prices are approximate.',
    },
    dataSource: {
      salt: 'CDSCO Registry',
      alts: 'BPPI Jan Aushadhi DB + AI',
      cdsco: cdscoResult.found ? 'CDSCO Drug Registry' : 'Not in CDSCO registry',
      cdscoFound: cdscoResult.found,
    }
  }
}

