import test from 'node:test'
import assert from 'node:assert/strict'
import { extractLocalLabelDetails, hasMedicineLabelEvidence, hasVerifiedMedicineEvidence, resolveKnownMedicineBrand } from './localMedicineLabel.js'

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