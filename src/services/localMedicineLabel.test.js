import test from 'node:test'
import assert from 'node:assert/strict'
import { extractLocalLabelDetails, hasCatalogIngredientMatch, hasMedicineLabelEvidence, hasVerifiedMedicineEvidence, resolveKnownMedicineBrand, selectBestMedicineOcrText } from './localMedicineLabel.js'
import { ensureLoaded, lookupJanAushadhi, matchQuality, parseSalts } from './dbService.js'

test('resolves a Dolo 650 brand from OCR text to its active salt and strength', () => {
  assert.deepEqual(resolveKnownMedicineBrand('Paracetamol Tablets IP\nDolo-650'), {
    brandName: 'Dolo 650',
    saltComposition: 'Paracetamol 650mg',
  })
})

test('extracts printed package fields from OCR text without inventing missing values', () => {
  const details = extractLocalLabelDetails(`
    MRP Rs. 35.00 incl of all taxes
    Batch No: DL650A23
    EXP: NOV 2027
    Mfg. by MICRO LABS LIMITED
    10 Tablets
  `)

  assert.deepEqual(details, {
    manufacturer: 'MICRO LABS LIMITED',
    mrp: 35,
    unitSize: '10 tablets',
    batchNumber: 'DL650A23',
    expiryDate: '11/2027',
  })
})

test('leaves label fields empty when OCR text does not contain them', () => {
  assert.deepEqual(extractLocalLabelDetails('Paracetamol Tablets IP 650mg'), {
    manufacturer: null,
    mrp: null,
    unitSize: null,
    batchNumber: null,
    expiryDate: null,
  })
})

test('requires medicine packaging evidence rather than arbitrary OCR text', () => {
  assert.equal(hasMedicineLabelEvidence('SALE TODAY AT MAIN STREET MARKET'), false)
  assert.equal(hasMedicineLabelEvidence('Paracetamol Tablets IP 500 mg'), true)
  assert.equal(hasMedicineLabelEvidence('Batch No: AB1234'), true)
})

test('prefers original-image OCR when it recovers a known brand and package details', () => {
  const processedText = 'tablets 650 mg'
  const originalText = 'Paracetamol Tablets IP Dolo-650 Each uncoated tablet contains Paracetamol IP 650 mg Mfg. by Micro Labs Limited'
  assert.equal(selectBestMedicineOcrText(processedText, originalText), originalText)
})

test('matches OCR ingredients to catalog products and rejects unrelated product ingredients', () => {
  const text = 'Flunarizine Dihydrochloride Tablets 5 mg Migarid 5 Each uncoated tablet contains Flunarizine'
  const tablet = { row: { 'Generic Name': 'Flunarizine Tablets IP 5 mg' } }
  const unrelatedOintment = { row: { 'Generic Name': 'Salicylic acid 1.15% w/w, Dithranol 1.15% w/w and Coal Tar 5.3% w/w Ointment' } }

  assert.equal(hasCatalogIngredientMatch(text, tablet), true)
  assert.equal(hasCatalogIngredientMatch(text.replaceAll('Flunarizine', 'Flunarzine'), tablet), true)
  assert.equal(hasCatalogIngredientMatch(text, unrelatedOintment), false)
  assert.equal(hasVerifiedMedicineEvidence({ text, catalogMatches: [unrelatedOintment] }), false)
  assert.equal(hasVerifiedMedicineEvidence({ text, catalogMatches: [tablet] }), true)
  assert.equal(hasVerifiedMedicineEvidence({ text, knownBrand: { brandName: 'Crocin' } }), true)
  assert.equal(hasVerifiedMedicineEvidence({ text: 'Crocin sale today' , knownBrand: { brandName: 'Crocin' } }), false)
})

test('Flunarizine 5 mg matches its tablet record and blocks the unrelated ointment', async () => {
  await ensureLoaded()
  const query = parseSalts('Flunarizine Dihydrochloride 5 mg')
  const correctProduct = parseSalts('Flunarizine Tablets IP 5 mg')
  const unrelatedOintment = parseSalts('Salicylic acid 1.15% w/w, Dithranol 1.15% w/w and Coal Tar 5.3% w/w Ointment')

  assert.equal(matchQuality(query, correctProduct), 'exact')
  assert.equal(matchQuality(query, unrelatedOintment), 'blocked')
  assert.equal(lookupJanAushadhi('Flunarizine Dihydrochloride 5 mg').best?.name, 'Flunarizine Tablets IP 5 mg')
})