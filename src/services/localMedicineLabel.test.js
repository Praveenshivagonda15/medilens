import test from 'node:test'
import assert from 'node:assert/strict'
import { extractLocalLabelDetails, extractMedicineCandidateQueries, hasMedicineLabelEvidence, hasVerifiedMedicineEvidence, resolveKnownMedicineBrand } from './localMedicineLabel.js'
import { ensureLoaded, lookupJanAushadhi } from './dbService.js'

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

test('rejects fuzzy-only catalog hits and accepts packaging with known or exact medicine matches', () => {
  const text = 'Paracetamol Tablets IP 500 mg'
  assert.equal(hasVerifiedMedicineEvidence({ text, catalogMatches: [{ score: 2.2, exactMatch: false }] }), false)
  assert.equal(hasVerifiedMedicineEvidence({ text, catalogMatches: [{ score: 2.2, exactMatch: true }] }), true)
  assert.equal(hasVerifiedMedicineEvidence({ text, knownBrand: { brandName: 'Crocin' } }), true)
  assert.equal(hasVerifiedMedicineEvidence({ text: 'Crocin sale today' , knownBrand: { brandName: 'Crocin' } }), false)
})

test('rejects the uploaded college timetable as a medicine image', () => {
  const timetableOcr = `
    GURU NANAK DEV ENGINEERING COLLEGE BIDAR
    DEPARTMENT OF COMPUTER SCIENCE & ENGG
    Academic Year 2026-27 Semester ODD CLASS TIME TABLE
    Days Time MONDAY TUESDAY WEDNESDAY THURSDAY FRIDAY SATURDAY
    CNS FN JW IOT FN VP PC FN SW RSE FN RJ BDA FN SF
    Internet of Things Parallel computing Cryptography Network Security
    Big Data Analytics Road safety Engineering Major Project Phase-II
    Prof Vineeta Prof Savitri Prof John Prof Samreen Dr Dayanand
  `
  const labelDetails = extractLocalLabelDetails(timetableOcr)

  assert.equal(resolveKnownMedicineBrand(timetableOcr), null)
  assert.equal(hasVerifiedMedicineEvidence({
    text: timetableOcr,
    labelDetails,
    catalogMatches: [{ score: 2.2, exactMatch: true }],
  }), false)
})

test('keeps Migarid Flunarizine candidates and excludes an unrelated OCR ointment tail', async () => {
  const scanOcr = `
    Flunarizine Dihydrochloride Tablets 5 mg
    Migarid-5
    Each uncoated tablet contains
    Flunarizine Dihydrochloride BP equivalent to Flunarizine 5 mg
    Colour Lake Carmoisine
    Dosage: As directed by the Physician
    Schedule H prescription drug
    Alternative as Salicylic acid 1.15% w/w, Dithranol 1.15% w/w and Coal Tar 5.3% w/w Ointment
  `
  const candidates = extractMedicineCandidateQueries(scanOcr)
  assert.ok(candidates.some(candidate => /flunarizine/i.test(candidate)))
  assert.equal(candidates.some(candidate => /salicylic|dithranol|coal tar/i.test(candidate)), false)

  await ensureLoaded()
  const result = lookupJanAushadhi('Flunarizine Dihydrochloride 5 mg')
  assert.equal(result.best?.name, 'Flunarizine Tablets IP 5 mg')
  assert.equal(result.best?.mrp, 6.57)
})