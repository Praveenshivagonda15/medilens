

const PK_LIBRARY = {
  paracetamol: {
    name: 'Paracetamol',
    halfLifeElimination: 2.5,
    halfLifeAbsorption: 0.3,
    vd: 0.9,
    bioavailability: 0.8,
    minEffectiveConc: 5.0,
    minToxicConc: 15.0,
    typicalDose: 500,
    partition: 'hydrophilic',
    maxDailyDoseMg: 4000,
  },
  ibuprofen: {
    name: 'Ibuprofen',
    halfLifeElimination: 2.0,
    halfLifeAbsorption: 0.4,
    vd: 0.15,
    bioavailability: 0.9,
    minEffectiveConc: 10.0,
    minToxicConc: 45.0,
    typicalDose: 400,
    partition: 'lipophilic',
    maxDailyDoseMg: 2400,
  },
  atorvastatin: {
    name: 'Atorvastatin',
    halfLifeElimination: 14.0,
    halfLifeAbsorption: 0.3,
    vd: 5.5,
    bioavailability: 0.14,
    minEffectiveConc: 0.002,
    minToxicConc: 0.012,
    typicalDose: 10,
    partition: 'lipophilic',
    maxDailyDoseMg: 80,
  },
  metformin: {
    name: 'Metformin',
    halfLifeElimination: 6.2,
    halfLifeAbsorption: 0.8,
    vd: 4.0,
    bioavailability: 0.55,
    minEffectiveConc: 0.5,
    minToxicConc: 2.5,
    typicalDose: 500,
    partition: 'hydrophilic',
    maxDailyDoseMg: 2550,
  },
  pantoprazole: {
    name: 'Pantoprazole',
    halfLifeElimination: 1.0,
    halfLifeAbsorption: 1.8,
    vd: 0.15,
    bioavailability: 0.77,
    minEffectiveConc: 0.5,
    minToxicConc: 2.0,
    typicalDose: 40,
    partition: 'hydrophilic',
    maxDailyDoseMg: 240,
  },
  amoxicillin: {
    name: 'Amoxicillin',
    halfLifeElimination: 1.0,
    halfLifeAbsorption: 0.5,
    vd: 0.3,
    bioavailability: 0.85,
    minEffectiveConc: 2.0,
    minToxicConc: 20.0,
    typicalDose: 500,
    partition: 'hydrophilic',
    maxDailyDoseMg: 3000,
  },
  duloxetine: {
    name: 'Duloxetine',
    halfLifeElimination: 12.0,
    halfLifeAbsorption: 1.0,
    vd: 2.6,
    bioavailability: 0.5,
    minEffectiveConc: 0.03,
    minToxicConc: 0.15,
    typicalDose: 60,
    partition: 'lipophilic',
    maxDailyDoseMg: 120,
  },
  azithromycin: {
    name: 'Azithromycin',
    halfLifeElimination: 68.0,
    halfLifeAbsorption: 0.5,
    vd: 31.0,
    bioavailability: 0.37,
    minEffectiveConc: 0.4,
    minToxicConc: 3.0,
    typicalDose: 500,
    partition: 'lipophilic',
    maxDailyDoseMg: 500,
  },
  cetirizine: {
    name: 'Cetirizine',
    halfLifeElimination: 8.3,
    halfLifeAbsorption: 0.4,
    vd: 0.4,
    bioavailability: 0.7,
    minEffectiveConc: 0.1,
    minToxicConc: 0.8,
    typicalDose: 10,
    partition: 'hydrophilic',
    maxDailyDoseMg: 10,
  },
  telmisartan: {
    name: 'Telmisartan',
    halfLifeElimination: 24.0,
    halfLifeAbsorption: 0.5,
    vd: 7.0,
    bioavailability: 0.42,
    minEffectiveConc: 0.04,
    minToxicConc: 0.3,
    typicalDose: 40,
    partition: 'lipophilic',
    maxDailyDoseMg: 80,
  },
  amlodipine: {
    name: 'Amlodipine',
    halfLifeElimination: 35.0,
    halfLifeAbsorption: 1.2,
    vd: 21.0,
    bioavailability: 0.64,
    minEffectiveConc: 0.005,
    minToxicConc: 0.025,
    typicalDose: 5,
    partition: 'lipophilic',
    maxDailyDoseMg: 10,
  }
}

export function getPKParameters(saltComposition) {
  if (!saltComposition) return null
  const normalized = saltComposition.toLowerCase()
  for (const key in PK_LIBRARY) {
    if (normalized.includes(key)) {
      return PK_LIBRARY[key]
    }
  }

  let detectedDose = 500
  const match = saltComposition.match(/(\d+)\s*mg/i)
  if (match) {
    detectedDose = parseInt(match[1]) || 500
  }
  const calculatedMax = detectedDose <= 50 ? detectedDose * 2 : detectedDose <= 200 ? detectedDose * 3 : detectedDose * 4

  return {
    name: saltComposition.split(' ')[0] || 'Drug',
    halfLifeElimination: 4.0,
    halfLifeAbsorption: 0.5,
    vd: 1.0,
    bioavailability: 0.7,
    minEffectiveConc: 1.0,
    minToxicConc: 30.0,
    typicalDose: detectedDose,
    partition: 'hydrophilic',
    maxDailyDoseMg: calculatedMax,
  }
}

export function calculatePhysiologicalIndices(weightKg, heightCm, ageYears, gender) {
  const w = parseFloat(weightKg) || 70
  const h = parseFloat(heightCm) || 170
  const age = parseFloat(ageYears) || 30
  const g = (gender || 'male').toLowerCase()

  const bmi = w / ((h / 100) ** 2)
  const bsa = Math.sqrt((w * h) / 3600)

  let lbm = w
  if (g === 'female') {
    lbm = 1.07 * w - 148 * ((w / h) ** 2)
  } else {
    lbm = 1.10 * w - 128 * ((w / h) ** 2)
  }
  if (lbm <= 0 || lbm > w) {
    lbm = w * 0.75
  }

  return {
    bmi: Math.round(bmi * 10) / 10,
    bsa: Math.round(bsa * 100) / 100,
    lbm: Math.round(lbm * 10) / 10
  }
}

export function simulatePharmacokinetics(params, doseMg, doseTimesHours, weightKg = 70, heightCm = 170, ageYears = 30, gender = 'male', durationHours = 24) {
  if (!params) return []
  
  const indices = calculatePhysiologicalIndices(weightKg, heightCm, ageYears, gender)
  const F = params.bioavailability

  let Vd = 0
  if (params.partition === 'hydrophilic') {

    Vd = params.vd * indices.lbm
  } else {

    Vd = params.vd * weightKg
  }
  if (Vd <= 0) Vd = 50

  let renalFactor = 1.0
  if (ageYears > 50) {
    renalFactor = Math.max(0.4, 1.0 - 0.008 * (ageYears - 50))
  }
  if (gender === 'female') {
    renalFactor *= 0.85
  }
  
  const Ke = (Math.log(2) / params.halfLifeElimination) * renalFactor
  const Ka = Math.log(2) / params.halfLifeAbsorption

  const diff = Ka - Ke
  const divisor = Math.abs(diff) < 1e-4 ? 1e-4 : diff
  const coefficient = (F * doseMg * Ka) / (Vd * divisor)
  
  const dataPoints = []
  const step = 0.25
  
  for (let t = 0; t <= durationHours; t += step) {
    let totalConc = 0

    for (const doseTime of doseTimesHours) {
      if (t >= doseTime) {
        const dt = t - doseTime
        const conc = coefficient * (Math.exp(-Ke * dt) - Math.exp(-Ka * dt))
        totalConc += Math.max(0, conc)
      }
    }
    
    dataPoints.push({
      time: Math.round(t * 100) / 100,
      conc: Math.round(totalConc * 100000) / 100000
    })
  }
  
  return dataPoints
}

export function checkDosageSafety(saltComposition, doseStrengthMg, dailyFrequency, weightKg = 70, heightCm = 170, ageYears = 30, gender = 'male') {
  const params = getPKParameters(saltComposition);
  const standardMaxMg = params ? params.maxDailyDoseMg : 2000;
  
  const w = parseFloat(weightKg) || 70;
  const age = parseFloat(ageYears) || 30;
  const g = (gender || 'male').toLowerCase();

  let weightScale = 1.0;
  if (age < 18 || w < 55) {
    weightScale = Math.max(0.1, w / 70);
  }
  
  let renalFactor = 1.0;
  if (params && params.partition === 'hydrophilic') {
    if (age > 50) {
      renalFactor = Math.max(0.4, 1.0 - 0.008 * (age - 50));
    }
    if (g === 'female') {
      renalFactor *= 0.9;
    }
  }
  
  const maxSafeMg = Math.min(standardMaxMg, standardMaxMg * weightScale * renalFactor);
  const scheduledMg = (parseFloat(doseStrengthMg) || 0) * (parseInt(dailyFrequency) || 1);
  
  let safe = scheduledMg <= maxSafeMg;
  let reason = '';
  
  if (!safe) {
    if (age < 18) {
      reason = `Daily intake of ${scheduledMg}mg exceeds pediatric safety limit of ${Math.round(maxSafeMg)}mg for a child of ${w}kg. (standard clinical guidance, but listen to your actual doctor and not a website designed by a sleep-deprived programmer)`;
    } else if (age > 50 && renalFactor < 0.9) {
      reason = `Daily intake of ${scheduledMg}mg exceeds age-adjusted safety limit of ${Math.round(maxSafeMg)}mg due to age-related renal clearance decline. (clinical guidelines, but listen to your doctor, not a website)`;
    } else {
      reason = `Daily intake of ${scheduledMg}mg exceeds weight-adjusted safety limit of ${Math.round(maxSafeMg)}mg for a patient of ${w}kg. (clinical guidelines, but listen to your doctor, not me)`;
    }
  } else {
    reason = `Dose of ${scheduledMg}mg/day is safe for patient weight (${w}kg) and age (${age}). (at least according to standard medical sheets, but verify with a pharmacist before swallowing pills)`;
  }
  
  return {
    safe,
    maxSafeMg: Math.round(maxSafeMg),
    scheduledMg,
    reason
  };
}

