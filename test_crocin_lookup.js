import { lookupMedicineNameOnly } from './src/services/geminiService.js';

async function test() {
  console.log("Testing lookupMedicineNameOnly('Crocin')...");
  try {
    const result = await lookupMedicineNameOnly("Crocin");
    console.log("Result Brand Name:", result.brandName);
    console.log("Result Salt Composition:", result.saltComposition);
    console.log("CDSCO Found:", result.authenticity.cdscoFound);
    console.log("CDSCO Badge:", result.authenticity.cdscoBadge);
    console.log("Jan Aushadhi Available:", result.alternatives.janAushadhiAvailable);
    console.log("Top Alternatives count:", result.alternatives.topAlternatives.length);
    console.log("Top Alternatives detail:", JSON.stringify(result.alternatives.topAlternatives, null, 2));
  } catch (err) {
    console.error("Error during test:", err);
  }
}

test();
