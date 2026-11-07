/**
 * LuminaMed - Clinical Drug-Drug Interaction & Contraindication Engine
 * Comprehensive clinical safety database and pairwise conflict detection.
 */

(function(window) {
  'use strict';

  // ==========================================================================
  // Clinical Drug Interaction Database
  // Pairs, classes, severity, clinical mechanism, and actionable recommendations
  // ==========================================================================
  const DRUG_INTERACTIONS_DB = [
    {
      drugs: ['warfarin', 'aspirin'],
      severity: 'severe',
      title: 'Anticoagulant + Antiplatelet Potentiation',
      description: 'Concomitant use substantially increases upper gastrointestinal and systemic bleeding risks.',
      recommendation: 'Requires strict physician oversight and INR monitoring. Consider gastroprotection (PPI) if co-prescribed.',
      action: 'Separate administration & consult doctor immediately'
    },
    {
      drugs: ['warfarin', 'ibuprofen'],
      severity: 'severe',
      title: 'NSAID + Anticoagulant Hemorrhage Hazard',
      description: 'NSAIDs displace warfarin from albumin, inhibit platelet aggregation, and cause gastric mucosal erosions.',
      recommendation: 'Avoid combination. Use acetaminophen for analgesia instead under medical guidance.',
      action: 'Avoid combination. High GI bleed risk.'
    },
    {
      drugs: ['warfarin', 'naproxen'],
      severity: 'severe',
      title: 'NSAID + Anticoagulant Hemorrhage Hazard',
      description: 'Naproxen significantly elevates major bleeding and gastrointestinal ulceration risk.',
      recommendation: 'Avoid combination. Seek non-NSAID alternatives from your prescriber.',
      action: 'Avoid combination.'
    },
    {
      drugs: ['lisinopril', 'spironolactone'],
      severity: 'severe',
      title: 'Hyperkalemia Cardiac Arrhythmia Risk',
      description: 'Both medications elevate serum potassium levels. Combining them may trigger dangerous cardiac arrhythmias.',
      recommendation: 'Requires baseline and periodic serum potassium and renal function testing.',
      action: 'Monitor potassium levels closely. Do not use potassium salt substitutes.'
    },
    {
      drugs: ['losartan', 'spironolactone'],
      severity: 'severe',
      title: 'Hyperkalemia Cardiac Arrhythmia Risk',
      description: 'ARB combined with aldosterone antagonist causes additive potassium retention and renal impairment risk.',
      recommendation: 'Frequent electrolyte checks required. Avoid potassium supplements.',
      action: 'Monitor potassium & creatinine.'
    },
    {
      drugs: ['lisinopril', 'potassium'],
      severity: 'severe',
      title: 'Severe Hyperkalemia Risk',
      description: 'ACE inhibitors reduce aldosterone secretion, impairing potassium excretion. Adding potassium supplements risks fatal hyperkalemia.',
      recommendation: 'Potassium supplementation should only be taken if explicitly directed and monitored by your doctor.',
      action: 'Consult prescribing physician.'
    },
    {
      drugs: ['atorvastatin', 'clarithromycin'],
      severity: 'severe',
      title: 'CYP3A4 Inhibition - Rhabdomyolysis Risk',
      description: 'Clarithromycin strongly inhibits CYP3A4, leading to massive accumulation of atorvastatin and acute muscle breakdown (rhabdomyolysis).',
      recommendation: 'Temporarily suspend atorvastatin during macrolide antibiotic course or choose an alternative antibiotic.',
      action: 'Suspend statin during antibiotic therapy after doctor approval.'
    },
    {
      drugs: ['simvastatin', 'clarithromycin'],
      severity: 'severe',
      title: 'Severe Statin Toxicity / Rhabdomyolysis',
      description: 'Clarithromycin dramatically increases simvastatin serum concentrations up to 10-fold.',
      recommendation: 'Strictly contraindicated. Switch antibiotic or pause simvastatin under clinical guidance.',
      action: 'Contraindicated combination.'
    },
    {
      drugs: ['sertraline', 'tramadol'],
      severity: 'severe',
      title: 'Serotonin Syndrome & Seizure Risk',
      description: 'Additive serotonergic activity increases the risk of life-threatening Serotonin Syndrome and lowers seizure threshold.',
      recommendation: 'Monitor for mental status changes, tremor, rigidity, hyperthermia, and agitation.',
      action: 'Use with extreme caution under psychiatric supervision.'
    },
    {
      drugs: ['fluoxetine', 'tramadol'],
      severity: 'severe',
      title: 'Serotonin Syndrome & Seizure Risk',
      description: 'Potent CYP2D6 inhibition by fluoxetine plus dual serotonergic reuptake causes severe toxic syndrome risk.',
      recommendation: 'Avoid co-prescription where possible. Watch for tachycardia, diaphoresis, and clonus.',
      action: 'High-risk interaction.'
    },
    {
      drugs: ['sildenafil', 'nitroglycerin'],
      severity: 'severe',
      title: 'Fatal Hypotensive Collapse (Contraindicated)',
      description: 'PDE5 inhibitors potentiate hypotensive effects of organic nitrates, risking life-threatening blood pressure drop and myocardial infarction.',
      recommendation: 'Absolutely contraindicated. Do not take within 24 hours of each other under any circumstance.',
      action: 'Strictly contraindicated. Never take together.'
    },
    {
      drugs: ['tadalafil', 'nitroglycerin'],
      severity: 'severe',
      title: 'Fatal Hypotensive Collapse (Contraindicated)',
      description: 'Tadalafil combined with nitrates causes profound, irreversible vasodilation and shock.',
      recommendation: 'Do not take nitrates within 48 hours of tadalafil.',
      action: 'Strictly contraindicated.'
    },
    {
      drugs: ['alprazolam', 'tramadol'],
      severity: 'severe',
      title: 'Additive CNS & Respiratory Depression',
      description: 'Benzodiazepines combined with opioid analgesics carry FDA Black Box warning for profound sedation, respiratory depression, and coma.',
      recommendation: 'Dose reductions and continuous observation recommended.',
      action: 'High-risk combination. Never exceed prescribed doses.'
    },
    {
      drugs: ['clonazepam', 'codeine'],
      severity: 'severe',
      title: 'Severe Respiratory Depression Risk',
      description: 'Concurrent central nervous system depressants impair respiratory drive.',
      recommendation: 'Keep naloxone accessible if on combined therapy.',
      action: 'Monitor respiratory rate and alertness.'
    },
    {
      drugs: ['metformin', 'alcohol'],
      severity: 'severe',
      title: 'Lactic Acidosis Toxicity',
      description: 'Alcohol potentiates metformin effects on lactate metabolism, triggering potentially fatal lactic acidosis.',
      recommendation: 'Avoid excessive acute or chronic alcohol intake while taking metformin.',
      action: 'Strictly limit or avoid alcohol.'
    },
    {
      drugs: ['levothyroxine', 'calcium'],
      severity: 'moderate',
      title: 'Decreased Thyroid Hormone Absorption',
      description: 'Calcium binds to levothyroxine in the gastrointestinal tract, significantly reducing thyroid hormone absorption.',
      recommendation: 'Separate oral administration by at least 4 hours.',
      action: 'Separate timing by at least 4 hours apart.'
    },
    {
      drugs: ['levothyroxine', 'iron'],
      severity: 'moderate',
      title: 'Decreased Thyroid Absorption by Chelation',
      description: 'Ferrous sulfate binds to levothyroxine forming an insoluble compound that fails to absorb.',
      recommendation: 'Take levothyroxine on an empty stomach in the morning; take iron supplements 4 to 6 hours later.',
      action: 'Space doses by 4 to 6 hours.'
    },
    {
      drugs: ['levothyroxine', 'omeprazole'],
      severity: 'moderate',
      title: 'Reduced Absorption via Gastric Acid Suppression',
      description: 'PPIs raise intragastric pH, impairing dissolution and bioavailability of levothyroxine.',
      recommendation: 'Monitor TSH levels; thyroid dosage adjustment may be needed.',
      action: 'Take levothyroxine 30-60m before omeprazole or meals.'
    },
    {
      drugs: ['ciprofloxacin', 'calcium'],
      severity: 'moderate',
      title: 'Antibiotic Chelation / Absorption Failure',
      description: 'Polyvalent cations in dairy or calcium supplements chelate fluoroquinolones, cutting absorption by over 50%.',
      recommendation: 'Administer ciprofloxacin at least 2 hours before or 4 hours after calcium/dairy products.',
      action: 'Separate by 2 hours before or 4 hours after dairy/calcium.'
    },
    {
      drugs: ['doxycycline', 'calcium'],
      severity: 'moderate',
      title: 'Tetracycline Chelation',
      description: 'Calcium forms non-absorbable chelates with doxycycline in the digestive tract.',
      recommendation: 'Do not take with milk, yogurt, or calcium supplements. Separate by 2-3 hours.',
      action: 'Separate by 2-3 hours from dairy products.'
    },
    {
      drugs: ['clopidogrel', 'omeprazole'],
      severity: 'moderate',
      title: 'Reduced Antiplatelet Efficacy',
      description: 'Omeprazole inhibits CYP2C19, preventing metabolic activation of clopidogrel and increasing thrombosis risk.',
      recommendation: 'Use pantoprazole instead, which exhibits minimal CYP2C19 inhibition.',
      action: 'Ask doctor to substitute omeprazole with pantoprazole.'
    },
    {
      drugs: ['methotrexate', 'ibuprofen'],
      severity: 'severe',
      title: 'Methotrexate Toxicity / Bone Marrow Suppression',
      description: 'NSAIDs diminish renal blood flow and competitive tubular secretion of methotrexate, causing severe toxicity.',
      recommendation: 'Avoid combination unless low-dose methotrexate is closely monitored by rheumatology.',
      action: 'Notify your physician before taking any NSAIDs.'
    },
    {
      drugs: ['lithium', 'ibuprofen'],
      severity: 'severe',
      title: 'Elevated Lithium Toxicity',
      description: 'NSAIDs decrease renal prostaglandin synthesis, lowering lithium clearance by 20-40% and risking neurotoxicity.',
      recommendation: 'Monitor serum lithium levels closely or use acetaminophen instead.',
      action: 'Avoid NSAIDs; use acetaminophen after clinical confirmation.'
    },
    {
      drugs: ['aspirin', 'ibuprofen'],
      severity: 'moderate',
      title: 'Loss of Cardioprotective Antiplatelet Effect',
      description: 'Ibuprofen competitively blocks aspirin binding to platelet COX-1, negating stroke/heart attack cardioprotection.',
      recommendation: 'Take immediate-release aspirin at least 30 minutes before ibuprofen, or 8 hours after.',
      action: 'Take aspirin 30 min before ibuprofen.'
    },
    {
      drugs: ['digoxin', 'amiodarone'],
      severity: 'severe',
      title: 'Digoxin Toxicity & AV Block',
      description: 'Amiodarone inhibits P-glycoprotein, doubling serum digoxin concentrations and inducing fatal bradycardia.',
      recommendation: 'Reduce digoxin dose by 50% upon starting amiodarone and monitor ECG.',
      action: 'Requires dose adjustment & ECG monitoring.'
    },
    {
      drugs: ['digoxin', 'furosemide'],
      severity: 'moderate',
      title: 'Hypokalemia-Induced Digoxin Arrhythmia',
      description: 'Loop diuretics deplete serum potassium and magnesium, sensitizing the myocardium to digoxin toxicity.',
      recommendation: 'Maintain serum potassium between 4.0 and 5.0 mEq/L.',
      action: 'Monitor potassium levels regularly.'
    },
    {
      drugs: ['paracetamol', 'alcohol'],
      severity: 'moderate',
      title: 'Hepatotoxicity Risk',
      description: 'Ethanol induces CYP2E1, converting paracetamol into toxic metabolite NAPQI, risking acute liver damage.',
      recommendation: 'Do not exceed 2g daily if consuming alcohol; avoid alcohol during high-dose therapy.',
      action: 'Avoid alcohol while taking paracetamol.'
    },
    {
      drugs: ['metronidazole', 'alcohol'],
      severity: 'severe',
      title: 'Disulfiram-Like Reaction',
      description: 'Inhibits aldehyde dehydrogenase, causing violent nausea, vomiting, flushing, and tachycardia.',
      recommendation: 'Strictly avoid all alcohol and alcohol-containing medications during and for 48 hours after treatment.',
      action: 'Strictly avoid alcohol during and 48h after therapy.'
    }
  ];

  // ==========================================================================
  // Known Food & Dietary Warning Mapping
  // ==========================================================================
  const DIETARY_KNOWLEDGE_BASE = [
    {
      keywords: ['atorvastatin', 'simvastatin', 'lovastatin', 'amlodipine', 'felodipine', 'tacrolimus'],
      warnings: ['Avoid Grapefruit & Juice'],
      reason: 'Inhibits intestinal CYP3A4 enzymes, causing dangerously high medication concentrations in the bloodstream.'
    },
    {
      keywords: ['doxycycline', 'tetracycline', 'ciprofloxacin', 'levofloxacin', 'norfloxacin', 'alendronate'],
      warnings: ['Avoid Dairy / High Calcium (Milk, Yogurt)'],
      reason: 'Calcium ions chelate with the medication molecules, cutting absorption by over 50%.'
    },
    {
      keywords: ['metronidazole', 'paracetamol', 'acetaminophen', 'warfarin', 'methotrexate', 'ketoconazole', 'isoniazid'],
      warnings: ['Strict No Alcohol'],
      reason: 'Increases liver stress or triggers severe disulfiram-like vomiting and flushing reactions.'
    },
    {
      keywords: ['lisinopril', 'ramipril', 'enalapril', 'losartan', 'valsartan', 'spironolactone'],
      warnings: ['Avoid High Potassium / Bananas / Salt Substitutes'],
      reason: 'Reduces potassium excretion in urine; excess dietary potassium can trigger dangerous cardiac arrhythmias.'
    },
    {
      keywords: ['alendronate', 'ibandronate', 'risedronate', 'aspirin', 'iron', 'ferrous'],
      warnings: ['Drink Full Glass of Water & Stay Upright'],
      reason: 'Prevents severe pill-induced esophageal ulceration and ensures proper gastrointestinal dissolution.'
    },
    {
      keywords: ['theophylline', 'pseudoephedrine', 'ciprofloxacin'],
      warnings: ['Limit Caffeine & Energy Drinks'],
      reason: 'Decreases caffeine clearance, leading to tremors, palpitations, and elevated blood pressure.'
    }
  ];

  // ==========================================================================
  // Engine Helper Methods
  // ==========================================================================
  const InteractionsEngine = {
    /**
     * Normalize drug names for fuzzy/alias matching
     */
    normalizeName(name) {
      if (!name) return '';
      return name.toLowerCase().trim()
        .replace(/[^a-z0-9]/g, ' ')
        .split(' ')
        .filter(w => w.length > 2)[0] || name.toLowerCase().trim();
    },

    /**
     * Check if a single drug matches a target term or alias
     */
    matchesDrug(medName, target) {
      if (!medName || !target) return false;
      const clean = medName.toLowerCase();
      const t = target.toLowerCase();

      // Direct inclusion
      if (clean.includes(t) || t.includes(clean)) return true;

      // Common clinical aliases / trade names
      const ALIASES = {
        'paracetamol': ['acetaminophen', 'tylenol', 'crocin', 'dolo', 'calpol', 'panadol'],
        'aspirin': ['ecotrin', 'disprin', 'acetylsalicylic'],
        'ibuprofen': ['advil', 'motrin', 'brufen', 'nurofen'],
        'warfarin': ['coumadin', 'jantoven'],
        'atorvastatin': ['lipitor', 'atorva'],
        'simvastatin': ['zocor'],
        'lisinopril': ['prinivil', 'zestril'],
        'losartan': ['cozaar'],
        'spironolactone': ['aldactone'],
        'metformin': ['glucophage', 'glycomet'],
        'omeprazole': ['prilosec', 'omez'],
        'pantoprazole': ['protonix', 'pantocid', 'pan'],
        'ciprofloxacin': ['cipro', 'cifran'],
        'levothyroxine': ['synthroid', 'eltroxin', 'thyronorm'],
        'sertraline': ['zoloft', 'daxid'],
        'fluoxetine': ['prozac'],
        'tramadol': ['ultram'],
        'sildenafil': ['viagra'],
        'tadalafil': ['cialis'],
        'clarithromycin': ['biaxin', 'klaricid'],
        'iron': ['ferrous', 'ferroglobe', 'autrin'],
        'calcium': ['caltrate', 'shelcal', 'calcium carbonate']
      };

      if (ALIASES[t]) {
        for (const alias of ALIASES[t]) {
          if (clean.includes(alias)) return true;
        }
      }

      // Check reverse alias lookup
      for (const [key, list] of Object.entries(ALIASES)) {
        if (list.includes(clean) && (key === t || key.includes(t))) {
          return true;
        }
      }

      return false;
    },

    /**
     * Scan an entire list of medications and find all pairwise interactions
     */
    scanCabinet(medications) {
      if (!medications || medications.length < 2) {
        return [];
      }

      const results = [];
      const checkedPairs = new Set();

      for (let i = 0; i < medications.length; i++) {
        for (let j = i + 1; j < medications.length; j++) {
          const medA = medications[i];
          const medB = medications[j];

          const pairId = [medA.id, medB.id].sort().join('__');
          if (checkedPairs.has(pairId)) continue;
          checkedPairs.add(pairId);

          const matches = this.checkPair(medA.name, medB.name);
          matches.forEach(m => {
            results.push({
              ...m,
              medA,
              medB
            });
          });
        }
      }

      // Sort: severe first, then moderate, then minor
      const order = { severe: 1, moderate: 2, minor: 3 };
      results.sort((a, b) => (order[a.severity] || 99) - (order[b.severity] || 99));

      return results;
    },

    /**
     * Check if a specific single medication conflicts with existing active list
     */
    checkNewAgainstCabinet(newMedName, currentMeds, currentMedId = null) {
      if (!newMedName || !currentMeds || currentMeds.length === 0) return [];
      const results = [];

      currentMeds.forEach(existing => {
        if (currentMedId && existing.id === currentMedId) return;
        const conflicts = this.checkPair(newMedName, existing.name);
        conflicts.forEach(c => {
          results.push({
            ...c,
            otherMed: existing
          });
        });
      });

      return results;
    },

    /**
     * Check pair of drug names against clinical database
     */
    checkPair(nameA, nameB) {
      if (!nameA || !nameB) return [];
      const matches = [];

      for (const item of DRUG_INTERACTIONS_DB) {
        const [target1, target2] = item.drugs;
        const matchForward = this.matchesDrug(nameA, target1) && this.matchesDrug(nameB, target2);
        const matchBackward = this.matchesDrug(nameA, target2) && this.matchesDrug(nameB, target1);

        if (matchForward || matchBackward) {
          matches.push({
            ...item,
            matchedNames: [nameA, nameB]
          });
        }
      }

      return matches;
    },

    /**
     * Auto-detect recommended dietary warnings for a medication by name
     */
    detectDietaryWarnings(medName) {
      if (!medName) return [];
      const clean = medName.toLowerCase();
      const detected = new Set();

      for (const entry of DIETARY_KNOWLEDGE_BASE) {
        for (const kw of entry.keywords) {
          if (clean.includes(kw) || this.matchesDrug(clean, kw)) {
            entry.warnings.forEach(w => detected.add(w));
            break;
          }
        }
      }

      return Array.from(detected);
    },

    /**
     * Get explanatory reason for a dietary warning
     */
    getDietaryWarningReason(warningText) {
      for (const entry of DIETARY_KNOWLEDGE_BASE) {
        if (entry.warnings.includes(warningText)) {
          return entry.reason;
        }
      }
      return 'Observe dietary precautions to maximize drug efficacy and prevent unwanted stomach irritation.';
    },

    /**
     * Map dietary warning to Lucide icon name
     */
    getDietaryIcon(warningText) {
      const text = (warningText || '').toLowerCase();
      if (text.includes('grapefruit') || text.includes('citrus')) return 'citrus';
      if (text.includes('dairy') || text.includes('milk') || text.includes('calcium')) return 'milk';
      if (text.includes('alcohol')) return 'wine-off';
      if (text.includes('potassium') || text.includes('banana')) return 'alert-circle';
      if (text.includes('water') || text.includes('upright')) return 'glass-water';
      if (text.includes('caffeine') || text.includes('coffee')) return 'coffee';
      return 'alert-triangle';
    }
  };

  // Expose to window
  window.LuminaInteractions = InteractionsEngine;

})(window);
