

export function normalizeSaltName(salt) {
  return (salt || '').toLowerCase()
    .replace(/\b\d+(\s*(mg|mcg|g|ml))?\b/g, '')
    .replace(/\b(sodium|potassium|citrate|maleate|succinate|hydrochloride|hcl|phosphate|sulfate)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class ClinicalGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
  }

  addNode(id, type, props = {}) {
    this.nodes.set(id, { id, type, ...props });
    if (!this.edges.has(id)) {
      this.edges.set(id, []);
    }
  }

  addEdge(source, target, relType, weight = 1) {
    if (!this.nodes.has(source)) this.addNode(source, 'Unknown');
    if (!this.nodes.has(target)) this.addNode(target, 'Unknown');
    
    this.edges.get(source).push({ targetId: target, relType, weight });
    this.edges.get(target).push({ targetId: source, relType, weight });
  }

  findPaths(startNode, endNode, maxDepth = 4) {
    const queue = [[startNode, []]];
    const visited = new Set();
    const paths = [];

    while (queue.length > 0) {
      const [current, path] = queue.shift();
      
      if (path.length > maxDepth) continue;

      if (current === endNode) {
        paths.push([...path, current]);
        continue;
      }

      visited.add(current);
      const neighbors = this.edges.get(current) || [];
      for (const edge of neighbors) {
        if (!path.includes(edge.targetId)) {
          queue.push([edge.targetId, [...path, current]]);
        }
      }
    }
    return paths;
  }
}

export const clinicalGraphInstance = new ClinicalGraph();
const g = clinicalGraphInstance;

g.addNode('aspirin', 'SALT', { name: 'Aspirin' });
g.addNode('warfarin', 'SALT', { name: 'Warfarin' });
g.addNode('ibuprofen', 'SALT', { name: 'Ibuprofen' });
g.addNode('sildenafil', 'SALT', { name: 'Sildenafil' });
g.addNode('nitroglycerin', 'SALT', { name: 'Nitroglycerin' });
g.addNode('lisinopril', 'SALT', { name: 'Lisinopril' });
g.addNode('spironolactone', 'SALT', { name: 'Spironolactone' });
g.addNode('simvastatin', 'SALT', { name: 'Simvastatin' });
g.addNode('amlodipine', 'SALT', { name: 'Amlodipine' });
g.addNode('metformin', 'SALT', { name: 'Metformin' });
g.addNode('glimepiride', 'SALT', { name: 'Glimepiride' });
g.addNode('paracetamol', 'SALT', { name: 'Paracetamol' });
g.addNode('acetaminophen', 'SALT', { name: 'Acetaminophen' });

g.addNode('nsaid', 'CLASS', { name: 'NSAID (Pain Reliever)' });
g.addNode('anticoagulant', 'CLASS', { name: 'Anticoagulant (Blood Thinner)' });
g.addNode('vasodilator', 'CLASS', { name: 'PDE5 Vasodilator' });
g.addNode('organic_nitrate', 'CLASS', { name: 'Organic Nitrate Vasodilator' });
g.addNode('ace_inhibitor', 'CLASS', { name: 'ACE Inhibitor (BP Lowering)' });
g.addNode('diuretic', 'CLASS', { name: 'Potassium-Sparing Diuretic' });
g.addNode('statin', 'CLASS', { name: 'HMG-CoA Reductase Statin' });
g.addNode('ccb', 'CLASS', { name: 'Calcium Channel Blocker' });
g.addNode('biguanide', 'CLASS', { name: 'Biguanide (Anti-Diabetic)' });
g.addNode('sulfonylurea', 'CLASS', { name: 'Sulfonylurea (Anti-Diabetic)' });
g.addNode('analgesic', 'CLASS', { name: 'Analgesic (Antipyretic)' });

g.addNode('bleeding_risk', 'PATHWAY', { name: 'Severe Bleeding Risk', severity: 'CRITICAL', title: 'Severe Bleeding Pathway Collision' });
g.addNode('hypotension_risk', 'PATHWAY', { name: 'Severe Hypotension Risk', severity: 'CRITICAL', title: 'Fatal Blood Pressure Drop Pathway' });
g.addNode('hyperkalemia_risk', 'PATHWAY', { name: 'Hyperkalemia Risk', severity: 'CRITICAL', title: 'Hyperkalemia Pathway Collision' });
g.addNode('statin_toxicity', 'PATHWAY', { name: 'Statin Toxicity Risk', severity: 'MODERATE', title: 'Statin Muscle Toxicity Pathway' });
g.addNode('hypoglycemia_risk', 'PATHWAY', { name: 'Hypoglycemia Risk', severity: 'MODERATE', title: 'Double Antidiabetic Hypoglycemia Pathway' });

g.addNode('dry_cough', 'SIDEEFFECT', { name: 'Dry Cough', description: 'ACE inhibitor-induced cough' });
g.addNode('stomach_bleed', 'SIDEEFFECT', { name: 'Stomach Bleed', description: 'NSAID-induced gastrointestinal bleeding or irritation' });
g.addNode('muscle_pain', 'SIDEEFFECT', { name: 'Muscle Pain', description: 'Statin-induced myalgia or rhabdomyolysis' });
g.addNode('hypoglycemia', 'SIDEEFFECT', { name: 'Hypoglycemia', description: 'Low blood sugar from antidiabetics' });
g.addNode('dizziness', 'SIDEEFFECT', { name: 'Dizziness', description: 'Blood pressure drop or orthostatic hypotension' });
g.addNode('nausea', 'SIDEEFFECT', { name: 'Nausea', description: 'Common gastrointestinal side effect' });
g.addNode('headache', 'SIDEEFFECT', { name: 'Headache', description: 'Vasodilator-induced cerebral pressure' });

g.addEdge('aspirin', 'nsaid', 'MEMBER_OF');
g.addEdge('ibuprofen', 'nsaid', 'MEMBER_OF');
g.addEdge('warfarin', 'anticoagulant', 'MEMBER_OF');
g.addEdge('sildenafil', 'vasodilator', 'MEMBER_OF');
g.addEdge('nitroglycerin', 'organic_nitrate', 'MEMBER_OF');
g.addEdge('lisinopril', 'ace_inhibitor', 'MEMBER_OF');
g.addEdge('spironolactone', 'diuretic', 'MEMBER_OF');
g.addEdge('simvastatin', 'statin', 'MEMBER_OF');
g.addEdge('amlodipine', 'ccb', 'MEMBER_OF');
g.addEdge('metformin', 'biguanide', 'MEMBER_OF');
g.addEdge('glimepiride', 'sulfonylurea', 'MEMBER_OF');
g.addEdge('paracetamol', 'analgesic', 'MEMBER_OF');
g.addEdge('acetaminophen', 'analgesic', 'MEMBER_OF');

g.addEdge('lisinopril', 'dry_cough', 'CAUSES');
g.addEdge('aspirin', 'stomach_bleed', 'CAUSES');
g.addEdge('ibuprofen', 'stomach_bleed', 'CAUSES');
g.addEdge('simvastatin', 'muscle_pain', 'CAUSES');
g.addEdge('glimepiride', 'hypoglycemia', 'CAUSES');
g.addEdge('amlodipine', 'dizziness', 'CAUSES');
g.addEdge('metformin', 'nausea', 'CAUSES');
g.addEdge('nitroglycerin', 'headache', 'CAUSES');

g.addEdge('nsaid', 'bleeding_risk', 'POTENTIATES');
g.addEdge('anticoagulant', 'bleeding_risk', 'POTENTIATES');

g.addEdge('vasodilator', 'hypotension_risk', 'POTENTIATES');
g.addEdge('organic_nitrate', 'hypotension_risk', 'POTENTIATES');

g.addEdge('ace_inhibitor', 'hyperkalemia_risk', 'POTENTIATES');
g.addEdge('diuretic', 'hyperkalemia_risk', 'POTENTIATES');

g.addEdge('statin', 'statin_toxicity', 'POTENTIATES');
g.addEdge('ccb', 'statin_toxicity', 'POTENTIATES');

g.addEdge('biguanide', 'hypoglycemia_risk', 'POTENTIATES');
g.addEdge('sulfonylurea', 'hypoglycemia_risk', 'POTENTIATES');

g.addEdge('ibuprofen', 'aspirin', 'INTERACTS_WITH', 2);

export function checkInteractions(activeSalts) {
  if (!Array.isArray(activeSalts) || activeSalts.length < 2) return [];

  const normalized = activeSalts.map(s => ({
    original: s,
    clean: normalizeSaltName(s)
  })).filter(s => s.clean.length > 0);

  const collisions = [];
  const processedPairs = new Set();

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const s1 = normalized[i];
      const s2 = normalized[j];

      const node1Key = Array.from(g.nodes.keys()).find(k => s1.clean.includes(k) || k.includes(s1.clean));
      const node2Key = Array.from(g.nodes.keys()).find(k => s2.clean.includes(k) || k.includes(s2.clean));

      if (!node1Key || !node2Key || node1Key === node2Key) continue;

      const pairKey = [node1Key, node2Key].sort().join('-');
      if (processedPairs.has(pairKey)) continue;
      processedPairs.add(pairKey);

      const paths = g.findPaths(node1Key, node2Key, 4);

      for (const path of paths) {
        const pathwayId = path.find(nodeId => g.nodes.get(nodeId)?.type === 'PATHWAY');
        
        if (pathwayId) {
          const pathwayNode = g.nodes.get(pathwayId);
          const c1Id = path[1];
          const c2Id = path[path.length - 2];
          const class1 = g.nodes.get(c1Id)?.name || c1Id;
          const class2 = g.nodes.get(c2Id)?.name || c2Id;

          let explanation = `Combining ${s1.original} and ${s2.original} is contraindicated. `;
          if (pathwayId === 'bleeding_risk') {
            explanation += `Both ${s1.original} (${class1}) and ${s2.original} (${class2}) potentiate the bleeding pathway, severely raising the risk of internal bleeding and gastrointestinal hemorrhage.`;
          } else if (pathwayId === 'hypotension_risk') {
            explanation += `Both ${s1.original} (${class1}) and ${s2.original} (${class2}) induce vessel dilation. Taking them together causes a synergistic drop in systemic blood pressure, which can be fatal.`;
          } else if (pathwayId === 'hyperkalemia_risk') {
            explanation += `Both ${s1.original} (${class1}) and ${s2.original} (${class2}) lead to renal potassium accumulation. This increases potassium concentrations (hyperkalemia), potentially inducing cardiac arrhythmias.`;
          } else if (pathwayId === 'statin_toxicity') {
            explanation += `The CCB agent ${s2.original} inhibits the metabolism of the HMG-CoA Statin ${s1.original}, elevating its systemic concentration and increasing the risk of muscle toxicity (rhabdomyolysis).`;
          } else if (pathwayId === 'hypoglycemia_risk') {
            explanation += `Both ${s1.original} (${class1}) and ${s2.original} (${class2}) increase insulin secretion or glucose absorption. Combining them increases the risk of severe hypoglycemia.`;
          }

          collisions.push({
            severity: pathwayNode.severity,
            title: pathwayNode.title,
            saltA: s1.original,
            saltB: s2.original,
            explanation,
            path: path.map(nodeId => g.nodes.get(nodeId)?.name || nodeId)
          });
        }

        if (path.length === 2) {
          if ((node1Key === 'ibuprofen' && node2Key === 'aspirin') || (node1Key === 'aspirin' && node2Key === 'ibuprofen')) {
            collisions.push({
              severity: 'MODERATE',
              title: 'Reduced Cardioprotective Benefit',
              saltA: s1.original,
              saltB: s2.original,
              explanation: 'Ibuprofen blocks the beneficial antiplatelet anti-clogging effects of low-dose Aspirin. Space the doses out if both are required.',
              path: [s1.original, 'Direct Interference', s2.original]
            });
          }
        }
      }
    }
  }

  return collisions;
}

export function checkTherapeuticDuplication(activeSalts) {
  if (!Array.isArray(activeSalts) || activeSalts.length < 2) return [];

  const normalized = activeSalts.map(s => ({
    original: s,
    clean: normalizeSaltName(s)
  })).filter(s => s.clean.length > 0);

  const duplicates = [];
  const classMap = new Map();

  for (const s of normalized) {
    const nodeKey = Array.from(g.nodes.keys()).find(k => s.clean.includes(k) || k.includes(s.clean));
    if (nodeKey) {
      const edges = g.edges.get(nodeKey) || [];
      const classEdges = edges.filter(e => e.relType === 'MEMBER_OF');
      
      for (const e of classEdges) {
        const clsName = g.nodes.get(e.targetId)?.name || e.targetId;
        if (!classMap.has(clsName)) {
          classMap.set(clsName, []);
        }
        classMap.get(clsName).push(s.original);
      }
    }
  }

  for (const [className, medicines] of classMap.entries()) {
    if (medicines.length >= 2) {
      duplicates.push({
        severity: 'ALERT',
        title: 'Therapeutic Class Overlap',
        className,
        medicines,
        explanation: `You are taking multiple ingredients classified as ${className} (${medicines.join(' + ')}). Taking overlapping classes can increase side effects or lead to accidental toxic overdose. Consult a pharmacist.`
      });
    }
  }

  return duplicates;
}

export const CHRONOTHERAPY_METADATA = {
  'omeprazole': { idealTime: 'Morning', foodRelation: 'Empty Stomach (30m before breakfast)', rationale: 'PPIs require active proton pumps to bind; taking before first meal maximizes acid suppression.' },
  'pantoprazole': { idealTime: 'Morning', foodRelation: 'Empty Stomach (30m before breakfast)', rationale: 'PPIs require active proton pumps to bind; taking before first meal maximizes acid suppression.' },
  'rabeprazole': { idealTime: 'Morning', foodRelation: 'Empty Stomach (30m before breakfast)', rationale: 'PPIs require active proton pumps to bind; taking before first meal maximizes acid suppression.' },
  'simvastatin': { idealTime: 'Bedtime', foodRelation: 'With or without food', rationale: 'Cholesterol synthesis peaks during early morning hours; short-acting statins work best at bedtime.' },
  'atorvastatin': { idealTime: 'Bedtime', foodRelation: 'With or without food', rationale: 'Bedtime dosing aligns with peak hepatic cholesterol synthesis.' },
  'rosuvastatin': { idealTime: 'Bedtime', foodRelation: 'With or without food', rationale: 'Bedtime dosing aligns with peak hepatic cholesterol synthesis.' },
  'aspirin': { idealTime: 'Morning', foodRelation: 'After Food', rationale: 'Taking after food reduces mucosal stomach lining irritation.' },
  'ibuprofen': { idealTime: 'Evening', foodRelation: 'After Food', rationale: 'NSAIDs should be taken with food. Spaced to avoid blocking Aspirin’s antiplatelet effects.' },
  'diclofenac': { idealTime: 'Evening', foodRelation: 'After Food', rationale: 'NSAIDs should be taken with food to prevent gastric upset.' },
  'aceclofenac': { idealTime: 'Evening', foodRelation: 'After Food', rationale: 'NSAIDs should be taken with food to prevent gastric upset.' },
  'paracetamol': { idealTime: 'Afternoon', foodRelation: 'With or without food', rationale: 'Commonly taken for mid-day relief; ensure 4-6 hours spacing between doses.' },
  'metformin': { idealTime: 'Evening', foodRelation: 'With Food', rationale: 'Metformin is taken with dinner to minimize gastrointestinal side effects.' },
  'lisinopril': { idealTime: 'Morning', foodRelation: 'With or without food', rationale: 'Dosing blood pressure medication in the morning prevents daytime hypertension spikes.' },
  'losartan': { idealTime: 'Morning', foodRelation: 'With or without food', rationale: 'Dosing blood pressure medication in the morning prevents daytime hypertension spikes.' },
  'telmisartan': { idealTime: 'Morning', foodRelation: 'With or without food', rationale: 'Long half-life allows morning dosing for stable 24h pressure control.' }
};

export function orchestrateMedicationSchedule(cabinetItems) {
  const schedule = {
    'Morning': [],
    'Afternoon': [],
    'Evening': [],
    'Bedtime': []
  };
  const notes = [];

  if (!Array.isArray(cabinetItems) || cabinetItems.length === 0) {
    return { schedule, notes };
  }

  const processed = cabinetItems.map(item => {
    const clean = normalizeSaltName(item.saltComposition);
    const metaKey = Object.keys(CHRONOTHERAPY_METADATA).find(k => clean.includes(k));
    const meta = metaKey ? { ...CHRONOTHERAPY_METADATA[metaKey] } : {
      idealTime: 'Morning',
      foodRelation: 'With or without food',
      rationale: 'Standard maintenance dosing.'
    };
    return {
      brandName: item.brandName,
      saltComposition: item.saltComposition,
      clean,
      meta
    };
  });

  const hasAspirin = processed.some(item => item.clean.includes('aspirin'));
  const hasIbuprofen = processed.some(item => item.clean.includes('ibuprofen'));

  if (hasAspirin && hasIbuprofen) {
    notes.push({
      type: 'spacing',
      message: ' Spaced-Dosing Alert: Aspirin and Ibuprofen are in your cabinet. Ibuprofen has been automatically scheduled to Bedtime to prevent it from blocking Aspirin’s cardiovascular antiplatelet effects.'
    });

    processed.forEach(item => {
      if (item.clean.includes('aspirin')) {
        item.meta.idealTime = 'Morning';
      }
      if (item.clean.includes('ibuprofen')) {
        item.meta.idealTime = 'Bedtime';
      }
    });
  }

  processed.forEach(item => {
    const slot = item.meta.idealTime || 'Morning';
    if (schedule[slot]) {
      schedule[slot].push({
        brandName: item.brandName,
        saltComposition: item.saltComposition,
        foodRelation: item.meta.foodRelation,
        rationale: item.meta.rationale
      });
    }
  });

  return { schedule, notes };
}

export function flagPotentialSideEffects(activeSalts, loggedSymptoms) {
  if (!Array.isArray(activeSalts) || activeSalts.length === 0 || !Array.isArray(loggedSymptoms) || loggedSymptoms.length === 0) {
    return [];
  }

  const normalizedSalts = activeSalts.map(s => normalizeSaltName(s)).filter(s => s.length > 0);
  const normalizedSymptoms = loggedSymptoms.map(s => s.toLowerCase().trim()).filter(s => s.length > 0);
  const flags = [];

  for (const saltClean of normalizedSalts) {

    const saltNodeKey = Array.from(g.nodes.keys()).find(k => {
      const cleanK = k.replace(/[^a-z0-9]/g, '');
      const cleanS = saltClean.replace(/[^a-z0-9]/g, '');
      return cleanS.includes(cleanK) || cleanK.includes(cleanS);
    });
    if (!saltNodeKey) continue;

    for (const symptom of normalizedSymptoms) {

      const sideEffectNodeKey = Array.from(g.nodes.keys()).find(k => {
        const node = g.nodes.get(k);
        const cleanK = k.replace(/[^a-z0-9]/g, '');
        const cleanS = symptom.replace(/[^a-z0-9]/g, '');
        return node?.type === 'SIDEEFFECT' && (cleanS.includes(cleanK) || cleanK.includes(cleanS));
      });
      if (!sideEffectNodeKey) continue;

      const paths = g.findPaths(saltNodeKey, sideEffectNodeKey, 3);
      if (paths.length > 0) {
        const sideEffectNode = g.nodes.get(sideEffectNodeKey);
        const saltNode = g.nodes.get(saltNodeKey);
        flags.push({
          salt: saltNode.name,
          symptom: sideEffectNode.name,
          explanation: `️ Potential Side Effect: Your symptom '${symptom}' matches a known side effect of ${saltNode.name} (${sideEffectNode.description}).`,
        });
      }
    }
  }

  return flags;
}

